// Ronda 34, etapa 3: el buscador del paso 2 (Material) — índice, «Buscar en», resultados por código, la última clave
// del área, agregar con la cantidad vacía y los contadores de la lista; y el ajuste «NP en el lote».

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import {
  agregarPartida,
  agregarPartidasDesdeVale,
  buscarMaterial,
  claveNueva,
  codigoNuevo,
  conClaveManual,
  conOtraClave,
  conPartidasDeVale,
  contarPartidas,
  entradasDeHoy,
  filasEnOrden,
  indiceMaterial,
  lineaCodigoNuevo,
  partidasDelVale,
  ultimasDeArea,
} from "../src/servicios/buscarMaterial.js";
import { hoyIso } from "../src/nucleo/fechas.js";
import * as en from "../src/servicios/entradas.js";
import { fijarAjuste } from "../src/servicios/catalogos.js";
import * as v from "../src/servicios/vales.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const area = (estado, nombre) => estado.plantillas_area.find((p) => p.nombre === nombre);

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  return { estado, indices, items: indiceMaterial(estado, { indices }) };
}

test("resultados agrupados por código; un número exacto va primero; «Buscar en» acota", () => {
  const { items } = preparar();
  const foco = buscarMaterial(items, "foco led");
  assert.deepEqual(foco.grupos.map((g) => g.codigo), [711]);
  assert.equal(foco.grupos[0].filas.length, 4);
  assert.deepEqual(foco.grupos[0].filas.map((f) => f.np), ["LED 20W", "LED 50W", "X100", ""]);
  // «711» exacto primero aunque otros códigos empiecen igual; en «Solo código», letras no encuentran nada.
  assert.equal(buscarMaterial(items, "711").grupos[0].codigo, 711);
  const prefijo = buscarMaterial(items, "71", { alcance: "codigo" }).grupos.map((g) => String(g.codigo));
  assert.ok(prefijo.length >= 3 && prefijo.every((c) => c.startsWith("71")), prefijo.join());
  assert.equal(buscarMaterial(items, "foco", { alcance: "codigo" }).grupos.length, 0);
  // Por NP: solo la clave que lo trae; en «Solo descripción» el NP no cuenta.
  const porNp = filasEnOrden(buscarMaterial(items, "x100", { alcance: "dimension" }).grupos);
  assert.ok(porNp.some((f) => f.codigo === 711 && f.np === "X100"));
  assert.ok(porNp.every((f) => `${f.clave} ${f.np}`.includes("X100")), "solo las claves con esa dimensión o NP");
  assert.equal(buscarMaterial(items, "x100", { alcance: "descripcion" }).grupos.length, 0);
  // El diésel no tiene partidas: sale como artículo sin existencia.
  const [diesel] = buscarMaterial(items, "136").grupos;
  assert.deepEqual([diesel.codigo, diesel.filas[0].tipo, diesel.filas[0].total], [136, "articulo", null]);
  assert.deepEqual(buscarMaterial(items, "   "), { grupos: [], mas: 0 });
  const limitado = buscarMaterial(items, "7", { alcance: "codigo", limite: 2 });
  assert.equal(limitado.grupos.length, 2);
  assert.ok(limitado.mas > 0);
});

test("agregar deja la cantidad vacía; el NP no va al lote salvo con el ajuste; contadores de la lista", () => {
  const { estado, indices, items } = preparar();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id });
  b.lineas.push(v.lineaVacia()); // los borradores de antes traían una fila en blanco
  const conNp = items.find((i) => i.codigo === 711 && i.np === "LED 20W");
  let { datos, linea } = agregarPartida(estado, b, conNp, { indices });
  assert.deepEqual([linea.existencia_id, linea.cantidad, linea.clave, linea.lote, linea.um], [conNp.id, "", "S/D", "", "PZA"]);
  assert.equal(datos.lineas.length, 1, "sin la fila en blanco");
  const diesel = items.find((i) => i.codigo === 136);
  ({ datos } = agregarPartida(estado, datos, diesel, { indices }));
  const ultima = datos.lineas.at(-1);
  assert.deepEqual([ultima.no_inventariado, ultima.existencia_id, ultima.um, ultima.clave], [true, null, "", "S/D"]);
  datos.lineas.push({ ...v.lineaDesdeExistencia(estado, conNp.id), existencia_id: null, variante_id: null, no_inventariado: true, clave: "OTRA", cantidad: "1" });
  datos.lineas.push({ ...v.lineaDesdeExistencia(estado, conNp.id), existencia_id: null, variante_id: null, no_inventariado: false, cantidad: "1" });
  assert.deepEqual(contarPartidas(estado, datos.lineas, { indices }), { total: 4, sinCantidad: 2, noDescuentan: 1, sinClave: 1 });
  assert.equal(partidasDelVale([v.lineaVacia(), ...datos.lineas]).length, 4);
  // Con el ajuste, el NP sí se pone en el lote.
  fijarAjuste(estado, "np_en_lote", true, USUARIO);
  assert.equal(agregarPartida(estado, b, conNp, { indices }).linea.lote, "LED 20W");
  assert.equal(estado.auditoria.at(-1).entidad_id, "np_en_lote");
});

test("la última clave que se llevó el área, del vale de salida más reciente", () => {
  const { estado, indices, items } = preparar();
  const focos = items.filter((i) => i.codigo === 711);
  const emitir = (existenciaId) => {
    const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
    Object.assign(b, { recibio_nombre: "MECANICO UNO", etapa_perforacion: '12 1/4"' });
    b.lineas.push({ ...v.conExistencia(estado, v.lineaVacia(), existenciaId, indices), cantidad: "1" });
    v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  };
  emitir(focos[0].id);
  emitir(focos[1].id);
  const mecanico = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id });
  assert.equal(ultimasDeArea(estado, mecanico).get(711), focos[1].id);
  const soldador = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "SOLDADOR").id });
  assert.notEqual(ultimasDeArea(estado, soldador).get(711), focos[1].id);
  assert.equal(ultimasDeArea(estado, v.nuevoBorrador(estado, { usuario: USUARIO })).size, 0);
});

