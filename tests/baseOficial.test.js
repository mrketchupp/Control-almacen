// Base oficial (Ronda 24): el conteo de la auditoría REEMPLAZA lo inventariable. Lo idéntico se conserva (con
// su NP); lo demás sale del Kardex; lo que no quedó se da de baja y queda en las listas de revisión.
// Kardex SINTÉTICO (tests/fixtures/generar.py, generar_kardex): hojas FX, GSM y PRINCIPAL. DLTA usa el
// inventario sintético de siempre; GSM el suyo (códigos de 4 dígitos).

import assert from "node:assert/strict";
import { test } from "node:test";
import { nombreFx } from "../src/almacen/almacen.js";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { leerReporteAx } from "../src/importadores/ax.js";
import { leerInventario } from "../src/importadores/inventario.js";
import { decTexto } from "../src/nucleo/decimal.js";
import { FORMATO_ESTADO, Indices, migrarEstado } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { DUENO_FX, soloConsumible } from "../src/nucleo/inventarios.js";
import * as b from "../src/servicios/baseOficial.js";
import { conciliar, fisicoPorVariante } from "../src/servicios/conciliacion.js";
import { historialConteos } from "../src/servicios/conteos.js";
import { filasInventario } from "../src/servicios/consultas.js";
import { estadoAlCierre } from "../src/servicios/corte.js";
import { ubicacionesSugeridas } from "../src/servicios/inventario.js";
import { hojaParaConciliar, marcaDeHoja } from "../src/servicios/kardex.js";
import * as v from "../src/servicios/vales.js";
import { NOMBRE_KARDEX, bytesInventarioGsm, bytesKardex, cargaSintetica, cargaSinteticaGsm } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const FECHA = "2026-10-26";
const tablaDe = (reporte, hoja) => reporte.tablas.find((t) => t.hoja === hoja);

/** El usuario relacionó las hojas: en DLTA la PRINCIPAL; en GSM la de GSM y (si se pide) la de FX. */
function preparar(inventario = "DLTA", { conFx = true } = {}) {
  const { estado } = inventario === "GSM" ? cargaSinteticaGsm() : cargaSintetica();
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  const hojas =
    inventario === "GSM"
      ? [{ hoja: "GSM", uso: "propio", tabla: tablaDe(reporte, "GSM") }, ...(conFx ? [{ hoja: "FX", uso: DUENO_FX, tabla: tablaDe(reporte, "FX") }] : [])]
      : [{ hoja: "PRINCIPAL", uso: "propio", tabla: tablaDe(reporte, "PRINCIPAL") }];
  const indices = () => new Indices(estado);
  const ubicacion = (texto) => estado.ubicaciones.find((u) => u.hoja_excel.trim() === texto);
  const partidas = (codigo, dimension = undefined, { activas = true } = {}) =>
    estado.existencias.filter((e) => {
      const variante = indices().variante(e.variante_id);
      return (!activas || e.activo !== false) && variante.codigo === codigo && (dimension === undefined || (e.dimension_hoja ?? variante.dimension ?? "") === dimension);
    });
  const total = (e) => decTexto(calcularSaldos(estado, [e.id]).get(e.id).total);
  const plan = (decisiones = {}) => b.planBaseOficial(estado, b.analizarKardex(estado, hojas, { fecha: FECHA }), decisiones);
  const aplicar = (decisiones = {}, opciones = {}) => b.aplicarBaseOficial(estado, { hojas, fecha: FECHA, decisiones, archivo: NOMBRE_KARDEX, huella: "kardex", ...opciones }, USUARIO);
  const salida = (existenciaId, cantidad, fecha) => {
    const mecanico = estado.plantillas_area.find((x) => x.nombre === "MECANICO");
    const borrador = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha });
    borrador.lineas.push({ ...v.lineaDesdeExistencia(estado, existenciaId), cantidad });
    return v.emitirBorrador(estado, borrador.id, { usuario: USUARIO })[0];
  };
  return { estado, reporte, hojas, ubicacion, partidas, total, plan, aplicar, salida };
}

