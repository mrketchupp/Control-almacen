// Hoja de conteo imprimible (RF-41): una por contenedor, con los renglones en el orden de su
// hoja del Excel y la columna CONTADO en blanco para contar "a ciegas" (sin la existencia que
// dice el sistema). Al final, renglones vacíos para lo que se encuentre y no esté en la lista.
// HTML y CSS puros: la interfaz los manda al diálogo de impresión.

import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { fmtFecha } from "../nucleo/fechas.js";
import { escaparHtml } from "./vale.js";

const RENGLONES_EN_BLANCO = 6;

const CSS =
  "@page{size:letter portrait;margin:0.45in 0.4in 0.5in 0.4in}" +
  ".conteo-hoja{font:9pt Arial,sans-serif;color:#000;break-after:page;page-break-after:always}" +
  ".conteo-hoja:last-child{break-after:auto;page-break-after:auto}" +
  ".conteo-hoja *{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  ".conteo-cabeza{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:6px}" +
  ".conteo-cabeza h1{font-size:13pt;margin:0}.conteo-cabeza p{margin:2px 0 0;font-size:9pt}" +
  ".conteo-datos{text-align:right;font-size:9pt;line-height:1.5}" +
  ".conteo-tabla{width:100%;border-collapse:collapse;table-layout:fixed}" +
  ".conteo-tabla th,.conteo-tabla td{border:1px solid #000;padding:0 4px;overflow:hidden}" +
  ".conteo-tabla th{background:#d9e1f2;font-size:8pt;text-align:left;height:0.24in}" +
  // Todos los renglones del mismo alto y con espacio para escribir a mano; el texto largo va en una línea.
  ".conteo-tabla td{height:0.34in;max-height:0.34in;vertical-align:middle;white-space:nowrap;text-overflow:ellipsis}" +
  ".conteo-tabla .n,.conteo-tabla .cod{text-align:right}" +
  ".conteo-tabla .contado{background:#fff}" +
  ".conteo-tabla thead{display:table-header-group}.conteo-tabla tr{break-inside:avoid;page-break-inside:avoid}" +
  ".conteo-firmas{display:flex;gap:40px;margin-top:28px}.conteo-firmas div{flex:1;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8pt}" +
  ".conteo-nota{font-size:8pt;margin:6px 0 0}";

const COLUMNAS = [
  ["ITEM", "4%", "n"],
  ["CÓDIGO", "7%", "cod"],
  ["DESCRIPCIÓN", "27%", ""],
  ["DIMENSIÓN", "15%", ""],
  ["NP", "10%", ""],
  ["UM", "5%", ""],
  ["CONTADO", "12%", "contado"],
  ["OBSERVACIONES", "20%", ""],
];

/**
 * @param ubicaciones ids a imprimir (en el orden de las hojas)
 * @returns {{ css, html }}
 */
export function documentoHojaConteo(estado, { ubicaciones, fecha = null, usuario = null } = {}) {
  const indices = new Indices(estado);
  const elegidas = [...estado.ubicaciones].filter((u) => ubicaciones.includes(u.id)).sort((a, b) => a.orden - b.orden);
  const cabezaTabla = `<colgroup>${COLUMNAS.map(([, ancho]) => `<col style="width:${ancho}">`).join("")}</colgroup><thead><tr>${COLUMNAS.map(([t]) => `<th>${t}</th>`).join("")}</tr></thead>`;
  const hojas = elegidas.map((u) => {
    const renglones = estado.existencias.filter((e) => e.ubicacion_id === u.id && e.activo !== false).sort((a, b) => a.orden - b.orden);
    const filas = renglones.map((e, i) => {
      const v = indices.variante(e.variante_id);
      const celdas = [
        i + 1,
        v.codigo,
        indices.articulo(v.codigo)?.descripcion ?? "",
        dimensionMostrada(e, v) ?? "",
        npMostrado(e, v) ?? "",
        umMostrada(e, v) ?? "",
        "",
        "",
      ];
      return `<tr>${celdas.map((c, k) => `<td class="${COLUMNAS[k][2]}" title="${escaparHtml(String(c))}">${escaparHtml(String(c))}</td>`).join("")}</tr>`;
    });
    for (let i = 0; i < RENGLONES_EN_BLANCO; i++) filas.push(`<tr>${COLUMNAS.map(([, , clase]) => `<td class="${clase}"></td>`).join("")}</tr>`);
    const titulo = escaparHtml(u.hoja_excel.trim());
    return (
      `<section class="conteo-hoja"><div class="conteo-cabeza"><div><h1>Hoja de conteo · ${titulo}</h1>` +
      `<p>${renglones.length} partidas. Anota lo que cuentes; lo que no esté en la lista va en las partidas en blanco.</p></div>` +
      `<div class="conteo-datos">Fecha: ${fecha ? escaparHtml(fmtFecha(fecha)) : "____________"}<br>Contó: ${usuario ? escaparHtml(usuario) : "______________________"}</div></div>` +
      `<table class="conteo-tabla">${cabezaTabla}<tbody>${filas.join("")}</tbody></table>` +
      `<div class="conteo-firmas"><div>Contó (nombre y firma)</div><div>Revisó (nombre y firma)</div></div></section>`
    );
  });
  return { css: CSS, html: hojas.join("") };
}
