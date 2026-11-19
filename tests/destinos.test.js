// Ronda 30 — el reporte diario guarda cada archivo en su carpeta, sin «Guardar como»: el inventario en
// <base>/<inventario>/<inventarios>/<año>/<mes> (del día del reporte) y el libro de vales en su archivo fijo.
// Las carpetas son de mentira (tests/ayudaCarpetas.js) con nombres inventados y las rarezas de las de verdad:
// meses escritos "05.MAYO" junto a "05. MAYO", "01. INVENTARIO" en uno y "01. INVENTARIOS" en otro, FX sin
// carpeta de inventarios.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLAVE_DESTINOS,
  abrirRuta,
  carpetasPara,
  claveCarpeta,
  destinoDe,
  hayArchivo,
  normalizarDestinos,
  normalizarRuta,
  problemaDeRuta,
  proponerRutas,
  rutaDeCarpetas,
} from "../src/almacen/destinos.js";
import { guardarEnSuLugar, textoDestino } from "../src/ui/paginas/carpetas.js";
import { Sesion } from "../src/ui/sesion.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { ArchivoFalso, arbol, meses } from "./ayudaCarpetas.js";
import { almacenReporteGsm, FECHA_REPORTE_GSM, PRIMER_FOLIO_GSM, ULTIMO_FOLIO_GSM } from "./ayudaReporteGsm.js";

const RUTA_DLTA = "ALMACEN DLTA/01. INVENTARIOS/{año}/{mes}";
const RUTA_GSM = "GSM PRUEBA/01. INVENTARIO/{año}/{mes}";

/** Como la carpeta del inventario diario del usuario, con nombres inventados. */
const ESTRUCTURA = () => ({
  FX: { 2026: meses(10, 11) },
  "GSM PRUEBA": {
    "01. INVENTARIO": {
      2025: { ...meses(1, 4), "05.MAYO": {}, "06. JUNIO": {}, "07.JULIO": {}, ...meses(8, 12) },
      2026: { ...meses(1, 4), "05.MAYO": {}, "06. JUNIO": {}, "07.JULIO": {}, ...meses(8, 11) },
    },
    "02. KARDEX": { 2026: meses(1, 1) },
  },
  "ALMACEN DLTA": {
    "01. INVENTARIOS": {
      2025: { "12. DICIEMBRE": {} },
      2026: { "01. ENERO": { "TOP DRIVE": {} }, ...meses(2, 3), "04.ABRIL": {}, "05.MAYO": {}, ...meses(6, 11) },
    },
    "02. KARDEX": { "10. OCTUBRE": {} },
  },
});
const base = () => arbol("INVENTARIO DIARIO", ESTRUCTURA());
const nombres = (camino) => camino.carpetas.map((c) => c.nombre);

test("la ruta para un día: {año} y {mes} (también sin ñ y con \\ de Windows)", () => {
  assert.deepEqual(carpetasPara(RUTA_DLTA, "2026-11-18").map((c) => c.nombre), ["ALMACEN DLTA", "01. INVENTARIOS", "2026", "11. NOVIEMBRE"]);
  assert.deepEqual(carpetasPara(RUTA_DLTA, "2026-11-18").map((c) => c.variable), [false, false, true, true]);
  assert.deepEqual(carpetasPara("FX\\{ano}\\{mm}.{nombre_mes}", "2026-05-02").map((c) => c.nombre), ["FX", "2026", "05.MAYO"]);
  assert.deepEqual(carpetasPara("{nombre_mes} {anio}", "2025-09-30").map((c) => c.nombre), ["SEPTIEMBRE 2025"]);
  assert.deepEqual(carpetasPara(" A / {AÑO} ", "2024-01-01").map((c) => c.nombre), ["A", "2024"]);
  assert.equal(normalizarRuta("ALMACEN DLTA\\01. INVENTARIOS\\\\{año}/"), "ALMACEN DLTA/01. INVENTARIOS/{año}");
});

