// Ronda 22: la lógica del editor de diseños de etiqueta que no necesita navegador (impresion/lienzo.js):
// conversión px ↔ % ↔ mm, zoom para ajustar, mover y cambiar el tamaño sin salirse de la etiqueta, imán
// a la cuadrícula, guías de alineación, flechas, deshacer / rehacer (con cambios juntados), agregar /
// duplicar / quitar / ordenar elementos y los avisos de lectura de QR y código de barras.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as l from "../src/impresion/lienzo.js";
import { LADO_MINIMO, MAXIMO_ELEMENTOS, MODELOS_FABRICA, TITULOS_CAMPO, normalizarElemento } from "../src/impresion/modelos.js";

const caja = (x, y, w, h) => ({ x, y, w, h });
const dentro = (c) => c.x >= 0 && c.y >= 0 && c.w >= LADO_MINIMO && c.h >= LADO_MINIMO && c.x + c.w <= 100.0001 && c.y + c.h <= 100.0001;

test("conversiones px ↔ % ↔ mm y la letra en mm / px", () => {
  assert.equal(l.pxAPorciento(50, 200), 25);
  assert.equal(l.pxAPorciento(10, 0), 0);
  assert.equal(l.porcientoAPx(25, 200), 50);
  assert.equal(l.porcientoAMm(50, 92), 46);
  assert.equal(l.porcientoAMm(33.333, 39), 13);
  assert.equal(l.mmAPorciento(46, 92), 50);
  assert.equal(l.mmAPorciento(5, 0), 0);
  // 6.78 % de 39 mm ≈ 2.64 mm ≈ 10 px (la letra de la plantilla de antes).
  const m = l.letraEnMedidas(6.78, 39);
  assert.equal(m.mm, 2.64);
  assert.equal(m.px, 10);
  assert.ok(Math.abs(m.pt - 7.5) < 0.1);
});

test("zoom para ajustar la etiqueta al espacio y pasos de zoom acotados", () => {
  // 92 × 39 mm en 1000 × 500 px con 24 px de margen: manda el ancho (952 / 92).
  assert.ok(Math.abs(l.zoomParaAjustar(92, 39, 1000, 500) - 952 / 92) < 1e-9);
  // Muy bajo: manda el alto.
  assert.ok(Math.abs(l.zoomParaAjustar(92, 39, 2000, 300) - 252 / 39) < 1e-9);
  assert.equal(l.zoomParaAjustar(92, 39, 10, 10), 1);
  assert.equal(l.zoomParaAjustar(1, 1, 5000, 5000), 40);
  assert.equal(l.zoomParaAjustar(0, 39, 1000, 500), 1);
  assert.equal(l.siguienteZoom(10, 1), 12.5);
  assert.equal(l.siguienteZoom(10, -1), 8);
  assert.equal(l.siguienteZoom(39, 1), 40);
  assert.equal(l.siguienteZoom(1, -1), 1);
});

test("imán a la cuadrícula", () => {
  assert.equal(l.imantar(12.4, 1), 12);
  assert.equal(l.imantar(12.6, 1), 13);
  assert.equal(l.imantar(12.6, 5), 15);
  assert.equal(l.imantar(12.34, 0), 12.34);
  assert.equal(l.imantar(12.34, -1), 12.34);
  assert.equal(l.imantar(0.7, 2), 0);
});

test("mover una caja nunca la saca de la etiqueta", () => {
  assert.deepEqual(l.moverCaja(caja(10, 10, 20, 20), 5, -3), caja(15, 7, 20, 20));
  assert.deepEqual(l.moverCaja(caja(10, 10, 20, 20), 500, 500), caja(80, 80, 20, 20));
  assert.deepEqual(l.moverCaja(caja(10, 10, 20, 20), -500, -500), caja(0, 0, 20, 20));
  // A dos decimales, como los modelos.
  assert.deepEqual(l.moverCaja(caja(10, 10, 20, 20), 0.333333, 0.666666), caja(10.33, 10.67, 20, 20));
  // Flechas: 0.5 % y, con Shift, 5 %.
  assert.deepEqual(l.moverConTecla(caja(10, 10, 20, 20), "ArrowRight"), caja(10.5, 10, 20, 20));
  assert.deepEqual(l.moverConTecla(caja(10, 10, 20, 20), "ArrowUp", true), caja(10, 5, 20, 20));
  assert.deepEqual(l.moverConTecla(caja(0, 0, 20, 20), "ArrowLeft", true), caja(0, 0, 20, 20));
  assert.deepEqual(l.moverConTecla(caja(10, 79.8, 20, 20), "ArrowDown"), caja(10, 80, 20, 20));
  assert.equal(l.moverConTecla(caja(1, 1, 1, 1), "Enter"), null);
});

