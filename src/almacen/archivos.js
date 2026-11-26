// Archivos del usuario en SU equipo: carpeta elegida (p. ej. OneDrive\ControlAlmacen)
// con la API de acceso a archivos del navegador, o descargas normales si no hay carpeta.

import { anotar, describirHandle } from "./registro.js";
import { conTiempo, esTiempo } from "./tiempo.js";

export const soportaCarpetas = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

const TIPOS = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".zip": "application/zip",
  ".txt": "text/plain;charset=utf-8",
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
  anotar("guardar como", `abre «Guardar como» para «${nombre}»`);
  try {
    const archivo = await window.showSaveFilePicker({
      id,
      startIn,
      suggestedName: nombre,
      types: [{ description: DESCRIPCIONES[extension] ?? "Archivo", accept: { [TIPOS[extension] ?? "application/octet-stream"]: [extension] } }],
    });
    anotar("guardar como", `entregó ${describirHandle(archivo)}`);
    return archivo;
  } catch (error) {
    if (canceloDialogo(error)) {
      anotar("guardar como", "se cerró sin archivo", error);
      return null;
    }
    anotar("guardar como", "falló al elegir", error);
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

/** Tras cerrarse un diálogo del explorador (la ventana vuelve a tener el foco), cuánto se espera a que Edge responda. */
export const ESPERA_TRAS_DIALOGO_MS = 5000;

/**
 * La respuesta de un diálogo del explorador («Guardar como», elegir carpeta o archivo), vigilada: si la ventana ya
 * recuperó el foco (el diálogo se cerró) y Edge no responde en `ms`, rechaza con ErrorEscritura 'colgado' (pasa
 * mientras OneDrive sube archivos). Si Edge responde después, `alLlegarTarde(resultado)` lo recibe para usarlo de
 * todos modos. `mensaje`: qué decir si no respondió.
 */
export function vigilarDialogo(promesa, { ms = ESPERA_TRAS_DIALOGO_MS, alLlegarTarde = null, mensaje = null } = {}) {
  return new Promise((resolver, rechazar) => {
    let vencida = false;
    let temporizador = null;
    const limpiar = () => {
      clearTimeout(temporizador);
      window.removeEventListener("focus", alFoco);
      window.removeEventListener("blur", alPerderFoco);
    };
    function alFoco() {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (!document.hasFocus()) return;
        vencida = true;
        limpiar();
        rechazar(new ErrorEscritura(mensaje ?? "Edge no respondió al guardar en esa carpeta (pasa mientras OneDrive sube archivos)", { causa: "colgado" }));
      }, ms);
    }
    function alPerderFoco() {
      clearTimeout(temporizador);
    }
    window.addEventListener("focus", alFoco);
    window.addEventListener("blur", alPerderFoco);
    Promise.resolve(promesa).then(
      (resultado) => {
        limpiar();
        if (!vencida) resolver(resultado);
        else if (resultado) alLlegarTarde?.(resultado);
      },
      (error) => {
        limpiar();
        if (!vencida) rechazar(error);
      },
    );
  });
}

/**
 * El explorador se cerró sin entregar nada (AbortError). Puede ser que se canceló o que Edge no entregó lo elegido
 * (le pasa con carpetas de OneDrive, como a «Guardar como» en las Rondas 26 y 29): el mensaje lo dice con el detalle
 * técnico, para que nunca quede en silencio. `que`: "la carpeta" o "el archivo".
 */
export class SinElegir extends Error {
  constructor(que, causa = null) {
    const detalle = causa ? ` (Edge respondió: ${causa.name}${causa.message ? ` — ${causa.message}` : ""})` : "";
    super(
      `No llegó ${que} del explorador. Si sí ${que === "el archivo" ? "lo" : "la"} elegiste, Edge no ${que === "el archivo" ? "lo" : "la"} entregó (le pasa con algunas carpetas de OneDrive): arrástra${que === "el archivo" ? "lo" : "la"} desde el Explorador de Windows al recuadro punteado.${detalle}`,
      causa ? { cause: causa } : undefined,
    );
    this.name = "SinElegir";
    this.que = que;
  }
}

