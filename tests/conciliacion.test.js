// Fase 4: conciliación contra AX con un reporte SINTÉTICO (tests/fixtures/generar.py).

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportarSolicitudAjuste, filasSolicitud, nombreSolicitud } from "../src/exportadores/ajuste.js";
import { sinDimension } from "../src/nucleo/normalizar.js";
import { ErrorReporteAx, delAlmacen, fechaDeNombre, leerReporteAx } from "../src/importadores/ax.js";
import * as c from "../src/servicios/conciliacion.js";
import * as en from "../src/servicios/entradas.js";
import { candidatosExactos, indiceExistencias } from "../src/servicios/primeraCarga.js";
import { Indices } from "../src/nucleo/estado.js";
import { descomprimirZip } from "../src/xlsx/zip.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { NOMBRE_AX, bytesAx, bytesInventario, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

function conCorte({ fecha = null, folioSalida = null, extra = [] } = {}) {
  const { estado } = cargaSintetica();
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const corte = c.registrarCorteAx(
    estado,
    { fecha: fecha ?? reporte.fechaSugerida, almacen: "RIG91-IX25", archivo: NOMBRE_AX, huella: "abc", folioSalida, renglones: [...delAlmacen(reporte.renglones, "RIG91-IX25"), ...extra] },
    USUARIO,
  );
  return { estado, corte };
}

/** Confirma todas las sugerencias como lo haría el usuario con "Es esta". */
function confirmarTodo(estado, corte) {
  for (const p of c.conciliar(estado, corte).porConfirmar) c.confirmarPareja(estado, { corteId: corte.id, lineaId: p.linea.id, varianteId: p.variante_id }, USUARIO);
}

const renglonDe = (r, codigo, dimension) => r.renglones.find((x) => x.codigo === codigo && x.variante.dimension === dimension);

test("importar el reporte de AX: columnas por nombre, almacenes, fecha del nombre y textos como vienen", () => {
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  assert.equal(reporte.hoja, "rptInventSumDateTransForDimensi");
  assert.equal(reporte.fechaSugerida, "2026-09-05");
  assert.deepEqual(reporte.almacenes, [
    { nombre: "RIG91-IX25", renglones: 17 },
    { nombre: "RIG48-XX10", renglones: 1 },
  ]);
  const propios = delAlmacen(reporte.renglones, "rig91-ix25");
  assert.equal(propios.length, 17);
  assert.equal(propios.find((r) => r.codigo === 136).modelo, "NO INV");
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
  // El diésel (modelo NO INV) no se concilia.
  assert.equal(pares.some((p) => p.linea.codigo === 136), false);
});

test("solo se concilia el modelo INV: los códigos de otro modelo tampoco cuentan del lado físico", () => {
  const { estado, corte } = conCorte();
  assert.deepEqual(c.conciliar(estado, corte).fisicoSinAx.map((x) => x.codigo), [799]);
  // Si AX trae el 799 como servicio (no INV), su renglón físico deja de compararse.
  const otro = conCorte({ extra: [{ fila: 99, codigo: 799, codigo_texto: "000000799", nombre: "SERVICIO", modelo: "SERV", um: "PZA", almacen: "RIG91-IX25", tamano: "", color: "", disponible: "3", valor_financiero: "30", valor_inventario: "30" }] });
  const r = c.conciliar(otro.estado, otro.corte);
  assert.deepEqual(r.fisicoSinAx, []);
  assert.equal(r.porCodigo.some((x) => x.codigo === 799 || x.codigo === 136), false);
  assert.equal(r.resumen.no_inv, 2);
  assert.equal(c.lineasInv(otro.corte).length, 16);
  // Un reporte sin la columna de modelo se concilia completo.
  assert.equal(c.lineasInv({ lineas: [{ codigo: 1, modelo: "" }, { codigo: 2, modelo: "" }] }).length, 2);
});

