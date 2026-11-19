// Ronda 30 — dónde se guarda cada archivo del reporte diario, sin «Guardar como».
//
// El usuario guarda sus libros siempre en el mismo lugar:
//   · el libro de vales de salida, en un archivo fijo (el del Escritorio) que se reemplaza;
//   · el inventario del día, en <carpeta base>/<inventario>/<carpeta de inventarios>/<año>/<mes>/ (cada mes
//     tiene su carpeta y el nombre del archivo lleva la fecha DDMMAA).
// Aquí está lo que no depende del navegador: las rutas con {año} y {mes} (del día del reporte, que puede ser
// uno anterior), cómo se encuentran las carpetas aunque estén escritas un poco distinto ("05.MAYO" y
// "05. MAYO") y cómo se proponen las rutas al elegir la carpeta base. Las carpetas y archivos son los de la
// API de acceso a archivos (FileSystemDirectoryHandle / FileSystemFileHandle) o un doble en las pruebas.
//
// Edge no deja elegir como carpeta el Escritorio ni las que lo contienen (OneDrive completo): por eso el libro
// de vales se fija como archivo y los inventarios cuelgan de una carpeta dentro (p. ej. INVENTARIO DIARIO).

import { ratio } from "../nucleo/difflib.js";
import { sinAcentos } from "../nucleo/normalizar.js";
import { DUENO_FX, diceFx, inventarioDelNombre } from "../nucleo/inventarios.js";

export const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

/** Las rutas que se configuran: el inventario de cada uno y el de FX (que sale del de GSM). */
export const RUTAS = ["DLTA", "GSM", DUENO_FX];
/** Los libros de vales que se configuran (uno por inventario). */
export const LIBROS = ["DLTA", "GSM"];

/** Clave en los ajustes de la base común (lo comparten DLTA y GSM; no va en los respaldos: es de este equipo). */
export const CLAVE_DESTINOS = "destinos_reporte";

const dos = (n) => String(n).padStart(2, "0");

/** Lo que vale cada variable para una fecha AAAA-MM-DD. */
function valoresDe(fecha) {
  const [anio, mes] = String(fecha).split("-").map(Number);
  const nombre = MESES[mes - 1];
  return { "año": String(anio), mm: dos(mes), nombre_mes: nombre, mes: `${dos(mes)}. ${nombre}` };
}

/** Variables de las rutas, con un ejemplo. `ano` y `anio` también valen (para escribir sin ñ). */
export const VARIABLES = [
  { variable: "{año}", detalle: "el año", ejemplo: "2026" },
  { variable: "{mes}", detalle: "número y nombre", ejemplo: "11. NOVIEMBRE" },
  { variable: "{mm}", detalle: "número del mes", ejemplo: "11" },
  { variable: "{nombre_mes}", detalle: "nombre del mes", ejemplo: "NOVIEMBRE" },
];
const ALIAS = { "año": "año", ano: "año", anio: "año", mes: "mes", mm: "mm", nombre_mes: "nombre_mes" };
function nombreVariable(texto) {
  const limpia = String(texto).trim().toLowerCase();
  return ALIAS[limpia] ?? ALIAS[sinAcentos(limpia)] ?? null;
}

