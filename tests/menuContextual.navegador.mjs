// Integración real con el HTML compilado y datos sintéticos.
// npm run build; PLAYWRIGHT_MODULE=... CHROMIUM_BIN=... node --test tests/menuContextual.navegador.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { siguienteId } from "../src/nucleo/estado.js";
import * as et from "../src/servicios/etiquetas.js";
import * as en from "../src/servicios/entradas.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

async function escenario() {
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  const { estado } = cargaSintetica();
  const usuario = "ALMACENISTA UNO";
  estado.config.usuario_en_turno = usuario;
  const elementos = et.modeloDe(estado, "material").elementos;
  const uno = et.guardarModeloEtiqueta(estado, { nombre: "DISEÑO PRUEBA UNO", elementos }, usuario);
  const dos = et.guardarModeloEtiqueta(estado, { nombre: "DISEÑO PRUEBA DOS", elementos }, usuario);
  et.usarModelo(estado, "material", uno, usuario);
  et.agregarEtiquetas(estado, "material", [{ codigo: "701", nombre: "ETIQUETA SINTETICA", dimension: "6309", cantidad: 1, inventario: "DLTA" }]);
  const b = en.nuevoBorradorEntrada(estado, { usuario, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-PRUEBA", origen: "BASE SINTETICA", entrego_nombre: "ENTREGA SINTETICA" });
  b.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), estado.existencias[0].id), cantidad: "1" }];
  const entrada = en.confirmarEntrada(estado, b.id, { usuario });
  const cancelado = structuredClone(estado.vales.find((v) => v.tipo === "SALIDA"));
  Object.assign(cancelado, { id: siguienteId(estado, "vale"), folio: 9999, estado: "CANCELADO" });
  cancelado.lineas.forEach((l) => { l.id = siguienteId(estado, "vale_linea"); });
  estado.vales.push(cancelado);
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  return {
    estado: almacen.estado, uno, dos, entradaId: entrada.id,
    archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })),
  };
}

