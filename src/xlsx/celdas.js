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
