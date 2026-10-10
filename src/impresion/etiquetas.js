// Etiquetas de almacén (Ronda 20; antes vivían en el generador de etiquetas aparte). Cada hoja tiene el
// tamaño exacto del papel con los márgenes como relleno, y la cuadrícula se CALCULA con las medidas
// físicas (hoja, márgenes, etiqueta y separación): nunca se dibujan filas que no caben, que era lo que
// causaba saltos de página. Lo que se ve en la vista previa es lo que sale impreso (@page sin margen).
// HTML y CSS puros: la interfaz los manda al diálogo de impresión. Todo texto pasa por escaparHtml.
//
// Ronda 22: qué lleva cada etiqueta y dónde lo dice su **modelo** (el «diseño» que el usuario arma en el
// editor; ver modelos.js). Cada etiqueta es una caja `position: relative` y cada elemento va encima en
// posición absoluta, en % de la etiqueta; la letra, en % de su alto. Hay un solo render: el documento que
// se imprime, la vista previa y el editor dibujan cada elemento con el mismo HTML (`htmlElemento`).
// La plantilla (`diseno`) sigue diciendo papel, márgenes, tamaño, separaciones y borde; su `fuente` ya no
// se usa (el tamaño de la letra va en el modelo) y se conserva solo para no perder lo guardado.

import { codigo128, svgBarras, textoParaBarras, LARGO_MAXIMO_BARRAS } from "./barras.js";
import { CAMPOS_ETIQUETA, modeloDeFabrica, normalizarElemento, normalizarModelo } from "./modelos.js";
import { CAPACIDAD_QR, matrizQr, svgQr } from "./qr.js";
import { escaparHtml } from "./vale.js";

export const HOJAS = {
  carta: { nombre: "Carta", detalle: "215.9 × 279.4 mm", ancho: 215.9, alto: 279.4 },
  a4: { nombre: "A4", detalle: "210 × 297 mm", ancho: 210, alto: 297 },
};

/**
 * Medidas en mm. Como la plantilla estándar del generador (2 × 6 en carta). `fuente` (px) ya no se usa
 * desde la Ronda 22 (la letra va en el modelo); se conserva en los datos por compatibilidad.
 */
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


// ---------------------------------------------------------------- elementos

const IMAGEN = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const imagen = (logo) => (logo?.src && IMAGEN.test(logo.src) ? `<img src="${logo.src}" alt="">` : "");
const limpio = (valor) => String(valor ?? "").trim();
const t = (valor) => escaparHtml(limpio(valor));
const mm = (n) => `${Math.round(n * 100) / 100}mm`;
/** Un número ya normalizado, corto, para el CSS. */
const cifra = (n) => String(Math.round(n * 1000) / 1000);

/** Zona blanca alrededor del código QR (módulos) y del código de barras (módulos; el estándar pide 10). */
export const MARGEN_QR = 2;
export const MARGEN_BARRAS = 10;
/** Grosor de la línea de abajo de un campo, en mm. */
const LINEA = 0.2;

const FLEX = { izq: "flex-start", centro: "center", der: "flex-end", arriba: "flex-start", abajo: "flex-end" };
const ALINEAR_TEXTO = { izq: "left", centro: "center", der: "right" };
const SVG_X = { izq: "xMin", centro: "xMid", der: "xMax" };
const SVG_Y = { arriba: "YMin", centro: "YMid", abajo: "YMax" };
const DE_TEXTO = new Set(["titulo", "texto_almacen", "campo", "texto"]);
// El título y el texto de almacén van más juntos, como el encabezado de las Rondas 20–21.
const interlineado = (el) => (el.tipo === "titulo" || el.tipo === "texto_almacen" ? 1.1 : 1.2);

const sinAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const valorDe = (etiqueta, campo) => limpio(etiqueta?.[campo]);

/**
 * Sustituye {codigo} {nombre} {dimension} {np} {descripcion} {area} {inventario} por los datos de la
 * etiqueta (también con mayúsculas o acento: {Dimensión}). Lo demás queda tal cual. Sin escapar.
 */
export function llenarPlantilla(plantilla, etiqueta) {
  return String(plantilla ?? "").replace(/\{\s*([^{}\s]{1,20})\s*\}/g, (todo, nombre) => {
    const campo = sinAcento(nombre).toLowerCase();
    return Object.hasOwn(CAMPOS_ETIQUETA, campo) ? valorDe(etiqueta, campo) : todo;
  });
}

