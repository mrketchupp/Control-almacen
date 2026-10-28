// Conteo de auditoría como base oficial en el HTML autónomo (Chromium): vista previa, decisiones y aplicar en
// DLTA; FX dentro de GSM (marca, filtro y libro aparte); aviso de Kardex de otro inventario en Conciliación AX.
// Datos SINTÉTICOS (tests/fixtures/generar.py).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica, fixtures } from "./ayuda.js";

test("conteo de auditoría como base oficial en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-auditoria-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const servidor = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(req.url === "/blank" ? "<html><body></body></html>" : documento);
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => servidor.close(resolve));
    await rm(carpeta, { recursive: true, force: true });
  });

  async function preparado(inventario) {
    const almacen = new Almacen(new BackendMemoria(), { inventario });
    await almacen.iniciar();
    const { estado } = cargaSintetica({ idInventario: inventario });
    estado.config.usuario_en_turno = "ALMACENISTA UNO";
    await almacen.cargarPrimeraVez(estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    return { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  }

  async function abrir(inventario, hash) {
    const bd = inventario === "GSM" ? "control-almacen-gsm" : "control-almacen";
    const fixture = await preparado(inventario);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errores = [];
    const externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errores.push(m.text());
    });
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url());
    });
    page.on("dialog", (d) => d.accept());
    await page.goto(origen + "/blank");
    await page.evaluate(
      async ({ f, bd, inventario }) => {
        localStorage.setItem("control-almacen:inventario", inventario);
        const db = await new Promise((resolve, reject) => {
          const q = indexedDB.open(bd, 1);
          q.onupgradeneeded = () => {
            for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined);
          };
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["estado", "archivos"], "readwrite");
          tx.objectStore("estado").put(f.estado, "actual");
          for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { f: fixture, bd, inventario },
    );
    await page.goto(origen + hash);
    await page.locator(".navegacion").waitFor();
    const leer = () =>
      page.evaluate(
        (bd) =>
          new Promise((resolve, reject) => {
            const q = indexedDB.open(bd, 1);
            q.onsuccess = () => {
              const db = q.result;
              const r = db.transaction("estado").objectStore("estado").get("actual");
              r.onsuccess = () => {
                resolve(r.result);
                db.close();
              };
              r.onerror = () => reject(r.error);
            };
          }),
        bd,
      );
    const terminar = async () => {
      assert.deepEqual(errores, []);
      assert.deepEqual(externas, []);
      await context.close();
    };
    return { page, leer, terminar };
  }

  const elegir = async (page, lista, texto) => {
    await lista.locator(".lista-boton").click();
    await page.locator(".lista .resultados li", { hasText: texto }).first().click();
  };
  const cargarKardex = async (page) => {
    await page.locator(".tarjeta", { hasText: "Conteo de auditoría (Kardex)" }).locator("input[type=file]").setInputFiles(fixtures.kardex);
    const ventana = page.locator(".ventana-concilia");
    await ventana.locator(".cifras-auditoria").waitFor();
    return ventana;
  };

  await t.test("DLTA: la vista previa pide lo dudoso y al aplicar el conteo es la nueva cantidad", async () => {
    const { page, leer, terminar } = await abrir("DLTA", "/#conteo");
    const ventana = await cargarKardex(page);
    const filas = ventana.locator("table").first().locator("tbody tr");
    assert.equal(await filas.count(), 3);
    assert.match(await filas.nth(2).innerText(), /PRINCIPAL[\s\S]*Es de DLTA/);
    assert.match(await filas.nth(0).innerText(), /FX se lleva dentro de GSM/);
    const aplicar = ventana.getByRole("button", { name: "Aplicar como base oficial" });
    assert.equal(await aplicar.isEnabled(), false);
    await ventana.getByRole("button", { name: /por elegir: partida nueva/ }).click();
    await elegir(page, ventana.locator("tr", { hasText: "CABLE 3/4" }).locator(".lista"), "CONTENEDOR #2 INVENTARIABLE");
    assert.equal(await aplicar.isEnabled(), true);
    await aplicar.click();
    await page.locator(".toast", { hasText: "Base oficial aplicada" }).waitFor();
    const estado = await leer();
    const conteo = estado.conteos.find((c) => c.tipo === "AUDITORIA");
    assert.ok(conteo);
    assert.equal(conteo.fecha, "2026-10-26");
    const codigos = new Set(conteo.nuevos.map((id) => estado.variantes.find((v) => v.id === estado.existencias.find((e) => e.id === id).variante_id).codigo));
    assert.deepEqual([...codigos].sort(), [703, 705, 709, 712]);
    assert.equal(estado.existencias.filter((e) => e.baja).length, 1); // la repetida del 701 en #2
    await terminar();
  });

  await t.test("GSM: la hoja de FX marca sus partidas, el inventario las filtra y su libro sale aparte", async () => {
    const { page, terminar } = await abrir("GSM", "/#conteo");
    const ventana = await cargarKardex(page);
    assert.match(await ventana.locator(".cifras-auditoria").innerText(), /3\s+de FX/);
    await ventana.getByRole("button", { name: "Aplicar como base oficial" }).click();
    await page.locator(".toast", { hasText: "Base oficial aplicada" }).waitFor();
    await page.goto(origen + "/#inventario");
    await page.locator(".pastilla-fx").first().waitFor();
    assert.equal(await page.locator(".pastilla-fx").count(), 3);
    await page.locator(".segmento", { hasText: "FX" }).click();
    assert.match(await page.locator(".filtros .conteo").innerText(), /^3 de/);
    await page.goto(origen + "/#reporte");
    await page.locator(".archivos-dia", { hasText: "Inventario de FX" }).waitFor();
    await terminar();
  });

  await t.test("Conciliación AX: elige la hoja del inventario y avisa si se elige la de otro", async () => {
    const { page, terminar } = await abrir("DLTA", "/#conciliacion");
    await page.locator("input[type=file][accept='.xlsx']").first().setInputFiles(fixtures.kardex);
    const ventana = page.getByRole("dialog", { name: "Importar reporte de AX" });
    await ventana.waitFor();
    assert.match(await ventana.locator(".lista-boton").first().innerText(), /PRINCIPAL/);
    const importar = ventana.getByRole("button", { name: "Importar corte" });
    assert.equal(await importar.isEnabled(), true);
    await elegir(page, ventana.locator(".lista").first(), "FX se lleva dentro de GSM");
    await ventana.locator(".aviso-advertencia").waitFor();
    assert.equal(await importar.isEnabled(), false);
    await ventana.getByText(/importarlo de todos modos/).click();
    assert.equal(await importar.isEnabled(), true);
    await terminar();
  });
});
