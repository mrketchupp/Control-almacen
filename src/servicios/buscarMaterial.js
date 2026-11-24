// Ronda 34, paso 2 · Material (docs/13-rediseno-vale-salida.md §4): el buscador del vale de salida. Sin navegador: el
// índice del inventario (cada clave con su contenedor y existencia, y los artículos sin existencia como el diésel), la
// búsqueda, los resultados agrupados por código, la clave que el área se llevó la última vez y lo que se cuenta de las
// partidas del vale. Ronda 35 (pedido del usuario): dos campos en lugar de «Buscar en» — «Código o descripción» elige
// los códigos y «Dimensión o NP» sus claves —, y si la dimensión escrita no está en un código, ese código ofrece
// «Usar «…»» tal como se escribió (espacios, guiones, comillas, letras): ya no se adivina qué palabra es qué.

import { aNumero } from "../nucleo/decimal.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { DUENO_FX, duenoDe } from "../nucleo/inventarios.js";
import { claveEstricta } from "../nucleo/normalizar.js";
import { partidasParaSalida } from "./copiarVale.js";
import {
  claveDeRenglon,
  conExistencia,
  lineaEnBlanco,
  lineaNoInventariada,
  lineaVacia,
  lineasCapturadas,
  loteDeRenglon,
  opcionesDeClave,
  plantillaArea,
} from "./vales.js";

/** Cuántos códigos se muestran a la vez; con más, se pide escribir más (la lista tiene su propio scroll). */
export const LIMITE_CODIGOS = 15;

export const normal = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim();
const palabras = (t) => normal(t).split(/\s+/).filter(Boolean);
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const lugarDe = (u) => `#${u.contenedor} ${u.clase === "INV" ? "Inv." : "Cons."}`;
/** Sin espacios y con las comillas iguales: `4''X 3M` y `4" x 3m` se escriben igual para buscar. */
export const junta = (t) => normal(t).replace(/[“”″]|''/g, '"').replace(/[‘’′]/g, "'").replace(/\s+/g, "");

/**
 * Lo que se puede agregar al vale: una fila por partida del inventario (su clave = dimensión tal cual, su NP, contenedor
 * y existencia) y una por artículo del catálogo sin partidas (diésel, gases: no llevan existencia).
 */
export function indiceMaterial(estado, { indices = new Indices(estado), saldos = null } = {}) {
  const totales = saldos ?? calcularSaldos(estado);
  const items = [];
  const conPartidas = new Set();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    const descripcion = indices.articulo(v.codigo)?.descripcion ?? "";
    const dimension = dimensionMostrada(e, v) || "";
    const np = npMostrado(e, v) || "";
    conPartidas.add(v.codigo);
    items.push({
      tipo: "existencia",
      id: e.id,
      codigo: v.codigo,
      descripcion,
      clave: claveDeRenglon(dimension),
      np: loteDeRenglon(np),
      um: umMostrada(e, v) || "",
      lugar: lugarDe(u),
      hoja: u.hoja_excel.trim(),
      total: aNumero(totales.get(e.id)?.total ?? 0),
      fx: duenoDe(e) === DUENO_FX,
      orden: u.orden * 100000 + e.orden,
      buscar: buscarEn(v.codigo, descripcion, dimension, np),
    });
  }
  for (const a of Object.values(estado.articulos)) {
    if (conPartidas.has(a.codigo) || a.activo === false) continue;
    items.push({
      tipo: "articulo",
      id: null,
      codigo: a.codigo,
      descripcion: a.descripcion ?? "",
      clave: "",
      np: "",
      um: "",
      lugar: null,
      hoja: null,
      total: null,
      fx: false,
      orden: 0,
      buscar: buscarEn(a.codigo, a.descripcion, "", ""),
    });
  }
  return items;
}

// Lo que se compara de cada fila (ya normalizado, para no repetirlo en cada tecla).
function buscarEn(codigo, descripcion, dimension, np) {
  return {
    material: normal(`${codigo} ${descripcion}`),
    descripcion: normal(descripcion),
    dimension: normal(dimension),
    np: normal(np),
    dimensionJunta: junta(dimension),
    npJunto: junta(np),
  };
}

/**
 * ¿El código de la fila es el que se escribió en «Código o descripción»? Un número: los códigos que empiezan así (1) o,
 * si no, las descripciones que lo traen (2); texto: todas sus palabras en el código y la descripción (2). 0 = no.
 */
function comoMaterial(item, q) {
  if (!q) return 1;
  if (/^\d+$/.test(q)) {
    if (String(item.codigo).startsWith(q.replace(/^0+/, "") || "0")) return 1;
    return item.buscar.descripcion.includes(q) ? 2 : 0;
  }
  return palabras(q).every((p) => item.buscar.material.includes(p)) ? 2 : 0;
}

