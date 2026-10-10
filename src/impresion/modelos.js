// Diseños de etiqueta (Ronda 22): qué lleva cada etiqueta y dónde. En el código se llaman **modelos** para
// no confundirlos con el «diseño» de la hoja que ya existía (`diseno`: papel, márgenes y tamaño de la
// etiqueta); en la interfaz el usuario los ve como «diseños». Un modelo es una lista de elementos (logos,
// título, texto de almacén, campos, texto libre, código QR y código de barras) colocados en PROPORCIÓN de
// la etiqueta: x, y, ancho y alto en % de su ancho y alto, y la letra en % de su alto. Así el mismo modelo
// sirve con cualquier plantilla de hoja.
//
// Los modelos se guardan en `config.etiquetas` (compartida entre DLTA y GSM) y llegan del otro inventario
// y de los respaldos: son entrada NO confiable. `normalizarModelo` / `normalizarElemento` dejan solo
// números finitos y acotados, valores conocidos y textos limpios y recortados; nada llega crudo al CSS ni
// al HTML (el render en etiquetas.js vuelve a normalizar y además escapa los textos).
//
// Los dos modelos de fábrica (Material y Código AX) reproducen la etiqueta de las Rondas 20–21 y no se
// guardan en el estado: son constantes de solo lectura.

/** Tipos de elemento y su nombre en la interfaz (el orden es el del menú «Agregar»). */
export const TIPOS_ELEMENTO = {
  logo_izq: "Logo izquierdo",
  logo_der: "Logo derecho",
  titulo: "Título",
  texto_almacen: "Texto de almacén",
  campo: "Campo",
  texto: "Texto libre",
  qr: "Código QR",
  barras: "Código de barras",
};

/** Datos de una etiqueta que puede llevar un campo (y que se sustituyen en {campo}). */
export const CAMPOS_ETIQUETA = {
  codigo: "Código",
  nombre: "Nombre",
  dimension: "Dimensión",
  np: "No. parte",
  descripcion: "Descripción",
  area: "Área",
  inventario: "Inventario",
};

/** Título de cada campo como se imprimía hasta la Ronda 21. */
export const TITULOS_CAMPO = {
  codigo: "CODIGO AX:",
  nombre: "NOMBRE:",
  dimension: "DIMENSIÓN:",
  np: "NO. PARTE:",
  descripcion: "DESCRIPCION:",
  area: "ÁREA:",
  inventario: "INVENTARIO:",
};

export const ALINEACIONES = { izq: "Izquierda", centro: "Centro", der: "Derecha" };
export const VERTICALES = { arriba: "Arriba", centro: "Centro", abajo: "Abajo" };

export const MAXIMO_ELEMENTOS = 40;
/** Modelos guardados como máximo (los de fábrica no cuentan). */
export const MAXIMO_MODELOS = 50;
/** Largo máximo de cada texto (en caracteres; lo demás se corta). */
export const LARGOS = { id: 64, nombre: 60, texto: 200, etiqueta: 40, vacio: 20, datos: 200 };
/** Letra en % del alto de la etiqueta (6.78 ≈ 10 px en 39 mm). */
export const LETRA = { minimo: 1, maximo: 80, defecto: 6.78 };
/** Espaciado entre letras en em. */
export const ESPACIADO = { minimo: -0.1, maximo: 1 };
/** Ancho y alto mínimos de un elemento, en %. */
export const LADO_MINIMO = 1;

/** Qué propiedades usa cada tipo, además de id, tipo, x, y, w y h. */
export const PROPIEDADES = {
  logo_izq: ["alinear", "vertical"],
  logo_der: ["alinear", "vertical"],
  titulo: ["texto", "letra", "negrita", "alinear", "vertical", "linea_abajo", "varias_lineas", "espaciado"],
  texto_almacen: ["letra", "negrita", "alinear", "vertical", "linea_abajo", "varias_lineas", "espaciado"],
  campo: ["campo", "etiqueta", "vacio", "letra", "negrita", "alinear", "vertical", "linea_abajo", "varias_lineas", "espaciado"],
  texto: ["texto", "vacio", "letra", "negrita", "alinear", "vertical", "linea_abajo", "varias_lineas", "espaciado"],
  qr: ["datos", "alinear", "vertical"],
  barras: ["datos", "texto_visible", "letra", "negrita"],
};

const TEXTO_TITULO = "ETIQUETADO ALMACEN";

