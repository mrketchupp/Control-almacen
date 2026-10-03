// Vales de entrada (Fase 3, RF-30 a RF-36): material que llega de la base (o que se
// devuelve) y entra a un renglón del inventario. Funciones puras sobre el estado: la interfaz
// las ejecuta dentro de Almacen.modificar(), que las vuelve atómicas.
//
// Cada renglón entra a un destino:
//  - un renglón existente del inventario (`existencia_id`), sugerido si la variante ya vive
//    en un contenedor (el de más existencia si vive en varios);
//  - un renglón nuevo al final de la hoja de un contenedor (`ubicacion_id`), de una variante
//    existente (`variante_id`) o nueva (`dimension`, `np`, `um`), con aviso de parecidas;
//  - ninguno (`no_inventariado`): diésel, gases y lo que no lleva existencia.
// Nada toca el inventario hasta confirmar, y la entrada confirmada recibe su folio interno
// consecutivo (E-0001), independiente del folio de la base. Ver docs/05-flujos.md §2.

import { DEPTO_ALMACEN, ORIGEN_EQUIPO } from "../nucleo/areas.js";
import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, claveVariante, dimensionMostrada, npMostrado, siguienteId, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha, hoyIso } from "../nucleo/fechas.js";
import { claveEstricta, nombrePersona, unidad } from "../nucleo/normalizar.js";
import { crearRenglon, lugarCorto, renglonDe } from "./inventario.js";
import { claveDeRenglon, conLoteDeNp, disponibles, loteDeRenglon, siguienteFolio } from "./vales.js";

export class ErrorEntrada extends Error {
  constructor(mensaje, errores = []) {
    super(mensaje);
    this.errores = errores;
  }
}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const textoONulo = (v) => texto(v) || null;
const mayus = (v) => textoONulo(v)?.toUpperCase() ?? null;
const hay = (v) => v !== null && v !== undefined;

/** Folio interno de una entrada: E-0001. */
export const folioEntrada = (folio) => (hay(folio) ? `E-${String(folio).padStart(4, "0")}` : "");

// ---------------------------------------------------------------- borradores

const SIN_DESTINO = { existencia_id: null, variante_id: null, ubicacion_id: null, dimension: "", np: "", no_inventariado: false };

export function lineaEntradaVacia() {
  return {
    uid: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    oc: "",
    cantidad: "",
    codigo: null,
    descripcion: "",
    clave: "",
    um: "",
    lote: "",
    ...SIN_DESTINO,
  };
}

export const lineaEntradaEnBlanco = (l) =>
  !Number.isInteger(l.codigo) && !texto(l.cantidad) && !texto(l.clave) && !texto(l.dimension) && !texto(l.np);

export const lineasEntradaCapturadas = (lineas) => (lineas ?? []).filter((l) => !lineaEntradaEnBlanco(l));

/** La última entrada de material de la base (para proponer de dónde viene). */
function ultimaDeLaBase(estado) {
  let ultima = null;
  for (const v of estado.vales) {
    if (v.tipo !== "ENTRADA" || v.estado !== "EMITIDO" || (v.motivo ?? "BASE") !== "BASE") continue;
    if (!ultima || v.folio > ultima.folio) ultima = v;
  }
  return ultima;
}

export function nuevoBorradorEntrada(estado, { usuario = null, fecha = hoyIso() } = {}) {
  const ultima = ultimaDeLaBase(estado);
  const b = {
    id: siguienteId(estado, "borrador_entrada"),
    tipo: "ENTRADA",
    creado_en: ahoraIso(),
    actualizado_en: ahoraIso(),
    creado_por: usuario,
    motivo: "BASE",
    folio_externo: "",
    folio_repetido: false,
    devolucion_folio: null,
    fecha,
    origen: ultima?.origen ?? "",
    depto_origen: DEPTO_ALMACEN,
    destino: ORIGEN_EQUIPO,
    depto_destino: DEPTO_ALMACEN,
    entrego_nombre: "",
    entrego_puesto: "",
    recibio_nombre: usuario ?? "",
    observaciones: "",
    lineas: [lineaEntradaVacia()],
  };
  estado.borradores_entrada.push(b);
  return b;
}

export function borradorEntrada(estado, id) {
  return estado.borradores_entrada.find((b) => b.id === id) ?? null;
}

export function descartarBorradorEntrada(estado, id) {
  estado.borradores_entrada = estado.borradores_entrada.filter((b) => b.id !== id);
}

