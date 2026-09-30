// Estilos de celda de Excel (styles.xml + tema) convertidos a CSS, y formato de valores
// como los muestra Excel. Se usa para imprimir el vale con la hoja-formulario del usuario.

import { FechaCelda, isoDesdeSerial } from "../nucleo/fechas.js";
import { atributos } from "./xml.js";
import { esFormatoFecha } from "./leer.js";

const INDEXADOS = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

const FORMATOS_INTEGRADOS = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
  11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "dd/mm/yyyy", 15: "d-mmm-yy", 16: "d-mmm",
  17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "dd/mm/yyyy h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

const BORDES = {
  thin: "1px solid", hair: "1px dotted", dotted: "1px dotted", dashed: "1px dashed",
  medium: "2px solid", mediumDashed: "2px dashed", dashDot: "1px dashed", mediumDashDot: "2px dashed",
  dashDotDot: "1px dashed", mediumDashDotDot: "2px dashed", slantDashDot: "2px dashed",
  thick: "3px solid", double: "3px double",
};

// ------------------------------------------------------------------ colores

function hexARgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function rgbAHex([r, g, b]) {
  return [r, g, b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Tinte de Excel: aclara (tint > 0) u oscurece (tint < 0) la luminosidad HSL. */
export function aplicarTinte(hex, tinte) {
  if (!tinte) return hex;
  const [r, g, b] = hexARgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tinte < 0 ? l * (1 + tinte) : l * (1 - tinte) + tinte;
  if (s === 0) return rgbAHex([l, l, l]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbAHex([canal(h + 1 / 3), canal(h), canal(h - 1 / 3)]);
}

function leerTema(xml) {
  if (!xml) return [];
  const esquema = /<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml);
  if (!esquema) return [];
  const colores = [];
  for (const m of esquema[1].matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g)) {
    const srgb = /<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/.exec(m[2]);
    const sys = /<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(m[2]);
    colores.push((srgb?.[1] || sys?.[1] || "000000").toUpperCase());
  }
  // Excel intercambia los dos primeros pares: tema 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2.
  const [dk1, lt1, dk2, lt2, ...resto] = colores;
  return [lt1, dk1, lt2, dk2, ...resto];
}

// ------------------------------------------------------------------ estilos

export class EstilosLibro {
  /** @param libro LibroLeido */
  constructor(libro) {
    const parteEstilos = "xl/styles.xml";
    const xml = libro.existe(parteEstilos) ? libro.texto(parteEstilos) : "";
    const tema = libro.existe("xl/theme/theme1.xml") ? libro.texto("xl/theme/theme1.xml") : "";
    this.tema = leerTema(tema);
    this.indexados = [...INDEXADOS];
    const propios = /<indexedColors>([\s\S]*?)<\/indexedColors>/.exec(xml);
    if (propios) {
      [...propios[1].matchAll(/<rgbColor\b([^>]*?)\/?>/g)].forEach((m, i) => {
        const rgb = atributos(m[1]).rgb;
        if (rgb) this.indexados[i] = rgb.slice(-6).toUpperCase();
      });
    }
    this.formatos = new Map();
    for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      this.formatos.set(Number(a.numFmtId), a.formatCode);
    }
    const seccion = (nombre) => new RegExp(`<${nombre}\\b[^>]*>([\\s\\S]*?)</${nombre}>`).exec(xml)?.[1] ?? "";
    this.fuentes = [...seccion("fonts").matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => this._fuente(m[1] || ""));
    this.rellenos = [...seccion("fills").matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)].map((m) => this._relleno(m[1] || ""));
    this.bordes = [...seccion("borders").matchAll(/<border\b[^>]*?(?:\/>|>([\s\S]*?)<\/border>)/g)].map((m) => this._borde(m[1] || ""));
    this.xfs = [...seccion("cellXfs").matchAll(/<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((m) => {
      const a = atributos(m[1]);
      const alineacion = /<alignment\b([^>]*?)\/?>/.exec(m[2] || "");
      return {
        fuente: Number(a.fontId || 0),
        relleno: Number(a.fillId || 0),
        borde: Number(a.borderId || 0),
        formato: Number(a.numFmtId || 0),
        alineacion: alineacion ? atributos(alineacion[1]) : {},
      };
    });
    this._css = new Map();
  }

  color(atr, defecto = null) {
    if (!atr) return defecto;
    let hex = null;
    if (atr.rgb) hex = atr.rgb.slice(-6).toUpperCase();
    else if (atr.theme !== undefined) hex = this.tema[Number(atr.theme)] ?? null;
    else if (atr.indexed !== undefined) {
      const i = Number(atr.indexed);
      hex = i === 64 ? "000000" : i === 65 ? "FFFFFF" : (this.indexados[i] ?? null);
    } else if (atr.auto) hex = "000000";
    if (!hex) return defecto;
    return aplicarTinte(hex, Number(atr.tint || 0));
  }

  _fuente(xml) {
    const val = (etiqueta) => {
      const m = new RegExp(`<${etiqueta}\\b([^>]*?)\\/?>`).exec(xml);
      return m ? atributos(m[1]) : null;
    };
    const u = val("u");
    return {
      nombre: val("name")?.val ?? "Calibri",
      tam: Number(val("sz")?.val ?? 11),
      negrita: Boolean(val("b")) && val("b").val !== "0",
      cursiva: Boolean(val("i")) && val("i").val !== "0",
      subrayado: Boolean(u) && u.val !== "none",
      tachado: Boolean(val("strike")) && val("strike").val !== "0",
      color: val("color"),
    };
  }

  _relleno(xml) {
    const patron = /<patternFill\b([^>]*?)(?:\/>|>([\s\S]*?)<\/patternFill>)/.exec(xml);
    if (!patron) return null;
    const tipo = atributos(patron[1]).patternType;
    if (!tipo || tipo === "none") return null;
    const fg = /<fgColor\b([^>]*?)\/?>/.exec(patron[2] || "");
    const bg = /<bgColor\b([^>]*?)\/?>/.exec(patron[2] || "");
    return { tipo, fg: fg ? atributos(fg[1]) : null, bg: bg ? atributos(bg[1]) : null };
  }

  _borde(xml) {
    const lado = (nombre) => {
      const m = new RegExp(`<${nombre}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${nombre}>)`).exec(xml);
      if (!m) return null;
      const estilo = atributos(m[1]).style;
      if (!estilo || !BORDES[estilo]) return null;
      const color = /<color\b([^>]*?)\/?>/.exec(m[2] || "");
      return { estilo, color: color ? atributos(color[1]) : null };
    };
    return { izq: lado("left") ?? lado("start"), der: lado("right") ?? lado("end"), sup: lado("top"), inf: lado("bottom") };
  }

  xf(indice) {
    return this.xfs[indice] ?? this.xfs[0] ?? { fuente: 0, relleno: 0, borde: 0, formato: 0, alineacion: {} };
  }

  codigoFormato(indice) {
    const id = this.xf(indice).formato;
    return this.formatos.get(id) ?? FORMATOS_INTEGRADOS[id] ?? "General";
  }

  /** Bordes de un estilo como declaraciones CSS por lado. */
  bordesCss(indice) {
    const b = this.bordes[this.xf(indice).borde] ?? {};
    const css = {};
    for (const [lado, clave] of [["izq", "border-left"], ["der", "border-right"], ["sup", "border-top"], ["inf", "border-bottom"]]) {
      if (b[lado]) css[clave] = `${BORDES[b[lado].estilo]} #${this.color(b[lado].color, "000000")}`;
    }
    return css;
  }

  /** CSS (sin bordes) de un estilo: fuente, relleno y alineación. */
  css(indice) {
    if (this._css.has(indice)) return this._css.get(indice);
    const xf = this.xf(indice);
    const f = this.fuentes[xf.fuente] ?? this.fuentes[0] ?? { nombre: "Calibri", tam: 11 };
    const css = {
      "font-family": `"${f.nombre}", Calibri, Arial, sans-serif`,
      "font-size": `${f.tam}pt`,
    };
    if (f.negrita) css["font-weight"] = "bold";
    if (f.cursiva) css["font-style"] = "italic";
    const decoracion = [f.subrayado ? "underline" : "", f.tachado ? "line-through" : ""].filter(Boolean).join(" ");
    if (decoracion) css["text-decoration"] = decoracion;
    const colorFuente = this.color(f.color);
    if (colorFuente) css.color = `#${colorFuente}`;
    const relleno = this.rellenos[xf.relleno];
    if (relleno) {
      const fondo = relleno.tipo === "solid" ? this.color(relleno.fg) : this.color(relleno.fg) ?? this.color(relleno.bg);
      if (fondo) css.background = `#${fondo}`;
    }
    const a = xf.alineacion;
    const horizontal = { center: "center", centerContinuous: "center", right: "right", left: "left", justify: "justify", distributed: "center", fill: "left" }[a.horizontal];
    if (horizontal) css["text-align"] = horizontal;
    css["vertical-align"] = { top: "top", center: "middle", justify: "middle", distributed: "middle" }[a.vertical] ?? "bottom";
    if (a.wrapText === "1" || a.wrapText === "true") css["white-space"] = "pre-wrap";
    if (a.indent) css["padding-left"] = `${Number(a.indent) * 9}px`;
    const resultado = { css, alineado: Boolean(horizontal), ajustar: css["white-space"] === "pre-wrap" };
    this._css.set(indice, resultado);
    return resultado;
  }
}

// ------------------------------------------------------------------ formato de valores

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function formatearFecha(serial, codigo) {
  const iso = isoDesdeSerial(serial);
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  const limpio = codigo.split(";")[0].replace(/\[[^\]]*\]/g, "");
  let salida = "";
  const tokens = /("[^"]*"|\\.|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|[hHsS]+|AM\/PM|.)/gi;
  for (const [t] of limpio.matchAll(tokens)) {
    const bajo = t.toLowerCase();
    if (t.startsWith('"')) salida += t.slice(1, -1);
    else if (t.startsWith("\\")) salida += t.slice(1);
    else if (bajo === "yyyy") salida += String(a);
    else if (bajo === "yy") salida += String(a).slice(-2);
    else if (bajo === "mmmmm") salida += MESES[m - 1][0];
    else if (bajo === "mmmm") salida += MESES[m - 1];
    else if (bajo === "mmm") salida += MESES[m - 1].slice(0, 3);
    else if (bajo === "mm") salida += String(m).padStart(2, "0");
    else if (bajo === "m") salida += String(m);
    else if (bajo === "dddd") salida += DIAS[diaSemana];
    else if (bajo === "ddd") salida += DIAS[diaSemana].slice(0, 3);
    else if (bajo === "dd") salida += String(d).padStart(2, "0");
    else if (bajo === "d") salida += String(d);
    else if (/^[hs]+$/i.test(t) || bajo === "am/pm") salida += "";
    else salida += t;
  }
  return salida.trim();
}

