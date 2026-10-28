// Base oficial: el conteo de la auditoría (Kardex con Conteo y Contenedor) como base oficial del inventario.
// Kardex SINTÉTICO (tests/fixtures/generar.py, generar_kardex): hojas FX, GSM y PRINCIPAL.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { leerReporteAx } from "../src/importadores/ax.js";
import { leerInventario } from "../src/importadores/inventario.js";
import { decTexto } from "../src/nucleo/decimal.js";
import { FORMATO_ESTADO, Indices, migrarEstado } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { DUENO_FX } from "../src/nucleo/inventarios.js";
import { nombreFx } from "../src/almacen/almacen.js";
import * as b from "../src/servicios/baseOficial.js";
import { conciliar, fisicoPorVariante } from "../src/servicios/conciliacion.js";
import { historialConteos } from "../src/servicios/conteos.js";
import { filasInventario } from "../src/servicios/consultas.js";
import { clasificarHojas, coincidencia, codigosDelInventario, hojaParaConciliar } from "../src/servicios/kardex.js";
import * as v from "../src/servicios/vales.js";
import { NOMBRE_KARDEX, bytesInventario, bytesKardex, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const FECHA = "2026-10-26";

function preparar(inventario = "DLTA") {
  const { estado } = cargaSintetica({ idInventario: inventario });
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  const hojas = clasificarHojas(estado, reporte.tablas);
  const indices = () => new Indices(estado);
  const ubicacion = (texto) => estado.ubicaciones.find((u) => u.hoja_excel.trim() === texto);
  const partidas = (codigo, dimension = undefined) =>
    estado.existencias.filter((e) => {
      const variante = indices().variante(e.variante_id);
      return variante.codigo === codigo && (dimension === undefined || (e.dimension_hoja ?? variante.dimension) === dimension);
    });
  const total = (e) => decTexto(calcularSaldos(estado, [e.id]).get(e.id).total);
  const plan = (decisiones = {}) => b.planBaseOficial(estado, b.analizarKardex(estado, hojas, { fecha: FECHA }), decisiones);
  const aplicar = (decisiones = {}, opciones = {}) => b.aplicarBaseOficial(estado, { hojas, fecha: FECHA, decisiones, archivo: NOMBRE_KARDEX, huella: "kardex", ...opciones }, USUARIO);
  return { estado, reporte, hojas, ubicacion, partidas, total, plan, aplicar };
}

test("el lector toma todas las hojas del libro, con Conteo (o Conteo Fisico), Contenedor y Sitio", () => {
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  assert.equal(reporte.fechaSugerida, FECHA);
  assert.deepEqual(
    reporte.tablas.map((t) => [t.hoja, t.renglones.length, t.conConteo]),
    [
      ["FX", 3, true],
      ["GSM", 3, true],
      ["PRINCIPAL", 13, true],
    ],
  );
  // La primera hoja sigue arriba (como antes) y es la de FX: por eso hay que elegir.
  assert.equal(reporte.hoja, "FX");
  const r = reporte.tablas[2].renglones.find((x) => x.codigo === 707);
  assert.deepEqual([r.conteo, r.contenedor, r.disponible, r.cantidad_financiera, r.sitio], ["3", "1", "4", "4", "SITIO-P"]);
  assert.equal(b.contenedorDe("#3"), 3);
  assert.equal(b.contenedorDe("0"), null);
  assert.equal(decTexto(b.costoUnitario(r)), "1500");
});

test("cada hoja se usa en su inventario: DLTA toma la que no dice nombre; GSM la de GSM y la de FX", () => {
  const dlta = preparar("DLTA").hojas.map((h) => [h.hoja, h.uso, h.motivo]);
  assert.deepEqual(dlta, [
    ["FX", null, "FX se lleva dentro de GSM"],
    ["GSM", null, "Es de GSM"],
    ["PRINCIPAL", "propio", ""],
  ]);
  const gsm = preparar("GSM").hojas.map((h) => [h.hoja, h.uso, h.motivo]);
  assert.deepEqual(gsm, [
    ["FX", DUENO_FX, ""],
    ["GSM", "propio", ""],
    ["PRINCIPAL", null, "Ya se usa la hoja GSM"],
  ]);
});

test("un Kardex de otro inventario (códigos que no están) no se usa y avisa antes de importar", () => {
  const { estado } = cargaSintetica();
  const ajena = { hoja: "rptInventSum", almacenes: [{ nombre: "RIG91-IX25", renglones: 3 }], renglones: [{ codigo: 9001 }, { codigo: 9002 }, { codigo: 701 }] };
  const c = coincidencia(ajena.renglones, codigosDelInventario(estado));
  assert.deepEqual([c.codigos, c.conocidos, c.ajenos], [3, 1, [9001, 9002]]);
  const [h] = clasificarHojas(estado, [ajena]);
  assert.equal(h.uso, null);
  assert.match(h.motivo, /Solo 1 de sus 3 códigos está en tu inventario DLTA/);
  // En Conciliación AX se elige la hoja y se avisa si casi no tiene códigos del inventario.
  const elegida = hojaParaConciliar(estado, { tablas: [ajena] });
  assert.equal(elegida.aviso, true);
  const kardex = hojaParaConciliar(estado, leerReporteAx(bytesKardex(), NOMBRE_KARDEX));
  assert.deepEqual([kardex.hoja, kardex.aviso], ["PRINCIPAL", false]);
});

test("vista previa en DLTA: cuadran, cambian, repetidas, nuevas, por confirmar y lo consumible no se toca", () => {
  const { plan } = preparar("DLTA");
  const p = plan();
  const porCodigo = (codigo) => p.grupos.filter((g) => g.lineas[0].codigo === codigo);
  // 701 6309-2Z/C3: 7 en #1 y 3 en #2, el conteo dice 9 (contenedor 1): queda en #1 y la de #2 se da de baja.
  const g = porCodigo(701).find((x) => x.lineas[0].tamano === "6309-2Z/C3");
  assert.deepEqual(
    g.partidas.map((x) => [x.lugar, decTexto(x.actual), decTexto(x.cantidad), x.baja]),
    [
      ["#1 Inv.", "7", "9", false],
      ["#2 Inv.", "3", "0", true],
    ],
  );
  assert.equal(g.revisar, true);
  // 707 MARIPOSA (Tamaño cortado a 10 en AX): 4 → 3.
  assert.deepEqual(porCodigo(707)[0].partidas.map((x) => decTexto(x.cantidad)), ["3"]);
  // 702 P557500 solo está en una hoja de consumible: no se toca.
  assert.deepEqual(p.soloConsumible.map((s) => [s.lineas[0].codigo, s.partidas[0].lugar]), [[702, "#1 Cons."]]);
  // 714 "MODELO ZX100" se escribe distinto (MOD:ZX100): por confirmar, con la sugerida por omisión (mismos
  // números). 705 "3/4 ALTA PRES" no se parece a ninguna de sus partidas: hay que elegir.
  assert.deepEqual(
    p.porConfirmar.map((x) => [x.linea.codigo, x.metodo, x.decision === null ? null : typeof x.decision]),
    [
      [714, "aproximado", "number"],
      [705, "sin_sugerencia", null],
    ],
  );
  // Nuevas: 703 en #2, 712 (no está en el catálogo) en #1 y 709 (contenedor 6, no existe): hay que elegir.
  assert.deepEqual(
    p.nuevas.map((n) => [n.codigo, n.lugar, decTexto(n.cantidad)]),
    [
      [703, "#2 Inv.", "8"],
      [712, "#1 Inv.", "1"],
      [709, "", "40"],
    ],
  );
  assert.deepEqual(
    p.errores.map((e) => e.clave),
    ["PRINCIPAL#14", "n:PRINCIPAL#8"],
  );
  assert.equal(p.resumen.porDecidir, 1);
  // El diésel (NO INV) no se da de alta; lo inventariable que el Kardex no trae se queda.
  assert.deepEqual(p.ignoradas.map((i) => i.linea.codigo), [136]);
  assert.deepEqual(p.sinKardex.map((s) => [s.codigo, s.decision]), [
    [706, "dejar"],
    [799, "dejar"],
    [714, "dejar"],
  ]);
  // Un reparto que no suma el conteo es un error.
  const mal = plan({ cantidades: { [g.partidas[1].clave]: "1" }, bajas: { [g.partidas[1].clave]: false } });
  assert.ok(mal.errores.some((e) => e.clave === g.clave && /el conteo es 9 y en las partidas suman 10/.test(e.mensaje)));
});

test("aplicar en DLTA: el conteo es la nueva CANTIDAD, con corte en el día; lo posterior se descuenta", () => {
  const { estado, ubicacion, partidas, total, aplicar, plan } = preparar("DLTA");
  // Un vale del 27 (después del conteo, antes de aplicar) sobre el 6205-2Z.
  const [r6205] = partidas(701, "6205-2Z");
  const mecanico = estado.plantillas_area.find((x) => x.nombre === "MECANICO");
  const borrador = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-27" });
  borrador.lineas.push({ ...v.lineaDesdeExistencia(estado, r6205.id), cantidad: "1" });
  const [vale] = v.emitirBorrador(estado, borrador.id, { usuario: USUARIO });
  const consumible = partidas(702, "P557500")[0];
  const antesConsumible = total(consumible);

  assert.throws(() => aplicar(), (e) => e instanceof b.ErrorBaseOficial && e.errores.length === 2); // 705 sin decidir y el contenedor del 709
  const c2 = ubicacion("CONTENEDOR #2 INVENTARIABLE");
  const sinKardex799 = plan().sinKardex.find((s) => s.codigo === 799);
  const { conteo, corteAx } = aplicar(
    { parejas: { "PRINCIPAL#14": "nueva" }, ubicaciones: { "n:PRINCIPAL#8": c2.id }, sinKardex: { [sinKardex799.existencia.id]: "baja" } },
    { registrarCorte: true },
  );

  assert.equal(conteo.tipo, "AUDITORIA");
  assert.equal(conteo.ultimo_folio_salida, vale.folio - 1); // el del 27 no estaba en el conteo
  assert.equal(total(r6205), "5"); // 6 contados − 1 del vale del 27
  assert.equal(total(partidas(707)[0]), "3");
  const [d1, d2] = partidas(701, "6309-2Z/C3");
  assert.deepEqual([total(d1), d2.activo, d2.baja.motivo], ["9", false, "Repetida: el conteo de auditoría quedó en #1 Inv."]);
  assert.equal(total(consumible), antesConsumible); // lo consumible no se toca
  // Nuevas: con su contenedor, el artículo nuevo y la variante como la escribe AX.
  assert.deepEqual(partidas(703).map((e) => [e.ubicacion_id, total(e)]), [[c2.id, "8"]]);
  assert.deepEqual(partidas(709).map((e) => [e.ubicacion_id, total(e)]), [[c2.id, "40"]]);
  // 705 "nueva": en la hoja inventariable del #2, con la UM como la escribe el inventario (MTS, no "m").
  const [r705] = partidas(705, "3/4 ALTA PRES");
  assert.deepEqual([r705.ubicacion_id, total(r705), new Indices(estado).variante(r705.variante_id).um], [c2.id, "2", "MTS"]);
  assert.equal(estado.articulos[712].origen, "AUDITORIA");
  // 714: la variante toma la escritura de AX.
  assert.equal(new Indices(estado).variante(partidas(714, "MODELO ZX100")[0].variante_id).dimension, "MODELO ZX100");
  // 799 "no existe": de baja y fuera del inventario (pero en el historial del conteo).
  assert.equal(partidas(799)[0].activo, false);
  assert.ok(!filasInventario(estado).some((f) => f.codigo === 799));
  assert.ok(conteo.bajas.includes(partidas(799)[0].id));
  assert.equal(historialConteos(estado)[0].descripcion.startsWith("Conteo de auditoría (base oficial)"), true);
  // El Disponible de AX como corte de ese día (para justificar faltantes en Conciliación AX).
  assert.deepEqual([corteAx.fecha, corteAx.hoja, corteAx.lineas.length], [FECHA, "PRINCIPAL", 13]);
  assert.equal(estado.auditoria.at(-1).accion, "BASE_OFICIAL");
});

test("una sugerencia con otros números no es segura: '0-500 PSI' no es '0-300 PSI'", () => {
  assert.equal(b.mismosNumeros({ tamano: "0-500 PSI", color: "" }, { dimension: "0 - 300 PSI", np: "SALIDA 1/2 NPT" }), false);
  assert.equal(b.mismosNumeros({ tamano: "0-500 PSI", color: "" }, { dimension: null, np: "0 - 500 PSI (SALIDA 1/2 NPT)" }), true);
  assert.equal(b.mismosNumeros({ tamano: "MODELO ZX100", color: "" }, { dimension: "MOD:ZX100", np: null }), true);
  // AX corta el Tamaño a 10 caracteres: el último número puede venir incompleto.
  assert.equal(b.mismosNumeros({ tamano: "1/2 X 1234", color: "" }, { dimension: '1/2" X 12345', np: null }), true);
});

test("una partida con vales posteriores al conteo no se puede dar de baja", () => {
  const { estado, partidas, plan } = preparar("DLTA");
  const [r706] = partidas(706);
  const mecanico = estado.plantillas_area.find((x) => x.nombre === "MECANICO");
  const borrador = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha: "2026-10-28" });
  borrador.lineas.push({ ...v.lineaDesdeExistencia(estado, r706.id), cantidad: "1" });
  v.emitirBorrador(estado, borrador.id, { usuario: USUARIO });
  const p = plan({ sinKardex: { [r706.id]: "baja" } });
  assert.ok(p.errores.some((e) => /tiene vales posteriores al conteo/.test(e.mensaje)));
});

