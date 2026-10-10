// Caso sintético 2 + 2 = 4 y vinculación manual en el HTML compilado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";
import { escenarioGruposAx } from "./ayudaGruposAx.js";

test("grupos físicos y vínculo manual en la conciliación AX en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-grupos-ax-"));
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
  async function pagina(manual = false) {
    const almacen = new Almacen(new BackendMemoria());
    await almacen.iniciar();
    const e = escenarioGruposAx(cargaSintetica().estado, manual ? { segundaDimension: "MODELO SINTETICO" } : {});
    e.estado.config.usuario_en_turno = "ALMACENISTA UNO";
    await almacen.cargarPrimeraVez(e.estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
    // Actualización desde la versión publicada anterior.
    fixture.estado.formato = 14;
    delete fixture.estado.cortes_ax[0].vinculos_fisicos;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
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
        tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, fixture);
    const estado = () => page.evaluate(() => new Promise((resolve, reject) => { const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
        r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
      };
    }));
    const guardado = async (condicion) => {
      for (let i = 0; i < 100; i++) { const s = await estado(); if (condicion(s)) return s; await new Promise((r) => setTimeout(r, 25)); }
      assert.fail("No se guardó el vínculo esperado");
    };
    await page.goto(origen + "/#conciliacion");
    const terminar = async () => { assert.deepEqual(errores, []); assert.deepEqual(externas, []); await context.close(); };
    return { page, e, guardado, estado, terminar };
  }
  const reporte = async (page) => {
    await page.getByRole("button", { name: /Reporte AX/ }).click();
    return page.getByRole("dialog", { name: "Reporte de AX completo", exact: true });
  };

  await t.test("al abrir la versión anterior las dos partidas aparecen como físico 4 y Cuadra", async () => {
    const { page, terminar } = await pagina();
    const r = await reporte(page);
    const fila = r.locator("tbody tr").filter({ hasText: /150VA/ });
    assert.equal(await fila.count(), 1);
    assert.match(await fila.innerText(), /Misma dimensión/);
    assert.match(await fila.innerText(), /Cuadra/);
    assert.equal((await fila.locator("td").allTextContents())[5], "4");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Justificar", exact: true }).click();
    assert.equal(await page.locator(".item-justificar").filter({ hasText: "8426" }).count(), 0);
    await terminar();
  });

  await t.test("elegir del inventario requiere revisión, conserva los datos y permite Deshacer", async () => {
    const { page, e, estado, guardado, terminar } = await pagina(true);
    const original = await estado();
    await page.getByRole("button", { name: "Justificar", exact: true }).click();
    const faltante = page.locator(".item-justificar").filter({ hasText: "8426" });
    assert.match(await faltante.innerText(), /Faltan 2/);
    await faltante.getByRole("button", { name: "Elegir del inventario…", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Elegir partidas del inventario", exact: true });
    assert.equal(await modal.getByRole("checkbox", { name: /150VA.*NP-SINTETICO-A/ }).isChecked(), true);
    assert.equal(await modal.getByRole("checkbox", { name: /100VA/ }).isDisabled(), true);
    await modal.getByRole("checkbox", { name: /MODELO SINTETICO/ }).check();
    await modal.getByRole("button", { name: "Revisar vínculo", exact: true }).click();
    assert.deepEqual((await estado()).cortes_ax[0].vinculos_fisicos ?? [], []);
    const revision = page.getByRole("dialog", { name: "Revisar vínculo del inventario", exact: true });
    assert.match(await revision.innerText(), /Físico seleccionado: 4/);
    await revision.getByRole("button", { name: "Confirmar vínculo", exact: true }).click();
    const nuevo = await guardado((s) => s.cortes_ax[0].vinculos_fisicos?.length === 1);
    assert.deepEqual(nuevo.cortes_ax[0].vinculos_fisicos[0].variante_ids, [e.uno.v.id, e.dos.v.id]);
    for (const clave of ["vales", "existencias", "variantes", "etiquetas"]) assert.deepEqual(nuevo[clave], original[clave]);
    assert.equal(await page.locator(".item-justificar").filter({ hasText: "8426" }).count(), 0);
    await page.getByRole("button", { name: "↶ Deshacer", exact: true }).click();
    await guardado((s) => s.cortes_ax[0].vinculos_fisicos.length === 0);
    assert.match(await page.locator(".item-justificar").filter({ hasText: "8426" }).innerText(), /Faltan 2/);
    await terminar();
  });

  await t.test("el reporte completo permite ajustar un vínculo, recargar y volver al automático", async () => {
    const { page, guardado, terminar } = await pagina(true);
    let r = await reporte(page);
    await r.locator("tbody tr").filter({ hasText: /150VA/ }).getByRole("button", { name: "Elegir del inventario…" }).click();
    await page.getByRole("dialog", { name: "Elegir partidas del inventario", exact: true }).getByRole("checkbox", { name: /MODELO SINTETICO/ }).check();
    await page.getByRole("button", { name: "Revisar vínculo", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar vínculo", exact: true }).click();
    await guardado((s) => s.cortes_ax[0].vinculos_fisicos?.length === 1);
    await page.reload();
    r = await reporte(page);
    const fila = r.locator("tbody tr").filter({ hasText: /150VA/ });
    assert.match(await fila.innerText(), /Inventario vinculado/);
    assert.match(await fila.innerText(), /Cuadra/);
    await fila.getByRole("button", { name: "Elegir del inventario…" }).click();
    await page.getByRole("button", { name: "Usar emparejamiento automático", exact: true }).click();
    await guardado((s) => s.cortes_ax[0].vinculos_fisicos.length === 0);
    assert.match(await r.locator("tbody tr").filter({ hasText: /150VA/ }).innerText(), /Faltan 2/);
    await terminar();
  });

  await t.test("el vínculo permite corregir claves con revisión, etiquetas y Deshacer", async () => {
    const { page, e, estado, guardado, terminar } = await pagina(true);
    const original = await estado();
    await page.getByRole("button", { name: "Justificar", exact: true }).click();
    await page.locator(".item-justificar").filter({ hasText: "8426" }).getByRole("button", { name: "Elegir del inventario…", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Elegir partidas del inventario", exact: true });
    await modal.getByRole("checkbox", { name: /Incluir MODELO SINTETICO/ }).check();
    assert.match(await modal.innerText(), /Etiquetas: 0 nuevas/);
    await modal.getByRole("checkbox", { name: "También corregir las claves del inventario a como están en AX y preparar etiquetas", exact: true }).check();
    assert.match(await modal.innerText(), /Etiquetas: 1 nuevas/);
    assert.match(await modal.innerText(), /Después: AX 4 · Físico 4 · Resultado: Cuadra/);
    await modal.getByRole("button", { name: "Revisar vínculo", exact: true }).click();
    const revision = page.getByRole("dialog", { name: "Revisar vínculo del inventario", exact: true });
    assert.match(await revision.innerText(), /Quedará en inventario/);
    assert.deepEqual((await estado()).variantes, original.variantes);
    assert.deepEqual((await estado()).etiquetas, original.etiquetas);
    await revision.getByRole("button", { name: "Confirmar corrección, vínculo y etiquetas", exact: true }).click();
    const nuevo = await guardado((s) => s.etiquetas.material.length === (original.etiquetas?.material.length ?? 0) + 1);
    assert.equal(nuevo.variantes.find((v) => v.id === e.dos.v.id).dimension, "150VA");
    assert.equal(nuevo.variantes.find((v) => v.id === e.dos.v.id).np, "NP-SINTETICO-B");
    assert.deepEqual(nuevo.vales, original.vales);
    assert.deepEqual(nuevo.existencias, original.existencias);
    assert.equal(nuevo.etiquetas.material.at(-1).origen.existencia_id, e.dos.e.id);
    await page.getByRole("button", { name: "↶ Deshacer", exact: true }).click();
    const deshecho = await guardado((s) => s.cortes_ax[0].vinculos_fisicos.length === 0);
    assert.deepEqual(deshecho.variantes, original.variantes);
    assert.deepEqual(deshecho.etiquetas.material, original.etiquetas.material);
    await terminar();
  });

  await t.test("elegir una sugerencia AX muestra su cantidad, el resultado y etiquetas antes de corregir", async () => {
    const { page, e, estado, guardado, terminar } = await pagina(true);
    const original = await estado();
    await page.getByRole("button", { name: "Emparejar", exact: true }).click();
    const emparejar = page.getByRole("dialog", { name: "Emparejar con AX", exact: true });
    await emparejar.getByRole("radio", { name: /Solo en el físico/ }).click();
    const item = emparejar.locator(".lista-sin-ax > li").filter({ hasText: "MODELO SINTETICO" });
    await item.getByRole("button", { name: "Corregir dimensión / NP", exact: true }).click();
    await item.getByRole("combobox", { name: "Dimensión", exact: true }).click();
    const opcion = item.getByRole("option").filter({ hasText: /150VA.*AX del corte.*4 PZA/ });
    assert.equal(await opcion.count(), 1);
    await opcion.click();
    assert.match(await item.innerText(), /Destino en AX: 8426.*150VA.*4 PZA/);
    assert.match(await item.innerText(), /Etiquetas: 1 nuevas/);
    assert.match(await item.innerText(), /Después: AX 4 · Físico 4 · Resultado: Cuadra/);
    // La corrección individual y la selección de varias partidas se conectan sin guardar al abrirlas.
    await item.getByRole("button", { name: "Elegir varias partidas para este AX…", exact: true }).click();
    const vinculo = page.getByRole("dialog", { name: "Elegir partidas del inventario", exact: true });
    assert.equal(await vinculo.getByRole("checkbox", { name: /Incluir MODELO SINTETICO/ }).isChecked(), true);
    await vinculo.getByRole("button", { name: "Cancelar", exact: true }).click();
    await item.getByRole("button", { name: "Revisar corrección", exact: true }).click();
    assert.deepEqual((await estado()).variantes, original.variantes);
    await item.getByRole("button", { name: "Confirmar corrección y etiquetas", exact: true }).click();
    const nuevo = await guardado((s) => s.variantes.find((v) => v.id === e.dos.v.id).dimension === "150VA");
    assert.equal(nuevo.etiquetas.material.at(-1).origen.linea_ax_id, 1);
    assert.deepEqual(nuevo.vales, original.vales);
    assert.deepEqual(nuevo.existencias, original.existencias);
    await page.getByRole("button", { name: "↶ Deshacer", exact: true }).click();
    const deshecho = await guardado((s) => s.variantes.find((v) => v.id === e.dos.v.id).dimension === "MODELO SINTETICO");
    assert.deepEqual(deshecho.etiquetas.material, original.etiquetas.material);
    await terminar();
  });
});
