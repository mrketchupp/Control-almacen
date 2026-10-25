// Filtros, ampliación y posición del historial sobreviven a detalle, Atrás, recarga y cambio de inventario.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { inventarioPorId } from "../src/nucleo/inventarios.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

function estadoHistorial(inventario) {
  const { estado } = cargaSintetica({ idInventario: inventario });
  const original = estado.vales[0];
  estado.config.usuario_en_turno = "ALMACENISTA UNO";
  estado.vales = [];
  for (const tipo of ["SALIDA", "ENTRADA"]) for (let i = 0; i < (tipo === "SALIDA" ? 260 : 90); i++) {
    const id = 10000 + estado.vales.length;
    estado.vales.push({ ...structuredClone(original), id, tipo, folio: i + 1000, estado: "EMITIDO", fecha: "2026-10-10",
      fecha_recibido: tipo === "ENTRADA" ? "2026-10-10" : undefined,
      folio_externo: tipo === "ENTRADA" ? `BASE-SINTETICA-${i}` : undefined,
      origen: "ORIGEN SINTETICO", depto_destino: "MECANICO", recibio_nombre: "PERSONA SINTETICA",
      lineas: [{ ...structuredClone(original.lineas[0]), id, codigo: 701, cantidad: "1", um: "PZA", existencia_id: null,
        descripcion: "MATERIAL MEMORIA SINTETICO PARA REVISAR EN EL HISTORIAL", clave: "CLAVE SINTETICA", oc: "OC-SINTETICA" }],
    });
  }
  return estado;
}

