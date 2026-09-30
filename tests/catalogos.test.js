// Áreas, personas, ajustes y consultas de la interfaz (ronda de comentarios de la Fase 2).

import assert from "node:assert/strict";
import { test } from "node:test";
import { conEtapa, etapaDe, normalizarArea, tipoDeArea } from "../src/nucleo/areas.js";
import { ErrorCatalogo, areaVacia, fijarAjuste, guardarArea } from "../src/servicios/catalogos.js";
import { buscarPersonas, filasHistorial, filtrarHistorial, personasParaRecibir } from "../src/servicios/consultas.js";
import { cargaSintetica } from "./ayuda.js";

test("tipo de área: interna, externa (NOV) o transferencia", () => {
  assert.equal(tipoDeArea({ nombre: "MECANICO", origen: "RIG 91", destino: "RIG 91" }), "INTERNO");
  assert.equal(tipoDeArea({ nombre: "NOV", origen: "RIG 91", destino: "RIG 91 - TANQUE NOV" }), "EXTERNO");
  assert.equal(tipoDeArea({ nombre: "TRANSFERENCIAS", origen: "RIG 91", destino: "RIG 48" }), "TRANSFERENCIA");
  assert.equal(tipoDeArea({ nombre: "X", naturaleza: "TRANSFERENCIA" }), "TRANSFERENCIA");
  assert.equal(tipoDeArea({ nombre: "X", tipo: "EXTERNO", origen: "A", destino: "A" }), "EXTERNO");
  const interna = normalizarArea({ nombre: "SOLDADOR", origen: "RIG 91", depto_origen: "MANTENIMIENTO", destino: "RIG 91" });
  assert.deepEqual([interna.depto_origen, interna.destino, interna.tipo], ["ALMACEN", "RIG 91", "INTERNO"]);
});

test("etapa de perforación dentro de las observaciones", () => {
  const texto = 'LINEA UNO\nLINEA DOS\nETAPA DE PERFORACION: 12 1/4""';
  assert.equal(etapaDe(texto), '12 1/4""');
  assert.equal(conEtapa(texto, '8 1/2"'), 'LINEA UNO\nLINEA DOS\nETAPA DE PERFORACION: 8 1/2"');
  assert.equal(etapaDe("Etapa de perforación:  17 1/2"), "17 1/2");
  assert.equal(etapaDe("SIN ETAPA"), null);
  assert.equal(conEtapa("SOLO UNA LINEA", "6"), "SOLO UNA LINEA\nETAPA DE PERFORACION: 6");
});

test("guardar un área interna fija el origen en ALMACEN; una transferencia exige autorizó", () => {
  const { estado } = cargaSintetica();
  const interna = guardarArea(estado, { ...areaVacia(), nombre: "Electrico", depto_destino: "electrico", depto_origen: "OTRO" });
  assert.deepEqual([interna.tipo, interna.origen, interna.depto_origen, interna.destino, interna.depto_destino], ["INTERNO", "RIG 91", "ALMACEN", "RIG 91", "ELECTRICO"]);
  const trans = guardarArea(estado, { ...areaVacia(), nombre: "A OTRO EQUIPO", tipo: "TRANSFERENCIA", destino: "RIG 300" });
  assert.deepEqual([trans.naturaleza, trans.requiere_autoriza, trans.destino], ["TRANSFERENCIA", true, "RIG 300"]);
  assert.throws(() => guardarArea(estado, { ...areaVacia(), nombre: "electrico" }), ErrorCatalogo);
});

test("ajustes: captura rápida y etapa quedan en el estado con bitácora", () => {
  const { estado } = cargaSintetica();
  assert.equal(estado.config.captura_rapida, false);
  fijarAjuste(estado, "captura_rapida", true, "ALMACENISTA UNO");
  fijarAjuste(estado, "etapa_perforacion", ' 6 1/8" ', "ALMACENISTA UNO");
  assert.deepEqual([estado.config.captura_rapida, estado.config.etapa_perforacion], [true, '6 1/8"']);
  assert.equal(estado.auditoria.filter((a) => a.entidad === "config").length, 2);
  assert.throws(() => fijarAjuste(estado, "otra_cosa", 1), ErrorCatalogo);
});

test("quién recibe: se busca por nombre, puesto o área habitual", () => {
  const { estado } = cargaSintetica();
  estado.personas.find((p) => p.nombre === "ALMACENISTA UNO").es_almacenista = true;
  const personas = personasParaRecibir(estado);
  const nombres = (lista) => lista.map((p) => p.nombre);
  // por puesto / área, sin acentos ni mayúsculas
  assert.ok(nombres(buscarPersonas(personas, "mecánico")).includes("MECANICO UNO"));
  assert.ok(nombres(buscarPersonas(personas, "soldador")).includes("SOLDADOR UNO"));
  // por nombre
  assert.deepEqual(nombres(buscarPersonas(personas, "quimico uno")), ["QUIMICO UNO"]);
  // sin texto: primero las del área del vale
  assert.equal(buscarPersonas(personas, "", { depto: "SOLDADOR" })[0].nombre, "SOLDADOR UNO");
  // los almacenistas van al final
  assert.equal(personas.at(-1).nombre, "ALMACENISTA UNO");
});

test("historial: los filtros se combinan (código + área + persona + fechas)", () => {
  const { estado } = cargaSintetica();
  const filas = filasHistorial(estado);
  const solo702 = filtrarHistorial(filas, { codigo: "000702" });
  assert.ok(solo702.length > 0 && solo702.every((f) => f.codigo === 702));
  const conArea = filtrarHistorial(filas, { codigo: "702", depto: "MECANICO" });
  assert.ok(conArea.length > 0 && conArea.length <= solo702.length && conArea.every((f) => f.depto === "MECANICO"));
  assert.equal(filtrarHistorial(filas, { codigo: "702", depto: "SOLDADOR", recibio: "zzz" }).length, 0);
  const rango = filtrarHistorial(filas, { desde: "2026-09-02", hasta: "2026-09-02" });
  assert.ok(rango.length > 0 && rango.every((f) => f.fecha_iso === "2026-09-02"));
  assert.equal(filtrarHistorial(filas, {}).length, filas.length);
  assert.ok(filtrarHistorial(filas, { texto: "filtros p551317" }).every((f) => f.codigo === 702));
});
