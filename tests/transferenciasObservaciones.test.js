import assert from "node:assert/strict";
import { test } from "node:test";
import { sinEtapa } from "../src/nucleo/areas.js";
import { conDatosFijos, corregirVale, datosParaCorregir, emitirBorrador, lineaNoInventariada, nuevoBorrador, observacionesDelVale, pideEtapa, validarVale } from "../src/servicios/vales.js";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { cargaSintetica } from "./ayuda.js";

function escenario() {
  const { estado } = cargaSintetica();
  const area = estado.plantillas_area.find((a) => a.nombre === "TRANSFERENCIAS");
  const borrador = nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: area.id, fecha: "2026-10-24" });
  borrador.recibio_nombre = "PERSONA SINTETICA";
  borrador.lineas = [{ ...lineaNoInventariada(estado, 136), cantidad: "1", um: "LTS" }];
  return { estado, area, borrador };
}

test("transferencias: la etapa se cambia por separado y origen y destino siguen editables", () => {
  const { estado, borrador } = escenario();
  assert.equal(pideEtapa(estado, borrador), true);
  borrador.origen = "EQUIPO SINTETICO ORIGEN";
  borrador.destino = "EQUIPO SINTETICO DESTINO";
  borrador.etapa_perforacion = '12 1/4"';
  assert.deepEqual([conDatosFijos(estado, borrador).origen, conDatosFijos(estado, borrador).destino], [borrador.origen, borrador.destino]);
  assert.equal(observacionesDelVale(estado, borrador).split("\n").at(-1), 'ETAPA DE PERFORACION: 12 1/4"');
  borrador.etapa_perforacion = "";
  assert.ok(validarVale(estado, borrador).errores.some((e) => e.campo === "etapa_perforacion"));
  const antigua = { ...borrador, plantilla_area_id: null, naturaleza: "TRANSFERENCIA", observaciones: "TEXTO HISTORICO\nETAPA DE PERFORACION: 8", etapa_perforacion: "17" };
  assert.equal(pideEtapa(estado, antigua), true);
  assert.equal(observacionesDelVale(estado, antigua), "TEXTO HISTORICO\nETAPA DE PERFORACION: 17");
});

test("la transferencia conserva el texto personalizado al emitir y recuerda la etapa siguiente", () => {
  const { estado, borrador } = escenario();
  borrador.observaciones = "PRIMERA LINEA PERSONALIZADA\nSEGUNDA LINEA\nETAPA DE PERFORACION: ANTERIOR";
  borrador.etapa_perforacion = '6 1/8"';
  const [vale] = emitirBorrador(estado, borrador.id, { usuario: "ALMACENISTA UNO" });
  assert.equal(vale.observaciones, 'PRIMERA LINEA PERSONALIZADA\nSEGUNDA LINEA\nETAPA DE PERFORACION: 6 1/8"');
  assert.equal(estado.config.etapa_perforacion, '6 1/8"');
  assert.equal(nuevoBorrador(estado).etapa_perforacion, '6 1/8"');
});

test("corregir una transferencia mantiene sus observaciones aunque después cambie el texto del área", () => {
  const { estado, area, borrador } = escenario();
  borrador.observaciones = 'OBSERVACION PROPIA\nETAPA DE PERFORACION: 8 1/2"';
  const [vale] = emitirBorrador(estado, borrador.id, { usuario: "ALMACENISTA UNO" });
  const anteriores = estado.vales.filter((v) => v.id !== vale.id).map((v) => JSON.stringify(v));
  area.observaciones = "OTRO TEXTO DEL AREA\nETAPA DE PERFORACION: OTRA ETAPA";
  const datos = datosParaCorregir(estado, vale.id);
  datos.etapa_perforacion = "17";
  corregirVale(estado, vale.id, datos, "Corregir etapa", "ALMACENISTA UNO");
  assert.equal(vale.observaciones, "OBSERVACION PROPIA\nETAPA DE PERFORACION: 17");
  assert.deepEqual(estado.vales.filter((v) => v.id !== vale.id).map((v) => JSON.stringify(v)), anteriores);
});

test("las observaciones históricas de transferencia sin etapa no recuperan la línea eliminada", () => {
  const { estado, area, borrador } = escenario();
  borrador.observaciones = "PRIMERA LINEA\nSEGUNDA LINEA";
  assert.match(area.observaciones, /ETAPA DE PERFORACION/);
  assert.equal(pideEtapa(estado, borrador), false);
  assert.equal(observacionesDelVale(estado, borrador), "PRIMERA LINEA\nSEGUNDA LINEA");
  const [vale] = emitirBorrador(estado, borrador.id, { usuario: "ALMACENISTA UNO" });
  const datos = datosParaCorregir(estado, vale.id);
  datos.destino = "EQUIPO DESTINO ACTUALIZADO";
  corregirVale(estado, vale.id, datos, "Corregir destino", "ALMACENISTA UNO");
  assert.equal(vale.observaciones, "PRIMERA LINEA\nSEGUNDA LINEA");
});

test("un borrador reabierto mantiene su texto propio y su etapa sin campos nuevos de estado", async () => {
  const { estado, borrador } = escenario();
  borrador.observaciones = "TEXTO PROPIO GUARDADO\nETAPA DE PERFORACION: ANTERIOR";
  borrador.etapa_perforacion = "26";
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  await almacen.cargarPrimeraVez(estado, []);
  const reabierto = new Almacen(almacen.backend);
  await reabierto.iniciar();
  const guardado = reabierto.estado.borradores.find((b) => b.id === borrador.id);
  assert.equal(observacionesDelVale(reabierto.estado, guardado), "TEXTO PROPIO GUARDADO\nETAPA DE PERFORACION: 26");
  assert.equal(sinEtapa("UNO\r\nETAPA DE PERFORACIÓN: 26\r\nDOS"), "UNO\nDOS");
});
