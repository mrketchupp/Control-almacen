// Reporte diario con «Guardar como» en Chromium: el archivo elegido puede estar abierto en Excel
// (Windows no deja crearlo o vaciarlo al elegirlo) o bloquearse al escribir. El Excel no se pierde:
// queda en la carpeta de la herramienta o en Descargas, con un aviso que no se quita solo, y la
// tarjeta dice dónde quedó. Cancelar no hace nada. El "Guardar como" se simula sobre archivos reales
// del navegador (sistema de archivos privado de origen), así que createWritable / close son los de Chromium.
// El caso con la carpeta de la herramienta está en guardarComo.test.js: el Chromium de pruebas se cierra
// al guardar en IndexedDB un directorio de ese sistema de archivos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inventarioPorId } from "../src/nucleo/inventarios.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { almacenReporteGsm, FECHA_REPORTE_GSM, PRIMER_FOLIO_GSM, ULTIMO_FOLIO_GSM } from "./ayudaReporteGsm.js";

const VALES = "VALES DE SALIDA GSM.xlsm";
const TARJETA_VALES = "Descargar Libro de vales de salida";
const TARJETA_INVENTARIO = "Descargar Inventario de refaccionamiento";

const foliosDelLibro = (datos) => {
  const diario = new LibroLeido(datos).hoja("DIARIO"), folios = [];
  for (let f = 2; f <= diario.maxFila; f++) if (Number.isInteger(diario.valor(f, 2))) folios.push(diario.valor(f, 2));
  return folios;
};
const TODOS = Array.from({ length: ULTIMO_FOLIO_GSM - PRIMER_FOLIO_GSM + 1 }, (_, i) => PRIMER_FOLIO_GSM + i);

