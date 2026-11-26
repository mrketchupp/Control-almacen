// Ronda 36 (fallo reportado: tras un corte de luz la herramienta se quedaba en «Cargando…»): el arranque no espera
// para siempre a la carpeta de trabajo y se puede restaurar un respaldo de emergencia aunque la base no responda.
// Datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { ErrorRespaldo, crearRespaldo, leerRespaldo } from "../src/almacen/respaldos.js";
import { copiaDeRescate, loQueSePierde, restaurarDeEmergencia, resumenDeDatos, revisarRespaldo } from "../src/almacen/rescate.js";
import { ErrorTiempo, conTiempo, esTiempo, oSiNo } from "../src/almacen/tiempo.js";
import { Sesion } from "../src/ui/sesion.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const nunca = () => new Promise(() => {});

async function almacenDe(inventario = "DLTA") {
  const almacen = new Almacen(new BackendMemoria(), { version: "prueba", inventario });
  await almacen.iniciar();
  const { estado } = cargaSintetica({ idInventario: inventario });
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: `INVENTARIO ${inventario} SINTETICO.xlsx`, datos: bytesInventario() },
    { tipo: "VALES", nombre: `VALES DE SALIDA ${inventario} SINTETICO.xlsm`, datos: bytesVales() },
  ]);
  return almacen;
}

/** Un respaldo de `almacen` sin sus últimos `quitar` vales de salida (como uno de antes). */
async function respaldoAnterior(almacen, quitar = 2) {
  const estado = structuredClone(almacen.estado);
  const salidas = estado.vales.filter((v) => v.tipo === "SALIDA").sort((a, b) => b.folio - a.folio).slice(0, quitar);
  estado.vales = estado.vales.filter((v) => !salidas.includes(v) && !salidas.some((s) => s.id === v.id));
  const plantillas = await almacen.plantillasDelEstado(estado);
  return crearRespaldo(estado, plantillas, { motivo: "inicio", ahora: "2026-11-25T08:00:00" });
}

test("conTiempo / oSiNo: lo que no responde deja de esperarse", async () => {
  assert.equal(await conTiempo(Promise.resolve(3), 50), 3);
  await assert.rejects(conTiempo(nunca(), 20, "no respondió"), (e) => e instanceof ErrorTiempo && esTiempo(e) && e.ms === 20);
  assert.equal(await oSiNo(nunca(), 20, "prompt"), "prompt");
  assert.equal(await oSiNo(Promise.reject(new Error("x")), 20, null), null);
});

test("resumen de un respaldo, del inventario equivocado y lo que se perdería", async () => {
  const almacen = await almacenDe("DLTA");
  const actual = resumenDeDatos(almacen.estado);
  assert.ok(actual.ultimaSalida > 2, "la fixture trae vales de salida");
  const anterior = await respaldoAnterior(almacen, 2);
  const r = revisarRespaldo(anterior.datos, "DLTA");
  assert.equal(r.inventario, "DLTA");
  assert.equal(r.fecha_hora, "2026-11-25T08:00:00");
  assert.equal(r.motivo, "inicio");
  assert.ok(r.ultimaSalida < actual.ultimaSalida);
  assert.deepEqual(loQueSePierde(actual, r).salidas?.[1], actual.ultimaSalida);
  assert.deepEqual(loQueSePierde(r, actual), { salidas: null, entradas: null });
  assert.throws(() => revisarRespaldo(anterior.datos, "GSM"), ErrorRespaldo);
  assert.throws(() => revisarRespaldo(new Uint8Array([1, 2, 3]), "DLTA"), ErrorRespaldo);
});

test("copia de rescate: un respaldo normal de lo que hay; sin datos, nada; si la base no responde, ErrorTiempo", async () => {
  const almacen = await almacenDe("DLTA");
  const copia = await copiaDeRescate(almacen.backend, { inventario: "DLTA", version: "prueba" });
  assert.match(copia.nombre, /^almacen_\d{4}-\d{2}-\d{2}_\d{6}_rescate\.zip$/);
  const leido = leerRespaldo(copia.datos);
  assert.equal(leido.estado.vales.length, almacen.estado.vales.length);
  assert.equal(copia.resumen.ultimaSalida, resumenDeDatos(almacen.estado).ultimaSalida);
  assert.equal(await copiaDeRescate(new BackendMemoria(), { inventario: "DLTA" }), null);
  const colgada = new BackendMemoria();
  colgada.leerEstado = nunca;
  await assert.rejects(copiaDeRescate(colgada, { inventario: "DLTA", limiteMs: 20 }), ErrorTiempo);
});

test("restaurar de emergencia: sobre la base que hay (conserva sus copias internas)", async () => {
  const almacen = await almacenDe("DLTA");
  await almacen.instantanea("inicio del día");
  const anterior = await respaldoAnterior(almacen, 2);
  let borrada = 0;
  const r = await restaurarDeEmergencia({ abrirBackend: () => almacen.backend, borrarBase: async () => borrada++, inventario: "DLTA", datos: anterior.datos });
  assert.equal(r.borrada, false);
  assert.equal(borrada, 0);
  const otra = new Almacen(almacen.backend, { inventario: "DLTA" });
  await otra.iniciar();
  assert.equal(resumenDeDatos(otra.estado).ultimaSalida, revisarRespaldo(anterior.datos, "DLTA").ultimaSalida);
  assert.equal(almacen.backend.instantaneas.length, 1, "la copia interna de antes sigue ahí");
});

