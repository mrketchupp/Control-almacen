// Preferencias de pantalla de cada almacenista (Ajustes → Mi pantalla de vales).

import assert from "node:assert/strict";
import { test } from "node:test";
import { estadoVacio } from "../src/nucleo/estado.js";
import {
  ErrorPreferencias,
  LADO_DEFECTO,
  ORDEN_DEFECTO,
  guardarPersonalizacion,
  guardarPreferenciasVale,
  moverBloque,
  normalizarOrden,
  personalizacion,
  preferenciasVale,
  restablecerPreferenciasVale,
} from "../src/servicios/preferencias.js";

test("sin preferencias guardadas se usa el orden de fábrica: origen y destino al principio, lo automático al final", () => {
  const estado = estadoVacio();
  const prefs = preferenciasVale(estado, "ALMACENISTA UNO");
  assert.deepEqual(prefs, { orden: ORDEN_DEFECTO, lado: LADO_DEFECTO, propias: false });
  assert.equal(ORDEN_DEFECTO.indexOf("origen_destino") < ORDEN_DEFECTO.indexOf("recibio"), true);
  assert.equal(ORDEN_DEFECTO.at(-1), "automaticos");
  assert.deepEqual(preferenciasVale(estado, null).orden, ORDEN_DEFECTO);
});

test("cada almacenista guarda su propio orden y lado", () => {
  const estado = estadoVacio();
  const orden = moverBloque(ORDEN_DEFECTO, "fecha", 0);
  guardarPreferenciasVale(estado, "ALMACENISTA UNO", { orden, lado: "partidas-izquierda" });
  assert.deepEqual(preferenciasVale(estado, "ALMACENISTA UNO"), { orden, lado: "partidas-izquierda", propias: true });
  assert.deepEqual(preferenciasVale(estado, "ALMACENISTA DOS"), { orden: ORDEN_DEFECTO, lado: LADO_DEFECTO, propias: false });

  restablecerPreferenciasVale(estado, "ALMACENISTA UNO");
  assert.equal(preferenciasVale(estado, "ALMACENISTA UNO").propias, false);
  assert.throws(() => guardarPreferenciasVale(estado, null, { orden, lado: LADO_DEFECTO }), ErrorPreferencias);
});

test("un orden guardado se limpia: sin desconocidos ni repetidos y con los bloques nuevos en su lugar", () => {
  const sinEtapa = ORDEN_DEFECTO.filter((id) => id !== "etapa").reverse();
  const limpio = normalizarOrden(["xyz", ...sinEtapa, "fecha"]);
  assert.equal(limpio.length, ORDEN_DEFECTO.length);
  assert.equal(new Set(limpio).size, ORDEN_DEFECTO.length);
  // "etapa" faltaba: va justo después de "autorizo", que en el orden de fábrica la antecede.
  assert.equal(limpio.indexOf("etapa"), limpio.indexOf("autorizo") + 1);
  assert.deepEqual(normalizarOrden(null), ORDEN_DEFECTO);

  const estado = estadoVacio();
  estado.config.preferencias_vale = { X: { orden: ["recibio", "fecha"], lado: "de lado" } };
  const prefs = preferenciasVale(estado, "X");
  assert.equal(prefs.orden.indexOf("recibio") < prefs.orden.indexOf("fecha"), true);
  assert.equal(prefs.orden.length, ORDEN_DEFECTO.length);
  assert.equal(prefs.lado, LADO_DEFECTO);
});

test("mover un bloque a cualquier posición", () => {
  const orden = ["a", "b", "c", "d"];
  assert.deepEqual(moverBloque(orden, "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moverBloque(orden, "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moverBloque(orden, "b", 99), ["a", "c", "d", "b"]);
  assert.deepEqual(moverBloque(orden, "c", -3), ["c", "a", "b", "d"]);
});

test("personalización: por almacenista, la del equipo sin nadie en turno y valores de fábrica", () => {
  const estado = estadoVacio();
  assert.deepEqual(personalizacion(estado, "ALMACENISTA UNO"), { tema: "sistema", avisos: "arriba", animaciones: true, propia: false });
  guardarPersonalizacion(estado, "ALMACENISTA UNO", { tema: "oscuro" });
  guardarPersonalizacion(estado, "ALMACENISTA UNO", { avisos: "abajo", animaciones: false });
  assert.deepEqual(personalizacion(estado, "ALMACENISTA UNO"), { tema: "oscuro", avisos: "abajo", animaciones: false, propia: true });
  // Otro almacenista no hereda la de alguien más; sin nadie en turno se guarda para el equipo.
  assert.equal(personalizacion(estado, "ALMACENISTA DOS").tema, "sistema");
  guardarPersonalizacion(estado, null, { tema: "claro", avisos: "no-existe" });
  assert.deepEqual(personalizacion(estado, null), { tema: "claro", avisos: "arriba", animaciones: true, propia: false });
  assert.equal(personalizacion(estado, "ALMACENISTA DOS").tema, "claro");
  assert.equal(personalizacion(estado, "ALMACENISTA UNO").tema, "oscuro");
});
