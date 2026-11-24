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
  const leer = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
    q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    };
  }));
  // Ronda 34: en el paso 1 las observaciones de la transferencia no se ven como campo; se editan con un botón.
  await page.goto(origen + "/#vales");
  const editar = page.getByRole("button", { name: "Editar observaciones de esta transferencia", exact: true });
  await editar.waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Observaciones de la transferencia", exact: true }).count(), 0);
  const cambiarEtapa = page.getByRole("button", { name: "Cambiar etapa", exact: true });
  if (await cambiarEtapa.count()) await cambiarEtapa.click();
  await page.getByLabel("Etapa de perforación", { exact: true }).fill('12 1/4"');
  // Ronda 35: la línea «PARA USO EN» dice el destino (el del formato, RIG 48) y cambia al elegir otro.
  await page.getByText('Las observaciones dicen «PARA USO EN RIG 48» y la etapa 12 1/4".', { exact: true }).waitFor();
  await page.getByRole("radio", { name: "RIG 165", exact: true }).click();
  await page.getByText('Las observaciones dicen «PARA USO EN RIG 165» y la etapa 12 1/4".', { exact: true }).waitFor();
  await editar.click();
  assert.match(await page.getByRole("textbox", { name: "Observaciones de la transferencia", exact: true }).inputValue(), /^MATERIAL SUMINISTRADO PARA USO EN RIG 165$/m);
  const entrada = page.getByRole("textbox", { name: "Observaciones de la transferencia", exact: true });
  assert.doesNotMatch(await entrada.inputValue(), /ETAPA DE PERFORACION/);
  await entrada.fill("OBSERVACION PERSONALIZADA\nSEGUNDA LINEA");
  await page.getByRole("button", { name: "Terminar edición de observaciones", exact: true }).click();
  assert.equal(await entrada.count(), 0);
  // El cambio de página guarda inmediatamente lo pendiente, sin esperar al temporizador del borrador.
  await page.evaluate(() => { location.hash = "#inventario"; });
  await page.getByRole("heading", { name: "Inventario", exact: true }).waitFor();
  const guardado = (await leer()).borradores[0];
  assert.match(guardado.observaciones, /OBSERVACION PERSONALIZADA\s+SEGUNDA LINEA\s+ETAPA DE PERFORACION: 12 1\/4"/);
  assert.equal(guardado.etapa_perforacion, '12 1/4"');
  await page.evaluate(() => { location.hash = "#vales"; });
  await editar.waitFor();
  await editar.click();
  assert.equal(await entrada.inputValue(), "OBSERVACION PERSONALIZADA\nSEGUNDA LINEA");
  await page.getByText('Observaciones de TRANSFERENCIAS y etapa 12 1/4" se llenan solas.', { exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "Otro destino", exact: true }).isEditable(), true);
  assert.deepEqual(errores, []); assert.deepEqual(externas, []);
});
