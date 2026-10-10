import assert from "node:assert/strict";
import { test } from "node:test";
import { siguienteId } from "../src/nucleo/estado.js";
import { conciliar } from "../src/servicios/conciliacion.js";
import { corregirYVincularFisico, preverCorreccionAx, preverVinculoCorregido } from "../src/servicios/correccionAx.js";
import { datosCorreccion, deshacerCorreccion } from "../src/servicios/deshacerCorreccion.js";
import { escenarioGruposAx } from "./ayudaGruposAx.js";

const escenario = () => escenarioGruposAx(undefined, { segundaDimension: "MODELO SINTETICO" });
const datos = (e, varianteIds = [e.uno.v.id, e.dos.v.id]) => ({ corteId: e.corte.id, lineaIds: [1], varianteIds });
const fila = (e) => conciliar(e.estado, e.corte).renglones.find((f) => f.lineas.some((l) => l.id === 1));

test("prever una corrección a AX muestra físico conjunto, resultado y etiquetas sin guardar", () => {
  const e = escenario(), antes = JSON.stringify(e.estado);
  const p = preverCorreccionAx(e.estado, { corteId: e.corte.id, lineaId: 1, cual: { varianteId: e.dos.v.id }, dimension: "150VA", np: e.dos.v.np });
  assert.equal(p.etiquetas, 1);
  assert.deepEqual([p.comparacion.ax.toFixed(), p.comparacion.fisico.toFixed(), p.comparacion.estado], ["4", "4", "cuadra"]);
  assert.equal(JSON.stringify(e.estado), antes);
});

test("corregir y vincular conserva NP, cantidades y vales, crea etiquetas sólo donde cambia y deshace todo", () => {
  const e = escenario();
  e.estado.vales.push({ id: siguienteId(e.estado, "vale"), folio: 9, tipo: "SALIDA", estado: "EMITIDO", fecha: "2026-09-06",
    lineas: [{ id: siguienteId(e.estado, "vale_linea"), codigo: e.codigo, existencia_id: e.dos.e.id, clave: e.dos.v.dimension, cantidad: "1", um: "PZA" }] });
  const antes = datosCorreccion(e.estado), vales = structuredClone(e.estado.vales), cantidades = e.estado.existencias.map((x) => x.cantidad_conteo);
  const p = preverVinculoCorregido(e.estado, datos(e));
  assert.deepEqual([p.etiquetas, p.comparacion.fisico.toFixed(), p.comparacion.salidas.toFixed(), p.comparacion.estado], [1, "3", "1", "explicada"]);
  assert.deepEqual(datosCorreccion(e.estado), antes);
  const res = corregirYVincularFisico(e.estado, datos(e), "PERSONA SINTETICA");
  assert.equal(res.etiquetas.length, 1);
  assert.equal(fila(e).estado, "explicada");
  assert.equal(e.dos.v.dimension, "150VA");
  assert.equal(e.dos.v.np, "NP-SINTETICO-B");
  assert.deepEqual(e.estado.vales, vales);
  assert.deepEqual(e.estado.existencias.map((x) => x.cantidad_conteo), cantidades);
  const etiqueta = e.estado.etiquetas.material.at(-1);
  assert.deepEqual([etiqueta.dimension, etiqueta.np, etiqueta.cantidad], ["150VA", "NP-SINTETICO-B", 1]);
  assert.deepEqual([etiqueta.origen.existencia_id, etiqueta.origen.corte_ax_id, etiqueta.origen.linea_ax_id], [e.dos.e.id, e.corte.id, 1]);
  const despues = datosCorreccion(e.estado);
  deshacerCorreccion(e.estado, antes, despues);
  assert.deepEqual(datosCorreccion(e.estado), antes);
  assert.deepEqual(e.estado.vales, vales);
});

test("unir claves al destino muestra todas las piezas y genera una etiqueta por partida modificada", () => {
  const e = escenario();
  e.dos.v.np = e.uno.v.np;
  e.dos.v.np_clave = e.uno.v.np_clave;
  const indicesAntes = e.estado.existencias.map((x) => x.id);
  const p = preverVinculoCorregido(e.estado, datos(e, [e.dos.v.id]));
  assert.equal(p.comparacion.fisico.toFixed(), "4"); // Seleccionó 2 y se une a las otras 2 ya existentes.
  assert.equal(p.etiquetas, 1);
  const antes = datosCorreccion(e.estado);
  corregirYVincularFisico(e.estado, datos(e, [e.dos.v.id]));
  assert.deepEqual(e.estado.existencias.map((x) => x.id), indicesAntes);
  assert.deepEqual(e.corte.vinculos_fisicos[0].variante_ids, [e.uno.v.id]);
  assert.equal(fila(e).fisico.toFixed(), "4");
  deshacerCorreccion(e.estado, antes, datosCorreccion(e.estado));
  assert.deepEqual(datosCorreccion(e.estado), antes);
});

