// Ronda 14: justificar faltantes de la conciliación asignándoles vales sin IN / TR, con datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { HOJA_AJUSTE, HOJA_LEYENDA, HOJA_VALES, exportarSolicitudAjuste } from "../src/exportadores/ajuste.js";
import { leerArchivoBase } from "../src/importadores/base.js";
import { delAlmacen, leerReporteAx } from "../src/importadores/ax.js";
import { dec } from "../src/nucleo/decimal.js";
import { FORMATO_ESTADO, migrarEstado, siguienteId } from "../src/nucleo/estado.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { fechaMinimaJustificantes, fechaMinimaPropuesta } from "../src/nucleo/justificantes.js";
import { valesPorAplicar } from "../src/exportadores/ajuste.js";
import * as c from "../src/servicios/conciliacion.js";
import * as j from "../src/servicios/justificacion.js";
import { registrarSeguimiento } from "../src/servicios/seguimiento.js";
import { NOMBRE_AX, NOMBRE_BASE, bytesAx, bytesBase, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

/** Una partida más en un vale migrado del DIARIO (sin partida del inventario ligada). */
function agregarPartida(estado, vale, { codigo, clave, cantidad, descripcion = "ARTICULO", um = "PZA" }) {
  const linea = { ...vale.lineas[0], id: siguienteId(estado, "vale_linea"), renglon: vale.lineas.length + 1, codigo, clave, cantidad, descripcion, um, existencia_id: null, variante_id: null, no_inventariado: false };
  vale.lineas.push(linea);
  return linea;
}

/**
 * Faltantes del corte sintético: 709 CABLE 3/4 (AX 50, sin físico) y 710 S/D (AX 2, físico 0).
 * Vales que los justifican: folio 8 (04-sep, posterior al archivo de la base: sin IN / TR) con 30 + 20
 * de cable, y una lámpara de 2 escrita "LAMPARA" en el folio 4 (anterior al conteo). Otra lámpara en el
 * folio 8 es posterior al conteo y sin ubicar: el físico aún no la descuenta.
 */
function escenario({ conBase = true } = {}) {
  const { estado } = cargaSintetica();
  agregarPartida(estado, estado.vales.find((v) => v.folio === 4), { codigo: 710, clave: "LAMPARA", cantidad: "2", descripcion: "LAMPARA DE USO GENERAL" });
  const vale8 = { ...structuredClone(estado.vales.find((v) => v.folio === 3)), id: siguienteId(estado, "vale"), folio: 8, fecha: "2026-09-04", lineas: [] };
  estado.vales.push(vale8);
  agregarPartida(estado, vale8, { codigo: 709, clave: "CABLE 3/4", cantidad: "30", descripcion: "CABLES", um: "MTS" });
  agregarPartida(estado, vale8, { codigo: 709, clave: "CABLE 3/4", cantidad: "20", descripcion: "CABLES", um: "MTS" });
  agregarPartida(estado, vale8, { codigo: 710, clave: "LAMPARA", cantidad: "1", descripcion: "LAMPARA DE USO GENERAL" });
  if (conBase) {
    const b = leerArchivoBase(bytesBase());
    registrarSeguimiento(estado, { archivo: NOMBRE_BASE, partidas: b.partidas, ultimoFolio: b.ultimoFolio }, USUARIO);
  }
  const corte = c.registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "RIG91-IX25", renglones: delAlmacen(leerReporteAx(bytesAx(), NOMBRE_AX).renglones, "RIG91-IX25") }, USUARIO);
  return { estado, corte };
}

const fila = (r, codigo) => [...r.renglones, ...r.axSinFisico].find((x) => x.codigo === codigo);

test("candidatos: mismo código, con su estado (libre, posterior al conteo…) y si coincide la dimensión", () => {
  const { estado, corte } = escenario();
  const r = c.conciliar(estado, corte);
  assert.deepEqual(j.justificables(estado, r).map((x) => [x.codigo, x.falta.toFixed()]), [[703, "10"], [709, "50"], [710, "2"]]);
  const cable = j.candidatos(estado, r, fila(r, 709));
  assert.deepEqual(cable.map((k) => [k.vale.folio, k.cantidad.toFixed(), k.estado, k.coincide, k.sugerible]), [[8, "30", "libre", "exacta", true], [8, "20", "libre", "exacta", true]]);
  const lampara = j.candidatos(estado, r, fila(r, 710));
  assert.deepEqual(lampara.map((k) => [k.vale.folio, k.estado, k.sugerible]), [[4, "libre", true], [8, "posterior_conteo", false]]);
  assert.equal(lampara[0].coincide, "unica"); // "LAMPARA" no es la dimensión, pero el código tiene una sola partida
  // 703 solo tiene el folio 3, marcado CONPROV en la base: no se descuenta en AX, no es candidato.
  assert.deepEqual(j.candidatos(estado, r, fila(r, 703)), []);
});

