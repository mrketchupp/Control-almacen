// Ronda 12: archivo de vales de la base (qué partidas ya aplicó en AX), con datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorArchivoBase, guardadoEl, leerArchivoBase } from "../src/importadores/base.js";
import { delAlmacen, leerReporteAx } from "../src/importadores/ax.js";
import { migrarEstado } from "../src/nucleo/estado.js";
import { ahoraIso } from "../src/nucleo/fechas.js";
import * as c from "../src/servicios/conciliacion.js";
import * as s from "../src/servicios/seguimiento.js";
import * as v from "../src/servicios/vales.js";
import { NOMBRE_AX, NOMBRE_BASE, bytesAx, bytesBase, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function conBase() {
  const { estado } = cargaSintetica();
  const leido = leerArchivoBase(bytesBase());
  s.registrarSeguimiento(estado, { archivo: NOMBRE_BASE, huella: "b1", guardado: leido.guardado, partidas: leido.partidas, ultimoFolio: leido.ultimoFolio }, USUARIO);
  return estado;
}
const linea = (estado, folio, codigo, i = 0) => estado.vales.find((v) => v.folio === folio).lineas.filter((l) => l.codigo === codigo)[i];

test("leer el archivo de la base: columnas por nombre (las dos CANTIDAD), último folio y cuándo lo guardó Excel", () => {
  const leido = leerArchivoBase(bytesBase());
  assert.equal(leido.hoja, "DIARIO");
  assert.equal(leido.ultimoFolio, 7);
  assert.equal(leido.partidas.length, 12);
  const parcial = leido.partidas[1];
  assert.deepEqual([parcial.folio, parcial.codigo, parcial.cantidad, parcial.inv, parcial.mov, parcial.aplicada, parcial.in], [1, 702, "3", "INV", "CONSUMO", "1", "IN00000101"]);
  assert.throws(() => leerArchivoBase(bytesVales()), ErrorArchivoBase); // el DIARIO de la herramienta no trae INV/NINV
  // La fecha de guardado es solo informativa (docProps/core.xml, en hora local).
  assert.match(leido.guardado, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const core = '<cp:coreProperties><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-05T00:39:13Z</dcterms:modified></cp:coreProperties>';
  assert.equal(guardadoEl({ existe: () => true, texto: () => core }), ahoraIso(new Date("2026-10-05T00:39:13Z")));
  assert.equal(guardadoEl({ existe: () => false }), null);
});

test("importar otro archivo de la base reemplaza al anterior (su fecha no importa)", () => {
  const estado = conBase();
  const { partidas } = leerArchivoBase(bytesBase());
  const otro = s.registrarSeguimiento(estado, { archivo: "BASE NUEVO.xlsm", partidas: partidas.slice(0, 3), ultimoFolio: 2 }, USUARIO);
  assert.deepEqual(estado.seguimientos_base.map((x) => x.archivo), ["BASE NUEVO.xlsm"]);
  assert.equal(s.seguimientoVigente(estado), otro);
  assert.deepEqual(estado.auditoria.at(-1).antes.reemplaza.map((x) => x.archivo), [NOMBRE_BASE]);
  // Con el archivo nuevo (hasta el folio 2), los vales posteriores aún no están en la base: sin IN / TR.
  const ax = s.estadoAxDeVales(estado);
  assert.equal(ax.porLinea.get(linea(estado, 6, 706).id).estado, "posterior");
});

test("clasificar: IN/TRS = aplicada (U vacía = todo), U menor = parcial, sin folio = sin aplicar, NO INV / CONPROV no se descuentan", () => {
  const f = (x) => ({ cantidad: "3", inv: "INV", mov: "", aplicada: "", tr: "", in: "", ...x });
  assert.equal(s.clasificar(f({ in: "IN00000101" })).estado, "aplicada");
  assert.deepEqual(s.foliosAx(f({ tr: "TRS000000287", in: "IN598/IN651" })), ["TRS000000287", "IN598", "IN651"]);
  const parcial = s.clasificar(f({ in: "IN00000101", aplicada: "1" }));
  assert.deepEqual([parcial.estado, parcial.aplicada.toFixed(), parcial.pendiente.toFixed()], ["parcial", "1", "2"]);
  assert.equal(s.clasificar(f({ in: "IN761", aplicada: "4 Y 2", cantidad: "6" })).estado, "aplicada");
  assert.match(s.clasificar(f({ tr: "TRS1", aplicada: "REGRESAR" })).avisos[0], /REGRESAR/);
  assert.deepEqual([s.clasificar(f({})).estado, s.clasificar(f({ tr: "PENDIENTE" })).estado], ["pendiente", "pendiente"]);
  for (const inv of ["NO INV", "NO INV ", "no inv", "CONPROV", "SIN EXSTENCIA"]) assert.equal(s.clasificar(f({ inv })).estado, "no_inv", inv);
  assert.deepEqual([s.clasificar(f({ inv: "" })).estado, s.clasificar(f({ inv: "" })).pendiente.toFixed()], ["sin_revisar", "3"]); // sin folio: aún no en AX
});

test("cada partida de los vales con su estado en AX y los avisos de diferencias", () => {
  const estado = conBase();
  const ax = s.estadoAxDeVales(estado);
  const de = (folio, codigo, i) => ax.porLinea.get(linea(estado, folio, codigo, i).id);
  assert.deepEqual([de(1, 702, 0).estado, de(1, 702, 0).folios], ["aplicada", ["IN00000101"]]);
  assert.deepEqual([de(1, 702, 1).estado, de(1, 702, 1).pendiente.toFixed()], ["parcial", "2"]);
  assert.deepEqual([de(2, 708, 0).estado, de(2, 708, 0).folios], ["aplicada", ["TRS000000201"]]); // U vacía = todo
  assert.equal(de(2, 708, 1).estado, "sin_registro"); // el DIARIO la tiene dos veces; la base, una
  assert.deepEqual([de(3, 704).estado, de(3, 703).estado, de(5, 136).estado], ["no_inv", "no_inv", "no_inv"]);
  assert.equal(de(4, 799).estado, "sin_revisar");
  assert.deepEqual([de(6, 701).estado, de(6, 706).estado], ["pendiente", "pendiente"]);
  assert.deepEqual([de(9, 705).estado, de(9, 705).pendiente.toFixed()], ["posterior", "2"]); // la base aún no tiene el vale
  assert.equal(s.etiquetaAx(de(1, 702, 1)), "1 de 3 en AX · IN00000101");
  // Pueden justificar faltantes: lo que no tiene IN / TR, salvo la duplicada que la base no tiene (error del vale).
  const folioDe = (id) => estado.vales.find((v) => v.lineas.some((l) => l.id === id)).folio;
  assert.deepEqual([...ax.porLinea].filter(([, info]) => s.sinAplicar(info)).map(([id]) => folioDe(id)).sort(), [1, 4, 6, 6, 9]);
  assert.equal(s.sinAplicar(de(2, 708, 1)), false);
  const avisos = ax.avisos.map((a) => `${a.folio} ${a.texto}`);
  assert.ok(avisos.includes("7 La base anotó la clave P551318; el vale dice P551317."));
  assert.ok(avisos.includes("7 La base tiene 712 6303 SKF (1), que no está en el vale."));
  assert.ok(avisos.includes("2 708 ISOFLEX (1) no está en el archivo de la base (está duplicada: repite la partida 1)."));
  assert.ok(avisos.some((a) => a.startsWith("7 La base anotó \"REGRESAR\"")));
  assert.ok(!avisos.some((a) => a.startsWith("4 ")), "S/D = S/D no es aviso");
  assert.deepEqual(ax.resumen, { aplicada: 4, parcial: 1, pendiente: 2, no_inv: 3, sin_revisar: 1, sin_registro: 1, posterior: 1, sin_aplicar: 5, avisos: 5 });
});

test("conciliación: lo que no tiene IN / TR en la base cuenta como tránsito aunque el vale sea anterior al corte; NO INV no", () => {
  const estado = conBase();
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const corte = c.registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "RIG91-IX25", renglones: delAlmacen(reporte.renglones, "RIG91-IX25") }, USUARIO);
  const r = c.conciliar(estado, corte);
  const de = (codigo, dimension) => r.renglones.find((x) => x.codigo === codigo && x.variante.dimension === dimension);
  const deCodigo = (codigo) => r.porCodigo.find((x) => x.codigo === codigo);
  // Folio 1 (01-sep, antes del corte): la base aplicó 1 de 3 → 2 en tránsito.
  assert.deepEqual([de(702, "P557500").salidas.toFixed(), de(702, "P557500").folios], ["2", ["1 (S, 2 sin IN/TR)"]]);
  // Folio 6 (04-sep): INV sin folio → tránsito; 701 sin partida del inventario ligada → pista por ubicar.
  assert.deepEqual(de(706, "555001").folios, ["6 (S, sin IN/TR)"]);
  assert.deepEqual(deCodigo(701).por_ubicar, ["6 (S, sin IN/TR)"]);
  // Folio 4: la base no lo ha revisado (sin INV/NINV ni folio): también cuenta.
  assert.deepEqual(deCodigo(799).folios, ["4 (S, sin IN/TR)"]);
  // Folio 9 (06-sep) es posterior al corte: tránsito por fecha, tenga o no folio de AX.
  assert.deepEqual(de(705, '1/2"').folios, ["9 (S)"]);
  // Con IN / TR (folio 2, 708) no cuenta, ni la duplicada que la base no tiene; NO INV (folio 3, 704) queda como pista.
  assert.deepEqual(de(708, "ISOFLEX").folios, []);
  assert.deepEqual(deCodigo(704).no_inv, ["3 (S)"]);
  assert.equal(r.ax.seguimiento.archivo, NOMBRE_BASE);
  // Sin archivo de la base todo vuelve a ser por fecha.
  s.quitarSeguimiento(estado, s.seguimientoVigente(estado).id, USUARIO);
  const sin = c.conciliar(estado, corte);
  const sinBase = (codigo, dimension) => sin.renglones.find((x) => x.codigo === codigo && x.variante.dimension === dimension);
  assert.deepEqual([sinBase(706, "555001").folios, sinBase(702, "P557500").folios, sinBase(705, '1/2"').folios], [[], [], ["9 (S)"]]);
  assert.equal(sin.ax, null);
});