test("las variantes de Color se corrigen juntas sin borrar sus NP y un sobrante real sigue siendo sobrante", () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "VERDE SINTETICO CLARO", lineas: (l) => [l("", "3", "VERDE SINTETICO"), l("100VA", "4")] });
  const p = preverVinculoCorregido(e.estado, datos(e));
  assert.equal(p.etiquetas, 2);
  assert.deepEqual([p.comparacion.fisico.toFixed(), p.comparacion.estado, p.comparacion.sin_explicar.toFixed()], ["4", "sobrante", "1"]);
  corregirYVincularFisico(e.estado, datos(e));
  const variantes = e.estado.existencias.filter((x) => x.id === e.uno.e.id || x.id === e.dos.e.id).map((x) => e.estado.variantes.find((v) => v.id === x.variante_id));
  assert.ok(variantes.every((v) => v.dimension === "VERDE SINTETICO"));
  assert.deepEqual(variantes.map((v) => v.np), ["NP-SINTETICO-A", "NP-SINTETICO-B"]);
  assert.equal(e.estado.etiquetas.material.length, 2);
});

test("selecciones inválidas se rechazan antes de modificar inventario, vínculos o etiquetas", () => {
  for (const ids of [(e) => [e.dos.v.id, 999999], (e) => [e.dos.v.id, e.otra.v.id]]) {
    const e = escenario(), antes = JSON.stringify(e.estado);
    assert.throws(() => corregirYVincularFisico(e.estado, datos(e, ids(e))));
    assert.equal(JSON.stringify(e.estado), antes);
  }
});

test("AX sin dimensión no borra las claves del inventario al vincular", () => {
  const e = escenarioGruposAx(undefined, { lineas: (l) => [l("S/D", "4")] }), antes = JSON.stringify(e.estado);
  assert.throws(() => corregirYVincularFisico(e.estado, datos(e)), /AX no indica una dimensión/);
  assert.equal(JSON.stringify(e.estado), antes);
});

test("una variante en varios contenedores prepara una etiqueta por partida y limpia sólo el NP que repite Color", () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "VERDE SINTETICO CLARO", lineas: (l) => [l("", "4", "VERDE SINTETICO"), l("100VA", "4")] });
  e.dos.v.np = "VERDE SINTETICO";
  e.dos.v.np_clave = "VERDESINTETICO";
  const ex = { ...e.dos.e, id: siguienteId(e.estado, "existencia"), cantidad_conteo: "1" };
  e.estado.existencias.push(ex);
  const p = preverVinculoCorregido(e.estado, datos(e));
  assert.equal(p.etiquetas, 3);
  assert.equal(p.comparacion.fisico.toFixed(), "5");
  const antes = datosCorreccion(e.estado);
  corregirYVincularFisico(e.estado, datos(e));
  const etiquetas = e.estado.etiquetas.material;
  assert.equal(etiquetas.length, 3);
  assert.deepEqual(new Set(etiquetas.map((x) => x.origen.existencia_id)), new Set([e.uno.e.id, e.dos.e.id, ex.id]));
  assert.ok(etiquetas.filter((x) => x.origen.existencia_id !== e.uno.e.id).every((x) => !x.np));
  deshacerCorreccion(e.estado, antes, datosCorreccion(e.estado));
  assert.deepEqual(datosCorreccion(e.estado), antes);
});

test("Deshacer conserva cambios ajenos y cantidades posteriores y protege una clave editada después", () => {
  const e = escenario(), antes = datosCorreccion(e.estado);
  corregirYVincularFisico(e.estado, datos(e));
  const despues = datosCorreccion(e.estado);
  e.otra.v.np = "NP SINTETICO ACTUALIZADO";
  e.dos.e.cantidad_conteo = "8";
  deshacerCorreccion(e.estado, antes, despues);
  assert.equal(e.estado.variantes.find((v) => v.id === e.otra.v.id).np, "NP SINTETICO ACTUALIZADO");
  assert.equal(e.dos.e.cantidad_conteo, "8");
  const otro = escenario(), a = datosCorreccion(otro.estado);
  corregirYVincularFisico(otro.estado, datos(otro));
  const d = datosCorreccion(otro.estado);
  otro.dos.v.np = "NP POSTERIOR";
  const actual = JSON.stringify(otro.estado);
  assert.throws(() => deshacerCorreccion(otro.estado, a, d), /cambió después/);
  assert.equal(JSON.stringify(otro.estado), actual);
});
