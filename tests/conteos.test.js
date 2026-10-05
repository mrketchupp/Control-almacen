// Fase 3: conteo físico total o parcial (corte por renglón), sobrantes y reacomodos.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { migrarEstado } from "../src/nucleo/estado.js";
import { calcularSaldos, cortesVigentes } from "../src/nucleo/existencias.js";
import { lineasPorUbicar, resumen } from "../src/servicios/consultas.js";
import * as co from "../src/servicios/conteos.js";
import * as en from "../src/servicios/entradas.js";
import { historialReacomodos, reacomodar } from "../src/servicios/reacomodos.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const saldo = (estado, id) => calcularSaldos(estado, [id]).get(id);

function preparar() {
  const { estado } = cargaSintetica();
  const variante = (e) => estado.variantes.find((x) => x.id === e.variante_id);
  const renglones = (codigo) => estado.existencias.filter((e) => variante(e).codigo === codigo);
  const ubicacion = (texto) => estado.ubicaciones.find((u) => u.hoja_excel.trim() === texto);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const salida = (lineas, fecha = "2026-10-01") => {
    const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha });
    for (const [id, cantidad] of lineas) b.lineas.push({ ...v.lineaDesdeExistencia(estado, id), cantidad });
    return v.emitirBorrador(estado, b.id, { usuario: USUARIO })[0];
  };
  return { estado, renglones, ubicacion, salida };
}

test("un conteo parcial reinicia CONSUMO/INGRESO solo en los contenedores contados (criterio F3)", () => {
  const { estado, renglones, ubicacion, salida } = preparar();
  const [balero1, balero1b, balero2] = renglones(701); // #1 INV, #1 INV, #2 INV
  salida([[balero1.id, "2"], [balero2.id, "1"]]);
  assert.deepEqual([saldo(estado, balero1.id).consumo.toFixed(), saldo(estado, balero2.id).consumo.toFixed()], ["2", "1"]);

  const c1inv = ubicacion("CONTENEDOR #1 INVENTARIABLE");
  const datos = co.iniciarConteo(estado, { ubicaciones: [c1inv.id], usuario: USUARIO, fecha: "2026-10-05" });
  assert.equal(datos.total, false);
  assert.throws(() => co.iniciarConteo(estado, {}), co.ErrorConteo);
  const filas = co.renglonesDelConteo(estado);
  assert.ok(filas.every((f) => f.ubicacion_id === c1inv.id));
  assert.equal(filas.find((f) => f.id === balero1.id).teorico.toFixed(), "5");
  co.guardarConteoEnCurso(estado, { ...datos, capturas: { [balero1.id]: "4", [balero1b.id]: "6" } });
  assert.deepEqual(co.resumenConteo(estado), { renglones: filas.length, contados: 2, faltan: filas.length - 2, con_diferencia: 1, sobrantes: 0 });

  const conteo = co.aplicarConteo(estado, { usuario: USUARIO });
  assert.equal(estado.conteo_en_curso, null);
  assert.equal(conteo.alcance, "PARCIAL");
  assert.equal(conteo.ultimo_folio_salida, 10);
  // Contados: CANTIDAD = contado, sin consumo.
  assert.deepEqual([saldo(estado, balero1.id).cantidad.toFixed(), saldo(estado, balero1.id).consumo.toFixed()], ["4", "0"]);
  // No contados (otro contenedor): siguen con su conteo y su consumo.
  assert.deepEqual([saldo(estado, balero2.id).cantidad.toFixed(), saldo(estado, balero2.id).consumo.toFixed()], ["3", "1"]);
  // Lo anterior queda en el historial del conteo.
  const linea = conteo.lineas.find((l) => l.existencia_id === balero1.id);
  assert.deepEqual([linea.contado, linea.teorico, linea.cantidad_anterior, linea.conteo_anterior_id], ["4", "5", "7", 1]);
  // Cortes: el más antiguo sigue siendo el de la primera carga (el #2 no se contó).
  assert.deepEqual(cortesVigentes(estado), { salida: 5, entrada: 0 });
  // Una salida posterior descuenta en ambos.
  salida([[balero1.id, "1"], [balero2.id, "1"]]);
  assert.deepEqual([saldo(estado, balero1.id).total.toFixed(), saldo(estado, balero2.id).total.toFixed()], ["3", "1"]);
  const [hist] = co.historialConteos(estado);
  assert.equal(hist.diferencias.length, 1);
  assert.equal(hist.diferencias[0].diferencia.toFixed(), "-1");
  assert.equal(resumen(estado).conteo_alcance, "PARCIAL");
});

