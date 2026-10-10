import assert from "node:assert/strict";
import { test } from "node:test";
import { Indices, migrarEstado, siguienteId } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { conciliar, registrarCorteAx } from "../src/servicios/conciliacion.js";
import { corregirYVincularFisico, preverVinculoCorregido } from "../src/servicios/correccionAx.js";
import { corregirUnidadInventario } from "../src/servicios/unidadesAx.js";
import { datosCorreccion, deshacerCorreccion } from "../src/servicios/deshacerCorreccion.js";
import { asignarVales, candidatos } from "../src/servicios/justificacion.js";
import { valesPorAplicar, exportarSolicitudAjuste, HOJA_VALES } from "../src/exportadores/ajuste.js";
import { registrarSeguimiento } from "../src/servicios/seguimiento.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { lineaDesdeExistencia } from "../src/servicios/vales.js";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { escenarioGruposAx } from "./ayudaGruposAx.js";

const escenario = () => escenarioGruposAx(undefined, { segundaUm: "CJA", segundaDimension: "MODELO SINTETICO", lineas: (l) => [l("150VA", "26"), l("100VA", "4")] });
const datos = (e, opciones = {}) => ({ corteId: e.corte.id, lineaIds: [1], varianteIds: [e.uno.v.id, e.dos.v.id],
  corregirClaves: true, corregirUnidades: true, equivalencias: { [e.uno.v.id]: { origen: "1", destino: "1" }, [e.dos.v.id]: { origen: "1", destino: "12" } }, ...opciones });
const fila = (e, corte = e.corte) => conciliar(e.estado, corte).renglones.find((f) => f.lineas.some((l) => l.tamano === "150VA"));
function vale(e, cantidad, um = "CJA", fecha = "2026-09-06") {
  const v = { id: siguienteId(e.estado, "vale"), folio: siguienteId(e.estado, "vale_linea"), tipo: "SALIDA", estado: "EMITIDO", fecha,
    lineas: [{ id: e.estado.secuencias.vale_linea, existencia_id: e.dos.e.id, variante_id: e.dos.e.variante_id, codigo: e.codigo, clave: "MODELO SINTETICO", cantidad, um }] };
  e.estado.vales.push(v); return v;
}

test("corregir unidad y dimensión persiste y el siguiente corte concilia automáticamente sin vínculo", () => {
  const e = escenario(), antes = JSON.stringify(e.estado);
  const p = preverVinculoCorregido(e.estado, datos(e));
  assert.equal(JSON.stringify(e.estado), antes);
  assert.deepEqual([p.propuestas[1].ahora.cantidad.toFixed(), p.propuestas[1].ahora.um, p.propuestas[1].quedara.cantidad.toFixed(), p.propuestas[1].quedara.um], ["2", "CJA", "24", "PZA"]);
  assert.deepEqual([p.etiquetas, p.comparacion.fisico.toFixed(), p.comparacion.estado], [1, "26", "cuadra"]);
  corregirYVincularFisico(e.estado, datos(e), "PERSONA SINTETICA");
  const v = new Indices(e.estado).variante(e.dos.e.variante_id);
  assert.deepEqual([v.dimension, v.np, v.um, e.dos.e.cantidad_conteo], ["150VA", "NP-SINTETICO-B", "PZA", "24"]);
  assert.deepEqual(e.dos.e.conversiones_um[0].equivalencia, { origen: "1", destino: "12" });
  assert.equal(e.estado.etiquetas.material.length, 1);
  assert.equal(e.estado.etiquetas.material[0].descripcion, "UM: PZA");
  const siguiente = registrarCorteAx(e.estado, { fecha: "2026-09-10", almacen: "ALMACEN SINTETICO", renglones: [e.linea("150VA", "26"), e.linea("100VA", "4")] });
  assert.deepEqual(siguiente.vinculos_fisicos, []);
  assert.deepEqual([fila(e, siguiente).fisico.toFixed(), fila(e, siguiente).estado], ["26", "cuadra"]);
  assert.equal(conciliar(e.estado, siguiente).porConfirmar.length, 0);
});

test("los movimientos anteriores se convierten sin editar vales; los nuevos usan la unidad corregida", () => {
  const e = escenario(), anterior = vale(e, "0.5"), originales = JSON.stringify(e.estado.vales);
  corregirYVincularFisico(e.estado, datos(e));
  assert.equal(JSON.stringify(e.estado.vales), originales);
  assert.deepEqual([fila(e).fisico.toFixed(), fila(e).salidas.toFixed(), fila(e).estado], ["20", "6", "explicada"]);
  const movimientos = valesPorAplicar(conciliar(e.estado, e.corte), e.corte);
  assert.deepEqual([movimientos[0].cantidad.toFixed(), movimientos[0].um], ["6", "PZA"]);
  assert.match(movimientos[0].como, /Vale original: 0.5 CJA/);
  const solicitud = new LibroLeido(exportarSolicitudAjuste(e.estado, e.corte).datos).hoja(HOJA_VALES);
  assert.equal(solicitud.valorRef("H2"), 6);
  assert.equal(solicitud.valorRef("I2"), "PZA");
  const nuevaLinea = lineaDesdeExistencia(e.estado, e.dos.e.id);
  assert.equal(nuevaLinea.um, "PZA");
  vale(e, "1", nuevaLinea.um);
  assert.deepEqual([calcularSaldos(e.estado).get(e.dos.e.id).total.toFixed(), fila(e).salidas.toFixed()], ["17", "7"]);
  assert.equal(anterior.lineas[0].cantidad, "0.5");
});

