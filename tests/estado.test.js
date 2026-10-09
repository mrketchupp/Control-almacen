// Compatibilidad del estado y de los respaldos: datos inventados, sin archivos reales.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { crearRespaldo, leerRespaldo } from "../src/almacen/respaldos.js";
import { FORMATO_ESTADO, estadoVacio, migrarEstado } from "../src/nucleo/estado.js";

function valeSintetico(id, tipo = "SALIDA") {
  return {
    id,
    tipo,
    folio: id,
    fecha: "2026-09-30",
    migrado: true,
    depto_destino: "AREA SINTETICA",
    entrego_nombre: "PERSONA IZQUIERDA",
    recibio_nombre: "PERSONA DERECHA",
    lineas: [{
      id: id * 10,
      renglon: 1,
      codigo: 701,
      descripcion: "MATERIAL SINTETICO",
      cantidad: "1.25",
      existencia_id: null,
      encabezado_original: { fecha: "2026-09-29", entrego: "FIRMA ORIGINAL" },
    }],
  };
}

test("formato 10: migra los encabezados sin modificar partidas ni reinterpretar firmas", () => {
  const estado = estadoVacio("GSM");
  estado.formato = 9;
  estado.vales = [valeSintetico(1), valeSintetico(2), valeSintetico(3, "ENTRADA")];
  estado.vales[1].campos_encabezado_corregidos = ["fecha", "entrego"];
  estado.vales[1].firmas_por_posicion = true;
  estado.vales[2].firmas_por_posicion = false;
  const vales = estado.vales;
  const originales = vales.map((vale) => ({
    vale,
    lineas: vale.lineas,
    linea: vale.lineas[0],
    encabezado: vale.lineas[0].encabezado_original,
    json: JSON.stringify(vale),
  }));
  const camposPrevios = vales[1].campos_encabezado_corregidos;
  for (const vale of vales) {
    Object.freeze(vale.lineas[0].encabezado_original);
    Object.freeze(vale.lineas[0]);
    Object.freeze(vale.lineas);
  }

  assert.equal(migrarEstado(estado), estado);
  assert.equal(estado.formato, FORMATO_ESTADO);
  assert.equal(estado.config.inventario, "GSM");
  assert.equal(estado.vales, vales);
  for (const [i, original] of originales.entries()) {
    const vale = estado.vales[i];
    assert.equal(vale, original.vale);
    assert.equal(vale.lineas, original.lineas);
    assert.equal(vale.lineas[0], original.linea);
    assert.equal(vale.lineas[0].encabezado_original, original.encabezado);
    const sinMarcadorNuevo = { ...vale };
    if (i !== 1) delete sinMarcadorNuevo.campos_encabezado_corregidos;
    assert.equal(JSON.stringify(sinMarcadorNuevo), original.json);
  }
  assert.deepEqual(estado.vales[0].campos_encabezado_corregidos, []);
  assert.equal(estado.vales[1].campos_encabezado_corregidos, camposPrevios);
  assert.deepEqual(estado.vales[2].campos_encabezado_corregidos, []);
  assert.notEqual(estado.vales[0].campos_encabezado_corregidos, estado.vales[2].campos_encabezado_corregidos);
  assert.equal(Object.hasOwn(estado.vales[0], "firmas_por_posicion"), false);
  assert.equal(estado.vales[1].firmas_por_posicion, true);
  assert.equal(estado.vales[2].firmas_por_posicion, false);

  const migrado = JSON.stringify(estado);
  const campos = estado.vales.map((vale) => vale.campos_encabezado_corregidos);
  migrarEstado(estado);
  assert.equal(JSON.stringify(estado), migrado);
  estado.vales.forEach((vale, i) => assert.equal(vale.campos_encabezado_corregidos, campos[i]));
});

test("en el formato actual los marcadores siguen siendo opcionales", () => {
  const estado = estadoVacio();
  estado.vales.push(valeSintetico(1));
  const antes = JSON.stringify(estado);
  assert.equal(migrarEstado(estado), estado);
  assert.equal(JSON.stringify(estado), antes);
  assert.equal(migrarEstado(null), null);
});

function estadoAnterior(formato, inventario = "DLTA") {
  const estado = estadoVacio(inventario);
  estado.formato = formato;
  estado.vales = [valeSintetico(1), valeSintetico(2, "ENTRADA")];
  if (formato < 2) {
    delete estado.borradores;
    delete estado.envios;
  }
  if (formato < 5) {
    delete estado.borradores_entrada;
    delete estado.conteo_en_curso;
    delete estado.reacomodos;
  }
  if (formato < 6) {
    delete estado.cortes_ax;
    delete estado.equivalencias_ax;
  }
  if (formato < 7) delete estado.seguimientos_base;
  if (formato < 9) delete estado.config.inventario;
  return estado;
}

test("los respaldos de formatos 1 a 9 se restauran, migran y sobreviven al volver a abrir", async (t) => {
  for (const formato of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await t.test(`respaldo de formato ${formato}`, async () => {
      const viejo = estadoAnterior(formato);
      const lineas = viejo.vales.map((vale) => JSON.stringify(vale.lineas));
      const respaldo = crearRespaldo(viejo, [], { ahora: "2026-10-01T08:00:00" });
      assert.equal(leerRespaldo(respaldo.datos).estado.formato, formato);
      const almacen = new Almacen(new BackendMemoria());
      await almacen.iniciar();
      const manifiesto = await almacen.restaurar(respaldo.datos);
      assert.equal(manifiesto.formato_estado, formato);
      assert.equal(almacen.estado.formato, FORMATO_ESTADO);
      assert.equal(almacen.estado.config.inventario, "DLTA");
      assert.deepEqual(almacen.estado.vales.map((vale) => JSON.stringify(vale.lineas)), lineas);
      assert.ok(almacen.estado.vales.every((vale) => vale.campos_encabezado_corregidos.length === 0));
      assert.ok(almacen.estado.vales.every((vale) => !Object.hasOwn(vale, "firmas_por_posicion")));
      const otro = new Almacen(almacen.backend);
      await otro.iniciar();
      assert.deepEqual(otro.estado, almacen.estado);
      assert.equal(leerRespaldo((await otro.respaldo()).datos).manifiesto.formato_estado, FORMATO_ESTADO);
    });
  }
  await t.test("respaldo GSM de formato 9 conserva su inventario", async () => {
    const viejo = estadoAnterior(9, "GSM");
    const almacen = new Almacen(new BackendMemoria(), { inventario: "GSM" });
    await almacen.iniciar();
    await almacen.restaurar(crearRespaldo(viejo, []).datos);
    assert.equal(almacen.estado.config.inventario, "GSM");
    assert.equal(almacen.estado.formato, FORMATO_ESTADO);
  });
});

test("un respaldo actual conserva marcadores y rechaza formatos posteriores", async () => {
  const estado = estadoVacio();
  estado.vales = [valeSintetico(1), valeSintetico(2)];
  estado.vales[0].campos_encabezado_corregidos = ["fecha", "recibio"];
  estado.vales[0].firmas_por_posicion = true;
  estado.vales[1].firmas_por_posicion = false;
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  await almacen.restaurar(crearRespaldo(estado, []).datos);
  assert.deepEqual(almacen.estado.vales, estado.vales);
  estado.formato = FORMATO_ESTADO + 1;
  assert.throws(() => leerRespaldo(crearRespaldo(estado, []).datos), /versión más nueva/);
});
