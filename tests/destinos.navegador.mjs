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
    const context = await browser.newContext({ viewport, colorScheme, isMobile, hasTouch: isMobile, acceptDownloads: true, timezoneId: "America/Mexico_City", permissions: ["clipboard-read", "clipboard-write"] });
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
      // __modo: "ok" | "aborta" (Edge responde como al cancelar aunque se eligió) | "colgado" (no responde hasta
      // que la prueba llama window.__responder()).
      window.__modo = "ok";
      const responder = (dar) => {
        if (window.__modo === "aborta") return Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
        if (window.__modo === "colgado") return new Promise((resolver) => { window.__responder = async () => resolver(await dar()); });
        return dar();
      };
      const libro = async () => (await abrirRuta("Escritorio")).getFileHandle("VALES DE SALIDA GSM.xlsm");
      window.showDirectoryPicker = () => responder(() => abrirRuta(window.__elegirCarpeta));
      window.showOpenFilePicker = () => responder(async () => [await libro()]);
      // Arrastrar desde el Explorador de Windows: el elemento soltado entrega la carpeta o el archivo de OPFS.
      window.__arrastrado = null;
      DataTransferItem.prototype.getAsFileSystemHandle = async function () {
        if (window.__arrastrado === "libro") return libro();
        return window.__arrastrado ? abrirRuta(window.__arrastrado) : null;
      };
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

  await t.test("si el explorador no entrega nada lo dice; arrastrar desde Windows sí funciona; Edge tarde también", async () => {
    const r = await abrir();
    const { page } = r;
    await page.getByRole("button", { name: "Carpetas…" }).click();
    const v = r.ventana();
    await v.waitFor();
    const resultado = v.locator(".carpetas-resultado");
    // Edge responde como al cancelar aunque se eligió: ya no queda en silencio.
    await page.evaluate(() => { window.__modo = "aborta"; });
    await v.getByRole("button", { name: "Elegir carpeta…" }).click();
    await resultado.filter({ hasText: "No llegó la carpeta del explorador" }).waitFor();
    assert.match(await resultado.innerText(), /arrástrala desde el Explorador de Windows al recuadro punteado/);
    assert.match(await resultado.innerText(), /Edge respondió: AbortError — The user aborted a request\./);
    await page.locator(".toast-advertencia", { hasText: "No llegó la carpeta" }).waitFor();
    if (CAPTURAS) await v.screenshot({ path: join(CAPTURAS, "carpetas-sin-respuesta.png") });

    // Arrastrar la carpeta base al recuadro punteado: se fija y se proponen las rutas.
    const soltar = (zona, que) => page.evaluate(([zona, que]) => {
      window.__arrastrado = que;
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "arrastrado"));
      const destino = document.querySelector(`[data-zona="${zona}"]`);
      for (const tipo of ["dragenter", "dragover", "drop"]) destino.dispatchEvent(new DragEvent(tipo, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [zona, que]);
    await soltar("Carpeta base", "INVENTARIO DIARIO");
    await resultado.filter({ hasText: "Carpeta base: INVENTARIO DIARIO. Encontré las de DLTA, GSM, FX" }).waitFor();
    assert.equal(await v.getByRole("textbox", { name: "Ruta del inventario de GSM dentro de la carpeta base" }).inputValue(), RUTA_GSM);
    // Un archivo donde va una carpeta se explica.
    await soltar("Carpeta de FX", "libro");
    await resultado.filter({ hasText: "es un archivo: aquí va una carpeta" }).waitFor();
    // La carpeta de un inventario soltada en su fila: su ruta con {año} y {mes}.
    await soltar("Carpeta de FX", "INVENTARIO DIARIO/FX/2026/10. OCTUBRE");
    await resultado.filter({ hasText: "Ruta de FX: FX/{año}/{mes}" }).waitFor();
    // El libro de vales soltado en su fila.
    await soltar("Libro de vales de GSM", "libro");
    await v.locator(".carpeta-archivo", { hasText: VALES }).waitFor();
    assert.match(await resultado.innerText(), /Libro de vales de GSM: «Descargar» reemplazará VALES DE SALIDA GSM\.xlsm/);

    // Edge no responde tras cerrar el explorador: se dice a los 5 s y, si responde después, se usa lo elegido.
    await v.getByRole("button", { name: "Quitar el libro de vales de GSM" }).click();
    await page.evaluate(() => { window.__modo = "colgado"; });
    await page.evaluate(() => { window.__responder = null; });
    await v.getByRole("button", { name: "Elegir el libro de vales de GSM" }).click();
    await page.waitForFunction(() => typeof window.__responder === "function"); // el explorador ya se abrió
    await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); });
    await resultado.filter({ hasText: "Edge no respondió después de elegir el archivo" }).waitFor({ timeout: 15000 });
    await page.evaluate(() => window.__responder());
    await v.locator(".carpeta-archivo", { hasText: VALES }).waitFor();
    await resultado.filter({ hasText: "Libro de vales de GSM" }).waitFor();
    // Soltar un archivo fuera de los recuadros no lo abre en Edge.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "otro.xlsx"));
      const fuera = document.querySelector(".ventana-carpetas h3");
      fuera.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      window.__soltadoFuera = !fuera.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    assert.equal(await page.evaluate(() => window.__soltadoFuera), true, "el navegador no hace nada con lo soltado fuera");
    // El registro dice qué respondió Edge en cada paso, para pegarlo en la conversación.
    await v.locator("summary", { hasText: "Registro de lo que pasó" }).click();
    const pre = await v.locator(".registro-archivos").innerText();
    assert.match(pre, /\[explorador\] se cerró sin entregar nada {2}✗ AbortError — The user aborted a request\./);
    assert.match(pre, /\[arrastrar\] Edge entregó carpeta «INVENTARIO DIARIO»/);
    assert.match(pre, /\[carpetas\] base carpeta «INVENTARIO DIARIO»; encontradas: DLTA=ALMACEN DLTA\/01\. INVENTARIOS\/\{año\}\/\{mes\}/);
    assert.match(pre, /\[explorador\] respondió tarde: entregó archivo «VALES DE SALIDA GSM\.xlsm»/);
    await v.getByRole("button", { name: "Copiar registro" }).click();
    await page.locator(".toast-exito", { hasText: "Registro copiado" }).waitFor();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copiado, /^Registro de carpetas y archivos — Control de Almacén\nHerramienta: /);
    assert.match(copiado, /Funciones: elegir carpeta sí, elegir archivo sí, guardar como sí, arrastrar sí/);
    assert.match(copiado, /Carpeta base: INVENTARIO DIARIO/);
    const esperando = page.waitForEvent("download");
    await v.getByRole("button", { name: "Descargar .txt" }).click();
    const descarga = await esperando;
    assert.match(descarga.suggestedFilename(), /^registro carpetas \d{4}-\d{2}-\d{2}\.txt$/);
    assert.match(await readFile(await descarga.path(), "utf8"), /\[explorador\] se cerró sin entregar nada/);
    if (CAPTURAS) await v.screenshot({ path: join(CAPTURAS, "carpetas-registro.png") });
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
      const ancho = await r.page.evaluate(() => [window.innerWidth + Math.max(0, (() => { const a = document.querySelector(".cuerpo > main.contenido"); return Math.max(document.documentElement.scrollWidth - innerWidth, a ? a.scrollWidth - a.clientWidth : 0); })()), window.innerWidth]);
      assert.ok(ancho[0] <= ancho[1], `sin desplazamiento horizontal (${ancho})`);
      const caja = await v.boundingBox();
      assert.ok(caja.x >= 0 && caja.x + caja.width <= ancho[1] + 1, "la ventana cabe a lo ancho");
      if (CAPTURAS) await v.screenshot({ path: join(CAPTURAS, nombre) });
      assert.deepEqual(r.errores, []);
    }
  });
});
