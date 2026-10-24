// Navegación real en el HTML autónomo: escritorio, ventana mediana y móvil.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("navegación adaptable y preferencia de menú compacto en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-nav-"));
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
  async function abrir(viewport, vacia = false) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errores = [], externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    await page.goto(origen + "/blank");
    if (!vacia) await page.evaluate(async (f) => {
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
    await page.goto(origen + (vacia ? "/#carga" : "/#inventario"));
    await page.locator(".navegacion").waitFor();
    const terminar = async () => { assert.deepEqual(errores, []); assert.deepEqual(externas, []); await context.close(); };
    return { page, terminar };
  }
  async function sinDesbordamiento(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "La página se sale del ancho de la ventana");
  }
  const abrirMas = async (page) => {
    await page.getByRole("button", { name: "Más secciones", exact: true }).click();
    return page.getByRole("dialog", { name: "Todas las secciones", exact: true });
  };

  await t.test("escritorio: contraer, recargar, expandir y mantener el menú alcanzable en una ventana baja", async () => {
    const { page, terminar } = await abrir({ width: 1440, height: 600 });
    const nav = page.locator(".navegacion");
    assert.equal(Math.round((await nav.boundingBox()).width), 236);
    await page.getByRole("button", { name: "Contraer menú lateral", exact: true }).click();
    assert.equal(Math.round((await nav.boundingBox()).width), 76);
    assert.equal(await nav.getByRole("link", { name: "Inventario", exact: true }).getAttribute("title"), "Inventario");
    await page.reload();
    await page.getByRole("button", { name: "Expandir menú lateral", exact: true }).waitFor();
    assert.equal(Math.round((await nav.boundingBox()).width), 76);
    await page.getByRole("button", { name: "Expandir menú lateral", exact: true }).click();
    const mas = await nav.getByRole("link", { name: "Ajustes y más", exact: true }).boundingBox();
    assert.ok(mas.y + mas.height <= 601);
    await sinDesbordamiento(page); await terminar();
  });

  await t.test("ventana mediana: iconos por defecto y menú completo accesible con teclado", async () => {
    const { page, terminar } = await abrir({ width: 900, height: 600 });
    const nav = page.locator(".navegacion");
    assert.equal(Math.round((await nav.boundingBox()).width), 76);
    const boton = page.getByRole("button", { name: "Abrir menú de secciones", exact: true });
    await boton.focus(); await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Todas las secciones", exact: true });
    for (const nombre of ["Vales de entrada", "Historial de vales", "Conteo físico", "Etiquetas", "Reporte diario", "Conciliación AX", "Ajustes"]) {
      assert.equal(await menu.getByRole("link", { name: nombre, exact: true }).isVisible(), true);
    }
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
    assert.equal(await boton.evaluate((e) => e === document.activeElement), true);
    const cabecera = await page.locator(".cabecera").boundingBox(), menuRect = await nav.boundingBox();
    assert.ok(Math.abs(menuRect.y - cabecera.y - cabecera.height) <= 1);
    await sinDesbordamiento(page); await terminar();
  });

  await t.test("móvil 390 y 320: barra inferior, todas las secciones disponibles y sin desbordamiento", async () => {
    const { page, terminar } = await abrir({ width: 390, height: 844 });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 680 });
      const barra = page.locator(".nav-inferior"), rect = await barra.boundingBox();
      assert.ok(rect && rect.y + rect.height <= 681);
      for (const nombre of ["Inicio", "Vales de salida", "Inventario"]) assert.equal(await barra.getByRole("link", { name: nombre, exact: true }).isVisible(), true);
      await sinDesbordamiento(page);
      const menu = await abrirMas(page);
      for (const nombre of ["Vales de entrada", "Historial de vales", "Conteo físico", "Reporte diario", "Conciliación AX", "Etiquetas", "Áreas y personas", "Ajustes"]) assert.equal(await menu.getByRole("link", { name: nombre, exact: true }).isVisible(), true);
      await menu.getByRole("link", { name: "Vales de entrada", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#entradas");
      assert.equal(await menu.count(), 0);
      await barra.getByRole("link", { name: "Inventario", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#inventario");
    }
    await terminar();
  });

  await t.test("sin datos: el menú móvil mantiene Primera carga, Respaldos y Ayuda", async () => {
    const { page, terminar } = await abrir({ width: 320, height: 680 }, true);
    await sinDesbordamiento(page);
    assert.equal(await page.locator(".nav-inferior").getByRole("link", { name: "Primera carga", exact: true }).isVisible(), true);
    const menu = await abrirMas(page);
    assert.equal(await menu.getByRole("link", { name: "Respaldos", exact: true }).isVisible(), true);
    assert.equal(await menu.getByRole("link", { name: "Ayuda", exact: true }).isVisible(), true);
    await terminar();
  });
});
