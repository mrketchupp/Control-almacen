// FX dentro del Inventario B: mover, recibir y contar nunca mezclan una partida de FX con una del inventario.
// Antes, `renglonDe` buscaba "la partida de ese artículo en ese contenedor" sin ver el dueño y `crearRenglon`
// no ponía la marca: mover material de FX lo volvía del inventario (o lo sumaba a la partida del inventario).

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { Indices } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { DUENO_FX, duenoDe } from "../src/nucleo/inventarios.js";
import * as co from "../src/servicios/conteos.js";
import { estadoAlCierre } from "../src/servicios/corte.js";
import * as en from "../src/servicios/entradas.js";
import { crearRenglon, renglonDe } from "../src/servicios/inventario.js";
import { reacomodar } from "../src/servicios/reacomodos.js";
import { opcionesDeClave } from "../src/servicios/vales.js";
import { leerInventario } from "../src/importadores/inventario.js";
import { bytesInventarioGsm, cargaSinteticaGsm } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const total = (estado, id) => calcularSaldos(estado, [id]).get(id).total.toFixed();

/** GSM con una partida de FX (u1) y, del mismo artículo, una del inventario en otro contenedor (u2). */
function preparar() {
  const { estado } = cargaSinteticaGsm();
  const indices = new Indices(estado);
  const saldos = calcularSaldos(estado);
  const fx = estado.existencias.find((e) => {
    const v = indices.variante(e.variante_id);
    return e.activo !== false && v.codigo >= 1000 && indices.ubicacion(e.ubicacion_id).clase === "INV" && saldos.get(e.id).total.gte(4);
  });
  fx.dueno = DUENO_FX;
  const libre = (u) => u.clase === "INV" && u.id !== fx.ubicacion_id && !estado.existencias.some((e) => e.ubicacion_id === u.id && e.variante_id === fx.variante_id);
  const [u2, u3] = estado.ubicaciones.filter(libre);
  const propia = crearRenglon(estado, indices, { varianteId: fx.variante_id, ubicacionId: u2.id, cantidad: "5", origen: "PRUEBA" });
  return { estado, indices, fx, propia, u1: indices.ubicacion(fx.ubicacion_id), u2, u3 };
}

test("renglonDe y crearRenglon respetan el dueño", () => {
  const { estado, indices, fx, propia, u1, u2 } = preparar();
  assert.equal(renglonDe(estado, fx.variante_id, u1.id), null, "en u1 solo hay de FX");
  assert.equal(renglonDe(estado, fx.variante_id, u1.id, DUENO_FX), fx);
  assert.equal(renglonDe(estado, fx.variante_id, u2.id), propia);
  assert.equal(renglonDe(estado, fx.variante_id, u2.id, DUENO_FX), null);
  const nueva = crearRenglon(estado, indices, { varianteId: fx.variante_id, ubicacionId: u2.id, dueno: DUENO_FX, origen: "PRUEBA" });
  assert.equal(nueva.dueno, DUENO_FX);
  assert.equal(Object.hasOwn(propia, "dueno"), false, "las del inventario no llevan dueño");
});

test("mover lo de FX lo deja de FX, aunque el destino tenga esa partida del inventario", () => {
  const { estado, fx, propia, u1, u2 } = preparar();
  const antesFx = total(estado, fx.id);
  const r = reacomodar(estado, { desdeId: fx.id, ubicacionId: u2.id, cantidad: "1", usuario: USUARIO });
  const hacia = estado.existencias.find((e) => e.id === r.hacia_existencia_id);
  assert.notEqual(hacia.id, propia.id, "no se suma a la partida del inventario");
  assert.equal(duenoDe(hacia), DUENO_FX);
  assert.equal(total(estado, hacia.id), "1");
  assert.equal(total(estado, propia.id), "5");
  // Otra vez al mismo contenedor: ahora sí hay partida de FX ahí y se suma a esa.
  const r2 = reacomodar(estado, { desdeId: fx.id, ubicacionId: u2.id, cantidad: "1", usuario: USUARIO });
  assert.equal(r2.hacia_existencia_id, hacia.id);
  assert.equal(total(estado, hacia.id), "2");
  assert.equal(total(estado, fx.id), String(Number(antesFx) - 2));
  // Y al revés: lo del inventario no se suma a la de FX.
  const r3 = reacomodar(estado, { desdeId: propia.id, ubicacionId: u1.id, cantidad: "1", usuario: USUARIO });
  const nueva = estado.existencias.find((e) => e.id === r3.hacia_existencia_id);
  assert.notEqual(nueva.id, fx.id);
  assert.equal(duenoDe(nueva), null);
  // Los libros: el de FX tiene las dos partidas de FX y el del inventario no las trae.
  const libro = (dueno) => leerInventario(exportarInventario(estado, bytesInventarioGsm(), { dueno }).datos, "x.xlsx").hojas.reduce((t, h) => t + h.renglones.length, 0);
  assert.equal(libro(DUENO_FX), 2);
  // Al cierre del día anterior los movimientos se deshacen (también la partida nueva de FX).
  const cierre = estadoAlCierre(estado, "2026-01-01").estado;
  assert.ok(!cierre.existencias.some((e) => e.id === hacia.id));
});

