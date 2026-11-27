// Ronda 37: los fallos del reporte de pruebas externas (docs/reporte-pruebas-externas-2026-11-26.md), reproducidos
// con las fixtures sintéticas. Cada prueba lleva el número del hallazgo.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen, nombreConFecha, nombreFx } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { ErrorRespaldo, crearRespaldo, leerRespaldo } from "../src/almacen/respaldos.js";
import { exportarVales } from "../src/exportadores/vales.js";
import { cantidadEscrita, dec, decTexto, problemaDeCantidad } from "../src/nucleo/decimal.js";
import { Indices } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { ahoraIso, esFechaIso, hoyIso, sumarDias } from "../src/nucleo/fechas.js";
import { aplicarEntradaIA, interpretarRespuesta } from "../src/servicios/capturaIA.js";
import * as co from "../src/servicios/conteos.js";
import { describirCorte, estadoAlCierre } from "../src/servicios/corte.js";
import * as en from "../src/servicios/entradas.js";
import { ErrorJson, leerJsonTolerante } from "../src/servicios/jsonTolerante.js";
import { pendientesParaEmitir } from "../src/servicios/pasosVale.js";
import { ErrorReacomodo, reacomodar } from "../src/servicios/reacomodos.js";
import { reporteDelDia } from "../src/servicios/reporte.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { MAXIMO_CELDA, desescapar, desescaparX } from "../src/xlsx/xml.js";
import { ErrorZip, crearZip, descomprimir, descomprimirZip, escribirZip, leerZip } from "../src/xlsx/zip.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function preparar() {
  const { estado } = cargaSintetica();
  estado.config.usuario_en_turno = USUARIO;
  const indices = new Indices(estado);
  const de = (codigo) => estado.existencias.filter((e) => e.activo !== false && indices.variante(e.variante_id).codigo === codigo);
  const mecanico = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const borrador = (fecha = hoyIso()) => {
    const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: mecanico.id, fecha });
    b.recibio_nombre = "PERSONA SINTETICA";
    b.recibio_puesto = "MECANICO";
    return b;
  };
  const salida = (fecha, existencia, cantidad, extra = {}) => {
    const b = borrador(fecha);
    b.lineas.push({ ...v.lineaDesdeExistencia(estado, existencia.id), cantidad, justificacion: "PRUEBA", ...extra });
    return v.emitirBorrador(estado, b.id, { usuario: USUARIO })[0];
  };
  return { estado, indices, de, borrador, salida };
}

// ---------------------------------------------------------------- 1 · cantidades con «+»

test("1 · dec() nunca lanza: «+5» es 5 y lo que no es número es null", () => {
  assert.equal(decTexto(dec("+5")), "5");
  assert.equal(decTexto(dec("+.5")), "0.5");
  assert.equal(decTexto(dec("-3")), "-3");
  for (const t of ["1,5", "0x10", "1_000", "_5_", "1__0", "1e999999", "abc", "", "1.000.5"]) assert.equal(dec(t), null, t);
  assert.equal(decTexto(dec(7)), "7");
});

test("1 · cantidad escrita: solo dígitos y un punto; ni notación científica ni más de 9 enteros", () => {
  assert.equal(decTexto(cantidadEscrita("+5")), "5");
  assert.equal(decTexto(cantidadEscrita(" 2.5 ")), "2.5");
  for (const t of ["1e5", "1e40", "1e-30", "1_000", "1.000.5", "1000000000", "abc"]) assert.equal(cantidadEscrita(t), null, t);
  assert.deepEqual(["", "0", "-1", "1e5", "3"].map((t) => problemaDeCantidad(t)), ["falta", "cero", "cero", "numero", null]);
  assert.equal(problemaDeCantidad("0", { ceroValido: true }), null);
});

test("1a · conteo con «+5» capturado: la pantalla se arma y el conteo se aplica con 5", () => {
  const { estado, de } = preparar();
  const [balero] = de(701);
  const d = co.iniciarConteo(estado, { ubicaciones: [balero.ubicacion_id], fecha: hoyIso() });
  co.guardarConteoEnCurso(estado, { ...d, capturas: { [balero.id]: "+5" } });
  const fila = co.renglonesDelConteo(estado).find((f) => f.id === balero.id);
  assert.equal(decTexto(fila.contado), "5");
  assert.doesNotThrow(() => co.resumenConteo(estado));
  assert.deepEqual(co.validarConteo(estado), []);
  co.guardarConteoEnCurso(estado, { ...estado.conteo_en_curso, capturas: { [balero.id]: "1e5" } });
  assert.match(co.validarConteo(estado)[0].mensaje, /debe ser un número/);
  co.guardarConteoEnCurso(estado, { ...estado.conteo_en_curso, capturas: { [balero.id]: "+5" } });
  co.aplicarConteo(estado, { corteAlAplicar: true });
  assert.equal(estado.existencias.find((e) => e.id === balero.id).cantidad_conteo, "5");
});

