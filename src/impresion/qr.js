// Código QR para las etiquetas (Ronda 22), sin dependencias: lo que se imprime se arma aquí mismo y
// nada sale del equipo. Sigue ISO/IEC 18004 en lo que hace falta para una etiqueta:
// - solo modo byte (el texto en UTF-8, con TextEncoder): códigos, dimensiones y acentos sin sorpresas;
// - versiones 1 a 10 (hasta 57 × 57 módulos), la menor en la que cabe el texto;
// - corrección M por omisión (L, Q y H también están en la tabla);
// - Reed-Solomon en GF(256) con el polinomio 0x11d, bloques y entrelazado según la tabla del estándar;
// - patrones de búsqueda, separadores, sincronización, alineación (v2+), módulo oscuro, información de
//   formato (BCH 15,5 y máscara 0x5412) y de versión (v7+, BCH 18,6);
// - las 8 máscaras, eligiendo la de menor penalización con las 4 reglas del estándar evaluadas sobre el
//   símbolo COMPLETO (con la información de formato y de versión ya puestas, como pide el estándar).
//   La biblioteca qrcode de Python (la referencia de las pruebas) evalúa con esa información en blanco
//   y a veces elige otra máscara; cualquier máscara es válida y se lee igual. tests/qr.test.js
//   comprueba que las reglas dan los mismos puntos que las de qrcode, evaluando lo mismo.
// Corre igual en Node y en el navegador. La salida SVG no lleva nada del texto, solo los módulos.

/** Bits del nivel de corrección en la información de formato. */
const NIVELES = { L: 1, M: 0, Q: 3, H: 2 };

/**
 * Bloques por versión (1–10) y nivel: [palabras de corrección por bloque, bloques del grupo 1, palabras
 * de datos por bloque del grupo 1, bloques del grupo 2]. Los del grupo 2 llevan una palabra de datos más.
 */
const BLOQUES = {
  L: [[7, 1, 19, 0], [10, 1, 34, 0], [15, 1, 55, 0], [20, 1, 80, 0], [26, 1, 108, 0], [18, 2, 68, 0], [20, 2, 78, 0], [24, 2, 97, 0], [30, 2, 116, 0], [18, 2, 68, 2]],
  M: [[10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0], [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]],
  Q: [[13, 1, 13, 0], [22, 1, 22, 0], [18, 2, 17, 0], [26, 2, 24, 0], [18, 2, 15, 2], [24, 4, 19, 0], [18, 2, 14, 4], [22, 4, 18, 2], [20, 4, 16, 4], [24, 6, 19, 2]],
  H: [[17, 1, 9, 0], [28, 1, 16, 0], [22, 2, 13, 0], [16, 4, 9, 0], [22, 2, 11, 2], [28, 4, 15, 0], [26, 4, 13, 1], [26, 4, 14, 2], [24, 4, 12, 4], [28, 6, 15, 2]],
};

/** Centros de los patrones de alineación por versión (la 1 no tiene). */
const ALINEACION = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const VERSION_MAXIMA = 10;
const MODO_BYTE = 0b0100;
const RELLENO = [0xec, 0x11];

// ---------------------------------------------------------------- Campo de Galois GF(256), 0x11d

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const multiplicar = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const generadores = new Map();

/** Polinomio generador de grado n: (x − α⁰)(x − α¹)…(x − αⁿ⁻¹), del término mayor al menor. */
function generador(n) {
  if (generadores.has(n)) return generadores.get(n);
  let g = [1];
  for (let i = 0; i < n; i++) {
    const siguiente = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      siguiente[j] ^= g[j];
      siguiente[j + 1] ^= multiplicar(g[j], EXP[i]);
    }
    g = siguiente;
  }
  generadores.set(n, g);
  return g;
}

/** Palabras de corrección de un bloque: residuo de datos·xⁿ entre el generador de grado n. */
function correccionDe(datos, n) {
  const g = generador(n);
  const residuo = new Array(n).fill(0);
  for (const palabra of datos) {
    const factor = palabra ^ residuo.shift();
    residuo.push(0);
    if (factor) for (let i = 0; i < n; i++) residuo[i] ^= multiplicar(g[i + 1], factor);
  }
  return residuo;
}

// ---------------------------------------------------------------- Capacidad y datos

const bloquesDe = (version, correccion) => BLOQUES[correccion][version - 1];
const tamanoDe = (version) => 17 + 4 * version;
const bitsDeCuenta = (version) => (version <= 9 ? 8 : 16);

function palabrasDeDatos(version, correccion) {
  const [, n1, d1, n2] = bloquesDe(version, correccion);
  return n1 * d1 + n2 * (d1 + 1);
}

