// Exportación sobre plantilla: solo cambian las partes necesarias y los datos cuadran.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportarEntradas } from "../src/exportadores/entradas.js";
import { exportarInventario, fechaEnTexto } from "../src/exportadores/inventario.js";
import { exportarVales } from "../src/exportadores/vales.js";
import { FechaCelda, isoDesdeSerial } from "../src/nucleo/fechas.js";
import { Indices } from "../src/nucleo/estado.js";
import { desplazarFormula } from "../src/xlsx/celdas.js";
import { letraColumna } from "../src/xlsx/celdas.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { descomprimirZip } from "../src/xlsx/zip.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

function partesDistintas(original, exportado) {
  const a = descomprimirZip(original);
  const b = descomprimirZip(exportado);
  const distintas = new Set();
  for (const [nombre, datos] of a) {
    const otro = b.get(nombre);
    if (!otro || otro.length !== datos.length || !otro.every((x, i) => x === datos[i])) distintas.add(nombre);
  }
  return distintas;
}

function filasDiario(datos) {
  const hoja = new LibroLeido(datos).hoja("DIARIO");
  const filas = [];
  for (let f = 1; f <= hoja.maxFila; f++) filas.push(hoja.fila(f, 1, 20));
  return filas;
}

// ------------------------------------------------------------------ fórmulas

test("desplazar fórmulas como Excel", () => {
  const casos = [
    [
      'IF(B2="","",VLOOKUP(Tabla1[[#This Row],[CODIGO AX]],ARTICULOS_MX!$A$2:$B$5000,2,))',
      3,
      'IF(B5="","",VLOOKUP(Tabla1[[#This Row],[CODIGO AX]],ARTICULOS_MX!$A$2:$B$5000,2,))',
    ],
    ["Tabla315[[#This Row],[INGRESO]]+Tabla315[[#This Row],[CANTIDAD]]", 10, "Tabla315[[#This Row],[INGRESO]]+Tabla315[[#This Row],[CANTIDAD]]"],
    ["SUBTOTAL(109,Tabla1[CANTIDAD])", 5, "SUBTOTAL(109,Tabla1[CANTIDAD])"],
    ['A1&"B2"&$C$3&D$4&Hoja!E5', 1, 'A2&"B2"&$C$3&D$4&Hoja!E6'],
    ["TABLA315[x]+B2", 1, "TABLA315[x]+B3"],
  ];
  for (const [formula, delta, esperada] of casos) assert.equal(desplazarFormula(formula, delta), esperada);
  assert.deepEqual([1, 20, 26, 27, 52].map(letraColumna), ["A", "T", "Z", "AA", "AZ"]);
});

// --------------------------------------------------------------------- vales

test("vales: solo cambia el DIARIO; macros, botón, imagen y customXml intactos", () => {
  const { estado } = cargaSintetica();
  const original = bytesVales();
  const resultado = exportarVales(estado, original);
  assert.equal(resultado.renglones, 13);
  assert.equal(resultado.ultimoFolio, 9);
  const distintas = partesDistintas(original, resultado.datos);
  assert.ok([...distintas].every((p) => ["xl/worksheets/sheet1.xml", "xl/workbook.xml"].includes(p)), [...distintas].join());
  const nombres = [...descomprimirZip(resultado.datos).keys()];
  for (const parte of ["xl/vbaProject.bin", "xl/drawings/drawing1.xml", "xl/media/image1.png", "customXml/item1.xml", "xl/calcChain.xml"]) {
    assert.ok(nombres.includes(parte), parte);
  }
  // mismo orden de partes que la plantilla
  assert.deepEqual(nombres, [...descomprimirZip(original).keys()]);
});

test("vales: valores del DIARIO como los dejaba la macro", () => {
  const { estado } = cargaSintetica();
  const filas = filasDiario(exportarVales(estado, bytesVales()).datos);
  assert.equal(filas[0][1], "No. folio");
  const datos = filas.slice(1);
  assert.deepEqual(datos.map((f) => f[1]), [1, 1, 2, 2, 3, 3, 4, 5, 6, 6, 7, 7, 9]);
  const primero = datos[0];
  assert.ok(primero[0] instanceof FechaCelda);
  assert.equal(isoDesdeSerial(primero[0].serial), "2026-09-01");
  assert.deepEqual(primero.slice(2, 4), [0, "XXXXX"]);
  assert.equal(primero[8], "S/OC");
  assert.equal(primero[17], 0); // sin autorizó → 0, como la macro
  assert.deepEqual(datos[4].slice(4, 6), ["RIG 91", "MANTENIMIENTO"]); // encabezado perdido completado
  const folio7 = datos.slice(10, 12);
  assert.equal(folio7[0][11], "FILTROS");
  assert.equal(folio7[1][8], 11536);
  assert.equal(folio7[1][14], "NUEVO");
  assert.deepEqual(folio7[1].slice(18, 20), ["INV", "CONSUMO"]);
  assert.equal(datos[9][12], 555001); // número guardado como texto vuelve a ser número
});

