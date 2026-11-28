// Ronda 39, etapas 3 a 5 (docs/14 §5–§7, §13): el material de la entrada (tipo inicial, agregar, editar, Copilot,
// filtros), el acomodo por contenedor (★ con 0, 1 y 2 contenedores con existencia, ubicación = contenedor + clase,
// contenedores tomados de los datos: 3 y 7) y lo que se revisa antes de registrar.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { ErrorAcomodo, acomodar, acomodoAutomatico, acomodoDe, avanceAcomodo, conTipo, contenedoresDe, desacomodar, varianteDeLinea } from "../src/servicios/acomodoEntrada.js";
import * as en from "../src/servicios/entradas.js";
import {
  camposDeLinea,
  conCamposEditados,
  conVarianteParecida,
  filtrosDeMaterial,
  parecidaDe,
  partidaDesdeResultado,
  porRevisar,
  tipoDeLinea,
  tipoInicial,
  umDeLosVales,
} from "../src/servicios/materialEntrada.js";
import { antesDeRegistrar, faltaAcomodo, leerRespuestaCopilot } from "../src/servicios/pasosEntrada.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const partida = (codigo, dimension) =>
    estado.existencias.find((e) => {
      const v = indices.variante(e.variante_id);
      return v.codigo === codigo && (dimension === undefined || v.dimension === dimension);
    });
  const hoja = (e) => indices.ubicacion(e.ubicacion_id).hoja_excel.trim();
  return { estado, indices, partida, hoja };
}

/** Agrega hojas de contenedores al estado: [[numero, clase], …]. */
function conHojas(estado, hojas) {
  let id = Math.max(...estado.ubicaciones.map((u) => u.id));
  let orden = Math.max(...estado.ubicaciones.map((u) => u.orden));
  for (const [numero, clase] of hojas) {
    estado.ubicaciones.push({ id: ++id, contenedor: numero, clase, hoja_excel: `CONTENEDOR #${numero} ${clase === "INV" ? "INVENTARIABLE" : "CONSUMIBLE"}`, tabla_excel: null, orden: ++orden });
  }
}

test("tipo inicial (§5.1): según su existencia, consumible por la regla de los 3 dígitos o el de Ajustes", () => {
  const { estado, indices, partida } = preparar();
  const baleros = en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(701, "6205-2Z").id, indices);
  assert.deepEqual(tipoInicial(estado, baleros, { indices }), { clase: "INV", motivo: "existencia" });
  const empaque = en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(704).id, indices);
  assert.deepEqual(tipoInicial(estado, empaque, { indices }), { clase: "CONS", motivo: "existencia" });
  // Variante nueva de un código: la de Ajustes (Consumible de fábrica; Inventariable si se eligió).
  const nueva = partidaDesdeResultado(estado, { tipo: "clave", codigo: 701, descripcion: "BALEROS", clave: "6311-2RS" }, { indices });
  assert.deepEqual(tipoInicial(estado, nueva, { indices }), { clase: "CONS", motivo: "defecto" });
  estado.config.tipo_partida_entrada = "INV";
  assert.deepEqual(tipoInicial(estado, nueva, { indices }), { clase: "INV", motivo: "defecto" });
  // GSM: un código de 3 dígitos sin existencia es consumible y no se cambia.
  estado.config.inventario = "GSM";
  const tornillos = partidaDesdeResultado(estado, { tipo: "clave", codigo: 703, descripcion: "TORNILLOS", clave: '1/2"' }, { indices });
  assert.deepEqual(tipoInicial(estado, tornillos, { indices }), { clase: "CONS", motivo: "regla" });
  assert.deepEqual(tipoDeLinea(estado, { ...tornillos, clase: "INV" }, { indices }), { clase: "CONS", nota: "consumible por regla", bloqueado: true });
  assert.equal(tipoDeLinea(estado, baleros, { indices }).nota, "según su existencia");
});

