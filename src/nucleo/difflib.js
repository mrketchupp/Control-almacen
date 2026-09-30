// Port de difflib.SequenceMatcher(None, a, b).ratio() de Python (con autojunk),
// para que las sugerencias coincidan con las de la versión anterior.

function b2jDe(b) {
  const b2j = new Map();
  b.forEach((elemento, i) => {
    if (!b2j.has(elemento)) b2j.set(elemento, []);
    b2j.get(elemento).push(i);
  });
  const n = b.length;
  if (n >= 200) {
    const limite = Math.floor(n / 100) + 1;
    for (const [elemento, indices] of [...b2j]) if (indices.length > limite) b2j.delete(elemento);
  }
  return b2j;
}

function masLarga(a, b, b2j, alo, ahi, blo, bhi) {
  let mejorI = alo;
  let mejorJ = blo;
  let mejor = 0;
  let j2len = new Map();
  for (let i = alo; i < ahi; i++) {
    const nuevo = new Map();
    for (const j of b2j.get(a[i]) || []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      nuevo.set(j, k);
      if (k > mejor) {
        mejorI = i - k + 1;
        mejorJ = j - k + 1;
        mejor = k;
      }
    }
    j2len = nuevo;
  }
  while (mejorI > alo && mejorJ > blo && a[mejorI - 1] === b[mejorJ - 1]) {
    mejorI--;
    mejorJ--;
    mejor++;
  }
  while (mejorI + mejor < ahi && mejorJ + mejor < bhi && a[mejorI + mejor] === b[mejorJ + mejor]) mejor++;
  return [mejorI, mejorJ, mejor];
}

export function ratio(textoA, textoB) {
  const a = Array.from(textoA);
  const b = Array.from(textoB);
  const total = a.length + b.length;
  if (!total) return 1;
  const b2j = b2jDe(b);
  const cola = [[0, a.length, 0, b.length]];
  let coincidencias = 0;
  while (cola.length) {
    const [alo, ahi, blo, bhi] = cola.pop();
    const [i, j, k] = masLarga(a, b, b2j, alo, ahi, blo, bhi);
    if (k) {
      coincidencias += k;
      if (alo < i && blo < j) cola.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) cola.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * coincidencias) / total;
}
