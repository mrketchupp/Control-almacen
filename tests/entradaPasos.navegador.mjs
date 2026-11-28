// Ronda 39 en Chromium: el vale de entrada en 4 pasos (docs/14 §3–§7, §11). Paso 1 *De dónde viene* y *Llenar con
// Copilot*: lo que falta se marca al pulsar «Continuar» (o Enter), el paso se guarda con el borrador, regresar no borra
// nada y lo que lee Copilot solo se usa con «Ver las partidas →». Paso 2 *Material*: filtros, tipo, buscador y editar
// una partida. Paso 3 *Acomodo*: contenedor por contenedor (★ lo que vive en uno solo). Paso 4: dónde quedó cada partida
// y *Registrar*. Con CAPTURAS=<carpeta> guarda las capturas a 1440, 1024, 768 y 640 px (CAPTURAS_FILTRO=<expresión>
// para solo algunas); en cada una, la cabecera y el menú se ven completos (§1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Indices } from "../src/nucleo/estado.js";
import { confirmarEntrada, conRenglonExistente, lineaEntradaVacia, nuevoBorradorEntrada } from "../src/servicios/entradas.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const ANCHOS = [1440, 1024, 768, 640];
const RESPUESTA = {
  tipo: "vale_entrada",
  folio: "B-500",
  fecha: "2026-10-20",
  viene_de: "BASE NORTE",
  entrego: "CHOFER DOS",
  partidas: [
    { oc: "4500123", cantidad: 4, codigo: "701", descripcion: "BALEROS", dimension: "6309-2Z/C3", np: "", um: "PZA", lote: "J. PEREZ", dudoso: false },
    { oc: "S/OC", cantidad: 10, codigo: "704", descripcion: "EMPAQUE", dimension: '6"', np: "FLEXITALIC", um: "PZA", lote: "", dudoso: true },
    { oc: "", cantidad: 2, codigo: "701", descripcion: "BALEROS", dimension: "6311-2RS", np: "", um: "PZA", lote: "J. PEREZ", dudoso: false },
  ],
};
// Como la copia Copilot: en un bloque de código y, esta vez, cortada al final (se cierra sola y se avisa).
const PEGADO = "Aquí está:\n```json\n" + JSON.stringify(RESPUESTA, null, 2).replace(/\n\}$/, "") + "\n```";

