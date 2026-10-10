// Código de barras Code 128 para las etiquetas (Ronda 22), sin dependencias: lo que se imprime se arma
// aquí mismo y nada sale del equipo. Sigue ISO/IEC 15417 en lo que hace falta para una etiqueta:
// - solo ASCII imprimible (32–126): se codifica con los conjuntos B (letras, símbolos, dígitos sueltos)
//   y C (dos dígitos por símbolo); el conjunto A (caracteres de control) no hace falta;
// - el cambio de conjunto se elige por corrida de dígitos, para que el código sea lo más corto posible.
//   Entre corridas siempre hay letras o símbolos, que van en B, así que cada corrida se decide sola y
//   el resultado es el mínimo de símbolos con B y C (tests/barras.test.js lo compara con una búsqueda
//   exhaustiva):
//     · todo el texto numérico: C si el número de dígitos es par o hay 4 o más (con uno impar, CODE B
//       antes del último);
//     · al inicio o al final del texto: C con 4 dígitos o más;
//     · en medio: C con 6 o más (con 4 o 5, el CODE C y el CODE B de regreso cuestan lo que ahorran);
//     · con un número impar de dígitos, el que sobra va en B: al final de la corrida (como hace la
//       biblioteca python-barcode, la referencia de las pruebas), salvo en la corrida que termina el
//       texto, donde va al principio (así no hace falta regresar a B: un símbolo menos);
// - dígito de control = (valor del inicio + Σ valor · posición) mod 103; parada 2331112.
// Corre igual en Node y en el navegador. La salida SVG no lleva nada del texto, solo las barras.

/**
 * Anchos de barra y espacio (en módulos) de los 107 símbolos: valores 0–102, inicio A (103), inicio B
 * (104), inicio C (105) y la parada (106, con la barra final de 2 módulos). Cada símbolo empieza con
 * barra; los de datos suman 11 módulos y la parada 13.
 */
const ANCHOS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Los anchos como módulos: "1" = barra, "0" = espacio, alternando desde una barra. */
const PATRONES = ANCHOS.map((anchos) =>
  [...anchos].map((ancho, i) => (i % 2 ? "0" : "1").repeat(Number(ancho))).join(""),
);

const CODE_C = 99;
const CODE_B = 100;
const INICIO_B = 104;
const INICIO_C = 105;
const PARADA = 106;

/** Caracteres como máximo: más ya no se lee en una etiqueta (las barras quedan demasiado delgadas). */
export const LARGO_MAXIMO_BARRAS = 48;

/**
 * Lo que sí se puede poner en un Code 128: sin acentos (Á → A, Ñ → N, ü → u), los tabuladores, saltos
 * de renglón y espacios especiales como espacio, sin nada fuera de ASCII 32–126 (emoji, °, ½…) y sin
 * espacios en los extremos.
 */
export function textoParaBarras(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\s/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
}

/**
 * Los símbolos (valores 0–105) del texto ya limpio: inicio y datos, sin dígito de control ni parada.
 * Ver arriba cómo se elige el conjunto de cada corrida de dígitos.
 */
function simbolos(texto) {
  const valores = [];
  let conjunto = null; // "B" | "C"
  const enB = () => {
    if (conjunto !== "B") valores.push(conjunto === null ? INICIO_B : CODE_B);
    conjunto = "B";
  };
  const enC = () => {
    if (conjunto !== "C") valores.push(conjunto === null ? INICIO_C : CODE_C);
    conjunto = "C";
  };
  const comoB = (letras) => {
    enB();
    for (const letra of letras) valores.push(letra.charCodeAt(0) - 32);
  };
  const corridas = texto.match(/[0-9]+|[^0-9]+/g);
  /** Si la corrida de n dígitos ahorra en C, según dónde está. */
  const ahorraEnC = (n, inicio, fin) => {
    if (inicio && fin) return n % 2 === 0 || n >= 4;
    if (inicio || fin) return n >= 4;
    return n >= 6;
  };
  for (const [i, corrida] of corridas.entries()) {
    const n = corrida.length;
    const inicio = i === 0;
    const fin = i === corridas.length - 1;
    if (!/^[0-9]/.test(corrida) || !ahorraEnC(n, inicio, fin)) {
      comoB(corrida);
      continue;
    }
    let pares = corrida;
    let despues = "";
    if (n % 2 && fin && !inicio) {
      comoB(corrida[0]);
      pares = corrida.slice(1);
    } else if (n % 2) {
      pares = corrida.slice(0, -1);
      despues = corrida.slice(-1);
    }
    enC();
    for (let j = 0; j < pares.length; j += 2) valores.push(Number(pares.slice(j, j + 2)));
    if (despues) comoB(despues);
  }
  return valores;
}

/** Dígito de control: (inicio + Σ valor · posición) mod 103, con la posición desde 1 tras el inicio. */
function digitoDeControl(valores) {
  let suma = valores[0];
  for (let i = 1; i < valores.length; i++) suma += valores[i] * i;
  return suma % 103;
}

/**
 * El Code 128 del texto, o null si no queda nada que codificar o pasa de LARGO_MAXIMO_BARRAS.
 * - patron: módulos "1" (barra) y "0" (espacio): inicio, datos, dígito de control y parada, sin zona
 *   muda (la pone svgBarras);
 * - texto: lo que se codificó (textoParaBarras);
 * - cambiado: si textoParaBarras tuvo que cambiar algo (la interfaz lo avisa);
 * - modulos: largo del patrón.
 */
export function codigo128(texto) {
  const original = String(texto ?? "");
  const limpio = textoParaBarras(original);
  if (!limpio || limpio.length > LARGO_MAXIMO_BARRAS) return null;
  const valores = simbolos(limpio);
  valores.push(digitoDeControl(valores), PARADA);
  const patron = valores.map((v) => PATRONES[v]).join("");
  return { patron, texto: limpio, cambiado: limpio !== original, modulos: patron.length };
}

/**
 * El código de barras como SVG, o null (ver codigo128). Ancho = módulos + 2 · margen (zona muda, en
 * módulos; el estándar pide 10) y alto 1: con preserveAspectRatio="none" las barras se estiran al
 * tamaño del contenedor, sea cual sea la etiqueta. Cada barra es un rectángulo; nada del texto va
 * dentro del SVG.
 */
export function svgBarras(texto, { margen = 10 } = {}) {
  const codigo = codigo128(texto);
  if (!codigo) return null;
  const orilla = Number.isInteger(margen) && margen >= 0 ? margen : 10;
  const ancho = codigo.modulos + 2 * orilla;
  const trazos = [];
  for (const barra of codigo.patron.matchAll(/1+/g)) {
    const w = barra[0].length;
    trazos.push(`M${barra.index + orilla} 0h${w}v1h-${w}z`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} 1" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `<rect width="${ancho}" height="1" fill="#fff"/><path fill="#000" d="${trazos.join("")}"/></svg>`
  );
}
