// Conteo de auditoría en el HTML autónomo (Chromium), Ronda 24: unir las hojas del Kardex con su inventario,
// revisar e imprimir las listas, reemplazar lo inventariable en DLTA y luego en GSM (FX dentro) sin volver a
// cargarlo, anotar el NP con el lápiz del inventario y elegir la hoja en Conciliación AX.
// Datos SINTÉTICOS (tests/fixtures/generar.py).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { bytesInventario, bytesInventarioGsm, bytesVales, cargaSintetica, cargaSinteticaGsm, fixtures } from "./ayuda.js";

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
    const gsm = inventario === "GSM";
    const { estado } = gsm ? cargaSinteticaGsm() : cargaSintetica({ idInventario: inventario });
    estado.config.usuario_en_turno = "ALMACENISTA UNO";
    await almacen.cargarPrimeraVez(estado, [
      gsm ? { tipo: "INVENTARIO", nombre: "INVENTARIO GSM SINTETICO.xlsx", datos: bytesInventarioGsm() } : { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
      { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
    ]);
    return { estado: structuredClone(almacen.estado), archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  }

  const BD = { DLTA: "control-almacen", GSM: "control-almacen-gsm" };

  /** Abre la herramienta en `inventario` con los dos inventarios ya cargados (para cambiar en la misma pestaña). */
  async function abrir(inventario, hash) {
    const preparados = { DLTA: await preparado("DLTA"), GSM: await preparado("GSM") };
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
    await page.addInitScript(() => {
      window.__impresiones = [];
      window.print = () => {
        window.__impresiones.push(document.querySelector("#area-impresion")?.innerHTML ?? "");
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    await page.goto(origen + "/blank");
    await page.evaluate(
      async ({ preparados, BD, inventario }) => {
        localStorage.setItem("control-almacen:inventario", inventario);
        for (const [id, f] of Object.entries(preparados)) {
          const db = await new Promise((resolve, reject) => {
            const q = indexedDB.open(BD[id], 1);
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
        }
      },
      { preparados, BD, inventario },
    );
    await page.goto(origen + hash);
    await page.locator(".navegacion").waitFor();
    const leer = (id = inventario) =>
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
        BD[id],
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
    await ventana.locator(".relacionar").waitFor();
    return ventana;
  };
  const unir = async (ventana, inventario, hoja) => {
    await ventana.locator(`.relacionar-item[data-lado="izq"][data-id="${inventario}"]`).click();
    await ventana.locator('.relacionar-item[data-lado="der"]', { hasText: hoja }).click();
  };

  await t.test("DLTA y luego GSM con el mismo Kardex: unir hojas, revisar, imprimir las listas y aplicar", async () => {
    const { page, leer, terminar } = await abrir("DLTA", "/#conteo");
    const ventana = await cargarKardex(page);
    assert.match(await ventana.innerText(), /Une la hoja de DLTA/);
    // Unir y separar: tocar otra vez la misma pareja la deshace.
    await unir(ventana, "DLTA", "PRINCIPAL");
    await ventana.locator(".cifras-auditoria").waitFor();
    await unir(ventana, "DLTA", "PRINCIPAL");
    await ventana.locator(".cifras-auditoria").waitFor({ state: "detached" });
    await unir(ventana, "DLTA", "PRINCIPAL");
    await unir(ventana, "GSM", "GSM");
    await unir(ventana, "FX", "FX");
    assert.equal(await ventana.locator(".relacionar-lineas path").count(), 3);
    assert.match(await ventana.locator('.relacionar-item[data-lado="der"]', { hasText: "PRINCIPAL" }).innerText(), /→ DLTA/);

    const aplicar = ventana.getByRole("button", { name: "Reemplazar lo inventariable de DLTA" });
    assert.equal(await aplicar.isEnabled(), false); // el 709: el conteo anotó un contenedor que no existe
    await elegir(page, ventana.locator("tr", { hasText: "CABLE 3/4" }).locator(".lista"), "CONTENEDOR #2 INVENTARIABLE");
    assert.equal(await aplicar.isEnabled(), true);
    // Las listas se imprimen antes de aplicar.
    const np = ventana.locator(".detalles", { hasText: "NP que se pierden" });
    await np.locator("summary").click();
    await np.getByRole("button", { name: /Imprimir la lista/ }).click();
    await page.waitForFunction(() => window.__impresiones.length === 1);
    const impreso = await page.evaluate(() => window.__impresiones[0]);
    assert.match(impreso, /NP que se perdieron · DLTA/);
    assert.match(impreso, /LED 20W/);
    await aplicar.click();
    await page.locator(".toast", { hasText: "DLTA quedó como el Kardex" }).waitFor();
    const dlta = await leer("DLTA");
    const conteo = dlta.conteos.find((c) => c.tipo === "AUDITORIA");
    assert.equal(conteo.fecha, "2026-10-26");
    assert.deepEqual(conteo.revision.np.map((r) => r.np).sort(), ["LED 20W", "LED 50W", "X100"]);
    assert.ok(conteo.revision.retiradas.length > 0);
    // El mismo Kardex queda como reporte de AX con la fecha del conteo (sin importarlo otra vez).
    assert.deepEqual(dlta.cortes_ax.map((c) => [c.fecha, c.hoja]), [["2026-10-26", "PRINCIPAL"]]);

    // El Kardex y las parejas se quedan: GSM se aplica sin volver a cargarlo.
    await ventana.getByRole("button", { name: "Ir a GSM para aplicar GSM y FX" }).click();
    await page.locator('html[data-inventario="GSM"]').waitFor();
    const enGsm = page.locator(".ventana-concilia");
    await enGsm.locator(".cifras-auditoria").waitFor();
    assert.match(await enGsm.locator(".cifras-auditoria").innerText(), /de FX/);
    await enGsm.getByRole("button", { name: "Reemplazar lo inventariable de GSM" }).click();
    await page.locator(".toast", { hasText: "GSM quedó como el Kardex" }).waitFor();
    const gsm = await leer("GSM");
    const fx = gsm.existencias.filter((e) => e.activo !== false && e.dueno === "FX").map((e) => gsm.variantes.find((v) => v.id === e.variante_id).codigo);
    assert.deepEqual(fx.sort(), [1701, 1703, 1707, 1742]);
    assert.deepEqual(gsm.cortes_ax.map((c) => [c.fecha, c.hoja]), [["2026-10-26", "GSM"]]);
    assert.equal(await enGsm.getByRole("button", { name: /Ir a DLTA/ }).count(), 0); // DLTA ya se aplicó
    await enGsm.getByRole("button", { name: "Cerrar" }).first().click();

    // Las listas quedan en Conteo físico para imprimirlas después.
    await page.locator(".tarjeta", { hasText: "Listas de revisión de la auditoría" }).waitFor();

    // FX en el inventario y su libro aparte.
    await page.goto(origen + "/#inventario");
    await page.locator(".pastilla-fx").first().waitFor();
    assert.equal(await page.locator(".pastilla-fx").count(), 4);
    await page.locator(".segmento", { hasText: "FX" }).click();
    assert.match(await page.locator(".filtros .conteo").innerText(), /^4 de/);
    await page.goto(origen + "/#reporte");
    await page.locator(".archivos-dia", { hasText: "Inventario de FX" }).waitFor();
    await terminar();
  });

  await t.test("Inventario: el NP se anota con el lápiz y sugiere los que se perdieron en la auditoría", async () => {
    const { page, leer, terminar } = await abrir("DLTA", "/#conteo");
    const ventana = await cargarKardex(page);
    await unir(ventana, "DLTA", "PRINCIPAL");
    await elegir(page, ventana.locator("tr", { hasText: "CABLE 3/4" }).locator(".lista"), "CONTENEDOR #2 INVENTARIABLE");
    await ventana.getByRole("button", { name: "Reemplazar lo inventariable de DLTA" }).click();
    await page.locator(".toast", { hasText: "DLTA quedó como el Kardex" }).waitFor();
    await ventana.getByRole("button", { name: "Cerrar" }).first().click();
    await page.goto(origen + "/#inventario");
    await page.locator("input.buscador").fill("711");
    const fila = page.locator("tbody tr", { hasText: "711" }).filter({ hasNotText: "MOD:A1" });
    await fila.getByRole("button", { name: /Anotar el NP de 711/ }).click();
    const editor = page.getByRole("dialog", { name: "Anotar el NP" });
    await editor.getByRole("button", { name: "LED 50W" }).click();
    await editor.getByRole("button", { name: "Guardar" }).click();
    await page.locator(".toast", { hasText: "711 quedó como" }).waitFor();
    const estado = await leer();
    const conNp = estado.existencias.filter((e) => e.activo !== false).map((e) => estado.variantes.find((v) => v.id === e.variante_id)).filter((v) => v.codigo === 711 && v.np === "LED 50W");
    assert.equal(conNp.length, 1);
    await terminar();
  });

  await t.test("Conciliación AX: propone la hoja del inventario y deja elegir otra sin preguntar", async () => {
    const { page, terminar } = await abrir("DLTA", "/#conciliacion");
    await page.locator("input[type=file][accept='.xlsx']").first().setInputFiles(fixtures.kardex);
    const ventana = page.getByRole("dialog", { name: "Importar reporte de AX" });
    await ventana.waitFor();
    assert.match(await ventana.locator(".lista-boton").first().innerText(), /PRINCIPAL/);
    const importar = ventana.getByRole("button", { name: "Importar corte" });
    assert.equal(await importar.isEnabled(), true);
    await elegir(page, ventana.locator(".lista").first(), "FX");
    assert.equal(await ventana.locator(".aviso-advertencia").count(), 0);
    assert.equal(await importar.isEnabled(), true);
    await terminar();
  });
});
