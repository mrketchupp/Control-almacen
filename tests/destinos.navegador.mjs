// Ronda 30 en Chromium: el reporte diario guarda cada archivo en su carpeta sin «Guardar como». Las carpetas son
// del sistema de archivos privado del navegador (OPFS), con la forma de las del usuario y nombres inventados; el
// explorador (showDirectoryPicker / showOpenFilePicker) se simula devolviéndolas. Se recorre: fijar las carpetas
// (se proponen solas), ver la ruta del día en cada tarjeta, guardar, reemplazar (pregunta), un mes sin carpeta (se
// crea), recargar la página (se recuerdan), «Guardar como…» para otro lugar y la ventana en oscuro y en el teléfono.
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
const RUTA_GSM = "GSM PRUEBA/01. INVENTARIO/{año}/{mes}";
const TODOS = Array.from({ length: ULTIMO_FOLIO_GSM - PRIMER_FOLIO_GSM + 1 }, (_, i) => PRIMER_FOLIO_GSM + i);
const foliosDelLibro = (datos) => {
  const diario = new LibroLeido(datos).hoja("DIARIO"), folios = [];
  for (let f = 2; f <= diario.maxFila; f++) if (Number.isInteger(diario.valor(f, 2))) folios.push(diario.valor(f, 2));
  return folios;
};

/** Las carpetas del inventario diario (inventadas) y el Escritorio con el libro de vales de siempre. */
const CARPETAS = [
  "INVENTARIO DIARIO/FX/2026/10. OCTUBRE",
  "INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026/09. SEPTIEMBRE",
  "INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026/10.OCTUBRE",
  "INVENTARIO DIARIO/GSM PRUEBA/02. KARDEX/2026",
  "INVENTARIO DIARIO/ALMACEN DLTA/01. INVENTARIOS/2026/10. OCTUBRE",
  "Escritorio",
];

