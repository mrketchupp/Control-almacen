// Ronda 39, etapa 2 (docs/14 §3–§4): el vale de entrada en 4 pasos — en qué paso está un borrador, qué falta para
// pasar del 1 al 2 y lo que el paso 1 toma de los datos (orígenes, quién entrega y su puesto, lo que leyó Copilot).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import * as en from "../src/servicios/entradas.js";
import {
  PASOS_ENTRADA,
  esOrigenFrecuente,
  faltaDeDondeViene,
  faltaMaterialEntrada,
  faltaParaAvanzarEntrada,
  leerRespuestaCopilot,
  nombrePasoEntrada,
  origenesFrecuentes,
  pasoDeEntrada,
  puestoDeQuienEntrega,
  quienesEntregan,
} from "../src/servicios/pasosEntrada.js";
import { estadoDePasos } from "../src/servicios/pasosVale.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const campos = (falta) => falta.map((f) => [f.campo, f.mensaje]);

/** Registra una entrada con una partida (un balero) y devuelve la entrada. */
function registrar(estado, { origen, folio, entrego = "", puesto = "", recibido = "2026-10-02", creada = null }) {
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-01", fechaRecibido: recibido });
  Object.assign(b, { folio_externo: folio, origen, entrego_nombre: entrego, entrego_puesto: puesto });
  b.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "1" }];
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  if (creada) Object.assign(vale, { emitido_en: creada, creado_en: creada });
  return vale;
}

test("los 4 pasos; un borrador nuevo empieza en el 1 y el paso no llega a la entrada registrada", () => {
  assert.deepEqual(PASOS_ENTRADA.map((p) => `${p.numero} · ${p.nombre}`), ["1 · De dónde viene", "2 · Material", "3 · Acomodo", "4 · Revisar y registrar"]);
  assert.equal(nombrePasoEntrada(3), "Acomodo");
  assert.deepEqual(estadoDePasos(2, PASOS_ENTRADA).map((p) => p.estado), ["completo", "actual", "pendiente", "pendiente"]);
  const { estado } = cargaSintetica();
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  assert.equal(b.paso, 1);
  assert.equal(pasoDeEntrada(b), 1);
  // Un borrador de antes de la Ronda 39 (sin paso) o con un paso que no existe empieza en el 1.
  assert.equal(pasoDeEntrada({ ...b, paso: undefined }), 1);
  assert.equal(pasoDeEntrada({ ...b, paso: 7 }), 1);
  assert.equal(pasoDeEntrada({ ...b, paso: 3 }), 3);
  b.paso = 2;
  const vale = registrar(estado, { origen: "BASE PRUEBA", folio: "B-1" });
  assert.equal("paso" in vale, false);
  assert.equal(estado.vales.filter((v) => v.tipo === "ENTRADA").some((v) => "paso" in v), false);
});

test("del 1 al 2: folio, de dónde viene, las dos fechas y quién recibe (lo de validarEntrada), con textos cortos", () => {
  const { estado } = cargaSintetica();
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(b, { origen: "", fecha: "", fecha_recibido: "" });
  assert.deepEqual(campos(faltaDeDondeViene(estado, b, { usuario: USUARIO })), [
    ["fecha", "Falta la fecha del vale"],
    ["fecha_recibido", "Falta la fecha de recibido"],
    ["folio_externo", "Falta el folio del vale"],
    ["origen", "Falta de dónde viene"],
  ]);
  // Las partidas no cuentan en el paso 1 (la entrada todavía no tiene).
  Object.assign(b, { origen: "BASE PRUEBA", fecha: "2026-10-01", fecha_recibido: "2026-10-02", folio_externo: "B-9" });
  assert.deepEqual(faltaDeDondeViene(estado, b, { usuario: USUARIO }), []);
  assert.deepEqual(faltaParaAvanzarEntrada(estado, b, 1, { usuario: USUARIO }), []);
  // Sin almacenista en turno no hay quién reciba.
  assert.deepEqual(campos(faltaDeDondeViene(estado, { ...b, recibio_nombre: "" }, { usuario: null })), [
    ["recibio_nombre", "Elige quién está en turno (arriba a la derecha)"],
  ]);
  // Una regla que no se cumple se dice con su texto (sin el punto final).
  assert.deepEqual(campos(faltaDeDondeViene(estado, { ...b, fecha_recibido: "2999-01-01" }, { usuario: USUARIO })), [
    ["fecha_recibido", "La fecha de recibido no puede ser futura"],
  ]);
});

test("folio de la base ya registrado: se pide marcarlo, con un texto corto junto al campo", () => {
  const { estado } = cargaSintetica();
  registrar(estado, { origen: "BASE PRUEBA", folio: "B-400" });
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(b, { origen: "BASE PRUEBA", folio_externo: "B-400" });
  assert.deepEqual(campos(faltaDeDondeViene(estado, b, { usuario: USUARIO })), [["folio_externo", "Ese folio ya está registrado: márcalo si es otro vale"]]);
  assert.deepEqual(faltaDeDondeViene(estado, { ...b, folio_repetido: true }, { usuario: USUARIO }), []);
});

