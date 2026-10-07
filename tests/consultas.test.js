import assert from "node:assert/strict";
import { test } from "node:test";
import { estadoVacio } from "../src/nucleo/estado.js";
import * as consultas from "../src/servicios/consultas.js";
import { FOLIO_CORTE, cargaSintetica } from "./ayuda.js";

test("resumen de una herramienta vacía", () => {
  assert.ok(consultas.resumen(estadoVacio()).vacia);
});

test("resumen con datos", () => {
  const r = consultas.resumen(cargaSintetica().estado);
  assert.ok(!r.vacia);
  assert.deepEqual([r.existencias, r.ultimo_folio, r.conteo_folio, r.por_ubicar], [20, 9, FOLIO_CORTE, 2]);
});

test("filas de inventario e historial", () => {
  const { estado } = cargaSintetica();
  // Como el Excel diario: el día del vale (04-sep) sale en CONSUMO; al día siguiente ya está en CANTIDAD.
  const sellos = (dia) => consultas.filasInventario(estado, { dia }).find((f) => f.codigo === 706);
  assert.deepEqual([sellos("2026-09-04").cantidad, sellos("2026-09-04").consumo, sellos("2026-09-04").total], [2, 1, 1]);
  assert.deepEqual([sellos("2026-09-05").cantidad, sellos("2026-09-05").consumo, sellos("2026-09-05").total], [1, null, 1]);
  assert.deepEqual([sellos("2026-09-03").cantidad, sellos("2026-09-03").consumo], [2, 1]); // un vale posterior al día va en CONSUMO
  const historial = consultas.filasHistorial(estado);
  assert.equal(historial.length, 13);
  assert.equal(historial[0].folio, 9); // más reciente primero
});

test("candidatos ordenados por parecido", () => {
  const candidatos = consultas.candidatosPara(cargaSintetica().estado, 702, "P551318"); // dedo de P551317
  assert.match(candidatos[0].etiqueta, /P551317/);
});

test("almacenista en turno", () => {
  const { estado } = cargaSintetica();
  assert.ok(!consultas.almacenistas(estado).includes("ALMACENISTA UNO")); // pocas entregas en la muestra
  consultas.fijarUsuarioEnTurno(estado, "ALMACENISTA UNO");
  assert.equal(consultas.usuarioEnTurno(estado), "ALMACENISTA UNO");
  consultas.agregarAlmacenista(estado, "ALMACENISTA UNO");
  assert.ok(consultas.almacenistas(estado).includes("ALMACENISTA UNO"));
});