test("reporte diario: cada archivo a su carpeta (año y mes del día), sin «Guardar como»", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-destinos-"));
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
  const fixture = { bd: inventarioPorId("GSM").bd, inventario: "GSM", estado: structuredClone(almacen.estado), carpetas: CARPETAS, vales: VALES,
    archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })),
  };
  const CAPTURAS = process.env.DESTINOS_CAPTURAS; // carpeta para las capturas (opcional)

  async function abrir({ viewport = { width: 1440, height: 1000 }, colorScheme = "light", isMobile = false } = {}) {
    const context = await browser.newContext({ viewport, colorScheme, isMobile, hasTouch: isMobile, acceptDownloads: true, timezoneId: "America/Mexico_City" });
    t.after(() => context.close());
    await context.addInitScript(() => {
      // El explorador de Windows, simulado: devuelve la carpeta (o el archivo) de OPFS que diga la prueba.
      const abrirRuta = async (ruta) => {
        let dir = await navigator.storage.getDirectory();
        for (const parte of ruta.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(parte);
        return dir;
      };
      window.__elegirCarpeta = "INVENTARIO DIARIO";
      window.__guardarComo = 0;
      window.showDirectoryPicker = async () => abrirRuta(window.__elegirCarpeta);
      window.showOpenFilePicker = async () => [await (await abrirRuta("Escritorio")).getFileHandle("VALES DE SALIDA GSM.xlsm")];
      window.showSaveFilePicker = async () => {
        window.__guardarComo++;
        throw new DOMException("The user aborted a request.", "AbortError");
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errores = [], externas = [], dialogos = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    page.on("dialog", async (d) => { dialogos.push(d.message()); await d.accept(); });
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      localStorage.setItem("control-almacen:inventario", f.inventario);
      const raiz = await navigator.storage.getDirectory();
      for await (const [nombre] of raiz.entries()) await raiz.removeEntry(nombre, { recursive: true });
      for (const ruta of f.carpetas) {
        let dir = raiz;
        for (const parte of ruta.split("/")) dir = await dir.getDirectoryHandle(parte, { create: true });
      }
      const escritorio = await raiz.getDirectoryHandle("Escritorio");
      const escritor = await (await escritorio.getFileHandle(f.vales, { create: true })).createWritable();
      await escritor.write(new Uint8Array([1, 2, 3]));
      await escritor.close();
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
      try { for (const parte of ruta.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(parte); } catch { return null; }
      const salida = {};
      for await (const [nombre, h] of dir.entries()) salida[nombre] = h.kind === "file" ? [...new Uint8Array(await (await h.getFile()).arrayBuffer())] : "carpeta";
      return salida;
    }, ruta);
    const ventana = () => page.getByRole("dialog", { name: "Carpetas del reporte diario" });
    const listo = async (n) => page.waitForFunction((n) => (document.body.innerText.match(/✓ Guardado en/g) ?? []).length >= n, n);
    const preguntas = async (n) => {
      for (let i = 0; i < 200 && dialogos.length < n; i++) await page.waitForTimeout(50);
      assert.equal(dialogos.length, n, `${n} pregunta(s) de confirmar`);
    };
    return { page, errores, externas, dialogos, archivos, ventana, listo, preguntas };
  }

  await t.test("fijar las carpetas (se proponen solas), guardar, reemplazar, mes nuevo y recargar", async () => {
    const r = await abrir();
    const { page } = r;
    assert.match(await page.locator(".bento-ancha").first().innerText(), /En Carpetas… puedes fijar/);
    await page.getByRole("button", { name: "Carpetas…" }).click();
    const v = r.ventana();
    await v.waitFor();
    await v.getByRole("button", { name: "Elegir carpeta…" }).click();
    await page.locator(".toast-exito", { hasText: "Encontré las de DLTA, GSM, FX" }).waitFor();
    const ruta = (id) => v.getByRole("textbox", { name: `Ruta del inventario de ${id} dentro de la carpeta base` });
    assert.equal(await ruta("GSM").inputValue(), RUTA_GSM);
    assert.equal(await ruta("DLTA").inputValue(), "ALMACEN DLTA/01. INVENTARIOS/{año}/{mes}");
    assert.equal(await ruta("FX").inputValue(), "FX/{año}/{mes}");
    // La vista previa revisa el disco: la de GSM usa la carpeta escrita "10.OCTUBRE".
    await v.locator(".carpeta-vista", { hasText: "10.OCTUBRE" }).waitFor();
    // Una ruta mal escrita se ve antes de guardar, con la carpeta parecida.
    await ruta("DLTA").fill("ALMACEN DLTA/01. INVENTARIO/{año}/{mes}");
    await ruta("DLTA").press("Enter");
    await v.locator(".carpeta-vista", { hasText: "No existe «01. INVENTARIO» en INVENTARIO DIARIO › ALMACEN DLTA. Ahí hay «01. INVENTARIOS»." }).waitFor();
    await ruta("DLTA").fill("ALMACEN DLTA/01. INVENTARIOS/{año}/{mes}");
    await ruta("DLTA").press("Enter");
    // Explorar: elegir la carpeta del mes la vuelve ruta con {año} y {mes}.
    await page.evaluate(() => { window.__elegirCarpeta = "INVENTARIO DIARIO/FX/2026/10. OCTUBRE"; });
    await v.getByRole("button", { name: "Explorar la carpeta de FX" }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Ruta del inventario de FX dentro de la carpeta base"]')?.value === "FX/{año}/{mes}");
    await v.getByRole("button", { name: "Elegir el libro de vales de GSM" }).click();
    await v.locator(".carpeta-archivo", { hasText: VALES }).waitFor();
    if (CAPTURAS) await v.screenshot({ path: join(CAPTURAS, "carpetas-claro.png") });
    await v.getByRole("button", { name: "Listo" }).click();
    await v.waitFor({ state: "detached" });

    const tarjetaInv = page.getByRole("button", { name: TARJETA_INVENTARIO, exact: true });
    const tarjetaVales = page.getByRole("button", { name: TARJETA_VALES, exact: true });
    assert.match(await tarjetaInv.innerText(), /INVENTARIO DIARIO › GSM PRUEBA › 01\. INVENTARIO › 2026 › 10\. OCTUBRE/);
    assert.match(await tarjetaVales.innerText(), /Reemplaza VALES DE SALIDA GSM\.xlsm/);
    assert.match(await page.locator(".bento-ancha").first().innerText(), /cada uno va a su carpeta/);
    if (CAPTURAS) await page.locator(".bento-ancha").first().screenshot({ path: join(CAPTURAS, "reporte-con-carpetas.png") });

    await tarjetaInv.click();
    await r.listo(1);
    const octubre = await r.archivos("INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026/10.OCTUBRE");
    const nombre = Object.keys(octubre).find((n) => /^INVENTARIO GSM .*231026\.xlsx$/.test(n));
    assert.ok(nombre && octubre[nombre].length > 1000, "el inventario quedó en la carpeta de octubre (la que ya existía)");
    assert.equal(Object.keys(await r.archivos("INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026")).length, 2, "no se creó otra de octubre");
    assert.match(await tarjetaInv.innerText(), /✓ Guardado en INVENTARIO DIARIO › GSM PRUEBA › 01\. INVENTARIO › 2026 › 10\.OCTUBRE/);

    await tarjetaVales.click();
    await page.waitForFunction(() => /✓ Guardado: VALES DE SALIDA GSM\.xlsm/.test(document.body.innerText));
    assert.deepEqual(foliosDelLibro(new Uint8Array((await r.archivos("Escritorio"))[VALES])), TODOS, "el libro del Escritorio se reemplazó");
    assert.deepEqual(r.dialogos, [], "sin vales posteriores y sin archivo previo: no pregunta nada");

    await tarjetaInv.click();
    await r.preguntas(1);
    await page.waitForFunction(() => !document.querySelector(".ocupado, [aria-busy=true]") && /Otra vez/.test(document.body.innerText));
    assert.match(r.dialogos[0], /Ya existe «INVENTARIO GSM .*231026\.xlsx» en INVENTARIO DIARIO › GSM PRUEBA › 01\. INVENTARIO › 2026 › 10\.OCTUBRE/);

    // Otro día de otro mes: la carpeta de noviembre aún no existe y se crea al guardar.
    await page.getByRole("textbox", { name: "Fecha del reporte" }).fill("2026-11-02");
    await tarjetaInv.waitFor();
    assert.match(await tarjetaInv.innerText(), /› 2026 › 11\. NOVIEMBRE/);
    await tarjetaInv.click();
    await page.locator(".toast-exito", { hasText: "carpeta nueva: 11. NOVIEMBRE" }).waitFor();
    const noviembre = await r.archivos("INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026/11. NOVIEMBRE");
    assert.ok(Object.keys(noviembre).some((n) => /021126\.xlsx$/.test(n)));

    // Al volver a abrir la herramienta las carpetas siguen fijadas (base común en IndexedDB).
    await page.reload();
    await tarjetaInv.waitFor();
    assert.match(await tarjetaInv.innerText(), /› 2026 › 11\. NOVIEMBRE/);
    await tarjetaInv.click();
    await r.preguntas(2); // ya existía el del 2 de noviembre: preguntó otra vez
    await page.waitForFunction(() => /✓ Guardado en/.test(document.body.innerText));
    // «Guardar como…» abre el explorador para guardar en otro lugar esa vez.
    await page.getByRole("button", { name: "Guardar Inventario de refaccionamiento en otro lugar" }).click();
    await page.locator(".toast-info", { hasText: "No se guardó" }).waitFor();
    assert.equal(await page.evaluate(() => window.__guardarComo), 1);
    assert.deepEqual(r.errores, []);
    assert.deepEqual(r.externas, []);
  });

  await t.test("la ventana de carpetas en oscuro y en el teléfono se ve completa, sin desplazar a lo ancho", async () => {
    for (const [nombre, opciones] of [["carpetas-oscuro.png", { colorScheme: "dark" }], ["carpetas-telefono.png", { viewport: { width: 390, height: 844 }, isMobile: true }]]) {
      const r = await abrir(opciones);
      await r.page.getByRole("button", { name: "Carpetas…" }).click();
      const v = r.ventana();
      await v.waitFor();
      await v.getByRole("button", { name: "Elegir carpeta…" }).click();
      await v.locator(".carpeta-vista", { hasText: "10.OCTUBRE" }).waitFor();
      const ancho = await r.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(ancho[0] <= ancho[1], `sin desplazamiento horizontal (${ancho})`);
      const caja = await v.boundingBox();
      assert.ok(caja.x >= 0 && caja.x + caja.width <= ancho[1] + 1, "la ventana cabe a lo ancho");
      if (CAPTURAS) await v.screenshot({ path: join(CAPTURAS, nombre) });
      assert.deepEqual(r.errores, []);
    }
  });
});
