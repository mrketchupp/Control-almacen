// Ronda 35: solo tres plantillas del vale (Consumo interno, NOV y Transferencia); un área es un nombre con su
// plantilla y los destinos de una transferencia son los nombres de la plantilla Transferencia.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { Compartidos, VALORES_COMPARTIDOS } from "../src/almacen/compartidos.js";
import { tipoDeArea } from "../src/nucleo/areas.js";
import { areasConsumo, conArea, destinosTransferencia, esDestinoConocido, listaDestinos } from "../src/servicios/pasosVale.js";
import {
  PLANTILLAS_VALE,
  agregarDestino,
  cambiarPlantillaDeArea,
  destinosDeFabrica,
  fijarDestinos,
  guardarPlantillaVale,
  nombrePlantilla,
  nuevaArea,
  plantillaVale,
  quitarDestino,
} from "../src/servicios/plantillasVale.js";
import * as v from "../src/servicios/vales.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const area = (estado, nombre) => estado.plantillas_area.find((p) => p.nombre === nombre);

test("tres plantillas; cada una se ve desde sus áreas y guardarla las deja iguales", () => {
  const { estado } = cargaSintetica();
  assert.deepEqual(PLANTILLAS_VALE.map((p) => p.nombre), ["Consumo interno", "NOV", "Transferencia"]);
  assert.equal(nombrePlantilla("EXTERNO"), "NOV");
  const interna = plantillaVale(estado, "INTERNO");
  assert.deepEqual(interna.areas.map((a) => a.nombre), ["SOLDADOR", "MECANICO"]);
  assert.equal(interna.referencia.nombre, "SOLDADOR");
  assert.deepEqual(interna.distintas, ["MECANICO"], "cada área traía su hoja");
  assert.equal(plantillaVale(estado, "TRANSFERENCIA").referencia.nombre, "TRANSFERENCIAS");
  // Guardar la plantilla: el mismo formato y las mismas observaciones en todas sus áreas, en la auditoría.
  const obs = "MATERIAL PARA EL EQUIPO\nETAPA DE PERFORACION: 8";
  const antes = estado.auditoria.length;
  assert.equal(guardarPlantillaVale(estado, "INTERNO", { hoja_excel: "SOLDADOR", observaciones: obs }, USUARIO), 2);
  for (const nombre of ["SOLDADOR", "MECANICO"]) assert.deepEqual([area(estado, nombre).hoja_excel, area(estado, nombre).observaciones], ["SOLDADOR", obs]);
  assert.equal(estado.auditoria.length - antes, 2);
  assert.equal(estado.auditoria.at(-1).accion, "PLANTILLA_VALE");
  assert.deepEqual(plantillaVale(estado, "INTERNO").distintas, []);
  assert.equal(guardarPlantillaVale(estado, "INTERNO", { hoja_excel: "SOLDADOR", observaciones: obs }, USUARIO), 0, "sin cambios no se anota");
  // NOV y Transferencia no se tocan; el vale nuevo de MECANICO ya trae el texto de la plantilla.
  assert.notEqual(area(estado, "NOV").observaciones, obs);
  const b = conArea(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), area(estado, "MECANICO").id);
  assert.match(b.observaciones, /^MATERIAL PARA EL EQUIPO/);
});

