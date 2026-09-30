// Fase 2: borradores, emisión con folio, división, corrección, cancelación y envíos.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarVales } from "../src/exportadores/vales.js";
import { Indices, migrarEstado } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { lineasPorUbicar } from "../src/servicios/consultas.js";
import { importarValesNuevos, revisarValesNuevos } from "../src/servicios/sincronizar.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesVales, cargaSintetica, libroVales } from "./ayuda.js";

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  return { estado, indices, mecanico, sellos };
}

function borradorListo(estado, { mecanico, sellos }, cantidad = "1") {
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: mecanico.id, fecha: "2026-10-01" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad });
  return b;
}

const saldo = (estado, id) => calcularSaldos(estado, [id]).get(id).total.toFixed();

test("el estado de la versión anterior se migra", () => {
  const { estado } = cargaSintetica();
  delete estado.borradores;
  delete estado.envios;
  estado.formato = 1;
  // un estado de la Fase 2: áreas sin tipo y MECANICO saliendo de MANTENIMIENTO
  for (const a of estado.plantillas_area) delete a.tipo;
  estado.plantillas_area.find((a) => a.nombre === "MECANICO").depto_origen = "MANTENIMIENTO";
  delete estado.config.etapa_perforacion;
  migrarEstado(estado);
  assert.equal(estado.formato, 3);
  assert.deepEqual([estado.borradores, estado.envios], [[], []]);
  const tipos = Object.fromEntries(estado.plantillas_area.map((a) => [a.nombre, a.tipo]));
  assert.deepEqual(tipos, { SOLDADOR: "INTERNO", MECANICO: "INTERNO", TRANSFERENCIAS: "TRANSFERENCIA", NOV: "EXTERNO" });
  const mecanico = estado.plantillas_area.find((a) => a.nombre === "MECANICO");
  assert.deepEqual([mecanico.origen, mecanico.depto_origen, mecanico.destino], ["RIG 91", "ALMACEN", "RIG 91"]);
  // un borrador a medias hecho con la versión anterior toma los datos fijos del área
  const b = { id: 99, plantilla_area_id: mecanico.id, origen: "RIG 91", depto_origen: "MANTENIMIENTO", destino: "RIG 91", observaciones: "", lineas: [] };
  const otro = cargaSintetica().estado;
  otro.formato = 2;
  otro.plantillas_area.find((a) => a.nombre === "MECANICO").depto_origen = "MANTENIMIENTO";
  otro.borradores = [{ ...b, plantilla_area_id: otro.plantillas_area.find((a) => a.nombre === "MECANICO").id }];
  migrarEstado(otro);
  assert.equal(otro.borradores[0].depto_origen, "ALMACEN");
  assert.equal(estado.config.etapa_perforacion, '8 1/2"');
});

test("áreas internas: datos fijos, etapa de perforación y entregó = almacenista en turno", () => {
  const { estado, mecanico, sellos } = preparar();
  assert.equal(mecanico.depto_origen, "ALMACEN");
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: mecanico.id, fecha: "2026-10-01" });
  assert.equal(b.etapa_perforacion, '8 1/2"');
  assert.match(b.observaciones, /^ESTE MATERIAL CUMPLE/);
  assert.match(b.observaciones, /ETAPA DE PERFORACION: 8 1\/2"$/);
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  b.etapa_perforacion = "";
  assert.ok(v.validarVale(estado, b).errores.some((e) => e.campo === "etapa_perforacion"));
  b.etapa_perforacion = '12 1/4"';
  b.entrego_nombre = "OTRA PERSONA";
  // emite quien está en turno, sin importar lo que traía el borrador
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: "ALMACENISTA PRUEBA" });
  assert.equal(vale.entrego_nombre, "ALMACENISTA PRUEBA");
  assert.equal(vale.entrego_puesto, "ALMACENISTA");
  assert.equal(vale.observaciones.split("\n").at(-1), 'ETAPA DE PERFORACION: 12 1/4"');
  assert.equal(vale.observaciones.split("\n").length, 3);
  // la etapa usada queda para el siguiente vale
  assert.equal(estado.config.etapa_perforacion, '12 1/4"');
  assert.equal(v.nuevoBorrador(estado, {}).etapa_perforacion, '12 1/4"');
  // al corregir, la etapa se recupera del vale
  assert.equal(v.datosParaCorregir(estado, vale.id).etapa_perforacion, '12 1/4"');
});

