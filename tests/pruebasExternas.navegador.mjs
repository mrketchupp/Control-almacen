// Ronda 37 en Chromium (reporte de pruebas externas, hallazgo 1): «+5» capturado en un conteo o en un vale ya no deja
// la sección en blanco, y si una sección truena al dibujarse, solo ella muestra el aviso y las demás siguen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Indices } from "../src/nucleo/estado.js";
import { iniciarConteo } from "../src/servicios/conteos.js";
import { lineaDesdeExistencia, nuevoBorrador } from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

test("cantidades con «+» y secciones que fallan, en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "pruebas-externas-"));
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

  // Lo que dejaba el fallo: un conteo con «+5» guardado y un borrador en el paso 2 con «+5» en su partida.
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  estado.conteo_en_curso = { ...iniciarConteo(estado, { ubicaciones: [balero.ubicacion_id] }), capturas: { [balero.id]: "+5" } };
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const b = nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id });
  Object.assign(b, { recibio_nombre: "PERSONA SINTETICA", recibio_puesto: "MECANICO", paso: 2 });
  b.lineas.push({ ...lineaDesdeExistencia(estado, balero.id), cantidad: "+5", uid: "p1" });
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const archivos = [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] }));

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  let errores = [];
  const externas = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
  page.on("dialog", (d) => d.accept());
  const sembrar = async (valor) => {
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      await new Promise((resolve) => { const q = indexedDB.deleteDatabase("control-almacen"); q.onsuccess = q.onerror = q.onblocked = resolve; });
      const db = await new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
        q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => { const tx = db.transaction(["estado", "archivos"], "readwrite");
        tx.objectStore("estado").put(f.estado, "actual"); for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, { estado: valor, archivos });
  };

  await t.test("1a · conteo con «+5»: se ve la captura y se puede descartar, también tras recargar", async () => {
    await sembrar(almacen.estado);
    await page.goto(`${origen}/#conteo`);
    const celda = page.locator(`#cnt-${balero.id}`);
    assert.equal(await celda.inputValue(), "+5");
    await page.getByRole("button", { name: "Descartar conteo", exact: true }).waitFor();
    await page.reload();
    assert.equal(await page.locator(`#cnt-${balero.id}`).inputValue(), "+5");
    await page.getByRole("button", { name: "Descartar conteo", exact: true }).waitFor();
    // Las demás secciones siguen.
    await page.goto(`${origen}/#inventario`);
    await page.getByRole("heading", { name: "Inventario", level: 1 }).waitFor();
    assert.deepEqual(errores, []);
  });

  await t.test("1b · vale con «+5»: una sola franja y una barra de pasos; en el paso 3 no falta la cantidad", async () => {
    await page.goto(`${origen}/#vales`);
    await page.locator(".partida-vale").first().waitFor();
    assert.equal(await page.getByLabel("Cantidad de la partida 1").inputValue(), "+5");
    assert.equal(await page.getByText(/sin cantidad/).count(), 0);
    await page.getByRole("button", { name: /^Revisar y emitir/ }).click();
    await page.waitForFunction(() => document.querySelector('li[aria-current="step"] .paso-nombre')?.textContent.includes("3 ·"));
    assert.equal(await page.locator('ol[aria-label="Pasos del vale"]').count(), 1);
    assert.equal(await page.locator(".franja-borradores").count(), 1);
    assert.equal(await page.getByText("Falta la cantidad.", { exact: true }).count(), 0);
    assert.deepEqual(errores, []);
  });

  await t.test("red de seguridad: una sección que truena muestra su aviso y las demás siguen", async () => {
    const roto = structuredClone(almacen.estado);
    roto.borradores[0].lineas = "no es una lista";
    await sembrar(roto);
    errores = [];
    await page.goto(`${origen}/#vales`);
    await page.getByText("Esta sección falló.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Recargar", exact: true }).waitFor();
    await page.getByRole("button", { name: "Copiar diagnóstico" }).waitFor();
    await page.goto(`${origen}/#inventario`);
    await page.getByRole("heading", { name: "Inventario", level: 1 }).waitFor();
    assert.equal(await page.getByText("Esta sección falló.", { exact: true }).count(), 0);
    const registro = await page.evaluate(() => localStorage.getItem("control-almacen:registro-archivos") ?? "");
    assert.match(registro, /falló al dibujarse/);
  });

  assert.deepEqual(externas, []);
});
