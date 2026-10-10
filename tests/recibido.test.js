// Ronda 22: los vales de entrada tienen dos fechas. La del vale (cuando la base lo envió) y la de recibido
// (cuando llegó y se registra): esta decide el día del inventario, el reporte diario, el inicio y el historial.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { crearRespaldo } from "../src/almacen/respaldos.js";
import { exportarEntradas } from "../src/exportadores/entradas.js";
import { exportarInventario } from "../src/exportadores/inventario.js";
import { FORMATO_ESTADO, migrarEstado } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { fechaDelDia, hoyIso, sumarDias } from "../src/nucleo/fechas.js";
import { enTransito } from "../src/servicios/conciliacion.js";
import { filasInventario, resumen } from "../src/servicios/consultas.js";
import * as co from "../src/servicios/conteos.js";
import { describirCorte, entradasAlCierre, estadoAlCierre, ultimoFolioAl } from "../src/servicios/corte.js";
import * as en from "../src/servicios/entradas.js";
import { reacomodar } from "../src/servicios/reacomodos.js";
import { reporteDelDia } from "../src/servicios/reporte.js";
import { bitacoraDeVale } from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function preparar() {
  const { estado } = cargaSintetica();
  const variante = (e) => estado.variantes.find((x) => x.id === e.variante_id);
  const ubicacion = (texto) => estado.ubicaciones.find((u) => u.hoja_excel.trim() === texto);
  const c1inv = ubicacion("CONTENEDOR #1 INVENTARIABLE");
  // El balero 6309-2Z/C3 del contenedor #1 inventariable (hay 7, contados el 03/09).
  const balero = estado.existencias.find((e) => variante(e).codigo === 701 && e.ubicacion_id === c1inv.id);
  return { estado, balero, ubicacion, c1inv };
}

const alRenglon = (estado, id, cantidad) => ({ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), id), cantidad });

function borrador(estado, lineas, { fecha, recibido, folio = "B-1" }) {
  const b = en.nuevoBorradorEntrada(estado, { usuario: USUARIO, fecha, fechaRecibido: recibido });
  Object.assign(b, { folio_externo: folio, origen: "BASE PRUEBA" });
  b.lineas = lineas;
  return b;
}

const entrada = (estado, lineas, opciones) => en.confirmarEntrada(estado, borrador(estado, lineas, opciones).id, { usuario: USUARIO });

const saldo = (estado, id, dia) => {
  const s = calcularSaldos(estado, [id], { dia }).get(id);
  return { cantidad: s.cantidad.toFixed(), ingreso: s.ingreso.toFixed(), total: s.total.toFixed() };
};

/** CANTIDAD (F), INGRESO (I) y TOTAL del renglón en el inventario exportado. */
function enInventario(estado, fecha, hoja, codigo, dimension) {
  const libro = new LibroLeido(exportarInventario(estado, bytesInventario(), { fecha }).datos);
  const h = libro.hoja(hoja);
  for (let r = 2; r <= h.maxFila; r++) {
    if (h.valor(r, 2) === codigo && String(h.valor(r, 4)) === dimension) return { cantidad: String(h.valor(r, 6)), ingreso: h.valor(r, 9) === null ? null : String(h.valor(r, 9)) };
  }
  return null;
}

test("fechaDelDia: recibido en las entradas (o su fecha si no la trae), la fecha en las salidas", () => {
  assert.equal(fechaDelDia({ tipo: "ENTRADA", fecha: "2026-10-01", fecha_recibido: "2026-10-03" }), "2026-10-03");
  assert.equal(fechaDelDia({ tipo: "ENTRADA", fecha: "2026-10-01" }), "2026-10-01");
  assert.equal(fechaDelDia({ tipo: "SALIDA", fecha: "2026-10-01", fecha_recibido: "2026-10-03" }), "2026-10-01");
  assert.equal(fechaDelDia(null), null);
});

