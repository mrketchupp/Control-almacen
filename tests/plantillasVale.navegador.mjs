// Ronda 35 en el HTML autónomo: las tres plantillas del vale, agregar un área y un destino desde «Áreas y personas»
// y verlos en el paso 1 del vale; la plantilla Consumo interno cambia las observaciones de todas sus áreas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("plantillas del vale, áreas y destinos en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-plantillas-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const servidor = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(req.url === "/blank" ? "<html><body></body></html>" : documento);
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => servidor.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = "ALMACENISTA UNO";
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errores = [], externas = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
  await page.goto(origen + "/blank");
  await page.evaluate(async (f) => {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open("control-almacen", 1);
      q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["estado", "archivos"], "readwrite"); tx.objectStore("estado").put(f.estado, "actual");
      for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, fixture);
  const leer = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
    q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    }; q.onerror = () => reject(q.error);
  }));
  const esperar = async (cumple, mensaje) => {
    for (let i = 0; i < 60; i += 1) { const e = await leer(); if (cumple(e)) return e; await page.waitForTimeout(100); }
    assert.fail(mensaje);
  };

  await page.goto(origen + "/#areas");
  const mas = page.getByRole("dialog", { name: "Ajustes y más" });
  await mas.getByRole("heading", { name: "Plantillas del vale", exact: true }).waitFor();
  assert.deepEqual(await mas.locator(".plantilla-vale strong").allInnerTexts(), ["Consumo interno", "NOV", "Transferencia"]);
  // Áreas y destinos en una sola lista; el equipo propio (RIG 91) no sale como destino.
  const lista = mas.locator("table").first();
  for (const nombre of ["SOLDADOR", "MECANICO", "NOV", "RIG 48", "BASE MARIN"]) await lista.getByRole("cell", { name: nombre, exact: true }).first().waitFor(); // nombre (y departamento)
  assert.equal(await lista.getByRole("cell", { name: "RIG 91", exact: true }).count(), 0);
  // Un destino es su propio departamento.
  assert.deepEqual(await lista.getByRole("row", { name: /^RIG 48 / }).getByRole("cell").allInnerTexts().then((t) => t.slice(0, 3).map((x) => x.trim())), ["RIG 48", "Transferencia", "RIG 48"]);
  // Un destino nuevo: nombre + plantilla Transferencia.
  await mas.getByRole("button", { name: "＋ Agregar", exact: true }).click();
  await mas.locator("#nuevo-nombre").fill("rig 302");
  await mas.getByRole("radio", { name: /^Transferencia/ }).click();
  await mas.getByRole("button", { name: "Agregar destino", exact: true }).click();
  await lista.getByRole("cell", { name: "RIG 302", exact: true }).first().waitFor(); // nombre y departamento
  // Un área nueva de consumo interno: solo nombre y plantilla.
  await mas.getByRole("button", { name: "＋ Agregar", exact: true }).click();
  await mas.locator("#nuevo-nombre").fill("electrico sintetico");
  await mas.getByRole("button", { name: "Agregar área", exact: true }).click();
  await lista.getByRole("cell", { name: "ELECTRICO SINTETICO", exact: true }).first().waitFor();
  let e = await esperar((x) => x.plantillas_area.some((a) => a.nombre === "ELECTRICO SINTETICO") && x.config.destinos_transferencia?.includes("RIG 302"), "No se guardaron");
  const electrico = e.plantillas_area.find((a) => a.nombre === "ELECTRICO SINTETICO");
  assert.deepEqual([electrico.tipo, electrico.depto_destino], ["INTERNO", "ELECTRICO SINTETICO"]);
  // La plantilla Consumo interno: sus observaciones quedan en todas sus áreas.
  await mas.locator(".plantilla-vale").first().getByRole("button", { name: "Editar", exact: true }).click();
  await mas.getByRole("textbox", { name: "Observaciones de la plantilla" }).fill("MATERIAL SINTETICO PARA EL EQUIPO\nETAPA DE PERFORACION: 8");
  await mas.getByRole("button", { name: "Guardar plantilla", exact: true }).click();
  e = await esperar((x) => x.plantillas_area.filter((a) => a.tipo === "INTERNO" && a.activo !== false).every((a) => a.observaciones?.startsWith("MATERIAL SINTETICO")), "No se guardó la plantilla");
  assert.ok(e.plantillas_area.filter((a) => a.tipo === "INTERNO").length >= 3);
  // En el vale: el área nueva sale en «Área» y el destino nuevo en «¿A dónde se envía?».
  await page.goto(origen + "/#vales");
  await page.getByRole("button", { name: /＋ Nuevo vale/ }).first().click();
  await page.getByRole("radiogroup", { name: "Área" }).getByRole("radio", { name: /ELECTRICO SINTETICO/ }).click();
  await page.getByText(/^Observaciones de ELECTRICO SINTETICO/).waitFor();
  await page.getByRole("radio", { name: "Transferencia", exact: true }).click();
  await page.getByRole("radiogroup", { name: "¿A dónde se envía?" }).getByRole("radio", { name: "RIG 302", exact: true }).click();
  await page.getByText(/^Las observaciones dicen «PARA USO EN RIG 302»/).waitFor();
  assert.deepEqual(errores, []); assert.deepEqual(externas, []);
  await context.close();
});
