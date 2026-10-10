// Editor de diseños de etiqueta (Ronda 22): la lógica que no necesita navegador, para probarla en Node.
// Geometría en % de la etiqueta (como los modelos, ver modelos.js): mover y cambiar el tamaño de una caja
// sin salirse de la etiqueta, imán a la cuadrícula, guías de alineación con los bordes y centros de los
// demás elementos y de la etiqueta, conversión px ↔ % ↔ mm, el zoom para que la etiqueta llene el espacio,
// deshacer / rehacer, agregar / duplicar / quitar / ordenar elementos y los avisos de lectura de QR y
// código de barras en la plantilla actual. La interfaz (ui/paginas/editorEtiquetas.js) solo traduce el
// ratón y el teclado a estas funciones.

import { codigo128 } from "./barras.js";
import { MARGEN_BARRAS, MARGEN_QR, llenarPlantilla, normalizarDiseno } from "./etiquetas.js";
import { LADO_MINIMO, MAXIMO_ELEMENTOS, TITULOS_CAMPO, elementoNuevo, normalizarElemento } from "./modelos.js";
import { CAPACIDAD_QR, matrizQr } from "./qr.js";

/** Lo que mueven las flechas (en % de la etiqueta); con Shift, el paso grande. */
export const PASO_FLECHA = 0.5;
export const PASO_FLECHA_GRANDE = 5;
/** Pasos de la cuadrícula que se ofrecen (en %). */
export const PASOS_CUADRICULA = [1, 2, 5];
/** Las 8 asas: norte, noreste, este… (o = oeste). */
export const ASAS = ["no", "n", "ne", "e", "se", "s", "so", "o"];
/** Mínimos para que un código se lea bien con cualquier lector. */
export const LECTURA = { qr_lado_mm: 12, barra_mm: 0.25, barra_minima_mm: 0.19, barras_alto_mm: 5 };
/** Píxeles de CSS por milímetro (96 por pulgada): «tamaño real» en pantalla. */
export const PX_POR_MM = 96 / 25.4;

const dos = (n) => Math.round(n * 100) / 100;
const acotar = (n, minimo, maximo) => Math.min(maximo, Math.max(minimo, n));

// ---------------------------------------------------------------- conversiones

/** Una distancia en px de pantalla como % de un lado que mide `ladoPx`. */
export const pxAPorciento = (px, ladoPx) => (ladoPx > 0 ? (px / ladoPx) * 100 : 0);
export const porcientoAPx = (porciento, ladoPx) => (porciento / 100) * ladoPx;
/** % de un lado de `ladoMm` en mm (a dos decimales, para mostrar). */
export const porcientoAMm = (porciento, ladoMm) => dos((porciento / 100) * ladoMm);
export const mmAPorciento = (mm, ladoMm) => (ladoMm > 0 ? (mm / ladoMm) * 100 : 0);

/** La letra (% del alto de la etiqueta) en mm y en px de pantalla a tamaño real (como la «Letra (px)» de antes). */
export function letraEnMedidas(letra, altoMm) {
  const mm = (letra / 100) * altoMm;
  return { mm: dos(mm), px: Math.round(mm * PX_POR_MM * 10) / 10, pt: Math.round((mm / 25.4) * 72 * 10) / 10 };
}

/**
 * Píxeles por mm para que una etiqueta de anchoMm × altoMm quepa en anchoPx × altoPx con `margen` px a
 * cada lado. Acotado a [minimo, maximo] (en px por mm).
 */
export function zoomParaAjustar(anchoMm, altoMm, anchoPx, altoPx, { margen = 24, minimo = 1, maximo = 40 } = {}) {
  if (!(anchoMm > 0) || !(altoMm > 0)) return minimo;
  const ancho = Math.max(0, anchoPx - 2 * margen);
  const alto = Math.max(0, altoPx - 2 * margen);
  return acotar(Math.min(ancho / anchoMm, alto / altoMm), minimo, maximo);
}

