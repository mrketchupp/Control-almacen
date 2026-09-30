// Guardado local, respaldos y restauración (con un almacenamiento en memoria).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen, BaseNoVacia, SinPlantilla, nombreConFecha } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { ErrorRespaldo, crearRespaldo, infoDeNombre, leerRespaldo, respaldosABorrar } from "../src/almacen/respaldos.js";
import { ubicarLinea, lineasPorUbicar } from "../src/servicios/consultas.js";
import { ErrorVale, emitirBorrador, lineaNoInventariada, nuevoBorrador, siguienteFolio } from "../src/servicios/vales.js";
import { crearZip, descomprimirZip } from "../src/xlsx/zip.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

async function almacenCargado() {
  const almacen = new Almacen(new BackendMemoria(), { version: "prueba" });
  await almacen.iniciar();
  const { estado } = cargaSintetica();
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  return almacen;
}

test("la primera carga guarda estado y plantillas, y no se repite", async () => {
  const almacen = await almacenCargado();
  assert.equal(almacen.estado.plantillas_excel.length, 2);
  assert.match(almacen.estado.plantillas_excel[0].archivo, /^inventario_[0-9a-f]{12}\.xlsx$/);
  const { datos } = await almacen.plantillaActiva("VALES");
  assert.equal(datos.length, bytesVales().length);
  await assert.rejects(() => almacen.cargarPrimeraVez(cargaSintetica().estado, []), BaseNoVacia);
  // lo guardado sobrevive a "cerrar y abrir"
  const otro = new Almacen(almacen.backend);
  await otro.iniciar();
  assert.equal(otro.estado.vales.length, 8);
});

test("un cambio que falla no altera el estado vigente", async () => {
  const almacen = await almacenCargado();
  const antes = JSON.stringify(almacen.estado);
  await assert.rejects(() =>
    almacen.modificar((estado) => {
      estado.vales.length = 0;
      throw new Error("falla a propósito");
    }),
  );
  assert.equal(JSON.stringify(almacen.estado), antes);
});

test("folios bajo concurrencia: sin duplicados ni saltos, y un error no consume folio", async () => {
  const almacen = await almacenCargado();
  // Guardado lento y variable, como IndexedDB con el disco ocupado.
  const guardar = almacen.backend.guardarEstado.bind(almacen.backend);
  almacen.backend.guardarEstado = async (estado) => {
    await new Promise((listo) => setTimeout(listo, Math.random() * 8));
    return guardar(estado);
  };
  const area = almacen.estado.plantillas_area.find((p) => p.nombre === "SOLDADOR");
  const ids = [];
  for (let i = 0; i < 12; i++) {
    ids.push(
      await almacen.modificar((e) => {
        const b = nuevoBorrador(e, { usuario: "ALMACENISTA UNO", plantillaId: area.id });
        // uno de cada cuatro queda sin cantidad: debe fallar sin consumir folio
        b.lineas.push({ ...lineaNoInventariada(e, 136), cantidad: i % 4 === 3 ? "" : "5", um: "LTS" });
        return b.id;
      }),
    );
  }
  const primero = siguienteFolio(almacen.estado);
  const resultados = await Promise.allSettled(
    ids.map((id) => almacen.modificar((e) => emitirBorrador(e, id, { usuario: "ALMACENISTA UNO" }))),
  );
  const emitidos = resultados.filter((r) => r.status === "fulfilled").flatMap((r) => r.value.map((v) => v.folio));
  const fallidos = resultados.filter((r) => r.status === "rejected");
  assert.equal(fallidos.length, 3);
  assert.ok(fallidos.every((r) => r.reason instanceof ErrorVale));
  assert.deepEqual(
    [...emitidos].sort((a, b) => a - b),
    Array.from({ length: 9 }, (_, i) => primero + i),
  );
  // lo guardado es lo mismo que lo que hay en memoria
  const otro = new Almacen(almacen.backend);
  await otro.iniciar();
  const folios = otro.estado.vales.map((v) => v.folio);
  assert.equal(new Set(folios).size, folios.length);
  assert.equal(siguienteFolio(otro.estado), primero + 9);
  assert.equal(otro.estado.borradores.length, 3);
});