test("el inventario exportado refleja el conteo parcial: CONSUMO vacío solo en los contados", () => {
  const { estado, renglones, ubicacion, salida } = preparar();
  const [balero1, , balero2] = renglones(701);
  salida([[balero1.id, "2"], [balero2.id, "1"]]);
  const c1inv = ubicacion("CONTENEDOR #1 INVENTARIABLE");
  const datos = co.iniciarConteo(estado, { ubicaciones: [c1inv.id], fecha: "2026-10-05" });
  co.guardarConteoEnCurso(estado, { ...datos, capturas: { [balero1.id]: "5" } });
  co.aplicarConteo(estado);
  const libro = new LibroLeido(exportarInventario(estado, bytesInventario()).datos);
  const fila = (hoja, codigo, dimension) => {
    const h = libro.hoja(libro.nombresHojas.find((n) => n.trim() === hoja));
    for (let r = 2; r <= h.maxFila; r++) if (h.valor(r, 2) === codigo && h.valor(r, 4) === dimension) return [h.valor(r, 6), h.valor(r, 8)];
    return null;
  };
  assert.deepEqual(fila("CONTENEDOR #1 INVENTARIABLE", 701, "6309-2Z/C3").map(String), ["5", "null"]);
  assert.deepEqual(fila("CONTENEDOR #2 INVENTARIABLE", 701, "6309-2Z/C3").map(String), ["3", "1"]);
});

test("vales emitidos mientras se contaba: el corte es el del inicio, o el de ahora si ya estaban descontados", () => {
  for (const corteAlAplicar of [false, true]) {
    const { estado, renglones, salida } = preparar();
    const [balero1] = renglones(701);
    const datos = co.iniciarConteo(estado, { fecha: "2026-10-05" });
    assert.equal(datos.total, true);
    const vale = salida([[balero1.id, "2"]]); // sale mientras se cuenta
    co.guardarConteoEnCurso(estado, { ...datos, capturas: { [balero1.id]: "7" } });
    assert.deepEqual(co.valesDuranteConteo(estado).map((x) => x.folio), [vale.folio]);
    const conteo = co.aplicarConteo(estado, { corteAlAplicar });
    // Contado antes de que saliera (se descuenta) o después (ya no se descuenta).
    assert.equal(saldo(estado, balero1.id).total.toFixed(), corteAlAplicar ? "7" : "5");
    assert.equal(conteo.ultimo_folio_salida, corteAlAplicar ? vale.folio : vale.folio - 1);
  }
});

test("renglones encontrados (sobrantes) y validación del conteo", () => {
  const { estado, renglones, ubicacion } = preparar();
  const c2cons = ubicacion("CONTENEDOR #2 CONSUMIBLE");
  const datos = co.iniciarConteo(estado, { ubicaciones: [c2cons.id] });
  assert.equal(co.validarConteo(estado)[0].campo, "capturas");
  const [, cinta12] = renglones(705);
  const sobrante = { ...co.nuevoSobrante(c2cons.id), codigo: 701, descripcion: "BALEROS", dimension: "6312", um: "PZA", cantidad: "2" };
  const yaEstaba = { ...co.nuevoSobrante(c2cons.id), codigo: 705, variante_id: cinta12.variante_id, um: "MTS", cantidad: "9" };
  co.guardarConteoEnCurso(estado, { ...datos, capturas: { [cinta12.id]: "-1" }, nuevos: [sobrante, yaEstaba] });
  assert.match(co.validarConteo(estado)[0].mensaje, /número/);
  co.guardarConteoEnCurso(estado, { ...datos, capturas: {}, nuevos: [sobrante, yaEstaba] });
  const conteo = co.aplicarConteo(estado);
  assert.equal(conteo.nuevos.length, 1);
  const nuevo = estado.existencias.find((e) => e.id === conteo.nuevos[0]);
  assert.deepEqual([nuevo.ubicacion_id, nuevo.cantidad_conteo, nuevo.conteo_id], [c2cons.id, "2", conteo.id]);
  // El que ya estaba en ese contenedor cuenta como renglón contado.
  assert.equal(saldo(estado, cinta12.id).total.toFixed(), "9");
  assert.equal(conteo.lineas.length, 2);
});

