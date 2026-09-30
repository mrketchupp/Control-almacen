// Vales de salida (Fase 2): borradores, validación, emisión con folio, corrección,
// cancelación y envíos a la base. Funciones puras sobre el estado: la interfaz las
// ejecuta dentro de Almacen.modificar(), que las vuelve atómicas (todo o nada).
//
// Ver docs/05-flujos.md §1 y §3 y los requerimientos RF-10 a RF-21.

import { conEtapa, esInterna, etapaDe, tieneEtapa } from "../nucleo/areas.js";
import { CERO, aNumero, dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, dimensionMostrada, npMostrado, siguienteId, ultimoConteo, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, hoyIso } from "../nucleo/fechas.js";
import { claveEstricta, nombrePersona, unidad } from "../nucleo/normalizar.js";

export const CAPACIDAD_DEFECTO = 21;
export const CAMPOS_ENCABEZADO = [
  "fecha", "origen", "depto_origen", "destino", "depto_destino",
  "entrego_nombre", "entrego_puesto", "recibio_nombre", "recibio_puesto", "autorizo_nombre", "observaciones",
];

export class ErrorVale extends Error {
  constructor(mensaje, errores = []) {
    super(mensaje);
    this.errores = errores;
  }
}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const textoONulo = (v) => texto(v) || null;
const mayus = (v) => textoONulo(v)?.toUpperCase() ?? null;

// ---------------------------------------------------------------- consultas

export function siguienteFolio(estado, tipo = "SALIDA") {
  let maximo = 0;
  for (const v of estado.vales) if (v.tipo === tipo && v.folio > maximo) maximo = v.folio;
  const minimo = Number(estado.config?.[`folio_minimo_${tipo.toLowerCase()}`] || 0);
  return Math.max(maximo + 1, minimo);
}

export function plantillaArea(estado, id) {
  return estado.plantillas_area.find((p) => p.id === id) ?? null;
}

function puestoDe(estado, nombre) {
  return estado.personas.find((p) => p.nombre === nombre)?.puesto ?? null;
}

/**
 * CLAVE ALMACÉN con la que se escribe un renglón, como en el DIARIO: la dimensión,
 * "NP:…" si solo hay número de parte, o ambos ("3/8 NP:4900-10").
 */
export function claveParaVale(dimension, np) {
  const dim = texto(dimension);
  const numero = texto(np).replace(/^N\.?P\.?\s*:?\s*/i, "");
  const conDim = claveEstricta(dim) !== "";
  const conNp = claveEstricta(numero) !== "";
  if (conDim && conNp) return `${dim} NP:${numero}`;
  if (conDim) return dim;
  if (conNp) return `NP:${numero}`;
  return dim || "S/D";
}

// ---------------------------------------------------------------- borradores

function lineaBase() {
  return {
    uid: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    codigo: null,
    descripcion: "",
    existencia_id: null,
    variante_id: null,
    no_inventariado: false,
    clave: "",
    um: "",
    cantidad: "",
    oc: "",
    lote: "",
    justificacion: "",
  };
}

/** Renglón a partir de un renglón del inventario (sale de ese contenedor). */
export function lineaDesdeExistencia(estado, existenciaId, indices = new Indices(estado)) {
  const existencia = indices.existencia(existenciaId);
  const variante = indices.variante(existencia.variante_id);
  return {
    ...lineaBase(),
    codigo: variante.codigo,
    descripcion: indices.articulo(variante.codigo)?.descripcion ?? "",
    existencia_id: existencia.id,
    variante_id: variante.id,
    clave: claveParaVale(dimensionMostrada(existencia, variante), npMostrado(existencia, variante)),
    um: umMostrada(existencia, variante) || "",
  };
}

/** ¿Renglón sin capturar? (la fila vacía lista para escribir el siguiente código) */
export const lineaEnBlanco = (l) => !Number.isInteger(l.codigo) && !texto(l.cantidad) && !texto(l.clave);

/** Renglones capturados (sin las filas vacías). */
export const lineasCapturadas = (lineas) => (lineas ?? []).filter((l) => !lineaEnBlanco(l));

