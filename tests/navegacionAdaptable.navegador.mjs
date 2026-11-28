// Navegación real en el HTML autónomo (Ronda 34, §7 de docs/13): menú completo o de íconos, Ctrl + B, encima en
// ventana angosta y sin barra inferior en ninguna anchura.
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
    assert.equal(await page.evaluate(() => (() => { const a = document.querySelector(".cuerpo > main.contenido"); return Math.max(document.documentElement.scrollWidth - innerWidth, a ? a.scrollWidth - a.clientWidth : 0); })() <= 1), true, "La página se sale del ancho de la ventana");
  }
  const ancho = async (loc) => Math.round((await loc.boundingBox()).width);

  await t.test("escritorio: contraer y expandir con el botón y con Ctrl + B, recordado al recargar; nada al pasar el cursor", async () => {
    const { page, terminar } = await abrir({ width: 1440, height: 600 });
    const nav = page.locator(".navegacion");
    const enCabecera = page.locator(".cabecera").getByRole("radiogroup", { name: "Inventario" });
    const enMenu = nav.getByRole("radiogroup", { name: "Inventario" });
    assert.equal(await ancho(nav), 236);
    // Ronda 35: con el menú completo, DLTA | GSM va arriba del menú, a la izquierda de «Contraer menú».
    assert.equal(await enMenu.isVisible(), true);
    assert.equal(await enCabecera.count(), 0);
    const contraer = page.getByRole("button", { name: "Contraer menú", exact: true });
    assert.equal(await contraer.getAttribute("title"), "Contraer menú (Ctrl + B)");
    const caja = await contraer.boundingBox();
    assert.deepEqual([Math.round(caja.width), Math.round(caja.height)], [36, 36]);
    const selector = await enMenu.boundingBox();
    assert.ok(selector.x + selector.width <= caja.x && Math.abs(selector.y + selector.height / 2 - (caja.y + caja.height / 2)) <= 2, "DLTA | GSM junto al botón");
    await contraer.click();
    assert.equal(await ancho(nav), 64);
    // De íconos: el inventario vuelve a la cabecera. Ronda 39 (docs/14 §1): a 600 px de alto el menú se compacta y cabe
    // (sin barra vertical ni horizontal); «Ajustes y más» y la cabecera se ven completos.
    assert.equal(await enCabecera.isVisible(), true);
    assert.equal(await enMenu.count(), 0);
    const lista = page.locator(".nav-principal");
    assert.equal(await lista.evaluate((e) => e.scrollHeight <= e.clientHeight), true, "a 600 px de alto el menú cabe compacto, sin desplazarse");
    assert.equal(await lista.evaluate((e) => e.scrollWidth <= e.clientWidth), true, "sin barra horizontal en el menú de íconos");
    const cajaMas = await nav.locator(".nav-boton-mas").boundingBox();
    assert.ok(cajaMas.y >= 0 && cajaMas.y + cajaMas.height <= 600, "«Ajustes y más» se ve completo");
    const inventario = nav.getByRole("link", { name: "Inventario", exact: true });
    assert.equal(await inventario.getAttribute("title"), "Inventario");
    const boton = await inventario.boundingBox();
    assert.deepEqual([Math.round(boton.width), Math.round(boton.height)], [44, 38], "compacto a lo alto en una ventana baja");
    await nav.hover(); await page.waitForTimeout(300);
    assert.equal(await ancho(nav), 64, "no se abre solo al pasar el cursor");
    await page.reload();
    await page.getByRole("button", { name: "Expandir menú", exact: true }).waitFor();
    assert.equal(await ancho(nav), 64, "se queda como lo dejó");
    await page.keyboard.press("Control+b");
    assert.equal(await ancho(nav), 236);
    await page.keyboard.press("Control+b");
    assert.equal(await ancho(nav), 64);
    await page.keyboard.press("Control+b");
    const mas = await nav.getByRole("link", { name: /^Ajustes y más/ }).boundingBox();
    assert.ok(mas.y + mas.height <= 601);
    await sinDesbordamiento(page); await terminar();
  });

  await t.test("ventana mediana (1024): íconos siempre; expandir lo abre encima sin mover el contenido; Esc, clic fuera o un enlace lo cierran", async () => {
    const { page, terminar } = await abrir({ width: 1024, height: 700 });
    const nav = page.locator(".navegacion"), contenido = page.locator(".contenido");
    assert.equal(await ancho(nav), 64);
    const x = (await contenido.boundingBox()).x;
    const expandir = page.getByRole("button", { name: "Expandir menú", exact: true });
    await expandir.click();
    const encima = page.locator(".navegacion.encima");
    await encima.waitFor();
    assert.equal(await ancho(encima), 236);
    assert.equal((await contenido.boundingBox()).x, x, "el contenido no se mueve");
    assert.equal(await encima.getByRole("radiogroup", { name: "Inventario" }).count(), 0, "encima no se repite: sigue en la cabecera");
    assert.equal(await page.locator(".cabecera").getByRole("radiogroup", { name: "Inventario" }).isVisible(), true);
    for (const nombre of ["Vales de entrada", "Historial de vales", "Conteo físico", "Etiquetas", "Reporte diario", "Conciliación AX"]) {
      assert.equal(await encima.getByRole("link", { name: nombre, exact: true }).isVisible(), true);
    }
    await page.keyboard.press("Escape");
    assert.equal(await encima.count(), 0);
    assert.equal(await expandir.evaluate((e) => e === document.activeElement), true, "el foco vuelve al botón");
    await page.keyboard.press("Control+b");
    await encima.waitFor();
    await page.mouse.click(900, 400); // en el fondo oscurecido
    assert.equal(await encima.count(), 0);
    await page.keyboard.press("Control+b");
    await encima.getByRole("link", { name: "Reporte diario", exact: true }).click();
    await page.waitForFunction(() => location.hash.startsWith("#reporte"));
    assert.equal(await encima.count(), 0);
    assert.equal(await ancho(nav), 64);
    const cabecera = await page.locator(".cabecera").boundingBox(), menuRect = await nav.boundingBox();
    assert.ok(Math.abs(menuRect.y - cabecera.y - cabecera.height) <= 1);
    await sinDesbordamiento(page); await terminar();
  });

  await t.test("640, 390 y 320: el menú de íconos se queda, sin barra inferior ni desbordamiento", async () => {
    const { page, terminar } = await abrir({ width: 640, height: 700 });
    const nav = page.locator(".navegacion");
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 680 });
      assert.equal(await ancho(nav), 64);
      assert.equal(await page.locator(".nav-inferior").count(), 0);
      for (const nombre of ["Inicio", "Vales de salida", "Inventario"]) assert.equal(await nav.getByRole("link", { name: new RegExp(`^${nombre}`) }).isVisible(), true);
      await sinDesbordamiento(page);
      await page.getByRole("button", { name: "Expandir menú", exact: true }).click();
      const encima = page.locator(".navegacion.encima");
      await encima.getByRole("link", { name: "Vales de entrada", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#entradas");
      assert.equal(await encima.count(), 0);
      await nav.getByRole("link", { name: "Inventario", exact: true }).click();
      await page.waitForFunction(() => location.hash === "#inventario");
    }
    await terminar();
  });

  await t.test("pendientes: en el menú de íconos son un punto y el número va en el nombre del enlace", async () => {
    const { page, terminar } = await abrir({ width: 1024, height: 700 });
    const conPunto = page.locator(".navegacion a:has(.contador)");
    assert.ok((await conPunto.count()) > 0, "la fixture tiene algo pendiente (vales por subir)");
    const primero = conPunto.first();
    assert.match(await primero.getAttribute("aria-label"), /, \d+ /);
    const punto = await primero.locator(".contador").boundingBox();
    assert.ok(punto.width <= 12 && punto.height <= 12, `punto de ${punto.width}×${punto.height}`);
    await terminar();
  });

  await t.test("sin datos (320): el menú solo lleva a Inicio (ni Primera carga ni Ajustes y más) y la bienvenida cabe", async () => {
    const { page, terminar } = await abrir({ width: 320, height: 680 }, true);
    await sinDesbordamiento(page);
    const nav = page.locator(".navegacion");
    assert.deepEqual(await nav.getByRole("link").evaluateAll((a) => a.map((x) => x.getAttribute("aria-label"))), ["Inicio"]);
    assert.equal(await nav.getByRole("link", { name: /^Ajustes y más/ }).count(), 0);
    await page.evaluate(() => { location.hash = "#inicio"; });
    await page.getByRole("button", { name: /Empezar desde cero/ }).waitFor();
    await sinDesbordamiento(page);
    await terminar();
  });
});