test("vales: un vale cancelado aparece con su folio", () => {
  const { estado } = cargaSintetica();
  const vale = estado.vales.find((v) => v.folio === 9);
  vale.estado = "CANCELADO";
  vale.motivo_cancelacion = "Captura duplicada";
  const filas = filasDiario(exportarVales(estado, bytesVales()).datos);
  const ultimo = filas[filas.length - 1];
  assert.deepEqual([ultimo[1], ultimo[9], ultimo[11]], [9, 0, "CANCELADO – Captura duplicada"]);
});

// ---------------------------------------------------------------- inventario

test("inventario: partes intactas y recálculo al abrir", () => {
  const { estado } = cargaSintetica();
  const original = bytesInventario();
  const resultado = exportarInventario(estado, original);
  assert.equal(resultado.renglones, 14);
  const distintas = partesDistintas(original, resultado.datos);
  const permitidas = new Set([
    "[Content_Types].xml",
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
    "xl/calcChain.xml",
    ...[1, 2, 3, 4, 5].map((i) => `xl/worksheets/sheet${i}.xml`),
    ...[1, 2, 3, 4].map((i) => `xl/tables/table${i}.xml`),
    "xl/comments/comment1.xml",
    "xl/drawings/commentsDrawing1.vml",
  ]);
  for (const parte of distintas) assert.ok(permitidas.has(parte), parte);
  assert.ok(!distintas.has("xl/styles.xml") && !distintas.has("xl/theme/theme1.xml"));
  const partes = descomprimirZip(resultado.datos);
  assert.ok(!partes.has("xl/calcChain.xml"));
  assert.ok(!new TextDecoder().decode(partes.get("[Content_Types].xml")).includes("calcChain"));
  assert.match(new TextDecoder().decode(partes.get("xl/workbook.xml")), /fullCalcOnLoad="1"/);
});

test("inventario: la fecha del encabezado de página es la del inventario", () => {
  const { estado } = cargaSintetica();
  const encabezado = (datos) => /<oddHeader>([\s\S]*?)<\/oddHeader>/.exec(new TextDecoder().decode(descomprimirZip(datos).get("xl/worksheets/sheet1.xml")))[1];
  const original = bytesInventario();
  assert.match(encabezado(original), /LUNES 28 SEPTIEMBRE DE {2}2026/);
  const exportado = encabezado(exportarInventario(estado, original, { fecha: "2026-10-04" }).datos);
  assert.match(exportado, /&amp;RDOMINGO 4 OCTUBRE DE {2}2026/);
  assert.match(exportado, /POZO PRUEBA 7/); // el título no cambia
  assert.equal(encabezado(exportarInventario(estado, original).datos), encabezado(original));
  assert.equal(fechaEnTexto("&RDOMINGO 19 DE ABRIL 2026", "2026-09-30"), "&RMIÉRCOLES 30 DE SEPTIEMBRE 2026");
  assert.equal(fechaEnTexto("Fecha: 5/9/2026, 28 de septiembre de 2026", "2026-10-01"), "Fecha: 01/10/2026, 1 de octubre de 2026");
});

test("inventario: datos, fórmulas, totales y notas", () => {
  const { estado } = cargaSintetica();
  const libro = new LibroLeido(exportarInventario(estado, bytesInventario()).datos);
  const c1 = libro.hoja("CONTENEDOR #1 INVENTARIABLE");
  assert.equal(c1.tablas()[0].ref, "A1:J7");
  assert.ok(c1.formulas.get("C3").startsWith('IF(B3="","",VLOOKUP(Tabla1[[#This Row],[CODIGO AX]]'));
  assert.equal(c1.formulas.get("J6"), "Tabla1[[#This Row],[INGRESO]]+Tabla1[[#This Row],[CANTIDAD]]-Tabla1[[#This Row],[CONSUMO]]");
  assert.equal(c1.valorRef("A7"), "Total");
  assert.equal(c1.formulas.get("F7"), "SUBTOTAL(109,Tabla1[CANTIDAD])");
  assert.deepEqual([2, 3, 4, 5, 6].map((f) => c1.valor(f, 1)), [1, 2, 3, 4, 5]); // ITEM renumerado
  assert.equal(c1.valorRef("D6"), 555001);
  assert.equal(c1.valorRef("H6"), 1); // CONSUMO del vale 6
  assert.equal(c1.valorRef("G3"), "PZA"); // 'PZA ' sin el espacio sobrante
  assert.ok(c1.comentarios().has("D4")); // la nota sigue en su celda
  const consumible = libro.hoja("CONTENEDOR #1 CONSUMIBLE ");
  assert.equal(consumible.tablas()[0].ref, "A1:J7"); // se quitó el renglón vacío
  assert.equal(consumible.valorRef("H2"), 4); // vale 7, ubicado automáticamente
  assert.equal(consumible.valorRef("I6"), null); // INGRESO sin vale que lo respalde
  assert.equal(libro.hoja("CONTENEDOR #2 CONSUMIBLE").valorRef("A6"), "TEXTO FUERA DE LA TABLA");
});

