// Ronda 34, etapa 1: el vale de salida en 3 pasos — en qué paso está un borrador y qué falta para avanzar.

import assert from "node:assert/strict";
import { test } from "node:test";
import { borradorDesdeVale } from "../src/servicios/copiarVale.js";
import * as en from "../src/servicios/entradas.js";
import {
  PASOS,
  areaTransferencia,
  areasConsumo,
  conArea,
  conDestino,
  conTipoDeVale,
  destinosTransferencia,
  esDestinoConocido,
  esTransferencia,
  estadoDePasos,
  faltaMaterial,
  faltaParaAvanzar,
  faltaParaQuien,
  nombrePaso,
  paraEmitir,
  pasoDe,
  pendientesParaEmitir,
  textoObservaciones,
} from "../src/servicios/pasosVale.js";
import * as v from "../src/servicios/vales.js";
import { Indices } from "../src/nucleo/estado.js";
import { conUsoEn, tieneUsoEn } from "../src/nucleo/areas.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const area = (estado, nombre) => estado.plantillas_area.find((p) => p.nombre === nombre);
const campos = (falta) => falta.map((f) => [f.campo, f.mensaje]);

test("los 3 pasos y en cuál está un borrador: el nuevo, el copiado de otro vale y los de antes empiezan en el 1", () => {
  assert.deepEqual(PASOS.map((p) => `${p.numero} · ${p.nombre}`), ["1 · Para quién", "2 · Material", "3 · Revisar y emitir"]);
  assert.equal(nombrePaso(2), "Material");
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO });
  assert.equal(b.paso, 1);
  assert.equal(pasoDe(b), 1);
  // Un borrador anterior a la Ronda 34 no trae paso; uno dañado tampoco se sale de 1…3.
  assert.equal(pasoDe({ ...b, paso: undefined }), 1);
  assert.equal(pasoDe({ ...b, paso: 7 }), 1);
  assert.equal(pasoDe({ ...b, paso: "2" }), 1);
  assert.equal(pasoDe({ ...b, paso: 3 }), 3);
  // Desde una entrada: paso 1 con las partidas ya cargadas.
  const indices = new Indices(estado);
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const be = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(be, { folio_externo: "B-1", origen: "BASE PRUEBA" });
  be.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "2" }];
  const entrada = en.confirmarEntrada(estado, be.id, { usuario: USUARIO });
  const { borrador } = borradorDesdeVale(estado, entrada.id, { usuario: USUARIO });
  assert.equal(borrador.paso, 1);
  assert.equal(borrador.lineas.length, 1);
});

test("paso 1 → 2: área (o destino), nombre de quien recibe y, si el área lo pide, quién autoriza", () => {
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO });
  assert.deepEqual(campos(faltaParaQuien(estado, b)), [["depto_destino", "Falta el área"], ["recibio_nombre", "Falta el nombre"]]);
  v.aplicarPlantilla(estado, b, area(estado, "MECANICO").id);
  b.recibio_nombre = "";
  assert.deepEqual(campos(faltaParaQuien(estado, b)), [["recibio_nombre", "Falta el nombre"]]);
  b.recibio_nombre = "MECANICO UNO";
  assert.deepEqual(faltaParaQuien(estado, b), []);
  assert.deepEqual(faltaParaAvanzar(estado, b, 1), []);
  // Transferencia: sin destino ni autoriza no se avanza.
  const t = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "TRANSFERENCIAS").id });
  Object.assign(t, { destino: "", depto_destino: "", recibio_nombre: "CHOFER UNO", autorizo_nombre: "" });
  assert.deepEqual(campos(faltaParaQuien(estado, t)), [["depto_destino", "Falta el destino"], ["autorizo_nombre", "Falta quién autoriza"]]);
  Object.assign(t, { destino: "OTRO EQUIPO", autorizo_nombre: "RIG MANAGER UNO" });
  assert.deepEqual(faltaParaQuien(estado, t), []);
});

test("paso 2 → 3: al menos una partida; las que no tienen cantidad no detienen (sí al emitir)", () => {
  const { estado } = cargaSintetica();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id });
  b.lineas.push(v.lineaVacia());
  assert.deepEqual(campos(faltaMaterial(b)), [["lineas", "Agrega al menos una partida"]]);
  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  b.lineas.push(v.lineaDesdeExistencia(estado, sellos.id)); // sin cantidad
  assert.deepEqual(faltaParaAvanzar(estado, b, 2), []);
  assert.ok(v.validarVale(estado, b).errores.some((e) => e.campo === "cantidad"), "emitir sí la pide");
  assert.deepEqual(faltaParaAvanzar(estado, b, 3), [], "en el 3 no se avanza: se emite");
});

