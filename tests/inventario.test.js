// Corregir la dimensión y el NP de un renglón o de una variante (Ronda 9), con datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { leerReporteAx, delAlmacen } from "../src/importadores/ax.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { registrarCorteAx } from "../src/servicios/conciliacion.js";
import { ErrorCorreccion, corregirDimensionNp, previaCorreccion, sugerenciasClave } from "../src/servicios/inventario.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { NOMBRE_AX, bytesAx, bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const varianteDe = (estado, codigo, dimension) => estado.variantes.find((v) => v.codigo === codigo && v.dimension === dimension);
const renglonesDe = (estado, variante) => estado.existencias.filter((e) => e.variante_id === variante.id);

test("corregir un solo renglón: pasa a otra variante y los demás renglones no cambian", () => {
  const { estado } = cargaSintetica();
  const balero = varianteDe(estado, 701, "6309-2Z/C3");
  const [c1, c2] = renglonesDe(estado, balero);
  const totales = calcularSaldos(estado);
  const previa = previaCorreccion(estado, { existenciaId: c2.id }, { dimension: "6309-2RS", np: "" });
  assert.deepEqual([previa.todos, previa.otra, previa.cambia], [false, null, true]);
  const r = corregirDimensionNp(estado, { existenciaId: c2.id }, { dimension: "6309-2RS", np: "" }, { usuario: USUARIO, motivo: "Etiqueta mal escrita" });
  assert.deepEqual([r.antes, r.despues, r.unida, r.renglones], ["6309-2Z/C3", "6309-2RS", false, 1]);
  assert.equal(c1.variante_id, balero.id);
  assert.notEqual(c2.variante_id, balero.id);
  assert.deepEqual(r.variante.claves_anteriores, ["6309-2Z/C3"]);
  // Las cantidades no cambian: los vales apuntan al renglón.
  const despues = calcularSaldos(estado);
  for (const e of [c1, c2]) assert.equal(despues.get(e.id).total.toFixed(), totales.get(e.id).total.toFixed());
  const auditoria = estado.auditoria.at(-1);
  assert.deepEqual([auditoria.accion, auditoria.entidad, auditoria.despues.motivo], ["CORREGIR_CLAVE", "existencia", "Etiqueta mal escrita"]);
});

test("corregir toda la variante: cambia de nombre o se junta con la que ya tenía esa dimensión", () => {
  const { estado } = cargaSintetica();
  const mariposa = varianteDe(estado, 707, 'MARIPOSA 4"');
  corregirDimensionNp(estado, { varianteId: mariposa.id }, { dimension: "MARIPOSA 4 PULG", np: "" }, { usuario: USUARIO });
  assert.deepEqual([mariposa.dimension, mariposa.dimension_clave, mariposa.activo], ["MARIPOSA 4 PULG", "MARIPOSA4PULG", true]);
  // 701 "6205-2Z" → "6309-2Z/C3": ya existe, los renglones pasan a esa variante y la otra queda inactiva.
  const chico = varianteDe(estado, 701, "6205-2Z");
  const grande = varianteDe(estado, 701, "6309-2Z/C3");
  const [renglon] = renglonesDe(estado, chico);
  const r = corregirDimensionNp(estado, { varianteId: chico.id }, { dimension: "6309-2Z/C3", np: "" }, { usuario: USUARIO });
  assert.equal(r.unida, true);
  assert.equal(renglon.variante_id, grande.id);
  assert.deepEqual([chico.activo, chico.unida_a], [false, grande.id]);
  assert.ok(grande.claves_anteriores.includes("6205-2Z"));
  assert.throws(() => corregirDimensionNp(estado, { varianteId: grande.id }, { dimension: "6309-2Z/C3", np: "" }), ErrorCorreccion);
  // El inventario exportado ya lleva la dimensión corregida.
  const hoja = new LibroLeido(exportarInventario(estado, bytesInventario()).datos).hoja("CONTENEDOR #1 INVENTARIABLE");
  const dimensiones = [];
  for (let f = 2; f <= 6; f++) dimensiones.push(hoja.valor(f, 4));
  assert.deepEqual(dimensiones.slice(0, 3), ["6309-2Z/C3", "6309-2Z/C3", "MARIPOSA 4 PULG"]);
});

test("sugerencias de dimensión y NP: cómo lo escribe AX y las variantes del inventario", () => {
  const { estado } = cargaSintetica();
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "RIG91-IX25", renglones: delAlmacen(reporte.renglones, "RIG91-IX25") }, USUARIO);
  const s = sugerenciasClave(estado, 707);
  assert.deepEqual(s.dimensiones.map((x) => x.valor), ["MARIPOSA 4", 'MARIPOSA 4"']);
  assert.match(s.dimensiones[0].detalle, /AX .*10 caracteres/);
  assert.deepEqual(sugerenciasClave(estado, 704).nps.map((x) => x.valor), ["FLEXITALIC"]);
});