test("x / y / ancho / alto escritos: el otro lado se respeta y todo queda dentro", () => {
  // Ancho de más: se acota a lo que queda hasta la orilla, x no se mueve.
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { w: 80 }), caja(50, 10, 50, 20));
  // x de más: se acota para que quepa el ancho, el ancho no cambia.
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { x: 95 }), caja(80, 10, 20, 20));
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { h: 0 }), caja(50, 10, 20, LADO_MINIMO));
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { y: -4 }), caja(50, 0, 20, 20));
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { x: NaN, w: "30" }), caja(50, 10, 20, 20));
  assert.deepEqual(l.fijarCaja(caja(50, 10, 20, 20), { x: 12.345 }), caja(12.35, 10, 20, 20));
});

test("cambiar el tamaño con cada una de las 8 asas", () => {
  const c = caja(20, 20, 40, 40);
  assert.deepEqual(l.ASAS, ["no", "n", "ne", "e", "se", "s", "so", "o"]);
  assert.deepEqual(l.redimensionar(c, "e", 10, 99), caja(20, 20, 50, 40));
  assert.deepEqual(l.redimensionar(c, "o", 10, 99), caja(30, 20, 30, 40));
  assert.deepEqual(l.redimensionar(c, "s", 99, 10), caja(20, 20, 40, 50));
  assert.deepEqual(l.redimensionar(c, "n", 99, 10), caja(20, 30, 40, 30));
  assert.deepEqual(l.redimensionar(c, "se", 5, 5), caja(20, 20, 45, 45));
  assert.deepEqual(l.redimensionar(c, "no", -5, -5), caja(15, 15, 45, 45));
  assert.deepEqual(l.redimensionar(c, "ne", 5, -5), caja(20, 15, 45, 45));
  assert.deepEqual(l.redimensionar(c, "so", -5, 5), caja(15, 20, 45, 45));
  // Nunca sale de la etiqueta.
  assert.deepEqual(l.redimensionar(c, "se", 500, 500), caja(20, 20, 80, 80));
  assert.deepEqual(l.redimensionar(c, "no", -500, -500), caja(0, 0, 60, 60));
  // Ni queda más chica que el mínimo: el borde contrario se queda fijo.
  assert.deepEqual(l.redimensionar(c, "e", -500, 0), caja(20, 20, LADO_MINIMO, 40));
  assert.deepEqual(l.redimensionar(c, "o", 500, 0), caja(60 - LADO_MINIMO, 20, LADO_MINIMO, 40));
  assert.deepEqual(l.redimensionar(c, "n", 0, 500), caja(20, 60 - LADO_MINIMO, 40, LADO_MINIMO));
  // Muchos movimientos al azar: siempre dentro.
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280) * 300 - 150;
  for (let i = 0; i < 500; i++) {
    const asa = l.ASAS[i % 8];
    const r = l.redimensionar(c, asa, azar(), azar());
    assert.ok(dentro(r), `${asa} ${JSON.stringify(r)}`);
    assert.ok(dentro(l.moverCaja(r, azar(), azar())));
  }
});

