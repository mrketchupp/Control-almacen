// Archivos del usuario en SU equipo: carpeta elegida (p. ej. OneDrive\ControlAlmacen)
// con la API de acceso a archivos del navegador, o descargas normales si no hay carpeta.

export const soportaCarpetas = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

const TIPOS = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".zip": "application/zip",
};

export async function leerArchivoSubido(archivo) {
  return new Uint8Array(await archivo.arrayBuffer());
}

/** Descarga normal del navegador (va a la carpeta Descargas). */
export function descargar(nombre, datos) {
  const tipo = TIPOS[nombre.slice(nombre.lastIndexOf(".")).toLowerCase()] || "application/octet-stream";
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = "noopener";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const soportaGuardarComo = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

/**
 * Ventana "Guardar como" del explorador de archivos. Recuerda la última carpeta usada.
 * @returns el archivo elegido, o null si el usuario canceló
 */
const DESCRIPCIONES = { ".xlsm": "Libro de Excel con macros", ".xlsx": "Libro de Excel", ".zip": "Carpeta comprimida (.zip)" };

export async function elegirDondeGuardar(nombre, { startIn = "documents", id = "control-almacen-exportar" } = {}) {
  const extension = nombre.slice(nombre.lastIndexOf(".")).toLowerCase();
  try {
    return await window.showSaveFilePicker({
      id,
      startIn,
      suggestedName: nombre,
      types: [{ description: DESCRIPCIONES[extension] ?? "Archivo", accept: { [TIPOS[extension] ?? "application/octet-stream"]: [extension] } }],
    });
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  }
}

export class ErrorEscritura extends Error {}

/** Explica en palabras del usuario por qué el navegador no pudo escribir el archivo. */
export function explicarErrorEscritura(error, nombre) {
  switch (error?.name) {
    case "NoModificationAllowedError":
    case "InvalidModificationError":
      return `«${nombre}» está abierto en Excel u otro programa`;
    case "InvalidStateError":
      return `«${nombre}» cambió mientras se guardaba (¿OneDrive lo estaba sincronizando?)`;
    case "NotAllowedError":
    case "SecurityError":
      return `el navegador no dio permiso para escribir «${nombre}»`;
    case "QuotaExceededError":
      return "no hay espacio en el disco";
    case "NotFoundError":
      return `la carpeta de «${nombre}» ya no existe`;
    default:
      return error?.message || String(error);
  }
}

const ESPERAS_ESCRITURA = [0, 500, 1500];
const sinReintento = (error) => ["NotAllowedError", "SecurityError", "QuotaExceededError"].includes(error?.name);

/**
 * Escribe en el archivo elegido con "Guardar como". Reintenta (OneDrive o un antivirus pueden tener el
 * archivo un instante) y comprueba que quedó completo. @throws ErrorEscritura con la causa explicada
 */
export async function escribirEnArchivo(archivo, datos) {
  let ultimo = null;
  for (const espera of ESPERAS_ESCRITURA) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try {
      const escritor = await archivo.createWritable();
      try {
        await escritor.write(datos);
        await escritor.close();
      } catch (error) {
        await escritor.abort().catch(() => {});
        throw error;
      }
      if (typeof archivo.getFile === "function") {
        const escrito = await archivo.getFile();
        if (escrito.size !== datos.length) throw new ErrorEscritura(`«${archivo.name}» quedó incompleto`);
      }
      return archivo.name;
    } catch (error) {
      ultimo = error;
      if (sinReintento(error)) break;
    }
  }
  throw new ErrorEscritura(explicarErrorEscritura(ultimo, archivo.name), { cause: ultimo });
}

export async function elegirCarpeta() {
  return window.showDirectoryPicker({ id: "control-almacen", mode: "readwrite", startIn: "documents" });
}

/** 'granted' | 'prompt' | 'denied'. Con `pedir`, solicita el permiso (requiere un clic). */
export async function permisoCarpeta(carpeta, pedir = false) {
  if (!carpeta) return "denied";
  const opciones = { mode: "readwrite" };
  try {
    let estado = await carpeta.queryPermission(opciones);
    if (estado !== "granted" && pedir) estado = await carpeta.requestPermission(opciones);
    return estado;
  } catch {
    return "denied";
  }
}

async function subcarpeta(carpeta, ruta, crear = true) {
  let actual = carpeta;
  for (const parte of ruta.split("/").filter(Boolean)) actual = await actual.getDirectoryHandle(parte, { create: crear });
  return actual;
}

/** Escribe `datos` en carpeta/ruta/nombre (crea las subcarpetas). Escritura atómica del navegador. */
export async function escribirEnCarpeta(carpeta, ruta, nombre, datos) {
  const destino = await subcarpeta(carpeta, ruta);
  const archivo = await destino.getFileHandle(nombre, { create: true });
  const escritor = await archivo.createWritable();
  await escritor.write(datos);
  await escritor.close();
  return `${carpeta.name}/${ruta ? `${ruta}/` : ""}${nombre}`;
}

export async function listarCarpeta(carpeta, ruta) {
  let destino;
  try {
    destino = await subcarpeta(carpeta, ruta, false);
  } catch {
    return [];
  }
  const salida = [];
  for await (const [nombre, entrada] of destino.entries()) {
    if (entrada.kind === "file") {
      const archivo = await entrada.getFile();
      salida.push({ nombre, tamano: archivo.size, modificado: archivo.lastModified });
    }
  }
  return salida;
}

export async function leerDeCarpeta(carpeta, ruta, nombre) {
  const destino = await subcarpeta(carpeta, ruta, false);
  const archivo = await (await destino.getFileHandle(nombre)).getFile();
  return new Uint8Array(await archivo.arrayBuffer());
}

export async function borrarDeCarpeta(carpeta, ruta, nombre) {
  const destino = await subcarpeta(carpeta, ruta, false);
  await destino.removeEntry(nombre);
}
