// Ronda 32 — el inventario de GSM y el de FX salían con errores que Excel reparaba al abrirlos («Registros quitados:
// Fórmula de /xl/worksheets/sheetN.xml», «Tabla reparada», «Parte quitada: /xl/tables/tableN.xml»). El de DLTA no.
// Causas, reproducidas con datos inventados (generar.py, pie_con_formulas en las hojas INVENTARIABLE de GSM):
//   · una hoja sin ninguna partida (en el libro de FX, casi todas) dejaba la tabla sin filas de datos: Excel la quita;
//   · lo de debajo de la tabla se copiaba, no se reubicaba: SUBTOTAL(109,F2:F5) con 2 partidas quedaba F0:F3 (fila 0:
//     Excel quita la fórmula), y las celdas combinadas, validaciones y formatos se quedaban donde estaban.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { leerInventario } from "../src/importadores/inventario.js";
import { mapaDeFilas, reubicarReferencias, separarRango } from "../src/xlsx/celdas.js";
import { HojaXML, PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { TIPOS } from "../src/xlsx/rutas.js";
import { atributos, desescapar } from "../src/xlsx/xml.js";
import { bytesInventarioGsm, cargaSinteticaGsm } from "./ayuda.js";

const INVENTARIABLE_1 = "CONTENEDOR #1 INVENTARIABLE";
const INVENTARIABLE_2 = "CONTENEDOR #2 INVENTARIABLE";

/**
 * Lo que Excel repararía al abrir el libro, revisado en el XML: tablas sin filas de datos, fórmulas con filas que
 * no existen (0, negativas o #REF!) y celdas combinadas encima de una tabla.
 */
function problemasDelLibro(datos) {
  const paquete = new PaqueteOOXML(datos);
  const problemas = [];
  for (const [nombre, parte] of paquete.hojas()) {
    const xml = paquete.texto(parte);
    const rangos = [];
    for (const rel of paquete.relaciones(parte).filter((r) => r.tipo === TIPOS.tabla)) {
      const a = atributos(/<table\b([^>]*?)\/?>/.exec(paquete.texto(rel.destino))[1]);
      const { inicio, fin } = separarRango(a.ref);
      const filasDatos = fin.fila - inicio.fila + 1 - Number(a.headerRowCount ?? 1) - Number(a.totalsRowCount ?? 0);
      if (filasDatos < 1) problemas.push(`${nombre}: la tabla ${a.displayName} (${a.ref}) no tiene filas de datos`);
      rangos.push({ nombre: a.displayName, inicio, fin });
    }
    for (const m of xml.matchAll(/<f\b[^>]*>([\s\S]*?)<\/f>/g)) {
      const formula = desescapar(m[1]);
      if (/#REF!|(?<![A-Za-z0-9_$.[\]!':])\$?[A-Z]{1,3}\$?(0|-\d+)(?!\d)/.test(formula)) problemas.push(`${nombre}: fórmula con una fila que no existe: ${formula}`);
    }
    for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)) {
      const { inicio, fin } = separarRango(m[1]);
      for (const t of rangos) {
        const cruza = inicio.fila <= t.fin.fila && fin.fila >= t.inicio.fila && inicio.columna <= t.fin.columna && fin.columna >= t.inicio.columna;
        if (cruza) problemas.push(`${nombre}: las celdas combinadas ${m[1]} quedan encima de la tabla ${t.nombre}`);
      }
    }
  }
  return problemas;
}

/** La hoja exportada: fórmulas por celda, combinadas, validaciones, formatos y el rango de su tabla. */
function hojaExportada(datos, nombre) {
  const paquete = new PaqueteOOXML(datos);
  const parte = paquete.parteDeHoja(nombre);
  const xml = paquete.texto(parte);
  const hoja = new HojaXML(xml);
  const formula = (ref) => {
    const [, letras, fila] = /^([A-Z]+)(\d+)$/.exec(ref);
    return hoja.formulaDe(Number(fila), letras);
  };
  const tabla = paquete.texto(paquete.relacionDeTipo(parte, TIPOS.tabla));
  return {
    formula,
    texto: (ref) => {
      const [, letras, fila] = /^([A-Z]+)(\d+)$/.exec(ref);
      const t = /<t[^>]*>([^<]*)<\/t>/.exec(hoja.celdas(Number(fila)).get(letras)?.contenido ?? "")?.[1];
      return t === undefined ? null : desescapar(t);
    },
    combinadas: [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map((m) => m[1]),
    validaciones: [...xml.matchAll(/<dataValidation\b[^>]*\bsqref="([^"]+)"/g)].map((m) => m[1]),
    formatos: [...xml.matchAll(/<conditionalFormatting\b[^>]*\bsqref="([^"]+)"/g)].map((m) => m[1]),
    tabla: /<table\b[^>]*\bref="([^"]+)"/.exec(tabla)[1],
  };
}

function preparar() {
  const { estado } = cargaSinteticaGsm();
  const ubicacion = (nombre) => estado.ubicaciones.find((u) => u.hoja_excel === nombre);
  const de = (nombre) => estado.existencias.filter((e) => e.ubicacion_id === ubicacion(nombre).id && e.activo !== false).sort((a, b) => a.orden - b.orden);
  return { estado, de };
}

