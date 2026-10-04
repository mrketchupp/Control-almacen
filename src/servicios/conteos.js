// Conteo físico (Fase 3, RF-40): total o por contenedor. Mientras se captura vive en
// `conteo_en_curso` y no cambia el inventario. Al aplicarlo, en cada renglón contado
// CANTIDAD = contado y CONSUMO / INGRESO vuelven a empezar (el renglón apunta al conteo
// nuevo, con su folio de corte). Los renglones no contados conservan su conteo anterior.
// El conteo guarda, por renglón, lo que había antes, para el historial.
//
// Ver docs/05-flujos.md §4.

import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, siguienteId } from "../nucleo/estado.js";
import { calcularSaldos, cuentaParaSaldo } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha, hoyIso } from "../nucleo/fechas.js";
import { claveEstricta, claveLaxa, unidad } from "../nucleo/normalizar.js";
import { crearRenglon, describirRenglon, lugarCorto, renglonDe, ubicacionesOrdenadas } from "./inventario.js";
import { siguienteFolio } from "./vales.js";

export class ErrorConteo extends Error {
  constructor(mensaje, errores = []) {
    super(mensaje);
    this.errores = errores;
  }
}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mayus = (v) => texto(v).toUpperCase() || null;

/** Último folio emitido de cada tipo: el corte que queda en el conteo. */
export function foliosActuales(estado) {
  return { salida: siguienteFolio(estado, "SALIDA") - 1, entrada: siguienteFolio(estado, "ENTRADA") - 1 };
}

/** Inicia la captura de un conteo. `ubicaciones` = ids (null o vacío = todo el inventario). */
export function iniciarConteo(estado, { ubicaciones = null, usuario = null, fecha = hoyIso() } = {}) {
  if (estado.conteo_en_curso) throw new ErrorConteo("Ya hay un conteo en captura: aplícalo o descártalo antes de empezar otro.");
  const todas = ubicacionesOrdenadas(estado).map((u) => u.id);
  const elegidas = Array.isArray(ubicaciones) && ubicaciones.length ? todas.filter((id) => ubicaciones.includes(id)) : todas;
  if (!elegidas.length) throw new ErrorConteo("Elige al menos un contenedor para contar.");
  estado.conteo_en_curso = {
    id: siguienteId(estado, "conteo_en_curso"),
    iniciado_en: ahoraIso(),
    iniciado_por: usuario,
    fecha,
    total: elegidas.length === todas.length,
    ubicaciones: elegidas,
    corte: foliosActuales(estado),
    capturas: {},
    nuevos: [],
    observaciones: "",
  };
  auditar(estado, { usuario, entidad: "conteo", accion: "INICIAR", despues: { ubicaciones: elegidas.length, total: elegidas.length === todas.length } });
  return estado.conteo_en_curso;
}

export function descartarConteo(estado, usuario = null) {
  if (!estado.conteo_en_curso) return;
  const contados = Object.keys(estado.conteo_en_curso.capturas ?? {}).length;
  estado.conteo_en_curso = null;
  auditar(estado, { usuario, entidad: "conteo", accion: "DESCARTAR", despues: { contados } });
}

/** Guarda lo capturado (lo llama la pantalla mientras se escribe). */
export function guardarConteoEnCurso(estado, datos) {
  if (!estado.conteo_en_curso) throw new ErrorConteo("No hay un conteo en captura.");
  const actual = estado.conteo_en_curso;
  estado.conteo_en_curso = {
    ...actual,
    fecha: texto(datos.fecha) || actual.fecha,
    capturas: Object.fromEntries(Object.entries(datos.capturas ?? {}).filter(([, v]) => texto(v) !== "")),
    nuevos: (datos.nuevos ?? []).map((n) => ({ ...n })),
    observaciones: texto(datos.observaciones),
  };
}

/** Renglón encontrado que no está en la lista (sobrante): se captura con su contenedor. */
export function nuevoSobrante(ubicacionId = null) {
  return {
    uid: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ubicacion_id: ubicacionId,
    codigo: null,
    descripcion: "",
    variante_id: null,
    dimension: "",
    np: "",
    um: "",
    cantidad: "",
  };
}

