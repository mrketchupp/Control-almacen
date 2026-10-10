// Ronda 22: diseños de etiqueta (en el código, «modelos»): normalización estricta de lo que llega
// sincronizado o de un respaldo, render de cada elemento, los de fábrica (como la etiqueta de las Rondas
// 20–21), las 5 plantillas, QR y código de barras dentro del HTML, y el servicio (guardar, borrar,
// reponer, usar) con su bitácora. Datos SINTÉTICOS.

import assert from "node:assert/strict";
import { test } from "node:test";
import { svgBarras } from "../src/impresion/barras.js";
import {
  DISENO_DEFECTO,
  MARGEN_QR,
  PLANTILLAS,
  avisosElemento,
  cssEtiqueta,
  cuadricula,
  documentoEtiquetas,
  htmlElemento,
  htmlEtiqueta,
  llenarPlantilla,
  muestraEtiqueta,
  normalizarDiseno,
} from "../src/impresion/etiquetas.js";
import {
  FABRICA_POR_TIPO,
  LARGOS,
  MAXIMO_ELEMENTOS,
  MAXIMO_MODELOS,
  MODELOS_FABRICA,
  PROPIEDADES,
  TIPOS_ELEMENTO,
  TITULOS_CAMPO,
  elementoNuevo,
  esModeloDeFabrica,
  modeloDeFabrica,
  normalizarElemento,
  normalizarModelo,
} from "../src/impresion/modelos.js";
import { svgQr } from "../src/impresion/qr.js";
import * as et from "../src/servicios/etiquetas.js";
import { cargaSintetica } from "./ayuda.js";

const USUARIO = "ALMACENISTA UNO";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const IDENTIDAD = { DLTA: { logo_izq: { src: PNG }, logo_der: { src: PNG }, texto: "BRONCO RIG-91" }, GSM: { logo_izq: null, logo_der: { src: PNG }, texto: "" } };
const BALERO = { cantidad: 1, codigo: "701", nombre: "BALEROS", dimension: "6309-2Z/C3", np: "SKF-123", descripcion: "OC: 4500123", area: "TALLER", inventario: "DLTA" };

/** Los textos que se ven, en orden (sin etiquetas HTML). */
const textos = (html) => [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]);

/** Las cajas (left/top/width/height) de cada regla `.etq-n<n>` del CSS. */
function cajas(css) {
  return [...css.matchAll(/\.etq-n(\d+)\{([^}]*)\}/g)].map(([, n, decl]) => {
    const v = Object.fromEntries(decl.split(";").map((d) => d.split(":")));
    return { n: Number(n), left: parseFloat(v.left), top: parseFloat(v.top), width: parseFloat(v.width), height: parseFloat(v.height), fuente: v["font-size"] };
  });
}

const CON_QR_Y_BARRAS = {
  id: "modelo-1-prueba",
  nombre: "Con códigos",
  elementos: [
    { tipo: "campo", campo: "codigo", x: 2, y: 3, w: 60, h: 15, letra: 12 },
    { tipo: "texto", texto: "{nombre} · {Dimensión}", x: 2, y: 20, w: 60, h: 12 },
    { tipo: "qr", datos: "{codigo} {dimension}", x: 70, y: 3, w: 28, h: 60 },
    { tipo: "barras", datos: "{codigo}", x: 2, y: 65, w: 96, h: 33 },
  ],
};

// ---------------------------------------------------------------- normalización

test("elemento: números fuera de rango se acotan y la caja nunca se sale de la etiqueta", () => {
  const el = normalizarElemento({ tipo: "campo", campo: "codigo", x: -5, y: 150, w: 300, h: 0.2, letra: 500, espaciado: 9 });
  assert.deepEqual([el.x, el.y, el.w, el.h, el.letra, el.espaciado], [0, 99, 100, 1, 80, 1]);
  const corrido = normalizarElemento({ tipo: "texto", x: 90, y: 95.5, w: 30, h: 10 });
  assert.deepEqual([corrido.x, corrido.w, corrido.y, corrido.h], [70, 30, 90, 10]);
  const decimales = normalizarElemento({ tipo: "texto", x: 33.33333, y: "12.345", w: 66.66666, h: 5 });
  assert.deepEqual([decimales.x, decimales.y, decimales.w], [33.33, 12.35, 66.67]);
  assert.ok(Math.round((decimales.x + decimales.w) * 100) <= 10000);
  assert.equal(normalizarElemento({ tipo: "texto", espaciado: -3 }).espaciado, -0.1);
});

test("elemento: números con inyección de CSS, NaN o Infinity toman el valor por omisión", () => {
  const defecto = elementoNuevo("campo");
  const sucio = normalizarElemento({ tipo: "campo", campo: "codigo", x: "10;background:url(x)", y: "1e3", w: NaN, h: Infinity, letra: "6.8px", espaciado: {} });
  assert.deepEqual([sucio.x, sucio.y, sucio.w, sucio.h, sucio.letra, sucio.espaciado], [defecto.x, defecto.y, defecto.w, defecto.h, defecto.letra, 0]);
  assert.equal(normalizarElemento({ tipo: "texto", letra: " 7.5 " }).letra, 7.5);
  for (const v of Object.values(sucio)) assert.doesNotMatch(String(v), /url|;|background/);
});

