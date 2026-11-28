// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §5): paso 2 · Material del vale de entrada — qué entra (código,
// variante o variante nueva, cantidad, tipo, quién lo solicita y la O.C.). El contenedor se decide en el paso 3
// (`acomodoEntrada.js`): aquí una partida solo queda acomodada sola (★) cuando su variante vive en un solo contenedor de
// su tipo, o cuando se eligió una fila del buscador (esa partida del inventario). Sin navegador.

import { Indices, claveVariante } from "../nucleo/estado.js";
import { inventarioDe, soloConsumible } from "../nucleo/inventarios.js";
import { claveEstricta, unidad } from "../nucleo/normalizar.js";
import { acomodoAutomatico, acomodoDe, claseDeLinea, desacomodar, dondeHay, varianteDeLinea } from "./acomodoEntrada.js";
import { claveEscrita } from "./buscarMaterial.js";
import { conRenglonExistente, conVarianteNueva, destinosDeCodigo, entradaSinExistencia, lineaEntradaVacia, lineasEntradaCapturadas } from "./entradas.js";
import { variantesParecidas } from "./inventario.js";
import { claveDeRenglon, loteDeRenglon } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const hay = (v) => v !== null && v !== undefined;

export const TIPOS = Object.freeze({ CONS: "Consumible", INV: "Inventariable" });

/** El tipo de las partidas nuevas (§10, en *Ajustes*): Consumible de fábrica. */
export const tipoPorDefecto = (estado) => (estado.config?.tipo_partida_entrada === "INV" ? "INV" : "CONS");

/** ¿La regla de los 3 dígitos (GSM y FX) obliga a que el código sea consumible? */
export const consumiblePorRegla = (estado, codigo) => soloConsumible(inventarioDe(estado).id, codigo);

/**
 * El tipo con que empieza una partida (§5.1), en este orden: el de la hoja donde ya tiene existencia su variante
 * («según su existencia»), Consumible por la regla de los 3 dígitos («consumible por regla», sin poder cambiarlo) o el
 * de *Ajustes*. @returns { clase, motivo: "existencia" | "regla" | "defecto" }
 */
export function tipoInicial(estado, linea, { indices = new Indices(estado) } = {}) {
  if (hay(linea.existencia_id)) {
    const clase = indices.ubicacion(indices.existencia(linea.existencia_id)?.ubicacion_id)?.clase;
    if (clase) return { clase, motivo: "existencia" };
  }
  const variante = varianteDeLinea(linea, indices);
  if (variante) {
    const donde = dondeHay(estado, variante.id, null, indices);
    if (donde.length) {
      // En las dos clases (raro): la que tiene más partidas.
      const inv = donde.filter((d) => d.ubicacion.clase === "INV").length;
      return { clase: inv * 2 >= donde.length ? (inv ? "INV" : "CONS") : "CONS", motivo: "existencia" };
    }
  }
  if (consumiblePorRegla(estado, linea.codigo)) return { clase: "CONS", motivo: "regla" };
  return { clase: tipoPorDefecto(estado), motivo: "defecto" };
}

/** Lo que dice el interruptor de tipo y si se puede cambiar. @returns { clase, nota, bloqueado } */
export function tipoDeLinea(estado, linea, { indices = new Indices(estado) } = {}) {
  const inicial = tipoInicial(estado, linea, { indices });
  const clase = claseDeLinea(linea, indices) ?? inicial.clase;
  const bloqueado = inicial.motivo === "regla";
  const nota = bloqueado ? "consumible por regla" : inicial.motivo === "existencia" && inicial.clase === clase ? "según su existencia" : null;
  return { clase: bloqueado ? "CONS" : clase, nota, bloqueado };
}

/** La partida con su tipo inicial (si no lo tenía) y acomodada sola si su variante vive en un solo contenedor (★). */
export function conTipoYAcomodo(estado, linea, { indices = new Indices(estado), conservarTipo = false } = {}) {
  if (linea.no_inventariado) return linea;
  const inicial = tipoInicial(estado, linea, { indices });
  const clase = conservarTipo && (linea.clase === "INV" || linea.clase === "CONS") && inicial.motivo !== "regla" && inicial.motivo !== "existencia" ? linea.clase : inicial.clase;
  const conClase = { ...linea, clase };
  if (acomodoDe(estado, conClase, { indices }).estado === "acomodada") return conClase;
  return acomodoAutomatico(estado, conClase, { indices });
}