/**
 * Renglones del conteo con su teórico (TOTAL actual), lo contado y la diferencia.
 * @returns [{ id, ubicacion_id, hoja, lugar, codigo, descripcion, dimension, np, um, teorico, contado, diferencia }]
 */
export function renglonesDelConteo(estado, datos = estado.conteo_en_curso, { indices = new Indices(estado), saldos = null } = {}) {
  if (!datos) return [];
  const dentro = new Set(datos.ubicaciones);
  const totales = saldos ?? calcularSaldos(estado);
  const orden = new Map(datos.ubicaciones.map((id, i) => [id, i]));
  return estado.existencias
    .filter((e) => e.activo !== false && dentro.has(e.ubicacion_id))
    .sort((a, b) => orden.get(a.ubicacion_id) - orden.get(b.ubicacion_id) || a.orden - b.orden)
    .map((e) => {
      const r = describirRenglon(estado, e.id, { indices, saldos: totales });
      const capturado = datos.capturas?.[e.id];
      const contado = texto(capturado) === "" ? null : dec(capturado);
      return {
        id: e.id,
        ubicacion_id: e.ubicacion_id,
        hoja: r.hoja,
        lugar: r.lugar,
        codigo: r.codigo,
        descripcion: r.descripcion,
        dimension: r.dimension,
        np: r.np,
        um: r.um,
        teorico: r.total,
        capturado: texto(capturado),
        contado,
        diferencia: contado === null ? null : contado.minus(r.total),
      };
    });
}

/** Vales emitidos después de empezar el conteo que tocan renglones contados (pueden contarse doble). */
export function valesDuranteConteo(estado, datos = estado.conteo_en_curso) {
  if (!datos) return [];
  const contados = new Set([...Object.keys(datos.capturas ?? {})].map(Number));
  const salida = [];
  for (const v of estado.vales) {
    if (v.estado !== "EMITIDO") continue;
    const corte = v.tipo === "ENTRADA" ? datos.corte.entrada : datos.corte.salida;
    if (!(v.folio > corte)) continue;
    const renglones = v.lineas.filter((l) => contados.has(l.existencia_id)).length;
    if (renglones) salida.push({ vale_id: v.id, tipo: v.tipo, folio: v.folio, renglones });
  }
  return salida.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.folio - b.folio);
}

/** Resumen para la pantalla: cuántos se contaron, cuántos faltan y cuántos difieren. */
export function resumenConteo(estado, datos = estado.conteo_en_curso) {
  const filas = renglonesDelConteo(estado, datos);
  const contados = filas.filter((f) => f.contado !== null);
  return {
    renglones: filas.length,
    contados: contados.length,
    faltan: filas.length - contados.length,
    con_diferencia: contados.filter((f) => !f.diferencia.eq(0)).length,
    sobrantes: (datos?.nuevos ?? []).filter((n) => Number.isInteger(n.codigo)).length,
  };
}

export function validarConteo(estado, datos = estado.conteo_en_curso) {
  const errores = [];
  const error = (id, campo, mensaje) => errores.push({ id, campo, mensaje });
  if (!datos) return [{ id: null, campo: "conteo", mensaje: "No hay un conteo en captura." }];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(datos.fecha))) error(null, "fecha", "Falta la fecha del conteo.");
  const dentro = new Set(estado.existencias.filter((e) => e.activo !== false && datos.ubicaciones.includes(e.ubicacion_id)).map((e) => e.id));
  for (const [id, valor] of Object.entries(datos.capturas ?? {})) {
    if (!dentro.has(Number(id))) continue;
    const n = dec(valor);
    if (n === null || n.lt(0)) error(Number(id), "contado", `Lo contado debe ser un número (0 o más): "${valor}".`);
  }
  const sobrantes = (datos.nuevos ?? []).filter((s) => Number.isInteger(s.codigo) || texto(s.cantidad));
  sobrantes.forEach((s, i) => {
    const n = i + 1;
    if (!Number.isInteger(s.codigo)) error(s.uid, "codigo", `Partida encontrada ${n}: falta el código.`);
    if (!datos.ubicaciones.includes(s.ubicacion_id)) error(s.uid, "ubicacion", `Partida encontrada ${n}: elige el contenedor donde está.`);
    const c = dec(s.cantidad);
    if (c === null || c.lte(0)) error(s.uid, "cantidad", `Partida encontrada ${n}: la cantidad debe ser mayor que 0.`);
    if (!unidad(s.um)) error(s.uid, "um", `Partida encontrada ${n}: falta la unidad (UM).`);
  });
  const contados = Object.keys(datos.capturas ?? {}).filter((id) => dentro.has(Number(id))).length;
  if (!contados && !sobrantes.length) error(null, "capturas", "No se ha capturado ninguna partida.");
  return errores;
}