/** Un paso más grande o más chico de zoom (×1.25), acotado. */
export function siguienteZoom(actual, sentido, { minimo = 1, maximo = 40 } = {}) {
  const factor = sentido > 0 ? 1.25 : 1 / 1.25;
  return acotar(actual * factor, minimo, maximo);
}

// ---------------------------------------------------------------- cajas

/** x, y, w, h de un elemento. */
export const cajaDe = (el) => ({ x: el.x, y: el.y, w: el.w, h: el.h });

/** El valor redondeado al múltiplo de `paso` más cercano (paso ≤ 0 = sin imán). */
export function imantar(valor, paso) {
  if (!(paso > 0)) return valor;
  return dos(Math.round(valor / paso) * paso);
}

/** La caja movida dx, dy (en %), sin salirse de la etiqueta. */
export function moverCaja(caja, dx, dy) {
  return { ...caja, x: dos(acotar(caja.x + dx, 0, 100 - caja.w)), y: dos(acotar(caja.y + dy, 0, 100 - caja.h)) };
}

/**
 * x, y, w o h escritos a mano: el lado que no se escribió se respeta. Cambiar el ancho no mueve x (el
 * ancho se acota a lo que queda hasta la orilla); cambiar x no cambia el ancho (x se acota). Igual en alto.
 */
export function fijarCaja(caja, cambios) {
  const n = (v, antes) => (typeof v === "number" && Number.isFinite(v) ? v : antes);
  let { x, y, w, h } = caja;
  if ("w" in cambios) w = acotar(n(cambios.w, w), LADO_MINIMO, 100 - x);
  if ("h" in cambios) h = acotar(n(cambios.h, h), LADO_MINIMO, 100 - y);
  if ("x" in cambios) x = acotar(n(cambios.x, x), 0, 100 - w);
  if ("y" in cambios) y = acotar(n(cambios.y, y), 0, 100 - h);
  return { ...caja, x: dos(x), y: dos(y), w: dos(w), h: dos(h) };
}

const verticalDe = (asa) => (asa[0] === "n" || asa[0] === "s" ? asa[0] : null);
const horizontalDe = (asa) => (asa.at(-1) === "e" || asa.at(-1) === "o" ? asa.at(-1) : null);

/**
 * Bordes que mueve cada asa: { izq, der, arr, aba } (true = ese borde se mueve).
 */
export function bordesDeAsa(asa) {
  const v = verticalDe(asa);
  const h = horizontalDe(asa);
  return { izq: h === "o", der: h === "e", arr: v === "n", aba: v === "s" };
}

/**
 * Cambia el tamaño de la caja arrastrando el asa dx, dy (en %). El borde contrario se queda fijo; nunca
 * sale de la etiqueta ni queda más chica que `minimo`. `ajustar(eje, valor)` (opcional) corrige cada
 * borde que se mueve (imán / guías) antes de acotarlo.
 */
export function redimensionar(caja, asa, dx, dy, { minimo = LADO_MINIMO, ajustar = null } = {}) {
  const mueve = bordesDeAsa(asa);
  let izq = caja.x;
  let der = caja.x + caja.w;
  let arr = caja.y;
  let aba = caja.y + caja.h;
  const corrige = (eje, valor) => (ajustar ? ajustar(eje, valor) : valor);
  if (mueve.izq) izq = acotar(corrige("x", izq + dx), 0, der - minimo);
  if (mueve.der) der = acotar(corrige("x", der + dx), izq + minimo, 100);
  if (mueve.arr) arr = acotar(corrige("y", arr + dy), 0, aba - minimo);
  if (mueve.aba) aba = acotar(corrige("y", aba + dy), arr + minimo, 100);
  const x = dos(izq);
  const y = dos(arr);
  return { ...caja, x, y, w: dos(Math.max(minimo, dos(der) - x)), h: dos(Math.max(minimo, dos(aba) - y)) };
}

