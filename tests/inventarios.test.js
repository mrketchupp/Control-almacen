// Ronda 17: dos inventarios (DLTA y GSM) por separado, y los logos y textos del vale impreso de cada
// uno. Datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { ErrorRespaldo, crearRespaldo, infoDeNombre, leerRespaldo, nombreRespaldo, respaldosABorrar } from "../src/almacen/respaldos.js";
import { delAlmacen, leerReporteAx } from "../src/importadores/ax.js";
import { analizarFormulario } from "../src/impresion/formulario.js";
import { coincidencias, encabezadoDelFormato, identidadDe, logosDelFormato, reemplazarTextos, textosDelFormato } from "../src/impresion/identidad.js";
import { documentoImpresion, paginaHtml, valoresDeVale } from "../src/impresion/vale.js";
import { FORMATO_ESTADO, estadoVacio, migrarEstado } from "../src/nucleo/estado.js";
import { deOtroInventario, inventarioDe, inventarioDelNombre, inventarioPorId, otrosInventarios } from "../src/nucleo/inventarios.js";
import { registrarCorteAx } from "../src/servicios/conciliacion.js";
import { ErrorValeImpreso, fijarLogoVale, guardarTextosVale } from "../src/servicios/valeImpreso.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { NOMBRE_AX, bytesAx, bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";

async function almacenDe(inventario) {
  const almacen = new Almacen(new BackendMemoria(), { version: "prueba", inventario });
  await almacen.iniciar();
  const { estado } = cargaSintetica({ idInventario: inventario });
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: `INVENTARIO ${inventario} SINTETICO.xlsx`, datos: bytesInventario() },
    { tipo: "VALES", nombre: `VALES DE SALIDA ${inventario} SINTETICO.xlsm`, datos: bytesVales() },
  ]);
  return almacen;
}

function emitir(estado, hoja = "MECANICO") {
  const area = estado.plantillas_area.find((p) => p.nombre === hoja);
  const b = v.nuevoBorrador(estado, { usuario: USUARIO, plantillaId: area.id, fecha: "2026-10-01" });
  b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "10", um: "LTS" });
  return v.emitirBorrador(estado, b.id, { capacidad: 50 })[0];
}

test("inventarios: por id, por el nombre del archivo y los demás", () => {
  assert.equal(inventarioPorId("gsm").id, "GSM");
  assert.equal(inventarioPorId("otro").id, "DLTA");
  assert.deepEqual(otrosInventarios("GSM"), ["DLTA"]);
  assert.equal(inventarioDelNombre("VALES_DE_SALIDA_DLTA.xlsm"), "DLTA");
  assert.equal(inventarioDelNombre("DELTA RIG 91 27-09-26.xlsx"), "DLTA");
  assert.equal(inventarioDelNombre("INVENTARIO GSM 280926.xlsx"), "GSM");
  assert.equal(inventarioDelNombre("INVENTARIO_GSM280926.xlsx"), "GSM");
  assert.equal(inventarioDelNombre("PROGSMX.xlsx"), null); // GSM dentro de otra palabra no cuenta
  assert.equal(inventarioDelNombre("DELTA GSM.xlsx"), null); // nombra a los dos: no se sabe
  assert.equal(deOtroInventario("VALES_DE_SALIDA_DLTA.xlsm", "GSM"), "DLTA");
  assert.equal(deOtroInventario("VALES_DE_SALIDA_DLTA.xlsm", "DLTA"), null);
  assert.equal(deOtroInventario("reporte.xlsx", "GSM"), null);
});

test("formato 9: los estados anteriores son de DLTA; uno nuevo dice de qué inventario es", () => {
  const viejo = cargaSintetica().estado;
  delete viejo.config.inventario;
  viejo.formato = 8;
  migrarEstado(viejo);
  assert.deepEqual([viejo.formato, viejo.config.inventario], [FORMATO_ESTADO, "DLTA"]);
  assert.equal(estadoVacio("GSM").config.inventario, "GSM");
  const gsm = cargaSintetica({ idInventario: "GSM" }).estado;
  assert.deepEqual([inventarioDe(gsm).id, gsm.config.almacen_ax], ["GSM", null]);
  assert.equal(cargaSintetica().estado.config.almacen_ax, "RIG91-IX25");
});

