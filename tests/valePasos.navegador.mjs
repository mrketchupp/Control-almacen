// Ronda 34, etapa 1 en Chromium: el vale de salida en 3 pasos (Para quién → Material → Revisar y emitir). El paso se
// guarda con el borrador, regresar no borra nada, Enter avanza (no dentro de las partidas) y se emite como siempre.
// Con CAPTURAS=<carpeta> guarda las capturas de cada paso a 1440, 1024, 768 y 640 px para revisarlas (CAPTURAS_FILTRO=
// <expresión> para solo las que cambiaron en una etapa, p. ej. «^paso-1»).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const ANCHOS = [1440, 1024, 768, 640];

test("vale de salida en 3 pasos", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "vale-pasos-"));
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

  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  const folio = Math.max(...fixture.estado.vales.filter((v) => v.tipo === "SALIDA").map((v) => v.folio)) + 1;

  const capturas = process.env.CAPTURAS || null;
  if (capturas) await mkdir(capturas, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: capturas ? 2 : 1 });
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
  const esperar = async (condicion, mensaje) => {
    for (let i = 0; i < 160; i++) { const e = await leer(); if (condicion(e)) return e; await new Promise((r) => setTimeout(r, 25)); }
    assert.fail(mensaje);
  };
  const cerrarAvisos = async () => {
    const cerrar = page.getByRole("button", { name: "Cerrar aviso" });
    for (let i = 0; i < 5 && (await cerrar.count()); i++) await cerrar.first().click().catch(() => {});
  };
  const pasoActual = async () => (await page.locator('ol[aria-label="Pasos del vale"] li[aria-current="step"] .paso-nombre').innerText()).trim();
  const continuar = page.getByRole("button", { name: /^Continuar a material/ });
  const revisar = page.getByRole("button", { name: /^Revisar y emitir/ });
  // Capturas de lo que cambió, sin elementos encimados: nada se sale de su caja a lo ancho.
  const filtro = process.env.CAPTURAS_FILTRO ? new RegExp(process.env.CAPTURAS_FILTRO) : null;
  const capturar = async (nombre) => {
    const guardar = capturas && (!filtro || filtro.test(nombre));
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.waitForTimeout(250);
      // La ventana crece hasta lo que mide la página: lo fijo abajo (el pie del paso) queda donde se ve, no encima.
      if (guardar) for (let i = 0; i < 3; i++) {
        const alto = await page.evaluate(() => document.documentElement.scrollHeight);
        if (alto <= page.viewportSize().height) break;
        await page.setViewportSize({ width: ancho, height: alto });
        await page.waitForTimeout(150);
      }
      const desborde = await page.evaluate(() => {
        const ancho = document.documentElement.clientWidth;
        const fuera = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > ancho + 0.5 && el.getClientRects().length)
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(el.getBoundingClientRect().right)}`);
        return { px: document.documentElement.scrollWidth - ancho, fuera: fuera.slice(0, 8) };
      });
      assert.ok(desborde.px <= 0, `${nombre} a ${ancho} px: la página se sale ${desborde.px} px a lo ancho (${desborde.fuera.join(", ")})`);
      if (guardar) await page.screenshot({ path: join(capturas, `${nombre}-${ancho}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };

  const nombre = page.locator("#quien-recibe");
  const etapaSiFalta = async () => {
    const etapa = page.getByLabel("Etapa de perforación", { exact: true });
    if (await etapa.count()) await etapa.fill('12 1/4" SINTETICA');
  };

  await t.test("paso 1: no se avanza sin área ni quién recibe; teclas 1…0 y Enter", async () => {
    await page.goto(`${origen}/#vales`);
    await page.getByRole("button", { name: `＋ Nuevo vale · folio ${folio}`, exact: true }).click();
    assert.equal(await pasoActual(), "1 · Para quién");
    assert.equal(await continuar.isDisabled(), true);
    await page.getByText("Falta el área", { exact: true }).waitFor();
    await page.getByText("Falta el nombre", { exact: true }).waitFor();
    assert.equal(await page.locator(".franja-borradores").getByRole("button", { name: "Descartar borrador", exact: true }).count(), 1);
    // Sin área preseleccionada; las de transferencia no van en la cuadrícula; cada una con su tecla.
    const areas = page.getByRole("radiogroup", { name: "Área" }).getByRole("radio");
    assert.deepEqual(await areas.allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, " ").trim())), ["SOLDADOR 1", "MECANICO 2", "NOV 3"]);
    assert.equal(await page.getByRole("radio", { checked: true, name: "MECANICO" }).count(), 0);
    await cerrarAvisos();
    await capturar("paso-1-vacio");
    // «2» (con el foco fuera de los campos) elige MECANICO y pasa al nombre, que trae la plantilla del área.
    await page.locator("#paso-vale").focus();
    await page.keyboard.press("2");
    await page.getByRole("radio", { name: "MECANICO", checked: true }).waitFor();
    assert.equal(await page.getByText("Falta el área", { exact: true }).count(), 0);
    await page.waitForFunction(() => document.activeElement?.id === "quien-recibe");
    assert.equal(await nombre.inputValue(), "MECANICO UNO");
    await page.getByText("Suelen recibir en MECANICO", { exact: true }).waitFor();
    // Escribir filtra la lista; ↓ y Enter eligen (el puesto se llena con el último que tuvo).
    await nombre.fill("mecanico");
    await nombre.press("ArrowDown");
    await nombre.press("ArrowUp");
    await nombre.press("Enter");
    assert.equal(await pasoActual(), "1 · Para quién", "Enter con la lista abierta elige, no avanza");
    assert.equal(await nombre.inputValue(), "MECANICO UNO");
    await page.getByRole("combobox", { name: "Puesto (quién lo lleva)" }).fill("MECANICO");
    await etapaSiFalta();
    await page.getByText(/^Observaciones de MECANICO y etapa .+ se llenan solas\.$/).waitFor();
    assert.equal(await continuar.isDisabled(), false);
    await capturar("paso-1-interno");
    // Sin lista abierta, Enter en el nombre pasa al paso 2.
    await nombre.focus();
    await nombre.press("Enter");
    await page.waitForFunction(() => document.querySelector('li[aria-current="step"] .paso-nombre')?.textContent.includes("2 · Material"));
    assert.equal(await page.locator(".pasos-vale li.paso-completo").count(), 1);
  });

  await t.test("paso 2: el resumen de para quién, partidas y Enter dentro de ellas no cambia de paso", async () => {
    const resumen = page.getByRole("region", { name: "Para quién" });
    assert.match(await resumen.innerText(), /MECANICO UNO/);
    assert.equal(await revisar.isDisabled(), true);
    await page.getByText("Agrega al menos una partida.", { exact: true }).waitFor();
    const codigo = page.getByRole("combobox", { name: "Código AX", exact: true }).first();
    await codigo.fill("706");
    await page.getByRole("option").filter({ hasText: /^706\b/ }).click();
    const cantidad = page.getByLabel("Cantidad", { exact: true }).first();
    await cantidad.fill("1");
    await cantidad.press("Enter"); // pasa a una partida nueva, no al paso 3
    assert.equal(await pasoActual(), "2 · Material");
    const otro = page.getByRole("combobox", { name: "Código AX", exact: true }).last();
    await otro.click();
    await otro.fill("136");
    await page.getByRole("option").filter({ hasText: /^136\b/ }).click();
    await page.getByLabel("Cantidad", { exact: true }).last().fill("200");
    await page.getByLabel("Presentación (UM)", { exact: true }).last().fill("LTS");
    assert.equal(await revisar.isDisabled(), false);
    await capturar("paso-2");
    await revisar.click();
    assert.equal(await pasoActual(), "3 · Revisar y emitir");
  });

  await t.test("paso 3: resumen, regresar sin perder nada, el paso se guarda y se emite", async () => {
    const material = page.getByRole("region", { name: "Material" });
    assert.match(await material.innerText(), /Material · 2 partidas/);
    assert.match(await material.innerText(), /SELLOS/);
    assert.equal(await page.locator(".pasos-vale li.paso-completo").count(), 2);
    await capturar("paso-3");
    // Editar para quién → paso 1 con todo como estaba; las partidas siguen.
    await page.getByRole("button", { name: "Editar para quién", exact: true }).click();
    assert.equal(await pasoActual(), "1 · Para quién");
    await page.getByRole("radio", { name: "MECANICO", checked: true }).waitFor();
    await continuar.click();
    assert.equal(await page.getByLabel("Cantidad", { exact: true }).first().inputValue(), "1");
    await revisar.click();
    // El paso se guarda con el borrador: al volver a abrir la página sigue en el 3.
    await esperar((e) => e.borradores[0]?.paso === 3, "No se guardó el paso");
    await page.reload();
    await page.getByRole("button", { name: `Emitir vale · folio ${folio}`, exact: true }).waitFor();
    assert.equal(await pasoActual(), "3 · Revisar y emitir");
    // Enter en el paso 3 emite, con la confirmación del folio.
    await page.locator("#paso-vale").focus();
    await page.keyboard.press("Enter");
    await page.getByText(`✓ Vale ${folio} emitido`, { exact: true }).waitFor();
    const e = await esperar((x) => x.vales.some((v) => v.tipo === "SALIDA" && v.folio === folio), "No se emitió");
    const vale = e.vales.find((v) => v.tipo === "SALIDA" && v.folio === folio);
    assert.equal(vale.lineas.length, 2);
    assert.equal("paso" in vale, false, "el paso no llega al vale emitido");
    assert.equal(e.borradores.length, 0);
  });

  await t.test("descartar desde la franja de pestañas y deshacer devuelve el borrador en su paso", async () => {
    await cerrarAvisos();
    await page.getByRole("button", { name: "＋ Nuevo vale", exact: true }).click();
    await page.getByRole("radio", { name: "SOLDADOR", exact: true }).click();
    await etapaSiFalta();
    await continuar.click();
    await esperar((e) => e.borradores[0]?.paso === 2, "No se guardó el paso 2");
    await page.locator(".franja-borradores").getByRole("button", { name: "Descartar borrador", exact: true }).click();
    await esperar((e) => e.borradores.length === 0, "No se descartó");
    await page.getByRole("button", { name: "↶ Deshacer", exact: true }).click();
    await esperar((e) => e.borradores.length === 1, "No se recuperó");
    await page.waitForFunction(() => document.querySelector('li[aria-current="step"] .paso-nombre')?.textContent.includes("2 · Material"));
  });

  await t.test("paso 1: transferencia (destino, quién transporta y quién autoriza) y NOV con sus firmas extra", async () => {
    await cerrarAvisos();
    await page.getByRole("button", { name: "＋ Nuevo vale", exact: true }).click();
    await page.getByRole("radio", { name: "Enviar a otro RIG o pozo", exact: true }).click();
    // Los destinos del usuario, sin el RIG propio; ninguno elegido.
    const destinos = page.getByRole("radiogroup", { name: "¿A dónde se envía?" }).getByRole("radio");
    assert.deepEqual(await destinos.allInnerTexts(), ["RIG 48", "RIG 90", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);
    await page.getByText("Falta el destino", { exact: true }).waitFor();
    assert.equal(await continuar.isDisabled(), true);
    await page.getByRole("radio", { name: "RIG 165", exact: true }).click();
    await page.locator("#quien-recibe").fill("CHOFER SINTETICO");
    await page.locator("#quien-recibe").press("Escape");
    await page.getByRole("combobox", { name: "Puesto (quién lo transporta)" }).fill("CHOFER");
    await page.getByRole("heading", { name: "¿Quién autoriza?", exact: true }).waitFor();
    await page.locator("#quien-autoriza").fill("");
    await page.getByText("Falta quién autoriza", { exact: true }).waitFor();
    await page.locator("#quien-autoriza").fill("AUTORIZADOR UNO");
    await page.locator("#quien-autoriza").press("Escape");
    await etapaSiFalta();
    assert.equal(await continuar.isDisabled(), false);
    await page.locator("#paso-vale").click({ position: { x: 5, y: 5 } });
    await capturar("paso-1-transferencia");
    let e = await esperar((x) => x.borradores.at(-1)?.destino === "RIG 165" && x.borradores.at(-1)?.recibio_nombre === "CHOFER SINTETICO", "No se guardó la transferencia");
    assert.equal(e.borradores.at(-1).naturaleza, "TRANSFERENCIA");
    // Otro destino escrito a mano; los botones quedan sin elegir.
    await page.getByRole("combobox", { name: "Otro destino" }).fill("POZO SINTETICO 7");
    assert.equal(await page.getByRole("radiogroup", { name: "¿A dónde se envía?" }).getByRole("radio", { checked: true }).count(), 0);
    // De vuelta a consumo interno: se elige el área desde cero.
    await page.getByRole("radio", { name: "Consumo interno", exact: true }).click();
    await page.getByText("Falta el área", { exact: true }).waitFor();
    assert.equal(await page.getByRole("radiogroup", { name: "Área" }).getByRole("radio", { checked: true }).count(), 0);
    // NOV: una tarjeta por cada firma extra, con las del último vale del área.
    await page.getByRole("radio", { name: "NOV", exact: true }).click();
    assert.equal(await page.locator(".columna-personas .tarjeta-persona").count(), 3);
    await etapaSiFalta();
    await capturar("paso-1-nov");
    e = await esperar((x) => x.borradores.at(-1)?.depto_destino === "NOV ENERGY", "No se guardó el área NOV");
    assert.equal(e.borradores.at(-1).destino, "RIG 91 - TANQUE NOV");
    assert.deepEqual(errores, []);
    assert.deepEqual(externas, []);
  });
});