// ---------------------------------------------------------------- guías de alineación

/**
 * Las líneas a las que se alinea un elemento: orillas y centro de la etiqueta y de los demás elementos.
 * @returns {{ x: number[], y: number[] }} en %, sin repetir y ordenadas
 */
export function lineasGuia(elementos, { salvo = null } = {}) {
  const xs = new Set([0, 50, 100]);
  const ys = new Set([0, 50, 100]);
  for (const el of elementos) {
    if (el.id === salvo) continue;
    for (const v of [el.x, el.x + el.w / 2, el.x + el.w]) xs.add(dos(v));
    for (const v of [el.y, el.y + el.h / 2, el.y + el.h]) ys.add(dos(v));
  }
  const orden = (s) => [...s].sort((a, b) => a - b);
  return { x: orden(xs), y: orden(ys) };
}

/**
 * La línea más cercana a alguno de `propios` (dentro de `umbral`). @returns {{ delta, linea }} o null
 */
export function mejorAjuste(propios, lineas, umbral) {
  let mejor = null;
  for (const p of propios) {
    for (const l of lineas) {
      const delta = l - p;
      if (Math.abs(delta) <= umbral && (!mejor || Math.abs(delta) < Math.abs(mejor.delta))) mejor = { delta, linea: l };
    }
  }
  return mejor;
}

/** Las guías que coinciden con alguna orilla o el centro de la caja (para dibujarlas). */
export function guiasCoincidentes(caja, lineas, { tolerancia = 0.05 } = {}) {
  const propiasX = [caja.x, caja.x + caja.w / 2, caja.x + caja.w];
  const propiasY = [caja.y, caja.y + caja.h / 2, caja.y + caja.h];
  const cerca = (propias, l) => propias.some((p) => Math.abs(p - l) <= tolerancia);
  return {
    x: lineas.x.filter((l) => cerca(propiasX, l)),
    y: lineas.y.filter((l) => cerca(propiasY, l)),
  };
}

/**
 * Mover arrastrando: la caja inicial + dx, dy (en %) con guías e imán. Primero las guías (si alguna orilla
 * o el centro queda a `umbral` de una línea, se pega a ella); si no, la cuadrícula (`paso`, si hay imán).
 * Sin imán (`imán: false`, p. ej. con Alt) se mueve libre.
 * @param umbral { x, y } en % (≈ unos px de pantalla en cada eje)
 * @returns {{ caja, guias: { x: number[], y: number[] } }}
 */
export function moverArrastrando(inicio, dx, dy, { lineas = null, umbral = { x: 1, y: 1 }, paso = 0, iman = true } = {}) {
  const { w, h } = inicio;
  let x = acotar(inicio.x + dx, 0, 100 - w);
  let y = acotar(inicio.y + dy, 0, 100 - h);
  if (iman) {
    const ax = lineas ? mejorAjuste([x, x + w / 2, x + w], lineas.x, umbral.x) : null;
    const ay = lineas ? mejorAjuste([y, y + h / 2, y + h], lineas.y, umbral.y) : null;
    x = ax ? x + ax.delta : imantar(x, paso);
    y = ay ? y + ay.delta : imantar(y, paso);
  }
  const caja = { ...inicio, x: dos(acotar(x, 0, 100 - w)), y: dos(acotar(y, 0, 100 - h)) };
  return { caja, guias: iman && lineas ? guiasCoincidentes(caja, lineas) : { x: [], y: [] } };
}

/**
 * Cambiar el tamaño arrastrando un asa, con guías e imán en los bordes que se mueven.
 * @returns {{ caja, guias }}
 */