/** Separa la ruta escrita (con / o \) en carpetas, sin vacías ni espacios de los extremos. */
export function partesDeRuta(texto) {
  return String(texto ?? "")
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** La ruta escrita, ordenada: "ALMACEN DLTA\01. INVENTARIOS\{año}" → "ALMACEN DLTA/01. INVENTARIOS/{año}". */
export const normalizarRuta = (texto) => partesDeRuta(texto).join("/");

const PROHIBIDOS = /[<>:"|?*\u0000-\u001f]/;

/** null si la ruta se puede usar; si no, por qué (en palabras del usuario). */
export function problemaDeRuta(texto) {
  if (/^\s*([a-z]:|[\\/]{2})/i.test(String(texto ?? ""))) return "Escribe la ruta desde la carpeta base, sin «C:\\» ni la ruta completa";
  for (const parte of partesDeRuta(texto)) {
    if (parte === "." || parte === "..") return "La ruta no puede subir de carpeta («..»)";
    const desconocida = [...parte.matchAll(/\{([^{}]*)\}/g)].find((m) => !nombreVariable(m[1]));
    if (desconocida) return `No conozco ${desconocida[0]}: usa ${VARIABLES.map((v) => v.variable).join(", ")}`;
    const sinVariables = parte.replace(/\{[^{}]*\}/g, "");
    if (/[{}]/.test(sinVariables)) return `Falta cerrar una llave en «${parte}»`;
    if (PROHIBIDOS.test(sinVariables)) return `«${parte}» tiene un carácter que Windows no permite en carpetas (< > : " | ? *)`;
    if (/[. ]$/.test(parte)) return `«${parte}»: Windows no deja que una carpeta termine en punto o espacio`;
  }
  return null;
}


/**
 * Las carpetas de la ruta para el día `fecha`: [{ nombre, plantilla, variable }]. `variable` = lleva el año o
 * el mes (si falta, se crea); las fijas tienen que existir.
 */
export function carpetasPara(ruta, fecha) {
  const valores = valoresDe(fecha);
  return partesDeRuta(ruta).map((plantilla) => {
    let variable = false;
    const nombre = plantilla.replace(/\{([^{}]*)\}/g, (todo, v) => {
      const clave = nombreVariable(v);
      if (!clave) return todo;
      variable = true;
      return valores[clave];
    });
    return { nombre, plantilla, variable };
  });
}

/**
 * Para reconocer una carpeta aunque esté escrita un poco distinto: sin mayúsculas, acentos, espacios ni
 * puntos, y sin ceros a la izquierda ("05.MAYO" = "5. Mayo"; "SETIEMBRE" = "SEPTIEMBRE").
 */
export function claveCarpeta(nombre) {
  return sinAcentos(String(nombre ?? "").toUpperCase())
    .replace(/SETIEMBRE/g, "SEPTIEMBRE")
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/(^|[^0-9])0+(?=\d)/g, "$1");
}

/** Las subcarpetas de una carpeta: [{ nombre, carpeta }], en orden. */
export async function subcarpetas(carpeta) {
  const salida = [];
  for await (const [nombre, entrada] of carpeta.entries()) if (entrada.kind === "directory") salida.push({ nombre, carpeta: entrada });
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** La subcarpeta que se llama así (la escrita igual primero; si no, la que se escribe parecido). */
function buscar(lista, nombre) {
  return lista.find((s) => s.nombre === nombre) ?? lista.find((s) => s.nombre.toUpperCase() === nombre.toUpperCase()) ?? lista.find((s) => claveCarpeta(s.nombre) === claveCarpeta(nombre)) ?? null;
}

/** Las que más se parecen (para decir "ahí hay «01. INVENTARIOS»"). */
function parecidas(lista, nombre, cuantas = 3) {
  const clave = claveCarpeta(nombre);
  return lista
    .map((s) => ({ nombre: s.nombre, parecido: ratio(claveCarpeta(s.nombre), clave) }))
    .filter((s) => s.parecido >= 0.5)
    .sort((a, b) => b.parecido - a.parecido)
    .slice(0, cuantas)
    .map((s) => s.nombre);
}

/**
 * Recorre la ruta del día `fecha` desde `raiz`. Las carpetas fijas tienen que existir; las de año y mes que
 * falten se crean solo con `crear` (y solo si no falta una fija: nunca deja carpetas a medias).
 * @returns {{
 *   carpeta,            la carpeta final (null si aún no existe)
 *   carpetas: [{ nombre, existe, variable }], como quedan (con el nombre real de las que ya existían)
 *   nuevas: string[],   las que se crearon (o se crearían)
 *   falta: { nombre, dentro: string, hay: string[] } | null   una carpeta fija que no existe
 *   texto: string       "INVENTARIO DIARIO › ALMACEN DLTA › … › 11. NOVIEMBRE"
 * }}
 */
export async function abrirRuta(raiz, ruta, fecha, { crear = false } = {}) {
  const partes = carpetasPara(ruta, fecha);
  const recorrido = [];
  let actual = raiz;
  let falta = null;
  for (const parte of partes) {
    if (!actual) {
      // La anterior aún no existe: esta tampoco (si es fija, falta: no se inventan carpetas fijas).
      if (!parte.variable && !falta) falta = { nombre: parte.nombre, dentro: [raiz.name, ...recorrido.map((c) => c.nombre)].join(" › "), hay: [] };
      recorrido.push({ nombre: parte.nombre, existe: false, variable: parte.variable });
      continue;
    }
    const lista = await subcarpetas(actual);
    const hallada = buscar(lista, parte.nombre);
    if (hallada) {
      recorrido.push({ nombre: hallada.nombre, existe: true, variable: parte.variable, carpeta: hallada.carpeta });
      actual = hallada.carpeta;
      continue;
    }
    if (!parte.variable && !falta) falta = { nombre: parte.nombre, dentro: [raiz.name, ...recorrido.map((c) => c.nombre)].join(" › "), hay: parecidas(lista, parte.nombre) };
    recorrido.push({ nombre: parte.nombre, existe: false, variable: parte.variable });
    actual = null;
  }
  const nuevas = recorrido.filter((c) => !c.existe).map((c) => c.nombre);
  if (crear && !falta && nuevas.length) {
    actual = raiz;
    for (const c of recorrido) {
      actual = c.carpeta ?? (await actual.getDirectoryHandle(c.nombre, { create: true }));
      c.carpeta = actual;
    }
  }
  const carpetas = recorrido.map(({ nombre, existe, variable }) => ({ nombre, existe, variable }));
  const listo = recorrido.every((c) => c.carpeta);
  return {
    carpeta: falta ? null : listo ? (recorrido.at(-1)?.carpeta ?? raiz) : null,
    carpetas,
    nuevas,
    falta,
    texto: [raiz.name, ...carpetas.map((c) => c.nombre)].join(" › "),
  };
}

/** ¿Ya hay un archivo con ese nombre en la carpeta? */
export async function hayArchivo(carpeta, nombre) {
  if (!carpeta) return false;
  try {
    await carpeta.getFileHandle(nombre);
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError" || error?.name === "TypeError") return false;
    // Hay algo con ese nombre que no es un archivo (una carpeta) u otro problema: que lo diga al guardar.
    return error?.name === "TypeMismatchError";
  }
}

// ------------------------------------------------------------ proponer las rutas

const esAnio = (nombre) => /^(19|20)\d{2}$/.test(nombre.trim());

/** ¿La carpeta es de un mes? → su forma ({mes}, {mm}.{nombre_mes}, {nombre_mes}…) o null. */
function formaDeMes(nombre) {
  const texto = sinAcentos(nombre.trim().toUpperCase()).replace(/SETIEMBRE/, "SEPTIEMBRE");
  const m = /^(\d{1,2})?(\s*[.\-_]?\s*)([A-Z]+)$/.exec(texto);
  if (!m || !MESES.includes(m[3])) return null;
  if (m[1] && Number(m[1]) !== MESES.indexOf(m[3]) + 1) return null;
  if (!m[1]) return "{nombre_mes}";
  return m[2] === ". " ? "{mes}" : `{mm}${m[2]}{nombre_mes}`;
}

/** La forma de las carpetas de mes que más se usa en las carpetas de año (la de {mes} si no hay o empatan). */
async function formaDeMeses(anios) {
  const cuenta = new Map();
  for (const anio of anios.slice(-2)) {
    for (const s of await subcarpetas(anio.carpeta)) {
      const forma = formaDeMes(s.nombre);
      if (forma) cuenta.set(forma, (cuenta.get(forma) ?? 0) + 1);
    }
  }
  let mejor = "{mes}";
  for (const [forma, n] of cuenta) if (n > (cuenta.get(mejor) ?? 0)) mejor = forma;
  return mejor;
}

const esDe = (id, nombre) => (id === DUENO_FX ? diceFx(nombre) : inventarioDelNombre(nombre) === id && !diceFx(nombre));

/**
 * Busca en la carpeta base (hasta 3 niveles) la de cada inventario y, dentro, la de los inventarios con sus
 * años; propone la ruta con {año} y la forma de mes que ya se usa. Lo que no encuentra queda en null.
 * Por ejemplo: "ALMACEN DLTA/01. INVENTARIOS/{año}/{mes}", "FX/{año}/{mes}".
 * @returns {{ [id]: string | null }}
 */
export async function proponerRutas(raiz, ids = RUTAS, { niveles = 3, maximo = 300 } = {}) {
  const propuestas = Object.fromEntries(ids.map((id) => [id, null]));
  const porVisitar = [{ carpeta: raiz, partes: [] }];
  const encontradas = new Map(); // id → { carpeta, partes }
  for (const id of ids) if (esDe(id, raiz.name)) encontradas.set(id, { carpeta: raiz, partes: [] });
  let vistas = 0;
  while (porVisitar.length && encontradas.size < ids.length && vistas < maximo) {
    const { carpeta, partes } = porVisitar.shift();
    vistas += 1;
    if (partes.length >= niveles) continue;
    for (const s of await subcarpetas(carpeta)) {
      const aqui = { carpeta: s.carpeta, partes: [...partes, s.nombre] };
      for (const id of ids) if (!encontradas.has(id) && esDe(id, s.nombre)) encontradas.set(id, aqui);
      if (!esAnio(s.nombre)) porVisitar.push(aqui);
    }
  }
  for (const [id, { carpeta, partes }] of encontradas) {
    let base = { carpeta, partes };
    let lista = await subcarpetas(carpeta);
    let anios = lista.filter((s) => esAnio(s.nombre));
    if (!anios.length) {
      // Dentro de la del inventario: la de los inventarios ("01. INVENTARIOS"), mejor si ya tiene años.
      const candidatas = lista.filter((s) => /INVENTARIO/.test(claveCarpeta(s.nombre)));
      for (const c of candidatas) {
        const suyas = (await subcarpetas(c.carpeta)).filter((s) => esAnio(s.nombre));
        if (suyas.length || c === candidatas.at(-1)) {
          base = { carpeta: c.carpeta, partes: [...partes, c.nombre] };
          anios = suyas;
          break;
        }
      }
    }
    propuestas[id] = [...base.partes, "{año}", await formaDeMeses(anios)].join("/");
  }
  return propuestas;
}

/**
 * De las carpetas elegidas en el explorador (las de dentro de la base, `raiz.resolve(elegida)`) a una ruta: el
 * año y el mes se vuelven {año} y {mes}, y si no llegó hasta ahí se agregan ("ALMACEN DLTA/01. INVENTARIOS" →
 * "ALMACEN DLTA/01. INVENTARIOS/{año}/{mes}").
 */
export function rutaDeCarpetas(partes) {
  const salida = [];
  let anio = false;
  let mes = false;
  for (const parte of partes) {
    if (!anio && esAnio(parte)) {
      salida.push("{año}");
      anio = true;
    } else if (anio && !mes && formaDeMes(parte)) {
      salida.push(formaDeMes(parte));
      mes = true;
    } else salida.push(parte);
  }
  if (!anio) salida.push("{año}");
  if (!mes) salida.push("{mes}");
  return salida.join("/");
}

// ------------------------------------------------------------ lo guardado

/** { raiz, rutas: { DLTA, GSM, FX }, vales: { DLTA, GSM } } con lo que falte en null. */
export function normalizarDestinos(guardado) {
  const rutas = Object.fromEntries(RUTAS.map((id) => {
    // Vacía = sin carpeta (se abre «Guardar como»).
    const ruta = typeof guardado?.rutas?.[id] === "string" ? normalizarRuta(guardado.rutas[id]) : "";
    return [id, ruta || null];
  }));
  const vales = Object.fromEntries(LIBROS.map((id) => [id, guardado?.vales?.[id] ?? null]));
  return { raiz: guardado?.raiz ?? null, rutas, vales };
}

/** Qué ruta usa cada exportación del reporte (INVENTARIO_FX → FX). */
export const rutaDeTipo = (tipo, inventario) => (tipo === "INVENTARIO_FX" ? DUENO_FX : inventario);

/**
 * El destino fijado para una exportación del reporte, o null (= «Guardar como», como antes).
 * @returns {{ clase: "carpeta", raiz, ruta, id } | { clase: "archivo", archivo, id } | null}
 */
export function destinoDe(destinos, tipo, inventario) {
  if (!destinos) return null;
  if (tipo === "VALES") {
    const archivo = destinos.vales?.[inventario];
    return archivo ? { clase: "archivo", archivo, id: inventario } : null;
  }
  if (tipo !== "INVENTARIO" && tipo !== "INVENTARIO_FX") return null;
  const id = rutaDeTipo(tipo, inventario);
  const ruta = destinos.rutas?.[id];
  if (!destinos.raiz || typeof ruta !== "string" || problemaDeRuta(ruta)) return null;
  return { clase: "carpeta", raiz: destinos.raiz, ruta, id };
}