test("el indicador: anteriores completos, el actual y los siguientes pendientes; el paso no llega al vale emitido", () => {
  assert.deepEqual(estadoDePasos(2).map((p) => p.estado), ["completo", "actual", "pendiente"]);
  assert.deepEqual(estadoDePasos(1).map((p) => p.estado), ["actual", "pendiente", "pendiente"]);
  assert.deepEqual(estadoDePasos(3).map((p) => p.estado), ["completo", "completo", "actual"]);
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
  Object.assign(b, { recibio_nombre: "MECANICO UNO", etapa_perforacion: '12 1/4"', paso: 3 });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  assert.equal("paso" in vale, false);
});

test("paso 1: áreas de consumo, destinos de transferencia sin el RIG propio y cambiar de tipo empieza de cero", () => {
  const { estado } = cargaSintetica();
  assert.deepEqual(areasConsumo(estado).map((a) => a.nombre), ["SOLDADOR", "MECANICO", "NOV"]);
  assert.equal(areaTransferencia(estado).nombre, "TRANSFERENCIAS");
  assert.deepEqual(destinosTransferencia(), ["RIG 48", "RIG 90", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);
  assert.deepEqual(destinosTransferencia("RIG 48"), ["RIG 90", "RIG 91", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);
  assert.equal(esDestinoConocido("rig  165"), true);
  assert.equal(esDestinoConocido("POZO 7"), false);

  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, fecha: "2026-10-03" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  const mecanico = conArea(estado, b, area(estado, "MECANICO").id);
  assert.equal(b.plantilla_area_id, null, "no cambia el original");
  // Quién recibe: el del vale más reciente de MECANICO (el folio 7 migrado), no el fijo de la plantilla (Ronda 35).
  assert.deepEqual([mecanico.depto_destino, mecanico.recibio_nombre, mecanico.lineas.length], ["MECANICO", "MECANICO UNOO", 1]);
  assert.equal(esTransferencia(estado, mecanico), false);
  // A transferencia: el área TRANSFERENCIAS sin destino (se elige); las partidas, fecha y etapa se quedan.
  const t = conTipoDeVale(estado, { ...mecanico, etapa_perforacion: '8 1/2"' }, true);
  assert.equal(esTransferencia(estado, t), true);
  assert.deepEqual([t.plantilla_area_id, t.destino, t.naturaleza, t.fecha, t.etapa_perforacion, t.lineas.length], [area(estado, "TRANSFERENCIAS").id, "", "TRANSFERENCIA", "2026-10-03", '8 1/2"', 1]);
  assert.deepEqual(campos(faltaParaQuien(estado, t)).map(([c]) => c).includes("depto_destino"), true);
  assert.equal(faltaParaQuien(estado, t)[0].mensaje, "Falta el destino");
  // De vuelta a consumo: sin área ni personas.
  const c = conTipoDeVale(estado, { ...t, destino: "RIG 165" }, false);
  assert.deepEqual([c.plantilla_area_id, c.destino, c.recibio_nombre, c.autorizo_nombre, c.naturaleza, c.lineas.length], [null, "", "", "", "CONSUMO", 1]);
  assert.deepEqual(campos(faltaParaQuien(estado, c)), [["depto_destino", "Falta el área"], ["recibio_nombre", "Falta el nombre"]]);
  // El pie del paso: de qué área salen las observaciones y con qué etapa.
  assert.equal(textoObservaciones(estado, { ...mecanico, etapa_perforacion: '12 1/4"' }), 'Observaciones de MECANICO y etapa 12 1/4" se llenan solas.');
  assert.equal(textoObservaciones(estado, b), "");
});

test("paso 3: lo que falta antes de emitir, a dónde lleva cada cosa y las fotos del formato", () => {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area(estado, "MECANICO").id, fecha: "2026-10-03" });
  Object.assign(b, { recibio_nombre: "", etapa_perforacion: '12 1/4"', paso: 3 });
  const foco = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 711);
  b.lineas.push(v.lineaVacia(), { ...v.lineaDesdeExistencia(estado, foco.id) }, { ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "50" });
  let r = pendientesParaEmitir(estado, b, { usuario: USUARIO });
  const porTipo = (t) => r.pendientes.filter((p) => p.tipo === t);
  // Falta quién recibe (paso 1), la cantidad de la partida 1 (paso 2) y justificar lo que excede (aquí mismo).
  assert.deepEqual(porTipo("corregir").map((p) => [p.campo, p.paso]), [["recibio_nombre", 1]]);
  assert.deepEqual(porTipo("cantidad").map((p) => [p.paso, p.uid]), [[2, b.lineas[1].uid]]);
  assert.match(porTipo("cantidad")[0].mensaje, /^Partida 1 · FOCO LED .+: falta la cantidad\.$/);
  assert.equal(porTipo("justificacion").length, 1);
  assert.match(porTipo("justificacion")[0].mensaje, /^SELLOS 555001: sacas 50 y el inventario dice que hay \d+\. ¿Por qué\?$/);
  assert.equal(r.bloquea, 3);
  // Con todo resuelto la justificación se queda (para no perder el campo al escribir), ya sin bloquear.
  b.recibio_nombre = "MECANICO UNO";
  b.lineas[1].cantidad = "1";
  b.lineas[2].justificacion = "PRESTAMO";
  r = pendientesParaEmitir(estado, b, { usuario: USUARIO });
  assert.deepEqual(r.pendientes.map((p) => [p.tipo, p.pendiente]), [["justificacion", false]]);
  assert.equal(r.bloquea, 0);
  // NOV: faltar una foto del formato bloquea Emitir (decisión del usuario).
  r = pendientesParaEmitir(estado, { ...b, fotos: ["f1", null] }, { usuario: USUARIO, espacios: 3 });
  assert.deepEqual(r.pendientes.filter((p) => p.tipo === "fotos").map((p) => p.mensaje), ["Faltan 2 fotos del formato (1 de 3)."]);
  assert.equal(r.bloquea, 1);
  // Sin almacenista en turno: se avisa, sin paso al que ir.
  const sinTurno = pendientesParaEmitir(estado, { ...b, entrego_nombre: "" }, { usuario: null });
  assert.deepEqual(sinTurno.pendientes.filter((p) => p.campo === "entrego_nombre").map((p) => [p.tipo, p.paso]), [["aviso", null]]);
  // Los datos para emitir: entrega quien está en turno, sin filas en blanco.
  const listo = paraEmitir(estado, b, "OTRO ALMACENISTA");
  assert.deepEqual([listo.entrego_nombre, listo.lineas.length], ["OTRO ALMACENISTA", 2]);
});