/** ¿La clave de la fila trae lo escrito en «Dimensión o NP»? Junto (sin espacios) o palabra por palabra. */
export function coincideDimension(item, q) {
  if (item.tipo !== "existencia") return false;
  const b = item.buscar;
  const j = junta(q);
  if (j && (b.dimensionJunta.includes(j) || b.npJunto.includes(j))) return true;
  const ps = palabras(q);
  return ps.length > 0 && ps.every((p) => b.dimension.includes(p) || b.np.includes(p));
}

// Para saber si la clave escrita ya existe: sin espacios, guiones ni puntos y con las comillas iguales (`6''` = `6"`).
const igualClave = (t) => claveEstricta(junta(t));

/** Una dimensión escrita a mano como se guarda en la partida: mayúsculas, sin espacios de más. */
export const claveEscrita = (t) => texto(t).replace(/\s+/g, " ").toUpperCase();

/**
 * Resultados agrupados por código (§4.2, Ronda 35): `material` = lo escrito en «Código o descripción» y `dimension` = lo
 * de «Dimensión o NP». Un número igual a un código pone ese código primero; luego los que traen la dimensión, los que
 * empiezan con el número y los que tienen existencia. Cada grupo: { codigo, descripcion, filas, exacto, usar,
 * sinCoincidencia }. Con dimensión escrita y material, `usar` = la opción «Usar «…»» si el código no tiene esa clave
 * (exacta: ni como dimensión ni como NP); si ninguna clave del código la trae, en el código escrito (o el único que
 * queda) se ven sus claves de referencia (`sinCoincidencia`). Sin material, solo los códigos con claves que la traen.
 * @returns { grupos, mas } — `mas`: cuántos códigos más coinciden y no se muestran.
 */
export function buscarMaterial(items, { material = "", dimension = "" } = {}, { limite = LIMITE_CODIGOS } = {}) {
  const q1 = texto(material);
  const q2 = texto(dimension);
  if (!q1 && !q2) return { grupos: [], mas: 0 };
  const numero = /^\d+$/.test(q1) ? Number(q1) : null;
  const porCodigo = new Map();
  for (const item of items) {
    const como = comoMaterial(item, q1);
    if (!como) continue;
    let g = porCodigo.get(item.codigo);
    if (!g) {
      g = { codigo: item.codigo, descripcion: item.descripcion, filas: [], todas: [], exacto: item.codigo === numero, porNumero: como === 1, usar: null, sinCoincidencia: false };
      porCodigo.set(item.codigo, g);
    }
    g.todas.push(item);
    if (!q2 || coincideDimension(item, q2)) g.filas.push(item);
  }
  let grupos = [...porCodigo.values()];
  if (q2) {
    const escrita = igualClave(q2);
    for (const g of grupos) {
      const existe = g.todas.some((i) => i.tipo === "existencia" && (igualClave(i.clave) === escrita || (i.np && igualClave(i.np) === escrita)));
      if (q1 && escrita && !existe) g.usar = { tipo: "clave", codigo: g.codigo, descripcion: g.descripcion, clave: claveEscrita(q2) };
    }
    grupos = grupos.filter((g) => g.filas.length || g.usar);
  }
  const hay = (g) => g.filas.some((f) => (f.total ?? 0) > 0);
  grupos.sort(
    (a, b) =>
      Number(b.exacto) - Number(a.exacto) ||
      Number(b.filas.length > 0) - Number(a.filas.length > 0) ||
      Number(b.porNumero) - Number(a.porNumero) ||
      Number(hay(b)) - Number(hay(a)) ||
      a.codigo - b.codigo,
  );
  const vistos = grupos.slice(0, limite).map(({ todas, porNumero, ...g }) => {
    const filas = g.filas.sort((x, y) => x.orden - y.orden);
    // Ninguna clave trae lo escrito: en el código buscado se ven las que sí hay, por si está escrita de otra forma.
    if (!filas.length && (g.exacto || grupos.length === 1)) return { ...g, filas: todas.sort((x, y) => x.orden - y.orden), sinCoincidencia: true };
    return { ...g, filas };
  });
  return { grupos: vistos, mas: Math.max(0, grupos.length - limite) };
}

/** Las filas de los grupos en el orden en que se ven, sin «Usar «…»» (lo de antes). */
export const filasEnOrden = (grupos) => grupos.flatMap((g) => g.filas);

/** Lo que se puede resaltar con ↑ ↓, en el orden en que se ve: cada grupo con sus claves y su «Usar «…»». */
export const opcionesEnOrden = (grupos) => grupos.flatMap((g) => (g.usar ? [...g.filas, g.usar] : g.filas));

/**
 * Lo escrito en «Código o descripción» no encontró nada pero sí es una dimensión o NP (p. ej. «6309»): cuántas claves lo
 * traen, para ofrecer buscarlo en el otro campo.
 */
