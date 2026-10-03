// Reporte diario: libros como estaban al cierre de un día.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { renglonesDiario } from "../src/exportadores/vales.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import * as co from "../src/servicios/conteos.js";
import { estadoAlCierre, ultimoFolioAl } from "../src/servicios/corte.js";
import * as en from "../src/servicios/entradas.js";
import { reacomodar } from "../src/servicios/reacomodos.js";
import { reporteDelDia } from "../src/servicios/reporte.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function escenario() {
  const { estado } = cargaSintetica();
  const variante = (e) => estado.variantes.find((x) => x.id === e.variante_id);
  const [balero1] = estado.existencias.filter((e) => variante(e).codigo === 701);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const salida = (fecha, cantidad) => {
    const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha });
    b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero1.id), cantidad });
    return v.emitirBorrador(estado, b.id, { usuario: USUARIO })[0];
  };
  const v1 = salida("2026-10-01", "1"); // folio 10
  // Entrada del 02: crea un renglón nuevo en otro contenedor.
  const c2cons = estado.ubicaciones.find((u) => u.hoja_excel.trim() === "CONTENEDOR #2 CONSUMIBLE");
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha: "2026-10-02" });
  Object.assign(b, { folio_externo: "B-1", origen: "BASE PRUEBA" });
  b.lineas = [en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701), cantidad: "4" }, { dimension: "7777", um: "PZA", ubicacionId: c2cons.id })];
  const entrada = en.confirmarEntrada(estado, b.id, { usuario: USUARIO });
  const v2 = salida("2026-10-03", "2"); // folio 11
  // Conteo del 03 y movimiento del 04.
  const c1inv = estado.ubicaciones.find((u) => u.hoja_excel.trim() === "CONTENEDOR #1 INVENTARIABLE");
  const d = co.iniciarConteo(estado, { ubicaciones: [c1inv.id], fecha: "2026-10-03" });
  co.guardarConteoEnCurso(estado, { ...d, capturas: { [balero1.id]: "3" } });
  co.aplicarConteo(estado, { corteAlAplicar: true });
  reacomodar(estado, { desdeId: balero1.id, ubicacionId: c2cons.id, cantidad: "1", fecha: "2026-10-04" });
  return { estado, balero1, v1, v2, entrada };
}

test("al cierre de un día: solo vales y entradas hasta ese día; conteos y movimientos posteriores se deshacen", () => {
  const { estado, balero1, v1, v2, entrada } = escenario();
  assert.equal(ultimoFolioAl(estado, "SALIDA", "2026-10-01"), v1.folio);
  assert.equal(ultimoFolioAl(estado, "ENTRADA", "2026-10-01"), 0);
  const antesDeTodo = cargaSintetica().estado;
  const cantidadOriginal = antesDeTodo.existencias.find((e) => e.id === balero1.id).cantidad_conteo;

  const al01 = estadoAlCierre(estado, "2026-10-01");
  assert.deepEqual([al01.salida, al01.entrada], [v1.folio, 0]);
  assert.ok(!al01.estado.vales.some((x) => x.id === v2.id || x.id === entrada.id));
  const renglon = al01.estado.existencias.find((e) => e.id === balero1.id);
  assert.equal(renglon.cantidad_conteo, cantidadOriginal);
  assert.equal(renglon.conteo_id, 1);
  assert.equal(calcularSaldos(al01.estado, [balero1.id]).get(balero1.id).consumo.toFixed(), "1");
  assert.ok(!al01.estado.existencias.some((e) => e.origen === "ENTRADA E-0001"));
  assert.equal(al01.estado.reacomodos.length, 0);
  // El estado real no cambia.
  assert.ok(estado.vales.some((x) => x.id === v2.id));

  const al02 = estadoAlCierre(estado, "2026-10-02");
  assert.deepEqual([al02.salida, al02.entrada], [v1.folio, 1]);
  assert.ok(al02.estado.existencias.some((e) => e.origen === "ENTRADA E-0001"));

  const al03 = estadoAlCierre(estado, "2026-10-03");
  assert.equal(al03.estado.existencias.find((e) => e.id === balero1.id).cantidad_conteo, "3");
  assert.equal(al03.estado.reacomodos.length, 0);
  const hoy = estadoAlCierre(estado, "2026-10-09");
  assert.equal(hoy.estado.reacomodos.length, 1);
});

test("los libros exportados al cierre no traen lo posterior", () => {
  const { estado, balero1, v1 } = escenario();
  const { estado: al01 } = estadoAlCierre(estado, "2026-10-01");
  const folios = new Set(renglonesDiario(al01).map(([vale]) => vale.folio));
  assert.equal(Math.max(...folios), v1.folio);
  const libro = new LibroLeido(exportarInventario(al01, bytesInventario()).datos);
  const hoja = libro.hoja("CONTENEDOR #1 INVENTARIABLE");
  let consumo = null;
  for (let r = 2; r <= hoja.maxFila; r++) if (hoja.valor(r, 2) === 701 && hoja.valor(r, 4) === "6309-2Z/C3") consumo = hoja.valor(r, 8);
  assert.equal(String(consumo), "1"); // solo el vale del 01
  const c2 = libro.hoja("CONTENEDOR #2 CONSUMIBLE");
  for (let r = 2; r <= c2.maxFila; r++) assert.notEqual(c2.valor(r, 4), "7777");
  assert.ok(balero1);
});

test("subir al SharePoint hasta el folio del día deja pendientes los posteriores", () => {
  const { estado, v1, v2 } = escenario();
  const reporte = reporteDelDia(estado, "2026-10-01");
  assert.deepEqual(reporte.porSubir.map((p) => p.vale.folio), [v1.folio]);
  assert.equal(reporte.despues, 1);
  v.registrarEnvio(estado, USUARIO, { hastaFolio: v1.folio });
  assert.deepEqual(v.valesPorEnviar(estado).map((p) => p.vale.folio), [v2.folio]);
  assert.equal(reporteDelDia(estado, "2026-10-01").porSubir.length, 0);
  v.registrarEnvio(estado, USUARIO);
  assert.equal(v.valesPorEnviar(estado).length, 0);
  // Corregir después un vale ya subido lo vuelve a poner pendiente.
  const datos = v.datosParaCorregir(estado, v1.id);
  datos.lineas[0].cantidad = "2";
  v.corregirVale(estado, v1.id, datos, "cantidad", USUARIO);
  assert.deepEqual(v.valesPorEnviar(estado).map((p) => p.vale.folio), [v1.folio]);
});
