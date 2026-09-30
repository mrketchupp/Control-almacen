import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { Indices } from "../src/nucleo/estado.js";
import { fechaDesdeNombre, sugerirFolioCorte } from "../src/servicios/primeraCarga.js";
import { cargaSintetica, libroVales } from "./ayuda.js";

const { estado, reporte } = cargaSintetica();
const indices = new Indices(estado);
const valePorFolio = (folio) => estado.vales.find((v) => v.folio === folio);

test("carga el inventario completo", () => {
  assert.equal(reporte.existencias, 14);
  assert.deepEqual(reporte.hojas.map((h) => h.renglones), [5, 5, 2, 2]);
  assert.ok(estado.ubicaciones.some((u) => u.hoja_excel === "CONTENEDOR #1 CONSUMIBLE "));
  // la misma variante en dos ubicaciones es una sola variante
  assert.equal(estado.variantes.filter((v) => v.codigo === 701).length, 2);
  // 1/2" y 12 no se confunden
  assert.equal(estado.variantes.filter((v) => v.codigo === 705).length, 2);
});

test("vales migrados", () => {
  assert.equal(reporte.vales, 8);
  assert.deepEqual(reporte.folios_faltantes, [8]);
  const vale = valePorFolio(7);
  assert.equal(vale.estado, "EMITIDO");
  assert.ok(vale.migrado);
  assert.deepEqual(vale.lineas.map((l) => l.fila_diario_origen), [13, 14]);
});

test("las líneas posteriores al corte se ubican solas cuando no hay duda", () => {
  // folio 6: 701 está en 2 contenedores (ambiguo); 706 555001 solo en uno
  // folio 7: 702 P551317 único; 704 6" duplicado en la misma hoja (ambiguo)
  // folio 9: 705 1/2" único (no se confunde con "12")
  assert.equal(reporte.lineas_ubicadas, 3);
  assert.deepEqual(reporte.por_ubicar.map((p) => [p.folio, p.codigo]).sort(), [[6, 701], [7, 704]]);
  const diesel = estado.vales.flatMap((v) => v.lineas).find((l) => l.codigo === 136);
  assert.equal(diesel.existencia_id, null); // folio 5 es anterior al corte: solo historial
});

test("la verificación cruzada señala diferencias", () => {
  const diferencias = new Map(reporte.diferencias.map((d) => [`${d.hoja}|${d.fila}`, d]));
  assert.ok(!diferencias.has("CONTENEDOR #1 INVENTARIABLE|6")); // el vale 6 explica el CONSUMO 1
  const d = diferencias.get("CONTENEDOR #1 CONSUMIBLE |2");
  assert.deepEqual([d.archivo_consumo.toFixed(), d.calculado_consumo.toFixed()], ["0", "4"]);
  assert.equal(diferencias.get("CONTENEDOR #1 CONSUMIBLE |6").archivo_ingreso.toFixed(), "2");
  assert.equal(reporte.cuadra, false);
});

test("saldos derivados de los movimientos", () => {
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  const saldo = calcularSaldos(estado, [sellos.id]).get(sellos.id);
  assert.deepEqual([saldo.cantidad, saldo.consumo, saldo.total].map((x) => x.toFixed()), ["2", "1", "1"]);
});

test("plantillas de área y personas", () => {
  assert.equal(reporte.plantillas_area, 3);
  const transferencias = estado.plantillas_area.find((p) => p.nombre === "TRANSFERENCIAS");
  assert.equal(transferencias.naturaleza, "TRANSFERENCIA");
  assert.ok(transferencias.requiere_autoriza);
  assert.ok(estado.personas.some((p) => p.nombre === "ALMACENISTA UNO"));
});

test("artículos por confirmar", () => {
  assert.ok(reporte.articulos_por_confirmar.some(([codigo]) => codigo === 799));
});

test("el estado se puede guardar como JSON y volver a leer igual", () => {
  const copia = JSON.parse(JSON.stringify(estado));
  assert.deepEqual(copia, estado);
});

test("fecha desde el nombre del archivo", () => {
  assert.equal(fechaDesdeNombre("INVENTARIO_DE_REFACCIONAMIENTO_DLTA_DE_ALMACEN_280926.xlsx"), "2026-09-28");
  assert.equal(fechaDesdeNombre("DELTA RIG 91 27-09-26.xlsx"), "2026-09-27");
  assert.equal(fechaDesdeNombre("sin fecha.xlsx"), null);
});

test("sugerir folio de corte", () => {
  const renglones = libroVales().renglones;
  assert.equal(sugerirFolioCorte(renglones, "2026-09-04"), 5);
  assert.equal(sugerirFolioCorte(renglones, "2026-01-01"), null);
});