export function dimensionEnMaterial(items, material) {
  const q = texto(material);
  if (!q) return 0;
  return items.filter((i) => coincideDimension(i, q)).length;
}

/**
 * La clave que el área se llevó la última vez de cada código (§4.2, «La última de MECANICO»): código → id de la partida
 * del inventario, del vale de salida más reciente de esa área que la traía.
 */
export function ultimasDeArea(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const depto = normal(datos.depto_destino);
  const ultimas = new Map();
  if (!area && !depto) return ultimas;
  const delArea = (v) => (area ? v.plantilla_area_id === area.id || (v.plantilla_area_id == null && depto && normal(v.depto_destino) === depto) : normal(v.depto_destino) === depto);
  const vales = estado.vales
    .filter((v) => v.tipo === "SALIDA" && v.estado === "EMITIDO" && delArea(v))
    .sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  for (const v of vales) {
    for (const l of v.lineas) if (Number.isInteger(l.codigo) && l.existencia_id != null && !ultimas.has(l.codigo)) ultimas.set(l.codigo, l.existencia_id);
  }
  return ultimas;
}

/**
 * Cómo está cada partida del vale (§4.3): sin cantidad, sin clave elegida (copiada de otro vale), con una clave escrita
 * a mano que no descuenta, o sin existencia por ser un insumo que no se inventaría (diésel, gases).
 */
export function estadoPartida(estado, l, { indices = new Indices(estado), codigosConPartidas = null } = {}) {
  const conExistencia = l.existencia_id !== null && l.existencia_id !== undefined;
  // Con `codigosConPartidas` (los códigos con partidas en el inventario) no se recorre el inventario en cada tecla.
  const tienePartidas = Number.isInteger(l.codigo) && (codigosConPartidas ? codigosConPartidas.has(l.codigo) : opcionesDeClave(estado, l.codigo, { indices }).length > 0);
  return {
    sinCantidad: !texto(l.cantidad),
    sinClave: !conExistencia && !l.no_inventariado,
    noDescuenta: !conExistencia && Boolean(l.no_inventariado) && tienePartidas,
    noInventariado: !conExistencia && Boolean(l.no_inventariado) && !tienePartidas,
  };
}

/** Los códigos que tienen partidas en el inventario (de `indiceMaterial`). */
export const codigosConPartidas = (items) => new Set(items.filter((i) => i.tipo === "existencia").map((i) => i.codigo));

/** Los contadores de la lista: «2 sin cantidad», «1 no descuenta», «1 sin clave». */
export function contarPartidas(estado, lineas, { indices = new Indices(estado), codigosConPartidas = null } = {}) {
  const capturadas = lineasCapturadas(lineas);
  const estados = capturadas.map((l) => estadoPartida(estado, l, { indices, codigosConPartidas }));
  return {
    total: capturadas.length,
    sinCantidad: estados.filter((e) => e.sinCantidad).length,
    noDescuentan: estados.filter((e) => e.noDescuenta).length,
    sinClave: estados.filter((e) => e.sinClave).length,
  };
}

/** Las partidas que se ven en la lista: sin las filas en blanco que dejaba el editor de antes. */
export const partidasDelVale = (lineas) => (lineas ?? []).filter((l) => !lineaEnBlanco(l));

/**
 * Agrega al final una partida desde un resultado (§4.2), con la cantidad vacía (nunca se inventa). De una partida del
 * inventario toma su clave, UM y contenedor; un artículo sin existencia (diésel) va como «no inventariado» y su UM se
 * escribe. El lote es el del área (si tiene) o, con el ajuste, el NP. Quita las filas en blanco del editor de antes.
 * @returns { datos, linea }
 */
export function agregarPartida(estado, datos, item, { indices = new Indices(estado) } = {}) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const lote = area?.lote_defecto ?? "";
  const linea =
    item.tipo === "existencia"
      ? conExistencia(estado, lineaVacia(lote), item.id, indices)
      : { ...lineaNoInventariada(estado, item.codigo), lote, clave: "S/D" };
  return { datos: { ...datos, lineas: [...partidasDelVale(datos.lineas), linea] }, linea };
}

// ---------------------------------------------------------------- editar una partida (§4.4)

/**
 * La partida con otra clave (u otro material) de los resultados: conserva cantidad, lote y O.C. (y la UM si sigue sin
 * existencia del mismo código). Una partida del inventario fija clave, UM y contenedor; un artículo sin existencia
 * queda «no inventariado».
 */
