// Ronda 34, etapa 3: el buscador del paso 2 (Material) — índice, resultados por código, la última clave del área,
// agregar con la cantidad vacía y los contadores de la lista; y el ajuste «NP en el lote». Ronda 35: dos campos
// («Código o descripción» y «Dimensión o NP») en lugar de «Buscar en».

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import {
  agregarPartida,
  agregarPartidasDesdeVale,
  buscarMaterial,
  codigoNuevo,
  codigosConPartidas,
  conClaveManual,
  conOtraClave,
  conPartidasDeVale,
  contarPartidas,
  dimensionEnMaterial,
  entradasDeHoy,
  estadoPartida,
  filasEnOrden,
  indiceMaterial,
  lineaCodigoNuevo,
  opcionesEnOrden,
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

test("resultados por código: «Código o descripción» elige los códigos y «Dimensión o NP» sus claves", () => {
  const { items } = preparar();
  const foco = buscarMaterial(items, { material: "foco led" });
  assert.deepEqual(foco.grupos.map((g) => g.codigo), [711]);
  assert.equal(foco.grupos[0].filas.length, 4);
  assert.deepEqual(foco.grupos[0].filas.map((f) => f.np), ["LED 20W", "LED 50W", "X100", ""]);
  // «711» exacto primero aunque otros códigos empiecen igual; un número busca los códigos que empiezan así.
  assert.equal(buscarMaterial(items, { material: "711" }).grupos[0].codigo, 711);
  const prefijo = buscarMaterial(items, { material: "71" }).grupos.map((g) => String(g.codigo));
  assert.ok(prefijo.length >= 3 && prefijo.every((c) => c.startsWith("71")), prefijo.join());
  // La dimensión o NP acota las claves del código.
  const porNp = buscarMaterial(items, { material: "foco", dimension: "x100" });
  assert.deepEqual(filasEnOrden(porNp.grupos).map((f) => f.np), ["X100"]);
  assert.equal(porNp.grupos[0].usar, null, "X100 sí existe (como NP)");
  // Solo la dimensión, sin material: las claves que la traen en cualquier código y sin «Usar» (no se sabe de cuál).
  const soloDimension = buscarMaterial(items, { dimension: "x100" });
  assert.ok(filasEnOrden(soloDimension.grupos).length >= 1);
  assert.ok(filasEnOrden(soloDimension.grupos).every((f) => `${f.clave} ${f.np}`.includes("X100")));
  assert.ok(soloDimension.grupos.every((g) => g.usar === null));
  // El diésel no tiene partidas: sale como artículo sin existencia.
  const [diesel] = buscarMaterial(items, { material: "136" }).grupos;
  assert.deepEqual([diesel.codigo, diesel.filas[0].tipo, diesel.filas[0].total], [136, "articulo", null]);
  assert.deepEqual(buscarMaterial(items, { material: "   ", dimension: " " }), { grupos: [], mas: 0 });
  const limitado = buscarMaterial(items, { material: "7" }, { limite: 2 });
  assert.equal(limitado.grupos.length, 2);
  assert.ok(limitado.mas > 0);
});

test("la dimensión se encuentra junta o separada y con cualquier comilla (`6''` = `6\"`)", () => {
  const { items } = preparar();
  const empaque = items.find((i) => i.codigo === 704 && i.clave === '6"');
  assert.ok(empaque, "la fixture trae el empaque de 6\"");
  for (const escrito of ['6"', "6''", "6”", ' 6 " ']) {
    const r = buscarMaterial(items, { material: "704", dimension: escrito });
    assert.ok(r.grupos[0].filas.some((f) => f.id === empaque.id), escrito);
    assert.equal(r.grupos[0].usar, null, `«${escrito}» es la misma clave`);
  }
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

test("clave que no está: «Usar «…»» tal como se escribió en cada código que no la tiene (§4.5, Ronda 35)", () => {
  const { estado, items } = preparar();
  const descripcion = items.find((i) => i.codigo === 701).descripcion;
  let r = buscarMaterial(items, { material: "balero", dimension: "6309-2Z/C" });
  assert.deepEqual(r.grupos[0].usar, { tipo: "clave", codigo: 701, descripcion, clave: "6309-2Z/C" });
  assert.ok(r.grupos[0].filas.length >= 1, "las claves que la traen (6309-2Z/C3) siguen a la vista");
  assert.deepEqual(opcionesEnOrden(r.grupos).at(-1), r.grupos[0].usar, "«Usar» va al final de su código");
  assert.equal(buscarMaterial(items, { material: "balero", dimension: "6309-2Z/C3" }).grupos[0].usar, null, "esa sí existe");
  // Antes, las letras que también estaban en la descripción («X», «LED»…) se perdían de la clave: ahora se queda todo.
  r = buscarMaterial(items, { material: "711", dimension: 'led  x 2"' });
  assert.equal(r.grupos[0].usar.clave, 'LED X 2"');
  // Ninguna clave la trae: el código buscado enseña las que sí hay, de referencia.
  r = buscarMaterial(items, { material: "701", dimension: "ZZZ-1" });
  assert.deepEqual([r.grupos.length, r.grupos[0].sinCoincidencia, r.grupos[0].usar.clave], [1, true, "ZZZ-1"]);
  assert.equal(r.grupos[0].filas.length, items.filter((i) => i.codigo === 701).length);
  // Con varios códigos (por descripción), cada uno ofrece «Usar»; los que traen la dimensión van primero.
  r = buscarMaterial(items, { material: "o", dimension: "6309" });
  assert.ok(r.grupos.length > 1);
  assert.ok(r.grupos[0].filas.length > 0 && r.grupos.slice(1).every((g) => g.usar));
  assert.ok(r.grupos.filter((g) => !g.filas.length).every((g) => g.usar.clave === "6309"));
  // Sin material no se sabe para qué código: nada que usar.
  assert.equal(buscarMaterial(items, { dimension: "ZZZ-1" }).grupos.length, 0);
  // Lo escrito como material que en realidad es una dimensión: cuántas claves la traen.
  assert.ok(dimensionEnMaterial(items, "6309") >= 2);
  assert.equal(dimensionEnMaterial(items, "bomba"), 0);
});

test("código que no está en el catálogo (§4.6), con la dimensión escrita", () => {
  const { estado } = preparar();
  assert.deepEqual(codigoNuevo(estado, "1399 bomba sintetica"), { tipo: "codigo", codigo: 1399, descripcion: "BOMBA SINTETICA", clave: "" });
  assert.equal(codigoNuevo(estado, "1399", { dimension: " p-1  x " }).clave, "P-1 X");
  assert.equal(codigoNuevo(estado, "701"), null, "ya está en el catálogo");
  assert.equal(codigoNuevo(estado, "1399", { hayResultados: true }), null);
  assert.equal(codigoNuevo(estado, "foco"), null);
  const nuevo = lineaCodigoNuevo(1399, "bomba", "FX", "p-1");
  assert.deepEqual([nuevo.codigo, nuevo.descripcion, nuevo.no_inventariado, nuevo.existencia_id, nuevo.lote, nuevo.cantidad, nuevo.clave], [1399, "BOMBA", true, null, "FX", "", "P-1"]);
});

test("el estado de cada partida no recorre el inventario si ya se sabe qué códigos tienen partidas", () => {
  const { estado, indices, items } = preparar();
  const conPartidas = codigosConPartidas(items);
  assert.equal(conPartidas.has(701), true);
  assert.equal(conPartidas.has(136), false, "el diésel no tiene partidas");
  const manual = { ...v.lineaDesdeExistencia(estado, items.find((i) => i.codigo === 701).id), existencia_id: null, variante_id: null, no_inventariado: true, clave: "OTRA", cantidad: "1" };
  const diesel = { ...v.lineaNoInventariada(estado, 136), cantidad: "1" };
  for (const l of [manual, diesel]) assert.deepEqual(estadoPartida(estado, l, { indices, codigosConPartidas: conPartidas }), estadoPartida(estado, l, { indices }));
  assert.equal(estadoPartida(estado, manual, { indices, codigosConPartidas: conPartidas }).noDescuenta, true);
  assert.equal(estadoPartida(estado, diesel, { indices, codigosConPartidas: conPartidas }).noInventariado, true);
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