function formatearNumero(valor, codigo) {
  const seccion = codigo.split(";")[valor < 0 && codigo.includes(";") ? 1 : 0] ?? codigo;
  const limpio = seccion.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\./g, "");
  if (/General/i.test(limpio) || !/[0#?]/.test(limpio)) {
    return Number.isInteger(valor) ? String(valor) : String(Number(valor.toPrecision(10)));
  }
  const porcentaje = limpio.includes("%");
  const numero = porcentaje ? valor * 100 : valor;
  const decimales = /\.([0#?]+)/.exec(limpio)?.[1].length ?? 0;
  let texto = Math.abs(numero).toFixed(decimales);
  if (/#,##|0,0/.test(limpio)) {
    const [entero, fraccion] = texto.split(".");
    texto = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraccion ? `.${fraccion}` : "");
  }
  const signo = numero < 0 && !codigo.includes(";") ? "-" : "";
  return `${signo}${texto}${porcentaje ? "%" : ""}`;
}

/** Texto que Excel mostraría para un valor con ese código de formato. */
export function formatearValor(valor, codigo = "General") {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof FechaCelda) return formatearFecha(valor.serial, esFormatoFecha(codigo) ? codigo : "dd/mm/yyyy");
  if (typeof valor === "boolean") return valor ? "VERDADERO" : "FALSO";
  if (typeof valor === "number") return esFormatoFecha(codigo) ? formatearFecha(valor, codigo) : formatearNumero(valor, codigo);
  if (typeof valor === "object" && typeof valor.toFixed === "function") return formatearNumero(Number(valor.toFixed()), codigo);
  return String(valor);
}
