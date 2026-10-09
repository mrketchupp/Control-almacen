// Ronda 20: etiquetas de almacén dentro de la herramienta (antes, el generador aparte). Propuestas desde
// el inventario y desde un vale de entrada, lista por imprimir, bitácora, lista .json del generador y
// la hoja impresa con la cuadrícula que cabe físicamente.

import assert from "node:assert/strict";
import { test } from "node:test";
import { adoptarCompartidos, sinImagenes } from "../src/almacen/compartidos.js";
import { delAlmacen, leerReporteAx } from "../src/importadores/ax.js";
import { DISENO_DEFECTO, PLANTILLAS, cuadricula, documentoEtiquetas, leerMedida, normalizarDiseno, plantillaDe } from "../src/impresion/etiquetas.js";
import { Indices, migrarEstado } from "../src/nucleo/estado.js";
import { registrarCorteAx } from "../src/servicios/conciliacion.js";
import * as en from "../src/servicios/entradas.js";
import * as et from "../src/servicios/etiquetas.js";
import { bytesAx, cargaSintetica, NOMBRE_AX } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function preparar() {
  const { estado } = cargaSintetica();
  const indices = new Indices(estado);
  const renglon = (codigo, dimension) =>
    estado.existencias.find((e) => {
      const v = indices.variante(e.variante_id);
      return v.codigo === codigo && v.dimension === dimension;
    });
  return { estado, indices, renglon };
}

/** Registra una entrada con las partidas dadas ({ existencia, cantidad, oc } o { codigo, sinExistencia }). */
function entrada(estado, partidas, extra = {}) {
  const indices = new Indices(estado);
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-100", origen: "BASE PRUEBA", depto_origen: "ALMACEN GENERAL", ...extra });
  b.lineas = partidas.map((p) => {
    const base = p.existencia
      ? en.conRenglonExistente(estado, en.lineaEntradaVacia(), p.existencia.id, indices)
      : en.entradaSinExistencia(en.entradaConArticulo(estado, en.lineaEntradaVacia(), p.codigo, { indices }));
    return { ...base, cantidad: p.cantidad, oc: p.oc ?? "", ...(p.um ? { um: p.um } : {}) };
  });
  return en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
}

test("cantidad propuesta: una por pieza; 1 si es metro, litro, kilo… o si no es entera", () => {
  assert.equal(et.cantidadPropuesta("5", "PZA"), 5);
  assert.equal(et.cantidadPropuesta("3", "JGO"), 3);
  assert.equal(et.cantidadPropuesta("12.5", "PZA"), 1);
  assert.equal(et.cantidadPropuesta("100", "MTS"), 1);
  assert.equal(et.cantidadPropuesta("20", "lts"), 1);
  assert.equal(et.cantidadPropuesta("4", "KG"), 1);
  assert.equal(et.cantidadPropuesta("0", "PZA"), 1);
  assert.equal(et.cantidadPropuesta("", "PZA"), 1);
  assert.equal(et.cantidadPropuesta("5000", "PZA"), et.MAXIMO_POR_PARTIDA);
});

test("desde el inventario: una por partida, NOMBRE de AX si lo trae, ÁREA vacía, INVENTARIO el abierto", () => {
  const { estado, renglon } = preparar();
  const balero = renglon(701, "6309-2Z/C3");
  const sinAx = et.etiquetaDeExistencia(estado, balero.id);
  assert.deepEqual(
    [sinAx.cantidad, sinAx.codigo, sinAx.nombre, sinAx.dimension, sinAx.area, sinAx.inventario, sinAx.origen.tipo, sinAx.origen.hoja],
    [1, "701", "BALEROS", "6309-2Z/C3", "", "DLTA", "INVENTARIO", "CONTENEDOR #1 INVENTARIABLE"],
  );
  // Con un reporte de AX, el nombre es el de AX (el más reciente que trae el código).
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const renglones = delAlmacen(reporte.renglones, "RIG91-IX25").map((r) => (r.codigo === 701 ? { ...r, nombre: "BALERO RIGIDO DE BOLAS" } : r));
  registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "RIG91-IX25", archivo: NOMBRE_AX, renglones }, USUARIO);
  assert.equal(et.etiquetaDeExistencia(estado, balero.id).nombre, "BALERO RIGIDO DE BOLAS");
  assert.equal(et.nombreDe(estado, 708), "GRASA");
  assert.equal(et.nombreDe(estado, "x", { respaldo: "ESCRITO" }), "ESCRITO");
  const gsm = cargaSintetica({ idInventario: "GSM" }).estado;
  assert.equal(et.etiquetaDeExistencia(gsm, gsm.existencias[0].id).inventario, "GSM");
});

