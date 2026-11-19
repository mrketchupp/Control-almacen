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
  // (En Node, para las pruebas, el temporizador no detiene la salida.)
  setTimeout(() => URL.revokeObjectURL(url), 60000)?.unref?.();
}

export const soportaGuardarComo = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

const DESCRIPCIONES = { ".xlsm": "Libro de Excel con macros", ".xlsx": "Libro de Excel", ".zip": "Carpeta comprimida (.zip)" };

/**
 * ¿El usuario cerró «Guardar como» sin elegir? Chromium (Edge) rechaza con AbortError tanto al cancelar
 * ("The user aborted a request.", el mensaje de siempre) como cuando una operación falla con su propio
 * mensaje (p. ej. no pudo crear o vaciar el archivo elegido). Solo lo primero es cancelar.
 */
export function canceloDialogo(error) {
  return error?.name === "AbortError" && (!error.message || /user aborted|aborted a request|cancel/i.test(error.message));
}

/**
 * Error al guardar, explicado. `causa` dice qué dibujar en el aviso: 'abierto' (Excel u otro programa lo
 * tiene), 'sincronizando' (OneDrive), 'colgado' (Edge o Windows no respondió: pasa mientras OneDrive sube
 * archivos), 'bloqueado' (SmartScreen), 'permiso', 'espacio', 'carpeta' u 'otro'.
 */
export class ErrorEscritura extends Error {
  constructor(mensaje, { cause, causa } = {}) {
    super(mensaje, cause === undefined ? undefined : { cause });
    this.causa = causa ?? causaDeError(cause);
  }
}

/** Código de la causa de un error de escritura del navegador (ver ErrorEscritura). */
export function causaDeError(error) {
  if (error instanceof ErrorEscritura) return error.causa;
  switch (error?.name) {
    case "NoModificationAllowedError":
    case "InvalidModificationError":
    case "NotReadableError":
      return "abierto";
    case "AbortError":
      return /safe ?browsing|smartscreen/i.test(error.message ?? "") ? "bloqueado" : "abierto";
    case "InvalidStateError":
      return "sincronizando";
    case "NotAllowedError":
      // "File picker already active": Edge sigue con el «Guardar como» anterior, que no respondió.
      return /already active/i.test(error.message ?? "") ? "colgado" : "permiso";
    case "SecurityError":
      return "permiso";
    case "QuotaExceededError":
      return "espacio";
    case "NotFoundError":
      return "carpeta";
    default:
      return "otro";
  }
}

/**
 * Ventana "Guardar como" del explorador de archivos. Recuerda la última carpeta usada.
 * Ojo: el navegador crea el archivo elegido (o lo deja vacío si ya existía) en cuanto se acepta la
 * ventana; si Windows no lo deja (abierto en Excel, OneDrive sincronizándolo), falla aquí mismo.
 * @returns el archivo elegido, o null si el usuario canceló
 * @throws ErrorEscritura con la causa explicada si no se pudo usar el archivo elegido
 */
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
    if (canceloDialogo(error)) return null;
    throw new ErrorEscritura(explicarErrorEscritura(error, nombre), { cause: error });
  }
}

/** Explica en palabras del usuario por qué el navegador no pudo escribir el archivo. */
export function explicarErrorEscritura(error, nombre) {
  switch (error?.name) {
    case "NoModificationAllowedError":
    case "InvalidModificationError":
      return `«${nombre}» está abierto en Excel u otro programa`;
    case "NotReadableError":
      // Así llega el archivo ocupado por otro programa (Excel, OneDrive) al crearlo o reemplazarlo.
      return `Windows no dejó usar «${nombre}»: casi siempre es porque está abierto en Excel o OneDrive lo está sincronizando`;
    case "AbortError":
      if (/safe ?browsing|smartscreen/i.test(error.message ?? "")) return `Edge (SmartScreen) bloqueó «${nombre}»`;
      return `Windows no dejó crear o reemplazar «${nombre}»: casi siempre es porque está abierto en Excel o OneDrive lo está sincronizando`;
    case "InvalidStateError":
      return `«${nombre}» cambió mientras se guardaba (¿OneDrive lo estaba sincronizando?)`;
    case "NotAllowedError":
      if (/already active/i.test(error.message ?? "")) return "Edge sigue ocupado con el «Guardar como» anterior, que no respondió";
      return `el navegador no dio permiso para escribir «${nombre}»`;
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

/** Lo más que se espera a una escritura (OneDrive puede dejarla esperando sin responder). */
export const LIMITE_ESCRITURA_MS = 30000;

/**
 * La promesa, o un ErrorEscritura con causa 'colgado' si no termina en `ms`. Lo que quedó corriendo
 * sigue por su lado; así la herramienta nunca se queda en «Generando Excel…» para siempre.
 */
export function conLimite(promesa, ms, nombre) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new ErrorEscritura(`Windows no terminó de guardar «${nombre}» (¿OneDrive está subiendo archivos?)`, { causa: "colgado" })), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

const ESPERAS_ESCRITURA = [0, 500, 1500];
const sinReintento = (error) =>
  ["NotAllowedError", "SecurityError", "QuotaExceededError"].includes(error?.name) ||
  /safe ?browsing|smartscreen/i.test(error?.message ?? "") ||
  causaDeError(error) === "colgado";

/**
 * Escribe en el archivo elegido con "Guardar como". Reintenta (OneDrive o un antivirus pueden tener el
 * archivo un instante) y comprueba que quedó completo. @throws ErrorEscritura con la causa explicada
 */
export async function escribirEnArchivo(archivo, datos, { limiteMs = LIMITE_ESCRITURA_MS } = {}) {
  let ultimo = null;
  const intento = async () => {
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
      if (escrito.size !== datos.length) throw new ErrorEscritura(`«${archivo.name}» quedó incompleto`, { causa: "otro" });
    }
  };
  for (const espera of ESPERAS_ESCRITURA) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    try {
      await conLimite(intento(), limiteMs, archivo.name);
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

/**
 * Escribe `datos` en carpeta/ruta/nombre (crea las subcarpetas). Escritura atómica del navegador, con
 * un límite de tiempo (`conLimite`) para no quedarse esperando a OneDrive.
 */
export async function escribirEnCarpeta(carpeta, ruta, nombre, datos, { limiteMs = LIMITE_ESCRITURA_MS * 2 } = {}) {
  const escribir = async () => {
    const destino = await subcarpeta(carpeta, ruta);
    const archivo = await destino.getFileHandle(nombre, { create: true });
    const escritor = await archivo.createWritable();
    await escritor.write(datos);
    await escritor.close();
  };
  await conLimite(escribir(), limiteMs, nombre);
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
