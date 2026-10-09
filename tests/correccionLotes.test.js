import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarEntradas, valoresEntrada } from "../src/exportadores/entradas.js";
import { exportarVales, valoresRenglon } from "../src/exportadores/vales.js";
import { analizarFormulario } from "../src/impresion/formulario.js";
import { valoresDeVale } from "../src/impresion/vale.js";
import { estadoVacio } from "../src/nucleo/estado.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { isoDesdeSerial } from "../src/nucleo/fechas.js";
import { CAMPOS_CORRECCION_GENERAL, corregirDatosGeneralesLote, resolverLoteCorreccion, revisarCorreccionGeneral } from "../src/servicios/correccionLotes.js";
import { conFirmasPorPapel, firmasPorPosicion, siguienteFolio, valesPorEnviar } from "../src/servicios/vales.js";
import { Sesion } from "../src/ui/sesion.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { leerZip } from "../src/xlsx/zip.js";
import { bytesVales } from "./ayuda.js";

function vale(id, tipo = "SALIDA", extra = {}) {
  return {
    id, tipo, folio: id, estado: "EMITIDO", migrado: false, fecha: "2026-10-01",
    origen: "EQUIPO A", depto_origen: "ALMACEN", destino: "EQUIPO B", depto_destino: "MECANICO",
    entrego_nombre: "PERSONA UNO", entrego_puesto: "ALMACENISTA", recibio_nombre: "PERSONA DOS", recibio_puesto: "TECNICO",
    autorizo_nombre: null, autorizo_puesto: null, observaciones: "OBSERVACION DE PRUEBA",
    plantilla_area_id: null, naturaleza: "CONSUMO", fotos: ["foto-sintetica"],
    lineas: [
      { id: id * 10, renglon: 1, codigo: 701, descripcion: "MATERIAL SINTETICO", cantidad: "1.25", oc: "S/OC", clave: "CLAVE UNO", um: "PZA", lote: "LOTE UNO", existencia_id: 1, variante_id: 1, fila_diario_origen: 2, encabezado_original: null, familia: "FAMILIA", transferencia_consumo: "CONSUMO", notas: "ESCRITURA ORIGINAL" },
      { id: id * 10 + 1, renglon: 2, codigo: 702, descripcion: "OTRO MATERIAL", cantidad: "0.50", oc: "4567", clave: "CLAVE DOS", um: "PZA", lote: "LOTE DOS", existencia_id: null, no_inventariado: true },
    ],
    ...extra,
  };
}

function preparar(vales = [vale(1), vale(2), vale(3, "ENTRADA", { folio: 1, folio_externo: "845", motivo: "BASE", devolucion_folio: null })]) {
  const estado = estadoVacio();
  estado.vales = vales;
  estado.existencias = [{ id: 1, variante_id: 1, ubicacion_id: 1, conteo_id: 1, cantidad_conteo: "100", activo: true }];
  estado.conteos = [{ id: 1, ultimo_folio_salida: 0, ultimo_folio_entrada: 0 }];
  estado.secuencias = { vale: 3, vale_linea: 31, cambio: 20 };
  estado.personas = [{ id: 1, nombre: "PERSONA UNO", puesto: "ALMACENISTA" }, { id: 2, nombre: "PERSONA DOS", puesto: "TECNICO" }];
  return estado;
}

