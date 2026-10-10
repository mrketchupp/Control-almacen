// Ronda 22: código QR propio (src/impresion/qr.js) contra la referencia de la biblioteca qrcode de
// Python (tests/fixtures/qr-referencia.json, generada con tests/fixtures/qr_referencia.py): mismas
// matrices módulo por módulo con la máscara forzada, mismas penalizaciones y la máscara que se elige.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAPACIDAD_QR, capacidadQr, matrizQr, penalizacionQr, svgQr } from "../src/impresion/qr.js";

const REFERENCIA = JSON.parse(readFileSync(new URL("./fixtures/qr-referencia.json", import.meta.url), "utf8"));
const CASOS = REFERENCIA.casos.filter((c) => !c.excede);
const EXCEDEN = REFERENCIA.casos.filter((c) => c.excede);

const renglones = (modulos) => modulos.map((fila) => fila.map((v) => (v ? "1" : "0")).join(""));
const primerMenor = (lista) => lista.indexOf(Math.min(...lista));
const bytes = (texto) => new TextEncoder().encode(texto).length;

/** La matriz como la evalúa qrcode al elegir máscara: formato, versión y módulo oscuro en blanco. */
function comoLaBiblioteca(modulos, version) {
  const n = modulos.length;
  const copia = modulos.map((fila) => [...fila]);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) copia[8][i] = copia[i][8] = false;
  }
  for (let i = 0; i < 8; i++) copia[8][n - 1 - i] = copia[n - 1 - i][8] = false;
  if (version >= 7) {
    for (let i = 0; i < 18; i++) copia[Math.floor(i / 3)][n - 11 + (i % 3)] = copia[n - 11 + (i % 3)][Math.floor(i / 3)] = false;
  }
  return copia;
}

/** Residuo BCH (para revisar la información de formato y de versión leída de la matriz). */
function residuo(valor, generador, grado) {
  let r = valor;
  for (let i = 31 - Math.clz32(r); i >= grado; i--) if ((r >>> i) & 1) r ^= generador << (i - grado);
  return r;
}

test("capacidad: 213 bytes en v10-M y la misma tabla que la biblioteca para L, M, Q y H", () => {
  assert.equal(CAPACIDAD_QR, 213);
  for (const [nivel, lista] of Object.entries(REFERENCIA.capacidades)) {
    assert.deepEqual(
      lista.map((_, i) => capacidadQr(i + 1, nivel)),
      lista,
      `capacidades de ${nivel}`,
    );
  }
  assert.throws(() => capacidadQr(11, "M"), /fuera de rango/);
});

test("la referencia cubre lo pedido: v1, v2, v6, v7, v10, el límite de v10-M, acentos y las 8 máscaras", () => {
  const m = CASOS.filter((c) => c.correccion === "M");
  for (const v of [1, 2, 6, 7, 10]) assert.ok(m.some((c) => c.version === v), `M v${v}`);
  for (const nivel of ["L", "M", "Q", "H"]) {
    for (let v = 1; v <= 10; v++) assert.ok(CASOS.some((c) => c.correccion === nivel && c.version === v), `${nivel} v${v}`);
  }
  assert.ok(m.some((c) => c.bytes === 213 && c.version === 10));
  assert.ok(EXCEDEN.some((c) => c.correccion === "M" && c.bytes === 214));
  assert.ok(CASOS.some((c) => /Ñ/.test(c.texto) && bytes(c.texto) > c.texto.length));
  assert.deepEqual([...new Set(CASOS.map((c) => c.mascara))].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(CASOS.length >= 20);
});

test("con la máscara forzada, la matriz es igual a la de qrcode módulo por módulo", () => {
  for (const caso of CASOS) {
    const qr = matrizQr(caso.texto, { correccion: caso.correccion, mascara: caso.mascara });
    assert.equal(qr.version, caso.version, `${caso.nombre}: versión`);
    assert.equal(qr.tamano, 17 + 4 * caso.version, `${caso.nombre}: tamaño`);
    assert.equal(qr.mascara, caso.mascara);
    assert.equal(qr.correccion, caso.correccion);
    assert.equal(qr.modulos.length, qr.tamano);
    assert.ok(qr.modulos.every((fila) => fila.length === qr.tamano && fila.every((v) => typeof v === "boolean")));
    const obtenidos = renglones(qr.modulos);
    for (let f = 0; f < qr.tamano; f++) assert.equal(obtenidos[f], caso.modulos[f], `${caso.nombre}: renglón ${f}`);
  }
});

test("penalización: igual a lost_point de qrcode, sobre el símbolo completo y sobre su matriz de prueba", () => {
  for (const caso of CASOS) {
    const opciones = { correccion: caso.correccion };
    const porMascara = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => matrizQr(caso.texto, { ...opciones, mascara: m }).modulos);
    assert.deepEqual(porMascara.map(penalizacionQr), caso.penalizaciones_simbolo, `${caso.nombre}: símbolo completo`);
    assert.deepEqual(
      porMascara.map((modulos) => penalizacionQr(comoLaBiblioteca(modulos, caso.version))),
      caso.penalizaciones_biblioteca,
      `${caso.nombre}: como la evalúa qrcode`,
    );
    // Evaluada como qrcode (formato en blanco), la regla da su misma máscara: la única diferencia es qué
    // se evalúa, no cómo.
    assert.equal(primerMenor(caso.penalizaciones_biblioteca), caso.mascara_biblioteca, caso.nombre);
  }
});