test("rutas que no se pueden usar se explican", () => {
  assert.equal(problemaDeRuta(RUTA_DLTA), null);
  assert.equal(problemaDeRuta("FX/{ano}/{mm}. {nombre_mes}"), null);
  assert.match(problemaDeRuta("../OTRA/{año}"), /subir de carpeta/);
  assert.match(problemaDeRuta("C:\\Users\\x\\{año}"), /sin «C:\\»/);
  assert.match(problemaDeRuta("FX/{semana}"), /No conozco \{semana\}/);
  assert.match(problemaDeRuta("FX/{año"), /llave/);
  assert.match(problemaDeRuta("FX/A?B"), /Windows no permite/);
  assert.match(problemaDeRuta("FX/INV."), /punto o espacio/);
});

test("las carpetas se reconocen aunque estén escritas un poco distinto", () => {
  assert.equal(claveCarpeta("05.MAYO"), claveCarpeta("5. Mayo"));
  assert.equal(claveCarpeta("11.NOVIEMBRE"), claveCarpeta("11. NOVIEMBRE"));
  assert.equal(claveCarpeta("09. SETIEMBRE"), claveCarpeta("09. SEPTIEMBRE"));
  assert.equal(claveCarpeta("2026"), "2026");
  assert.notEqual(claveCarpeta("01. INVENTARIO"), claveCarpeta("01. INVENTARIOS"));
});

test("abrirRuta encuentra la carpeta del mes del día del reporte, también de días anteriores", async () => {
  const raiz = base();
  const hoy = await abrirRuta(raiz, RUTA_DLTA, "2026-11-18");
  assert.equal(hoy.carpeta, raiz.en("ALMACEN DLTA", "01. INVENTARIOS", "2026", "11. NOVIEMBRE"));
  assert.deepEqual(hoy.nuevas, []);
  assert.equal(hoy.falta, null);
  assert.equal(hoy.texto, "INVENTARIO DIARIO › ALMACEN DLTA › 01. INVENTARIOS › 2026 › 11. NOVIEMBRE");

  const julio = await abrirRuta(raiz, RUTA_GSM, "2026-07-15");
  assert.deepEqual(nombres(julio), ["GSM PRUEBA", "01. INVENTARIO", "2026", "07.JULIO"], "usa la que ya existe aunque esté escrita sin espacio");
  assert.equal(julio.carpeta, raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "07.JULIO"));

  const anterior = await abrirRuta(raiz, RUTA_DLTA, "2025-12-31");
  assert.equal(anterior.carpeta, raiz.en("ALMACEN DLTA", "01. INVENTARIOS", "2025", "12. DICIEMBRE"));

  const sinMayusculas = await abrirRuta(raiz, "almacen dlta/01. inventarios/{año}/{mes}", "2026-11-18");
  assert.equal(sinMayusculas.carpeta, hoy.carpeta);
  assert.deepEqual(nombres(sinMayusculas), ["ALMACEN DLTA", "01. INVENTARIOS", "2026", "11. NOVIEMBRE"], "con el nombre real");
});