test("reacomodo: mueve material a otro contenedor sin cambiar el total", () => {
  const { estado, renglones, ubicacion, salida } = preparar();
  const [balero1, , balero2] = renglones(701);
  salida([[balero1.id, "1"]]);
  const suma = () => renglones(701).reduce((t, e) => t.plus(saldo(estado, e.id).total), saldo(estado, balero1.id).total.minus(saldo(estado, balero1.id).total));
  const antes = suma().toFixed();
  const c2cons = ubicacion("CONTENEDOR #2 CONSUMIBLE");
  assert.throws(() => reacomodar(estado, { desdeId: balero1.id, ubicacionId: c2cons.id, cantidad: "7" }), /Solo hay 6/);
  assert.throws(() => reacomodar(estado, { desdeId: balero1.id, ubicacionId: balero1.ubicacion_id, cantidad: "1" }), /ya está en ese contenedor/);
  const registro = reacomodar(estado, { desdeId: balero1.id, ubicacionId: c2cons.id, cantidad: "4", motivo: "Se pasó al contenedor 2", usuario: USUARIO });
  assert.equal(registro.renglon_nuevo, true);
  const nuevo = estado.existencias.find((e) => e.id === registro.hacia_existencia_id);
  assert.equal(nuevo.ubicacion_id, c2cons.id);
  assert.equal(suma().toFixed(), antes);
  // Los dos quedan como recién contados: CANTIDAD = lo que queda, sin consumo.
  assert.deepEqual([saldo(estado, balero1.id).cantidad.toFixed(), saldo(estado, balero1.id).consumo.toFixed()], ["2", "0"]);
  assert.equal(saldo(estado, nuevo.id).cantidad.toFixed(), "4");
  // Otro movimiento al mismo contenedor usa el mismo renglón.
  const otro = reacomodar(estado, { desdeId: balero2.id, ubicacionId: c2cons.id, cantidad: "1" });
  assert.equal(otro.hacia_existencia_id, nuevo.id);
  assert.equal(saldo(estado, nuevo.id).total.toFixed(), "5");
  assert.equal(suma().toFixed(), antes);
  assert.equal(historialReacomodos(estado)[0].id, otro.id);
  // No aparecen como conteos físicos.
  assert.equal(co.historialConteos(estado).length, 1);
  assert.equal(resumen(estado).conteo_alcance, "TOTAL");
});

test("renglones por ubicar respetan el corte de cada renglón; un respaldo del formato 4 se migra", () => {
  const { estado, renglones, ubicacion } = preparar();
  const porUbicar = lineasPorUbicar(estado).length;
  // Un conteo parcial no esconde los pendientes de los contenedores que no se contaron.
  const c1inv = ubicacion("CONTENEDOR #1 INVENTARIABLE");
  const datos = co.iniciarConteo(estado, { ubicaciones: [c1inv.id] });
  co.guardarConteoEnCurso(estado, { ...datos, capturas: { [renglones(701)[0].id]: "7" } });
  co.aplicarConteo(estado);
  assert.equal(lineasPorUbicar(estado).length, porUbicar);

  const viejo = structuredClone(cargaSintetica().estado);
  viejo.formato = 4;
  delete viejo.borradores_entrada;
  delete viejo.conteo_en_curso;
  delete viejo.reacomodos;
  delete viejo.conteos[0].alcance;
  migrarEstado(viejo);
  assert.equal(viejo.formato, 8);
  assert.deepEqual(viejo.seguimientos_base, []);
  assert.equal(viejo.conteos[0].alcance, "TOTAL");
  // Entradas y conteos funcionan sobre un estado migrado.
  const b = en.nuevoBorradorEntrada(viejo, { usuario: USUARIO });
  assert.equal(b.destino, "RIG 91");
  co.iniciarConteo(viejo, {});
  assert.ok(viejo.conteo_en_curso);
});