test("desde un vale de entrada: piezas, OC en la descripción y sin marcar lo que no lleva existencia", () => {
  const { estado, renglon } = preparar();
  const vale = entrada(estado, [
    { existencia: renglon(701, "6309-2Z/C3"), cantidad: "4", oc: "4500123" },
    { existencia: renglon(705, '1/2"'), cantidad: "25.5" },
    { codigo: 136, cantidad: "200", um: "LTS" },
  ]);
  const propuestas = et.etiquetasDeEntrada(estado, vale.id);
  assert.deepEqual(
    propuestas.map((p) => [p.etiqueta.codigo, p.etiqueta.cantidad, p.etiqueta.descripcion, p.etiqueta.dimension, p.incluir, p.sinExistencia]),
    [
      ["701", 4, "OC: 4500123", "6309-2Z/C3", true, false],
      ["705", 1, "", '1/2"', true, false],
      ["136", 1, "", "", false, true],
    ],
  );
  assert.deepEqual(propuestas[0].etiqueta.origen, { tipo: "ENTRADA", inventario: "DLTA", vale_id: vale.id, emitido_en: vale.emitido_en, folio: "E-0001", folio_externo: "B-100", linea_id: vale.lineas[0].id });
  assert.equal(propuestas[0].etiqueta.area, "");
  assert.throws(() => et.etiquetasDeEntrada(estado, 9999), et.ErrorEtiquetas);
});

test("buscar la entrada por su folio interno (E-0002, E2, 2) o por el folio de la base", () => {
  const { estado, renglon } = preparar();
  const balero = renglon(701, "6309-2Z/C3");
  const primera = entrada(estado, [{ existencia: balero, cantidad: "1" }], { folio_externo: "B-100" });
  const segunda = entrada(estado, [{ existencia: balero, cantidad: "1" }], { folio_externo: "2" });
  const ids = (consulta) => et.buscarEntradas(estado, consulta).map((r) => [r.vale.id, r.por]);
  assert.deepEqual(ids("E-0002"), [[segunda.id, "interno"]]);
  assert.deepEqual(ids("e2"), [[segunda.id, "interno"]]);
  // "2" es el folio interno de la segunda y también su folio de la base.
  assert.deepEqual(ids("2"), [[segunda.id, "interno"]]);
  assert.deepEqual(ids("1"), [[primera.id, "interno"]]);
  assert.deepEqual(ids("b 100"), [[primera.id, "base"]]);
  assert.deepEqual(ids("B-10"), [[primera.id, "base"]]);
  // Sin texto: las más recientes primero.
  assert.deepEqual(ids(""), [[segunda.id, null], [primera.id, null]]);
});