// ---------------------------------------------------------------- destino de cada renglón

/**
 * Renglones del inventario donde puede entrar un código. Por variante se sugiere el que
 * tiene más existencia (RF-31); cada opción trae su clave, contenedor y existencia actual.
 */
export function destinosDeCodigo(estado, codigo, { indices = new Indices(estado), saldos = null } = {}) {
  if (!Number.isInteger(codigo)) return [];
  const renglones = estado.existencias.filter((e) => e.activo !== false && indices.variante(e.variante_id)?.codigo === codigo);
  const totales = saldos ?? calcularSaldos(estado, renglones.map((e) => e.id));
  const opciones = renglones.map((e) => {
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    return {
      id: e.id,
      variante_id: v.id,
      ubicacion_id: u.id,
      clave: claveDeRenglon(dimensionMostrada(e, v)),
      np: loteDeRenglon(npMostrado(e, v)),
      lugar: lugarCorto(u),
      hoja: u.hoja_excel.trim(),
      total: totales.get(e.id)?.total ?? CERO,
      um: umMostrada(e, v) || "",
      orden: u.orden * 100000 + e.orden,
    };
  });
  const mejor = new Map();
  const cuantos = new Map();
  const primero = new Map();
  for (const o of opciones) {
    const m = mejor.get(o.variante_id);
    if (!m || o.total.gt(m.total) || (o.total.eq(m.total) && o.orden < m.orden)) mejor.set(o.variante_id, o);
    cuantos.set(o.variante_id, (cuantos.get(o.variante_id) ?? 0) + 1);
    primero.set(o.variante_id, Math.min(primero.get(o.variante_id) ?? Infinity, o.orden));
  }
  return opciones
    .map((o) => ({ ...o, total: Number(o.total.toFixed()), sugerida: mejor.get(o.variante_id) === o, enVarios: cuantos.get(o.variante_id) > 1 }))
    .sort((a, b) => primero.get(a.variante_id) - primero.get(b.variante_id) || Number(b.sugerida) - Number(a.sugerida) || a.orden - b.orden);
}

/** El renglón entra a un renglón existente del inventario (fija clave y UM). */
export function conRenglonExistente(estado, linea, existenciaId, indices = new Indices(estado)) {
  const e = indices.existencia(existenciaId);
  const v = indices.variante(e.variante_id);
  return conLoteDeNp(
    {
      ...linea,
      ...SIN_DESTINO,
      codigo: v.codigo,
      descripcion: texto(linea.descripcion) || (indices.articulo(v.codigo)?.descripcion ?? ""),
      existencia_id: e.id,
      variante_id: v.id,
      clave: claveDeRenglon(dimensionMostrada(e, v)),
      um: umMostrada(e, v) || linea.um,
    },
    loteDeRenglon(npMostrado(e, v)),
  );
}

/** Con el código elegido: su descripción y, si solo hay un renglón de ese código, ese destino. */
export function entradaConArticulo(estado, linea, codigo, { indices = new Indices(estado), descripcion = null } = {}) {
  const base = {
    ...linea,
    ...SIN_DESTINO,
    codigo,
    clave: "",
    descripcion: descripcion ?? indices.articulo(codigo)?.descripcion ?? (linea.codigo === codigo ? linea.descripcion : ""),
  };
  const opciones = destinosDeCodigo(estado, codigo, { indices });
  const variantes = new Set(opciones.map((o) => o.variante_id));
  if (variantes.size === 1) return conRenglonExistente(estado, base, opciones.find((o) => o.sugerida).id, indices);
  return base;
}

/** La misma variante en otro contenedor: si ya tiene renglón ahí entra a ese; si no, a uno nuevo. */
export function conOtroContenedor(estado, linea, ubicacionId, indices = new Indices(estado)) {
  const existente = hay(linea.variante_id) ? renglonDe(estado, linea.variante_id, ubicacionId) : null;
  if (existente) return conRenglonExistente(estado, linea, existente.id, indices);
  return { ...linea, existencia_id: null, ubicacion_id: ubicacionId, no_inventariado: false };
}

/** Alta de variante (RF-33): código + dimensión + NP + UM, en un renglón nuevo del contenedor elegido. */
export function conVarianteNueva(linea, { dimension = "", np = "", um = "", ubicacionId = null } = {}) {
  return conLoteDeNp(
    {
      ...linea,
      ...SIN_DESTINO,
      ubicacion_id: ubicacionId,
      dimension: texto(dimension).toUpperCase(),
      np: texto(np).toUpperCase(),
      um: unidad(um) || linea.um,
      clave: claveDeRenglon(texto(dimension).toUpperCase()),
    },
    texto(np).toUpperCase(),
  );
}

