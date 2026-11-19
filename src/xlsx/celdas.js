// Referencias de celda: 'AB12' ↔ { columna: 28, fila: 12 }.

export function letraColumna(indice) {
  let letras = "";
  while (indice > 0) {
    const resto = (indice - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    indice = Math.floor((indice - 1) / 26);
  }
  return letras;
}

export function indiceColumna(letras) {
  let valor = 0;
  for (const letra of letras.toUpperCase()) valor = valor * 26 + letra.charCodeAt(0) - 64;
  return valor;
}

export function separarReferencia(referencia) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(referencia);
  if (!m) throw new Error(`Referencia inválida: ${referencia}`);
  return { letras: m[1].toUpperCase(), columna: indiceColumna(m[1]), fila: Number(m[2]) };
}

/** 'A1:J105' → { inicio: {…}, fin: {…} } */
export function separarRango(rango) {
  const [a, b] = rango.split(":");
  return { inicio: separarReferencia(a), fin: separarReferencia(b || a) };
}

/** 'DIARIO!$A$1:$T$1293' → 'DIARIO!$A$1:$T$<ultima>'; 'A1:J104' → 'A1:J<ultima>'. */
export function cambiarUltimaFila(rango, ultima) {
  return rango.replace(/(\$?[A-Z]{1,3}\$?)(\d+)$/, (_, c) => `${c}${ultima}`);
}

const REFERENCIA = /(?<![A-Za-z0-9_$.[\]])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_([])/g;

/**
 * Copia una fórmula a otra fila, como Excel: mueve solo las filas relativas.
 * Respeta textos entre comillas y referencias estructuradas de tabla.
 */
export function desplazarFormula(formula, deltaFilas) {
  if (!deltaFilas) return formula;
  const partes = formula.split('"');
  for (let i = 0; i < partes.length; i += 2) {
    partes[i] = partes[i].replace(REFERENCIA, (todo, d1, col, d2, fila) =>
      d2 ? todo : `${d1}${col}${Number(fila) + deltaFilas}`,
    );
  }
  return partes.join('"');
}

/** Igual que desplazarFormula pero también mueve columnas relativas (fórmulas compartidas). */
export function desplazarFormula2D(formula, deltaFilas, deltaColumnas) {
  if (!deltaFilas && !deltaColumnas) return formula;
  const partes = formula.split('"');
  for (let i = 0; i < partes.length; i += 2) {
    partes[i] = partes[i].replace(REFERENCIA, (todo, d1, col, d2, fila) => {
      const nuevaCol = d1 ? col : letraColumna(indiceColumna(col) + deltaColumnas);
      const nuevaFila = d2 ? fila : String(Number(fila) + deltaFilas);
      return `${d1}${nuevaCol}${d2}${nuevaFila}`;
    });
  }
  return partes.join('"');
}

/**
 * Cómo cambian las filas de una hoja cuando sus filas de datos (`desde`..`hasta`) pasan a terminar en `nuevoHasta`
 * (como Excel al insertar o borrar filas dentro de una tabla): lo de arriba no se mueve, lo de abajo se recorre y lo
 * de adentro se queda (sin pasar de la nueva última); el final de un rango que llegaba a la última fila de datos
 * llega a la nueva. @returns (fila, esFinDeRango) => fila nueva
 */
export function mapaDeFilas(desde, hasta, nuevoHasta) {
  const delta = nuevoHasta - hasta;
  return (fila, esFin = false) => {
    if (fila < desde) return fila;
    if (fila > hasta) return fila + delta;
    return esFin && fila === hasta ? nuevoHasta : Math.min(fila, nuevoHasta);
  };
}

// Una referencia (A1, $B$7) o un rango (A1:B7) de ESTA hoja: no las de otra hoja (Hoja!A1, 'Mi hoja'!A1), ni las de
// tablas (Tabla1[…]), ni nombres o funciones (LOG10(, INV2026_X).
const REF_O_RANGO = /(?<![A-Za-z0-9_$.[\]!':])(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_([!])/g;

/**
 * Reubica las referencias de una fórmula (o de un sqref como "A2:J150 L5") con `mapa` (mapaDeFilas): a diferencia de
 * copiar (desplazarFormula), al insertar o borrar filas Excel también mueve las absolutas. Respeta los "textos".
 */
export function reubicarReferencias(texto, mapa) {
  const partes = String(texto).split('"');
  for (let i = 0; i < partes.length; i += 2) {
    partes[i] = partes[i].replace(REF_O_RANGO, (todo, d1, c1, d2, f1, d3, c2, d4, f2) => {
      if (f2 === undefined) return `${d1}${c1}${d2}${mapa(Number(f1))}`;
      const inicio = mapa(Number(f1));
      const fin = Math.max(inicio, mapa(Number(f2), true));
      return `${d1}${c1}${d2}${inicio}:${d3}${c2}${d4}${fin}`;
    });
  }
  return partes.join('"');
}