test("restaurar de emergencia: si la base no responde, se borra y se restaura en una nueva", async () => {
  const almacen = await almacenDe("DLTA");
  const anterior = await respaldoAnterior(almacen, 1);
  const colgada = new BackendMemoria();
  colgada.guardarTodo = nunca;
  const nueva = new BackendMemoria();
  const abiertas = [colgada, nueva];
  let borrada = 0;
  const r = await restaurarDeEmergencia({
    abrirBackend: () => abiertas.shift(),
    borrarBase: async () => borrada++,
    inventario: "DLTA",
    datos: anterior.datos,
    limiteMs: 30,
  });
  assert.equal(r.borrada, true);
  assert.equal(borrada, 1);
  assert.ok(esTiempo(r.motivo));
  assert.equal(nueva.estado.vales.length, leerRespaldo(anterior.datos).estado.vales.length);
});

test("restaurar de emergencia: un respaldo del otro inventario no toca nada; si ni borrando, ErrorTiempo", async () => {
  const almacen = await almacenDe("DLTA");
  const anterior = await respaldoAnterior(almacen, 1);
  let abiertas = 0;
  let borrada = 0;
  await assert.rejects(
    restaurarDeEmergencia({ abrirBackend: () => (abiertas++, new BackendMemoria()), borrarBase: async () => borrada++, inventario: "GSM", datos: anterior.datos }),
    ErrorRespaldo,
  );
  assert.deepEqual([abiertas, borrada], [0, 0]);
  const colgada = () => Object.assign(new BackendMemoria(), { guardarTodo: nunca });
  await assert.rejects(
    restaurarDeEmergencia({ abrirBackend: colgada, borrarBase: nunca, inventario: "DLTA", datos: anterior.datos, limiteMs: 20, limiteBorrarMs: 20 }),
    ErrorTiempo,
  );
});

// ---------------------------------------------------------------- el arranque no espera a la carpeta

/** Carpeta de trabajo de prueba: con `colgar`, esas operaciones nunca responden (OneDrive tras un apagón). */
function carpeta(colgar = []) {
  const hijos = new Map();
  const dir = (nombre, mapa) => ({
    kind: "directory",
    name: nombre,
    queryPermission: colgar.includes("permiso") ? nunca : async () => "granted",
    requestPermission: async () => "granted",
    async getDirectoryHandle(n, { create } = {}) {
      if (!mapa.has(n)) {
        if (!create) throw Object.assign(new Error("no existe"), { name: "NotFoundError" });
        mapa.set(n, dir(n, new Map()));
      }
      return mapa.get(n);
    },
    async getFileHandle(n) {
      const archivo = { kind: "file", name: n, datos: null };
      archivo.createWritable = colgar.includes("escribir")
        ? nunca
        : async () => ({ write: async (d) => (archivo.datos = d), close: async () => mapa.set(n, archivo) });
      archivo.getFile = async () => ({ size: archivo.datos?.length ?? 0, lastModified: 0 });
      return archivo;
    },
    entries() {
      if (colgar.includes("listar")) return { [Symbol.asyncIterator]: () => ({ next: nunca }) };
      return mapa.entries()[Symbol.iterator] ? (async function* () { yield* mapa.entries(); })() : null;
    },
    async removeEntry(n) {
      mapa.delete(n);
    },
    hijos: mapa,
  });
  return dir("ONEDRIVE", hijos);
}

async function sesionConCarpeta(colgar) {
  const almacen = await almacenDe("DLTA");
  await almacen.backend.guardarAjuste("carpeta", carpeta(colgar));
  await almacen.backend.guardarAjuste("ultimo_respaldo", { fecha_hora: "2026-11-20T08:00:00", destino: "x", nombre: "x.zip" });
  return new Sesion(new Almacen(almacen.backend, { inventario: "DLTA" }), almacen.backend);
}

test("Sesion.iniciar no espera el respaldo del día ni a una carpeta que no responde", async () => {
  const pasos = [];
  const sesion = await sesionConCarpeta(["permiso"]);
  const inicio = Date.now();
  await sesion.iniciar({ alPaso: (p) => pasos.push(p), limiteMs: 30 });
  assert.ok(Date.now() - inicio < 2000);
  assert.deepEqual(pasos, ["datos", "compartidos", "carpeta", "abrir"]);
  assert.equal(sesion.permiso, "prompt", "sin respuesta del permiso se sigue como si hubiera que pedirlo");
  assert.equal(sesion.carpetaLista, false);
});

test("el respaldo del inicio del día va después de abrir; si la carpeta no lista, se deja la limpieza para otro día", async () => {
  const sesion = await sesionConCarpeta(["listar"]);
  await sesion.iniciar({ limiteMs: 30 });
  assert.equal(sesion.carpetaLista, true);
  assert.equal(sesion.carpeta.hijos.get("respaldos"), undefined, "iniciar no respalda");
  // aplicarRetencion con límite corto: la carpeta no lista, pero el respaldo queda y no se cuelga
  const original = sesion.aplicarRetencion.bind(sesion);
  sesion.aplicarRetencion = () => original({ limiteMs: 30 });
  await sesion.alAbrir({ esperaMs: 0 });
  assert.equal(sesion.carpeta.hijos.get("respaldos").hijos.size, 1);
  assert.equal(sesion.respaldoDeHoy, true);
});