test("ubicar pendientes deja auditoría", async () => {
  const almacen = await almacenCargado();
  const pendiente = lineasPorUbicar(almacen.estado).find((p) => p.codigo === 701);
  assert.deepEqual(pendiente.candidatos.map((c) => c.coincide), [true, true, false]);
  await almacen.modificar((e) => ubicarLinea(e, pendiente.id, pendiente.candidatos[1].id, "ALMACENISTA UNO"));
  const restantes = lineasPorUbicar(almacen.estado);
  assert.ok(restantes.every((p) => p.codigo !== 701));
  const auditoria = almacen.estado.auditoria.find((a) => a.accion === "UBICAR");
  assert.equal(auditoria.usuario, "ALMACENISTA UNO");
  await almacen.modificar((e) => ubicarLinea(e, restantes[0].id, null, "ALMACENISTA UNO")); // no inventariado
  assert.deepEqual(lineasPorUbicar(almacen.estado), []);
});

test("exportar registra la exportación y nombra con la fecha", async () => {
  const almacen = await almacenCargado();
  const vales = await almacen.exportar("VALES", "ALMACENISTA UNO", "2026-10-01");
  const inventario = await almacen.exportar("INVENTARIO", null, "2026-10-01");
  assert.equal(vales.nombre, "VALES SINTETICO.xlsm");
  assert.equal(vales.subcarpeta, "exportaciones/2026-10-01");
  assert.equal(inventario.nombre, "INVENTARIO SINTETICO 011026.xlsx");
  assert.deepEqual(
    almacen.estado.exportaciones.map((e) => [e.tipo, e.ultimo_folio]),
    [["VALES", 9], ["INVENTARIO", null]],
  );
});

test("sin plantilla no se puede exportar", async () => {
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  almacen.estado = cargaSintetica().estado;
  await assert.rejects(() => almacen.exportar("VALES", null), SinPlantilla);
});

test("nombre con fecha", () => {
  assert.equal(nombreConFecha("INVENTARIO DE REFACCIONAMIENTO_280926.xlsx", "2026-10-01"), "INVENTARIO DE REFACCIONAMIENTO_011026.xlsx");
  assert.equal(nombreConFecha("INVENTARIO.xlsx", "2026-10-01"), "INVENTARIO 011026.xlsx");
});

test("respaldo y restauración completos", async () => {
  const almacen = await almacenCargado();
  const respaldo = await almacen.respaldo("prueba");
  assert.match(respaldo.nombre, /^almacen_\d{4}-\d{2}-\d{2}_\d{6}_prueba\.zip$/);
  const partes = descomprimirZip(respaldo.datos);
  assert.ok(partes.has("estado.json") && partes.has("manifiesto.json"));
  assert.equal([...partes.keys()].filter((n) => n.startsWith("plantillas/")).length, 2);
  // se pierde un vale y luego se restaura en un navegador "nuevo"
  await almacen.modificar((e) => {
    e.vales = e.vales.filter((v) => v.folio !== 1);
  });
  const nuevo = new Almacen(new BackendMemoria());
  await nuevo.iniciar();
  await nuevo.restaurar(respaldo.datos);
  assert.ok(nuevo.estado.vales.some((v) => v.folio === 1));
  const { datos } = await nuevo.plantillaActiva("INVENTARIO");
  assert.equal(datos.length, bytesInventario().length);
  // restaurar sobre datos existentes guarda antes una copia interna
  await almacen.restaurar(respaldo.datos);
  assert.ok((await almacen.backend.listarInstantaneas()).some((c) => c.motivo === "antes de restaurar"));
});

test("respaldos inválidos se rechazan con un mensaje claro", () => {
  assert.throws(() => leerRespaldo(crearZip([["otra_cosa.txt", "hola"]])), ErrorRespaldo);
  assert.throws(() => leerRespaldo(crearZip([["almacen.db", "x"]])), /versión de escritorio/);
  assert.throws(() => leerRespaldo(new Uint8Array([1, 2, 3])), ErrorRespaldo);
  const { estado } = cargaSintetica();
  estado.vales[1].folio = estado.vales[0].folio;
  assert.throws(() => leerRespaldo(crearRespaldo(estado, []).datos), /repetido/);
});

test("retención: uno por día, 30 días y 12 meses", () => {
  const nombres = [];
  const base = Date.UTC(2026, 0, 1, 8);
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 2; j++) {
      const d = new Date(base + i * 86400000 + j * 3600000).toISOString();
      nombres.push(`almacen_${d.slice(0, 10)}_${d.slice(11, 19).replace(/:/g, "")}_auto.zip`);
    }
  }
  const borrar = new Set(respaldosABorrar(nombres));
  const restantes = nombres.filter((n) => !borrar.has(n)).map(infoDeNombre);
  const dias = new Set(restantes.map((r) => r.fecha));
  assert.equal(restantes.length, dias.size); // uno por día
  assert.equal(dias.size, 30);
  assert.equal([...dias].sort()[0], "2026-01-31");
  assert.ok(!borrar.has("otro-archivo.zip"));
});