test("el lector toma todas las hojas del libro, con Conteo (o Conteo Fisico), Contenedor y Sitio", () => {
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  assert.equal(reporte.fechaSugerida, FECHA);
  assert.deepEqual(
    reporte.tablas.map((t) => [t.hoja, t.renglones.length, t.conConteo]),
    [
      ["FX", 4, true],
      ["GSM", 11, true],
      ["PRINCIPAL", 13, true],
    ],
  );
  const r = tablaDe(reporte, "PRINCIPAL").renglones.find((x) => x.codigo === 707);
  assert.deepEqual([r.conteo, r.contenedor, r.disponible, r.cantidad_financiera, r.sitio], ["3", "1", "4", "4", "SITIO-P"]);
  assert.equal(b.contenedorDe("#3"), 3);
  assert.equal(b.contenedorDe("0"), null);
  assert.equal(decTexto(b.costoUnitario(r)), "1500");
  // La conciliación propone la hoja por su nombre (sin revisar códigos); la de DLTA no dice su nombre.
  assert.deepEqual(reporte.tablas.map(marcaDeHoja), [DUENO_FX, "GSM", null]);
  assert.equal(hojaParaConciliar(reporte, "DLTA"), "PRINCIPAL");
  assert.equal(hojaParaConciliar(reporte, "GSM"), "GSM");
});

test("regla de códigos: en GSM y FX los de 3 dígitos son consumibles; en DLTA no aplica", () => {
  assert.deepEqual([soloConsumible("GSM", 101), soloConsumible("GSM", 1701), soloConsumible("DLTA", 101)], [true, false, false]);
  const { estado } = cargaSinteticaGsm();
  // Al dar de alta material de 3 dígitos, las hojas inventariables van al final de las sugerencias.
  const sugeridas = ubicacionesSugeridas(estado, 102).map((x) => x.ubicacion.clase);
  assert.deepEqual(sugeridas.slice(-2), ["INV", "INV"]);
  // Y el Kardex no aplica sus partidas de 3 dígitos (se quedan en consumible).
  const { plan } = preparar("GSM");
  assert.deepEqual(plan().porRegla.map((l) => l.codigo), [101]);
});

test("DLTA: lo idéntico se conserva, lo demás sale del Kardex y lo que no quedó se da de baja con sus listas", () => {
  const { plan } = preparar("DLTA");
  const p = plan();
  const texto = (x) => `${x.codigo} ${x.dimension || "SIN DIMENSIÓN"}${x.np ? ` NP ${x.np}` : ""} ${x.lugar}`;
  assert.deepEqual(
    p.conservadas.map((c) => [texto(c), decTexto(c.actual), decTexto(c.cantidad)]),
    [
      ["701 6205-2Z #1 Inv.", "6", "6"],
      ['707 MARIPOSA 4" #1 Inv.', "4", "3"], // AX corta el Tamaño a 10: sigue siendo idéntica
      ["701 6309-2Z/C3 #1 Inv.", "7", "9"], // estaba en #1 y #2: queda la del contenedor que anotó el conteo
      ["711 MOD:A1 #2 Inv.", "2", "2"],
      ["710 S/D NP X00489 #1 Inv.", "0", "0"],
    ],
  );
  assert.deepEqual(
    p.nuevas.map((n) => [`${n.codigo} ${n.dimension || "SIN DIMENSIÓN"}`, n.lugar, decTexto(n.cantidad), n.um, n.junta]),
    [
      ["703 1/2 X 2", "#2 Inv.", "8", "PZA", 0],
      ["712 6303 SKF", "#1 Inv.", "1", "PZA", 0],
      ["709 CABLE 3/4", "", "40", "MTS", 0], // contenedor 6 (no existe): hay que elegir
      ["714 MODELO ZX100", "#2 Inv.", "7", "PZA", 0], // se escribe distinto: no se pregunta, sale del Kardex
      ["711 SIN DIMENSIÓN", "#2 Inv.", "6", "PZA", 3], // AX cuenta juntas las 3 sin dimensión (distintos NP)
      ["705 3/4 ALTA PRES", "#2 Inv.", "2", "MTS", 0], // "m" de AX → "MTS" como en el inventario
    ],
  );
  assert.deepEqual(p.errores.map((e) => e.clave), ["n:PRINCIPAL#8"]);
  assert.deepEqual(p.sustituidas.map(texto), ["701 6309-2Z/C3 #2 Inv.", "711 S/D NP LED 20W #2 Inv.", "711 SIN DIMENSION NP LED 50W #2 Inv.", "711 S/N NP X100 #2 Inv.", "714 MOD:ZX100 #2 Inv.", "714 S/D #2 Inv."]);
  assert.deepEqual(p.retiradas.map(texto), ["706 555001 #1 Inv.", "799 SIN DIMENSION #2 Inv."]);
  // Listas para revisar: los NP que se pierden (con lo que los reemplaza) y lo que no viene en el Kardex.
  assert.deepEqual(
    p.listaNp.map((x) => [x.np, x.reemplazo]),
    [
      ["LED 20W", "SIN DIMENSIÓN · #2 Inv. · 6"],
      ["LED 50W", "SIN DIMENSIÓN · #2 Inv. · 6"],
      ["X100", "SIN DIMENSIÓN · #2 Inv. · 6"],
    ],
  );
  assert.deepEqual(p.listaRetiradas.map((x) => [x.codigo, x.cantidad]), [
    [706, "1"],
    [799, "1"],
  ]);
  // Lo consumible no se toca; el diésel (NO INV) no se da de alta.
  assert.deepEqual(p.soloConsumible.map((s) => [s.linea.codigo, s.partidas[0].lugar]), [[702, "#1 Cons."]]);
  assert.deepEqual(p.ignoradas.map((i) => i.linea.codigo), [136]);
  // Por código: lo que había y lo que queda (para revisar el impacto).
  const r714 = p.porCodigo.find((f) => f.codigo === 714);
  assert.deepEqual([decTexto(r714.antes), decTexto(r714.despues), decTexto(r714.impacto)], ["8", "7", "-45"]);
});