test("menús contextuales por elemento y estado en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const fixture = await escenario();
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-menu-browser-"));
  const cache = join(carpeta, "cache"), config = join(carpeta, "config");
  await Promise.all([mkdir(cache), mkdir(config)]);
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    res.end(req.url === "/blank" ? "<html><body>Fixture sintética</body></html>" : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(carpeta, { recursive: true, force: true });
  });
  browser = await chromium.launch({
    headless: true, ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
  });
  const origen = "http://127.0.0.1:" + server.address().port;
  async function pagina(ruta) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], red = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) red.push(r.url()); });
    page.on("dialog", (d) => d.accept());
    await context.addInitScript(() => {
      window.__prints = [];
      window.print = () => { window.__prints.push(document.querySelector("#area-impresion")?.innerHTML); window.dispatchEvent(new Event("afterprint")); };
    });
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open("control-almacen", 1);
        q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["estado", "archivos"], "readwrite");
        tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, fixture);
    await page.goto(origen + ruta, { waitUntil: "domcontentloaded" });
    const estado = () => page.evaluate(() => new Promise((resolve, reject) => {
      const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => {
        const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual");
        r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
      };
    }));
    const guardado = async (condicion) => {
      for (let i = 0; i < 100; i++) { const e = await estado(); if (condicion(e)) return e; await new Promise((r) => setTimeout(r, 25)); }
      assert.fail("No se guardó el cambio esperado");
    };
    const terminar = async () => { assert.deepEqual(errors, []); assert.deepEqual(red, []); await context.close(); };
    return { page, estado, guardado, terminar };
  }
  async function editor(page) {
    await page.getByRole("button", { name: "Editor de diseños", exact: true }).click();
    return page.getByRole("dialog", { name: "Editor de diseños de etiqueta" });
  }
  const opciones = (page) => page.getByRole("menuitem").allTextContents();
  const abrir = async (page, target) => { await target.click({ button: "right" }); await page.getByRole("menu").waitFor(); };

  await t.test("diseños: renombrar el pulsado, proteger fábrica y conservar cambios pendientes", async () => {
    const { page, guardado, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    const dos = ed.locator(".edd-diseno").filter({ hasText: "DISEÑO PRUEBA DOS" });
    await abrir(page, dos);
    await page.getByRole("menuitem", { name: "Renombrar diseño…" }).click();
    const rename = page.getByRole("dialog", { name: "Renombrar el diseño" });
    assert.equal(await rename.getByLabel("Nombre").inputValue(), "DISEÑO PRUEBA DOS");
    await rename.getByLabel("Nombre").fill("DISEÑO RENOMBRADO");
    await rename.getByRole("button", { name: "Renombrar", exact: true }).click();
    const e = await guardado((e) => e.config.etiquetas.modelos.some((m) => m.id === fixture.dos && m.nombre === "DISEÑO RENOMBRADO"));
    assert.equal(e.config.etiquetas.modelos.find((m) => m.id === fixture.uno).nombre, "DISEÑO PRUEBA UNO");
    await abrir(page, ed.locator(".edd-diseno").filter({ hasText: "Material (de fábrica)" }));
    assert.ok(!(await opciones(page)).some((s) => /Renombrar|Borrar/.test(s)));
    await page.keyboard.press("Escape");
    await ed.getByRole("button", { name: "Texto libre", exact: true }).click();
    await ed.getByLabel("Texto", { exact: true }).fill("CAMBIO SIN GUARDAR");
    await abrir(page, ed.locator(".edd-diseno").filter({ hasText: "DISEÑO PRUEBA UNO" }));
    await page.getByRole("menuitem", { name: "Renombrar diseño…" }).click();
    await page.getByRole("button", { name: "Seguir editando", exact: true }).click();
    assert.equal(await ed.getByLabel("Texto", { exact: true }).inputValue(), "CAMBIO SIN GUARDAR");
    assert.equal(await page.getByRole("dialog", { name: "Renombrar el diseño" }).count(), 0);
    await terminar();
  });

  await t.test("teclado, Escape y menú dentro del viewport sin mover el elemento del editor", async () => {
    const { page, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    const caja = ed.locator(".edd-caja").first();
    const geometria = await caja.getAttribute("style");
    await caja.focus(); await page.keyboard.press("Shift+F10");
    await page.getByRole("menu").waitFor();
    await page.keyboard.press("End");
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Quitar elemento/);
    await page.keyboard.press("ArrowUp"); await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu").count(), 0);
    assert.equal(await caja.getAttribute("style"), geometria);
    assert.equal(await ed.count(), 1);
    assert.equal(await caja.evaluate((e) => document.activeElement === e), true);
    const lienzo = ed.locator(".edd-lienzo");
    // Evento al borde simula el clic derecho en una pantalla pequeña / junto al límite.
    await lienzo.dispatchEvent("contextmenu", { clientX: 1438, clientY: 998, bubbles: true });
    const rect = await page.getByRole("menu").boundingBox();
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1440 && rect.y + rect.height <= 1000);
    await page.keyboard.press("Escape");
    await terminar();
  });

  await t.test("elementos: duplicar el pulsado y deshacer desde el lienzo", async () => {
    const { page, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    await ed.getByRole("button", { name: "Texto libre", exact: true }).click();
    const total = await ed.locator(".edd-caja").count();
    // Lista de capas: elegir otro elemento sin depender de las superposiciones del diseño.
    const target = ed.locator(".edd-capa-boton").filter({ hasText: /^Título$/ });
    await abrir(page, target);
    await page.getByRole("menuitem", { name: "Duplicar elemento" }).click();
    assert.equal(await ed.locator(".edd-caja").count(), total + 1);
    assert.match(await ed.locator(".edd-props h3").innerText(), /Título/);
    await abrir(page, ed.locator(".edd-lienzo"));
    await page.getByRole("menuitem", { name: "Deshacer", exact: true }).click();
    assert.equal(await ed.locator(".edd-caja").count(), total);
    await terminar();
  });

  await t.test("copiar, cortar, pegar entre diseños y deshacer/rehacer; el texto conserva sus atajos", async () => {
    const { page, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    await ed.getByRole("button", { name: "Texto libre", exact: true }).click();
    const campo = ed.getByLabel("Texto", { exact: true });
    await campo.fill("");
    await campo.pressSequentially("TEXTO SINTETICO COPIABLE");
    const texto = await campo.inputValue();
    await campo.press("Control+Z");
    assert.notEqual(await campo.inputValue(), texto);
    await campo.press("Control+Y");
    assert.equal(await campo.inputValue(), texto);
    await campo.press("Control+A"); await campo.press("Control+C");
    await campo.fill(""); await campo.press("Control+V");
    assert.equal(await campo.inputValue(), texto);
    const target = ed.locator(".edd-capa-boton").filter({ hasText: /^Texto libre$/ });
    await abrir(page, target);
    await page.getByRole("menuitem", { name: /Copiar elemento/ }).click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes("control-almacen.elemento"));
    await ed.getByRole("button", { name: "Guardar", exact: true }).click();
    await ed.locator(".edd-diseno").filter({ hasText: "DISEÑO PRUEBA DOS" }).click();
    const total = await ed.locator(".edd-caja").count();
    await abrir(page, ed.locator(".edd-lienzo"));
    await page.getByRole("menuitem", { name: /Pegar elemento/ }).click();
    await ed.getByLabel("Texto", { exact: true }).waitFor();
    assert.equal(await ed.getByLabel("Texto", { exact: true }).inputValue(), texto);
    assert.equal(await ed.locator(".edd-caja").count(), total + 1);
    await ed.locator(".edd-caja.elegida").focus();
    await page.keyboard.press("Control+X");
    assert.equal(await ed.locator(".edd-caja").count(), total);
    await page.keyboard.press("Control+Z");
    assert.equal(await ed.locator(".edd-caja").count(), total + 1);
    await page.keyboard.press("Control+Y");
    assert.equal(await ed.locator(".edd-caja").count(), total);
    await ed.locator(".edd-caja").first().focus();
    await page.keyboard.press("Control+V");
    assert.equal(await ed.locator(".edd-caja").count(), total + 1);
    await terminar();
  });

  await t.test("copiar y pegar entre diseños con el portapapeles del navegador bloqueado", async () => {
    const { page, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async () => { throw new DOMException("Bloqueado", "NotAllowedError"); },
        readText: async () => { throw new DOMException("Bloqueado", "NotAllowedError"); },
      } });
      document.execCommand = () => false;
    });
    await abrir(page, ed.locator(".edd-capa-boton").filter({ hasText: /^Título$/ }));
    await page.getByRole("menuitem", { name: "Copiar elemento", exact: true }).click();
    await ed.locator(".edd-diseno").filter({ hasText: "DISEÑO PRUEBA DOS" }).click();
    const total = await ed.locator(".edd-caja").count();
    await abrir(page, ed.locator(".edd-lienzo"));
    await page.getByRole("menuitem", { name: "Pegar elemento", exact: true }).click();
    assert.equal(await ed.locator(".edd-caja").count(), total + 1);
    assert.match(await ed.locator(".edd-props h3").innerText(), /Título/);
    await terminar();
  });

  await t.test("zonas sin acciones, captura, selección y Mayús conservan el menú nativo", async () => {
    const { page, terminar } = await pagina("/#etiquetas");
    const ed = await editor(page);
    await ed.getByRole("button", { name: "Texto libre", exact: true }).click();
    const campo = ed.getByLabel("Texto", { exact: true });
    const nativo = (target, props = {}) => target.evaluate((el, props) => {
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...props });
      el.dispatchEvent(e); return !e.defaultPrevented;
    }, props);
    assert.equal(await nativo(campo), true);
    assert.equal(await nativo(ed.locator(".edd-diseno").first(), { shiftKey: true }), true);
    assert.equal(await nativo(ed.locator("h2").first()), true);
    await ed.locator(".edd-diseno-nombre").first().evaluate((el) => {
      const range = document.createRange(); range.selectNodeContents(el);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    });
    assert.equal(await nativo(ed.locator(".edd-diseno").first()), true);
    assert.equal(await page.getByRole("menu").count(), 0);
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await abrir(page, ed.locator(".edd-diseno").first());
    await ed.locator("h2").click();
    assert.equal(await page.getByRole("menu").count(), 0);
    await terminar();
  });

  await t.test("etiquetas: opciones cambian al incluir/excluir y quitar permite Deshacer", async () => {
    const { page, guardado, terminar } = await pagina("/#etiquetas");
    const fila = page.locator(".etq-fila").first();
    await abrir(page, fila);
    await page.getByRole("menuitem", { name: "Excluir de esta impresión" }).click();
    assert.equal(await fila.locator("input[type=checkbox]").isChecked(), false);
    await abrir(page, fila);
    assert.ok((await opciones(page)).some((s) => s.includes("Incluir en esta impresión")));
    await page.getByRole("menuitem", { name: "Quitar de la lista" }).click();
    await guardado((e) => e.etiquetas.material.length === 0);
    await page.getByRole("button", { name: "Deshacer", exact: true }).click();
    const e = await guardado((e) => e.etiquetas.material.length === 1);
    assert.deepEqual(e.vales, fixture.estado.vales);
    assert.deepEqual(e.existencias, fixture.estado.existencias);
    await terminar();
  });

  await t.test("historial: acciones por tipo y estado; imprimir y abrir la corrección correcta", async () => {
    const { page, terminar } = await pagina("/#historial");
    let fila = page.locator(".tabla tbody tr").filter({ has: page.locator(".enlace-folio").filter({ hasText: /^9999$/ }) }).first();
    await abrir(page, fila);
    assert.deepEqual((await opciones(page)).map((s) => s.trim()), ["Abrir vale"]);
    await page.keyboard.press("Escape");
    fila = page.locator(".tabla tbody tr").filter({ has: page.locator(".enlace-folio").filter({ hasText: /^3$/ }) }).first();
    await abrir(page, fila);
    await page.getByRole("menuitem", { name: "Imprimir vale", exact: true }).click();
    await page.waitForFunction(() => window.__prints.length === 1);
    assert.ok((await page.evaluate(() => window.__prints[0])).includes("OBSERVACION"));
    await abrir(page, fila);
    await page.getByRole("menuitem", { name: "Corregir vale…" }).click();
    await page.getByRole("heading", { name: "Corregir vale 3", exact: true }).waitFor();
    assert.ok(page.url().includes("/corregir"));
    await page.goto(origen + "/#historial/entradas");
    fila = page.locator(".tabla tbody tr").first();
    await abrir(page, fila);
    assert.ok(!(await opciones(page)).some((s) => s.includes("Imprimir vale")));
    await page.getByRole("menuitem", { name: "Hacer etiquetas…" }).click();
    await page.getByRole("dialog", { name: "Etiquetas de un vale de entrada", exact: true }).waitFor();
    assert.ok(page.url().includes("#entrada/" + fixture.entradaId));
    await terminar();
  });

  await t.test("inventario: editar y mover la partida elegida", async () => {
    const { page, terminar } = await pagina("/#inventario");
    const fila = page.locator(".tabla tbody tr").first();
    await abrir(page, fila);
    await page.getByRole("menuitem", { name: "Editar dimensión y NP…" }).click();
    const modal = page.getByRole("dialog", { name: "Corregir dimensión y NP", exact: true });
    await modal.waitFor();
    await page.keyboard.press("Escape");
    await abrir(page, fila);
    await page.getByRole("menuitem", { name: "Mover a otro contenedor…" }).click();
    await page.getByRole("heading", { name: "Mover a otro contenedor", exact: true }).waitFor();
    await terminar();
  });
});
