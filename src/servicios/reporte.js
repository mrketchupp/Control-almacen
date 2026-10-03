// Reporte diario: el libro de vales y el inventario como estaban al cierre de una fecha (ver
// corte.js), con los vales y entradas de ese día y lo que falta subir al SharePoint hasta ahí.

import { ultimoFolioAl } from "./corte.js";
import { folioEntrada } from "./entradas.js";
import { areaDeVale, conFirmasPorPapel, ultimoEnvio, valesPorEnviar } from "./vales.js";

const partidas = (v) => v.lineas.filter((l) => Number.isInteger(l.codigo)).length;

/**
 * @returns {{ fecha, salidas: [{ vale, folio, area, recibio, partidas, porSubir }], entradas: [...], partidas, porSubir }}
 */
export function reporteDelDia(estado, fecha) {
  const desde = ultimoEnvio(estado)?.hasta_cambio ?? 0;
  const salidas = estado.vales
    .filter((v) => v.tipo === "SALIDA" && v.estado === "EMITIDO" && v.fecha === fecha)
    .sort((a, b) => a.folio - b.folio)
    .map((v) => ({
      vale: v,
      folio: v.folio,
      area: areaDeVale(estado, v)?.nombre ?? v.depto_destino ?? "",
      recibio: conFirmasPorPapel(estado, v).recibio_nombre ?? "",
      partidas: partidas(v),
      porSubir: (v.cambio ?? 0) > Math.max(desde, v.subido_cambio ?? 0),
    }));
  const entradas = estado.vales
    .filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO" && v.fecha === fecha)
    .sort((a, b) => a.folio - b.folio)
    .map((v) => ({ vale: v, folio: folioEntrada(v.folio), folio_externo: v.folio_externo ?? "", origen: v.origen ?? "", partidas: partidas(v) }));
  const corteSalida = ultimoFolioAl(estado, "SALIDA", fecha);
  return {
    fecha,
    salidas,
    entradas,
    partidas: salidas.reduce((t, s) => t + s.partidas, 0),
    corte: { salida: corteSalida, entrada: ultimoFolioAl(estado, "ENTRADA", fecha) },
    // Vales posteriores al día (no van en los archivos de este reporte).
    despues: estado.vales.filter((v) => v.tipo === "SALIDA" && v.folio > corteSalida && v.estado === "EMITIDO").length,
    porSubir: valesPorEnviar(estado, { hastaFolio: corteSalida }),
  };
}

/** Fechas con vales de salida, de la más reciente a la más antigua (para saltar entre días). */
export function fechasConVales(estado) {
  return [...new Set(estado.vales.filter((v) => v.tipo === "SALIDA" && v.estado === "EMITIDO" && v.fecha).map((v) => v.fecha))].sort().reverse();
}