test("DLTA: aplicar deja el inventario como el Kardex; aplicar otra vez no cambia nada", () => {
  const { estado, ubicacion, partidas, total, plan, aplicar, salida } = preparar("DLTA");
  // Un vale del 27 (después del conteo) sobre la partida del #2 que el Kardex sustituye: pasa a la del #1.
  const [p6309c2] = partidas(701, "6309-2Z/C3").filter((e) => e.ubicacion_id === ubicacion("CONTENEDOR #2 INVENTARIABLE").id);
  const vale = salida(p6309c2.id, "1", "2026-10-27");
  assert.throws(() => aplicar(), (e) => e instanceof b.ErrorBaseOficial && e.errores.length === 1); // falta el contenedor del 709
  const c2 = ubicacion("CONTENEDOR #2 INVENTARIABLE");
  const { conteo, corteAx } = aplicar({ ubicaciones: { "n:PRINCIPAL#8": c2.id } });

  assert.equal(conteo.tipo, "AUDITORIA");
  assert.equal(conteo.ultimo_folio_salida, vale.folio - 1); // el del 27 no estaba en el conteo
  const [p6309] = partidas(701, "6309-2Z/C3");
  assert.deepEqual([partidas(701, "6309-2Z/C3").length, total(p6309)], [1, "8"]); // 9 contados − 1 del vale del 27
  assert.equal(vale.lineas[0].existencia_id, p6309.id);
  assert.deepEqual(conteo.religadas.map((r) => [r.de, r.a]), [[p6309c2.id, p6309.id]]);
  assert.equal(p6309c2.activo, false);
  assert.match(p6309c2.baja.motivo, /^Sustituida por el conteo de auditoría/);
  // Las botoneras (711 sin dimensión): una partida con el total; las tres de antes, de baja.
  const r711 = partidas(711).map((e) => [new Indices(estado).variante(e.variante_id).dimension ?? "", total(e)]);
  assert.deepEqual(r711.sort(), [["", "6"], ["MOD:A1", "2"]]);
  assert.deepEqual(partidas(714).map((e) => [new Indices(estado).variante(e.variante_id).dimension, total(e)]), [["MODELO ZX100", "7"]]);
  assert.deepEqual(partidas(709).map((e) => [e.ubicacion_id, total(e)]), [[c2.id, "40"]]);
  assert.equal(estado.articulos[712].origen, "AUDITORIA");
  // Lo que no viene en el Kardex sale del inventario y del Excel, pero sigue en el historial del conteo.
  assert.equal(partidas(799).length, 0);
  assert.ok(!filasInventario(estado).some((f) => f.codigo === 799));
  assert.match(partidas(799, undefined, { activas: false })[0].baja.motivo, /^No viene en el conteo de auditoría/);
  // Las listas quedan guardadas para imprimirlas después; los NP sirven de sugerencia al anotarlos.
  const [listas] = b.listasDeRevision(estado);
  assert.deepEqual([listas.np.length, listas.retiradas.length], [3, 2]);
  assert.deepEqual(b.npAnteriores(estado, 711).map((x) => x.np), ["LED 20W", "LED 50W", "X100"]);
  assert.equal(historialConteos(estado)[0].descripcion.startsWith("Conteo de auditoría (base oficial)"), true);
  assert.deepEqual([corteAx.fecha, corteAx.hoja, corteAx.lineas.length], [FECHA, "PRINCIPAL", 13]);
  assert.equal(estado.auditoria.at(-1).accion, "BASE_OFICIAL");

  // Otra vez el mismo Kardex: todo se conserva y el reporte de AX no se repite.
  const otra = plan();
  assert.deepEqual([otra.nuevas.length, otra.sustituidas.length, otra.retiradas.length, otra.errores.length], [0, 0, 0, 0]);
  assert.equal(aplicar().corteAx, null);
  assert.equal(estado.cortes_ax.length, 1);
});