// ---------------------------------------------------------------- agregar desde el buscador

/**
 * Una partida desde un resultado del buscador (§5): de una fila del inventario, esa partida (su variante y su
 * contenedor: se eligió esa); de un código sin partidas (diésel, gases), sin existencia; «Usar «…» en <código>», una
 * variante nueva de ese código (se acomoda en el paso 3); de un código que no está en el catálogo, código nuevo.
 * La cantidad empieza vacía (nunca se inventa). `um`: la unidad más usada del código, para una variante nueva.
 */
export function partidaDesdeResultado(estado, item, { indices = new Indices(estado) } = {}) {
  const vacia = lineaEntradaVacia();
  if (item.tipo === "existencia") {
    const linea = conRenglonExistente(estado, vacia, item.id, indices);
    return { ...linea, clase: indices.ubicacion(indices.existencia(item.id).ubicacion_id)?.clase ?? tipoInicial(estado, linea, { indices }).clase };
  }
  if (item.tipo === "articulo") {
    return entradaSinExistencia({ ...vacia, codigo: item.codigo, descripcion: texto(item.descripcion).toUpperCase(), um: umDeLosVales(estado, item.codigo) });
  }
  const descripcion = texto(item.descripcion) || indices.articulo(item.codigo)?.descripcion || "";
  const opciones = destinosDeCodigo(estado, item.codigo, { indices });
  const linea = conVarianteNueva({ ...vacia, codigo: item.codigo, descripcion: descripcion.toUpperCase() }, { dimension: item.clave ?? "", um: umMasUsada(opciones) });
  return { ...linea, clase: tipoInicial(estado, linea, { indices }).clase };
}

/** La unidad con que se anotó ese código la última vez en un vale (diésel: LTS), para no escribirla cada vez. */
export function umDeLosVales(estado, codigo) {
  let mejor = null;
  for (const v of estado.vales) {
    if (v.estado === "CANCELADO") continue;
    for (const l of v.lineas) if (l.codigo === codigo && texto(l.um) && (!mejor || (v.emitido_en ?? v.fecha ?? "") >= mejor.cuando)) mejor = { um: unidad(l.um), cuando: v.emitido_en ?? v.fecha ?? "" };
  }
  return mejor?.um ?? "";
}