test("editar una partida: otra clave conserva cantidad, lote y O.C.; una clave escrita no descuenta", () => {
  const { estado, indices, items } = preparar();
  const baleros = items.filter((i) => i.codigo === 701);
  assert.ok(baleros.length >= 2);
  const linea = { ...v.conExistencia(estado, v.lineaVacia(), baleros[0].id, indices), cantidad: "3", lote: "NUEVO", oc: "OC-1" };
  const otra = conOtraClave(estado, linea, baleros[1], { indices });
  assert.deepEqual([otra.uid, otra.existencia_id, otra.cantidad, otra.lote, otra.oc], [linea.uid, baleros[1].id, "3", "NUEVO", "OC-1"]);
  // Otro material (el diésel) reemplaza la partida: no inventariado, la UM se escribe.
  const diesel = conOtraClave(estado, linea, items.find((i) => i.codigo === 136), { indices });
  assert.deepEqual([diesel.codigo, diesel.no_inventariado, diesel.existencia_id, diesel.cantidad, diesel.lote, diesel.um], [136, true, null, "3", "NUEVO", ""]);
  const manual = conClaveManual(linea, "6309-2z/c");
  assert.deepEqual([manual.clave, manual.existencia_id, manual.no_inventariado, manual.lote, manual.cantidad], ["6309-2Z/C", null, true, "NUEVO", "3"]);
  // El lote que se puso solo (NP) se quita con la clave escrita; el escrito a mano se queda.
  estado.config.np_en_lote = true;
  const conNp = v.conExistencia(estado, v.lineaVacia(), items.find((i) => i.codigo === 711 && i.np === "LED 20W").id, indices);
  assert.equal(conNp.lote, "LED 20W");
  assert.equal(conClaveManual(conNp, "OTRA").lote, "");
});

test("clave que no está y código que no está en el catálogo (§4.5, §4.6)", () => {
  const { estado, items } = preparar();
  assert.deepEqual(claveNueva(items, "balero 6309-2Z/C"), { codigo: 701, descripcion: items.find((i) => i.codigo === 701).descripcion, clave: "6309-2Z/C" });
  assert.equal(claveNueva(items, "balero 6309-2Z/C3"), null, "esa sí existe");
  assert.equal(claveNueva(items, "balero"), null, "sin clave escrita");
  assert.equal(claveNueva(items, "6309-2Z/C"), null, "sin código no se sabe de cuál");
  assert.equal(claveNueva(items, "701 ABC-1").clave, "ABC-1");
  assert.equal(claveNueva(items, "foco led", { alcance: "descripcion" }), null);
  // Al editar, en «Solo código» lo escrito es una clave del código de la partida.
  assert.equal(claveNueva(items, "704 8 1/2", { codigo: 704 }).clave, "8 1/2");
  assert.deepEqual(codigoNuevo(estado, "1399 bomba sintetica"), { codigo: 1399, descripcion: "BOMBA SINTETICA" });
  assert.equal(codigoNuevo(estado, "701"), null, "ya está en el catálogo");
  assert.equal(codigoNuevo(estado, "1399", { hayResultados: true }), null);
  assert.equal(codigoNuevo(estado, "foco"), null);
  const nuevo = lineaCodigoNuevo(1399, "bomba", "FX");
  assert.deepEqual([nuevo.codigo, nuevo.descripcion, nuevo.no_inventariado, nuevo.existencia_id, nuevo.lote, nuevo.cantidad], [1399, "BOMBA", true, null, "FX", ""]);
});

test("traer partidas de una entrada al vale abierto, no a uno nuevo (§4.7)", () => {
  const { estado, indices } = preparar();
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const be = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(be, { folio_externo: "B-9", origen: "BASE PRUEBA" });
  be.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "2", oc: "OC-5" }];
  const entrada = en.confirmarEntrada(estado, be.id, { usuario: USUARIO });
  assert.deepEqual(entradasDeHoy(estado, hoyIso()).map((v2) => v2.id), [entrada.id]);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero.id), cantidad: "1" });
  const antes = estado.borradores.length;
  const r = agregarPartidasDesdeVale(estado, b.id, entrada.id);
  assert.equal(estado.borradores.length, antes, "no crea otro borrador");
  assert.deepEqual([r.partidas, b.lineas.length, b.lineas[1].cantidad, b.lineas[1].oc, b.lineas[1].existencia_id], [1, 2, "2", "OC-5", balero.id]);
  assert.throws(() => conPartidasDeVale(estado, b, 99999), /No se encontró/);
});

test("material de FX: su lote es «FX» por omisión y se quita al cambiar a una partida que no es de FX", () => {
  const { estado, indices } = preparar();
  const [fx, normalE] = estado.existencias.filter((e) => indices.variante(e.variante_id).codigo === 701);
  fx.dueno = "FX";
  const conFx = v.conExistencia(estado, v.lineaVacia(), fx.id, indices);
  assert.deepEqual([conFx.lote, conFx.lote_fx], ["FX", true]);
  const sinFx = v.conExistencia(estado, conFx, normalE.id, indices);
  assert.equal(sinFx.lote, "");
  // Lo escrito a mano no se toca.
  assert.equal(v.conExistencia(estado, { ...v.lineaVacia(), lote: "PRESTAMO" }, fx.id, indices).lote, "PRESTAMO");
});