/** Renglón en blanco para capturar código → clave → cantidad. */
export function lineaVacia(lote = "") {
  return { ...lineaBase(), lote: lote ?? "" };
}

/**
 * Renglones del inventario de un código, para elegir la CLAVE ALMACÉN (y con ella de qué
 * contenedor sale). Cada opción trae su lugar y la existencia actual.
 */
export function opcionesDeClave(estado, codigo, { indices = new Indices(estado), saldos = null } = {}) {
  if (!Number.isInteger(codigo)) return [];
  const existencias = estado.existencias.filter((e) => e.activo !== false && indices.variante(e.variante_id).codigo === codigo);
  const totales = saldos ?? calcularSaldos(estado, existencias.map((e) => e.id));
  return existencias
    .map((e) => {
      const v = indices.variante(e.variante_id);
      const u = indices.ubicacion(e.ubicacion_id);
      return {
        id: e.id,
        clave: claveParaVale(dimensionMostrada(e, v), npMostrado(e, v)),
        lugar: `#${u.contenedor} ${u.clase === "INV" ? "Inv." : "Cons."}`,
        hoja: u.hoja_excel.trim(),
        total: aNumero(totales.get(e.id)?.total ?? CERO),
        um: umMostrada(e, v) || "",
        orden: u.orden * 100000 + e.orden,
      };
    })
    .sort((a, b) => a.orden - b.orden);
}

/** El renglón con el artículo elegido. Si solo está en un renglón del inventario, se asigna solo (RF-12). */
export function conArticulo(estado, linea, codigo, { indices = new Indices(estado), descripcion = null } = {}) {
  const opciones = opcionesDeClave(estado, codigo, { indices });
  const base = {
    ...linea,
    codigo,
    descripcion: estado.articulos[codigo]?.descripcion ?? descripcion ?? linea.descripcion ?? "",
    existencia_id: null,
    variante_id: null,
    clave: "",
    um: "",
    no_inventariado: opciones.length === 0,
    justificacion: "",
  };
  return opciones.length === 1 ? conExistencia(estado, base, opciones[0].id, indices) : base;
}

/** El renglón saliendo de un renglón del inventario (fija clave, UM y contenedor). */
export function conExistencia(estado, linea, existenciaId, indices = new Indices(estado)) {
  const d = lineaDesdeExistencia(estado, existenciaId, indices);
  return {
    ...linea,
    codigo: d.codigo,
    descripcion: d.descripcion,
    existencia_id: d.existencia_id,
    variante_id: d.variante_id,
    clave: d.clave,
    um: d.um || linea.um,
    no_inventariado: false,
  };
}

/** Renglón de un artículo del catálogo que no lleva existencia (diésel, gases, servicios). */
export function lineaNoInventariada(estado, codigo, descripcion = null) {
  return {
    ...lineaBase(),
    codigo,
    descripcion: descripcion ?? estado.articulos[codigo]?.descripcion ?? "",
    no_inventariado: true,
    clave: "S/D",
  };
}

/** Aplica al borrador los datos de la plantilla del área (RF-11). */
export function aplicarPlantilla(estado, borrador, plantillaId) {
  const p = plantillaArea(estado, plantillaId);
  borrador.plantilla_area_id = p ? p.id : null;
  if (!p) return borrador;
  Object.assign(borrador, {
    origen: p.origen ?? "",
    depto_origen: p.depto_origen ?? "",
    destino: p.destino ?? "",
    depto_destino: p.depto_destino ?? "",
    recibio_nombre: p.recibe_nombre ?? "",
    recibio_puesto: p.recibe_puesto ?? "",
    autorizo_nombre: p.autoriza_nombre ?? "",
    observaciones: p.observaciones ?? "",
    naturaleza: p.naturaleza || "CONSUMO",
  });
  borrador.observaciones = observacionesDelVale(estado, borrador) ?? "";
  if (p.lote_defecto) for (const l of borrador.lineas) if (!l.lote) l.lote = p.lote_defecto;
  return borrador;
}

