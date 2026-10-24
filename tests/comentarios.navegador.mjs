// Recorrido real desde los Excel sintéticos: primera carga, emisión, impresión, exportación y respaldo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FORMATO_ESTADO } from "../src/nucleo/estado.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { leerRespaldo } from "../src/almacen/respaldos.js";
import { fixtures, FOLIO_CORTE } from "./ayuda.js";

test("la carga simplificada conserva el recorrido de emitir, imprimir, exportar y respaldar en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const contenido = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-comentarios-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" }); res.end(contenido); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  const contexto = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "America/Mexico_City", acceptDownloads: true });
  await contexto.addInitScript(() => {
    delete window.showSaveFilePicker; delete window.showDirectoryPicker;
    window.__impresiones = [];
    window.print = () => {
      window.__impresiones.push(document.getElementById("area-impresion")?.innerHTML ?? "");
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", (d) => d.accept());
  const errores = [], externas = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
  const ir = async (ruta) => { await page.evaluate((hash) => { location.hash = hash; }, ruta); };
  const leerEstado = () => page.evaluate(() => new Promise((resolve, reject) => {
    const q = indexedDB.open("control-almacen", 1);
    q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    }; q.onerror = () => reject(q.error);
  }));
  const descarga = async (accion) => {
    const esperando = page.waitForEvent("download"); await accion();
    const archivo = await esperando; assert.equal(await archivo.failure(), null);
    return { nombre: archivo.suggestedFilename(), datos: new Uint8Array(await readFile(await archivo.path())) };
  };
  try {
    await page.goto(`${origen}/#carga`);
    await page.locator("label.boton").filter({ hasText: /^Elegir inventario$/ }).locator("input[type=file]").setInputFiles(fixtures.inventario);
    await page.locator("label.boton").filter({ hasText: /^Elegir libro de vales$/ }).locator("input[type=file]").setInputFiles(fixtures.vales);
    await page.getByLabel(/Fecha del conteo físico/).fill("2026-09-03");
    await page.getByLabel(/Último folio ya reflejado en el conteo/).fill(String(FOLIO_CORTE));
    await page.getByPlaceholder("Nombre como firma los vales").fill("ALMACENISTA UNO");
    await page.getByRole("button", { name: "Ensayar", exact: true }).click();
    await page.getByRole("button", { name: "Cargar definitivamente", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator(".primera-carga .carga-archivo-listo").count(), 2);
    assert.match(await page.locator(".carga-revision").innerText(), /Correcciones aplicadas/);
    if (process.env.COMENTARIOS_SCREENSHOTS) await page.screenshot({ path: join(process.env.COMENTARIOS_SCREENSHOTS, "primera-carga.png"), fullPage: true });
    for (const [nombre, vista] of [["ventana", { width: 960, height: 700 }], ["movil", { width: 390, height: 844 }]]) {
      await page.setViewportSize(vista);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `La primera carga desborda en ${nombre}`);
      if (process.env.COMENTARIOS_SCREENSHOTS) await page.screenshot({ path: join(process.env.COMENTARIOS_SCREENSHOTS, `primera-carga-${nombre}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const inicial = await descarga(() => page.getByRole("button", { name: "Cargar definitivamente", exact: true }).click());
    assert.match(inicial.nombre, /primera-carga.*\.zip$/);
    assert.equal(leerRespaldo(inicial.datos).estado.formato, FORMATO_ESTADO);
    await page.waitForFunction(() => location.hash === "#inicio");
    const antes = await leerEstado();
    const ultimo = Math.max(...antes.vales.filter((v) => v.tipo === "SALIDA").map((v) => v.folio));

    await ir("#vales");
    await page.getByRole("button", { name: /Nuevo vale · folio/ }).click();
    await page.getByRole("button", { name: "Área que recibe", exact: true }).click();
    await page.getByRole("option", { name: "MECANICO", exact: true }).click();
    await page.getByLabel("Recibió", { exact: true }).fill("MECANICO UNO");
    await page.getByLabel("Puesto de quien recibe", { exact: true }).fill("MECANICO");
    const etapa = page.getByLabel(/Etapa de perforación/);
    if (await etapa.count()) await etapa.fill('12 1/4" SINTETICA');
    const codigo = page.getByRole("combobox", { name: "Código AX", exact: true }).first();
    await codigo.fill("136");
    await page.getByRole("option").filter({ hasText: /^136\b/ }).click();
    await page.getByLabel("Cantidad", { exact: true }).first().fill("2");
    await page.getByLabel("Presentación (UM)", { exact: true }).first().fill("LTS");
    await page.getByRole("button", { name: `Emitir vale · folio ${ultimo + 1}`, exact: true }).click();
    await page.getByText(`✓ Vale ${ultimo + 1} emitido`, { exact: true }).waitFor({ state: "visible" });
    const emitido = (await leerEstado()).vales.find((v) => v.tipo === "SALIDA" && v.folio === ultimo + 1);
    assert.equal(emitido.lineas[0].codigo, 136);
    assert.equal(emitido.lineas[0].cantidad, "2");
    await page.getByRole("button", { name: /Imprimir vale$/, exact: false }).click();
    await page.waitForFunction(() => window.__impresiones.length === 1 && !document.body.classList.contains("imprimiendo"));
    const impresion = await page.evaluate(() => window.__impresiones[0]);
    assert.match(impresion, /SUMINISTRO DE DIESEL/);
    assert.ok(impresion.includes(String(ultimo + 1)));

    await ir("#exportar");
    const libro = await descarga(() => page.getByRole("button", { name: "Exportar vales", exact: true }).click());
    assert.match(libro.nombre, /\.xlsm$/);
    const diario = new LibroLeido(libro.datos).hoja("DIARIO");
    const folios = Array.from({ length: diario.maxFila - 1 }, (_, i) => diario.valor(i + 2, 2));
    assert.equal(Math.max(...folios), ultimo + 1);
    await ir("#respaldos");
    const respaldo = await descarga(() => page.getByRole("button", { name: "Respaldar ahora", exact: true }).click());
    const estadoFinal = leerRespaldo(respaldo.datos).estado;
    assert.equal(estadoFinal.formato, FORMATO_ESTADO);
    assert.equal(estadoFinal.vales.find((v) => v.id === emitido.id).folio, ultimo + 1);
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
  } catch (error) {
    await writeFile("/tmp/comentarios-recorrido-error.txt", await page.locator("body").innerText());
    await page.screenshot({ path: "/tmp/comentarios-recorrido-error.png", fullPage: true });
    throw error;
  }
});
