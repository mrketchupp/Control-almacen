// Exporta los vales de DLTA / GSM: DIARIO y los rangos de sus tablas, si las tiene.
//
// Mapeo de columnas en docs/06-formatos-excel.md, sección B. Emula lo que hacía la
// macro PasarDatos: los campos vacíos se escribían como 0 y la O.C. vacía como S/OC.

import { dec } from "../nucleo/decimal.js";
import { FechaCelda, serialExcel } from "../nucleo/fechas.js";
import { textoONumero } from "../nucleo/normalizar.js";
import { cambiarUltimaFila, letraColumna, separarRango } from "../xlsx/celdas.js";
import { HojaXML, PaqueteOOXML, cambiarNombresDefinidos, celda } from "../xlsx/plantilla.js";
import { TIPOS } from "../xlsx/rutas.js";
import { atributos, cambiarEtiqueta, ponerAtributo, quitarAtributo } from "../xlsx/xml.js";

export const HOJA_DIARIO = "DIARIO";
export const MARCA = "XXXXX";
const FILAS_VISIBLES_AL_ABRIR = 34;

const oCero = (valor) => (valor === null || valor === undefined || valor === "" ? 0 : valor);
const fechaExcel = (iso) => (iso ? new FechaCelda(serialExcel(iso)) : null);

/** Los 20 valores (A–T) de un renglón del DIARIO. */
export function valoresRenglon(vale, linea) {
  const encabezado = {
    fecha: vale.fecha,
    origen: vale.origen,
    depto_origen: vale.depto_origen,
    destino: vale.destino,
    depto_destino: vale.depto_destino,
    entrego: vale.entrego_nombre,
    recibio: vale.recibio_nombre,
    autorizo: vale.autorizo_nombre,
  };
  // Como la macro: con el almacenista a la derecha (NOV), "Entrego" es quien firma a la izquierda.
  if (vale.almacenista_derecha && !vale.migrado) [encabezado.entrego, encabezado.recibio] = [encabezado.recibio, encabezado.entrego];
  if (linea?.encabezado_original) {
    // Una corrección general aplica el encabezado vigente a todas las partidas,
    // conservando intactos los datos originales y los campos que no se corrigieron.
    const corregidos = new Set(vale.campos_encabezado_corregidos ?? []);
    for (const [campo, valor] of Object.entries(linea.encabezado_original)) {
      if (!corregidos.has(campo)) encabezado[campo] = valor;
    }
  }
  const esEntrada = vale.tipo === "ENTRADA";
  let cantidad, codigo, descripcion, oc, clave, um, lote, familia, transferencia;
  if (!linea) {
    // Vale cancelado: un renglón con cantidad 0 para que el folio no parezca perdido.
    cantidad = 0;
    codigo = 0;
    descripcion = `CANCELADO – ${vale.motivo_cancelacion || ""}`.replace(/[\s–]+$/, "");
    oc = clave = um = lote = familia = transferencia = null;
  } else {
    cantidad = dec(linea.cantidad);
    ({ codigo, descripcion, oc, clave, um, lote, familia } = linea);
    transferencia = linea.transferencia_consumo;
  }
  return [
    fechaExcel(encabezado.fecha),
    vale.folio,
    esEntrada ? MARCA : 0,
    esEntrada ? 0 : MARCA,
    oCero(encabezado.origen),
    oCero(encabezado.depto_origen),
    oCero(encabezado.destino),
    oCero(encabezado.depto_destino),
    oc ? textoONumero(oc) : "S/OC",
    oCero(cantidad),
    oCero(codigo),
    oCero(descripcion),
    oCero(textoONumero(clave)),
    oCero(um),
    oCero(textoONumero(lote)),
    oCero(encabezado.entrego),
    oCero(encabezado.recibio),
    oCero(encabezado.autorizo),
    familia ?? null,
    transferencia ?? null,
  ];
}

/** [[vale, línea | null]] en orden de folio; un vale cancelado ocupa un renglón. */
export function renglonesDiario(estado, tipo = "SALIDA") {
  const vales = estado.vales
    .filter((v) => v.tipo === tipo && (v.estado === "EMITIDO" || v.estado === "CANCELADO"))
    .sort((a, b) => a.folio - b.folio);
  const renglones = [];
  for (const vale of vales) {
    if (vale.estado === "CANCELADO") renglones.push([vale, null]);
    else for (const linea of vale.lineas) renglones.push([vale, linea]);
  }
  return renglones;
}

/**
 * @param plantilla  bytes del libro de vales del usuario
 * @returns {{ datos: Uint8Array, renglones, ultimoFolio, partesModificadas }}
 */
