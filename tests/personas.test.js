// Unificar personas repetidas: la lista queda limpia y el historial de vales no cambia.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices } from "../src/nucleo/estado.js";
import { guardarPersona } from "../src/servicios/catalogos.js";
import { personasParaFirma } from "../src/servicios/consultas.js";
import { aliasDe, marcarDistintas, parecenLaMisma, personasRepetidas, unificarPersonas } from "../src/servicios/personas.js";
import { cargaSintetica } from "./ayuda.js";

test("nombres que parecen la misma persona: orden, acentos, iniciales, títulos, faltas y apellido de más", () => {
  assert.ok(parecenLaMisma("FULANO MENGANO", "MENGANO FULANO"));
  assert.ok(parecenLaMisma("FULANO MÉNGANO ZÚTANO", "FULANO MENGANO"));
  assert.ok(parecenLaMisma("F. MENGANO", "FULANO MENGANO"));
  assert.ok(parecenLaMisma("ING. FULANO MENGANO", "fulano mengano"));
  assert.ok(parecenLaMisma("FULANO MENGANA", "FULANO MENGANO"));
  assert.ok(parecenLaMisma("PERENGANA DE LA LUZ ZUTANO", "PERENGANA LUZ ZUTANO"));
  assert.ok(!parecenLaMisma("LUIS MENGANO", "LUISA MENGANO"));
  assert.ok(!parecenLaMisma("FULANO", "FULANO MENGANO")); // una sola palabra no basta
  assert.ok(!parecenLaMisma("PERENGANO ZUTANO", "FULANO MENGANO"));
  assert.ok(!parecenLaMisma("F. M.", "FULANO MENGANO")); // solo iniciales no basta
});

function conRepetidos() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const persona = (nombre, extra = {}) => Object.assign(indices.persona(nombre), extra);
  const fulano = persona("FULANO MENGANO ZUTANO", { puesto: "MECANICO" });
  const fulano2 = persona("MENGANO ZUTANO FULANO");
  const fulano3 = persona("F. MENGANA ZUTANO", { es_almacenista: true });
  const perengana = persona("PERENGANA ZUTANO RUIZ");
  const perengana2 = persona("PERENGANA ZUTANA");
  // Vales con los nombres como se escribieron (historial).
  const salida = estado.vales.find((v) => v.tipo === "SALIDA");
  salida.recibio_nombre = "MENGANO ZUTANO FULANO";
  estado.plantillas_area[1].recibe_nombre = "F. MENGANA ZUTANO";
  estado.config.usuario_en_turno = "F. MENGANA ZUTANO";
  estado.config.personalizacion = { "F. MENGANA ZUTANO": { tema: "oscuro", avisos: "abajo", animaciones: true } };
  return { estado, fulano, fulano2, fulano3, perengana, perengana2, salida };
}

test("se sugieren los grupos repetidos y 'no son la misma' ya no se vuelve a sugerir", () => {
  const { estado, fulano, fulano2, fulano3, perengana, perengana2 } = conRepetidos();
  const grupos = personasRepetidas(estado);
  const ids = grupos.map((g) => g.map((x) => x.persona.id).sort((a, b) => a - b));
  assert.ok(ids.some((g) => JSON.stringify(g) === JSON.stringify([fulano.id, fulano2.id, fulano3.id].sort((a, b) => a - b))));
  assert.ok(ids.some((g) => JSON.stringify(g) === JSON.stringify([perengana.id, perengana2.id].sort((a, b) => a - b))));
  // El almacenista va primero (es el nombre que se propone conservar).
  assert.equal(grupos.find((g) => g.some((x) => x.persona.id === fulano.id))[0].persona.id, fulano3.id);
  marcarDistintas(estado, [perengana.id, perengana2.id]);
  assert.ok(!personasRepetidas(estado).some((g) => g.some((x) => x.persona.id === perengana.id)));
});

test("unificar: queda un nombre, los demás son alias; los vales no cambian", () => {
  const { estado, fulano, fulano2, fulano3, salida } = conRepetidos();
  const valesAntes = structuredClone(estado.vales);
  const queda = unificarPersonas(estado, fulano.id, [fulano2.id, fulano3.id], "ALMACENISTA UNO");
  assert.equal(queda.nombre, "FULANO MENGANO ZUTANO");
  assert.deepEqual(estado.vales, valesAntes); // historial intacto
  assert.equal(salida.recibio_nombre, "MENGANO ZUTANO FULANO");
  assert.ok(!estado.personas.some((p) => p.id === fulano2.id || p.id === fulano3.id));
  assert.deepEqual(aliasDe(estado, fulano.id), ["F. MENGANA ZUTANO", "MENGANO ZUTANO FULANO"]);
  assert.deepEqual([queda.puesto, queda.es_almacenista], ["MECANICO", true]);
  // Datos por defecto y lo guardado por almacenista pasan al nombre que queda.
  assert.equal(estado.plantillas_area[1].recibe_nombre, "FULANO MENGANO ZUTANO");
  assert.equal(estado.config.usuario_en_turno, "FULANO MENGANO ZUTANO");
  assert.equal(estado.config.personalizacion["FULANO MENGANO ZUTANO"].tema, "oscuro");
  // Escribir otra vez un nombre unificado no crea a la persona repetida.
  assert.equal(new Indices(estado).persona("MENGANO ZUTANO FULANO").id, fulano.id);
  assert.throws(() => guardarPersona(estado, { nombre: "Mengano Zutano Fulano" }), /unificad/);
  // Las firmas hechas con el otro nombre cuentan para la persona, y se encuentra por él.
  const firma = personasParaFirma(estado).find((p) => p.id === fulano.id);
  assert.equal(firma.veces, 1);
  assert.match(firma.texto, /MENGANO ZUTANO FULANO/);
  assert.equal(estado.auditoria.at(-1).accion, "UNIFICAR");
});
