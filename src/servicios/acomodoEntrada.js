// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §5.1 y §6): en qué contenedor queda cada partida de una entrada.
// El tipo de la partida (Consumible | Inventariable, paso 2) y el contenedor (paso 3) deciden la hoja:
// ubicación = (contenedor, clase). Los contenedores salen del inventario abierto (`ubicacion.contenedor`, en el orden de
// sus hojas): pueden ser más o menos de 5, y un contenedor puede tener solo una de las dos hojas.
//
// Una partida acomodada lleva su destino como siempre (`existencia_id` = una partida del inventario, o `ubicacion_id` =
// partida nueva al final de esa hoja), así que `validarEntrada` y `confirmarEntrada` no cambian; sin acomodar no lleva
// ninguno (y `validarEntrada` lo marca). Sin navegador.

import { Indices } from "../nucleo/estado.js";
import { duenoDe } from "../nucleo/inventarios.js";
import { renglonDe, ubicacionesOrdenadas } from "./inventario.js";

const hay = (v) => v !== null && v !== undefined;

export class ErrorAcomodo extends Error {}

export const NOMBRE_CLASE = { INV: "inventariables", CONS: "consumibles" };

/** Los contenedores del inventario, en el orden de sus hojas: [{ numero, hojas: { INV, CONS } }] (una hoja puede faltar). */
export function contenedoresDe(estado) {
  const porNumero = new Map();
  for (const u of ubicacionesOrdenadas(estado)) {
    let c = porNumero.get(u.contenedor);
    if (!c) {
      c = { numero: u.contenedor, hojas: { INV: null, CONS: null } };
      porNumero.set(u.contenedor, c);
    }
    if (!c.hojas[u.clase]) c.hojas[u.clase] = u;
  }
  return [...porNumero.values()];
}

/** La variante ya elegida de la partida (la de su partida del inventario o la elegida sin contenedor); null si es nueva. */
export function varianteDeLinea(linea, indices) {
  if (hay(linea.existencia_id)) return indices.variante(indices.existencia(linea.existencia_id)?.variante_id) ?? null;
  if (hay(linea.variante_id)) return indices.variante(linea.variante_id) ?? null;
  return null;
}

/** Las partidas del inventario (no las de FX) de una variante, en hojas de esa clase: [{ existencia, ubicacion }]. */
export function dondeHay(estado, varianteId, clase, indices) {
  const salida = [];
  for (const e of estado.existencias) {
    if (e.activo === false || e.variante_id !== varianteId || duenoDe(e)) continue;
    const ubicacion = indices.ubicacion(e.ubicacion_id);
    if (ubicacion && (!clase || ubicacion.clase === clase)) salida.push({ existencia: e, ubicacion });
  }
  return salida.sort((a, b) => a.ubicacion.orden - b.ubicacion.orden || a.existencia.orden - b.existencia.orden);
}

/** El tipo guardado de la partida o, si no lo tiene (borradores de antes), el de la hoja a la que ya entra. */
export function claseDeLinea(linea, indices) {
  if (linea.clase === "INV" || linea.clase === "CONS") return linea.clase;
  if (hay(linea.existencia_id)) return indices.ubicacion(indices.existencia(linea.existencia_id)?.ubicacion_id)?.clase ?? null;
  if (hay(linea.ubicacion_id)) return indices.ubicacion(linea.ubicacion_id)?.clase ?? null;
  return null;
}

/**
 * Cómo está una partida para el acomodo:
 *   { estado: "sin_existencia" }                  no lleva existencia (diésel, gases): no se acomoda ni suma
 *   { estado: "falta", falta: "codigo" | "clave" } le falta el código o elegir su clave (se completa en el paso 2)
 *   { estado: "pendiente", donde }                falta el contenedor; `donde` = números de los contenedores con su existencia
 *   { estado: "acomodada", contenedor, ubicacion, existencia, ya, fx }
 *       `existencia` = la partida del inventario a la que suma (null = partida nueva al final de la hoja);
 *       `ya` = esa partida ya existía (★ «ya tiene existencia aquí»); `fx` = es de FX (se eligió a mano).
 */
export function acomodoDe(estado, linea, { indices = new Indices(estado) } = {}) {
  if (linea.no_inventariado) return { estado: "sin_existencia" };
  if (!Number.isInteger(linea.codigo)) return { estado: "falta", falta: "codigo" };
  if (hay(linea.existencia_id)) {
    const existencia = indices.existencia(linea.existencia_id);
    const ubicacion = existencia ? indices.ubicacion(existencia.ubicacion_id) : null;
    if (existencia && existencia.activo !== false && ubicacion) {
      return { estado: "acomodada", contenedor: ubicacion.contenedor, ubicacion, existencia, ya: true, fx: Boolean(duenoDe(existencia)) };
    }
  }
  const variante = varianteDeLinea(linea, indices);
  if (!variante && !linea.alta) return { estado: "falta", falta: "clave" };
  if (hay(linea.ubicacion_id) && !hay(linea.existencia_id)) {
    const ubicacion = indices.ubicacion(linea.ubicacion_id);
    if (ubicacion) {
      const existencia = variante ? renglonDe(estado, variante.id, ubicacion.id) : null;
      return { estado: "acomodada", contenedor: ubicacion.contenedor, ubicacion, existencia, ya: Boolean(existencia), fx: false };
    }
  }
  const clase = claseDeLinea(linea, indices);
  const donde = variante ? [...new Set(dondeHay(estado, variante.id, clase, indices).map((d) => d.ubicacion.contenedor))] : [];
  return { estado: "pendiente", donde };
}