export function redimensionarArrastrando(inicio, asa, dx, dy, { lineas = null, umbral = { x: 1, y: 1 }, paso = 0, iman = true, minimo = LADO_MINIMO } = {}) {
  const ajustar = iman
    ? (eje, valor) => {
        const a = lineas ? mejorAjuste([valor], lineas[eje], umbral[eje]) : null;
        return a ? valor + a.delta : imantar(valor, paso);
      }
    : null;
  const caja = redimensionar(inicio, asa, dx, dy, { minimo, ajustar });
  if (!iman || !lineas) return { caja, guias: { x: [], y: [] } };
  // Solo las guías de los bordes que se movieron.
  const mueve = bordesDeAsa(asa);
  const bordesX = [mueve.izq ? caja.x : null, mueve.der ? caja.x + caja.w : null].filter((v) => v !== null);
  const bordesY = [mueve.arr ? caja.y : null, mueve.aba ? caja.y + caja.h : null].filter((v) => v !== null);
  const cerca = (bordes, l) => bordes.some((b) => Math.abs(b - l) <= 0.05);
  return { caja, guias: { x: lineas.x.filter((l) => cerca(bordesX, l)), y: lineas.y.filter((l) => cerca(bordesY, l)) } };
}

/** La caja movida con las flechas: 0.5 % (o 5 % con Shift). null si la tecla no es una flecha. */
export function moverConTecla(caja, tecla, grande = false) {
  const paso = grande ? PASO_FLECHA_GRANDE : PASO_FLECHA;
  const d = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[tecla];
  return d ? moverCaja(caja, d[0], d[1]) : null;
}

// ---------------------------------------------------------------- deshacer / rehacer

const mismo = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Historial nuevo con `presente` (p. ej. la lista de elementos). */
export function historial(presente, { limite = 100 } = {}) {
  return { pasado: [], presente, futuro: [], clave: null, en: 0, limite };
}

/**
 * Un cambio nuevo. Si trae la misma `clave` que el anterior y llega antes de `ventana` ms (p. ej. letras
 * escritas en un campo o flechas seguidas), se junta con él: un solo paso para deshacer. Un cambio que no
 * cambia nada no hace nada. Siempre borra lo que se podía rehacer.
 */
export function empujar(h, nuevo, { clave = null, ahora = Date.now(), ventana = 1200 } = {}) {
  if (mismo(nuevo, h.presente)) return h;
  if (clave !== null && clave === h.clave && ahora - h.en <= ventana && h.pasado.length) {
    return { ...h, presente: nuevo, futuro: [], en: ahora };
  }
  return { ...h, pasado: [...h.pasado, h.presente].slice(-h.limite), presente: nuevo, futuro: [], clave, en: ahora };
}

export const puedeDeshacer = (h) => h.pasado.length > 0;
export const puedeRehacer = (h) => h.futuro.length > 0;

export function deshacer(h) {
  if (!puedeDeshacer(h)) return h;
  return { ...h, pasado: h.pasado.slice(0, -1), presente: h.pasado.at(-1), futuro: [h.presente, ...h.futuro], clave: null };
}

export function rehacer(h) {
  if (!puedeRehacer(h)) return h;
  return { ...h, pasado: [...h.pasado, h.presente], presente: h.futuro[0], futuro: h.futuro.slice(1), clave: null };
}

// ---------------------------------------------------------------- elementos

/** Un id que no usa ningún elemento: `<base>-1`, `<base>-2`… (solo letras, números y -). */
export function idLibre(elementos, base = "e") {
  const raiz = String(base).replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "e";
  const usados = new Set(elementos.map((el) => el.id));
  let n = 1;
  while (usados.has(`${raiz}-${n}`)) n++;
  return `${raiz}-${n}`;
}

/** Corre la caja en diagonal mientras otro elemento ya esté exactamente ahí (así no se tapan). */
function sinEncimar(el, elementos, paso = 3) {
  let actual = el;
  for (let i = 0; i < 12 && elementos.some((o) => o.x === actual.x && o.y === actual.y); i++) {
    const corrido = moverCaja(cajaDe(actual), paso, paso);
    // En la orilla ya no se puede bajar ni ir a la derecha: se regresa a la esquina contraria.
    const atorado = corrido.x === actual.x && corrido.y === actual.y;
    actual = { ...actual, ...(atorado ? moverCaja(cajaDe(actual), -actual.x, -actual.y) : corrido) };
    if (atorado) break;
  }
  return actual;
}

