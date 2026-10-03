// Captura asistida: se lee el JSON que devuelve el asistente y se llena el borrador.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorCapturaIA, INSTRUCCIONES, aplicarConteoIA, aplicarEntradaIA, leerRespuesta, ubicacionPorNombre } from "../src/servicios/capturaIA.js";
import * as co from "../src/servicios/conteos.js";
import * as en from "../src/servicios/entradas.js";
import { cargaSintetica } from "./ayuda.js";

test("se lee el bloque JSON aunque venga con texto alrededor, comillas tipográficas o comas sobrantes", () => {
  const pegado = 'Aquí está:\n```json\n{ "tipo": "vale_entrada", "folio": “123”, "partidas": [ {"codigo": "000000701",}, ], }\n```\nSaludos';
  assert.deepEqual(leerRespuesta(pegado), { tipo: "vale_entrada", folio: "123", partidas: [{ codigo: "000000701" }] });
  assert.throws(() => leerRespuesta(""), ErrorCapturaIA);
  assert.throws(() => leerRespuesta("no hay json"), /No encontré/);
  assert.throws(() => leerRespuesta('{"a": [1, 2}'), /mal formado/);
  assert.match(INSTRUCCIONES.entrada.texto, /"partidas"/);
  assert.match(INSTRUCCIONES.conteo.texto, /"hojas"/);
});

test("vale de entrada: encabezado, renglón existente, variante nueva y código ilegible", () => {
  const { estado } = cargaSintetica();
  const b = en.nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO" });
  const respuesta = {
    folio: "B-55",
    fecha: "05/10/2026",
    viene_de: "base prueba",
    entrego: "chofer uno",
    partidas: [
      { oc: "S/OC", cantidad: "3", codigo: "000000701", descripcion: "BALEROS", dimension: "6309 2Z/C3", um: "PZA" },
      { oc: "4500123", cantidad: 2.5, codigo: "701", dimension: "6315", um: "pza", dudoso: true },
      { cantidad: 1, codigo: "", descripcion: "ALGO", dimension: "X" },
      { cantidad: 4, codigo: "704", dimension: '6"', np: "FLEXITALIC", um: "PZA" },
    ],
  };
  const { datos, reporte } = aplicarEntradaIA(estado, b, respuesta);
  assert.deepEqual([datos.folio_externo, datos.fecha, datos.origen, datos.entrego_nombre], ["B-55", "2026-10-05", "BASE PRUEBA", "CHOFER UNO"]);
  const [balero, nuevo, sinCodigo, empaque] = en.lineasEntradaCapturadas(datos.lineas);
  // El existente se elige con la clave (el sugerido, el de más existencia).
  assert.equal(en.destinosDeCodigo(estado, 701).find((o) => o.id === balero.existencia_id).sugerida, true);
  assert.deepEqual([balero.cantidad, balero.oc], ["3", ""]);
  assert.deepEqual([nuevo.alta, nuevo.clave, nuevo.cantidad, nuevo.dudoso, nuevo.um], [true, "6315", "2.5", true, "PZA"]);
  assert.equal(sinCodigo.codigo, null);
  assert.equal(empaque.lote, "FLEXITALIC");
  assert.deepEqual(reporte, { partidas: 4, conRenglon: 2, nuevas: 1, sinCodigo: [3], dudosas: [2] });
  assert.throws(() => aplicarEntradaIA(estado, b, { hojas: [] }), /partidas/);
});

test("conteo: por contenedor + ITEM, por código si el ITEM no cuadra, encontrados y contenedores fuera del conteo", () => {
  const { estado } = cargaSintetica();
  const c1inv = ubicacionPorNombre(estado, "Contenedor #1 inventariable");
  assert.equal(c1inv.hoja_excel, "CONTENEDOR #1 INVENTARIABLE");
  assert.equal(ubicacionPorNombre(estado, "#1 Cons.").hoja_excel.trim(), "CONTENEDOR #1 CONSUMIBLE");
  const datos = co.iniciarConteo(estado, { ubicaciones: [c1inv.id] });
  const renglones = co.renglonesDelConteo(estado);
  const respuesta = {
    fecha: "2026-10-06",
    hojas: [
      {
        contenedor: "CONTENEDOR #1 INVENTARIABLE",
        renglones: [
          { item: 1, codigo: "701", contado: 6 },
          { item: 9, codigo: "706", dimension: "555001", contado: "1" }, // ITEM equivocado: se busca por código
          { item: 3, codigo: "707", contado: "", dudoso: true },
          { codigo: "701", dimension: "6400", um: "PZA", contado: 2 }, // renglón en blanco llenado a mano
          { codigo: "707", dimension: 'MARIPOSA 6"', um: "PZA", contado: 1 }, // otra dimensión del único 707: es encontrado
        ],
      },
      { contenedor: "CONTENEDOR #2 CONSUMIBLE", renglones: [{ item: 1, contado: 3 }] },
    ],
  };
  const { datos: nuevo, reporte } = aplicarConteoIA(estado, datos, respuesta);
  assert.equal(nuevo.fecha, "2026-10-06");
  assert.equal(nuevo.capturas[renglones[0].id], "6");
  assert.equal(nuevo.capturas[renglones.find((r) => r.codigo === 706).id], "1");
  assert.equal(nuevo.nuevos[0].dimension, "6400");
  assert.equal(reporte.capturados, 2);
  assert.equal(reporte.sobrantes, 2);
  assert.equal(nuevo.nuevos[1].dimension, 'MARIPOSA 6"');
  assert.equal(reporte.fueraDeAlcance.length, 1);
  assert.match(reporte.noReconocidos[0], /no se leyó la cantidad/);
  // Lo cargado se guarda y aplica como una captura normal.
  co.guardarConteoEnCurso(estado, nuevo);
  assert.equal(co.resumenConteo(estado).contados, 2);
});
