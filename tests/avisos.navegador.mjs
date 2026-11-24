// Ronda 35 (pedido del usuario, con video): al quitarse un aviso de la pila, se desvanece y su hueco se cierra poco a
// poco; los demás se recorren suave en lugar de brincar. Sin animaciones, se quita de una vez.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("avisos: salen con animación y los demás se recorren sin brincar", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-avisos-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const servidor = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(req.url === "/blank" ? "<html><body></body></html>" : documento);
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => servidor.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = "ALMACENISTA UNO";
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
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
  await page.goto(origen + "/#inicio");
  const huecos = (n) => page.waitForFunction((n) => document.querySelectorAll(".toast-hueco").length === n, n);
  // Cada «Guardar» de la etapa de perforación deja un aviso.
  const otroAviso = async (etapa, n) => {
    await page.getByRole("button", { name: "Cambiar etapa →" }).click();
    await page.locator("#etapa-inicio").fill(etapa);
    await page.locator("#etapa-inicio").press("Enter");
    await huecos(n);
  };
  await otroAviso('10"', 1);
  await otroAviso('11"', 2);
  await otroAviso('12"', 3);
  await page.waitForTimeout(500); // que termine la entrada

  // Cerrar el de en medio: el de abajo se recorre en varios pasos y, al borrarse el que salió, ya no brinca.
  const fotos = await page.evaluate(async () => {
    const lista = [...document.querySelectorAll(".toast-hueco")];
    const ultimo = lista[2].querySelector(".toast");
    const y = () => ultimo.getBoundingClientRect().top;
    const muestras = [{ t: 0, y: y(), n: lista.length, oculto: false }];
    lista[1].querySelector(".toast-cerrar").click();
    const inicio = performance.now();
    while (performance.now() - inicio < 700) {
      await new Promise((r) => requestAnimationFrame(r));
      muestras.push({ t: performance.now() - inicio, y: y(), n: document.querySelectorAll(".toast-hueco").length, oculto: lista[1].getAttribute("aria-hidden") === "true" });
    }
    return muestras;
  });
  const antes = fotos[0].y, despues = fotos.at(-1).y;
  assert.ok(antes - despues > 50, `el de abajo sube a ocupar el hueco (${antes} → ${despues})`);
  const intermedias = new Set(fotos.filter((f) => f.y < antes - 2 && f.y > despues + 2).map((f) => Math.round(f.y)));
  assert.ok(intermedias.size >= 3, `se recorre poco a poco, no de golpe (${[...intermedias].join(", ")})`);
  const borrado = fotos.find((f) => f.n === 2);
  assert.ok(borrado && borrado.t < 600, "el aviso se borra al terminar su salida");
  assert.ok(Math.abs(borrado.y - despues) <= 1, "al borrarse ya no hay brinco");
  assert.ok(fotos.slice(1).find((f) => f.n === 3)?.oculto, "mientras sale, no lo leen los lectores de pantalla");
  // Mientras sale ya no cuenta como aviso que se puede cerrar.
  assert.equal(await page.getByRole("button", { name: "Cerrar aviso" }).count(), 2);

  // A lo más 3: al llegar el cuarto, el más viejo sale con su animación (no se borra de golpe).
  await otroAviso('13"', 3);
  await otroAviso('14"', 4);
  assert.equal(await page.locator(".toast-hueco.saliendo").count(), 1);
  await huecos(3);

  // Sin animaciones (personalización), se quita de una vez.
  await page.evaluate(() => document.documentElement.setAttribute("data-animaciones", "no"));
  await page.getByRole("button", { name: "Cerrar aviso" }).first().click();
  assert.equal(await page.locator(".toast-hueco").count(), 2);
  assert.deepEqual(errores, []);
  await context.close();
});