test("lista por imprimir: agregar, cambiar, duplicar, quitar y reponer (Deshacer)", () => {
  const { estado, renglon } = preparar();
  const balero = et.etiquetaDeExistencia(estado, renglon(701, "6309-2Z/C3").id);
  const [a, b] = et.agregarEtiquetas(estado, "material", [balero, { ...balero, cantidad: 3, inventario: "GSM" }]);
  et.agregarEtiquetas(estado, "ax", [balero]);
  assert.deepEqual(Object.keys(estado.etiquetas.ax[0]).sort(), ["agregada_en", "cantidad", "codigo", "id", "inventario", "nombre", "origen"]);
  assert.equal(et.totalEtiquetas(et.etiquetasPorImprimir(estado, "material")), 4);
  et.cambiarEtiqueta(estado, "material", a, { cantidad: "0", area: " taller ", inventario: "gsm", origen: { tipo: "OTRO" } });
  const cambiada = estado.etiquetas.material[0];
  assert.deepEqual([cambiada.cantidad, cambiada.area, cambiada.inventario, cambiada.origen.tipo], [1, "taller", "GSM", "INVENTARIO"]);
  const copia = et.duplicarEtiqueta(estado, "material", a);
  assert.deepEqual(estado.etiquetas.material.map((e) => e.id), [a, copia, b]);
  const quitadas = et.quitarEtiquetas(estado, "material", [a, b]);
  assert.deepEqual(estado.etiquetas.material.map((e) => e.id), [copia]);
  et.reponerEtiquetas(estado, "material", quitadas);
  et.reponerEtiquetas(estado, "material", quitadas);
  assert.deepEqual(estado.etiquetas.material.map((e) => e.id), [a, copia, b]);
  assert.throws(() => et.cambiarEtiqueta(estado, "material", 999, {}), et.ErrorEtiquetas);
  assert.throws(() => et.agregarEtiquetas(estado, "otro", []), et.ErrorEtiquetas);
});

test("imprimir: queda en la bitácora con sus entradas; la entrada deja de faltar", () => {
  const { estado, renglon } = preparar();
  const vale = entrada(estado, [{ existencia: renglon(701, "6309-2Z/C3"), cantidad: "2" }]);
  const otra = entrada(estado, [{ existencia: renglon(708, "ISOFLEX"), cantidad: "1" }], { folio_externo: "B-200" });
  assert.deepEqual(et.entradasSinEtiquetas(estado).map((v) => v.id), [otra.id, vale.id]);
  const ids = et.agregarEtiquetas(estado, "material", et.etiquetasDeEntrada(estado, vale.id).map((p) => p.etiqueta));
  // En la lista ya no "falta".
  assert.deepEqual(et.entradasSinEtiquetas(estado).map((v) => v.id), [otra.id]);
  assert.equal(et.entradasEnLista(estado).get(et.claveDeVale(vale)), 1);
  const registro = et.registrarImpresion(estado, "material", ids, { usuario: USUARIO });
  assert.deepEqual([registro.partidas, registro.etiquetas, registro.vales, registro.usuario], [1, 2, [{ inventario: "DLTA", vale_id: vale.id, emitido_en: vale.emitido_en }], USUARIO]);
  assert.match(registro.id, /^DLTA-\d+-[a-z0-9]+$/);
  assert.equal(estado.etiquetas.material.length, 0);
  assert.equal(et.impresionesPorVale(estado).get(et.claveDeVale(vale))[0].id, registro.id);
  assert.deepEqual(et.entradasSinEtiquetas(estado).map((v) => v.id), [otra.id]);
  // Sin quitar de la lista (para volver a imprimirlas).
  const otras = et.agregarEtiquetas(estado, "ax", [{ codigo: "708", nombre: "GRASA" }]);
  et.registrarImpresion(estado, "ax", otras, { quitar: false });
  assert.equal(estado.etiquetas.ax.length, 1);
  assert.throws(() => et.registrarImpresion(estado, "ax", [12345]), et.ErrorEtiquetas);
});