/** Renglón que no lleva existencia (diésel, gases): queda en el historial y no suma. */
export function entradaSinExistencia(linea) {
  return { ...linea, ...SIN_DESTINO, no_inventariado: true, clave: texto(linea.clave) || "S/D" };
}

/** Variante exacta (si ya existe) para los datos de una variante nueva. */
function varianteExacta(indices, l) {
  const clave = claveVariante(l.codigo, claveEstricta(l.dimension), claveEstricta(l.np), unidad(l.um));
  return indices.porClave.get(clave) ?? null;
}

/**
 * A dónde entra un renglón: { tipo: 'renglon' | 'nuevo' | 'sin_existencia' | 'pendiente' | 'invalido',
 * existencia, ubicacion, variante }. Una variante "nueva" que ya existe se usa tal cual, y si
 * ya tiene renglón en ese contenedor, entra a ese renglón.
 */
export function destinoDe(estado, l, indices = new Indices(estado)) {
  if (l.no_inventariado) return { tipo: "sin_existencia" };
  if (hay(l.existencia_id)) {
    const existencia = indices.existencia(l.existencia_id);
    if (!existencia || existencia.activo === false) return { tipo: "invalido" };
    return { tipo: "renglon", existencia, ubicacion: indices.ubicacion(existencia.ubicacion_id), variante: indices.variante(existencia.variante_id) };
  }
  if (hay(l.ubicacion_id)) {
    const ubicacion = indices.ubicacion(l.ubicacion_id);
    if (!ubicacion) return { tipo: "invalido" };
    const variante = hay(l.variante_id) ? (indices.variante(l.variante_id) ?? null) : Number.isInteger(l.codigo) ? varianteExacta(indices, l) : null;
    const existente = variante ? renglonDe(estado, variante.id, ubicacion.id) : null;
    if (existente) return { tipo: "renglon", existencia: existente, ubicacion, variante };
    return { tipo: "nuevo", ubicacion, variante };
  }
  return { tipo: "pendiente" };
}

// ---------------------------------------------------------------- vista previa y validación

/**
 * Vista previa (RF-32): por renglón, en qué hoja queda y cuánto había, entra y queda. Varios
 * renglones al mismo destino se acumulan. En una corrección, "había" no incluye lo que la
 * propia entrada ya sumaba.
 */
export function vistaPreviaEntrada(estado, datos, { excluirValeId = null } = {}) {
  const indices = new Indices(estado);
  const lineas = lineasEntradaCapturadas(datos.lineas);
  const destinos = lineas.map((l) => destinoDe(estado, l, indices));
  const ids = [...new Set(destinos.filter((d) => d.tipo === "renglon").map((d) => d.existencia.id))];
  const base = ids.length ? disponibles(estado, ids, excluirValeId) : new Map();
  const acumulado = new Map();
  return lineas.map((l, i) => {
    const d = destinos[i];
    const entra = dec(l.cantidad);
    let clave = null;
    let habia = null;
    if (d.tipo === "renglon") {
      clave = `r${d.existencia.id}`;
      habia = acumulado.get(clave) ?? base.get(d.existencia.id) ?? CERO;
    } else if (d.tipo === "nuevo") {
      clave = `n${d.ubicacion.id}:${d.variante ? d.variante.id : `${claveEstricta(l.dimension)}|${claveEstricta(l.np)}|${unidad(l.um)}`}`;
      habia = acumulado.get(clave) ?? CERO;
    }
    const queda = habia === null ? null : entra && entra.gt(0) ? habia.plus(entra) : habia;
    if (clave) acumulado.set(clave, queda);
    return {
      renglon: i + 1,
      uid: l.uid,
      codigo: l.codigo,
      descripcion: texto(l.descripcion),
      clave: texto(l.clave),
      um: unidad(l.um),
      tipo: d.tipo,
      hoja: d.ubicacion ? d.ubicacion.hoja_excel.trim() : null,
      lugar: d.ubicacion ? lugarCorto(d.ubicacion) : null,
      habia,
      entra,
      queda,
      variante_nueva: d.tipo === "nuevo" && !d.variante,
      renglon_nuevo: d.tipo === "nuevo",
    };
  });
}

const mismoFolioBase = (a, b) => claveEstricta(a) !== "" && claveEstricta(a) === claveEstricta(b);

