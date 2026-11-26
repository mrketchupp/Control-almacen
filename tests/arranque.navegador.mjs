// Ronda 36 (fallo reportado: tras un corte de luz se quedaba en «Cargando…» y la otra ventana decía «ya está
// abierta» sin salida). En Chromium, con datos SINTÉTICOS:
//   · una carpeta de trabajo que no responde (OneDrive) ya no detiene la apertura: el respaldo del día va después;
//   · si la base no responde, la carga dice el paso y ofrece Recargar / Restaurar un respaldo…; el rescate restaura;
//   · «ya está abierta» → Abrir aquí: la otra ventana deja de guardar; «Usar esta ventana» la recupera;
//   · rescate con la base sana: copia de lo que había en Descargas y aviso de los folios que se perderían.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { crearRespaldo } from "../src/almacen/respaldos.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const CAPTURAS = process.env.CAPTURAS;

/** Cuelga lo que el arranque lee, según banderas en localStorage (así la prueba las quita cuando quiere). */
function colgar() {
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (clave) {
    if (this.name === "estado" && clave === "actual" && localStorage.getItem("prueba:colgar-base") === "1") {
      return { result: undefined, error: null }; // nunca responde
    }
    if (this.name === "ajustes" && clave === "carpeta" && localStorage.getItem("prueba:carpeta") === "1") {
      const peticion = { result: undefined, error: null, onerror: null };
      let alListo = null;
      Object.defineProperty(peticion, "onsuccess", { set: (f) => (alListo = f), get: () => alListo });
      navigator.storage.getDirectory().then((r) => r.getDirectoryHandle("TRABAJO", { create: true })).then((h) => {
        peticion.result = h;
        alListo?.();
      });
      return peticion;
    }
    return get.call(this, clave);
  };
  // Edge no muestra su aviso de permiso (OneDrive sin responder): requestPermission nunca responde, o responde tarde.
  if (localStorage.getItem("prueba:permiso-colgado") === "1") {
    const tarde = Number(localStorage.getItem("prueba:permiso-tarde-ms") || 0);
    FileSystemHandle.prototype.queryPermission = async function () {
      return this.__concedido ? "granted" : "prompt";
    };
    FileSystemHandle.prototype.requestPermission = function () {
      if (!tarde) return new Promise(() => {});
      return new Promise((r) => setTimeout(() => {
        this.__concedido = true;
        r("granted");
      }, tarde));
    };
  }
  if (localStorage.getItem("prueba:carpeta-no-lista") === "1") {
    const nunca = () => new Promise(() => {});
    FileSystemDirectoryHandle.prototype.entries = function () {
      return { [Symbol.asyncIterator]: () => ({ next: nunca }) };
    };
  }
}