export function exportarVales(estado, plantilla) {
  const paquete = new PaqueteOOXML(plantilla);
  const parte = paquete.parteDeHoja(HOJA_DIARIO);
  const hoja = new HojaXML(paquete.texto(parte));
  const tablas = paquete.relaciones(parte).filter((r) => r.tipo === TIPOS.tabla).map((r) => {
    const xml = paquete.texto(r.destino), a = atributos(/<table\b[^>]*>/.exec(xml)[0]);
    return { parte: r.destino, xml, a, totales: Number(a.totalsRowCount || 0) };
  });
  const filasPlantilla = hoja.numerosFila.filter((n) => n > 1);
  const ultimaPlantilla = filasPlantilla.length ? Math.max(...filasPlantilla) : 1;
  const tablaConTotales = tablas.find((t) => t.totales > 0);
  const filaModelo = tablaConTotales ? separarRango(tablaConTotales.a.ref).fin.fila - tablaConTotales.totales : ultimaPlantilla;
  const estilosDefecto = hoja.estilos(filaModelo);
  const atributosDefecto = hoja.atributosFila(filaModelo);

  const nuevas = [];
  const renglones = renglonesDiario(estado);
  renglones.forEach(([vale, linea], i) => {
    const numero = i + 2;
    const origen = linea ? linea.fila_diario_origen : null;
    const existe = origen !== null && origen !== undefined && hoja.tieneFila(origen);
    const estilos = existe ? hoja.estilos(origen) : estilosDefecto;
    const atributos = atributosVisibles(existe ? hoja.atributosFila(origen) : atributosDefecto);
    const celdas = [];
    valoresRenglon(vale, linea).forEach((valor, indice) => {
      const columna = letraColumna(indice + 1);
      const estilo = estilos[columna] ?? estilosDefecto[columna] ?? null;
      if (valor === null && estilo === null) return;
      celdas.push(celda(`${columna}${numero}`, valor, estilo));
    });
    nuevas.push(HojaXML.nuevaFila(numero, celdas, atributos));
  });

  const ultima = Math.max(1, renglones.length + 1);
  const filasTotales = new Map();
  for (const tabla of tablas) {
    const fin = separarRango(tabla.a.ref).fin.fila;
    for (let i = 1; i <= tabla.totales; i++) {
      const destino = ultima + i, origen = fin - tabla.totales + i;
      if (hoja.tieneFila(origen) && !filasTotales.has(destino)) filasTotales.set(destino, hoja.moverFila(origen, destino));
    }
  }
  nuevas.push(...[...filasTotales].sort(([a], [b]) => a - b).map(([, fila]) => filaVisible(fila)));
  hoja.reemplazarFilas([1], nuevas);
  hoja.ajustarDimension(Math.max(ultima, ...filasTotales.keys()));
  hoja.cambiarPanel(`A${Math.max(2, ultima - FILAS_VISIBLES_AL_ABRIR)}`);
  paquete.escribir(parte, vistaCompleta(hoja.toString(), ultima));
  // Si DIARIO usa tablas de Excel, sus rangos y filtros viven en partes separadas de la hoja.
  for (const tabla of tablas) {
    const xml = cambiarEtiqueta(tabla.xml, "table", (e) => ponerAtributo(e, "ref", cambiarUltimaFila(atributos(e).ref, Math.max(2, ultima) + tabla.totales)));
    paquete.escribir(tabla.parte, vistaCompleta(xml, Math.max(2, ultima)));
  }
  ajustarNombreFiltro(paquete, HOJA_DIARIO, ultima);

  const folios = renglones.map(([v]) => v.folio).filter((f) => f !== null && f !== undefined);
  return {
    datos: paquete.generar(),
    renglones: renglones.length,
    ultimoFolio: folios.length ? Math.max(...folios) : null,
    partesModificadas: paquete.partesModificadas,
  };
}

/** Los atributos de una fila filtrada de la plantilla no deben ocultar vales al exportar. */
function atributosVisibles(antes) {
  const salida = { ...antes };
  delete salida.hidden;
  delete salida.collapsed;
  if (salida.ht !== undefined && Number(salida.ht) === 0) { delete salida.ht; delete salida.customHeight; }
  return salida;
}

function filaVisible(fila) {
  return cambiarEtiqueta(fila, "row", (e) => {
    e = quitarAtributo(quitarAtributo(e, "hidden"), "collapsed");
    return Number(atributos(e).ht) === 0 ? quitarAtributo(quitarAtributo(e, "ht"), "customHeight") : e;
  });
}

/** Libro completo al abrir: actualizar los filtros y quitar criterios guardados en la plantilla. */
function vistaCompleta(xml, ultima) {
  xml = cambiarEtiqueta(xml, "sheetPr", (e) => atributos(e).filterMode === undefined ? e : ponerAtributo(e, "filterMode", "0"));
  xml = cambiarEtiqueta(xml, "sheetFormatPr", (e) => atributos(e).zeroHeight === undefined ? e : ponerAtributo(e, "zeroHeight", "0"));
  return xml.replace(/<customSheetViews\b[^>]*>[\s\S]*?<\/customSheetViews>|<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)|<sortState\b[^>]*?(?:\/>|>[\s\S]*?<\/sortState>)/g, (filtro) => {
    if (filtro.startsWith("<customSheetViews")) return filtro;
    if (filtro.startsWith("<sortState")) return "";
    const apertura = /^<autoFilter\b[^>]*>/.exec(filtro)[0];
    const ref = atributos(apertura).ref;
    return (ref ? ponerAtributo(apertura, "ref", cambiarUltimaFila(ref, ultima)) : apertura).replace(/\/?\s*>$/, "/>");
  });
}

/** Actualiza _xlnm._FilterDatabase de la hoja (si existe) al nuevo último renglón. */
function ajustarNombreFiltro(paquete, nombreHoja, ultima) {
  const indice = paquete.hojas().findIndex(([nombre]) => nombre === nombreHoja);
  const libro = paquete.texto("xl/workbook.xml");
  const nuevo = cambiarNombresDefinidos(libro, (nombre, local, texto) =>
    nombre === "_xlnm._FilterDatabase" && local === String(indice) ? cambiarUltimaFila(texto, ultima) : null,
  );
  if (nuevo !== libro) paquete.escribir("xl/workbook.xml", nuevo);
}
