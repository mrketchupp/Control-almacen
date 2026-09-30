import assert from "node:assert/strict";
import { test } from "node:test";
import { claveNormalizacion, limpiarDiario, respuestasVacias } from "../src/servicios/limpieza.js";
import { CATALOGO, libroVales } from "./ayuda.js";

const limpiar = (respuestas) => limpiarDiario(libroVales().renglones, CATALOGO, respuestas);
const porFolio = (resultado) => new Map(resultado.vales.map((v) => [v.folio, v]));

test("agrupa por folio y detecta faltantes", () => {
  const resultado = limpiar();
  assert.deepEqual(resultado.vales.map((v) => v.folio), [1, 2, 3, 4, 5, 6, 7, 9]);
  assert.deepEqual(resultado.folios_faltantes, [8]);
  assert.deepEqual(resultado.omitidos, [[8, "Renglón perdido: sin folio ni código (#REF!)"]]);
});

test("sin revisión no elimina duplicados", () => {
  assert.equal(porFolio(limpiar()).get(2).lineas.length, 2);
});

test("encabezado perdido se completa con otro renglón del folio", () => {
  const folio3 = porFolio(limpiar()).get(3);
  assert.deepEqual([folio3.origen, folio3.depto_origen, folio3.destino], ["RIG 91", "MANTENIMIENTO", "RIG 91"]);
  assert.match(folio3.lineas[0].notas[0], /Datos perdidos/);
  assert.deepEqual(folio3.lineas[0].encabezado_original, {});
  assert.deepEqual(folio3.lineas[1].encabezado_original, {});
});

test("descripción con error de dedo usa la del catálogo", () => {
  const resultado = limpiar();
  assert.equal(porFolio(resultado).get(7).lineas[0].descripcion, "FILTROS");
  assert.ok(resultado.correcciones.some((c) => JSON.stringify(c) === JSON.stringify([13, "descripcion", "FILTRO", "FILTROS"])));
});

test("código fuera de catálogo", () => {
  assert.deepEqual([...limpiar().codigos_nuevos], [[799, "ARTICULO NUEVO"]]);
});

test("fecha como texto y cantidad con unidad", () => {
  const folio4 = porFolio(limpiar()).get(4);
  assert.equal(folio4.fecha, "2026-09-03");
  assert.ok(folio4.lineas[0].cantidad.eq(15));
  assert.match(folio4.lineas[0].notas[0], /15LTS/);
});

test("aplica las respuestas de la revisión", () => {
  const respuestas = respuestasVacias();
  respuestas.eliminar.add(5);
  respuestas.alias.set("MECANICO UNOO", "MECANICO UNO");
  respuestas.normalizaciones.set(claveNormalizacion("destino", "(vacío)"), "RIG 91");
  respuestas.correcciones.set(6, { lote: "NUEVO" });
  respuestas.codigos.set(799, [null, "ARTICULO CONFIRMADO"]);
  const resultado = limpiar(respuestas);
  const vales = porFolio(resultado);
  assert.equal(vales.get(2).lineas.length, 1);
  assert.equal(vales.get(7).recibio, "MECANICO UNO");
  assert.equal(vales.get(5).destino, "RIG 91");
  assert.equal(vales.get(3).lineas[0].lote, "NUEVO");
  assert.deepEqual([...resultado.codigos_nuevos], [[799, "ARTICULO CONFIRMADO"]]);
  assert.ok(resultado.omitidos.some(([fila, motivo]) => fila === 5 && motivo.startsWith("Eliminado")));
});
