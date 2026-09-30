// Artículos y variantes: altas, búsquedas y parecidos.

import { ratio } from "./difflib.js";
import { claveEstricta, sinAcentos } from "./normalizar.js";

// Prefijos que en la columna CLAVE del DIARIO acompañan a la dimensión real.
const RUIDO_CLAVE = /^\s*(S\/D|S\/N|SIN\s+DIMENSI[OÓ]N|SIN\s+DIMENCION)\b\s*/i;
const PREFIJO_NP = /\bN\.?P\.?\s*:?\s*/gi;

/**
 * Claves con las que un texto de CLAVE/dimensión puede corresponder a una variante.
 * 'S/D NP: 1/4"' → {'1/4"'}; '6309-2Z/C3' → {'63092Z/C3'}.
 */
export function clavesDeBusqueda(texto) {
  if (!texto) return new Set();
  const claves = new Set([claveEstricta(texto)]);
  const limpio = texto.replace(RUIDO_CLAVE, "").replace(PREFIJO_NP, "");
  claves.add(claveEstricta(limpio));
  claves.delete("");
  return claves;
}

/** True si cada palabra de `texto` se parece a alguna de `referencia` (GRSA ~ GRASA). */
export function esErrorDeDedo(texto, referencia) {
  if (!texto || !referencia) return false;
  const palabrasRef = sinAcentos(referencia.toUpperCase()).match(/[A-Z0-9]+/g) || [];
  const palabras = sinAcentos(texto.toUpperCase()).match(/[A-Z0-9]{4,}/g) || [];
  if (!palabras.length) return false;
  return palabras.every((p) => palabrasRef.some((r) => ratio(p, r) >= 0.8));
}

export function hayInterseccion(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}