function congelar(valor) {
  if (valor && typeof valor === "object") {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

test("resuelve folios de cada tipo en orden; las entradas usan E-0001 o número interno", () => {
  const estado = preparar();
  const salidas = resolverLoteCorreccion(estado, "2, 001;2 1 9 E-0001");
  assert.deepEqual(salidas.vales.map((v) => v.id), [2, 1]);
  assert.deepEqual(salidas.repetidos, [2, 1]);
  assert.deepEqual(salidas.faltantes, [9]);
  assert.deepEqual(salidas.invalidos, ["E-0001"]);
  const entradas = resolverLoteCorreccion(estado, "E-0001;1 e-001 845 2 +1 0 1e2", "ENTRADA");
  assert.deepEqual(entradas.vales.map((v) => v.id), [3]);
  assert.deepEqual(entradas.repetidos, [1]);
  assert.deepEqual(entradas.faltantes, [845, 2]);
  assert.deepEqual(entradas.invalidos, ["+1", "0", "1e2"]);
  assert.throws(() => resolverLoteCorreccion(estado, "1", "OTRO"), /entrada o de salida/);
});

test("la resolución y la vista previa trabajan con estado congelado, sin tocarlo", () => {
  const estado = congelar(preparar());
  const antes = JSON.stringify(estado);
  const lote = resolverLoteCorreccion(estado, "2\n1\n2");
  const vista = revisarCorreccionGeneral(estado, lote.vales, { recibio_nombre: " persona nueva ", recibio_puesto: " supervisor " });
  assert.deepEqual(vista.corregidos.map((v) => v.id), [2, 1]);
  assert.deepEqual(vista.sinCambios, []);
  assert.deepEqual(vista.vales[0].cambios.map(({ clave, antes, despues }) => ({ clave, antes, despues })), [
    { clave: "recibio_nombre", antes: "PERSONA DOS", despues: "PERSONA NUEVA" },
    { clave: "recibio_puesto", antes: "TECNICO", despues: "SUPERVISOR" },
  ]);
  assert.match(vista.resumen[0], /^\[2\] Nombre de quien recibe:/);
  assert.equal(JSON.stringify(estado), antes);
});

test("aplica un lote de 88 encabezados, mantiene partidas por referencia y bytes e inventario intacto", () => {
  const estado = preparar(Array.from({ length: 88 }, (_, i) => vale(i + 1)));
  const partidas = estado.vales.map((v) => ({ arreglo: v.lineas, lineas: [...v.lineas], bytes: JSON.stringify(v.lineas) }));
  const saldo = calcularSaldos(estado).get(1).total.toFixed();
  const ajeno = JSON.stringify({ existencias: estado.existencias, conteos: estado.conteos, personas: estado.personas, config: estado.config, variantes: estado.variantes, articulos: estado.articulos });
  const folio = siguienteFolio(estado);
  const resultado = corregirDatosGeneralesLote(estado, estado.vales.map((v) => v.id), { fecha: "2026-10-03", entrego_nombre: "PERSONA TRES", entrego_puesto: "ENCARGADO", observaciones: "Texto corregido\nSegunda línea" }, "Datos de la guardia", "USUARIO PRUEBA");
  assert.equal(resultado.corregidos.length, 88);
  assert.deepEqual(resultado.sinCambios, []);
  estado.vales.forEach((v, i) => {
    assert.strictEqual(v.lineas, partidas[i].arreglo);
    v.lineas.forEach((linea, j) => assert.strictEqual(linea, partidas[i].lineas[j]));
    assert.equal(JSON.stringify(v.lineas), partidas[i].bytes);
    assert.equal(v.entrego_nombre, "PERSONA TRES");
    assert.equal(v.entrego_puesto, "ENCARGADO");
    assert.equal(v.recibio_nombre, "PERSONA DOS");
    assert.equal(v.observaciones, "Texto corregido\nSegunda línea");
    assert.deepEqual(v.fotos, ["foto-sintetica"]);
  });
  assert.equal(JSON.stringify({ existencias: estado.existencias, conteos: estado.conteos, personas: estado.personas, config: estado.config, variantes: estado.variantes, articulos: estado.articulos }), ajeno);
  assert.equal(calcularSaldos(estado).get(1).total.toFixed(), saldo);
  assert.equal(siguienteFolio(estado), folio);
  assert.equal(estado.secuencias.vale, 3);
  assert.equal(estado.secuencias.vale_linea, 31);
  assert.equal(estado.secuencias.cambio, 108);
  assert.equal(estado.auditoria.length, 88);
});

test("guardar no acepta partidas, folio, tipo, plantilla, fotos ni campos fuera del encabezado", () => {
  const prohibidos = ["lineas", "materiales", "partidas", "folio", "folio_externo", "tipo", "plantilla_area_id", "naturaleza", "fotos", "motivo", "devolucion_folio", "etapa_perforacion", "__proto__"];
  for (const campo of prohibidos) {
    const estado = preparar();
    const antes = JSON.stringify(estado);
    assert.throws(() => corregirDatosGeneralesLote(estado, [1], Object.fromEntries([["recibio_puesto", "ENCARGADO"], [campo, "dato"]]), "Prueba"), /No se permite/);
    assert.equal(JSON.stringify(estado), antes);
  }
});

test("fecha real, motivo y nombres obligatorios; inválidos dejan todo el lote intacto", () => {
  const invalidos = [
    { fecha: "2026-02-29" }, { fecha: "2026-04-31" }, { fecha: "2026-13-01" }, { fecha: "0000-01-01" }, { fecha: "03/10/2026" },
    { fecha: "" }, { entrego_nombre: " " }, { recibio_nombre: "0" }, { recibio_nombre: null }, { recibio_puesto: 9 },
  ];
  for (const cambios of invalidos) {
    const estado = preparar();
    const antes = JSON.stringify(estado);
    assert.throws(() => corregirDatosGeneralesLote(estado, [1, 2], cambios, "Validación"));
    assert.equal(JSON.stringify(estado), antes);
  }
  const estado = preparar();
  const antes = JSON.stringify(estado);
  assert.throws(() => corregirDatosGeneralesLote(estado, [1, 2], { recibio_puesto: "SUPERVISOR" }, " \n "), /motivo/);
  assert.throws(() => revisarCorreccionGeneral(estado, estado.vales, {}), /al menos un dato/);
  assert.equal(JSON.stringify(estado), antes);
  corregirDatosGeneralesLote(estado, [1], { fecha: "2028-02-29" }, "Fecha válida");
  assert.equal(estado.vales[0].fecha, "2028-02-29");
});

test("valida todos los vales antes de mutar, incluidos cancelados, ids inexistentes y campos incompatibles", () => {
  for (const caso of ["cancelado", "id", "entrada"]) {
    const estado = preparar();
    if (caso === "cancelado") estado.vales[1].estado = "CANCELADO";
    const antes = JSON.stringify(estado);
    const ids = caso === "id" ? [1, 900] : caso === "entrada" ? [1, 3] : [1, 2];
    const cambios = caso === "entrada" ? { autorizo_nombre: "AUTORIZADOR" } : { recibio_nombre: "PERSONA NUEVA" };
    assert.throws(() => corregirDatosGeneralesLote(estado, ids, cambios, "Prueba"));
    assert.equal(JSON.stringify(estado), antes);
  }
  const estado = preparar();
  estado.vales[1].estado = "CANCELADO";
  assert.deepEqual(resolverLoteCorreccion(estado, "2 1 2").cancelados, [2]);
});

test("omite vales sin cambios y duplicados, sin nuevos registros ni cambio de fecha de modificación", () => {
  const estado = preparar();
  estado.vales[1].recibio_puesto = "SUPERVISOR";
  const segundo = JSON.stringify(estado.vales[1]);
  const resultado = corregirDatosGeneralesLote(estado, [1, 2, 1, 2], { recibio_puesto: " supervisor " }, "Puesto correcto");
  assert.deepEqual(resultado.corregidos.map((v) => v.id), [1]);
  assert.deepEqual(resultado.sinCambios.map((v) => v.id), [2]);
  assert.equal(JSON.stringify(estado.vales[1]), segundo);
  assert.equal(estado.auditoria.length, 1);
  assert.equal(estado.secuencias.cambio, 21);
  const antes = JSON.stringify(estado);
  const repetido = corregirDatosGeneralesLote(estado, [1, 2], { recibio_puesto: "SUPERVISOR" }, "Ya correcto");
  assert.equal(repetido.corregidos.length, 0);
  assert.equal(JSON.stringify(estado), antes);
});

test("bitácora por vale conserva motivo y snapshots independientes de cambios futuros", () => {
  const estado = preparar();
  const anterior = structuredClone(estado.vales[0]);
  corregirDatosGeneralesLote(estado, [1], { destino: "EQUIPO C", recibio_puesto: "JEFE" }, "Guardia correcta", "USUARIO");
  const auditoria = estado.auditoria[0];
  assert.equal(auditoria.accion, "CORREGIR");
  assert.equal(auditoria.entidad_id, "1");
  assert.equal(auditoria.usuario, "USUARIO");
  assert.equal(auditoria.antes.motivo, "Guardia correcta");
  assert.equal(auditoria.antes.destino, anterior.destino);
  assert.deepEqual(auditoria.antes.lineas, anterior.lineas);
  assert.equal(auditoria.despues.recibio_puesto, "JEFE");
  assert.equal(auditoria.antes.cambios.length, 2);
  const snapshot = JSON.stringify(auditoria);
  estado.vales[0].lineas[0].cantidad = "99";
  assert.equal(JSON.stringify(auditoria), snapshot);
  assert.deepEqual(valesPorEnviar(estado).map(({ vale }) => vale.id), [1]);
});

test("entrada: conserva motivo, base, consecutivo y materiales; corrige la cabecera exportada", () => {
  const estado = preparar();
  const entrada = estado.vales[2];
  const lineas = entrada.lineas;
  const materialAntes = valoresEntrada(entrada, lineas[0]).slice(8, 15);
  const secuencias = { ...estado.secuencias };
  const vista = revisarCorreccionGeneral(estado, [entrada], { fecha: "2026-10-04", recibio_nombre: "PERSONA CUATRO", recibio_puesto: "ALMACENISTA" });
  assert.match(vista.resumen[0], /^\[E-0001\] Fecha:/);
  corregirDatosGeneralesLote(estado, [entrada.id], { fecha: "2026-10-04", recibio_nombre: "PERSONA CUATRO", recibio_puesto: "ALMACENISTA" }, "Datos generales");
  assert.strictEqual(entrada.lineas, lineas);
  assert.equal(entrada.motivo, "BASE");
  assert.equal(entrada.folio_externo, "845");
  assert.equal(entrada.folio, 1);
  assert.equal(entrada.devolucion_folio, null);
  assert.deepEqual(valoresEntrada(entrada, lineas[0]).slice(8, 15), materialAntes);
  assert.equal(estado.secuencias.cambio, secuencias.cambio);
  assert.equal(estado.secuencias.vale, secuencias.vale);
  assert.equal(estado.secuencias.vale_linea, secuencias.vale_linea);
  assert.equal(estado.auditoria[0].antes.motivo_entrada, "BASE");
  assert.equal(estado.auditoria[0].antes.motivo, "Datos generales");
  assert.equal(estado.auditoria[0].despues.motivo, "BASE");
  const hoja = new LibroLeido(exportarEntradas(estado).datos).hoja("DIARIO");
  assert.equal(isoDesdeSerial(hoja.valor(2, 1).serial), "2026-10-04");
  assert.deepEqual([hoja.valor(2, 2), hoja.valor(2, 17), hoja.valor(2, 21)], [845, "PERSONA CUATRO", "E-0001"]);
});

test("NOV migrado: vista previa por papel, almacenamiento por posición y sólo override seleccionado", () => {
  const nov = vale(1, "SALIDA", { migrado: true, depto_destino: "NOV", entrego_nombre: "QUIMICO UNO", entrego_puesto: "QUIMICO", recibio_nombre: "ALMACENISTA UNO", recibio_puesto: "ALMACENISTA" });
  nov.lineas[0].encabezado_original = { entrego: "QUIMICO ORIGINAL", recibio: "ALMACENISTA ORIGINAL", destino: "DESTINO PARTICULAR" };
  const estado = preparar([nov]);
  estado.plantillas_area = [{ id: 1, depto_destino: "NOV", almacenista_derecha: true }];
  const originales = JSON.stringify(nov.lineas);
  const vista = revisarCorreccionGeneral(estado, [nov], { recibio_nombre: "QUIMICO DOS", recibio_puesto: "SUPERVISOR" });
  assert.equal(vista.vales[0].cambios[0].antes, "QUIMICO UNO");
  corregirDatosGeneralesLote(estado, [nov.id], { recibio_nombre: "QUIMICO DOS", recibio_puesto: "SUPERVISOR" }, "Firma correcta");
  assert.deepEqual([nov.entrego_nombre, nov.entrego_puesto, nov.recibio_nombre], ["QUIMICO DOS", "SUPERVISOR", "ALMACENISTA UNO"]);
  assert.deepEqual(nov.campos_encabezado_corregidos, ["entrego", "entrego_puesto"]);
  assert.equal(nov.firmas_por_posicion, true);
  assert.equal(JSON.stringify(nov.lineas), originales);
  assert.deepEqual(valoresRenglon(nov, nov.lineas[0]).slice(15, 17), ["QUIMICO DOS", "ALMACENISTA ORIGINAL"]);
  assert.equal(valoresRenglon(nov, nov.lineas[0])[6], "DESTINO PARTICULAR");
  corregirDatosGeneralesLote(estado, [nov.id], { entrego_nombre: "ALMACENISTA DOS", depto_destino: "OTRO DEPTO" }, "Datos actualizados");
  assert.ok(firmasPorPosicion(estado, nov));
  assert.equal(conFirmasPorPapel(estado, nov).entrego_nombre, "ALMACENISTA DOS");
  assert.equal(conFirmasPorPapel(estado, nov).recibio_nombre, "QUIMICO DOS");
  assert.deepEqual(new Set(nov.campos_encabezado_corregidos), new Set(["entrego", "entrego_puesto", "recibio", "depto_destino"]));
  assert.deepEqual(valoresRenglon(nov, nov.lineas[0]).slice(15, 17), ["QUIMICO DOS", "ALMACENISTA DOS"]);
});

test("migrado de otra área conserva firmas por papel al cambiar el departamento a NOV", () => {
  const estado = preparar([vale(1, "SALIDA", { migrado: true })]);
  estado.plantillas_area = [{ id: 1, depto_destino: "NOV", almacenista_derecha: true }];
  corregirDatosGeneralesLote(estado, [1], { depto_destino: "NOV", recibio_nombre: "PERSONA NUEVA" }, "Departamento correcto");
  assert.equal(estado.vales[0].firmas_por_posicion, false);
  assert.equal(firmasPorPosicion(estado, estado.vales[0]), false);
  assert.deepEqual([conFirmasPorPapel(estado, estado.vales[0]).entrego_nombre, conFirmasPorPapel(estado, estado.vales[0]).recibio_nombre], ["PERSONA UNO", "PERSONA NUEVA"]);
});

test("NOV migrado encontrado por nombre de hoja conserva sus firmas al corregir fecha y departamento", async () => {
  const nov = vale(1, "SALIDA", {
    migrado: true, depto_destino: " nov ",
    entrego_nombre: "RECEPTOR SINTETICO", entrego_puesto: "QUIMICO",
    recibio_nombre: "ENTREGANTE SINTETICO", recibio_puesto: "ALMACENISTA",
  });
  nov.lineas[0].encabezado_original = { entrego: "RECEPTOR DIARIO ORIGINAL", recibio: "ENTREGANTE DIARIO ORIGINAL" };
  const estado = preparar([nov]);
  estado.plantillas_area = [
    { id: 1, depto_destino: "MECANICO", hoja_excel: "MECANICO ", almacenista_derecha: false },
    { id: 2, depto_destino: "NOV ENERGY", hoja_excel: "NOV ", almacenista_derecha: true },
  ];
  const sesion = { estado, hojasFormato: async () => ["MECANICO ", "NOV "] };
  assert.equal(await Sesion.prototype.hojaParaVale.call(sesion, nov), "NOV ");
  const libro = new LibroLeido(bytesVales());
  const modeloNov = analizarFormulario(libro, "NOV");
  const modeloMecanico = analizarFormulario(libro, "MECANICO ");
  const firmasImpresas = (modelo, v) => {
    const valores = valoresDeVale(modelo, v);
    return [modelo.campos.entrega_nombre, modelo.campos.recibe_nombre].map(({ r, c }) => valores.get(`${r},${c}`));
  };
  const impresas = firmasImpresas(modeloNov, nov);
  const diario = valoresRenglon(nov, nov.lineas[0]).slice(15, 17);
  const lineas = nov.lineas;
  const originales = JSON.stringify(lineas);
  assert.deepEqual(impresas, ["ENTREGANTE SINTETICO", "RECEPTOR SINTETICO"]);
  corregirDatosGeneralesLote(estado, [nov.id], { fecha: "2026-10-02" }, "Corregir fecha");
  assert.equal(nov.firmas_por_posicion, true);
  assert.deepEqual(firmasImpresas(modeloNov, nov), impresas);
  assert.deepEqual(valoresRenglon(nov, nov.lineas[0]).slice(15, 17), diario);
  corregirDatosGeneralesLote(estado, [nov.id], { depto_destino: "MECANICO" }, "Corregir departamento");
  assert.equal(await Sesion.prototype.hojaParaVale.call(sesion, nov), "MECANICO ");
  assert.equal(nov.firmas_por_posicion, true);
  assert.deepEqual(firmasImpresas(modeloMecanico, nov), impresas);
  assert.deepEqual(valoresRenglon(nov, nov.lineas[0]).slice(15, 17), diario);
  assert.equal(nov.lineas, lineas);
  assert.equal(JSON.stringify(nov.lineas), originales);
  corregirDatosGeneralesLote(estado, [nov.id], { recibio_nombre: "RECEPTOR CORREGIDO" }, "Corregir firma por papel");
  assert.equal(nov.entrego_nombre, "RECEPTOR CORREGIDO");
  assert.ok(nov.campos_encabezado_corregidos.includes("entrego"));
  const diarioExportado = new LibroLeido(exportarVales(estado, bytesVales()).datos).hoja("DIARIO");
  assert.deepEqual([diarioExportado.valor(2, 16), diarioExportado.valor(2, 17)], ["RECEPTOR CORREGIDO", "ENTREGANTE DIARIO ORIGINAL"]);
  assert.equal(JSON.stringify(nov.lineas), originales);

  const porPapel = vale(2, "SALIDA", { migrado: true, depto_destino: "NOV", firmas_por_posicion: false });
  estado.vales.push(porPapel);
  const firmasPorPapel = firmasImpresas(modeloNov, porPapel);
  corregirDatosGeneralesLote(estado, [porPapel.id], { fecha: "2026-10-02" }, "Fecha con firmas por papel");
  assert.equal(porPapel.firmas_por_posicion, false);
  assert.deepEqual(firmasImpresas(modeloNov, porPapel), firmasPorPapel);
  assert.equal(firmasPorPosicion(estado, { ...porPapel, firmas_por_posicion: undefined, plantilla_area_id: 1 }), false, "La plantilla propia prevalece sobre el nombre de hoja");
  const porDepartamento = { ...estado, plantillas_area: [{ id: 3, depto_destino: "NOV", hoja_excel: "MECANICO ", almacenista_derecha: false }, ...estado.plantillas_area] };
  assert.equal(firmasPorPosicion(porDepartamento, { ...porPapel, firmas_por_posicion: undefined }), false, "El departamento del área prevalece sobre el nombre de hoja");
});

test("un campo igual al encabezado corrige discrepancias migradas sin tocar la partida", () => {
  const estado = preparar([vale(1, "SALIDA", { migrado: true })]);
  const v = estado.vales[0];
  v.lineas[0].encabezado_original = { fecha: "2026-09-01", recibio: "OTRA PERSONA", origen: "OTRO ORIGEN" };
  const originales = JSON.stringify(v.lineas);
  const vista = revisarCorreccionGeneral(estado, [v], { fecha: "2026-10-01", recibio_nombre: "PERSONA DOS" });
  assert.equal(vista.corregidos.length, 1);
  assert.equal(vista.vales[0].cambios.length, 2);
  corregirDatosGeneralesLote(estado, [1], { fecha: "2026-10-01", recibio_nombre: "PERSONA DOS" }, "Unificar cabecera");
  const valores = valoresRenglon(v, v.lineas[0]);
  assert.equal(isoDesdeSerial(valores[0].serial), "2026-10-01");
  assert.equal(valores[16], "PERSONA DOS");
  assert.equal(valores[4], "OTRO ORIGEN");
  assert.equal(JSON.stringify(v.lineas), originales);
  const antes = JSON.stringify(estado);
  corregirDatosGeneralesLote(estado, [1], { fecha: "2026-10-01", recibio_nombre: "PERSONA DOS" }, "Ya correcto");
  assert.equal(JSON.stringify(estado), antes);
});

test("la corrección no depende de validar materiales históricos ni personas no seleccionadas", () => {
  const v = vale(1, "SALIDA", { migrado: true, entrego_nombre: null, recibio_nombre: null });
  v.lineas[0].codigo = null;
  v.lineas[0].cantidad = "texto histórico";
  const estado = preparar([v]);
  const partidas = JSON.stringify(v.lineas);
  corregirDatosGeneralesLote(estado, [1], { fecha: "2026-10-04" }, "Fecha correcta");
  assert.equal(v.fecha, "2026-10-04");
  assert.equal(v.entrego_nombre, null);
  assert.equal(v.recibio_nombre, null);
  assert.equal(JSON.stringify(v.lineas), partidas);
});

test("exportar salidas corregidas cambia la cabecera y mantiene materiales y partes comprimidas intactas", () => {
  const estado = preparar([vale(1, "SALIDA", { migrado: true })]);
  const v = estado.vales[0];
  v.lineas[0].encabezado_original = { fecha: "2026-09-01", recibio: "OTRA PERSONA" };
  const original = bytesVales();
  const antes = valoresRenglon(v, v.lineas[0]);
  corregirDatosGeneralesLote(estado, [1], { fecha: "2026-10-05", recibio_nombre: "PERSONA NUEVA" }, "Encabezado actualizado");
  const resultado = exportarVales(estado, original);
  const hoja = new LibroLeido(resultado.datos).hoja("DIARIO");
  assert.equal(isoDesdeSerial(hoja.valor(2, 1).serial), "2026-10-05");
  assert.equal(hoja.valor(2, 17), "PERSONA NUEVA");
  assert.equal(resultado.renglones, 2);
  assert.deepEqual(valoresRenglon(v, v.lineas[0]).slice(8, 15), antes.slice(8, 15));
  const nuevos = new Map(leerZip(resultado.datos).map((entrada) => [entrada.nombre, entrada]));
  const modificadas = new Set(resultado.partesModificadas);
  for (const entrada of leerZip(original)) {
    if (!modificadas.has(entrada.nombre)) assert.deepEqual(nuevos.get(entrada.nombre).comprimido, entrada.comprimido, entrada.nombre);
  }
});

test("los campos disponibles sólo incluyen encabezado y reservan firmas extra para salidas", () => {
  assert.ok(CAMPOS_CORRECCION_GENERAL.every((campo) => campo.clave !== "lineas" && campo.tipos.length));
  assert.deepEqual(CAMPOS_CORRECCION_GENERAL.find((campo) => campo.clave === "autorizo_nombre").tipos, ["SALIDA"]);
  assert.deepEqual(CAMPOS_CORRECCION_GENERAL.find((campo) => campo.clave === "recibio_puesto").tipos, ["SALIDA", "ENTRADA"]);
});

test("recuerda vacíos explícitos en puestos, observaciones y firmas extra sin tocar las partidas", () => {
  const estado = preparar();
  const v = estado.vales[0];
  v.firma_extra_izq_nombre = "PERSONA EXTRA";
  v.firma_extra_izq_puesto = "PUESTO EXTRA";
  const lineas = v.lineas;
  const bytes = JSON.stringify(lineas);
  corregirDatosGeneralesLote(estado, [1], {
    entrego_puesto: "", recibio_puesto: " ", observaciones: null,
    firma_extra_izq_nombre: "", firma_extra_izq_puesto: "",
  }, "Quitar datos que no corresponden");
  for (const campo of ["entrego_puesto", "recibio_puesto", "observaciones", "firma_extra_izq_nombre", "firma_extra_izq_puesto"]) {
    assert.equal(v[campo], null);
    assert.ok(v.campos_encabezado_corregidos.includes(campo), campo);
  }
  assert.strictEqual(v.lineas, lineas);
  assert.equal(JSON.stringify(v.lineas), bytes);
  const anterior = JSON.stringify(estado);
  corregirDatosGeneralesLote(estado, [1], { entrego_puesto: "", observaciones: "" }, "Ya estaban vacíos");
  assert.equal(JSON.stringify(estado), anterior);
});

test("vaciar puestos u observaciones ya nulos quita la herencia una sola vez; nombres nulos siguen sin cambios", () => {
  const estado = preparar();
  const v = estado.vales[0];
  v.recibio_puesto = null;
  v.observaciones = null;
  v.autorizo_nombre = null;
  const lineas = v.lineas;
  const originales = JSON.stringify(lineas);
  const cambios = { recibio_puesto: "", observaciones: "", autorizo_nombre: "" };
  const vista = revisarCorreccionGeneral(estado, [v], cambios);
  assert.deepEqual(vista.vales[0].cambios.map(({ clave, antes, despues, descripcion }) => ({ clave, antes, despues, descripcion })), [
    { clave: "recibio_puesto", antes: null, despues: null, descripcion: "Puesto de quien recibe: dejar vacío" },
    { clave: "observaciones", antes: null, despues: null, descripcion: "Observaciones: dejar vacío" },
  ]);
  corregirDatosGeneralesLote(estado, [1], cambios, "Dejar estos datos vacíos");
  assert.deepEqual(v.campos_encabezado_corregidos, ["recibio_puesto", "observaciones"]);
  assert.strictEqual(v.lineas, lineas);
  assert.equal(JSON.stringify(v.lineas), originales);
  const anterior = JSON.stringify(estado);
  const repetido = corregirDatosGeneralesLote(estado, [1], cambios, "Siguen vacíos");
  assert.deepEqual(repetido.corregidos, []);
  assert.deepEqual(repetido.sinCambios, [v]);
  assert.equal(JSON.stringify(estado), anterior);
});
