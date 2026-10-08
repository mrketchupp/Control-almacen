// Ronda 18: la etapa de perforación es la misma en DLTA y GSM. Datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Compartidos, adoptarCompartidos } from "../src/almacen/compartidos.js";
import { fijarAjuste } from "../src/servicios/catalogos.js";
import { guardarPersonalizacion, guardarPreferenciasVale, personalizacion, preferenciasVale, restablecerPreferenciasVale } from "../src/servicios/preferencias.js";
import * as v from "../src/servicios/vales.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

async function abrir(inventario, backend = new BackendMemoria()) {
  const almacen = new Almacen(backend, { inventario });
  await almacen.iniciar();
  return almacen;
}

async function cargar(almacen) {
  const { estado } = cargaSintetica({ idInventario: almacen.inventario });
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
}

const etapa = (almacen) => almacen.estado.config.etapa_perforacion;

test("la etapa que se cambia en un inventario la toma el otro al abrirse", async () => {
  const comun = new BackendMemoria();
  const dlta = await abrir("DLTA");
  await cargar(dlta);
  const c1 = new Compartidos(dlta, comun);
  await c1.sincronizar();
  const inicial = etapa(dlta);
  assert.equal((await comun.leerAjuste("compartidos")).etapa_perforacion.valor, inicial); // la primera vez se publica

  await dlta.modificar((e) => fijarAjuste(e, "etapa_perforacion", '17 1/2"', USUARIO));
  await c1.terminar();
  const guardado = (await comun.leerAjuste("compartidos")).etapa_perforacion;
  assert.deepEqual([guardado.valor, guardado.desde], ['17 1/2"', "DLTA"]);

  // GSM: su primera carga toma la etapa compartida (no la de su formato).
  const gsmBackend = new BackendMemoria();
  const gsm = await abrir("GSM", gsmBackend);
  const c2 = new Compartidos(gsm, comun);
  await cargar(gsm);
  await c2.terminar();
  assert.equal(etapa(gsm), '17 1/2"');
  assert.equal(gsm.estado.auditoria.at(-1).accion, "SINCRONIZAR");

  // En GSM se emite un vale interno con otra etapa: pasa a ser la de los dos.
  const area = gsm.estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  await gsm.modificar((e) => {
    const b = v.nuevoBorrador(e, { usuario: USUARIO, plantillaId: area.id, fecha: "2026-10-08" });
    b.lineas.push({ ...v.lineaNoInventariada(e, 136), cantidad: "5", um: "LTS" });
    b.etapa_perforacion = '12 1/4"';
    v.emitirBorrador(e, b.id, { capacidad: 50 });
  });
  await c2.terminar();
  assert.equal(etapa(gsm), '12 1/4"');

  // DLTA vuelve a abrirse (otra sesión con la misma base): toma 12 1/4".
  const dlta2 = await abrir("DLTA", dlta.backend);
  await new Compartidos(dlta2, comun).sincronizar();
  assert.equal(etapa(dlta2), '12 1/4"');
});

test("al restaurar un respaldo con una etapa vieja se queda la compartida", async () => {
  const comun = new BackendMemoria();
  const dlta = await abrir("DLTA");
  await cargar(dlta);
  const c = new Compartidos(dlta, comun);
  await c.sincronizar();
  const viejo = await dlta.respaldo("manual");
  await dlta.modificar((e) => fijarAjuste(e, "etapa_perforacion", '8 1/2"', USUARIO));
  await c.terminar();
  await dlta.restaurar(viejo.datos);
  await c.terminar();
  assert.equal(etapa(dlta), '8 1/2"');
});

test("adoptar: también los borradores que traían la etapa anterior (los cambiados a mano se respetan)", () => {
  const { estado } = cargaSintetica();
  const antes = estado.config.etapa_perforacion;
  estado.borradores = [{ id: 1, etapa_perforacion: antes }, { id: 2, etapa_perforacion: "ESCRITA A MANO" }];
  const cambiadas = adoptarCompartidos(estado, { etapa_perforacion: { valor: '26"', desde: "GSM" } }, USUARIO);
  assert.deepEqual(cambiadas, ["etapa_perforacion"]);
  assert.deepEqual(
    [estado.config.etapa_perforacion, estado.borradores[0].etapa_perforacion, estado.borradores[1].etapa_perforacion],
    ['26"', '26"', "ESCRITA A MANO"],
  );
  assert.deepEqual(adoptarCompartidos(estado, { etapa_perforacion: { valor: '26"' } }), []); // ya es la misma
});

test("personalización, captura de partidas y Mi pantalla de vales son las mismas en DLTA y GSM", async () => {
  const comun = new BackendMemoria();
  const dlta = await abrir("DLTA");
  await cargar(dlta);
  const c1 = new Compartidos(dlta, comun);
  await c1.sincronizar();
  const gsm = await abrir("GSM");
  await cargar(gsm);
  const c2 = new Compartidos(gsm, comun);
  await c2.sincronizar();

  // En GSM: tema oscuro, captura con búsqueda rápida y partidas a la izquierda.
  await gsm.modificar((e) => {
    guardarPersonalizacion(e, USUARIO, { tema: "oscuro", avisos: "abajo" });
    fijarAjuste(e, "captura_rapida", true, USUARIO);
    guardarPreferenciasVale(e, USUARIO, { orden: preferenciasVale(e, USUARIO).orden, lado: "partidas-izquierda" });
  });
  await c2.terminar();

  // DLTA, al abrirse otra vez, queda igual.
  await new Compartidos(dlta, comun).sincronizar();
  assert.equal(personalizacion(dlta.estado, USUARIO).tema, "oscuro");
  assert.equal(personalizacion(dlta.estado, USUARIO).avisos, "abajo");
  assert.equal(dlta.estado.config.captura_rapida, true);
  assert.equal(preferenciasVale(dlta.estado, USUARIO).lado, "partidas-izquierda");

  // Restablecer la pantalla en DLTA también llega a GSM (gana el último cambio, completo).
  const c3 = new Compartidos(dlta, comun);
  await c3.sincronizar();
  await dlta.modificar((e) => restablecerPreferenciasVale(e, USUARIO));
  await c3.terminar();
  await new Compartidos(gsm, comun).sincronizar();
  assert.notEqual(preferenciasVale(gsm.estado, USUARIO).lado, "partidas-izquierda");
  assert.equal(personalizacion(gsm.estado, USUARIO).tema, "oscuro");
});