test("respaldos: GSM con su prefijo; la limpieza de uno no toca los del otro", () => {
  assert.equal(nombreRespaldo("2026-10-07T08:09:10", "manual"), "almacen_2026-10-07_080910_manual.zip");
  assert.equal(nombreRespaldo("2026-10-07T08:09:10", "manual", "GSM"), "almacen_GSM_2026-10-07_080910_manual.zip");
  assert.equal(infoDeNombre("almacen_GSM_2026-10-07_080910_manual.zip"), null);
  assert.equal(infoDeNombre("almacen_2026-10-07_080910_manual.zip", "GSM"), null);
  assert.equal(infoDeNombre("almacen_GSM_2026-10-07_080910_manual.zip", "GSM").fecha, "2026-10-07");
  const nombres = [];
  for (let d = 1; d <= 3; d++) {
    for (const h of ["080000", "180000"]) {
      nombres.push(`almacen_2026-10-0${d}_${h}_auto.zip`, `almacen_GSM_2026-10-0${d}_${h}_auto.zip`);
    }
  }
  const dlta = respaldosABorrar(nombres, { diarios: 1, mensuales: 1 });
  const gsm = respaldosABorrar(nombres, { diarios: 1, mensuales: 1, inventario: "GSM" });
  assert.equal(dlta.length, 5);
  assert.ok(dlta.every((n) => !n.startsWith("almacen_GSM_")));
  assert.equal(gsm.length, 5);
  assert.ok(gsm.every((n) => n.startsWith("almacen_GSM_")));
  const { estado } = cargaSintetica({ idInventario: "GSM" });
  const respaldo = crearRespaldo(estado, [], { ahora: "2026-10-07T08:09:10" });
  assert.equal(respaldo.nombre, "almacen_GSM_2026-10-07_080910_manual.zip");
  assert.equal(leerRespaldo(respaldo.datos).manifiesto.inventario, "GSM");
});

test("cada inventario por separado: folios, nombres de exportación y respaldos que no se cruzan", async () => {
  const dlta = await almacenDe("DLTA");
  const gsm = await almacenDe("GSM");
  assert.equal(gsm.estado.config.inventario, "GSM");
  const folio = v.siguienteFolio(gsm.estado);
  await gsm.modificar((e) => emitir(e));
  assert.equal(v.siguienteFolio(gsm.estado), folio + 1);
  assert.equal(v.siguienteFolio(dlta.estado), folio); // DLTA no se entera
  assert.equal(gsm.nombreExportacion("ENTRADAS"), "VALES DE ENTRADA GSM.xlsx");
  assert.equal(dlta.nombreExportacion("ENTRADAS"), "VALES DE ENTRADA DLTA.xlsx");
  assert.equal(gsm.nombreExportacion("VALES"), "VALES DE SALIDA GSM SINTETICO.xlsm");
  const { nombre } = await gsm.exportar("ENTRADAS", USUARIO, "2026-10-07");
  assert.equal(nombre, "VALES DE ENTRADA GSM.xlsx");
  const corte = await gsm.modificar((e) => registrarCorteAx(e, { fecha: "2026-09-05", almacen: "RIG91-IX25", renglones: delAlmacen(leerReporteAx(bytesAx(), NOMBRE_AX).renglones, "RIG91-IX25") }, USUARIO));
  assert.equal(gsm.nombreExportacion("AJUSTE", "2026-10-07", { corteAx: corte.id }), "SOLICITUD DE AJUSTE RIG 91 GSM 050926.xlsx");
  // Un respaldo de DLTA no entra en GSM (ni al revés); el suyo sí.
  const deDlta = await dlta.respaldo("manual");
  const deGsm = await gsm.respaldo("manual");
  assert.match(deGsm.nombre, /^almacen_GSM_/);
  assert.throws(() => gsm.restaurar(deDlta.datos), (e) => e instanceof ErrorRespaldo && /es del inventario DLTA y estás en GSM/.test(e.message));
  assert.throws(() => dlta.restaurar(deGsm.datos), ErrorRespaldo);
  const antes = gsm.estado.vales.length;
  await gsm.restaurar(deGsm.datos);
  assert.equal(gsm.estado.vales.length, antes);
  // La primera carga no acepta datos de otro inventario.
  const vacio = new Almacen(new BackendMemoria(), { inventario: "GSM" });
  await vacio.iniciar();
  await assert.rejects(() => vacio.cargarPrimeraVez(cargaSintetica().estado, []), /son del inventario DLTA y estás en GSM/);
});

// ------------------------------------------------------------------ vale impreso

const libro = new LibroLeido(bytesVales());

test("reemplazos de texto: sin importar mayúsculas ni espacios de más, en orden; lo que no es texto queda igual", () => {
  const reglas = [{ buscar: "mx dlta  alm 1", poner: "MX GSM ALM 2" }, { buscar: "calle ficticia", poner: "AV. INVENTADA" }];
  assert.equal(reemplazarTextos("ALMACEN:MX DLTA ALM 1", reglas), "ALMACEN:MX GSM ALM 2");
  assert.equal(reemplazarTextos("CALLE  FICTICIA 123", reglas), "AV. INVENTADA 123");
  assert.equal(reemplazarTextos("PRECIO (1.5) $", [{ buscar: "(1.5) $", poner: "X" }]), "PRECIO X"); // sin regex
  assert.equal(reemplazarTextos(551, reglas), 551);
  assert.equal(reemplazarTextos("ALGO", [{ buscar: "  ", poner: "Z" }]), "ALGO");
});

