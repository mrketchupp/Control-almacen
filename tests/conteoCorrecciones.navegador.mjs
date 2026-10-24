// Correcciones del conteo en el HTML compilado: borrador, revisión y aplicación.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { iniciarConteo } from "../src/servicios/conteos.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("las correcciones de conteo requieren revisión y conservan los vales en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-conteo-correcciones-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const servidor = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" }); res.end(req.url === "/blank" ? "<html><body></body></html>" : html); });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => servidor.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });

  async function abrir() {
    const { estado } = cargaSintetica();
    const partida = estado.existencias.find((e) => estado.variantes.find((v) => v.id === e.variante_id)?.codigo === 701);
    const variante = estado.variantes.find((v) => v.id === partida.variante_id);
    estado.config.usuario_en_turno = "ALMACENISTA UNO";
    iniciarConteo(estado, { ubicaciones: [partida.ubicacion_id], fecha: "2026-10-24", usuario: "ALMACENISTA UNO" });
    const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
    await almacen.cargarPrimeraVez(estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errores = [], externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      const db = await new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
        q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => { const tx = db.transaction(["estado", "archivos"], "readwrite");
        tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, fixture);
    const leer = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
        r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
      };
    }));
    const esperar = async (condicion) => { for (let i = 0; i < 100; i++) { const e = await leer(); if (condicion(e)) return e; await new Promise((resolve) => setTimeout(resolve, 25)); } assert.fail("No se guardó el cambio del conteo"); };
    await page.goto(origen + "/#conteo");
    const fila = page.locator(".tabla-conteo tbody tr").filter({ hasText: "701" }).filter({ hasText: variante.dimension }).first();
    await fila.waitFor({ state: "visible" });
    const terminar = async () => { assert.deepEqual(errores, []); assert.deepEqual(externas, []); await context.close(); };
    return { page, fila, partida, fixture, leer, esperar, terminar };
  }

  await t.test("corregir dimensión y NP sólo cambia el inventario después de confirmar", async () => {
    const { page, fila, partida, fixture, leer, esperar, terminar } = await abrir();
    await fila.getByRole("button", { name: "Corregir dimensión / NP", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Corregir partida del conteo", exact: true });
    await editor.getByRole("textbox", { name: "Dimensión corregida", exact: true }).fill("DIM CONTEO SINTETICA");
    await editor.getByRole("textbox", { name: "NP corregido", exact: true }).fill("NP CONTEO SINTETICO");
    await editor.getByRole("button", { name: "Guardar en el conteo", exact: true }).click();
    await esperar((e) => e.conteo_en_curso?.correcciones?.length === 1);
    const borrador = await leer();
    assert.deepEqual(borrador.existencias, fixture.estado.existencias);
    assert.deepEqual(borrador.variantes, fixture.estado.variantes);
    await page.getByRole("button", { name: "Revisar y aplicar conteo", exact: true }).click();
    const revision = page.getByRole("dialog", { name: "Revisar conteo físico", exact: true });
    assert.match(await revision.innerText(), /DIM CONTEO SINTETICA/);
    assert.deepEqual((await leer()).variantes, fixture.estado.variantes);
    await revision.getByRole("button", { name: "Confirmar conteo", exact: true }).click();
    const final = await esperar((e) => e.conteo_en_curso === null), corregida = final.existencias.find((e) => e.id === partida.id);
    const variante = final.variantes.find((v) => v.id === corregida.variante_id);
    assert.deepEqual([variante.dimension, variante.np], ["DIM CONTEO SINTETICA", "NP CONTEO SINTETICO"]);
    assert.deepEqual([corregida.cantidad_conteo, corregida.conteo_id], [partida.cantidad_conteo, partida.conteo_id]);
    assert.deepEqual(final.vales, fixture.estado.vales);
    assert.equal(final.conteos.at(-1).correcciones.length, 1);
    await terminar();
  });

  await t.test("quitar se puede deshacer en el borrador y requiere confirmar la baja", async () => {
    const { page, fila, partida, fixture, leer, esperar, terminar } = await abrir();
    await fila.getByRole("button", { name: "Quitar partida", exact: true }).click();
    assert.match(await fila.innerText(), /Se quitará/);
    assert.deepEqual((await leer()).existencias, fixture.estado.existencias);
    await fila.getByRole("button", { name: "Deshacer corrección", exact: true }).click();
    assert.equal(await fila.getByRole("button", { name: "Quitar partida", exact: true }).count(), 1);
    await fila.getByRole("button", { name: "Quitar partida", exact: true }).click();
    await page.getByRole("button", { name: "Revisar y aplicar conteo", exact: true }).click();
    const revision = page.getByRole("dialog", { name: "Revisar conteo físico", exact: true });
    assert.match(await revision.innerText(), /Fuera del inventario activo, con cantidad 0/);
    assert.deepEqual((await leer()).existencias, fixture.estado.existencias);
    await revision.getByRole("button", { name: "Confirmar conteo", exact: true }).click();
    const final = await esperar((e) => e.conteo_en_curso === null), retirada = final.existencias.find((e) => e.id === partida.id);
    assert.deepEqual([retirada.activo, retirada.cantidad_conteo], [false, "0"]);
    assert.deepEqual(final.vales, fixture.estado.vales);
    assert.equal(final.conteos.at(-1).lineas.find((l) => l.existencia_id === partida.id).activo_anterior, true);
    await terminar();
  });
});
