import assert from "node:assert/strict";
import { test } from "node:test";
import { leerInventario, sumaCantidad } from "../src/importadores/inventario.js";
import { esPerdido, leerVales } from "../src/importadores/vales.js";
import { bytesInventario, libroInventario, libroVales } from "./ayuda.js";

test("inventario: hojas con nombre exacto (espacio final incluido)", () => {
  const libro = libroInventario();
  assert.deepEqual(
    libro.hojas.map((h) => h.nombre),
    ["CONTENEDOR #1 INVENTARIABLE", "CONTENEDOR #1 CONSUMIBLE ", "CONTENEDOR #2 INVENTARIABLE", "CONTENEDOR #2 CONSUMIBLE"],
  );
  assert.deepEqual(
    libro.hojas.map((h) => [h.contenedor, h.clase]),
    [[1, "INV"], [1, "CONS"], [2, "INV"], [2, "CONS"]],
  );
  assert.ok(libro.hojas.every((h) => h.tabla));
});

test("inventario: renglones, totales y renglones vacíos", () => {
  const hojas = new Map(libroInventario().hojas.map((h) => [h.nombre, h]));
  const c1 = hojas.get("CONTENEDOR #1 INVENTARIABLE");
  assert.equal(c1.renglones.length, 5);
  assert.ok(sumaCantidad(c1).eq(19));
  assert.equal(c1.fila_totales, 7);
  const sellos = c1.renglones[4];
  assert.deepEqual([sellos.codigo, sellos.dimension, sellos.consumo.toFixed()], [706, "555001", "1"]);
  assert.equal(c1.renglones[1].um, "PZA"); // 'PZA ' normalizada
  assert.equal(c1.renglones[3].item, null);
  assert.deepEqual(hojas.get("CONTENEDOR #1 CONSUMIBLE ").filas_vacias, [7]);
});

test("inventario: notas de celda y catálogo oculto", () => {
  const libro = libroInventario();
  assert.match(libro.hojas[0].renglones[2].nota || "", /Revisar dimensión/);
  assert.equal(libro.catalogo.get(701), "BALEROS");
});

test("DIARIO: errores, fecha como texto, cantidad con unidad y ceros de la macro", () => {
  const libro = libroVales();
  const renglones = new Map(libro.renglones.map((r) => [r.fila, r]));
  assert.equal(libro.renglones.length, 14);
  assert.ok(esPerdido(renglones.get(8)));
  for (const campo of ["origen", "pase_entrada", "lote"]) assert.ok(renglones.get(6).errores.has(campo));
  assert.equal(renglones.get(9).fecha, "2026-09-03");
  assert.ok(renglones.get(9).cantidad.eq(15));
  assert.equal(renglones.get(9).resto_cantidad, "LTS");
  assert.equal(renglones.get(10).destino, null);
  assert.equal(renglones.get(14).oc, "11536");
  assert.equal(renglones.get(2).depto_destino, "MECANICO");
});

test("formularios con firmas desplazadas", () => {
  const plantillas = new Map(libroVales().plantillas.map((p) => [p.hoja, p]));
  assert.deepEqual([...plantillas.keys()].sort(), ["MECANICO ", "SOLDADOR", "TRANSFERENCIAS"]);
  const mecanico = plantillas.get("MECANICO ");
  assert.deepEqual([mecanico.entrega_nombre, mecanico.recibe_nombre], ["ALMACENISTA UNO", "MECANICO UNO"]);
  assert.equal(mecanico.recibe_puesto, "MECANICO");
  assert.equal(plantillas.get("TRANSFERENCIAS").autoriza_nombre, "AUTORIZADOR UNO");
  assert.match(plantillas.get("SOLDADOR").observaciones, /ESPECIFICACIONES/);
  assert.ok(!(mecanico.observaciones || "").toUpperCase().includes("NOMBRE"));
});

test("catálogo de los formularios (AG:AH)", () => {
  assert.equal(libroVales().catalogo.get(721), "CODIGO SOLO EN CATALOGO DE VALES");
});

test("un archivo que no es Excel da un error claro", () => {
  assert.throws(() => leerInventario(new Uint8Array([1, 2, 3]), "x.xlsx"), /no es un libro de Excel/);
  assert.throws(() => leerVales(bytesInventario(), "inventario.xlsx"), /no tiene la hoja DIARIO/);
});
