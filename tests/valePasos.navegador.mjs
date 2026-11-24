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
import { Indices } from "../src/nucleo/estado.js";
import { confirmarEntrada, conRenglonExistente, entradaSinExistencia, lineaEntradaVacia, nuevoBorradorEntrada } from "../src/servicios/entradas.js";
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
  // Una entrada recibida hoy (para «Traer partidas de E-0001»): un balero a su partida y diésel sin existencia.
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const be = nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(be, { modo: "manual", folio_externo: "B-400", origen: "BASE PRUEBA" });
  be.lineas = [
    { ...conRenglonExistente(estado, lineaEntradaVacia(), balero.id, indices), cantidad: "4", oc: "OC-91" },
    { ...entradaSinExistencia({ ...lineaEntradaVacia(), codigo: 136, descripcion: "DIESEL", um: "LTS" }), cantidad: "300" },
  ];
  confirmarEntrada(estado, be.id, { usuario: USUARIO });
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
  const esperarPartidas = (n) => page.waitForFunction((n) => document.querySelectorAll(".partida-vale").length === n, n);
  const pasoActual = async () => (await page.locator('ol[aria-label="Pasos del vale"] li[aria-current="step"] .paso-nombre').innerText()).trim();
  const continuar = page.getByRole("button", { name: /^Continuar a material/ });
  const revisar = page.getByRole("button", { name: /^Revisar y emitir/ });
  // Capturas de lo que cambió, sin elementos encimados: nada se sale de su caja a lo ancho.
  const filtro = process.env.CAPTURAS_FILTRO ? new RegExp(process.env.CAPTURAS_FILTRO) : null;
  const capturar = async (nombre, anchos = ANCHOS, antes = null) => {
    const guardar = capturas && (!filtro || filtro.test(nombre));
    for (const ancho of anchos) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.waitForTimeout(250);
      // La ventana crece hasta lo que mide la página: lo fijo abajo (el pie del paso) queda donde se ve, no encima.
      if (guardar) for (let i = 0; i < 3; i++) {
        const alto = await page.evaluate(() => document.documentElement.scrollHeight);
        if (alto <= page.viewportSize().height) break;
        await page.setViewportSize({ width: ancho, height: alto });
        await page.waitForTimeout(150);
      }
      if (antes) await antes();
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
    // «2» (con el foco fuera de los campos) elige MECANICO y pasa al nombre, que trae a quien recibió en el vale más
    // reciente del área (Ronda 35: el folio 7, migrado, dice MECANICO UNOO).
    await page.locator("#paso-vale").focus();
    await page.keyboard.press("2");
    await page.getByRole("radio", { name: "MECANICO", checked: true }).waitFor();
    assert.equal(await page.getByText("Falta el área", { exact: true }).count(), 0);
    await page.waitForFunction(() => document.activeElement?.id === "quien-recibe");
    assert.equal(await nombre.inputValue(), "MECANICO UNOO");
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

  await t.test("paso 2: buscador fijo, resultados por código, agregar en ráfaga y Tab entre cantidades", async () => {
    const resumen = page.getByRole("region", { name: "Para quién" });
    assert.match(await resumen.innerText(), /MECANICO UNO/);
    assert.equal(await revisar.isDisabled(), true);
    await page.getByText("Busca un material a la izquierda para agregarlo.", { exact: true }).waitFor();
    const buscador = page.getByRole("combobox", { name: "Código o descripción", exact: true });
    await page.waitForFunction(() => document.activeElement?.id === "buscar-material");
    // Un clic en la fila solo la resalta; Enter agrega la resaltada con la cantidad vacía y el foco sigue en el buscador.
    await buscador.fill("706");
    await page.getByRole("group", { name: /^706 · SELLOS/ }).waitFor();
    await page.getByRole("option").first().click();
    assert.equal(await page.locator(".partida-vale").count(), 0, "un clic no agrega");
    await buscador.press("Enter");
    await page.locator(".partida-vale").first().waitFor();
    assert.equal(await page.getByLabel("Cantidad de la partida 1").inputValue(), "");
    await page.getByText("1 sin cantidad", { exact: true }).first().waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "buscar-material");
    // Shift + Enter agrega y lleva a su cantidad; el diésel no se inventaría: su unidad se escribe.
    await buscador.fill("136");
    await buscador.press("Shift+Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Cantidad de la partida 2");
    await page.keyboard.type("200");
    await page.getByLabel("Unidad de la partida 2").fill("LTS");
    assert.match(await page.locator(".partida-vale").nth(1).innerText(), /No inventariado/);
    // Tab / Shift+Tab van de cantidad en cantidad; Enter vuelve al buscador sin cambiar de paso.
    await page.getByLabel("Cantidad de la partida 2").focus();
    await page.keyboard.press("Shift+Tab");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Cantidad de la partida 1");
    await page.keyboard.type("1");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "buscar-material");
    assert.equal(await pasoActual(), "2 · Material");
    // Quitar con Deshacer.
    await buscador.fill("foco led");
    await page.getByRole("option").first().dblclick();
    await esperarPartidas(3);
    await page.getByRole("button", { name: "Quitar la partida 3", exact: true }).click();
    await esperarPartidas(2);
    await page.getByRole("button", { name: "↶ Deshacer", exact: true }).click();
    await esperarPartidas(3);
    await page.getByRole("button", { name: "Quitar la partida 3", exact: true }).click();
    await esperarPartidas(2);
    await cerrarAvisos();
    await buscador.fill("foco led");
    assert.equal(await revisar.isDisabled(), false);
    await capturar("paso-2");
    // Menos de 700 px: la lista se abre desde la barra de abajo, encima de los resultados.
    await capturar("paso-2-lista", [640], async () => {
      await page.getByRole("button", { name: /^2 partidas/ }).click();
      await page.getByRole("button", { name: "Cerrar la lista", exact: true }).waitFor();
    });
    await page.keyboard.press("Escape");
    // La página no se desplaza: solo los resultados y la lista tienen scroll.
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), "el paso 2 no debe desplazar la página");
    await buscador.fill("");
    await revisar.click();
    assert.equal(await pasoActual(), "3 · Revisar y emitir");
  });

  await t.test("paso 3: resumen, regresar sin perder nada, el paso se guarda y se emite", async () => {
    const material = page.getByRole("region", { name: "Material" });
    assert.match(await material.innerText(), /Material · 2 partidas/);
    assert.match(await material.innerText(), /SELLOS/);
    assert.equal(await page.locator(".pasos-vale li.paso-completo").count(), 2);
    await capturar("paso-3-listo");
    // Editar para quién → paso 1 con todo como estaba; las partidas siguen.
    await page.getByRole("button", { name: "Editar para quién", exact: true }).click();
    assert.equal(await pasoActual(), "1 · Para quién");
    await page.getByRole("radio", { name: "MECANICO", checked: true }).waitFor();
    await continuar.click();
    assert.equal(await page.getByLabel("Cantidad de la partida 1").inputValue(), "1");
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

  await t.test("paso 2: traer partidas, código nuevo, clave que no está y editar una partida desde un solo botón", async () => {
    await cerrarAvisos();
    const buscador = page.getByRole("combobox", { name: "Código o descripción", exact: true });
    // Lo recibido hoy se trae al vale abierto (no a uno nuevo), con sus cantidades.
    await page.getByRole("button", { name: "Traer partidas de E-0001 · hoy · 2", exact: true }).click();
    await esperarPartidas(2);
    await cerrarAvisos();
    let e = await esperar((x) => x.borradores[0]?.lineas.length === 2, "No se trajeron las partidas");
    assert.deepEqual(e.borradores[0].lineas.map((l) => [l.codigo, l.cantidad, l.oc]), [[701, "4", "OC-91"], [136, "300", ""]]);
    // Código que no está en el catálogo: se agrega «por confirmar» con la descripción escrita.
    await buscador.fill("1399 bomba sintetica");
    await page.getByRole("option", { name: /Agregar código 1399 · BOMBA SINTETICA/ }).waitFor();
    await buscador.press("Enter");
    await esperarPartidas(3);
    assert.equal(await page.getByLabel("Descripción del código nuevo 1399").inputValue(), "BOMBA SINTETICA");
    // Ronda 35: código o descripción en un campo y la dimensión en el otro. La que no existe se ofrece tal como se
    // escribió («Usar «…» en 701», al final de la tarjeta del código), con las claves que la traen arriba.
    const dimension = page.getByRole("combobox", { name: "Dimensión o NP", exact: true });
    await buscador.fill("balero");
    await dimension.fill("6309-2Z/C");
    const usar = page.getByRole("option", { name: /Usar «6309-2Z\/C» en 701/ });
    await usar.waitFor();
    const tarjeta = page.getByRole("group", { name: /^701 · BALEROS/ });
    assert.ok((await tarjeta.getByRole("option").count()) >= 2, "las claves que la traen y «Usar» en la misma tarjeta");
    await capturar("paso-2-clave-nueva");
    await usar.click();
    await esperarPartidas(4);
    assert.match(await page.locator(".partida-vale").nth(3).innerText(), /6309-2Z\/C[\s\S]*No descuenta/);
    assert.equal(await dimension.inputValue(), "", "la dimensión ya se usó; el código se queda");
    assert.equal(await buscador.inputValue(), "balero");
    // Con letras, espacios, comillas y diagonales: lo que ninguna clave trae se ofrece igual (antes se perdía).
    await buscador.fill("709");
    await dimension.fill('LED X 1/2" -B');
    await page.getByRole("option", { name: /Usar «LED X 1\/2" -B» en 709/ }).waitFor();
    // Una dimensión escrita en el primer campo: se ofrece pasarla al segundo.
    await dimension.fill("");
    await buscador.fill("6309");
    await page.getByRole("button", { name: /«6309» está como dimensión o NP en \d+ claves/ }).click();
    assert.deepEqual([await buscador.inputValue(), await dimension.inputValue()], ["", "6309"]);
    await page.getByRole("group", { name: /^701 · BALEROS/ }).waitFor();
    await dimension.fill("");
    // Un solo «Editar» para las partidas: se elige una y se edita a la izquierda; al terminar vuelve la búsqueda.
    await buscador.fill("foco led");
    await page.getByRole("button", { name: "Editar las partidas", exact: true }).click();
    await page.getByText("— elige en la lista la partida que quieres cambiar.", { exact: false }).waitFor();
    await page.getByRole("button", { name: /^Editar la partida 1:/ }).click();
    await page.getByText("Editando la partida 1", { exact: true }).waitFor();
    // Al abrir la edición el foco va al buscador de claves; se espera para no escribir mientras se mueve.
    await page.waitForFunction(() => document.activeElement?.id === "editar-material");
    await page.getByRole("textbox", { name: "Lote" }).fill("NUEVO");
    await page.getByRole("textbox", { name: "O.C." }).fill("OC-77");
    assert.equal(await page.getByText("Actual", { exact: true }).count(), 1);
    await capturar("paso-2-editar");
    const otras = page.getByRole("button", { name: /^Usar 701 / });
    assert.ok((await otras.count()) >= 1, "las otras claves del código");
    await otras.first().click();
    // Al usarla, el foco vuelve al código (en el siguiente cuadro): se espera para no escribir mientras se mueve.
    await page.waitForFunction(() => document.activeElement?.id === "editar-material");
    // Una clave escrita que no tiene el código, desde la edición (en «Dimensión o NP», con el código de la partida).
    assert.equal(await page.getByRole("combobox", { name: "Otro material · código o descripción", exact: true }).inputValue(), "701");
    await page.locator("#editar-material-dimension").fill("XYZ-9");
    await page.getByRole("option", { name: /Usar «XYZ-9» en 701/ }).click();
    await page.getByRole("button", { name: "Terminar · Esc", exact: true }).click();
    assert.equal(await buscador.inputValue(), "foco led", "vuelve la búsqueda de antes");
    await page.getByRole("group", { name: /^711 · FOCO LED/ }).waitFor();
    assert.match(await page.locator(".partida-vale").first().innerText(), /XYZ-9[\s\S]*Lote NUEVO · O\.C\. OC-77/);
    e = await esperar((x) => x.borradores[0]?.lineas[0]?.clave === "XYZ-9", "No se guardó la edición");
    const [primera] = e.borradores[0].lineas;
    assert.deepEqual([primera.cantidad, primera.lote, primera.oc, primera.existencia_id, primera.no_inventariado], ["4", "NUEVO", "OC-77", null, true]);
    await buscador.fill("");
    assert.deepEqual(errores, []);
  });

  await t.test("paso 3: lo que falta, ir a la partida, justificar ahí mismo, vista previa real y ampliada", async () => {
    await cerrarAvisos();
    await revisar.click();
    assert.equal(await pasoActual(), "3 · Revisar y emitir");
    const emitirBoton = page.locator(".emitir-fijo").getByRole("button", { name: /^Emitir vale · folio/ });
    // Ronda 35: sin lista aparte arriba; lo que falta se marca en ámbar en la fila de su partida, con su botón.
    await page.getByText("Faltan 3 cosas: están marcadas en ámbar.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("region", { name: /antes de emitir/ }).count(), 0);
    const material = page.getByRole("region", { name: "Material" });
    const bomba = material.locator("li.con-pendiente", { hasText: "BOMBA SINTETICA" });
    assert.match(await bomba.innerText(), /Falta la cantidad\./);
    assert.match(await bomba.innerText(), /Falta la unidad \(UM\)\./);
    assert.equal(await material.getByText("3 por resolver", { exact: true }).count(), 1);
    assert.equal(await emitirBoton.isDisabled(), true);
    // Cantidad · código y descripción · dimensión; Lote y O.C. con su nombre junto a la dimensión, solo si tienen algo.
    assert.deepEqual(await material.locator(".resumen-encabezado span").allInnerTexts().then((t) => t.map((x) => x.trim().toUpperCase())), ["CANTIDAD", "CÓDIGO Y DESCRIPCIÓN", "DIMENSIÓN"]);
    assert.match(await material.innerText(), /Lote: NUEVO/);
    assert.match(await material.innerText(), /O\.C\.: OC-77/);
    assert.doesNotMatch(await material.innerText(), /sin lote/);
    await page.locator(".miniatura-vale .vale-pagina").first().waitFor();
    await capturar("paso-3-pendiente");
    // «Ir a la partida» lleva a su cantidad en el paso 2.
    await bomba.getByRole("button", { name: "Ir a la partida", exact: true }).click();
    assert.equal(await pasoActual(), "2 · Material");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Cantidad de la partida 3");
    await page.keyboard.type("2");
    await page.getByLabel("Unidad de la partida 3").fill("PZA");
    await page.getByLabel("Cantidad de la partida 4").fill("1");
    // Más de lo que hay (Ronda 35, pedido del usuario): la justificación se escribe en el paso 2, debajo de la partida;
    // Tab desde la cantidad entra a ella.
    const buscador = page.getByRole("combobox", { name: "Código o descripción", exact: true });
    await buscador.fill("706");
    await buscador.press("Shift+Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Cantidad de la partida 5");
    await page.keyboard.type("5");
    const partida5 = page.locator(".partida-vale").nth(4);
    const campoPaso2 = partida5.getByRole("textbox", { name: /^Solo hay \d+ PZA\. ¿Por qué sacas más\?/ });
    await campoPaso2.waitFor();
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.activeElement?.id?.startsWith("just-"));
    await buscador.fill("");
    await revisar.click();
    // En el paso 3 solo se avisa en su fila, con «Ir a la partida», que lleva al campo del paso 2.
    const sellos = page.getByRole("region", { name: "Material" }).locator(".resumen-partidas > li", { hasText: "SELLOS" }).last();
    assert.match(await sellos.innerText(), /Sacas 5 y el inventario dice que hay \d+: falta escribir por qué\./);
    assert.equal(await sellos.getByRole("textbox").count(), 0, "en el resumen ya no hay campo");
    assert.equal(await emitirBoton.isDisabled(), true);
    await page.getByText("Falta 1 cosa: está marcada en ámbar.", { exact: true }).waitFor();
    await sellos.getByRole("button", { name: "Ir a la partida", exact: true }).click();
    assert.equal(await pasoActual(), "2 · Material");
    await page.waitForFunction(() => document.activeElement?.id?.startsWith("just-"));
    await page.keyboard.type("PRESTAMO SINTETICO");
    await revisar.click();
    await page.getByText("Al emitir se asigna el folio; después lo imprimes.", { exact: true }).waitFor();
    assert.equal(await emitirBoton.isDisabled(), false);
    assert.match(await sellos.innerText(), /Justificación: PRESTAMO SINTETICO/);
    // La miniatura es el vale impreso real, con BORRADOR en el folio.
    assert.match(await page.locator(".miniatura-vale").innerText(), /BORRADOR/);
    await capturar("paso-3");
    // Vista ampliada: zoom, ajustar al ancho y Emitir siempre a la vista.
    await page.getByRole("button", { name: "Ampliar", exact: true }).click();
    const ampliada = page.getByRole("dialog", { name: "Así saldrá impreso" });
    await ampliada.waitFor();
    await ampliada.getByText("100 %", { exact: true }).waitFor();
    await ampliada.getByRole("button", { name: "Acercar", exact: true }).click();
    await ampliada.getByText("125 %", { exact: true }).waitFor();
    await page.keyboard.press("Control+-");
    await ampliada.getByText("100 %", { exact: true }).waitFor();
    await ampliada.getByText("✓ Todo listo", { exact: true }).waitFor();
    await capturar("paso-3-ampliada");
    await page.keyboard.press("Escape");
    await ampliada.waitFor({ state: "detached" });
    await page.locator(".miniatura-vale").click();
    const e0 = await leer();
    const siguiente = Math.max(...e0.vales.filter((v) => v.tipo === "SALIDA").map((v) => v.folio)) + 1;
    await ampliada.getByRole("button", { name: `Emitir vale · folio ${siguiente}`, exact: true }).click();
    await page.getByText(`✓ Vale ${siguiente} emitido`, { exact: true }).waitFor();
    const e = await esperar((x) => x.vales.some((v) => v.tipo === "SALIDA" && v.folio === siguiente), "No se emitió desde la vista ampliada");
    const vale = e.vales.find((v) => v.tipo === "SALIDA" && v.folio === siguiente);
    assert.equal(vale.lineas.length, 5);
    assert.equal(vale.lineas[4].justificacion, "PRESTAMO SINTETICO");
    assert.ok(e.articulos[1399], "el código nuevo quedó dado de alta");
    assert.deepEqual(errores, []);
  });

  await t.test("paso 1: transferencia (destino, quién transporta y quién autoriza) y NOV con sus firmas extra", async () => {
    await cerrarAvisos();
    await page.getByRole("button", { name: "＋ Nuevo vale", exact: true }).click();
    await page.getByRole("radio", { name: "Transferencia", exact: true }).click();
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