test("una entrada no se suma sola a una partida de FX; elegida a mano, sí", () => {
  const { estado, indices, fx, u1 } = preparar();
  const base = { ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), indices.variante(fx.variante_id).codigo, { indices }), cantidad: "3", um: fx.um ?? "PZA" };
  // "Entra a" el contenedor donde solo está la de FX: partida nueva del inventario.
  const aU1 = { ...en.conOtroContenedor(estado, { ...base, variante_id: fx.variante_id }, u1.id, indices), cantidad: "3" };
  assert.equal(aU1.existencia_id, null);
  const opcion = en.opcionesEntraA(estado, aU1, { indices }).find((o) => o.valor === u1.id);
  assert.equal(opcion.propio, false);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-200", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL", lineas: [aU1] });
  const antesFx = total(estado, fx.id);
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const nueva = estado.existencias.find((e) => e.id === vale.lineas[0].existencia_id);
  assert.notEqual(nueva.id, fx.id);
  assert.equal(duenoDe(nueva), null);
  assert.equal(total(estado, fx.id), antesFx);
  // Elegir la partida de FX en la clave sí entra a la de FX.
  const aFx = { ...en.conRenglonExistente(estado, base, fx.id, indices), cantidad: "2" };
  const b2 = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b2, { folio_externo: "B-201", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL", lineas: [aFx] });
  const vale2 = en.confirmarEntrada(estado, b2.id, { usuario: USUARIO });
  assert.equal(vale2.lineas[0].existencia_id, fx.id);
  assert.equal(total(estado, fx.id), String(Number(antesFx) + 2));
});

test("un conteo: lo encontrado no se suma a una partida de FX que no se contó", () => {
  const { estado, indices, fx, u1 } = preparar();
  const antesFx = fx.cantidad_conteo;
  const datos = co.iniciarConteo(estado, { ubicaciones: [u1.id], usuario: USUARIO, fecha: "2026-10-05" });
  const v = indices.variante(fx.variante_id);
  const encontrado = { ...co.nuevoSobrante(u1.id), codigo: v.codigo, variante_id: v.id, um: v.um ?? "PZA", cantidad: "2" };
  co.guardarConteoEnCurso(estado, { ...datos, capturas: {}, nuevos: [encontrado] });
  const conteo = co.aplicarConteo(estado, { usuario: USUARIO });
  assert.equal(conteo.nuevos.length, 1, "partida nueva del inventario, aparte de la de FX");
  const nueva = estado.existencias.find((e) => e.id === conteo.nuevos[0]);
  assert.equal(duenoDe(nueva), null);
  assert.equal(fx.cantidad_conteo, antesFx);
});

test("al elegir la clave en un vale se ve cuál partida es de FX", () => {
  const { estado, indices, fx, propia } = preparar();
  const opciones = opcionesDeClave(estado, indices.variante(fx.variante_id).codigo, { indices });
  assert.equal(opciones.find((o) => o.id === fx.id).fx, true);
  assert.equal(opciones.find((o) => o.id === propia.id).fx, false);
});

test("la entrada sugiere la partida del inventario aunque la de FX tenga más; solo FX = se elige a mano", () => {
  const { estado, indices, fx, propia } = preparar();
  propia.cantidad_conteo = "0"; // la de FX tiene más existencia
  const codigo = indices.variante(fx.variante_id).codigo;
  const sugerida = en.destinosDeCodigo(estado, codigo, { indices }).find((o) => o.variante_id === fx.variante_id && o.sugerida);
  assert.equal(sugerida.id, propia.id);
  assert.equal(sugerida.fx, false);
  // Sin la del inventario (solo queda la de FX), el código no se asigna solo a la de FX.
  propia.activo = false;
  const otras = estado.existencias.filter((e) => e.activo !== false && e.variante_id !== fx.variante_id && indices.variante(e.variante_id).codigo === codigo);
  for (const e of otras) e.activo = false;
  const linea = en.entradaConArticulo(estado, en.lineaEntradaVacia(), codigo, { indices });
  assert.equal(linea.existencia_id, null);
  assert.equal(en.destinosDeCodigo(estado, codigo, { indices }).find((o) => o.id === fx.id).fx, true);
});

test("la hoja de conteo impresa marca lo de FX", async () => {
  const { documentoHojaConteo } = await import("../src/impresion/conteo.js");
  const { estado, indices, fx, u1 } = preparar();
  const { html } = documentoHojaConteo(estado, { ubicaciones: [u1.id] });
  const descripcion = indices.articulo(indices.variante(fx.variante_id).codigo).descripcion;
  assert.ok(html.includes(`FX · ${descripcion}`));
  assert.equal(html.split(">FX · ").length - 1, estado.existencias.filter((e) => e.ubicacion_id === u1.id && e.dueno === DUENO_FX && e.activo !== false).length);
});