/** Renglones que caben en la caja de un texto de varias líneas (al menos uno). */
function renglonesDe(el, alto) {
  const disponible = (el.h / 100) * alto - (el.linea_abajo ? LINEA : 0);
  const renglon = (el.letra / 100) * alto * interlineado(el);
  return Math.max(1, Math.floor(disponible / renglon + 0.02));
}

/**
 * Declaraciones CSS de un elemento limpio: [caja, texto de dentro]. Solo números ya acotados y palabras
 * fijas de esta tabla: nada del modelo llega crudo.
 */
function estilosDe(el, d) {
  const caja = [`left:${cifra(el.x)}%`, `top:${cifra(el.y)}%`, `width:${cifra(el.w)}%`, `height:${cifra(el.h)}%`];
  const dentro = [];
  if (el.letra !== undefined) caja.push(`font-size:${cifra((el.letra / 100) * d.alto)}mm`);
  if (el.alinear && el.tipo !== "qr") caja.push(`justify-content:${FLEX[el.alinear]}`);
  if (el.vertical && el.tipo !== "qr") caja.push(`align-items:${FLEX[el.vertical]}`);
  if (DE_TEXTO.has(el.tipo)) {
    caja.push(`line-height:${interlineado(el)}`);
    if (el.espaciado) dentro.push(`letter-spacing:${cifra(el.espaciado)}em`);
    if (el.varias_lineas) dentro.push(`text-align:${ALINEAR_TEXTO[el.alinear]}`, `-webkit-line-clamp:${renglonesDe(el, d.alto)}`);
  }
  return [caja.join(";"), dentro.join(";")];
}

/** Lo que dice un elemento de texto (sin escapar), o null si no se dibuja. */
function contenidoDeTexto(el, etiqueta, identidad) {
  switch (el.tipo) {
    case "titulo":
      return el.texto;
    case "texto_almacen":
      // Sin texto de almacén no se dibuja nada (ni su línea).
      return limpio(identidad?.texto) || null;
    case "texto":
      return limpio(llenarPlantilla(el.texto, etiqueta)) || el.vacio;
    default:
      return valorDe(etiqueta, el.campo) || el.vacio;
  }
}

/**
 * El HTML de un elemento ya limpio. `n` = su número en el modelo (la caja se toma de la regla `.etq-n<n>`
 * del CSS del documento); null = la caja va en el atributo style (editor).
 */
function dibujar(el, etiqueta, identidad, d, n) {
  const [caja, dentro] = n === null ? estilosDe(el, d) : ["", ""];
  const marca = n === null ? "" : ` etq-n${n}`;
  const abre = (clases) => `<div class="etq-e ${clases}${marca}"${caja ? ` style="${caja}"` : ""}>`;
  switch (el.tipo) {
    case "logo_izq":
    case "logo_der": {
      const img = imagen(identidad?.[el.tipo]);
      return img ? `${abre("etq-e-logo")}${img}</div>` : "";
    }
    case "qr": {
      const svg = svgQr(llenarPlantilla(el.datos, etiqueta), { margen: MARGEN_QR });
      if (!svg) return "";
      return `${abre("etq-e-qr")}${svg.replace('preserveAspectRatio="xMidYMid meet"', `preserveAspectRatio="${SVG_X[el.alinear]}${SVG_Y[el.vertical]} meet"`)}</div>`;
    }
    case "barras": {
      const datos = llenarPlantilla(el.datos, etiqueta);
      const codigo = codigo128(datos);
      if (!codigo) return "";
      const debajo = el.texto_visible ? `<div class="etq-bar-txt${el.negrita ? " etq-b" : ""}">${t(codigo.texto)}</div>` : "";
      return `${abre("etq-e-bar")}<div class="etq-bar">${svgBarras(datos, { margen: MARGEN_BARRAS })}</div>${debajo}</div>`;
    }
    default: {
      const contenido = contenidoDeTexto(el, etiqueta, identidad);
      if (contenido === null) return "";
      const varias = el.varias_lineas;
      const clases = `etq-e-txt ${varias ? "etq-v" : "etq-1"}${el.linea_abajo ? " etq-linea" : ""}`;
      const conEstilo = dentro ? ` style="${dentro}"` : "";
      let interior;
      if (el.tipo === "campo") {
        // El título del campo siempre en negritas; «negrita» es para el valor.
        const titulo = el.etiqueta ? `<b>${t(el.etiqueta)}</b>${varias ? " " : ""}` : "";
        interior = `<div class="etq-t"${conEstilo}>${titulo}<span${el.negrita ? ' class="etq-b"' : ""}>${t(contenido)}</span></div>`;
      } else {
        interior = `<div class="etq-t${el.negrita ? " etq-b" : ""}"${conEstilo}><span>${t(contenido)}</span></div>`;
      }
      return `${abre(clases)}${interior}</div>`;
    }
  }
}

