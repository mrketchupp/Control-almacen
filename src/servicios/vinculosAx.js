// Vínculos de inventario por corte: sólo cambian qué variantes se comparan contra AX.
// Las existencias, dimensiones, NP, etiquetas y vales conservan sus datos.
import { auditar } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { sumar } from "../nucleo/decimal.js";
import { ErrorConciliacion, claveAx, comparar, conciliar, corteAx, dimensionAx, lineasInv, umComparable, unidadesCompatibles } from "./conciliacion.js";

const llave = (l) => `${claveAx(l)}|${umComparable(l.um)}`;
const registros = (corte, ids) => (corte.vinculos_fisicos ?? []).filter((v) => ids.includes(v.linea_ax_id));

/** Opciones del mismo código. Una variante reúne sus partidas en todos los contenedores. */
export function candidatosFisicos(r, lineaIds) {
  const lineas = r.corte.lineas.filter((l) => lineaIds.includes(l.id));
  if (!lineas.length) return [];
  const llaves = new Set(lineas.map(llave));
  return [...r.fisico.values()].filter((f) => f.variante.codigo === lineas[0].codigo).map((f) => {
    const ocupada = r.pares.find((p) => p.confirmado && p.variante_id !== null &&
      !lineaIds.includes(p.linea.id) && !llaves.has(llave(p.linea)) && (p.grupo ?? [p.variante_id]).includes(f.variante.id));
    return { ...f, ocupada: ocupada?.linea ?? null, compatible: lineas.every((l) => unidadesCompatibles(l.um, f.variante.um)) };
  }).sort((a, b) => String(a.variante.dimension ?? "").localeCompare(String(b.variante.dimension ?? ""), "es", { numeric: true }) ||
    String(a.variante.np ?? "").localeCompare(String(b.variante.np ?? ""), "es", { numeric: true }));
}

function destino(estado, corteId, lineaIds) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  const ids = [...new Set(lineaIds ?? [])];
  const lineas = lineasInv(corte).filter((l) => ids.includes(l.id));
  if (!ids.length || lineas.length !== ids.length) throw new ErrorConciliacion("Elige una partida INV de este corte de AX.");
  if (lineas.some((l) => l.codigo !== lineas[0].codigo)) throw new ErrorConciliacion("Las partidas de AX deben ser del mismo código.");
  if (lineas.some((l) => llave(l) !== llave(lineas[0]))) throw new ErrorConciliacion("Revisa cada dimensión de AX por separado.");
  return { corte, ids, lineas };
}

/** Recalcula el resultado de la selección sin guardar: incluye también los vales en tránsito. */
export function previaVinculoFisico(estado, { corteId, lineaIds, varianteIds }) {
  const { corte, ids } = destino(estado, corteId, lineaIds);
  const simulado = { ...corte, vinculos_fisicos: [
    ...(corte.vinculos_fisicos ?? []).filter((v) => !ids.includes(v.linea_ax_id)),
    ...ids.map((id) => ({ linea_ax_id: id, variante_ids: varianteIds })),
  ] };
  return resultadoLineasAx(conciliar(estado, simulado), ids);
}

/** Resultado conjunto de las partidas elegidas, con el tránsito sin duplicar el físico. */
export function resultadoLineasAx(r, ids) {
  if (r.porConfirmar.some((p) => ids.includes(p.linea.id))) return null;
  const filas = [...r.renglones.filter((f) => f.lineas.some((l) => ids.includes(l.id))), ...r.axSinFisico.filter((f) => ids.includes(f.linea.id))];
  return comparar({ ax: sumar(...filas.map((f) => f.ax)), valorAx: null, fisico: sumar(...filas.map((f) => f.fisico)),
    transito: { salidas: sumar(...filas.map((f) => f.salidas)), entradas: sumar(...filas.map((f) => f.entradas)),
      folios: [...new Set(filas.flatMap((f) => f.folios))] } });
}

function aplicar(estado, corte, ids, nuevos, usuario, accion) {
  const antes = structuredClone(registros(corte, ids));
  corte.vinculos_fisicos = [...(corte.vinculos_fisicos ?? []).filter((v) => !ids.includes(v.linea_ax_id)), ...nuevos];
  const despues = structuredClone(registros(corte, ids));
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion, antes: { vinculos: antes }, despues: { vinculos: despues } });
  return { lineaIds: ids, antes, despues };
}

/** Confirma la selección completa para una o varias partidas de AX de la misma fila. */
export function vincularFisico(estado, { corteId, lineaIds, varianteIds }, usuario = null) {
  const { corte, ids, lineas } = destino(estado, corteId, lineaIds);
  if (!Array.isArray(varianteIds)) throw new ErrorConciliacion("Falta la selección del inventario.");
  const seleccion = [...new Set(varianteIds)];
  const candidatos = candidatosFisicos(conciliar(estado, corte), ids);
  for (const id of seleccion) {
    const f = candidatos.find((f) => f.variante.id === id);
    if (!f) throw new ErrorConciliacion("Esa partida ya no existe en el inventario de este código.");
    if (!f.compatible) throw new ErrorConciliacion("No se pueden sumar cantidades con unidades de medida distintas.");
    if (f.ocupada) throw new ErrorConciliacion(`Esa partida ya corresponde a ${f.ocupada.codigo} ${dimensionAx(f.ocupada) || "SIN DIMENSIÓN"} en AX.`);
  }
  const fecha = ahoraIso();
  const nuevos = lineas.map((l) => ({ linea_ax_id: l.id, variante_ids: seleccion, fecha_hora: fecha, usuario }));
  return aplicar(estado, corte, ids, nuevos, usuario, "VINCULAR_FISICO_AX");
}

/** Retira el vínculo manual y deja que el emparejamiento automático vuelva a decidir. */
export function quitarVinculosFisicos(estado, { corteId, lineaIds }, usuario = null) {
  const { corte, ids } = destino(estado, corteId, lineaIds);
  return aplicar(estado, corte, ids, [], usuario, "QUITAR_VINCULO_FISICO_AX");
}

/** Deshacer sólo si el vínculo sigue como lo dejó esta acción. */
export function deshacerVinculoFisico(estado, { corteId, cambio }, usuario = null) {
  const { corte, ids } = destino(estado, corteId, cambio.lineaIds);
  if (JSON.stringify(registros(corte, ids)) !== JSON.stringify(cambio.despues)) {
    throw new ErrorConciliacion("Ese vínculo cambió después. Revisa la selección actual del inventario.");
  }
  return aplicar(estado, corte, ids, structuredClone(cambio.antes), usuario, "DESHACER_VINCULO_FISICO_AX");
}