/**
 * Aplica el conteo. El corte (último folio de salida y de entrada ya reflejados en lo contado) es
 * el del momento en que empezó el conteo; con `corteAlAplicar` se toma el de ahora (cuando los
 * vales emitidos mientras se contaba ya estaban descontados de lo que se contó).
 * @returns el conteo guardado
 */
export function aplicarConteo(estado, { usuario = null, corteAlAplicar = false } = {}) {
  const datos = estado.conteo_en_curso;
  const errores = validarConteo(estado, datos);
  if (errores.length) throw new ErrorConteo("El conteo tiene datos pendientes.", errores);
  const indices = new Indices(estado);
  const saldos = calcularSaldos(estado);
  const corte = corteAlAplicar ? foliosActuales(estado) : datos.corte;
  const nombres = datos.ubicaciones.map((id) => lugarCorto(indices.ubicacion(id)));
  const conteo = indices.agregarConteo({
    fecha: datos.fecha,
    descripcion: datos.total ? "Conteo físico total" : `Conteo físico parcial (${nombres.join(", ")})`,
    alcance: datos.total ? "TOTAL" : "PARCIAL",
    ubicaciones: [...datos.ubicaciones],
    usuario,
    ultimo_folio_salida: corte.salida,
    ultimo_folio_entrada: corte.entrada,
    aplicado_en: ahoraIso(),
    observaciones: texto(datos.observaciones) || null,
    lineas: [],
    nuevos: [],
  });
  const dentro = new Set(datos.ubicaciones);
  for (const [id, valor] of Object.entries(datos.capturas ?? {})) {
    const existencia = indices.existencia(Number(id));
    if (!existencia || existencia.activo === false || !dentro.has(existencia.ubicacion_id)) continue;
    const saldo = saldos.get(existencia.id);
    conteo.lineas.push({
      existencia_id: existencia.id,
      contado: decTexto(dec(valor)),
      teorico: decTexto(saldo ? saldo.total : CERO),
      cantidad_anterior: existencia.cantidad_conteo,
      conteo_anterior_id: existencia.conteo_id ?? null,
    });
    existencia.cantidad_conteo = decTexto(dec(valor));
    existencia.conteo_id = conteo.id;
  }
  for (const s of (datos.nuevos ?? []).filter((n) => Number.isInteger(n.codigo))) {
    indices.obtenerOCrearArticulo(s.codigo, texto(s.descripcion).toUpperCase(), "CONTEO");
    const variante = Number.isInteger(s.variante_id)
      ? indices.variante(s.variante_id)
      : indices.obtenerOCrearVariante(s.codigo, mayus(s.dimension), mayus(s.np), unidad(s.um));
    const cantidad = decTexto(dec(s.cantidad));
    const previo = renglonDe(estado, variante.id, s.ubicacion_id);
    if (previo && !conteo.lineas.some((l) => l.existencia_id === previo.id)) {
      // Ya estaba en ese contenedor: cuenta como renglón contado.
      conteo.lineas.push({
        existencia_id: previo.id,
        contado: cantidad,
        teorico: decTexto(saldos.get(previo.id)?.total ?? CERO),
        cantidad_anterior: previo.cantidad_conteo,
        conteo_anterior_id: previo.conteo_id ?? null,
      });
      previo.cantidad_conteo = cantidad;
      previo.conteo_id = conteo.id;
      continue;
    }
    const renglon = crearRenglon(estado, indices, {
      varianteId: variante.id,
      ubicacionId: s.ubicacion_id,
      cantidad,
      conteoId: conteo.id,
      origen: `CONTEO ${fmtFecha(datos.fecha)}`,
    });
    conteo.nuevos.push(renglon.id);
    conteo.lineas.push({ existencia_id: renglon.id, contado: cantidad, teorico: "0", cantidad_anterior: null, conteo_anterior_id: null });
  }
  estado.conteo_en_curso = null;
  const diferencias = conteo.lineas.filter((l) => !dec(l.contado).eq(dec(l.teorico))).length;
  auditar(estado, {
    usuario,
    entidad: "conteo",
    entidadId: conteo.id,
    accion: "APLICAR",
    despues: { alcance: conteo.alcance, renglones: conteo.lineas.length, diferencias, nuevos: conteo.nuevos.length, corte },
  });
  return conteo;
}