test("el mes (o el año) que aún no tiene carpeta se crea solo al guardar; una carpeta fija que falta, nunca", async () => {
  const raiz = base();
  const revisar = await abrirRuta(raiz, RUTA_DLTA, "2026-12-01");
  assert.equal(revisar.carpeta, null);
  assert.deepEqual(revisar.nuevas, ["12. DICIEMBRE"]);
  assert.equal(raiz.en("ALMACEN DLTA", "01. INVENTARIOS", "2026", "12. DICIEMBRE"), undefined, "revisar no crea nada");
  const crear = await abrirRuta(raiz, RUTA_DLTA, "2026-12-01", { crear: true });
  assert.equal(crear.carpeta, raiz.en("ALMACEN DLTA", "01. INVENTARIOS", "2026", "12. DICIEMBRE"));
  assert.deepEqual(crear.nuevas, ["12. DICIEMBRE"]);

  const anio = await abrirRuta(raiz, RUTA_DLTA, "2027-01-04", { crear: true });
  assert.deepEqual(anio.nuevas, ["2027", "01. ENERO"]);
  assert.ok(raiz.en("ALMACEN DLTA", "01. INVENTARIOS", "2027", "01. ENERO"));

  const mal = await abrirRuta(raiz, "ALMACEN DLTA/01. INVENTARIO/{año}/{mes}", "2026-11-18", { crear: true });
  assert.equal(mal.carpeta, null);
  assert.deepEqual(mal.falta, { nombre: "01. INVENTARIO", dentro: "INVENTARIO DIARIO › ALMACEN DLTA", hay: ["01. INVENTARIOS"] });
  assert.equal(raiz.en("ALMACEN DLTA", "01. INVENTARIO"), undefined, "no se inventa la carpeta fija");

  const despues = await abrirRuta(raiz, "ALMACEN DLTA/{año}/FIJA/{mes}", "2030-03-01", { crear: true });
  assert.equal(despues.falta.nombre, "FIJA");
  assert.equal(raiz.en("ALMACEN DLTA", "2030"), undefined, "tampoco quedan carpetas a medias");
});

test("hayArchivo dice si el inventario del día ya está en su carpeta", async () => {
  const raiz = arbol("X", { "INV 181126.xlsx": "x", CARPETA: {} });
  assert.equal(await hayArchivo(raiz, "INV 181126.xlsx"), true);
  assert.equal(await hayArchivo(raiz, "inv 181126.xlsx"), true);
  assert.equal(await hayArchivo(raiz, "INV 171126.xlsx"), false);
  assert.equal(await hayArchivo(null, "x"), false);
});

test("al elegir la carpeta base se proponen las rutas de DLTA, GSM y FX con la forma de mes que ya se usa", async () => {
  assert.deepEqual(await proponerRutas(base()), { DLTA: RUTA_DLTA, GSM: RUTA_GSM, FX: "FX/{año}/{mes}" });
  // Un nivel más arriba (p. ej. la carpeta del equipo): la ruta empieza en la del inventario diario.
  const arriba = arbol("EQUIPO", { "INVENTARIO DIARIO": ESTRUCTURA(), OTRA: { "DLTA VIEJO NO": {} } });
  const propuestas = await proponerRutas(arriba);
  assert.equal(propuestas.DLTA, `INVENTARIO DIARIO/${RUTA_DLTA}`);
  assert.equal(propuestas.FX, "INVENTARIO DIARIO/FX/{año}/{mes}");
  // Meses solo con el nombre, y la base es la carpeta del propio inventario.
  const solo = arbol("ALMACEN DLTA", { 2026: { OCTUBRE: {}, NOVIEMBRE: {} } });
  assert.deepEqual(await proponerRutas(solo), { DLTA: "{año}/{nombre_mes}", GSM: null, FX: null });
  // Sin años todavía: se propone {año}/{mes} dentro de la de inventarios.
  const nueva = arbol("BASE", { "GSM NUEVO": { "01. INVENTARIOS": {}, "02. KARDEX": {} } });
  assert.equal((await proponerRutas(nueva)).GSM, "GSM NUEVO/01. INVENTARIOS/{año}/{mes}");
  assert.deepEqual(await proponerRutas(arbol("VACIA")), { DLTA: null, GSM: null, FX: null });
});