test("código → clave: opciones del inventario con lugar y existencia", () => {
  const { estado } = preparar();
  const opciones = v.opcionesDeClave(estado, 701);
  assert.ok(opciones.length >= 2);
  assert.ok(opciones.every((o) => o.lugar.startsWith("#") && typeof o.total === "number"));
  // varios renglones: no se elige solo
  const varios = v.conArticulo(estado, v.lineaVacia(), 701);
  assert.equal(varios.existencia_id, null);
  assert.equal(varios.no_inventariado, false);
  const elegido = v.conExistencia(estado, { ...varios, cantidad: "2" }, opciones[1].id);
  assert.equal(elegido.clave, opciones[1].clave);
  assert.equal(elegido.cantidad, "2");
  // un solo renglón: se asigna solo
  const unico = [...new Set(estado.existencias.map((e) => new Indices(estado).variante(e.variante_id).codigo))].find(
    (c) => v.opcionesDeClave(estado, c).length === 1,
  );
  assert.ok(v.conArticulo(estado, v.lineaVacia(), unico).existencia_id !== null);
  // sin existencia (diésel): no inventariado, la clave se escribe a mano
  const diesel = v.conArticulo(estado, v.lineaVacia(), 136);
  assert.deepEqual([diesel.no_inventariado, diesel.existencia_id, diesel.descripcion], [true, null, "SUMINISTRO DE DIESEL Y COMBUSTIBLE"]);
});

test("un borrador toma los datos de la plantilla del área y el almacenista en turno", () => {
  const { estado, mecanico } = preparar();
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: mecanico.id });
  assert.equal(b.depto_destino, mecanico.depto_destino);
  assert.equal(b.recibio_nombre, "MECANICO UNO");
  assert.equal(b.entrego_nombre, "ALMACENISTA UNO");
  assert.equal(b.entrego_puesto, "ALMACENISTA");
  assert.equal(estado.borradores.length, 1);
});

test("la clave del vale se arma como en el DIARIO", () => {
  assert.equal(v.claveParaVale("6309-2Z/C3", null), "6309-2Z/C3");
  assert.equal(v.claveParaVale("S/D", "X00489"), "NP:X00489");
  assert.equal(v.claveParaVale("SIN DIMENSION", "NP:H143405"), "NP:H143405");
  assert.equal(v.claveParaVale('3/8', "4900-10"), "3/8 NP:4900-10");
  assert.equal(v.claveParaVale(null, null), "S/D");
});

test("validaciones: encabezado, renglones y existencia insuficiente con justificación", () => {
  const { estado, mecanico, sellos } = preparar();
  const vacio = v.nuevoBorrador(estado, {});
  const { errores } = v.validarVale(estado, vacio);
  assert.ok(errores.some((e) => e.campo === "recibio_nombre"));
  assert.ok(errores.some((e) => e.campo === "lineas"));
  const b = borradorListo(estado, { mecanico, sellos }, "5"); // hay 1
  let r = v.validarVale(estado, b);
  assert.equal(r.avisos.length, 1);
  assert.ok(r.errores.some((e) => e.campo === "justificacion"));
  b.lineas[0].justificacion = "Se recibió material sin vale de entrada";
  r = v.validarVale(estado, b);
  assert.deepEqual(r.errores, []);
  b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "0", um: "LTS" });
  r = v.validarVale(estado, b);
  assert.ok(r.errores.some((e) => e.renglon === 2 && e.campo === "cantidad"));
});