test("reporte diario: «Guardar como» que falla no se calla y el Excel no se pierde", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-guardar-como-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(req.url === "/blank" ? "<html><body></body></html>" : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  const { almacen } = await almacenReporteGsm({ inventario: "GSM", conTabla: true });
  const fixture = { bd: inventarioPorId("GSM").bd, inventario: "GSM", estado: structuredClone(almacen.estado),
    archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })),
  };

  /** Abre el reporte del día con la plantilla y los vales sintéticos de GSM. */
  async function abrir() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, timezoneId: "America/Mexico_City" });
    t.after(() => context.close());
    await context.addInitScript(() => {
      // modo: "ok" | "cancela" | "ocupado" (falla al elegir, como un archivo abierto en Excel) | "bloqueado" (falla al escribir)
      window.__modo = "ok";
      window.__pedidos = 0;
      const error = (name, message) => new DOMException(message, name);
      window.showSaveFilePicker = async (opciones) => {
        window.__pedidos++;
        if (window.__modo === "cancela") throw error("AbortError", "The user aborted a request.");
        if (window.__modo === "ocupado") throw error("AbortError", "Failed to create or truncate file");
        const raiz = await navigator.storage.getDirectory();
        const elegidos = await raiz.getDirectoryHandle("elegidos", { create: true });
        const archivo = await elegidos.getFileHandle(opciones.suggestedName, { create: true });
        if (window.__modo !== "bloqueado") return archivo;
        return { name: archivo.name, getFile: () => archivo.getFile(),
          createWritable: async () => ({ write: async () => {}, abort: async () => {}, close: async () => { throw error("NoModificationAllowedError", "Locked"); } }) };
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errores = [], externas = [], descargas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    page.on("download", (d) => descargas.push(d));
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      localStorage.setItem("control-almacen:inventario", f.inventario);
      const raiz = await navigator.storage.getDirectory();
      for await (const [nombre] of raiz.entries()) await raiz.removeEntry(nombre, { recursive: true });
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open(f.bd, 1);
        q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["estado", "archivos"], "readwrite");
        tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, fixture);
    await page.goto(`${origen}/#reporte/${FECHA_REPORTE_GSM}`);
    await page.getByRole("button", { name: TARJETA_VALES, exact: true }).waitFor({ state: "visible" });
    const archivos = (ruta) => page.evaluate(async (ruta) => {
      let dir = await navigator.storage.getDirectory();
      try { for (const parte of ruta.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(parte); } catch { return {}; }
      const salida = {};
      for await (const [nombre, h] of dir.entries()) if (h.kind === "file") salida[nombre] = [...new Uint8Array(await (await h.getFile()).arrayBuffer())];
      return salida;
    }, ruta);
    const pulsar = async (tarjeta, modo) => {
      await page.evaluate((m) => { window.__modo = m; }, modo);
      const boton = page.getByRole("button", { name: tarjeta, exact: true });
      await boton.click();
      await page.waitForFunction(() => !document.querySelector(".ocupado, [aria-busy=true]"));
      return boton;
    };
    const avisos = () => page.locator(".toast").allInnerTexts();
    return { page, errores, externas, descargas, archivos, pulsar, avisos };
  }

  await t.test("cancelar no hace nada: ni descarga ni aviso", async () => {
    const r = await abrir();
    const boton = await r.pulsar(TARJETA_VALES, "cancela");
    await r.page.waitForTimeout(400);
    assert.equal(await r.page.evaluate(() => window.__pedidos), 1);
    assert.deepEqual(r.descargas, []);
    assert.deepEqual(await r.avisos(), []);
    assert.doesNotMatch(await boton.innerText(), /Guardado|No quedó/);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("archivo abierto en Excel (falla al elegirlo): se descarga completo y lo dice sin quitarse", async () => {
    const r = await abrir();
    const esperando = r.page.waitForEvent("download");
    const boton = await r.pulsar(TARJETA_VALES, "ocupado");
    const descarga = await esperando;
    assert.equal(descarga.suggestedFilename(), VALES);
    assert.deepEqual(foliosDelLibro(new Uint8Array(await readFile(await descarga.path()))), TODOS);
    await r.page.locator(".toast-advertencia").waitFor();
    const [aviso] = await r.avisos();
    assert.match(aviso, /No se guardó donde elegiste: Windows no dejó crear o reemplazar «VALES DE SALIDA GSM\.xlsm».*abierto en Excel.*quedó en tu carpeta de Descargas/s);
    assert.match(await boton.innerText(), /No quedó donde elegiste .*se guardó en Descargas/s);
    await r.page.waitForTimeout(6500); // los avisos normales se quitan a los 6 s; este no
    assert.equal((await r.avisos()).length, 1);
    if (process.env.GUARDAR_COMO_SCREENSHOT) await r.page.screenshot({ path: process.env.GUARDAR_COMO_SCREENSHOT });
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("bloqueado al escribir (se eligió bien, falla al cerrar): el inventario se descarga y lo dice", async () => {
    const r = await abrir();
    const esperando = r.page.waitForEvent("download");
    const boton = await r.pulsar(TARJETA_INVENTARIO, "bloqueado");
    const descarga = await esperando;
    assert.match(descarga.suggestedFilename(), /^INVENTARIO GSM .*231026\.xlsx$/);
    assert.ok((await readFile(await descarga.path())).length > 1000);
    await r.page.locator(".toast-advertencia").waitFor();
    assert.match((await r.avisos()).join("\n"), /está abierto en Excel.*quedó en tu carpeta de Descargas/s);
    assert.match(await boton.innerText(), /No quedó donde elegiste/);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("cuando sí se puede: queda donde se eligió con todos los folios y la tarjeta lo dice", async () => {
    const r = await abrir();
    const vales = await r.pulsar(TARJETA_VALES, "ok");
    await r.page.waitForFunction(() => /Guardado/.test(document.body.innerText));
    const inventario = await r.pulsar(TARJETA_INVENTARIO, "ok");
    await r.page.waitForFunction(() => (document.body.innerText.match(/✓ Guardado/g) ?? []).length === 2);
    const elegidos = await r.archivos("elegidos");
    assert.deepEqual(foliosDelLibro(new Uint8Array(elegidos[VALES])), TODOS);
    assert.ok(Object.keys(elegidos).some((n) => /^INVENTARIO GSM .*231026\.xlsx$/.test(n) && elegidos[n].length > 1000));
    assert.match(await vales.innerText(), new RegExp(`✓ Guardado: ${VALES.replace(".", "\\.")}`));
    assert.match(await inventario.innerText(), /✓ Guardado: INVENTARIO GSM/);
    assert.deepEqual(r.descargas, []);
    assert.equal((await r.page.locator(".toast-advertencia").count()), 0);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });
});