export function conOtraClave(estado, linea, item, { indices = new Indices(estado) } = {}) {
  const conserva = { uid: linea.uid, cantidad: linea.cantidad ?? "", lote: linea.lote ?? "", oc: linea.oc ?? "", justificacion: linea.justificacion ?? "" };
  if (item.tipo === "existencia") return { ...conExistencia(estado, { ...linea, ...conserva }, item.id, indices), ...pick(conserva, ["uid", "cantidad", "oc"]) };
  const base = lineaNoInventariada(estado, item.codigo);
  return { ...base, ...conserva, clave: "S/D", um: linea.codigo === item.codigo ? (linea.um ?? "") : "", lote_np: null, lote_fx: null };
}
const pick = (o, claves) => Object.fromEntries(claves.map((c) => [c, o[c]]));

/**
 * Clave escrita a mano que no está en el inventario (§4.5): queda en el vale y el historial pero no descuenta. Es lo
 * mismo que hoy con «Otra clave»: sin partida del inventario y `no_inventariado`.
 */
export function conClaveManual(linea, clave) {
  // El lote que se puso solo (NP o «FX» de la partida de antes) ya no aplica; lo escrito a mano se queda.
  const puestoSolo = (linea.lote_fx && texto(linea.lote) === DUENO_FX) || (linea.lote_np && texto(linea.lote) === linea.lote_np);
  return {
    ...linea,
    clave: texto(clave).toUpperCase(),
    existencia_id: null,
    variante_id: null,
    no_inventariado: true,
    lote: puestoSolo ? "" : (linea.lote ?? ""),
    lote_np: null,
    lote_fx: null,
  };
}

// ---------------------------------------------------------------- clave nueva y código nuevo (§4.5, §4.6)

/** Las claves que hay de un código (para mostrarlas arriba de «Usar «clave»»). */
export const filasDeCodigo = (items, codigo) => items.filter((i) => i.codigo === codigo).sort((a, b) => a.orden - b.orden);

/**
 * ¿Lo escrito en «Código o descripción» empieza con un código que no está en el catálogo, sin ningún resultado? (§4.6)
 * «1399» o «1399 bomba»: se agrega «por confirmar» con la descripción que siga (o se escribe en la partida) y, si se
 * escribió, la dimensión del otro campo.
 * @returns { tipo: "codigo", codigo, descripcion, clave } o null
 */
export function codigoNuevo(estado, material, { hayResultados = false, dimension = "" } = {}) {
  const m = /^0*(\d{1,9})(?:\s+(.*))?$/.exec(texto(material));
  if (!m || hayResultados) return null;
  const codigo = Number(m[1]);
  if (!codigo || estado.articulos[codigo]) return null;
  return { tipo: "codigo", codigo, descripcion: texto(m[2]).toUpperCase(), clave: claveEscrita(dimension) };
}

/** Partida de un código que no está en el catálogo: no descuenta; al emitir se da de alta «por confirmar». */
export function lineaCodigoNuevo(codigo, descripcion = "", lote = "", clave = "") {
  return { ...lineaVacia(lote), codigo, descripcion: texto(descripcion).toUpperCase(), no_inventariado: true, clave: claveEscrita(clave) };
}

// ---------------------------------------------------------------- traer partidas de otra entrada o vale (§4.7)

/**
 * Agrega al borrador abierto (no a uno nuevo) las partidas de una entrada o de otro vale de salida, como
 * `borradorDesdeVale` (Ronda 33): cada una sale de la partida del inventario a la que entró, con su cantidad.
 * @returns { datos, avisos, partidas }
 */
export function conPartidasDeVale(estado, datos, valeId, { indices = new Indices(estado) } = {}) {
  const vale = estado.vales.find((v) => v.id === valeId);
  if (!vale || (vale.tipo !== "SALIDA" && vale.tipo !== "ENTRADA") || vale.estado !== "EMITIDO") {
    throw new Error("No se encontró ese vale (solo entradas y salidas emitidas).");
  }
  const { lineas, avisos } = partidasParaSalida(estado, vale, { indices });
  return { datos: { ...datos, lineas: [...partidasDelVale(datos.lineas), ...lineas] }, avisos, partidas: lineas.length };
}

/** Lo mismo sobre el borrador guardado en el estado (dentro de `Almacen.modificar`). */
export function agregarPartidasDesdeVale(estado, borradorId, valeId) {
  const b = estado.borradores.find((x) => x.id === borradorId);
  if (!b) throw new Error("El borrador ya no existe.");
  const r = conPartidasDeVale(estado, b, valeId);
  b.lineas = r.datos.lineas;
  return { avisos: r.avisos, partidas: r.partidas };
}

/** Entradas recibidas hoy, para «¿Es material que acabas de recibir?» (las 2 más recientes). */
export function entradasDeHoy(estado, hoy, limite = 2) {
  return estado.vales
    .filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO" && (v.fecha_recibido || v.fecha) === hoy)
    .sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0))
    .slice(0, limite);
}