test("transferencias exigen quién autoriza", () => {
  const { estado, sellos } = preparar();
  const transferencias = estado.plantillas_area.find((p) => p.nombre === "TRANSFERENCIAS");
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: transferencias.id });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  b.autorizo_nombre = "";
  assert.ok(v.validarVale(estado, b).errores.some((e) => e.campo === "autorizo_nombre"));
});

test("emitir asigna el siguiente folio, descuenta existencia y deja bitácora", () => {
  const { estado, mecanico, sellos } = preparar();
  assert.equal(v.siguienteFolio(estado), 10);
  assert.equal(saldo(estado, sellos.id), "1");
  const b = borradorListo(estado, { mecanico, sellos });
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: "ALMACENISTA UNO" });
  assert.equal(vale.folio, 10);
  assert.equal(vale.estado, "EMITIDO");
  assert.equal(estado.borradores.length, 0);
  assert.equal(saldo(estado, sellos.id), "0");
  assert.equal(v.siguienteFolio(estado), 11);
  assert.ok(estado.auditoria.some((a) => a.accion === "EMITIR" && a.despues.folios[0] === 10));
  assert.throws(() => v.emitirBorrador(estado, b.id), v.ErrorVale); // ya no existe
});

test("un borrador con errores no consume folio", () => {
  const { estado } = preparar();
  const b = v.nuevoBorrador(estado, {});
  assert.throws(() => v.emitirBorrador(estado, b.id), v.ErrorVale);
  assert.equal(v.siguienteFolio(estado), 10);
  assert.equal(estado.borradores.length, 1);
});

test("el folio mínimo configurado se respeta (folios usados fuera de la herramienta)", () => {
  const { estado } = preparar();
  estado.config.folio_minimo_salida = 600;
  assert.equal(v.siguienteFolio(estado), 600);
});

test("más renglones que el formato: se divide en folios consecutivos solo si se pide", () => {
  const { estado, mecanico, sellos } = preparar();
  const b = borradorListo(estado, { mecanico, sellos });
  for (let i = 0; i < 2; i++) b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "10", um: "LTS" });
  assert.throws(() => v.emitirBorrador(estado, b.id, { capacidad: 2 }), /dividir/);
  const vales = v.emitirBorrador(estado, b.id, { capacidad: 2, dividir: true });
  assert.deepEqual(vales.map((x) => [x.folio, x.lineas.length]), [[10, 2], [11, 1]]);
  assert.deepEqual(vales[1].lineas.map((l) => l.renglon), [1]);
});

test("corregir: motivo obligatorio, mismo folio, existencia recalculada", () => {
  const { estado, mecanico, sellos } = preparar();
  sellos.cantidad_conteo = "6"; // el vale 6 (migrado) ya descontó 1
  const [vale] = v.emitirBorrador(estado, borradorListo(estado, { mecanico, sellos }, "1").id);
  assert.equal(saldo(estado, sellos.id), "4");
  const datos = v.datosParaCorregir(estado, vale.id);
  datos.lineas[0].cantidad = "3";
  assert.throws(() => v.corregirVale(estado, vale.id, datos, ""), /motivo/);
  v.corregirVale(estado, vale.id, datos, "Se entregaron 3", "ALMACENISTA UNO");
  assert.equal(vale.folio, 10);
  assert.equal(vale.lineas[0].cantidad, "3");
  assert.equal(saldo(estado, sellos.id), "2");
  const bitacora = v.bitacoraDeVale(estado, vale.id);
  const correccion = bitacora.find((a) => a.accion === "CORREGIR");
  assert.equal(correccion.antes.lineas[0].cantidad, "1");
  assert.equal(correccion.antes.motivo, "Se entregaron 3");
  // la existencia del propio vale cuenta como disponible al corregir
  datos.lineas[0].cantidad = "5";
  v.corregirVale(estado, vale.id, datos, "Fueron 5");
  assert.equal(saldo(estado, sellos.id), "0");
});