test("sin forzar, elige la máscara de menor penalización del símbolo completo (ISO/IEC 18004)", () => {
  let iguales = 0;
  for (const caso of CASOS) {
    const qr = matrizQr(caso.texto, { correccion: caso.correccion });
    assert.equal(qr.mascara, primerMenor(caso.penalizaciones_simbolo), caso.nombre);
    assert.equal(penalizacionQr(qr.modulos), Math.min(...caso.penalizaciones_simbolo));
    assert.deepEqual(qr.modulos, matrizQr(caso.texto, { correccion: caso.correccion, mascara: qr.mascara }).modulos);
    if (qr.mascara === caso.mascara_biblioteca) iguales++;
  }
  // qrcode elige con la información de formato en blanco: coincide en una parte de los casos, no en todos.
  assert.ok(iguales > 0 && iguales <= CASOS.length);
});

test("versión: la menor en la que cabe, contando bytes en UTF-8", () => {
  for (const nivel of ["L", "M", "Q", "H"]) {
    for (let v = 1; v <= 10; v++) {
      const cabe = capacidadQr(v, nivel);
      assert.equal(matrizQr("x".repeat(cabe), { correccion: nivel }).version, v, `${nivel} v${v}`);
      if (v < 10) assert.equal(matrizQr("x".repeat(cabe + 1), { correccion: nivel }).version, v + 1, `${nivel} v${v} + 1`);
    }
  }
  assert.equal(matrizQr("Ñ".repeat(7)).version, 1);
  assert.equal(matrizQr("Ñ".repeat(7) + "A").version, 2);
  assert.equal(matrizQr("").version, 1);
  assert.deepEqual(matrizQr(701).modulos, matrizQr("701").modulos);
});

test("estructura: patrones de búsqueda, sincronización, módulo oscuro, formato y versión legibles", () => {
  for (const caso of CASOS) {
    const { modulos, tamano: n, version, mascara } = matrizQr(caso.texto, { correccion: caso.correccion });
    const en = (f, c) => (modulos[f][c] ? 1 : 0);
    for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let f = 0; f < 7; f++) {
        for (let c = 0; c < 7; c++) {
          const anillo = Math.max(Math.abs(f - 3), Math.abs(c - 3));
          assert.equal(en(f0 + f, c0 + c), anillo === 2 ? 0 : 1, `${caso.nombre}: búsqueda`);
        }
      }
    }
    for (let i = 8; i < n - 8; i++) {
      assert.equal(en(6, i), i % 2 === 0 ? 1 : 0);
      assert.equal(en(i, 6), i % 2 === 0 ? 1 : 0);
    }
    assert.equal(en(n - 8, 8), 1, "módulo oscuro");
    // Formato: las dos copias dicen lo mismo, con BCH válido, y es el nivel y la máscara usados.
    let a = 0;
    let b = 0;
    for (let i = 0; i < 15; i++) {
      a |= (i < 6 ? en(i, 8) : i < 8 ? en(i + 1, 8) : en(n - 15 + i, 8)) << i;
      b |= (i < 8 ? en(8, n - 1 - i) : i === 8 ? en(8, 7) : en(8, 14 - i)) << i;
    }
    assert.equal(a, b, `${caso.nombre}: copias del formato`);
    const formato = a ^ 0x5412;
    assert.equal(residuo(formato, 0x537, 10), 0, "BCH del formato");
    assert.equal(formato >>> 10, ({ L: 1, M: 0, Q: 3, H: 2 }[caso.correccion] << 3) | mascara);
    if (version >= 7) {
      let arriba = 0;
      let abajo = 0;
      for (let i = 0; i < 18; i++) {
        arriba |= en(Math.floor(i / 3), n - 11 + (i % 3)) << i;
        abajo |= en(n - 11 + (i % 3), Math.floor(i / 3)) << i;
      }
      assert.equal(arriba, abajo, "copias de la versión");
      assert.equal(arriba >>> 12, version);
      assert.equal(residuo(arriba, 0x1f25, 12), 0, "BCH de la versión");
    }
  }
});