// Lugar y tamaño de un elemento nuevo (y de uno guardado al que le falten), en %.
const CAJAS = {
  logo_izq: { x: 2.17, y: 5.13, w: 18.48, h: 21.79 },
  logo_der: { x: 79.35, y: 5.13, w: 18.48, h: 21.79 },
  titulo: { x: 21.74, y: 5.13, w: 56.52, h: 11.64 },
  texto_almacen: { x: 21.74, y: 16.77, w: 56.52, h: 10.15 },
  campo: { x: 2.17, y: 40, w: 50, h: 10.19 },
  texto: { x: 2.17, y: 40, w: 50, h: 10.19 },
  qr: { x: 70, y: 40, w: 22, h: 52 },
  barras: { x: 20, y: 60, w: 60, h: 30 },
};

// Valores por omisión de cada propiedad según el tipo.
function defectos(tipo, campo) {
  const texto = { letra: LETRA.defecto, negrita: false, alinear: "izq", vertical: "centro", linea_abajo: false, varias_lineas: false, espaciado: 0 };
  switch (tipo) {
    case "logo_izq":
    case "logo_der":
      return { alinear: "centro", vertical: "centro" };
    case "titulo":
      return { ...texto, texto: TEXTO_TITULO, letra: 7.46, negrita: true, alinear: "centro" };
    case "texto_almacen":
      return { ...texto, letra: 6.11, alinear: "centro" };
    case "campo":
      return { ...texto, campo, etiqueta: TITULOS_CAMPO[campo], vacio: "N/A", linea_abajo: true };
    case "texto":
      return { ...texto, texto: "", vacio: "" };
    case "qr":
      return { datos: "{codigo}", alinear: "centro", vertical: "centro" };
    case "barras":
      return { datos: "{codigo}", texto_visible: true, letra: LETRA.defecto, negrita: false };
    default:
      return {};
  }
}

const tiene = (objeto, clave) => typeof clave === "string" && Object.hasOwn(objeto, clave);
const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Un número de verdad: number finito o texto que solo es un número ("10", "-2.5"). Lo demás, NaN. */
function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
}

const centesimas = (n) => Math.round(n * 100);
const acotar = (n, minimo, maximo) => Math.min(maximo, Math.max(minimo, n));

/** El valor si es un número; si no, `defecto`; siempre dentro de [minimo, maximo] y a dos decimales. */
function medida(v, defecto, minimo, maximo) {
  const n = numero(v);
  return centesimas(acotar(Number.isFinite(n) ? n : defecto, minimo, maximo)) / 100;
}

// Controles, separadores de renglón y marcas de dirección del texto (bidi): se vuelven espacio.
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** Texto limpio y recortado a `largo` caracteres; null si no es texto (= «no lo trae»). */
export function textoLimpio(v, largo) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const limpio = String(v).replace(INVISIBLES, " ").trim();
  return Array.from(limpio).slice(0, largo).join("").trim();
}

const ID = /^[A-Za-z0-9_-]+$/;
/** Un id seguro (letras, números, - y _) o null. */
export const idValido = (v) => (typeof v === "string" && v.length <= LARGOS.id && ID.test(v) ? v : null);

const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const fechaValida = (v) => (typeof v === "string" && FECHA.test(v) ? v : null);

/**
 * Un elemento limpio, o null si no sirve (no es objeto, tipo desconocido o campo desconocido). Lleva
 * id, tipo, x, y, w, h y solo las propiedades de su tipo (PROPIEDADES), cada una corregida:
 * - x, y en [0, 100 − w] y [0, 100 − h]; w, h en [1, 100]; todo a dos decimales.
 * - letra en [1, 80] (% del alto), espaciado en [−0.1, 1] em; alinear / vertical conocidos.
 * - negrita, linea_abajo, varias_lineas, texto_visible: solo true / false.
 * - textos sin controles y recortados (LARGOS). `etiqueta`, `vacio` y `texto` que no vienen toman el
 *   valor por omisión; si vienen vacíos se respetan (etiqueta "" = solo el valor).
 * El id se respeta si es seguro; si no, queda null (normalizarModelo pone uno).
 */
export function normalizarElemento(el) {
  if (!esObjeto(el) || !tiene(TIPOS_ELEMENTO, el.tipo)) return null;
  const tipo = el.tipo;
  let campo = null;
  if (tipo === "campo") {
    if (!tiene(CAMPOS_ETIQUETA, el.campo)) return null;
    campo = el.campo;
  }
  const d = defectos(tipo, campo);
  const caja = CAJAS[tipo];
  const w = medida(el.w, caja.w, LADO_MINIMO, 100);
  const h = medida(el.h, caja.h, LADO_MINIMO, 100);
  const limpio = {
    id: idValido(el.id),
    tipo,
    x: medida(el.x, Math.min(caja.x, 100 - w), 0, centesimas(100 - w) / 100),
    y: medida(el.y, Math.min(caja.y, 100 - h), 0, centesimas(100 - h) / 100),
    w,
    h,
  };
  for (const prop of PROPIEDADES[tipo]) {
    const v = el[prop];
    switch (prop) {
      case "campo":
        limpio.campo = campo;
        break;
      case "letra":
        limpio.letra = medida(v, d.letra, LETRA.minimo, LETRA.maximo);
        break;
      case "espaciado":
        limpio.espaciado = medida(v, d.espaciado, ESPACIADO.minimo, ESPACIADO.maximo);
        break;
      case "alinear":
        limpio.alinear = tiene(ALINEACIONES, v) ? v : d.alinear;
        break;
      case "vertical":
        limpio.vertical = tiene(VERTICALES, v) ? v : d.vertical;
        break;
      case "negrita":
      case "linea_abajo":
      case "varias_lineas":
      case "texto_visible":
        limpio[prop] = typeof v === "boolean" ? v : d[prop];
        break;
      default: {
        // texto, etiqueta, vacio, datos
        const t = textoLimpio(v, LARGOS[prop]);
        limpio[prop] = t ?? d[prop];
      }
    }
  }
  return limpio;
}

