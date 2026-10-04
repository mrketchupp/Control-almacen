// Piezas del inventario que comparten entradas, conteos y reacomodos: renglones nuevos al
// final de su hoja, variantes parecidas (para no duplicar) y contenedores sugeridos.

import { CERO } from "../nucleo/decimal.js";
import { ratio } from "../nucleo/difflib.js";
import { Indices, auditar, claveVariante, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
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

// ---------------------------------------------------------------- corregir dimensión y NP

export class ErrorCorreccion extends Error {}

const nulo = (v) => texto(v) || null;
const escritura = (dimension, np) => [texto(dimension), texto(np)].filter(Boolean).join(" · ");

/**
 * Qué pasaría al corregir la dimensión y el NP (para mostrarlo antes de confirmar).
 * alcance: 'renglon' (solo ese renglón del inventario) o 'variante' (todos sus renglones).
 * @returns {{ variante, renglones, otra, cambia, todos }}  otra: la variante que ya tiene esa
 *   dimensión y NP (se juntarán con ella); todos: el cambio toca todos los renglones de la variante.
 */
export function previaCorreccion(estado, { existenciaId = null, varianteId = null }, { dimension, np }, { indices = new Indices(estado) } = {}) {
  const existencia = existenciaId !== null ? indices.existencia(existenciaId) : null;
  const variante = indices.variante(existencia ? existencia.variante_id : varianteId);
  if (!variante) throw new ErrorCorreccion("Esa partida ya no existe.");
  const deLaVariante = estado.existencias.filter((e) => e.variante_id === variante.id);
  const renglones = existencia ? [existencia] : deLaVariante;
  const todos = renglones.length === deLaVariante.length;
  const destino = claveVariante(variante.codigo, claveEstricta(dimension), claveEstricta(np), variante.um);
  const encontrada = indices.porClave.get(destino) ?? null;
  const otra = encontrada && encontrada.id !== variante.id ? encontrada : null;
  const cambia = renglones.some((e) => texto(dimensionMostrada(e, variante)) !== texto(dimension) || texto(npMostrado(e, variante)) !== texto(np));
  return { variante, renglones, otra, cambia, todos };
}

/**
 * Corrige la dimensión y el NP de un renglón (existenciaId) o de una variante con todos sus
 * renglones (varianteId; p. ej. a como lo escribe AX). Si ya hay otra variante del mismo código
 * con esa dimensión y NP, los renglones pasan a ella. Los vales NO se reescriben: sus partidas
 * apuntan al renglón; la escritura anterior se guarda en `claves_anteriores` para seguir
 * reconociendo los vales que la usaban.
 * @returns {{ variante, antes, despues, unida, renglones }}
 */
export function corregirDimensionNp(estado, cual, { dimension, np }, { usuario = null, motivo = "" } = {}) {
  const indices = new Indices(estado);
  const { variante, renglones, otra, cambia, todos } = previaCorreccion(estado, cual, { dimension, np }, { indices });
  if (!cambia) throw new ErrorCorreccion("La dimensión y el NP ya están así.");
  const antes = escritura(dimensionMostrada(renglones[0], variante), npMostrado(renglones[0], variante));
  const anteriores = new Set([...(variante.claves_anteriores ?? []), ...renglones.map((e) => escritura(dimensionMostrada(e, variante), npMostrado(e, variante)))]);
  anteriores.delete("");
  let destino;
  if (otra) destino = otra;
  else if (todos) {
    // La variante cambia de nombre (conserva su id: lo que apuntaba a ella sigue igual).
    indices.porClave.delete(claveVariante(variante.codigo, variante.dimension_clave, variante.np_clave, variante.um));
    variante.dimension = nulo(dimension);
    variante.np = nulo(np);
    variante.dimension_clave = claveEstricta(dimension);
    variante.np_clave = claveEstricta(np);
    indices.porClave.set(claveVariante(variante.codigo, variante.dimension_clave, variante.np_clave, variante.um), variante);
    destino = variante;
  } else destino = indices.obtenerOCrearVariante(variante.codigo, nulo(dimension), nulo(np), variante.um);
  for (const e of renglones) {
    e.variante_id = destino.id;
    delete e.dimension_hoja;
    delete e.np_hoja;
  }
  const propias = escritura(destino.dimension, destino.np);
  destino.claves_anteriores = [...new Set([...(destino.claves_anteriores ?? []), ...anteriores])].filter((c) => c !== propias);
  if (destino !== variante && todos) {
    // Se juntó con otra: la anterior queda sin renglones y lo que apuntaba a ella pasa a la otra.
    variante.activo = false;
    variante.unida_a = destino.id;
    for (const eq of Object.values(estado.equivalencias_ax ?? {})) if (eq.variante_id === variante.id) eq.variante_id = destino.id;
  }
  const despues = escritura(destino.dimension, destino.np);
  auditar(estado, {
    usuario,
    entidad: cual.existenciaId !== null && cual.existenciaId !== undefined ? "existencia" : "variante",
    entidadId: cual.existenciaId ?? variante.id,
    accion: "CORREGIR_CLAVE",
    antes: { variante_id: variante.id, clave: antes },
    despues: { variante_id: destino.id, clave: despues, renglones: renglones.map((e) => e.id), unida: Boolean(otra), motivo: texto(motivo) || null },
  });
  return { variante: destino, antes, despues, unida: Boolean(otra), renglones: renglones.length };
}

/**
 * Sugerencias para la dimensión y el NP de un código: cómo lo escribe AX (Tamaño y Color del
 * último corte) y las otras variantes del inventario.
 * @returns {{ dimensiones: [{ valor, detalle }], nps: [{ valor, detalle }] }}
 */
export function sugerenciasClave(estado, codigo) {
  const dimensiones = new Map();
  const nps = new Map();
  const poner = (mapa, valor, detalle) => {
    const v = texto(valor);
    if (v && !mapa.has(claveEstricta(v) || v)) mapa.set(claveEstricta(v) || v, { valor: v, detalle });
  };
  const cortes = [...(estado.cortes_ax ?? [])].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  for (const corte of cortes) {
    for (const l of corte.lineas) {
      if (l.codigo !== codigo) continue;
      const cortado = texto(l.tamano).length === 10 ? " · AX guarda solo 10 caracteres" : "";
      poner(dimensiones, l.tamano, `Tamaño en AX (${corte.fecha})${cortado}`);
      poner(nps, l.color, `Color en AX (${corte.fecha})`);
    }
  }
  for (const v of estado.variantes) {
    if (v.codigo !== codigo || v.activo === false) continue;
    poner(dimensiones, v.dimension, "En el inventario");
    poner(nps, v.np, "En el inventario");
  }
  return { dimensiones: [...dimensiones.values()], nps: [...nps.values()] };
}
