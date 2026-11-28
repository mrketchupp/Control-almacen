// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §3): el vale de entrada en 4 pasos — De dónde viene → Material →
// Acomodo → Revisar y registrar —, como el de salida (Ronda 34). Aquí, sin navegador, en qué paso está un borrador de
// entrada, qué falta para pasar al siguiente y lo que el paso 1 ofrece de los datos (orígenes, puesto de quien entrega,
// lo que leyó Copilot). El paso se guarda en el borrador (`paso`, opcional: no cambia el formato del estado) y no llega
// a la entrada registrada (`confirmarEntrada` copia solo el encabezado).

import { cantidadEscrita } from "../nucleo/decimal.js";
import { Indices } from "../nucleo/estado.js";
import { avanceAcomodo } from "./acomodoEntrada.js";
import { aplicarEntradaIA, conNombres } from "./capturaIA.js";
import { prepararDeCopilot } from "./materialEntrada.js";
import { lineasEntradaCapturadas, validarEntrada } from "./entradas.js";

export const PASOS_ENTRADA = Object.freeze([
  Object.freeze({ numero: 1, nombre: "De dónde viene" }),
  Object.freeze({ numero: 2, nombre: "Material" }),
  Object.freeze({ numero: 3, nombre: "Acomodo" }),
  Object.freeze({ numero: 4, nombre: "Revisar y registrar" }),
]);

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mismo = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase();

/** El paso guardado; un borrador de antes de la Ronda 39 (sin paso) empieza en el 1, como uno nuevo. */
export const pasoDeEntrada = (borrador) => (PASOS_ENTRADA.some((p) => p.numero === borrador?.paso) ? borrador.paso : 1);

export const nombrePasoEntrada = (numero) => PASOS_ENTRADA.find((p) => p.numero === numero)?.nombre ?? "";

// Lo del encabezado que revisa `validarEntrada` (§3: para pasar del 1 al 2), con su texto corto para el paso.
const CORTOS = {
  folio_externo: "Falta el folio del vale",
  origen: "Falta de dónde viene",
  fecha: "Falta la fecha del vale",
  fecha_recibido: "Falta la fecha de recibido",
  recibio_nombre: "Elige quién está en turno (arriba a la derecha)",
};
const CAMPOS_PASO_1 = new Set([...Object.keys(CORTOS), "devolucion_folio"]);

/**
 * Lo que falta para pasar de *De dónde viene* a *Material*: lo que `validarEntrada` pide del encabezado (folio, de
 * dónde viene, las dos fechas, quién recibe). `usuario`: el almacenista en turno, que es quien recibe;
 * `excluirValeId`: en una corrección, la entrada misma (su folio no cuenta como repetido).
 * @returns [{ campo, mensaje }] con el texto corto ("Falta el folio del vale") o el de la regla que no se cumple.
 */
export function faltaDeDondeViene(estado, datos, { usuario = null, excluirValeId = null } = {}) {
  const { errores } = validarEntrada(estado, { ...datos, recibio_nombre: usuario || datos.recibio_nombre }, { excluirValeId });
  return errores
    .filter((e) => e.renglon === null && CAMPOS_PASO_1.has(e.campo))
    .map((e) => ({ campo: e.campo, mensaje: textoCorto(e) }));
}

// El folio repetido ya se explica junto a su casilla; debajo del campo basta con qué hacer.
function textoCorto(e) {
  if (/^Falta/.test(e.mensaje) && CORTOS[e.campo]) return CORTOS[e.campo];
  if (e.campo === "folio_externo") return "Ese folio ya está registrado: márcalo si es otro vale";
  return e.mensaje.replace(/\.$/, "");
}

/** De *Material* a *Acomodo* (§3): al menos una partida con código y cantidad. */
export function faltaMaterialEntrada(datos) {
  const alguna = lineasEntradaCapturadas(datos.lineas).some((l) => Number.isInteger(l.codigo) && cantidadEscrita(l.cantidad)?.gt(0));
  return alguna ? [] : [{ campo: "lineas", mensaje: "Agrega al menos una partida con su cantidad" }];
}

/** De *Acomodo* a *Revisar y registrar* (§3): ninguna partida sin acomodar (las «sin existencia» no se acomodan). */
export function faltaAcomodo(estado, datos, { indices = new Indices(estado) } = {}) {
  const { faltan } = avanceAcomodo(estado, lineasEntradaCapturadas(datos.lineas), { indices });
  return faltan.length ? [{ campo: "acomodo", mensaje: `${faltan.length === 1 ? "Falta 1 partida" : `Faltan ${faltan.length} partidas`} por acomodar` }] : [];
}

