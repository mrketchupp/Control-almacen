// Actualizar puestos en el historial solo después de la confirmación, sin tocar partidas.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { estadoVacio } from "../src/nucleo/estado.js";
import { guardarPersona } from "../src/servicios/catalogos.js";
import { actualizarPuestoEnVales, previaActualizacionPuesto } from "../src/servicios/personas.js";

function conFirmas() {
  const estado = estadoVacio();
  estado.articulos[42] = { codigo: 42, descripcion: "ARTICULO SINTETICO", no_inventariado: false };
  estado.variantes.push({ id: 1, codigo: 42, dimension: "DIMENSION SINTETICA", um: "PZA" });
  estado.existencias.push({ id: 77, variante_id: 1, cantidad_conteo: "10.5000", ubicacion_id: 8 });
  estado.plantillas_area.push({ id: 1, nombre: "AREA SINTETICA", recibe_puesto: "PUESTO DEL FORMATO" });
  const persona = guardarPersona(estado, { nombre: "FULANO MÉNGANO", puesto: "" });
  estado.alias["MENGANO FULANO"] = persona.id;
  const partida = (id) => ({
    id,
    renglon: id,
    cantidad: "1.2500",
    codigo: 42,
    descripcion: "MATERIAL SINTETICO",
    clave: "DIMENSION SINTETICA",
    existencia_id: 77,
    oc: "000123",
    lote: "LOTE INVENTADO",
    encabezado_original: { entrego: "MENGANO FULANO", fecha: "2025-02-03" },
    dato_importado: { sin_cambios: true },
  });
  const vale = (id, tipo, firmas) => ({
    id,
    tipo,
    folio: id,
    fecha: "2025-02-03",
    estado: "EMITIDO",
    lineas: [partida(id)],
    fotos: ["foto_sintetica"],
    observaciones: "OBSERVACIONES SINTETICAS",
    ...firmas,
  });
  estado.vales = [
    vale(1, "SALIDA", { entrego_nombre: " fulano mengano ", recibio_nombre: "OTRA PERSONA", recibio_puesto: "OTRO PUESTO", autorizo_nombre: "MENGANO FULANO", autorizo_puesto: "ANTERIOR" }),
    vale(2, "ENTRADA", { recibio_nombre: "FULANO MÉNGANO", recibio_puesto: null, motivo: "INGRESO SINTETICO" }),
    vale(3, "SALIDA", { firma_extra_izq_nombre: "Fulano Méngano", firma_extra_izq_puesto: "ANTERIOR", firma_extra_der_nombre: "MENGANO FULANO", estado: "CANCELADO", motivo_cancelacion: "MOTIVO SINTETICO", migrado: true }),
    vale(4, "SALIDA", { firmas_extra: { izq: { nombre: "MENGANO FULANO", puesto: "ANTERIOR", titulo: "PRIMERA FIRMA" }, der: { nombre: "OTRA PERSONA", puesto: "OTRO PUESTO" } } }),
    vale(5, "SALIDA", { recibio_nombre: "FULANO MENGANA", recibio_puesto: "SIMILAR PERO SIN UNIFICAR" }),
    vale(6, "ENTRADA", { entrego_nombre: "MENGANO FULANO", entrego_puesto: "MECANICO" }),
  ];
  estado.vales[0].campos_encabezado_corregidos = ["fecha"];
  return { estado, persona };
}

test("la vista previa cuenta vales una vez, incluye todos los papeles y alias sin usar nombres parecidos", () => {
  const { estado, persona } = conFirmas();
  const antes = structuredClone(estado);
  const previa = previaActualizacionPuesto(estado, { ...persona, puesto: " mecanico " });
  assert.deepEqual([previa.total, previa.firmas, previa.salidas, previa.entradas], [4, 6, 3, 1]);
  assert.deepEqual(previa.vales.map((v) => v.id), [1, 2, 3, 4]);
  assert.equal(previa.puesto, "MECANICO");
  assert.deepEqual(estado, antes);
});

