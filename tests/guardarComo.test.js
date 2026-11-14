// «Guardar como»: distinguir cuando el usuario cancela de cuando Windows no deja usar el archivo elegido.
// Chromium (Edge) rechaza ambos con AbortError y solo los distingue el mensaje; un archivo abierto en
// Excel llega como un error de archivo genérico (NotReadableError). Antes, todo AbortError se tomaba como
// cancelar y no pasaba nada después de elegir la carpeta.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorEscritura, causaDeError, canceloDialogo, elegirDondeGuardar, escribirEnArchivo, explicarErrorEscritura } from "../src/almacen/archivos.js";
import { Sesion } from "../src/ui/sesion.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { hoyIso } from "../src/nucleo/fechas.js";
import { almacenReporteGsm, FECHA_REPORTE_GSM, PRIMER_FOLIO_GSM, ULTIMO_FOLIO_GSM } from "./ayudaReporteGsm.js";

const domError = (name, message = "") => Object.assign(new Error(message), { name });
const NOMBRE = "VALES DE SALIDA GSM.xlsm";

test("solo es cancelar el AbortError con el mensaje de siempre (o sin mensaje)", () => {
  assert.equal(canceloDialogo(domError("AbortError", "The user aborted a request.")), true);
  assert.equal(canceloDialogo(domError("AbortError", "")), true);
  assert.equal(canceloDialogo(domError("AbortError", "Failed to create or truncate file")), false);
  assert.equal(canceloDialogo(domError("AbortError", "Blocked by Safe Browsing.")), false);
  assert.equal(canceloDialogo(domError("NotReadableError", "The requested file could not be read")), false);
  assert.equal(canceloDialogo(null), false);
});

test("cada error trae la causa que decide el dibujo del aviso", () => {
  assert.equal(causaDeError(domError("NotReadableError")), "abierto");
  assert.equal(causaDeError(domError("NoModificationAllowedError")), "abierto");
  assert.equal(causaDeError(domError("AbortError", "Failed to create or truncate file")), "abierto");
  assert.equal(causaDeError(domError("AbortError", "Blocked by Safe Browsing.")), "bloqueado");
  assert.equal(causaDeError(domError("InvalidStateError")), "sincronizando");
  assert.equal(causaDeError(domError("NotAllowedError")), "permiso");
  assert.equal(causaDeError(domError("QuotaExceededError")), "espacio");
  assert.equal(causaDeError(domError("NotFoundError")), "carpeta");
  assert.equal(causaDeError(new Error("otra cosa")), "otro");
  assert.equal(causaDeError(new ErrorEscritura("x", { cause: domError("InvalidStateError") })), "sincronizando");
  assert.equal(new ErrorEscritura("quedó incompleto", { causa: "otro" }).causa, "otro");
});

test("los errores de archivo se explican en palabras del usuario", () => {
  assert.match(explicarErrorEscritura(domError("NotReadableError"), NOMBRE), /abierto en Excel/);
  assert.match(explicarErrorEscritura(domError("AbortError", "Failed to create or truncate file"), NOMBRE), /no dejó crear o reemplazar «VALES DE SALIDA GSM\.xlsm».*abierto en Excel/);
  assert.match(explicarErrorEscritura(domError("AbortError", "Blocked by Safe Browsing."), NOMBRE), /SmartScreen/);
  assert.match(explicarErrorEscritura(domError("NoModificationAllowedError"), NOMBRE), /abierto en Excel/);
});

test("elegirDondeGuardar: cancelar devuelve null; si Windows no deja usar el archivo, lanza la causa", async (t) => {
  const antes = globalThis.window;
  t.after(() => { globalThis.window = antes; });
  const pedidos = [];
  const rechazar = (error) => { globalThis.window = { showSaveFilePicker: async (o) => { pedidos.push(o); throw error; } }; };

  rechazar(domError("AbortError", "The user aborted a request."));
  assert.equal(await elegirDondeGuardar(NOMBRE), null);

  rechazar(domError("AbortError", "Failed to create or truncate file"));
  await assert.rejects(elegirDondeGuardar(NOMBRE), (e) => e instanceof ErrorEscritura && /abierto en Excel/.test(e.message) && e.cause.name === "AbortError");

  rechazar(domError("NotReadableError", "The requested file could not be read"));
  await assert.rejects(elegirDondeGuardar(NOMBRE), (e) => e instanceof ErrorEscritura && /abierto en Excel/.test(e.message));

  assert.equal(pedidos[0].suggestedName, NOMBRE);
  assert.deepEqual(pedidos[0].types[0].accept, { "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"] });
});