test("inventario: al crecer se recorren totales y notas", () => {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const ubicacion = estado.ubicaciones.find((u) => u.hoja_excel === "CONTENEDOR #1 INVENTARIABLE");
  const propias = estado.existencias.filter((e) => e.ubicacion_id === ubicacion.id);
  const primera = propias.find((e) => e.orden === 1);
  for (const e of propias) e.orden += 1;
  indices.agregarExistencia({
    variante_id: primera.variante_id,
    ubicacion_id: ubicacion.id,
    orden: 1,
    item: null,
    cantidad_conteo: "9",
    conteo_id: primera.conteo_id,
    nota: null,
    fila_origen: null,
    dimension_hoja: null,
    np_hoja: null,
    um_hoja: null,
  });
  const c1 = new LibroLeido(exportarInventario(estado, bytesInventario()).datos).hoja("CONTENEDOR #1 INVENTARIABLE");
  assert.equal(c1.tablas()[0].ref, "A1:J8");
  assert.equal(c1.valorRef("A8"), "Total");
  assert.equal(c1.valorRef("F2"), 9);
  const notas = c1.comentarios();
  assert.ok(notas.has("D5") && !notas.has("D4")); // la nota bajó con su renglón
});

test("inventario: agrega códigos nuevos al catálogo oculto", () => {
  const { estado } = cargaSintetica();
  const libro = new LibroLeido(exportarInventario(estado, bytesInventario()).datos);
  const catalogo = libro.hoja("ARTICULOS_MX");
  const codigos = [];
  for (let f = 3; f <= catalogo.maxFila; f++) codigos.push(catalogo.valor(f, 1));
  assert.ok(codigos.includes(799) && codigos.includes(721));
  assert.equal(libro.hojas.find((h) => h.nombre === "ARTICULOS_MX").estado, "hidden");
});

const soffice = spawnSync("soffice", ["--version"], { encoding: "utf8" });
test("LibreOffice abre los exportados", { skip: soffice.status !== 0 && "LibreOffice no está instalado" }, () => {
  const { estado } = cargaSintetica();
  const carpeta = mkdtempSync(join(tmpdir(), "exportados-"));
  writeFileSync(join(carpeta, "vales.xlsm"), exportarVales(estado, bytesVales()).datos);
  writeFileSync(join(carpeta, "inventario.xlsx"), exportarInventario(estado, bytesInventario()).datos);
  writeFileSync(join(carpeta, "entradas.xlsx"), exportarEntradas(estado).datos);
  for (const nombre of ["vales", "inventario", "entradas"]) {
    const ruta = join(carpeta, nombre === "vales" ? "vales.xlsm" : `${nombre}.xlsx`);
    const r = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", carpeta, ruta], { timeout: 180000 });
    assert.equal(r.status, 0, String(r.stderr));
    assert.ok(existsSync(join(carpeta, `${nombre}.pdf`)));
  }
});

// ------------------------------------------------------------------ fase 3

