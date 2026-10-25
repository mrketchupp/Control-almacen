// Prueba opcional con Chromium real; no forma parte del glob de `npm test` (necesita `npm run build`).
// Con Playwright instalado: node --test tests/descripcionCodigo.navegador.mjs
// Opcionales: PLAYWRIGHT_MODULE (módulo o file: URL), CHROMIUM_BIN (ejecutable) y PYTHON (como tests/ayuda.js).

import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Indices } from "../src/nucleo/estado.js";
import * as co from "../src/servicios/conteos.js";
import * as en from "../src/servicios/entradas.js";
import * as v from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const NUEVA = "DESCRIPCIÓN CORREGIDA DE PRUEBA";

test("corregir la descripción de un código desde el inventario, la corrección de un vale, los borradores y el conteo, en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-descripcion-codigo-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" }); res.end(req.url === "/blank" ? "<html><body></body></html>" : html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });

  /** Abre la aplicación con ese estado ya guardado en IndexedDB. */
  async function abrir(estado) {
    estado.config.usuario_en_turno = "ALMACENISTA UNO";
    const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
    await almacen.cargarPrimeraVez(estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
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
    const leer = () => page.evaluate(() => new Promise((resolve, reject) => {
      const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual"); r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error); };
      q.onerror = () => reject(q.error);
    }));
    return { page, leer, errores, externas, cerrar: () => context.close() };
  }
  const cuerpo = (estado) => JSON.stringify({ vales: estado.vales, articulos: estado.articulos });
  const lapiz = (page, codigo) => page.getByRole("button", { name: `Corregir la descripción del código ${codigo}`, exact: true });
  const ventana = (page, codigo) => page.getByRole("dialog", { name: `Descripción del código ${codigo}`, exact: true });
  const campo = (page, codigo) => ventana(page, codigo).getByRole("textbox", { name: `Descripción del código ${codigo}`, exact: true });

  await t.test("inventario: Escape no guarda y Enter corrige el catálogo sin tocar los vales", async () => {
    const { estado } = cargaSintetica();
    const { page, leer, errores, externas, cerrar } = await abrir(estado);
    await page.goto(`${origen}/#inventario`);
    const fila = page.locator(".tabla tbody tr").first();
    const codigo = Number((await fila.locator("td").nth(1).innerText()).trim());
    const antes = await leer();
    const descripcion = antes.articulos[codigo].descripcion;

    await lapiz(page, codigo).first().click();
    await ventana(page, codigo).waitFor();
    assert.equal(await ventana(page, codigo).getByRole("button", { name: "Guardar descripción", exact: true }).isDisabled(), true, "sin cambios no se puede guardar");
    assert.equal(await campo(page, codigo).inputValue(), descripcion);
    await campo(page, codigo).fill("otra descripción sin guardar");
    await page.keyboard.press("Escape");
    await ventana(page, codigo).waitFor({ state: "hidden" });
    assert.equal((await leer()).articulos[codigo].descripcion, descripcion);

    await lapiz(page, codigo).first().click();
    await campo(page, codigo).fill("descripción corregida de prueba");
    await ventana(page, codigo).getByRole("textbox", { name: "Motivo (opcional)" }).fill("Así viene en AX");
    await campo(page, codigo).press("Enter");
    await ventana(page, codigo).waitFor({ state: "hidden" });
    await page.locator(".tabla tbody tr", { hasText: NUEVA }).first().waitFor();
    const despues = await leer();
    assert.equal(despues.articulos[codigo].descripcion, NUEVA);
    const registro = despues.auditoria.filter((a) => a.accion === "CORREGIR_DESCRIPCION").at(-1);
    assert.deepEqual([registro.entidad_id, registro.antes.descripcion, registro.despues.descripcion, registro.despues.motivo], [String(codigo), descripcion, NUEVA, "Así viene en AX"]);
    assert.equal(JSON.stringify(despues.vales), JSON.stringify(antes.vales), "los vales emitidos no cambian");
    // Otra vez abierta, muestra la corrección anterior para poder volver al texto de antes.
    await lapiz(page, codigo).first().click();
    assert.match(await ventana(page, codigo).innerText(), new RegExp(`antes decía\\s+${descripcion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await cerrar();
  });

  await t.test("corregir un vale del historial: la partida toma la descripción nueva y la corrección la registra", async () => {
    const { estado } = cargaSintetica();
    const vale = estado.vales.find((x) => x.tipo === "SALIDA" && x.estado === "EMITIDO" && x.lineas.some((l) => Number.isInteger(l.codigo) && estado.articulos[l.codigo]));
    const indice = vale.lineas.findIndex((l) => Number.isInteger(l.codigo) && estado.articulos[l.codigo]);
    const { codigo, descripcion } = vale.lineas[indice];
    const { page, leer, errores, externas, cerrar } = await abrir(estado);
    await page.goto(`${origen}/#vale/${vale.id}`);
    await page.getByRole("button", { name: "Corregir", exact: true }).click();
    await lapiz(page, codigo).first().click();
    await campo(page, codigo).fill("descripción corregida de prueba");
    await ventana(page, codigo).getByRole("button", { name: "Guardar descripción", exact: true }).click();
    await ventana(page, codigo).waitFor({ state: "hidden" });
    await page.locator("td.col-descripcion .descripcion", { hasText: NUEVA }).first().waitFor();
    const motivo = page.getByRole("textbox", { name: "Motivo de la corrección", exact: true });
    assert.match(await motivo.inputValue(), new RegExp(`descripción .* → ${NUEVA}`), "el motivo se llena con el cambio de descripción");
    // Hasta guardar la corrección, el vale conserva su texto.
    assert.equal((await leer()).vales.find((x) => x.id === vale.id).lineas[indice].descripcion, descripcion);
    await page.getByRole("button", { name: "Guardar corrección", exact: true }).click();
    await page.getByRole("button", { name: "Corregir", exact: true }).waitFor();
    const guardado = await leer();
    assert.equal(guardado.vales.find((x) => x.id === vale.id).lineas[indice].descripcion, NUEVA);
    assert.equal(guardado.articulos[codigo].descripcion, NUEVA);
    const bitacora = guardado.auditoria.filter((a) => a.entidad === "vale" && a.accion === "CORREGIR").at(-1);
    assert.ok(bitacora.antes.cambios.some((c) => c.includes("descripción")));
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await cerrar();
  });

  await t.test("borrador de salida: la partida abierta toma la descripción y sigue igual al capturar después", async () => {
    const { estado } = cargaSintetica();
    const indices = new Indices(estado);
    const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
    const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
    const borrador = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: mecanico.id, fecha: "2026-10-01" });
    borrador.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
    const { page, leer, errores, externas, cerrar } = await abrir(estado);
    await page.goto(`${origen}/#vales`);
    await lapiz(page, 706).click();
    await campo(page, 706).fill("descripción corregida de prueba");
    await campo(page, 706).press("Enter");
    await ventana(page, 706).waitFor({ state: "hidden" });
    await page.locator("td.col-descripcion .descripcion", { hasText: NUEVA }).first().waitFor();
    // Capturar la cantidad después no devuelve el texto de antes (el borrador se guarda solo).
    const cantidad = page.getByRole("textbox", { name: "Cantidad", exact: true }).first();
    await cantidad.fill("2");
    await page.waitForTimeout(1200);
    const guardado = await leer();
    assert.equal(guardado.articulos[706].descripcion, NUEVA);
    assert.deepEqual([guardado.borradores[0].lineas[0].descripcion, guardado.borradores[0].lineas[0].cantidad], [NUEVA, "2"]);
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await cerrar();
  });

  await t.test("borrador de entrada: la partida abierta toma la descripción", async () => {
    const { estado } = cargaSintetica();
    const indices = new Indices(estado);
    const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
    const borrador = en.nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO", fecha: "2026-10-02" });
    Object.assign(borrador, { folio_externo: "B-100", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL" });
    borrador.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "2" }];
    const { page, leer, errores, externas, cerrar } = await abrir(estado);
    await page.goto(`${origen}/#entradas`);
    await lapiz(page, 701).click();
    await campo(page, 701).fill("descripción corregida de prueba");
    await ventana(page, 701).getByRole("button", { name: "Guardar descripción", exact: true }).click();
    await ventana(page, 701).waitFor({ state: "hidden" });
    await page.locator(".pf-desc .descripcion", { hasText: NUEVA }).first().waitFor();
    await page.waitForTimeout(1200);
    const guardado = await leer();
    assert.equal(guardado.articulos[701].descripcion, NUEVA);
    assert.equal(guardado.borradores_entrada[0].lineas[0].descripcion, NUEVA);
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await cerrar();
  });

  await t.test("conteo: la partida encontrada toma la descripción del código", async () => {
    const { estado } = cargaSintetica();
    const indices = new Indices(estado);
    const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
    const datos = co.iniciarConteo(estado, { ubicaciones: [sellos.ubicacion_id], fecha: "2026-10-05" });
    co.guardarConteoEnCurso(estado, { ...datos, nuevos: [{ ...co.nuevoSobrante(sellos.ubicacion_id), codigo: 706, descripcion: estado.articulos[706].descripcion, dimension: "OTRA", um: "PZA", cantidad: "1" }] });
    const { page, leer, errores, externas, cerrar } = await abrir(estado);
    await page.goto(`${origen}/#conteo`);
    await lapiz(page, 706).click();
    await campo(page, 706).fill("descripción corregida de prueba");
    await campo(page, 706).press("Enter");
    await ventana(page, 706).waitFor({ state: "hidden" });
    await page.locator(".tabla-partidas .descripcion", { hasText: NUEVA }).first().waitFor();
    await page.waitForTimeout(1200);
    const guardado = await leer();
    assert.equal(guardado.articulos[706].descripcion, NUEVA);
    assert.equal(guardado.conteo_en_curso.nuevos[0].descripcion, NUEVA);
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await cerrar();
  });
});
