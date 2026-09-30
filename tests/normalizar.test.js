import assert from "node:assert/strict";
import { test } from "node:test";
import { Big, decTexto } from "../src/nucleo/decimal.js";
import { ratio } from "../src/nucleo/difflib.js";
import { FechaCelda, serialExcel } from "../src/nucleo/fechas.js";
import * as n from "../src/nucleo/normalizar.js";
import { clavesDeBusqueda, esErrorDeDedo } from "../src/nucleo/catalogo.js";

test("valorATexto", () => {
  const casos = [
    [null, null],
    ["#REF!", null],
    ["  PZA  ", "PZA"],
    ["DISCOS  PARA DESBASTE ", "DISCOS  PARA DESBASTE"], // doble espacio interno se respeta
    [126649.0, "126649"],
    [5.5, "5.5"],
    [new FechaCelda(46294), "2026-09-29"],
    [true, "SI"],
  ];
  for (const [valor, esperado] of casos) assert.equal(n.valorATexto(valor), esperado, String(valor));
});

test("claveEstricta", () => {
  const casos = [
    ['1/2"', '1/2"'],
    ['1/2 "', '1/2"'],
    ["6309-2Z/C3", "63092Z/C3"],
    ["NP: H143405", "H143405"],
    ["S/D", ""],
    ["SIN DIMENSION", ""],
    ["SIN DIMENCION ", ""],
    [0, ""],
    ["Válvula 3/4", "VALVULA3/4"],
    ["1/2”", '1/2"'],
  ];
  for (const [valor, esperado] of casos) assert.equal(n.claveEstricta(valor), esperado, String(valor));
});

test("claveEstricta no confunde fracciones con enteros", () => {
  assert.notEqual(n.claveEstricta('1/2"'), n.claveEstricta("12"));
  assert.equal(n.claveLaxa('1/2"'), "12");
});

test("codigoAx", () => {
  const casos = [["000000670", 670], [670, 670], [670.0, 670], [670.5, null], ["ABC", null], ["#REF!", null], [null, null]];
  for (const [valor, esperado] of casos) assert.equal(n.codigoAx(valor), esperado, String(valor));
});

test("unidad y nombres", () => {
  assert.equal(n.unidad("PZ A"), "PZA");
  assert.equal(n.unidad("pza "), "PZA");
  assert.equal(n.unidad(null), "");
  assert.equal(n.nombrePersona("  juan  perez "), "JUAN PEREZ");
  assert.equal(n.nombrePersona(0), null);
});

test("separarCantidad", () => {
  const [cantidad, resto] = n.separarCantidad("15LTS");
  assert.ok(cantidad.eq(15));
  assert.equal(resto, "LTS");
  assert.equal(decTexto(n.separarCantidad(3)[0]), "3");
  assert.equal(decTexto(n.separarCantidad(0.1)[0]), "0.1");
  assert.deepEqual(n.separarCantidad("#REF!"), [null, null]);
  assert.equal(decTexto(n.separarCantidad("2,5 kg")[0]), "2.5");
});

test("textoONumero conserva ceros iniciales", () => {
  assert.ok(n.textoONumero("126649") instanceof Big);
  assert.equal(n.textoONumero("5.5").toFixed(), "5.5");
  assert.equal(n.textoONumero("0509"), "0509");
  assert.equal(n.textoONumero("6309-2Z"), "6309-2Z");
  assert.equal(n.textoONumero(null), null);
});

test("fechas", () => {
  assert.equal(n.fecha(" 11/04/2026"), "2026-04-11");
  assert.equal(n.fecha(46294), "2026-09-29");
  assert.equal(n.fecha("2026-09-29"), "2026-09-29");
  assert.equal(n.fecha("31/02/2026"), null);
  assert.equal(n.fecha("5/9/26"), "2026-09-05");
  assert.equal(serialExcel("2026-09-29"), 46294);
  assert.equal(n.fecha("#REF!"), null);
});

test("decimales exactos (nunca float)", () => {
  assert.equal(decTexto(n.decimal(0.1).plus(n.decimal(0.2))), "0.3");
  assert.equal(decTexto(n.decimal("1.50")), "1.5");
  assert.equal(n.decimal("abc"), null);
});

test("ratio igual al de difflib de Python", () => {
  // Valores calculados con difflib.SequenceMatcher(None, a, b).ratio()
  assert.equal(ratio("GRSA", "GRASA"), 8 / 9);
  assert.equal(ratio("P551317", "P551318"), 12 / 14);
  assert.equal(ratio("", ""), 1);
  assert.equal(ratio("ABC", "XYZ"), 0);
});

test("clavesDeBusqueda y errores de dedo", () => {
  assert.ok(clavesDeBusqueda('S/D NP: 1/4"').has('1/4"'));
  assert.equal(clavesDeBusqueda("S/D").size, 0);
  assert.ok(clavesDeBusqueda("6309-2Z/C3").has("63092Z/C3"));
  assert.ok(esErrorDeDedo("GRSA", "GRASA"));
  assert.ok(!esErrorDeDedo("ACETILENO", "OXIGENO"));
});