test("una entrada de material nuevo queda en la hoja y contenedor correctos del inventario exportado (criterio F3)", async () => {
  const en = await import("../src/servicios/entradas.js");
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const c2cons = estado.ubicaciones.find((u) => u.hoja_excel.trim() === "CONTENEDOR #2 CONSUMIBLE");
  const b = en.nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO", fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-100", origen: "BASE PRUEBA" });
  const linea = en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701, { indices }), cantidad: "4" }, { dimension: "6310-2RS", um: "PZA", ubicacionId: c2cons.id });
  const nuevoCodigo = { ...en.lineaEntradaVacia(), codigo: 950, descripcion: "CODIGO NUEVO DE PRUEBA", cantidad: "2" };
  b.lineas = [linea, en.conVarianteNueva(nuevoCodigo, { dimension: "X1", um: "PZA", ubicacionId: c2cons.id })];
  en.confirmarEntrada(estado, b.id, { usuario: "ALMACENISTA UNO" });

  const original = bytesInventario();
  const resultado = exportarInventario(estado, original);
  const libro = new LibroLeido(resultado.datos);
  const hoja = libro.hoja("CONTENEDOR #2 CONSUMIBLE");
  const [, fin] = hoja.tablas()[0].ref.split(":");
  const ultima = Number(fin.replace(/\D/g, "")) - 1; // antes de la fila de totales
  // Los dos renglones nuevos van al final de la tabla de esa hoja, con INGRESO y CANTIDAD 0.
  assert.deepEqual(hoja.fila(ultima - 1, 2, 9).map((x) => (x === null ? null : String(x))), ["701", null, "6310-2RS", null, "0", "PZA", null, "4"]);
  assert.deepEqual(hoja.fila(ultima, 2, 9).map((x) => (x === null ? null : String(x))), ["950", null, "X1", null, "0", "PZA", null, "2"]);
  assert.match(hoja.formulas.get(`J${ultima}`), /^Tabla\d+\[\[#This Row\],\[INGRESO\]\]\+Tabla\d+\[\[#This Row\],\[CANTIDAD\]\]-/);
  assert.equal(hoja.valorRef(`A${ultima + 1}`), "Total");
  // El código nuevo entra al catálogo oculto para que la descripción no salga #N/A (P-15).
  const catalogo = libro.hoja("ARTICULOS_MX");
  const codigos = [];
  for (let f = 1; f <= catalogo.maxFila; f++) codigos.push(catalogo.valor(f, 1));
  assert.ok(codigos.includes(950));
  // Ninguna otra hoja de contenedor cambia de tamaño.
  const antes = new LibroLeido(exportarInventario(cargaSintetica().estado, original).datos);
  for (const nombre of libro.nombresHojas.filter((n) => n.startsWith("CONTENEDOR") && n.trim() !== "CONTENEDOR #2 CONSUMIBLE")) {
    assert.equal(libro.hoja(nombre).tablas()[0].ref, antes.hoja(nombre).tablas()[0].ref, nombre);
  }
});

test("entradas: VALES DE ENTRADA DLTA.xlsx con las columnas del DIARIO y el folio interno", async () => {
  const en = await import("../src/servicios/entradas.js");
  const { exportarEntradas, ENCABEZADOS_ENTRADAS } = await import("../src/exportadores/entradas.js");
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const vacio = exportarEntradas(estado);
  assert.equal(vacio.renglones, 0);
  const b = en.nuevoBorradorEntrada(estado, { usuario: "ALMACENISTA UNO", fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "12345", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL", entrego_nombre: "chofer uno" });
  b.lineas = [
    { ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 708, { indices }), cantidad: "3", oc: "4500123" },
    { ...en.entradaSinExistencia({ ...en.lineaEntradaVacia(), codigo: 136, descripcion: "DIESEL", um: "LTS" }), cantidad: "500" },
  ];
  en.confirmarEntrada(estado, b.id, { usuario: "ALMACENISTA UNO" });
  const { datos, renglones, ultimoFolio } = exportarEntradas(estado);
  assert.deepEqual([renglones, ultimoFolio], [2, 1]);
  const hoja = new LibroLeido(datos).hoja("DIARIO");
  assert.deepEqual(hoja.fila(1, 1, 21), ENCABEZADOS_ENTRADAS);
  const fila = hoja.fila(2, 1, 21);
  assert.ok(fila[0] instanceof FechaCelda);
  assert.equal(isoDesdeSerial(fila[0].serial), "2026-10-02");
  assert.deepEqual(fila.slice(1, 18).map((x) => (x === null ? null : String(x))), [
    "12345", "XXXXX", "0", "BASE PRUEBA", "ALMACEN", "RIG 91", "ALMACEN", "4500123", "3", "708", fila[11], "ISOFLEX", "PZA", "0", "CHOFER UNO", "ALMACENISTA UNO", "0",
  ]);
  assert.equal(fila[20], "E-0001");
  assert.equal(hoja.fila(3, 1, 21)[8], "S/OC");
});

test("hoja de conteo: una por contenedor, sin cantidades y con renglones en blanco", async () => {
  const { documentoHojaConteo } = await import("../src/impresion/conteo.js");
  const { estado } = cargaSintetica();
  const ids = estado.ubicaciones.slice(0, 2).map((u) => u.id);
  const { html, css } = documentoHojaConteo(estado, { ubicaciones: ids, fecha: "2026-10-05", usuario: "ALMACENISTA UNO" });
  assert.equal(html.match(/class="conteo-hoja"/g).length, 2);
  assert.match(html, /Hoja de conteo · CONTENEDOR #1 INVENTARIABLE/);
  assert.match(html, /05\/10\/2026/);
  assert.ok(!/>7</.test(html.split("CONTENEDOR #1 CONSUMIBLE")[0].replace(/<td class="n">7<\/td>/g, "")), "no muestra existencias");
  assert.match(css, /@page/);
});
