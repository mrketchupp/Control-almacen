import { auditar } from "../nucleo/estado.js";
import { ErrorCorreccion } from "./inventario.js";
import { quitarEtiquetas } from "./etiquetas.js";

/** Sólo los datos de las claves y de las decisiones AX; las cantidades y los vales quedan aparte. */
export function datosCorreccion(e) {
  return structuredClone({ variantes: e.variantes,
    existencias: e.existencias.map((x) => ({ id: x.id, variante_id: x.variante_id, dimension_hoja: x.dimension_hoja, np_hoja: x.np_hoja })),
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
    if (!igual(actual[g].find((x) => x.id === c.id), c.despues)) throw new ErrorCorreccion("La corrección cambió después. Revisa los datos actuales antes de deshacer.");
  }
  for (const k of eq) if (!igual(actual.equivalencias[k], despues.equivalencias[k])) throw new ErrorCorreccion("La pareja de AX cambió después. Revisa la conciliación antes de deshacer.");
  const existenciasTocadas = new Set(cambios.existencias.map((c) => c.id));
  if (cambios.variantes.some((c) => !c.antes && e.existencias.some((x) => x.variante_id === c.id && !existenciasTocadas.has(x.id)))) {
    throw new ErrorCorreccion("La variante corregida tiene nuevas partidas. Revisa el inventario antes de deshacer.");
  }
  const variantes = new Map(cambios.variantes.map((c) => [c.id, c]));
  e.variantes = e.variantes.filter((v) => !variantes.has(v.id) || variantes.get(v.id).antes)
    .map((v) => variantes.has(v.id) ? structuredClone(variantes.get(v.id).antes) : v);
  for (const c of cambios.existencias) {
    const x = e.existencias.find((x) => x.id === c.id);
    for (const campo of ["variante_id", "dimension_hoja", "np_hoja"]) {
      if (c.antes[campo] === undefined) delete x[campo];
      else x[campo] = c.antes[campo];
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