function umMasUsada(opciones) {
  const cuenta = new Map();
  for (const o of opciones) if (o.um) cuenta.set(o.um, (cuenta.get(o.um) ?? 0) + 1);
  return [...cuenta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

// ---------------------------------------------------------------- editar una partida (§5.2)

/** Lo que identifica qué material es una partida: su variante o los datos de su variante nueva. */
export function identidadDe(linea, indices) {
  if (linea.no_inventariado) return `sin:${linea.codigo}`;
  const variante = varianteDeLinea(linea, indices);
  if (variante) return `v:${variante.id}`;
  return `n:${linea.codigo}|${claveEstricta(linea.dimension)}|${claveEstricta(linea.np)}|${unidad(linea.um)}`;
}

/** Los campos con que se edita una partida: código, dimensión, NP, U.M. y descripción (la de un código nuevo). */
export function camposDeLinea(linea, indices) {
  const variante = varianteDeLinea(linea, indices);
  const existencia = hay(linea.existencia_id) ? indices.existencia(linea.existencia_id) : null;
  const dimension = linea.alta ? texto(linea.dimension) : variante ? texto(existencia?.dimension_hoja ?? variante.dimension) : texto(linea.clave) === "S/D" ? "" : texto(linea.clave);
  const np = linea.alta ? texto(linea.np) : variante ? texto(existencia?.np_hoja ?? variante.np) : texto(linea.np);
  const um = texto(linea.um) || (variante ? texto(variante.um) : "");
  return { codigo: Number.isInteger(linea.codigo) ? String(linea.codigo) : "", dimension, np, um, descripcion: texto(linea.descripcion), sinExistencia: Boolean(linea.no_inventariado) };
}

/** La variante del inventario que se escribe igual (código, dimensión, NP y U.M.); null si no hay. */
export function varianteEscrita(indices, codigo, { dimension = "", np = "", um = "" } = {}) {
  if (!Number.isInteger(codigo)) return null;
  const v = indices.porClave.get(claveVariante(codigo, claveEstricta(dimension), claveEstricta(np), unidad(um)));
  return v && v.activo !== false ? v : null;
}

/**
 * La partida con lo que se eligió al editarla (§5.2). `campos`: { codigo, dimension, np, um, descripcion,
 * sinExistencia, existenciaId } — `existenciaId` = la fila elegida con «Usar esta» (esa partida del inventario). Si los
 * campos son los de una variante del inventario, esa; si no, una variante nueva con lo escrito. Cantidad, tipo, solicita
 * y O.C. se conservan; si cambió el material, vuelve a «Faltan por acomodar» salvo que la nueva viva en un solo
 * contenedor de su tipo (★). Queda revisada (`dudoso: false`).
 */
export function conCamposEditados(estado, linea, campos, { indices = new Indices(estado) } = {}) {
  const codigo = /^\d+$/.test(texto(campos.codigo)) ? Number(texto(campos.codigo)) : null;
  const conserva = { uid: linea.uid, cantidad: linea.cantidad ?? "", lote: linea.lote ?? "", oc: linea.oc ?? "", clase: linea.clase, ia: linea.ia, ia_leyo: linea.ia_leyo, dudoso: false };
  const descripcion = (texto(campos.descripcion) || indices.articulo(codigo)?.descripcion || "").toUpperCase();
  const base = { ...lineaEntradaVacia(), ...conserva, codigo, descripcion };
  if (codigo === null) return { ...base, clave: claveEscrita(campos.dimension), np: texto(campos.np).toUpperCase(), um: unidad(campos.um) };
  if (campos.sinExistencia) return { ...entradaSinExistencia({ ...base, um: unidad(campos.um) }), clave: claveEscrita(campos.dimension) || "S/D" };
  let nueva;
  if (hay(campos.existenciaId) && indices.existencia(campos.existenciaId)) {
    nueva = conRenglonExistente(estado, base, campos.existenciaId, indices);
    nueva = { ...nueva, ...conserva, clase: indices.ubicacion(indices.existencia(campos.existenciaId).ubicacion_id)?.clase ?? conserva.clase };
    return nueva;
  }
  const variante = varianteEscrita(indices, codigo, campos);
  if (variante) {
    const existencia = dondeHay(estado, variante.id, null, indices)[0]?.existencia;
    nueva = existencia
      ? { ...conRenglonExistente(estado, base, existencia.id, indices), ...conserva, existencia_id: null, variante_id: variante.id }
      : { ...base, variante_id: variante.id, clave: claveDeRenglon(variante.dimension), np: loteDeRenglon(variante.np), um: variante.um ?? "", alta: false };
  } else {
    nueva = { ...conVarianteNueva(base, { dimension: campos.dimension, np: campos.np, um: campos.um }), ...conserva };
  }
  // El mismo material que tenía: se queda donde estaba.
  if (identidadDe(nueva, indices) === identidadDe(linea, indices) && acomodoDe(estado, linea, { indices }).estado === "acomodada") {
    return { ...linea, ...conserva, descripcion: nueva.descripcion || linea.descripcion };
  }
  return conTipoYAcomodo(estado, desacomodar(nueva, indices), { indices, conservarTipo: true });
}

/**
 * Para no dar de alta un duplicado (RF-33): la variante del inventario, con partidas, que más se parece a la variante
 * nueva de una partida (`igual` = la misma al normalizar: «Esa clave ya existe»; si no, «¿Es la misma que…?»).
 * null si la partida no es una variante nueva o nada se parece.
 */
export function parecidaDe(estado, linea, { indices = new Indices(estado) } = {}) {
  if (!linea.alta || !Number.isInteger(linea.codigo) || !texto(linea.dimension)) return null;
  const parecidas = variantesParecidas(estado, linea.codigo, { dimension: linea.dimension, np: linea.np, um: linea.um }, { indices });
  return parecidas.find((p) => p.lugares.length) ?? null;
}

/** La partida con la variante parecida en lugar de la nueva: conserva cantidad, solicita y O.C.; el tipo, el de su hoja. */
export function conVarianteParecida(estado, linea, varianteId, { indices = new Indices(estado) } = {}) {
  const v = indices.variante(varianteId);
  if (!v || v.codigo !== linea.codigo) return linea;
  return conCamposEditados(estado, linea, { codigo: String(v.codigo), dimension: v.dimension ?? "", np: v.np ?? "", um: v.um ?? "", descripcion: linea.descripcion }, { indices });
}

// ---------------------------------------------------------------- lo de Copilot

/**
 * Las partidas que trajo Copilot, ya con las reglas de la entrada nueva: cada una con su tipo, acomodada sola solo si su
 * variante vive en un solo contenedor de su tipo (las variantes nuevas se acomodan en el paso 3) y, si Copilot no estaba
 * seguro, lo que leyó (`ia_leyo`, para «Copilot leyó «…» y no está seguro»). `partidas`: las de la respuesta, en orden.
 */
export function prepararDeCopilot(estado, previas, lineas, partidas, { indices = new Indices(estado) } = {}) {
  const antes = new Set((previas ?? []).map((l) => l.uid));
  let i = 0;
  return lineas.map((l) => {
    if (antes.has(l.uid) || lineasEntradaCapturadas([l]).length === 0) return l;
    const p = partidas[i++] ?? {};
    const leyo = [texto(p.codigo), texto(p.dimension), texto(p.np) ? `NP ${texto(p.np)}` : ""].filter(Boolean).join(" ");
    const lista = l.no_inventariado ? l : conTipoYAcomodo(estado, desacomodar(l, indices), { indices });
    return l.dudoso ? { ...lista, ia_leyo: leyo || texto(p.descripcion) } : lista;
  });
}

// ---------------------------------------------------------------- la lista: filtros y lo que se marca

export const sinOc = (l) => !texto(l.oc) || /^S\s*\/?\s*O\.?\s*C\.?$/i.test(texto(l.oc));
export const sinSolicitante = (l) => !texto(l.lote);

/**
 * Por qué una partida necesita atención (§5): lo que Copilot no tenía claro, sin código o, de un código con varias
 * claves, sin la clave elegida. null si nada.
 */
export function porRevisar(estado, l, { indices = new Indices(estado) } = {}) {
  if (!Number.isInteger(l.codigo)) return { tipo: "codigo", texto: "Falta el código." };
  if (!l.no_inventariado && !l.alta && !varianteDeLinea(l, indices)) return { tipo: "clave", texto: "Falta elegir la clave: el código tiene varias." };
  if (l.dudoso) return { tipo: "copilot", texto: l.ia_leyo ? `Copilot leyó «${l.ia_leyo}» y no está seguro.` : "Copilot no está seguro de esta partida." };
  return null;
}

export const FILTROS_MATERIAL = Object.freeze([
  { id: "todas", nombre: "Todas" },
  { id: "revisar", nombre: "Por revisar" },
  { id: "sin_oc", nombre: "Sin O.C." },
  { id: "sin_solicitante", nombre: "Sin solicitante" },
]);

/** Cuántas partidas hay en cada filtro y si una partida entra en él. */
export function filtrosDeMaterial(estado, lineas, { indices = new Indices(estado) } = {}) {
  const prueba = {
    todas: () => true,
    revisar: (l) => porRevisar(estado, l, { indices }) !== null,
    sin_oc: sinOc,
    sin_solicitante: sinSolicitante,
  };
  const cuenta = Object.fromEntries(FILTROS_MATERIAL.map((f) => [f.id, lineas.filter(prueba[f.id]).length]));
  return { cuenta, prueba };
}
