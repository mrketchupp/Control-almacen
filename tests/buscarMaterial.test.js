// Ronda 34, etapa 3: el buscador del paso 2 (Material) — índice, «Buscar en», resultados por código, la última clave
// del área, agregar con la cantidad vacía y los contadores de la lista; y el ajuste «NP en el lote».

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { agregarPartida, buscarMaterial, contarPartidas, filasEnOrden, indiceMaterial, partidasDelVale, ultimasDeArea } from "../src/servicios/buscarMaterial.js";
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