test("1b/1c · vale, entrada, reacomodo y Copilot con «+»: sin excepciones de big.js", () => {
  const { estado, de, borrador } = preparar();
  const [balero] = de(701);
  const b = borrador();
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero.id), cantidad: "+1", uid: "u1" });
  assert.deepEqual(v.validarVale(estado, b).errores, []);
  const [vale] = v.emitirBorrador(estado, b.id, { usuario: USUARIO });
  assert.equal(vale.lineas[0].cantidad, "1");

  // Lo que no es una cantidad se dice, no truena.
  const otro = borrador();
  otro.lineas.push({ ...v.lineaDesdeExistencia(estado, balero.id), cantidad: "1e5", uid: "u2" });
  const { errores } = v.validarVale(estado, otro);
  assert.match(errores.find((e) => e.campo === "cantidad").mensaje, /escribe solo números/);
  const pendiente = pendientesParaEmitir(estado, otro, { usuario: USUARIO }).pendientes.find((p) => p.tipo === "cantidad");
  assert.equal(pendiente.corto, "Escribe solo números (ej. 2 o 2.5).");

  assert.doesNotThrow(() => reacomodar(estado, { desdeId: balero.id, ubicacionId: de(702)[0].ubicacion_id === balero.ubicacion_id ? estado.ubicaciones.find((u) => u.id !== balero.ubicacion_id).id : de(702)[0].ubicacion_id, cantidad: "+1" }));
  assert.throws(() => reacomodar(estado, { desdeId: balero.id, ubicacionId: estado.ubicaciones.find((u) => u.id !== balero.ubicacion_id).id, cantidad: "1e5" }), ErrorReacomodo);

  const e = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(e, { folio_externo: "B-1", origen: "BASE PRUEBA" });
  e.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id), cantidad: "+2" }];
  assert.doesNotThrow(() => en.vistaPreviaEntrada(estado, e));
  assert.deepEqual(en.validarEntrada(estado, e).errores.filter((x) => x.campo === "cantidad"), []);

  const { datos } = interpretarRespuesta('{"lineas":[{"codigo":"706","cantidad":"+3"},{"codigo":"706","cantidad":"1e40"},{"codigo":"706","cantidad":"1,000.5"}]}');
  const lleno = aplicarEntradaIA(estado, en.nuevoBorradorEntrada(estado, { usuario: USUARIO }), datos).datos;
  assert.deepEqual(lleno.lineas.filter((l) => l.codigo === 706).map((l) => l.cantidad), ["3", "", "1000.5"]);
});

// ---------------------------------------------------------------- 2 · CRC de los ZIP

async function respaldoSintetico() {
  const almacen = new Almacen(new BackendMemoria());
  await almacen.iniciar();
  await almacen.cargarPrimeraVez(cargaSintetica().estado, [
    { tipo: "INVENTARIO", nombre: "INVENTARIO SINTETICO.xlsx", datos: bytesInventario() },
    { tipo: "VALES", nombre: "VALES SINTETICO.xlsm", datos: bytesVales() },
  ]);
  return { almacen, respaldo: await almacen.respaldo("prueba") };
}

test("2 · un bit cambiado en una plantilla del respaldo se detecta siempre (antes 389 de 400 pasaban)", async () => {
  const { respaldo } = await respaldoSintetico();
  const entrada = leerZip(respaldo.datos).find((e) => e.nombre.startsWith("plantillas/"));
  const inicio = entrada.comprimido.byteOffset - respaldo.datos.byteOffset;
  let detectados = 0;
  for (let i = 0; i < 200; i++) {
    const copia = new Uint8Array(respaldo.datos);
    const byte = inicio + Math.floor(Math.random() * entrada.comprimido.length);
    copia[byte] ^= 1 << Math.floor(Math.random() * 8);
    try {
      leerRespaldo(copia);
    } catch (error) {
      assert.ok(error instanceof ErrorRespaldo, error.message);
      detectados++;
    }
  }
  assert.equal(detectados, 200);
  assert.throws(() => descomprimir({ ...entrada, crc: entrada.crc ^ 1 }), (e) => e instanceof ErrorZip && e.parte === entrada.nombre);
});

