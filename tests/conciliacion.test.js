// Fase 4: conciliación contra AX con un reporte SINTÉTICO (tests/fixtures/generar.py).

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarSolicitudAjuste, nombreSolicitud } from "../src/exportadores/ajuste.js";
import { ErrorReporteAx, delAlmacen, fechaDeNombre, leerReporteAx } from "../src/importadores/ax.js";
import * as c from "../src/servicios/conciliacion.js";
import * as en from "../src/servicios/entradas.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { NOMBRE_AX, bytesAx, bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function conCorte({ fecha = null, folioSalida = null } = {}) {
  const { estado } = cargaSintetica();
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const corte = c.registrarCorteAx(
    estado,
    { fecha: fecha ?? reporte.fechaSugerida, almacen: "RIG91-IX25", archivo: NOMBRE_AX, huella: "abc", folioSalida, renglones: delAlmacen(reporte.renglones, "RIG91-IX25") },
    USUARIO,
  );
  return { estado, corte };
}

const renglonDe = (r, codigo, dimension) => r.renglones.find((x) => x.codigo === codigo && x.variante.dimension === dimension);

test("importar el reporte de AX: columnas por nombre, almacenes, fecha del nombre y textos como vienen", () => {
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  assert.equal(reporte.hoja, "rptInventSumDateTransForDimensi");
  assert.equal(reporte.fechaSugerida, "2026-09-05");
  assert.deepEqual(reporte.almacenes, [
    { nombre: "RIG91-IX25", renglones: 13 },
    { nombre: "RIG48-XX10", renglones: 1 },
  ]);
  const propios = delAlmacen(reporte.renglones, "rig91-ix25");
  assert.equal(propios.length, 13);
  const [primero] = propios;
  assert.deepEqual([primero.codigo, primero.codigo_texto, primero.tamano, primero.disponible, primero.valor_financiero], [701, "000000701", "6309-2Z/C3", "9", "3150"]);
  assert.equal(propios.find((r) => r.codigo === 705).um, "m"); // tal cual (se normaliza al comparar)
  assert.throws(() => leerReporteAx(bytesInventario(), "INVENTARIO.xlsx"), ErrorReporteAx);
  assert.equal(fechaDeNombre("DELTA RIG 91 27-09-26.xlsx"), "2026-09-27");
  assert.equal(fechaDeNombre("DELTA RIG 91 27.09.2026.xlsx"), "2026-09-27");
  assert.equal(fechaDeNombre("DELTA RIG 91.xlsx"), null);
});

test("emparejamiento: exacto (Tamaño cortado a 10, NP en Color, 1/2\" ≠ 12, m = MTS), sugerencia y sin físico", () => {
  const { estado, corte } = conCorte();
  const pares = c.emparejar(estado, corte);
  const par = (codigo, tamano) => pares.find((p) => p.linea.codigo === codigo && p.linea.tamano === tamano);
  const variante = (p) => estado.variantes.find((v) => v.id === p.variante_id);
  assert.equal(par(707, "MARIPOSA 4").metodo, "exacto");
  assert.equal(variante(par(707, "MARIPOSA 4")).dimension, 'MARIPOSA 4"');
  assert.deepEqual([par(704, '6"').metodo, variante(par(704, '6"')).np], ["exacto", "FLEXITALIC"]);
  assert.equal(variante(par(705, '1/2"')).dimension, '1/2"');
  assert.equal(variante(par(705, "12")).dimension, "12");
  assert.equal(par(710, "S/D").metodo, "exacto");
  // Error de dedo: se sugiere y espera confirmación.
  const dedo = par(702, "P55I317");
  assert.equal(dedo.confirmado, false);
  assert.equal(variante(dedo).dimension, "P551317");
  assert.ok(dedo.puntaje >= c.PUNTAJE_SEGURO);
  assert.deepEqual([par(703, "1/2 X 2").metodo, par(709, "CABLE 3/4").metodo], ["sin_fisico", "sin_fisico"]);
});

