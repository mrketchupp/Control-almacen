// Piezas del inventario que comparten entradas, conteos y reacomodos: renglones nuevos al
// final de su hoja, variantes parecidas (para no duplicar) y contenedores sugeridos.

import { CERO } from "../nucleo/decimal.js";
import { ratio } from "../nucleo/difflib.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { claveEstricta, claveLaxa, unidad } from "../nucleo/normalizar.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** "#5 Inv." / "#1 Cons." */
export const lugarCorto = (u) => `#${u.contenedor} ${u.clase === "INV" ? "Inv." : "Cons."}`;
/** "Contenedor #5 · Inventariable" */
export const lugarLargo = (u) => `Contenedor #${u.contenedor} · ${u.clase === "INV" ? "Inventariable" : "Consumible"}`;

export function ubicacionesOrdenadas(estado) {
  return [...estado.ubicaciones].sort((a, b) => a.orden - b.orden);
}

/** Posición para un renglón nuevo: al final de su hoja (el orden de los demás no cambia). */
export function ordenSiguiente(estado, ubicacionId) {
  let maximo = 0;
  for (const e of estado.existencias) if (e.ubicacion_id === ubicacionId && e.orden > maximo) maximo = e.orden;
  return maximo + 1;
}

/** Renglón activo de esa variante en esa ubicación (el primero de la hoja), o null. */
export function renglonDe(estado, varianteId, ubicacionId) {
  let mejor = null;
  for (const e of estado.existencias) {
    if (e.activo === false || e.variante_id !== varianteId || e.ubicacion_id !== ubicacionId) continue;
    if (!mejor || e.orden < mejor.orden) mejor = e;
  }
  return mejor;
}

/**
 * Renglón nuevo del inventario (va al final de la hoja de su ubicación). Sin conteo: su
 * CANTIDAD es la inicial y todos sus movimientos cuentan como CONSUMO / INGRESO.
 */
export function crearRenglon(estado, indices, { varianteId, ubicacionId, cantidad = "0", conteoId = null, origen }) {
  return indices.agregarExistencia({
    variante_id: varianteId,
    ubicacion_id: ubicacionId,
    orden: ordenSiguiente(estado, ubicacionId),
    item: null,
    cantidad_conteo: cantidad,
    conteo_id: conteoId,
    nota: null,
    fila_origen: null,
    origen: origen ?? null,
  });
}

/**
 * Variantes del mismo código que se parecen a una dimensión/NP nuevas (RF-33): iguales al
 * normalizar o muy parecidas. Sirve para avisar antes de dar de alta un duplicado.
 */
export function variantesParecidas(estado, codigo, { dimension = "", np = "", um = "" } = {}, { indices = new Indices(estado) } = {}) {
  if (!Number.isInteger(codigo)) return [];
  const dim = claveEstricta(dimension);
  const num = claveEstricta(np);
  const laxa = claveLaxa(`${texto(dimension)}${texto(np)}`);
  const um2 = unidad(um);
  const salida = [];
  for (const v of estado.variantes) {
    if (v.codigo !== codigo || v.activo === false) continue;
    const igual = v.dimension_clave === dim && v.np_clave === num;
    const otra = claveLaxa(`${v.dimension ?? ""}${v.np ?? ""}`);
    const parecido = laxa && otra ? ratio(laxa, otra) : !laxa && !otra ? 1 : 0;
    const mismaDim = dim !== "" && (v.dimension_clave === dim || v.np_clave === dim);
    if (!igual && !mismaDim && parecido < 0.8) continue;
    const renglones = estado.existencias.filter((e) => e.variante_id === v.id && e.activo !== false);
    salida.push({
      variante: v,
      igual: igual && (!um2 || unidad(v.um) === um2),
      parecido,
      lugares: renglones.map((e) => lugarCorto(indices.ubicacion(e.ubicacion_id))),
    });
  }
  return salida.sort((a, b) => Number(b.igual) - Number(a.igual) || b.parecido - a.parecido);
}

/**
 * Ubicaciones para un renglón nuevo de un código, primero las más probables: donde ya está
 * ese código, luego las de la clase del artículo (inventariable / consumible) y luego el resto.
 */
export function ubicacionesSugeridas(estado, codigo, { indices = new Indices(estado) } = {}) {
  const donde = new Map();
  for (const e of estado.existencias) {
    if (e.activo === false || indices.variante(e.variante_id)?.codigo !== codigo) continue;
    donde.set(e.ubicacion_id, (donde.get(e.ubicacion_id) ?? 0) + 1);
  }
  const clases = new Set([...donde.keys()].map((id) => indices.ubicacion(id)?.clase));
  const claseArticulo = indices.articulo(codigo)?.clase ?? null;
  if (claseArticulo) clases.add(claseArticulo);
  const puntaje = (u) => (donde.has(u.id) ? 0 : clases.has(u.clase) ? 1 : 2);
  return ubicacionesOrdenadas(estado)
    .map((u) => ({ ubicacion: u, puntaje: puntaje(u), renglones: donde.get(u.id) ?? 0 }))
    .sort((a, b) => a.puntaje - b.puntaje || a.ubicacion.orden - b.ubicacion.orden);
}

/** Datos para mostrar un renglón del inventario (con su existencia actual). */
export function describirRenglon(estado, existenciaId, { indices = new Indices(estado), saldos = null } = {}) {
  const e = indices.existencia(existenciaId);
  if (!e) return null;
  const v = indices.variante(e.variante_id);
  const u = indices.ubicacion(e.ubicacion_id);
  const saldo = (saldos ?? calcularSaldos(estado, [e.id])).get(e.id);
  return {
    id: e.id,
    existencia: e,
    variante: v,
    ubicacion: u,
    codigo: v.codigo,
    descripcion: indices.articulo(v.codigo)?.descripcion ?? "",
    dimension: dimensionMostrada(e, v) || "",
    np: npMostrado(e, v) || "",
    um: umMostrada(e, v) || "",
    hoja: u.hoja_excel.trim(),
    lugar: lugarCorto(u),
    total: saldo ? saldo.total : CERO,
  };
}
