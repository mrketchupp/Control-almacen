// Consultas y acciones pequeñas que usa la interfaz (sin lógica de pantalla).

import { clavesDeBusqueda, clavesPropias, hayInterseccion } from "../nucleo/catalogo.js";
import { aNumero } from "../nucleo/decimal.js";
import { ratio } from "../nucleo/difflib.js";
import { Indices, auditar, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos, corteDe, cortesVigentes } from "../nucleo/existencias.js";
import { fmtFecha, hoyIso } from "../nucleo/fechas.js";
import { claveLaxa } from "../nucleo/normalizar.js";

export function resumen(estado) {
  const salidas = estado.vales.filter((v) => v.tipo === "SALIDA");
  const entradas = estado.vales.filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO");
  const ultimaEntrada = entradas.reduce((a, v) => (!a || v.folio > a.folio ? v : a), null);
  const cortes = cortesVigentes(estado);
  const conFolio = salidas.filter((v) => v.folio !== null && v.folio !== undefined);
  const ultimo = conFolio.reduce((a, v) => (!a || v.folio > a.folio ? v : a), null);
  // El último conteo físico (los reacomodos también fijan la cantidad de sus renglones, pero no son conteos).
  const conteo = [...estado.conteos].reverse().find((c) => c.tipo !== "REACOMODO") ?? null;
  const exportaciones = {};
  for (const e of estado.exportaciones) exportaciones[e.tipo] = e.fecha_hora;
  return {
    vacia: !estado.existencias.length && !salidas.length,
    existencias: estado.existencias.length,
    ubicaciones: estado.ubicaciones.length,
    articulos: Object.keys(estado.articulos).length,
    vales: salidas.length,
    ultimo_folio: ultimo ? ultimo.folio : null,
    fecha_ultimo_vale: ultimo ? ultimo.fecha : null,
    por_ubicar: lineasPorUbicar(estado).length,
    por_confirmar: Object.values(estado.articulos).filter((a) => a.por_confirmar).length,
    conteo_fecha: conteo ? conteo.fecha : null,
    conteo_alcance: conteo ? (conteo.alcance ?? "TOTAL") : null,
    conteo_folio: cortes.salida,
    conteos: estado.conteos.length,
    conteo_en_curso: Boolean(estado.conteo_en_curso),
    entradas: entradas.length,
    ultima_entrada: ultimaEntrada ? ultimaEntrada.folio : null,
    fecha_ultima_entrada: ultimaEntrada ? ultimaEntrada.fecha : null,
    borradores_entrada: estado.borradores_entrada?.length ?? 0,
    ultima_exportacion: exportaciones,
    vales_hoy: salidas.filter((v) => !v.migrado && v.fecha === hoyIso() && v.estado === "EMITIDO").length,
    borradores: estado.borradores?.length ?? 0,
    agotados: renglonesAgotados(estado),
  };
}

/** Renglones del inventario con existencia 0 o negativa. */
export function renglonesAgotados(estado) {
  let total = 0;
  for (const saldo of calcularSaldos(estado).values()) if (saldo.total.lte(0)) total += 1;
  return total;
}

// ---------------------------------------------------------------- inventario

export function filasInventario(estado) {
  const saldos = calcularSaldos(estado);
  const indices = new Indices(estado);
  const filas = [];
  const existencias = [...estado.existencias].sort((a, b) => {
    const ua = indices.ubicacion(a.ubicacion_id);
    const ub = indices.ubicacion(b.ubicacion_id);
    return ua.orden - ub.orden || a.orden - b.orden;
  });
  for (const e of existencias) {
    const saldo = saldos.get(e.id);
    const ubicacion = indices.ubicacion(e.ubicacion_id);
    const variante = indices.variante(e.variante_id);
    filas.push({
      id: e.id,
      contenedor: ubicacion.contenedor,
      clase: ubicacion.clase === "INV" ? "Inventariable" : "Consumible",
      hoja: ubicacion.hoja_excel.trim(),
      codigo: variante.codigo,
      descripcion: indices.articulo(variante.codigo)?.descripcion ?? "",
      dimension: dimensionMostrada(e, variante) || "",
      np: npMostrado(e, variante) || "",
      um: umMostrada(e, variante) || "",
      cantidad: aNumero(saldo.cantidad),
      consumo: aNumero(saldo.consumo) || null,
      ingreso: aNumero(saldo.ingreso) || null,
      total: aNumero(saldo.total),
      nota: e.nota || "",
      origen: e.origen || "",
      ubicacion_id: ubicacion.id,
    });
  }
  return filas;
}