/** La entrada ya registrada con ese folio de la base (para no meter dos veces el mismo material). */
export function entradaConFolioBase(estado, folioExterno, excluirValeId = null) {
  if (!texto(folioExterno)) return null;
  return (
    estado.vales.find(
      (v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO" && v.id !== excluirValeId && mismoFolioBase(v.folio_externo, folioExterno),
    ) ?? null
  );
}

export function valeDeSalida(estado, folio) {
  const n = Number(texto(folio));
  if (!Number.isInteger(n) || n <= 0) return null;
  return estado.vales.find((v) => v.tipo === "SALIDA" && v.folio === n && v.estado === "EMITIDO") ?? null;
}

/**
 * @returns {{ errores: [{renglon, campo, mensaje}], avisos: [{renglon, campo, mensaje}] }}
 * No se puede confirmar con renglones sin destino (RF-32).
 */
export function validarEntrada(estado, datos, { excluirValeId = null } = {}) {
  const errores = [];
  const avisos = [];
  const error = (renglon, campo, mensaje) => errores.push({ renglon, campo, mensaje });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(datos.fecha))) error(null, "fecha", "Falta la fecha.");
  if (!texto(datos.folio_externo)) error(null, "folio_externo", "Falta el folio del vale que llega con el material.");
  if (texto(datos.devolucion_folio) && !valeDeSalida(estado, datos.devolucion_folio)) {
    error(null, "devolucion_folio", `No hay un vale de salida con el folio ${texto(datos.devolucion_folio)}.`);
  }
  if (!texto(datos.origen)) error(null, "origen", "Falta de dónde viene el material.");
  const repetida = entradaConFolioBase(estado, datos.folio_externo, excluirValeId);
  if (repetida) {
    const mensaje = `El folio ${texto(datos.folio_externo)} ya se registró en la entrada ${folioEntrada(repetida.folio)} (${fmtFecha(repetida.fecha)}).`;
    avisos.push({ renglon: null, campo: "folio_externo", mensaje });
    if (!datos.folio_repetido) error(null, "folio_externo", `${mensaje} Si es otro vale con el mismo folio, márcalo para continuar.`);
  }
  if (!texto(datos.recibio_nombre)) error(null, "recibio_nombre", "Falta quién recibe: elige quién está en turno (arriba a la derecha).");
  const lineas = lineasEntradaCapturadas(datos.lineas);
  if (!lineas.length) error(null, "lineas", "La entrada no tiene partidas.");
  const indices = new Indices(estado);
  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!Number.isInteger(l.codigo) || l.codigo <= 0) error(n, "codigo", `Partida ${n}: falta el código.`);
    if (!texto(l.descripcion)) error(n, "descripcion", `Partida ${n}: falta la descripción.`);
    const cantidad = dec(l.cantidad);
    if (cantidad === null || cantidad.lte(0)) error(n, "cantidad", `Partida ${n}: la cantidad debe ser mayor que 0.`);
    if (!texto(l.um)) error(n, "um", `Partida ${n}: falta la unidad (UM).`);
    const destino = destinoDe(estado, l, indices);
    if (destino.tipo === "pendiente") error(n, "destino", `Partida ${n}: elige a qué renglón del inventario o contenedor entra.`);
    if (destino.tipo === "invalido") error(n, "destino", `Partida ${n}: el renglón o contenedor elegido ya no existe.`);
  });
  if (excluirValeId !== null && !errores.length) {
    for (const fila of vistaPreviaEntrada(estado, datos, { excluirValeId })) {
      if (fila.queda && fila.queda.lt(0)) {
        avisos.push({ renglon: fila.renglon, campo: "cantidad", mensaje: `Partida ${fila.renglon}: la existencia quedaría en ${decTexto(fila.queda)} (ya salió parte de lo que entró).` });
      }
    }
  }
  return { errores, avisos };
}

// ---------------------------------------------------------------- confirmar