/** Historial de conteos, del más reciente al más antiguo. */
export function historialConteos(estado) {
  const indices = new Indices(estado);
  const vigentes = new Map();
  for (const e of estado.existencias) if (e.activo !== false && e.conteo_id != null) vigentes.set(e.conteo_id, (vigentes.get(e.conteo_id) ?? 0) + 1);
  return [...estado.conteos]
    .filter((c) => c.tipo !== "REACOMODO")
    .reverse()
    .map((c) => {
      const lineas = c.lineas ?? [];
      const diferencias = lineas
        .filter((l) => !dec(l.contado).eq(dec(l.teorico) ?? CERO))
        .map((l) => {
          const r = describirRenglon(estado, l.existencia_id, { indices, saldos: new Map() });
          return {
            existencia_id: l.existencia_id,
            lugar: r?.lugar ?? "",
            codigo: r?.codigo ?? null,
            descripcion: r?.descripcion ?? "",
            clave: r ? [r.dimension, r.np ? `NP ${r.np}` : ""].filter(Boolean).join(" · ") : "",
            um: r?.um ?? "",
            teorico: dec(l.teorico),
            contado: dec(l.contado),
            diferencia: dec(l.contado).minus(dec(l.teorico) ?? CERO),
            nuevo: (c.nuevos ?? []).includes(l.existencia_id),
          };
        });
      return {
        id: c.id,
        fecha: c.fecha,
        descripcion: c.descripcion ?? (c.alcance === "PARCIAL" ? "Conteo parcial" : "Conteo total"),
        alcance: c.alcance ?? "TOTAL",
        usuario: c.usuario ?? null,
        renglones: lineas.length,
        vigentes: vigentes.get(c.id) ?? 0,
        corte_salida: c.ultimo_folio_salida,
        corte_entrada: c.ultimo_folio_entrada ?? 0,
        diferencias,
        inicial: !c.lineas,
      };
    });
}

/** ¿El renglón de vale descuenta / suma en su renglón del inventario? (por el corte de su conteo) */
export function lineaCuenta(estado, vale, linea) {
  if (linea.existencia_id === null || linea.existencia_id === undefined) return false;
  const e = estado.existencias.find((x) => x.id === linea.existencia_id);
  if (!e) return false;
  return cuentaParaSaldo(estado.conteos.find((c) => c.id === e.conteo_id), vale);
}

/** Para buscar sobrantes: variantes de un código (clave, UM y dónde está). */
export function variantesDeCodigo(estado, codigo, { indices = new Indices(estado) } = {}) {
  if (!Number.isInteger(codigo)) return [];
  return estado.variantes
    .filter((v) => v.codigo === codigo && v.activo !== false)
    .map((v) => ({
      id: v.id,
      dimension: v.dimension ?? "",
      np: v.np ?? "",
      um: v.um ?? "",
      lugares: estado.existencias.filter((e) => e.variante_id === v.id && e.activo !== false).map((e) => lugarCorto(indices.ubicacion(e.ubicacion_id))),
      clave: claveLaxa(`${v.dimension ?? ""}${v.np ?? ""}`) || claveEstricta(v.dimension),
    }));
}
