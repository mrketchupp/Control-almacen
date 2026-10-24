import assert from "node:assert/strict";
import { test } from "node:test";
import { reporteDelDia } from "../src/servicios/reporte.js";
import { estadoAlCierre } from "../src/servicios/corte.js";
import { exportarVales } from "../src/exportadores/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { descomprimirZip, leerZip } from "../src/xlsx/zip.js";
import { almacenReporteGsm, atributosEtiquetas, FECHA_ANTERIOR_GSM, FECHA_REPORTE_GSM, PRIMER_FOLIO_GSM, ULTIMO_FOLIO_GSM, TABLA_DIARIO_GSM } from "./ayudaReporteGsm.js";

function revisarVisibilidad(xml, ultima) {
  const filas = atributosEtiquetas(xml, "row");
  assert.equal(filas.length, ultima);
  for (const fila of filas) {
    assert.ok(!["1", "true"].includes(fila.hidden), `Fila ${fila.r} oculta`);
    assert.ok(fila.ht === undefined || Number(fila.ht) > 0, `Fila ${fila.r} sin altura visible`);
  }
  assert.ok(!atributosEtiquetas(xml, "sheetFormatPr").some((a) => ["1", "true"].includes(a.zeroHeight)));
  assert.ok(!atributosEtiquetas(xml, "sheetPr").some((a) => ["1", "true"].includes(a.filterMode)));
  assert.doesNotMatch(xml, /<filterColumn\b|<sortState\b/);
  assert.equal(atributosEtiquetas(xml, "autoFilter")[0].ref, `A1:T${ultima}`);
}

function conservarPartes(original, resultado, cambiables) {
  const antes = descomprimirZip(original), despues = descomprimirZip(resultado);
  assert.deepEqual([...despues.keys()], [...antes.keys()]);
  for (const [parte, bytes] of antes) if (!cambiables.has(parte)) assert.deepEqual(despues.get(parte), bytes, parte);
  const comprimidas = new Map(leerZip(original).map((p) => [p.nombre, p.comprimido]));
  for (const parte of leerZip(resultado)) if (!cambiables.has(parte.nombre)) assert.deepEqual(parte.comprimido, comprimidas.get(parte.nombre), `Bytes comprimidos: ${parte.nombre}`);
}

test("GSM: el reporte diario incluye hasta 2964, con filas visibles y tabla y filtro completos", async () => {
  const { almacen, estado, plantilla } = await almacenReporteGsm();
  const reporte = reporteDelDia(estado, FECHA_REPORTE_GSM);
  assert.equal(reporte.corte.salida, ULTIMO_FOLIO_GSM);
  const antes = JSON.stringify([estado.vales, estado.existencias]);
  const exportado = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  assert.equal(exportado.resultado.ultimoFolio, ULTIMO_FOLIO_GSM);
  const libro = new LibroLeido(exportado.datos), hoja = libro.hoja("DIARIO");
  assert.deepEqual(Array.from({ length: 35 }, (_, i) => hoja.valorRef(`B${i + 2}`)), Array.from({ length: 35 }, (_, i) => PRIMER_FOLIO_GSM + i));
  const paquete = new PaqueteOOXML(exportado.datos), parte = paquete.parteDeHoja("DIARIO"), diario = paquete.texto(parte);
  revisarVisibilidad(diario, 36);
  const tabla = paquete.texto(TABLA_DIARIO_GSM);
  assert.equal(atributosEtiquetas(tabla, "table")[0].ref, "A1:T36");
  assert.equal(atributosEtiquetas(tabla, "autoFilter")[0].ref, "A1:T36");
  assert.doesNotMatch(tabla, /<filterColumn\b|<sortState\b/);
  const original = new PaqueteOOXML(plantilla).texto(TABLA_DIARIO_GSM);
  assert.equal(/<tableColumns\b[\s\S]*?<\/tableColumns>/.exec(tabla)[0], /<tableColumns\b[\s\S]*?<\/tableColumns>/.exec(original)[0]);
  assert.deepEqual(atributosEtiquetas(tabla, "tableStyleInfo"), atributosEtiquetas(original, "tableStyleInfo"));
  conservarPartes(plantilla, exportado.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
  assert.equal(JSON.stringify([almacen.estado.vales, almacen.estado.existencias]), antes);
});

test("GSM: el reporte histórico mantiene sólo 2930 al 07/10 y reduce tabla y filtros", async () => {
  const { almacen, plantilla } = await almacenReporteGsm();
  const exportado = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_ANTERIOR_GSM });
  assert.equal(exportado.resultado.ultimoFolio, PRIMER_FOLIO_GSM);
  const hoja = new LibroLeido(exportado.datos).hoja("DIARIO");
  assert.equal(hoja.valorRef("B2"), PRIMER_FOLIO_GSM);
  assert.equal(hoja.valorRef("B3"), null);
  const paquete = new PaqueteOOXML(exportado.datos), parte = paquete.parteDeHoja("DIARIO");
  revisarVisibilidad(paquete.texto(parte), 2);
  const tabla = paquete.texto(TABLA_DIARIO_GSM);
  assert.equal(atributosEtiquetas(tabla, "table")[0].ref, "A1:T2");
  assert.equal(atributosEtiquetas(tabla, "autoFilter")[0].ref, "A1:T2");
  assert.doesNotMatch(tabla, /<filterColumn\b|<sortState\b/);
  conservarPartes(plantilla, exportado.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
});