// ---------------------------------------------------------------- Ronda 35

test("transferencia: la línea «PARA USO EN» de las observaciones dice el destino elegido", () => {
  assert.equal(conUsoEn("MATERIAL SUMINISTRADO PARA USO EN MANTENIMIENTO DEL RIG 91\nETAPA DE PERFORACION: 8", "rig  48"),
    "MATERIAL SUMINISTRADO PARA USO EN RIG 48\nETAPA DE PERFORACION: 8");
  assert.equal(conUsoEn("Material para uso en algo", "BASE MARIN"), "Material para uso en BASE MARIN");
  // Sin la línea: se agrega antes de la etapa (o al final); sin destino, nada cambia.
  assert.equal(conUsoEn("CUMPLE\nETAPA DE PERFORACION: 8", "RIG 90"), "CUMPLE\nPARA USO EN RIG 90\nETAPA DE PERFORACION: 8");
  assert.equal(conUsoEn("", "RIG 90"), "PARA USO EN RIG 90");
  assert.equal(conUsoEn("CUMPLE\nPARA USO EN RIG 48", "  "), "CUMPLE\nPARA USO EN RIG 48");
  assert.equal(tieneUsoEn("SIN DESTINO"), false);

  const { estado } = cargaSintetica();
  const t = conTipoDeVale(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), true);
  // Antes de elegir: la línea con el destino que traía el formato (RIG 48); el pie pide elegirlo.
  assert.match(t.observaciones, /^MATERIAL SUMINISTRADO PARA USO EN RIG 48$/m);
  assert.equal(t.destino, "");
  assert.equal(textoObservaciones(estado, t), "Al elegir el destino, las observaciones dicen «PARA USO EN …».");
  const a48 = conDestino(t, "RIG 48");
  assert.equal(a48.destino, "RIG 48");
  assert.match(a48.observaciones, /^MATERIAL SUMINISTRADO PARA USO EN RIG 48$/m);
  assert.match(textoObservaciones(estado, { ...a48, etapa_perforacion: '8 1/2"' }), /^Las observaciones dicen «PARA USO EN RIG 48» y la etapa 8 1\/2"\.$/);
  // Cambiar de destino (botón u «Otro destino») vuelve a cambiar la línea; el resto del texto y la etapa se quedan.
  const otro = conDestino(a48, "Pozo Sintetico 7");
  assert.match(otro.observaciones, /PARA USO EN POZO SINTETICO 7\nETAPA DE PERFORACION/);
  assert.equal(otro.observaciones.split("\n")[0], t.observaciones.split("\n")[0]);
  assert.equal(v.observacionesDelVale(estado, { ...otro, etapa_perforacion: "17" }).split("\n").at(-1), "ETAPA DE PERFORACION: 17");
});