/** Lo que falta para avanzar desde `paso` (en el 4 no se avanza: se registra). */
export function faltaParaAvanzarEntrada(estado, datos, paso = pasoDeEntrada(datos), { usuario = null } = {}) {
  if (paso === 1) return faltaDeDondeViene(estado, datos, { usuario });
  if (paso === 2) return faltaMaterialEntrada(datos);
  if (paso === 3) return faltaAcomodo(estado, datos);
  return [];
}

// Lo que pide `validarEntrada` de cada partida, a qué paso lleva y con qué texto corto.
const PASO_DEL_CAMPO = { codigo: 2, descripcion: 2, cantidad: 2, um: 2, destino: 3 };
const CORTO_PARTIDA = {
  codigo: "falta el código",
  descripcion: "falta la descripción",
  um: "falta la unidad (U.M.)",
  destino: "falta acomodarla",
};

/**
 * *Antes de registrar* (§7): lo que se revisa (✓ o pendiente) y lo que impide registrar (los errores de
 * `validarEntrada`), cada uno con el paso y la partida o el campo que lo arregla.
 * @returns {{ revisado: [{ id, texto, listo, aviso? }], informa: [texto], bloquean: [{ paso, campo, uid, texto }] }}
 */
export function antesDeRegistrar(estado, datos, { usuario = null } = {}) {
  const lineas = lineasEntradaCapturadas(datos.lineas);
  const { errores } = validarEntrada(estado, { ...datos, recibio_nombre: usuario || datos.recibio_nombre });
  const bloquean = [];
  for (const e of errores) {
    if (e.renglon === null) {
      if (e.campo === "lineas") bloquean.push({ paso: 2, campo: "lineas", uid: null, texto: "La entrada no tiene partidas" });
      else bloquean.push({ paso: 1, campo: e.campo, uid: null, texto: textoCorto(e) });
      continue;
    }
    const l = lineas[e.renglon - 1];
    const corto = e.campo === "cantidad" ? (/número/.test(e.mensaje) ? "la cantidad no es un número" : "falta la cantidad") : CORTO_PARTIDA[e.campo];
    const frase = corto && !/3 dígitos/.test(e.mensaje) ? `Partida ${e.renglon}: ${corto}` : e.mensaje.replace(/\.$/, "");
    bloquean.push({ paso: PASO_DEL_CAMPO[e.campo] ?? 2, campo: e.campo, uid: l?.uid ?? null, texto: frase });
  }
  const conCantidad = lineas.filter((l) => cantidadEscrita(l.cantidad)?.gt(0)).length;
  const { faltan } = avanceAcomodo(estado, lineas);
  const dudosas = lineas.filter((l) => l.dudoso).length;
  const sinOc = lineas.filter((l) => !texto(l.oc) || /^S\s*\/?\s*O\.?\s*C\.?$/i.test(texto(l.oc))).length;
  const revisado = [
    { id: "cantidad", listo: lineas.length > 0 && conCantidad === lineas.length, texto: lineas.length && conCantidad === lineas.length ? `${conCantidad} ${conCantidad === 1 ? "partida" : "partidas"} con cantidad` : `${lineas.length - conCantidad} sin cantidad` },
    { id: "acomodo", listo: faltan.length === 0, texto: faltan.length ? `${faltan.length} sin acomodar` : "Todas acomodadas" },
    ...(lineas.some((l) => l.ia || l.dudoso)
      ? [{ id: "copilot", listo: dudosas === 0, aviso: dudosas > 0, texto: dudosas ? `${dudosas} de Copilot por revisar` : "Lo que Copilot no tenía claro ya se revisó" }]
      : []),
  ];
  const informa = [...(sinOc ? [`${sinOc} sin O.C. · se registran como S/OC`] : []), "O.C. y solicitante son opcionales"];
  return { revisado, informa, bloquean };
}

// ---------------------------------------------------------------- paso 1 · de dónde viene (§4)

// Qué entrada es más reciente: la hora en que se registró y, si coincide, el folio interno.
const reciente = (v) => `${texto(v.emitido_en ?? v.creado_en ?? v.fecha)}|${String(Number(v.folio) || 0).padStart(9, "0")}`;
const masRecientePrimero = (a, b) => (reciente(a) < reciente(b) ? 1 : reciente(a) > reciente(b) ? -1 : 0);

