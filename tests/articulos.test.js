// Corregir la descripción de un código del catálogo: bitácora, borradores abiertos, correcciones de vales y
// entradas y el catálogo (ARTICULOS_MX) del inventario exportado.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { leerCatalogoInventario } from "../src/importadores/inventario.js";
import { Indices } from "../src/nucleo/estado.js";
import { ErrorArticulo, bitacoraDeDescripcion, corregirDescripcion, descripcionLimpia } from "../src/servicios/articulos.js";
import { filasInventario } from "../src/servicios/consultas.js";
import * as co from "../src/servicios/conteos.js";
import * as en from "../src/servicios/entradas.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const sellos = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 706);
  return { estado, indices, mecanico, sellos };
}

test("la descripción se guarda sin espacios sobrantes y en mayúsculas", () => {
  assert.equal(descripcionLimpia("  sellos de bomba \n"), "SELLOS DE BOMBA");
  assert.equal(descripcionLimpia(null), "");
});

test("corregir la descripción de un código cambia el catálogo y el inventario, y queda en la bitácora", () => {
  const { estado } = preparar();
  const antes = estado.articulos[706].descripcion;
  const otros = Object.values(estado.articulos).filter((a) => a.codigo !== 706).map((a) => [a.codigo, a.descripcion]);
  const r = corregirDescripcion(estado, 706, "  sellos de bomba  ", { usuario: USUARIO, motivo: "Así viene en AX" });
  assert.deepEqual([r.antes, r.despues, r.partidas], [antes, "SELLOS DE BOMBA", 0]);
  assert.equal(estado.articulos[706].descripcion, "SELLOS DE BOMBA");
  const filas = filasInventario(estado).filter((f) => f.codigo === 706);
  assert.ok(filas.length > 0 && filas.every((f) => f.descripcion === "SELLOS DE BOMBA"));
  assert.deepEqual(Object.values(estado.articulos).filter((a) => a.codigo !== 706).map((a) => [a.codigo, a.descripcion]), otros);
  const [registro] = bitacoraDeDescripcion(estado, 706);
  assert.deepEqual(
    [registro.entidad, registro.entidad_id, registro.accion, registro.usuario, registro.antes.descripcion, registro.despues.descripcion, registro.despues.motivo],
    ["articulo", "706", "CORREGIR_DESCRIPCION", USUARIO, antes, "SELLOS DE BOMBA", "Así viene en AX"],
  );
  corregirDescripcion(estado, 706, "SELLOS DE BOMBA DE LODOS", { usuario: USUARIO });
  assert.deepEqual(bitacoraDeDescripcion(estado, 706).map((a) => a.despues.descripcion), ["SELLOS DE BOMBA DE LODOS", "SELLOS DE BOMBA"], "la más reciente primero");
  assert.equal(bitacoraDeDescripcion(estado, 706)[0].despues.motivo, null);
  assert.deepEqual(bitacoraDeDescripcion(estado, 701), []);
});

test("no se corrige un código que no existe, una descripción vacía ni la que ya tiene", () => {
  const { estado } = preparar();
  const actual = estado.articulos[706].descripcion;
  assert.throws(() => corregirDescripcion(estado, 99999, "NUEVA"), ErrorArticulo);
  assert.throws(() => corregirDescripcion(estado, "706", "NUEVA"), /ya no está en el catálogo/);
  assert.throws(() => corregirDescripcion(estado, 706, "   "), /Escribe la descripción/);
  assert.throws(() => corregirDescripcion(estado, 706, ` ${actual.toLowerCase()} `), /ya está así/);
  assert.equal(estado.articulos[706].descripcion, actual);
  assert.equal(estado.auditoria.filter((a) => a.accion === "CORREGIR_DESCRIPCION").length, 0);
});

test("los borradores abiertos que seguían la descripción anterior la toman; el resto y los vales emitidos no cambian", () => {
  const { estado, indices, mecanico, sellos } = preparar();
  const antes = estado.articulos[706].descripcion;
  const ubicacion = estado.ubicaciones.find((u) => u.id === sellos.ubicacion_id);

  const emitido = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-01" });
  emitido.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  const [vale] = v.emitirBorrador(estado, emitido.id, { usuario: USUARIO });

  const salida = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-02" });
  salida.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  salida.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1", descripcion: "REDACCIÓN PROPIA" });
  salida.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "5" });
  const entrada = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  entrada.lineas = [{ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 706, { indices }), cantidad: "2" }];
  const datos = co.iniciarConteo(estado, { ubicaciones: [ubicacion.id], fecha: "2026-10-05" });
  co.guardarConteoEnCurso(estado, { ...datos, nuevos: [{ ...co.nuevoSobrante(ubicacion.id), codigo: 706, descripcion: antes, um: "PZA", cantidad: "1" }] });

  const diesel = salida.lineas[2].descripcion;
  const r = corregirDescripcion(estado, 706, "SELLOS DE BOMBA", { usuario: USUARIO });
  assert.equal(r.partidas, 3);
  assert.deepEqual(salida.lineas.map((l) => l.descripcion), ["SELLOS DE BOMBA", "REDACCIÓN PROPIA", diesel]);
  assert.equal(entrada.lineas[0].descripcion, "SELLOS DE BOMBA");
  assert.equal(estado.conteo_en_curso.nuevos[0].descripcion, "SELLOS DE BOMBA");
  assert.equal(vale.lineas[0].descripcion, antes, "el vale emitido conserva el texto con el que se imprimió");
  assert.equal(bitacoraDeDescripcion(estado, 706)[0].despues.borradores, 3);
});