// El vale de entrada solo pide de dónde viene: el departamento siempre es el almacén. Si las
// partidas se copiaron de un vale de salida (material que regresa), queda su folio como referencia.
function encabezadoEntrada(datos) {
  const devolucion = Boolean(texto(datos.devolucion_folio));
  return {
    motivo: devolucion ? "DEVOLUCION" : "BASE",
    folio_externo: textoONulo(datos.folio_externo),
    devolucion_folio: devolucion ? Number(texto(datos.devolucion_folio)) : null,
    fecha: texto(datos.fecha),
    origen: mayus(datos.origen),
    depto_origen: DEPTO_ALMACEN,
    destino: mayus(datos.destino) ?? ORIGEN_EQUIPO,
    depto_destino: mayus(datos.depto_destino) ?? DEPTO_ALMACEN,
    entrego_nombre: nombrePersona(datos.entrego_nombre),
    entrego_puesto: mayus(datos.entrego_puesto),
    recibio_nombre: nombrePersona(datos.recibio_nombre),
    recibio_puesto: mayus(datos.recibio_puesto),
    autorizo_nombre: null,
    autorizo_puesto: null,
    observaciones: textoONulo(datos.observaciones),
  };
}

/** Renglón guardado; crea la variante o el renglón del inventario si hacen falta. */
function lineaEntradaLimpia(estado, indices, l, renglon, id, origen) {
  const d = destinoDe(estado, l, indices);
  let existencia = null;
  let variante = null;
  if (d.tipo === "renglon") {
    existencia = d.existencia;
    variante = d.variante;
  } else if (d.tipo === "nuevo") {
    variante = d.variante ?? indices.obtenerOCrearVariante(l.codigo, mayus(l.dimension), mayus(l.np), unidad(l.um));
    existencia =
      renglonDe(estado, variante.id, d.ubicacion.id) ??
      crearRenglon(estado, indices, { varianteId: variante.id, ubicacionId: d.ubicacion.id, origen });
  }
  return {
    id,
    renglon,
    oc: mayus(l.oc),
    cantidad: decTexto(dec(l.cantidad)),
    codigo: l.codigo,
    descripcion: texto(l.descripcion).toUpperCase(),
    clave: existencia ? claveDeRenglon(dimensionMostrada(existencia, variante)) : (textoONulo(l.clave) ?? "S/D"),
    um: unidad(l.um) || null,
    lote: mayus(l.lote),
    variante_id: variante ? variante.id : null,
    existencia_id: existencia ? existencia.id : null,
    no_inventariado: !existencia,
    familia: null,
    transferencia_consumo: null,
    notas: l.notas ?? null,
  };
}

function asegurarArticulos(estado, indices, lineas) {
  for (const l of lineas) if (Number.isInteger(l.codigo)) indices.obtenerOCrearArticulo(l.codigo, texto(l.descripcion).toUpperCase(), "ENTRADA");
}

/**
 * Confirma un borrador de entrada: valida, asigna el folio interno (último + 1) y suma a
 * INGRESO de cada renglón (RF-36). Los renglones y variantes nuevos se crean aquí.
 */
export function confirmarEntrada(estado, borradorId, { usuario = null } = {}) {
  const guardado = borradorEntrada(estado, borradorId);
  if (!guardado) throw new ErrorEntrada("El borrador ya no existe (¿se confirmó en otra ventana?).");
  const datos = { ...guardado, recibio_nombre: usuario || guardado.recibio_nombre, lineas: lineasEntradaCapturadas(guardado.lineas) };
  const { errores } = validarEntrada(estado, datos);
  if (errores.length) throw new ErrorEntrada("La entrada tiene datos pendientes.", errores);
  const folio = siguienteFolio(estado, "ENTRADA");
  if (estado.vales.some((v) => v.tipo === "ENTRADA" && v.folio === folio)) throw new ErrorEntrada(`La entrada ${folioEntrada(folio)} ya existe. No se guardó nada.`);
  const indices = new Indices(estado);
  asegurarArticulos(estado, indices, datos.lineas);
  const encabezado = encabezadoEntrada(datos);
  if (!encabezado.recibio_puesto) encabezado.recibio_puesto = estado.personas.find((p) => p.nombre === encabezado.recibio_nombre)?.puesto ?? null;
  indices.persona(encabezado.entrego_nombre, { puesto: encabezado.entrego_puesto ?? undefined });
  const ahora = ahoraIso();
  const vale = {
    id: siguienteId(estado, "vale"),
    tipo: "ENTRADA",
    folio,
    estado: "EMITIDO",
    ...encabezado,
    plantilla_area_id: null,
    naturaleza: null,
    creado_por: usuario,
    creado_en: guardado.creado_en,
    emitido_en: ahora,
    modificado_en: null,
    migrado: false,
    notas: null,
    lineas: [],
  };
  vale.lineas = datos.lineas.map((l, i) => lineaEntradaLimpia(estado, indices, l, i + 1, siguienteId(estado, "vale_linea"), `ENTRADA ${folioEntrada(folio)}`));
  estado.vales.push(vale);
  descartarBorradorEntrada(estado, borradorId);
  auditar(estado, {
    usuario,
    entidad: "vale",
    entidadId: vale.id,
    accion: "EMITIR",
    despues: { entrada: folioEntrada(folio), folio_base: vale.folio_externo, renglones: vale.lineas.length },
  });
  return vale;
}