/**
 * Un modelo limpio: { id, nombre, elementos, creado_en, cambiado_en }, o null si no es un objeto.
 * id: el que trae si es seguro, si no null (= nuevo). Elementos: los que sirven, hasta
 * MAXIMO_ELEMENTOS, con ids únicos (los repetidos o que faltan reciben `e1`, `e2`…).
 */
export function normalizarModelo(modelo) {
  if (!esObjeto(modelo)) return null;
  const elementos = (Array.isArray(modelo.elementos) ? modelo.elementos : [])
    .map(normalizarElemento)
    .filter(Boolean)
    .slice(0, MAXIMO_ELEMENTOS);
  const usados = new Set();
  const sinId = [];
  for (const el of elementos) {
    if (el.id && !usados.has(el.id)) usados.add(el.id);
    else sinId.push(el);
  }
  let n = 0;
  for (const el of sinId) {
    do el.id = `e${++n}`;
    while (usados.has(el.id));
    usados.add(el.id);
  }
  return {
    id: idValido(modelo.id),
    nombre: textoLimpio(modelo.nombre, LARGOS.nombre) ?? "",
    elementos,
    creado_en: fechaValida(modelo.creado_en),
    cambiado_en: fechaValida(modelo.cambiado_en),
  };
}

/** Un elemento nuevo del tipo (con su lugar y valores por omisión), para el editor. */
export function elementoNuevo(tipo, { campo = "codigo", id = null } = {}) {
  return normalizarElemento({ tipo, campo, id, ...(tipo === "texto" ? { texto: "Texto libre" } : {}) });
}

// ---------------------------------------------------------------- de fábrica

// Se escriben en mm sobre la etiqueta estándar (92 × 39 mm, letra de 10 px) para que se vean como la de las
// Rondas 20–21: borde + relleno de 1.5 mm, encabezado de 8.5 mm con logos de 17 mm y, debajo, los campos
// repartidos como lo hacía `justify-content: space-evenly`. Chromium (Edge) dibuja los bordes en píxeles
// enteros: el de 0.5 mm y las líneas de 0.2 mm salían de 1 px (0.26 mm), y así se cuentan aquí.
const ANCHO = 92;
const ALTO = 39;
const PX = 25.4 / 96;
const ORILLA = PX + 1.5; // borde de la etiqueta + relleno
const LINEA = PX;
const UTIL = ANCHO - 2 * ORILLA;
const enX = (mm) => centesimas((mm / ANCHO) * 100) / 100;
const enY = (mm) => centesimas((mm / ALTO) * 100) / 100;
const letraPx = (px) => centesimas(((px * PX) / ALTO) * 100) / 100;
const caja = (x, y, w, h) => ({ x: enX(x), y: enY(y), w: enX(w), h: enY(h) });

// Título (11 px) y texto de almacén (9 px), interlineado 1.1, centrados juntos en los 8.5 mm del encabezado.
const ALTO_TITULO = 11 * 1.1 * PX;
const ALTO_ALMACEN = 9 * 1.1 * PX;
const FIN_TITULO = ORILLA + (8.5 - ALTO_TITULO - ALTO_ALMACEN) / 2 + ALTO_TITULO;
const FIN_ENCABEZADO = ORILLA + 8.5;

const ENCABEZADO = [
  { id: "logo-izq", tipo: "logo_izq", ...caja(ORILLA, ORILLA, 17, 8.5) },
  { id: "titulo", tipo: "titulo", ...caja(ORILLA + 18, ORILLA, UTIL - 36, FIN_TITULO - ORILLA), texto: TEXTO_TITULO, letra: letraPx(11), negrita: true, alinear: "centro", vertical: "abajo" },
  { id: "almacen", tipo: "texto_almacen", ...caja(ORILLA + 18, FIN_TITULO, UTIL - 36, FIN_ENCABEZADO - FIN_TITULO), letra: letraPx(9), alinear: "centro", vertical: "arriba" },
  { id: "logo-der", tipo: "logo_der", ...caja(ANCHO - ORILLA - 17, ORILLA, 17, 8.5) },
];

