import { dec } from "./decimal.js";
import { unidad } from "./normalizar.js";

const IGUALES = [
  ["PZA", "PZ", "PZS", "PZAS", "PIEZA", "PIEZAS", "UN", "UND", "UNID", "UD", "UDS", "UNIDAD", "UNIDADES", "UNIT", "UNITS", "EA", "EACH", "PC", "PCS", "PIECE", "PIECES"],
  ["M", "MT", "MTS", "METRO", "METROS"], ["L", "LT", "LTS", "LITRO", "LITROS"],
  ["KG", "KGS", "KILO", "KILOS"], ["CUB", "CUBETA", "CUBETAS"], ["JGO", "JUEGO", "JUEGOS"],
  ["GAL", "GALON", "GALONES"], ["CJA", "CAJA", "CAJAS"], ["ROL", "ROLLO", "ROLLOS"],
];
export function umComparable(um) {
  const u = unidad(um);
  return IGUALES.find((g) => g.includes(u.replaceAll(".", "")))?.[0] ?? u;
}
export function unidadesCompatibles(a, b) {
  const una = umComparable(a), otra = umComparable(b);
  return !una || !otra || una === otra;
}

/** Fracción exacta: no aproximar 1/12 antes de multiplicar una cantidad. */
export function fraccionMovimiento(existencia, linea) {
  const registrada = existencia?.factores_um_vales?.[linea.id];
  if (registrada && umComparable(registrada.um) === umComparable(linea.um)) {
    return { numerador: dec(registrada.numerador), denominador: dec(registrada.denominador) };
  }
  const historial = existencia?.conversiones_um ?? [];
  let inicio = -1;
  for (let i = 0; i < historial.length; i++) if (umComparable(historial[i].desde) === umComparable(linea.um)) inicio = i;
  let numerador = dec(1), denominador = dec(1);
  if (inicio >= 0 && umComparable(linea.um) !== umComparable(historial.at(-1).hasta)) {
    for (const c of historial.slice(inicio)) {
      numerador = numerador.times(c.equivalencia.destino);
      denominador = denominador.times(c.equivalencia.origen);
    }
  }
  return { numerador, denominador };
}

/** La captura del vale permanece intacta; su cantidad se expresa en la unidad física vigente. */
export function cantidadEnInventario(existencia, linea, cantidad = linea.cantidad) {
  const d = dec(cantidad);
  if (d === null) return null;
  const f = fraccionMovimiento(existencia, linea);
  return d.times(f.numerador).div(f.denominador);
}