test("sugerencias por cantidad exacta y aprobarlas: el faltante queda explicado por los vales asignados", () => {
  const { estado, corte } = escenario();
  const r = c.conciliar(estado, corte);
  const s = j.sugerencias(estado, r);
  const de = (codigo) => s.get(j.claveDestino(fila(r, codigo)));
  assert.deepEqual([de(709).partidas.map((p) => p.cantidad.toFixed()), de(709).suma.toFixed(), de(709).exacta], [["30", "20"], "50", true]);
  assert.deepEqual([de(710).partidas.map((p) => p.vale.folio), de(710).exacta], [[4], true]);
  assert.equal(de(703), undefined);
  assert.deepEqual(j.asignarSugeridas(estado, corte.id, USUARIO), { faltantes: 2, partidas: 3 });
  const despues = c.conciliar(estado, corte);
  assert.deepEqual([fila(despues, 709).estado, fila(despues, 709).folios], ["explicada", ["8 (S, asignado)"]]);
  assert.deepEqual([fila(despues, 710).estado, fila(despues, 710).folios], ["explicada", ["4 (S, asignado)"]]);
  assert.equal(despues.resumen.faltantes, r.resumen.faltantes - 2);
  // Siguen en la lista (con lo asignado) para poder quitarlo; ya no hay qué sugerir.
  const lista = j.justificables(estado, despues);
  assert.deepEqual(lista.filter((x) => x.asignadas.length).map((x) => [x.codigo, x.falta.toFixed(), x.asignadas.length]), [[709, "0", 2], [710, "0", 1]]);
  assert.equal(j.sugerencias(estado, despues).size, 0);
  assert.equal(estado.auditoria.filter((a) => a.accion === "ASIGNAR_VALES").length, 2);
  // Una partida solo se asigna una vez por corte.
  const yaAsignada = estado.cortes_ax[0].asignaciones[0].partida_id;
  assert.throws(() => j.asignarVales(estado, { corteId: corte.id, destino: { linea_ax_id: 1 }, partidas: [{ partida_id: yaAsignada }] }, USUARIO), j.ErrorJustificacion);
  // Quitarla regresa el faltante.
  const lamparas = estado.cortes_ax[0].asignaciones.filter((a) => a.codigo === 710).map((a) => a.id);
  assert.equal(j.quitarAsignaciones(estado, { corteId: corte.id, ids: lamparas }, USUARIO), 1);
  assert.equal(fila(c.conciliar(estado, corte), 710).estado, "faltante");
});

test("a mano: sin el archivo de la base, una salida anterior al corte se puede asignar (no se sugiere)", () => {
  const { estado, corte } = escenario({ conBase: false });
  const r = c.conciliar(estado, corte);
  const cable = j.candidatos(estado, r, fila(r, 709));
  assert.deepEqual(cable.map((k) => [k.estado, k.sugerible]), [["sin_base", false], ["sin_base", false]]);
  assert.equal(j.sugerencias(estado, r).size, 0);
  j.asignarVales(estado, { corteId: corte.id, destino: j.destinoDe(fila(r, 709)), partidas: cable.map((k) => ({ partida_id: k.linea.id, cantidad: k.cantidad })) }, USUARIO);
  assert.equal(fila(c.conciliar(estado, corte), 709).estado, "explicada");
  assert.equal(estado.cortes_ax[0].asignaciones[0].metodo, "manual");
});

test("mejor combinación: exacta con menos partidas; si no hay, la que más se acerca sin pasarse", () => {
  const pool = ["2", "3", "5", "9"].map((x, i) => ({ id: i, cantidad: dec(x) }));
  const de = (falta) => {
    const m = j.mejorCombinacion(pool, dec(falta));
    return m && [m.partidas.map((p) => p.cantidad.toFixed()), m.suma.toFixed(), m.exacta];
  };
  assert.deepEqual(de("5"), [["5"], "5", true]); // una sola antes que 2 + 3
  assert.deepEqual(de("10"), [["2", "3", "5"], "10", true]);
  assert.deepEqual(de("4"), [["3"], "3", false]); // 9 y 5 se pasan
  assert.equal(de("1"), null); // todas se pasan: mejor no sugerir
});

