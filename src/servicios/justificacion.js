// Justificar faltantes de la conciliación con AX (Ronda 14). Un faltante (físico < AX) se explica con
// vales que el físico ya descontó pero AX todavía no (sin IN / TR). Muchos ya cuentan solos (tránsito);
// los que no —su clave no ubica una sola partida del inventario, el vale es de antes del reporte de AX,
// la base ya le puso folio pero lo aplicó después…— el usuario los ASIGNA al faltante: se sugieren por
// código, dimensión y cantidad, se aprueban (una por una o todas) y también se eligen a mano.
//
// Una asignación vive en el corte (corte.asignaciones) y la usa transitoDesde: la partida cuenta para
// ese faltante, dentro del periodo admitido. Las cantidades del inventario y los vales no cambian. Lo
// asignado sale en la hoja "VALES POR APLICAR" de la solicitud de ajuste para que la base lo aplique.

import { CERO, dec, decTexto, sumar } from "../nucleo/decimal.js";
import { clavesDeBusqueda, clavesPropias, hayInterseccion } from "../nucleo/catalogo.js";
import { Indices, auditar, siguienteId } from "../nucleo/estado.js";
import { cuentaParaSaldo } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../nucleo/fechas.js";
import { fechaIsoValida, fechaMinimaJustificantes, valeAdmitido } from "../nucleo/justificantes.js";
import { claveEstricta, sinDimension } from "../nucleo/normalizar.js";
import { corteAx, conciliar, dimensionAx, enTransito, varianteVigente } from "./conciliacion.js";
import { sinAplicar } from "./seguimiento.js";

export class ErrorJustificacion extends Error {}

/** Guarda el límite de este corte; las asignaciones anteriores se conservan para revisar o quitar. */
export function fijarFechaMinimaVales(estado, corteId, fecha, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorJustificacion("El corte ya no existe.");
  if (!fechaIsoValida(fecha)) throw new ErrorJustificacion("Escribe una fecha mínima válida para los vales.");
  if (fecha > corte.fecha) throw new ErrorJustificacion("La fecha mínima no puede ser posterior al reporte de AX.");
  const antes = fechaMinimaJustificantes(corte);
  if (fecha === antes) return fecha;
  corte.fecha_minima_vales = fecha;
  auditar(estado, {
    usuario, entidad: "corte_ax", entidadId: corte.id, accion: "CAMBIAR_FECHA_MINIMA_VALES",
    antes: { fecha_minima_vales: antes }, despues: { fecha_minima_vales: fecha },
  });
  return fecha;
}

const hay = (v) => v !== null && v !== undefined;

/** Clave de una fila de la conciliación a la que se le pueden asignar vales: "v12" (variante) o "a34" (partida de AX). */
export const claveDestino = (x) => (x.variante_id !== undefined && x.variante_id !== null && x.lineas ? `v${x.variante_id}` : `a${x.linea.id}`);

/** Destino guardado en la asignación: { variante_id } o { linea_ax_id }. */
export const destinoDe = (x) => (x.lineas && hay(x.variante_id) ? { variante_id: x.variante_id, linea_ax_id: null } : { variante_id: null, linea_ax_id: x.linea.id });

/** ¿Esta asignación es de esta fila? (una fila de variante también recibe lo asignado a sus partidas de AX). */
const idsDeFila = (fila) => fila.variante_ids ?? (hay(fila.variante_id) ? [fila.variante_id] : []);

function esDeFila(asignacion, fila, indices) {
  if (hay(asignacion.variante_id)) return Boolean(fila.lineas) && idsDeFila(fila).includes(varianteVigente(indices, asignacion.variante_id));
  const lineas = fila.lineas ?? (fila.linea ? [fila.linea] : []);
  return lineas.some((l) => l.id === asignacion.linea_ax_id);
}

/**
 * Filas que se pueden justificar: los faltantes sin explicar y las que ya tienen vales asignados.
 * @returns [{ clave, fila, codigo, falta (Big ≥ 0), asignadas: [asignación…] }]
 */
export function justificables(estado, r, { indices = new Indices(estado) } = {}) {
  const asignaciones = r.corte.asignaciones ?? [];
  const salida = [];
  for (const fila of [...r.renglones, ...r.axSinFisico]) {
    const asignadas = asignaciones.filter((a) => esDeFila(a, fila, indices));
    if (fila.estado !== "faltante" && !asignadas.length) continue;
    salida.push({ clave: claveDestino(fila), fila, codigo: fila.codigo, falta: fila.estado === "faltante" ? fila.sin_explicar.abs() : CERO, asignadas });
  }
  return salida.sort((a, b) => a.codigo - b.codigo);
}

