// Lectura y escritura de ZIP (los .xlsx/.xlsm son ZIP de partes XML).
//
// Al reescribir, las partes que no cambiaron se copian con sus bytes comprimidos
// originales: quedan idénticas al archivo del usuario, no solo "equivalentes".

import { deflateSync, inflateSync } from "fflate";

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

export class ErrorZip extends Error {}

const codificador = new TextEncoder();
const decodificador = new TextDecoder("utf-8");

export function aBytes(datos) {
  if (datos instanceof Uint8Array) return datos;
  if (datos instanceof ArrayBuffer) return new Uint8Array(datos);
  if (ArrayBuffer.isView(datos)) return new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength);
  throw new ErrorZip("Datos binarios no válidos");
}

export const textoABytes = (texto) => codificador.encode(texto);
export const bytesATexto = (bytes) => decodificador.decode(bytes);

// ------------------------------------------------------------------ CRC-32

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ lectura

/**
 * Lee el directorio central. Devuelve las entradas en el orden del archivo:
 * { nombre, metodo, banderas, hora, fecha, crc, comprimido (Uint8Array), tamano,
 *   atributosExternos, versionHecho, versionNecesaria }
 */
export function leerZip(datos) {
  const bytes = aBytes(datos);
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErrorZip("El archivo no es un libro de Excel válido (no es ZIP).");
  const total = vista.getUint16(fin + 10, true);
  let posicion = vista.getUint32(fin + 16, true);
  if (posicion === 0xffffffff) throw new ErrorZip("ZIP64 no soportado.");
  const entradas = [];
  for (let i = 0; i < total; i++) {
    if (vista.getUint32(posicion, true) !== FIRMA_CENTRAL) throw new ErrorZip("Directorio ZIP dañado.");
    const versionHecho = vista.getUint16(posicion + 4, true);
    const versionNecesaria = vista.getUint16(posicion + 6, true);
    const banderas = vista.getUint16(posicion + 8, true);
    const metodo = vista.getUint16(posicion + 10, true);
    const hora = vista.getUint16(posicion + 12, true);
    const fecha = vista.getUint16(posicion + 14, true);
    const crc = vista.getUint32(posicion + 16, true);
    const tamComprimido = vista.getUint32(posicion + 20, true);
    const tamano = vista.getUint32(posicion + 24, true);
    const largoNombre = vista.getUint16(posicion + 28, true);
    const largoExtra = vista.getUint16(posicion + 30, true);
    const largoComentario = vista.getUint16(posicion + 32, true);
    const atributosExternos = vista.getUint32(posicion + 38, true);
    const desplazamiento = vista.getUint32(posicion + 42, true);
    const nombre = decodificador.decode(bytes.subarray(posicion + 46, posicion + 46 + largoNombre));
    if (vista.getUint32(desplazamiento, true) !== FIRMA_LOCAL) throw new ErrorZip("Entrada ZIP dañada.");
    const inicio =
      desplazamiento + 30 + vista.getUint16(desplazamiento + 26, true) + vista.getUint16(desplazamiento + 28, true);
    entradas.push({
      nombre,
      metodo,
      banderas,
      hora,
      fecha,
      crc,
      comprimido: bytes.subarray(inicio, inicio + tamComprimido),
      tamano,
      atributosExternos,
      versionHecho,
      versionNecesaria,
    });
    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

export function descomprimir(entrada) {
  if (entrada.metodo === 0) return entrada.comprimido;
  if (entrada.metodo === 8) return inflateSync(entrada.comprimido, { out: new Uint8Array(entrada.tamano) });
  throw new ErrorZip(`Método de compresión no soportado (${entrada.metodo}) en ${entrada.nombre}`);
}

/** Todas las partes descomprimidas: Map nombre → Uint8Array (en orden). */
export function descomprimirZip(datos) {
  const partes = new Map();
  for (const entrada of leerZip(datos)) partes.set(entrada.nombre, descomprimir(entrada));
  return partes;
}

// ----------------------------------------------------------------- escritura

function fechaDos(fecha = new Date()) {
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1);
  const dia = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  return { hora, fecha: dia };
}

/** Entrada nueva (se comprime al escribir). */
export function entradaNueva(nombre, datos, { comprimir = true, fecha } = {}) {
  const bytes = typeof datos === "string" ? textoABytes(datos) : aBytes(datos);
  const comprimido = comprimir ? deflateSync(bytes, { level: 6 }) : bytes;
  const dos = fecha ? fecha : fechaDos();
  return {
    nombre,
    metodo: comprimir ? 8 : 0,
    banderas: 0,
    hora: dos.hora,
    fecha: dos.fecha,
    crc: crc32(bytes),
    comprimido,
    tamano: bytes.length,
    atributosExternos: 0,
    versionHecho: 20,
    versionNecesaria: 20,
  };
}

/** Reemplaza el contenido de una entrada conservando nombre, fecha y atributos. */
export function reemplazarEntrada(entrada, datos) {
  const nueva = entradaNueva(entrada.nombre, datos, { fecha: { hora: entrada.hora, fecha: entrada.fecha } });
  nueva.banderas = entrada.banderas & 0x0006; // opción de compresión; sin descriptor ni cifrado
  nueva.atributosExternos = entrada.atributosExternos;
  nueva.versionHecho = entrada.versionHecho;
  nueva.versionNecesaria = Math.max(20, entrada.versionNecesaria);
  return nueva;
}

export function escribirZip(entradas) {
  const nombres = entradas.map((e) => textoABytes(e.nombre));
  let tamano = 22;
  entradas.forEach((e, i) => {
    tamano += 30 + nombres[i].length + e.comprimido.length + 46 + nombres[i].length;
  });
  const salida = new Uint8Array(tamano);
  const vista = new DataView(salida.buffer);
  let p = 0;
  const desplazamientos = [];
  entradas.forEach((e, i) => {
    const nombre = nombres[i];
    const utf8 = /[^\x20-\x7e]/.test(e.nombre) ? 0x0800 : 0;
    const banderas = (e.banderas & ~0x0008) | utf8;
    desplazamientos.push(p);
    vista.setUint32(p, FIRMA_LOCAL, true);
    vista.setUint16(p + 4, e.versionNecesaria || 20, true);
    vista.setUint16(p + 6, banderas, true);
    vista.setUint16(p + 8, e.metodo, true);
    vista.setUint16(p + 10, e.hora, true);
    vista.setUint16(p + 12, e.fecha, true);
    vista.setUint32(p + 14, e.crc, true);
    vista.setUint32(p + 18, e.comprimido.length, true);
    vista.setUint32(p + 22, e.tamano, true);
    vista.setUint16(p + 26, nombre.length, true);
    vista.setUint16(p + 28, 0, true);
    salida.set(nombre, p + 30);
    salida.set(e.comprimido, p + 30 + nombre.length);
    p += 30 + nombre.length + e.comprimido.length;
  });
  const inicioCentral = p;
  entradas.forEach((e, i) => {
    const nombre = nombres[i];
    const utf8 = /[^\x20-\x7e]/.test(e.nombre) ? 0x0800 : 0;
    const banderas = (e.banderas & ~0x0008) | utf8;
    vista.setUint32(p, FIRMA_CENTRAL, true);
    vista.setUint16(p + 4, e.versionHecho || 20, true);
    vista.setUint16(p + 6, e.versionNecesaria || 20, true);
    vista.setUint16(p + 8, banderas, true);
    vista.setUint16(p + 10, e.metodo, true);
    vista.setUint16(p + 12, e.hora, true);
    vista.setUint16(p + 14, e.fecha, true);
    vista.setUint32(p + 16, e.crc, true);
    vista.setUint32(p + 20, e.comprimido.length, true);
    vista.setUint32(p + 24, e.tamano, true);
    vista.setUint16(p + 28, nombre.length, true);
    vista.setUint16(p + 30, 0, true);
    vista.setUint16(p + 32, 0, true);
    vista.setUint16(p + 34, 0, true);
    vista.setUint16(p + 36, 0, true);
    vista.setUint32(p + 38, e.atributosExternos >>> 0, true);
    vista.setUint32(p + 42, desplazamientos[i], true);
    salida.set(nombre, p + 46);
    p += 46 + nombre.length;
  });
  vista.setUint32(p, FIRMA_FIN, true);
  vista.setUint16(p + 8, entradas.length, true);
  vista.setUint16(p + 10, entradas.length, true);
  vista.setUint32(p + 12, p - inicioCentral, true);
  vista.setUint32(p + 16, inicioCentral, true);
  return salida;
}

/** ZIP nuevo a partir de [nombre, datos] (para respaldos y libros nuevos). */
export function crearZip(archivos, opciones = {}) {
  return escribirZip(archivos.map(([nombre, datos]) => entradaNueva(nombre, datos, opciones)));
}