test("2 · al restaurar, cada plantilla debe ser la registrada (su huella sha256)", async () => {
  const { almacen, respaldo } = await respaldoSintetico();
  const { estado, plantillas } = leerRespaldo(respaldo.datos);
  const cambiada = plantillas.map((p, i) => (i === 0 ? { ...p, datos: crearZip([["otra.xml", "<a/>"]]) } : p));
  const falso = crearRespaldo(estado, cambiada, { motivo: "falso" });
  await assert.rejects(almacen.restaurar(falso.datos), (e) => e instanceof ErrorRespaldo && /dañado \(plantilla /.test(e.message));
  await almacen.restaurar(respaldo.datos); // el bueno sí
});

test("2/8 · tamaño declarado absurdo: error de archivo dañado sin reservar 4 GB", () => {
  const [entrada] = leerZip(crearZip([["estado.json", "{}"]]));
  const t0 = Date.now();
  assert.throws(() => descomprimir({ ...entrada, tamano: 0xfffffff0 }), ErrorZip);
  assert.ok(Date.now() - t0 < 1000);
  const zip = escribirZip([{ ...entrada, tamano: 0xfffffff0 }]);
  assert.throws(() => leerRespaldo(zip), (e) => e instanceof ErrorRespaldo && /dañado/.test(e.message));
});

// ---------------------------------------------------------------- 3 · cierre del día por fecha

test("3 · un vale de ayer capturado hoy: el cierre de ayer no lleva el de hoy y cuadra con el inventario", () => {
  const { estado, de, salida } = preparar();
  const [balero] = de(702);
  const ayer = "2026-10-25";
  const hoy = "2026-10-26";
  const total = (e) => calcularSaldos(e, [balero.id]).get(balero.id).total;
  const inicial = total(estado);
  const deHoy = salida(hoy, balero, "2"); // folio menor, fecha de hoy
  const deAyer = salida(ayer, balero, "3"); // folio mayor, fecha de ayer (capturado tarde)
  assert.ok(deAyer.folio > deHoy.folio);

  const cierreAyer = estadoAlCierre(estado, ayer);
  assert.deepEqual(cierreAyer.estado.vales.filter((x) => x.tipo === "SALIDA" && x.folio >= deHoy.folio).map((x) => x.folio), [deAyer.folio]);
  assert.deepEqual(cierreAyer.salidasFuera, [deHoy.folio]);
  const delDia = calcularSaldos(cierreAyer.estado, [balero.id], { dia: ayer }).get(balero.id);
  assert.equal(delDia.consumo.toFixed(), "3");
  assert.equal(delDia.total.toFixed(), inicial.minus(3).toFixed());
  assert.match(describirCorte(cierreAyer), new RegExp(`menos ${deHoy.folio}, de otro día`));
  assert.deepEqual(reporteDelDia(estado, ayer).salidas.map((s) => s.folio), [deAyer.folio]);

  const cierreHoy = estadoAlCierre(estado, hoy);
  assert.deepEqual(cierreHoy.salidasFuera, []);
  const hoyMismo = calcularSaldos(cierreHoy.estado, [balero.id], { dia: hoy }).get(balero.id);
  assert.deepEqual([hoyMismo.consumo.toFixed(), hoyMismo.total.toFixed()], ["2", inicial.minus(5).toFixed()]);

  // «Ya lo subí» del reporte de ayer marca el de ayer; el de hoy sigue pendiente aunque su folio sea menor.
  const r = reporteDelDia(estado, ayer);
  assert.deepEqual(r.porSubir.map((p) => p.vale.folio).filter((f) => f >= deHoy.folio), [deAyer.folio]);
  v.registrarEnvio(estado, USUARIO, { hastaFolio: r.corte.salida, hastaFecha: ayer });
  assert.deepEqual(v.valesPorEnviar(estado).map((p) => p.vale.folio), [deHoy.folio]);
});

test("3 · fechas: no después de hoy ni fuera del calendario; el borrador sin fecha elegida sale con la de hoy", () => {
  const { estado, de, borrador } = preparar();
  const [balero] = de(701);
  const conPartida = (b) => {
    b.lineas.push({ ...v.lineaDesdeExistencia(estado, balero.id), cantidad: "1" });
    return b;
  };
  const errorDeFecha = (fecha) => v.validarVale(estado, { ...conPartida(borrador()), fecha }).errores.find((e) => e.campo === "fecha")?.mensaje;
  assert.equal(errorDeFecha(sumarDias(hoyIso(), 1)), "La fecha no puede ser después de hoy.");
  for (const f of ["2026-02-30", "2026-13-45", "0000-00-00"]) assert.match(errorDeFecha(f), /calendario/, f);
  assert.equal(errorDeFecha(hoyIso()), undefined);
  assert.deepEqual(["2026-02-30", "2024-02-29", "1899-12-31"].map(esFechaIso), [false, true, false]);

  // Un borrador de ayer que nadie fechó (como los de antes, sin `fecha_elegida`): sale hoy.
  const ayer = sumarDias(hoyIso(), -1);
  const viejo = conPartida(borrador());
  Object.assign(viejo, { fecha: ayer, creado_en: `${ayer}T18:00:00` });
  delete viejo.fecha_elegida;
  assert.equal(v.fechaDelBorrador(viejo), hoyIso());
  assert.equal(v.emitirBorrador(estado, viejo.id, { usuario: USUARIO })[0].fecha, hoyIso());
  // Con la fecha elegida a mano (vale de ayer capturado hoy), se respeta.
  const elegido = Object.assign(conPartida(borrador()), v.conFechaElegida(ayer));
  assert.equal(v.emitirBorrador(estado, elegido.id, { usuario: USUARIO })[0].fecha, ayer);

  // Conteo y entrada: también con fecha que exista.
  const d = co.iniciarConteo(estado, { ubicaciones: [balero.ubicacion_id] });
  co.guardarConteoEnCurso(estado, { ...d, fecha: "2026-02-30", capturas: { [balero.id]: "1" } });
  assert.ok(co.validarConteo(estado).some((e) => e.campo === "fecha"));
  const e = en.nuevoBorradorEntrada(estado, { usuario: USUARIO });
  Object.assign(e, { folio_externo: "B-9", origen: "BASE", fecha: "2026-02-30" });
  e.lineas = [{ ...en.conRenglonExistente(estado, en.lineaEntradaVacia(), balero.id), cantidad: "1" }];
  assert.ok(en.validarEntrada(estado, e).errores.some((x) => x.campo === "fecha"));
});

// ---------------------------------------------------------------- 4 · partida quitada por un conteo

test("4 · un borrador no se emite sobre una partida que un conteo quitó; corregir un vale viejo sí", () => {
  const { estado, de, borrador, salida } = preparar();
  const [partida] = de(702);
  const anterior = salida(hoyIso(), partida, "1");
  const b = borrador();
  b.lineas.push({ ...v.lineaDesdeExistencia(estado, partida.id), cantidad: "2", justificacion: "PRUEBA" });
  const d = co.iniciarConteo(estado, { ubicaciones: [partida.ubicacion_id] });
  co.guardarConteoEnCurso(estado, { ...d, correcciones: [{ existencia_id: partida.id, quitar: true }] });
  co.aplicarConteo(estado, { corteAlAplicar: true });
  assert.equal(estado.existencias.find((e) => e.id === partida.id).activo, false);
  const { errores } = v.validarVale(estado, b);
  assert.match(errores.find((e) => e.campo === "existencia_id").mensaje, /ya no está en el inventario; elige otra clave/);
  assert.throws(() => v.emitirBorrador(estado, b.id, { usuario: USUARIO }), v.ErrorVale);
  // El vale que ya salía de esa partida se puede seguir corrigiendo.
  const datos = v.datosParaCorregir(estado, anterior.id);
  assert.deepEqual(v.validarVale(estado, datos, { excluirValeId: anterior.id }).errores.filter((e) => e.campo === "existencia_id"), []);
});

// ---------------------------------------------------------------- 6 · celdas de más de 32 767 caracteres

test("6 · los textos largos se cortan a lo que admite una celda de Excel", () => {
  const { estado, de, salida } = preparar();
  const largo = "Ñ".repeat(40000);
  const vale = salida(hoyIso(), de(701)[0], "1");
  Object.assign(vale, { observaciones: largo, recibio_nombre: largo });
  vale.lineas[0].lote = largo;
  const { datos } = exportarVales(estado, bytesVales());
  const libro = new LibroLeido(datos);
  const hoja = libro.hojas.find((h) => /DIARIO/i.test(h.nombre));
  const xml = libro.texto(hoja.parte);
  const textos = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescaparX(desescapar(m[1])));
  assert.ok(textos.some((t) => t.length === MAXIMO_CELDA), "el texto largo sí llega, cortado");
  assert.ok(textos.every((t) => t.length <= MAXIMO_CELDA));
});

