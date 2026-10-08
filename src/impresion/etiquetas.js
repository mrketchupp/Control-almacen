// Etiquetas de almacén (Ronda 20; antes vivían en el generador de etiquetas aparte). Cada hoja tiene el
// tamaño exacto del papel con los márgenes como relleno, y la cuadrícula se CALCULA con las medidas
// físicas (hoja, márgenes, etiqueta y separación): nunca se dibujan filas que no caben, que era lo que
// causaba saltos de página. Lo que se ve en la vista previa es lo que sale impreso (@page sin margen).
// HTML y CSS puros: la interfaz los manda al diálogo de impresión. Todo texto pasa por escaparHtml.

import { escaparHtml } from "./vale.js";

export const HOJAS = {
  carta: { nombre: "Carta", detalle: "215.9 × 279.4 mm", ancho: 215.9, alto: 279.4 },
  a4: { nombre: "A4", detalle: "210 × 297 mm", ancho: 210, alto: 297 },
};

/** Medidas en mm; fuente en px. Como la plantilla estándar del generador (2 × 6 en carta). */
export const DISENO_DEFECTO = { hoja: "carta", margen_sup: 10, margen_lat: 10, ancho: 92, alto: 39, sep_x: 4, sep_y: 4, fuente: 10, borde: true };

export const PLANTILLAS = [
  { id: "carta-2x6", nombre: "Carta · 2 × 6 (92 × 39 mm)", detalle: "Estándar", diseno: { ...DISENO_DEFECTO } },
  {
    // Hojas precortadas J-5163 / Avery 5163: 4 × 2 in, margen superior 0.5 in, lateral 5/32 in,
    // separación horizontal 3/16 in y vertical 0. Sin borde para no marcar el precorte.
    id: "carta-2x5-j5163",
    nombre: "Carta · 2 × 5 precortada (102 × 51 mm)",
    detalle: "J-5163 / Avery 5163",
    diseno: { hoja: "carta", margen_sup: 12.7, margen_lat: 3.97, ancho: 101.6, alto: 50.8, sep_x: 4.76, sep_y: 0, fuente: 11, borde: false },
  },
  { id: "carta-3x8", nombre: "Carta · 3 × 8 (60 × 30 mm)", detalle: "Compacta", diseno: { hoja: "carta", margen_sup: 10, margen_lat: 10, ancho: 60, alto: 30, sep_x: 2.5, sep_y: 2.5, fuente: 8, borde: true } },
  { id: "carta-1x4", nombre: "Carta · 1 × 4 (180 × 58 mm)", detalle: "Grande", diseno: { hoja: "carta", margen_sup: 12.7, margen_lat: 12.7, ancho: 180, alto: 58, sep_x: 5, sep_y: 5, fuente: 13, borde: true } },
  { id: "a4-2x6", nombre: "A4 · 2 × 6 (93 × 42 mm)", detalle: "", diseno: { hoja: "a4", margen_sup: 10, margen_lat: 10, ancho: 93, alto: 42, sep_x: 3, sep_y: 3, fuente: 10, borde: true } },
];

/** Etiquetas por impresión como máximo (más es casi seguro un error de cantidad). */
export const MAXIMO_ETIQUETAS = 2000;

const MEDIDAS = ["margen_sup", "margen_lat", "ancho", "alto", "sep_x", "sep_y"];
const POR_MM = { mm: 1, cm: 10, in: 25.4, pulg: 25.4, px: 25.4 / 96 };

/**
 * Una longitud escrita a mano, en mm: "95.25", "95,25", "3.75in", "0.5 in", "2cm". Sin unidad = mm.
 * null si no se entiende.
 */