test("el inventario del día suma la entrada el día en que se recibió, no el de su vale", () => {
  const { estado, balero } = preparar();
  const vale = entrada(estado, [alRenglon(estado, balero.id, "5")], { fecha: "2026-10-01", recibido: "2026-10-03" });
  assert.deepEqual([vale.fecha, vale.fecha_recibido], ["2026-10-01", "2026-10-03"]);
  // El día del vale no es el día del inventario.
  assert.deepEqual(saldo(estado, balero.id, "2026-10-03"), { cantidad: "7", ingreso: "5", total: "12" });
  assert.deepEqual(saldo(estado, balero.id, "2026-10-04"), { cantidad: "12", ingreso: "0", total: "12" });
  const fila = filasInventario(estado, { dia: "2026-10-03" }).find((f) => f.id === balero.id);
  assert.deepEqual([fila.cantidad, fila.ingreso, fila.total], [7, 5, 12]);
  // Al cierre del día del vale todavía no estaba; al cierre del día de recibido, sí, como INGRESO de ese día.
  const al01 = estadoAlCierre(estado, "2026-10-01").estado;
  assert.equal(calcularSaldos(al01, [balero.id]).get(balero.id).total.toFixed(), "7");
  assert.deepEqual(enInventario(al01, "2026-10-01", "CONTENEDOR #1 INVENTARIABLE", 701, "6309-2Z/C3"), { cantidad: "7", ingreso: null });
  const al03 = estadoAlCierre(estado, "2026-10-03").estado;
  assert.deepEqual(enInventario(al03, "2026-10-03", "CONTENEDOR #1 INVENTARIABLE", 701, "6309-2Z/C3"), { cantidad: "7", ingreso: "5" });
  const al04 = estadoAlCierre(estado, "2026-10-04").estado;
  assert.deepEqual(enInventario(al04, "2026-10-04", "CONTENEDOR #1 INVENTARIABLE", 701, "6309-2Z/C3"), { cantidad: "12", ingreso: null });
  // El reporte diario la lista el día que se recibió (con la fecha de su vale).
  assert.deepEqual(reporteDelDia(estado, "2026-10-01").entradas, []);
  const [listada] = reporteDelDia(estado, "2026-10-03").entradas;
  assert.deepEqual([listada.folio, listada.fecha_vale], ["E-0001", "2026-10-01"]);
});

test("inicio: las entradas de hoy son las recibidas hoy", () => {
  const { estado, balero } = preparar();
  const hoy = hoyIso();
  const ayer = sumarDias(hoy, -1);
  entrada(estado, [alRenglon(estado, balero.id, "1")], { fecha: ayer, recibido: hoy, folio: "B-1" });
  entrada(estado, [alRenglon(estado, balero.id, "1")], { fecha: ayer, recibido: ayer, folio: "B-2" });
  const r = resumen(estado);
  assert.equal(r.entradas_hoy, 1);
  assert.equal(r.fecha_ultima_entrada, ayer); // la última registrada se recibió ayer
});

test("reporte al cierre: E-0002 recibida antes que E-0001 entra sola; lo que creó E-0001 no aparece", () => {
  const { estado, balero, ubicacion } = preparar();
  const c2cons = ubicacion("CONTENEDOR #2 CONSUMIBLE");
  const nueva = en.conVarianteNueva({ ...en.entradaConArticulo(estado, en.lineaEntradaVacia(), 701), cantidad: "4" }, { dimension: "7777", um: "PZA", ubicacionId: c2cons.id });
  // E-0001: vale del 04, llegó el 05 (crea la partida 7777 en el #2). E-0002: vale del 02, llegó el 03.
  const e1 = entrada(estado, [nueva, alRenglon(estado, balero.id, "1")], { fecha: "2026-10-04", recibido: "2026-10-05", folio: "B-1" });
  const e2 = entrada(estado, [alRenglon(estado, balero.id, "2")], { fecha: "2026-10-02", recibido: "2026-10-03", folio: "B-2" });
  const creada = e1.lineas[0].existencia_id;
  assert.ok(estado.existencias.some((e) => e.id === creada && e.origen === "ENTRADA E-0001"));

  const al04 = estadoAlCierre(estado, "2026-10-04");
  assert.deepEqual([al04.entrada, al04.fuera, al04.entradas], [e2.folio, [e1.folio], 1]);
  assert.deepEqual(al04.estado.vales.filter((v) => v.tipo === "ENTRADA").map((v) => v.folio), [e2.folio]);
  assert.ok(!al04.estado.existencias.some((e) => e.id === creada));
  assert.equal(calcularSaldos(al04.estado, [balero.id]).get(balero.id).total.toFixed(), "9");
  assert.equal(describirCorte(al04), "vales de salida hasta el folio 9 · entradas recibidas hasta el 04/10/2026: hasta E-0002 (menos E-0001, recibida después)");
  assert.equal(ultimoFolioAl(estado, "ENTRADA", "2026-10-04"), e2.folio);

  const al02 = estadoAlCierre(estado, "2026-10-02");
  assert.deepEqual([al02.entrada, al02.fuera, al02.entradas], [0, [], 0]);
  assert.match(describirCorte(al02), /entradas recibidas hasta el 02\/10\/2026: ninguna$/);
  const al05 = estadoAlCierre(estado, "2026-10-05");
  assert.deepEqual([al05.entrada, al05.fuera, al05.entradas], [e2.folio, [], 2]);
  assert.ok(al05.estado.existencias.some((e) => e.id === creada));

  // El reporte del 03 lista la E-0002 (aunque su vale sea del 02); el del 04 dice qué folio quedó fuera.
  assert.deepEqual(reporteDelDia(estado, "2026-10-03").entradas.map((x) => x.folio), ["E-0002"]);
  assert.deepEqual(reporteDelDia(estado, "2026-10-02").entradas, []);
  assert.deepEqual(reporteDelDia(estado, "2026-10-04").corte, { salida: 9, entrada: e2.folio, fuera: [e1.folio], fecha: "2026-10-04" });

  // Una entrada registrada después, recibida el 03, que llega a la partida que creó E-0001: esa partida ya
  // existía el 04 (con lo de E-0003, no con lo de E-0001).
  const e3 = entrada(estado, [alRenglon(estado, creada, "3")], { fecha: "2026-10-03", recibido: "2026-10-03", folio: "B-3" });
  const otra = estadoAlCierre(estado, "2026-10-04");
  assert.deepEqual([otra.entrada, otra.fuera], [e3.folio, [e1.folio]]);
  assert.ok(otra.estado.existencias.some((e) => e.id === creada));
  assert.equal(calcularSaldos(otra.estado, [creada]).get(creada).total.toFixed(), "3");
  assert.deepEqual(enInventario(otra.estado, "2026-10-04", "CONTENEDOR #2 CONSUMIBLE", 701, "7777"), { cantidad: "3", ingreso: null });
  assert.deepEqual(entradasAlCierre(estado, "2026-10-03").fuera, [e1.folio]);
});