test("errores en español: texto que no cabe, nivel o máscara inválidos", () => {
  for (const caso of EXCEDEN) {
    assert.throws(() => matrizQr(caso.texto, { correccion: caso.correccion }), (e) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /demasiado largo/);
      assert.match(e.message, new RegExp(`${caso.bytes} bytes`));
      assert.match(e.message, new RegExp(`caben ${capacidadQr(10, caso.correccion)}`));
      return true;
    });
  }
  assert.throws(() => matrizQr("x".repeat(CAPACIDAD_QR + 1)), /demasiado largo/);
  assert.throws(() => matrizQr("Ñ".repeat(107)), /214 bytes/);
  assert.equal(matrizQr("Ñ".repeat(106) + "A").version, 10);
  assert.throws(() => matrizQr("701", { correccion: "X" }), /Nivel de corrección/);
  assert.throws(() => matrizQr("701", { mascara: 8 }), /Máscara/);
  assert.throws(() => matrizQr("701", { mascara: 1.5 }), /Máscara/);
  assert.equal(matrizQr("701", { correccion: "q" }).correccion, "Q");
});

/** Vuelve a armar la matriz pintando el path del SVG (solo M x y, h, v y z). */
function pintarPath(d, lado) {
  const pintado = Array.from({ length: lado }, () => new Array(lado).fill(false));
  const comando = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let largoLeido = 0;
  for (const m of d.matchAll(comando)) {
    const [x, y, ancho, regreso] = m.slice(1).map(Number);
    assert.equal(ancho, regreso);
    for (let c = x; c < x + ancho; c++) {
      assert.equal(pintado[y][c], false, "tramos encimados");
      pintado[y][c] = true;
    }
    largoLeido += m[0].length;
  }
  assert.equal(largoLeido, d.length, "el path solo tiene tramos M/h/v/z");
  return pintado;
}

test("svgQr: un solo path con tramos horizontales, viewBox con el margen y nada del texto", () => {
  for (const texto of ["701", "000000670 6309-2Z/C3", "DESCRIPCIÓN: BALERO AÑO", "x".repeat(CAPACIDAD_QR)]) {
    const { tamano, modulos } = matrizQr(texto);
    const svg = svgQr(texto);
    const lado = tamano + 8;
    assert.match(
      svg,
      new RegExp(
        `^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="0 0 ${lado} ${lado}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">` +
          `<rect width="${lado}" height="${lado}" fill="#fff"/><path fill="#000" d="[^"]*"/></svg>$`,
      ),
    );
    assert.equal(svg.match(/<path/g).length, 1);
    const d = /d="([^"]*)"/.exec(svg)[1];
    assert.match(d, /^[Mhvz0-9 -]+$/);
    const pintado = pintarPath(d, lado);
    for (let f = 0; f < lado; f++) {
      for (let c = 0; c < lado; c++) {
        const dentro = f >= 4 && c >= 4 && f < 4 + tamano && c < 4 + tamano;
        assert.equal(pintado[f][c], dentro ? modulos[f - 4][c - 4] : false, `módulo ${f},${c}`);
      }
    }
    // Un tramo por cada racha de negros en cada renglón.
    const rachas = modulos.reduce((n, fila) => n + fila.filter((v, c) => v && !fila[c - 1]).length, 0);
    assert.equal(d.split("M").length - 1, rachas);
  }
  const sinMargen = svgQr("701", { margen: 0 });
  assert.match(sinMargen, /viewBox="0 0 21 21"/);
  assert.match(svgQr("701", { margen: 2 }), /viewBox="0 0 25 25"/);
  assert.match(svgQr("701", { margen: -1 }), /viewBox="0 0 29 29"/);
  const raro = '<script>alert("ñ")</script> & 701';
  const svg = svgQr(raro);
  assert.ok(svg);
  assert.ok(!svg.includes("script") && !svg.includes("alert") && !svg.includes("&") && !svg.includes("701"));
  assert.equal(svg.match(/</g).length, 4);
});

test("svgQr: null si el texto queda vacío o no cabe", () => {
  assert.equal(svgQr(""), null);
  assert.equal(svgQr("   "), null);
  assert.equal(svgQr(null), null);
  assert.equal(svgQr(undefined), null);
  assert.equal(svgQr("x".repeat(CAPACIDAD_QR + 1)), null);
  assert.equal(svgQr("Ñ".repeat(107)), null);
  assert.ok(svgQr("x".repeat(CAPACIDAD_QR)));
  assert.ok(svgQr(" 701 "));
});