export function nuevoBorrador(estado, { usuario = null, plantillaId = null, fecha = hoyIso() } = {}) {
  const borrador = {
    id: siguienteId(estado, "borrador"),
    tipo: "SALIDA",
    creado_en: ahoraIso(),
    actualizado_en: ahoraIso(),
    creado_por: usuario,
    plantilla_area_id: null,
    fecha,
    origen: "",
    depto_origen: "",
    destino: "",
    depto_destino: "",
    entrego_nombre: usuario ?? "",
    entrego_puesto: usuario ? (puestoDe(estado, usuario) ?? "ALMACENISTA") : "",
    recibio_nombre: "",
    recibio_puesto: "",
    autorizo_nombre: "",
    observaciones: "",
    etapa_perforacion: estado.config?.etapa_perforacion ?? "",
    naturaleza: "CONSUMO",
    lineas: [],
  };
  if (plantillaId) aplicarPlantilla(estado, borrador, plantillaId);
  estado.borradores.push(borrador);
  return borrador;
}

export function borrador(estado, id) {
  return estado.borradores.find((b) => b.id === id) ?? null;
}

export function descartarBorrador(estado, id) {
  estado.borradores = estado.borradores.filter((b) => b.id !== id);
}

/**
 * Observaciones con las que sale el vale. En las áreas internas el texto es el del área y
 * solo cambia la etapa de perforación; en las demás, lo que se escribió en el vale.
 */
export function observacionesDelVale(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const etapa = texto(datos.etapa_perforacion);
  if (esInterna(area) && tieneEtapa(area.observaciones) && etapa) return conEtapa(area.observaciones, etapa);
  return datos.observaciones;
}

/** En un área interna, origen y destino son siempre los del área (RIG 91 · ALMACEN → RIG 91 · depto). */
export function conDatosFijos(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  if (!esInterna(area)) return datos;
  return { ...datos, origen: area.origen ?? "", depto_origen: area.depto_origen ?? "", destino: area.destino ?? "", depto_destino: area.depto_destino ?? "" };
}

/** ¿Este vale pide la etapa de perforación? (área interna cuyas observaciones la llevan) */
export function pideEtapa(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  return esInterna(area) && tieneEtapa(area.observaciones);
}

/** Entregó: siempre el almacenista en turno, con su puesto. */
export function conEntregaEnTurno(estado, datos, usuario) {
  if (!texto(usuario)) return datos;
  return { ...datos, entrego_nombre: usuario, entrego_puesto: puestoDe(estado, usuario) || "ALMACENISTA" };
}

// ---------------------------------------------------------------- validación

/** ¿Requiere "Autorizó"? Solo transferencias o áreas marcadas así (P-14). */
export function requiereAutoriza(estado, datos) {
  const p = plantillaArea(estado, datos.plantilla_area_id);
  return Boolean(p?.requiere_autoriza) || datos.naturaleza === "TRANSFERENCIA";
}

/**
 * Existencia disponible por renglón de inventario. Con `excluirValeId`, se devuelve
 * lo que ese vale consumía (para validar una corrección).
 */
export function disponibles(estado, ids, excluirValeId = null) {
  const saldos = calcularSaldos(estado, ids);
  const salida = new Map();
  for (const [id, saldo] of saldos) salida.set(id, saldo.total);
  if (excluirValeId !== null) {
    const vale = estado.vales.find((v) => v.id === excluirValeId);
    if (vale && vale.estado === "EMITIDO") {
      for (const l of vale.lineas) {
        if (l.existencia_id !== null && salida.has(l.existencia_id)) {
          salida.set(l.existencia_id, salida.get(l.existencia_id).plus(dec(l.cantidad) ?? CERO));
        }
      }
    }
  }
  return salida;
}

/**
 * @returns {{ errores: [{renglon, campo, mensaje}], avisos: [{renglon, disponible, pedido}] }}
 * renglon es 1..n (null = encabezado). Los avisos de existencia se vuelven error si el
 * renglón no trae justificación.
 */
