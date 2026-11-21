// Ronda 34, paso 2 · Material (docs/13-rediseno-vale-salida.md §4): el buscador único del vale de salida. Sin navegador:
// el índice del inventario (cada clave con su contenedor y existencia, y los artículos sin existencia como el diésel), la
// búsqueda por alcance («Buscar en»), los resultados agrupados por código, la clave que el área se llevó la última vez y
// lo que se cuenta de las partidas del vale. Sustituye a la búsqueda rápida de antes (`indiceRapido` / `buscarRapido`).

import { aNumero } from "../nucleo/decimal.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { DUENO_FX, duenoDe } from "../nucleo/inventarios.js";
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

/** «Buscar en» (§4.1). */
export const ALCANCES = Object.freeze([
  Object.freeze({ valor: "todo", etiqueta: "Todo" }),
  Object.freeze({ valor: "codigo", etiqueta: "Solo código" }),
  Object.freeze({ valor: "descripcion", etiqueta: "Solo descripción" }),
  Object.freeze({ valor: "dimension", etiqueta: "Dimensión o NP" }),
]);

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
      buscar: {
        descripcion: normal(descripcion),
        dimension: normal(`${dimension} ${np}`),
        todo: normal(`${v.codigo} ${descripcion} ${dimension} ${np} ${u.hoja_excel}`),
      },
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
      buscar: { descripcion: normal(a.descripcion), dimension: "", todo: normal(`${a.codigo} ${a.descripcion}`) },
    });
  }
  return items;
}

/** ¿La fila coincide con lo escrito según «Buscar en»? */
function coincide(item, consulta, alcance) {
  const q = consulta.trim();
  if (alcance === "codigo") {
    if (!/^\d+$/.test(q)) return false;
    return String(item.codigo).startsWith(q.replace(/^0+/, "") || "0");
  }
  const ps = palabras(q);
  if (!ps.length) return false;
  const donde = alcance === "descripcion" ? item.buscar.descripcion : alcance === "dimension" ? item.buscar.dimension : item.buscar.todo;
  return ps.every((p) => donde.includes(p));
}

/**
 * Resultados agrupados por código (§4.2): [{ codigo, descripcion, filas, exacto }]. Un número igual a un código pone
 * ese código primero; luego los que tienen existencia. Dentro de cada código, las claves en el orden del inventario.
 * @returns { grupos, mas } — `mas`: cuántos códigos más coinciden y no se muestran.
 */
export function buscarMaterial(items, consulta, { alcance = "todo", limite = LIMITE_CODIGOS } = {}) {
  const q = texto(consulta);
  if (!q) return { grupos: [], mas: 0 };
  const exacto = /^\d+$/.test(q) ? Number(q) : null;
  const porCodigo = new Map();
  for (const item of items) {
    if (!coincide(item, q, alcance)) continue;
    if (!porCodigo.has(item.codigo)) porCodigo.set(item.codigo, { codigo: item.codigo, descripcion: item.descripcion, filas: [], exacto: item.codigo === exacto });
    porCodigo.get(item.codigo).filas.push(item);
  }
  const hay = (g) => g.filas.some((f) => (f.total ?? 0) > 0);
  const grupos = [...porCodigo.values()]
    .map((g) => ({ ...g, filas: g.filas.sort((a, b) => a.orden - b.orden) }))
    .sort((a, b) => Number(b.exacto) - Number(a.exacto) || Number(hay(b)) - Number(hay(a)) || a.codigo - b.codigo);
  return { grupos: grupos.slice(0, limite), mas: Math.max(0, grupos.length - limite) };
}

/** Las filas de los grupos en el orden en que se ven (para moverse con ↑ ↓). */
export const filasEnOrden = (grupos) => grupos.flatMap((g) => g.filas);

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
export function estadoPartida(estado, l, { indices = new Indices(estado) } = {}) {
  const conExistencia = l.existencia_id !== null && l.existencia_id !== undefined;
  const opciones = Number.isInteger(l.codigo) ? opcionesDeClave(estado, l.codigo, { indices }) : [];
  return {
    sinCantidad: !texto(l.cantidad),
    sinClave: !conExistencia && !l.no_inventariado,
    noDescuenta: !conExistencia && Boolean(l.no_inventariado) && opciones.length > 0,
    noInventariado: !conExistencia && Boolean(l.no_inventariado) && opciones.length === 0,
  };
}

/** Los contadores de la lista: «2 sin cantidad», «1 no descuenta», «1 sin clave». */
export function contarPartidas(estado, lineas, { indices = new Indices(estado) } = {}) {
  const capturadas = lineasCapturadas(lineas);
  const estados = capturadas.map((l) => estadoPartida(estado, l, { indices }));
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