test("la plantilla de GSM trae el pie con fórmulas, combinadas, validación y formato (como la real)", () => {
  const plantilla = hojaExportada(bytesInventarioGsm(), INVENTARIABLE_1);
  assert.equal(plantilla.tabla, "A1:J6");
  assert.equal(plantilla.formula("F9"), "SUBTOTAL(109,F2:F5)");
  assert.deepEqual(plantilla.combinadas, ["A9:C9"]);
  assert.deepEqual(plantilla.validaciones, ["G2:G5"]);
  assert.deepEqual(plantilla.formatos, ["J2:J5"]);
  assert.deepEqual(problemasDelLibro(bytesInventarioGsm()), []);
});

test("con menos partidas que la plantilla, el pie sube con la tabla y sus rangos se achican (nada que reparar)", () => {
  const { estado, de } = preparar();
  for (const e of de(INVENTARIABLE_1).slice(2)) e.dueno = "FX"; // en el libro de GSM quedan 2 de 4
  const { datos } = exportarInventario(estado, bytesInventarioGsm(), { fecha: "2026-11-18" });
  assert.deepEqual(problemasDelLibro(datos), []);
  const hoja = hojaExportada(datos, INVENTARIABLE_1);
  assert.equal(hoja.tabla, "A1:J4");
  assert.equal(hoja.texto("A7"), "CONTÓ: PERSONA SINTETICA");
  assert.equal(hoja.formula("F7"), "SUBTOTAL(109,F2:F3)", "antes quedaba F0:F3 y Excel quitaba la fórmula");
  assert.equal(hoja.formula("H7"), "$H$4", "la absoluta a la fila de totales también se mueve");
  assert.equal(hoja.formula("J7"), "SUM(J2:J3)");
  assert.deepEqual(hoja.combinadas, ["A7:C7"]);
  assert.deepEqual(hoja.validaciones, ["G2:G3"]);
  assert.deepEqual(hoja.formatos, ["J2:J3"]);
});

test("con más partidas que la plantilla, el pie baja y sus rangos crecen", () => {
  const { estado, de } = preparar();
  const [primera] = de(INVENTARIABLE_1);
  for (let i = 1; i <= 5; i++) estado.existencias.push({ ...structuredClone(primera), id: `nueva-${i}`, orden: primera.orden + 100 + i, fila_origen: null });
  const { datos } = exportarInventario(estado, bytesInventarioGsm(), { fecha: "2026-11-18" });
  assert.deepEqual(problemasDelLibro(datos), []);
  const hoja = hojaExportada(datos, INVENTARIABLE_1);
  assert.equal(hoja.tabla, "A1:J11");
  assert.equal(hoja.formula("F14"), "SUBTOTAL(109,F2:F10)");
  assert.equal(hoja.formula("H14"), "$H$11");
  assert.deepEqual(hoja.combinadas, ["A14:C14"], "antes se quedaba en A9:C9, encima de la tabla");
  assert.deepEqual(hoja.validaciones, ["G2:G10"]);
});

test("libro de FX: una hoja sin partidas de FX conserva una fila vacía en su tabla (Excel no acepta tablas sin filas)", () => {
  const { estado, de } = preparar();
  const [fx] = de(INVENTARIABLE_1);
  fx.dueno = "FX";
  const { datos } = exportarInventario(estado, bytesInventarioGsm(), { fecha: "2026-11-18", dueno: "FX" });
  assert.deepEqual(problemasDelLibro(datos), []);
  const vacia = hojaExportada(datos, INVENTARIABLE_2);
  assert.equal(vacia.tabla, "A1:J3", "encabezado, una fila vacía y totales");
  assert.equal(vacia.formula("J2"), "Tabla3[[#This Row],[INGRESO]]+Tabla3[[#This Row],[CANTIDAD]]-Tabla3[[#This Row],[CONSUMO]]");
  assert.equal(vacia.formula("F6"), "SUBTOTAL(109,F2:F2)");
  assert.deepEqual(vacia.combinadas, ["A6:C6"]);
  // Al leerlo otra vez, la fila vacía no es una partida.
  const libro = leerInventario(datos, "INVENTARIO DE REFACCIONAMIENTO FX DE ALMACEN 181126.xlsx");
  assert.deepEqual(libro.hojas.map((h) => h.renglones.length), [1, 0, 0, 0]);
});

test("reubicarReferencias: como Excel al insertar o borrar filas, no como al copiar", () => {
  const mapa = mapaDeFilas(2, 150, 60); // los datos 2..150 pasan a 2..60 (lo de abajo sube 90)
  assert.equal(reubicarReferencias("SUBTOTAL(109,F2:F150)", mapa), "SUBTOTAL(109,F2:F60)");
  assert.equal(reubicarReferencias("$J$151+J152+A1", mapa), "$J$61+J62+A1");
  assert.equal(reubicarReferencias("SUM(J100:J150)", mapa), "SUM(J60:J60)", "un rango que queda fuera se encoge a la última");
  assert.equal(reubicarReferencias("'OTRA HOJA'!F150+OTRA!B3:B150", mapa), "'OTRA HOJA'!F150+OTRA!B3:B150", "las de otra hoja no se tocan");
  assert.equal(reubicarReferencias('IF(B5="F150","",LOG10(J151))', mapa), 'IF(B5="F150","",LOG10(J61))');
  assert.equal(reubicarReferencias("Tabla3[[#This Row],[TOTAL]]", mapa), "Tabla3[[#This Row],[TOTAL]]");
  assert.equal(reubicarReferencias("A2:J150 L160", mapa), "A2:J60 L70", "también un sqref");
  const crece = mapaDeFilas(2, 5, 10);
  assert.equal(reubicarReferencias("SUBTOTAL(109,F2:F5)&$H$6&J9", crece), "SUBTOTAL(109,F2:F10)&$H$11&J14");
});