test("criterio F4: confirmar una pareja corrige el inventario a como lo escribe AX (sin memoria aparte)", () => {
  const { estado, corte } = conCorte();
  const antes = c.conciliar(estado, corte).resumen;
  assert.ok(antes.porcentaje < 100);
  const dedo = c.conciliar(estado, corte).porConfirmar.find((p) => p.linea.tamano === "P55I317");
  const variante = estado.variantes.find((v) => v.id === dedo.variante_id);
  assert.deepEqual(c.valoresAx(dedo.linea, variante), { dimension: "P55I317", np: "", cortado: false });
  // Sesión: se confirman las sugerencias → se corrige la dimensión de la variante.
  confirmarTodo(estado, corte);
  assert.equal(variante.dimension, "P55I317");
  assert.deepEqual(variante.claves_anteriores, ["P551317"]);
  assert.deepEqual(estado.equivalencias_ax, {});
  const despues = c.conciliar(estado, corte).resumen;
  assert.ok(despues.porcentaje >= 95, `emparejado: ${despues.porcentaje}%`);
  assert.equal(despues.por_confirmar, 0);
  assert.equal(c.emparejar(estado, corte).find((p) => p.linea.tamano === "P55I317").metodo, "exacto");
  assert.ok(estado.auditoria.some((a) => a.accion === "CORREGIR_CLAVE" && a.despues.clave === "P55I317"));
  // Los vales viejos que escribían "P551317" siguen encontrando su renglón.
  const indices = new Indices(estado);
  assert.equal(candidatosExactos(indiceExistencias(estado, indices), indices, 702, "P551317").length, 1);
  // Siguiente corte (otra fecha): empareja exacto, sin preguntar.
  const reporte = leerReporteAx(bytesAx(), NOMBRE_AX);
  const segundo = c.registrarCorteAx(estado, { fecha: "2026-09-19", almacen: "RIG91-IX25", renglones: delAlmacen(reporte.renglones, "RIG91-IX25") }, USUARIO);
  assert.equal(c.conciliar(estado, segundo).resumen.por_confirmar, 0);
  // "No está en físico" se anota solo en ese corte; olvidar la deja otra vez a elección.
  const linea = segundo.lineas.find((l) => l.tamano === "P557500");
  c.confirmarPareja(estado, { corteId: segundo.id, lineaId: linea.id, varianteId: null }, USUARIO);
  assert.equal(c.emparejar(estado, segundo).find((p) => p.linea === linea).metodo, "sin_pareja");
  assert.equal(c.emparejar(estado, corte).find((p) => p.linea.tamano === "P557500").metodo, "exacto");
  c.olvidarPareja(estado, { corteId: segundo.id, lineaId: linea.id }, USUARIO);
  assert.equal(c.emparejar(estado, segundo).find((p) => p.linea === linea).metodo, "exacto");
});

const lineaAx = (codigo, tamano, disponible = "1") => ({ fila: 90, codigo, codigo_texto: String(codigo).padStart(9, "0"), nombre: "ARTICULO", modelo: "INV", um: "PZA", almacen: "RIG91-IX25", tamano, color: "", disponible, valor_financiero: "10", valor_inventario: "10" });

test("una partida del inventario solo es pareja de una partida de AX (no se ofrece si ya tiene pareja)", () => {
  // Como ACP6034 / ACP6044: dos partidas de AX parecidas del mismo código y una sola en el físico libre.
  const { estado, corte } = conCorte({ extra: [lineaAx(702, "P55I318")] });
  const v = (dimension) => estado.variantes.find((x) => x.codigo === 702 && x.dimension === dimension);
  const libre = v("P551317");
  const exacta = v("P557500"); // pareja exacta de la partida de AX "P557500"
  const par = (tamano) => c.emparejar(estado, corte).find((p) => p.linea.tamano === tamano);
  // Nunca se ofrece la que ya es pareja exacta, y la libre se sugiere a una sola partida (la más parecida).
  for (const tamano of ["P55I317", "P55I318"]) assert.ok(!par(tamano).candidatos.some((x) => x.variante_id === exacta.id));
  assert.deepEqual([par("P55I317").metodo, par("P55I317").variante_id], ["aproximado", libre.id]);
  assert.deepEqual([par("P55I318").metodo, par("P55I318").variante_id], ["sin_sugerencia", null]);
  // Se confirma la primera: la variante pasa a P55I317 y ya no se ofrece para la segunda.
  c.confirmarPareja(estado, { corteId: corte.id, lineaId: par("P55I317").linea.id, varianteId: libre.id }, USUARIO);
  assert.equal(libre.dimension, "P55I317");
  const segunda = par("P55I318");
  assert.deepEqual([segunda.metodo, segunda.candidatos, segunda.ocupadas], ["sin_sugerencia", [], 2]);
  assert.throws(
    () => c.confirmarPareja(estado, { corteId: corte.id, lineaId: segunda.linea.id, varianteId: libre.id }, USUARIO),
    (e) => e instanceof c.ErrorConciliacion && /ya es la pareja de 702 P55I317/.test(e.message),
  );
  assert.equal(libre.dimension, "P55I317"); // no se tocó
  // "No está en el físico" sí se puede.
  c.confirmarPareja(estado, { corteId: corte.id, lineaId: segunda.linea.id, varianteId: null }, USUARIO);
  assert.equal(par("P55I318").metodo, "sin_pareja");
});

