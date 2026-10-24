// El libro descargado desde Reporte diario debe coincidir con el folio anunciado en pantalla.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inventarioPorId } from "../src/nucleo/inventarios.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { almacenReporteGsm, atributosEtiquetas, FECHA_ANTERIOR_GSM, FECHA_REPORTE_GSM, PRIMER_FOLIO_GSM, ULTIMO_FOLIO_GSM } from "./ayudaReporteGsm.js";

test("el reporte diario descarga los folios vigentes de GSM y mantiene el cierre histórico en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-reporte-gsm-"));
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

  async function abrir(inventario, conTabla) {
    const { almacen } = await almacenReporteGsm({ inventario, conTabla });
    const bd = inventarioPorId(inventario).bd;
    const fixture = { bd, inventario, estado: structuredClone(almacen.estado),
      archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })),
    };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, timezoneId: "America/Mexico_City" });
    t.after(() => context.close());
    await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errores = [], externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      localStorage.setItem("control-almacen:inventario", f.inventario);
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
    const boton = page.getByRole("button", { name: "Descargar Libro de vales de salida", exact: true });
    await boton.waitFor({ state: "visible" });
    assert.match(await boton.innerText(), new RegExp(`Hasta el folio ${ULTIMO_FOLIO_GSM}`));
    assert.equal(await page.locator("html").getAttribute("data-inventario"), inventario);
    const leerEstado = () => page.evaluate((nombre) => new Promise((resolve, reject) => {
      const q = indexedDB.open(nombre, 1);
      q.onsuccess = () => {
        const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
        r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
      };
      q.onerror = () => reject(q.error);
    }), bd);
    return { page, boton, leerEstado, errores, externas, conTabla };
  }

  async function descargar(reporte, fecha, ultimoFolio) {
    const { page, boton, conTabla } = reporte;
    await page.getByRole("textbox", { name: "Fecha del reporte", exact: true }).fill(fecha);
    await page.getByRole("textbox", { name: "Fecha del reporte", exact: true }).dispatchEvent("change");
    await page.waitForFunction((f) => location.hash === `#reporte/${f}`, fecha);
    assert.match(await boton.innerText(), new RegExp(`Hasta el folio ${ultimoFolio}`));
    const esperando = page.waitForEvent("download");
    await boton.click();
    const descarga = await esperando;
    assert.equal(await descarga.failure(), null);
    if (conTabla) assert.equal(descarga.suggestedFilename(), "VALES DE SALIDA GSM.xlsm");
    const datos = new Uint8Array(await readFile(await descarga.path()));
    const libro = new LibroLeido(datos), diario = libro.hoja("DIARIO");
    const folios = [];
    for (let f = 2; f <= diario.maxFila; f++) if (Number.isInteger(diario.valor(f, 2))) folios.push(diario.valor(f, 2));
    assert.equal(Math.max(...folios), ultimoFolio);
    assert.deepEqual(folios, Array.from({ length: ultimoFolio - PRIMER_FOLIO_GSM + 1 }, (_, i) => PRIMER_FOLIO_GSM + i));
    const paquete = new PaqueteOOXML(datos), parte = paquete.parteDeHoja("DIARIO");
    const xml = paquete.texto(parte);
    for (const fila of atributosEtiquetas(xml, "row").filter((a) => Number(a.r) > 1)) {
      assert.ok(!["1", "true"].includes(fila.hidden), `Fila ${fila.r} oculta`);
      assert.notEqual(fila.ht, "0", `Fila ${fila.r} sin altura`);
    }
    assert.doesNotMatch(xml, /<filterColumn\b|<sortState\b/);
    if (conTabla) {
      assert.equal(diario.tablas().length, 1);
      assert.equal(diario.tablas()[0].ref, `A1:T${folios.length + 1}`);
      const tabla = paquete.texto(diario.tablas()[0].parte);
      assert.equal(atributosEtiquetas(tabla, "autoFilter")[0].ref, `A1:T${folios.length + 1}`);
      assert.doesNotMatch(tabla, /<filterColumn\b|<sortState\b/);
    }
    return folios;
  }

  await t.test("GSM: descarga 2964, retrocede a 2930 y vuelve a 2964 con todas las filas visibles", async () => {
    const reporte = await abrir("GSM", true);
    const antes = (await reporte.leerEstado()).vales;
    await descargar(reporte, FECHA_REPORTE_GSM, ULTIMO_FOLIO_GSM);
    await descargar(reporte, FECHA_ANTERIOR_GSM, PRIMER_FOLIO_GSM);
    await descargar(reporte, FECHA_REPORTE_GSM, ULTIMO_FOLIO_GSM);
    assert.deepEqual((await reporte.leerEstado()).vales, antes);
    assert.deepEqual(reporte.errores, []); assert.deepEqual(reporte.externas, []);
    if (process.env.REPORTE_GSM_SCREENSHOT) await reporte.page.screenshot({ path: process.env.REPORTE_GSM_SCREENSHOT, fullPage: true });
  });

  await t.test("DLTA: el mismo cierre exporta sus folios sin tabla y mantiene su inventario separado", async () => {
    const reporte = await abrir("DLTA", false);
    const antes = (await reporte.leerEstado()).vales;
    await descargar(reporte, FECHA_REPORTE_GSM, ULTIMO_FOLIO_GSM);
    assert.deepEqual((await reporte.leerEstado()).vales, antes);
    assert.deepEqual(reporte.errores, []); assert.deepEqual(reporte.externas, []);
  });
});
