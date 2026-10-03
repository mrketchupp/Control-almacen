// Estado "al cierre" de un día (reporte diario): lo que había al terminar esa fecha, para
// exportar el libro de vales y el inventario como estaban ese día aunque después se hayan hecho
// más vales, entradas, conteos o movimientos.
//
//  - Vales de salida hasta el último folio con fecha ≤ al día (los folios van en orden).
//  - Entradas hasta la última E-folio con fecha ≤ al día.
//  - Conteos y reacomodos con fecha posterior se deshacen (cada línea guarda la cantidad y el
//    conteo anteriores); también los aplicados después de alguno de ellos, para no mezclar.
//  - Renglones del inventario creados después (por entradas, conteos o movimientos) no aparecen.
//
// Las correcciones se toman como están hoy: corrigen un error del vale, no son otro movimiento.

import { folioEntrada } from "./entradas.js";

const hay = (v) => v !== null && v !== undefined;

/** Último folio de un tipo con fecha ≤ al día (0 si no hay). */
export function ultimoFolioAl(estado, tipo, fecha) {
  let maximo = 0;
  for (const v of estado.vales) {
    if (v.tipo !== tipo || !hay(v.folio) || !v.fecha || v.fecha > fecha) continue;
    if (v.folio > maximo) maximo = v.folio;
  }
  return maximo;
}

/**
 * Copia del estado como estaba al cierre del día.
 * @returns {{ estado, salida, entrada, revertidos, excluidos }} salida/entrada = folios de corte
 */
export function estadoAlCierre(estadoActual, fecha) {
  const estado = structuredClone(estadoActual);
  const salida = ultimoFolioAl(estado, "SALIDA", fecha);
  const entrada = ultimoFolioAl(estado, "ENTRADA", fecha);
  estado.vales = estado.vales.filter((v) => !hay(v.folio) || (v.tipo === "ENTRADA" ? v.folio <= entrada : v.folio <= salida));

  // Conteos posteriores al día: se deshacen del más reciente al más antiguo.
  const posteriores = estado.conteos.filter((c) => c.lineas && c.fecha > fecha);
  const desde = posteriores.length ? Math.min(...posteriores.map((c) => c.id)) : Infinity;
  const revertir = estado.conteos.filter((c) => c.lineas && c.id >= desde).sort((a, b) => b.id - a.id);
  const quitar = new Set();
  const porId = new Map(estado.existencias.map((e) => [e.id, e]));
  for (const conteo of revertir) {
    for (const linea of [...conteo.lineas].reverse()) {
      const e = porId.get(linea.existencia_id);
      if (!e) continue;
      if (linea.cantidad_anterior === null || linea.cantidad_anterior === undefined) {
        quitar.add(e.id);
        continue;
      }
      e.cantidad_conteo = linea.cantidad_anterior;
      e.conteo_id = linea.conteo_anterior_id ?? null;
    }
    for (const id of conteo.nuevos ?? []) quitar.add(id);
  }
  const revertidos = new Set(revertir.map((c) => c.id));
  estado.conteos = estado.conteos.filter((c) => !revertidos.has(c.id));
  estado.reacomodos = (estado.reacomodos ?? []).filter((r) => !revertidos.has(r.conteo_id));

  // Renglones que creó una entrada posterior al corte.
  for (const e of estado.existencias) {
    const m = /^ENTRADA E-(\d+)/.exec(e.origen ?? "");
    if (m && Number(m[1]) > entrada) quitar.add(e.id);
  }
  estado.existencias = estado.existencias.filter((e) => !quitar.has(e.id));
  estado.conteo_en_curso = null;
  return { estado, salida, entrada, revertidos: revertidos.size, excluidos: quitar.size };
}

/** Texto del corte para mostrar ("vales hasta el folio 555 · entradas hasta E-0004"). */
export function describirCorte({ salida, entrada }) {
  return `vales de salida hasta el folio ${salida || "—"} · entradas hasta ${entrada ? folioEntrada(entrada) : "—"}`;
}