// ---------------------------------------------------------------- 8 · respaldos dañados o manipulados

test("8 · respaldos manipulados: se rechazan con un mensaje claro o se reparan", async () => {
  const { respaldo } = await respaldoSintetico();
  const partes = descomprimirZip(respaldo.datos);
  const estado = JSON.parse(new TextDecoder().decode(partes.get("estado.json")));
  const con = (cambio, extra = []) => {
    const e = structuredClone(estado);
    cambio(e);
    return crearZip([...[...partes].filter(([n]) => n !== "estado.json").map(([n, d]) => [n, d]), ["estado.json", JSON.stringify(e)], ...extra]);
  };
  const rechaza = (zip, patron) => assert.throws(() => leerRespaldo(zip), (e) => e instanceof ErrorRespaldo && patron.test(e.message));
  rechaza(crearZip([...[...partes].filter(([n]) => n !== "manifiesto.json"), ["manifiesto.json", "{malo"]]), /dañado \(manifiesto.json\)/);
  rechaza(con((e) => e.vales.push(null)), /dañado \(vales\)/);
  rechaza(con((e) => (e.vales[0].lineas = null)), /dañado \(partidas de un vale\)/);
  rechaza(con((e) => (e.vales[0].folio = String(e.vales[0].folio))), /dañado \(folio/);
  rechaza(con((e) => delete e.formato), /no contiene datos de Control de Almacén/);
  rechaza(con((e) => (e.config.inventario = "ZZZ")), /inventario que la herramienta no conoce/);

  // Secuencias vacías: los ids nuevos siguen después de los que hay.
  const reparado = leerRespaldo(con((e) => (e.secuencias = {}))).estado;
  assert.equal(reparado.secuencias.vale, Math.max(...estado.vales.map((x) => x.id)));
  assert.equal(reparado.secuencias.existencia, Math.max(...estado.existencias.map((x) => x.id)));

  // Una «plantilla» con ruta (../) no entra.
  const { plantillas } = leerRespaldo(con(() => {}, [["plantillas/../fotos/x.jpg", new Uint8Array([1, 2, 3])]]));
  assert.ok(plantillas.every((p) => !p.archivo.includes("/")));
});

// ---------------------------------------------------------------- 9 · nombre con fecha

test("9 · el nombre exportado cambia su fecha, no el primer bloque de 6 dígitos", () => {
  assert.equal(nombreConFecha("INVENTARIO RIG 910001 280926.xlsx", "2026-12-05"), "INVENTARIO RIG 910001 051226.xlsx");
  assert.equal(nombreConFecha("INVENTARIO 123456 RIG 91 280926.xlsx", "2026-12-05"), "INVENTARIO 123456 RIG 91 051226.xlsx");
  assert.equal(nombreConFecha("INVENTARIO_20260926.xlsx", "2026-12-05"), "INVENTARIO_20261205.xlsx");
  assert.equal(nombreConFecha("INVENTARIO RIG 91.xlsx", "2026-12-05"), "INVENTARIO RIG 91 051226.xlsx");
  assert.equal(nombreFx(nombreConFecha("INVENTARIO GSM 910001 280926.xlsx", "2026-12-05")), "INVENTARIO FX 910001 051226.xlsx");
});

// ---------------------------------------------------------------- 10 · Excel con prefijo de espacio de nombres

test("10 · un libro con <x:sheetData> (Open XML SDK) se lee igual", () => {
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const libro = crearZip([
    ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ["xl/workbook.xml", `<?xml version="1.0"?><x:workbook xmlns:x="${NS}" xmlns:r="${R}"><x:sheets><x:sheet name="REPORTE" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ["xl/sharedStrings.xml", `<?xml version="1.0"?><x:sst xmlns:x="${NS}"><x:si><x:t>000000706</x:t></x:si><x:si><x:t>SELLOS</x:t></x:si></x:sst>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><x:worksheet xmlns:x="${NS}"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1"><x:v>3</x:v></x:c></x:row></x:sheetData></x:worksheet>`],
  ]);
  const leido = new LibroLeido(libro);
  assert.deepEqual(leido.nombresHojas, ["REPORTE"]);
  const fila = leido.hoja("REPORTE").filas.get(1);
  assert.deepEqual([...fila.values()], ["000000706", "SELLOS", 3]);
});

// ---------------------------------------------------------------- 11 · JSON con miles de niveles

test("11 · JSON de Copilot con miles de niveles: error claro, no RangeError", () => {
  for (const t of ["[".repeat(100000), '{"a":'.repeat(100000)]) assert.throws(() => leerJsonTolerante(t), ErrorJson);
});

test("ahoraIso y hoyIso siguen siendo del mismo día (lo usa fechaElegida)", () => {
  assert.equal(ahoraIso().slice(0, 10), hoyIso());
});