test("el pendiente parcial de la base se convierte y cuenta una sola vez", () => {
  const e = escenario(), v = vale(e, "1", "CJA", "2026-09-01");
  registrarSeguimiento(e.estado, { partidas: [{ folio: v.folio, codigo: e.codigo, clave: v.lineas[0].clave, cantidad: "1", um: "CJA", inv: "INV", mov: "CONSUMO", aplicada: "0.5", in: "IN00000999", tr: "" }] });
  const antes = JSON.stringify(e.estado.vales);
  corregirYVincularFisico(e.estado, datos(e));
  const r = conciliar(e.estado, e.corte), f = fila(e);
  assert.deepEqual([f.fisico.toFixed(), f.salidas.toFixed(), f.sin_explicar.toFixed()], ["14", "6", "-6"]);
  assert.equal(r.ax.porLinea.get(v.lineas[0].id).pendiente.toFixed(), "0.5");
  assert.equal(valesPorAplicar(r, e.corte)[0].cantidad.toFixed(), "6");
  assert.equal(JSON.stringify(e.estado.vales), antes);
});

test("una conversión inversa usa la fracción completa y deja 24 piezas como 2 cajas exactas", () => {
  const e = escenarioGruposAx();
  e.dos.e.cantidad_conteo = "24";
  const salida = vale(e, "12", "PZA");
  corregirUnidadInventario(e.estado, { existenciaId: e.dos.e.id, um: "CJA", equivalencia: { origen: "12", destino: "1" } });
  assert.equal(e.dos.e.cantidad_conteo, "2");
  assert.equal(calcularSaldos(e.estado).get(e.dos.e.id).total.toFixed(), "1");
  corregirUnidadInventario(e.estado, { existenciaId: e.dos.e.id, um: "PZA", equivalencia: { origen: "1", destino: "12" } });
  assert.equal(calcularSaldos(e.estado).get(e.dos.e.id).total.toFixed(), "12");
  assert.equal(new Indices(e.estado).variante(e.dos.e.variante_id).activo, true);
  assert.equal(salida.lineas[0].cantidad, "12");
});

test("una unidad mal anotada se corrige 1 = 1; el faltante real permanece y se preparan etiquetas", () => {
  const e = escenarioGruposAx(undefined, { segundaUm: "KG", lineas: (l) => [l("150VA", "5"), l("100VA", "4")] });
  const d = datos(e); d.equivalencias[e.dos.v.id].destino = "1";
  corregirYVincularFisico(e.estado, d);
  assert.deepEqual([fila(e).fisico.toFixed(), fila(e).sin_explicar.toFixed(), fila(e).estado], ["4", "-1", "faltante"]);
  assert.equal(e.estado.etiquetas.material.length, 1);
});

test("equivalencias incompletas, cero o negativas rechazan el lote entero sin cambios", () => {
  for (const eq of [undefined, { origen: "1", destino: "" }, { origen: "0", destino: "12" }, { origen: "1", destino: "-1" }, { origen: "abc", destino: "1" }]) {
    const e = escenario(), d = datos(e); d.equivalencias[e.dos.v.id] = eq;
    const antes = JSON.stringify(e.estado);
    assert.throws(() => corregirYVincularFisico(e.estado, d), /equivalencia mayor que cero/);
    assert.equal(JSON.stringify(e.estado), antes);
  }
});

test("la unidad puede corregirse conservando dimensión y NP, incluso si AX no tiene tamaño", () => {
  const e = escenario(); e.corte.lineas[0].tamano = "";
  const p = corregirYVincularFisico(e.estado, datos(e, { corregirClaves: false }));
  assert.equal(p.propuestas[1].quedara.dimension, "MODELO SINTETICO");
  assert.equal(p.propuestas[1].quedara.np, "NP-SINTETICO-B");
  assert.equal(e.estado.etiquetas.material.length, 1);
});