test("escribirEnArchivo reintenta, comprueba el tamaño y explica por qué no pudo", async () => {
  const datos = new Uint8Array([1, 2, 3, 4]);
  let intentos = 0;
  let guardado = null;
  const ocupadoUnaVez = {
    name: NOMBRE,
    async createWritable() {
      intentos++;
      if (intentos === 1) throw domError("NoModificationAllowedError");
      return { write: async (d) => { guardado = d; }, close: async () => {}, abort: async () => {} };
    },
    async getFile() { return { size: guardado?.length ?? 0 }; },
  };
  assert.equal(await escribirEnArchivo(ocupadoUnaVez, datos), NOMBRE);
  assert.equal(intentos, 2);

  const siempreOcupado = { name: NOMBRE, createWritable: async () => { throw domError("NotReadableError"); } };
  await assert.rejects(escribirEnArchivo(siempreOcupado, datos), (e) => e instanceof ErrorEscritura && /abierto en Excel/.test(e.message));

  const bloqueado = {
    name: NOMBRE,
    createWritable: async () => ({ write: async () => {}, close: async () => { throw domError("AbortError", "Blocked by Safe Browsing."); }, abort: async () => {} }),
  };
  await assert.rejects(escribirEnArchivo(bloqueado, datos), (e) => e instanceof ErrorEscritura && /SmartScreen/.test(e.message));
});

// ---------------------------------------------------------------- Sesion.exportar (sin navegador)
// En Chromium de pruebas no se puede guardar en IndexedDB un directorio (la carpeta de la herramienta):
// aquí la carpeta es un directorio en memoria con la misma forma que el del navegador.

function directorio(nombre, permiso = "granted") {
  const hijos = new Map();
  const pedidos = [];
  const dir = {
    kind: "directory",
    name: nombre,
    pedidos,
    hijos,
    queryPermission: async () => permiso,
    requestPermission: async () => { pedidos.push("permiso"); return permiso; },
    async getDirectoryHandle(n, { create = false } = {}) {
      if (!hijos.has(n)) { if (!create) throw domError("NotFoundError"); hijos.set(n, directorio(n, permiso)); }
      return hijos.get(n);
    },
    async getFileHandle(n, { create = false } = {}) {
      if (!hijos.has(n)) {
        if (!create) throw domError("NotFoundError");
        const archivo = { kind: "file", name: n, datos: new Uint8Array(),
          createWritable: async () => { let d = null; return { write: async (x) => { d = x; }, close: async () => { archivo.datos = d; }, abort: async () => {} }; },
          getFile: async () => ({ size: archivo.datos.length, lastModified: 0, arrayBuffer: async () => archivo.datos.buffer }) };
        hijos.set(n, archivo);
      }
      return hijos.get(n);
    },
    async *entries() { yield* hijos.entries(); },
    async removeEntry(n) { hijos.delete(n); },
  };
  return dir;
}

const ruta = (dir, ...partes) => partes.reduce((d, p) => d?.hijos.get(p), dir);
const folios = (datos) => {
  const diario = new LibroLeido(datos).hoja("DIARIO"), salida = [];
  for (let f = 2; f <= diario.maxFila; f++) if (Number.isInteger(diario.valor(f, 2))) salida.push(diario.valor(f, 2));
  return salida;
};
const TODOS = Array.from({ length: ULTIMO_FOLIO_GSM - PRIMER_FOLIO_GSM + 1 }, (_, i) => PRIMER_FOLIO_GSM + i);

async function sesionConCarpeta(permiso = "granted") {
  const { almacen } = await almacenReporteGsm({ inventario: "GSM", conTabla: true });
  const sesion = new Sesion(almacen, almacen.backend);
  sesion.carpeta = directorio("ControlAlmacen", permiso);
  sesion.permiso = permiso;
  return sesion;
}

test("bloqueado al escribir donde se eligió: el Excel queda en la carpeta de la herramienta y se dice por qué", async () => {
  const sesion = await sesionConCarpeta();
  const bloqueado = { name: "VALES DE SALIDA GSM.xlsm", createWritable: async () => { throw domError("NoModificationAllowedError"); } };
  const r = await sesion.exportar("VALES", bloqueado, { corte: FECHA_REPORTE_GSM });
  assert.equal(r.elegido, false);
  assert.match(r.motivo, /abierto en Excel/);
  assert.equal(r.causa, "abierto");
  assert.equal(r.nombre, "VALES DE SALIDA GSM.xlsm");
  assert.equal(r.destino, `ControlAlmacen/exportaciones/${hoyIso()}/VALES DE SALIDA GSM.xlsm`);
  assert.deepEqual(folios(ruta(sesion.carpeta, "exportaciones", hoyIso(), "VALES DE SALIDA GSM.xlsm").datos), TODOS);
  // Lo explica la ventana con dibujos (exportarConDialogo), no un aviso de texto.
  assert.deepEqual(sesion.avisos, []);
  // Queda registrada la exportación con el lugar donde de verdad quedó, y se hizo el respaldo.
  assert.equal(sesion.estado.exportaciones.at(-1).archivo, r.destino);
  assert.equal(ruta(sesion.carpeta, "respaldos").hijos.size, 1);
});