test("guías: orillas y centros de la etiqueta y de los demás elementos", () => {
  const elementos = [
    { id: "a", x: 10, y: 20, w: 30, h: 10 },
    { id: "b", x: 50, y: 50, w: 20, h: 20 },
  ];
  const g = l.lineasGuia(elementos, { salvo: "b" });
  assert.deepEqual(g.x, [0, 10, 25, 40, 50, 100]);
  assert.deepEqual(g.y, [0, 20, 25, 30, 50, 100]);
  const ajuste = l.mejorAjuste([9.4, 30], [0, 10, 50], 1);
  assert.equal(ajuste.linea, 10);
  assert.ok(Math.abs(ajuste.delta - 0.6) < 1e-9);
  assert.equal(l.mejorAjuste([5], [0, 10], 1), null);
  // Arrastrar b cerca de la orilla izquierda de a: se pega (guía en x = 10).
  const m = l.moverArrastrando(elementos[1], -39.3, 0, { lineas: g, umbral: { x: 1, y: 1 } });
  assert.equal(m.caja.x, 10);
  assert.ok(m.guias.x.includes(10));
  // Su centro con el centro de la etiqueta.
  const c = l.moverArrastrando(elementos[1], -9.6, 0, { lineas: g, umbral: { x: 1, y: 1 } });
  assert.equal(c.caja.x, 40);
  assert.ok(c.guias.x.includes(50));
  // Sin guía cerca: imán a la cuadrícula de 5 %.
  const r = l.moverArrastrando(elementos[1], -17.2, 0, { lineas: g, umbral: { x: 1, y: 1 }, paso: 5 });
  assert.equal(r.caja.x, 35);
  // Sin imán (Alt): libre y sin guías.
  const libre = l.moverArrastrando(elementos[1], -39.3, 0.37, { lineas: g, umbral: { x: 1, y: 1 }, paso: 5, iman: false });
  assert.deepEqual(libre.caja, { id: "b", x: 10.7, y: 50.37, w: 20, h: 20 });
  assert.deepEqual(libre.guias, { x: [], y: [] });
  // La guía nunca la saca de la etiqueta.
  const orilla = l.moverArrastrando(caja(0, 0, 30, 30), 75, 0, { lineas: { x: [100, 104], y: [] }, umbral: { x: 5, y: 5 } });
  assert.equal(orilla.caja.x, 70);
});

test("cambiar el tamaño con guías e imán solo en los bordes que se mueven", () => {
  const g = { x: [0, 50, 72, 100], y: [0, 50, 100] };
  const r = l.redimensionarArrastrando(caja(20, 20, 40, 40), "e", 11.6, 0, { lineas: g, umbral: { x: 1, y: 1 } });
  assert.deepEqual(r.caja, caja(20, 20, 52, 40));
  assert.deepEqual(r.guias.x, [72]);
  // El borde que no se mueve (izq = 20) no cuenta como guía aunque coincida.
  const g2 = { x: [20, 72], y: [] };
  assert.deepEqual(l.redimensionarArrastrando(caja(20, 20, 40, 40), "e", 11.6, 0, { lineas: g2 }).guias.x, [72]);
  // Imán a la cuadrícula sin guías cerca.
  const p = l.redimensionarArrastrando(caja(20, 20, 40, 40), "se", 3.4, 6.6, { lineas: { x: [], y: [] }, paso: 5 });
  assert.deepEqual(p.caja, caja(20, 20, 45, 45));
  // Sin imán: libre.
  const s = l.redimensionarArrastrando(caja(20, 20, 40, 40), "se", 3.4, 6.6, { lineas: g, paso: 5, iman: false });
  assert.deepEqual(s.caja, caja(20, 20, 43.4, 46.6));
});

test("deshacer y rehacer, con cambios seguidos juntados en un paso", () => {
  let h = l.historial([1]);
  assert.equal(l.puedeDeshacer(h), false);
  h = l.empujar(h, [1, 2], { ahora: 0 });
  h = l.empujar(h, [1, 2, 3], { ahora: 10 });
  assert.deepEqual(h.presente, [1, 2, 3]);
  assert.equal(h.pasado.length, 2);
  // Lo mismo no cuenta como cambio.
  assert.equal(l.empujar(h, [1, 2, 3], { ahora: 20 }), h);
  h = l.deshacer(h);
  assert.deepEqual(h.presente, [1, 2]);
  assert.equal(l.puedeRehacer(h), true);
  h = l.rehacer(h);
  assert.deepEqual(h.presente, [1, 2, 3]);
  h = l.deshacer(l.deshacer(h));
  assert.deepEqual(h.presente, [1]);
  assert.equal(l.deshacer(h), h);
  // Un cambio nuevo borra lo que se podía rehacer.
  h = l.empujar(h, [9], { ahora: 30 });
  assert.equal(l.puedeRehacer(h), false);
  assert.equal(l.rehacer(h), h);
  // Letras escritas en el mismo campo (misma clave, seguidas): un solo paso.
  let t = l.historial("");
  t = l.empujar(t, "E", { clave: "e1:texto", ahora: 0 });
  t = l.empujar(t, "ET", { clave: "e1:texto", ahora: 300 });
  t = l.empujar(t, "ETI", { clave: "e1:texto", ahora: 600 });
  assert.equal(t.pasado.length, 1);
  assert.deepEqual(l.deshacer(t).presente, "");
  // Con pausa larga, o con otra clave, ya son pasos aparte.
  t = l.empujar(t, "ETIQ", { clave: "e1:texto", ahora: 5000 });
  t = l.empujar(t, "ETIQ!", { clave: "e2:texto", ahora: 5100 });
  assert.equal(t.pasado.length, 3);
  // Después de deshacer, no se junta con lo anterior.
  t = l.deshacer(t);
  t = l.empujar(t, "ETIQ?", { clave: "e2:texto", ahora: 5200 });
  assert.equal(t.pasado.length, 3);
  // Límite de pasos.
  let lim = l.historial(0, { limite: 3 });
  for (let i = 1; i <= 10; i++) lim = l.empujar(lim, i, { ahora: i * 10000 });
  assert.deepEqual(lim.pasado, [7, 8, 9]);
});