test("del 2 al 3: al menos una partida con código y cantidad", () => {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  const falta = [["lineas", "Agrega al menos una partida con su cantidad"]];
  assert.deepEqual(campos(faltaMaterialEntrada(b)), falta);
  const linea = en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices);
  assert.deepEqual(campos(faltaMaterialEntrada({ ...b, lineas: [{ ...linea, cantidad: "" }] })), falta);
  assert.deepEqual(campos(faltaMaterialEntrada({ ...b, lineas: [{ ...linea, cantidad: "1e5" }] })), falta);
  assert.deepEqual(campos(faltaMaterialEntrada({ ...b, lineas: [{ ...linea, cantidad: "0" }] })), falta);
  assert.deepEqual(faltaMaterialEntrada({ ...b, lineas: [{ ...linea, cantidad: "2" }, en.lineaEntradaVacia()] }), []);
  assert.deepEqual(faltaParaAvanzarEntrada(estado, { ...b, lineas: [{ ...linea, cantidad: "2" }] }, 2), []);
  // El acomodo y el registro llegan en las etapas siguientes.
  assert.deepEqual(faltaParaAvanzarEntrada(estado, b, 4), []);
});

test("«Viene de»: los orígenes de las entradas, del más usado al menos; si empatan, el más reciente", () => {
  const { estado } = cargaSintetica();
  assert.deepEqual(origenesFrecuentes(estado), []);
  registrar(estado, { origen: "BASE NORTE", folio: "N-1", creada: "2026-10-01T10:00:00.000Z" });
  registrar(estado, { origen: "base prueba", folio: "B-1", creada: "2026-10-02T10:00:00.000Z" });
  registrar(estado, { origen: "BASE PRUEBA", folio: "B-2", creada: "2026-10-03T10:00:00.000Z" });
  registrar(estado, { origen: "RIG 48", folio: "R-1", creada: "2026-10-04T10:00:00.000Z" });
  // BASE PRUEBA dos veces (como se escribió la última vez); RIG 48 y BASE NORTE una vez, primero la más reciente.
  assert.deepEqual(origenesFrecuentes(estado), ["BASE PRUEBA", "RIG 48", "BASE NORTE"]);
  assert.deepEqual(origenesFrecuentes(estado, { limite: 2 }), ["BASE PRUEBA", "RIG 48"]);
  assert.equal(esOrigenFrecuente(origenesFrecuentes(estado), "rig 48"), true);
  assert.equal(esOrigenFrecuente(origenesFrecuentes(estado), "BASE SUR"), false);
});

test("quién entrega: los que han entregado (el más reciente primero) y luego la lista; el puesto es el último suyo", () => {
  const { estado } = cargaSintetica();
  registrar(estado, { origen: "BASE PRUEBA", folio: "B-1", entrego: "CHOFER UNO", puesto: "CHOFER", creada: "2026-10-01T10:00:00.000Z" });
  registrar(estado, { origen: "BASE PRUEBA", folio: "B-2", entrego: "CHOFER UNO", puesto: "OPERADOR", creada: "2026-10-03T10:00:00.000Z" });
  registrar(estado, { origen: "BASE NORTE", folio: "N-1", entrego: "CHOFER DOS", puesto: "CHOFER", creada: "2026-10-02T10:00:00.000Z" });
  const nombres = quienesEntregan(estado);
  assert.deepEqual(nombres.slice(0, 2), ["CHOFER UNO", "CHOFER DOS"]);
  assert.ok(nombres.includes(USUARIO));
  assert.equal(new Set(nombres).size, nombres.length);
  assert.equal(puestoDeQuienEntrega(estado, "chofer uno"), "OPERADOR");
  // Quien nunca entregó una entrada: el puesto de la lista de personas.
  assert.equal(puestoDeQuienEntrega(estado, "SOLDADOR UNO"), "SOLDADOR");
  assert.equal(puestoDeQuienEntrega(estado, "NADIE"), "");
  assert.equal(puestoDeQuienEntrega(estado, ""), "");
});

test("lo que leyó Copilot se calcula sin tocar el borrador: datos del vale y resumen de las partidas", () => {
  const { estado } = cargaSintetica();
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  const antes = structuredClone(b);
  const respuesta = {
    tipo: "vale_entrada",
    folio: "B-500",
    fecha: "2026-10-20",
    viene_de: "base norte",
    entrego: "chofer dos",
    partidas: [
      { oc: "4500123", cantidad: 4, codigo: "701", descripcion: "BALEROS", dimension: "6309-2Z/C3", um: "PZA", lote: "J. PEREZ" },
      { oc: "S/OC", cantidad: 10, codigo: "704", descripcion: "EMPAQUE", dimension: '6"', np: "FLEXITALIC", um: "PZA", dudoso: true },
      { cantidad: 2, codigo: "701", descripcion: "BALEROS", dimension: "6311-2RS", um: "PZA" },
    ],
  };
  const leido = leerRespuestaCopilot(estado, b, respuesta);
  assert.deepEqual(b, antes);
  assert.deepEqual(leido.leido, { origen: "BASE NORTE", folio: "B-500", fecha: "2026-10-20", entrego: "CHOFER DOS" });
  assert.deepEqual([leido.partidas, leido.porRevisar, leido.variantesNuevas, leido.sinCodigo, leido.sinClave], [3, 1, 1, 0, 0]);
  assert.deepEqual(leido.reporte.dudosas, [2]);
  assert.equal(en.lineasEntradaCapturadas(leido.datos.lineas).length, 3);
  assert.deepEqual(faltaDeDondeViene(estado, leido.datos, { usuario: USUARIO }), []);
  // Sin datos del vale (solo partidas): el paso 1 sigue pidiendo el folio y el origen (§11; sin entradas anteriores,
  // el borrador nuevo no trae origen).
  const solo = leerRespuestaCopilot(estado, b, { partidas: respuesta.partidas.slice(0, 1) });
  assert.deepEqual(solo.leido, { origen: "", folio: "", fecha: b.fecha, entrego: "" });
  assert.deepEqual(campos(faltaDeDondeViene(estado, solo.datos, { usuario: USUARIO })), [
    ["folio_externo", "Falta el folio del vale"],
    ["origen", "Falta de dónde viene"],
  ]);
});
