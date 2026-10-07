// Primera carga: convierte los Excel actuales en el estado de la herramienta.
//
// La herramienta llega vacía ("cascarón"); los datos reales solo entran por aquí,
// desde los archivos del usuario, en su propio equipo. Ver docs/07-migracion.md.

import { esInterna, etapaDe, normalizarArea } from "../nucleo/areas.js";
import { hayInterseccion, clavesDeBusqueda, clavesPropias } from "../nucleo/catalogo.js";
import { CERO, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, estadoVacio, siguienteId } from "../nucleo/estado.js";
import { inventarioPorId } from "../nucleo/inventarios.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, isoDesdePartes } from "../nucleo/fechas.js";
import { sumaCantidad, sumaTotal } from "../importadores/inventario.js";
import { limpiarDiario, respuestasVacias } from "./limpieza.js";

export const MINIMO_ENTREGAS_ALMACENISTA = 20;

export class BaseNoVacia extends Error {}

/**
 * Carga todo en un estado NUEVO: si algo falla, no queda nada a medias.
 *
 * @param inventario  resultado de leerInventario
 * @param vales       resultado de leerVales
 * @param opciones    { folioCorte, fechaConteo, usuario, respuestas, idInventario (DLTA o GSM) }
 * @returns {{ estado, reporte }}
 */
export function ejecutarPrimeraCarga(inventario, vales, opciones) {
  const { folioCorte, fechaConteo, usuario = null } = opciones;
  const respuestas = opciones.respuestas || respuestasVacias();
  const de = inventarioPorId(opciones.idInventario);
  const estado = estadoVacio(de.id);
  const indices = new Indices(estado);
  const reporte = {
    articulos: 0,
    articulos_por_confirmar: [],
    variantes: 0,
    existencias: 0,
    hojas: [],
    diferencias: [],
    vales: 0,
    renglones_diario: 0,
    lineas_migradas: 0,
    omitidos: [],
    correcciones: [],
    folios_faltantes: [],
    por_ubicar: [],
    lineas_ubicadas: 0,
    personas: 0,
    plantillas_area: 0,
    advertencias: [],
    cuadra: false,
  };

  cargarCatalogo(estado, inventario, vales);
  const conteo = indices.agregarConteo({
    fecha: fechaConteo,
    descripcion: `Conteo inicial (importado de ${inventario.nombre})`,
    alcance: "TOTAL",
    usuario,
    ultimo_folio_salida: folioCorte,
    ultimo_folio_entrada: 0,
  });
  cargarInventario(indices, inventario, conteo, reporte);
  reporte.advertencias.push(...respuestas.advertencias);
  cargarPlantillas(estado, indices, vales, respuestas, reporte);
  cargarDiario(estado, indices, vales, respuestas, { folioCorte, usuario }, reporte);
  verificar(estado, indices, inventario, reporte);
  estado.config.almacen_ax = de.almacenAx;
  auditar(estado, {
    usuario,
    entidad: "sistema",
    accion: "PRIMERA_CARGA",
    despues: {
      de: de.id,
      inventario: inventario.nombre,
      vales: vales.nombre,
      folio_corte: folioCorte,
      fecha_conteo: fechaConteo,
      existencias: reporte.existencias,
      vales_migrados: reporte.vales,
    },
  });
  return { estado, reporte };
}

// ------------------------------------------------------------------ catálogo

/** ARTICULOS_MX manda (alimenta el BUSCARV del inventario); el catálogo de vales completa. */
function cargarCatalogo(estado, inventario, vales) {
  for (const [origen, catalogo] of [
    ["ARTICULOS_MX", inventario.catalogo],
    ["CATALOGO_VALES", vales.catalogo],
  ]) {
    for (const [codigo, descripcion] of catalogo) {
      if (!estado.articulos[codigo]) {
        estado.articulos[codigo] = {
          codigo,
          descripcion: descripcion ?? `CÓDIGO ${codigo}`,
          clase: null,
          modelo_ax: null,
          origen,
          por_confirmar: false,
          activo: true,
        };
      }
    }
  }
}

// ---------------------------------------------------------------- inventario