// ------------------------------------------------------------------ historial

export function filasHistorial(estado, tipo = "SALIDA") {
  const vales = estado.vales.filter((v) => v.tipo === tipo).sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  const filas = [];
  for (const vale of vales) {
    for (const linea of vale.lineas) {
      filas.push({
        id: linea.id,
        vale_id: vale.id,
        folio: vale.folio,
        fecha: fmtFecha(vale.fecha),
        fecha_iso: vale.fecha || "",
        estado: vale.estado,
        destino: vale.destino || "",
        depto: vale.depto_destino || "",
        recibio: vale.recibio_nombre || "",
        cantidad: aNumero(linea.cantidad),
        um: linea.um || "",
        codigo: linea.codigo,
        descripcion: linea.descripcion || "",
        clave: linea.clave || "",
        oc: linea.oc || "S/OC",
        notas: linea.notas || "",
      });
    }
  }
  return filas;
}

// --------------------------------------------------------- renglones por ubicar

/** Folio de salida más antiguo que todavía descuenta en algún renglón (ver cortesVigentes). */
export function folioCorteActual(estado) {
  return cortesVigentes(estado).salida;
}

/** Renglones de vales posteriores al conteo que aún no se ligan a un renglón del inventario. */
export function lineasPorUbicar(estado) {
  const cortes = cortesVigentes(estado);
  const indices = new Indices(estado);
  const saldos = calcularSaldos(estado);
  const salida = [];
  const vales = [...estado.vales].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.folio - b.folio);
  for (const vale of vales) {
    if (vale.estado !== "EMITIDO" || !(vale.folio > corteDe(cortes, vale.tipo))) continue;
    for (const linea of [...vale.lineas].sort((a, b) => a.renglon - b.renglon)) {
      if (linea.existencia_id !== null || linea.no_inventariado || linea.codigo === null) continue;
      salida.push({
        id: linea.id,
        tipo: vale.tipo,
        folio: vale.folio,
        renglon: linea.renglon,
        codigo: linea.codigo,
        descripcion: linea.descripcion || "",
        clave: linea.clave || "",
        cantidad: aNumero(linea.cantidad),
        um: linea.um || "",
        candidatos: candidatosPara(estado, linea.codigo, linea.clave, { indices, saldos }),
      });
    }
  }
  return salida;
}

/** Renglones del inventario con el mismo código; primero los que coinciden con la clave. */
export function candidatosPara(estado, codigo, clave, { indices = new Indices(estado), saldos = null } = {}) {
  if (codigo === null || codigo === undefined) return [];
  const existencias = estado.existencias.filter((e) => indices.variante(e.variante_id).codigo === codigo);
  const claves = clavesDeBusqueda(clave);
  const totales = saldos || calcularSaldos(estado, existencias.map((e) => e.id));
  const laxa = claveLaxa(clave);
  const datos = existencias.map((e) => {
    const variante = indices.variante(e.variante_id);
    const ubicacion = indices.ubicacion(e.ubicacion_id);
    const propias = clavesPropias(variante);
    const dimension = dimensionMostrada(e, variante);
    const np = npMostrado(e, variante);
    const texto = claveLaxa(`${dimension || ""}${np || ""}`);
    return {
      e,
      ubicacion,
      dimension,
      np,
      coincide: hayInterseccion(claves, propias),
      parecido: laxa && texto ? ratio(laxa, texto) : 0,
      total: aNumero(totales.get(e.id).total),
      um: umMostrada(e, variante) || "",
    };
  });
  datos.sort(
    (a, b) =>
      Number(!a.coincide) - Number(!b.coincide) ||
      b.parecido - a.parecido ||
      a.ubicacion.orden - b.ubicacion.orden ||
      a.e.orden - b.e.orden,
  );
  return datos.map((d) => ({
    id: d.e.id,
    etiqueta:
      `${d.ubicacion.hoja_excel.trim()} · ${d.dimension || "S/D"}` +
      (d.np ? ` · NP ${d.np}` : "") +
      ` · existencia ${d.total} ${d.um}`.trimEnd(),
    coincide: d.coincide,
  }));
}

