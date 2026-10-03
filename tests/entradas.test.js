// Fase 3: vales de entrada (ubicación sugerida, alta de variante, vista previa, folio E-0001,
// corrección y devoluciones).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import * as en from "../src/servicios/entradas.js";
import { variantesParecidas, ubicacionesSugeridas } from "../src/servicios/inventario.js";
import * as v from "../src/servicios/vales.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const total = (estado, id) => calcularSaldos(estado, [id]).get(id).total.toFixed();

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const renglones = (codigo) => estado.existencias.filter((e) => estado.variantes.find((x) => x.id === e.variante_id).codigo === codigo);
  const hoja = (e) => indices.ubicacion(e.ubicacion_id).hoja_excel.trim();
  const ubicacion = (texto) => estado.ubicaciones.find((u) => u.hoja_excel.trim() === texto);
  return { estado, indices, renglones, hoja, ubicacion };
}

function borrador(estado, lineas, extra = {}) {
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-100", origen: "BASE DOS BOCAS", depto_origen: "ALMACEN GENERAL", ...extra });
  b.lineas = lineas;
  return b;
}

test("el destino sugerido es el renglón con más existencia de esa variante (RF-31)", () => {
  const { estado, indices, renglones, hoja } = preparar();
  const opciones = en.destinosDeCodigo(estado, 701);
  const baleros = opciones.filter((o) => o.clave === "6309-2Z/C3");
  assert.equal(baleros.length, 2);
  const sugerida = baleros.find((o) => o.sugerida);
  assert.equal(sugerida.hoja, "CONTENEDOR #1 INVENTARIABLE");
  assert.equal(sugerida.total, 7);
  assert.ok(baleros.every((o) => o.enVarios));
  // Un código con una sola variante se asigna solo.
  const linea = en.entradaConArticulo(estado, en.lineaEntradaVacia(), 708, { indices });
  assert.equal(hoja(indices.existencia(linea.existencia_id)), "CONTENEDOR #1 CONSUMIBLE");
  assert.equal(linea.clave, "ISOFLEX");
  // Con varias variantes, se elige la clave.
  const varias = en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices });
  assert.equal(varias.existencia_id, null);
  assert.equal(varias.descripcion.length > 0, true);
  assert.equal(renglones(701).length, 3);
});

test("vista previa: había, entra y queda en la hoja de destino; nada cambia hasta confirmar (RF-32)", () => {
  const { estado, indices, renglones } = preparar();
  const [balero1] = renglones(701);
  const linea1 = { ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero1.id, indices), cantidad: "5" };
  const linea2 = { ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero1.id, indices), cantidad: "2" };
  const b = borrador(estado, [linea1, linea2, en.lineaEntradaVacia()]);
  const previa = en.vistaPreviaEntrada(estado, b);
  assert.equal(previa.length, 2);
  assert.deepEqual(previa.map((p) => [p.hoja, p.habia.toFixed(), p.entra.toFixed(), p.queda.toFixed()]), [
    ["CONTENEDOR #1 INVENTARIABLE", "7", "5", "12"],
    ["CONTENEDOR #1 INVENTARIABLE", "12", "2", "14"],
  ]);
  assert.equal(total(estado, balero1.id), "7");
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  assert.equal(vale.folio, 1);
  assert.equal(en.folioEntrada(vale.folio), "E-0001");
  assert.equal(total(estado, balero1.id), "14");
  assert.equal(calcularSaldos(estado, [balero1.id]).get(balero1.id).ingreso.toFixed(), "7");
  assert.equal(estado.borradores_entrada.length, 0);
  // El folio de la salida no se mueve: son consecutivos independientes.
  assert.equal(v.siguienteFolio(estado, "SALIDA"), 10);
  assert.equal(v.siguienteFolio(estado, "ENTRADA"), 2);
});

test("no se confirma con renglones sin destino ni con un folio de la base repetido", () => {
  const { estado, indices } = preparar();
  const sinDestino = { ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices }), cantidad: "1" };
  const b = borrador(estado, [sinDestino], { folio_externo: "" });
  const { errores } = en.validarEntrada(estado, b);
  // Sin elegir la clave tampoco hay unidad.
  assert.deepEqual(errores.map((e) => e.campo).sort(), ["destino", "folio_externo", "um"]);
  assert.throws(() => en.confirmarEntrada(estado, b.id, { usuario: USUARIO }), en.ErrorEntrada);
  assert.equal(estado.vales.filter((x) => x.tipo === "ENTRADA").length, 0);

  const ok = borrador(estado, [{ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 708, { indices }), cantidad: "3" }]);
  en.confirmarEntrada(estado, ok.id, { usuario: USUARIO });
  const otra = borrador(estado, [{ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 708, { indices }), cantidad: "3" }], { folio_externo: "b 100" });
  const repetida = en.validarEntrada(estado, otra);
  assert.match(repetida.errores[0].mensaje, /ya se registró en la entrada E-0001/);
  otra.folio_repetido = true;
  assert.equal(en.validarEntrada(estado, otra).errores.length, 0);
});

