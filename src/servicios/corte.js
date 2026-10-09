// Estado "al cierre" de un día (reporte diario): lo que había al terminar esa fecha, para
// exportar el libro de vales y el inventario como estaban ese día aunque después se hayan hecho
// más vales, entradas, conteos o movimientos.
//
//  - Vales de salida hasta el último folio con fecha ≤ al día (los folios van en orden).
//  - Entradas recibidas hasta ese día (`fechaDelDia` = fecha de recibido, Ronda 22). Como se puede
//    corregir, ya no van en orden de folio: E-0002 pudo recibirse antes que E-0001.
//  - Conteos y reacomodos con fecha posterior se deshacen (cada línea guarda la cantidad y el
//    conteo anteriores); también los aplicados después de alguno de ellos, para no mezclar.
//  - Renglones del inventario creados después (por entradas, conteos o movimientos) no aparecen.
//
// Las correcciones se toman como están hoy: corrigen un error del vale, no son otro movimiento.

import { fechaDelDia, fmtFecha } from "../nucleo/fechas.js";
import { folioEntrada } from "./entradas.js";

const hay = (v) => v !== null && v !== undefined;

/** Último folio de un tipo con fecha ≤ al día (0 si no hay). En las entradas, por su fecha de recibido. */
export function ultimoFolioAl(estado, tipo, fecha) {
  let maximo = 0;
  for (const v of estado.vales) {
    const dia = fechaDelDia(v);
    if (v.tipo !== tipo || !hay(v.folio) || !dia || dia > fecha) continue;
    if (v.folio > maximo) maximo = v.folio;
  }
  return maximo;
}

/**
 * Entradas recibidas al cierre del día (por fecha de recibido, no por folio).
 * @returns {{ incluidas: Set<folio>, ultima, fuera: [folio] }} ultima = el folio más alto incluido;
 *   fuera = folios menores que `ultima` que se recibieron después (huecos en el orden de folio)
 */
export function entradasAlCierre(estado, fecha) {
  const incluidas = new Set();
  const todas = [];
  for (const v of estado.vales) {
    if (v.tipo !== "ENTRADA" || !hay(v.folio)) continue;
    todas.push(v.folio);
    const dia = fechaDelDia(v);
    if (dia && dia <= fecha) incluidas.add(v.folio);
  }
  const ultima = incluidas.size ? Math.max(...incluidas) : 0;
  const fuera = todas.filter((f) => f < ultima && !incluidas.has(f)).sort((a, b) => a - b);
  return { incluidas, ultima, fuera };
}

/**
 * Copia del estado como estaba al cierre del día.
 * @returns {{ estado, salida, entrada, fuera, entradas, fecha, revertidos, excluidos }} salida = folio de corte
 *   de las salidas; entrada = la entrada de folio más alto recibida hasta ese día; fuera = las de folio menor
 *   recibidas después; entradas = cuántas entran
 */
export function estadoAlCierre(estadoActual, fecha) {
  const estado = structuredClone(estadoActual);
  const salida = ultimoFolioAl(estado, "SALIDA", fecha);
  const { incluidas, ultima: entrada, fuera } = entradasAlCierre(estado, fecha);
  estado.vales = estado.vales.filter((v) => !hay(v.folio) || (v.tipo === "ENTRADA" ? incluidas.has(v.folio) : v.folio <= salida));

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

  // Renglones que creó una entrada recibida después del día, salvo que un vale que sí entra (p. ej. una entrada
  // registrada después pero recibida antes) también use ese renglón: entonces ya existía ese día.
  const usados = new Set();
  for (const v of estado.vales) for (const l of v.lineas) if (hay(l.existencia_id)) usados.add(l.existencia_id);
  for (const e of estado.existencias) {
    const m = /^ENTRADA E-(\d+)/.exec(e.origen ?? "");
    if (m && !incluidas.has(Number(m[1])) && !usados.has(e.id)) quitar.add(e.id);
  }
  estado.existencias = estado.existencias.filter((e) => !quitar.has(e.id));
  estado.conteo_en_curso = null;
  return { estado, salida, entrada, fuera, entradas: incluidas.size, fecha, revertidos: revertidos.size, excluidos: quitar.size };
}

const folios = (lista) => {
  const textos = lista.map(folioEntrada);
  return textos.length === 1 ? textos[0] : `${textos.slice(0, -1).join(", ")} y ${textos.at(-1)}`;
};

/**
 * Texto del corte para mostrar: "vales de salida hasta el folio 555 · entradas recibidas hasta el 03/10/2026:
 * hasta E-0004 (menos E-0003, recibida después)".
 */
export function describirCorte({ salida, entrada, fuera = [], fecha = null }) {
  const hasta = fecha ? `hasta el ${fmtFecha(fecha)}` : "hasta ese día";
  const entradas = entrada ? `hasta ${folioEntrada(entrada)}` : "ninguna";
  const huecos = fuera.length ? ` (menos ${folios(fuera)}, ${fuera.length === 1 ? "recibida" : "recibidas"} después)` : "";
  return `vales de salida hasta el folio ${salida || "—"} · entradas recibidas ${hasta}: ${entradas}${huecos}`;
}