test("guardar una persona sin confirmar cambia solo el catálogo, incluso con vales pendientes de puesto", () => {
  const { estado, persona } = conFirmas();
  const antes = structuredClone(estado.vales);
  guardarPersona(estado, { ...persona, puesto: "MECANICO" });
  assert.equal(persona.puesto, "MECANICO");
  assert.deepEqual(estado.vales, antes);
  guardarPersona(estado, { ...persona, puesto: "SUPERVISOR" }, null, { actualizarVales: false });
  assert.equal(persona.puesto, "SUPERVISOR");
  assert.deepEqual(estado.vales, antes);
});

test("la confirmación corrige puestos en salidas, entradas y cancelados conservando exactamente las partidas", () => {
  const { estado, persona } = conFirmas();
  const antes = structuredClone(estado.vales);
  const lineas = estado.vales.map((v) => v.lineas);
  const colecciones = structuredClone({ articulos: estado.articulos, existencias: estado.existencias, variantes: estado.variantes, plantillas_area: estado.plantillas_area });
  guardarPersona(estado, { ...persona, puesto: "MECANICO" }, "ALMACENISTA SINTETICO", { actualizarVales: true });
  assert.equal(estado.vales[0].entrego_puesto, "MECANICO");
  assert.equal(estado.vales[0].autorizo_puesto, "MECANICO");
  assert.equal(estado.vales[1].recibio_puesto, "MECANICO");
  assert.equal(estado.vales[2].firma_extra_izq_puesto, "MECANICO");
  assert.equal(estado.vales[2].firma_extra_der_puesto, "MECANICO");
  assert.equal(estado.vales[3].firmas_extra.izq.puesto, "MECANICO");
  assert.deepEqual(estado.vales[0].campos_encabezado_corregidos, ["fecha", "entrego_puesto", "autorizo_puesto"]);
  assert.deepEqual(estado.vales[1].campos_encabezado_corregidos, ["recibio_puesto"]);
  assert.deepEqual(estado.vales[2].campos_encabezado_corregidos, ["firma_extra_izq_puesto", "firma_extra_der_puesto"]);
  assert.deepEqual(estado.vales.slice(4), antes.slice(4));
  assert.deepEqual({ articulos: estado.articulos, existencias: estado.existencias, variantes: estado.variantes, plantillas_area: estado.plantillas_area }, colecciones);
  for (let i = 0; i < estado.vales.length; i++) {
    const vale = estado.vales[i];
    assert.equal(vale.lineas, lineas[i]);
    assert.deepEqual(vale.lineas, antes[i].lineas);
    for (const campo of ["id", "tipo", "folio", "fecha", "estado", "entrego_nombre", "recibio_nombre", "autorizo_nombre", "firma_extra_izq_nombre", "firma_extra_der_nombre", "fotos", "observaciones", "motivo_cancelacion", "migrado"]) {
      assert.deepEqual(vale[campo], antes[i][campo]);
    }
  }
  assert.equal(estado.vales[2].estado, "CANCELADO");
  assert.equal(estado.vales[3].firmas_extra.der.puesto, "OTRO PUESTO");
  const bitacora = estado.auditoria.filter((a) => a.entidad === "vale");
  assert.equal(bitacora.length, 4);
  for (const registro of bitacora) {
    assert.equal(registro.accion, "CORREGIR");
    assert.equal(registro.usuario, "ALMACENISTA SINTETICO");
    assert.match(registro.antes.motivo, /Actualización confirmada.*MECANICO/);
    const previo = antes.find((v) => String(v.id) === registro.entidad_id);
    assert.deepEqual(registro.antes.lineas, previo.lineas);
    assert.deepEqual(registro.despues.lineas, previo.lineas);
  }
  assert.equal(bitacora.find((a) => a.entidad_id === "2").antes.motivo_entrada, "INGRESO SINTETICO");
  assert.equal(estado.vales[1].motivo, "INGRESO SINTETICO");
  assert.equal(estado.secuencias.cambio, 3);
  assert.equal(previaActualizacionPuesto(estado, persona).total, 0);
});

