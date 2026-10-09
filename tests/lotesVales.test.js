import assert from "node:assert/strict";
import { test } from "node:test";
import { resolverLoteVales } from "../src/servicios/lotesVales.js";

const salida = (folio, extra = {}) => ({ id: folio, folio, tipo: "SALIDA", estado: "EMITIDO", lineas: [], ...extra });
const folios = (resultado) => resultado.vales.map((vale) => vale.folio);

test("un lote vacío no selecciona vales ni produce avisos", () => {
  const estado = { vales: [salida(1)] };
  for (const texto of ["", " \t\r\n, ; \n"]) {
    assert.deepEqual(resolverLoteVales(estado, texto), {
      vales: [], faltantes: [], invalidos: [], repetidos: [], cancelados: [],
    });
  }
});

test("acepta folios pegados desde Excel y separados por espacios, comas y punto y coma", () => {
  const estado = { vales: [5, 1, 4, 2, 3, 6].map((folio) => salida(folio)) };
  const resultado = resolverLoteVales(estado, "3\t1\r\n5, 2;4  6");
  assert.deepEqual(folios(resultado), [3, 1, 5, 2, 4, 6]);
  assert.deepEqual(resultado.faltantes, []);
  assert.deepEqual(resultado.invalidos, []);
  assert.deepEqual(resultado.repetidos, []);
});

test("resuelve los 88 folios completos y conserva el orden de la lista", () => {
  const vales = Array.from({ length: 88 }, (_, i) => salida(1000 + i));
  const solicitados = vales.map((vale) => vale.folio).reverse();
  const resultado = resolverLoteVales({ vales }, solicitados.join("\n"));
  assert.equal(resultado.vales.length, 88);
  assert.deepEqual(folios(resultado), solicitados);
  assert.deepEqual(resultado.faltantes, []);
});

test("ceros iniciales y repeticiones seleccionan cada vale una sola vez", () => {
  const estado = { vales: [salida(12), salida(7)] };
  const resultado = resolverLoteVales(estado, "0007,0012;7 12 0007 00012");
  assert.deepEqual(folios(resultado), [7, 12]);
  assert.deepEqual(resultado.repetidos, [7, 12]);
  assert.deepEqual(resultado.faltantes, []);
  assert.deepEqual(resultado.invalidos, []);
});

test("informa faltantes y también detecta sus repeticiones sin duplicar avisos", () => {
  const resultado = resolverLoteVales({ vales: [salida(2)] }, "99 2 77 0099 77 99 2 2");
  assert.deepEqual(folios(resultado), [2]);
  assert.deepEqual(resultado.faltantes, [99, 77]);
  assert.deepEqual(resultado.repetidos, [99, 77, 2]);
});

test("rechaza signos, decimales, rangos, notación científica y folios no seguros", () => {
  const invalidos = ["0", "000", "-1", "+1", "1.5", "1e2", "10-20", "E-0001", "folio", "١", "１", "9007199254740992"];
  const resultado = resolverLoteVales({ vales: [salida(1)] }, `${invalidos.join(" ")} 1 1.5 folio 0`);
  assert.deepEqual(folios(resultado), [1]);
  assert.deepEqual(resultado.invalidos, invalidos);
  assert.deepEqual(resultado.faltantes, []);
  assert.deepEqual(resultado.repetidos, []);
});

test("acepta el mayor entero seguro y su representación con ceros iniciales", () => {
  const maximo = Number.MAX_SAFE_INTEGER;
  const vale = salida(maximo);
  const resultado = resolverLoteVales({ vales: [vale] }, `00${maximo} ${maximo}`);
  assert.deepEqual(folios(resultado), [maximo]);
  assert.deepEqual(resultado.repetidos, [maximo]);
  assert.deepEqual(resultado.invalidos, []);
  assert.strictEqual(resultado.vales[0], vale);
});

test("busca únicamente salidas aunque una entrada tenga el mismo folio", () => {
  const entrada = salida(7, { id: 70, tipo: "ENTRADA" });
  const vale = salida(7);
  const soloEntrada = salida(8, { id: 80, tipo: "ENTRADA" });
  const resultado = resolverLoteVales({ vales: [entrada, soloEntrada, vale] }, "7 8");
  assert.deepEqual(resultado.vales, [vale]);
  assert.strictEqual(resultado.vales[0], vale);
  assert.deepEqual(resultado.faltantes, [8]);
});

test("incluye los vales cancelados e informa sus folios una sola vez", () => {
  const cancelado = salida(9, { estado: "CANCELADO" });
  const resultado = resolverLoteVales({ vales: [salida(3), cancelado] }, "9 3 009");
  assert.deepEqual(folios(resultado), [9, 3]);
  assert.deepEqual(resultado.cancelados, [9]);
  assert.deepEqual(resultado.repetidos, [9]);
});

test("resolver un lote no cambia el estado, el orden original ni los vales", () => {
  const vales = [salida(30), salida(10), salida(20, { estado: "CANCELADO" })];
  for (const vale of vales) {
    Object.freeze(vale.lineas);
    Object.freeze(vale);
  }
  const estado = Object.freeze({ vales: Object.freeze(vales), config: Object.freeze({ usuario: "ALMACENISTA" }) });
  const antes = structuredClone(estado);
  const resultado = resolverLoteVales(estado, "20 10 10 40 inválido 30");
  assert.deepEqual(folios(resultado), [20, 10, 30]);
  assert.deepEqual(estado, antes);
  assert.strictEqual(resultado.vales[0], vales[2]);
  assert.strictEqual(resultado.vales[1], vales[1]);
  assert.strictEqual(resultado.vales[2], vales[0]);
});
