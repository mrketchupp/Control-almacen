import assert from "node:assert/strict";
import { test } from "node:test";
import { conciliar, umComparable, unidadesCompatibles } from "../src/servicios/conciliacion.js";
import { candidatosFisicos, previaVinculoFisico, vincularFisico } from "../src/servicios/vinculosAx.js";
import { escenarioGruposAx } from "./ayudaGruposAx.js";

test("abreviaturas de pieza y unidad se comparan 1 a 1 sin convertir medidas diferentes", () => {
  for (const um of ["pza", "Pz.", "P.Z.A.", "PZS", "UN", "UND", "UNID", "UD", "UDS", "Unidad", "Unidades", "Unit", "Units", "EA", "Each", "PC", "PCS", "Piece", "Pieces"]) {
    assert.equal(umComparable(um), "PZA", um);
    assert.equal(unidadesCompatibles(um, "PZA"), true, um);
  }
  for (const um of ["CJA", "JGO", "KG", "M", "L", "PAQ", "DOCENA"]) assert.equal(unidadesCompatibles(um, "PZA"), false, um);
  assert.equal(umComparable("M.T.S."), "M");
  assert.equal(umComparable("UM.SINTETICA"), "UM.SINTETICA");
});

test("AX con EA suma variantes PZA, permite seleccionarlas y conserva las unidades originales", () => {
  const e = escenarioGruposAx(undefined, { lineas: (l) => [l("150VA", "4", "", "EA"), l("100VA", "4")] });
  const antes = JSON.stringify([e.estado.variantes, e.estado.existencias, e.estado.vales, e.estado.etiquetas, e.corte.lineas]);
  const r = conciliar(e.estado, e.corte), f = r.renglones.find((f) => f.lineas.some((l) => l.id === 1));
  assert.deepEqual([f.ax.toFixed(), f.fisico.toFixed(), f.estado], ["4", "4", "cuadra"]);
  const opciones = candidatosFisicos(r, [1]);
  assert.ok(opciones.filter((f) => f.variante.id === e.uno.v.id || f.variante.id === e.dos.v.id).every((f) => f.compatible));
  vincularFisico(e.estado, { corteId: e.corte.id, lineaIds: [1], varianteIds: [e.uno.v.id, e.dos.v.id] });
  assert.equal(JSON.stringify([e.estado.variantes, e.estado.existencias, e.estado.vales, e.estado.etiquetas, e.corte.lineas]), antes);
});

test("una unidad equivalente desbloquea la selección pero conserva un faltante real de una pieza", () => {
  const e = escenarioGruposAx(undefined, { lineas: (l) => [l("150VA", "12", "", "UND"), l("100VA", "4")] });
  e.uno.e.cantidad_conteo = "4";
  e.dos.e.cantidad_conteo = "7";
  const f = previaVinculoFisico(e.estado, { corteId: e.corte.id, lineaIds: [1], varianteIds: [e.uno.v.id, e.dos.v.id] });
  assert.deepEqual([f.ax.toFixed(), f.fisico.toFixed(), f.sin_explicar.toFixed(), f.estado], ["12", "11", "-1", "faltante"]);
});
