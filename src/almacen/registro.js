// Registro de lo que pasa con carpetas y archivos (Ronda 30, a sugerencia del usuario): qué se pidió al explorador
// de Edge y qué respondió, permisos, lo arrastrado desde Windows y cada guardado del reporte diario, con el nombre
// y el mensaje exacto de cada error. Sirve para diagnosticar en el equipo del usuario lo que no se puede reproducir
// aquí: se copia o se descarga desde *Reporte diario → Carpetas…* y se pega en la conversación.
//
// Vive solo en este navegador (localStorage, las últimas MAXIMO entradas; si no se puede, solo en memoria): nunca
// sale del equipo ni va en los respaldos. Corre también en Node (pruebas), sin localStorage.

import { ahoraIso } from "../nucleo/fechas.js";

const CLAVE = "control-almacen:registro-archivos";
export const MAXIMO_REGISTRO = 300;

let entradas = null;
const oyentes = new Set();

function almacenamiento() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function cargar() {
  if (entradas) return entradas;
  try {
    const leidas = JSON.parse(almacenamiento()?.getItem(CLAVE) ?? "[]");
    entradas = Array.isArray(leidas) ? leidas : [];
  } catch {
    entradas = [];
  }
  return entradas;
}

function guardar() {
  try {
    almacenamiento()?.setItem(CLAVE, JSON.stringify(entradas));
  } catch {
    // sin almacenamiento local: el registro dura mientras la página esté abierta
  }
}

/** "AbortError — The user aborted a request." (y su causa, si la trae). */
export function textoError(error) {
  if (!error) return "";
  if (typeof error !== "object") return String(error);
  const propio = `${error.name ?? "Error"}${error.message ? ` — ${error.message}` : ""}`;
  return error.cause && error.cause !== error ? `${propio} (causa: ${textoError(error.cause)})` : propio;
}

/** Cómo se anota lo que entregó el explorador: "carpeta «INVENTARIO DIARIO»", "archivo «x.xlsm»". */
export function describirHandle(handle) {
  if (Array.isArray(handle)) return handle.length ? handle.map(describirHandle).join(", ") : "nada (lista vacía)";
  if (!handle) return "nada";
  const clase = handle.kind === "directory" ? "carpeta" : handle.kind === "file" ? "archivo" : (handle.kind ?? typeof handle);
  return `${clase} «${handle.name ?? "?"}»`;
}

/** Anota un paso. `que`: explorador, permiso, arrastrar, carpetas, descargar, guardar…; `error`, si falló. */
export function anotar(que, detalle = "", error = null) {
  const lista = cargar();
  lista.push({ en: ahoraIso(), que, detalle: String(detalle ?? ""), ...(error ? { error: textoError(error) } : {}) });
  if (lista.length > MAXIMO_REGISTRO) lista.splice(0, lista.length - MAXIMO_REGISTRO);
  guardar();
  for (const oyente of oyentes) oyente();
}

export const registro = () => [...cargar()];

export function borrarRegistro() {
  entradas = [];
  guardar();
  for (const oyente of oyentes) oyente();
}

export function suscribirRegistro(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** El registro como texto para pegar en la conversación: primero el entorno (`entorno`: [[clave, valor]]). */
export function textoRegistro(entorno = []) {
  const lineas = ["Registro de carpetas y archivos — Control de Almacén", ...entorno.map(([k, v]) => `${k}: ${v}`), ""];
  for (const e of cargar()) lineas.push(`${e.en.replace("T", " ")}  [${e.que}] ${e.detalle}${e.error ? `  ✗ ${e.error}` : ""}`);
  if (!cargar().length) lineas.push("(sin entradas)");
  return lineas.join("\n");
}
