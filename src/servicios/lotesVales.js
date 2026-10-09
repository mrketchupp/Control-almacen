/** Resuelve una lista pegada de folios de salida, sin depender de los filtros del historial. */
export function resolverLoteVales(estado, texto) {
  const porFolio = new Map(estado.vales.filter((v) => v.tipo === "SALIDA").map((v) => [v.folio, v]));
  const vales = [];
  const faltantes = [];
  const invalidos = new Set();
  const repetidos = new Set();
  const vistos = new Set();
  for (const escrito of texto.trim().split(/[\s,;]+/u).filter(Boolean)) {
    const folio = Number(escrito);
    if (!/^\d+$/.test(escrito) || !Number.isSafeInteger(folio) || folio <= 0) {
      invalidos.add(escrito);
      continue;
    }
    if (vistos.has(folio)) {
      repetidos.add(folio);
      continue;
    }
    vistos.add(folio);
    const vale = porFolio.get(folio);
    if (vale) vales.push(vale);
    else faltantes.push(folio);
  }
  return {
    vales,
    faltantes,
    invalidos: [...invalidos],
    repetidos: [...repetidos],
    cancelados: vales.filter((v) => v.estado === "CANCELADO").map((v) => v.folio),
  };
}