test("lo que no viene en el Kardex pero tiene vales después del conteo no se da de baja", () => {
  const { partidas, plan, salida } = preparar("DLTA");
  const [r706] = partidas(706);
  salida(r706.id, "1", "2026-10-28");
  const p = plan();
  assert.deepEqual(p.sinRetirar.map((s) => s.codigo), [706]);
  assert.equal(p.avisos.length, 1);
});

test("GSM: la hoja de FX marca lo suyo, las botoneras quedan en una partida y lo de 3 dígitos no se toca", () => {
  const { estado, partidas, total, aplicar, plan } = preparar("GSM");
  const p = plan();
  assert.equal(p.errores.length, 0);
  assert.deepEqual(p.soloConsumible.map((s) => s.linea.codigo), [1702]);
  aplicar();
  // 6205-2Z: el físico tenía GSM y FX juntos; GSM se queda la partida y FX tiene la suya.
  assert.deepEqual(partidas(1701, "6205-2Z").map((e) => [e.dueno ?? null, total(e)]), [
    [null, "4"],
    [DUENO_FX, "2"],
  ]);
  assert.deepEqual(partidas(1707).map((e) => e.dueno), [DUENO_FX]);
  assert.deepEqual(partidas(1703).map((e) => [e.dueno, total(e)]), [[DUENO_FX, "3"]]);
  assert.deepEqual(partidas(1730).map((e) => [new Indices(estado).variante(e.variante_id).np ?? "", total(e)]), [["", "5"]]);
  assert.deepEqual(b.listasDeRevision(estado)[0].np.map((x) => x.np), ["NP-100", "NP-200", "NP-300"]);
  assert.deepEqual(partidas(101).map(total), ["25"]); // 3 dígitos: consumible, sin tocar
  assert.deepEqual(filasInventario(estado).filter((f) => f.dueno === DUENO_FX).map((f) => f.codigo).sort(), [1701, 1703, 1707, 1742]);

  // El Excel de GSM sale sin FX y el de FX solo con lo suyo (misma plantilla).
  const leer = (dueno) =>
    leerInventario(exportarInventario(estado, bytesInventarioGsm(), { fecha: "2026-10-28", dueno }).datos, "x.xlsx").hojas.flatMap((h) => h.renglones.map((r) => `${r.codigo} ${r.dimension ?? ""}`.trim()));
  assert.deepEqual(leer(DUENO_FX).sort(), ["1701 6205-2Z", "1703 1/2 X 2", '1707 MARIPOSA 4"', "1742"].sort());
  const gsm = leer(null);
  assert.ok(gsm.includes("1701 6205-2Z") && !gsm.includes('1707 MARIPOSA 4"') && !gsm.includes("1799 SIN DIMENSION"));
  assert.equal(nombreFx("INVENTARIO DE REFACCIONAMIENTO DE ALMACEN 281026.xlsx"), "INVENTARIO DE REFACCIONAMIENTO FX DE ALMACEN 281026.xlsx");

  // La conciliación de GSM no cuenta las partidas de FX.
  assert.equal(fisicoPorVariante(estado, { dueno: null }).has(partidas(1707)[0].variante_id), false);
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  const corte = { id: 1, fecha: FECHA, lineas: tablaDe(reporte, "GSM").renglones.map((r, i) => ({ id: i + 1, ...r })), asignaciones: [] };
  const fila = conciliar(estado, corte).renglones.find((x) => x.codigo === 1701 && x.variante.dimension === "6205-2Z");
  assert.equal(decTexto(fila.fisico), "4");

  // Otra vez: todo se conserva.
  const otra = plan();
  assert.deepEqual([otra.nuevas.length, otra.sustituidas.length, otra.retiradas.length], [0, 0, 0]);
});

