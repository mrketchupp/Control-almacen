// Ronda 33: vale de salida a partir de una entrada (lo que se recibió y se entregó el mismo día) o
// de otro vale de salida (repetirlo).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { hoyIso } from "../src/nucleo/fechas.js";
import * as cv from "../src/servicios/copiarVale.js";
import * as en from "../src/servicios/entradas.js";
import * as v from "../src/servicios/vales.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const total = (estado, id) => calcularSaldos(estado, [id]).get(id).total.toFixed();
const area = (estado, nombre) => estado.plantillas_area.find((p) => p.nombre === nombre);

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const renglones = (codigo) => estado.existencias.filter((e) => indices.variante(e.variante_id).codigo === codigo);
  return { estado, indices, renglones };
}

/** Entrada recibida hoy: balero a su partida, una partida con NP, una variante nueva y diésel sin existencia. */
function entradaDeHoy(estado, indices, renglones) {
  const [balero1] = renglones(701);
  const [conNp] = renglones(710);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(b, { folio_externo: "B-200", origen: "BASE PRUEBA" });
  const base = { ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices }), um: "PZA" };
  b.lineas = [
    { ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero1.id, indices), cantidad: "3", oc: "OC-77", lote: "SOLICITANTE UNO" },
    { ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), conNp.id, indices), cantidad: "2", lote: "SOLICITANTE DOS" },
    { ...en.conClaveEscrita(estado, base, "6400", { indices }), cantidad: "5" },
    { ...en.entradaSinExistencia({ ...en.lineaEntradaVacia(), codigo: 136, descripcion: "DIESEL", um: "LTS" }), cantidad: "1000" },
  ];
  return { vale: en.confirmarEntrada(estado, b.id, { usuario: USUARIO }), balero1, conNp };
}

test("de una entrada: cada partida sale de la partida a la que entró, con su cantidad y O.C.; el LOTE es el NP, no quien solicita", () => {
  const { estado, indices, renglones } = preparar();
  const { vale, balero1, conNp } = entradaDeHoy(estado, indices, renglones);
  const antes = new Map(vale.lineas.filter((l) => l.existencia_id).map((l) => [l.existencia_id, total(estado, l.existencia_id)]));
  const salidas = estado.vales.filter((x) => x.tipo === "SALIDA").length;
  const { borrador, avisos, partidas } = cv.borradorDesdeVale(estado, vale.id, { usuario: USUARIO });
  assert.deepEqual(avisos, []);
  assert.equal(partidas, 4);
  assert.ok(estado.borradores.includes(borrador));
  assert.deepEqual(borrador.copia_de, { tipo: "ENTRADA", vale_id: vale.id, folio: "E-0001" });
  assert.equal(borrador.fecha, hoyIso());
  assert.equal(borrador.entrego_nombre, USUARIO);
  assert.equal(borrador.plantilla_area_id, null); // de una entrada se elige el área
  const [balero, np, nueva, diesel] = borrador.lineas;
  assert.deepEqual([balero.existencia_id, balero.cantidad, balero.oc, balero.lote, balero.clave], [balero1.id, "3", "OC-77", "", "6309-2Z/C3"]);
  assert.deepEqual([np.existencia_id, np.cantidad, np.lote, np.lote_np], [conNp.id, "2", "X00489", "X00489"]);
  assert.equal(nueva.existencia_id, vale.lineas[2].existencia_id); // la partida que la entrada dio de alta
  assert.equal(nueva.clave, "6400");
  assert.deepEqual([diesel.no_inventariado, diesel.existencia_id, diesel.cantidad, diesel.um, diesel.clave], [true, null, "1000", "LTS", "S/D"]);
  // El vale original no cambia y nada se mueve hasta emitir.
  for (const [id, cantidad] of antes) assert.equal(total(estado, id), cantidad);
  assert.equal(estado.vales.filter((x) => x.tipo === "SALIDA").length, salidas);
  // Con el área elegida se emite como cualquier vale; lo que entró hoy vuelve a salir.
  v.aplicarPlantilla(estado, borrador, area(estado, "MECANICO").id);
  const [salida] = v.emitirBorrador(estado, borrador.id, { usuario: USUARIO });
  for (const [id, cantidad] of antes) {
    const entro = vale.lineas.find((l) => l.existencia_id === id).cantidad;
    assert.equal(total(estado, id), String(Number(cantidad) - Number(entro)));
  }
  assert.equal(salida.lineas[0].oc, "OC-77");
  const emitir = estado.auditoria.at(-1);
  assert.equal(emitir.accion, "EMITIR");
  assert.deepEqual(emitir.despues.copia_de, { tipo: "ENTRADA", folio: "E-0001" });
});