// ---------------------------------------------------------------- devoluciones

/**
 * Encabezado y renglones de una devolución a partir del vale de salida: cada renglón regresa
 * al mismo renglón del inventario del que salió (la cantidad se ajusta a lo que regresa).
 */
export function datosDeDevolucion(estado, folio) {
  const vale = valeDeSalida(estado, folio);
  if (!vale) throw new ErrorEntrada(`No hay un vale de salida con el folio ${texto(folio)}.`);
  const indices = new Indices(estado);
  const lineas = vale.lineas
    .filter((l) => Number.isInteger(l.codigo))
    .map((l) => {
      const base = { ...lineaEntradaVacia(), codigo: l.codigo, descripcion: l.descripcion ?? "", clave: l.clave ?? "", um: l.um ?? "", oc: l.oc ?? "", lote: l.lote ?? "", cantidad: l.cantidad ?? "" };
      const existencia = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
      if (existencia && existencia.activo !== false) return conRenglonExistente(estado, base, existencia.id, indices);
      return l.no_inventariado ? entradaSinExistencia(base) : entradaConArticulo(estado, base, l.codigo, { indices, descripcion: l.descripcion });
    });
  return {
    devolucion_folio: vale.folio,
    origen: vale.destino ?? "",
    entrego_nombre: vale.recibio_nombre ?? "",
    entrego_puesto: vale.recibio_puesto ?? "",
    lineas: lineas.length ? lineas : [lineaEntradaVacia()],
  };
}

// ---------------------------------------------------------------- corrección

/** Datos editables de una entrada confirmada. */
export function datosParaCorregirEntrada(estado, valeId) {
  const vale = estado.vales.find((v) => v.id === valeId && v.tipo === "ENTRADA");
  if (!vale) throw new ErrorEntrada("No existe la entrada.");
  const campos = ["fecha", "origen", "depto_origen", "destino", "depto_destino", "entrego_nombre", "entrego_puesto", "recibio_nombre", "recibio_puesto", "observaciones"];
  return {
    ...Object.fromEntries(campos.map((c) => [c, vale[c] ?? ""])),
    motivo: vale.motivo ?? "BASE",
    folio_externo: vale.folio_externo ?? "",
    folio_repetido: Boolean(entradaConFolioBase(estado, vale.folio_externo, vale.id)),
    devolucion_folio: vale.devolucion_folio ?? null,
    lineas: vale.lineas.map((l) => ({
      ...lineaEntradaVacia(),
      ...l,
      uid: `v${l.id}`,
      oc: l.oc ?? "",
      cantidad: l.cantidad ?? "",
      clave: l.clave ?? "",
      um: l.um ?? "",
      lote: l.lote ?? "",
      descripcion: l.descripcion ?? "",
      ubicacion_id: null,
      dimension: "",
      np: "",
    })),
  };
}

const ETIQUETAS = {
  fecha: "Fecha",
  folio_externo: "Folio del vale",
  devolucion_folio: "Partidas copiadas del vale",
  origen: "Viene de",
  destino: "Destino",
  depto_destino: "Depto. destino",
  entrego_nombre: "Entregó",
  entrego_puesto: "Puesto de quien entrega",
  recibio_nombre: "Recibió",
  observaciones: "Observaciones",
};

const describir = (l) => `${l.codigo ?? "?"} ${texto(l.descripcion).toUpperCase()}${texto(l.clave) ? ` ${texto(l.clave)}` : ""}`.trim();
const conUm = (l) => `${decTexto(dec(l.cantidad)) ?? texto(l.cantidad)} ${texto(l.um).toUpperCase()}`.trim();