test("la carpeta elegida en el explorador se vuelve ruta: el año y el mes pasan a {año} y {mes}", () => {
  assert.equal(rutaDeCarpetas(["ALMACEN DLTA", "01. INVENTARIOS"]), RUTA_DLTA);
  assert.equal(rutaDeCarpetas(["ALMACEN DLTA", "01. INVENTARIOS", "2026"]), RUTA_DLTA);
  assert.equal(rutaDeCarpetas(["ALMACEN DLTA", "01. INVENTARIOS", "2026", "11. NOVIEMBRE"]), RUTA_DLTA);
  assert.equal(rutaDeCarpetas(["GSM PRUEBA", "01. INVENTARIO", "2026", "07.JULIO"]), "GSM PRUEBA/01. INVENTARIO/{año}/{mm}.{nombre_mes}");
  assert.equal(rutaDeCarpetas([]), "{año}/{mes}");
});

test("destinoDe: el inventario va a su ruta (FX a la de FX) y los vales a su archivo; sin destino, null", () => {
  const raiz = base();
  const libro = new ArchivoFalso("VALES DE SALIDA GSM.xlsm");
  const destinos = normalizarDestinos({ raiz, rutas: { GSM: RUTA_GSM, FX: "FX\\{año}\\{mes}", DLTA: "  " }, vales: { GSM: libro } });
  assert.deepEqual(destinos.rutas, { DLTA: null, GSM: RUTA_GSM, FX: "FX/{año}/{mes}" });
  assert.deepEqual(destinoDe(destinos, "INVENTARIO", "GSM"), { clase: "carpeta", raiz, ruta: RUTA_GSM, id: "GSM" });
  assert.equal(destinoDe(destinos, "INVENTARIO_FX", "GSM").ruta, "FX/{año}/{mes}");
  assert.deepEqual(destinoDe(destinos, "VALES", "GSM"), { clase: "archivo", archivo: libro, id: "GSM" });
  assert.equal(destinoDe(destinos, "INVENTARIO", "DLTA"), null);
  assert.equal(destinoDe(destinos, "VALES", "DLTA"), null);
  assert.equal(destinoDe(destinos, "ENTRADAS", "GSM"), null, "solo los del reporte diario");
  assert.equal(destinoDe({ ...destinos, raiz: null }, "INVENTARIO", "GSM"), null, "sin carpeta base");
  assert.equal(destinoDe({ ...destinos, rutas: { GSM: "../x" } }, "INVENTARIO", "GSM"), null, "una ruta con problema no se usa");
  assert.deepEqual(normalizarDestinos(null), { raiz: null, rutas: { DLTA: null, GSM: null, FX: null }, vales: { DLTA: null, GSM: null } });
});

// ---------------------------------------------------------------- el clic en «Descargar» (sin navegador)

const TODOS = Array.from({ length: ULTIMO_FOLIO_GSM - PRIMER_FOLIO_GSM + 1 }, (_, i) => PRIMER_FOLIO_GSM + i);
const folios = (datos) => {
  const diario = new LibroLeido(datos).hoja("DIARIO"), salida = [];
  for (let f = 2; f <= diario.maxFila; f++) if (Number.isInteger(diario.valor(f, 2))) salida.push(diario.valor(f, 2));
  return salida;
};
const esperar = async (condicion) => {
  for (let i = 0; i < 200 && !condicion(); i++) await new Promise((r) => setTimeout(r, 10));
};