test("lista .json del generador: cada campo se cuida, la condición no se usa y el inventario es el abierto", () => {
  const archivo = JSON.stringify({
    format: "etiquetas-almacen",
    version: 1,
    exportedAt: "2026-10-01T10:00:00.000Z",
    materials: [
      { cantidad: 3, codigoAx: " 1739 ", nombre: "BANDA", dimension: "3VX900", noParte: "", descripcion: "OC: 45", condicion: "USADO NUEVO", area: "TALLER", logoIndex: 2 },
      { cantidad: "x", codigoAx: 1063, nombre: "EMPAQUE", categoria: "CONSUMIBLES" },
      "basura",
    ],
    axItems: [{ cantidad: 2, codigoAx: "1763", nombre: "BOMBA" }],
  });
  const { material, ax, exportado } = et.leerListaGenerador(archivo, { inventario: "GSM", archivo: "etiquetas.json" });
  assert.equal(exportado, "2026-10-01T10:00:00.000Z");
  assert.deepEqual(
    material.map((m) => [m.cantidad, m.codigo, m.nombre, m.dimension, m.descripcion, m.area, m.inventario]),
    [
      [3, "1739", "BANDA", "3VX900", "OC: 45", "TALLER", "GSM"],
      [1, "1063", "EMPAQUE", "", "", "CONSUMIBLES", "GSM"],
      [1, "", "", "", "", "", "GSM"],
    ],
  );
  assert.ok(!("condicion" in material[0]));
  assert.deepEqual(ax, [{ cantidad: 2, codigo: "1763", nombre: "BOMBA", inventario: "GSM", origen: { tipo: "ARCHIVO", archivo: "etiquetas.json" } }]);
  assert.throws(() => et.leerListaGenerador("{no es json"), /no es un .json válido/);
  assert.throws(() => et.leerListaGenerador(JSON.stringify({ format: "otra" })), /no es una lista exportada/);
  assert.throws(() => et.leerListaGenerador(JSON.stringify({ format: "etiquetas-almacen", materials: [] })), /no trae partidas/);
});

test("sugerencias al escribir a mano: por código o por nombre, y las claves del código", () => {
  const { estado } = preparar();
  assert.deepEqual(et.sugerenciasCodigo(estado, "70").slice(0, 2).map((s) => s.codigo), [701, 702]);
  assert.deepEqual(et.sugerenciasCodigo(estado, "grasa").map((s) => [s.codigo, s.nombre]), [[708, "GRASA"]]);
  assert.deepEqual(et.sugerenciasCodigo(estado, ""), []);
  const { dimensiones } = et.clavesDeCodigo(estado, 701);
  assert.ok(dimensiones.includes("6309-2Z/C3") && dimensiones.includes("6205-2Z"));
});

test("diseño e identidad: compartidos entre inventarios y sin imágenes en la bitácora", () => {
  const { estado } = preparar();
  assert.deepEqual(et.configEtiquetas(estado).diseno, DISENO_DEFECTO);
  assert.deepEqual(et.configEtiquetas(estado).identidad.GSM, { logo_izq: null, logo_der: null, texto: "" });
  const j5163 = PLANTILLAS.find((p) => p.id === "carta-2x5-j5163").diseno;
  assert.equal(et.fijarDiseno(estado, { ...j5163, ancho: "4in" }, USUARIO), true);
  assert.equal(et.configEtiquetas(estado).diseno.ancho, 101.6);
  assert.equal(et.fijarDiseno(estado, j5163, USUARIO), false);
  assert.equal(et.fijarIdentidad(estado, "GSM", { logo_der: { src: PNG, nombre: "gsm.png" }, texto: " BRONCO RIG-91 " }, USUARIO), true);
  assert.equal(et.fijarIdentidad(estado, "GSM", { texto: "BRONCO RIG-91" }, USUARIO), false);
  assert.deepEqual(et.configEtiquetas(estado).identidad.GSM, { logo_izq: null, logo_der: { src: PNG, nombre: "gsm.png" }, texto: "BRONCO RIG-91" });
  assert.throws(() => et.fijarIdentidad(estado, "DLTA", { logo_izq: { src: "https://x/logo.png" } }), et.ErrorEtiquetas);
  const ultima = estado.auditoria.at(-1);
  assert.equal(ultima.entidad_id, "etiquetas.GSM");
  assert.equal(ultima.despues.logo_der, "imagen gsm.png");
  // El otro inventario toma lo compartido; la bitácora no guarda la imagen completa.
  const gsm = cargaSintetica({ idInventario: "GSM" }).estado;
  assert.deepEqual(adoptarCompartidos(gsm, { etiquetas: { valor: estado.config.etiquetas, desde: "DLTA" } }), ["etiquetas"]);
  assert.equal(et.configEtiquetas(gsm).identidad.GSM.logo_der.src, PNG);
  assert.doesNotMatch(JSON.stringify(gsm.auditoria.at(-1)), /base64/);
  assert.deepEqual(sinImagenes({ a: [PNG, "texto"] }), { a: ["[imagen de 0 KB]", "texto"] });
});