const identidadDe = (identidad, etiqueta) => (identidad && Object.hasOwn(identidad, String(etiqueta?.inventario)) ? identidad[etiqueta.inventario] : null);
const claseTipo = (tipo) => (tipo === "ax" ? "ax" : "material");

/** El modelo con que se dibuja: el que llega (limpio) o, si no sirve, el de fábrica de la lista. */
const modeloPara = (modelo, tipo) => normalizarModelo(modelo) ?? normalizarModelo(modeloDeFabrica(tipo));

/**
 * El HTML de UN elemento como se imprime, con su caja en el atributo style (para el editor). Va dentro de
 * un `.etq` (ver htmlEtiqueta y cssEtiqueta). "" si con esos datos no se dibuja (logo sin imagen, texto de
 * almacén vacío, QR o código de barras sin datos) o si el elemento no sirve.
 * @param identidad  { DLTA: { logo_izq, logo_der, texto }, GSM: … }: se usa la del inventario de la etiqueta
 */
export function htmlElemento(el, etiqueta, { identidad = {}, diseno = null } = {}) {
  const limpio = normalizarElemento(el);
  return limpio ? dibujar(limpio, etiqueta, identidadDe(identidad, etiqueta), normalizarDiseno(diseno), null) : "";
}

/** Una etiqueta completa con el modelo (cajas en style, como htmlElemento). */
export function htmlEtiqueta(etiqueta, { tipo = "material", modelo = null, identidad = {}, diseno = null } = {}) {
  const m = modeloPara(modelo, tipo);
  const d = normalizarDiseno(diseno);
  const propia = identidadDe(identidad, etiqueta);
  return `<div class="etq etq-${claseTipo(tipo)}">${m.elementos.map((el) => dibujar(el, etiqueta, propia, d, null)).join("")}</div>`;
}

/** Datos de ejemplo para el editor y la muestra del diseño (inventados). */
export function muestraEtiqueta(tipo = "material", inventario = "DLTA") {
  const material = { cantidad: 1, codigo: "1739", nombre: "BANDA EN V", dimension: "3VX900", np: "NP-4471", descripcion: "OC: 4500123", area: "TALLER", inventario };
  if (tipo !== "ax") return material;
  const { cantidad, codigo, nombre } = material;
  return { cantidad, codigo, nombre, inventario };
}

/**
 * Avisos de un elemento con los datos de una etiqueta (para el editor): QR o código de barras vacío,
 * demasiado largo, con letras que no admite o muy chico para leerse; campos que la etiqueta de código AX
 * no trae.
 */