/** Qué cambió en una corrección de entrada, en frases para la bitácora (prellena el motivo). */
export function resumenCambiosEntrada(estado, vale, datos) {
  const cambios = [];
  const indices = new Indices(estado);
  const valor = (campo, v) => (campo === "fecha" ? (v ? fmtFecha(v) : "") : texto(v).toUpperCase());
  const nuevo = encabezadoEntrada(datos);
  for (const [campo, etiqueta] of Object.entries(ETIQUETAS)) {
    const a = valor(campo, vale[campo]);
    const b = valor(campo, nuevo[campo]);
    if (a !== b) cambios.push(campo === "observaciones" ? "Se cambiaron las observaciones" : `${etiqueta}: ${a || "—"} → ${b || "—"}`);
  }
  const lugar = (l) => {
    const d = destinoDe(estado, l, indices);
    if (d.tipo === "sin_existencia") return "sin existencia";
    return d.ubicacion ? `${lugarCorto(d.ubicacion)}${d.tipo === "nuevo" ? " (renglón nuevo)" : ""}` : "—";
  };
  const previas = new Map(vale.lineas.map((l) => [l.id, l]));
  const siguen = new Set();
  lineasEntradaCapturadas(datos.lineas).forEach((l, i) => {
    const previa = Number.isInteger(l.id) ? previas.get(l.id) : null;
    if (!previa) {
      cambios.push(`Se agregó la partida ${i + 1}: ${describir(l)}, ${conUm(l)} → ${lugar(l)}`);
      return;
    }
    siguen.add(previa.id);
    const detalle = [];
    if (previa.codigo !== l.codigo) detalle.push(`código ${previa.codigo} → ${l.codigo}`);
    const ca = dec(previa.cantidad);
    const cb = dec(l.cantidad);
    if (!(ca && cb ? ca.eq(cb) : texto(previa.cantidad) === texto(l.cantidad))) detalle.push(`cantidad ${conUm(previa)} → ${conUm(l)}`);
    const antes = lugar(previa);
    const despues = lugar(l);
    if (texto(previa.clave).toUpperCase() !== texto(l.clave).toUpperCase()) detalle.push(`clave ${texto(previa.clave) || "—"} → ${texto(l.clave) || "—"}`);
    if (antes !== despues || (hay(previa.existencia_id) && previa.existencia_id !== l.existencia_id && texto(previa.clave) === texto(l.clave))) {
      detalle.push(`entra a ${despues} (antes ${antes})`);
    }
    if (texto(previa.oc).toUpperCase() !== texto(l.oc).toUpperCase()) detalle.push(`O.C. ${texto(previa.oc) || "S/OC"} → ${texto(l.oc) || "S/OC"}`);
    if (texto(previa.lote).toUpperCase() !== texto(l.lote).toUpperCase()) detalle.push(`lote ${texto(previa.lote) || "—"} → ${texto(l.lote) || "—"}`);
    if (detalle.length) cambios.push(`Partida ${i + 1} (${describir(previa)}): ${detalle.join("; ")}`);
  });
  vale.lineas.forEach((l) => {
    if (!siguen.has(l.id)) cambios.push(`Se quitó la partida ${l.renglon}: ${describir(l)}, ${conUm(l)}`);
  });
  return cambios;
}

const fotoEntrada = (vale) => structuredClone({ ...vale, lineas: vale.lineas });

/**
 * Corrige una entrada confirmada: motivo obligatorio, el folio no cambia y la bitácora guarda
 * antes → después. La existencia se recalcula sola.
 */
export function corregirEntrada(estado, valeId, datos, motivo, usuario = null) {
  const vale = estado.vales.find((v) => v.id === valeId && v.tipo === "ENTRADA");
  if (!vale) throw new ErrorEntrada("No existe la entrada.");
  if (!texto(motivo)) throw new ErrorEntrada("Escribe el motivo de la corrección.", [{ renglon: null, campo: "motivo", mensaje: "Falta el motivo." }]);
  datos = { ...datos, recibio_nombre: texto(datos.recibio_nombre) || vale.recibio_nombre, lineas: lineasEntradaCapturadas(datos.lineas) };
  const { errores } = validarEntrada(estado, datos, { excluirValeId: valeId });
  if (errores.length) throw new ErrorEntrada("La corrección tiene datos pendientes.", errores);
  const cambios = resumenCambiosEntrada(estado, vale, datos);
  if (!cambios.length) throw new ErrorEntrada("No hay cambios que guardar.", [{ renglon: null, campo: "vale", mensaje: "No cambiaste nada de la entrada." }]);
  const antes = fotoEntrada(vale);
  const indices = new Indices(estado);
  asegurarArticulos(estado, indices, datos.lineas);
  const encabezado = encabezadoEntrada(datos);
  indices.persona(encabezado.entrego_nombre, { puesto: encabezado.entrego_puesto ?? undefined });
  const previas = new Map(vale.lineas.map((l) => [l.id, l]));
  Object.assign(vale, encabezado, { recibio_puesto: encabezado.recibio_puesto ?? vale.recibio_puesto, modificado_en: ahoraIso() });
  vale.lineas = datos.lineas.map((l, i) => {
    const previa = Number.isInteger(l.id) ? previas.get(l.id) : null;
    return lineaEntradaLimpia(estado, indices, l, i + 1, previa ? previa.id : siguienteId(estado, "vale_linea"), `ENTRADA ${folioEntrada(vale.folio)}`);
  });
  quitarRenglonesSinUso(estado, `ENTRADA ${folioEntrada(vale.folio)}`);
  // "motivo" en la bitácora es el de la corrección; el de la entrada va como motivo_entrada.
  const { motivo: motivoEntrada, ...previo } = antes;
  auditar(estado, {
    usuario,
    entidad: "vale",
    entidadId: vale.id,
    accion: "CORREGIR",
    antes: { ...previo, motivo_entrada: motivoEntrada, motivo: texto(motivo), cambios },
    despues: fotoEntrada(vale),
  });
  return vale;
}