test("formato 10: los estados anteriores se migran con la lista de etiquetas vacía", () => {
  const { estado } = cargaSintetica();
  delete estado.etiquetas;
  delete estado.impresiones_etiquetas;
  estado.formato = 9;
  migrarEstado(estado);
  assert.deepEqual([estado.formato, estado.etiquetas, estado.impresiones_etiquetas], [13, { material: [], ax: [], cambiado_en: null }, []]);
});

test("formato 11: ids con el inventario, origen con su inventario y la lista que ya traía etiquetas se junta", () => {
  const { estado } = cargaSintetica({ idInventario: "GSM" });
  estado.formato = 10;
  estado.etiquetas = {
    material: [{ id: 3, codigo: "701", inventario: "GSM", origen: { tipo: "ENTRADA", vale_id: 7, folio: "E-0001" } }],
    ax: [{ id: 4, codigo: "708", inventario: "GSM", origen: { tipo: "MANUAL" } }],
  };
  estado.impresiones_etiquetas = [{ id: 1, fecha_hora: "2026-10-08T10:00:00", vales: [7] }];
  migrarEstado(estado);
  assert.equal(estado.formato, 13);
  assert.deepEqual(estado.etiquetas.material.map((e) => [e.id, e.origen.inventario]), [["GSM-3", "GSM"]]);
  assert.deepEqual(estado.etiquetas.ax.map((e) => [e.id, e.origen.inventario]), [["GSM-4", undefined]]);
  assert.equal(estado.etiquetas.juntar, true);
  assert.deepEqual(estado.impresiones_etiquetas[0], { id: "GSM-1", fecha_hora: "2026-10-08T10:00:00", vales: [{ inventario: "GSM", vale_id: 7, emitido_en: null }] });
  // Una lista vacía no queda «por juntar».
  const vacio = cargaSintetica().estado;
  vacio.formato = 10;
  migrarEstado(vacio);
  assert.equal(vacio.etiquetas.juntar, undefined);
});

test("DLTA y GSM: una sola lista por imprimir; gana el último cambio y la de antes de compartir se junta", () => {
  const vacia = { material: [], ax: [], cambiado_en: null };
  const vieja = { material: [{ id: "DLTA-1" }], ax: [], cambiado_en: "2026-10-08T10:00:00.000Z" };
  const nueva = { material: [{ id: "GSM-1" }], ax: [{ id: "GSM-2" }], cambiado_en: "2026-10-08T10:05:00.000Z" };
  assert.deepEqual(et.adoptarListaEtiquetas(vieja, nueva), nueva);
  assert.deepEqual(et.adoptarListaEtiquetas(nueva, vieja), nueva); // la de aquí es más nueva: se queda
  assert.deepEqual(et.adoptarListaEtiquetas(vacia, nueva), nueva);
  const juntada = et.adoptarListaEtiquetas({ ...vieja, juntar: true, material: [{ id: "DLTA-1" }, { id: "GSM-1" }] }, nueva);
  assert.deepEqual(juntada.material.map((e) => e.id), ["GSM-1", "DLTA-1"]);
  assert.deepEqual(juntada.ax.map((e) => e.id), ["GSM-2"]);
  assert.equal(juntada.juntar, undefined);
  assert.deepEqual(et.listaPublicable({ ...vieja, juntar: true }), vieja);
  // La bitácora se junta sin repetir y en orden.
  const a = [{ id: "DLTA-1", fecha_hora: "2026-10-08T09:00:00" }, { id: "DLTA-2", fecha_hora: "2026-10-08T11:00:00" }];
  const b = [{ id: "GSM-1", fecha_hora: "2026-10-08T10:00:00" }, { id: "DLTA-1", fecha_hora: "2026-10-08T09:00:00" }];
  assert.deepEqual(et.juntarImpresiones(a, b).map((r) => r.id), ["DLTA-1", "GSM-1", "DLTA-2"]);
});