test("migración 12 → 13: las entradas toman su fecha como recibido; los borradores, hoy; un respaldo viejo también", async () => {
  const { estado, balero } = preparar();
  const vale = entrada(estado, [alRenglon(estado, balero.id, "2")], { fecha: "2026-10-01", recibido: "2026-10-01" });
  const b = borrador(estado, [alRenglon(estado, balero.id, "1")], { fecha: "2026-09-28", recibido: "2026-09-28", folio: "B-9" });
  assert.ok(FORMATO_ESTADO >= 13);

  // Como quedó con el formato 12: sin fecha de recibido.
  const viejo = structuredClone(estado);
  viejo.formato = 12;
  for (const v of viejo.vales) delete v.fecha_recibido;
  for (const x of viejo.borradores_entrada) delete x.fecha_recibido;
  const antes = reporteDelDia({ ...viejo, vales: viejo.vales }, "2026-10-01").entradas.map((x) => x.folio);
  migrarEstado(viejo);
  assert.equal(viejo.formato, FORMATO_ESTADO);
  assert.equal(viejo.vales.find((v) => v.id === vale.id).fecha_recibido, "2026-10-01");
  assert.ok(viejo.vales.filter((v) => v.tipo === "SALIDA").every((v) => v.fecha_recibido === undefined));
  assert.equal(viejo.borradores_entrada.find((x) => x.id === b.id).fecha_recibido, hoyIso());
  // Ningún reporte ya subido cambia.
  assert.deepEqual(reporteDelDia(viejo, "2026-10-01").entradas.map((x) => x.folio), antes);
  assert.deepEqual(antes, ["E-0001"]);
  // Migrar otra vez no cambia nada.
  assert.deepEqual(migrarEstado(structuredClone(viejo)), viejo);

  // Un respaldo del formato 12 se restaura migrado; el estado guardado en el navegador también.
  const almacen = new Almacen(new BackendMemoria(), { version: "prueba" });
  await almacen.iniciar();
  await almacen.cargarPrimeraVez(cargaSintetica().estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  const anterior = structuredClone(estado);
  anterior.formato = 12;
  anterior.plantillas_excel = almacen.estado.plantillas_excel;
  for (const v of anterior.vales) delete v.fecha_recibido;
  for (const x of anterior.borradores_entrada) delete x.fecha_recibido;
  const respaldo = crearRespaldo(anterior, await almacen.plantillasDelEstado(), { motivo: "prueba" });
  const nuevo = new Almacen(new BackendMemoria());
  await nuevo.iniciar();
  await nuevo.restaurar(respaldo.datos);
  assert.equal(nuevo.estado.formato, FORMATO_ESTADO);
  assert.equal(nuevo.estado.vales.find((v) => v.id === vale.id).fecha_recibido, "2026-10-01");
  assert.equal(nuevo.estado.borradores_entrada[0].fecha_recibido, hoyIso());
  assert.equal((await nuevo.backend.leerEstado()).formato, FORMATO_ESTADO);
});

test("validación del recibido: obligatoria, no futura, no después del registro; avisa si es antes del vale o de un conteo", () => {
  const { estado, balero, ubicacion, c1inv } = preparar();
  const hoy = "2026-10-08";
  const linea = () => [alRenglon(estado, balero.id, "1")];
  const errores = (b, opciones = {}) => en.validarEntrada(estado, b, { hoy, ...opciones }).errores.filter((e) => e.campo === "fecha_recibido").map((e) => e.mensaje);
  const avisos = (b, opciones = {}) => en.validarEntrada(estado, b, { hoy, ...opciones }).avisos.filter((e) => e.campo === "fecha_recibido").map((e) => e.mensaje);

  assert.deepEqual(errores(borrador(estado, linea(), { fecha: "2026-10-01", recibido: "" })), ["Falta la fecha de recibido."]);
  assert.deepEqual(errores(borrador(estado, linea(), { fecha: "2026-10-01", recibido: "2026-10-09" })), ["La fecha de recibido no puede ser futura."]);
  assert.deepEqual(errores(borrador(estado, linea(), { fecha: "2026-10-01", recibido: hoy })), []);
  // Futura de verdad (contra el reloj): no se registra.
  const manana = borrador(estado, linea(), { fecha: hoyIso(), recibido: sumarDias(hoyIso(), 1) });
  assert.throws(() => en.confirmarEntrada(estado, manana.id, { usuario: USUARIO }), (e) => e.errores.some((x) => x.campo === "fecha_recibido"));
  en.descartarBorradorEntrada(estado, manana.id);

  // Antes de la fecha del vale: avisa y no bloquea.
  const raro = borrador(estado, linea(), { fecha: "2026-10-05", recibido: "2026-10-03", folio: "B-5" });
  assert.deepEqual(errores(raro), []);
  assert.deepEqual(avisos(raro), ["Se recibió (03/10/2026) antes de la fecha del vale (05/10/2026): revisa las dos."]);
  const registrada = en.confirmarEntrada(estado, raro.id, { usuario: USUARIO });

  // Al corregir, no puede quedar después del día en que se registró.
  registrada.emitido_en = "2026-10-05T10:00:00";
  const datos = en.datosParaCorregirEntrada(estado, registrada.id);
  assert.equal(datos.fecha_recibido, "2026-10-03");
  assert.match(errores({ ...datos, fecha_recibido: "2026-10-06" }, { excluirValeId: registrada.id })[0], /posterior al día en que se registró la entrada \(05\/10\/2026\)/);
  assert.deepEqual(errores({ ...datos, fecha_recibido: "2026-10-05" }, { excluirValeId: registrada.id }), []);
  assert.throws(() => en.corregirEntrada(estado, registrada.id, { ...datos, fecha_recibido: "2026-10-06" }, "llegó después", USUARIO), /datos pendientes/);

  // Conteo del #1 inventariable el 06 (después de E-0001): una entrada recibida antes del conteo pudo contarse ya.
  const d = co.iniciarConteo(estado, { ubicaciones: [c1inv.id], fecha: "2026-10-06" });
  co.guardarConteoEnCurso(estado, { ...d, capturas: { [balero.id]: "8" } });
  co.aplicarConteo(estado, { corteAlAplicar: true });
  const dosVeces = /^Hubo un conteo el 06\/10\/2026 después de esa fecha \(la partida 1\): si ya se contó, la entrada lo sumaría dos veces\.$/;
  assert.match(avisos(borrador(estado, linea(), { fecha: "2026-10-04", recibido: "2026-10-04", folio: "B-6" }))[0], dosVeces);
  assert.deepEqual(avisos(borrador(estado, linea(), { fecha: "2026-10-04", recibido: "2026-10-06", folio: "B-7" })), []); // el mismo día: no
  assert.deepEqual(avisos(borrador(estado, linea(), { fecha: "2026-10-04", recibido: "2026-10-07", folio: "B-8" })), []);
  // A una partida que no se contó, no.
  const otra = estado.existencias.find((e) => e.ubicacion_id === ubicacion("CONTENEDOR #2 CONSUMIBLE").id);
  assert.deepEqual(avisos(borrador(estado, [alRenglon(estado, otra.id, "1")], { fecha: "2026-10-04", recibido: "2026-10-04", folio: "B-9" })), []);
  // La E-0001 se registró antes del conteo (ya está en lo contado): corregirla no avisa.
  assert.deepEqual(avisos({ ...en.datosParaCorregirEntrada(estado, registrada.id), fecha: "2026-10-02" }, { excluirValeId: registrada.id }), []);
  // Un reacomodo después del conteo no lo esconde: su cantidad sale del sistema, el conteo físico sigue siendo el del 06.
  reacomodar(estado, { desdeId: balero.id, ubicacionId: ubicacion("CONTENEDOR #2 CONSUMIBLE").id, cantidad: "1", fecha: "2026-10-07" });
  assert.match(avisos(borrador(estado, linea(), { fecha: "2026-10-04", recibido: "2026-10-05", folio: "B-10" }))[0], /^Hubo un conteo el 06\/10\/2026/);
  // Dos partidas al mismo renglón contado: un solo aviso.
  assert.match(avisos(borrador(estado, [...linea(), ...linea()], { fecha: "2026-10-04", recibido: "2026-10-05", folio: "B-11" }))[0], /\(las partidas 1 y 2\)/);
});

test("corregir el recibido: queda en la bitácora con motivo y la entrada pasa al otro día", () => {
  const { estado, balero } = preparar();
  const vale = entrada(estado, [alRenglon(estado, balero.id, "3")], { fecha: "2026-10-01", recibido: "2026-10-01" });
  const datos = en.datosParaCorregirEntrada(estado, vale.id);
  assert.deepEqual([datos.fecha, datos.fecha_recibido], ["2026-10-01", "2026-10-01"]);
  datos.fecha_recibido = "2026-10-03";
  const cambios = en.resumenCambiosEntrada(estado, vale, datos);
  assert.deepEqual(cambios, ["Recibido: 01/10/2026 → 03/10/2026"]);
  assert.throws(() => en.corregirEntrada(estado, vale.id, datos, " ", USUARIO), /motivo/);
  en.corregirEntrada(estado, vale.id, datos, `${cambios[0]}\nLlegó el viernes`, USUARIO);
  assert.deepEqual([vale.fecha, vale.fecha_recibido], ["2026-10-01", "2026-10-03"]);
  const registro = bitacoraDeVale(estado, vale.id).at(-1);
  assert.equal(registro.accion, "CORREGIR");
  assert.deepEqual([registro.antes.fecha_recibido, registro.despues.fecha_recibido], ["2026-10-01", "2026-10-03"]);
  assert.match(registro.antes.motivo, /Recibido: 01\/10\/2026 → 03\/10\/2026/);
  // Ahora cuenta el 03 (inventario y reporte diario).
  assert.deepEqual(reporteDelDia(estado, "2026-10-01").entradas, []);
  assert.equal(reporteDelDia(estado, "2026-10-03").entradas.length, 1);
  assert.deepEqual(saldo(estado, balero.id, "2026-10-03"), { cantidad: "7", ingreso: "3", total: "10" });
  assert.equal(calcularSaldos(estadoAlCierre(estado, "2026-10-02").estado, [balero.id]).get(balero.id).total.toFixed(), "7");
  // Cambiar solo la fecha del vale no lo mueve de día.
  const otra = en.datosParaCorregirEntrada(estado, vale.id);
  otra.fecha = "2026-09-30";
  assert.deepEqual(en.resumenCambiosEntrada(estado, vale, otra), ["Fecha del vale: 01/10/2026 → 30/09/2026"]);
  en.corregirEntrada(estado, vale.id, otra, "fecha del vale", USUARIO);
  assert.equal(reporteDelDia(estado, "2026-10-03").entradas.length, 1);
  // El libro exportado lleva las dos.
  const fila = new LibroLeido(exportarEntradas(estado).datos).hoja("DIARIO").fila(2, 1, 22);
  assert.deepEqual([fila[0].serial, fila[21].serial].map((n) => sumarDias("1899-12-30", n)), ["2026-09-30", "2026-10-03"]);
});

test("la conciliación con AX sigue con la fecha del vale (la base mueve el material en AX al enviarlo)", () => {
  const { estado, balero } = preparar();
  const vale = entrada(estado, [alRenglon(estado, balero.id, "1")], { fecha: "2026-10-06", recibido: "2026-10-08" });
  // AX al 07: el vale ya es anterior (AX lo trae) aunque el material llegó el 08.
  assert.equal(enTransito({ fecha: "2026-10-07" }, vale), false);
  assert.equal(enTransito({ fecha: "2026-10-05" }, vale), true);
});