// ---------------------------------------------------------------- candidatos

/** Qué tan bien coincide la clave del vale con la fila: "exacta", "unica" (el código tiene una sola partida) o "". */
function coincidencia(linea, fila, variantesDelCodigo) {
  const clave = String(linea.clave ?? "");
  const estricta = claveEstricta(clave);
  const delVale = clavesDeBusqueda(clave);
  // "S/D" = "S/D" también cuenta (clavesDeBusqueda quita esas marcas).
  const igual = (...textos) => Boolean(estricta) && textos.some((t) => claveEstricta(t ?? "") === estricta);
  const metodos = fila.metodos ?? [];
  // La partida de AX es el código completo: cualquier vale del código es de ella.
  if (metodos.includes("todo_el_codigo")) return "exacta";
  // Sin dimensión en AX: un vale sin dimensión (S/D, SIN DIMENSIÓN…) es de esta fila.
  if (metodos.includes("sin_dimension") && sinDimension(clave)) return "exacta";
  if (fila.variante) {
    const variantes = fila.variantes ?? [fila.variante];
    if (variantes.some((v) => hayInterseccion(delVale, clavesPropias(v)) || igual(v.dimension, `${v.dimension ?? ""} ${v.np ?? ""}`))) return "exacta";
    return variantesDelCodigo === 1 ? "unica" : "";
  }
  const lineas = fila.lineas ?? [fila.linea];
  if (lineas.some((l) => hayInterseccion(delVale, clavesDeBusqueda(dimensionAx(l))) || igual(dimensionAx(l), l.tamano))) return "exacta";
  return variantesDelCodigo === 0 ? "unica" : "";
}

/**
 * ESTADOS de una partida candidata:
 *  libre             no cuenta en ningún lado y el físico ya la descontó: se puede asignar (y sugerir)
 *  otra              ya justifica a otra partida del inventario: se puede mover a mano
 *  en_ax             la base ya le puso IN / TR: solo a mano (si AX la aplicó después del reporte)
 *  sin_base          sin el archivo de la base, una salida anterior al corte se supone ya en AX: solo a mano
 *  posterior_conteo  el físico aún no la descuenta (está por ubicar, después del conteo): no se puede
 *  aqui              ya justifica esta misma fila sola
 */
export const ESTADOS_CANDIDATO = {
  libre: "Sin IN / TR, no justifica nada todavía",
  otra: "Ya justifica otra partida",
  en_ax: "La base ya la aplicó en AX (IN / TR)",
  sin_base: "Sin archivo de la base: se supone ya en AX",
  posterior_conteo: "Aún no se descuenta del físico (por ubicar)",
  aqui: "Ya justifica esta partida",
};

/**
 * Partidas de vales de salida que podrían justificar la fila (mismo código), con su estado.
 * @returns [{ vale, linea, cantidad: Big, info, estado, coincide, sugerible, otra }]
 *   (sin las NO INV, las duplicadas que la base no tiene ni las ya asignadas en este corte)
 */
