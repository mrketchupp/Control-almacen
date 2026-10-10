import { auditar } from "../nucleo/estado.js";
import { ErrorCorreccion } from "./inventario.js";
import { quitarEtiquetas } from "./etiquetas.js";

/** Datos necesarios para revertir claves, unidades y decisiones AX sin reescribir vales. */
export function datosCorreccion(e) {
  return structuredClone({ variantes: e.variantes,
    existencias: e.existencias.map((x) => ({ id: x.id, variante_id: x.variante_id, dimension_hoja: x.dimension_hoja, np_hoja: x.np_hoja,
      um_hoja: x.um_hoja, cantidad_conteo: x.cantidad_conteo, conteo_id: x.conteo_id, conversiones_um: x.conversiones_um, factores_um_vales: x.factores_um_vales })),
    movimientos: e.vales.flatMap((v) => v.lineas.map((l) => ({ id: l.id, existencia_id: l.existencia_id, cantidad: l.cantidad, um: l.um, estado: v.estado }))),
    equivalencias: e.equivalencias_ax ?? {},
    cortes: (e.cortes_ax ?? []).map((c) => ({ id: c.id, sin_pareja: c.sin_pareja ?? [], vinculos_fisicos: c.vinculos_fisicos ?? [] })),
    etiquetas: e.etiquetas?.material ?? [],
  });
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diferencias(antes, despues, clave = "id") {
  const a = new Map(antes.map((x) => [x[clave], x])), b = new Map(despues.map((x) => [x[clave], x]));
  return [...new Set([...a.keys(), ...b.keys()])].filter((id) => !igual(a.get(id), b.get(id))).map((id) => ({ id, antes: a.get(id), despues: b.get(id) }));
}

/** Revierte únicamente lo que cambió la acción y se niega a pisar una edición posterior. */
export function deshacerCorreccion(e, antes, despues, usuario = null) {
  const actual = datosCorreccion(e);
  const grupos = ["variantes", "existencias", "cortes", "etiquetas"];
  const cambios = Object.fromEntries(grupos.map((g) => [g, diferencias(antes[g], despues[g])]));
  const eq = [...new Set([...Object.keys(antes.equivalencias), ...Object.keys(despues.equivalencias)])]
    .filter((k) => !igual(antes.equivalencias[k], despues.equivalencias[k]));
  for (const g of grupos) for (const c of cambios[g]) {
    const vigente = actual[g].find((x) => x.id === c.id);
    const coincide = c.antes && c.despues && ["existencias", "cortes"].includes(g)
      ? vigente && Object.keys({ ...c.antes, ...c.despues }).every((campo) => igual(c.antes[campo], c.despues[campo]) || igual(vigente[campo], c.despues[campo]))
      : igual(vigente, c.despues);
    if (!coincide) throw new ErrorCorreccion("La corrección cambió después. Revisa los datos actuales antes de deshacer.");
  }
  for (const k of eq) if (!igual(actual.equivalencias[k], despues.equivalencias[k])) throw new ErrorCorreccion("La pareja de AX cambió después. Revisa la conciliación antes de deshacer.");
  const existenciasTocadas = new Set(cambios.existencias.map((c) => c.id));
  const convertidas = new Set(cambios.existencias.filter((c) => !igual(c.antes.conversiones_um, c.despues.conversiones_um)).map((c) => c.id));
  if (actual.existencias.some((x) => convertidas.has(x.id) && !igual(x.conteo_id, despues.existencias.find((e) => e.id === x.id).conteo_id))) {
    throw new ErrorCorreccion("Se realizó un conteo posterior en las partidas convertidas. Revisa su unidad antes de deshacer.");
  }
  if (actual.movimientos.some((m) => convertidas.has(m.existencia_id) && !igual(m, despues.movimientos.find((x) => x.id === m.id))) ||
      despues.movimientos.some((m) => convertidas.has(m.existencia_id) && !igual(m, actual.movimientos.find((x) => x.id === m.id)))) {
    throw new ErrorCorreccion("Se registraron o editaron vales de las partidas convertidas. Revisa su unidad antes de deshacer.");
  }
  if (cambios.variantes.some((c) => !c.antes && e.existencias.some((x) => x.variante_id === c.id && !existenciasTocadas.has(x.id)))) {
    throw new ErrorCorreccion("La variante corregida tiene nuevas partidas. Revisa el inventario antes de deshacer.");
  }
  const variantes = new Map(cambios.variantes.map((c) => [c.id, c]));
  e.variantes = e.variantes.filter((v) => !variantes.has(v.id) || variantes.get(v.id).antes)
    .map((v) => variantes.has(v.id) ? structuredClone(variantes.get(v.id).antes) : v);
  for (const c of cambios.existencias) {
    const x = e.existencias.find((x) => x.id === c.id);
    for (const campo of ["variante_id", "dimension_hoja", "np_hoja", "um_hoja", "cantidad_conteo", "conversiones_um", "factores_um_vales"]) {
      if (igual(c.antes[campo], c.despues[campo])) continue;
      if (c.antes[campo] === undefined) delete x[campo];
      else x[campo] = structuredClone(c.antes[campo]);
    }
  }
  e.equivalencias_ax ??= {};
  for (const k of eq) {
    if (antes.equivalencias[k] === undefined) delete e.equivalencias_ax[k];
    else e.equivalencias_ax[k] = structuredClone(antes.equivalencias[k]);
  }
  for (const c of cambios.cortes) {
    const corte = e.cortes_ax.find((x) => x.id === c.id);
    for (const campo of ["sin_pareja", "vinculos_fisicos"]) if (!igual(c.antes[campo], c.despues[campo])) corte[campo] = structuredClone(c.antes[campo]);
  }
  quitarEtiquetas(e, "material", cambios.etiquetas.filter((c) => !c.antes).map((c) => c.id));
  auditar(e, { usuario, entidad: "variante", accion: "DESHACER_CORRECCION" });
}