function cargarInventario(indices, inventario, conteo, reporte) {
  for (const hoja of inventario.hojas) {
    const ubicacion = indices.agregarUbicacion({
      contenedor: hoja.contenedor,
      clase: hoja.clase,
      hoja_excel: hoja.nombre,
      tabla_excel: hoja.tabla,
      orden: hoja.orden,
    });
    hoja.renglones.forEach((renglon, i) => {
      const articulo = indices.obtenerOCrearArticulo(renglon.codigo, renglon.descripcion, "INVENTARIO");
      const variante = indices.obtenerOCrearVariante(articulo.codigo, renglon.dimension, renglon.np, renglon.um);
      indices.agregarExistencia({
        variante_id: variante.id,
        ubicacion_id: ubicacion.id,
        orden: i + 1,
        item: renglon.item,
        cantidad_conteo: decTexto(renglon.cantidad),
        conteo_id: conteo.id,
        nota: renglon.nota,
        fila_origen: renglon.fila,
        dimension_hoja: renglon.dimension !== variante.dimension ? renglon.dimension : null,
        np_hoja: renglon.np !== variante.np ? renglon.np : null,
        um_hoja: renglon.um_hoja !== variante.um ? renglon.um_hoja : null,
      });
    });
    reporte.existencias += hoja.renglones.length;
  }
}

// --------------------------------------------------------- personas y áreas

function alias(respuestas, nombre) {
  return nombre ? (respuestas.alias.get(nombre) ?? nombre) : null;
}

/**
 * Completa un área con lo que trae su hoja-formulario y que versiones anteriores no leían:
 * puesto de quien autoriza y la segunda fila de firmas (NOV). No pisa lo que ya tenga.
 */
export function completarAreaDesdeFormulario(area, p, indices, nombreCanonico = (x) => x) {
  if (!area.autoriza_puesto && p.autoriza_puesto) area.autoriza_puesto = p.autoriza_puesto;
  // En el DIARIO, la macro guarda las firmas por posición: con el almacenista a la derecha
  // (NOV), "Entrego" es quien firma a la izquierda.
  area.almacenista_derecha ??= Boolean(p.almacenista_derecha);
  if (!area.firmas_extra && p.firmas_extra) {
    const lado = (x) => ({ titulo: x.titulo ?? null, nombre: nombreCanonico(x.nombre) ?? null, puesto: x.puesto ?? null });
    area.firmas_extra = { izq: lado(p.firmas_extra.izq), der: lado(p.firmas_extra.der) };
    for (const x of Object.values(area.firmas_extra)) indices.persona(x.nombre, { puesto: x.puesto ?? undefined });
  }
  return area;
}

function cargarPlantillas(estado, indices, vales, respuestas, reporte) {
  vales.plantillas.forEach((p, i) => {
    const entrega = alias(respuestas, p.entrega_nombre);
    const recibe = alias(respuestas, p.recibe_nombre);
    const autoriza = alias(respuestas, p.autoriza_nombre);
    indices.persona(entrega, { puesto: p.entrega_puesto });
    indices.persona(recibe, { puesto: p.recibe_puesto });
    indices.persona(autoriza, { puesto: p.autoriza_puesto ?? undefined });
    const esTransferencia = `${p.hoja}${p.depto_destino || ""}`.toUpperCase().includes("TRANSFER");
    estado.plantillas_area.push({
      id: siguienteId(estado, "plantilla_area"),
      nombre: p.hoja.trim(),
      hoja_excel: p.hoja,
      origen: p.origen,
      depto_origen: p.depto_origen,
      destino: p.destino,
      depto_destino: p.depto_destino,
      entrega_nombre: entrega,
      entrega_puesto: p.entrega_puesto,
      recibe_nombre: recibe,
      recibe_puesto: p.recibe_puesto,
      autoriza_nombre: autoriza,
      autoriza_puesto: p.autoriza_puesto ?? null,
      firmas_extra: null,
      requiere_autoriza: Boolean(autoriza) || esTransferencia,
      naturaleza: esTransferencia ? "TRANSFERENCIA" : "CONSUMO",
      observaciones: p.observaciones,
      lote_defecto: null,
      orden: i + 1,
      activo: true,
    });
    normalizarArea(estado.plantillas_area.at(-1));
    completarAreaDesdeFormulario(estado.plantillas_area.at(-1), p, indices, (nombre) => alias(respuestas, nombre));
  });
  const interna = estado.plantillas_area.find((a) => esInterna(a) && etapaDe(a.observaciones) !== null);
  estado.config.etapa_perforacion = interna ? etapaDe(interna.observaciones) : "";
  estado.config.captura_rapida = false;
  reporte.plantillas_area = vales.plantillas.length;
}

// ------------------------------------------------------------------- DIARIO

