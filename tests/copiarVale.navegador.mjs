// Ronda 33 en Chromium: vale de salida desde la entrada recibida hoy (botón del detalle y ventana
// «Desde un vale…» de Vales de salida) y copia de un vale de salida; se emite sin errores.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Indices } from "../src/nucleo/estado.js";
import { conRenglonExistente, confirmarEntrada, entradaSinExistencia, lineaEntradaVacia, nuevoBorradorEntrada } from "../src/servicios/entradas.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

test("vale de salida a partir de una entrada o de otro vale", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "copiar-vale-"));
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

  // Estado sintético con una entrada recibida hoy (balero a su partida y diésel sin existencia).
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const b = nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(b, { modo: "manual", folio_externo: "B-300", origen: "BASE PRUEBA" });
  b.lineas = [
    { ...conRenglonExistente(estado, lineaEntradaVacia(), balero.id, indices), cantidad: "3", oc: "OC-90", lote: "SOLICITANTE" },
    { ...entradaSinExistencia({ ...lineaEntradaVacia(), codigo: 136, descripcion: "DIESEL", um: "LTS" }), cantidad: "500" },
  ];
  const entrada = confirmarEntrada(estado, b.id, { usuario: USUARIO });
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
  const cerrarAvisos = async () => {
    const cerrar = page.getByRole("button", { name: "Cerrar aviso" });
    for (let i = 0; i < 5 && (await cerrar.count()); i++) await cerrar.first().click().catch(() => {});
  };
  const esperar = async (condicion, mensaje) => {
    for (let i = 0; i < 120; i++) { const e = await leer(); if (condicion(e)) return e; await new Promise((r) => setTimeout(r, 25)); }
    assert.fail(mensaje);
  };

  await t.test("desde el detalle de la entrada se abre el borrador con sus partidas", async () => {
    await page.goto(`${origen}/#entrada/${entrada.id}`);
    await page.getByRole("button", { name: "Vale de salida", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#vales");
    await page.locator(".copia-de").getByText("Partidas de la entrada", { exact: false }).waitFor();
    const e = await esperar((x) => x.borradores.length === 1, "No se creó el borrador");
    const [borrador] = e.borradores;
    assert.deepEqual(borrador.copia_de, { tipo: "ENTRADA", vale_id: entrada.id, folio: "E-0001" });
    assert.deepEqual(borrador.lineas.map((l) => [l.codigo, l.existencia_id, l.cantidad, l.oc]), [[701, balero.id, "3", "OC-90"], [136, null, "500", ""]]);
    assert.equal(await page.getByRole("link", { name: "E-0001", exact: true }).count(), 1);
    assert.equal((await page.locator(".copia-de").innerText()).trim(), "Partidas de la entrada E-0001");
    await cerrarAvisos();
  });

  await t.test("«Desde un vale…» propone lo recibido hoy y abre otra pestaña", async () => {
    await page.getByRole("button", { name: "Desde un vale…", exact: true }).click();
    const ventana = page.getByRole("dialog", { name: "Vale nuevo desde otro vale" });
    await ventana.getByText("Recibido hoy", { exact: true }).waitFor();
    await page.waitForTimeout(400); // termina de aparecer
    await page.screenshot({ path: join(carpeta, "ventana.png") });
    await ventana.getByRole("button", { name: /E-0001/ }).click();
    await ventana.waitFor({ state: "detached" });
    await esperar((x) => x.borradores.length === 2, "No se creó el segundo borrador");
    assert.equal(await page.getByRole("tab").count(), 2);
    await cerrarAvisos();
    // Se busca un vale de salida por su folio.
    await page.getByRole("button", { name: "Desde un vale…", exact: true }).click();
    await page.getByRole("textbox", { name: "Folio del vale" }).fill(String(fixture.estado.vales.find((v) => v.tipo === "SALIDA").folio));
    await page.getByRole("dialog").getByText("Coinciden:", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });

  await t.test("se elige el área y se emite; el vale de salida se copia desde su detalle", async () => {
    await cerrarAvisos();
    await page.getByRole("tab").first().click();
    // Área MECANICO y quién recibe (como en cualquier vale).
    await page.getByRole("radio", { name: "MECANICO", exact: true }).click();
    await page.locator("#quien-recibe").fill("MECANICO UNO");
    await page.locator("#quien-recibe").press("Escape");
    await page.getByRole("combobox", { name: "Puesto (quién lo lleva)" }).fill("MECANICO");
    const etapa = page.getByLabel("Etapa de perforación", { exact: true });
    if (await etapa.count()) await etapa.fill('12 1/4" SINTETICA');
    // Ronda 34: el borrador copiado empieza en *Para quién*; las partidas ya vienen cargadas.
    await page.getByRole("button", { name: /^Continuar a material/ }).click();
    await page.getByRole("button", { name: /^Revisar y emitir/ }).click();
    await page.getByRole("button", { name: /^Emitir vale · folio/ }).click();
    const e = await esperar((x) => x.borradores.length === 1 && x.vales.some((v) => v.tipo === "SALIDA" && !v.migrado), "No se emitió el vale");
    const emitido = e.vales.find((v) => v.tipo === "SALIDA" && !v.migrado);
    assert.equal(emitido.lineas.length, 2);
    assert.deepEqual(e.auditoria.at(-1).despues.copia_de, { tipo: "ENTRADA", folio: "E-0001" });
    await page.goto(`${origen}/#vale/${emitido.id}`);
    await page.getByRole("button", { name: "Copiar a un vale nuevo", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#vales");
    const copia = await esperar((x) => x.borradores.length === 2, "No se copió el vale de salida");
    const nuevo = copia.borradores.at(-1);
    assert.deepEqual([nuevo.copia_de.tipo, nuevo.plantilla_area_id, nuevo.recibio_nombre], ["SALIDA", emitido.plantilla_area_id, emitido.recibio_nombre]);
    await page.locator(".copia-de").getByText(`Partidas del vale ${emitido.folio}`).waitFor();
    await cerrarAvisos();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(carpeta, "borrador.png") });
    assert.deepEqual(errores, []);
    assert.deepEqual(externas, []);
  });
  if (process.env.CAPTURAS) for (const f of ["ventana.png", "borrador.png"]) await import("node:fs/promises").then((fs) => fs.copyFile(join(carpeta, f), join(process.env.CAPTURAS, f)));
});