export function validarVale(estado, datos, { excluirValeId = null, historial = false } = {}) {
  const errores = [];
  const avisos = [];
  const error = (renglon, campo, mensaje) => errores.push({ renglon, campo, mensaje });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(datos.fecha))) error(null, "fecha", "Falta la fecha.");
  if (historial) {
    // Vale anterior al conteo: solo es historial (no descuenta), se corrige con lo mínimo.
    lineasCapturadas(datos.lineas).forEach((l, i) => {
      if (!Number.isInteger(l.codigo) || l.codigo <= 0) error(i + 1, "codigo", `Renglón ${i + 1}: falta el código.`);
    });
    return { errores, avisos };
  }
  if (!texto(datos.depto_destino) && !texto(datos.destino)) error(null, "depto_destino", "Falta el destino o departamento que recibe.");
  if (!texto(datos.entrego_nombre)) error(null, "entrego_nombre", "Falta quién entrega: elige quién está en turno (arriba a la derecha).");
  if (!texto(datos.recibio_nombre)) error(null, "recibio_nombre", "Falta quién recibe.");
  if (excluirValeId === null && pideEtapa(estado, datos) && !texto(datos.etapa_perforacion)) {
    error(null, "etapa_perforacion", "Falta la etapa de perforación.");
  }
  if (requiereAutoriza(estado, datos) && !texto(datos.autorizo_nombre)) {
    error(null, "autorizo_nombre", "Esta área requiere que alguien autorice.");
  }
  const lineas = lineasCapturadas(datos.lineas);
  if (!lineas.length) error(null, "lineas", "El vale no tiene partidas.");
  const indices = new Indices(estado);
  const pedidos = new Map();
  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!Number.isInteger(l.codigo) || l.codigo <= 0) error(n, "codigo", `Renglón ${n}: falta el código.`);
    if (!texto(l.descripcion)) error(n, "descripcion", `Renglón ${n}: falta la descripción.`);
    const cantidad = dec(l.cantidad);
    if (cantidad === null || cantidad.lte(0)) error(n, "cantidad", `Renglón ${n}: la cantidad debe ser mayor que 0.`);
    if (!texto(l.um)) error(n, "um", `Renglón ${n}: falta la unidad (UM).`);
    if (l.existencia_id !== null && l.existencia_id !== undefined) {
      if (!indices.existencia(l.existencia_id)) error(n, "existencia_id", `Renglón ${n}: el renglón de inventario ya no existe.`);
      else if (cantidad !== null) pedidos.set(l.existencia_id, (pedidos.get(l.existencia_id) ?? CERO).plus(cantidad));
    } else if (!l.no_inventariado) {
      error(n, "existencia_id", `Renglón ${n}: elige la clave de la lista (o "Otra clave" si no sale del inventario).`);
    }
  });
  if (pedidos.size) {
    const disponible = disponibles(estado, [...pedidos.keys()], excluirValeId);
    lineas.forEach((l, i) => {
      if (l.existencia_id === null || l.existencia_id === undefined || !pedidos.has(l.existencia_id)) return;
      const hay = disponible.get(l.existencia_id) ?? CERO;
      const pedido = pedidos.get(l.existencia_id);
      if (pedido.gt(hay)) {
        avisos.push({ renglon: i + 1, disponible: hay, pedido });
        if (!texto(l.justificacion)) {
          error(i + 1, "justificacion", `Renglón ${i + 1}: la existencia es ${decTexto(hay)} y pides ${decTexto(pedido)}; escribe una justificación.`);
        }
      }
    });
  }
  return { errores, avisos };
}

// ---------------------------------------------------------------- emisión

function encabezadoLimpio(datos) {
  return {
    fecha: texto(datos.fecha),
    origen: mayus(datos.origen),
    depto_origen: mayus(datos.depto_origen),
    destino: mayus(datos.destino),
    depto_destino: mayus(datos.depto_destino),
    entrego_nombre: nombrePersona(datos.entrego_nombre),
    entrego_puesto: mayus(datos.entrego_puesto),
    recibio_nombre: nombrePersona(datos.recibio_nombre),
    recibio_puesto: mayus(datos.recibio_puesto),
    autorizo_nombre: nombrePersona(datos.autorizo_nombre),
    observaciones: textoONulo(datos.observaciones),
  };
}

