// Ronda 22: código de barras Code 128 propio (src/impresion/barras.js) contra la referencia de la
// biblioteca python-barcode (tests/fixtures/barras-referencia.json, generada con
// tests/fixtures/barras_referencia.py). Cada patrón se decodifica aquí con la tabla de la biblioteca
// (no con la de barras.js), revisando dígito de control y parada; debe dar el texto y no ser más largo
// que el de la biblioteca. Además se compara con el mínimo posible con los conjuntos B y C.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LARGO_MAXIMO_BARRAS, codigo128, svgBarras, textoParaBarras } from "../src/impresion/barras.js";

const REFERENCIA = JSON.parse(readFileSync(new URL("./fixtures/barras-referencia.json", import.meta.url), "utf8"));
const PARADA = REFERENCIA.tabla[106];
const POR_PATRON = new Map(REFERENCIA.tabla.slice(0, 106).map((patron, valor) => [patron, valor]));

/** Anchos de barra y espacio de un símbolo ("11011001100" → [2, 1, 2, 2, 2, 2]). */
const anchos = (simbolo) => simbolo.match(/1+|0+/g).map((corrida) => corrida.length);

/**
 * patrón → valores → texto, como un lector: símbolos de 11 módulos (3 barras y 3 espacios, empezando
 * con barra, barras de suma par), parada de 13 al final, dígito de control y cambios de conjunto.
 */
function decodificar(patron) {
  assert.match(patron, /^[01]+$/);
  assert.equal(patron.slice(-13), PARADA, "termina con la parada");
  const cuerpo = patron.slice(0, -13);
  assert.equal(cuerpo.length % 11, 0, "símbolos de 11 módulos");
  const simbolos = cuerpo.match(/.{11}/g);
  for (const simbolo of simbolos) {
    const a = anchos(simbolo);
    assert.equal(a.length, 6, `3 barras y 3 espacios: ${simbolo}`);
    assert.equal(simbolo[0], "1");
    assert.equal((a[0] + a[2] + a[4]) % 2, 0, `barras de suma par: ${simbolo}`);
    assert.ok(a.every((w) => w >= 1 && w <= 4), `anchos de 1 a 4: ${simbolo}`);
  }
  const valores = simbolos.map((s) => {
    assert.ok(POR_PATRON.has(s), `símbolo conocido: ${s}`);
    return POR_PATRON.get(s);
  });
  const [inicio, ...resto] = valores;
  const control = resto.pop();
  const suma = resto.reduce((total, v, i) => total + v * (i + 1), inicio);
  assert.equal(control, suma % 103, "dígito de control");
  let conjunto = { 104: "B", 105: "C" }[inicio];
  assert.ok(conjunto, `inicio B o C (no A): ${inicio}`);
  let texto = "";
  for (const v of resto) {
    if (conjunto === "B") {
      if (v < 95) texto += String.fromCharCode(v + 32);
      else if (v === 99) conjunto = "C";
      else assert.fail(`valor ${v} inesperado en B`);
    } else {
      if (v < 100) texto += String(v).padStart(2, "0");
      else if (v === 100) conjunto = "B";
      else assert.fail(`valor ${v} inesperado en C`);
    }
  }
  return { texto, valores, datos: resto.length };
}

const digito = (c) => c >= "0" && c <= "9";

/** Lo menos que puede costar el texto en símbolos de datos (sin inicio, control ni parada) con B y C. */
function minimo(texto) {
  const memo = new Map();
  const desde = (i, conjunto) => {
    if (i === texto.length) return 0;
    const llave = `${i}${conjunto}`;
    if (memo.has(llave)) return memo.get(llave);
    const enB = () => 1 + desde(i + 1, "B");
    const enC = () => (digito(texto[i]) && digito(texto[i + 1] ?? "") ? 1 + desde(i + 2, "C") : Infinity);
    const costo = conjunto === "B" ? Math.min(enB(), 1 + enC()) : Math.min(enC(), 1 + enB());
    memo.set(llave, costo);
    return costo;
  };
  return Math.min(desde(0, "B"), desde(0, "C"));
}

/**
 * Los casos donde barras.js no da el mismo patrón que la biblioteca y por qué. En todos lo de la
 * biblioteca también es válido; ninguno de barras.js es más largo.
 */