function cargarDiario(estado, indices, vales, respuestas, { folioCorte, usuario }, reporte) {
  const catalogo = new Map(Object.values(estado.articulos).map((a) => [a.codigo, a.descripcion]));
  const resultado = limpiarDiario(vales.renglones, catalogo, respuestas);
  reporte.renglones_diario = vales.renglones.length;
  reporte.omitidos = resultado.omitidos;
  reporte.correcciones = resultado.correcciones;
  reporte.folios_faltantes = resultado.folios_faltantes;

  for (const [codigo, descripcion] of resultado.codigos_nuevos) {
    indices.obtenerOCrearArticulo(codigo, descripcion, "DIARIO");
  }
  for (const [codigo, [, descripcion]] of respuestas.codigos) {
    const articulo = estado.articulos[codigo];
    if (articulo && descripcion) {
      articulo.descripcion = descripcion;
      articulo.por_confirmar = false;
    }
  }

  const entregas = new Map();
  for (const v of resultado.vales) if (v.entrego) entregas.set(v.entrego, (entregas.get(v.entrego) || 0) + 1);
  agregarValesMigrados(estado, indices, resultado.vales, { folioCorte, usuario }, reporte);
  for (const [nombre, veces] of entregas) {
    if (veces >= MINIMO_ENTREGAS_ALMACENISTA && indices.personas.has(nombre)) {
      indices.personas.get(nombre).es_almacenista = true;
    }
  }
  for (const [variante, correcto] of respuestas.alias) {
    if (variante !== correcto && indices.personas.has(correcto) && !(variante in estado.alias)) {
      estado.alias[variante] = indices.personas.get(correcto).id;
    }
  }
  reporte.vales = resultado.vales.length;
  reporte.personas = estado.personas.length;
}

/**
 * Agrega vales ya limpios (limpiarDiario) al estado como vales migrados. Los que tienen
 * folio posterior al corte se ligan a su renglón de inventario cuando no hay duda.
 */
export function agregarValesMigrados(estado, indices, valesMigrados, { folioCorte, usuario }, reporte) {
  const indice = indiceExistencias(estado, indices);
  const creado = ahoraIso();
  for (const migrado of valesMigrados) {
    for (const nombre of [migrado.entrego, migrado.recibio, migrado.autorizo]) indices.persona(nombre);
    const vale = {
      id: siguienteId(estado, "vale"),
      tipo: "SALIDA",
      folio: migrado.folio,
      folio_externo: null,
      estado: "EMITIDO",
      fecha: migrado.fecha,
      origen: migrado.origen,
      depto_origen: migrado.depto_origen,
      destino: migrado.destino,
      depto_destino: migrado.depto_destino,
      entrego_nombre: migrado.entrego,
      entrego_puesto: null,
      recibio_nombre: migrado.recibio,
      recibio_puesto: null,
      autorizo_nombre: migrado.autorizo,
      observaciones: null,
      plantilla_area_id: null,
      naturaleza: (migrado.depto_destino || "").toUpperCase().includes("TRANSFER") ? "TRANSFERENCIA" : "CONSUMO",
      creado_por: usuario,
      creado_en: creado,
      emitido_en: null,
      cancelado_en: null,
      motivo_cancelacion: null,
      migrado: true,
      notas: null,
      lineas: [],
    };
    const afectaExistencias = migrado.folio > folioCorte;
    migrado.lineas.forEach((linea, i) => {
      const renglon = i + 1;
      const valeLinea = {
        id: siguienteId(estado, "vale_linea"),
        renglon,
        oc: linea.oc,
        cantidad: decTexto(linea.cantidad),
        codigo: linea.codigo,
        descripcion: linea.descripcion,
        clave: linea.clave,
        um: linea.um,
        lote: linea.lote,
        variante_id: null,
        existencia_id: null,
        no_inventariado: false,
        familia: linea.familia,
        transferencia_consumo: linea.transferencia_consumo,
        encabezado_original: Object.keys(linea.encabezado_original).length ? linea.encabezado_original : null,
        fila_diario_origen: linea.fila,
        notas: linea.notas.join("\n") || null,
      };
      if (afectaExistencias) {
        const candidatos = candidatosExactos(indice, indices, linea.codigo, linea.clave);
        if (candidatos.length === 1) {
          valeLinea.existencia_id = candidatos[0].id;
          valeLinea.variante_id = candidatos[0].variante_id;
          reporte.lineas_ubicadas += 1;
        } else if (linea.codigo !== null && !(indice.get(linea.codigo) || []).length) {
          valeLinea.no_inventariado = true;
        } else {
          reporte.por_ubicar.push({
            folio: migrado.folio,
            renglon,
            codigo: linea.codigo,
            descripcion: linea.descripcion,
            clave: linea.clave,
            cantidad: linea.cantidad,
            candidatos: candidatos.length,
          });
        }
      }
      vale.lineas.push(valeLinea);
      reporte.lineas_migradas += 1;
    });
    estado.vales.push(vale);
  }
}

