// Cantidades exactas (nunca float). En el estado se guardan como texto ("12.5").

import Big from "big.js";

Big.DP = 20;
Big.NE = -30;
Big.PE = 40;

export { Big };
export const CERO = new Big(0);

export const esDecimal = (valor) => valor instanceof Big;

// Más allá de 10^40 (o de 10^-40) no es una cantidad sino un error de captura: «1e999999» serían un millón de dígitos.
const EXPONENTE_MAXIMO = 40;

/**
 * Convierte a Big sin pasar por la imprecisión de float; null si no es número. **Nunca lanza**
 * (Ronda 37: «+5» tumbaba la página, big.js no acepta el «+»): todos los llamadores confían en el null.
 */
export function dec(valor) {
  if (valor === null || valor === undefined || typeof valor === "boolean") return null;
  if (valor instanceof Big) return valor;
  if (typeof valor === "number" && !Number.isFinite(valor)) return null;
  const texto = String(valor).trim().replace(/^\+/, "");
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(texto)) return null;
  try {
    const d = new Big(texto);
    return !d.eq(0) && Math.abs(d.e) > EXPONENTE_MAXIMO ? null : d;
  } catch {
    return null;
  }
}

/** Dígitos enteros que admite una cantidad escrita a mano (hasta 999 999 999). */
export const DIGITOS_CANTIDAD = 9;
const CANTIDAD_ESCRITA = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Cantidad escrita por una persona (vales, entradas, conteos, reacomodos): dígitos con un punto
 * decimal («2», «2.5», «+3», «.5»). null con cualquier otra cosa —notación científica («1e5»),
 * separadores de miles («1.000.5»), letras— o si pasa de 9 dígitos enteros o de 20 decimales.
 */
export function cantidadEscrita(valor) {
  if (typeof valor === "string" && !CANTIDAD_ESCRITA.test(valor.trim())) return null;
  const d = dec(valor);
  if (d === null) return null;
  const enteros = d.e + 1;
  const decimales = d.c.length - d.e - 1;
  return enteros > DIGITOS_CANTIDAD || decimales > Big.DP ? null : d;
}

/**
 * Lo que está mal en una cantidad escrita, para el mensaje: "falta" (vacía), "numero" (no es una
 * cantidad: ver `cantidadEscrita`), "cero" (0 o menos; con `ceroValido`, solo menos de 0) o null si está bien.
 */
export function problemaDeCantidad(valor, { ceroValido = false } = {}) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return "falta";
  const d = cantidadEscrita(valor);
  if (d === null) return "numero";
  return (ceroValido ? d.lt(0) : d.lte(0)) ? "cero" : null;
}

/** Texto para quien captura: «Escribe solo números (ej. 2 o 2.5).» — sin el número de partida. */
export const TEXTO_CANTIDAD_NO_NUMERO = "escribe solo números (ej. 2 o 2.5)";

/** Big → texto normalizado sin ceros sobrantes ni notación científica ("1.50" → "1.5"). */
export function decTexto(valor) {
  const d = dec(valor);
  if (d === null) return null;
  if (d.eq(0)) return "0";
  return d.toFixed();
}

export function sumar(...valores) {
  return valores.reduce((total, v) => total.plus(dec(v) ?? CERO), CERO);
}

export function iguales(a, b) {
  const x = dec(a) ?? CERO;
  const y = dec(b) ?? CERO;
  return x.eq(y);
}

/** Para mostrar en pantalla: entero si no tiene decimales. */
export function aNumero(valor) {
  const d = dec(valor);
  return d === null ? null : Number(d.toFixed());
}