export function avisosElemento(el, etiqueta, { diseno = null, tipo = "material" } = {}) {
  const x = normalizarElemento(el);
  if (!x) return ["Este elemento no se reconoce: no se imprime."];
  const d = normalizarDiseno(diseno);
  const ancho = (x.w / 100) * d.ancho;
  const alto = (x.h / 100) * d.alto;
  const avisos = [];
  if (x.tipo === "campo" && tipo === "ax" && !["codigo", "nombre", "inventario"].includes(x.campo)) {
    avisos.push("Las etiquetas de código AX solo traen código, nombre e inventario: este campo sale vacío.");
  }
  if (x.tipo === "qr") {
    const datos = llenarPlantilla(x.datos, etiqueta);
    const bytes = new TextEncoder().encode(datos).length;
    if (!datos.trim()) avisos.push("Con estos datos el código QR queda vacío: no se imprime.");
    else if (bytes > CAPACIDAD_QR) avisos.push(`No cabe en un código QR: ${bytes} bytes y caben ${CAPACIDAD_QR}. Acorta los datos.`);
    else {
      const modulo = Math.min(ancho, alto) / (matrizQr(datos).tamano + 2 * MARGEN_QR);
      if (modulo < 0.3) avisos.push(`Los cuadritos del código QR quedan de ${modulo.toFixed(2)} mm: agrándalo o acorta los datos (se lee bien desde 0.3 mm).`);
    }
  }
  if (x.tipo === "barras") {
    const datos = llenarPlantilla(x.datos, etiqueta);
    const codigo = codigo128(datos);
    if (!codigo) {
      avisos.push(textoParaBarras(datos) ? `El código de barras admite hasta ${LARGO_MAXIMO_BARRAS} caracteres.` : "Con estos datos el código de barras queda vacío: no se imprime.");
    } else {
      if (codigo.texto !== datos.trim()) avisos.push(`El código de barras no admite acentos ni símbolos especiales: lleva «${codigo.texto}».`);
      // Un lector de mano pide barras de al menos ~0.19 mm.
      const minimo = (codigo.modulos + 2 * MARGEN_BARRAS) * 0.19;
      if (ancho < minimo) avisos.push(`Muy angosto para leerse: dale al menos ${Math.ceil(minimo)} mm de ancho (ahora mide ${Math.floor(ancho)} mm).`);
    }
  }
  return avisos;
}

// ---------------------------------------------------------------- CSS

const AMBITO = /^[a-z][a-z0-9-]*$/;

function validarAmbito(ambito) {
  if (!AMBITO.test(ambito)) throw new Error(`Ámbito de vista previa inválido: ${ambito}`);
}