test("agregar, duplicar, quitar y ordenar elementos", () => {
  let els = [];
  const a = l.agregarElemento(els, "texto");
  assert.equal(a.id, "texto-1");
  assert.equal(a.elementos[0].texto, "Texto libre");
  els = a.elementos;
  // Otro del mismo tipo no queda exactamente encima.
  const b = l.agregarElemento(els, "texto");
  assert.equal(b.id, "texto-2");
  assert.notDeepEqual(l.cajaDe(b.elementos[1]), l.cajaDe(b.elementos[0]));
  els = b.elementos;
  const c = l.agregarElemento(els, "campo", { campo: "dimension" });
  assert.equal(c.id, "dimension-1");
  assert.equal(c.elementos.at(-1).etiqueta, TITULOS_CAMPO.dimension);
  els = c.elementos;
  assert.equal(l.agregarElemento(els, "linea"), null);
  assert.equal(l.agregarElemento(els, "logo_izq").id, "logo-izq-1");
  // Duplicar: justo encima del original, corrido y con id nuevo.
  const d = l.duplicarElemento(els, "texto-1");
  assert.equal(d.id, "texto-3");
  assert.deepEqual(d.elementos.map((e) => e.id), ["texto-1", "texto-3", "texto-2", "dimension-1"]);
  assert.notDeepEqual(l.cajaDe(d.elementos[1]), l.cajaDe(d.elementos[0]));
  assert.equal(l.duplicarElemento(els, "no-existe"), null);
  // De un modelo de fábrica (ids sin número).
  const f = l.duplicarElemento([...MODELOS_FABRICA["fabrica-material"].elementos], "codigo");
  assert.equal(f.id, "codigo-1");
  assert.deepEqual(l.quitarElemento(els, "texto-2").map((e) => e.id), ["texto-1", "dimension-1"]);
  assert.deepEqual(l.alFrente(els, "texto-1").map((e) => e.id), ["texto-2", "dimension-1", "texto-1"]);
  assert.deepEqual(l.alFondo(els, "dimension-1").map((e) => e.id), ["dimension-1", "texto-1", "texto-2"]);
  assert.equal(l.alFrente(els, "nada"), els);
  // Máximo de elementos.
  let muchos = [];
  for (let i = 0; i < MAXIMO_ELEMENTOS; i++) muchos = l.agregarElemento(muchos, "qr").elementos;
  assert.equal(new Set(muchos.map((e) => e.id)).size, MAXIMO_ELEMENTOS);
  assert.ok(muchos.every((e) => dentro(e)));
  assert.equal(l.agregarElemento(muchos, "qr"), null);
  assert.equal(l.duplicarElemento(muchos, muchos[0].id), null);
});