export function candidatos(estado, r, fila, { indices = new Indices(estado), codigo = fila.codigo } = {}) {
  const asignadas = new Set((r.corte.asignaciones ?? []).map((a) => a.partida_id));
  const variantesDelCodigo = new Set([...r.fisico.values()].filter((x) => x.variante.codigo === codigo).map((x) => x.variante.id)).size;
  const destino = new Set(idsDeFila(fila));
  const existenciasDestino = fila.variante ? estado.existencias.filter((e) => e.activo !== false && destino.has(e.variante_id)) : [];
  // El físico ya descontó una partida sin renglón ligado si el vale es anterior al conteo de todos los renglones del destino.
  const yaContado = (vale) =>
    existenciasDestino.every((e) => !cuentaParaSaldo(hay(e.conteo_id) ? indices.conteos.get(e.conteo_id) : null, vale));
  const salida = [];
  for (const vale of estado.vales) {
    if (vale.tipo !== "SALIDA" || vale.estado !== "EMITIDO" || !valeAdmitido(r.corte, vale)) continue;
    for (const linea of vale.lineas) {
      if (linea.codigo !== codigo || linea.no_inventariado || asignadas.has(linea.id)) continue;
      const total = dec(linea.cantidad);
      if (!total || total.lte(0)) continue;
      const info = r.ax?.porLinea.get(linea.id) ?? null;
      if (info?.estado === "no_inv" || (info?.estado === "sin_registro" && info.duplicada)) continue;
      const t = r.transito.porLinea.get(linea.id);
      const cantidad = t?.cantidad ?? (sinAplicar(info) ? info.pendiente : total);
      let estadoCand;
      let otra = null;
      const ligada = hay(linea.existencia_id) ? indices.existencia(linea.existencia_id) : null;
      const varianteLigada = ligada ? varianteVigente(indices, ligada.variante_id) : null;
      if (t?.donde === "variante") {
        const v = varianteVigente(indices, t.variante_id);
        if (fila.variante && destino.has(v)) estadoCand = "aqui";
        else {
          estadoCand = "otra";
          otra = indices.variante(v);
        }
      } else if (ligada && fila.variante && !destino.has(varianteLigada)) {
        // Salió de otra partida del inventario: moverla es decir que salió de esta.
        estadoCand = "otra";
        otra = indices.variante(varianteLigada);
      } else if (!ligada && fila.variante && !yaContado(vale)) {
        estadoCand = "posterior_conteo";
      } else if (t?.donde === "ubicar") {
        estadoCand = "libre";
      } else if (info && (info.estado === "aplicada" || info.estado === "parcial")) {
        estadoCand = "en_ax";
      } else if (!r.ax && !enTransito(r.corte, vale)) {
        estadoCand = "sin_base";
      } else {
        estadoCand = "libre";
      }
      const coincide = coincidencia(linea, fila, variantesDelCodigo);
      salida.push({ vale, linea, cantidad, info, estado: estadoCand, coincide, otra, sugerible: estadoCand === "libre" && coincide !== "" });
    }
  }
  const orden = { libre: 0, otra: 1, en_ax: 2, sin_base: 3, aqui: 4, posterior_conteo: 5 };
  return salida.sort(
    (a, b) => orden[a.estado] - orden[b.estado] || Number(b.coincide === "exacta") - Number(a.coincide === "exacta") || b.vale.folio - a.vale.folio,
  );
}

// ---------------------------------------------------------------- sugerencias

const escala = (d) => Math.round(Number(d.toFixed(3)) * 1000);

/**
 * La combinación de partidas que mejor cubre el faltante sin pasarse: primero la que lo cubre exacto
 * con menos partidas; si no hay, la que más se acerca. Hasta 14 candidatas (las más parecidas).
 */
export function mejorCombinacion(pool, falta) {
  const objetivo = escala(falta);
  const lista = pool.slice(0, 14).map((c) => ({ c, n: escala(c.cantidad) })).filter((x) => x.n > 0 && x.n <= objetivo);
  let mejor = null;
  const total = 1 << lista.length;
  for (let mascara = 1; mascara < total; mascara++) {
    let suma = 0;
    let cuantas = 0;
    for (let i = 0; i < lista.length; i++) {
      if (mascara & (1 << i)) {
        suma += lista[i].n;
        cuantas += 1;
      }
    }
    if (suma > objetivo) continue;
    if (!mejor || suma > mejor.suma || (suma === mejor.suma && cuantas < mejor.cuantas)) mejor = { mascara, suma, cuantas };
  }
  if (!mejor) return null;
  const partidas = lista.filter((_, i) => mejor.mascara & (1 << i)).map((x) => x.c);
  const suma = sumar(...partidas.map((p) => p.cantidad));
  return { partidas, suma, exacta: suma.eq(falta) };
}

/**
 * Sugerencias para todos los faltantes: cada partida libre que coincide en código y dimensión se
 * sugiere a un solo faltante (los más grandes eligen primero).
 * @returns Map(clave → { partidas: [candidata…], suma, exacta })
 */
export function sugerencias(estado, r, { indices = new Indices(estado) } = {}) {
  const usadas = new Set();
  const salida = new Map();
  const faltantes = justificables(estado, r, { indices })
    .filter((j) => j.falta.gt(0))
    .sort((a, b) => b.falta.cmp(a.falta));
  for (const j of faltantes) {
    const pool = candidatos(estado, r, j.fila, { indices }).filter((c) => c.sugerible && !usadas.has(c.linea.id));
    if (!pool.length) continue;
    const combinacion = mejorCombinacion(pool, j.falta);
    if (!combinacion) continue;
    for (const p of combinacion.partidas) usadas.add(p.linea.id);
    salida.set(j.clave, combinacion);
  }
  return salida;
}

// ---------------------------------------------------------------- asignar y quitar

/**
 * Asigna partidas de vale a una fila de la conciliación.
 *   destino: { variante_id } o { linea_ax_id }; partidas: [{ partida_id, cantidad }]
 *   metodo: "sugerida" (aprobada por el usuario) o "manual"
 */