test("elegir 'partida nueva' en lugar de la sugerida deja la otra sin tocar", () => {
  const { estado, partidas, aplicar } = preparar("DLTA");
  const c2 = estado.ubicaciones.find((u) => u.hoja_excel.trim() === "CONTENEDOR #2 INVENTARIABLE");
  aplicar({ parejas: { "PRINCIPAL#9": "nueva", "PRINCIPAL#14": "nueva" }, ubicaciones: { "n:PRINCIPAL#8": c2.id } });
  const indices = new Indices(estado);
  assert.deepEqual(
    partidas(714)
      .filter((e) => e.activo !== false)
      .map((e) => indices.variante(e.variante_id).dimension)
      .sort(),
    ["MODELO ZX100", "MOD:ZX100", "S/D"].sort(),
  );
});

test("GSM: lo que cuenta la hoja de FX queda como de FX; si el físico lo tenía junto, se separa", () => {
  const { estado, partidas, total, aplicar, plan } = preparar("GSM");
  const p = plan();
  assert.equal(p.errores.length, 0);
  aplicar();
  const r6205 = partidas(701, "6205-2Z");
  assert.deepEqual(r6205.map((e) => [e.dueno ?? null, total(e)]), [
    [null, "4"],
    [DUENO_FX, "2"],
  ]);
  assert.deepEqual(partidas(707).map((e) => e.dueno), [DUENO_FX]);
  assert.deepEqual(partidas(703).map((e) => [e.dueno, total(e)]), [[DUENO_FX, "3"]]);
  // 6309-2Z/C3: 7 + 3 = 10 = el conteo de GSM: se queda repartido en los dos contenedores.
  assert.deepEqual(partidas(701, "6309-2Z/C3").map(total), ["7", "3"]);
  // La lista del inventario lo marca.
  assert.deepEqual(filasInventario(estado).filter((f) => f.dueno === DUENO_FX).map((f) => f.codigo).sort(), [701, 703, 707]);

  // El Excel de GSM sale sin FX y el de FX solo con lo suyo (misma plantilla).
  const leer = (dueno) =>
    leerInventario(exportarInventario(estado, bytesInventario(), { fecha: "2026-10-28", dueno }).datos, "x.xlsx").hojas.flatMap((h) => h.renglones.map((r) => `${r.codigo} ${r.dimension ?? ""}`.trim()));
  const gsm = leer(null);
  const fx = leer(DUENO_FX);
  assert.deepEqual(fx.sort(), ["701 6205-2Z", "703 1/2 X 2", '707 MARIPOSA 4"'].sort());
  assert.ok(gsm.includes("701 6205-2Z") && !gsm.includes('707 MARIPOSA 4"') && !gsm.includes("703 1/2 X 2"));
  assert.equal(nombreFx("INVENTARIO DE REFACCIONAMIENTO DE ALMACEN 281026.xlsx"), "INVENTARIO DE REFACCIONAMIENTO FX DE ALMACEN 281026.xlsx");

  // La conciliación de GSM no cuenta las partidas de FX.
  const fisico = fisicoPorVariante(estado, { dueno: null });
  const v707 = partidas(707)[0].variante_id;
  assert.equal(fisico.has(v707), false);
  const reporte = leerReporteAx(bytesKardex(), NOMBRE_KARDEX);
  const corte = { id: 1, fecha: FECHA, lineas: reporte.tablas[1].renglones.map((r, i) => ({ id: i + 1, ...r })), asignaciones: [] };
  const r = conciliar(estado, corte);
  const fila = r.renglones.find((x) => x.codigo === 701 && x.variante.dimension === "6205-2Z");
  assert.equal(decTexto(fila.fisico), "4");
});

test("formato 18: los estados anteriores no tienen partidas de FX ni de baja", () => {
  const { estado } = cargaSintetica();
  estado.formato = 17;
  migrarEstado(estado);
  assert.equal(estado.formato, FORMATO_ESTADO);
  assert.ok(estado.existencias.every((e) => !e.dueno && e.activo !== false));
});

test("el reporte de un día anterior a la auditoría deshace sus cambios (cantidades, FX, bajas y nuevas)", async () => {
  const { estadoAlCierre } = await import("../src/servicios/corte.js");
  const { estado, partidas, aplicar } = preparar("GSM");
  const antes = structuredClone(estado.existencias);
  aplicar();
  assert.ok(estado.existencias.some((e) => e.dueno === DUENO_FX));
  const { estado: cierre } = estadoAlCierre(estado, "2026-10-25");
  assert.deepEqual(
    cierre.existencias.map((e) => [e.id, e.cantidad_conteo, e.conteo_id, e.dueno ?? null, e.activo]),
    antes.map((e) => [e.id, e.cantidad_conteo, e.conteo_id, e.dueno ?? null, e.activo]),
  );
  assert.equal(partidas(707)[0].dueno, DUENO_FX); // el estado actual no cambia
});