function lineaLimpia(estado, l, renglon, id) {
  return {
    id,
    renglon,
    oc: mayus(l.oc),
    cantidad: decTexto(dec(l.cantidad)),
    codigo: l.codigo,
    descripcion: texto(l.descripcion).toUpperCase(),
    clave: textoONulo(l.clave) ?? (l.no_inventariado ? "S/D" : null),
    um: unidad(l.um) || null,
    lote: mayus(l.lote),
    variante_id: l.existencia_id !== null && l.existencia_id !== undefined ? (l.variante_id ?? null) : null,
    existencia_id: l.existencia_id ?? null,
    no_inventariado: Boolean(l.no_inventariado) && (l.existencia_id === null || l.existencia_id === undefined),
    familia: l.familia ?? null,
    transferencia_consumo: l.transferencia_consumo ?? null,
    encabezado_original: l.encabezado_original ?? null,
    fila_diario_origen: l.fila_diario_origen ?? null,
    notas: l.notas ?? null,
    justificacion: textoONulo(l.justificacion),
  };
}

/** Da de alta (por confirmar) los códigos que no están en el catálogo. */
function asegurarArticulos(estado, lineas) {
  const indices = new Indices(estado);
  for (const l of lineas) if (Number.isInteger(l.codigo)) indices.obtenerOCrearArticulo(l.codigo, texto(l.descripcion).toUpperCase(), "VALE");
}

function registrarPersonas(estado, encabezado) {
  const indices = new Indices(estado);
  indices.persona(encabezado.entrego_nombre, { puesto: encabezado.entrego_puesto ?? undefined });
  indices.persona(encabezado.recibio_nombre, { puesto: encabezado.recibio_puesto ?? undefined });
  indices.persona(encabezado.autorizo_nombre);
}

/**
 * Emite un borrador: valida, asigna el siguiente folio y lo agrega al historial.
 * Si tiene más renglones que el formato impreso, se divide en folios consecutivos
 * (solo con `dividir: true`, P-16).
 * @returns los vales emitidos
 */
export function emitirBorrador(estado, borradorId, { usuario = null, capacidad = CAPACIDAD_DEFECTO, dividir = false } = {}) {
  const guardado = borrador(estado, borradorId);
  if (!guardado) throw new ErrorVale("El borrador ya no existe (¿se emitió en otra ventana?).");
  const datos = conDatosFijos(estado, conEntregaEnTurno(estado, guardado, usuario));
  datos.observaciones = observacionesDelVale(estado, datos);
  datos.lineas = lineasCapturadas(datos.lineas);
  const { errores } = validarVale(estado, datos);
  if (errores.length) throw new ErrorVale("El vale tiene datos pendientes.", errores);
  const grupos = [];
  for (let i = 0; i < datos.lineas.length; i += capacidad) grupos.push(datos.lineas.slice(i, i + capacidad));
  if (grupos.length > 1 && !dividir) {
    throw new ErrorVale(
      `El vale tiene ${datos.lineas.length} renglones y el formato impreso admite ${capacidad}. Se puede dividir en ${grupos.length} folios consecutivos.`,
      [{ renglon: null, campo: "lineas", mensaje: "Demasiados renglones para un solo formato." }],
    );
  }
  const encabezado = encabezadoLimpio(datos);
  asegurarArticulos(estado, datos.lineas);
  registrarPersonas(estado, encabezado);
  const ahora = ahoraIso();
  const emitidos = [];
  let folio = siguienteFolio(estado, "SALIDA");
  for (const grupo of grupos) {
    if (estado.vales.some((v) => v.tipo === "SALIDA" && v.folio === folio)) {
      throw new ErrorVale(`El folio ${folio} ya existe. No se emitió nada.`);
    }
    const vale = {
      id: siguienteId(estado, "vale"),
      tipo: "SALIDA",
      folio,
      folio_externo: null,
      estado: "EMITIDO",
      ...encabezado,
      plantilla_area_id: datos.plantilla_area_id ?? null,
      naturaleza: datos.naturaleza || "CONSUMO",
      creado_por: usuario,
      creado_en: datos.creado_en,
      emitido_en: ahora,
      enviado_en: null,
      cambio: siguienteId(estado, "cambio"),
      modificado_en: null,
      cancelado_en: null,
      motivo_cancelacion: null,
      migrado: false,
      notas: grupos.length > 1 ? `Dividido en ${grupos.length} folios consecutivos por límite del formato.` : null,
      lineas: grupo.map((l, i) => lineaLimpia(estado, l, i + 1, siguienteId(estado, "vale_linea"))),
    };
    estado.vales.push(vale);
    emitidos.push(vale);
    folio += 1;
  }
  descartarBorrador(estado, borradorId);
  // La etapa usada queda como la actual para los siguientes vales.
  if (pideEtapa(estado, datos)) estado.config.etapa_perforacion = texto(datos.etapa_perforacion);
  auditar(estado, {
    usuario,
    entidad: "vale",
    entidadId: emitidos.map((v) => v.id).join(","),
    accion: "EMITIR",
    despues: { folios: emitidos.map((v) => v.folio), renglones: datos.lineas.length },
  });
  return emitidos;
}

