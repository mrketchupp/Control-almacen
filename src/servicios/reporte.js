// Reporte del día: los vales de salida (y las entradas) de una fecha, para descargarlos como
// imágenes o PDF y subirlos al SharePoint junto con el libro de vales.

import { fmtFecha } from "../nucleo/fechas.js";
import { folioEntrada } from "./entradas.js";
import { areaDeVale, conFirmasPorPapel, ultimoEnvio } from "./vales.js";

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
      porSubir: (v.cambio ?? 0) > desde,
    }));
  const entradas = estado.vales
    .filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO" && v.fecha === fecha)
    .sort((a, b) => a.folio - b.folio)
    .map((v) => ({ vale: v, folio: folioEntrada(v.folio), folio_externo: v.folio_externo ?? "", origen: v.origen ?? "", partidas: partidas(v) }));
  return {
    fecha,
    salidas,
    entradas,
    partidas: salidas.reduce((t, s) => t + s.partidas, 0),
    porSubir: salidas.filter((s) => s.porSubir).length,
  };
}

/** Nombre del .zip con las imágenes de los vales del día ("Vales de salida 03-10-2026.zip"). */
export const nombreImagenesDelDia = (fecha) => `Vales de salida ${fmtFecha(fecha).replaceAll("/", "-")}.zip`;

/** Fechas con vales de salida, de la más reciente a la más antigua (para saltar entre días). */
export function fechasConVales(estado) {
  return [...new Set(estado.vales.filter((v) => v.tipo === "SALIDA" && v.estado === "EMITIDO" && v.fecha).map((v) => v.fecha))].sort().reverse();
}