test("acomodo solo (★) con 0, 1 y 2 contenedores con existencia de su tipo", () => {
  const { estado, indices, partida, hoja } = preparar();
  // 1 contenedor: queda ahí.
  const una = acomodoAutomatico(estado, { ...desacomodar(en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(701, "6205-2Z").id, indices), indices), clase: "INV" }, { indices });
  const a1 = acomodoDe(estado, una, { indices });
  assert.deepEqual([a1.estado, a1.contenedor, a1.ya], ["acomodada", 1, true]);
  // 2 contenedores: falta elegir, con dónde hay.
  const dos = acomodoAutomatico(estado, { ...desacomodar(en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(701, "6309-2Z/C3").id, indices), indices), clase: "INV" }, { indices });
  assert.deepEqual(acomodoDe(estado, dos, { indices }), { estado: "pendiente", donde: [1, 2] });
  // 0: variante nueva, o una variante que no tiene existencia de ese tipo.
  const nueva = acomodoAutomatico(estado, partidaDesdeResultado(estado, { tipo: "clave", codigo: 701, descripcion: "BALEROS", clave: "6311-2RS" }, { indices }), { indices });
  assert.deepEqual(acomodoDe(estado, nueva, { indices }), { estado: "pendiente", donde: [] });
  const otraClase = acomodoAutomatico(estado, { ...una, clase: "CONS", existencia_id: null }, { indices });
  assert.equal(acomodoDe(estado, otraClase, { indices }).estado, "pendiente");
  // La ubicación final = (contenedor, clase): la misma variante en la hoja de consumibles del #2 es partida nueva.
  const enDos = acomodar(estado, { ...dos, clase: "CONS" }, 2, { indices });
  assert.equal(indices.ubicacion(enDos.ubicacion_id).hoja_excel, "CONTENEDOR #2 CONSUMIBLE");
  assert.equal(enDos.existencia_id, null);
  const enDosInv = acomodar(estado, dos, 2, { indices });
  assert.equal(hoja(indices.existencia(enDosInv.existencia_id)), "CONTENEDOR #2 INVENTARIABLE");
  // Sin existencia (diésel): no se acomoda.
  const diesel = partidaDesdeResultado(estado, { tipo: "articulo", codigo: 136, descripcion: "DIESEL" }, { indices });
  assert.deepEqual(acomodoDe(estado, diesel, { indices }), { estado: "sin_existencia" });
  assert.equal(diesel.um, umDeLosVales(estado, 136));
});

test("contenedores de los datos: con 3 (uno sin hoja de inventariables) y con 7", () => {
  const { estado, indices, partida } = preparar();
  conHojas(estado, [[3, "CONS"]]);
  const tres = contenedoresDe(estado);
  assert.deepEqual(tres.map((c) => [c.numero, Boolean(c.hojas.INV), Boolean(c.hojas.CONS)]), [[1, true, true], [2, true, true], [3, false, true]]);
  const i3 = new Indices(estado);
  const baleros = desacomodar(en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(701, "6309-2Z/C3").id, indices), i3);
  assert.throws(() => acomodar(estado, { ...baleros, clase: "INV" }, 3, { indices: i3 }), (e) => e instanceof ErrorAcomodo && e.message === "El #3 no tiene hoja de inventariables.");
  const comoConsumible = acomodar(estado, { ...baleros, clase: "CONS" }, 3, { indices: i3 });
  assert.equal(i3.ubicacion(comoConsumible.ubicacion_id).contenedor, 3);
  conHojas(estado, [[4, "INV"], [4, "CONS"], [5, "INV"], [6, "CONS"], [7, "INV"], [7, "CONS"]]);
  assert.deepEqual(contenedoresDe(estado).map((c) => c.numero), [1, 2, 3, 4, 5, 6, 7]);
});

test("otro tipo (§5.1, §11): se queda en su contenedor si tiene esa hoja; si no, vuelve a «Faltan»", () => {
  const { estado, indices, partida } = preparar();
  conHojas(estado, [[3, "CONS"]]);
  const i = new Indices(estado);
  const enUno = acomodar(estado, { ...desacomodar(en.conRenglonExistente(estado, en.lineaEntradaVacia(), partida(701, "6309-2Z/C3").id, indices), i), clase: "INV" }, 1, { indices: i });
  const cons = conTipo(estado, enUno, "CONS", { indices: i });
  const a = acomodoDe(estado, cons, { indices: i });
  assert.deepEqual([a.estado, a.contenedor, a.ubicacion.clase], ["acomodada", 1, "CONS"]);
  const enTres = acomodar(estado, cons, 3, { indices: i });
  assert.equal(acomodoDe(estado, conTipo(estado, enTres, "INV", { indices: i }), { indices: i }).estado, "pendiente");
});