test("elemento: tipos, campos y valores desconocidos se descartan o se corrigen", () => {
  for (const tipo of ["otro", "constructor", "__proto__", "toString", undefined, 5]) assert.equal(normalizarElemento({ tipo }), null);
  for (const campo of ["otro", "constructor", "hasOwnProperty", undefined]) assert.equal(normalizarElemento({ tipo: "campo", campo }), null);
  for (const basura of [null, "texto", 7, [], [{ tipo: "texto" }]]) assert.equal(normalizarElemento(basura), null);
  const el = normalizarElemento({ tipo: "titulo", alinear: "left", vertical: "middle", negrita: "true", linea_abajo: 1, varias_lineas: "si", extra: "x", onclick: "y" });
  assert.deepEqual([el.alinear, el.vertical, el.negrita, el.linea_abajo, el.varias_lineas], ["centro", "centro", true, false, false]);
  assert.equal("extra" in el || "onclick" in el, false);
});

test("elemento: cada tipo lleva solo sus propiedades y sus valores por omisión", () => {
  for (const tipo of Object.keys(TIPOS_ELEMENTO)) {
    const el = elementoNuevo(tipo);
    assert.deepEqual(Object.keys(el).sort(), ["id", "tipo", "x", "y", "w", "h", ...PROPIEDADES[tipo]].sort(), tipo);
  }
  assert.deepEqual(Object.keys(normalizarElemento({ tipo: "logo_izq" })).sort(), ["alinear", "h", "id", "tipo", "vertical", "w", "x", "y"]);
  assert.equal(normalizarElemento({ tipo: "qr" }).datos, "{codigo}");
  assert.equal(normalizarElemento({ tipo: "barras" }).texto_visible, true);
  assert.equal(normalizarElemento({ tipo: "titulo" }).texto, "ETIQUETADO ALMACEN");
  // El título del campo: si no viene, el de siempre; vacío = solo el valor.
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np" }).etiqueta, TITULOS_CAMPO.np);
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np", etiqueta: "" }).etiqueta, "");
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np" }).vacio, "N/A");
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np", vacio: "" }).vacio, "");
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np", etiqueta: 5 }).etiqueta, "5");
  assert.equal(normalizarElemento({ tipo: "campo", campo: "np", etiqueta: { a: 1 } }).etiqueta, TITULOS_CAMPO.np);
});

test("elemento: textos sin controles y recortados a su largo", () => {
  const nulo = String.fromCharCode(0);
  const bidi = String.fromCharCode(0x202e);
  const el = normalizarElemento({ tipo: "campo", campo: "codigo", etiqueta: `  CÓDIGO${nulo}AX${bidi}:  ${"X".repeat(100)}`, vacio: "Ñ".repeat(50) });
  assert.equal(Array.from(el.etiqueta).length, LARGOS.etiqueta);
  assert.ok(el.etiqueta.startsWith("CÓDIGO AX :"));
  assert.doesNotMatch(el.etiqueta, /[\x00-\x1f]/);
  assert.equal(el.etiqueta.includes(bidi), false);
  assert.equal(el.vacio, "Ñ".repeat(LARGOS.vacio));
  // Un emoji no se parte a la mitad al recortar.
  const emoji = normalizarElemento({ tipo: "texto", texto: "📦".repeat(300) }).texto;
  assert.equal(Array.from(emoji).length, LARGOS.texto);
  assert.equal(emoji, "📦".repeat(LARGOS.texto));
});

test("modelo: ids únicos, a lo más 40 elementos, nombre recortado y lo que no sirve fuera", () => {
  assert.equal(normalizarModelo(null), null);
  assert.equal(normalizarModelo("modelo"), null);
  assert.equal(normalizarModelo([]), null);
  const m = normalizarModelo({
    id: "modelo-1-abc",
    nombre: `  ${"Diseño ".repeat(20)}`,
    elementos: [
      { id: "a", tipo: "texto" },
      { id: "a", tipo: "texto" },
      { id: 'x" onload="y', tipo: "texto" },
      { id: "e1", tipo: "texto" },
      { tipo: "texto" },
      { tipo: "desconocido" },
      "basura",
    ],
    creado_en: "2026-10-09T10:00:00",
    cambiado_en: "ayer;}",
    otro: 1,
  });
  assert.equal(m.id, "modelo-1-abc");
  assert.equal(Array.from(m.nombre).length <= LARGOS.nombre, true);
  assert.deepEqual(m.elementos.map((e) => e.id), ["a", "e2", "e3", "e1", "e4"]);
  assert.deepEqual([m.creado_en, m.cambiado_en, "otro" in m], ["2026-10-09T10:00:00", null, false]);
  assert.equal(normalizarModelo({ elementos: Array.from({ length: 60 }, () => ({ tipo: "texto" })) }).elementos.length, MAXIMO_ELEMENTOS);
  assert.equal(normalizarModelo({ id: "con espacio" }).id, null);
  assert.equal(normalizarModelo({ id: "x".repeat(65) }).id, null);
  assert.deepEqual(normalizarModelo({ elementos: "no es lista" }).elementos, []);
});