/** Reglas de la etiqueta y de sus elementos (las mismas al imprimir, en la vista previa y en el editor). */
function reglasEtiqueta(d) {
  return [
    `.etq{box-sizing:border-box;position:relative;width:${mm(d.ancho)};height:${mm(d.alto)};background:#fff;color:#000;overflow:hidden;` +
      `font-family:Arial,Helvetica,sans-serif;line-height:1.2;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    ".etq *{box-sizing:border-box}",
    // El borde va encima, sin quitar espacio: las posiciones son % de la etiqueta completa, con o sin borde.
    ...(d.borde ? ['.etq::after{content:"";position:absolute;left:0;top:0;right:0;bottom:0;border:0.5mm solid #000;pointer-events:none}'] : []),
    ".etq-e{position:absolute;display:flex;overflow:hidden;margin:0;padding:0}",
    ".etq b,.etq .etq-b{font-weight:700}",
    ".etq-e-logo img{display:block;max-width:100%;max-height:100%;object-fit:contain}",
    ".etq-t{min-width:0;max-width:100%}",
    ".etq-1>.etq-t{display:flex;gap:.38em;white-space:nowrap;overflow:hidden}",
    ".etq-1>.etq-t>b{flex-shrink:0}",
    ".etq-1>.etq-t>span{overflow:hidden;text-overflow:ellipsis}",
    ".etq-v>.etq-t{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}",
    `.etq-linea{border-bottom:${LINEA}mm solid #999}`,
    ".etq-e-qr{display:block}",
    ".etq-e svg{display:block;width:100%;height:100%}",
    ".etq-e-bar{flex-direction:column;align-items:stretch}",
    ".etq-bar{flex:1 1 0;min-height:0}",
    ".etq-bar-txt{flex:none;line-height:1.2;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ];
}

/** Una regla por elemento del modelo (`.etq-n<n>`): la caja va una sola vez, no en cada etiqueta. */
function reglasModelo(m, d) {
  const reglas = [];
  m.elementos.forEach((el, n) => {
    const [caja, dentro] = estilosDe(el, d);
    reglas.push(`.etq-n${n}{${caja}}`);
    if (dentro) reglas.push(`.etq-n${n}>.etq-t{${dentro}}`);
  });
  return reglas;
}

/** En pantalla (`vista`) cada selector va dentro de `.<ambito>`. */
function conAmbito(reglas, vista, ambito) {
  if (!vista) return reglas.join("");
  const p = `.${ambito} `;
  return reglas.map((r) => r.replace(/(^|\})([^{}]+)\{/g, (_, antes, sel) => `${antes}${sel.split(",").map((x) => p + x.trim()).join(",")}{`)).join("");
}

/**
 * CSS de la etiqueta y sus elementos, sin hojas ni @page (para el editor). Con `modelo`, también la
 * regla de cada elemento (`.etq-n<n>`; htmlElemento no la necesita: lleva su caja en style).
 * @param vista  true = todas las reglas dentro de `.<ambito>` (para no tocar el resto de la página)
 */
export function cssEtiqueta({ diseno = null, vista = false, ambito = "etq-pantalla", modelo = null } = {}) {
  validarAmbito(ambito);
  const d = normalizarDiseno(diseno);
  const m = modelo ? normalizarModelo(modelo) : null;
  return conAmbito([...reglasEtiqueta(d), ...(m ? reglasModelo(m, d) : [])], vista, ambito);
}

/**
 * En pantalla (`vista`) todas las reglas van dentro de `.<ambito>`: así la vista previa (con sombras) no se mezcla con
 * el documento que se imprime ni con otra vista previa de otro diseño abierta al mismo tiempo.
 */
function css(c, m, vista, ambito) {
  const d = c.diseno;
  const reglas = [
    // Al imprimir, en bloque: los saltos de página no siempre se respetan dentro de un flex.
    vista ? ".etq-hojas{display:flex;flex-direction:column;align-items:center;gap:24px}" : ".etq-hojas{display:block}",
    // Un pelo menos alta que el papel: el redondeo no debe sacar una hoja en blanco.
    `.etq-hoja{box-sizing:border-box;width:${mm(c.hoja.ancho)};height:${mm(c.hoja.alto - 0.2)};padding:${mm(d.margen_sup)} ${mm(d.margen_lat)};background:#fff;overflow:hidden;` +
      `break-after:page;page-break-after:always${vista ? ";box-shadow:0 2px 14px rgba(0,0,0,.25)" : ""}}`,
    ".etq-hoja:last-child{break-after:auto;page-break-after:auto}",
    `.etq-rejilla{display:grid;grid-template-columns:repeat(${c.columnas || 1},${mm(d.ancho)});grid-auto-rows:${mm(d.alto)};gap:${mm(d.sep_y)} ${mm(d.sep_x)}}`,
    ...reglasEtiqueta(d),
    ...reglasModelo(m, d),
  ];
  return (vista ? "" : `@page{size:${mm(c.hoja.ancho)} ${mm(c.hoja.alto)};margin:0}@media print{html,body{margin:0!important;padding:0!important}}`) + conAmbito(reglas, vista, ambito);
}

// ---------------------------------------------------------------- documento

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
 * @param modelo     el modelo ya elegido (servicios/etiquetas.js `modeloDe`); sin él, el de fábrica del tipo
 * @returns {{ css, html, etiquetas, hojas, cuadricula }}
 */
export function documentoEtiquetas(etiquetas, { tipo = "material", diseno = null, identidad = {}, vista = false, ambito = "etq-pantalla", modelo = null } = {}) {
  validarAmbito(ambito);
  const c = cuadricula(diseno);
  const m = modeloPara(modelo, tipo);
  const todas = expandir(etiquetas);
  const estilos = css(c, m, vista, ambito);
  const envolver = (contenido) => (vista ? `<div class="${ambito}">${contenido}</div>` : contenido);
  if (!c.porHoja) return { css: estilos, html: "", etiquetas: todas.length, hojas: 0, cuadricula: c };
  const clase = `etq etq-${claseTipo(tipo)}`;
  // Las copias de una etiqueta son iguales: se dibuja una vez cada una.
  const dibujadas = new Map();
  const dibujarEtiqueta = (e) => {
    if (!dibujadas.has(e)) {
      const propia = identidadDe(identidad, e);
      dibujadas.set(e, `<div class="${clase}">${m.elementos.map((el, n) => dibujar(el, e, propia, c.diseno, n)).join("")}</div>`);
    }
    return dibujadas.get(e);
  };
  const hojas = [];
  for (let i = 0; i < todas.length; i += c.porHoja) {
    const celdas = todas.slice(i, i + c.porHoja).map(dibujarEtiqueta);
    hojas.push(`<section class="etq-hoja"><div class="etq-rejilla">${celdas.join("")}</div></section>`);
  }
  return { css: estilos, html: envolver(`<div class="etq-hojas">${hojas.join("")}</div>`), etiquetas: todas.length, hojas: hojas.length, cuadricula: c };
}