test("agregar desde el buscador: la fila elegida es esa partida del inventario; «Usar «…»» es variante nueva", () => {
  const { estado, indices, partida, hoja } = preparar();
  const dos = partida(701, "6309-2Z/C3");
  const otra = estado.existencias.find((e) => e.variante_id === dos.variante_id && e.id !== dos.id);
  const elegida = partidaDesdeResultado(estado, { tipo: "existencia", id: otra.id }, { indices });
  assert.equal(hoja(indices.existencia(elegida.existencia_id)), hoja(otra));
  assert.equal(elegida.clase, "INV");
  assert.equal(elegida.cantidad, "");
  const nueva = partidaDesdeResultado(estado, { tipo: "clave", codigo: 701, descripcion: "BALEROS", clave: "6311-2RS" }, { indices });
  assert.deepEqual([nueva.alta, nueva.dimension, nueva.um, nueva.existencia_id, nueva.ubicacion_id], [true, "6311-2RS", "PZA", null, null]);
  const codigo = partidaDesdeResultado(estado, { tipo: "codigo", codigo: 1399, descripcion: "", clave: "" }, { indices });
  assert.deepEqual(porRevisar(estado, codigo, { indices }), null);
  assert.equal(codigo.alta, true);
});

test("editar una partida (§5.2): la variante que se escribe igual, una nueva o sin existencia; el mismo material no se mueve", () => {
  const { estado, indices, partida } = preparar();
  const linea = { ...partidaDesdeResultado(estado, { tipo: "existencia", id: partida(701, "6205-2Z").id }, { indices }), cantidad: "3", lote: "J. PEREZ", oc: "OC-1", dudoso: true };
  // Igual a otra variante del inventario: esa (y como vive en 2 contenedores, queda por acomodar).
  const otra = conCamposEditados(estado, linea, { ...camposDeLinea(linea, indices), dimension: "6309-2Z/C3" }, { indices });
  assert.deepEqual([otra.cantidad, otra.lote, otra.oc, otra.dudoso, otra.alta], ["3", "J. PEREZ", "OC-1", false, false]);
  assert.equal(acomodoDe(estado, otra, { indices }).estado, "pendiente");
  // Otro NP: variante nueva.
  const nueva = conCamposEditados(estado, linea, { ...camposDeLinea(linea, indices), np: "SKF" }, { indices });
  assert.deepEqual([nueva.alta, nueva.dimension, nueva.np], [true, "6205-2Z", "SKF"]);
  // Sin cambiar nada: se queda donde estaba.
  const igual = conCamposEditados(estado, linea, camposDeLinea(linea, indices), { indices });
  assert.equal(igual.existencia_id, linea.existencia_id);
  assert.equal(igual.dudoso, false);
  const sin = conCamposEditados(estado, linea, { ...camposDeLinea(linea, indices), sinExistencia: true }, { indices });
  assert.equal(acomodoDe(estado, sin, { indices }).estado, "sin_existencia");
});

test("variante nueva parecida a una del inventario (RF-33): «¿Es la misma que…?» y «Usar esa»", () => {
  const { estado, indices } = preparar();
  const escrita = partidaDesdeResultado(estado, { tipo: "clave", codigo: 701, descripcion: "BALEROS", clave: "6205-2ZZ" }, { indices });
  const nueva = { ...escrita, cantidad: "3", lote: "J. PEREZ", oc: "OC-9" };
  const p = parecidaDe(estado, nueva, { indices });
  assert.equal(p.variante.dimension, "6205-2Z");
  assert.equal(p.igual, false);
  assert.ok(p.lugares.length > 0);
  // «Usar esa»: la variante del inventario, con lo capturado y el tipo de su hoja; ya no se parece a nada.
  const usada = conVarianteParecida(estado, nueva, p.variante.id, { indices });
  assert.equal(varianteDeLinea(usada, indices).id, p.variante.id);
  assert.ok(!usada.alta);
  assert.deepEqual([usada.cantidad, usada.lote, usada.oc, usada.clase], ["3", "J. PEREZ", "OC-9", "INV"]);
  assert.equal(parecidaDe(estado, usada, { indices }), null);
  // Lo que no se parece, nada.
  const otra = partidaDesdeResultado(estado, { tipo: "clave", codigo: 701, descripcion: "BALEROS", clave: "XQ-77" }, { indices });
  assert.equal(parecidaDe(estado, otra, { indices }), null);
});