test("criterio F4: ≥ 95% emparejado tras una sesión de confirmación y el segundo corte reutiliza las equivalencias", () => {
  const { estado, corte } = conCorte();
  const antes = c.conciliar(estado, corte).resumen;
  assert.ok(antes.porcentaje < 100);
  // Sesión: se confirman las sugerencias.
  for (const p of c.conciliar(estado, corte).porConfirmar) c.confirmarPareja(estado, p.linea, p.variante_id, USUARIO);
  const despues = c.conciliar(estado, corte).resumen;
  assert.ok(despues.porcentaje >= 95, `emparejado: ${despues.porcentaje}%`);
  assert.equal(despues.por_confirmar, 0);
  // Siguiente corte (otra fecha): el error de dedo ya sale por la memoria, sin preguntar.
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const segundo = c.registrarCorteAx(estado, { fecha: "2026-09-19", almacen: "RIG91-IX25", renglones: delAlmacen(reporte.renglones, "RIG91-IX25") }, USUARIO);
  const pares = c.emparejar(estado, segundo);
  assert.equal(pares.find((p) => p.linea.tamano === "P55I317").metodo, "equivalencia");
  assert.equal(c.conciliar(estado, segundo).resumen.por_confirmar, 0);
  // "No está en físico" también se recuerda; olvidar la deja otra vez a elección.
  const linea = segundo.lineas.find((l) => l.tamano === "P557500");
  c.confirmarPareja(estado, linea, null, USUARIO);
  assert.equal(c.emparejar(estado, segundo).find((p) => p.linea === linea).metodo, "sin_pareja");
  c.olvidarPareja(estado, linea, USUARIO);
  assert.equal(c.emparejar(estado, segundo).find((p) => p.linea === linea).metodo, "exacto");
  // Quitar un corte no borra lo aprendido.
  c.quitarCorteAx(estado, segundo.id, USUARIO);
  assert.equal(estado.cortes_ax.length, 1);
  assert.ok(Object.keys(estado.equivalencias_ax).length > 0);
});

test("cada diferencia muestra los folios que la explican o queda como sobrante / faltante (con su valor)", () => {
  const { estado, corte } = conCorte();
  const r = c.conciliar(estado, corte);
  // 705 1/2": AX 100, físico 98, el vale 9 (06-sep) va en tránsito → explicada.
  const manguera = renglonDe(r, 705, '1/2"');
  assert.deepEqual([manguera.estado, manguera.diferencia.toFixed(), manguera.salidas.toFixed(), manguera.folios], ["explicada", "-2", "2", ["9 (S)"]]);
  // 704 6" FLEXITALIC: renglón repetido en el físico (65 + 65) → sobrante de 65 con su valor.
  const empaque = renglonDe(r, 704, '6"');
  assert.deepEqual([empaque.estado, empaque.sin_explicar.toFixed(), empaque.valor.toFixed(2)], ["sobrante", "65", "2600.00"]);
  const lampara = renglonDe(r, 710, "S/D");
  assert.deepEqual([lampara.estado, lampara.sin_explicar.toFixed(), lampara.valor.toFixed(2)], ["faltante", "-2", "-150.00"]);
  assert.equal(renglonDe(r, 701, "6205-2Z").estado, "cuadra");
  // Listas separadas (RF-55).
  assert.deepEqual(r.fisicoSinAx.map((x) => x.codigo), [799]);
  assert.deepEqual(r.axSinFisico.map((x) => x.codigo).sort(), [703, 709]);
  // Por artículo y por contenedor.
  assert.equal(r.porCodigo.find((x) => x.codigo === 705).estado, "explicada");
  const c1 = r.porContenedor.find((x) => x.hoja === "CONTENEDOR #1 CONSUMIBLE");
  assert.equal(c1.renglones.filter((x) => x.codigo === 704).length, 2);
  // Con folio de corte: la base ya capturó hasta el 9 → ya no está en tránsito.
  c.fijarFolioCorte(estado, corte.id, 9, USUARIO);
  assert.equal(renglonDe(c.conciliar(estado, corte), 705, '1/2"').estado, "faltante");
  c.fijarFolioCorte(estado, corte.id, "", USUARIO);
  // Una entrada posterior al corte también explica (entra en tránsito).
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-09-10" });
  const balero = estado.existencias.find((e) => estado.variantes.find((v) => v.id === e.variante_id).dimension === "6205-2Z");
  Object.assign(b, { folio_externo: "B-1", origen: "BASE PRUEBA" });
  b.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id), cantidad: "2" }];
  en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const conEntrada = renglonDe(c.conciliar(estado, corte), 701, "6205-2Z");
  assert.deepEqual([conEntrada.estado, conEntrada.entradas.toFixed(), conEntrada.folios], ["explicada", "2", ["E-0001 (E)"]]);
});