export const estaAcomodada = (estado, linea, opciones) => acomodoDe(estado, linea, opciones).estado === "acomodada";

/** La partida sin contenedor (conserva su variante, o los datos de la variante nueva). */
export function desacomodar(linea, indices) {
  const variante = varianteDeLinea(linea, indices);
  return { ...linea, existencia_id: null, ubicacion_id: null, variante_id: variante ? variante.id : null };
}

/**
 * La partida en el contenedor `numero`, en la hoja de su tipo: suma a la partida de su variante si ya la hay ahí; si no,
 * es una partida nueva al final de esa hoja. Sin hoja de ese tipo: ErrorAcomodo («El #3 no tiene hoja de consumibles»).
 */
export function acomodar(estado, linea, numero, { indices = new Indices(estado) } = {}) {
  const clase = claseDeLinea(linea, indices) ?? "CONS";
  const hoja = contenedoresDe(estado).find((c) => c.numero === numero)?.hojas[clase] ?? null;
  if (!hoja) throw new ErrorAcomodo(`El #${numero} no tiene hoja de ${NOMBRE_CLASE[clase]}.`);
  const variante = varianteDeLinea(linea, indices);
  const limpia = { ...linea, clase, existencia_id: null, ubicacion_id: null, no_inventariado: false };
  if (variante) {
    const renglon = renglonDe(estado, variante.id, hoja.id);
    return renglon ? { ...limpia, variante_id: variante.id, existencia_id: renglon.id } : { ...limpia, variante_id: variante.id, ubicacion_id: hoja.id };
  }
  return { ...limpia, variante_id: null, ubicacion_id: hoja.id };
}

/**
 * Acomodo solo (§6, ★): si la variante tiene existencia en un solo contenedor de su tipo, la partida queda ahí; si no
 * (en varios, en ninguno o variante nueva), queda como estaba. Lo de FX nunca se elige solo.
 */
export function acomodoAutomatico(estado, linea, { indices = new Indices(estado) } = {}) {
  if (linea.no_inventariado || !Number.isInteger(linea.codigo)) return linea;
  const variante = varianteDeLinea(linea, indices);
  if (!variante) return linea;
  const contenedores = new Set(dondeHay(estado, variante.id, claseDeLinea(linea, indices), indices).map((d) => d.ubicacion.contenedor));
  if (contenedores.size !== 1) return linea;
  return acomodar(estado, linea, [...contenedores][0], { indices });
}

/**
 * Otro tipo para la partida (§5.1, §11): con existencia en un solo contenedor de ese tipo, ahí (★); si ya estaba
 * acomodada, se queda en su contenedor cuando tiene hoja de ese tipo; si no, vuelve a «Faltan por acomodar».
 */
export function conTipo(estado, linea, clase, { indices = new Indices(estado) } = {}) {
  const antes = acomodoDe(estado, linea, { indices });
  const nueva = desacomodar({ ...linea, clase }, indices);
  if (linea.no_inventariado) return { ...linea, clase };
  const auto = acomodoAutomatico(estado, nueva, { indices });
  if (auto !== nueva) return auto;
  if (antes.estado === "acomodada" && contenedoresDe(estado).find((c) => c.numero === antes.contenedor)?.hojas[clase]) {
    return acomodar(estado, nueva, antes.contenedor, { indices });
  }
  return nueva;
}

/**
 * El avance del acomodo (§6): las partidas que se acomodan (sin las «sin existencia»), cuántas ya, las que faltan y
 * cuántas de esta entrada hay en cada contenedor.
 */
export function avanceAcomodo(estado, lineas, { indices = new Indices(estado) } = {}) {
  const porContenedor = new Map();
  const faltan = [];
  const sinExistencia = [];
  let acomodadas = 0;
  for (const l of lineas) {
    const a = acomodoDe(estado, l, { indices });
    if (a.estado === "sin_existencia") sinExistencia.push(l);
    else if (a.estado === "acomodada") {
      acomodadas += 1;
      porContenedor.set(a.contenedor, (porContenedor.get(a.contenedor) ?? 0) + 1);
    } else faltan.push(l);
  }
  return { total: acomodadas + faltan.length, acomodadas, faltan, sinExistencia, porContenedor };
}
