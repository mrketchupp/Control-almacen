import assert from "node:assert/strict";
import { test } from "node:test";
import { conciliar, ErrorConciliacion, textoFisico, registrarCorteAx, olvidarPareja } from "../src/servicios/conciliacion.js";
import { candidatosFisicos, deshacerVinculoFisico, previaVinculoFisico, quitarVinculosFisicos, vincularFisico } from "../src/servicios/vinculosAx.js";
import { justificables } from "../src/servicios/justificacion.js";
import { filasSolicitud, valesPorAplicar } from "../src/exportadores/ajuste.js";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { siguienteId } from "../src/nucleo/estado.js";
import { escenarioGruposAx } from "./ayudaGruposAx.js";

const fila150 = (e) => conciliar(e.estado, e.corte).renglones.find((f) => f.lineas.some((l) => l.tamano === "150VA"));
const elegir = (e, ids = [e.uno.v.id, e.dos.v.id]) => vincularFisico(e.estado, { corteId: e.corte.id, lineaIds: [e.corte.lineas[0].id], varianteIds: ids }, "PERSONA SINTETICA");
const datos = (e) => JSON.stringify([e.variantes, e.existencias, e.vales, e.etiquetas]);

test("AX 4 = dos partidas físicas 2 + 2 del mismo tamaño y distintos NP, sin falso faltante", () => {
  const e = escenarioGruposAx(), antes = JSON.stringify(e.estado);
  const r = conciliar(e.estado, e.corte), f = fila150(e);
  assert.deepEqual([f.ax.toFixed(), f.fisico.toFixed(), f.estado], ["4", "4", "cuadra"]);
  assert.deepEqual(new Set(f.variante_ids), new Set([e.uno.v.id, e.dos.v.id]));
  assert.match(textoFisico(f), /150VA.*2 variantes/);
  assert.equal(r.fisicoSinAx.length, 0);
  assert.equal(justificables(e.estado, r).length, 0);
  assert.equal(filasSolicitud(r, e.corte).length, 0);
  assert.equal(JSON.stringify(e.estado), antes);
});

test("los duplicados de AX suman su disponible y cuentan el grupo físico una sola vez", () => {
  const e = escenarioGruposAx(undefined, { lineas: (l) => [l("150VA", "2"), l("150VA", "2"), l("100VA", "4")] });
  const r = conciliar(e.estado, e.corte), f = fila150(e);
  assert.deepEqual([f.lineas.length, f.fisico.toFixed(), f.ax.toFixed(), f.estado], [2, "4", "4", "cuadra"]);
  const filas = filasSolicitud(r, e.corte, { todos: true }).filter((f) => f[5] === "150VA");
  assert.deepEqual(filas.map((f) => f[10].toFixed()), ["4", "0"]);
  assert.equal(r.porCodigo[0].fisico.toFixed(), "8");
  const antes = JSON.stringify(e.estado);
  const previa = previaVinculoFisico(e.estado, { corteId: e.corte.id, lineaIds: [1, 2], varianteIds: [] });
  assert.deepEqual([previa.ax.toFixed(), previa.fisico.toFixed(), previa.sin_explicar.toFixed()], ["4", "0", "-4"]);
  assert.equal(JSON.stringify(e.estado), antes);
});

test("Color específico tiene prioridad sobre Tamaño general y las unidades distintas no se suman", () => {
  for (const inverso of [false, true]) {
    const e = escenarioGruposAx(undefined, { lineas: (l) => {
      const ls = [l("150VA", "2"), l("150VA", "2", "NP-SINTETICO-A"), l("100VA", "4")];
      return inverso ? ls.reverse() : ls;
    } });
    const r = conciliar(e.estado, e.corte);
    assert.ok(r.renglones.every((f) => f.estado === "cuadra"));
    assert.equal(new Set(r.renglones.flatMap((f) => f.variante_ids)).size, 3);
    assert.equal(r.renglones.reduce((n, f) => n + Number(f.fisico), 0), 8);
  }
  const e = escenarioGruposAx(undefined, { segundaUm: "KG" });
  assert.equal(fila150(e).fisico.toFixed(), "2");
  assert.equal(candidatosFisicos(conciliar(e.estado, e.corte), [1]).find((f) => f.variante.id === e.dos.v.id).compatible, false);
});

test("el grupo reúne los saldos y el tránsito de ambos NP sin duplicar vales", () => {
  const e = escenarioGruposAx();
  for (const parte of [e.uno, e.dos]) {
    e.estado.vales.push({ id: siguienteId(e.estado, "vale"), folio: siguienteId(e.estado, "folio_prueba"), tipo: "SALIDA", estado: "EMITIDO", fecha: "2026-09-06", lineas: [{ id: siguienteId(e.estado, "vale_linea"), codigo: e.codigo, existencia_id: parte.e.id, clave: parte.v.dimension, cantidad: "1", um: "PZA" }] });
  }
  const r = conciliar(e.estado, e.corte), f = fila150(e);
  assert.deepEqual([f.fisico.toFixed(), f.salidas.toFixed(), f.estado], ["2", "2", "explicada"]);
  assert.equal(new Set(f.partidas.map((p) => p.linea.id)).size, 2);
  assert.equal(valesPorAplicar(r, e.corte).length, 2);
});