test("solicitud de ajuste: primero la LEYENDA, luego la hoja de AX igual y al final los VALES POR APLICAR", () => {
  const { estado, corte } = escenario();
  j.asignarSugeridas(estado, corte.id, USUARIO);
  const { datos, vales } = exportarSolicitudAjuste(estado, corte);
  const libro = new LibroLeido(datos);
  assert.deepEqual(libro.hojas.map((h) => h.nombre), [HOJA_LEYENDA, HOJA_AJUSTE, HOJA_VALES]);
  const leyenda = libro.hoja(HOJA_LEYENDA);
  const textos = [];
  for (let f = 1; f <= leyenda.maxFila; f++) textos.push(leyenda.fila(f, 1, 3).map((x) => x ?? "").join(" | "));
  for (const t of ["Cuadra", "Explicada por vales", "Sobrante", "Faltante", "Por confirmar", "(S) | Salida", "(E) | Entrada", "545 (S, asignado)"]) {
    assert.ok(textos.some((x) => x.includes(t)), t);
  }
  // La hoja de AX no cambia: encabezados en la fila 1 y el folio asignado en «Folios que justifican».
  const ax = libro.hoja(HOJA_AJUSTE);
  assert.equal(ax.valor(1, 1), "Código de Artículo");
  const filas = [];
  for (let f = 2; f <= ax.maxFila; f++) filas.push(ax.fila(f, 1, 13));
  assert.equal(filas.find((x) => x[5] === "CABLE 3/4")[11], "8 (S, asignado)");
  // Vales por aplicar: las asignadas (y lo posterior al reporte sin IN / TR), nada de lo que la base ya aplicó.
  const hoja = libro.hoja(HOJA_VALES);
  const renglones = [];
  for (let f = 2; f <= hoja.maxFila; f++) renglones.push(hoja.fila(f, 1, 13));
  assert.equal(renglones.length, vales);
  const cable = renglones.filter((x) => x[4] === "000000709");
  assert.deepEqual(cable.map((x) => [x[0], String(x[7]), x[9], x[11]]), [
    [8, "30", "CABLE 3/4", "Asignado por el almacén (sugerencia aprobada)"],
    [8, "20", "CABLE 3/4", "Asignado por el almacén (sugerencia aprobada)"],
  ]);
  assert.ok(!renglones.some((x) => x[0] === 2), "el folio 2 ya tiene TRS");
  // Del folio 1 la base aplicó 1 de 3: van las 2 que faltan.
  assert.deepEqual(renglones.filter((x) => x[0] === 1).map((x) => [String(x[7]), x[11], x[12]]), [["2", "Sin IN / TR en el archivo de la base", "1 de 3 en AX · IN00000101"]]);
});

test("formato 8: los cortes anteriores se migran con la lista de asignaciones vacía", () => {
  const { estado, corte } = escenario();
  delete corte.asignaciones;
  estado.formato = 7;
  migrarEstado(estado);
  assert.deepEqual([estado.formato, estado.cortes_ax[0].asignaciones], [FORMATO_ESTADO, []]);
});

function cableFechado(estado, fecha, folio) {
  const nuevo = { ...structuredClone(estado.vales.find((v) => v.folio === 8)), id: siguienteId(estado, "vale"), folio, fecha, lineas: [] };
  estado.vales.push(nuevo);
  agregarPartida(estado, nuevo, { codigo: 709, clave: "CABLE 3/4", cantidad: "50", um: "MTS" });
  return nuevo;
}

test("límite anual: octubre del año pasado no es candidato ni sugerencia; noviembre sí", () => {
  const { estado, corte } = escenario();
  const antiguo = cableFechado(estado, "2025-10-31", 90);
  const noviembre = cableFechado(estado, "2025-11-01", 91);
  cableFechado(estado, "2024-12-31", 92);
  cableFechado(estado, "2026-02-30", 93);
  cableFechado(estado, null, 94);
  assert.equal(fechaMinimaJustificantes(corte), "2025-11-01");
  assert.equal(fechaMinimaPropuesta("2027-02-01"), "2026-11-01");
  const r = c.conciliar(estado, corte);
  const candidatos = j.candidatos(estado, r, fila(r, 709));
  assert.deepEqual(candidatos.map((p) => p.vale.folio), [91, 8, 8]);
  const sugeridas = j.sugerencias(estado, r).get(j.claveDestino(fila(r, 709)));
  assert.deepEqual(sugeridas.partidas.map((p) => p.vale.id), [noviembre.id]);
  assert.ok(!r.transito.porLinea.has(antiguo.lineas[0].id));
  j.asignarSugeridas(estado, corte.id, USUARIO);
  assert.ok(corte.asignaciones.some((a) => a.vale_id === noviembre.id));
  assert.ok(!corte.asignaciones.some((a) => a.vale_id === antiguo.id));
});

