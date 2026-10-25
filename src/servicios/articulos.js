// Catálogo de artículos: corregir la descripción de un código que ya existe.
//
// La descripción del catálogo es la que se copia a la partida al elegir el código, la que muestra el inventario,
// la que proponen las etiquetas nuevas y la que se exporta a ARTICULOS_MX. Los vales emitidos no cambian: cada
// partida guarda su texto y se corrige desde el historial. Las partidas de los borradores abiertos que seguían
// la descripción anterior pasan a la nueva.

import { auditar } from "../nucleo/estado.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

export class ErrorArticulo extends Error {}

/** La descripción como se guarda: sin espacios sobrantes y en MAYÚSCULAS, igual que la de un código nuevo. */
export const descripcionLimpia = (v) => texto(v).toUpperCase();

/** Partidas de los borradores (salida, entrada y conteo) que traen el texto de la descripción anterior del código. */
function partidasQueLaSiguen(estado, codigo, antes) {
  const anterior = descripcionLimpia(antes);
  return [
    ...(estado.borradores ?? []).flatMap((b) => b.lineas ?? []),
    ...(estado.borradores_entrada ?? []).flatMap((b) => b.lineas ?? []),
    ...(estado.conteo_en_curso?.nuevos ?? []),
  ].filter((l) => l.codigo === codigo && descripcionLimpia(l.descripcion) === anterior);
}

/**
 * Cambia la descripción de un código del catálogo y lo deja en la bitácora (antes → después).
 * @returns {{ articulo, antes, despues, partidas }}  partidas: las de borradores que se actualizaron con ella
 */
export function corregirDescripcion(estado, codigo, descripcion, { usuario = null, motivo = "" } = {}) {
  const articulo = Number.isInteger(codigo) ? estado.articulos[codigo] : null;
  if (!articulo) throw new ErrorArticulo("Ese código ya no está en el catálogo.");
  const despues = descripcionLimpia(descripcion);
  if (!despues) throw new ErrorArticulo("Escribe la descripción del código.");
  const antes = articulo.descripcion;
  if (despues === antes) throw new ErrorArticulo("La descripción ya está así.");
  const partidas = partidasQueLaSiguen(estado, codigo, antes);
  for (const partida of partidas) partida.descripcion = despues;
  articulo.descripcion = despues;
  auditar(estado, {
    usuario,
    entidad: "articulo",
    entidadId: codigo,
    accion: "CORREGIR_DESCRIPCION",
    antes: { descripcion: antes },
    despues: { descripcion: despues, motivo: texto(motivo) || null, borradores: partidas.length },
  });
  return { articulo, antes, despues, partidas: partidas.length };
}

/** Bitácora de las descripciones corregidas de un código, de la más reciente a la más antigua. */
export function bitacoraDeDescripcion(estado, codigo) {
  return estado.auditoria
    .filter((a) => a.entidad === "articulo" && a.accion === "CORREGIR_DESCRIPCION" && a.entidad_id === String(codigo))
    .reverse();
}