test("agregar una persona con puesto puede completar los vales previos aunque no estuviera en el catálogo", () => {
  const { estado } = conFirmas();
  estado.personas = [];
  estado.alias = {};
  const previa = previaActualizacionPuesto(estado, { nombre: "FULANO MÉNGANO", puesto: "MECANICO" });
  assert.equal(previa.total, 3);
  const nueva = guardarPersona(estado, { nombre: "FULANO MÉNGANO", puesto: "MECANICO" }, null, { actualizarVales: true });
  assert.equal(nueva.puesto, "MECANICO");
  assert.equal(estado.vales[0].entrego_puesto, "MECANICO");
  assert.equal(estado.vales[0].autorizo_puesto, "ANTERIOR"); // Este alias no fue unificado en el catálogo.
  assert.equal(estado.vales[2].firma_extra_der_puesto, undefined);
});

test("quitar un puesto también requiere confirmación y no genera cambios si el vacío ya se confirmó", () => {
  const { estado, persona } = conFirmas();
  const previa = previaActualizacionPuesto(estado, { ...persona, puesto: "" });
  assert.deepEqual(previa.vales.map((v) => v.id), [1, 2, 3, 4, 6]);
  guardarPersona(estado, { ...persona, puesto: "" }, null, { actualizarVales: true });
  assert.equal(estado.vales[0].autorizo_puesto, null);
  assert.equal(estado.vales[2].firma_extra_izq_puesto, null);
  assert.equal(estado.vales[3].firmas_extra.izq.puesto, null);
  assert.equal(estado.vales[5].entrego_puesto, null);
  assert.equal(estado.vales[2].firma_extra_der_puesto, null);
  assert.ok(estado.vales[0].campos_encabezado_corregidos.includes("autorizo_puesto"));
  assert.ok(estado.vales[2].campos_encabezado_corregidos.includes("firma_extra_der_puesto"));
  assert.equal(actualizarPuestoEnVales(estado, persona.id).total, 0);
  assert.throws(() => actualizarPuestoEnVales(estado, 99999), /ya no existe/);
});

test("confirmar un puesto vacío propio agrega el marcador de impresión sin alterar sus partidas", () => {
  const { estado, persona } = conFirmas();
  const entrada = estado.vales[1];
  estado.vales = [entrada];
  const antes = structuredClone(entrada);
  assert.equal(entrada.recibio_puesto, null);
  assert.equal(previaActualizacionPuesto(estado, { ...persona, puesto: "" }).total, 1);
  actualizarPuestoEnVales(estado, persona.id);
  assert.equal(entrada.recibio_puesto, null);
  assert.deepEqual(entrada.campos_encabezado_corregidos, ["recibio_puesto"]);
  assert.deepEqual(entrada.lineas, antes.lineas);
  assert.equal(actualizarPuestoEnVales(estado, persona.id).total, 0);
  assert.equal(estado.auditoria.filter((a) => a.entidad === "vale").length, 1);
});

test("el guardado de catálogo y puestos del historial es atómico si falla el almacenamiento", async () => {
  const { estado, persona } = conFirmas();
  const backend = new BackendMemoria();
  await backend.guardarEstado(estado);
  const almacen = new Almacen(backend);
  await almacen.iniciar();
  const antes = structuredClone(almacen.estado);
  backend.guardarEstado = async () => { throw new Error("Falla de disco sintética"); };
  await assert.rejects(almacen.modificar((e) => guardarPersona(e, { ...persona, puesto: "MECANICO" }, null, { actualizarVales: true })), /Falla de disco/);
  assert.deepEqual(almacen.estado, antes);
  assert.deepEqual(await backend.leerEstado(), antes);
});
