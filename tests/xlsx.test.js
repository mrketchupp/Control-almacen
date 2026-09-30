// Piezas de bajo nivel: ZIP, lector de celdas, libros nuevos y edición de plantilla.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Big } from "../src/nucleo/decimal.js";
import { FechaCelda } from "../src/nucleo/fechas.js";
import { esFormatoFecha, LibroLeido } from "../src/xlsx/leer.js";
import { LibroNuevo } from "../src/xlsx/nuevo.js";
import { HojaXML, PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { crc32, crearZip, descomprimirZip, leerZip } from "../src/xlsx/zip.js";
import { bytesVales } from "./ayuda.js";

test("CRC-32 estándar", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("ZIP: ida y vuelta, con nombres acentuados", () => {
  const zip = crearZip([
    ["a.txt", "hola"],
    ["carpeta/año.json", '{"x":1}'],
  ]);
  const partes = descomprimirZip(zip);
  assert.equal(new TextDecoder().decode(partes.get("a.txt")), "hola");
  assert.equal(new TextDecoder().decode(partes.get("carpeta/año.json")), '{"x":1}');
});

test("plantilla sin cambios = mismos bytes comprimidos", () => {
  const original = bytesVales();
  const copia = new PaqueteOOXML(original).generar();
  const a = leerZip(original);
  const b = leerZip(copia);
  assert.equal(a.length, b.length);
  a.forEach((e, i) => {
    assert.equal(b[i].nombre, e.nombre);
    assert.equal(b[i].crc, e.crc);
    assert.deepEqual(b[i].comprimido, e.comprimido);
  });
});

test("formatos de fecha de Excel", () => {
  assert.ok(esFormatoFecha("dd/mm/yyyy"));
  assert.ok(esFormatoFecha("[$-80A]dddd, d \\de mmmm \\de yyyy"));
  assert.ok(!esFormatoFecha("General"));
  assert.ok(!esFormatoFecha('0.00" días"'));
  assert.ok(!esFormatoFecha("#,##0.00"));
});

test("libro nuevo: valores, estilos y validaciones se leen de vuelta", () => {
  const libro = new LibroNuevo();
  const hoja = libro.agregarHoja("Prueba & <más>");
  hoja.agregarFila(["Texto", "Número", "Fecha", "Decimal"], { fuente: { negrita: true }, relleno: "1F3864" });
  hoja.agregarFila([" con espacios ", 42, new FechaCelda(46294), new Big("12.50")]);
  hoja.poner(2, 3, new FechaCelda(46294), { formato: "dd/mm/yyyy" });
  hoja.congelar = "B2";
  hoja.filtro = "A1:D2";
  hoja.validaciones.push({ ref: "E2:E3", opciones: ["Sí", "No"] });
  const leido = new LibroLeido(libro.generar());
  const ws = leido.hoja("Prueba & <más>");
  assert.deepEqual(ws.fila(2, 1, 4).map((v) => (v instanceof FechaCelda ? v.serial : v)), [" con espacios ", 42, 46294, 12.5]);
  assert.ok(ws.valor(2, 3) instanceof FechaCelda);
});

test("editar una celda de plantilla conserva el resto de la hoja", () => {
  const xml =
    '<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" s="3" t="inlineStr"><is><t>x</t></is></c></row>' +
    '<row r="3"><c r="B3"><v>1</v></c></row></sheetData><pageMargins/></worksheet>';
  const hoja = new HojaXML(xml);
  hoja.ponerCelda("B1", "nuevo");
  hoja.ponerCelda("A2", 5);
  const texto = hoja.toString();
  assert.match(texto, /<row r="1"><c r="A1" s="3" t="inlineStr"><is><t>x<\/t><\/is><\/c><c r="B1" t="inlineStr">/);
  assert.match(texto, /<row r="2"><c r="A2"><v>5<\/v><\/c><\/row><row r="3">/);
  assert.match(texto, /<pageMargins\/><\/worksheet>$/);
});

test("fórmulas compartidas se reconstruyen al mover filas", () => {
  const xml =
    '<worksheet><sheetData><row r="2"><c r="C2"><f t="shared" ref="C2:C3" si="0">A2+B2</f><v>3</v></c></row>' +
    '<row r="3"><c r="C3"><f t="shared" si="0"/><v>7</v></c></row></sheetData></worksheet>';
  const hoja = new HojaXML(xml);
  assert.equal(hoja.formulaDe(3, "C"), "A3+B3");
  assert.equal(hoja.moverFila(3, 10), '<row r="10"><c r="C10"><f>A10+B10</f></c></row>');
});