test("inyección: nada del modelo llega crudo al CSS ni al HTML", () => {
  const malo = {
    nombre: "</style><script>alert(1)</script>",
    elementos: [
      { tipo: "texto", texto: '</div><script>alert("x")</script>{nombre}', x: "1;}body{background:url(//x)}", letra: "10;color:red", espaciado: "1em;x" },
      { tipo: "campo", campo: "nombre", etiqueta: "<img src=x onerror=alert(1)>", vacio: "<b>vacío</b>", alinear: "center;}*{", vertical: "x" },
      { tipo: "titulo", texto: "}*{display:none}" },
      { tipo: "qr", datos: "<svg onload=alert(1)>" },
      { tipo: "barras", datos: '"><script>' },
    ],
  };
  const etiqueta = { ...BALERO, nombre: "<i>BALEROS</i>" };
  const doc = documentoEtiquetas([etiqueta], { modelo: malo, identidad: IDENTIDAD });
  // El CSS es el de siempre más una regla por elemento (validadas abajo).
  const base = documentoEtiquetas([etiqueta], { modelo: { elementos: [] } }).css;
  assert.equal(doc.css.slice(0, base.length), base);
  assert.doesNotMatch(doc.css.slice(base.length), /url\(|script|color:red|\*|display|body|background/);
  assert.match(doc.css.slice(base.length), /^(\.etq-n\d+(>\.etq-t)?\{[^{}]*\})+$/);
  // Solo las etiquetas HTML del render, sin atributos de eventos.
  assert.deepEqual(new Set([...doc.html.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1])), new Set(["div", "section", "span", "b", "svg", "rect", "path"]));
  assert.doesNotMatch(doc.html, /<[^>]*\son[a-z]+=/i);
  assert.match(doc.html, /&lt;\/div&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&lt;i&gt;BALEROS&lt;\/i&gt;/);
  assert.match(doc.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // En el documento las cajas van en el CSS: ningún atributo style.
  assert.doesNotMatch(doc.html, /style=/);
  // En el editor (style en línea) solo hay propiedades conocidas con valores de número o palabra fija.
  const permitidas = /^(left|top|width|height|font-size|justify-content|align-items|line-height|letter-spacing|text-align|-webkit-line-clamp):[a-z0-9.%-]+$/;
  for (const el of malo.elementos) {
    for (const [, estilo] of htmlElemento(el, etiqueta, { identidad: IDENTIDAD }).matchAll(/style="([^"]*)"/g)) {
      for (const d of estilo.split(";")) assert.match(d, permitidas);
    }
  }
  // Cada declaración del CSS del modelo también es de ese tipo.
  for (const [, decl] of doc.css.matchAll(/\.etq-n\d+(?:>\.etq-t)?\{([^}]*)\}/g)) for (const d of decl.split(";")) assert.match(d, permitidas);
});

// ---------------------------------------------------------------- render

test("render de cada tipo de elemento", () => {
  const html = (el, e = BALERO, opciones = {}) => htmlElemento(el, e, { identidad: IDENTIDAD, ...opciones });
  // Logos: la imagen de la identidad del inventario de la etiqueta; sin imagen, nada.
  assert.match(html({ tipo: "logo_izq" }), new RegExp(`<img src="${PNG.replace(/[+/]/g, "\\$&")}" alt="">`));
  assert.equal(html({ tipo: "logo_izq" }, { ...BALERO, inventario: "GSM" }), "");
  assert.equal(html({ tipo: "logo_der" }, { ...BALERO, inventario: "OTRO" }), "");
  assert.equal(htmlElemento({ tipo: "logo_izq" }, BALERO, { identidad: { DLTA: { logo_izq: { src: "https://fuera/x.png" } } } }), "");
  // Título y texto de almacén (vacío = nada).
  assert.deepEqual(textos(html({ tipo: "titulo", texto: "MI ALMACÉN" })), ["MI ALMACÉN"]);
  assert.deepEqual(textos(html({ tipo: "texto_almacen" })), ["BRONCO RIG-91"]);
  assert.equal(html({ tipo: "texto_almacen" }, { ...BALERO, inventario: "GSM" }), "");
  // Campo: título en negritas, valor (en negritas si se pide) o lo de «vacío».
  assert.match(html({ tipo: "campo", campo: "dimension" }), /<b>DIMENSIÓN:<\/b><span>6309-2Z\/C3<\/span>/);
  assert.match(html({ tipo: "campo", campo: "dimension", etiqueta: "", negrita: true }), /<div class="etq-t"[^>]*><span class="etq-b">6309-2Z\/C3<\/span>/);
  assert.match(html({ tipo: "campo", campo: "area" }, { ...BALERO, area: "  " }), /<span>N\/A<\/span>/);
  assert.match(html({ tipo: "campo", campo: "area", vacio: "-" }, { ...BALERO, area: "" }), /<span>-<\/span>/);
  assert.match(html({ tipo: "campo", campo: "inventario" }), /<span>DLTA<\/span>/);
  // Varias líneas: título y valor separados por un espacio y el número de renglones que caben.
  const varias = html({ tipo: "campo", campo: "nombre", varias_lineas: true, h: 20, letra: 8, alinear: "der" });
  assert.match(varias, /<b>NOMBRE:<\/b> <span>/);
  assert.match(varias, /class="etq-e etq-e-txt etq-v etq-linea"/);
  assert.match(varias, /-webkit-line-clamp:2/);
  assert.match(varias, /text-align:right/);
  assert.match(html({ tipo: "titulo", linea_abajo: true }), /etq-1 etq-linea/);
  // Texto libre con {campo}; vacío = lo de «vacío».
  assert.deepEqual(textos(html({ tipo: "texto", texto: "Código {codigo} · NP {np}" })), ["Código 701 · NP SKF-123"]);
  assert.deepEqual(textos(html({ tipo: "texto", texto: "{area}", vacio: "SIN ÁREA" }, { ...BALERO, area: "" })), ["SIN ÁREA"]);
  assert.equal(textos(html({ tipo: "texto", texto: "{area}" }, { ...BALERO, area: "" })).length, 0);
  // Letra en mm = letra / 100 × alto de la etiqueta; negrita, espaciado.
  assert.match(html({ tipo: "texto", texto: "X", letra: 10 }), /font-size:3\.9mm/);
  assert.match(html({ tipo: "texto", texto: "X", letra: 10 }, BALERO, { diseno: { ...DISENO_DEFECTO, alto: 58 } }), /font-size:5\.8mm/);
  assert.match(html({ tipo: "texto", texto: "X", negrita: true, espaciado: 0.2 }), /<div class="etq-t etq-b" style="letter-spacing:0\.2em">/);
  assert.match(html({ tipo: "texto", texto: "X", vertical: "abajo", alinear: "der" }), /justify-content:flex-end;align-items:flex-end/);
  assert.equal(htmlElemento({ tipo: "otro" }, BALERO), "");
});

