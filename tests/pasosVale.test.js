// Ronda 34, etapa 1: el vale de salida en 3 pasos — en qué paso está un borrador y qué falta para avanzar.

import assert from "node:assert/strict";
import { test } from "node:test";
import { borradorDesdeVale } from "../src/servicios/copiarVale.js";
import * as en from "../src/servicios/entradas.js";
import { PASOS, estadoDePasos, faltaMaterial, faltaParaAvanzar, faltaParaQuien, nombrePaso, pasoDe } from "../src/servicios/pasosVale.js";
import * as v from "../src/servicios/vales.js";
import { Indices } from "../src/nucleo/estado.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const area = (estado, nombre) => estado.plantillas_area.find((p) => p.nombre === nombre);
const campos = (falta) => falta.map((f) => [f.campo, f.mensaje]);

test("los 3 pasos y en cuál está un borrador: el nuevo, el copiado de otro vale y los de antes empiezan en el 1", () => {
  assert.deepEqual(PASOS.map((p) => `${p.numero} · ${p.nombre}`), ["1 · Para quién", "2 · Material", "3 · Revisar y emitir"]);
  assert.equal(nombrePaso(2), "Material");
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO });
  assert.equal(b.paso, 1);
  assert.equal(pasoDe(b), 1);
  // Un borrador anterior a la Ronda 34 no trae paso; uno dañado tampoco se sale de 1…3.
  assert.equal(pasoDe({ ...b, paso: undefined }), 1);
  assert.equal(pasoDe({ ...b, paso: 7 }), 1);
  assert.equal(pasoDe({ ...b, paso: "2" }), 1);
  assert.equal(pasoDe({ ...b, paso: 3 }), 3);
  // Desde una entrada: paso 1 con las partidas ya cargadas.
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const be = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(be, { folio_externo: "B-1", origen: "BASE PRUEBA" });
  be.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "2" }];
  const entrada = en.confirmarEntrada(estado, be.id, { usuario: USUARIO });
  const { borrador } = borradorDesdeVale(estado, entrada.id, { usuario: USUARIO });
  assert.equal(borrador.paso, 1);
  assert.equal(borrador.lineas.length, 1);
});

test("paso 1 → 2: área (o destino), nombre de quien recibe y, si el área lo pide, quién autoriza", () => {
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO });
  assert.deepEqual(campos(faltaParaQuien(estado, b)), [["depto_destino", "Falta el área"], ["recibio_nombre", "Falta el nombre"]]);
  v.aplicarPlantilla(estado, b, area(estado, "MECANICO").id);
  b.recibio_nombre = "";
  assert.deepEqual(campos(faltaParaQuien(estado, b)), [["recibio_nombre", "Falta el nombre"]]);
  b.recibio_nombre = "MECANICO UNO";
  assert.deepEqual(faltaParaQuien(estado, b), []);
  assert.deepEqual(faltaParaAvanzar(estado, b, 1), []);
  // Transferencia: sin destino ni autoriza no se avanza.
  const t = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "TRANSFERENCIAS").id });
  Object.assign(t, { destino: "", depto_destino: "", recibio_nombre: "CHOFER UNO", autorizo_nombre: "" });
  assert.deepEqual(campos(faltaParaQuien(estado, t)), [["depto_destino", "Falta el destino"], ["autorizo_nombre", "Falta quién autoriza"]]);
  Object.assign(t, { destino: "OTRO EQUIPO", autorizo_nombre: "RIG MANAGER UNO" });
  assert.deepEqual(faltaParaQuien(estado, t), []);
});

test("paso 2 → 3: al menos una partida; las que no tienen cantidad no detienen (sí al emitir)", () => {
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id });
  b.lineas.push(v.lineaVacia());
  assert.deepEqual(campos(faltaMaterial(b)), [["lineas", "Agrega al menos una partida"]]);
  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  b.lineas.push(v.lineaDesdeExistencia(estado, sellos.id)); // sin cantidad
  assert.deepEqual(faltaParaAvanzar(estado, b, 2), []);
  assert.ok(v.validarVale(estado, b).errores.some((e) => e.campo === "cantidad"), "emitir sí la pide");
  assert.deepEqual(faltaParaAvanzar(estado, b, 3), [], "en el 3 no se avanza: se emite");
});

test("el indicador: anteriores completos, el actual y los siguientes pendientes; el paso no llega al vale emitido", () => {
  assert.deepEqual(estadoDePasos(2).map((p) => p.estado), ["completo", "actual", "pendiente"]);
  assert.deepEqual(estadoDePasos(1).map((p) => p.estado), ["actual", "pendiente", "pendiente"]);
  assert.deepEqual(estadoDePasos(3).map((p) => p.estado), ["completo", "completo", "actual"]);
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
  Object.assign(b, { recibio_nombre: "MECANICO UNO", etapa_perforacion: '12 1/4"', paso: 3 });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  assert.equal("paso" in vale, false);
});
