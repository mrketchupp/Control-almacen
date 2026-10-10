// Límite anual de los vales que pueden explicar diferencias con AX. Cada corte guarda
// su fecha mínima; cambiarla no modifica cantidades del inventario ni los vales.

import { isoDesdePartes } from "./fechas.js";

export function fechaIsoValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  return isoDesdePartes(...fecha.split("-").map(Number)) === fecha;
}

/** Noviembre del año anterior al reporte, independiente del día en que se abre la app. */
export function fechaMinimaPropuesta(fechaReporte) {
  if (!fechaIsoValida(fechaReporte)) return null;
  return `${String(Number(fechaReporte.slice(0, 4)) - 1).padStart(4, "0")}-11-01`;
}

/** También funciona con cortes antiguos que aún no traen el campo guardado. */
export function fechaMinimaJustificantes(corte) {
  return fechaIsoValida(corte?.fecha_minima_vales) ? corte.fecha_minima_vales : fechaMinimaPropuesta(corte?.fecha);
}

/** El primer día se incluye; una fecha ausente o inválida no sirve como justificante. */
export function valeAdmitido(corte, vale) {
  const minima = fechaMinimaJustificantes(corte);
  return Boolean(minima && fechaIsoValida(vale?.fecha) && vale.fecha >= minima);
}
