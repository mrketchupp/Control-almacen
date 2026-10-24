import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { aplicarEntradaIA } from "../src/servicios/capturaIA.js";
import * as en from "../src/servicios/entradas.js";
import { cargaSintetica } from "./ayuda.js";

function escenario() {
  const { estado } = cargaSintetica(), indices = new Indices(estado);
  // Dimensión 6", NP FLEXITALIC: toda la información es de los Excel sintéticos.
  const sugerida = en.entradaConArticulo(estado, en.lineaEntradaVacia(), 704, { indices });
  const b = en.nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO", fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "BASE-SINTETICA", origen: "BASE PRUEBA" });
  return { estado, indices, sugerida, b };
}

test("crear material nuevo conserva dimensión y contenedor sin recuperar un NP heredado al salir del campo", () => {
  const { estado, indices, sugerida, b } = escenario();
  const originales = structuredClone(estado.variantes), saldoOriginal = calcularSaldos(estado).get(sugerida.existencia_id).total.toFixed();
  let nueva = en.conMaterialNuevo(estado, { ...sugerida, cantidad: "3" }, { indices });
  assert.deepEqual([nueva.clave, nueva.dimension, nueva.np, nueva.um], ['6"', '6"', "", "PZA"]);
  assert.equal(nueva.ubicacion_id, indices.existencia(sugerida.existencia_id).ubicacion_id);
  assert.equal(nueva.material_nuevo, true);
  assert.equal(nueva.existencia_id, null);
  nueva = en.conClaveEscrita(estado, nueva, "", { indices });
  assert.equal(nueva.material_nuevo, true);
  nueva = en.conClaveEscrita(estado, nueva, '6"', { indices });
  nueva = en.conClaveYNp(estado, nueva, { indices });
  nueva = en.conClaveYNp(estado, en.conNpEscrito(estado, nueva, "", { indices }), { indices });
  assert.deepEqual([nueva.material_nuevo, nueva.np, nueva.existencia_id], [true, "", null]);
  assert.equal(en.destinoDe(estado, nueva, indices).tipo, "nuevo");
  b.lineas = [nueva];
  const vale = en.confirmarEntrada(estado, b.id, { usuario: "ALMACENISTA UNO" });
  const variante = new Indices(estado).variante(vale.lineas[0].variante_id);
  assert.deepEqual([variante.dimension, variante.np, variante.um], ['6"', null, "PZA"]);
  assert.notEqual(vale.lineas[0].existencia_id, sugerida.existencia_id);
  assert.equal(calcularSaldos(estado).get(vale.lineas[0].existencia_id).total.toFixed(), "3");
  assert.equal(calcularSaldos(estado).get(sugerida.existencia_id).total.toFixed(), saldoOriginal);
  assert.deepEqual(estado.variantes.filter((v) => originales.some((o) => o.id === v.id)), originales);
});

test("el mismo tamaño con otro NP entra a su propia variante y elegir explícitamente una existente sale del modo nuevo", () => {
  const { estado, indices, sugerida, b } = escenario();
  let nueva = en.conMaterialNuevo(estado, { ...sugerida, cantidad: "2" }, { indices });
  nueva = en.conNpEscrito(estado, nueva, "NP-SINTETICO-NUEVO", { indices });
  nueva = en.conClaveYNp(estado, nueva, { indices });
  assert.deepEqual([nueva.material_nuevo, nueva.dimension, nueva.np, nueva.existencia_id], [true, '6"', "NP-SINTETICO-NUEVO", null]);
  const elegida = en.conRenglonExistente(estado, nueva, sugerida.existencia_id, indices);
  assert.equal(elegida.material_nuevo, false);
  assert.equal(elegida.np, "FLEXITALIC");
  b.lineas = [nueva];
  const vale = en.confirmarEntrada(estado, b.id);
  const v = new Indices(estado).variante(vale.lineas[0].variante_id);
  assert.deepEqual([v.dimension, v.np], ['6"', "NP-SINTETICO-NUEVO"]);
  assert.notEqual(v.id, sugerida.variante_id);
  assert.equal(indices.variante(sugerida.variante_id).np, "FLEXITALIC");
});

test("una identidad exacta se reutiliza al confirmar y otro contenedor obtiene su partida sin duplicar variante", () => {
  const { estado, indices, sugerida, b } = escenario();
  const variantesAntes = estado.variantes.length, existenciasAntes = estado.existencias.length;
  let nueva = en.conMaterialNuevo(estado, { ...sugerida, cantidad: "2" }, { indices });
  nueva = en.conClaveYNp(estado, en.conNpEscrito(estado, nueva, "FLEXITALIC", { indices }), { indices });
  assert.equal(nueva.material_nuevo, true);
  assert.equal(nueva.existencia_id, null);
  assert.equal(en.destinoDe(estado, nueva, indices).existencia.id, sugerida.existencia_id);
  const otraUbicacion = estado.ubicaciones.find((u) => !estado.existencias.some((e) => e.variante_id === sugerida.variante_id && e.ubicacion_id === u.id));
  nueva = en.conContenedor(estado, nueva, otraUbicacion.id, indices);
  b.lineas = [nueva];
  const vale = en.confirmarEntrada(estado, b.id);
  assert.equal(estado.variantes.length, variantesAntes);
  assert.equal(estado.existencias.length, existenciasAntes + 1);
  assert.equal(vale.lineas[0].variante_id, sugerida.variante_id);
  assert.notEqual(vale.lineas[0].existencia_id, sugerida.existencia_id);
  assert.equal(estado.existencias.find((e) => e.id === vale.lineas[0].existencia_id).ubicacion_id, otraUbicacion.id);
});

test("dejar el NP vacío en captura manual no lo usa como comodín para otra variante", () => {
  const { estado, indices, sugerida } = escenario();
  const sinNp = en.conClaveYNp(estado, en.conNpEscrito(estado, sugerida, "", { indices }), { indices });
  assert.deepEqual([sinNp.np, sinNp.existencia_id, sinNp.alta], ["", null, true]);
  assert.equal(en.destinoDe(estado, sinNp, indices).tipo, "nuevo");
});

test("captura asistida con el mismo tamaño y NP vacío o distinto no se mezcla con el NP del inventario", () => {
  for (const np of ["", "NP-SINTETICO-OTRO"]) {
    const { estado, b, sugerida } = escenario();
    const { datos } = aplicarEntradaIA(estado, b, { partidas: [{ codigo: "704", cantidad: 2, dimension: '6"', np, um: "PZA" }] });
    const [l] = en.lineasEntradaCapturadas(datos.lineas);
    assert.deepEqual([l.alta, l.np, l.existencia_id], [true, np, null]);
    b.lineas = datos.lineas;
    const vale = en.confirmarEntrada(estado, b.id);
    const variante = new Indices(estado).variante(vale.lineas[0].variante_id);
    assert.deepEqual([variante.dimension, variante.np], ['6"', np || null]);
    assert.notEqual(vale.lineas[0].variante_id, sugerida.variante_id);
  }
});