test("casos del Kardex real (datos inventados): dos escrituras, Color S/N y FX sin dimensión; aplicar dos veces no cambia nada", () => {
  const { estado, partidas, total, aplicar, plan } = preparar("GSM");
  const p = plan();
  const conservadas = p.conservadas.filter((c) => c.codigo === 1740).map((c) => [c.dimension, c.np, decTexto(c.cantidad)]);
  // AX trae la misma pieza como "RX100 AB" y como "RX100AB": cada partida se queda con la suya (y su NP).
  assert.deepEqual(conservadas.sort(), [
    ["RX100 AB", "NP-77", "3"],
    ["RX100AB", "", "5"],
  ]);
  aplicar();
  const clave = (e) => {
    const v = new Indices(estado).variante(e.variante_id);
    return [e.dimension_hoja ?? v.dimension ?? "", e.dueno ?? null, total(e)];
  };
  // Color "S/N": la partida nueva se escribe como AX y la siguiente vez ya es la idéntica.
  assert.deepEqual(partidas(1741).map(clave), [["3UX4455K S/N", null, "1"]]);
  // FX cuenta el código completo sin dimensión: tiene su partida y no toma las de GSM.
  assert.deepEqual(partidas(1742).map(clave).sort(), [
    ["", DUENO_FX, "4"],
    ["M-100", null, "2"],
    ["M-200", null, "1"],
  ]);
  const otra = plan();
  assert.deepEqual([otra.nuevas.length, otra.sustituidas.length, otra.retiradas.length, otra.resumen.conservadasCambian], [0, 0, 0, 0]);
});

test("GSM sin la hoja de FX: lo que ya es de FX no se toca", () => {
  const a = preparar("GSM");
  a.aplicar();
  const conGsm = preparar("GSM", { conFx: false });
  // Mismo estado ya aplicado, ahora solo con la hoja de GSM.
  const p = b.planBaseOficial(a.estado, b.analizarKardex(a.estado, conGsm.hojas, { fecha: FECHA }), {});
  assert.ok(![...p.sustituidas, ...p.retiradas].some((x) => x.dueno_antes === DUENO_FX));
});

test("formato 18: los estados anteriores no tienen partidas de FX ni de baja", () => {
  const { estado } = cargaSintetica();
  estado.formato = 17;
  migrarEstado(estado);
  assert.equal(estado.formato, FORMATO_ESTADO);
  assert.ok(estado.existencias.every((e) => !e.dueno && e.activo !== false));
});

test("el reporte de un día anterior a la auditoría deshace sus cambios (cantidades, FX, bajas y nuevas)", () => {
  const { estado, partidas, aplicar } = preparar("GSM");
  const antes = structuredClone(estado.existencias);
  aplicar();
  assert.ok(estado.existencias.some((e) => e.dueno === DUENO_FX));
  const { estado: cierre } = estadoAlCierre(estado, "2026-10-25");
  const ver = (e) => [e.id, e.cantidad_conteo, e.conteo_id, e.dueno ?? null, e.activo ?? null, e.baja ?? null];
  assert.deepEqual(cierre.existencias.map(ver), antes.map(ver));
  assert.equal(partidas(1707)[0].dueno, DUENO_FX); // el estado actual no cambia
});