test("Copilot: solo se acomoda lo que vive en un solo contenedor; lo dudoso dice qué leyó", () => {
  const { estado } = preparar();
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  const { datos } = leerRespuestaCopilot(estado, b, {
    folio: "B-1",
    partidas: [
      { cantidad: 4, codigo: "701", dimension: "6309-2Z/C3", um: "PZA" },
      { cantidad: 1, codigo: "701", dimension: "6205-2Z", um: "PZA" },
      { cantidad: 2, codigo: "701", dimension: "6311-2RS", um: "PZA", dudoso: true },
    ],
  });
  const indices = new Indices(estado);
  const lineas = en.lineasEntradaCapturadas(datos.lineas);
  assert.deepEqual(lineas.map((l) => acomodoDe(estado, l, { indices }).estado), ["pendiente", "acomodada", "pendiente"]);
  assert.deepEqual(lineas.map((l) => l.clase), ["INV", "INV", "CONS"]);
  assert.equal(porRevisar(estado, lineas[2], { indices }).texto, "Copilot leyó «701 6311-2RS» y no está seguro.");
  assert.deepEqual(faltaAcomodo(estado, datos), [{ campo: "acomodo", mensaje: "Faltan 2 partidas por acomodar" }]);
  const { cuenta } = filtrosDeMaterial(estado, lineas, { indices });
  assert.deepEqual(cuenta, { todas: 3, revisar: 1, sin_oc: 3, sin_solicitante: 3 });
});

test("antes de registrar (§7): lo revisado, lo que informa y lo que bloquea, con su paso", () => {
  const { estado, indices, partida } = preparar();
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(b, { folio_externo: "B-9", origen: "BASE PRUEBA" });
  const lista = { ...partidaDesdeResultado(estado, { tipo: "existencia", id: partida(701, "6205-2Z").id }, { indices }), cantidad: "2", oc: "OC-1" };
  const pendiente = { ...acomodoAutomatico(estado, desacomodar(partidaDesdeResultado(estado, { tipo: "existencia", id: partida(701, "6309-2Z/C3").id }, { indices }), indices), { indices }), cantidad: "" };
  b.lineas = [lista, pendiente];
  const r = antesDeRegistrar(estado, b, { usuario: USUARIO });
  assert.deepEqual(r.revisado.map((x) => [x.id, x.listo, x.texto]), [["cantidad", false, "1 sin cantidad"], ["acomodo", false, "1 sin acomodar"]]);
  assert.deepEqual(r.bloquean.map((x) => [x.paso, x.campo, x.texto]), [[2, "cantidad", "Partida 2: falta la cantidad"], [3, "destino", "Partida 2: falta acomodarla"]]);
  assert.equal(r.bloquean[0].uid, pendiente.uid);
  assert.deepEqual(r.informa, ["1 sin O.C. · se registran como S/OC", "O.C. y solicitante son opcionales"]);
  b.lineas = [lista, { ...acomodar(estado, pendiente, 2, { indices }), cantidad: "1" }];
  const listo = antesDeRegistrar(estado, b, { usuario: USUARIO });
  assert.deepEqual(listo.bloquean, []);
  assert.deepEqual(listo.revisado.map((x) => x.listo), [true, true]);
  // Sin folio: lleva al paso 1.
  assert.deepEqual(antesDeRegistrar(estado, { ...b, folio_externo: "" }, { usuario: USUARIO }).bloquean.map((x) => [x.paso, x.campo]), [[1, "folio_externo"]]);
  const avance = avanceAcomodo(estado, b.lineas, { indices });
  assert.deepEqual([avance.total, avance.acomodadas, avance.faltan.length, [...avance.porContenedor]], [2, 2, 0, [[1, 1], [2, 1]]]);
});
