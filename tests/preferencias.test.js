// Personalización de cada almacenista (Ajustes → Personalización). "Mi pantalla de vales" y la captura rápida se
// quitaron en la Ronda 34: al cargar un estado o un respaldo anterior, sus claves se borran.

import assert from "node:assert/strict";
import { test } from "node:test";
import { estadoVacio, migrarEstado } from "../src/nucleo/estado.js";
import * as preferencias from "../src/servicios/preferencias.js";
import { guardarPersonalizacion, personalizacion } from "../src/servicios/preferencias.js";

test("Ronda 34: «Mi pantalla de vales» y la captura rápida ya no existen; sus claves se borran al cargar", () => {
  for (const nombre of ["BLOQUES_VALE", "ORDEN_DEFECTO", "LADOS", "preferenciasVale", "guardarPreferenciasVale", "restablecerPreferenciasVale", "moverBloque"]) {
    assert.equal(preferencias[nombre], undefined, nombre);
  }
  const viejo = estadoVacio();
  viejo.config.preferencias_vale = { "ALMACENISTA UNO": { orden: ["fecha", "area"], lado: "partidas-izquierda" } };
  viejo.config.captura_rapida = true;
  viejo.config.personalizacion = { "ALMACENISTA UNO": { tema: "oscuro" } };
  const migrado = migrarEstado(structuredClone(viejo));
  assert.equal(Object.hasOwn(migrado.config, "preferencias_vale"), false);
  assert.equal(Object.hasOwn(migrado.config, "captura_rapida"), false);
  assert.equal(migrado.config.personalizacion["ALMACENISTA UNO"].tema, "oscuro", "la personalización se queda");
  assert.equal(migrado.formato, viejo.formato, "no cambia el formato");
  // Sin las claves (o sin config) tampoco falla.
  assert.doesNotThrow(() => migrarEstado(estadoVacio()));
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
