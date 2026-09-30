import assert from "node:assert/strict";
import { test } from "node:test";
import * as rv from "../src/servicios/revision.js";
import { claveNormalizacion } from "../src/servicios/limpieza.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { HojaXML, PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { CATALOGO, bytesInventario, cargaSintetica, libroInventario, libroVales } from "./ayuda.js";

const vales = libroVales();
const lista = rv.generarRevision(vales, libroInventario(), CATALOGO, { hoy: "2026-09-30" });

function filas(datos, hoja) {
  const ws = new LibroLeido(datos).hoja(hoja);
  const salida = [];
  for (let f = 2; f <= ws.maxFila; f++) salida.push(ws.fila(f, 1, 21));
  return salida;
}

/** Escribe valores en la lista como lo haría el usuario en Excel. */
function contestar(datos, hoja, cambios) {
  const paquete = new PaqueteOOXML(datos);
  const parte = paquete.parteDeHoja(hoja);
  const ws = new HojaXML(paquete.texto(parte));
  for (const [ref, valor] of cambios) ws.ponerCelda(ref, valor);
  paquete.escribir(parte, ws.toString());
  return paquete.generar();
}

function filaDeRenglon(datos, filaDiario) {
  return filas(datos, rv.HOJA_RENGLONES).findIndex((f) => f[1] === filaDiario) + 2;
}

test("la lista contiene los hallazgos", () => {
  const libro = new LibroLeido(lista);
  assert.equal(libro.hoja("Instrucciones").valorRef("H1"), rv.MARCA_FORMATO);
  const renglones = new Map(filas(lista, rv.HOJA_RENGLONES).map((f) => [f[1], f]));
  assert.equal(renglones.get(8)[0], "Alta");
  assert.equal(renglones.get(8)[19], "Sí"); // renglón perdido: eliminar
  assert.equal(renglones.get(6)[0], "Alta"); // encabezado perdido
  assert.equal(renglones.get(6)[5], "RIG 91"); // origen sugerido desde el otro renglón del folio 3
  assert.match(renglones.get(9)[3], /Cantidad inválida/);
  const duplicados = filas(lista, rv.HOJA_DUPLICADOS);
  assert.deepEqual(duplicados.map((d) => [d[0], d[2], d[3], d[9]]), [[2, 4, 5, "Sí"]]);
  assert.deepEqual(filas(lista, rv.HOJA_FOLIOS)[0].slice(0, 2), ["Alta", "8"]);
  assert.deepEqual(filas(lista, rv.HOJA_CODIGOS)[0].slice(0, 2), [799, "ARTICULO NUEVO"]);
  const nombres = new Map(filas(lista, rv.HOJA_NOMBRES).map((f) => [f[1], f[3]]));
  assert.equal(nombres.get("MECANICO UNOO"), "MECANICO UNO");
  const valores = new Map(filas(lista, rv.HOJA_VALORES).map((f) => [`${f[0]}|${f[1]}`, f[3]]));
  assert.equal(valores.get("Destino|(vacío)"), "RIG 91");
  const inventario = filas(lista, rv.HOJA_INVENTARIO);
  assert.ok(inventario.some((f) => String(f[7]).includes("Renglón repetido")));
  assert.ok(inventario.some((f) => f[2] === 799));
});

test("lee las respuestas del usuario", () => {
  let datos = contestar(lista, rv.HOJA_RENGLONES, [
    [`P${filaDeRenglon(lista, 6)}`, "NUEVO"], // lote
    [`K${filaDeRenglon(lista, 9)}`, 15], // cantidad corregida
  ]);
  datos = contestar(datos, rv.HOJA_CODIGOS, [["F2", "ARTICULO CONFIRMADO"]]);
  const respuestas = rv.leerRevision(datos, vales.renglones);
  assert.ok(respuestas.eliminar.has(8) && respuestas.eliminar.has(5));
  assert.equal(respuestas.correcciones.get(6).lote, "NUEVO");
  assert.ok("cantidad" in respuestas.correcciones.get(9));
  assert.deepEqual(respuestas.codigos.get(799), [null, "ARTICULO CONFIRMADO"]);
  assert.equal(respuestas.alias.get("MECANICO UNOO"), "MECANICO UNO");
  assert.equal(respuestas.normalizaciones.get(claveNormalizacion("destino", "(vacío)")), "RIG 91");
});

test("una fila que ya no corresponde a su folio se ignora", () => {
  const datos = contestar(lista, rv.HOJA_RENGLONES, [[`C${filaDeRenglon(lista, 6)}`, 999]]);
  const respuestas = rv.leerRevision(datos, vales.renglones);
  assert.ok(!respuestas.correcciones.has(6));
  assert.ok(respuestas.advertencias.some((a) => a.includes("fila 6")));
});

test("un archivo que no es la lista de revisión se rechaza", () => {
  assert.throws(() => rv.leerRevision(bytesInventario(), []), rv.ErrorRevision);
});

test("primera carga con las respuestas de la revisión", () => {
  const respuestas = rv.leerRevision(lista, vales.renglones);
  const { estado, reporte } = cargaSintetica({ respuestas });
  assert.ok(reporte.omitidos.some(([fila, motivo]) => fila === 5 && motivo.startsWith("Eliminado")));
  assert.equal(estado.vales.find((v) => v.folio === 5).destino, "RIG 91");
  const persona = estado.personas.find((p) => p.id === estado.alias["MECANICO UNOO"]);
  assert.equal(persona.nombre, "MECANICO UNO");
});