/** Bytes que caben en modo byte en esa versión y nivel. */
export function capacidadQr(version = VERSION_MAXIMA, correccion = "M") {
  const nivel = nivelDe(correccion);
  if (!Number.isInteger(version) || version < 1 || version > VERSION_MAXIMA) throw new Error(`Versión de código QR fuera de rango: ${version} (1 a ${VERSION_MAXIMA}).`);
  return Math.floor((palabrasDeDatos(version, nivel) * 8 - 4 - bitsDeCuenta(version)) / 8);
}

/** Bytes máximos en versión 10, nivel M (213). */
export const CAPACIDAD_QR = capacidadQr(VERSION_MAXIMA, "M");

function nivelDe(correccion) {
  const c = String(correccion ?? "").toUpperCase();
  if (!(c in NIVELES)) throw new Error(`Nivel de corrección de código QR desconocido: «${correccion}» (L, M, Q o H).`);
  return c;
}

const codificador = new TextEncoder();

/** Palabras de datos (con modo, cuenta, terminador y relleno) de los bytes en esa versión. */
function palabrasConRelleno(bytes, version, correccion) {
  const bits = [];
  const poner = (valor, largo) => {
    for (let i = largo - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(MODO_BYTE, 4);
  poner(bytes.length, bitsDeCuenta(version));
  for (const b of bytes) poner(b, 8);
  const capacidad = palabrasDeDatos(version, correccion) * 8;
  for (let i = 0; i < 4 && bits.length < capacidad; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const palabras = [];
  for (let i = 0; i < bits.length; i += 8) palabras.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; palabras.length < capacidad / 8; i++) palabras.push(RELLENO[i % 2]);
  return palabras;
}

/** Datos y corrección partidos en bloques y entrelazados palabra por palabra. */
function entrelazar(palabras, version, correccion) {
  const [ec, n1, d1, n2] = bloquesDe(version, correccion);
  const datos = [];
  let inicio = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const largo = i < n1 ? d1 : d1 + 1;
    datos.push(palabras.slice(inicio, inicio + largo));
    inicio += largo;
  }
  const correcciones = datos.map((bloque) => correccionDe(bloque, ec));
  const salida = [];
  for (let i = 0; i <= d1; i++) for (const bloque of datos) if (i < bloque.length) salida.push(bloque[i]);
  for (let i = 0; i < ec; i++) for (const bloque of correcciones) salida.push(bloque[i]);
  return salida;
}

// ---------------------------------------------------------------- Matriz

/** Residuo BCH: valor·2^(grado del generador) módulo el generador. */
function bch(valor, generador, grado) {
  let r = valor << grado;
  for (let i = 31 - Math.clz32(r); i >= grado; i--) if ((r >>> i) & 1) r ^= generador << (i - grado);
  return (valor << grado) | r;
}

const bitsDeFormato = (correccion, mascara) => bch((NIVELES[correccion] << 3) | mascara, 0x537, 10) ^ 0x5412;
const bitsDeVersion = (version) => bch(version, 0x1f25, 12);

const MASCARAS = [
  (f, c) => (f + c) % 2 === 0,
  (f) => f % 2 === 0,
  (f, c) => c % 3 === 0,
  (f, c) => (f + c) % 3 === 0,
  (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
  (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
  (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
  (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
];

/** Matriz con los patrones fijos y los datos sin enmascarar; `fija` marca lo que no es de datos. */
function base(version, palabras) {
  const n = tamanoDe(version);
  const modulos = Array.from({ length: n }, () => new Array(n).fill(false));
  const fija = Array.from({ length: n }, () => new Array(n).fill(false));
  const poner = (f, c, negro) => {
    modulos[f][c] = negro;
    fija[f][c] = true;
  };
  // Patrones de búsqueda (7 × 7) con su separador blanco alrededor.
  for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        const ff = f0 + f;
        const cc = c0 + c;
        if (ff < 0 || ff >= n || cc < 0 || cc >= n) continue;
        const anillo = Math.max(Math.abs(f - 3), Math.abs(c - 3));
        poner(ff, cc, anillo !== 2 && anillo !== 4);
      }
    }
  }
  // Patrones de alineación (5 × 5), salvo donde caen sobre los de búsqueda.
  const centros = ALINEACION[version - 1];
  for (const f0 of centros) {
    for (const c0 of centros) {
      if ((f0 === 6 && c0 === 6) || (f0 === 6 && c0 === n - 7) || (f0 === n - 7 && c0 === 6)) continue;
      for (let f = -2; f <= 2; f++) for (let c = -2; c <= 2; c++) poner(f0 + f, c0 + c, Math.max(Math.abs(f), Math.abs(c)) !== 1);
    }
  }
  // Sincronización: renglón y columna 6, alternando y empezando en negro.
  for (let i = 8; i < n - 8; i++) {
    poner(6, i, i % 2 === 0);
    poner(i, 6, i % 2 === 0);
  }
  // Lugar de la información de formato (se escribe después, con la máscara) y módulo oscuro. El
  // renglón y la columna 6 son de la sincronización.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    poner(8, i, false);
    poner(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    poner(8, n - 1 - i, false);
    poner(n - 1 - i, 8, false);
  }
  poner(n - 8, 8, true);
  // Información de versión (v7+): dos bloques de 6 × 3.
  if (version >= 7) {
    const bits = bitsDeVersion(version);
    for (let i = 0; i < 18; i++) {
      const negro = ((bits >>> i) & 1) === 1;
      poner(Math.floor(i / 3), n - 11 + (i % 3), negro);
      poner(n - 11 + (i % 3), Math.floor(i / 3), negro);
    }
  }
  // Datos: en zigzag, de dos en dos columnas desde abajo a la derecha, saltando la columna 6. Los
  // módulos que sobran (bits de residuo) quedan en blanco antes de la máscara.
  let bit = 0;
  const total = palabras.length * 8;
  let subir = true;
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let k = 0; k < n; k++) {
      const f = subir ? n - 1 - k : k;
      for (const c of [derecha, derecha - 1]) {
        if (fija[f][c]) continue;
        if (bit < total) modulos[f][c] = ((palabras[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    subir = !subir;
  }
  return { modulos, fija };
}

/** Copia de la matriz con la máscara aplicada a los datos y la información de formato escrita. */
function conMascara({ modulos, fija }, correccion, mascara) {
  const n = modulos.length;
  const aplicar = MASCARAS[mascara];
  const salida = modulos.map((fila, f) => fila.map((negro, c) => (fija[f][c] ? negro : negro !== aplicar(f, c))));
  const bits = bitsDeFormato(correccion, mascara);
  for (let i = 0; i < 15; i++) {
    const negro = ((bits >>> i) & 1) === 1;
    // Junto al patrón de arriba a la izquierda (columna 8 hacia abajo, renglón 8 hacia la izquierda)…
    if (i < 6) salida[i][8] = negro;
    else if (i < 8) salida[i + 1][8] = negro;
    else salida[n - 15 + i][8] = negro;
    // …y la copia repartida entre los otros dos.
    if (i < 8) salida[8][n - 1 - i] = negro;
    else if (i === 8) salida[8][7] = negro;
    else salida[8][14 - i] = negro;
  }
  return salida;
}

// ---------------------------------------------------------------- Penalización (ISO/IEC 18004, 7.8.3)

/**
 * Penalización de una matriz con las 4 reglas: tramos de 5 o más del mismo color (3 + lo que pase
 * de 5), bloques de 2 × 2 del mismo color (3 cada uno), el patrón 1:1:3:1:1 con 4 blancos antes o
 * después (40 cada uno, dentro del símbolo) y la proporción de negros (10 por cada 5 % completo de
 * distancia al 50 %). Exportada para las pruebas.
 */
export function penalizacionQr(modulos) {
  const n = modulos.length;
  let puntos = 0;
  const en = (f, c, porColumna) => (porColumna ? modulos[c][f] : modulos[f][c]);
  for (const porColumna of [false, true]) {
    for (let f = 0; f < n; f++) {
      // Regla 1: tramos.
      let largo = 0;
      let anterior = null;
      for (let c = 0; c < n; c++) {
        const v = en(f, c, porColumna);
        if (v === anterior) largo++;
        else {
          if (largo >= 5) puntos += largo - 2;
          largo = 1;
          anterior = v;
        }
      }
      if (largo >= 5) puntos += largo - 2;
      // Regla 3: 1011101 con 0000 antes o después (ventanas de 11 dentro del símbolo).
      for (let c = 0; c + 10 < n; c++) {
        const b = (k) => en(f, c + k, porColumna);
        const centro = !b(1) && b(4) && !b(5) && b(6) && !b(9);
        if (!centro) continue;
        if ((b(0) && b(2) && b(3) && !b(7) && !b(8) && !b(10)) || (!b(0) && !b(2) && !b(3) && b(7) && b(8) && b(10))) puntos += 40;
      }
    }
  }
  // Regla 2: bloques de 2 × 2.
  for (let f = 0; f + 1 < n; f++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = modulos[f][c];
      if (modulos[f][c + 1] === v && modulos[f + 1][c] === v && modulos[f + 1][c + 1] === v) puntos += 3;
    }
  }
  // Regla 4: proporción de negros, en enteros (sin redondeos de punto flotante).
  let negros = 0;
  for (const fila of modulos) for (const v of fila) if (v) negros++;
  const total = n * n;
  puntos += Math.floor(Math.abs(20 * negros - 10 * total) / total) * 10;
  return puntos;
}

// ---------------------------------------------------------------- API

/**
 * Matriz del código QR del texto (modo byte, UTF-8): { version, tamano, mascara, correccion, modulos }
 * con modulos[renglón][columna] = true si es negro y tamano = 17 + 4·version. Usa la menor versión
 * (1–10) en la que cabe; la máscara es la de menor penalización salvo que se fuerce una (0–7). Lanza
 * Error si el texto no cabe en la versión 10.
 */
export function matrizQr(texto, { correccion = "M", mascara = null } = {}) {
  const nivel = nivelDe(correccion);
  if (mascara !== null && mascara !== undefined && !(Number.isInteger(mascara) && mascara >= 0 && mascara <= 7)) {
    throw new Error(`Máscara de código QR fuera de rango: ${mascara} (0 a 7).`);
  }
  const bytes = codificador.encode(String(texto ?? ""));
  let version = 1;
  while (version <= VERSION_MAXIMA && bytes.length > capacidadQr(version, nivel)) version++;
  if (version > VERSION_MAXIMA) {
    throw new Error(
      `El texto es demasiado largo para el código QR: ${bytes.length} bytes y caben ${capacidadQr(VERSION_MAXIMA, nivel)} (versión ${VERSION_MAXIMA}, corrección ${nivel}). Acórtalo.`,
    );
  }
  const matriz = base(version, entrelazar(palabrasConRelleno(bytes, version, nivel), version, nivel));
  let elegida = mascara ?? null;
  let modulos = null;
  if (elegida === null) {
    let menor = Infinity;
    for (let m = 0; m < 8; m++) {
      const prueba = conMascara(matriz, nivel, m);
      const puntos = penalizacionQr(prueba);
      if (puntos < menor) {
        menor = puntos;
        elegida = m;
        modulos = prueba;
      }
    }
  } else {
    modulos = conMascara(matriz, nivel, elegida);
  }
  return { version, tamano: tamanoDe(version), mascara: elegida, correccion: nivel, modulos };
}

const RECIENTES = 256;
const recientes = new Map();

/**
 * El código QR como SVG (un solo path, módulos negros unidos en tramos horizontales) con `margen`
 * módulos blancos alrededor (4 = la zona silenciosa del estándar). null si el texto queda vacío (o
 * solo espacios) o no cabe. El SVG no lleva nada del texto.
 */
export function svgQr(texto, { margen = 4, correccion = "M" } = {}) {
  const contenido = String(texto ?? "");
  if (!contenido.trim()) return null;
  const nivel = nivelDe(correccion);
  if (codificador.encode(contenido).length > capacidadQr(VERSION_MAXIMA, nivel)) return null;
  const orilla = Number.isInteger(margen) && margen >= 0 ? margen : 4;
  // Las copias de una etiqueta (y cada vuelta a dibujar del editor) piden el mismo SVG: se recuerdan
  // los últimos (el resultado solo depende del nivel, el margen y el texto).
  const llave = `${nivel}|${orilla}|${contenido}`;
  if (recientes.has(llave)) return recientes.get(llave);
  const svg = dibujarSvg(matrizQr(contenido, { correccion: nivel }), orilla);
  if (recientes.size >= RECIENTES) recientes.delete(recientes.keys().next().value);
  recientes.set(llave, svg);
  return svg;
}

/** El SVG de una matriz: un tramo M x y h n v1 h −n z por cada racha de negros de cada renglón. */
function dibujarSvg({ tamano, modulos }, orilla) {
  const lado = tamano + 2 * orilla;
  const trazos = [];
  modulos.forEach((fila, f) => {
    for (let c = 0; c < tamano; c++) {
      if (!fila[c]) continue;
      let fin = c;
      while (fin + 1 < tamano && fila[fin + 1]) fin++;
      const largo = fin - c + 1;
      trazos.push(`M${c + orilla} ${f + orilla}h${largo}v1h-${largo}z`);
      c = fin;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">` +
    `<rect width="${lado}" height="${lado}" fill="#fff"/><path fill="#000" d="${trazos.join("")}"/></svg>`
  );
}