test("falló al elegirlo (abierto en Excel): se guarda en la carpeta sin volver a pedir permiso", async () => {
  const sesion = await sesionConCarpeta();
  const fallo = new ErrorEscritura("Windows no dejó crear o reemplazar «x»", { cause: domError("AbortError", "Failed to create or truncate file") });
  const r = await sesion.exportar("INVENTARIO", undefined, { corte: FECHA_REPORTE_GSM }, { fallo });
  assert.equal(r.elegido, false);
  assert.equal(r.motivo, fallo.message);
  assert.equal(r.causa, "abierto");
  assert.match(r.destino, new RegExp(`^ControlAlmacen/exportaciones/${hoyIso()}/INVENTARIO GSM .*231026\\.xlsx$`));
  assert.deepEqual(sesion.carpeta.pedidos, []);
});

test("falló al elegirlo y la carpeta no tiene permiso: no lo pide (sin clic lo negaría) y descarga", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const descargas = [];
  const antes = { document: globalThis.document, crear: URL.createObjectURL };
  globalThis.document = { createElement: () => { const a = { click: () => descargas.push(a.download), remove() {} }; return a; }, body: { appendChild() {} } };
  URL.createObjectURL = () => "blob:prueba";
  t.after(() => { globalThis.document = antes.document; URL.createObjectURL = antes.crear; });
  const sesion = await sesionConCarpeta("prompt");
  const r = await sesion.exportar("VALES", undefined, { corte: FECHA_REPORTE_GSM }, { fallo: "Windows no dejó crear o reemplazar «x»" });
  assert.equal(r.destino, "Descargas/VALES DE SALIDA GSM.xlsm");
  assert.deepEqual(descargas, ["VALES DE SALIDA GSM.xlsm"]);
  assert.deepEqual(sesion.carpeta.pedidos, []);
  assert.equal(sesion.permiso, "prompt");
  assert.equal(r.causa, "otro"); // un texto sin error detrás
});

test("si se pudo escribir donde se eligió: resultado elegido, sin avisos de advertencia", async () => {
  const sesion = await sesionConCarpeta();
  const elegido = await directorio("OneDrive").getFileHandle("VALES DE SALIDA GSM.xlsm", { create: true });
  const r = await sesion.exportar("VALES", elegido, { corte: FECHA_REPORTE_GSM });
  assert.deepEqual(r, { nombre: "VALES DE SALIDA GSM.xlsm", destino: "VALES DE SALIDA GSM.xlsm", elegido: true, motivo: null, causa: null });
  assert.deepEqual(folios(elegido.datos), TODOS);
  assert.deepEqual(sesion.avisos.filter((a) => a.tipo !== "exito"), []);
  assert.equal(sesion.exportoConDialogo, true);
});

test("avisos: se quitan solos a su tiempo, se detienen mientras se leen y no pasan de tres", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sesion = await sesionConCarpeta();
  sesion.avisar("exito", "uno");
  const [uno] = sesion.avisos;
  assert.equal(uno.duracion, 6000);
  t.mock.timers.tick(3000);
  sesion.pausarAviso(uno.id);
  t.mock.timers.tick(60000);
  assert.equal(sesion.avisos.length, 1, "en pausa no se quita");
  sesion.reanudarAviso(uno.id);
  t.mock.timers.tick(2999);
  assert.equal(sesion.avisos.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sesion.avisos.length, 0, "le quedaban 3 s");
  sesion.avisar("error", "no se quita solo");
  for (const texto of ["a", "b", "c"]) sesion.avisar("info", texto);
  assert.deepEqual(sesion.avisos.map((a) => a.texto), ["a", "b", "c"]);
  t.mock.timers.tick(6000);
  assert.deepEqual(sesion.avisos, []);
});

test("el diálogo con dibujos se muestra y se cierra desde la sesión", async () => {
  const sesion = await sesionConCarpeta();
  let cambios = 0;
  sesion.suscribir(() => cambios++);
  sesion.mostrarDialogo({ tipo: "no-guardado", nombre: "x.xlsx" });
  assert.equal(sesion.dialogo.nombre, "x.xlsx");
  sesion.cerrarDialogo();
  assert.equal(sesion.dialogo, null);
  assert.equal(cambios, 2);
});