// Seis renglones de campos debajo del encabezado (y 1 mm de aire): cada uno con 0.3 mm de relleno arriba y
// abajo, la línea de 10 px y su línea; el último sin línea; lo que sobra, repartido en 7 huecos iguales.
const INICIO_CAMPOS = FIN_ENCABEZADO + 1;
const RENGLON = 0.6 + 12 * PX + LINEA;
const HUECO = (ALTO - ORILLA - INICIO_CAMPOS - (6 * RENGLON - LINEA)) / 7;
const renglon = (i) => INICIO_CAMPOS + HUECO * (i + 1) + RENGLON * i;
const campo = (id, campoDe, x, w, i) => ({
  id,
  tipo: "campo",
  campo: campoDe,
  ...caja(x, renglon(i), w, i === 5 ? RENGLON - LINEA : RENGLON),
  etiqueta: TITULOS_CAMPO[campoDe],
  vacio: "N/A",
  letra: letraPx(10),
  linea_abajo: i !== 5,
});
// Código e inventario en el primer renglón, en dos columnas con 2 mm entre ellas.
const COLUMNA = (UTIL - 2) / 2;

// Código AX: el nombre (12 px, hasta dos renglones, 0.5 mm de relleno arriba y abajo, 1 mm a los lados)
// abajo; el código (45 px), centrado entre el encabezado y un nombre de un renglón (el caso común).
const FIN_NOMBRE = ALTO - ORILLA - 0.5;
const ALTO_NOMBRE_UNO = 0.5 + 12 * 1.2 * PX + 0.5;

const congelar = (objeto) => {
  for (const v of Object.values(objeto)) if (v && typeof v === "object") congelar(v);
  return Object.freeze(objeto);
};

function deFabrica(id, nombre, elementos) {
  return congelar({ ...normalizarModelo({ id, nombre, elementos }), fabrica: true });
}

/** Material: encabezado y siete campos en seis renglones (código e inventario en el primero). */
const FABRICA_MATERIAL = deFabrica("fabrica-material", "Material (de fábrica)", [
  ...ENCABEZADO,
  // El código llega hasta el inventario para que la línea de abajo sea una sola (antes era un renglón de dos columnas).
  campo("codigo", "codigo", ORILLA, COLUMNA + 2, 0),
  campo("inventario", "inventario", ORILLA + COLUMNA + 2, COLUMNA, 0),
  campo("nombre", "nombre", ORILLA, UTIL, 1),
  campo("dimension", "dimension", ORILLA, UTIL, 2),
  campo("descripcion", "descripcion", ORILLA, UTIL, 3),
  campo("np", "np", ORILLA, UTIL, 4),
  campo("area", "area", ORILLA, UTIL, 5),
]);

/** Código AX: encabezado, el código en grande y el nombre abajo. */
const FABRICA_AX = deFabrica("fabrica-ax", "Código AX (de fábrica)", [
  ...ENCABEZADO,
  {
    id: "codigo",
    tipo: "campo",
    campo: "codigo",
    ...caja(ORILLA, INICIO_CAMPOS, UTIL, ALTO - ORILLA - ALTO_NOMBRE_UNO - INICIO_CAMPOS),
    etiqueta: "",
    vacio: "",
    letra: letraPx(45),
    negrita: true,
    alinear: "centro",
    vertical: "centro",
    linea_abajo: false,
    espaciado: 0.15,
  },
  { id: "nombre", tipo: "campo", campo: "nombre", ...caja(ORILLA + 1, FIN_NOMBRE - 7.7, UTIL - 2, 7.7), etiqueta: "", vacio: "", letra: letraPx(12), alinear: "centro", vertical: "abajo", linea_abajo: false, varias_lineas: true },
]);

/** Los de fábrica, por id. */
export const MODELOS_FABRICA = Object.freeze({ [FABRICA_MATERIAL.id]: FABRICA_MATERIAL, [FABRICA_AX.id]: FABRICA_AX });

/** El de fábrica de cada lista. */
export const FABRICA_POR_TIPO = Object.freeze({ material: FABRICA_MATERIAL.id, ax: FABRICA_AX.id });

export const esModeloDeFabrica = (id) => typeof id === "string" && (Object.hasOwn(MODELOS_FABRICA, id) || id.startsWith("fabrica-"));

/** El modelo de fábrica de la lista `tipo` ("material" | "ax"; otro = el de material). */
export const modeloDeFabrica = (tipo) => MODELOS_FABRICA[FABRICA_POR_TIPO[tipo] ?? FABRICA_POR_TIPO.material];