test("cancelar revierte la existencia y el DIARIO muestra el folio cancelado", () => {
  const { estado, mecanico, sellos } = preparar();
  const [vale] = v.emitirBorrador(estado, borradorListo(estado, { mecanico, sellos }).id);
  assert.equal(saldo(estado, sellos.id), "0");
  v.cancelarVale(estado, vale.id, "Captura duplicada", "ALMACENISTA UNO");
  assert.equal(saldo(estado, sellos.id), "1");
  assert.throws(() => v.cancelarVale(estado, vale.id, "otra vez"), /ya está cancelado/);
  assert.equal(v.siguienteFolio(estado), 11); // el folio no se reutiliza
  const hoja = new LibroLeido(exportarVales(estado, bytesVales()).datos).hoja("DIARIO");
  const ultima = hoja.fila(hoja.maxFila, 1, 20);
  assert.deepEqual([ultima[1], ultima[9], ultima[11]], [10, 0, "CANCELADO – CAPTURA DUPLICADA"]);
});

test("un vale emitido aparece en el DIARIO exportado como lo haría la macro", () => {
  const { estado, mecanico, sellos } = preparar();
  v.emitirBorrador(estado, borradorListo(estado, { mecanico, sellos }).id);
  const hoja = new LibroLeido(exportarVales(estado, bytesVales()).datos).hoja("DIARIO");
  const fila = hoja.fila(hoja.maxFila, 1, 20);
  assert.equal(fila[1], 10);
  assert.deepEqual(fila.slice(2, 4), [0, "XXXXX"]);
  assert.equal(fila[7], mecanico.depto_destino.trim());
  assert.equal(fila[8], "S/OC");
  assert.deepEqual([fila[9], fila[10], fila[12], fila[13]], [1, 706, 555001, "PZA"]);
  assert.deepEqual([fila[15], fila[16]], ["ALMACENISTA UNO", "MECANICO UNO"]);
});

test("envíos a la base: nuevos, corregidos y cancelados desde el último envío", () => {
  const { estado, mecanico, sellos } = preparar();
  assert.deepEqual(v.valesPorEnviar(estado), []); // los migrados ya se enviaron
  const [nuevo] = v.emitirBorrador(estado, borradorListo(estado, { mecanico, sellos }).id);
  assert.deepEqual(v.valesPorEnviar(estado).map((p) => [p.vale.folio, p.motivo]), [[10, "nuevo"]]);
  v.registrarEnvio(estado, "ALMACENISTA UNO");
  assert.deepEqual(v.valesPorEnviar(estado), []);
  const migrado = estado.vales.find((x) => x.folio === 3);
  const datos = v.datosParaCorregir(estado, migrado.id);
  datos.lineas[0].lote = "NUEVO";
  v.corregirVale(estado, migrado.id, datos, "Faltaba el lote");
  v.cancelarVale(estado, nuevo.id, "No se entregó");
  assert.deepEqual(v.valesPorEnviar(estado).map((p) => [p.vale.folio, p.motivo]), [[3, "corregido"], [10, "cancelado"]]);
});

test("importar vales nuevos hechos en el Excel después de la primera carga", () => {
  const { estado } = cargaSintetica();
  estado.vales = estado.vales.filter((x) => x.folio < 7); // la herramienta "no conoce" 7 y 9
  const libro = libroVales();
  const vista = revisarValesNuevos(estado, libro);
  assert.deepEqual([vista.desde, vista.folios], [6, [7, 9]]);
  const reporte = importarValesNuevos(estado, libro, "ALMACENISTA UNO");
  assert.deepEqual(reporte.folios, [7, 9]);
  assert.ok(estado.vales.some((x) => x.folio === 9 && x.migrado));
  assert.equal(v.siguienteFolio(estado), 10);
  assert.ok(lineasPorUbicar(estado).some((p) => p.folio === 7));
  assert.deepEqual(importarValesNuevos(estado, libro).folios, []); // no duplica
});
