// Ronda 39, etapa 6 (docs/14 §8): lo que la vista de corrección marca — filas del resumen y partidas que cambiaron — y
// el efecto de la corrección en el inventario.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { efectosEnInventario, encabezadoCambiado, partidasCambiadas } from "../src/servicios/correccion.js";
import * as en from "../src/servicios/entradas.js";
import * as v from "../src/servicios/vales.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function valeEmitido() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const filtros = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 702);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-01" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, filtros.id), cantidad: "4" });
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  return { estado, indices, vale, filtros };
}

test("las filas del resumen que cambiaron (salida y entrada)", () => {
  const antes = { recibio_nombre: "MECANICO UNO", recibio_puesto: "MECANICO", fecha: "2026-10-01", entrego_puesto: "ALMACENISTA", origen: "BASE", folio_externo: "B-1" };
  assert.deepEqual([...encabezadoCambiado(antes, { ...antes, recibio_puesto: "SOLDADOR" })], ["puesto"]);
  assert.deepEqual([...encabezadoCambiado(antes, { ...antes, entrego_puesto: "" })], ["entrega"]);
  assert.deepEqual([...encabezadoCambiado(antes, { ...antes, recibio_nombre: "mecanico uno" })], []);
  assert.deepEqual([...encabezadoCambiado(antes, { ...antes, folio_externo: "B-2", fecha: "2026-10-02" }, "ENTRADA")], ["origen", "fecha"]);
});

test("las partidas que cambiaron: la cantidad anterior, otra clave o nueva", () => {
  const antes = [
    { uid: "a", codigo: 702, existencia_id: 1, cantidad: "4", um: "PZA", lote: "" },
    { uid: "b", codigo: 702, existencia_id: 2, cantidad: "1", um: "PZA", lote: "" },
  ];
  const ahora = [
    { ...antes[0], cantidad: "3" },
    { ...antes[1], lote: "J. PEREZ" },
    { uid: "c", codigo: 704, existencia_id: 3, cantidad: "2", um: "PZA" },
  ];
  assert.deepEqual([...partidasCambiadas(antes, ahora)], [["a", { antes: "4 PZA" }], ["b", { antes: null }], ["c", { nueva: true }]]);
  assert.equal(partidasCambiadas(antes, antes.map((l) => ({ ...l, cantidad: `${l.cantidad}.0` }))).size, 0);
});

test("el efecto en el inventario: lo que regresa o sale de más en una salida; lo que suma o resta una entrada", () => {
  const { estado, indices, vale, filtros } = valeEmitido();
  const datos = v.datosParaCorregir(estado, vale.id);
  const menos = { ...datos, lineas: datos.lineas.map((l) => ({ ...l, cantidad: "3" })) };
  const [regresa] = efectosEnInventario(estado, vale, menos, { indices });
  assert.match(regresa, /^Regresa 1 PZA a #1 Cons\. \(queda \d+\)$/);
  const mas = { ...datos, lineas: datos.lineas.map((l) => ({ ...l, cantidad: "6" })) };
  assert.match(efectosEnInventario(estado, vale, mas, { indices })[0], /^Sale 2 PZA más de #1 Cons\./);
  assert.deepEqual(efectosEnInventario(estado, vale, datos, { indices }), []);
  assert.deepEqual(efectosEnInventario(estado, vale, menos, { indices, historial: true }), []);
  // Entrada: más cantidad suma; una partida que ahora va a otro contenedor resta de uno y crea la otra.
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-01", fechaRecibido: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-9", origen: "BASE PRUEBA" });
  b.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), filtros.id, indices), cantidad: "2" }];
  const entrada = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const i2 = new Indices(estado);
  const corr = en.datosParaCorregirEntrada(estado, entrada.id);
  assert.match(efectosEnInventario(estado, entrada, { ...corr, lineas: corr.lineas.map((l) => ({ ...l, cantidad: "5" })) }, { indices: i2 })[0], /^Suma 3 PZA a #1 Cons\./);
  const otraHoja = estado.ubicaciones.find((u) => u.contenedor === 2 && u.clase === "CONS");
  const movida = { ...corr, lineas: corr.lineas.map((l) => ({ ...l, existencia_id: null, ubicacion_id: otraHoja.id })) };
  assert.deepEqual(
    efectosEnInventario(estado, entrada, movida, { indices: i2 }).map((t) => t.replace(/\(queda [^)]*\)/, "(queda …)")),
    ["Resta 2 PZA a #1 Cons. (queda …)", "Partida nueva en #2 Cons.: 2 PZA"],
  );
});