test("vincular escritura distinta elimina el falso faltante, se audita y permite deshacer o volver al automático", () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "MODELO SINTETICO" }), antes = datos(e.estado);
  assert.equal(fila150(e).estado, "faltante");
  const cambio = elegir(e);
  assert.equal(fila150(e).estado, "cuadra");
  assert.equal(datos(e.estado), antes);
  assert.equal(e.estado.auditoria.at(-1).accion, "VINCULAR_FISICO_AX");
  assert.equal(filasSolicitud(conciliar(e.estado, e.corte), e.corte).length, 0);
  deshacerVinculoFisico(e.estado, { corteId: e.corte.id, cambio });
  assert.equal(fila150(e).fisico.toFixed(), "2");
  elegir(e);
  const reset = quitarVinculosFisicos(e.estado, { corteId: e.corte.id, lineaIds: [1] });
  assert.equal(fila150(e).estado, "faltante");
  deshacerVinculoFisico(e.estado, { corteId: e.corte.id, cambio: reset });
  assert.equal(fila150(e).estado, "cuadra");
  e.dos.e.cantidad_conteo = "1";
  assert.deepEqual([fila150(e).fisico.toFixed(), fila150(e).estado], ["3", "faltante"]);
});

test("se impiden vínculos a variantes ocupadas, inexistentes o de otra unidad sin modificar el estado", () => {
  const e = escenarioGruposAx();
  for (const ids of [[e.otra.v.id], [999999]]) {
    const antes = JSON.stringify(e.estado);
    assert.throws(() => elegir(e, ids), ErrorConciliacion);
    assert.equal(JSON.stringify(e.estado), antes);
  }
  const otraUm = escenarioGruposAx(undefined, { segundaUm: "KG" });
  assert.throws(() => elegir(otraUm), /unidades de medida distintas: AX PZA; físico KG/);
  const cambio = elegir(e);
  elegir(e, [e.uno.v.id]);
  const antes = JSON.stringify(e.estado);
  assert.throws(() => deshacerVinculoFisico(e.estado, { corteId: e.corte.id, cambio }), /cambió después/);
  assert.equal(JSON.stringify(e.estado), antes);
  assert.throws(() => vincularFisico(e.estado, { corteId: e.corte.id, lineaIds: [1, 2], varianteIds: [e.uno.v.id] }), /cada dimensión/);
});

test("el vínculo pertenece al corte, admite físico vacío y deja pendientes las referencias que ya no existen", () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "MODELO SINTETICO" });
  elegir(e);
  const nuevo = registrarCorteAx(e.estado, { fecha: "2026-09-07", almacen: "ALMACEN SINTETICO", renglones: [e.linea("150VA", "4")] });
  assert.equal(conciliar(e.estado, nuevo).renglones[0].fisico.toFixed(), "2");
  e.estado.existencias = e.estado.existencias.filter((x) => x.id !== e.dos.e.id);
  const r = conciliar(e.estado, e.corte);
  assert.ok(r.porConfirmar.some((p) => p.metodo === "vinculo_pendiente"));
  assert.ok(!r.renglones.some((f) => f.lineas.some((l) => l.id === 1)));
  elegir(e, []);
  assert.equal(conciliar(e.estado, e.corte).axSinFisico.find((f) => f.linea.id === 1).fisico.toFixed(), "0");
  olvidarPareja(e.estado, { corteId: e.corte.id, lineaId: 1 });
  assert.equal(fila150(e).fisico.toFixed(), "2");
});

test("un vínculo recalcula la diferencia real con los vales ya asignados, sin forzar Cuadra", () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "MODELO SINTETICO" });
  e.estado.vales.push({ id: 1, folio: 1, tipo: "SALIDA", estado: "EMITIDO", fecha: "2026-09-01", lineas: [{ id: 1, codigo: e.codigo, clave: "150VA", cantidad: "2", existencia_id: null, um: "PZA" }] });
  e.corte.asignaciones.push({ id: 1, partida_id: 1, vale_id: 1, cantidad: "2", linea_ax_id: 1, variante_id: null });
  assert.equal(fila150(e).estado, "explicada");
  const antes = JSON.stringify([e.estado.vales, e.corte.asignaciones]);
  const previa = previaVinculoFisico(e.estado, { corteId: e.corte.id, lineaIds: [1], varianteIds: [e.uno.v.id, e.dos.v.id] });
  assert.equal(previa.estado, "sobrante");
  assert.equal(previa.sin_explicar.toFixed(), "2");
  elegir(e);
  assert.deepEqual([fila150(e).fisico.toFixed(), fila150(e).salidas.toFixed(), fila150(e).estado, fila150(e).sin_explicar.toFixed()], ["4", "2", "sobrante", "2"]);
  assert.equal(JSON.stringify([e.estado.vales, e.corte.asignaciones]), antes);
});

test("el vínculo persiste al respaldar, restaurar y volver a abrir", async () => {
  const e = escenarioGruposAx(undefined, { segundaDimension: "MODELO SINTETICO" });
  elegir(e);
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  await almacen.cargarPrimeraVez(e.estado, []);
  const respaldo = await almacen.respaldo();
  const otro = new Almacen(new BackendMemoria());
  await otro.iniciar();
  await otro.restaurar(respaldo.datos);
  const reabierto = new Almacen(otro.backend);
  await reabierto.iniciar();
  const f = conciliar(reabierto.estado, reabierto.estado.cortes_ax[0]).renglones[0];
  assert.deepEqual([f.ax.toFixed(), f.fisico.toFixed(), f.estado], ["4", "4", "cuadra"]);
});