/**
 * Los orígenes de las entradas registradas, del más usado al menos (y, si empatan, el más reciente), para los botones
 * de *Viene de* (§2.3: de los datos, nunca una lista fija). Cada uno como se escribió la última vez.
 */
export function origenesFrecuentes(estado, { limite = 6 } = {}) {
  const porOrigen = new Map();
  for (const v of estado.vales ?? []) {
    if (v.tipo !== "ENTRADA" || !texto(v.origen)) continue;
    const clave = texto(v.origen).toUpperCase();
    const cuando = reciente(v);
    const actual = porOrigen.get(clave) ?? { origen: texto(v.origen), veces: 0, ultimo: "" };
    actual.veces += 1;
    if (cuando >= actual.ultimo) Object.assign(actual, { ultimo: cuando, origen: texto(v.origen) });
    porOrigen.set(clave, actual);
  }
  return [...porOrigen.values()]
    .sort((a, b) => b.veces - a.veces || (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : 0))
    .slice(0, limite)
    .map((o) => o.origen);
}

/** ¿`origen` es uno de los botones? (sin distinguir mayúsculas) */
export const esOrigenFrecuente = (origenes, origen) => origenes.some((o) => mismo(o, origen));

/**
 * El puesto con que entregó esa persona la última vez (§4: «se llena con el último», como en salida); si nunca entregó
 * una entrada, el de la lista de personas.
 */
export function puestoDeQuienEntrega(estado, nombre) {
  if (!texto(nombre)) return "";
  const entradas = (estado.vales ?? []).filter((v) => v.tipo === "ENTRADA" && mismo(v.entrego_nombre, nombre) && texto(v.entrego_puesto));
  entradas.sort(masRecientePrimero);
  if (entradas.length) return texto(entradas[0].entrego_puesto);
  return texto((estado.personas ?? []).find((p) => mismo(p.nombre, nombre))?.puesto);
}

/** Quienes han entregado entradas (los más recientes primero) y luego la lista de personas, para sugerir el nombre. */
export function quienesEntregan(estado) {
  const nombres = [];
  const entradas = (estado.vales ?? []).filter((v) => v.tipo === "ENTRADA" && texto(v.entrego_nombre));
  entradas.sort(masRecientePrimero);
  for (const v of entradas) if (!nombres.some((n) => mismo(n, v.entrego_nombre))) nombres.push(texto(v.entrego_nombre));
  for (const p of estado.personas ?? []) if (p.activo !== false && texto(p.nombre) && !nombres.some((n) => mismo(n, p.nombre))) nombres.push(texto(p.nombre));
  return nombres;
}

// ---------------------------------------------------------------- llenar con Copilot (§4.1)

/**
 * Lo que la respuesta de Copilot dejaría en el borrador, sin guardarlo todavía (la ventana lo muestra y «Ver las
 * partidas →» lo aplica): el borrador lleno, lo leído del vale y el resumen de las partidas.
 * @returns {{ datos, leido: { origen, folio, fecha, entrego }, partidas, porRevisar, variantesNuevas, sinCodigo, sinClave, reporte }}
 *   (`reporte`: el de `aplicarEntradaIA`, con los números de partida de cada caso)
 */
export function leerRespuestaCopilot(estado, borrador, respuesta) {
  const { datos: llenos, reporte } = aplicarEntradaIA(estado, borrador, respuesta);
  // Las partidas como las leyó `aplicarEntradaIA` (mismos nombres y orden), para decir qué leyó Copilot en las dudosas.
  const vale = Array.isArray(respuesta) ? { partidas: respuesta } : conNombres(respuesta, "vale");
  const partidas = (Array.isArray(vale?.partidas) ? vale.partidas : []).filter((p) => p && typeof p === "object").map((p) => conNombres(p, "partida"));
  // Ronda 39: cada partida con su tipo y, solo si su variante vive en un solo contenedor, ya acomodada (§6).
  const datos = { ...llenos, lineas: prepararDeCopilot(estado, borrador.lineas, llenos.lineas, partidas) };
  return {
    datos,
    leido: { origen: texto(datos.origen), folio: texto(datos.folio_externo), fecha: texto(datos.fecha), entrego: texto(datos.entrego_nombre) },
    partidas: reporte.partidas,
    porRevisar: reporte.dudosas.length,
    variantesNuevas: reporte.nuevas,
    sinCodigo: reporte.sinCodigo.length,
    sinClave: reporte.sinClave.length,
    reporte,
  };
}
