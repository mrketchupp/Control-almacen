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
  async function abrir({ viewport = { width: 1440, height: 1000 }, colorScheme = "light", isMobile = false } = {}) {
    const context = await browser.newContext({ viewport, colorScheme, isMobile, hasTouch: isMobile, acceptDownloads: true, timezoneId: "America/Mexico_City" });
    t.after(() => context.close());
    await context.addInitScript(() => {
      // modo: "ok" | "cancela" | "ocupado" (falla al elegir, como un archivo abierto en Excel) | "bloqueado"
      // (falla al escribir) | "colgado" (Edge no responde hasta que la prueba llama window.__soltar()).
      window.__modo = "ok";
      window.__pedidos = 0;
      const error = (name, message) => new DOMException(message, name);
      const crear = async (nombre) => {
        const raiz = await navigator.storage.getDirectory();
        const elegidos = await raiz.getDirectoryHandle("elegidos", { create: true });
        return elegidos.getFileHandle(nombre, { create: true });
      };
      window.showSaveFilePicker = async (opciones) => {
        window.__pedidos++;
        if (window.__modo === "cancela") throw error("AbortError", "The user aborted a request.");
        if (window.__modo === "ocupado") throw error("AbortError", "Failed to create or truncate file");
        if (window.__modo === "colgado") return new Promise((resolver) => { window.__soltar = async () => resolver(await crear(opciones.suggestedName)); });
        const archivo = await crear(opciones.suggestedName);
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

  const CAPTURAS = process.env.GUARDAR_COMO_CAPTURAS; // carpeta para las capturas (opcional)
  const dialogo = (page) => page.getByRole("dialog", { name: "No se guardó donde elegiste" });

  await t.test("«Guardar como» se cierra sin archivo: nunca en silencio, «Guardar en Descargas» con un clic", async () => {
    const r = await abrir();
    const boton = await r.pulsar(TARJETA_VALES, "cancela");
    await r.page.locator(".toast-info").waitFor();
    assert.equal(await r.page.evaluate(() => window.__pedidos), 1);
    assert.deepEqual(r.descargas, [], "cancelar no descarga solo");
    const toast = r.page.locator(".toast-info");
    assert.match(await toast.innerText(), /No se guardó «VALES DE SALIDA GSM\.xlsm»/);
    assert.doesNotMatch(await boton.innerText(), /Guardado|No quedó/);
    if (CAPTURAS) { await r.page.waitForTimeout(500); await r.page.screenshot({ path: join(CAPTURAS, "no-se-guardo.png"), clip: { x: 420, y: 50, width: 600, height: 200 } }); }
    const esperando = r.page.waitForEvent("download");
    await toast.getByRole("button", { name: "Guardar en Descargas" }).click();
    const descarga = await esperando;
    assert.equal(descarga.suggestedFilename(), VALES);
    assert.deepEqual(foliosDelLibro(new Uint8Array(await readFile(await descarga.path()))), TODOS);
    await r.page.waitForFunction(() => /✓ Guardado: Descargas\/VALES DE SALIDA GSM\.xlsm/.test(document.body.innerText));
    assert.equal(await dialogo(r.page).count(), 0);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("Edge no responde tras cerrar «Guardar como»: a Descargas con el dibujo de OneDrive; si responde después, también ahí", async () => {
    const r = await abrir();
    await r.page.evaluate(() => { window.__modo = "colgado"; });
    await r.page.getByRole("button", { name: TARJETA_INVENTARIO, exact: true }).click();
    // El diálogo de Windows quita el foco a la página y lo devuelve al cerrarse.
    await r.page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    const esperando = r.page.waitForEvent("download", { timeout: 15000 });
    const ventana = dialogo(r.page);
    await ventana.waitFor({ timeout: 15000 });
    const descarga = await esperando;
    assert.match(descarga.suggestedFilename(), /^INVENTARIO GSM .*231026\.xlsx$/);
    const texto = await ventana.innerText();
    assert.match(texto, /Espera a que OneDrive termine de subir/);
    assert.match(texto, /Quedó en Descargas/);
    assert.equal(await ventana.getByRole("img", { name: /OneDrive subiendo archivos/ }).count(), 1);
    assert.equal(await ventana.getByRole("button", { name: "Guardar otra vez" }).count(), 1);
    if (CAPTURAS) await r.page.screenshot({ path: join(CAPTURAS, "aviso-colgado.png") });
    await ventana.getByRole("button", { name: "Cerrar aviso" }).click();
    // Edge responde tarde: el archivo elegido no queda vacío, se guarda ahí también.
    await r.page.evaluate(() => window.__soltar());
    await r.page.locator(".toast-exito", { hasText: "Edge respondió" }).waitFor();
    const elegidos = await r.archivos("elegidos");
    const nombre = Object.keys(elegidos).find((n) => /^INVENTARIO GSM .*231026\.xlsx$/.test(n));
    assert.ok(nombre && elegidos[nombre].length > 1000);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("archivo abierto en Excel (falla al elegirlo): se descarga completo y lo explica con dibujos", async () => {
    const r = await abrir();
    const esperando = r.page.waitForEvent("download");
    const boton = await r.pulsar(TARJETA_VALES, "ocupado");
    const descarga = await esperando;
    assert.equal(descarga.suggestedFilename(), VALES);
    assert.deepEqual(foliosDelLibro(new Uint8Array(await readFile(await descarga.path()))), TODOS);
    const ventana = dialogo(r.page);
    await ventana.waitFor();
    const texto = await ventana.innerText();
    assert.match(texto, /VALES DE SALIDA GSM\.xlsm/);
    assert.match(texto, /Ciérralo en Excel/);
    assert.match(texto, /Quedó en Descargas/);
    assert.equal(await ventana.getByRole("img", { name: /Barra de tareas de Windows con Excel abierto/ }).count(), 1);
    assert.equal(await ventana.getByRole("img", { name: /Explorador de archivos en Descargas/ }).count(), 1);
    assert.equal(await ventana.locator(".ilus-exp-lado li.activo").innerText(), "Descargas");
    assert.deepEqual(await r.avisos(), [], "el aviso de texto ya no hace falta");
    assert.match(await boton.innerText(), /No quedó donde elegiste .*se guardó en Descargas/s);
    if (CAPTURAS) await r.page.screenshot({ path: join(CAPTURAS, "aviso-claro.png") });
    await ventana.getByRole("button", { name: "Cerrar aviso" }).click();
    await ventana.waitFor({ state: "detached" });
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("«Ya lo cerré: guardar otra vez» vuelve a abrir «Guardar como» y ahora sí queda", async () => {
    const r = await abrir();
    const boton = await r.pulsar(TARJETA_VALES, "ocupado");
    const ventana = dialogo(r.page);
    await ventana.waitFor();
    await r.page.evaluate(() => { window.__modo = "ok"; });
    await ventana.getByRole("button", { name: "Ya lo cerré: guardar otra vez" }).click();
    await r.page.waitForFunction(() => /✓ Guardado/.test(document.body.innerText));
    assert.equal(await r.page.evaluate(() => window.__pedidos), 2);
    assert.deepEqual(foliosDelLibro(new Uint8Array((await r.archivos("elegidos"))[VALES])), TODOS);
    assert.match(await boton.innerText(), /✓ Guardado: VALES DE SALIDA GSM\.xlsm/);
    assert.equal(await dialogo(r.page).count(), 0);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("en oscuro y en el teléfono el aviso se ve completo, sin desplazar a lo ancho", async () => {
    for (const [nombre, opciones] of [["aviso-oscuro.png", { colorScheme: "dark" }], ["aviso-telefono.png", { viewport: { width: 390, height: 844 }, isMobile: true }]]) {
      const r = await abrir(opciones);
      await r.pulsar(TARJETA_VALES, "ocupado");
      const ventana = dialogo(r.page);
      await ventana.waitFor();
      const ancho = await r.page.evaluate(() => [window.innerWidth + Math.max(0, (() => { const a = document.querySelector(".cuerpo > main.contenido"); return Math.max(document.documentElement.scrollWidth - innerWidth, a ? a.scrollWidth - a.clientWidth : 0); })()), window.innerWidth]);
      assert.ok(ancho[0] <= ancho[1], `sin desplazamiento horizontal (${ancho})`);
      const caja = await ventana.boundingBox();
      assert.ok(caja.x >= 0 && caja.x + caja.width <= ancho[1] + 1, "la ventana cabe a lo ancho");
      if (CAPTURAS) await ventana.screenshot({ path: join(CAPTURAS, nombre) });
      assert.deepEqual(r.errores, []);
    }
  });

  await t.test("bloqueado al escribir (se eligió bien, falla al cerrar): el inventario se descarga y lo explica", async () => {
    const r = await abrir();
    const esperando = r.page.waitForEvent("download");
    const boton = await r.pulsar(TARJETA_INVENTARIO, "bloqueado");
    const descarga = await esperando;
    assert.match(descarga.suggestedFilename(), /^INVENTARIO GSM .*231026\.xlsx$/);
    assert.ok((await readFile(await descarga.path())).length > 1000);
    const ventana = dialogo(r.page);
    await ventana.waitFor();
    assert.match(await ventana.innerText(), /INVENTARIO GSM .*231026\.xlsx[\s\S]*Ciérralo en Excel[\s\S]*Quedó en Descargas/);
    assert.match(await boton.innerText(), /No quedó donde elegiste/);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("cuando sí se puede: queda donde se eligió, con aviso «Listo» que se pausa y se cierra con su botón", async () => {
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
    assert.equal(await dialogo(r.page).count(), 0);
    // Avisos: título corto, botón para cerrar que se ve y el tiempo se detiene mientras se lee.
    const toasts = r.page.locator(".toast");
    assert.equal(await toasts.count(), 2);
    await r.page.waitForTimeout(500); // que terminen de entrar (llegan con una escala de 0.96)
    const primero = toasts.first().getByRole("button", { name: "Cerrar aviso" });
    const tam = await primero.boundingBox();
    assert.ok(tam.width >= 40 && tam.height >= 40, `botón para cerrar de ${tam.width}×${tam.height}`);
    if (CAPTURAS) await r.page.screenshot({ path: join(CAPTURAS, "avisos-listo.png"), clip: { x: 420, y: 60, width: 600, height: 260 } });
    await primero.click();
    await r.page.waitForFunction(() => document.querySelectorAll(".toast").length === 1);
    const toast = toasts.first();
    assert.equal(await toast.locator(".toast-titulo").innerText(), "Listo");
    assert.match(await toast.locator(".toast-cuerpo").innerText(), /^INVENTARIO GSM/);
    await toast.hover();
    await r.page.waitForTimeout(6800);
    assert.equal(await toasts.count(), 1, "con el mouse encima no se quita");
    await toast.getByRole("button", { name: "Cerrar aviso" }).click();
    await r.page.waitForFunction(() => document.querySelectorAll(".toast").length === 0);
    assert.deepEqual(r.errores, []); assert.deepEqual(r.externas, []);
  });

  await t.test("◀ ▶ del reporte van de un día en un día, aunque el día no tenga vales", async () => {
    const r = await abrir();
    const fecha = () => r.page.evaluate(() => location.hash);
    await r.page.getByRole("button", { name: "Día anterior", exact: true }).click();
    assert.equal(await fecha(), "#reporte/2026-10-22");
    await r.page.getByRole("button", { name: "Día anterior", exact: true }).click();
    assert.equal(await fecha(), "#reporte/2026-10-21");
    assert.match(await r.page.locator("body").innerText(), /No hay vales de salida del 21\/10\/2026/);
    await r.page.getByRole("button", { name: "Día siguiente", exact: true }).click();
    await r.page.getByRole("button", { name: "Día siguiente", exact: true }).click();
    assert.equal(await fecha(), `#reporte/${FECHA_REPORTE_GSM}`);
    assert.deepEqual(r.errores, []);
  });
});