test("una corrección que sólo cambia la descripción de una partida se reconoce y se guarda", () => {
  const { estado, mecanico, sellos } = preparar();
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-01" });
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, sellos.id), cantidad: "1" });
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  const antes = vale.lineas[0].descripcion;
  const clave = vale.lineas[0].clave;

  const datos = v.datosParaCorregir(estado, vale.id);
  assert.deepEqual(v.resumenCambios(estado, vale, datos), []);
  datos.lineas[0].descripcion = "sellos de bomba";
  const cambios = v.resumenCambios(estado, vale, datos);
  assert.deepEqual(cambios, [`Partida 1 (706 ${antes} ${clave}): descripción ${antes} → SELLOS DE BOMBA`]);
  v.corregirVale(estado, vale.id, datos, cambios.join("\n"), USUARIO);
  assert.equal(vale.lineas[0].descripcion, "SELLOS DE BOMBA");
  assert.equal(estado.articulos[706].descripcion, antes, "corregir un vale no cambia el catálogo");

  // Con otro código la descripción cambia sola: el resumen no la repite.
  const otro = v.datosParaCorregir(estado, vale.id);
  const filtro = estado.existencias.find((e) => e.variante_id !== sellos.variante_id && new Indices(estado).variante(e.variante_id).codigo === 702);
  otro.lineas[0] = { ...otro.lineas[0], ...v.lineaDesdeExistencia(estado, filtro.id), id: otro.lineas[0].id, uid: otro.lineas[0].uid, cantidad: "1" };
  const [resumen] = v.resumenCambios(estado, vale, otro);
  assert.match(resumen, /código 706 → 702/);
  assert.doesNotMatch(resumen, /descripción/);
});

test("una corrección de entrada reconoce el cambio de descripción de una partida", () => {
  const { estado, indices } = preparar();
  const balero = estado.existencias.find((e) => indices.variante(e.variante_id).codigo === 701);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-100", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL" });
  b.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id, indices), cantidad: "2" }];
  const vale = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const antes = vale.lineas[0].descripcion;

  const datos = en.datosParaCorregirEntrada(estado, vale.id);
  assert.deepEqual(en.resumenCambiosEntrada(estado, vale, datos), []);
  datos.lineas[0].descripcion = "baleros de bomba";
  const cambios = en.resumenCambiosEntrada(estado, vale, datos);
  assert.equal(cambios.length, 1);
  assert.match(cambios[0], new RegExp(`descripción ${antes} → BALEROS DE BOMBA`));
  en.corregirEntrada(estado, vale.id, datos, cambios.join("\n"), USUARIO);
  assert.equal(vale.lineas[0].descripcion, "BALEROS DE BOMBA");
  assert.equal(estado.articulos[701].descripcion, antes);
});

// ------------------------------------------------------------------ catálogo del inventario exportado

/** El estado de la fixture con solo los códigos que ya trae la hoja ARTICULOS_MX de la plantilla. */
function conCatalogoDeLaPlantilla() {
  const { estado } = preparar();
  const catalogo = leerCatalogoInventario(new LibroLeido(bytesInventario()));
  for (const codigo of Object.keys(estado.articulos)) if (!catalogo.has(Number(codigo))) delete estado.articulos[codigo];
  assert.ok(Object.keys(estado.articulos).length > 3);
  assert.ok(Object.values(estado.articulos).every((a) => catalogo.get(a.codigo) === a.descripcion));
  return { estado, catalogo };
}

const parteDelCatalogo = (datos) => new PaqueteOOXML(datos).parteDeHoja("ARTICULOS_MX");

test("el catálogo del inventario exportado no se toca si no hay códigos ni descripciones nuevas", () => {
  const { estado } = conCatalogoDeLaPlantilla();
  const plantilla = bytesInventario();
  const parte = parteDelCatalogo(plantilla);
  const resultado = exportarInventario(estado, plantilla);
  assert.ok(!resultado.partesModificadas.includes(parte));
  assert.deepEqual(new PaqueteOOXML(resultado.datos).bytes(parte), new PaqueteOOXML(plantilla).bytes(parte));
});

test("la descripción corregida de un código llega al catálogo oculto del inventario exportado", () => {
  const { estado, catalogo } = conCatalogoDeLaPlantilla();
  const plantilla = bytesInventario();
  const parte = parteDelCatalogo(plantilla);
  corregirDescripcion(estado, 706, "SELLOS DE BOMBA", { usuario: USUARIO });
  const resultado = exportarInventario(estado, plantilla);
  assert.ok(resultado.partesModificadas.includes(parte));
  const exportado = leerCatalogoInventario(new LibroLeido(resultado.datos));
  assert.equal(exportado.get(706), "SELLOS DE BOMBA");
  for (const [codigo, descripcion] of catalogo) if (codigo !== 706) assert.equal(exportado.get(codigo), descripcion, `código ${codigo}`);
  assert.equal(exportado.size, catalogo.size);
  // Y es la misma hoja oculta que ya traía la plantilla.
  assert.equal(new LibroLeido(resultado.datos).hojas.find((h) => h.nombre === "ARTICULOS_MX").estado, "hidden");
});

test("la descripción corregida y un código nuevo llegan juntos al catálogo exportado", () => {
  const { estado } = preparar();
  corregirDescripcion(estado, 706, "SELLOS DE BOMBA", { usuario: USUARIO });
  const exportado = leerCatalogoInventario(new LibroLeido(exportarInventario(estado, bytesInventario()).datos));
  assert.equal(exportado.get(706), "SELLOS DE BOMBA");
  for (const articulo of Object.values(estado.articulos)) assert.equal(exportado.get(articulo.codigo), articulo.descripcion, `código ${articulo.codigo}`);
});