/** Liga un renglón de vale a un renglón del inventario (o lo marca como no inventariado). */
export function ubicarLinea(estado, lineaId, existenciaId, usuario) {
  let linea = null;
  for (const vale of estado.vales) {
    linea = vale.lineas.find((l) => l.id === lineaId);
    if (linea) break;
  }
  if (!linea) throw new Error(`No existe la partida ${lineaId}`);
  const antes = { existencia_id: linea.existencia_id, no_inventariado: linea.no_inventariado };
  if (existenciaId === null) {
    linea.no_inventariado = true;
    linea.existencia_id = null;
    linea.variante_id = null;
  } else {
    const existencia = estado.existencias.find((e) => e.id === existenciaId);
    if (!existencia) throw new Error(`No existe la partida de inventario ${existenciaId}`);
    linea.existencia_id = existencia.id;
    linea.variante_id = existencia.variante_id;
    linea.no_inventariado = false;
  }
  auditar(estado, {
    usuario,
    entidad: "vale_linea",
    entidadId: lineaId,
    accion: "UBICAR",
    antes,
    despues: { existencia_id: linea.existencia_id, no_inventariado: linea.no_inventariado },
  });
}

// ----------------------------------------------------------------- usuarios

export function almacenistas(estado) {
  return estado.personas
    .filter((p) => p.es_almacenista && p.activo !== false)
    .map((p) => p.nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
}

export function usuarioEnTurno(estado) {
  return estado?.config?.usuario_en_turno ?? null;
}

export function fijarUsuarioEnTurno(estado, nombre) {
  estado.config.usuario_en_turno = nombre;
}

/** Agrega (o reactiva) a una persona como almacenista. */
export function agregarAlmacenista(estado, nombre) {
  const indices = new Indices(estado);
  const persona = indices.persona(nombre);
  persona.es_almacenista = true;
  persona.activo = true;
  return persona;
}

// ----------------------------------------------------------------- recibe

const sinAcentos = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

/**
 * Personas para una firma del vale (recibe, autoriza, …) con su puesto y cuántas veces han
 * firmado así, por departamento. El uso solo ordena las sugerencias: lo que se muestra es el
 * puesto de cada persona.
 * @param campo  campo del vale con el nombre: recibio_nombre, autorizo_nombre, firma_extra_…
 */
export function personasParaFirma(estado, campo = "recibio_nombre") {
  const usos = new Map();
  const nombrePorId = new Map(estado.personas.map((p) => [p.id, p.nombre]));
  const canonico = new Map(Object.entries(estado.alias ?? {}).filter(([, id]) => nombrePorId.has(id)).map(([alias, id]) => [alias, nombrePorId.get(id)]));
  const otrosNombres = new Map();
  for (const [alias, nombre] of canonico) otrosNombres.set(nombre, [...(otrosNombres.get(nombre) ?? []), alias]);
  for (const v of estado.vales) {
    const escrito = v.tipo === "SALIDA" ? v[campo] : null;
    const nombre = canonico.get(escrito) ?? escrito;
    if (!nombre) continue;
    const cuenta = usos.get(nombre) ?? new Map();
    const depto = v.depto_destino || "";
    cuenta.set(depto, (cuenta.get(depto) ?? 0) + 1);
    usos.set(nombre, cuenta);
  }
  return estado.personas
    .filter((p) => p.activo !== false)
    .map((p) => {
      const porDepto = usos.get(p.nombre) ?? new Map();
      const veces = [...porDepto.values()].reduce((s, n) => s + n, 0);
      return {
        id: p.id,
        nombre: p.nombre,
        puesto: p.puesto ?? null,
        veces,
        porDepto,
        almacenista: Boolean(p.es_almacenista),
        texto: sinAcentos(`${p.nombre} ${p.puesto ?? ""} ${[...porDepto.keys()].join(" ")} ${(otrosNombres.get(p.nombre) ?? []).join(" ")}`),
      };
    })
    .sort((a, b) => Number(a.almacenista) - Number(b.almacenista) || b.veces - a.veces || a.nombre.localeCompare(b.nombre, "es"));
}

/** Personas que pueden recibir un vale (compatibilidad). */
export const personasParaRecibir = (estado) => personasParaFirma(estado, "recibio_nombre");

/**
 * Filtra por palabras (nombre, puesto o departamentos en que ha firmado) y ordena: primero los
 * puestos preferidos (p. ej. RIG MANAGER e ITP para autorizar), luego quien más ha firmado
 * para ese departamento y después quien más ha firmado en general.
 */
export function buscarPersonas(personas, consulta, { depto = null, puestos = [], limite = 30 } = {}) {
  const palabras = sinAcentos(consulta).split(/\s+/).filter(Boolean);
  const deptoLimpio = sinAcentos(depto).trim();
  const preferidos = puestos.map((x) => sinAcentos(x));
  const puntaje = (p) => {
    const puesto = sinAcentos(p.puesto);
    const preferido = preferidos.some((x) => puesto === x || puesto.split(/[^A-Z0-9]+/).includes(x) || puesto.includes(x));
    let enDepto = 0;
    if (deptoLimpio) for (const [d, n] of p.porDepto ?? []) if (sinAcentos(d).trim() === deptoLimpio) enDepto += n;
    return (preferido ? 1e6 : 0) + enDepto * 1000 + p.veces;
  };
  return personas
    .filter((p) => palabras.every((w) => p.texto.includes(w)))
    .map((p) => ({ p, n: puntaje(p) }))
    .sort((a, b) => b.n - a.n)
    .map(({ p }) => p)
    .slice(0, limite);
}

// ----------------------------------------------------------------- historial

/**
 * Filtros combinados del historial (todos deben cumplirse):
 * { texto, codigo, depto, recibio, estado, desde, hasta }
 */
export function filtrarHistorial(filas, filtros = {}) {
  const palabras = sinAcentos(filtros.texto).split(/\s+/).filter(Boolean);
  const codigo = String(filtros.codigo ?? "").trim().replace(/^0+/, "");
  const recibio = sinAcentos(filtros.recibio).trim();
  return filas.filter((f) => {
    if (codigo && String(f.codigo ?? "") !== codigo) return false;
    if (filtros.depto && f.depto !== filtros.depto) return false;
    if (recibio && !sinAcentos(f.recibio).includes(recibio)) return false;
    if (filtros.estado && f.estado !== filtros.estado) return false;
    if (filtros.desde && f.fecha_iso < filtros.desde) return false;
    if (filtros.hasta && f.fecha_iso > filtros.hasta) return false;
    if (palabras.length) {
      const todo = sinAcentos([f.folio, f.descripcion, f.codigo, f.clave, f.destino, f.depto, f.recibio, f.oc, f.notas].join(" "));
      if (!palabras.every((w) => todo.includes(w))) return false;
    }
    return true;
  });
}
