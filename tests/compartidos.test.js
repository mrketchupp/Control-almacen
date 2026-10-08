// Ronda 18: la etapa de perforación es la misma en DLTA y GSM. Datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Compartidos, adoptarCompartidos } from "../src/almacen/compartidos.js";
import { fijarAjuste } from "../src/servicios/catalogos.js";
import { guardarPersonalizacion, guardarPreferenciasVale, personalizacion, preferenciasVale, restablecerPreferenciasVale } from "../src/servicios/preferencias.js";
import * as et from "../src/servicios/etiquetas.js";
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

test("Ronda 21: la lista de etiquetas y su bitácora son las mismas en DLTA y GSM", async () => {
  const comun = new BackendMemoria();
  const dlta = await abrir("DLTA");
  await cargar(dlta);
  const c1 = new Compartidos(dlta, comun);
  await c1.sincronizar();
  const [deDlta] = await dlta.modificar((e) => et.agregarEtiquetas(e, "material", [{ codigo: "701", nombre: "BALEROS" }]));
  await c1.terminar();
  c1.cerrar();

  // GSM se abre: trae la lista de DLTA, agrega la suya e imprime las dos.
  const gsm = await abrir("GSM");
  const c2 = new Compartidos(gsm, comun);
  await cargar(gsm); // su primera carga ya trae lo compartido
  await c2.terminar();
  assert.deepEqual(gsm.estado.etiquetas.material.map((e) => e.id), [deDlta]);
  const [deGsm] = await gsm.modificar((e) => et.agregarEtiquetas(e, "material", [{ codigo: "708", nombre: "GRASA" }]));
  await gsm.modificar((e) => et.registrarImpresion(e, "material", [deDlta], { usuario: USUARIO }));
  await c2.terminar();
  assert.deepEqual(gsm.estado.etiquetas.material.map((e) => e.id), [deGsm]);
  // La lista y la bitácora no van en la auditoría (no son ajustes).
  assert.ok(!gsm.estado.auditoria.some((a) => a.entidad_id === "etiquetas_por_imprimir" || a.entidad_id === "impresiones_etiquetas"));
  c2.cerrar();

  // DLTA otra vez: la lista es la de GSM y la impresión está en su bitácora.
  const c3 = new Compartidos(dlta, comun);
  await c3.sincronizar();
  assert.deepEqual(dlta.estado.etiquetas.material.map((e) => e.id), [deGsm]);
  assert.equal(dlta.estado.impresiones_etiquetas.length, 1);

  // Si la base común se quedó atrás (p. ej. se cerró antes de guardarse), la lista más nueva no se pierde.
  await dlta.modificar((e) => et.quitarEtiquetas(e, "material", [deGsm]));
  await c3.terminar();
  c3.cerrar();
  const atrasada = await comun.leerAjuste("compartidos");
  atrasada.etiquetas_por_imprimir.valor = { material: [{ id: "GSM-99" }], ax: [], cambiado_en: "2000-01-01T00:00:00.000Z" };
  atrasada.impresiones_etiquetas.valor = [];
  await comun.guardarAjuste("compartidos", atrasada);
  const c4 = new Compartidos(dlta, comun);
  await c4.sincronizar();
  await c4.terminar();
  assert.deepEqual(dlta.estado.etiquetas.material, []);
  assert.equal(dlta.estado.impresiones_etiquetas.length, 1); // la bitácora se junta: nunca se pierde una
  const publicado = await comun.leerAjuste("compartidos");
  assert.deepEqual(publicado.etiquetas_por_imprimir.valor.material, []);
  assert.equal(publicado.impresiones_etiquetas.valor.length, 1);
});

test("Ronda 21: las listas de antes de compartir (formato 10) se juntan una vez y luego gana el último cambio", async () => {
  const comun = new BackendMemoria();
  const dlta = await abrir("DLTA");
  await cargar(dlta);
  const gsm = await abrir("GSM");
  await cargar(gsm);
  // Cada uno traía su lista del formato 10.
  await dlta.modificar((e) => {
    e.etiquetas = { material: [{ id: "DLTA-1", codigo: "701" }], ax: [], cambiado_en: null, juntar: true };
  });
  await gsm.modificar((e) => {
    e.etiquetas = { material: [{ id: "GSM-1", codigo: "708" }], ax: [{ id: "GSM-2", codigo: "1" }], cambiado_en: null, juntar: true };
  });
  const c1 = new Compartidos(dlta, comun);
  await c1.sincronizar();
  await c1.terminar();
  assert.equal(dlta.estado.etiquetas.juntar, undefined); // la primera en publicarse ya no queda «por juntar»
  c1.cerrar();
  const c2 = new Compartidos(gsm, comun);
  await c2.sincronizar();
  await c2.terminar();
  assert.deepEqual(gsm.estado.etiquetas.material.map((e) => e.id), ["DLTA-1", "GSM-1"]);
  assert.deepEqual(gsm.estado.etiquetas.ax.map((e) => e.id), ["GSM-2"]);
  assert.equal(gsm.estado.etiquetas.juntar, undefined);
  // En GSM se quita la de DLTA: al abrir DLTA no vuelve a aparecer.
  await gsm.modificar((e) => et.quitarEtiquetas(e, "material", ["DLTA-1"]));
  await c2.terminar();
  c2.cerrar();
  const c3 = new Compartidos(dlta, comun);
  await c3.sincronizar();
  assert.deepEqual(dlta.estado.etiquetas.material.map((e) => e.id), ["GSM-1"]);
});