test("GSM sin tabla: elimina filtros activos y la altura cero de la fila modelo", async () => {
  const { almacen } = await almacenReporteGsm({ conTabla: false, filaOculta: false, alturaCero: true, zeroHeight: true });
  const exportado = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  const paquete = new PaqueteOOXML(exportado.datos);
  revisarVisibilidad(paquete.texto(paquete.parteDeHoja("DIARIO")), 36);
  assert.equal(new LibroLeido(exportado.datos).hoja("DIARIO").valorRef("B36"), ULTIMO_FOLIO_GSM);
  assert.ok(!paquete.partes().some((p) => /^xl\/tables\//.test(p)));
});

test("DLTA sin tabla: el mismo historial exporta hasta el último folio y conserva alturas positivas", async () => {
  const { almacen, plantilla } = await almacenReporteGsm({ inventario: "DLTA", conTabla: false, filaOculta: false, alturaCero: false });
  const exportado = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  assert.equal(exportado.resultado.ultimoFolio, ULTIMO_FOLIO_GSM);
  const paquete = new PaqueteOOXML(exportado.datos), parte = paquete.parteDeHoja("DIARIO");
  const filas = atributosEtiquetas(paquete.texto(parte), "row");
  assert.equal(filas.at(-1).ht, "24");
  assert.equal(new LibroLeido(exportado.datos).hoja("DIARIO").valorRef("B36"), ULTIMO_FOLIO_GSM);
  conservarPartes(plantilla, exportado.datos, new Set([parte, "xl/workbook.xml"]));
});

test("un libro GSM exportado al23 puede usarse de plantilla y contraerse al07 sin conservar filas recientes", async () => {
  const { almacen } = await almacenReporteGsm();
  const actual = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  const antiguo = exportarVales(estadoAlCierre(almacen.estado, FECHA_ANTERIOR_GSM).estado, actual.datos);
  assert.equal(antiguo.ultimoFolio, PRIMER_FOLIO_GSM);
  const paquete = new PaqueteOOXML(antiguo.datos), parte = paquete.parteDeHoja("DIARIO");
  revisarVisibilidad(paquete.texto(parte), 2);
  assert.equal(atributosEtiquetas(paquete.texto(TABLA_DIARIO_GSM), "table")[0].ref, "A1:T2");
  assert.equal(atributosEtiquetas(paquete.texto(TABLA_DIARIO_GSM), "autoFilter")[0].ref, "A1:T2");
  assert.equal(new LibroLeido(antiguo.datos).hoja("DIARIO").valorRef("B3"), null);
  conservarPartes(actual.datos, antiguo.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
});

test("la fila de totales se conserva después del último vale al ampliar y contraer la tabla GSM", async () => {
  const { almacen, plantilla } = await almacenReporteGsm({ conTotales: true });
  const actual = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  const antiguo = exportarVales(estadoAlCierre(almacen.estado, FECHA_ANTERIOR_GSM).estado, actual.datos);
  for (const [datos, ultimaDatos] of [[actual.datos, 36], [antiguo.datos, 2]]) {
    const libro = new LibroLeido(datos), hoja = libro.hoja("DIARIO"), paquete = new PaqueteOOXML(datos);
    assert.equal(hoja.valorRef(`B${ultimaDatos}`), ultimaDatos === 36 ? ULTIMO_FOLIO_GSM : PRIMER_FOLIO_GSM);
    assert.equal(hoja.valorRef(`B${ultimaDatos + 1}`), "TOTAL SINTETICO");
    const diario = paquete.texto(paquete.parteDeHoja("DIARIO"));
    assert.match(diario, /SUBTOTAL\(109,TablaDiarioSintetica\[Cantidad\]\)/);
    assert.equal(atributosEtiquetas(diario, "row").length, ultimaDatos + 1);
    assert.equal(atributosEtiquetas(paquete.texto(TABLA_DIARIO_GSM), "table")[0].ref, `A1:T${ultimaDatos + 1}`);
    assert.equal(atributosEtiquetas(paquete.texto(TABLA_DIARIO_GSM), "autoFilter")[0].ref, `A1:T${ultimaDatos}`);
    assert.doesNotMatch(diario + paquete.texto(TABLA_DIARIO_GSM), /<filterColumn\b|<sortState\b/);
    assert.ok(!atributosEtiquetas(diario, "row").some((a) => ["1", "true"].includes(a.hidden)));
  }
  const parte = new PaqueteOOXML(actual.datos).parteDeHoja("DIARIO");
  conservarPartes(plantilla, actual.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
  conservarPartes(actual.datos, antiguo.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
});

test("la exportación limpia la vista activa sin reescribir filtros de vistas personalizadas guardadas", async () => {
  const { almacen, plantilla } = await almacenReporteGsm({ conVistaGuardada: true });
  const resultado = await almacen.exportar("VALES", "ALMACENISTA UNO", FECHA_REPORTE_GSM, { corte: FECHA_REPORTE_GSM });
  const original = new PaqueteOOXML(plantilla), exportado = new PaqueteOOXML(resultado.datos), parte = original.parteDeHoja("DIARIO");
  const vista = /<customSheetViews\b[\s\S]*?<\/customSheetViews>/;
  const esperada = vista.exec(original.texto(parte))[0];
  assert.equal(vista.exec(exportado.texto(parte))[0], esperada);
  revisarVisibilidad(exportado.texto(parte).replace(vista, ""), 36);
  conservarPartes(plantilla, resultado.datos, new Set([parte, "xl/workbook.xml", TABLA_DIARIO_GSM]));
});