test("formato 7: los estados anteriores se migran con la lista de archivos de la base vacía", () => {
  const { estado } = cargaSintetica();
  estado.formato = 6;
  delete estado.seguimientos_base;
  migrarEstado(estado);
  assert.deepEqual([estado.formato, estado.seguimientos_base, s.seguimientoVigente(estado), s.estadoAxDeVales(estado)], [10, [], null, null]);
  assert.throws(() => s.registrarSeguimiento(estado, { archivo: "VACIO.xlsm", partidas: [] }), s.ErrorSeguimiento);
});

test("partidas duplicadas dentro de un vale: se marcan y se quitan con una corrección", () => {
  const { estado } = cargaSintetica();
  const vale = estado.vales.find((x) => x.folio === 2);
  const repetida = linea(estado, 2, 708, 1);
  assert.deepEqual([...v.partidasDuplicadas(vale)], [[repetida.id, 1]]);
  assert.deepEqual([...v.duplicadasEnVales(estado)], [[repetida.id, 1]]);
  // Misma clave pero otra cantidad no es duplicada.
  assert.equal(v.partidasDuplicadas({ lineas: [{ id: 1, codigo: 702, clave: "P551317", cantidad: "1" }, { id: 2, codigo: 702, clave: "P551317", cantidad: "2" }] }).size, 0);
  const datos = v.datosParaCorregir(estado, vale.id);
  datos.lineas = datos.lineas.filter((l) => l.id !== repetida.id);
  v.corregirVale(estado, vale.id, datos, "Partidas duplicadas: el formulario de Excel guardó el vale dos veces.", USUARIO);
  const corregido = estado.vales.find((x) => x.folio === 2);
  assert.equal(corregido.lineas.filter((l) => l.codigo === 708).length, 1);
  assert.equal(v.partidasDuplicadas(corregido).size, 0);
  assert.equal(v.duplicadasEnVales(estado).size, 0);
});