test("alta de variante: aviso de parecidas y renglón nuevo al final de la hoja elegida (RF-33)", () => {
  const { estado, indices, renglones, ubicacion } = preparar();
  const parecidas = variantesParecidas(estado, 701, { dimension: "6309 2Z C3", um: "PZA" });
  assert.equal(parecidas[0].variante.dimension, "6309-2Z/C3");
  assert.equal(parecidas[0].igual, false);
  assert.ok(parecidas[0].parecido >= 0.8);
  assert.deepEqual(parecidas[0].lugares.sort(), ["#1 Inv.", "#2 Inv."]);
  assert.equal(variantesParecidas(estado, 701, { dimension: "6309-2z/c3", um: "PZA" })[0].igual, true);
  assert.equal(variantesParecidas(estado, 701, { dimension: "HX-99", um: "PZA" }).length, 0);
  const sugeridas = ubicacionesSugeridas(estado, 701).map((s) => s.ubicacion.hoja_excel.trim());
  assert.deepEqual(sugeridas.slice(0, 2), ["CONTENEDOR #1 INVENTARIABLE", "CONTENEDOR #2 INVENTARIABLE"]);

  const c2cons = ubicacion("CONTENEDOR #2 CONSUMIBLE");
  const nueva = en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices }), cantidad: "4" }, { dimension: "6310-2rs", um: "pza", ubicacionId: c2cons.id });
  const b = borrador(estado, [nueva]);
  const [fila] = en.vistaPreviaEntrada(estado, b);
  assert.deepEqual([fila.tipo, fila.variante_nueva, fila.hoja, fila.habia.toFixed(), fila.queda.toFixed()], ["nuevo", true, "CONTENEDOR #2 CONSUMIBLE", "0", "4"]);
  const antes = estado.existencias.filter((e) => e.ubicacion_id === c2cons.id).length;
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const creado = indices.existencia(vale.lineas[0].existencia_id) ?? estado.existencias.find((e) => e.id === vale.lineas[0].existencia_id);
  assert.equal(estado.existencias.filter((e) => e.ubicacion_id === c2cons.id).length, antes + 1);
  assert.equal(creado.orden, Math.max(...estado.existencias.filter((e) => e.ubicacion_id === c2cons.id).map((e) => e.orden)));
  assert.equal(creado.cantidad_conteo, "0");
  assert.equal(total(estado, creado.id), "4");
  assert.equal(vale.lineas[0].clave, "6310-2RS");
  assert.equal(renglones(701).length, 4);

  // La misma variante "nueva" otra vez va al renglón que ya se creó (no duplica).
  const otra = en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices: new Indices(estado) }), cantidad: "1" }, { dimension: "6310-2RS", um: "PZA", ubicacionId: c2cons.id });
  const b2 = borrador(estado, [otra], { folio_externo: "B-101" });
  assert.equal(en.vistaPreviaEntrada(estado, b2)[0].tipo, "renglon");
  en.confirmarEntrada(estado, b2.id, { usuario: USUARIO });
  assert.equal(renglones(701).length, 4);
  assert.equal(total(estado, creado.id), "5");
});

test("la misma variante en otro contenedor crea su renglón; sin existencia no suma", () => {
  const { estado, indices, renglones, ubicacion } = preparar();
  const [, , balero2] = renglones(701);
  const c1cons = ubicacion("CONTENEDOR #1 CONSUMIBLE");
  const base = en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero2.id, indices);
  const otro = { ...en.conOtroContenedor(estado, base, c1cons.id, indices), cantidad: "2" };
  assert.equal(otro.existencia_id, null);
  assert.equal(otro.variante_id, balero2.variante_id);
  const diesel = { ...en.entradaSinExistencia({ ...en.lineaEntradaVacia(), codigo: 136, descripcion: "DIESEL", um: "LTS" }), cantidad: "1000" };
  const b = borrador(estado, [otro, diesel]);
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  assert.equal(vale.lineas[1].no_inventariado, true);
  assert.equal(vale.lineas[1].existencia_id, null);
  const nuevo = estado.existencias.find((e) => e.id === vale.lineas[0].existencia_id);
  assert.equal(nuevo.ubicacion_id, c1cons.id);
  assert.equal(nuevo.variante_id, balero2.variante_id);
  assert.equal(nuevo.origen, "ENTRADA E-0001");
  assert.equal(total(estado, nuevo.id), "2");
});

