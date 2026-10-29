// Listas de revisión del conteo de auditoría (Ronda 24), para revisarlas a mano o en físico: los NP que se
// perdieron al reemplazar lo inventariable con el Kardex (y con qué partida quedó cada uno) y las partidas
// que salieron del inventario porque el Kardex no las trae. HTML y CSS puros, como la hoja de conteo.

import { fmtFecha } from "../nucleo/fechas.js";
import { escaparHtml } from "./vale.js";

const CSS =
  "@page{size:letter landscape;margin:0.4in}" +
  ".revision-hoja{font:9pt Arial,sans-serif;color:#000}" +
  ".revision-hoja *{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  ".revision-cabeza{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:6px}" +
  ".revision-cabeza h1{font-size:13pt;margin:0}.revision-cabeza p{margin:2px 0 0;font-size:9pt}" +
  ".revision-datos{text-align:right;font-size:9pt;line-height:1.5}" +
  ".revision-tabla{width:100%;border-collapse:collapse;table-layout:fixed}" +
  ".revision-tabla th,.revision-tabla td{border:1px solid #000;padding:0 4px;overflow:hidden}" +
  ".revision-tabla th{background:#d9e1f2;font-size:8pt;text-align:left;height:0.24in}" +
  ".revision-tabla td{height:0.3in;vertical-align:middle;white-space:nowrap;text-overflow:ellipsis}" +
  ".revision-tabla .n{text-align:right}.revision-tabla .marca{text-align:center}" +
  ".revision-tabla thead{display:table-header-group}.revision-tabla tr{break-inside:avoid;page-break-inside:avoid}" +
  ".revision-firmas{display:flex;gap:40px;margin-top:24px}.revision-firmas div{flex:1;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8pt}";

/** Columnas de cada lista: [título, ancho, clase, valor(fila)]. */
const COLUMNAS = {
  np: [
    ["CONT.", "6%", "", (f) => f.lugar],
    ["CÓDIGO", "6%", "n", (f) => f.codigo],
    ["DESCRIPCIÓN", "19%", "", (f) => f.descripcion],
    ["DIMENSIÓN", "12%", "", (f) => f.dimension],
    ["NP", "13%", "", (f) => f.np],
    ["TENÍA", "6%", "n", (f) => `${f.cantidad} ${f.um}`],
    ["AHORA ESTÁ EN", "18%", "", (f) => f.reemplazo || "—"],
    ["✓", "3%", "marca", () => ""],
    ["OBSERVACIONES", "17%", "", () => ""],
  ],
  retiradas: [
    ["CONT.", "6%", "", (f) => f.lugar],
    ["CÓDIGO", "6%", "n", (f) => f.codigo],
    ["DESCRIPCIÓN", "24%", "", (f) => f.descripcion],
    ["DIMENSIÓN", "13%", "", (f) => f.dimension],
    ["NP", "12%", "", (f) => f.np],
    ["TENÍA", "7%", "n", (f) => `${f.cantidad} ${f.um}`],
    ["¿ESTÁ?", "6%", "marca", () => ""],
    ["OBSERVACIONES", "26%", "", () => ""],
  ],
};

const TITULOS = {
  np: ["NP que se perdieron", "Partidas que el Kardex sustituyó y tenían NP. Si alguno hace falta, anótalo en Inventario (NP)."],
  retiradas: ["Partidas que salieron del inventario", "Estaban en una hoja inventariable y el Kardex no las trae. Revísalas en físico."],
};

/**
 * @param tipo  "np" | "retiradas"
 * @param filas los renglones de la lista (servicios/baseOficial.js, `conteo.revision`)
 * @returns {{ css, html }}
 */
export function documentoRevision(tipo, filas, { fecha = null, inventario = "", usuario = null } = {}) {
  const columnas = COLUMNAS[tipo];
  const [titulo, explicacion] = TITULOS[tipo];
  const cabeza = `<colgroup>${columnas.map(([, ancho]) => `<col style="width:${ancho}">`).join("")}</colgroup><thead><tr>${columnas.map(([t]) => `<th>${t}</th>`).join("")}</tr></thead>`;
  const ordenadas = [...filas].sort((a, b) => String(a.hoja).localeCompare(String(b.hoja)) || a.codigo - b.codigo);
  const cuerpo = ordenadas
    .map((f) => `<tr>${columnas.map(([, , clase, valor]) => `<td class="${clase}" title="${escaparHtml(String(valor(f) ?? ""))}">${escaparHtml(String(valor(f) ?? ""))}</td>`).join("")}</tr>`)
    .join("");
  const html =
    `<section class="revision-hoja"><div class="revision-cabeza"><div><h1>${escaparHtml(titulo)}${inventario ? ` · ${escaparHtml(inventario)}` : ""}</h1>` +
    `<p>${escaparHtml(explicacion)} ${filas.length} partidas.</p></div>` +
    `<div class="revision-datos">Conteo de auditoría: ${fecha ? escaparHtml(fmtFecha(fecha)) : "—"}<br>Revisó: ${usuario ? escaparHtml(usuario) : "______________________"}</div></div>` +
    `<table class="revision-tabla">${cabeza}<tbody>${cuerpo}</tbody></table>` +
    `<div class="revision-firmas"><div>Revisó (nombre y firma)</div><div>Fecha</div></div></section>`;
  return { css: CSS, html };
}