test("asignar a mano no elude el límite y un lote inválido no deja asignaciones parciales", () => {
  const { estado, corte } = escenario();
  const antiguo = cableFechado(estado, "2025-10-31", 90);
  const noviembre = cableFechado(estado, "2025-11-01", 91);
  const destino = j.destinoDe(fila(c.conciliar(estado, corte), 709));
  const antes = JSON.stringify(estado);
  assert.throws(() => j.asignarVales(estado, {
    corteId: corte.id, destino,
    partidas: [noviembre, antiguo].map((v) => ({ partida_id: v.lineas[0].id })),
  }, USUARIO), /Solo se aceptan vales desde el 01\/11\/2025/);
  assert.equal(JSON.stringify(estado), antes);
  j.asignarVales(estado, { corteId: corte.id, destino, partidas: [{ partida_id: noviembre.lineas[0].id }] }, USUARIO);
  assert.equal(corte.asignaciones.length, 1);
  assert.equal(fila(c.conciliar(estado, corte), 709).estado, "explicada");
});

test("prórroga editable por corte: cambia sugerencias, cálculo y solicitud sin borrar vales ni asignaciones", () => {
  const { estado, corte } = escenario();
  const noviembre = cableFechado(estado, "2025-11-01", 91);
  const destino = j.destinoDe(fila(c.conciliar(estado, corte), 709));
  j.asignarVales(estado, { corteId: corte.id, destino, partidas: [{ partida_id: noviembre.lineas[0].id }] }, USUARIO);
  const vales = JSON.stringify(estado.vales), existencias = JSON.stringify(estado.existencias);
  const asignadas = JSON.stringify(corte.asignaciones);
  j.fijarFechaMinimaVales(estado, corte.id, "2025-12-01", USUARIO);
  const r = c.conciliar(estado, corte);
  assert.equal(fila(r, 709).estado, "faltante");
  assert.ok(!r.transito.porLinea.has(noviembre.lineas[0].id));
  assert.ok(!j.candidatos(estado, r, fila(r, 709)).some((p) => p.vale.id === noviembre.id));
  assert.ok(!valesPorAplicar(r, corte).some((p) => p.vale.id === noviembre.id));
  const salida = new LibroLeido(exportarSolicitudAjuste(estado, corte).datos).hoja(HOJA_VALES);
  for (let f = 2; f <= salida.maxFila; f++) assert.notEqual(salida.valor(f, 1), noviembre.folio);
  assert.equal(JSON.stringify(corte.asignaciones), asignadas);
  assert.equal(JSON.stringify(estado.vales), vales);
  assert.equal(JSON.stringify(estado.existencias), existencias);
  assert.equal(estado.auditoria.at(-1).accion, "CAMBIAR_FECHA_MINIMA_VALES");
  j.fijarFechaMinimaVales(estado, corte.id, "2025-11-01", USUARIO);
  assert.equal(fila(c.conciliar(estado, corte), 709).estado, "explicada");
  const otro = c.registrarCorteAx(estado, { fecha: "2027-01-03", almacen: corte.almacen, renglones: corte.lineas }, USUARIO);
  assert.equal(otro.fecha_minima_vales, "2026-11-01");
  assert.equal(corte.fecha_minima_vales, "2025-11-01");
});

test("la fecha mínima es válida y nunca posterior al reporte; un folio alto tampoco admite vales antiguos", () => {
  const { estado, corte } = escenario();
  const antiguo = cableFechado(estado, "2025-10-31", 9000);
  corte.folio_salida = 0;
  assert.equal(c.enTransito(corte, antiguo), false);
  assert.ok(!c.transitoDesde(estado, corte).porLinea.has(antiguo.lineas[0].id));
  for (const fecha of ["", "2026-02-30", "2026-09-06", "texto", null]) {
    const antes = JSON.stringify(estado);
    assert.throws(() => j.fijarFechaMinimaVales(estado, corte.id, fecha, USUARIO), j.ErrorJustificacion);
    assert.equal(JSON.stringify(estado), antes);
  }
});