test("QR y código de barras dentro del HTML, con la plantilla de datos llenada", () => {
  const qr = htmlElemento({ tipo: "qr", datos: "{codigo} {dimension}", alinear: "izq", vertical: "abajo" }, BALERO);
  const esperado = svgQr("701 6309-2Z/C3", { margen: MARGEN_QR });
  assert.ok(qr.includes(esperado.match(/ d="[^"]+"/)[0]), "el path del QR es el de svgQr");
  assert.match(qr, /preserveAspectRatio="xMinYMax meet"/);
  assert.match(qr, /^<div class="etq-e etq-e-qr" style="[^"]+"><svg /);
  // Sin datos o demasiado largo: no se dibuja.
  assert.equal(htmlElemento({ tipo: "qr", datos: "{area}" }, { ...BALERO, area: "" }), "");
  assert.equal(htmlElemento({ tipo: "qr", datos: "{nombre}{nombre}" }, { ...BALERO, nombre: "X".repeat(150) }), "");
  const barras = htmlElemento({ tipo: "barras", datos: "{codigo}-{dimension}" }, BALERO);
  assert.ok(barras.includes(svgBarras("701-6309-2Z/C3")));
  assert.match(barras, /<div class="etq-bar-txt">701-6309-2Z\/C3<\/div>/);
  // El texto de abajo es lo que lleva el código (sin acentos); se puede quitar.
  assert.match(htmlElemento({ tipo: "barras", datos: "Ñandú {codigo}" }, BALERO), /etq-bar-txt">Nandu 701</);
  assert.doesNotMatch(htmlElemento({ tipo: "barras", texto_visible: false }, BALERO), /etq-bar-txt/);
  assert.equal(htmlElemento({ tipo: "barras", datos: "{np}" }, { ...BALERO, np: "" }), "");
  // En el documento: un QR y unas barras por etiqueta.
  const doc = documentoEtiquetas([{ ...BALERO, cantidad: 3 }, { ...BALERO, codigo: "708", inventario: "GSM" }], { modelo: CON_QR_Y_BARRAS, identidad: IDENTIDAD });
  assert.equal((doc.html.match(/<svg /g) ?? []).length, 8);
  assert.equal((doc.html.match(/class="etq-e etq-e-qr etq-n2"/g) ?? []).length, 4);
  assert.equal((doc.html.match(/class="etq-e etq-e-bar etq-n3"/g) ?? []).length, 4);
  assert.match(doc.html, /<span>BALEROS · 6309-2Z\/C3<\/span>/);
});

test("llenarPlantilla: {campo} con mayúsculas o acento; lo desconocido queda", () => {
  assert.equal(llenarPlantilla("{codigo}|{DIMENSION}|{Dimensión}|{ np }|{x}|{}|{inventario}", BALERO), "701|6309-2Z/C3|6309-2Z/C3|SKF-123|{x}|{}|DLTA");
  assert.equal(llenarPlantilla("{codigo}", { codigo: 701 }), "701");
  assert.equal(llenarPlantilla("{nombre}", null), "");
  assert.equal(llenarPlantilla("{constructor}{__proto__}", BALERO), "{constructor}{__proto__}");
});

test("htmlElemento dibuja lo mismo que el documento; htmlEtiqueta y cssEtiqueta para el editor", () => {
  const modelo = MODELOS_FABRICA["fabrica-material"];
  const doc = documentoEtiquetas([BALERO], { modelo, identidad: IDENTIDAD });
  const enDocumento = doc.html.match(/<div class="etq etq-material">(.*)<\/div><\/div><\/section>/)[1];
  const sueltos = modelo.elementos.map((el) => htmlElemento(el, BALERO, { identidad: IDENTIDAD }).replace(/ style="[^"]*"/g, "")).join("");
  assert.equal(enDocumento.replace(/ etq-n\d+/g, ""), sueltos);
  const etiqueta = htmlEtiqueta(BALERO, { tipo: "material", modelo, identidad: IDENTIDAD });
  assert.match(etiqueta, /^<div class="etq etq-material"><div class="etq-e etq-e-logo" style="left:/);
  assert.deepEqual(textos(etiqueta), textos(enDocumento));
  // Sin modelo, el de fábrica del tipo.
  assert.deepEqual(textos(htmlEtiqueta(BALERO, { tipo: "ax" })), ["ETIQUETADO ALMACEN", "701", "BALEROS"]);
  const css = cssEtiqueta({ diseno: DISENO_DEFECTO, vista: true, ambito: "etq-editor" });
  assert.ok(css.split("}").filter(Boolean).every((r) => r.startsWith(".etq-editor ")));
  assert.match(css, /\.etq-editor \.etq\{[^}]*width:92mm;height:39mm/);
  assert.match(css, /\.etq-editor \.etq::after\{/);
  assert.doesNotMatch(cssEtiqueta({ diseno: { ...DISENO_DEFECTO, borde: false } }), /::after/);
  assert.match(cssEtiqueta({ modelo }), /\.etq-n10\{/);
  assert.doesNotMatch(css, /etq-hoja|@page/);
  assert.throws(() => cssEtiqueta({ vista: true, ambito: "x{}" }));
  assert.deepEqual(Object.keys(muestraEtiqueta("ax")), ["cantidad", "codigo", "nombre", "inventario"]);
  assert.equal(muestraEtiqueta("material", "GSM").inventario, "GSM");
});

test("de fábrica: los mismos textos y campos que se imprimían en las Rondas 20–21", () => {
  const material = documentoEtiquetas([BALERO], { identidad: IDENTIDAD });
  assert.deepEqual(textos(material.html), [
    "ETIQUETADO ALMACEN",
    "BRONCO RIG-91",
    "CODIGO AX:",
    "701",
    "INVENTARIO:",
    "DLTA",
    "NOMBRE:",
    "BALEROS",
    "DIMENSIÓN:",
    "6309-2Z/C3",
    "DESCRIPCION:",
    "OC: 4500123",
    "NO. PARTE:",
    "SKF-123",
    "ÁREA:",
    "TALLER",
  ]);
  assert.equal((material.html.match(/<img /g) ?? []).length, 2);
  // Lo que falta, N/A; GSM sin texto de almacén ni logo izquierdo.
  const gsm = documentoEtiquetas([{ codigo: "708", nombre: "GRASA", inventario: "GSM" }], { identidad: IDENTIDAD });
  assert.deepEqual(textos(gsm.html), ["ETIQUETADO ALMACEN", "CODIGO AX:", "708", "INVENTARIO:", "GSM", "NOMBRE:", "GRASA", "DIMENSIÓN:", "N/A", "DESCRIPCION:", "N/A", "NO. PARTE:", "N/A", "ÁREA:", "N/A"]);
  assert.equal((gsm.html.match(/<img /g) ?? []).length, 1);
  // Código AX: el código y el nombre, sin títulos; vacíos no dicen N/A.
  const ax = documentoEtiquetas([{ codigo: "701", nombre: "BALEROS", inventario: "DLTA" }], { tipo: "ax", identidad: IDENTIDAD });
  assert.deepEqual(textos(ax.html), ["ETIQUETADO ALMACEN", "BRONCO RIG-91", "701", "BALEROS"]);
  assert.match(ax.html, /class="etq etq-ax"/);
  assert.deepEqual(textos(documentoEtiquetas([{ inventario: "GSM" }], { tipo: "ax" }).html), ["ETIQUETADO ALMACEN"]);
  // Como antes: código de 45 px (11.9 mm) con espaciado de .15em y nombre de 12 px en hasta dos renglones.
  const reglas = cajas(ax.css);
  assert.equal(reglas[4].fuente, "11.907mm"); // 45 px = 11.906 mm
  assert.match(ax.css, /\.etq-n4>\.etq-t\{letter-spacing:0\.15em\}/);
  assert.match(ax.css, /\.etq-n5>\.etq-t\{text-align:center;-webkit-line-clamp:2\}/);
  // Campos de material a 10 px (2.64 mm).
  assert.ok(cajas(material.css).slice(4).every((c) => c.fuente === "2.644mm"));
  // De solo lectura y reconocibles.
  assert.ok(Object.isFrozen(MODELOS_FABRICA["fabrica-material"]) && Object.isFrozen(MODELOS_FABRICA["fabrica-material"].elementos[0]));
  assert.equal(modeloDeFabrica("ax").id, "fabrica-ax");
  assert.equal(modeloDeFabrica("otro").id, "fabrica-material");
  assert.deepEqual(FABRICA_POR_TIPO, { material: "fabrica-material", ax: "fabrica-ax" });
  assert.ok(esModeloDeFabrica("fabrica-ax") && esModeloDeFabrica("fabrica-nuevo") && !esModeloDeFabrica("modelo-1-x") && !esModeloDeFabrica(null));
  // El de fábrica ya está limpio: normalizarlo no lo cambia.
  for (const m of Object.values(MODELOS_FABRICA)) assert.deepEqual(normalizarModelo(m).elementos, m.elementos);
});

test("las 5 plantillas: hojas exactas, letra proporcional al alto y cajas dentro de la etiqueta", () => {
  const etiquetas = [{ ...BALERO, cantidad: 23 }, { codigo: "708", nombre: "GRASA", inventario: "GSM", cantidad: 1 }];
  for (const p of PLANTILLAS) {
    const c = cuadricula(p.diseno);
    for (const modelo of [MODELOS_FABRICA["fabrica-material"], MODELOS_FABRICA["fabrica-ax"], CON_QR_Y_BARRAS]) {
      const doc = documentoEtiquetas(etiquetas, { diseno: p.diseno, modelo, identidad: IDENTIDAD });
      assert.equal(doc.hojas, Math.ceil(24 / c.porHoja), `${p.id} ${modelo.id}`);
      assert.equal((doc.html.match(/<section class="etq-hoja">/g) ?? []).length, doc.hojas);
      for (const caja of cajas(doc.css)) {
        assert.ok(caja.left >= 0 && caja.top >= 0 && caja.left + caja.width <= 100.001 && caja.top + caja.height <= 100.001, `${p.id} ${modelo.id} ${caja.n}`);
        const el = normalizarModelo(modelo).elementos[caja.n];
        if (el.letra !== undefined) assert.equal(caja.fuente, `${Math.round(((el.letra / 100) * p.diseno.alto) * 1000) / 1000}mm`);
      }
    }
  }
  // La letra (px) de la plantilla ya no cambia nada.
  const a = documentoEtiquetas([BALERO], { diseno: { ...DISENO_DEFECTO, fuente: 10 } });
  const b = documentoEtiquetas([BALERO], { diseno: { ...DISENO_DEFECTO, fuente: 30 } });
  assert.equal(a.css, b.css);
  assert.equal(normalizarDiseno({ fuente: 30 }).fuente, 30); // pero se conserva en los datos
});

test("avisos del elemento para el editor", () => {
  assert.deepEqual(avisosElemento({ tipo: "campo", campo: "codigo" }, BALERO), []);
  assert.match(avisosElemento({ tipo: "campo", campo: "dimension" }, muestraEtiqueta("ax"), { tipo: "ax" })[0], /solo traen código, nombre e inventario/);
  assert.match(avisosElemento({ tipo: "qr", datos: "{area}" }, { ...BALERO, area: "" })[0], /queda vacío/);
  assert.match(avisosElemento({ tipo: "qr", datos: "{nombre}" }, { ...BALERO, nombre: "Ñ".repeat(110) })[0], /No cabe en un código QR: 220 bytes y caben 213/);
  assert.match(avisosElemento({ tipo: "qr", datos: "X".repeat(210), w: 10, h: 10 }, BALERO)[0], /cuadritos/);
  assert.deepEqual(avisosElemento({ tipo: "qr", w: 22, h: 52 }, BALERO), []);
  assert.match(avisosElemento({ tipo: "barras", datos: "Ñandú" }, BALERO)[0], /«Nandu»/);
  assert.match(avisosElemento({ tipo: "barras", datos: "X".repeat(60) }, BALERO)[0], /hasta 48/);
  assert.match(avisosElemento({ tipo: "barras", datos: "{np}" }, { ...BALERO, np: "" })[0], /queda vacío/);
  assert.match(avisosElemento({ tipo: "barras", datos: "6309-2Z/C3 SKF", w: 10 }, BALERO).at(-1), /Muy angosto/);
  assert.match(avisosElemento({ tipo: "otro" }, BALERO)[0], /no se reconoce/);
});

// ---------------------------------------------------------------- servicio

test("servicio: los de fábrica siempre están; sin elegir se usa el de fábrica de cada lista", () => {
  const { estado } = cargaSintetica();
  assert.deepEqual(et.modelosEtiqueta(estado).map((m) => [m.id, m.fabrica]), [["fabrica-material", true], ["fabrica-ax", true]]);
  assert.equal(et.modeloDe(estado, "material").id, "fabrica-material");
  assert.equal(et.modeloDe(estado, "ax").id, "fabrica-ax");
  const config = et.configEtiquetas(estado);
  assert.deepEqual([config.modelos, config.modelo_por_tipo], [[], { material: "fabrica-material", ax: "fabrica-ax" }]);
  // Lo guardado que no sirve no se ve; un id elegido que ya no existe = el de fábrica.
  estado.config.etiquetas = {
    modelos: [null, "x", { id: "con espacio", nombre: "A" }, { id: "fabrica-ax", nombre: "Falso" }, { id: "m1", nombre: "Uno", elementos: [{ tipo: "texto" }] }, { id: "m1", nombre: "Repetido" }],
    modelo_por_tipo: { material: "borrado", ax: "m1", otro: "m1" },
  };
  assert.deepEqual(et.configEtiquetas(estado).modelos.map((m) => m.nombre), ["Uno"]);
  assert.deepEqual(et.configEtiquetas(estado).modelo_por_tipo, { material: "fabrica-material", ax: "m1" });
  assert.equal(et.modeloDe(estado, "ax").nombre, "Uno");
  estado.config.etiquetas = { modelos: "no es lista", modelo_por_tipo: "x" };
  assert.deepEqual(et.configEtiquetas(estado).modelo_por_tipo, { material: "fabrica-material", ax: "fabrica-ax" });
});

test("servicio: guardar crea o actualiza, con nombre único y bitácora sin los elementos", () => {
  const { estado } = cargaSintetica();
  const id = et.guardarModeloEtiqueta(estado, { ...CON_QR_Y_BARRAS, id: null, nombre: "  Con códigos  " }, USUARIO);
  assert.match(id, /^modelo-\d+-[a-z0-9]+$/);
  const [guardado] = et.configEtiquetas(estado).modelos;
  assert.deepEqual([guardado.id, guardado.nombre, guardado.elementos.length], [id, "Con códigos", 4]);
  assert.ok(guardado.creado_en && guardado.cambiado_en);
  let ultima = estado.auditoria.at(-1);
  assert.deepEqual([ultima.accion, ultima.entidad, ultima.entidad_id, ultima.usuario, ultima.antes, ultima.despues], ["ALTA", "config", `etiquetas.modelo.${id}`, USUARIO, null, { nombre: "Con códigos", elementos: 4 }]);
  // Actualizar: mismo id, conserva cuándo se creó.
  const cambiado = { ...guardado, nombre: "Con códigos 2", elementos: guardado.elementos.slice(0, 2) };
  assert.equal(et.guardarModeloEtiqueta(estado, cambiado, USUARIO), id);
  ultima = estado.auditoria.at(-1);
  assert.deepEqual([ultima.accion, ultima.antes, ultima.despues], ["EDITAR", { nombre: "Con códigos", elementos: 4 }, { nombre: "Con códigos 2", elementos: 2 }]);
  assert.equal(et.configEtiquetas(estado).modelos[0].creado_en, guardado.creado_en);
  assert.equal(et.configEtiquetas(estado).modelos.length, 1);
  // Sin cambios: no se anota nada.
  const antes = estado.auditoria.length;
  assert.equal(et.guardarModeloEtiqueta(estado, et.configEtiquetas(estado).modelos[0], USUARIO), id);
  assert.equal(estado.auditoria.length, antes);
  // Nombre obligatorio y único sin distinguir mayúsculas (también contra los de fábrica).
  assert.throws(() => et.guardarModeloEtiqueta(estado, { nombre: "   ", elementos: [] }), /Ponle un nombre/);
  assert.throws(() => et.guardarModeloEtiqueta(estado, { nombre: "con CÓDIGOS  2", elementos: [] }), /Ya hay un diseño llamado/);
  assert.throws(() => et.guardarModeloEtiqueta(estado, { nombre: "material (de fábrica)", elementos: [] }), /Ya hay un diseño llamado/);
  // Los de fábrica no se cambian.
  assert.throws(() => et.guardarModeloEtiqueta(estado, { ...MODELOS_FABRICA["fabrica-material"], nombre: "Mío" }), /de fábrica no se cambian/);
  assert.throws(() => et.guardarModeloEtiqueta(estado, { id: "fabrica-otro", nombre: "Mío" }), /de fábrica no se cambian/);
  assert.throws(() => et.guardarModeloEtiqueta(estado, "basura"), /no es válido/);
  // Un id que ya no existe (se borró en el otro inventario mientras se editaba): se guarda como nuevo.
  const otro = et.guardarModeloEtiqueta(estado, { id: "modelo-9-borrado", nombre: "Recuperado", elementos: [{ tipo: "texto" }] }, USUARIO);
  assert.notEqual(otro, "modelo-9-borrado");
  assert.deepEqual(et.configEtiquetas(estado).modelos.map((m) => m.nombre), ["Con códigos 2", "Recuperado"]);
  // Lo guardado no lleva nada sin limpiar ni imágenes en la bitácora.
  assert.doesNotMatch(JSON.stringify(estado.auditoria.slice(-3)), /"x":|base64/);
  assert.equal(et.nombreParaCopia(estado, "Recuperado"), "Recuperado (copia)");
  et.guardarModeloEtiqueta(estado, { nombre: "Recuperado (copia)" });
  assert.equal(et.nombreParaCopia(estado, "Recuperado"), "Recuperado (copia 2)");
  assert.equal(Array.from(et.nombreParaCopia(estado, "N".repeat(80))).length, LARGOS.nombre);
});

test("servicio: guardar respeta los demás modelos tal como están y tiene un máximo", () => {
  const { estado } = cargaSintetica();
  const futuro = { id: "modelo-1-futuro", nombre: "De otra versión", elementos: [{ tipo: "elemento_nuevo" }], extra: true };
  estado.config.etiquetas = { modelos: [futuro] };
  et.guardarModeloEtiqueta(estado, { nombre: "Nuevo", elementos: [] }, USUARIO);
  assert.deepEqual(estado.config.etiquetas.modelos[0], futuro);
  estado.config.etiquetas.modelos = Array.from({ length: MAXIMO_MODELOS }, (_, i) => ({ id: `m${i}`, nombre: `M${i}` }));
  assert.throws(() => et.guardarModeloEtiqueta(estado, { nombre: "Uno más" }), /Ya hay 50 diseños/);
  assert.equal(et.guardarModeloEtiqueta(estado, { id: "m3", nombre: "M3 cambiado" }), "m3");
});

test("servicio: usar, borrar (vuelve al de fábrica) y reponer (Deshacer), con bitácora", () => {
  const { estado } = cargaSintetica();
  const id = et.guardarModeloEtiqueta(estado, { ...CON_QR_Y_BARRAS, id: null }, USUARIO);
  const otro = et.guardarModeloEtiqueta(estado, { nombre: "Otro", elementos: [{ tipo: "texto" }] }, USUARIO);
  assert.equal(et.usarModelo(estado, "material", id, USUARIO), true);
  assert.equal(et.usarModelo(estado, "material", id, USUARIO), false);
  assert.equal(et.usarModelo(estado, "ax", id, USUARIO), true);
  assert.equal(et.modeloDe(estado, "material").id, id);
  assert.equal(et.modeloDe(estado, "ax").nombre, "Con códigos");
  let ultima = estado.auditoria.at(-1);
  assert.deepEqual([ultima.entidad_id, ultima.accion, ultima.antes, ultima.despues], ["etiquetas.modelo_por_tipo", "EDITAR", { tipo: "ax", modelo: "Código AX (de fábrica)" }, { tipo: "ax", modelo: "Con códigos" }]);
  assert.throws(() => et.usarModelo(estado, "material", "no-existe"), /ya no existe/);
  assert.throws(() => et.usarModelo(estado, "otro", id), /Tipo de etiqueta desconocido/);
  assert.throws(() => et.usarModelo(estado, "constructor", id), /Tipo de etiqueta desconocido/);
  // Usar uno de fábrica también se puede (y para la otra lista).
  assert.equal(et.usarModelo(estado, "ax", "fabrica-material", USUARIO), true);
  assert.equal(et.modeloDe(estado, "ax").id, "fabrica-material");
  assert.equal(et.usarModelo(estado, "ax", id, USUARIO), true);
  // Borrar: las dos listas vuelven al de fábrica.
  const deshacer = et.borrarModeloEtiqueta(estado, id, USUARIO);
  assert.deepEqual([deshacer.indice, deshacer.tipos, deshacer.modelo.id], [0, ["material", "ax"], id]);
  assert.deepEqual(et.configEtiquetas(estado).modelos.map((m) => m.id), [otro]);
  assert.deepEqual(et.configEtiquetas(estado).modelo_por_tipo, { material: "fabrica-material", ax: "fabrica-ax" });
  ultima = estado.auditoria.at(-1);
  assert.deepEqual([ultima.accion, ultima.antes, ultima.despues], ["BORRAR", { nombre: "Con códigos", elementos: 4, usado_en: ["material", "ax"] }, null]);
  assert.throws(() => et.borrarModeloEtiqueta(estado, id), /ya no existe/);
  assert.throws(() => et.borrarModeloEtiqueta(estado, "fabrica-material"), /de fábrica no se borran/);
  // Mientras tanto la lista de código AX eligió otro: al reponer solo Material vuelve a usarlo.
  et.usarModelo(estado, "ax", otro, USUARIO);
  assert.equal(et.reponerModeloEtiqueta(estado, deshacer, USUARIO), true);
  assert.deepEqual(et.configEtiquetas(estado).modelos.map((m) => m.id), [id, otro]);
  assert.deepEqual(et.configEtiquetas(estado).modelo_por_tipo, { material: id, ax: otro });
  ultima = estado.auditoria.at(-1);
  assert.deepEqual([ultima.accion, ultima.despues], ["REPONER", { nombre: "Con códigos", elementos: 4, usado_en: ["material"] }]);
  assert.equal(et.reponerModeloEtiqueta(estado, deshacer, USUARIO), false); // ya está
  // Si su nombre ya lo tomó otro, no se repone a escondidas.
  const deNuevo = et.borrarModeloEtiqueta(estado, id, USUARIO);
  et.guardarModeloEtiqueta(estado, { nombre: "con códigos" }, USUARIO);
  assert.throws(() => et.reponerModeloEtiqueta(estado, deNuevo, USUARIO), /Ya hay otro diseño llamado/);
  assert.throws(() => et.reponerModeloEtiqueta(estado, { modelo: MODELOS_FABRICA["fabrica-ax"] }), /No hay diseño que reponer/);
});

test("el modelo elegido es el que se imprime", () => {
  const { estado } = cargaSintetica();
  const id = et.guardarModeloEtiqueta(estado, CON_QR_Y_BARRAS, USUARIO);
  et.usarModelo(estado, "material", id, USUARIO);
  const { diseno, identidad } = et.configEtiquetas(estado);
  const doc = documentoEtiquetas([BALERO], { tipo: "material", diseno, identidad, modelo: et.modeloDe(estado, "material") });
  assert.equal((doc.html.match(/<svg /g) ?? []).length, 2);
  // La lista de código AX sigue con el de fábrica.
  const ax = documentoEtiquetas([BALERO], { tipo: "ax", modelo: et.modeloDe(estado, "ax") });
  assert.deepEqual(textos(ax.html), ["ETIQUETADO ALMACEN", "701", "BALEROS"]);
});