test("solicitud de ajuste: las columnas del reporte AX + existencia física + folios; lo físico sin AX al final", () => {
  const { estado, corte } = conCorte();
  for (const p of c.conciliar(estado, corte).porConfirmar) c.confirmarPareja(estado, p.linea, p.variante_id, USUARIO);
  const { datos, nombre, renglones } = exportarSolicitudAjuste(estado, corte);
  assert.equal(nombre, "SOLICITUD DE AJUSTE RIG 91 050926.xlsx");
  assert.equal(nombreSolicitud("2026-09-27"), "SOLICITUD DE AJUSTE RIG 91 270926.xlsx");
  const hoja = new LibroLeido(datos).hoja("rptInventSumDateTransForDimensi");
  assert.deepEqual(hoja.fila(1, 1, 12), [
    "Código de Artículo", "Nombre del Artículo", "Modelo de Inventario", "Unidad de Medida", "Almacén", "Tamaño", "Color",
    "Disponible", "Valor Financiero", "Valor de Inventario", "Existencia física", "Folios que justifican",
  ]);
  const filas = [];
  for (let f = 2; f <= hoja.maxFila; f++) filas.push(hoja.fila(f, 1, 12));
  assert.equal(filas.length, renglones);
  const fila = (tamano) => filas.find((x) => x[5] === tamano);
  assert.equal(fila('1/2"')[0], "000000705"); // código como texto, con sus ceros
  assert.deepEqual([String(fila('1/2"')[7]), String(fila('1/2"')[10]), fila('1/2"')[11]], ["100", "98", "9 (S)"]);
  assert.equal(String(fila('6"')[10]), "130");
  assert.equal(fila("6205-2Z"), undefined); // cuadra: no va
  assert.equal(String(fila("CABLE 3/4")[10]), "0"); // en AX, no en físico
  const ultima = filas.at(-1); // físico sin AX
  assert.deepEqual([ultima[0], ultima[5], String(ultima[7]), String(ultima[10])], ["000000799", "SIN DIMENSION", "0", "1"]);
  // Con todos, también los que cuadran.
  assert.ok(exportarSolicitudAjuste(estado, corte, { todos: true }).renglones > renglones);
});

test("primer corte: los vales migrados entre la fecha de AX y el conteo cuentan como tránsito", () => {
  // Conteo de la primera carga hasta el folio 9 (07-sep); AX al 05-sep: el vale 9 (06-sep) quedó migrado
  // sin renglón ligado, pero la cantidad contada ya lo descuenta.
  const { estado } = cargaSintetica({ folioCorte: 9, fechaConteo: "2026-09-07" });
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const corte = c.registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "RIG91-IX25", renglones: delAlmacen(reporte.renglones, "RIG91-IX25") }, USUARIO);
  const vale9 = estado.vales.find((v) => v.folio === 9);
  assert.equal(vale9.lineas[0].existencia_id ?? null, null);
  const manguera = renglonDe(c.conciliar(estado, corte), 705, '1/2"');
  // Contado 100; AX 100 menos los 2 del vale 9 debía dar 98: sobran 2, y el folio 9 aparece.
  assert.deepEqual([manguera.salidas.toFixed(), manguera.folios, manguera.estado, manguera.sin_explicar.toFixed()], ["2", ["9 (S)"], "sobrante", "2"]);
});
