// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §8): lo que la vista de corrección marca y cuenta, sin navegador.
// Qué filas del resumen cambiaron, qué partidas cambiaron (con su cantidad anterior) y el efecto de la corrección en el
// inventario («Regresa 1 PZA a #1 Cons. (queda 20)»). Las frases de la bitácora siguen saliendo de `resumenCambios` /
// `resumenCambiosEntrada`; esto solo las acompaña.

import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { Indices } from "../nucleo/estado.js";
import { claveEstricta } from "../nucleo/normalizar.js";
import { lineasEntradaCapturadas } from "./entradas.js";
import { lugarCorto } from "./inventario.js";
import { disponibles, lineasCapturadas } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const igual = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase();
const hay = (v) => v !== null && v !== undefined;

// Fila del resumen de *Para quién* (salida) que marca cada campo.
const FILA_SALIDA = {
  plantilla_area_id: "area",
  destino: "area",
  depto_destino: "area",
  recibio_nombre: "recibe",
  recibio_puesto: "puesto",
  autorizo_nombre: "autoriza",
  autorizo_puesto: "autoriza",
  etapa_perforacion: "etapa",
  fecha: "fecha",
  entrego_nombre: "entrega",
  entrego_puesto: "entrega",
};

// Dato del resumen de *De dónde viene* (entrada) que marca cada campo.
const DATO_ENTRADA = { origen: "origen", folio_externo: "origen", fecha: "fecha", fecha_recibido: "fecha_recibido", entrego_nombre: "entrego_nombre", entrego_puesto: "entrego_nombre" };

/** Las filas del resumen de *Para quién* (o datos de *De dónde viene*) que cambiaron respecto a como estaba el vale. */
export function encabezadoCambiado(antes, ahora, tipo = "SALIDA") {
  const mapa = tipo === "ENTRADA" ? DATO_ENTRADA : FILA_SALIDA;
  const cambiados = new Set();
  for (const [campo, fila] of Object.entries(mapa)) if (!igual(antes[campo], ahora[campo])) cambiados.add(fila);
  return cambiados;
}

const conUm = (l) => `${decTexto(dec(l.cantidad)) ?? texto(l.cantidad)} ${texto(l.um).toUpperCase()}`.trim();
// Lo que identifica a qué partida del inventario va (o qué material es) una partida.
const destino = (l) => `${l.codigo}|${hay(l.existencia_id) ? l.existencia_id : `${hay(l.ubicacion_id) ? l.ubicacion_id : ""}|${claveEstricta(l.dimension)}|${claveEstricta(l.np)}`}|${l.no_inventariado ? 1 : 0}`;

/**
 * Las partidas que cambiaron: uid → { antes } (texto de la cantidad anterior si cambió la cantidad) o { nueva: true }.
 * Lo que cambió sin tocar la cantidad (clave, lote, O.C., contenedor…) llega con `antes: null`.
 */
export function partidasCambiadas(lineasAntes, lineasAhora) {
  const previas = new Map(lineasAntes.map((l) => [l.uid, l]));
  const cambios = new Map();
  for (const l of lineasAhora) {
    const p = previas.get(l.uid);
    if (!p) {
      cambios.set(l.uid, { nueva: true });
      continue;
    }
    const cantidad = !(dec(p.cantidad)?.eq(dec(l.cantidad) ?? CERO) ?? texto(p.cantidad) === texto(l.cantidad));
    const otro = destino(p) !== destino(l) || ["lote", "oc", "descripcion", "um", "clave"].some((c) => !igual(p[c], l[c]));
    if (cantidad) cambios.set(l.uid, { antes: conUm(p) });
    else if (otro) cambios.set(l.uid, { antes: null });
  }
  return cambios;
}

/**
 * El efecto de la corrección en el inventario, por partida del inventario (§8): «Regresa 1 PZA a #1 Cons. (queda 20)»
 * o «Sale 2 PZA más de #1 Inv. (queda 3)» en salidas; «Suma» / «Resta» en entradas; «Partida nueva en #2 Inv.: 2 PZA»
 * si una entrada ahora crea una. Un vale anterior al conteo (`historial`) no mueve existencias: nada.
 */
export function efectosEnInventario(estado, vale, datos, { indices = new Indices(estado), historial = false } = {}) {
  if (historial) return [];
  const entrada = vale.tipo === "ENTRADA";
  const nuevas = entrada ? lineasEntradaCapturadas(datos.lineas) : lineasCapturadas(datos.lineas);
  const suma = (lineas) => {
    const total = new Map();
    for (const l of lineas) {
      if (!hay(l.existencia_id) || l.no_inventariado) continue;
      const actual = total.get(l.existencia_id) ?? { cantidad: CERO, um: texto(l.um) };
      actual.cantidad = actual.cantidad.plus(dec(l.cantidad) ?? CERO);
      total.set(l.existencia_id, actual);
    }
    return total;
  };
  const antes = suma(vale.lineas);
  const ahora = suma(nuevas);
  const ids = [...new Set([...antes.keys(), ...ahora.keys()])];
  const base = ids.length ? disponibles(estado, ids, vale.id) : new Map();
  const efectos = [];
  for (const id of ids) {
    const a = antes.get(id)?.cantidad ?? CERO;
    const b = ahora.get(id)?.cantidad ?? CERO;
    if (a.eq(b)) continue;
    const existencia = indices.existencia(id);
    const ubicacion = existencia ? indices.ubicacion(existencia.ubicacion_id) : null;
    const lugar = ubicacion ? lugarCorto(ubicacion) : "su partida";
    const um = ahora.get(id)?.um || antes.get(id)?.um || "";
    // Cambio en la existencia: una entrada suma lo que trae; una salida, lo contrario.
    const cambio = entrada ? b.minus(a) : a.minus(b);
    const queda = (base.get(id) ?? CERO)[entrada ? "plus" : "minus"](b);
    const cuanto = `${decTexto(cambio.abs())} ${um}`.trim();
    const verbo = entrada ? (cambio.gt(0) ? `Suma ${cuanto} a` : `Resta ${cuanto} a`) : cambio.gt(0) ? `Regresa ${cuanto} a` : `Sale ${cuanto} más de`;
    efectos.push(`${verbo} ${lugar} (queda ${decTexto(queda)})`);
  }
  if (entrada) {
    for (const l of nuevas) {
      if (hay(l.existencia_id) || !hay(l.ubicacion_id) || l.no_inventariado) continue;
      const ubicacion = indices.ubicacion(l.ubicacion_id);
      if (ubicacion) efectos.push(`Partida nueva en ${lugarCorto(ubicacion)}: ${conUm(l)}`);
    }
  }
  return efectos;
}
