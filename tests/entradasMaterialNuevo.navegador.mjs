// Crear otra variante sin que la sugerencia recupere un número de parte ajeno.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { entradaConArticulo, lineaEntradaVacia, nuevoBorradorEntrada } from "../src/servicios/entradas.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("el editor de entradas permite otra variante con el mismo tamaño, con NP distinto o sin NP", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "entrada-material-nuevo-"));
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

  async function abrir() {
    const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
    const { estado } = cargaSintetica(); estado.config.usuario_en_turno = "ALMACENISTA UNO";
    const sugerida = entradaConArticulo(estado, lineaEntradaVacia(), 704);
    const b = nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO", fecha: "2026-10-02" });
    Object.assign(b, { modo: "manual", folio_externo: "BASE-SINTETICA", origen: "BASE PRUEBA" });
    b.lineas = [{ ...sugerida, cantidad: "2" }];
    await almacen.cargarPrimeraVez(estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errores = [], externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    page.on("dialog", (d) => d.accept());
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
    const leer = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
        r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
      };
    }));
    const esperar = async (condicion) => {
      for (let i = 0; i < 100; i++) { const e = await leer(); if (condicion(e)) return e; await new Promise((r) => setTimeout(r, 25)); }
      assert.fail("La entrada no guardó los datos esperados");
    };
    await page.goto(origen + "/#entradas");
    await page.getByRole("button", { name: "Crear material nuevo", exact: true }).waitFor();
    return { page, leer, esperar, sugerida, terminar: async () => { assert.deepEqual(errores, []); assert.deepEqual(externas, []); await context.close(); } };
  }

  for (const np of ["", "NP-SINTETICO-NUEVO"]) await t.test(np ? "otro NP crea su variante sin modificar la existente" : "NP vacío se conserva al desenfocar, guardar y reabrir", async () => {
    const { page, leer, esperar, sugerida, terminar } = await abrir();
    assert.equal(await page.getByRole("textbox", { name: "NP (número de parte)", exact: true }).inputValue(), "FLEXITALIC");
    await page.getByRole("button", { name: "Crear material nuevo", exact: true }).click();
    const campoNp = page.getByRole("textbox", { name: "NP (número de parte)", exact: true });
    assert.equal(await campoNp.inputValue(), "");
    await campoNp.fill(np);
    await page.getByRole("combobox", { name: "Clave / dimensión", exact: true }).fill('6"');
    await page.getByRole("textbox", { name: "Cantidad", exact: true }).click();
    assert.equal(await campoNp.inputValue(), np);
    await esperar((e) => e.borradores_entrada[0].lineas[0].material_nuevo && e.borradores_entrada[0].lineas[0].np === np);
    await page.reload();
    await page.getByRole("button", { name: "Elegir existente", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "NP (número de parte)", exact: true }).inputValue(), np);
    await page.getByRole("button", { name: "Registrar entrada", exact: true }).click();
    const nuevo = await esperar((e) => e.vales.some((v) => v.tipo === "ENTRADA"));
    const vale = nuevo.vales.find((v) => v.tipo === "ENTRADA"), variante = nuevo.variantes.find((v) => v.id === vale.lineas[0].variante_id);
    assert.deepEqual([variante.dimension, variante.np], ['6"', np || null]);
    assert.notEqual(vale.lineas[0].existencia_id, sugerida.existencia_id);
    assert.equal(nuevo.variantes.find((v) => v.id === sugerida.variante_id).np, "FLEXITALIC");
    assert.equal((await leer()).borradores_entrada.length, 0);
    await terminar();
  });
});