test("de un vale de salida: se repiten el área, quién recibe y el LOTE; quién autoriza solo si el área lo pide", () => {
  const { estado, indices, renglones } = preparar();
  const [balero1] = renglones(701);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
  Object.assign(b, { recibio_nombre: "MECANICO UNO", recibio_puesto: "MECANICO", autorizo_nombre: "NO DEBE PASAR" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad: "2", lote: "FX" });
  const [original] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  const { borrador } = cv.borradorDesdeVale(estado, original.id, { usuario: "OTRO ALMACENISTA" });
  assert.equal(borrador.plantilla_area_id, area(estado, "MECANICO").id);
  assert.deepEqual([borrador.recibio_nombre, borrador.recibio_puesto], ["MECANICO UNO", "MECANICO"]);
  assert.equal(borrador.entrego_nombre, "OTRO ALMACENISTA");
  assert.equal(borrador.autorizo_nombre, ""); // MECANICO no pide autoriza: no saldría impreso sin verse
  assert.deepEqual([borrador.lineas[0].existencia_id, borrador.lineas[0].cantidad, borrador.lineas[0].lote], [balero1.id, "2", "FX"]);
  assert.equal(borrador.observaciones, v.observacionesDelVale(estado, borrador));
  assert.deepEqual(borrador.copia_de, { tipo: "SALIDA", vale_id: original.id, folio: String(original.folio) });

  // Transferencia: autoriza y el texto propio de las observaciones sí se repiten.
  const t = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "TRANSFERENCIAS").id, fecha: "2026-10-03" });
  Object.assign(t, { destino: "OTRO EQUIPO", depto_destino: "ALMACEN", recibio_nombre: "PERSONA DESTINO", autorizo_nombre: "JEFE UNO", autorizo_puesto: "SUPERINTENDENTE", observaciones: "TRASPASO POR PRESTAMO" });
  t.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad: "1" });
  const [transferencia] = v.emitirBorrador(estado, t.id, { usuario: USUARIO });
  const copia = cv.borradorDesdeVale(estado, transferencia.id, { usuario: USUARIO }).borrador;
  assert.deepEqual([copia.destino, copia.autorizo_nombre, copia.autorizo_puesto, copia.observaciones], ["OTRO EQUIPO", "JEFE UNO", "SUPERINTENDENTE", "TRASPASO POR PRESTAMO"]);
});

test("si la partida ya no está: otra de la misma clave; sin ninguna, se pide elegir la clave o va sin existencia", () => {
  const { estado, indices, renglones } = preparar();
  const [balero1, , balero2] = renglones(701);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad: "1" }, { ...v.lineaDesdeExistencia(estado, renglones(706)[0].id), cantidad: "1" });
  const [original] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  // La partida del balero se dio de baja: queda la de la misma clave en otro contenedor.
  balero1.activo = false;
  let r = cv.borradorDesdeVale(estado, original.id, { usuario: USUARIO });
  assert.equal(r.borrador.lineas[0].existencia_id, balero2.id);
  assert.deepEqual(r.avisos, []);
  // Con la clave cambiada y otras variantes del código, se pide elegirla.
  original.lineas[0].clave = "OTRA CLAVE";
  original.lineas[0].variante_id = null;
  r = cv.borradorDesdeVale(estado, original.id, { usuario: USUARIO });
  assert.equal(r.borrador.lineas[0].existencia_id, null);
  assert.equal(r.borrador.lineas[0].cantidad, "1");
  assert.match(r.avisos[0], /^701: elige la clave/);
  // Un código que ya no está en el inventario va como partida sin existencia.
  for (const e of renglones(706)) e.activo = false;
  r = cv.borradorDesdeVale(estado, original.id, { usuario: USUARIO });
  assert.deepEqual([r.borrador.lineas[1].no_inventariado, r.borrador.lineas[1].clave], [true, "555001"]);
  assert.match(r.avisos.at(-1), /^706: ya no está en el inventario/);
  assert.throws(() => cv.borradorDesdeVale(estado, 9999), /No se encontró ese vale/);
});

test("buscar el vale: lo recibido hoy primero; E-0001, folio de la base o folio de salida", () => {
  const { estado, indices, renglones } = preparar();
  const hoy = hoyIso();
  const { vale } = entradaDeHoy(estado, indices, renglones);
  const vacia = cv.buscarValesParaCopiar(estado, "", { hoy });
  assert.deepEqual([vacia[0].vale.id, vacia[0].por], [vale.id, "hoy"]);
  assert.ok(vacia.some((h) => h.vale.tipo === "SALIDA"));
  assert.equal(cv.buscarValesParaCopiar(estado, "", { hoy: "2000-01-01" }).filter((h) => h.por === "hoy").length, 0);
  assert.deepEqual(cv.buscarValesParaCopiar(estado, "e-1", { hoy }).map((h) => [h.vale.id, h.por]), [[vale.id, "interno"]]);
  assert.deepEqual(cv.buscarValesParaCopiar(estado, "b200", { hoy }).map((h) => [h.vale.id, h.por, h.exacto]), [[vale.id, "base", true]]);
  const salida = estado.vales.find((x) => x.tipo === "SALIDA" && x.estado === "EMITIDO");
  const porNumero = cv.buscarValesParaCopiar(estado, String(salida.folio), { hoy });
  assert.deepEqual([porNumero[0].vale.id, porNumero[0].por], [salida.id, "salida"]);
  assert.deepEqual(cv.buscarValesParaCopiar(estado, "ZZZ-NADA", { hoy }), []);
  assert.equal(cv.nombreDeVale(vale), "la entrada E-0001");
  assert.equal(cv.nombreDeVale(salida), `el vale ${salida.folio}`);
  assert.deepEqual([cv.deVale(vale), cv.deVale(salida)], ["de la entrada E-0001", `del vale ${salida.folio}`]);
});
