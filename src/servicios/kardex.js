// ¿De qué inventario es cada hoja de un reporte de AX? (Ronda 20). El Kardex de auditoría trae en el
// mismo libro una hoja por inventario (FX, GSM y la de DLTA, que no dice su nombre), y DLTA y GSM usan
// códigos distintos: un reporte equivocado casi no tiene códigos del inventario abierto. Antes de
// importar se revisa el nombre de la hoja (o del almacén) y cuántos de sus códigos están en el inventario.

import { DUENO_FX, diceFx, duenoDe, inventarioDe, inventarioDelNombre } from "../nucleo/inventarios.js";

/** Menos de esta proporción de códigos conocidos = parece de otro inventario. */
export const COINCIDENCIA_MINIMA = 0.5;

/** Códigos con alguna partida (activa) en el inventario; con `dueno` (null o "FX"), solo las de ese dueño. */
export function codigosDelInventario(estado, { dueno } = {}) {
  const variantes = new Map(estado.variantes.map((v) => [v.id, v]));
  const codigos = new Set();
  for (const e of estado.existencias) {
    if (e.activo === false || (dueno !== undefined && duenoDe(e) !== dueno)) continue;
    const v = variantes.get(e.variante_id);
    if (v) codigos.add(v.codigo);
  }
  return codigos;
}

/**
 * Cuántos códigos de las partidas de AX están en el inventario.
 * @returns {{ codigos, conocidos, proporcion, ajenos: [código…] (los primeros 8 que no están) }}
 */
export function coincidencia(renglones, codigos) {
  const distintos = [...new Set(renglones.map((r) => r.codigo))];
  const ajenos = distintos.filter((c) => !codigos.has(c));
  const conocidos = distintos.length - ajenos.length;
  return { codigos: distintos.length, conocidos, proporcion: distintos.length ? conocidos / distintos.length : 0, ajenos: ajenos.slice(0, 8) };
}

/** El almacén que más se repite en la hoja. */
function almacenPrincipal(tabla) {
  return tabla.almacenes?.[0]?.nombre ?? "";
}

/** De quién dice ser la hoja por su nombre o su almacén: "FX", "DLTA", "GSM" o null. */
export function marcaDeHoja(tabla) {
  if (diceFx(tabla.hoja) || diceFx(almacenPrincipal(tabla))) return DUENO_FX;
  return inventarioDelNombre(tabla.hoja);
}

/**
 * Para qué sirve cada hoja en el inventario abierto.
 *  uso "propio": es de este inventario (la que dice su nombre o, si ninguna lo dice, la que no dice
 *    nombre y tiene más códigos conocidos); "FX": la de FX, en GSM; null: no se usa (de otro inventario).
 *  aviso: la hoja se usaría pero casi no tiene códigos del inventario (¿es el archivo equivocado?).
 * @returns [{ tabla, hoja, marca, coincidencia, uso, motivo, aviso }] en el orden del libro
 */
export function clasificarHojas(estado, tablas) {
  const inv = inventarioDe(estado).id;
  const codigos = codigosDelInventario(estado);
  const hojas = tablas.map((tabla) => ({ tabla, hoja: tabla.hoja, marca: marcaDeHoja(tabla), coincidencia: coincidencia(tabla.renglones, codigos), uso: null, motivo: "", aviso: false }));
  for (const h of hojas) {
    if (h.marca === DUENO_FX) {
      if (inv === "GSM") h.uso = DUENO_FX;
      else h.motivo = "FX se lleva dentro de GSM";
    } else if (h.marca === inv) h.uso = "propio";
    else if (h.marca) h.motivo = `Es de ${h.marca}`;
  }
  const sinNombre = hojas.filter((h) => !h.marca);
  if (!hojas.some((h) => h.uso === "propio")) {
    const mejor = [...sinNombre].sort((a, b) => b.coincidencia.proporcion - a.coincidencia.proporcion)[0];
    if (mejor && mejor.coincidencia.proporcion >= COINCIDENCIA_MINIMA) mejor.uso = "propio";
  }
  for (const h of sinNombre) {
    if (h.uso) continue;
    h.motivo = hojas.some((x) => x.uso === "propio") ? `Ya se usa la hoja ${hojas.find((x) => x.uso === "propio").hoja}` : textoCoincidencia(h.coincidencia, inv);
  }
  for (const h of hojas) h.aviso = Boolean(h.uso) && h.coincidencia.proporcion < COINCIDENCIA_MINIMA;
  return hojas;
}

/** "Solo 1 de los 100 códigos está en tu inventario DLTA". */
export function textoCoincidencia(c, inv) {
  if (!c.codigos) return "No trae partidas.";
  if (!c.conocidos) return `Ninguno de sus ${c.codigos} códigos está en tu inventario ${inv}`;
  if (c.conocidos === c.codigos) return `Sus ${c.codigos} códigos están en tu inventario ${inv}`;
  return `Solo ${c.conocidos} de sus ${c.codigos} códigos ${c.conocidos === 1 ? "está" : "están"} en tu inventario ${inv}`;
}

/**
 * La hoja de un reporte de AX que se concilia en el inventario abierto (Conciliación AX): la "propia";
 * si ninguna lo es, la de más códigos conocidos, con aviso. FX no se concilia todavía.
 * @returns {{ tabla, hoja, coincidencia, aviso, hojas }}
 */
export function hojaParaConciliar(estado, reporte) {
  const hojas = clasificarHojas(estado, reporte.tablas ?? [reporte]);
  const propia = hojas.find((h) => h.uso === "propio");
  const elegida = propia ?? [...hojas].filter((h) => h.marca !== DUENO_FX).sort((a, b) => b.coincidencia.proporcion - a.coincidencia.proporcion)[0] ?? hojas[0];
  return { ...elegida, aviso: elegida.coincidencia.proporcion < COINCIDENCIA_MINIMA, hojas };
}