test("al ajustar, no se puede juntar con una variante que ya es pareja de otra partida de AX", () => {
  const { estado, corte } = conCorte({ extra: [lineaAx(701, "6309-2Z/C4")] });
  // Variante libre del 701 con otra escritura (se sugiere para "6309-2Z/C4").
  const indices = new Indices(estado);
  const suelta = indices.obtenerOCrearVariante(701, "6309 2Z C4", null, "PZA");
  indices.agregarExistencia({ variante_id: suelta.id, ubicacion_id: estado.ubicaciones[0].id, orden: 99, cantidad_conteo: "1", conteo_id: null });
  const linea = corte.lineas.find((l) => l.tamano === "6309-2Z/C4");
  assert.equal(c.emparejar(estado, corte).find((p) => p.linea === linea).variante_id, suelta.id);
  // Escribirle la dimensión de la que ya es pareja exacta de "6309-2Z/C3" las juntaría: no se permite.
  assert.throws(
    () => c.confirmarPareja(estado, { corteId: corte.id, lineaId: linea.id, varianteId: suelta.id, dimension: "6309-2Z/C3", np: "" }, USUARIO),
    (e) => e instanceof c.ErrorConciliacion && /ya es la pareja de 701 6309-2Z\/C3/.test(e.message),
  );
  // A como está en AX, sí.
  c.confirmarPareja(estado, { corteId: corte.id, lineaId: linea.id, varianteId: suelta.id }, USUARIO);
  assert.equal(suelta.dimension, "6309-2Z/C4");
});

test("en AX la dimensión es Tamaño + Color (AX no trae NP)", () => {
  const { estado, corte } = conCorte();
  const empaque = corte.lineas.find((l) => l.codigo === 704);
  const variante = estado.variantes.find((v) => v.codigo === 704);
  // El inventario anotó el Color como NP: empareja, y al corregir la dimensión queda completa y el NP se vacía.
  assert.equal(c.emparejar(estado, corte).find((p) => p.linea === empaque).metodo, "exacto");
  assert.deepEqual(c.valoresAx(empaque, variante), { dimension: '6" FLEXITALIC', np: "", cortado: false });
  assert.equal(c.dimensionAx(empaque), '6" FLEXITALIC');
  assert.ok(c.cuadraConAx(empaque, { dimension: '6" FLEXITALIC', np: "" }));
  // Tamaño cortado a 10 + Color: la dimensión completa empieza con el Tamaño y termina con el Color.
  assert.ok(c.cuadraConAx({ tamano: "MARIPOSA 4", color: "ROJO" }, { dimension: 'MARIPOSA 4" ROJO', np: "" }));
  assert.ok(!c.cuadraConAx({ tamano: "MARIPOSA 4", color: "ROJO" }, { dimension: 'MARIPOSA 4" AZUL', np: "" }));
  // Un NP distinto del Color se conserva.
  assert.equal(c.valoresAx({ tamano: "1/2", color: "ROJO" }, { np: "X-1" }).np, "X-1");
});

test("las parejas recordadas por la versión anterior se vuelven a proponer y, al confirmarlas, corrigen el inventario", () => {
  const { estado, corte } = conCorte();
  const linea = corte.lineas.find((l) => l.tamano === "P55I317");
  const variante = estado.variantes.find((v) => v.codigo === 702 && v.dimension === "P551317");
  estado.equivalencias_ax[c.claveAx(linea)] = { variante_id: variante.id, codigo: 702, tamano: linea.tamano, color: "" };
  const par = c.emparejar(estado, corte).find((p) => p.linea === linea);
  assert.deepEqual([par.metodo, par.confirmado, par.variante_id], ["recordada", false, variante.id]);
  c.confirmarPareja(estado, { corteId: corte.id, lineaId: linea.id, varianteId: variante.id, dimension: "P55I317", np: "" }, USUARIO);
  assert.equal(variante.dimension, "P55I317");
  assert.deepEqual(estado.equivalencias_ax, {});
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
  // La base reconoce la entrada por el folio de su vale (B-1), no por el interno (E-0001).
  assert.deepEqual([conEntrada.estado, conEntrada.entradas.toFixed(), conEntrada.folios], ["explicada", "2", ["B-1 (E)"]]);
});

