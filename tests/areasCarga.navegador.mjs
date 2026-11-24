// Ronda 35 en el HTML autónomo: en la primera carga, las hojas del libro de vales se acomodan en tres frascos
// (Consumo interno, NOV, Transferencia) arrastrándolas; con clic se renombran, cambian de plantilla o se quitan.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtures, FOLIO_CORTE } from "./ayuda.js";

test("primera carga: las hojas del libro de vales en sus plantillas, en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-areas-carga-"));
  await Promise.all([mkdir(join(carpeta, "cache")), mkdir(join(carpeta, "config"))]);
  const servidor = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(documento);
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: join(carpeta, "cache"), XDG_CONFIG_HOME: join(carpeta, "config") },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  t.after(async () => { await browser.close(); await new Promise((resolve) => servidor.close(resolve)); await rm(carpeta, { recursive: true, force: true }); });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errores = [], externas = [];
  page.on("pageerror", (e) => errores.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
  const leer = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
    q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    }; q.onerror = () => reject(q.error);
  }));

  await page.goto(`${origen}/#carga`);
  await page.locator("label.boton").filter({ hasText: /^Elegir inventario$/ }).locator("input[type=file]").setInputFiles(fixtures.inventario);
  await page.locator(".carga-archivo-listo").waitFor();
  await page.locator("label.boton").filter({ hasText: /^Elegir libro de vales$/ }).locator("input[type=file]").setInputFiles(fixtures.vales);
  // Con los dos Excel pasa a «Áreas»: las hojas (sin DIARIO) en los tres frascos, como se proponen.
  await page.getByRole("heading", { name: "Áreas del libro de vales", exact: true }).waitFor();
  const frasco = (nombre) => page.getByRole("region", { name: nombre, exact: true });
  const enFrasco = (nombre) => frasco(nombre).locator(".pastilla-hoja > span:first-child").allInnerTexts();
  assert.deepEqual(await enFrasco("Consumo interno"), ["SOLDADOR", "MECANICO"]);
  assert.deepEqual(await enFrasco("NOV"), ["NOV"]);
  assert.deepEqual(await enFrasco("Transferencia"), ["TRANSFERENCIAS"]);
  assert.match(await frasco("Transferencia").innerText(), /formato/i);
  assert.match(await page.locator(".areas-del-libro").innerText(), /Áreas y personas/, "dice dónde se cambia después");
  // Arrastrar una pastilla a otro frasco y regresarla.
  await frasco("Consumo interno").locator(".pastilla-hoja", { hasText: "MECANICO" }).dragTo(frasco("NOV"));
  assert.deepEqual(await enFrasco("NOV"), ["MECANICO", "NOV"]);
  await frasco("NOV").locator(".pastilla-hoja", { hasText: "MECANICO" }).dragTo(frasco("Consumo interno"));
  assert.deepEqual(await enFrasco("Consumo interno"), ["SOLDADOR", "MECANICO"]);
  // Con clic: cambiar el nombre (no se puede repetir) y la plantilla.
  await frasco("Consumo interno").locator(".pastilla-hoja", { hasText: "SOLDADOR" }).click();
  const editor = page.getByRole("dialog", { name: "Hoja «SOLDADOR»" });
  await editor.locator("#nombre-hoja").fill("mecanico");
  await editor.getByText("Ya hay otra con ese nombre.", { exact: true }).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Listo", exact: true }).isDisabled(), true);
  await editor.locator("#nombre-hoja").fill("soldadura sintetica");
  await editor.getByRole("button", { name: "Listo", exact: true }).click();
  assert.deepEqual(await enFrasco("Consumo interno"), ["SOLDADURA SINTETICA", "MECANICO"]);
  // Quitar una hoja: sale de los frascos y se puede regresar.
  await frasco("NOV").locator(".pastilla-hoja", { hasText: "NOV" }).click();
  await page.getByRole("dialog", { name: "Hoja «NOV»" }).getByRole("button", { name: "Quitar esta hoja", exact: true }).click();
  assert.deepEqual(await enFrasco("NOV"), []);
  await page.getByRole("button", { name: "Regresar NOV", exact: true }).waitFor();
  await page.getByRole("button", { name: "Regresar NOV", exact: true }).click();
  assert.deepEqual(await enFrasco("NOV"), ["NOV"]);
  await frasco("NOV").locator(".pastilla-hoja", { hasText: "NOV" }).click();
  await page.getByRole("dialog", { name: "Hoja «NOV»" }).getByRole("button", { name: "Quitar esta hoja", exact: true }).click();
  // Seguir: conteo base, revisar y cargar.
  await page.getByRole("button", { name: "Continuar →", exact: true }).click();
  await page.getByRole("heading", { name: "Conteo base", exact: true }).waitFor();
  await page.getByLabel(/Fecha del conteo físico/).fill("2026-09-03");
  await page.getByLabel(/Último folio ya reflejado en el conteo/).fill(String(FOLIO_CORTE));
  await page.getByPlaceholder("Nombre como firma los vales").fill("ALMACENISTA UNO");
  await page.getByRole("button", { name: "Continuar →", exact: true }).click();
  const cargar = page.getByRole("button", { name: "Cargar definitivamente", exact: true });
  await page.locator(".carga-revision").waitFor();
  page.once("dialog", (d) => d.accept());
  const descarga = page.waitForEvent("download");
  await cargar.click();
  await descarga;
  await page.waitForFunction(() => location.hash === "#inicio");
  const e = await leer();
  assert.deepEqual(e.plantillas_area.map((a) => [a.nombre, a.hoja_excel.trim(), a.tipo, a.activo !== false]), [
    ["SOLDADURA SINTETICA", "SOLDADOR", "INTERNO", true],
    ["MECANICO", "MECANICO", "INTERNO", true],
    ["TRANSFERENCIAS", "TRANSFERENCIAS", "TRANSFERENCIA", true],
    ["NOV", "NOV", "EXTERNO", false],
  ]);
  assert.deepEqual(errores, []); assert.deepEqual(externas, []);
  await context.close();
});