export function indiceExistencias(estado, indices) {
  const indice = new Map();
  for (const existencia of estado.existencias) {
    const codigo = indices.variante(existencia.variante_id).codigo;
    if (!indice.has(codigo)) indice.set(codigo, []);
    indice.get(codigo).push(existencia);
  }
  return indice;
}

/** Renglones de inventario a los que corresponde una línea de vale (coincidencia de clave). */
export function candidatosExactos(indice, indices, codigo, clave) {
  if (codigo === null || codigo === undefined) return [];
  const existencias = indice.get(codigo) || [];
  const claves = clavesDeBusqueda(clave);
  if (!claves.size) return existencias.length === 1 ? existencias : [];
  return existencias.filter((e) => hayInterseccion(claves, clavesPropias(indices.variante(e.variante_id))));
}

// ---------------------------------------------------------------- verificación

function verificar(estado, indices, inventario, reporte) {
  const saldos = calcularSaldos(estado);
  const existencias = new Map(
    estado.existencias.map((e) => [`${indices.ubicacion(e.ubicacion_id).hoja_excel}\u0000${e.fila_origen}`, e]),
  );
  for (const hoja of inventario.hojas) {
    let totalCalculado = CERO;
    for (const renglon of hoja.renglones) {
      const existencia = existencias.get(`${hoja.nombre}\u0000${renglon.fila}`);
      const saldo = saldos.get(existencia.id);
      totalCalculado = totalCalculado.plus(saldo.total);
      const archivoConsumo = renglon.consumo ?? CERO;
      const archivoIngreso = renglon.ingreso ?? CERO;
      if (!archivoConsumo.eq(saldo.consumo) || !archivoIngreso.eq(saldo.ingreso)) {
        reporte.diferencias.push({
          hoja: hoja.nombre,
          fila: renglon.fila,
          codigo: renglon.codigo,
          dimension: renglon.dimension,
          archivo_consumo: archivoConsumo,
          calculado_consumo: saldo.consumo,
          archivo_ingreso: archivoIngreso,
          calculado_ingreso: saldo.ingreso,
        });
      }
    }
    reporte.hojas.push({
      hoja: hoja.nombre,
      renglones: hoja.renglones.length,
      cantidad_archivo: sumaCantidad(hoja),
      total_archivo: sumaTotal(hoja),
      total_calculado: totalCalculado,
      filas_vacias_omitidas: hoja.filas_vacias,
    });
  }
  reporte.articulos = Object.keys(estado.articulos).length;
  reporte.variantes = estado.variantes.length;
  reporte.articulos_por_confirmar = Object.values(estado.articulos)
    .filter((a) => a.por_confirmar)
    .sort((a, b) => a.codigo - b.codigo)
    .map((a) => [a.codigo, a.descripcion]);
  reporte.cuadra = !reporte.diferencias.length && reporte.hojas.every((h) => h.total_archivo.eq(h.total_calculado));
}

// ------------------------------------------------------------------ sugerencias

/**
 * '…ALMACEN_280926.xlsx' → 2026-09-28; 'DELTA RIG 91 27-09-26' → 2026-09-27.
 * Si hay varias coincidencias se toma la última fecha válida.
 */
export function fechaDesdeNombre(nombre) {
  const patron = /(?<!\d)(?=(\d{2})[-_ ]?(\d{2})[-_ ]?(\d{2})(?!\d))/g;
  let encontrada = null;
  for (const m of nombre.matchAll(patron)) {
    const fecha = isoDesdePartes(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
    if (fecha) encontrada = fecha;
  }
  return encontrada;
}

/** Último folio con fecha anterior al conteo: sus vales ya están reflejados en CANTIDAD. */
export function sugerirFolioCorte(renglones, fechaConteo) {
  let maximo = null;
  for (const r of renglones) {
    if (r.folio !== null && r.fecha && r.fecha < fechaConteo && (maximo === null || r.folio > maximo)) maximo = r.folio;
  }
  return maximo;
}