test("cambiar propiedades deja el elemento limpio; el título del campo sigue al campo", () => {
  const els = [normalizarElemento({ id: "c", tipo: "campo", campo: "codigo", x: 10, y: 10, w: 30, h: 10 })];
  let r = l.cambiarElemento(els, "c", { letra: 500, alinear: "raro", negrita: "si" });
  assert.equal(r[0].letra, 80);
  assert.equal(r[0].alinear, "izq");
  assert.equal(r[0].negrita, false);
  r = l.cambiarElemento(els, "c", { campo: "nombre" });
  assert.equal(r[0].etiqueta, TITULOS_CAMPO.nombre);
  // Un título propio se respeta.
  const propio = l.cambiarElemento(els, "c", { etiqueta: "MI CÓDIGO" });
  assert.equal(l.cambiarElemento(propio, "c", { campo: "np" })[0].etiqueta, "MI CÓDIGO");
  // No cambia el tipo ni el id; un campo desconocido no se acepta.
  r = l.cambiarElemento(els, "c", { tipo: "qr", id: "x", campo: "precio" });
  assert.equal(r[0].tipo, "campo");
  assert.equal(r[0].id, "c");
  assert.equal(r[0].campo, "codigo");
  assert.deepEqual(l.conCaja(els, "c", caja(1, 2, 3, 4))[0].x, 1);
});

test("nombre libre para un diseño nuevo y datos predefinidos de QR / barras", () => {
  assert.equal(l.nombreLibre([]), "Diseño nuevo");
  assert.equal(l.nombreLibre(["diseño  NUEVO", "Diseño nuevo 2"]), "Diseño nuevo 3");
  assert.equal(l.datosPredefinidos("{codigo}"), "codigo");
  assert.equal(l.datosPredefinidos(" {CODIGO}   {dimension} "), "codigo_dimension");
  assert.equal(l.datosPredefinidos("OC {codigo}"), "libre");
  assert.equal(l.datosPredefinidos(null), "libre");
  assert.equal(l.MARCADORES.length, 7);
});

test("avisos de lectura: QR chico, barras delgadas o bajas", () => {
  const etiqueta = { codigo: "1739", dimension: "3VX900" };
  const diseno = { ancho: 92, alto: 39 };
  // QR de 22 % × 52 % en 92 × 39 mm = 20.2 × 20.3 mm: bien.
  assert.deepEqual(l.avisosLectura({ id: "q", tipo: "qr", x: 70, y: 40, w: 22, h: 52 }, etiqueta, diseno), []);
  // De 10 mm de lado: aviso.
  const chico = l.avisosLectura({ id: "q", tipo: "qr", x: 0, y: 0, w: 11, h: 26 }, etiqueta, diseno);
  assert.equal(chico.length, 1);
  assert.match(chico[0], /10\.1 mm de lado/);
  // Tan chico que ya no se lee: lo dice avisosElemento, no aquí.
  assert.deepEqual(l.avisosLectura({ id: "q", tipo: "qr", x: 0, y: 0, w: 4, h: 4 }, etiqueta, diseno), []);
  // Vacío o demasiado largo: también lo dice avisosElemento.
  assert.deepEqual(l.avisosLectura({ id: "q", tipo: "qr", datos: "{np}", x: 0, y: 0, w: 11, h: 26 }, etiqueta, diseno), []);
  // Barras: «1739» en Code 128 C = 57 módulos + 20 de zona muda = 77; en 60 % de 92 mm = 0.72 mm: bien.
  assert.deepEqual(l.avisosLectura({ id: "b", tipo: "barras", x: 20, y: 40, w: 60, h: 40 }, etiqueta, diseno), []);
  // En 18 % (16.6 mm) = 0.215 mm: aviso de delgadas.
  const delgadas = l.avisosLectura({ id: "b", tipo: "barras", x: 0, y: 40, w: 18, h: 40 }, etiqueta, diseno);
  assert.equal(delgadas.length, 1);
  assert.match(delgadas[0], /0\.22 mm/);
  assert.match(delgadas[0], /20 mm de ancho/);
  // Bajas: 12 % de 39 mm = 4.7 mm menos el texto de abajo.
  const bajas = l.avisosLectura({ id: "b", tipo: "barras", x: 20, y: 40, w: 60, h: 12, texto_visible: false }, etiqueta, diseno);
  assert.equal(bajas.length, 1);
  assert.match(bajas[0], /4\.7 mm de alto/);
  // Otros tipos: nada.
  assert.deepEqual(l.avisosLectura({ id: "t", tipo: "titulo" }, etiqueta, diseno), []);
  assert.deepEqual(l.avisosLectura(null, etiqueta, diseno), []);
});