/** window / document de mentira: confirmar responde `respuestas` en orden; las descargas se anotan. */
function navegador(t, { respuestas = [] } = {}) {
  const preguntas = [], descargas = [], guardarComo = [];
  const antes = { window: globalThis.window, document: globalThis.document, crear: URL.createObjectURL };
  globalThis.window = {
    confirm: (texto) => {
      preguntas.push(texto);
      return respuestas.length ? respuestas.shift() : true;
    },
    showSaveFilePicker: async (o) => {
      guardarComo.push(o.suggestedName);
      throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = { createElement: () => { const a = { click: () => descargas.push(a.download), remove() {} }; return a; }, body: { appendChild() {} }, hasFocus: () => true };
  URL.createObjectURL = () => "blob:prueba";
  t.after(() => {
    globalThis.window = antes.window;
    globalThis.document = antes.document;
    URL.createObjectURL = antes.crear;
  });
  return { preguntas, descargas, guardarComo, responder: (...r) => respuestas.push(...r) };
}

/** Que los avisos que quedaron no detengan la prueba esperando su tiempo. */
const sinAvisosAlTerminar = (t, sesion) => t.after(() => {
  for (const aviso of sesion.avisos) sesion.quitarAviso(aviso.id);
});

async function sesionGsm(t, { raiz = base(), rutas = { GSM: RUTA_GSM, FX: "FX/{año}/{mes}" }, libro = new ArchivoFalso("VALES DE SALIDA GSM.xlsm") } = {}) {
  const { almacen } = await almacenReporteGsm({ inventario: "GSM", conTabla: true });
  const sesion = new Sesion(almacen, almacen.backend);
  sinAvisosAlTerminar(t, sesion);
  await sesion._guardarDestinos({ raiz, rutas, vales: { GSM: libro } });
  return { sesion, raiz, libro };
}

const guardar = async (sesion, tipo, corte = FECHA_REPORTE_GSM, extra = {}) => {
  let resultado = null;
  await guardarEnSuLugar(sesion, tipo, (r) => { resultado = r; }, { corte }, extra);
  return resultado;
};

test("«Descargar» del reporte guarda el inventario en la carpeta del mes del día y el libro de vales en su archivo", async (t) => {
  const { preguntas } = navegador(t);
  const { sesion, raiz, libro } = await sesionGsm(t);
  const nombre = sesion.almacen.nombreExportacion("INVENTARIO", FECHA_REPORTE_GSM);
  assert.match(nombre, /231026\.xlsx$/);
  assert.equal(textoDestino(sesion, "INVENTARIO", FECHA_REPORTE_GSM), "INVENTARIO DIARIO › GSM PRUEBA › 01. INVENTARIO › 2026 › 10. OCTUBRE");
  assert.equal(textoDestino(sesion, "VALES", FECHA_REPORTE_GSM), "Reemplaza VALES DE SALIDA GSM.xlsm");

  const r = await guardar(sesion, "INVENTARIO");
  const octubre = raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "10. OCTUBRE");
  const archivo = octubre.hijo(nombre);
  assert.ok(archivo?.datos.length > 1000, "quedó el Excel completo en la carpeta de octubre");
  assert.ok(new LibroLeido(archivo.datos).nombresHojas.length > 0, "es un libro de Excel");
  assert.equal(r.elegido, true);
  assert.equal(r.enSuCarpeta, true);
  assert.equal(r.motivo, null);
  assert.deepEqual(r.nuevas, []);
  assert.equal(r.destino, `INVENTARIO DIARIO/GSM PRUEBA/01. INVENTARIO/2026/10. OCTUBRE/${nombre}`);
  assert.deepEqual(preguntas, [], "no existía: no se pregunta nada");
  assert.equal(sesion.estado.exportaciones.at(-1).archivo, r.destino);
  assert.match(sesion.avisos.at(-1).texto, /^Listo: «.*231026\.xlsx» en INVENTARIO DIARIO › GSM PRUEBA › 01\. INVENTARIO › 2026 › 10\. OCTUBRE$/);

  const v = await guardar(sesion, "VALES");
  assert.equal(v.elegido, true);
  assert.equal(v.destino, "VALES DE SALIDA GSM.xlsm");
  assert.deepEqual(folios(libro.datos), TODOS, "el libro fijado se reemplazó con el del cierre del día");
  assert.deepEqual(libro.pedidos, [], "ya tenía permiso: no se pidió");
});

test("si el inventario del día ya está en su carpeta, pregunta antes de reemplazarlo", async (t) => {
  const { preguntas, responder } = navegador(t);
  const { sesion, raiz } = await sesionGsm(t);
  await guardar(sesion, "INVENTARIO");
  const nombre = sesion.almacen.nombreExportacion("INVENTARIO", FECHA_REPORTE_GSM);
  const archivo = raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "10. OCTUBRE", nombre);
  assert.equal(archivo.escrituras, 1);
  const exportaciones = sesion.estado.exportaciones.length;

  responder(false);
  assert.equal(await guardar(sesion, "INVENTARIO"), null, "dijo que no: no se genera nada");
  assert.match(preguntas.at(-1), /Ya existe «.*231026\.xlsx» en INVENTARIO DIARIO › GSM PRUEBA › 01\. INVENTARIO › 2026 › 10\. OCTUBRE/);
  assert.match(preguntas.at(-1), /al cierre del 23\/10\/2026/);
  assert.equal(archivo.escrituras, 1);
  assert.equal(sesion.estado.exportaciones.length, exportaciones);

  responder(true);
  const r = await guardar(sesion, "INVENTARIO");
  assert.equal(r.elegido, true);
  assert.equal(archivo.escrituras, 2, "se reemplazó el mismo archivo");
});