test("arranque: nada lo deja en «Cargando…» y siempre hay salida", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const documento = await readFile(new URL("../dist/ControlAlmacen.html", import.meta.url));
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-arranque-"));
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

  // Datos sintéticos y un respaldo «de ayer» sin los dos últimos vales de salida.
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  const { estado } = cargaSintetica();
  estado.config.usuario_en_turno = "ALMACENISTA UNO";
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const fixture = { estado: almacen.estado, archivos: [...almacen.backend.archivos.values()].map((a) => ({ ...a, datos: [...a.datos] })) };
  const salidas = almacen.estado.vales.filter((v) => v.tipo === "SALIDA").map((v) => v.folio).sort((a, b) => b - a);
  const [ultima, , penultimaRespaldo] = salidas;
  const anterior = structuredClone(almacen.estado);
  anterior.vales = anterior.vales.filter((v) => !(v.tipo === "SALIDA" && v.folio > penultimaRespaldo));
  const respaldo = crearRespaldo(anterior, await almacen.plantillasDelEstado(anterior), { motivo: "inicio", ahora: "2026-11-25T08:00:00" });
  const archivoRespaldo = join(carpeta, respaldo.nombre);
  await writeFile(archivoRespaldo, respaldo.datos);

  const context = await browser.newContext({ viewport: { width: 1100, height: 820 }, acceptDownloads: true });
  await context.addInitScript(colgar);
  const errores = [];
  const nueva = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errores.push(e.message));
    return page;
  };
  const page = await nueva();
  await page.goto(origen + "/blank");
  // Cada caso parte de una página en blanco (suelta el candado y la base) con los datos de la fixture.
  const cargarFixture = async () => {
    await page.goto(origen + "/blank");
    await page.evaluate(async (f) => {
      await new Promise((r) => {
        const q = indexedDB.deleteDatabase("control-almacen");
        q.onsuccess = q.onerror = q.onblocked = r;
      });
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open("control-almacen", 1);
        q.onupgradeneeded = () => {
          for (const s of ["estado", "archivos", "ajustes", "instantaneas"]) q.result.createObjectStore(s, s === "instantaneas" ? { autoIncrement: true } : undefined);
        };
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["estado", "archivos", "ajustes"], "readwrite");
        tx.objectStore("estado").put(f.estado, "actual");
        for (const a of f.archivos) tx.objectStore("archivos").put({ ...a, datos: new Uint8Array(a.datos) }, a.clave);
        tx.objectStore("ajustes").put({ fecha_hora: "2026-11-20T08:00:00", destino: "x", nombre: "x.zip" }, "ultimo_respaldo");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, fixture);
  };
  const banderas = (b) => page.evaluate((b) => {
    for (const [k, v] of Object.entries(b)) v ? localStorage.setItem(`prueba:${k}`, "1") : localStorage.removeItem(`prueba:${k}`);
  }, b);
  const ultimaSalidaGuardada = (p = page) =>
    p.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open("control-almacen", 1);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      const estado = await new Promise((resolve) => {
        const q = db.transaction("estado").objectStore("estado").openCursor();
        q.onsuccess = () => resolve(q.result?.value);
      });
      db.close();
      return Math.max(...estado.vales.filter((v) => v.tipo === "SALIDA").map((v) => v.folio));
    });

  await t.test("la carpeta de trabajo no responde (OneDrive tras un apagón): abre igual y el respaldo del día va después", async () => {
    await cargarFixture();
    await banderas({ carpeta: true, "carpeta-no-lista": true });
    const inicio = Date.now();
    await page.goto(origen + "/#inicio");
    await page.locator(".navegacion").waitFor({ timeout: 8000 });
    assert.ok(Date.now() - inicio < 8000, `abrió en ${Date.now() - inicio} ms`);
    // El respaldo del inicio del día se escribe en la carpeta aunque no se puedan quitar los viejos.
    await page.waitForFunction(() => /respaldo.*del día: TRABAJO\/respaldos\/almacen_/.test(localStorage.getItem("control-almacen:registro-archivos") ?? ""), null, { timeout: 40000 });
    await banderas({ carpeta: false, "carpeta-no-lista": false });
  });

  await t.test("«Permitir» sin aviso de Edge: a los 6 s el respaldo va a Descargas, ofrece «Elegir carpeta…» y usa la respuesta tardía", async () => {
    await cargarFixture();
    await banderas({ carpeta: true, "permiso-colgado": true });
    await page.evaluate(() => localStorage.setItem("prueba:permiso-tarde-ms", "10000"));
    await page.goto(origen + "/#inicio");
    await page.locator(".navegacion").waitFor();
    const banner = page.locator(".banner");
    assert.equal((await banner.innerText()).replace(/\s+/g, " ").trim(), "Respaldos: falta permiso para TRABAJO. Permitir");
    const descarga = page.waitForEvent("download", { timeout: 15000 });
    await banner.getByRole("button", { name: "Permitir" }).click();
    await page.getByText("Pidiendo permiso…").first().waitFor();
    // Edge no preguntó: el respaldo del día se descarga y el aviso ofrece elegir la carpeta otra vez.
    assert.match((await descarga).suggestedFilename(), /^almacen_\d{4}-\d{2}-\d{2}_\d{6}_inicio\.zip$/);
    await banner.getByRole("button", { name: "Elegir carpeta…" }).waitFor();
    await banner.getByText("Respaldo de hoy en Descargas ✓").waitFor();
    assert.match(await banner.innerText(), /^Edge no dio acceso a TRABAJO\./);
    assert.equal(await page.getByText("Pidiendo permiso…").count(), 0, "ya no se queda pidiendo permiso");
    if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, "permiso-sin-respuesta.png"), clip: { x: 0, y: 0, width: 1100, height: 140 } });
    // Edge respondió tarde: se toma, el aviso se va y el respaldo de hoy también queda en la carpeta.
    await banner.waitFor({ state: "detached", timeout: 15000 });
    await page.waitForFunction(() => /Edge respondió tarde «granted»/.test(localStorage.getItem("control-almacen:registro-archivos") ?? ""));
    await page.waitForFunction(() => /del día: TRABAJO\/respaldos\/almacen_/.test(localStorage.getItem("control-almacen:registro-archivos") ?? ""), null, { timeout: 20000 });
    await banderas({ carpeta: false, "permiso-colgado": false });
    await page.evaluate(() => localStorage.removeItem("prueba:permiso-tarde-ms"));
  });

  await t.test("la base no responde: la carga dice el paso, ofrece salidas y el rescate restaura un respaldo", async () => {
    await cargarFixture();
    await banderas({ "colgar-base": true });
    await page.goto(origen + "/#inicio");
    await page.getByText("Leyendo datos…").waitFor();
    await page.getByText("Se quedó aquí.").waitFor({ timeout: 20000 });
    for (const nombre of ["Recargar", "Restaurar respaldo…", "Copiar diagnóstico"]) {
      assert.equal(await page.getByRole("button", { name: nombre }).count(), 1, nombre);
    }
    if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, "arranque-atorada.png") });
    await page.getByRole("button", { name: "Restaurar respaldo…" }).click();
    // Modo rescate: intenta copiar lo que hay; la base no responde → recarga sola y sigue sin copia.
    await page.getByRole("heading", { name: "Restaurar respaldo · DLTA" }).waitFor();
    await page.getByText("No se pudo leer lo que había.").waitFor({ timeout: 30000 });
    await page.locator('input[type="file"]').setInputFiles(archivoRespaldo);
    await page.getByText(respaldo.nombre).waitFor();
    assert.match(await page.locator(".arranque-resumen").innerText(), new RegExp(`25/11/2026 08:00 · hasta el vale ${penultimaRespaldo}`));
    assert.match(await page.locator(".arranque-alerta").last().innerText(), /Revisa tu último vale impreso/);
    if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, "arranque-rescate.png") });
    await banderas({ "colgar-base": false });
    await page.getByRole("button", { name: "Restaurar", exact: true }).click();
    await page.getByText("Listo.").waitFor();
    await page.getByRole("button", { name: "Abrir la herramienta" }).click();
    await page.locator(".navegacion").waitFor();
    assert.equal(await ultimaSalidaGuardada(), penultimaRespaldo);
  });

  await t.test("«ya está abierta» → Abrir aquí: la otra ventana deja de guardar; «Usar esta ventana» la recupera", async () => {
    await cargarFixture();
    await page.goto(origen + "/#inicio");
    await page.locator(".navegacion").waitFor();
    const otra = await nueva();
    await otra.goto(origen + "/#inicio");
    await otra.getByRole("heading", { name: "Ya está abierta en otra ventana" }).waitFor();
    await otra.getByRole("button", { name: "Reintentar" }).click();
    await otra.getByText("Sigue abierta.").waitFor();
    if (CAPTURAS) await otra.screenshot({ path: join(CAPTURAS, "arranque-ya-abierta.png") });
    await otra.getByRole("button", { name: "Abrir aquí" }).click();
    await otra.locator(".navegacion").waitFor();
    await page.getByRole("heading", { name: "Se abrió en otra ventana" }).waitFor();
    assert.equal(await page.locator(".navegacion").count(), 0, "la herramienta ya no está en la primera");
    await page.getByRole("button", { name: "Usar esta ventana" }).click();
    await page.locator(".navegacion").waitFor();
    await otra.getByRole("heading", { name: "Se abrió en otra ventana" }).waitFor();
    await otra.close();
  });

  await t.test("rescate con la base sana: copia de lo que había en Descargas y aviso de los folios que se pierden", async () => {
    await cargarFixture();
    await page.evaluate(() => sessionStorage.setItem("control-almacen:rescate", "DLTA"));
    const descarga = page.waitForEvent("download");
    await page.goto(origen + "/#inicio");
    const copia = await descarga;
    assert.match(copia.suggestedFilename(), /^almacen_\d{4}-\d{2}-\d{2}_\d{6}_rescate\.zip$/);
    await page.getByText("Copia de lo que había: Descargas/").waitFor();
    await page.locator('input[type="file"]').setInputFiles(archivoRespaldo);
    const alerta = page.locator(".arranque-alerta");
    await alerta.waitFor();
    assert.match(await alerta.innerText(), new RegExp(`Se pierden los vales ${penultimaRespaldo + 1}–${ultima}`));
    await page.getByRole("button", { name: "Salir", exact: true }).click();
    await page.locator(".navegacion").waitFor();
    assert.equal(await ultimaSalidaGuardada(), ultima, "salir sin restaurar no cambia nada");
  });

  assert.deepEqual(errores, []);
});
