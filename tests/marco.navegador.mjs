// Ronda 39, etapa 1 (docs/14 §1): la página nunca se desplaza. En todas las secciones y en todos los anchos, la cabecera y
// el menú lateral (con «Ajustes y más» abajo) se ven completos; lo único que se desplaza es el área de trabajo.
// Con CAPTURAS=<carpeta> guarda cada sección al principio y desplazada hasta abajo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const SECCIONES = ["inicio", "vales", "entradas", "historial", "inventario", "conteo", "etiquetas", "reporte", "conciliacion"];
const TAMANOS = [[1440, 900], [1440, 700], [768, 700]];

test("marco: la cabecera y el menú nunca se desplazan", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "marco-"));
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

  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };

  const capturas = process.env.CAPTURAS || null;
  if (capturas) await mkdir(capturas, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errores = [], externas = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
  await page.goto(origen + "/blank");
  await page.evaluate(async (f) => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
      q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
    });
    await new Promise((resolve, reject) => { const tx = db.transaction(["estado", "archivos"], "readwrite");
      tx.objectStore("estado").put(f.estado, "actual"); for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  }, fixture);

  // Lo que debe cumplirse siempre: la página sin desplazamiento, la cabecera arriba y completa, el menú completo con
  // «Ajustes y más» a la vista, y nada que se salga a lo ancho del área de trabajo.
  const revisar = (donde) => page.evaluate((donde) => {
    const vista = { ancho: innerWidth, alto: innerHeight };
    const caja = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const cabecera = caja(".cabecera");
    const mas = caja(".navegacion .nav-boton-mas");
    const nav = caja(".navegacion");
    const area = document.querySelector(".cuerpo > main.contenido");
    const problemas = [];
    if (document.documentElement.scrollHeight > vista.alto + 1 || document.scrollingElement.scrollTop !== 0) problemas.push("la página se desplaza");
    if (!cabecera || Math.round(cabecera.top) !== 0 || cabecera.bottom > vista.alto) problemas.push(`cabecera ${JSON.stringify(cabecera)}`);
    if (!mas || mas.top < (cabecera?.bottom ?? 0) - 1 || mas.bottom > vista.alto + 1) problemas.push(`«Ajustes y más» ${JSON.stringify(mas)}`);
    if (!nav || nav.bottom > vista.alto + 1) problemas.push("el menú se sale de la ventana");
    if (area && area.scrollWidth > area.clientWidth + 1) problemas.push(`el área de trabajo se sale ${area.scrollWidth - area.clientWidth} px a lo ancho`);
    return problemas.length ? `${donde}: ${problemas.join("; ")}` : null;
  }, donde);

  for (const [ancho, alto] of TAMANOS) {
    await t.test(`${ancho} × ${alto}: todas las secciones, al principio y desplazadas hasta abajo`, async () => {
      await page.setViewportSize({ width: ancho, height: alto });
      for (const seccion of SECCIONES) {
        await page.goto(`${origen}/#${seccion}`);
        await page.locator(".cuerpo > main.contenido").waitFor();
        await page.waitForTimeout(250);
        const nombre = `${seccion}-${ancho}x${alto}`;
        assert.equal(await revisar(`${nombre} (arriba)`), null);
        if (capturas) await page.screenshot({ path: join(capturas, `${nombre}.png`) });
        // Lo largo se desplaza dentro del área de trabajo; la cabecera y el menú no se mueven.
        const desplazado = await page.evaluate(() => {
          const area = document.querySelector(".cuerpo > main.contenido");
          area.scrollTop = area.scrollHeight;
          return area.scrollTop;
        });
        await page.waitForTimeout(100);
        assert.equal(await revisar(`${nombre} (abajo, ${desplazado} px)`), null);
        if (capturas && desplazado > 0) await page.screenshot({ path: join(capturas, `${nombre}-abajo.png`) });
      }
    });
  }

  await t.test("cambiar de sección empieza arriba y «Ajustes y más» se abre encima sin mover el marco", async () => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.goto(`${origen}/#inventario`);
    await page.locator(".cuerpo > main.contenido").waitFor();
    await page.evaluate(() => { const a = document.querySelector(".cuerpo > main.contenido"); a.scrollTop = a.scrollHeight; });
    // (El historial no: recuerda dónde se quedó, a propósito.)
    await page.locator(".navegacion").getByRole("link", { name: "Conteo físico" }).click();
    await page.waitForFunction(() => location.hash === "#conteo");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector(".cuerpo > main.contenido").scrollTop), 0);
    await page.locator(".nav-boton-mas").click();
    await page.getByRole("dialog", { name: "Ajustes y más" }).waitFor();
    assert.equal(await revisar("con «Ajustes y más» abierta"), null);
    if (capturas) await page.screenshot({ path: join(capturas, "ajustes-y-mas-1440x700.png") });
  });

  assert.deepEqual(errores, []);
  assert.deepEqual(externas, []);
});