/**
 * Agrega un elemento nuevo del tipo (con su lugar y valores por omisión) al final (encima de todos).
 * @returns {{ elementos, id }} o null si ya hay MAXIMO_ELEMENTOS o el tipo no se conoce
 */
export function agregarElemento(elementos, tipo, { campo = "codigo" } = {}) {
  if (elementos.length >= MAXIMO_ELEMENTOS) return null;
  const id = idLibre(elementos, tipo === "campo" ? campo : tipo.replace(/_/g, "-"));
  const nuevo = elementoNuevo(tipo, { campo, id });
  if (!nuevo) return null;
  const el = sinEncimar(nuevo, elementos);
  return { elementos: [...elementos, el], id };
}

/** Copia del elemento, un poco corrida, justo encima de él. @returns {{ elementos, id }} o null */
export function duplicarElemento(elementos, id) {
  const i = elementos.findIndex((el) => el.id === id);
  if (i < 0 || elementos.length >= MAXIMO_ELEMENTOS) return null;
  const original = elementos[i];
  const nuevoId = idLibre(elementos, original.id.replace(/-\d+$/, ""));
  const copia = sinEncimar({ ...original, id: nuevoId }, elementos, 2);
  return { elementos: [...elementos.slice(0, i + 1), copia, ...elementos.slice(i + 1)], id: nuevoId };
}

/** Pega una copia normalizada, con id libre y sin salirse de la etiqueta. */
export function pegarElemento(elementos, original) {
  if (elementos.length >= MAXIMO_ELEMENTOS) return null;
  const limpio = normalizarElemento(original);
  if (!limpio) return null;
  const id = idLibre(elementos, limpio.id.replace(/-\d+$/, ""));
  const copia = sinEncimar({ ...limpio, id }, elementos, 2);
  return { elementos: [...elementos, copia], id };
}

export const quitarElemento = (elementos, id) => elementos.filter((el) => el.id !== id);

/** Al frente = se dibuja al último (encima de todos); atrás = primero. */
export function alFrente(elementos, id) {
  const el = elementos.find((x) => x.id === id);
  return el ? [...elementos.filter((x) => x.id !== id), el] : elementos;
}

export function alFondo(elementos, id) {
  const el = elementos.find((x) => x.id === id);
  return el ? [el, ...elementos.filter((x) => x.id !== id)] : elementos;
}

/**
 * Cambia propiedades de un elemento y lo deja limpio (normalizarElemento: todo acotado). Al cambiar el
 * campo, si el título era el de fábrica del campo anterior, toma el del nuevo.
 */
export function cambiarElemento(elementos, id, cambios) {
  return elementos.map((el) => {
    if (el.id !== id) return el;
    const nuevo = { ...el, ...cambios, id: el.id, tipo: el.tipo };
    if (el.tipo === "campo" && cambios.campo && cambios.campo !== el.campo && !("etiqueta" in cambios) && el.etiqueta === TITULOS_CAMPO[el.campo]) {
      nuevo.etiqueta = TITULOS_CAMPO[cambios.campo];
    }
    return normalizarElemento(nuevo) ?? el;
  });
}

/** Cambia la caja de un elemento (sin pasar por la normalización de cada propiedad). */
export function conCaja(elementos, id, caja) {
  return elementos.map((el) => (el.id === id ? { ...el, x: caja.x, y: caja.y, w: caja.w, h: caja.h } : el));
}

