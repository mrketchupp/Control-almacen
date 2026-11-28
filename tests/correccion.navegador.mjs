// Ronda 39, etapa 6 en Chromium (docs/14 §8): corregir abre en la revisión, «Editar» abre el paso en modo corrección
// (su botón dice «Listo»), lo que cambió se marca en ámbar, *Cambios · N* lleva el motivo, el efecto en el inventario y
// Guardar / Cancelar; sin cambios no se guarda; un vale migrado muestra sus partidas sin ligar en gris. Con
// CAPTURAS=<carpeta> guarda las capturas a 1440, 1024, 768 y 640 px.
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
import { emitirBorrador, lineaDesdeExistencia, nuevoBorrador } from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const ANCHOS = [1440, 1024, 768, 640];

test("corrección en la revisión", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "correccion-"));
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

  // Un vale de salida de hoy (FILTROS, 4 PZA) y una entrada (FILTROS, 2 PZA); el vale 1 es migrado del Excel.
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
  const { estado } = cargaSintetica(); estado.config.usuario_en_turno = USUARIO;
  const indices = new Indices(estado);
  const filtros = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 702);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const b = nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id });
  b.lineas.push({ ...lineaDesdeExistencia(estado, filtros.id), cantidad: "4" });
  const [salida] = emitirBorrador(estado, b.id, { usuario: USUARIO });
  const be = nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-01", fechaRecibido: "2026-10-02" });
  Object.assign(be, { folio_externo: "B-9", origen: "BASE PRUEBA" });
  be.lineas = [{ ...conRenglonExistente(estado, lineaEntradaVacia(), filtros.id, indices), cantidad: "2" }];
  const entrada = confirmarEntrada(estado, be.id, { usuario: USUARIO });
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };

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
  const revisarMarco = (donde) => page.evaluate((donde) => {
    const caja = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const cabecera = caja(".cabecera"), mas = caja(".navegacion .nav-boton-mas");
    const area = document.querySelector(".cuerpo > main.contenido");
    const problemas = [];
    if (document.documentElement.scrollHeight > innerHeight + 1) problemas.push("la página se desplaza");
    if (!cabecera || Math.round(cabecera.top) !== 0) problemas.push("la cabecera no se ve");
    if (!mas || mas.bottom > innerHeight + 1) problemas.push("«Ajustes y más» no se ve");
    if (area && area.scrollWidth > area.clientWidth + 1) problemas.push(`el área de trabajo se sale ${area.scrollWidth - area.clientWidth} px a lo ancho`);
    return problemas.length ? `${donde}: ${problemas.join("; ")}` : null;
  }, donde);
  const capturar = async (nombre) => {
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 900 });
      await page.waitForTimeout(250);
      if (capturas) for (let i = 0; i < 3; i++) {
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
  const guardar = page.locator(".tarjeta-cambios").getByRole("button", { name: "Guardar", exact: true });

  await t.test("salida: sin cambios no se guarda; la cantidad nueva en ámbar con la anterior tachada y lo que regresa", async () => {
    await page.goto(`${origen}/#vale/${salida.id}`);
    await page.getByRole("button", { name: "Corregir", exact: true }).click();
    await page.getByText(`Corrigiendo el vale ${salida.folio}`, { exact: true }).waitFor();
    assert.equal(await page.locator(".tarjeta-cambios h2").innerText(), "Cambios · 0");
    assert.match(await page.locator(".tarjeta-cambios").innerText(), /No has cambiado nada/);
    assert.equal(await guardar.isDisabled(), true);
    await page.getByRole("button", { name: "Editar material", exact: true }).click();
    const cantidad = page.getByRole("textbox", { name: "Cantidad de la partida 1", exact: true });
    await cantidad.fill("3");
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    await page.locator(".tarjeta-cambios").waitFor();
    assert.equal(await page.locator(".tarjeta-cambios h2").innerText(), "Cambios · 1");
    assert.match(await page.locator(".partida-cambiada").innerText(), /3 PZA\s*4 PZA/);
    assert.equal(await page.locator(".partida-cambiada del").innerText(), "4 PZA");
    assert.match(await page.locator(".efectos-cambios").innerText(), /Regresa 1 PZA a #1 Cons\. \(queda \d+\)/);
    assert.match(await page.getByRole("textbox", { name: "Motivo de la corrección", exact: true }).inputValue(), /cantidad 4 PZA → 3 PZA/);
    await capturar("correccion-salida");
    // Editar *Para quién* y volver con «Listo» no borra lo de *Material*.
    await page.getByRole("button", { name: "Editar para quién", exact: true }).click();
    await page.getByRole("combobox", { name: "Puesto (quién lo lleva)", exact: true }).fill("SOLDADOR");
    await capturar("correccion-salida-para-quien");
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    assert.equal(await page.locator(".tarjeta-cambios h2").innerText(), "Cambios · 2");
    assert.equal(await page.locator(".resumen-vale .dato-cambiado").count(), 1);
    await guardar.click();
    await page.getByRole("button", { name: "Corregir", exact: true }).waitFor();
    const e = await esperar((x) => x.vales.find((v) => v.id === salida.id)?.lineas[0].cantidad === "3", "No se guardó la corrección");
    const vale = e.vales.find((v) => v.id === salida.id);
    assert.equal(vale.recibio_puesto, "SOLDADOR");
    assert.ok(e.auditoria.some((a) => a.entidad === "vale" && String(a.entidad_id) === String(vale.id) && a.accion === "CORREGIR"));
  });

  await t.test("entrada: De dónde viene, Material y Dónde quedó cada partida; mover de contenedor resta de uno y crea la otra", async () => {
    await page.goto(`${origen}/#entrada/${entrada.id}`);
    await page.getByRole("button", { name: "Corregir", exact: true }).click();
    await page.getByText("Corrigiendo la entrada E-0001", { exact: true }).waitFor();
    assert.deepEqual(await page.locator(".correccion-secciones h2").allInnerTexts(), ["De dónde viene", "Material · 1 partida", "Dónde quedó cada partida"]);
    await page.getByRole("button", { name: "Editar de dónde viene", exact: true }).click();
    await page.locator("#folio-base").fill("B-10");
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    assert.equal(await page.locator(".resumen-origen .dato-cambiado").count(), 1);
    // Para moverla: se desmarca en su contenedor (vuelve a «Faltan») y se marca en el otro.
    await page.getByRole("button", { name: "Editar acomodo", exact: true }).click();
    const casilla = page.getByRole("checkbox", { name: /^P551317/ });
    await page.getByRole("tab", { name: /Contenedor #1/ }).click();
    await casilla.uncheck();
    await page.getByRole("tab", { name: /Contenedor #2/ }).click();
    await casilla.check();
    await page.getByRole("button", { name: "Listo", exact: true }).click();
    assert.match(await page.locator(".efectos-cambios").innerText(), /Resta 2 PZA a #1 Cons\.[\s\S]*Partida nueva en #2 Cons\.: 2 PZA/);
    assert.match(await page.locator(".fila-donde.cambiada").innerText(), /nueva → 2/);
    await capturar("correccion-entrada");
    await guardar.click();
    await page.getByRole("button", { name: "Corregir", exact: true }).waitFor();
    const e = await esperar((x) => x.vales.find((v) => v.id === entrada.id)?.folio_externo === "B-10", "No se guardó la corrección de la entrada");
    const linea = e.vales.find((v) => v.id === entrada.id).lineas[0];
    assert.equal(e.ubicaciones.find((u) => u.id === e.existencias.find((x) => x.id === linea.existencia_id).ubicacion_id).hoja_excel, "CONTENEDOR #2 CONSUMIBLE");
  });

  await t.test("vale migrado: las partidas sin ligar en gris y la nota de que solo cambia el historial", async () => {
    await page.goto(`${origen}/#vale/1`);
    await page.getByRole("button", { name: "Corregir", exact: true }).click();
    await page.getByText("Corrigiendo el vale 1", { exact: true }).waitFor();
    assert.match(await page.locator(".nota-correccion").innerText(), /solo cambia el historial y el DIARIO/);
    assert.ok(await page.locator(".partida-sin-ligar").count() > 0);
    assert.match(await page.locator(".partida-sin-ligar").first().innerText(), /sin ligar al inventario · anterior al conteo/);
    assert.equal(await page.locator(".resumen-partidas .falta").count(), 0);
    await capturar("correccion-migrado");
    await page.locator(".tarjeta-cambios").getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Corregir", exact: true }).waitFor();
  });

  assert.deepEqual(errores, []);
  assert.deepEqual(externas, []);
});
