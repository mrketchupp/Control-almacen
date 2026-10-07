// Respaldos: un .zip con el estado (JSON), las plantillas de Excel y un manifiesto.
// Funciones puras (sin navegador) para poder probarlas.

import { FORMATO_ESTADO } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { INVENTARIO_DEFECTO, inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { bytesATexto, crearZip, descomprimirZip } from "../xlsx/zip.js";

export const ARCHIVO_ESTADO = "estado.json";
export const ARCHIVO_MANIFIESTO = "manifiesto.json";
export const CARPETA_PLANTILLAS = "plantillas/";
export const CARPETA_FOTOS = "fotos/";
// almacen_AAAA-MM-DD_HHMMSS_motivo.zip (DLTA) · almacen_GSM_AAAA-MM-DD_HHMMSS_motivo.zip (GSM)
const patron = (inventario) => new RegExp(`^${inventarioPorId(inventario).respaldo}(\\d{4}-\\d{2}-\\d{2})_(\\d{2})(\\d{2})(\\d{2})(?:_(.+))?\\.zip$`);

export class ErrorRespaldo extends Error {}

function limpiarMotivo(motivo) {
  return (
    String(motivo || "manual")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "manual"
  );
}

/** almacen_AAAA-MM-DD_HHMMSS_<motivo>.zip (en GSM, almacen_GSM_…). */
export function nombreRespaldo(fechaHora, motivo, inventario = INVENTARIO_DEFECTO) {
  const [fecha, hora] = fechaHora.split("T");
  return `${inventarioPorId(inventario).respaldo}${fecha}_${hora.replace(/:/g, "").slice(0, 6)}_${limpiarMotivo(motivo)}.zip`;
}

/** Fecha y motivo de un respaldo de ESE inventario por su nombre; null si no es suyo. */
export function infoDeNombre(nombre, inventario = INVENTARIO_DEFECTO) {
  const m = patron(inventario).exec(nombre);
  if (!m) return null;
  return { nombre, fecha_hora: `${m[1]}T${m[2]}:${m[3]}:${m[4]}`, fecha: m[1], motivo: m[5] || "" };
}

/**
 * @param plantillas  [{ archivo, datos: Uint8Array }]
 * @returns {{ nombre, datos: Uint8Array, fecha_hora }}
 */
export function crearRespaldo(estado, plantillas, { motivo = "manual", version = "", ahora = ahoraIso(), fotos = [] } = {}) {
  if (!estado) throw new ErrorRespaldo("No hay datos que respaldar.");
  const inventario = inventarioDe(estado).id;
  const manifiesto = {
    aplicacion: "Control de Almacén RIG 91",
    inventario,
    version_app: version,
    formato_estado: estado.formato,
    fecha_hora: ahora,
    motivo,
    vales: estado.vales.length,
    existencias: estado.existencias.length,
    plantillas: plantillas.map((p) => p.archivo),
    fotos: fotos.length,
  };
  const datos = crearZip([
    [ARCHIVO_MANIFIESTO, JSON.stringify(manifiesto, null, 2)],
    [ARCHIVO_ESTADO, JSON.stringify(estado)],
    ...plantillas.map((p) => [`${CARPETA_PLANTILLAS}${p.archivo}`, p.datos]),
    // Las fotos ya son JPEG comprimido: el .zip solo las guarda.
    ...fotos.map((f) => [f.clave.startsWith(CARPETA_FOTOS) ? f.clave : `${CARPETA_FOTOS}${f.clave}`, f.datos]),
  ]);
  return { nombre: nombreRespaldo(ahora, motivo, inventario), datos, fecha_hora: ahora };
}

/** Valida y abre un respaldo. @returns {{ estado, plantillas: [{archivo, datos}], manifiesto }} */
export function leerRespaldo(datos) {
  let partes;
  try {
    partes = descomprimirZip(datos);
  } catch {
    throw new ErrorRespaldo("El archivo no es un respaldo válido (no es un .zip).");
  }
  if (partes.has("almacen.db")) {
    throw new ErrorRespaldo(
      "Este respaldo es de la versión de escritorio (base SQLite) y no se puede abrir en la versión web.",
    );
  }
  if (!partes.has(ARCHIVO_ESTADO)) throw new ErrorRespaldo("El archivo no contiene datos de Control de Almacén.");
  let estado;
  try {
    estado = JSON.parse(bytesATexto(partes.get(ARCHIVO_ESTADO)));
  } catch {
    throw new ErrorRespaldo("Los datos del respaldo están dañados (JSON inválido).");
  }
  validarEstado(estado);
  const manifiesto = partes.has(ARCHIVO_MANIFIESTO) ? JSON.parse(bytesATexto(partes.get(ARCHIVO_MANIFIESTO))) : {};
  const plantillas = [];
  const fotos = [];
  for (const [nombre, contenido] of partes) {
    if (nombre.startsWith(CARPETA_PLANTILLAS) && nombre.length > CARPETA_PLANTILLAS.length) {
      plantillas.push({ archivo: nombre.slice(CARPETA_PLANTILLAS.length), datos: contenido });
    } else if (nombre.startsWith(CARPETA_FOTOS) && nombre.length > CARPETA_FOTOS.length) {
      fotos.push({ clave: nombre, datos: contenido });
    }
  }
  for (const registro of estado.plantillas_excel) {
    if (!plantillas.some((p) => p.archivo === registro.archivo)) {
      throw new ErrorRespaldo(`Al respaldo le falta la plantilla ${registro.archivo}.`);
    }
  }
  return { estado, plantillas, fotos, manifiesto };
}

/**
 * Un respaldo solo se restaura en su inventario: uno de DLTA no entra en GSM ni al revés (los
 * anteriores a GSM son de DLTA). @returns el inventario del respaldo
 */
export function revisarInventario(estado, actual) {
  const de = inventarioDe(estado).id;
  const aqui = inventarioPorId(actual).id;
  if (de !== aqui) {
    throw new ErrorRespaldo(`Ese respaldo es del inventario ${de} y estás en ${aqui}. Cámbiate a ${de} (arriba, junto al nombre de la herramienta) para restaurarlo.`);
  }
  return de;
}

export function validarEstado(estado) {
  const colecciones = ["variantes", "ubicaciones", "conteos", "existencias", "personas", "vales", "plantillas_excel"];
  if (!estado || typeof estado !== "object" || colecciones.some((c) => !Array.isArray(estado[c]))) {
    throw new ErrorRespaldo("El archivo no contiene datos de Control de Almacén.");
  }
  if (typeof estado.formato !== "number" || estado.formato > FORMATO_ESTADO) {
    throw new ErrorRespaldo("El respaldo es de una versión más nueva de la herramienta. Actualiza la página.");
  }
  const folios = new Set();
  for (const vale of estado.vales) {
    if (vale.folio === null || vale.folio === undefined) continue;
    const clave = `${vale.tipo}:${vale.folio}`;
    if (folios.has(clave)) throw new ErrorRespaldo(`Datos inconsistentes: el folio ${clave} está repetido.`);
    folios.add(clave);
  }
}

/**
 * Conserva el último respaldo de cada uno de los últimos `diarios` días y de los últimos
 * `mensuales` meses. Solo considera los del `inventario` (los del otro no se tocan).
 * @returns nombres a borrar
 */
export function respaldosABorrar(nombres, { diarios = 30, mensuales = 12, inventario = INVENTARIO_DEFECTO } = {}) {
  const respaldos = nombres
    .map((n) => infoDeNombre(n, inventario))
    .filter(Boolean)
    .sort((a, b) => (a.fecha_hora < b.fecha_hora ? 1 : a.fecha_hora > b.fecha_hora ? -1 : 0));
  const dias = new Map();
  const meses = new Map();
  for (const r of respaldos) {
    if (!dias.has(r.fecha)) dias.set(r.fecha, r.nombre);
    const mes = r.fecha.slice(0, 7);
    if (!meses.has(mes)) meses.set(mes, r.nombre);
  }
  const conservar = new Set([...[...dias.values()].slice(0, diarios), ...[...meses.values()].slice(0, mensuales)]);
  return respaldos.filter((r) => !conservar.has(r.nombre)).map((r) => r.nombre);
}