/** Abre un diálogo del explorador vigilado: AbortError → SinElegir; sin respuesta → ErrorEscritura 'colgado'. */
export async function delExplorador(que, abrir, { alLlegarTarde = null } = {}) {
  anotar("explorador", `se abre para elegir ${que}`);
  try {
    const resultado = await vigilarDialogo(abrir(), {
      alLlegarTarde: (tardio) => {
        anotar("explorador", `respondió tarde: entregó ${describirHandle(tardio)}`);
        alLlegarTarde?.(tardio);
      },
      mensaje: `Edge no respondió después de elegir ${que} (pasa mientras OneDrive sincroniza). Espera un momento o arrástra${que === "el archivo" ? "lo" : "la"} desde el Explorador de Windows al recuadro punteado.`,
    });
    anotar("explorador", `entregó ${describirHandle(resultado)}`);
    return resultado;
  } catch (error) {
    anotar("explorador", error?.name === "AbortError" ? "se cerró sin entregar nada" : "falló", error);
    if (error?.name === "AbortError") throw new SinElegir(que, error);
    throw error;
  }
}

/** Lo más que se espera a una escritura (OneDrive puede dejarla esperando sin responder). */
export const LIMITE_ESCRITURA_MS = 30000;

/**
 * La promesa, o un ErrorEscritura con causa 'colgado' si no termina en `ms`. Lo que quedó corriendo
 * sigue por su lado; así la herramienta nunca se queda en «Generando Excel…» para siempre.
 */
export function conLimite(promesa, ms, nombre, mensaje = null) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new ErrorEscritura(mensaje ?? `Windows no terminó de guardar «${nombre}» (¿OneDrive está subiendo archivos?)`, { causa: "colgado" })), ms);
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
      anotar("escribir", `«${archivo.name}»: ${datos.length} bytes escritos${espera ? " (tras reintentar)" : ""}`);
      return archivo.name;
    } catch (error) {
      ultimo = error;
      anotar("escribir", `«${archivo.name}»: falló${espera ? " otra vez" : ""}`, error);
      if (sinReintento(error)) break;
    }
  }
  throw new ErrorEscritura(explicarErrorEscritura(ultimo, archivo.name), { cause: ultimo });
}

export async function elegirCarpeta() {
  return window.showDirectoryPicker({ id: "control-almacen", mode: "readwrite", startIn: "documents" });
}

/**
 * Ronda 36 (fallo reportado tras un apagón: al pulsar «Permitir» se quedaba en «Pidiendo permiso…» y Edge nunca mostró
 * su aviso): Edge no respondió al pedir el permiso. Lo más probable es que OneDrive no respondiera (el arranque ya se
 * había colgado listando esa misma carpeta) y Edge se quedara esperándolo antes de mostrar su aviso.
 */
export const SIN_RESPUESTA = "sin-respuesta";
export const LIMITE_PERMISO_MS = 15000;

/** Qué se le dice al usuario cuando Edge no mostró el aviso del permiso. */
export const textoSinRespuesta = (nombre) =>
  `Edge no mostró el aviso para dar permiso a «${nombre}». Puede pasar cuando OneDrive no responde (por ejemplo, después de un apagón): abre esa carpeta en el Explorador de Windows y, si tarda o no abre, reinicia OneDrive. Luego vuelve a intentarlo. Mientras, los respaldos se descargan en Descargas.`;

/**
 * 'granted' | 'prompt' | 'denied' | SIN_RESPUESTA. Con `pedir`, solicita el permiso (requiere un clic). Si Edge no
 * responde en `limiteMs` se deja de esperar (SIN_RESPUESTA); si responde después, `alLlegarTarde(estado)`.
 */
export async function permisoCarpeta(carpeta, pedir = false, { limiteMs = LIMITE_PERMISO_MS, alLlegarTarde = null } = {}) {
  if (!carpeta) return "denied";
  const opciones = { mode: "readwrite" };
  let pedido = null;
  try {
    const antes = await conTiempo(carpeta.queryPermission(opciones), limiteMs);
    if (antes === "granted" || !pedir) return antes;
    pedido = carpeta.requestPermission(opciones);
    const estado = await conTiempo(pedido, limiteMs);
    anotar("permiso", `${describirHandle(carpeta)} (editar): estaba «${antes}», Edge respondió «${estado}»`);
    return estado;
  } catch (error) {
    if (esTiempo(error)) {
      anotar("permiso", `${describirHandle(carpeta)} (editar): Edge no respondió en ${limiteMs / 1000} s${pedido ? " (no mostró su aviso)" : " al consultarlo"}`);
      pedido
        ?.then((estado) => {
          anotar("permiso", `${describirHandle(carpeta)} (editar): Edge respondió tarde «${estado}»`);
          alLlegarTarde?.(estado);
        })
        .catch(() => {});
      return SIN_RESPUESTA;
    }
    if (pedir) anotar("permiso", `${describirHandle(carpeta)} (editar): no se pudo pedir`, error);
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