const DISTINTOS = {
  // Mismo largo: la biblioteca empieza en C aunque 3 dígitos cuesten lo mismo en B.
  "tres dígitos": "igual",
  "código corto": "igual",
  "empieza con tres dígitos": "igual",
  // Mismo largo: la biblioteca cambia a C con 4 o 5 dígitos en medio (CODE C y CODE B cuestan lo que ahorran).
  "letras, cinco dígitos, letras": "igual",
  "letras, cuatro dígitos, letras": "igual",
  "código y dimensión": "igual",
  // Un símbolo menos: el dígito impar va en B ANTES de cambiar a C, así no hay que regresar a B al final.
  "termina con cinco dígitos": "menor",
};

test("la referencia: textos que llegan sin cambio, patrones que se decodifican y todo B y C cubiertos", () => {
  assert.match(REFERENCIA.generado_con, /^python-barcode /);
  assert.equal(REFERENCIA.tabla.length, 107);
  for (const caso of REFERENCIA.casos) {
    assert.equal(textoParaBarras(caso.texto), caso.texto, `${caso.nombre}: texto ya limpio`);
    assert.ok(caso.texto.length <= LARGO_MAXIMO_BARRAS, caso.nombre);
    const leido = decodificar(caso.patron);
    assert.equal(leido.texto, caso.texto, `${caso.nombre}: la referencia se lee`);
    assert.deepEqual(leido.valores, caso.valores, caso.nombre);
  }
  const textos = REFERENCIA.casos.map((c) => c.texto).join("");
  for (let c = 32; c <= 126; c++) assert.ok(textos.includes(String.fromCharCode(c)), `ASCII ${c}`);
  assert.ok(REFERENCIA.casos.some((c) => c.texto === "000000670"));
  assert.ok(REFERENCIA.casos.some((c) => c.texto === "6309-2Z/C3"));
  assert.ok(REFERENCIA.casos.some((c) => c.texto === "ABC1234567DEF"));
  for (const nombre of Object.keys(DISTINTOS)) assert.ok(REFERENCIA.casos.some((c) => c.nombre === nombre), nombre);
});

test("contra python-barcode: mismo texto, nunca más largo y el mismo patrón salvo lo explicado", () => {
  let iguales = 0;
  for (const caso of REFERENCIA.casos) {
    const codigo = codigo128(caso.texto);
    assert.ok(codigo, caso.nombre);
    assert.equal(codigo.texto, caso.texto);
    assert.equal(codigo.cambiado, false);
    assert.equal(codigo.modulos, codigo.patron.length);
    assert.equal(decodificar(codigo.patron).texto, caso.texto, `${caso.nombre}: se lee`);
    assert.ok(codigo.modulos <= caso.patron.length, `${caso.nombre}: ${codigo.modulos} > ${caso.patron.length}`);
    const esperado = DISTINTOS[caso.nombre];
    if (!esperado) {
      assert.equal(codigo.patron, caso.patron, `${caso.nombre}: el mismo patrón`);
      iguales++;
    } else if (esperado === "igual") {
      assert.notEqual(codigo.patron, caso.patron, caso.nombre);
      assert.equal(codigo.modulos, caso.patron.length, `${caso.nombre}: mismo largo`);
    } else {
      assert.equal(codigo.modulos, caso.patron.length - 11, `${caso.nombre}: un símbolo menos`);
    }
  }
  assert.equal(iguales, REFERENCIA.casos.length - Object.keys(DISTINTOS).length);
});

test("ejemplos: conjuntos, cambios B → C → B y lugar del dígito impar", () => {
  const valores = (texto) => decodificar(codigo128(texto).patron).valores.slice(0, -1);
  assert.deepEqual(valores("701"), [104, 23, 16, 17]); // 3 dígitos: B
  assert.deepEqual(valores("12"), [105, 12]); // todo numérico y par: C
  assert.deepEqual(valores("1"), [104, 17]);
  assert.deepEqual(valores("000000670"), [105, 0, 0, 0, 67, 100, 16]); // impar: CODE B antes del último
  assert.deepEqual(valores("1234A"), [105, 12, 34, 100, 33]); // ≥ 4 al inicio
  assert.deepEqual(valores("123A"), [104, 17, 18, 19, 33]);
  assert.deepEqual(valores("A1234"), [104, 33, 99, 12, 34]); // ≥ 4 al final
  assert.deepEqual(valores("A12345"), [104, 33, 17, 99, 23, 45]); // impar al final: el sobrante primero, en B
  assert.deepEqual(valores("A123"), [104, 33, 17, 18, 19]);
  assert.deepEqual(valores("A12345B"), [104, 33, 17, 18, 19, 20, 21, 34]); // 5 en medio: B
  assert.deepEqual(valores("A123456B"), [104, 33, 99, 12, 34, 56, 100, 34]); // 6 en medio: C
  assert.deepEqual(valores("A1234567B"), [104, 33, 99, 12, 34, 56, 100, 23, 34]);
  assert.deepEqual(valores("RIG 91"), [104, 50, 41, 39, 0, 25, 17]);
});

