// Ronda 35: en la primera carga, las hojas del libro de vales (todas menos DIARIO) se acomodan en las tres plantillas
// — Consumo interno, NOV y Transferencia — antes de cargar: se propone una, el usuario la cambia, renombra o quita.

import assert from "node:assert/strict";
import { test } from "node:test";
import { tipoDeArea } from "../src/nucleo/areas.js";
import { DESTINOS_TRANSFERENCIA, areaTransferencia, areasConsumo, destinosTransferencia, listaDestinos } from "../src/servicios/pasosVale.js";
import { conFormatoDeTransferencia, ejecutarPrimeraCarga, propuestaDeAreas, tipoPropuesto } from "../src/servicios/primeraCarga.js";
import { FOLIO_CORTE, libroInventario, libroVales } from "./ayuda.js";

const cargar = (vales, areas) =>
  ejecutarPrimeraCarga(libroInventario(), vales, { folioCorte: FOLIO_CORTE, fechaConteo: "2026-09-03", usuario: "PRUEBA", areas });

/** El libro sintético más hojas de transferencia con nombre de RIG (como en otros equipos). */
function libroConRigs() {
  const vales = libroVales();
  const transferencias = vales.plantillas.find((p) => p.hoja === "TRANSFERENCIAS");
  return { ...vales, plantillas: [...vales.plantillas, { ...transferencias, hoja: "RIG 302", destino: "RIG 302" }, { ...transferencias, hoja: "Base Sintetica ", destino: "BASE SINTETICA" }] };
}

test("la propuesta: transferencias por nombre o por RIG / BASE / POZO, NOV por su destino y lo demás consumo interno", () => {
  const propuesta = propuestaDeAreas(libroVales().plantillas);
  assert.deepEqual(propuesta.map((a) => [a.hoja, a.nombre, a.tipo, a.formato]), [
    ["SOLDADOR", "SOLDADOR", "INTERNO", false],
    ["MECANICO ", "MECANICO", "INTERNO", false],
    ["TRANSFERENCIAS", "TRANSFERENCIAS", "TRANSFERENCIA", true],
    ["NOV", "NOV", "EXTERNO", false],
  ]);
  assert.equal(tipoPropuesto({ hoja: "RIG 48", origen: "RIG 91", destino: "RIG 91" }), "TRANSFERENCIA");
  assert.equal(tipoPropuesto({ hoja: "POZO SINTETICO 7" }), "TRANSFERENCIA");
  assert.equal(tipoPropuesto({ hoja: "ELECTRICO", origen: "RIG 91", destino: "RIG 91" }), "INTERNO");
  // De las de Transferencia, el formato es la de TRANSFER… aunque no sea la primera; las demás son destinos.
  const conRigs = propuestaDeAreas([{ hoja: "RIG 302" }, { hoja: "TRANSFERENCIAS" }]);
  assert.deepEqual(conRigs.map((a) => [a.hoja, a.formato]), [["RIG 302", false], ["TRANSFERENCIAS", true]]);
  // Si la del formato se quita o se mueve, otra lo toma; la que el usuario marca se queda.
  assert.deepEqual(conFormatoDeTransferencia(conRigs.map((a) => (a.hoja === "TRANSFERENCIAS" ? { ...a, tipo: "INTERNO", formato: false } : a))).map((a) => a.formato), [true, false]);
  assert.deepEqual(conFormatoDeTransferencia([{ ...conRigs[0], formato: true }, { ...conRigs[1], formato: false }]).map((a) => a.formato), [true, false]);
});

test("sin elegir nada, la carga queda como siempre (la propuesta)", () => {
  const { estado, reporte } = cargar(libroVales());
  assert.deepEqual(estado.plantillas_area.map((a) => [a.nombre, tipoDeArea(a), a.activo]), [
    ["SOLDADOR", "INTERNO", true],
    ["MECANICO", "INTERNO", true],
    ["TRANSFERENCIAS", "TRANSFERENCIA", true],
    ["NOV", "EXTERNO", true],
  ]);
  assert.equal(estado.config.destinos_transferencia, undefined, "sin destinos nuevos, los de fábrica");
  assert.deepEqual([reporte.plantillas_area, reporte.areas_quitadas, reporte.destinos_agregados], [4, [], []]);
});

test("como las acomodó el usuario: otra plantilla, otro nombre, una quitada y RIG como destinos", () => {
  const vales = libroConRigs();
  const areas = propuestaDeAreas(vales.plantillas).map((a) => {
    if (a.hoja === "SOLDADOR") return { ...a, nombre: "soldadura" };
    if (a.hoja === "MECANICO ") return { ...a, tipo: "EXTERNO" };
    if (a.hoja === "NOV") return { ...a, quitada: true };
    if (a.hoja === "Base Sintetica ") return { ...a, quitada: true };
    return a;
  });
  assert.deepEqual(areas.filter((a) => a.tipo === "TRANSFERENCIA").map((a) => [a.hoja, a.formato]), [["TRANSFERENCIAS", true], ["RIG 302", false], ["Base Sintetica ", false]]);
  const { estado, reporte } = cargar(vales, areas);
  const porNombre = (n) => estado.plantillas_area.find((a) => a.nombre === n);
  assert.deepEqual([porNombre("SOLDADURA").hoja_excel, tipoDeArea(porNombre("SOLDADURA"))], ["SOLDADOR", "INTERNO"]);
  assert.equal(tipoDeArea(porNombre("MECANICO")), "EXTERNO");
  // La quitada queda descartada (sus vales del DIARIO se siguen imprimiendo con ella) y no sale al hacer vales.
  assert.equal(porNombre("NOV").activo, false);
  assert.deepEqual(areasConsumo(estado).map((a) => a.nombre), ["SOLDADURA", "MECANICO"]);
  // Las de Transferencia que no son el formato son destinos (además de los de fábrica); la quitada no se agrega.
  assert.equal(estado.plantillas_area.some((a) => a.hoja_excel === "RIG 302"), false, "un destino no es un área");
  assert.equal(areaTransferencia(estado).nombre, "TRANSFERENCIAS");
  assert.deepEqual(listaDestinos(estado), [...DESTINOS_TRANSFERENCIA, "RIG 302"]);
  assert.ok(destinosTransferencia(estado).includes("RIG 302"));
  assert.deepEqual([reporte.areas_quitadas, reporte.destinos_agregados, reporte.plantillas_area], [["NOV", "BASE SINTETICA"], ["RIG 302"], 3]);
});

test("dos hojas con el mismo nombre: la segunda conserva el de su hoja", () => {
  const vales = libroVales();
  const areas = propuestaDeAreas(vales.plantillas).map((a) => (a.hoja === "MECANICO " ? { ...a, nombre: "SOLDADOR" } : a));
  const { estado } = cargar(vales, areas);
  assert.deepEqual(estado.plantillas_area.filter((a) => tipoDeArea(a) === "INTERNO").map((a) => a.nombre), ["SOLDADOR", "MECANICO"]);
});