test("la marca de impresa llega a la entrada de su inventario y los ids nunca chocan", () => {
  const { estado: dlta, renglon } = preparar();
  const valeDlta = entrada(dlta, [{ existencia: renglon(701, "6309-2Z/C3"), cantidad: "2" }]);
  const { estado: gsm } = cargaSintetica({ idInventario: "GSM" });
  const indicesGsm = new Indices(gsm);
  const balero = gsm.existencias.find((e) => indicesGsm.variante(e.variante_id).codigo === 701);
  const valeGsm = entrada(gsm, [{ existencia: balero, cantidad: "3" }]);
  // Se agregan en DLTA las de su entrada y las de la de GSM (leída del estado de GSM).
  const ids = et.agregarEtiquetas(dlta, "material", [
    ...et.etiquetasDeEntrada(dlta, valeDlta.id).map((p) => p.etiqueta),
    ...et.etiquetasDeEntrada(gsm, valeGsm.id).map((p) => p.etiqueta),
  ]);
  assert.ok(ids.every((id) => /^DLTA-\d+-[a-z0-9]+$/.test(id)));
  assert.deepEqual(dlta.etiquetas.material.map((e) => [e.inventario, e.origen.inventario]), [["DLTA", "DLTA"], ["GSM", "GSM"]]);
  // Las dos entradas tienen el mismo id interno en su inventario: cada una se ve por separado.
  assert.equal(valeDlta.id, valeGsm.id);
  assert.equal(et.entradasEnLista(dlta, "GSM").get(et.claveDeVale(valeGsm)), 1);
  assert.deepEqual(et.entradasSinEtiquetas(gsm, { registro: dlta }), []);
  const registro = et.registrarImpresion(dlta, "material", ids, { usuario: USUARIO });
  assert.deepEqual(registro.vales, [
    { inventario: "DLTA", vale_id: valeDlta.id, emitido_en: valeDlta.emitido_en },
    { inventario: "GSM", vale_id: valeGsm.id, emitido_en: valeGsm.emitido_en },
  ]);
  assert.equal(et.impresionesPorVale(dlta, "GSM").get(et.claveDeVale(valeGsm))[0].id, registro.id);
  assert.equal(et.impresionesPorVale(dlta).get(et.claveDeVale(valeDlta))[0].id, registro.id);
  // En GSM (con la bitácora ya compartida) su entrada se ve impresa.
  gsm.impresiones_etiquetas = et.juntarImpresiones(gsm.impresiones_etiquetas, dlta.impresiones_etiquetas);
  assert.equal(et.impresionesPorVale(gsm).get(et.claveDeVale(valeGsm))[0].etiquetas, 5);
  // Un id que ya está en la lista (p. ej. tras restaurar un respaldo viejo) no se vuelve a dar.
  dlta.etiquetas.ax.push({ id: `DLTA-${(dlta.secuencias.etiqueta ?? 0) + 1}`, codigo: "1", nombre: "X", cantidad: 1, inventario: "DLTA" });
  const [nuevo] = et.agregarEtiquetas(dlta, "ax", [{ codigo: "2", nombre: "Y" }]);
  assert.equal(new Set([...dlta.etiquetas.ax].map((e) => e.id)).size, dlta.etiquetas.ax.length);
  assert.notEqual(nuevo, dlta.etiquetas.ax[0].id);
  assert.ok(dlta.etiquetas.cambiado_en);
});

test("hoja de etiquetas: la cuadrícula se calcula con lo que cabe en el papel", () => {
  assert.deepEqual([cuadricula(DISENO_DEFECTO).columnas, cuadricula(DISENO_DEFECTO).filas], [2, 6]);
  const j5163 = PLANTILLAS.find((p) => p.id === "carta-2x5-j5163").diseno;
  assert.deepEqual([cuadricula(j5163).columnas, cuadricula(j5163).filas], [2, 5]);
  assert.deepEqual([cuadricula(PLANTILLAS.find((p) => p.id === "carta-3x8").diseno).porHoja], [24]);
  const imposible = cuadricula({ ...DISENO_DEFECTO, ancho: 300 });
  assert.equal(imposible.porHoja, 0);
  assert.equal(imposible.avisos.length, 1);
  assert.deepEqual([leerMedida("4in"), leerMedida("2,5 cm"), leerMedida("12.7"), leerMedida('0.5"'), leerMedida("abc")], [101.6, 25, 12.7, 12.7, null]);
  assert.equal(normalizarDiseno({ ancho: "-3", hoja: "oficio", fuente: 100 }).ancho, DISENO_DEFECTO.ancho);
  assert.equal(plantillaDe(j5163).id, "carta-2x5-j5163");
  assert.equal(plantillaDe({ ...j5163, fuente: 12 }), null);
});