test("el más corto posible con B y C, y se lee, en textos al azar", () => {
  // Generador fijo (mulberry32): siempre los mismos textos.
  let semilla = 0x5eed1234;
  const azar = () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const letras = "0123456789".repeat(4) + "AZ-/ .:ab";
  for (let n = 0; n < 2000; n++) {
    const largo = 1 + Math.floor(azar() * LARGO_MAXIMO_BARRAS);
    let texto = "";
    while (texto.length < largo) texto += letras[Math.floor(azar() * letras.length)];
    texto = texto.trim();
    if (!texto) continue;
    const codigo = codigo128(texto);
    const leido = decodificar(codigo.patron);
    assert.equal(leido.texto, texto);
    assert.equal(leido.datos, minimo(texto), `«${texto}»: ${leido.datos} símbolos de datos`);
    assert.equal(codigo.modulos, 11 * (leido.datos + 2) + 13);
  }
  // Y en todas las corridas de 1 a 12 dígitos al inicio, en medio, al final y solas.
  for (let n = 1; n <= 12; n++) {
    const d = "1234567890ab".slice(0, n).replace(/[ab]/g, "7");
    for (const texto of [d, `${d}X`, `X${d}`, `X${d}X`, `X${d}X${d}X`, `${d}X${d}`]) {
      const leido = decodificar(codigo128(texto).patron);
      assert.equal(leido.texto, texto);
      assert.equal(leido.datos, minimo(texto), `«${texto}»`);
    }
  }
});

test("textoParaBarras: sin acentos, Ñ → N, sin emoji, tabuladores como espacio y sin orillas", () => {
  assert.equal(textoParaBarras("DESCRIPCIÓN ÁÉÍÓÚ"), "DESCRIPCION AEIOU");
  assert.equal(textoParaBarras("Ñandú pingüino ÑÜ"), "Nandu pinguino NU");
  assert.equal(textoParaBarras("📦 701 ✅"), "701");
  assert.equal(textoParaBarras("6309\t2Z\nC3"), "6309 2Z C3");
  assert.equal(textoParaBarras("\t  000000670 \r\n"), "000000670");
  assert.equal(textoParaBarras("A B"), "A B"); // espacio que no se parte
  assert.equal(textoParaBarras("50°C ½ ß"), "50C"); // lo que no se descompone a ASCII se quita
  assert.equal(textoParaBarras("~!@#$%^&*()_+{}|:\"<>?`-=[]\\;',./"), "~!@#$%^&*()_+{}|:\"<>?`-=[]\\;',./");
  assert.equal(textoParaBarras("\u007f\u0000A"), "A");
  assert.equal(textoParaBarras(701), "701");
  assert.equal(textoParaBarras(null), "");
  assert.equal(textoParaBarras(undefined), "");
});

