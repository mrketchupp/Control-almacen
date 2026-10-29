// Estilos uniformes para la tabla del inventario (Ronda 25, decisiones del usuario I-1 a I-6): cada
// columna con un solo estilo. De la celda se conserva la alineación; se ponen bordes delgados en las
// cuatro orillas, Calibri 12 negrita, sin colores de fila (solo CONSUMO, INGRESO y TOTAL con su color),
// NP y DIMENSIÓN como texto y las cantidades en General. Solo se agregan entradas al final de
// styles.xml: lo que ya estaba (y lo que usan otras hojas) no cambia.

import { atributos, ponerAtributo } from "./xml.js";

const BORDE_DELGADO =
  '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right>' +
  '<top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>';
const LETRA = '<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>';
const relleno = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;

/** Color de cada columna (el encabezado de A a I va en azul claro; TOTAL en azul). */
export const COLOR_COLUMNA = { H: "FFFF00", I: "92D050", J: "00B0F0" };
const COLOR_ENCABEZADO = "B4C6E7";
const TEXTO = 49; // "@"
const GENERAL = 0;
const FORMATO_COLUMNA = { D: TEXTO, E: TEXTO, F: GENERAL, H: GENERAL, I: GENERAL, J: GENERAL };

/** Ancho (en caracteres) de A a J, igual en todas las hojas. */
export const ANCHOS = { A: 8, B: 14, C: 52, D: 28, E: 27, F: 13, G: 11, H: 13, I: 13, J: 13 };

const FORMATOS_INTEGRADOS = { 12: "# ?/?", 13: "# ??/??" };

export class EstilosUniformes {
  constructor(xml) {
    this.original = xml;
    this.xmlActual = xml;
    this.formatos = new Map(Object.entries(FORMATOS_INTEGRADOS).map(([k, v]) => [Number(k), v]));
    for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      this.formatos.set(Number(a.numFmtId), a.formatCode);
    }
    this.xfs = [...seccion(xml, "cellXfs").matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
    this.cache = new Map();
    this.ids = {};
  }

  get cambio() {
    return this.xmlActual !== this.original;
  }

  /** Código de formato de número de un estilo ("General", "# ?/?", "d-mmm"…). */
  formatoDe(indice) {
    const xf = this.xfs[Number(indice ?? 0)];
    const id = Number(atributos(/^<xf\b([^>]*?)\/?>/.exec(xf ?? "<xf>")?.[1] ?? "").numFmtId ?? 0);
    return id === 0 ? "General" : (this.formatos.get(id) ?? "General");
  }

  /** Estilo uniforme de la columna `letra` a partir del que tenía la celda (`base`, índice de cellXfs). */
  deColumna(base, letra, { encabezado = false } = {}) {
    const clave = `${base ?? ""}|${letra}|${encabezado ? 1 : 0}`;
    if (this.cache.has(clave)) return this.cache.get(clave);
    const xf = this.xfs[Number(base ?? 0)] ?? this.xfs[0];
    const color = encabezado ? (letra === "J" ? COLOR_COLUMNA.J : COLOR_ENCABEZADO) : COLOR_COLUMNA[letra];
    const cambios = {
      fontId: this._id("letra", "fonts", "font", LETRA),
      borderId: this._id("borde", "borders", "border", BORDE_DELGADO),
      fillId: color ? this._id(`relleno-${color}`, "fills", "fill", relleno(color)) : 0,
      applyFont: 1,
      applyBorder: 1,
      applyFill: 1,
    };
    if (!encabezado && FORMATO_COLUMNA[letra] !== undefined) Object.assign(cambios, { numFmtId: FORMATO_COLUMNA[letra], applyNumberFormat: 1 });
    let nuevo = xf.replace(/^<xf\b[^>]*?(?=\/?>)/, (apertura) => Object.entries(cambios).reduce((e, [n, v]) => ponerAtributo(e, n, String(v)), apertura));
    nuevo = nuevo.replace(/\s(?:quotePrefix|pivotButton)="[^"]*"/g, "");
    const indice = this._agregar("cellXfs", nuevo);
    this.xfs.push(nuevo);
    this.cache.set(clave, indice);
    return indice;
  }

  xml() {
    return this.xmlActual;
  }

  _id(clave, contenedor, etiqueta, elemento) {
    if (this.ids[clave] === undefined) this.ids[clave] = this._agregar(contenedor, elemento, etiqueta);
    return this.ids[clave];
  }

  /** Agrega `elemento` al final de la sección `contenedor` y devuelve su índice. */
  _agregar(contenedor, elemento) {
    const patron = new RegExp(`<${contenedor}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${contenedor}>)`);
    const m = patron.exec(this.xmlActual);
    if (!m) throw new Error(`styles.xml no tiene <${contenedor}>`);
    const hijo = contenedor === "cellXfs" ? "xf" : contenedor.slice(0, -1);
    const cuantos = [...(m[3] ?? "").matchAll(new RegExp(`<${hijo}\\b[^>]*?\\/>|<${hijo}\\b[^>]*>[\\s\\S]*?<\\/${hijo}>`, "g"))].length;
    const apertura = ponerAtributo(`<${contenedor}${m[1]}`, "count", String(cuantos + 1));
    this.xmlActual = this.xmlActual.replace(m[0], `${apertura}>${m[3] ?? ""}${elemento}</${contenedor}>`);
    return cuantos;
  }
}

function seccion(xml, nombre) {
  return new RegExp(`<${nombre}\\b[^>]*>([\\s\\S]*?)<\\/${nombre}>`).exec(xml)?.[1] ?? "";
}

/** <cols> con los anchos uniformes de A a J (las columnas después de J se conservan). */
export function conAnchosUniformes(antes) {
  const nuestras = Object.entries(ANCHOS)
    .map(([, ancho], i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho + 0.7109375}" customWidth="1"/>`)
    .join("");
  const m = /<cols>([\s\S]*?)<\/cols>/.exec(antes);
  if (!m) return antes.replace(/(<sheetFormatPr\b[^>]*?\/>)/, `$1<cols>${nuestras}</cols>`);
  const otras = [...m[1].matchAll(/<col\b[^>]*?\/>/g)]
    .map((c) => c[0])
    .flatMap((c) => {
      const a = atributos(c);
      const min = Number(a.min);
      const max = Number(a.max);
      if (min > 10) return [c];
      if (max > 10) return [ponerAtributo(c, "min", "11")];
      return [];
    });
  return antes.replace(m[0], `<cols>${nuestras}${otras.join("")}</cols>`);
}

/** El número con formato de fracción como se ve en Excel: 5.875 → "5 7/8" (denominador hasta 16). */
export function comoFraccion(numero) {
  const signo = numero < 0 ? "-" : "";
  const n = Math.abs(numero);
  const entero = Math.floor(n);
  let mejor = null;
  for (let d = 2; d <= 16; d++) {
    const num = Math.round((n - entero) * d);
    const error = Math.abs((n - entero) - num / d);
    if (!mejor || error < mejor.error - 1e-12) mejor = { num, d, error };
  }
  if (!mejor || mejor.num === 0) return `${signo}${entero}`;
  if (mejor.num === mejor.d) return `${signo}${entero + 1}`;
  const g = mcd(mejor.num, mejor.d);
  return `${signo}${entero ? `${entero} ` : ""}${mejor.num / g}/${mejor.d / g}`;
}

function mcd(a, b) {
  return b ? mcd(b, a % b) : a;
}