export function asignarVales(estado, { corteId, destino, partidas, metodo = "manual" }, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorJustificacion("El corte ya no existe.");
  if (!partidas?.length) throw new ErrorJustificacion("Elige al menos una partida de vale.");
  if (!hay(destino?.variante_id) && !hay(destino?.linea_ax_id)) throw new ErrorJustificacion("Falta a qué partida se asigna.");
  // Se revisa el lote completo antes de asignar: un vale fuera del periodo rechaza todo el lote.
  const ya = new Set((corte.asignaciones ?? []).map((a) => a.partida_id));
  const preparadas = [];
  for (const p of partidas) {
    const vale = estado.vales.find((v) => v.tipo === "SALIDA" && v.lineas.some((l) => l.id === p.partida_id));
    if (!vale) throw new ErrorJustificacion("Esa partida de vale ya no existe.");
    if (vale.estado !== "EMITIDO") throw new ErrorJustificacion(`El vale ${vale.folio} no está emitido.`);
    if (!valeAdmitido(corte, vale)) throw new ErrorJustificacion(
      `El vale ${vale.folio} tiene fecha ${fmtFecha(vale.fecha) || "sin registrar"}. Solo se aceptan vales desde el ${fmtFecha(fechaMinimaJustificantes(corte))}.`,
    );
    if (ya.has(p.partida_id)) throw new ErrorJustificacion(`Una partida del vale ${vale.folio} ya está asignada en este corte.`);
    const linea = vale.lineas.find((l) => l.id === p.partida_id);
    const cantidad = dec(p.cantidad ?? linea.cantidad);
    if (!cantidad || cantidad.lte(0)) throw new ErrorJustificacion(`La partida del vale ${vale.folio} no tiene cantidad.`);
    preparadas.push({ vale, linea, cantidad });
    ya.add(linea.id);
  }
  corte.asignaciones ??= [];
  const nuevas = [];
  for (const { vale, linea, cantidad } of preparadas) {
    const asignacion = {
      id: siguienteId(estado, "asignacion_ax"),
      partida_id: linea.id,
      vale_id: vale.id,
      folio: vale.folio,
      codigo: linea.codigo,
      cantidad: decTexto(cantidad),
      variante_id: hay(destino.variante_id) ? destino.variante_id : null,
      linea_ax_id: hay(destino.variante_id) ? null : destino.linea_ax_id,
      metodo,
      por: usuario,
      en: ahoraIso(),
    };
    corte.asignaciones.push(asignacion);
    nuevas.push(asignacion);
  }
  auditar(estado, {
    usuario,
    entidad: "corte_ax",
    entidadId: corte.id,
    accion: "ASIGNAR_VALES",
    despues: { destino, metodo, partidas: nuevas.map((a) => ({ folio: a.folio, codigo: a.codigo, cantidad: a.cantidad })) },
  });
  return nuevas;
}

/** Aprueba todas las sugerencias de una vez. @returns { faltantes, partidas } asignadas */
export function asignarSugeridas(estado, corteId, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorJustificacion("El corte ya no existe.");
  const indices = new Indices(estado);
  const r = conciliar(estado, corte);
  const filas = new Map(justificables(estado, r, { indices }).map((j) => [j.clave, j.fila]));
  let faltantes = 0;
  let partidas = 0;
  for (const [clave, s] of sugerencias(estado, r, { indices })) {
    const fila = filas.get(clave);
    if (!fila) continue;
    asignarVales(estado, { corteId, destino: destinoDe(fila), partidas: s.partidas.map((p) => ({ partida_id: p.linea.id, cantidad: p.cantidad })), metodo: "sugerida" }, usuario);
    faltantes += 1;
    partidas += s.partidas.length;
  }
  return { faltantes, partidas };
}

/** Quita asignaciones (por id) de un corte. */
export function quitarAsignaciones(estado, { corteId, ids }, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorJustificacion("El corte ya no existe.");
  const quitar = new Set(ids);
  const quitadas = (corte.asignaciones ?? []).filter((a) => quitar.has(a.id));
  if (!quitadas.length) return 0;
  corte.asignaciones = corte.asignaciones.filter((a) => !quitar.has(a.id));
  auditar(estado, {
    usuario,
    entidad: "corte_ax",
    entidadId: corte.id,
    accion: "QUITAR_ASIGNACION",
    antes: { partidas: quitadas.map((a) => ({ folio: a.folio, codigo: a.codigo, cantidad: a.cantidad })) },
  });
  return quitadas.length;
}