test("las asignaciones previas y posteriores a convertir justifican en la unidad vigente", () => {
  const e = escenario(), v = vale(e, "0.5", "CJA", "2026-09-01");
  const a = asignarVales(e.estado, { corteId: e.corte.id, destino: { linea_ax_id: 1 }, partidas: [{ partida_id: v.lineas[0].id, cantidad: "0.5" }] });
  corregirYVincularFisico(e.estado, datos(e));
  assert.equal(fila(e).salidas.toFixed(), "6");
  e.corte.asignaciones = [];
  const candidato = candidatos(e.estado, conciliar(e.estado, e.corte), fila(e)).find((p) => p.linea.id === v.lineas[0].id);
  assert.deepEqual([candidato.cantidad.toFixed(), candidato.um], ["6", "PZA"]);
  const nuevas = asignarVales(e.estado, { corteId: e.corte.id, destino: { linea_ax_id: 1 }, partidas: [{ partida_id: v.lineas[0].id, cantidad: "6" }] });
  assert.deepEqual([nuevas[0].cantidad, nuevas[0].cantidad_vale, fila(e).salidas.toFixed(), fila(e).estado], ["6", "0.5", "6", "explicada"]);
  assert.equal(a[0].cantidad_vale, "0.5");
});

test("los vales migrados sin partida ligada conservan su unidad original al asignar cantidades convertidas", () => {
  const e = escenario(), v = vale(e, "0.5", "CJA", "2026-09-01");
  v.lineas[0].existencia_id = null;
  e.dos.e.cantidad_conteo = "1.5";
  e.estado.conteos.push({ id: 1, fecha: "2026-09-03", ultimo_folio_salida: v.folio, ultimo_folio_entrada: 0 });
  e.dos.e.conteo_id = 1;
  corregirYVincularFisico(e.estado, datos(e));
  const asignadas = asignarVales(e.estado, { corteId: e.corte.id, destino: { linea_ax_id: 1 }, partidas: [{ partida_id: v.lineas[0].id, cantidad: "6" }] });
  assert.equal(asignadas[0].cantidad_vale, "0.5");
  assert.equal(asignadas[0].existencia_conversion_id, e.dos.e.id);
  assert.deepEqual([fila(e).fisico.toFixed(), fila(e).salidas.toFixed(), fila(e).estado], ["20", "6", "explicada"]);
  assert.equal(valesPorAplicar(conciliar(e.estado, e.corte), e.corte)[0].um, "PZA");
  assert.deepEqual([v.lineas[0].existencia_id, v.lineas[0].cantidad, v.lineas[0].um], [null, "0.5", "CJA"]);
});

test("Deshacer restaura cantidades y unidades y se protege si hay un vale posterior o editado", () => {
  const e = escenario(); vale(e, "0.5");
  const antes = datosCorreccion(e.estado), originales = JSON.stringify(e.estado.vales);
  corregirYVincularFisico(e.estado, datos(e));
  const despues = datosCorreccion(e.estado);
  deshacerCorreccion(e.estado, antes, despues);
  assert.deepEqual(datosCorreccion(e.estado), antes);
  assert.equal(JSON.stringify(e.estado.vales), originales);
  for (const editar of [false, true]) {
    const otro = escenario(); const v = vale(otro, "0.5"), a = datosCorreccion(otro.estado);
    corregirYVincularFisico(otro.estado, datos(otro)); const d = datosCorreccion(otro.estado);
    if (editar) v.lineas[0].cantidad = "1"; else vale(otro, "1", "PZA");
    const actual = JSON.stringify(otro.estado);
    assert.throws(() => deshacerCorreccion(otro.estado, a, d), /registraron o editaron vales/);
    assert.equal(JSON.stringify(otro.estado), actual);
  }
  const contado = escenario(), a = datosCorreccion(contado.estado);
  corregirYVincularFisico(contado.estado, datos(contado)); const d = datosCorreccion(contado.estado);
  contado.dos.e.conteo_id = 99;
  const actual = JSON.stringify(contado.estado);
  assert.throws(() => deshacerCorreccion(contado.estado, a, d), /conteo posterior/);
  assert.equal(JSON.stringify(contado.estado), actual);
});

test("las equivalencias sobreviven al respaldo y la reapertura y los estados 15 migran sin cambiar el saldo", async () => {
  const e = escenario(); vale(e, "0.5"); corregirYVincularFisico(e.estado, datos(e));
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar(); await almacen.cargarPrimeraVez(e.estado, []);
  const respaldo = await almacen.respaldo(), otro = new Almacen(new BackendMemoria()); await otro.iniciar(); await otro.restaurar(respaldo.datos);
  const reabierto = new Almacen(otro.backend); await reabierto.iniciar();
  assert.deepEqual([calcularSaldos(reabierto.estado).get(e.dos.e.id).total.toFixed(), fila({ ...e, estado: reabierto.estado }).estado], ["18", "explicada"]);
  assert.deepEqual(reabierto.estado.existencias.find((x) => x.id === e.dos.e.id).conversiones_um, e.dos.e.conversiones_um);
  const anterior = escenarioGruposAx(); anterior.estado.formato = 15;
  const saldos = [...calcularSaldos(anterior.estado)].map(([id, s]) => [id, s.total.toFixed()]); migrarEstado(anterior.estado);
  assert.deepEqual([...calcularSaldos(anterior.estado)].map(([id, s]) => [id, s.total.toFixed()]), saldos);
});