test("solicitud de ajuste: las columnas del reporte AX + existencia física + folios + estado con color; lo físico sin AX al final", () => {
  const { estado, corte } = conCorte();
  confirmarTodo(estado, corte);
  const { datos, nombre, renglones } = exportarSolicitudAjuste(estado, corte);
  assert.equal(nombre, "SOLICITUD DE AJUSTE RIG 91 DLTA 050926.xlsx");
  assert.equal(nombreSolicitud("2026-09-27"), "SOLICITUD DE AJUSTE RIG 91 DLTA 270926.xlsx");
  assert.equal(nombreSolicitud("2026-09-27", "GSM"), "SOLICITUD DE AJUSTE RIG 91 GSM 270926.xlsx");
  const hoja = new LibroLeido(datos).hoja("rptInventSumDateTransForDimensi");
  assert.deepEqual(hoja.fila(1, 1, 13), [
    "Código de Artículo", "Nombre del Artículo", "Modelo de Inventario", "Unidad de Medida", "Almacén", "Tamaño", "Color",
    "Disponible", "Valor Financiero", "Valor de Inventario", "Existencia física", "Folios que justifican", "Estado",
  ]);
  const filas = [];
  for (let f = 2; f <= hoja.maxFila; f++) filas.push(hoja.fila(f, 1, 13));
  assert.equal(filas.length, renglones);
  const fila = (tamano) => filas.find((x) => x[5] === tamano);
  assert.equal(fila('1/2"')[0], "000000705"); // código como texto, con sus ceros
  assert.deepEqual([String(fila('1/2"')[7]), String(fila('1/2"')[10]), fila('1/2"')[11]], ["100", "98", "9 (S)"]);
  assert.equal(String(fila('6"')[10]), "130");
  assert.equal(fila("6205-2Z"), undefined); // cuadra: no va
  assert.equal(String(fila("CABLE 3/4")[10]), "0"); // en AX, no en físico
  const ultima = filas.at(-1); // físico sin AX
  assert.deepEqual([ultima[0], ultima[5], String(ultima[7]), String(ultima[10])], ["000000799", "SIN DIMENSION", "0", "1"]);
  // Estado en texto y la fila con su color (verde, azul, amarillo, rojo).
  assert.deepEqual([fila('1/2"')[12], fila('6"')[12], fila("CABLE 3/4")[12], ultima[12]], ["Explicada por vales", "Sobrante", "Faltante", "Sobrante"]);
  assert.equal(filas.some((x) => x[0] === "000000136"), false); // diésel: no es INV
  const estilos = new TextDecoder().decode(descomprimirZip(datos).get("xl/styles.xml"));
  for (const color of ["DDEBF7", "FFEB9C", "FFC7CE"]) assert.match(estilos, new RegExp(`rgb="FF${color}"`));
  // Con todos, también los que cuadran (en verde).
  const todos = exportarSolicitudAjuste(estado, corte, { todos: true });
  assert.ok(todos.renglones > renglones);
  assert.match(new TextDecoder().decode(descomprimirZip(todos.datos).get("xl/styles.xml")), /rgb="FFC6EFCE"/);
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

test("vista general («Todos»): cada partida INV del reporte sale una vez (también por confirmar y sin físico) y los conteos cuadran", () => {
  const { estado, corte } = conCorte();
  const r = c.conciliar(estado, corte);
  const idsAx = r.general.flatMap((x) => (x.lineas ?? (x.linea ? [x.linea] : [])).map((l) => l.id));
  assert.deepEqual([...idsAx].sort((a, b) => a - b), c.lineasInv(corte).map((l) => l.id).sort((a, b) => a - b));
  assert.equal(new Set(idsAx).size, idsAx.length);
  const porConfirmar = r.general.filter((x) => x.estado === "por_confirmar");
  assert.equal(porConfirmar.length, r.porConfirmar.length);
  assert.ok(porConfirmar.length > 0 && porConfirmar.every((x) => x.fisico === null && x.linea));
  // Lo que solo está en el físico también, y cada mosaico cuenta lo mismo que su filtro.
  assert.equal(r.general.filter((x) => !x.linea && !x.lineas).length, r.fisicoSinAx.length);
  for (const [estadoFila, cuenta] of [["faltante", "faltantes"], ["sobrante", "sobrantes"], ["cuadra", "cuadran"], ["explicada", "explicadas"]]) {
    assert.equal(r.general.filter((x) => x.estado === estadoFila).length, r.resumen[cuenta], estadoFila);
  }
  assert.ok(r.general.every((x, i) => i === 0 || r.general[i - 1].codigo <= x.codigo), "ordenado por código");
});

test("AX sin dimensión (Tamaño y Color vacíos): junta las variantes sin dimensión, o el código completo si es su única partida", () => {
  const { estado, corte } = conCorte();
  const pares = c.emparejar(estado, corte);
  const variante = (id) => estado.variantes.find((v) => v.id === id);
  const par = (codigo, tamano) => pares.find((p) => p.linea.codigo === codigo && p.linea.tamano === tamano);
  // 711 también tiene MOD:A1 en AX: la de sin dimensión junta solo S/D, SIN DIMENSION y S/N (NP distintos).
  const foco = par(711, "");
  assert.deepEqual([foco.metodo, foco.confirmado], ["sin_dimension", true]);
  assert.deepEqual(foco.grupo.map((id) => variante(id).np).sort(), ["LED 20W", "LED 50W", "X100"]);
  assert.equal(variante(foco.variante_id).np, "LED 20W"); // la de más existencia
  assert.equal(par(711, "MOD:A1").metodo, "exacto");
  // 714 solo tiene esa partida en AX: es el código completo, también la de dimensión MOD:ZX100.
  const mano = par(714, "");
  assert.deepEqual([mano.metodo, mano.grupo.map((id) => variante(id).dimension).sort()], ["todo_el_codigo", ["MOD:ZX100", "S/D"]]);
  // Si el Color trae algo (S/D + X00489 = un NP), se empareja normal.
  assert.equal(par(710, "S/D").metodo, "exacto");
  // En la conciliación cada una es UNA fila con el físico de todas sus variantes; nada queda "solo en el físico".
  const r = c.conciliar(estado, corte);
  const fila = (codigo, tamano) => r.renglones.find((x) => x.codigo === codigo && x.lineas.some((l) => l.tamano === tamano));
  assert.deepEqual([fila(711, "").variante_ids.length, fila(711, "").fisico.toFixed(), fila(711, "").ax.toFixed(), fila(711, "").estado], [3, "7", "7", "cuadra"]);
  assert.deepEqual([fila(714, "").variante_ids.length, fila(714, "").fisico.toFixed(), fila(714, "").estado], [2, "8", "cuadra"]);
  assert.equal(c.textoFisico(fila(714, "")), "Todo el código (2 variantes)");
  assert.equal(c.textoFisico(fila(711, "")), "Sin dimensión (3 variantes)");
  assert.deepEqual(r.fisicoSinAx.map((x) => x.codigo), [799]);
  // El inventario no se corrige (AX no trae dimensión que copiar).
  assert.equal(estado.variantes.filter((v) => v.codigo === 711 && v.claves_anteriores?.length).length, 0);
  // En la solicitud (con todas) el físico de la fila va completo en su partida de AX.
  const filas = filasSolicitud(r, corte, { todos: true });
  const deAx = filas.find((x) => x[0] === "000000714");
  assert.deepEqual([String(deAx[10]), deAx[12]], ["8", "cuadra"]);
});

test("sinDimension: vacía, S/D, SIN DIMENSIÓN, S/N… o que empieza así", () => {
  for (const t of ["", null, "S/D", "SIN DIMENSION", "SIN DIMENSIÓN", "Sin dimención", "S/N", "S/D NP: 1/4\"", "S/D CABLE UTP"]) assert.equal(sinDimension(t), true, String(t));
  for (const t of ["MOD:ZX100", "6309-2Z/C3", "SD-12", '1/2"']) assert.equal(sinDimension(t), false, t);
});
