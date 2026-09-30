// Cantidades exactas (nunca float). En el estado se guardan como texto ("12.5").

import Big from "big.js";

Big.DP = 20;
Big.NE = -30;
Big.PE = 40;

export { Big };
export const CERO = new Big(0);

export const esDecimal = (valor) => valor instanceof Big;

/** Convierte a Big sin pasar por la imprecisión de float; null si no es número. */
export function dec(valor) {
  if (valor === null || valor === undefined || typeof valor === "boolean") return null;
  if (valor instanceof Big) return valor;
  if (typeof valor === "number") return Number.isFinite(valor) ? new Big(String(valor)) : null;
  const texto = String(valor).trim().replace(/_/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(texto)) return null;
  return new Big(texto);
}

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