// ---------------------------------------------------------------- corrección y cancelación

function foto(vale) {
  const { lineas, ...resto } = vale;
  return {
    ...resto,
    lineas: lineas.map(({ id, renglon, oc, cantidad, codigo, descripcion, clave, um, lote, existencia_id, no_inventariado }) => ({
      id, renglon, oc, cantidad, codigo, descripcion, clave, um, lote, existencia_id, no_inventariado,
    })),
  };
}

/** ¿El vale es anterior al conteo vigente? (ya está reflejado en CANTIDAD; no descuenta) */
export function esHistorial(estado, vale) {
  const conteo = ultimoConteo(estado);
  return Boolean(conteo) && vale.folio !== null && vale.folio <= conteo.ultimo_folio_salida;
}

/** Datos editables de un vale emitido (para abrirlo en el editor de corrección). */
export function datosParaCorregir(estado, valeId) {
  const vale = estado.vales.find((v) => v.id === valeId);
  if (!vale) throw new ErrorVale("No existe el vale.");
  return {
    ...Object.fromEntries(CAMPOS_ENCABEZADO.map((c) => [c, vale[c] ?? ""])),
    plantilla_area_id: vale.plantilla_area_id ?? null,
    naturaleza: vale.naturaleza || "CONSUMO",
    etapa_perforacion: etapaDe(vale.observaciones) ?? "",
    lineas: vale.lineas.map((l) => ({
      ...lineaBase(),
      ...l,
      uid: `v${l.id}`,
      oc: l.oc ?? "",
      cantidad: l.cantidad ?? "",
      clave: l.clave ?? "",
      um: l.um ?? "",
      lote: l.lote ?? "",
      justificacion: l.justificacion ?? "",
      descripcion: l.descripcion ?? "",
    })),
  };
}

/**
 * Corrige un vale emitido (RF-19): motivo obligatorio, el folio no cambia y la bitácora
 * guarda antes → después. La existencia se recalcula sola.
 */
export function corregirVale(estado, valeId, datos, motivo, usuario = null) {
  const vale = estado.vales.find((v) => v.id === valeId);
  if (!vale) throw new ErrorVale("No existe el vale.");
  if (vale.estado === "CANCELADO") throw new ErrorVale("Un vale cancelado no se corrige.");
  if (!texto(motivo)) throw new ErrorVale("Escribe el motivo de la corrección.", [{ renglon: null, campo: "motivo", mensaje: "Falta el motivo." }]);
  const { errores } = validarVale(estado, datos, { excluirValeId: valeId, historial: esHistorial(estado, vale) });
  if (errores.length) throw new ErrorVale("La corrección tiene datos pendientes.", errores);
  datos = { ...datos, lineas: lineasCapturadas(datos.lineas) };
  const antes = foto(vale);
  const encabezado = encabezadoLimpio({ ...datos, observaciones: observacionesDelVale(estado, datos) });
  asegurarArticulos(estado, datos.lineas);
  registrarPersonas(estado, encabezado);
  const previas = new Map(vale.lineas.map((l) => [l.id, l]));
  Object.assign(vale, encabezado, {
    plantilla_area_id: datos.plantilla_area_id ?? vale.plantilla_area_id ?? null,
    naturaleza: datos.naturaleza || vale.naturaleza,
    modificado_en: ahoraIso(),
    cambio: siguienteId(estado, "cambio"),
  });
  vale.lineas = datos.lineas.map((l, i) => {
    const previa = Number.isInteger(l.id) ? previas.get(l.id) : null;
    const nueva = lineaLimpia(estado, { ...previa, ...l }, i + 1, previa ? previa.id : siguienteId(estado, "vale_linea"));
    // Si el renglón cambió, el encabezado propio de la migración ya no aplica.
    if (previa && JSON.stringify(foto({ lineas: [previa] }).lineas[0]) !== JSON.stringify(foto({ lineas: [nueva] }).lineas[0])) {
      nueva.encabezado_original = null;
    }
    return nueva;
  });
  auditar(estado, { usuario, entidad: "vale", entidadId: vale.id, accion: "CORREGIR", antes: { motivo: texto(motivo), ...antes }, despues: foto(vale) });
  return vale;
}