/** Un nombre que no está en `nombres` (sin distinguir mayúsculas): «Diseño nuevo», «Diseño nuevo 2»… */
export function nombreLibre(nombres, base = "Diseño nuevo") {
  const clave = (t) => String(t ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("es");
  const usados = new Set(nombres.map(clave));
  for (let n = 1; ; n++) {
    const candidato = n === 1 ? base : `${base} ${n}`;
    if (!usados.has(clave(candidato))) return candidato;
  }
}

// ---------------------------------------------------------------- datos de QR y código de barras

/** Lo que más se pone en un QR o un código de barras. */
export const DATOS_PREDEFINIDOS = {
  codigo: { nombre: "Código", datos: "{codigo}" },
  codigo_dimension: { nombre: "Código + dimensión", datos: "{codigo} {dimension}" },
};

/** "codigo" | "codigo_dimension" | "libre" según los datos escritos. */
export function datosPredefinidos(datos) {
  const limpio = String(datos ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  for (const [clave, p] of Object.entries(DATOS_PREDEFINIDOS)) if (p.datos === limpio) return clave;
  return "libre";
}

/** Los {campos} que se pueden escribir en un texto libre o en los datos de un código. */
export const MARCADORES = ["{codigo}", "{nombre}", "{dimension}", "{np}", "{descripcion}", "{area}", "{inventario}"];

// ---------------------------------------------------------------- avisos de lectura

const largos = new Map();
/** Lado del QR en módulos (con su margen), recordado por texto. */
function modulosQr(datos) {
  if (!largos.has(datos)) {
    if (largos.size > 200) largos.clear();
    largos.set(datos, matrizQr(datos).tamano + 2 * MARGEN_QR);
  }
  return largos.get(datos);
}

/**
 * Avisos de un QR o un código de barras que, con la plantilla actual, quedan chicos para leerse con
 * cualquier lector (los de impresion/etiquetas.js `avisosElemento` dicen cuándo ya no se leen): QR de
 * menos de 12 mm de lado; barras más delgadas que 0.25 mm o de menos de 5 mm de alto.
 */
export function avisosLectura(el, etiqueta, diseno = null) {
  const x = normalizarElemento(el);
  if (!x || (x.tipo !== "qr" && x.tipo !== "barras")) return [];
  const d = normalizarDiseno(diseno);
  const ancho = (x.w / 100) * d.ancho;
  const alto = (x.h / 100) * d.alto;
  const datos = llenarPlantilla(x.datos, etiqueta);
  const avisos = [];
  if (x.tipo === "qr") {
    if (!datos.trim() || new TextEncoder().encode(datos).length > CAPACIDAD_QR) return [];
    const lado = Math.min(ancho, alto);
    const modulo = lado / modulosQr(datos);
    if (modulo >= 0.3 && lado < LECTURA.qr_lado_mm) {
      avisos.push(`El código QR mide ${lado.toFixed(1)} mm de lado: con menos de ${LECTURA.qr_lado_mm} mm algunos lectores no lo toman. Agrándalo si puedes.`);
    }
  } else {
    const codigo = codigo128(datos);
    if (!codigo) return [];
    const barra = ancho / (codigo.modulos + 2 * MARGEN_BARRAS);
    if (barra >= LECTURA.barra_minima_mm && barra < LECTURA.barra_mm) {
      const pide = Math.ceil((codigo.modulos + 2 * MARGEN_BARRAS) * LECTURA.barra_mm);
      avisos.push(`Las barras más delgadas quedan de ${barra.toFixed(2)} mm: para cualquier lector dale ${pide} mm de ancho (ahora ${Math.floor(ancho)} mm).`);
    }
    const texto = x.texto_visible ? (x.letra / 100) * d.alto * 1.2 : 0;
    const barras = alto - texto;
    if (barras < LECTURA.barras_alto_mm) avisos.push(`Las barras quedan de ${Math.max(0, barras).toFixed(1)} mm de alto: dales al menos ${LECTURA.barras_alto_mm} mm.`);
  }
  return avisos;
}
