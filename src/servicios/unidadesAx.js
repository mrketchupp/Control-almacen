import { dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { cantidadEnInventario, fraccionMovimiento, umComparable } from "../nucleo/unidades.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { ErrorCorreccion } from "./inventario.js";

export function equivalenciaUnidad(datos) {
  const origen = dec(String(datos?.origen ?? "").replace(",", ".")), destino = dec(String(datos?.destino ?? "").replace(",", "."));
  if (!origen || !destino || origen.lte(0) || destino.lte(0)) throw new ErrorCorreccion("Indica una equivalencia mayor que cero para cada unidad que se corregirá. Si sólo estaba mal anotada, usa 1 = 1.");
  return { origen: decTexto(origen), destino: decTexto(destino) };
}

/** Cambia la unidad y expresa conteo y movimientos en AX. Los vales y sus cantidades originales no se editan. */
export function corregirUnidadInventario(estado, { existenciaId, um, equivalencia }, usuario = null) {
  const indices = new Indices(estado), e = indices.existencia(existenciaId), v = e && indices.variante(e.variante_id);
  if (!v) throw new ErrorCorreccion("Esa partida ya no existe.");
  const hasta = String(um ?? "").trim(), desde = umMostrada(e, v) || "";
  if (!hasta) throw new ErrorCorreccion("AX no indica la unidad de destino.");
  const eq = equivalenciaUnidad(equivalencia);
  const cambia = desde !== hasta || !dec(eq.origen).eq(eq.destino);
  if (!cambia) return false;
  e.factores_um_vales ??= {};
  for (const vale of estado.vales) for (const l of vale.lineas) {
    if (l.existencia_id !== e.id) continue;
    const f = fraccionMovimiento(e, l);
    e.factores_um_vales[l.id] = { um: l.um ?? "", numerador: decTexto(f.numerador.times(eq.destino)), denominador: decTexto(f.denominador.times(eq.origen)) };
  }
  const anterior = { um: desde, cantidad_conteo: e.cantidad_conteo, variante_id: v.id };
  e.cantidad_conteo = decTexto(dec(e.cantidad_conteo).times(eq.destino).div(eq.origen));
  const destino = indices.obtenerOCrearVariante(v.codigo, dimensionMostrada(e, v), npMostrado(e, v), hasta);
  destino.activo = true;
  delete destino.unida_a;
  destino.claves_anteriores = [...new Set([...(destino.claves_anteriores ?? []), ...(v.claves_anteriores ?? [])])];
  e.variante_id = destino.id;
  delete e.um_hoja; delete e.dimension_hoja; delete e.np_hoja;
  (e.conversiones_um ??= []).push({ desde, hasta, equivalencia: eq, fecha_hora: ahoraIso(), usuario });
  if (destino.id !== v.id && !estado.existencias.some((x) => x.variante_id === v.id)) { v.activo = false; v.unida_a = destino.id; }
  auditar(estado, { usuario, entidad: "existencia", entidadId: e.id, accion: "CORREGIR_UNIDAD_AX", antes: anterior,
    despues: { um: hasta, cantidad_conteo: e.cantidad_conteo, variante_id: destino.id, equivalencia: eq } });
  return true;
}

/** Cantidad actual de una partida del vale, usada en la solicitud y al elegir justificantes. */
export function cantidadActualDeVale(estado, linea, cantidad = linea.cantidad) {
  return cantidadEnInventario(estado.existencias.find((e) => e.id === linea.existencia_id), linea, cantidad);
}

/** Un vale migrado puede carecer de existencia: sólo usar una equivalencia inequívoca del destino. */
export function existenciaParaConversion(estado, linea, varianteIds) {
  const ligada = estado.existencias.find((e) => e.id === linea.existencia_id);
  if (ligada) return ligada;
  const indices = new Indices(estado), um = umComparable(linea.um);
  const opciones = estado.existencias.filter((e) => e.activo !== false && varianteIds.includes(e.variante_id));
  if (!opciones.some((e) => e.conversiones_um?.length)) return null;
  const conocidas = opciones.filter((e) => umComparable(umMostrada(e, indices.variante(e.variante_id))) === um ||
    e.conversiones_um?.some((c) => umComparable(c.desde) === um));
  if (!conocidas.length) throw new ErrorCorreccion("La unidad del vale no tiene una equivalencia guardada con las partidas elegidas.");
  const f = fraccionMovimiento(conocidas[0], linea);
  if (conocidas.some((e) => {
    const otra = fraccionMovimiento(e, linea);
    return !f.numerador.times(otra.denominador).eq(otra.numerador.times(f.denominador)) ||
      umComparable(umMostrada(e, indices.variante(e.variante_id))) !== umComparable(umMostrada(conocidas[0], indices.variante(conocidas[0].variante_id)));
  })) throw new ErrorCorreccion("Ese vale puede corresponder a equivalencias distintas. Vincula su partida de inventario antes de asignarlo.");
  return conocidas[0];
}