test("codigo128: null si queda vacío o es muy largo; cambiado cuando hubo que limpiar", () => {
  assert.equal(LARGO_MAXIMO_BARRAS, 48);
  for (const vacio of ["", "   ", "\t\n", "📦", "°½", null, undefined]) assert.equal(codigo128(vacio), null, String(vacio));
  const largo = "A".repeat(LARGO_MAXIMO_BARRAS);
  assert.ok(codigo128(largo));
  assert.equal(codigo128(`${largo}B`), null);
  assert.equal(codigo128("1".repeat(LARGO_MAXIMO_BARRAS + 1)), null);
  // El largo se mide ya limpio: los acentos y las orillas no cuentan de más.
  assert.equal(codigo128(`  ${"É".repeat(LARGO_MAXIMO_BARRAS)}  `).texto, "E".repeat(LARGO_MAXIMO_BARRAS));

  const conAcento = codigo128("BALERO Ñ-1");
  assert.equal(conAcento.texto, "BALERO N-1");
  assert.equal(conAcento.cambiado, true);
  assert.equal(decodificar(conAcento.patron).texto, "BALERO N-1");
  assert.equal(codigo128("BALERO N-1").cambiado, false);
  assert.equal(codigo128(" 701").cambiado, true);
  assert.equal(codigo128(701).cambiado, false);
  assert.equal(codigo128(701).texto, "701");

  const ax = codigo128("000000670");
  assert.deepEqual(Object.keys(ax).sort(), ["cambiado", "modulos", "patron", "texto"]);
  assert.match(ax.patron, /^11010011100/); // inicio C
  assert.match(ax.patron, /1100011101011$/); // parada 2331112
  assert.equal(ax.modulos, 11 * 8 + 13);
});

/** Las barras del SVG de vuelta a módulos, quitando la zona muda. */
function patronDelSvg(svg, margen) {
  const ancho = Number(/viewBox="0 0 (\d+) 1"/.exec(svg)[1]);
  const modulos = Array(ancho).fill("0");
  const d = /<path fill="#000" d="([^"]*)"\/>/.exec(svg)[1];
  const barras = [...d.matchAll(/M(\d+) 0h(\d+)v1h-(\d+)z/g)];
  assert.equal(barras.map((b) => b[0]).join(""), d, "solo rectángulos de alto 1");
  for (const [, x, w, w2] of barras) {
    assert.equal(w, w2);
    for (let i = Number(x); i < Number(x) + Number(w); i++) {
      assert.equal(modulos[i], "0", "sin barras encimadas");
      modulos[i] = "1";
    }
  }
  const muda = "0".repeat(margen);
  const todo = modulos.join("");
  assert.ok(todo.startsWith(muda) && todo.endsWith(muda), "zona muda en blanco");
  return todo.slice(margen, ancho - margen);
}

test("svgBarras: ancho = módulos + 2 · margen, barras de alto 1 y nada del texto", () => {
  const codigo = codigo128("6309-2Z/C3");
  const svg = svgBarras("6309-2Z/C3");
  const ancho = codigo.modulos + 20;
  assert.ok(
    svg.startsWith(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} 1" preserveAspectRatio="none" shape-rendering="crispEdges">` +
        `<rect width="${ancho}" height="1" fill="#fff"/><path fill="#000" d="M10 0h2v1h-2z`,
    ),
    svg.slice(0, 220),
  );
  assert.ok(svg.endsWith('"/></svg>'));
  assert.equal(patronDelSvg(svg, 10), codigo.patron);
  // Una barra por corrida de unos.
  assert.equal((svg.match(/M/g) ?? []).length, codigo.patron.match(/1+/g).length);

  const sinMargen = svgBarras("6309-2Z/C3", { margen: 0 });
  assert.match(sinMargen, new RegExp(`viewBox="0 0 ${codigo.modulos} 1"`));
  assert.equal(patronDelSvg(sinMargen, 0), codigo.patron);
  assert.equal(patronDelSvg(svgBarras("6309-2Z/C3", { margen: 4 }), 4), codigo.patron);
  for (const raro of [-1, 2.5, "10", Number.NaN, null]) {
    assert.match(svgBarras("701", { margen: raro }), new RegExp(`viewBox="0 0 ${codigo128("701").modulos + 20} 1"`), String(raro));
  }

  // Nada del texto dentro del SVG (ni siquiera lo que parece marcado).
  for (const texto of ['<script>alert("x")</script>', "OC: 4500012345", "a&b'c"]) {
    const s = svgBarras(texto);
    assert.ok(s, texto);
    assert.ok(!s.includes(texto) && !/script|alert|OC:|&/.test(s), texto);
    assert.equal(patronDelSvg(s, 10), codigo128(texto).patron);
  }

  assert.equal(svgBarras(""), null);
  assert.equal(svgBarras("  "), null);
  assert.equal(svgBarras("📦"), null);
  assert.equal(svgBarras("X".repeat(LARGO_MAXIMO_BARRAS + 1)), null);
  assert.ok(svgBarras("X".repeat(LARGO_MAXIMO_BARRAS)));
});