test("el historial conserva su recorrido en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-historial-memoria-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" }); res.end(req.url === "/blank" ? "<html></html>" : html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  async function abrir({ sinSessionStorage = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 640, height: 700 } });
    t.after(() => context.close());
    if (sinSessionStorage) await context.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("Bloqueado", "SecurityError"); } }));
    const page = await context.newPage(), errores = [], externas = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    await page.goto(origen + "/blank");
    for (const inventario of ["DLTA", "GSM"]) {
      const almacen = new Almacen(new BackendMemoria(), { inventario }); await almacen.iniciar();
      await almacen.cargarPrimeraVez(estadoHistorial(inventario), [
        { tipo: "INVENTARIO", nombre: `INVENTARIO ${inventario} SINTETICO.xlsx`, datos: bytesInventario() },
        { tipo: "VALES", nombre: `VALES ${inventario} SINTETICO.xlsm`, datos: bytesVales() },
      ]);
      await page.evaluate(async (f) => {
        const db = await new Promise((resolve, reject) => { const q = indexedDB.open(f.bd, 1);
          q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
          q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
        });
        await new Promise((resolve, reject) => { const tx = db.transaction(["estado", "archivos"], "readwrite");
          tx.objectStore("estado").put(f.estado, "actual");
          for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        }); db.close();
      }, { bd: inventarioPorId(inventario).bd, estado: almacen.estado,
        archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) });
    }
    await page.goto(origen + "/#historial");
    await page.locator('[data-historial="salidas"] tbody tr').first().waitFor();
    return { page, verificar: () => { assert.deepEqual(errores, []); assert.deepEqual(externas, []); } };
  }
  const pausa = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const filas = (page) => page.locator("[data-historial] tbody tr");
  const posicion = (page) => page.evaluate(() => ({ y: scrollY, x: document.querySelector("[data-historial] .tabla-contenedor")?.scrollLeft ?? 0,
    tablaY: document.querySelector("[data-historial] .tabla-contenedor")?.scrollTop ?? 0 }));
  async function recorrer(page, indice) {
    const fila = filas(page).nth(indice);
    await fila.scrollIntoViewIfNeeded();
    await page.locator("[data-historial] .tabla-contenedor").evaluate((e) => { e.scrollLeft = 180; });
    await pausa(page);
    const guardada = await posicion(page);
    assert.ok(guardada.tablaY > 800);
    assert.ok(guardada.x > 0);
    await fila.dispatchEvent("contextmenu", { bubbles: true, clientX: 600, clientY: 350 });
    await page.getByRole("menuitem", { name: /Abrir (vale|entrada)/, exact: false }).click();
    await page.waitForFunction(() => /^#(?:vale|entrada)\//.test(location.hash));
    await pausa(page);
    assert.equal(await page.evaluate(() => scrollY), 0);
    return guardada;
  }
  async function restaurada(page, guardada) {
    await page.waitForFunction(({ y, x, tablaY }) => Math.abs(scrollY - y) <= 3 &&
      Math.abs((document.querySelector("[data-historial] .tabla-contenedor")?.scrollLeft ?? 0) - x) <= 3 &&
      Math.abs((document.querySelector("[data-historial] .tabla-contenedor")?.scrollTop ?? 0) - tablaY) <= 3, guardada);
  }

  await t.test("salidas: filtros, más de 200 filas y scroll vuelven desde detalle, Atrás y recarga", async () => {
    const { page, verificar } = await abrir();
    const buscador = page.getByRole("searchbox", { name: "Buscar en todo: folio, descripción, clave, O.C.…", exact: true });
    await buscador.fill("MATERIAL MEMORIA");
    await page.getByLabel("Código AX", { exact: true }).fill("701");
    await page.getByLabel("Desde", { exact: true }).fill("2026-10-01");
    await page.getByRole("button", { name: "Ver 60 más", exact: true }).click();
    assert.equal(await filas(page).count(), 260);
    let guardada = await recorrer(page, 220);
    await page.getByRole("link", { name: "← Historial", exact: true }).click();
    await restaurada(page, guardada);
    assert.equal(await buscador.inputValue(), "MATERIAL MEMORIA");
    assert.equal(await page.getByLabel("Código AX", { exact: true }).inputValue(), "701");
    assert.equal(await page.getByLabel("Desde", { exact: true }).inputValue(), "2026-10-01");
    assert.equal(await filas(page).count(), 260);
    guardada = await recorrer(page, 240);
    await page.goBack(); await restaurada(page, guardada);
    await page.reload(); await restaurada(page, guardada);
    assert.equal(await filas(page).count(), 260);
    await page.getByRole("button", { name: /Quitar filtros/ }).click();
    await pausa(page);
    assert.equal(await buscador.inputValue(), "");
    assert.equal(await filas(page).count(), 200);
    assert.equal(await page.evaluate(() => scrollY), 0);
    verificar();
  });

  await t.test("entradas: la pestaña y sus filtros tienen una posición propia y no se mezclan con otro inventario", async () => {
    const { page, verificar } = await abrir();
    await page.getByRole("button", { name: "Ver todos", exact: true }).click();
    const salida = await recorrer(page, 210);
    await page.getByRole("link", { name: "← Historial", exact: true }).click(); await restaurada(page, salida);
    // Para cambiar de pestaña hay que volver a su encabezado; el recorrido dentro de la tabla permanece.
    await page.getByRole("tab", { name: "Vales de entrada", exact: true }).scrollIntoViewIfNeeded(); await pausa(page);
    salida.y = (await posicion(page)).y;
    await page.getByRole("tab", { name: "Vales de entrada", exact: true }).click();
    const buscador = page.getByRole("searchbox", { name: "Buscar en todo: folio, descripción, clave, origen…", exact: true });
    await buscador.fill("MEMORIA");
    await page.getByLabel("O.C.", { exact: true }).fill("OC-SINTETICA");
    const entrada = await recorrer(page, 70);
    await page.getByRole("link", { name: "← Historial de entradas", exact: true }).click(); await restaurada(page, entrada);
    assert.equal(await page.getByRole("tab", { name: "Vales de entrada", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await buscador.inputValue(), "MEMORIA");
    await page.getByRole("tab", { name: "Vales de salida", exact: true }).click(); await restaurada(page, salida);
    assert.equal(await filas(page).count(), 260);
    await page.getByRole("radio", { name: "GSM", exact: true }).click();
    await page.locator('html[data-inventario="GSM"]').waitFor();
    await page.goto(origen + "/#historial");
    await page.locator('[data-historial="salidas"] tbody tr').first().waitFor();
    assert.equal(await page.getByRole("searchbox", { name: "Buscar en todo: folio, descripción, clave, O.C.…", exact: true }).inputValue(), "");
    assert.equal(await filas(page).count(), 200);
    await page.getByRole("radio", { name: "DLTA", exact: true }).click();
    await page.locator('html[data-inventario="DLTA"]').waitFor();
    await page.goto(origen + "/#historial"); await restaurada(page, salida);
    assert.equal(await filas(page).count(), 260);
    verificar();
  });

  await t.test("si sessionStorage está bloqueado, conserva los filtros y el recorrido al abrir y volver", async () => {
    const { page, verificar } = await abrir({ sinSessionStorage: true });
    const buscador = page.getByRole("searchbox", { name: "Buscar en todo: folio, descripción, clave, O.C.…", exact: true });
    await buscador.fill("MEMORIA");
    const guardada = await recorrer(page, 120);
    await page.getByRole("link", { name: "← Historial", exact: true }).click(); await restaurada(page, guardada);
    assert.equal(await buscador.inputValue(), "MEMORIA");
    verificar();
  });
});
