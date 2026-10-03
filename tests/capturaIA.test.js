// Captura asistida: se lee el JSON que devuelve el asistente y se llena el borrador.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ErrorCapturaIA,
  INSTRUCCIONES,
  aplicarConteoIA,
  aplicarEntradaIA,
  describirArreglos,
  interpretarRespuesta,
  leerRespuesta,
  ubicacionPorNombre,
} from "../src/servicios/capturaIA.js";
import * as co from "../src/servicios/conteos.js";
import * as en from "../src/servicios/entradas.js";
import { cargaSintetica } from "./ayuda.js";

test("se lee el bloque JSON aunque venga con texto alrededor, comillas tipográficas o comas sobrantes", () => {
  const pegado = 'Aquí está:\n```json\n{ "tipo": "vale_entrada", "folio": “123”, "partidas": [ {"codigo": "000000701",}, ], }\n```\nSaludos';
  assert.deepEqual(leerRespuesta(pegado), { tipo: "vale_entrada", folio: "123", partidas: [{ codigo: "000000701" }] });
  assert.throws(() => leerRespuesta(""), ErrorCapturaIA);
  assert.throws(() => leerRespuesta("no hay json"), /No encontré/);
  assert.deepEqual(leerRespuesta('{"a": [1, 2}'), { a: [1, 2] });
  assert.match(INSTRUCCIONES.entrada.texto, /"partidas"/);
  assert.match(INSTRUCCIONES.entrada.texto, /"lote"/);
  assert.match(INSTRUCCIONES.conteo.texto, /"hojas"/);
});

test("si Copilot deja el JSON mal cerrado o con errores, se arregla solo y se avisa", () => {
  // Cortado a la mitad de una partida, sin cerrar el bloque de código.
  const cortado = '```json\n{ "folio": "77", "partidas": [ {"codigo": "701", "cantidad": 2}, {"codigo": "704", "cantidad": 3, "descripcion": "EMPAQ';
  const a = interpretarRespuesta(cortado);
  assert.equal(a.datos.partidas.length, 2);
  assert.equal(a.datos.partidas[1].descripcion, "EMPAQ");
  assert.ok(a.arreglos.includes("venía cortada"));
  assert.match(describirArreglos(a.arreglos), /cortada/);
  // Comas que faltan, claves sin comillas, comillas sencillas, True/None, comentarios y 6" sin escapar.
  const sucio = `{
    folio: '12',
    partidas: [
      { codigo: "000000704" cantidad: 1, dimension: "6"", dudoso: True, np: None } // revisar
      { "codigo": "701", "cantidad": 2.5, um: PZA, }
    ]
  }`;
  const b = interpretarRespuesta(sucio);
  assert.deepEqual(b.datos, {
    folio: "12",
    partidas: [
      { codigo: "000000704", cantidad: 1, dimension: '6"', dudoso: true, np: null },
      { codigo: "701", cantidad: 2.5, um: "PZA" },
    ],
  });
  assert.ok(b.arreglos.length > 0);
  // Una lista sola (sin encabezado) y varias hojas en bloques separados se juntan.
  assert.deepEqual(leerRespuesta('[{"codigo": "701"}]'), [{ codigo: "701" }]);
  const dos = 'Hoja 1:\n```json\n{"folio": "9", "partidas": [{"codigo": "701"}]}\n```\nHoja 2:\n```json\n{"partidas": [{"codigo": "704"}]}\n```';
  assert.deepEqual(leerRespuesta(dos), { folio: "9", partidas: [{ codigo: "701" }, { codigo: "704" }] });
  // Bien formado: sin arreglos.
  assert.deepEqual(interpretarRespuesta('{"a": 1}').arreglos, []);
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
      { cantidad: 4, codigo: "704", dimension: '6"', np: "FLEXITALIC", um: "PZA", lote: "solicitante  uno" },
    ],
  };
  const { datos, reporte } = aplicarEntradaIA(estado, b, respuesta);
  assert.deepEqual([datos.folio_externo, datos.fecha, datos.origen, datos.entrego_nombre], ["B-55", "2026-10-05", "BASE PRUEBA", "CHOFER UNO"]);
  const [balero, nuevo, sinCodigo, empaque] = en.lineasEntradaCapturadas(datos.lineas);
  // El existente se elige con la clave (el sugerido, el de más existencia).
  assert.equal(en.destinosDeCodigo(estado, 701).find((o) => o.id === balero.existencia_id).sugerida, true);
  assert.deepEqual([balero.cantidad, balero.oc], ["3", ""]);
  assert.deepEqual([nuevo.alta, nuevo.clave, nuevo.cantidad, nuevo.dudoso, nuevo.um], [true, "6315", "2.5", true, "PZA"]);
  // La variante nueva queda en el contenedor donde ya vive el código (el de más existencia).
  assert.equal(estado.ubicaciones.find((u) => u.id === nuevo.ubicacion_id).hoja_excel.trim(), "CONTENEDOR #1 INVENTARIABLE");
  assert.equal(en.destinoDe(estado, nuevo).tipo, "nuevo");
  assert.equal(sinCodigo.codigo, null);
  // LOTE = quien solicita (no el NP).
  assert.equal(empaque.lote, "SOLICITANTE UNO");
  assert.equal(balero.lote, "");
  assert.deepEqual(reporte, { partidas: 4, conRenglon: 2, nuevas: 1, sinCodigo: [3], sinClave: [], dudosas: [2] });
  // Sin clave legible y con varias en el inventario: queda para elegirla (no se inventa una variante).
  const sinClave = aplicarEntradaIA(estado, b, { partidas: [{ codigo: "701", cantidad: 1 }] });
  assert.deepEqual(sinClave.reporte.sinClave, [1]);
  const [pendiente] = en.lineasEntradaCapturadas(sinClave.datos.lineas);
  assert.deepEqual([pendiente.existencia_id, pendiente.alta], [null, false]);
  assert.throws(() => aplicarEntradaIA(estado, b, { hojas: [] }), /partidas/);
  // Nombres distintos a los pedidos (renglones, clave, solicita, unidad) y una lista sin encabezado.
  const otra = aplicarEntradaIA(estado, b, { Folio: "B-56", Renglones: [{ Código: "708", Cant: "1", Unidad: "kg", Solicita: "persona dos" }] });
  assert.equal(otra.datos.folio_externo, "B-56");
  const [grasa] = en.lineasEntradaCapturadas(otra.datos.lineas);
  assert.deepEqual([grasa.codigo, grasa.cantidad, grasa.lote], [708, "1", "PERSONA DOS"]);
  assert.equal(aplicarEntradaIA(estado, b, [{ codigo: "708", cantidad: 2 }]).reporte.partidas, 1);
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