/** Cancela un vale (RF-20): el folio no se reutiliza y la existencia se revierte. */
export function cancelarVale(estado, valeId, motivo, usuario = null) {
  const vale = estado.vales.find((v) => v.id === valeId);
  if (!vale) throw new ErrorVale("No existe el vale.");
  if (vale.estado === "CANCELADO") throw new ErrorVale("El vale ya está cancelado.");
  if (!texto(motivo)) throw new ErrorVale("Escribe el motivo de la cancelación.");
  const antes = { estado: vale.estado };
  vale.estado = "CANCELADO";
  vale.cancelado_en = ahoraIso();
  vale.motivo_cancelacion = texto(motivo).toUpperCase();
  vale.modificado_en = vale.cancelado_en;
  vale.cambio = siguienteId(estado, "cambio");
  auditar(estado, { usuario, entidad: "vale", entidadId: vale.id, accion: "CANCELAR", antes, despues: { estado: "CANCELADO", motivo: vale.motivo_cancelacion } });
  return vale;
}

export function bitacoraDeVale(estado, valeId) {
  return estado.auditoria.filter(
    (a) => a.entidad === "vale" && String(a.entidad_id ?? "").split(",").includes(String(valeId)),
  );
}

// ---------------------------------------------------------------- envíos a la base

export function ultimoEnvio(estado) {
  return estado.envios.length ? estado.envios[estado.envios.length - 1] : null;
}

/**
 * Vales nuevos, corregidos o cancelados desde el último envío (RF-21). Cada cambio a un
 * vale toma un número de un contador; el envío recuerda hasta qué número incluyó.
 * Los vales migrados del Excel ya se habían enviado.
 */
export function valesPorEnviar(estado) {
  const desde = ultimoEnvio(estado)?.hasta_cambio ?? 0;
  return estado.vales
    .filter((v) => v.tipo === "SALIDA" && (v.cambio ?? 0) > desde)
    .map((v) => ({
      vale: v,
      motivo: v.estado === "CANCELADO" ? "cancelado" : v.migrado || v.enviado_en ? "corregido" : "nuevo",
    }))
    .sort((a, b) => a.vale.folio - b.vale.folio);
}

export function registrarEnvio(estado, usuario = null) {
  const pendientes = valesPorEnviar(estado);
  const ahora = ahoraIso();
  for (const { vale } of pendientes) if (!vale.enviado_en) vale.enviado_en = ahora;
  const envio = {
    id: siguienteId(estado, "envio"),
    fecha_hora: ahora,
    usuario,
    hasta_cambio: estado.secuencias.cambio ?? 0,
    ultimo_folio: estado.vales.filter((v) => v.tipo === "SALIDA").reduce((m, v) => Math.max(m, v.folio ?? 0), 0),
    folios: pendientes.map((p) => p.vale.folio),
  };
  estado.envios.push(envio);
  auditar(estado, { usuario, entidad: "envio", entidadId: envio.id, accion: "ENVIAR", despues: { folios: envio.folios } });
  return envio;
}