test("documento impreso: se repite por cantidad, cada una con la identidad de su inventario y el texto escapado", () => {
  const identidad = { DLTA: { logo_izq: { src: PNG }, logo_der: { src: "https://fuera.com/x.png" }, texto: "BRONCO RIG-91" }, GSM: { logo_izq: null, logo_der: { src: PNG }, texto: "" } };
  const etiquetas = [
    { cantidad: 13, codigo: "701", nombre: "BALEROS <b>", dimension: "6309", np: "", descripcion: "OC: 1", area: "", inventario: "DLTA" },
    { cantidad: 1, codigo: "708", nombre: "GRASA", inventario: "GSM" },
  ];
  const doc = documentoEtiquetas(etiquetas, { diseno: DISENO_DEFECTO, identidad });
  assert.deepEqual([doc.etiquetas, doc.hojas], [14, 2]);
  assert.match(doc.css, /@page\{size:215\.9mm 279\.4mm;margin:0\}/);
  assert.equal((doc.html.match(/class="etq etq-material"/g) ?? []).length, 14);
  assert.match(doc.html, /BALEROS &lt;b&gt;/);
  assert.doesNotMatch(doc.html, /fuera\.com/);
  assert.match(doc.html, /<b>INVENTARIO:<\/b><span>GSM<\/span>/);
  assert.match(doc.html, /<b>ÁREA:<\/b><span>N\/A<\/span>/);
  // GSM sin texto de almacén: esa línea no se dibuja (las 13 de DLTA sí la llevan).
  assert.equal((doc.html.match(/<span>BRONCO RIG-91<\/span>/g) ?? []).length, 13);
  assert.equal((doc.html.match(/<span>ETIQUETADO ALMACEN<\/span>/g) ?? []).length, 14);
  const vista = documentoEtiquetas(etiquetas, { tipo: "ax", diseno: DISENO_DEFECTO, identidad, vista: true });
  assert.doesNotMatch(vista.css, /@page/);
  assert.match(vista.html, /^<div class="etq-pantalla"><div class="etq-hojas">/);
  assert.match(vista.html, /<div class="etq-t"><span class="etq-b">701<\/span><\/div>/);
  // En pantalla cada regla va dentro de su ámbito: no toca el documento que se imprime.
  assert.ok(vista.css.split("}").filter(Boolean).every((regla) => regla.startsWith(".etq-pantalla ")));
  assert.match(documentoEtiquetas(etiquetas, { vista: true, ambito: "etq-sola" }).css, /^\.etq-sola \.etq-hojas\{/);
  assert.throws(() => documentoEtiquetas(etiquetas, { vista: true, ambito: "x{}" }));
  assert.equal(documentoEtiquetas(etiquetas, { diseno: { ...DISENO_DEFECTO, alto: 400 } }).hojas, 0);
});

test("Ronda 21 (revisión): bitácora con id repetido, reloj que se atrasa y el otro inventario sin abrir", () => {
  // Dos impresiones distintas con el mismo id (ids de antes, tras restaurar): se conservan las dos.
  const a = [{ id: "DLTA-1", fecha_hora: "2026-10-08T09:00:00", usuario: "A" }];
  const b = [{ id: "DLTA-1", fecha_hora: "2026-10-08T10:00:00", usuario: "B" }];
  assert.deepEqual(et.juntarImpresiones(a, b).map((r) => r.usuario), ["A", "B"]);
  assert.equal(et.juntarImpresiones(a, a).length, 1);
  // Si la lista trae una marca «del futuro» (reloj adelantado y luego corregido), el siguiente cambio va después.
  const { estado, renglon } = preparar();
  estado.etiquetas.cambiado_en = "2099-01-01T00:00:00.000Z";
  et.agregarEtiquetas(estado, "material", [{ codigo: "701", nombre: "BALEROS" }]);
  assert.ok(estado.etiquetas.cambiado_en > "2099-01-01T00:00:00.000Z");
  // El otro inventario aún no se abre tras actualizar: lo que su copia trae impreso o en su lista cuenta.
  const { estado: gsm } = cargaSintetica({ idInventario: "GSM" });
  const indicesGsm = new Indices(gsm);
  const balero = gsm.existencias.find((e) => indicesGsm.variante(e.variante_id).codigo === 701);
  const impresa = entrada(gsm, [{ existencia: balero, cantidad: "1" }]);
  const enSuLista = entrada(gsm, [{ existencia: balero, cantidad: "1" }], { folio_externo: "B-200" });
  const ids = et.agregarEtiquetas(gsm, "material", et.etiquetasDeEntrada(gsm, impresa.id).map((p) => p.etiqueta));
  et.registrarImpresion(gsm, "material", ids);
  et.agregarEtiquetas(gsm, "material", et.etiquetasDeEntrada(gsm, enSuLista.id).map((p) => p.etiqueta));
  gsm.etiquetas.juntar = true; // su lista aún no se comparte
  void renglon;
  assert.deepEqual(et.entradasSinEtiquetas(gsm, { registro: estado }), []);
  const r = et.registroParaLeer(estado, gsm);
  assert.ok(et.impresionesPorVale(r, "GSM").has(et.claveDeVale(impresa)));
  assert.ok(et.entradasEnLista(r, "GSM").has(et.claveDeVale(enSuLista)));
  assert.equal(et.registroParaLeer(estado, estado), estado);
});


test("formato 12: las marcas sin huella (del formato 11 anterior) se completan; las del otro se reconocen por id", () => {
  const { estado: dlta, renglon } = preparar();
  const vale = entrada(dlta, [{ existencia: renglon(701, "6309-2Z/C3"), cantidad: "1" }]);
  // Como quedó con la versión anterior del formato 11: marcas y origen sin `emitido_en`.
  dlta.formato = 11;
  dlta.impresiones_etiquetas = [
    { id: "DLTA-1", fecha_hora: "2026-10-08T10:00:00", vales: [{ inventario: "DLTA", vale_id: vale.id }, { inventario: "GSM", vale_id: 4 }] },
  ];
  dlta.etiquetas.material = [{ id: "DLTA-2", codigo: "701", inventario: "DLTA", origen: { tipo: "ENTRADA", inventario: "DLTA", vale_id: vale.id } }];
  migrarEstado(dlta);
  assert.equal(dlta.formato, 13);
  const [propia, ajena] = dlta.impresiones_etiquetas[0].vales;
  assert.equal(propia.emitido_en, vale.emitido_en);
  assert.equal(ajena.emitido_en, undefined); // la completa GSM al abrirse
  assert.equal(dlta.etiquetas.material[0].origen.emitido_en, vale.emitido_en);
  // La de GSM sin huella se reconoce por su id mientras tanto.
  assert.ok(et.marcaDe(et.impresionesPorVale(dlta, "GSM"), { id: 4, emitido_en: "2026-10-01T08:00:00" }));
  assert.ok(et.marcaDe(et.impresionesPorVale(dlta), vale));
  // Al juntar las dos copias de la misma impresión se queda la marca con huella.
  const deGsm = [{ id: "DLTA-1", fecha_hora: "2026-10-08T10:00:00", vales: [{ inventario: "DLTA", vale_id: vale.id }, { inventario: "GSM", vale_id: 4, emitido_en: "2026-10-01T08:00:00" }] }];
  const [junta] = et.juntarImpresiones(dlta.impresiones_etiquetas, deGsm);
  assert.deepEqual(junta.vales.map((m) => m.emitido_en), [vale.emitido_en, "2026-10-01T08:00:00"]);
  assert.equal(et.marcaDe(et.impresionesPorVale({ ...dlta, impresiones_etiquetas: [junta] }, "GSM"), { id: 4, emitido_en: "2026-10-02T08:00:00" }), undefined);
});