test("textos y logos del formato: lo que dice DLTA se sugiere y cada regla dice dónde aparece", () => {
  const modelos = ["SOLDADOR", "MECANICO ", "TRANSFERENCIAS", "NOV"].map((h) => analizarFormulario(libro, h));
  const textos = textosDelFormato(modelos);
  const almacen = textos.find((t) => t.texto === "MX DLTA ALM 1");
  assert.deepEqual([almacen.marca, almacen.hojas], ["DLTA", 4]);
  assert.ok(textos.some((t) => t.texto === "FORMATO-PRUEBA")); // también el pie de página
  assert.deepEqual(coincidencias(textos, [{ buscar: "DLTA" }, { buscar: "NO EXISTE" }]), [2, 0]);
  const logos = logosDelFormato(modelos);
  assert.equal(logos.length, 1); // el mismo logo en las hojas se cuenta una vez
  assert.match(logos[0].huella, /^[0-9a-f]{8}-\d+$/);
});

test("encabezado del archivo: textos fijos arriba de Origen y el pie de página, sin lo que llena el vale", () => {
  const modelos = ["SOLDADOR", "NOV"].map((h) => analizarFormulario(libro, h));
  const encabezado = encabezadoDelFormato(modelos);
  const textos = encabezado.map((t) => t.texto);
  for (const t of ["MX DLTA ALM 1", "ALMACEN:MX DLTA ALM 1", "CALLE FICTICIA 123, COL. PRUEBA", "Fecha:"]) assert.ok(textos.includes(t), t);
  assert.ok(!textos.includes("XXXXX")); // la marca de salida la pone el vale
  assert.ok(!textos.some((t) => /^Origen/.test(t) || /CANTIDAD/.test(t))); // de Origen para abajo no es encabezado
  assert.deepEqual(encabezado.filter((t) => t.zona === "pie").map((t) => t.texto), ["FORMATO-PRUEBA", "Emision: X"]);
  assert.equal(encabezado.find((t) => t.texto === "MX DLTA ALM 1").hojas, 2);
});

test("al imprimir cambian los textos fijos y el logo, no los datos del vale", () => {
  const { estado } = cargaSintetica({ idInventario: "GSM" });
  const vale = emitir(estado, "SOLDADOR");
  vale.observaciones = "MX DLTA ALM 1 (ESCRITO EN EL VALE)";
  const m = analizarFormulario(libro, "SOLDADOR");
  const [logo] = logosDelFormato([m]);
  const nuevo = "data:image/png;base64,iVBORw0KGgo=";
  guardarTextosVale(estado, [{ buscar: "MX DLTA ALM 1", poner: "MX GSM ALM 2" }, { buscar: "mx dlta alm 1", poner: "repetida" }, { buscar: " ", poner: "x" }], USUARIO);
  assert.deepEqual(estado.config.vale_impreso.textos, [{ buscar: "MX DLTA ALM 1", poner: "MX GSM ALM 2" }]);
  fijarLogoVale(estado, logo.huella, { src: nuevo, nombre: "logo gsm.png" }, USUARIO);
  const html = paginaHtml(m, valoresDeVale(m, vale), [], identidadDe(estado));
  assert.match(html, />MX GSM ALM 2</);
  assert.match(html, />ALMACEN:MX GSM ALM 2</);
  assert.doesNotMatch(html, />MX DLTA ALM 1</);
  assert.match(html, /MX DLTA ALM 1 \(ESCRITO EN EL VALE\)/); // lo capturado en el vale no se toca
  assert.ok(html.includes(nuevo) && !html.includes(logo.src));
  // Sin cambios, como siempre.
  const original = documentoImpresion([{ modelo: m, vale }]).html;
  assert.match(original, />MX DLTA ALM 1</);
  // Quitar el logo y volver al original.
  fijarLogoVale(estado, logo.huella, { quitar: true }, USUARIO);
  assert.doesNotMatch(paginaHtml(m, new Map(), [], identidadDe(estado)), /<img/);
  fijarLogoVale(estado, logo.huella, null, USUARIO);
  assert.deepEqual(estado.config.vale_impreso.logos, {});
  assert.throws(() => fijarLogoVale(estado, logo.huella, { src: "data:text/html;base64,PGI+" }), ErrorValeImpreso);
  assert.equal(estado.auditoria.filter((a) => a.entidad === "config" && String(a.entidad_id).startsWith("vale_impreso")).length, 4);
  // Va en los respaldos (es parte del estado).
  const { estado: leido } = leerRespaldo(crearRespaldo(estado, []).datos);
  assert.equal(leido.config.vale_impreso.textos[0].poner, "MX GSM ALM 2");
});
