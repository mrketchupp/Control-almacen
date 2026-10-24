// La protección de observaciones es local a la edición; el texto propio y la etapa sí se guardan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { lineaNoInventariada, nuevoBorrador } from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("transferencia: observaciones protegidas, edición explícita y etapa separada sobreviven a reabrir", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-transferencias-"));
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
  const { estado } = cargaSintetica();
  estado.config.usuario_en_turno = "ALMACENISTA UNO";
  const area = estado.plantillas_area.find((a) => a.nombre === "TRANSFERENCIAS");
  const b = nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: area.id, fecha: "2026-10-24" });
  b.recibio_nombre = "PERSONA SINTETICA";
  b.lineas = [{ ...lineaNoInventariada(estado, 136), cantidad: "1", um: "LTS" }];
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
  await page.goto(origen + "/#vales");
  const texto = page.locator(".observaciones-transferencia");
  await texto.getByRole("button", { name: "Editar observaciones de esta transferencia", exact: true }).waitFor();
  assert.equal(await texto.locator("textarea").count(), 0);
  assert.match(await texto.innerText(), /ESTE MATERIAL CUMPLE/);
  await page.locator('[data-bloque="etapa"] input').fill('12 1/4"');
  assert.match(await texto.innerText(), /ETAPA DE PERFORACION: 12 1\/4"/);
  await texto.getByRole("button", { name: "Editar observaciones de esta transferencia", exact: true }).click();
  const entrada = texto.getByRole("textbox", { name: "Observaciones de la transferencia", exact: true });
  assert.doesNotMatch(await entrada.inputValue(), /ETAPA DE PERFORACION/);
  await entrada.fill("OBSERVACION PERSONALIZADA\nSEGUNDA LINEA");
  await texto.getByRole("button", { name: "Terminar edición de observaciones", exact: true }).click();
  assert.equal(await texto.locator("textarea").count(), 0);
  assert.match(await texto.innerText(), /OBSERVACION PERSONALIZADA\s+SEGUNDA LINEA\s+ETAPA DE PERFORACION: 12 1\/4"/);
  // El cambio de página guarda inmediatamente lo pendiente, sin esperar al temporizador del borrador.
  await page.evaluate(() => { location.hash = "#inventario"; });
  await page.getByRole("heading", { name: "Inventario", exact: true }).waitFor();
  await page.evaluate(() => { location.hash = "#vales"; });
  await texto.getByRole("button", { name: "Editar observaciones de esta transferencia", exact: true }).waitFor();
  assert.equal(await texto.locator("textarea").count(), 0);
  assert.match(await texto.innerText(), /OBSERVACION PERSONALIZADA\s+SEGUNDA LINEA\s+ETAPA DE PERFORACION: 12 1\/4"/);
  assert.equal(await page.locator('[data-bloque="etapa"] input').inputValue(), '12 1/4"');
  assert.equal(await page.getByRole("combobox", { name: "Destino", exact: true }).isEditable(), true);
  assert.deepEqual(errores, []); assert.deepEqual(externas, []);
});
