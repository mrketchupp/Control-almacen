// Reglas de normalización de texto, códigos, unidades y cantidades.
// Ver docs/04-modelo-de-datos.md, sección "Reglas de normalización".

import { Big, dec, decTexto } from "./decimal.js";
import { FechaCelda, isoDesdePartes, isoDesdeSerial } from "./fechas.js";

export const ERRORES_EXCEL = new Set([
  "#REF!", "#N/A", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#SPILL!", "#CALC!",
]);

// Valores que en la práctica significan "sin dimensión" / "sin número".
const SIN_VALOR = new Set(["SD", "SN", "SNP", "SINDIMENSION", "SINDIMENCION", "SINNUMERO", "NA", "0"]);
const COMILLAS = { "”": '"', "“": '"', "″": '"', "´": "'", "’": "'", "‘": "'" };
const NUMERO_EXCEL = /^(0|[1-9]\d*)(\.\d+)?$/;
const CANTIDAD_INICIAL = /^\s*(\d+(?:[.,]\d+)?)\s*(.*)$/;

export function esErrorExcel(valor) {
  return typeof valor === "string" && ERRORES_EXCEL.has(valor.trim().toUpperCase());
}

export function sinAcentos(texto) {
  return texto.normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * Texto limpio de una celda: solo se quitan espacios de los extremos (AX usa dobles
 * espacios en descripciones). Los errores de Excel y las celdas vacías devuelven null.
 */
export function valorATexto(valor) {
  if (valor === null || valor === undefined || esErrorExcel(valor)) return null;
  if (typeof valor === "boolean") return valor ? "SI" : "NO";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : null;
  if (valor instanceof Big) return decTexto(valor);
  if (valor instanceof FechaCelda) return isoDesdeSerial(valor.serial);
  const texto = String(valor).trim();
  return texto || null;
}

export function mayusculas(valor) {
  const texto = valorATexto(valor);
  return texto ? texto.toUpperCase() : null;
}

/** Mayúsculas, comillas uniformes y un solo espacio entre palabras (para comparar). */
export function compactar(valor) {
  const texto = mayusculas(valor);
  if (!texto) return null;
  return texto.replace(/[”“″´’‘]/g, (c) => COMILLAS[c]).replace(/\s+/g, " ");
}

/**
 * Clave para unicidad de dimensión/NP: mayúsculas, sin acentos, sin espacios, guiones,
 * puntos ni comas. Conserva "/" y comillas para no confundir 1/2" con 12.
 */
export function claveEstricta(valor) {
  let texto = compactar(valor);
  if (!texto) return "";
  texto = sinAcentos(texto).replace(/[\s\-._,:;]/g, "");
  if (texto.startsWith("NP") && texto.length > 2) texto = texto.slice(2);
  return SIN_VALOR.has(texto.replaceAll("/", "")) ? "" : texto;
}

/**
 * ¿No tiene dimensión? Vacía, "S/D", "SIN DIMENSIÓN" (o "SIN DIMENCION"), "S/N", "N/A"… o un texto que
 * empieza así ("S/D NP: 1/4\"", "S/D CABLE UTP"): lo que sigue es NP o descripción, no la dimensión.
 */
export function sinDimension(valor) {
  if (claveEstricta(valor) === "") return true;
  const texto = sinAcentos(compactar(valor) ?? "");
  return /^(S\/D|S\/N|SIN DIMENSION|SIN DIMENCION)(\s|:|$)/.test(texto);
}

/** Solo letras y dígitos. Se usa para SUGERIR parejas, nunca para fusionar. */
export function claveLaxa(valor) {
  const texto = mayusculas(valor);
  if (!texto) return "";
  return sinAcentos(texto).replace(/[^A-Z0-9]/g, "");
}

/** '000000670' → 670. null si no es un código válido. */
export function codigoAx(valor) {
  if (valor === null || valor === undefined || esErrorExcel(valor) || typeof valor === "boolean") return null;
  if (valor instanceof FechaCelda) return null;
  if (typeof valor === "number") return Number.isInteger(valor) ? valor : null;
  if (valor instanceof Big) return valor.round(0, Big.roundDown).eq(valor) ? Number(valor.toFixed()) : null;
  const texto = String(valor).trim();
  return /^\d+$/.test(texto) ? Number.parseInt(texto, 10) : null;
}

/** Unidad de medida en mayúsculas y sin espacios ('PZ A' → 'PZA'). */
export function unidad(valor) {
  const texto = mayusculas(valor);
  return texto ? texto.replace(/\s+/g, "") : "";
}

export function nombrePersona(valor) {
  const texto = compactar(valor);
  return !texto || texto === "0" ? null : texto;
}

/** Convierte a decimal exacto; null si no es número. */
export function decimal(valor) {
  if (valor instanceof FechaCelda || esErrorExcel(valor)) return null;
  return dec(valor);
}

/** [cantidad, resto]: '15LTS' → [15, 'LTS']; 3 → [3, null]. */
export function separarCantidad(valor) {
  if (valor === null || valor === undefined || esErrorExcel(valor) || typeof valor === "boolean") return [null, null];
  if (typeof valor === "number" || valor instanceof Big) return [dec(valor), null];
  const texto = valor instanceof FechaCelda ? `${isoDesdeSerial(valor.serial)} 00:00:00` : String(valor);
  const m = CANTIDAD_INICIAL.exec(texto);
  if (!m) return [null, valorATexto(valor)];
  return [new Big(m[1].replace(",", ".")), m[2].trim() || null];
}

/**
 * Para exportar a Excel: '126649' → número; '5.5' → número; otros quedan como texto.
 * Los textos con cero inicial ('0509') se conservan como texto. Se devuelve Big para
 * escribir los dígitos exactos.
 */
export function textoONumero(texto) {
  if (texto === null || texto === undefined || !NUMERO_EXCEL.test(texto)) return texto ?? null;
  return new Big(texto);
}

function anio2(y) {
  const n = Number(y);
  return n < 69 ? 2000 + n : 1900 + n;
}

/** Fecha ISO desde celda: fecha de Excel, número de serie o texto dd/mm/aaaa. */
export function fecha(valor) {
  if (valor === null || valor === undefined || esErrorExcel(valor) || typeof valor === "boolean") return null;
  if (valor instanceof FechaCelda) return isoDesdeSerial(valor.serial);
  if (typeof valor === "number") return isoDesdeSerial(valor);
  if (valor instanceof Big) return isoDesdeSerial(Number(valor.toFixed()));
  const texto = String(valor).trim();
  let m;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto))) return isoDesdePartes(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(texto))) return isoDesdePartes(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto))) return isoDesdePartes(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(texto))) return isoDesdePartes(anio2(m[3]), +m[2], +m[1]);
  return null;
}

/** Representación al estilo Python (para notas de auditoría): 'texto' o número. */
export function repr(valor) {
  if (valor === null || valor === undefined) return "None";
  if (typeof valor === "string") {
    if (valor.includes("'") && !valor.includes('"')) return `"${valor}"`;
    return `'${valor.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  }
  if (valor instanceof FechaCelda) return isoDesdeSerial(valor.serial);
  return String(valor);
}