export function leerMedida(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? valor : null;
  const m = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(mm|cm|in|pulg|px|")?$/i.exec(String(valor ?? "").trim());
  if (!m) return null;
  const unidad = m[2] === '"' ? "in" : (m[2] || "mm").toLowerCase();
  return Math.round(Number(m[1].replace(",", ".")) * POR_MM[unidad] * 100) / 100;
}

/** El diseño guardado completado con los valores por defecto (y sin medidas imposibles). */
export function normalizarDiseno(guardado) {
  const d = { ...DISENO_DEFECTO };
  if (!guardado || typeof guardado !== "object") return d;
  if (HOJAS[guardado.hoja]) d.hoja = guardado.hoja;
  for (const clave of MEDIDAS) {
    const n = leerMedida(guardado[clave]);
    if (n !== null) d[clave] = n;
  }
  if (!(d.ancho > 0)) d.ancho = DISENO_DEFECTO.ancho;
  if (!(d.alto > 0)) d.alto = DISENO_DEFECTO.alto;
  const fuente = Number(guardado.fuente);
  if (Number.isFinite(fuente) && fuente >= 5 && fuente <= 40) d.fuente = fuente;
  if (typeof guardado.borde === "boolean") d.borde = guardado.borde;
  return d;
}

const mismoDiseno = (a, b) => Object.keys(DISENO_DEFECTO).every((k) => a[k] === b[k]);

/** La plantilla con exactamente ese diseño (null = personalizado). */
export const plantillaDe = (diseno) => PLANTILLAS.find((p) => mismoDiseno(p.diseno, normalizarDiseno(diseno))) ?? null;

/** Cuántas etiquetas caben físicamente en una hoja: n etiquetas + (n − 1) separaciones ≤ área útil. */
export function cuadricula(diseno) {
  const d = normalizarDiseno(diseno);
  const hoja = HOJAS[d.hoja];
  const utilAncho = hoja.ancho - 2 * d.margen_lat;
  const utilAlto = hoja.alto - 2 * d.margen_sup;
  // 0.05 mm de tolerancia para no perder una columna o fila por redondeo.
  const cabe = (util, medida, sep) => Math.max(0, Math.floor((util + sep + 0.05) / (medida + sep)));
  const columnas = cabe(utilAncho, d.ancho, d.sep_x);
  const filas = cabe(utilAlto, d.alto, d.sep_y);
  const avisos = [];
  if (!columnas) avisos.push("El ancho de la etiqueta no cabe en la hoja con ese margen.");
  if (!filas) avisos.push("El alto de la etiqueta no cabe en la hoja con ese margen.");
  return { hoja, diseno: d, utilAncho, utilAlto, columnas, filas, porHoja: columnas * filas, avisos };
}

const IMAGEN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const imagen = (logo) => (logo?.src && IMAGEN.test(logo.src) ? `<img src="${logo.src}" alt="">` : "");
const t = (valor) => escaparHtml(String(valor ?? "").trim());
const mm = (n) => `${Math.round(n * 100) / 100}mm`;

function cabeza(identidad) {
  const texto = t(identidad?.texto);
  return (
    `<div class="etq-cabeza"><div class="etq-logo">${imagen(identidad?.logo_izq)}</div>` +
    // Sin texto de almacén no se dibuja la línea: el título queda solo, sin hueco debajo.
    `<div class="etq-titulo"><b>ETIQUETADO ALMACEN</b>${texto ? `<span>${texto}</span>` : ""}</div>` +
    `<div class="etq-logo">${imagen(identidad?.logo_der)}</div></div>`
  );
}

const campo = (nombre, valor) => `<div class="etq-campo"><b>${nombre}</b><span>${t(valor) || "N/A"}</span></div>`;

/** Etiqueta completa de material (la CONDICIÓN del generador ahora es el INVENTARIO). */
function etiquetaMaterial(e, identidad) {
  return (
    `<div class="etq etq-material">${cabeza(identidad)}<div class="etq-cuerpo">` +
    `<div class="etq-par">${campo("CODIGO AX:", e.codigo)}${campo("INVENTARIO:", e.inventario)}</div>` +
    campo("NOMBRE:", e.nombre) +
    campo("DIMENSIÓN:", e.dimension) +
    campo("DESCRIPCION:", e.descripcion) +
    campo("NO. PARTE:", e.np) +
    campo("ÁREA:", e.area) +
    `</div></div>`
  );
}

/** Etiqueta de código AX en grande con el nombre abajo. */
function etiquetaAx(e, identidad) {
  return `<div class="etq etq-ax">${cabeza(identidad)}<div class="etq-codigo">${t(e.codigo)}</div><div class="etq-nombre">${t(e.nombre)}</div></div>`;
}

/**
 * En pantalla (`vista`) todas las reglas van dentro de `.<ambito>`: así la vista previa (con sombras) no se mezcla con
 * el documento que se imprime ni con otra vista previa de otro diseño abierta al mismo tiempo.
 */
function css(c, vista, ambito) {
  const d = c.diseno;
  const borde = d.borde ? "0.5mm" : "0mm";
  const p = vista ? `.${ambito} ` : "";
  const reglas = [
    // Al imprimir, en bloque: los saltos de página no siempre se respetan dentro de un flex.
    vista ? ".etq-hojas{display:flex;flex-direction:column;align-items:center;gap:24px}" : ".etq-hojas{display:block}",
    // Un pelo menos alta que el papel: el redondeo no debe sacar una hoja en blanco.
    `.etq-hoja{box-sizing:border-box;width:${mm(c.hoja.ancho)};height:${mm(c.hoja.alto - 0.2)};padding:${mm(d.margen_sup)} ${mm(d.margen_lat)};background:#fff;overflow:hidden;` +
      `break-after:page;page-break-after:always${vista ? ";box-shadow:0 2px 14px rgba(0,0,0,.25)" : ""}}`,
    ".etq-hoja:last-child{break-after:auto;page-break-after:auto}",
    `.etq-rejilla{display:grid;grid-template-columns:repeat(${c.columnas || 1},${mm(d.ancho)});grid-auto-rows:${mm(d.alto)};gap:${mm(d.sep_y)} ${mm(d.sep_x)}}`,
    `.etq{box-sizing:border-box;width:${mm(d.ancho)};height:${mm(d.alto)};border:${borde} solid #000;background:#fff;color:#000;padding:1.5mm;display:flex;flex-direction:column;overflow:hidden;` +
      `font-family:Arial,Helvetica,sans-serif;font-size:${d.fuente}px;line-height:1.2;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    ".etq *{box-sizing:border-box}",
    ".etq-cabeza{display:grid;grid-template-columns:17mm 1fr 17mm;gap:1mm;align-items:center;margin-bottom:1mm}",
    ".etq-logo{display:flex;align-items:center;justify-content:center;height:8.5mm}",
    ".etq-logo img{max-width:100%;max-height:100%;object-fit:contain}",
    ".etq-titulo{text-align:center;display:flex;flex-direction:column}",
    ".etq-titulo b{font-size:1.1em;line-height:1.1}",
    ".etq-titulo span{font-size:.9em;line-height:1.1}",
    ".etq-cuerpo{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-evenly}",
    ".etq-par{display:grid;grid-template-columns:1fr 1fr;gap:2mm;border-bottom:.2mm solid #999}",
    ".etq-par .etq-campo{border-bottom:none}",
    ".etq-campo{display:flex;gap:1mm;white-space:nowrap;overflow:hidden;padding:.3mm 0;border-bottom:.2mm solid #999}",
    ".etq-cuerpo>.etq-campo:last-child{border-bottom:none}",
    ".etq-campo b{flex-shrink:0}",
    ".etq-campo span{overflow:hidden;text-overflow:ellipsis}",
    `.etq-codigo{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;font-size:${d.fuente * 4.5}px;font-weight:bold;letter-spacing:.15em;text-align:center}`,
    ".etq-nombre{font-size:1.2em;text-align:center;padding:.5mm 1mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
  ];
  const conAmbito = reglas.map((r) => (p ? r.replace(/(^|\})([^{}]+)\{/g, (_, antes, sel) => `${antes}${sel.split(",").map((x) => p + x.trim()).join(",")}{`) : r));
  return (vista ? "" : `@page{size:${mm(c.hoja.ancho)} ${mm(c.hoja.alto)};margin:0}@media print{html,body{margin:0!important;padding:0!important}}`) + conAmbito.join("");
}

/** Cada etiqueta repetida según su cantidad (al menos una). */
export function expandir(etiquetas) {
  const todas = [];
  for (const e of etiquetas) for (let i = 0; i < Math.max(1, Math.trunc(Number(e.cantidad) || 1)); i++) todas.push(e);
  return todas;
}

/**
 * @param etiquetas  [{ cantidad, codigo, nombre, dimension, np, descripcion, area, inventario }]
 * @param tipo       "material" | "ax"
 * @param identidad  { DLTA: { logo_izq, logo_der, texto }, GSM: … }: cada etiqueta lleva la de su inventario
 * @param vista      true = para la pantalla (sin @page; las hojas con sombra), dentro de `.<ambito>`
 * @returns {{ css, html, etiquetas, hojas, cuadricula }}
 */
export function documentoEtiquetas(etiquetas, { tipo = "material", diseno = null, identidad = {}, vista = false, ambito = "etq-pantalla" } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(ambito)) throw new Error(`Ámbito de vista previa inválido: ${ambito}`);
  const c = cuadricula(diseno);
  const todas = expandir(etiquetas);
  const envolver = (contenido) => (vista ? `<div class="${ambito}">${contenido}</div>` : contenido);
  if (!c.porHoja) return { css: css(c, vista, ambito), html: "", etiquetas: todas.length, hojas: 0, cuadricula: c };
  const dibujar = tipo === "ax" ? etiquetaAx : etiquetaMaterial;
  const hojas = [];
  for (let i = 0; i < todas.length; i += c.porHoja) {
    const celdas = todas.slice(i, i + c.porHoja).map((e) => dibujar(e, identidad[e.inventario]));
    hojas.push(`<section class="etq-hoja"><div class="etq-rejilla">${celdas.join("")}</div></section>`);
  }
  return { css: css(c, vista, ambito), html: envolver(`<div class="etq-hojas">${hojas.join("")}</div>`), etiquetas: todas.length, hojas: hojas.length, cuadricula: c };
}