test("corregir una entrada: motivo con los cambios, avisa si la existencia queda negativa y no deja renglones huérfanos", () => {
  const { estado, indices, renglones, ubicacion } = preparar();
  const [balero1] = renglones(701);
  const c2cons = ubicacion("CONTENEDOR #2 CONSUMIBLE");
  const nueva = en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices }), cantidad: "4" }, { dimension: "6311", um: "PZA", ubicacionId: c2cons.id });
  const b = borrador(estado, [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero1.id, indices), cantidad: "10" }, nueva]);
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const creado = vale.lineas[1].existencia_id;
  // Sale material del balero después de la entrada.
  const salida = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: estado.plantillas_area.find((p) => p.nombre === "MECANICO").id, fecha: "2026-10-03" });
  salida.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad: "15" });
  v.emitirBorrador(estado, salida.id, { usuario: USUARIO });
  assert.equal(total(estado, balero1.id), "2");

  const datos = en.datosParaCorregirEntrada(estado, vale.id);
  datos.lineas[0].cantidad = "1"; // en realidad llegó 1
  datos.lineas = [datos.lineas[0]]; // y el renglón nuevo no llegó
  const { avisos } = en.validarEntrada(estado, datos, { excluirValeId: vale.id });
  assert.match(avisos[0].mensaje, /quedaría en -7/);
  const cambios = en.resumenCambiosEntrada(estado, vale, datos);
  assert.deepEqual(cambios, [
    "Partida 1 (701 BALEROS 6309-2Z/C3): cantidad 10 PZA → 1 PZA",
    "Se quitó la partida 2: 701 BALEROS 6311, 4 PZA",
  ]);
  assert.throws(() => en.corregirEntrada(estado, vale.id, datos, "", USUARIO), /motivo/);
  en.corregirEntrada(estado, vale.id, datos, cambios.join("\n"), USUARIO);
  assert.equal(total(estado, balero1.id), "-7");
  assert.equal(estado.existencias.some((e) => e.id === creado), false);
  const registro = v.bitacoraDeVale(estado, vale.id).at(-1);
  assert.equal(registro.accion, "CORREGIR");
  assert.equal(registro.antes.motivo, cambios.join("\n"));
  assert.equal(registro.antes.motivo_entrada, "BASE");
  assert.throws(() => en.corregirEntrada(estado, vale.id, en.datosParaCorregirEntrada(estado, vale.id), "x", USUARIO), /No hay cambios/);
});

test("devolución: los renglones regresan al renglón del que salieron", () => {
  const { estado, renglones } = preparar();
  const [balero1] = renglones(701);
  const salida = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: estado.plantillas_area.find((p) => p.nombre === "MECANICO").id, fecha: "2026-10-03" });
  salida.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad: "3" });
  const [emitido] = v.emitirBorrador(estado, salida.id, { usuario: USUARIO });
  assert.equal(total(estado, balero1.id), "4");
  const datos = en.datosDeDevolucion(estado, emitido.folio);
  assert.equal(datos.lineas[0].existencia_id, balero1.id);
  assert.equal(datos.origen, emitido.destino);
  const b = borrador(estado, datos.lineas, { ...datos, folio_externo: "D-1" });
  b.lineas[0].cantidad = "1";
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  assert.equal(vale.motivo, "DEVOLUCION");
  assert.equal(vale.devolucion_folio, emitido.folio);
  assert.equal(total(estado, balero1.id), "5");
  const filas = en.filtrarEntradas(en.filasEntradas(estado), { folio: "D-1" });
  assert.equal(filas.length, 1);
  assert.equal(estado.vales.at(-1).depto_origen, "ALMACEN");
  assert.throws(() => en.datosDeDevolucion(estado, 999), /No hay un vale de salida/);
});

test("historial de entradas con filtros por fecha, folio de la base, código y O.C. (RF-34)", () => {
  const { estado, indices } = preparar();
  const l = (codigo, cantidad, oc = "") => ({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), codigo, { indices }), cantidad, oc });
  en.confirmarEntrada(estado, borrador(estado, [l(708, "2", "4500123")]).id, { usuario: USUARIO });
  const b = borrador(estado, [l(708, "1"), l(706, "1")], { folio_externo: "B-200" });
  b.fecha = "2026-10-05";
  en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const filas = en.filasEntradas(estado);
  assert.equal(filas.length, 3);
  assert.equal(filas[0].folio_texto, "E-0002");
  assert.equal(en.filtrarEntradas(filas, { folio: "b200" }).length, 2);
  assert.equal(en.filtrarEntradas(filas, { codigo: "708" }).length, 2);
  assert.equal(en.filtrarEntradas(filas, { oc: "4500" }).length, 1);
  assert.equal(en.filtrarEntradas(filas, { desde: "2026-10-03" }).length, 2);
  assert.equal(en.filtrarEntradas(filas, { texto: "E-0001" }).length, 1);
});