test("nombres: se sugiere a quien recibió en el vale más reciente del área (y a quien autorizó, si el área lo pide)", () => {
  const { estado } = cargaSintetica();
  const mecanico = area(estado, "MECANICO");
  const emitir = (cambios, plantilla = mecanico) => {
    const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: plantilla.id, fecha: "2026-10-03" });
    Object.assign(b, cambios);
    b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "1", um: "LTS" }); // diésel: sin existencia que se acabe
    return v.emitirBorrador(estado, b.id, { usuario: USUARIO })[0];
  };
  const sugerido = (plantilla = mecanico) => {
    const b = conArea(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), plantilla.id);
    return [b.recibio_nombre, b.recibio_puesto];
  };
  // El último de MECANICO es el folio 7 (migrado): MECANICO UNOO.
  assert.equal(sugerido()[0], "MECANICO UNOO");
  emitir({ recibio_nombre: "PEDRO SINTETICO", recibio_puesto: "AYUDANTE" });
  assert.deepEqual(sugerido(), ["PEDRO SINTETICO", "AYUDANTE"]);
  emitir({ recibio_nombre: "JUAN SINTETICO", recibio_puesto: "MECANICO" });
  assert.deepEqual(sugerido(), ["JUAN SINTETICO", "MECANICO"], "el siguiente ya sugiere al del último vale");
  // El puesto, el que tiene hoy en la lista; con otro nombre unificado, el que se quedó; una persona desactivada no.
  estado.personas.find((p) => p.nombre === "JUAN SINTETICO").puesto = "SUPERVISOR";
  assert.deepEqual(sugerido(), ["JUAN SINTETICO", "SUPERVISOR"]);
  const pedro = estado.personas.find((p) => p.nombre === "PEDRO SINTETICO");
  estado.alias = { ...(estado.alias ?? {}), "JUAN SINTETICO": pedro.id };
  assert.equal(sugerido()[0], "PEDRO SINTETICO");
  pedro.activo = false;
  assert.equal(sugerido()[0], mecanico.recibe_nombre, "sin sugerencia válida queda el de la plantilla");
  // Un área sin vales: el de su plantilla. Otra área no se mezcla.
  assert.equal(sugerido(area(estado, "SOLDADOR"))[0], v.ultimoValeDeArea(estado, area(estado, "SOLDADOR"))?.recibio_nombre ?? area(estado, "SOLDADOR").recibe_nombre);
  // Transferencia: quién transporta y quién autoriza, del último vale de transferencia; MECANICO no lleva autoriza.
  const transferencias = area(estado, "TRANSFERENCIAS");
  emitir({ destino: "RIG 48", recibio_nombre: "CHOFER SINTETICO", recibio_puesto: "CHOFER", autorizo_nombre: "JEFE SINTETICO", autorizo_puesto: "RIG MANAGER" }, transferencias);
  const t = conTipoDeVale(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), true);
  assert.deepEqual([t.recibio_nombre, t.autorizo_nombre, t.autorizo_puesto, t.destino], ["CHOFER SINTETICO", "JEFE SINTETICO", "RIG MANAGER", ""]);
  pedro.activo = true;
  delete estado.alias["JUAN SINTETICO"];
  emitir({ recibio_nombre: "JUAN SINTETICO", autorizo_nombre: "NO VA" });
  const m = conArea(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), mecanico.id);
  assert.deepEqual([m.recibio_nombre, m.autorizo_nombre], ["JUAN SINTETICO", mecanico.autoriza_nombre ?? ""]);
});

test("NOV: las firmas se sugieren solo de vales hechos aquí (en los migrados van por posición)", () => {
  const { estado } = cargaSintetica();
  const nov = area(estado, "NOV");
  const b = conArea(estado, v.nuevoBorrador(estado, { usuario: USUARIO }), nov.id);
  assert.equal(v.ultimoValeDeArea(estado, nov, { migrados: false }), null, "la fixture solo trae migrados de NOV");
  assert.deepEqual([b.recibio_nombre, b.firma_extra_izq_nombre], [nov.recibe_nombre ?? "", nov.firmas_extra?.izq?.nombre ?? ""]);
});