test("un área nueva es un nombre con su plantilla: toma su formato y observaciones, nunca sus personas", () => {
  const { estado } = cargaSintetica();
  const ref = plantillaVale(estado, "INTERNO");
  const electrico = nuevaArea(estado, { nombre: " electrico ", tipo: "INTERNO" }, USUARIO);
  assert.deepEqual([electrico.nombre, tipoDeArea(electrico), electrico.depto_destino, electrico.hoja_excel, electrico.observaciones],
    ["ELECTRICO", "INTERNO", "ELECTRICO", ref.hoja_excel, ref.observaciones]);
  assert.deepEqual([electrico.origen, electrico.depto_origen, electrico.destino], ["RIG 91", "ALMACEN", "RIG 91"]);
  assert.equal(electrico.recibe_nombre, null);
  assert.ok(areasConsumo(estado).some((a) => a.id === electrico.id), "sale en la cuadrícula de Área");
  assert.equal(nuevaArea(estado, { nombre: "mtto", tipo: "INTERNO", depto_destino: "mantenimiento" }, USUARIO).depto_destino, "MANTENIMIENTO");
  assert.throws(() => nuevaArea(estado, { nombre: "electrico", tipo: "INTERNO" }, USUARIO), /Ya existe/);
  assert.throws(() => nuevaArea(estado, { nombre: "RIG 7", tipo: "TRANSFERENCIA" }, USUARIO), /destino/);
  // Con la plantilla NOV: sus firmas extra (los títulos, sin nombres), el almacenista a la derecha y si pide autoriza.
  const nov = area(estado, "NOV");
  const otra = nuevaArea(estado, { nombre: "compania sintetica", tipo: "EXTERNO" }, USUARIO);
  assert.equal(tipoDeArea(otra), "EXTERNO");
  assert.deepEqual([otra.firmas_extra.izq.titulo, otra.firmas_extra.izq.nombre, otra.firmas_extra.der.nombre], [nov.firmas_extra.izq.titulo, null, null]);
  assert.equal(otra.almacenista_derecha, true);
  assert.equal(otra.hoja_excel, nov.hoja_excel);
});

test("cambiar la plantilla de un área solo si aún no tiene vales", () => {
  const { estado } = cargaSintetica();
  const nueva = nuevaArea(estado, { nombre: "PINTURA", tipo: "INTERNO" }, USUARIO);
  const cambiada = cambiarPlantillaDeArea(estado, nueva.id, "EXTERNO", USUARIO);
  assert.deepEqual([tipoDeArea(cambiada), cambiada.hoja_excel], ["EXTERNO", plantillaVale(estado, "EXTERNO").referencia.hoja_excel]);
  assert.throws(() => cambiarPlantillaDeArea(estado, area(estado, "MECANICO").id, "EXTERNO", USUARIO), /ya tiene vales/);
  assert.throws(() => cambiarPlantillaDeArea(estado, nueva.id, "TRANSFERENCIA", USUARIO), /destino/);
});

test("destinos de transferencia: los de fábrica y los que se agregan; quitar no cambia los vales", () => {
  const { estado } = cargaSintetica();
  assert.equal(destinosDeFabrica(estado), true);
  assert.deepEqual(destinosTransferencia(estado), ["RIG 48", "RIG 90", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);
  assert.deepEqual(agregarDestino(estado, " rig  302 ", USUARIO).at(-1), "RIG 302");
  assert.equal(esDestinoConocido(estado, "Rig 302"), true);
  assert.equal(destinosTransferencia(estado).at(-1), "RIG 302", "sale como botón en «¿A dónde se envía?»");
  assert.equal(destinosDeFabrica(estado), false);
  assert.throws(() => agregarDestino(estado, "RIG 302", USUARIO), /ya está/);
  assert.throws(() => agregarDestino(estado, "  ", USUARIO), /nombre/);
  const antes = [...listaDestinos(estado)];
  quitarDestino(estado, "rig 48", USUARIO);
  assert.equal(esDestinoConocido(estado, "RIG 48"), false);
  fijarDestinos(estado, antes, USUARIO); // Deshacer
  assert.deepEqual(listaDestinos(estado), antes);
  assert.equal(estado.auditoria.at(-1).entidad_id, "destinos_transferencia");
});

test("la lista de destinos es la misma en DLTA y GSM", async () => {
  assert.ok("destinos_transferencia" in VALORES_COMPARTIDOS);
  const comun = new BackendMemoria();
  const abrir = async (inventario) => {
    const almacen = new Almacen(new BackendMemoria(), { inventario });
    await almacen.iniciar();
    await almacen.cargarPrimeraVez(cargaSintetica({ idInventario: inventario }).estado, []);
    return almacen;
  };
  const dlta = await abrir("DLTA");
  const gsm = await abrir("GSM");
  await new Compartidos(dlta, comun).sincronizar();
  const c2 = new Compartidos(gsm, comun);
  await c2.sincronizar();
  await gsm.modificar((e) => agregarDestino(e, "BASE SINTETICA", USUARIO));
  await c2.terminar();
  await new Compartidos(dlta, comun).sincronizar();
  assert.equal(listaDestinos(dlta.estado).at(-1), "BASE SINTETICA");
});