/**
 * Un renglón del inventario que creó una entrada y que, tras corregirla, ya no usa ningún vale
 * ni conteo se quita (nunca tuvo existencia propia): así no queda un renglón en 0 de más.
 */
function quitarRenglonesSinUso(estado, origen) {
  const usados = new Set();
  for (const v of estado.vales) for (const l of v.lineas) if (hay(l.existencia_id)) usados.add(l.existencia_id);
  for (const r of estado.reacomodos ?? []) usados.add(r.desde_existencia_id).add(r.hacia_existencia_id);
  estado.existencias = estado.existencias.filter(
    (e) => !(e.origen === origen && !usados.has(e.id) && !hay(e.conteo_id) && (dec(e.cantidad_conteo) ?? CERO).eq(0)),
  );
}

// ---------------------------------------------------------------- historial

/** Renglones del historial de entradas, más recientes primero (RF-34). */
export function filasEntradas(estado) {
  const indices = new Indices(estado);
  const vales = estado.vales.filter((v) => v.tipo === "ENTRADA").sort((a, b) => b.folio - a.folio);
  const filas = [];
  for (const vale of vales) {
    for (const l of vale.lineas) {
      const e = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
      const u = e ? indices.ubicacion(e.ubicacion_id) : null;
      filas.push({
        id: l.id,
        vale_id: vale.id,
        folio: vale.folio,
        folio_texto: folioEntrada(vale.folio),
        folio_externo: vale.folio_externo || (vale.motivo === "DEVOLUCION" ? `Dev. ${vale.devolucion_folio}` : ""),
        motivo: vale.motivo ?? "BASE",
        fecha: fmtFecha(vale.fecha),
        fecha_iso: vale.fecha || "",
        origen: vale.origen || "",
        cantidad: dec(l.cantidad) ? Number(dec(l.cantidad).toFixed()) : null,
        um: l.um || "",
        codigo: l.codigo,
        descripcion: l.descripcion || "",
        clave: l.clave || "",
        oc: l.oc || "S/OC",
        lugar: u ? lugarCorto(u) : l.no_inventariado ? "Sin existencia" : "—",
        hoja: u ? u.hoja_excel.trim() : "",
      });
    }
  }
  return filas;
}

/** Filtros del historial de entradas: fecha, folio de la base, código, O.C. y texto libre. */
export function filtrarEntradas(filas, { texto: libre = "", folio = "", codigo = "", oc = "", desde = "", hasta = "" } = {}) {
  const t = texto(libre).toUpperCase();
  const f = claveEstricta(folio);
  const c = texto(codigo);
  const o = texto(oc).toUpperCase();
  return filas.filter((r) => {
    if (desde && r.fecha_iso < desde) return false;
    if (hasta && r.fecha_iso > hasta) return false;
    if (c && String(r.codigo ?? "") !== c.replace(/^0+/, "")) return false;
    if (f && !claveEstricta(r.folio_externo).includes(f) && !claveEstricta(r.folio_texto).includes(f)) return false;
    if (o && !String(r.oc).toUpperCase().includes(o)) return false;
    if (t) {
      const todo = `${r.folio_texto} ${r.folio_externo} ${r.descripcion} ${r.clave} ${r.oc} ${r.origen} ${r.hoja} ${r.codigo}`.toUpperCase();
      if (!todo.includes(t)) return false;
    }
    return true;
  });
}