test("un día de un mes (o año) sin carpeta: se crea al guardar y el aviso lo dice", async (t) => {
  navegador(t);
  const { sesion, raiz } = await sesionGsm(t);
  const r = await guardar(sesion, "INVENTARIO", "2026-12-01");
  assert.deepEqual(r.nuevas, ["12. DICIEMBRE"]);
  const nombre = sesion.almacen.nombreExportacion("INVENTARIO", "2026-12-01");
  assert.match(nombre, /011226\.xlsx$/);
  assert.ok(raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "12. DICIEMBRE", nombre));
  assert.match(sesion.avisos.at(-1).texto, /\(carpeta nueva: 12\. DICIEMBRE\)$/);
  // Un día anterior con carpeta ya hecha (y escrita "05.MAYO") va a esa, sin crear otra.
  const mayo = await guardar(sesion, "INVENTARIO", "2026-05-20");
  assert.deepEqual(mayo.nuevas, []);
  assert.match(mayo.destino, /\/2026\/05\.MAYO\//);
  assert.equal([...raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026").hijos.keys()].filter((n) => /MAYO/.test(n)).length, 1);
});

test("el permiso se pide dentro del clic; si Edge no lo da, no se genera nada y se ofrece «Guardar como…»", async (t) => {
  const { guardarComo } = navegador(t);
  const { sesion, raiz, libro } = await sesionGsm(t);
  raiz.permiso = "prompt";
  const r = await guardar(sesion, "INVENTARIO");
  assert.deepEqual(raiz.pedidos, ["permiso"]);
  assert.equal(r.elegido, true, "dio permiso: se guardó");

  libro.permiso = "prompt";
  libro.alPedir = "denied";
  const antes = sesion.estado.exportaciones.length;
  assert.equal(await guardar(sesion, "VALES"), null);
  assert.deepEqual(libro.pedidos, ["permiso"]);
  assert.equal(libro.escrituras, 0);
  assert.equal(sesion.estado.exportaciones.length, antes);
  const aviso = sesion.avisos.at(-1);
  assert.equal(aviso.tipo, "advertencia");
  assert.match(aviso.texto, /no dio permiso para guardar en «VALES DE SALIDA GSM\.xlsm»/);
  assert.equal(aviso.accion.etiqueta, "Guardar como…");
  await aviso.accion.alHacer();
  assert.deepEqual(guardarComo, ["VALES DE SALIDA GSM.xlsm"], "abre «Guardar como» con el nombre de siempre");
});

test("una carpeta fija que ya no existe: se explica con las parecidas y no se crea nada", async (t) => {
  navegador(t);
  const { sesion, raiz } = await sesionGsm(t, { rutas: { GSM: "GSM PRUEBA/01. INVENTARIOS/{año}/{mes}" } });
  assert.equal(await guardar(sesion, "INVENTARIO"), null);
  const aviso = sesion.avisos.at(-1);
  assert.equal(aviso.tipo, "error");
  assert.match(aviso.texto, /No encontré la carpeta «01\. INVENTARIOS» en INVENTARIO DIARIO › GSM PRUEBA \(ahí hay «01\. INVENTARIO»/);
  assert.match(aviso.texto, /ruta de GSM en «Carpetas…»/);
  assert.equal(aviso.accion.etiqueta, "Guardar como…");
  assert.equal(raiz.en("GSM PRUEBA", "01. INVENTARIOS"), undefined);
});

test("si Windows no deja escribir ahí: el Excel va a Descargas, no queda un archivo vacío y se puede reintentar", async (t) => {
  const { descargas, preguntas } = navegador(t);
  const { sesion, raiz, libro } = await sesionGsm(t);
  // El libro de vales abierto en Excel: se queda como estaba, el Excel va a Descargas y la ventana con dibujos lo explica.
  libro.bloqueado = true;
  const v = await guardar(sesion, "VALES");
  assert.equal(v.elegido, false);
  assert.equal(v.causa, "abierto");
  assert.equal(v.destino, "Descargas/VALES DE SALIDA GSM.xlsm");
  assert.deepEqual(descargas, ["VALES DE SALIDA GSM.xlsm"]);
  assert.equal(libro.escrituras, 0);
  assert.equal(sesion.dialogo.tipo, "no-guardado");
  libro.bloqueado = false;
  const reintento = sesion.dialogo.reintentar;
  sesion.cerrarDialogo();
  await reintento();
  await esperar(() => libro.escrituras === 1);
  assert.deepEqual(folios(libro.datos), TODOS, "«Ya lo cerré: guardar otra vez» lo guarda en su archivo");

  // El inventario nuevo que no se pudo escribir no deja un archivo vacío en la carpeta del mes.
  const octubre = raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "10. OCTUBRE");
  const crear = octubre.getFileHandle.bind(octubre);
  octubre.getFileHandle = async (n, o) => Object.assign(await crear(n, o), { bloqueado: true });
  const r = await guardar(sesion, "INVENTARIO");
  assert.equal(r.elegido, false);
  assert.match(r.destino, /^Descargas\//);
  assert.equal(octubre.hijo(r.nombre), undefined, "se quitó el archivo vacío");
  assert.deepEqual(preguntas, []);
});

test("sin destino fijado se abre «Guardar como» como antes; el libro de vales con vales posteriores pregunta", async (t) => {
  const { guardarComo, preguntas, responder } = navegador(t);
  const { sesion, libro } = await sesionGsm(t, { rutas: {}, libro: null });
  assert.equal(textoDestino(sesion, "INVENTARIO", FECHA_REPORTE_GSM), null);
  await guardar(sesion, "INVENTARIO");
  assert.equal(guardarComo.length, 1);
  assert.equal(libro, null);

  const fijado = new ArchivoFalso("VALES DE SALIDA GSM.xlsm");
  await sesion._guardarDestinos({ ...sesion.destinos, vales: { GSM: fijado } });
  responder(false);
  const antes = () => window.confirm("¿Reemplazarlo?");
  assert.equal(await guardar(sesion, "VALES", FECHA_REPORTE_GSM, { antes }), null);
  assert.equal(fijado.escrituras, 0, "dijo que no");
  assert.equal(preguntas.at(-1), "¿Reemplazarlo?");
  await guardar(sesion, "VALES", FECHA_REPORTE_GSM, { antes });
  assert.equal(fijado.escrituras, 1);
});

test("los destinos se eligen con el explorador, se guardan en la base común y se quitan", async (t) => {
  navegador(t);
  const { almacen } = await almacenReporteGsm({ inventario: "GSM", conTabla: true });
  const comun = new (almacen.backend.constructor)();
  const sesion = new Sesion(almacen, almacen.backend, { comun });
  sinAvisosAlTerminar(t, sesion);
  const raiz = base();
  window.showDirectoryPicker = async () => raiz;
  const elegida = await sesion.elegirCarpetaReporte();
  assert.equal(elegida.raiz, raiz);
  assert.deepEqual(sesion.destinos.rutas, { DLTA: RUTA_DLTA, GSM: RUTA_GSM, FX: "FX/{año}/{mes}" });
  const guardado = await comun.leerAjuste(CLAVE_DESTINOS);
  assert.equal(guardado.raiz, raiz, "vive en la base común (la misma para DLTA y GSM)");
  assert.equal(await almacen.backend.leerAjuste(CLAVE_DESTINOS), null);

  // Explorar: la carpeta elegida dentro de la base (hasta el mes) se vuelve la ruta con {año} y {mes}.
  window.showDirectoryPicker = async () => raiz.en("GSM PRUEBA", "01. INVENTARIO", "2026", "11. NOVIEMBRE");
  assert.equal(await sesion.explorarRutaReporte("GSM"), RUTA_GSM);
  window.showDirectoryPicker = async () => arbol("FUERA");
  await assert.rejects(sesion.explorarRutaReporte("GSM"), /no está dentro de «INVENTARIO DIARIO»/);
  await sesion.fijarRutaReporte("GSM", "GSM PRUEBA\\01. INVENTARIO\\{año}\\{mm}.{nombre_mes}");
  assert.equal(sesion.destinos.rutas.GSM, "GSM PRUEBA/01. INVENTARIO/{año}/{mm}.{nombre_mes}");
  await sesion.fijarRutaReporte("GSM", "   ");
  assert.equal(sesion.destinos.rutas.GSM, null, "vacía = «Guardar como»");

  // Elegir la misma base otra vez solo llena lo vacío.
  await sesion.fijarRutaReporte("DLTA", "OTRA/{año}");
  window.showDirectoryPicker = async () => raiz;
  await sesion.elegirCarpetaReporte();
  assert.equal(sesion.destinos.rutas.DLTA, "OTRA/{año}");
  assert.equal(sesion.destinos.rutas.GSM, RUTA_GSM);

  // Libro de vales: el que ya existe, con la extensión del libro de este inventario.
  const libro = new ArchivoFalso("VALES DE SALIDA GSM.xlsm");
  window.showOpenFilePicker = async (o) => {
    assert.deepEqual(o.types[0].accept, { "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"] });
    return [libro];
  };
  assert.equal(await sesion.elegirLibroVales("GSM"), libro);
  assert.equal(sesion.destinos.vales.GSM, libro);
  window.showOpenFilePicker = async () => [new ArchivoFalso("VALES DE SALIDA GSM.xlsx")];
  await assert.rejects(sesion.elegirLibroVales("GSM"), /sale como \.xlsm/);
  window.showOpenFilePicker = async () => [new ArchivoFalso("VALES DE SALIDA DLTA.xlsm")];
  window.confirm = () => false;
  assert.equal(await sesion.elegirLibroVales("GSM"), null, "dice DLTA: se pregunta y no se cambia");
  assert.equal(sesion.destinos.vales.GSM, libro);
  window.showOpenFilePicker = async () => { throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" }); };
  assert.equal(await sesion.elegirLibroVales("GSM"), null);

  await sesion.quitarDestinoReporte({ vales: "GSM", ruta: "FX" });
  assert.equal(sesion.destinos.vales.GSM, null);
  assert.equal(sesion.destinos.rutas.FX, null);
  assert.equal((await comun.leerAjuste(CLAVE_DESTINOS)).rutas.FX, null);
  // Otra sesión (el otro inventario o al volver a abrir) lee lo mismo de la base común.
  const otra = new Sesion(almacen, almacen.backend, { comun });
  otra.destinos = normalizarDestinos(await otra._bdDestinos.leerAjuste(CLAVE_DESTINOS));
  assert.equal(otra.destinos.raiz, raiz);
  assert.equal(otra.destinos.rutas.GSM, RUTA_GSM);
});
