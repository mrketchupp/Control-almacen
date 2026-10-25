import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { conFirmasPorPapel } from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

test("el historial permite completar, modificar y borrar el puesto de entrega en vales importados", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const html = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-puestos-historial-"));
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

  for (const nov of [false, true]) await t.test(nov ? "la firma del almacén a la derecha conserva su papel y permite quitar el puesto" : "el puesto antiguo se guarda y reaparece sin afectar al usuario en turno", async () => {
    const { estado } = cargaSintetica(), vale = estado.vales[0], id = vale.id;
    estado.config.usuario_en_turno = "ALMACENISTA DOS";
    if (nov) Object.assign(vale, { depto_destino: "NOV ENERGY", entrego_nombre: "QUIMICO UNO", entrego_puesto: "QUIMICO", recibio_nombre: "ALMACENISTA UNO", recibio_puesto: null,
      autorizo_nombre: "AUTORIZADOR UNO", autorizo_puesto: null, firma_extra_izq_nombre: "PERSONAL NOV UNO", firma_extra_izq_puesto: null, firma_extra_der_nombre: "PATRIMONIAL UNO", firma_extra_der_puesto: null });
    const lineas = JSON.stringify(vale.lineas), personas = JSON.stringify(estado.personas), config = JSON.stringify(estado.config);
    const otros = JSON.stringify(estado.vales.slice(1));
    const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar();
    await almacen.cargarPrimeraVez(estado, [
      { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errores = [], externas = [];
    page.on("pageerror", (e) => errores.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
    page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origen)) externas.push(r.url()); });
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open("control-almacen", 1);
        q.onupgradeneeded = () => { for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined); };
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["estado", "archivos"], "readwrite"); tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    }, fixture);
    const leer = () => page.evaluate(() => new Promise((resolve, reject) => {
      const q = indexedDB.open("control-almacen", 1);
      q.onsuccess = () => { const db = q.result, r = db.transaction("estado").objectStore("estado").get("actual"); r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error); };
      q.onerror = () => reject(q.error);
    }));
    await page.goto(`${origen}/#vale/${id}`);
    for (const puesto of ["RESPONSABLE SINTETICO", "ENCARGADO SINTETICO", ""]) {
      await page.getByRole("button", { name: "Corregir", exact: true }).click();
      const campo = page.getByRole("combobox", { name: "Puesto de quien entrega", exact: true });
      await campo.fill(puesto);
      if (nov && puesto === "RESPONSABLE SINTETICO") {
        await page.getByRole("combobox", { name: "Puesto de quien autoriza", exact: true }).fill("SUPERVISOR SINTETICO");
        const firmas = page.locator('[data-bloque="firmas_extra"]');
        const puestos = firmas.getByRole("combobox", { name: /^Puesto \(/ });
        assert.equal(await puestos.count(), 2);
        await puestos.nth(0).fill("TECNICO SINTETICO");
        await puestos.nth(1).fill("SEGURIDAD SINTETICA");
      }
      if (puesto) assert.match(await page.locator(".datos-automaticos dd").first().innerText(), new RegExp(puesto));
      await page.getByRole("button", { name: "Guardar corrección", exact: true }).click();
      await page.getByRole("button", { name: "Corregir", exact: true }).waitFor();
      const guardado = await leer(), actual = guardado.vales.find((v) => v.id === id);
      assert.equal(conFirmasPorPapel(guardado, actual).entrego_puesto, puesto || null);
      if (nov) assert.deepEqual([actual.autorizo_puesto, actual.firma_extra_izq_puesto, actual.firma_extra_der_puesto], ["SUPERVISOR SINTETICO", "TECNICO SINTETICO", "SEGURIDAD SINTETICA"]);
      assert.equal(JSON.stringify(actual.lineas), lineas);
      assert.equal(JSON.stringify(guardado.vales.slice(1)), otros);
      assert.equal(JSON.stringify(guardado.personas), personas);
      assert.equal(JSON.stringify(guardado.config), config);
      await page.reload();
      await page.getByRole("button", { name: "Corregir", exact: true }).click();
      assert.equal(await campo.inputValue(), puesto);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
    assert.deepEqual(errores, []); assert.deepEqual(externas, []);
    await context.close();
  });
});