test("vale de entrada en 4 pasos", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "entrada-pasos-"));
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

  // Entradas anteriores: de ahí salen los botones de «Viene de» y el puesto de quien entrega.
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const anterior = (origenVale, folio, entrego, puesto) => {
    const b = nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-01", fechaRecibido: "2026-10-02" });
    Object.assign(b, { folio_externo: folio, origen: origenVale, entrego_nombre: entrego, entrego_puesto: puesto });
    b.lineas = [{ ...conRenglonExistente(estado, lineaEntradaVacia(), balero.id, indices), cantidad: "1" }];
    confirmarEntrada(estado, b.id, { usuario: USUARIO });
  };
  anterior("BASE PRUEBA", "B-100", "CHOFER UNO", "CHOFER");
  anterior("BASE PRUEBA", "B-101", "CHOFER UNO", "CHOFER");
  anterior("BASE NORTE", "N-200", "CHOFER DOS", "OPERADOR DE GRUA");
  anterior("RIG 48", "R-300", "RECEPTOR RIG 48", "SUP. RIG 48");
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };

  const capturas = process.env.CAPTURAS || null;
  if (capturas) await mkdir(capturas, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: capturas ? 2 : 1 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origen });
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
  const pasos = page.locator('ol[aria-label="Pasos de la entrada"]');
  const pasoActual = async () => (await pasos.locator('li[aria-current="step"] .paso-nombre').innerText()).trim();
  const continuar = page.getByRole("button", { name: /^Continuar a material/ });
  const vieneDe = page.getByRole("radiogroup", { name: "Viene de" });
  const faltas = () => page.locator("#paso-entrada .falta").allInnerTexts();
  const ventana = page.getByRole("dialog", { name: "Llenar con Copilot" });
  const enfocado = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim());

  // La cabecera y el menú completos, sin nada que se salga a lo ancho (§1 y §9).
  const revisarMarco = (donde) => page.evaluate((donde) => {
    const vista = { ancho: innerWidth, alto: innerHeight };
    const caja = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const cabecera = caja(".cabecera"), mas = caja(".navegacion .nav-boton-mas");
    const area = document.querySelector(".cuerpo > main.contenido");
    const problemas = [];
    if (document.documentElement.scrollHeight > vista.alto + 1 || document.scrollingElement.scrollTop !== 0) problemas.push("la página se desplaza");
    if (!cabecera || Math.round(cabecera.top) !== 0 || cabecera.bottom > vista.alto) problemas.push("la cabecera no se ve completa");
    if (!mas || mas.bottom > vista.alto + 1) problemas.push("«Ajustes y más» no se ve");
    if (area && area.scrollWidth > area.clientWidth + 1) problemas.push(`el área de trabajo se sale ${area.scrollWidth - area.clientWidth} px a lo ancho`);
    if (document.documentElement.scrollWidth > vista.ancho + 1) problemas.push("la página se sale a lo ancho");
    return problemas.length ? `${donde}: ${problemas.join("; ")}` : null;
  }, donde);
  const filtroCapturas = process.env.CAPTURAS_FILTRO ? new RegExp(process.env.CAPTURAS_FILTRO) : null;
  const capturar = async (nombre) => {
    if (filtroCapturas && !filtroCapturas.test(nombre)) return;
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.waitForTimeout(250);
      if (capturas && !(await ventana.count())) for (let i = 0; i < 3; i++) {
        const alto = await page.evaluate(() => { const a = document.querySelector(".cuerpo > main.contenido"); return innerHeight + (a ? a.scrollHeight - a.clientHeight : 0); });
        if (alto <= page.viewportSize().height) break;
        await page.setViewportSize({ width: ancho, height: alto });
        await page.waitForTimeout(150);
      }
      assert.equal(await revisarMarco(`${nombre} a ${ancho} px`), null);
      if (capturas) await page.screenshot({ path: join(capturas, `${nombre}-${ancho}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  const nueva = async (folio) => {
    await page.goto(`${origen}/#entradas`);
    await page.locator(".tarjeta-inicio-vales, .franja-borradores").first().waitFor();
    const boton = page.getByRole("button", { name: `＋ Nueva entrada · ${folio}`, exact: true });
    if (await boton.count()) await boton.click();
    else await page.getByRole("button", { name: "＋ Nueva entrada", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('ol[aria-label="Pasos de la entrada"]'));
  };

  await t.test("paso 1: los orígenes salen de los datos y lo que falta se marca al pulsar Continuar", async () => {
    await nueva("E-0005");
    assert.equal(await page.locator(".linea-borrador").innerText(), "Se registrará como E-0005 · Se guarda solo");
    assert.deepEqual(await pasos.locator(".paso-nombre").allInnerTexts(), ["1 · De dónde viene", "2 · Material", "3 · Acomodo", "4 · Revisar y registrar"]);
    assert.equal(await pasoActual(), "1 · De dónde viene");
    // Del más usado al menos; el borrador nuevo trae el último origen (como antes).
    assert.deepEqual(await vieneDe.getByRole("radio").allInnerTexts(), ["BASE PRUEBA", "RIG 48", "BASE NORTE"]);
    assert.equal(await vieneDe.getByRole("radio", { name: "RIG 48" }).getAttribute("aria-checked"), "true");
    assert.equal(await page.locator(".valor-fijo").innerText(), `${USUARIO}\nen turno`);
    // Nada en ámbar hasta que se intenta continuar (§11).
    assert.deepEqual(await faltas(), []);
    assert.equal(await continuar.isDisabled(), false);
    await continuar.click();
    assert.deepEqual(await faltas(), ["Falta el folio del vale"]);
    assert.equal(await enfocado(), "folio-base");
    assert.equal(await pasoActual(), "1 · De dónde viene");
    await capturar("paso-1-falta");
    await page.locator("#folio-base").fill("B-400");
    assert.deepEqual(await faltas(), []);
    await vieneDe.getByRole("radio", { name: "BASE PRUEBA" }).click();
    assert.equal(await vieneDe.getByRole("radio", { name: "BASE PRUEBA" }).getAttribute("aria-checked"), "true");
    // Quien entrega: el puesto se llena con el último suyo; uno escrito a mano no se pisa.
    await page.locator("#entrego-nombre").fill("CHOFER DOS");
    assert.equal(await page.locator("#entrego-puesto").inputValue(), "OPERADOR DE GRUA");
    await page.locator("#entrego-nombre").fill("CHOFER UNO");
    assert.equal(await page.locator("#entrego-puesto").inputValue(), "CHOFER");
    await page.locator("#entrego-puesto").fill("CHOFER DE PLATAFORMA");
    await page.locator("#entrego-nombre").fill("CHOFER DOS");
    assert.equal(await page.locator("#entrego-puesto").inputValue(), "CHOFER DE PLATAFORMA");
    await page.locator("#entrego-nombre").press("Escape");
    // «Otro origen…» escribe uno que no está en los botones (y ninguno queda elegido).
    await page.locator("#viene-de").fill("base sur");
    assert.equal(await vieneDe.locator('[aria-checked="true"]').count(), 0);
    await page.locator("#viene-de").press("Escape");
    await capturar("paso-1");
    // Enter avanza (no en una lista abierta).
    await page.locator("#folio-base").press("Enter");
    await page.waitForFunction(() => document.querySelector('ol[aria-label="Pasos de la entrada"] li[aria-current="step"]')?.textContent.includes("Material"));
    assert.deepEqual(await pasos.locator("li").evaluateAll((li) => li.map((l) => l.className)), ["paso-completo", "paso-actual", "paso-pendiente", "paso-pendiente"]);
    const guardado = await esperar((e) => e.borradores_entrada[0]?.paso === 2, "El paso no se guardó con el borrador");
    assert.deepEqual([guardado.borradores_entrada[0].origen, guardado.borradores_entrada[0].folio_externo, guardado.borradores_entrada[0].entrego_nombre], ["BASE SUR", "B-400", "CHOFER DOS"]);
    assert.equal(await page.locator(".resumen-de-donde strong").innerText(), "BASE SUR · vale B-400");
    // Regresar no borra nada.
    await page.getByRole("button", { name: "← De dónde viene", exact: true }).click();
    assert.equal(await pasoActual(), "1 · De dónde viene");
    assert.equal(await page.locator("#folio-base").inputValue(), "B-400");
    assert.equal(await page.locator("#viene-de").inputValue(), "BASE SUR");
    await esperar((e) => e.borradores_entrada[0]?.paso === 1, "El paso 1 no se guardó al regresar");
  });

  await t.test("Llenar con Copilot: lo leído se ve en verde y solo se usa con «Ver las partidas →»", async () => {
    await nueva("E-0005");
    const id = (await esperar((e) => e.borradores_entrada.length === 2, "No se creó la segunda entrada")).borradores_entrada[1].id;
    await page.getByRole("button", { name: "Llenar con Copilot", exact: true }).click();
    await ventana.waitFor();
    assert.equal(await ventana.getByRole("button", { name: "Ver las partidas →" }).isDisabled(), true);
    await ventana.getByRole("button", { name: "Copiar instrucciones", exact: true }).click();
    await ventana.getByRole("button", { name: "✓ Copiadas", exact: true }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /vale de material de almacén/);
    if (capturas) await capturar("copilot-copiadas");
    await page.evaluate((texto) => navigator.clipboard.writeText(texto), PEGADO);
    await ventana.getByRole("button", { name: "Pegar", exact: true }).click();
    const leido = ventana.locator(".copilot-leido");
    await leido.waitFor();
    assert.match(await leido.innerText(), /Viene de BASE NORTE/);
    assert.match(await leido.innerText(), /Folio B-500/);
    assert.match(await leido.innerText(), /Entregó CHOFER DOS/);
    assert.match(await leido.locator(".copilot-leido-partidas").innerText(), /^3 partidas · 1 por revisar · 1 variante nueva$/);
    assert.match(await leido.innerText(), /venía cortada/);
    assert.equal(await ventana.locator(".copilot-marca.hecho").count(), 3);
    await capturar("copilot-leido");
    // Todavía no cambia nada.
    await page.waitForTimeout(700);
    const antes = (await leer()).borradores_entrada.find((b) => b.id === id);
    assert.deepEqual([antes.folio_externo, en(antes.lineas)], ["", 0]);
    await ventana.getByRole("button", { name: "Ver las partidas →" }).click();
    await ventana.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelector('ol[aria-label="Pasos de la entrada"] li[aria-current="step"]')?.textContent.includes("Material"));
    assert.equal(await page.locator(".resumen-de-donde strong").innerText(), "BASE NORTE · vale B-500");
    assert.equal(await page.locator(".tarjeta-entrada").count(), 3);
    assert.match(await page.locator(".copilot-estado").innerText(), /Copilot leyó 3 partidas/);
    const despues = await esperar((e) => e.borradores_entrada.find((b) => b.id === id)?.paso === 2, "Lo de Copilot no se guardó");
    const b = despues.borradores_entrada.find((x) => x.id === id);
    assert.deepEqual([b.folio_externo, b.origen, b.fecha, b.entrego_nombre, en(b.lineas)], ["B-500", "BASE NORTE", "2026-10-20", "CHOFER DOS", 3]);
  });

  await t.test("Copilot sin datos del vale: se queda en el paso 1 con el folio marcado (§11); Ctrl + V en la ventana", async () => {
    await nueva("E-0005");
    const id = (await esperar((e) => e.borradores_entrada.length === 3, "No se creó la tercera entrada")).borradores_entrada[2].id;
    await page.getByRole("button", { name: "Llenar con Copilot", exact: true }).click();
    await ventana.waitFor();
    // Ctrl + V con el foco en la ventana (no en un campo).
    await page.evaluate((texto) => {
      const datos = new DataTransfer();
      datos.setData("text/plain", texto);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: datos, bubbles: true, cancelable: true }));
    }, JSON.stringify({ partidas: RESPUESTA.partidas.slice(0, 1) }));
    await ventana.locator(".copilot-leido").waitFor();
    assert.match(await ventana.locator(".copilot-leido").innerText(), /Folio —/);
    await ventana.getByRole("button", { name: "Ver las partidas →" }).click();
    await ventana.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "folio-base");
    assert.equal(await pasoActual(), "1 · De dónde viene");
    assert.deepEqual(await faltas(), ["Falta el folio del vale"]);
    const b = (await esperar((e) => en(e.borradores_entrada.find((x) => x.id === id)?.lineas ?? []) === 1, "No se guardaron las partidas")).borradores_entrada.find((x) => x.id === id);
    assert.equal(b.paso, 1);
    // Cancelar no cambia nada.
    await page.getByRole("button", { name: "Llenar con Copilot", exact: true }).click();
    await ventana.getByRole("button", { name: "Cancelar", exact: true }).click();
    await ventana.waitFor({ state: "detached" });
    assert.equal(await pasoActual(), "1 · De dónde viene");
  });

  const tarjeta = (texto) => page.locator(".tarjeta-entrada", { hasText: texto });
  const chip = (nombre) => page.locator(".filtros-entrada .chip-filtro-entrada", { hasText: nombre });

  await t.test("paso 2: filtros, «Está bien», tipo, buscador y editar una partida", async () => {
    await page.goto(`${origen}/#entradas`);
    await page.getByRole("tab", { name: /^Vale B-500/ }).click();
    await page.locator(".tarjeta-entrada").first().waitFor();
    assert.equal(await pasoActual(), "2 · Material");
    assert.deepEqual(await page.locator(".filtros-entrada .chip-filtro-entrada").allInnerTexts(), ["Todas · 3", "Por revisar · 1", "Sin O.C. · 2", "Sin solicitante · 1"]);
    // Lo que Copilot no tenía claro: franja ámbar con lo que leyó.
    const dudosa = tarjeta("FLEXITALIC");
    assert.match(await dudosa.locator(".franja-revisar").innerText(), /Copilot leyó «704 6" NP FLEXITALIC» y no está seguro/);
    // El tipo según su existencia; la variante nueva, Consumible de fábrica.
    assert.equal(await tarjeta("6309-2Z/C3").getByRole("radio", { name: "Inventariable" }).getAttribute("aria-checked"), "true");
    assert.match(await tarjeta("6309-2Z/C3").locator(".nota-tipo").innerText(), /según su existencia/);
    assert.equal(await tarjeta("6311-2RS").getByRole("radio", { name: "Consumible" }).getAttribute("aria-checked"), "true");
    await chip("Por revisar").click();
    assert.equal(await page.locator(".tarjeta-entrada").count(), 1);
    await capturar("paso-2-filtro");
    await dudosa.getByRole("button", { name: "Está bien" }).click();
    // Sin nada por revisar, el filtro vuelve a «Todas».
    await page.waitForFunction(() => !document.querySelector(".franja-revisar") && document.querySelectorAll(".tarjeta-entrada").length === 3);
    assert.equal(await chip("Todas").getAttribute("aria-pressed"), "true");
    assert.equal(await chip("Por revisar").innerText(), "Por revisar · 0");
    await tarjeta("6311-2RS").getByRole("radio", { name: "Inventariable" }).click();
    // Buscador de dos campos: diésel (sin existencia) y una clave que vive en un solo contenedor.
    await page.locator("#buscar-material").fill("136");
    await page.locator("#buscar-material").press("Shift+Enter");
    await page.waitForFunction(() => document.activeElement?.id?.startsWith("cant-"));
    await page.keyboard.type("300");
    assert.match(await tarjeta("DIESEL").innerText(), /Sin existencia · no suma/);
    await page.locator("#buscar-material").fill("701");
    await page.locator("#buscar-material-dimension").fill("6205");
    await page.getByRole("button", { name: /^Agregar 701 6205-2Z/ }).click();
    await tarjeta("6205-2Z").locator("input[id^=cant-]").fill("1");
    await tarjeta("6205-2Z").locator("input[id^=lote-]").fill("J. PEREZ");
    await page.locator("#buscar-material").fill("");
    await capturar("paso-2");
    // Editar: la variante nueva con otro NP.
    await tarjeta("6311-2RS").getByRole("button", { name: /^Editar la partida/ }).click();
    const panel = page.getByRole("region", { name: /^Editando la partida 3/ });
    await panel.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "editar-dimension");
    assert.equal(await page.locator(".tarjeta-entrada.editando").count(), 1);
    assert.deepEqual(await panel.locator(".claves-lista li .clave-texto").allInnerTexts(), ["6309-2Z/C3", "6309-2Z/C3", "6205-2Z", "Se queda como 6311-2RS"]);
    await panel.getByLabel("NP", { exact: true }).fill("SKF");
    await capturar("paso-2-editar");
    await panel.getByRole("button", { name: "Listo" }).click();
    await panel.waitFor({ state: "detached" });
    await page.waitForFunction(() => [...document.querySelectorAll(".tarjeta-entrada .clave-entrada")].some((e) => /6311-2RS · NP SKF/.test(e.textContent)));
    // Cancelar · Esc deja la partida como estaba.
    await tarjeta("6309-2Z/C3").getByRole("button", { name: /^Editar la partida/ }).click();
    await page.waitForFunction(() => document.activeElement?.id === "editar-dimension");
    await page.getByLabel("Dimensión", { exact: true }).fill("OTRA");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".panel-editar-entrada"));
    assert.equal(await page.locator(".tarjeta-entrada", { hasText: "OTRA" }).count(), 0);
    const b = await esperar((e) => (e.borradores_entrada.find((x) => x.folio_externo === "B-500")?.lineas ?? []).some((l) => l.np === "SKF"), "No se guardaron las partidas");
    assert.equal(en(b.borradores_entrada.find((x) => x.folio_externo === "B-500").lineas), 5);
    const lineas = b.borradores_entrada.find((x) => x.folio_externo === "B-500").lineas;
    const nueva = lineas.find((l) => l.dimension === "6311-2RS");
    assert.deepEqual([nueva.np, nueva.clase, nueva.alta], ["SKF", "INV", true]);
    await page.getByRole("button", { name: /^Continuar a acomodo/ }).click();
    await page.waitForFunction(() => document.querySelector('ol[aria-label="Pasos de la entrada"] li[aria-current="step"]')?.textContent.includes("Acomodo"));
  });

  await t.test("paso 3: lo que vive en un solo contenedor llega acomodado (★); lo demás, contenedor por contenedor", async () => {
    const faltan = () => page.locator(".acomodo-izq > .lista-acomodo .fila-acomodo, .acomodo-izq > ul.lista-acomodo .fila-acomodo");
    assert.match(await page.locator(".acomodo-titulo").innerText(), /^Faltan por acomodar · 2/);
    assert.equal(await page.getByRole("button", { name: /^Revisar y registrar/ }).isDisabled(), true);
    assert.match(await page.locator(".avance-acomodo").innerText(), /2 de 4 acomodadas/);
    assert.match(await page.locator(".faltan-acomodo").innerText(), /BALEROS 6309-2Z\/C3 · BALEROS 6311-2RS/);
    assert.match(await page.locator(".pastillas-sin").innerText(), /300 LTS/);
    assert.match(await faltan().filter({ hasText: "6309-2Z/C3" }).innerText(), /Con existencia en #1 y #2/);
    await capturar("paso-3");
    // 2 = el segundo contenedor.
    await page.locator(".paso-acomodo").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("2");
    assert.equal(await page.getByRole("tab", { name: /Contenedor #2/ }).getAttribute("aria-selected"), "true");
    assert.match(await page.locator(".acomodo-titulo").innerText(), /¿Qué guardas en el contenedor #2\?/);
    await page.getByRole("checkbox", { name: /^6309-2Z\/C3/ }).check();
    await page.getByRole("checkbox", { name: /^6311-2RS NP SKF/ }).check();
    assert.match(await page.locator(".avance-acomodo").innerText(), /4 de 4 acomodadas/);
    assert.match(await page.locator(".todo-acomodado").innerText(), /Todo acomodado/);
    assert.match(await page.locator(".grupo-ya").innerText(), /Ya en el #2 · 2/);
    assert.match(await page.locator(".grupo-ya .fila-acomodo", { hasText: "6309-2Z/C3" }).innerText(), /★ ya tiene existencia aquí/);
    assert.match(await page.locator(".grupo-ya .fila-acomodo", { hasText: "6311-2RS" }).innerText(), /Partida nueva en esta hoja/);
    await capturar("paso-3-contenedor");
    // Desmarcar la regresa a «Faltan».
    await page.getByRole("checkbox", { name: /^6311-2RS NP SKF/ }).uncheck();
    assert.match(await page.locator(".avance-acomodo").innerText(), /3 de 4 acomodadas/);
    await page.getByRole("checkbox", { name: /^6311-2RS NP SKF/ }).check();
    await page.getByRole("button", { name: /^Revisar y registrar/ }).click();
    await page.waitForFunction(() => document.querySelector('ol[aria-label="Pasos de la entrada"] li[aria-current="step"]')?.textContent.includes("Revisar"));
  });

  await t.test("paso 4: dónde quedó cada partida y registrar", async () => {
    assert.deepEqual(await page.locator(".donde-quedo .chip-filtro-entrada").allInnerTexts(), ["Todos · 5", "#1 · 2", "#2 · 2", "Sin existencia · 1"]);
    assert.match(await page.locator(".fila-donde", { hasText: "6311-2RS" }).innerText(), /nueva → 2/);
    assert.match(await page.locator(".lista-antes").innerText(), /5 partidas con cantidad/);
    assert.match(await page.locator(".lista-antes").innerText(), /Todas acomodadas/);
    assert.match(await page.locator(".lista-antes").innerText(), /Lo que Copilot no tenía claro ya se revisó/);
    assert.match(await page.locator(".lista-antes").innerText(), /sin O\.C\. · se registran como S\/OC/);
    await capturar("paso-4");
    await page.locator(".donde-quedo .chip-filtro-entrada", { hasText: "#2" }).click();
    assert.equal(await page.locator(".fila-donde").count(), 2);
    await page.getByRole("button", { name: /^Registrar entrada · E-0005/ }).click();
    await page.getByText("✓ Entrada E-0005 registrada").waitFor();
    const e = await esperar((x) => x.vales.some((v) => v.tipo === "ENTRADA" && v.folio_externo === "B-500"), "No se registró la entrada");
    const vale = e.vales.find((v) => v.tipo === "ENTRADA" && v.folio_externo === "B-500");
    assert.equal("paso" in vale, false);
    assert.deepEqual([vale.folio, vale.origen, vale.lineas.length], [5, "BASE NORTE", 5]);
    const ubicacion = (l) => e.ubicaciones.find((u) => u.id === e.existencias.find((x) => x.id === l.existencia_id)?.ubicacion_id);
    const de = (clave) => vale.lineas.find((l) => l.clave === clave);
    assert.equal(ubicacion(de("6309-2Z/C3")).hoja_excel, "CONTENEDOR #2 INVENTARIABLE");
    assert.equal(ubicacion(de("6311-2RS")).hoja_excel, "CONTENEDOR #2 INVENTARIABLE");
    assert.equal(ubicacion(de("6205-2Z")).hoja_excel, "CONTENEDOR #1 INVENTARIABLE");
    assert.equal(e.variantes.find((v) => v.id === de("6311-2RS").variante_id).np, "SKF");
    assert.equal(vale.lineas.find((l) => l.codigo === 136).no_inventariado, true);
    assert.equal(e.borradores_entrada.length, 2);
  });

  await t.test("descartar desde la franja de borradores", async () => {
    await page.goto(`${origen}/#entradas`);
    await page.getByRole("tab", { name: /^Vale B-400/ }).click();
    await page.getByRole("button", { name: "Descartar borrador", exact: true }).click();
    await esperar((e) => e.borradores_entrada.length === 1, "No se descartó el borrador");
  });

  assert.deepEqual(errores, []);
  assert.deepEqual(externas, []);
});

/** Partidas capturadas de un borrador guardado. */
function en(lineas) {
  return lineas.filter((l) => Number.isInteger(l.codigo) || String(l.cantidad ?? "").trim()).length;
}
