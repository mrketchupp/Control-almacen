// Logos y textos del vale impreso, por inventario (Ronda 17). GSM usa el mismo formato de libro de
// vales que DLTA: al imprimir se cambian los textos fijos de la hoja-formulario (nombre del almacén,
// dirección…) y sus logos, sin tocar el Excel del usuario ni los datos del vale.

import { inventarioDelNombre } from "../nucleo/inventarios.js";

const escaparRegex = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patrón de una regla: sin importar mayúsculas y con cualquier cantidad de espacios entre palabras. */
function patron(buscar) {
  const limpio = String(buscar ?? "").trim();
  return limpio ? new RegExp(escaparRegex(limpio).replace(/\s+/g, "\\s+"), "gi") : null;
}

/** Aplica las reglas { buscar, poner } en orden a un texto; lo que no es texto queda igual. */
export function reemplazarTextos(texto, textos = []) {
  if (typeof texto !== "string" || !texto || !textos?.length) return texto;
  let salida = texto;
  for (const { buscar, poner } of textos) {
    const p = patron(buscar);
    if (p) salida = salida.replace(p, () => poner ?? "");
  }
  return salida;
}

/** En cuántos textos del formato aparece cada regla (0 = no coincide con nada: revisar cómo se escribió). */
export function coincidencias(textosFormato, textos = []) {
  return textos.map(({ buscar }) => {
    const p = patron(buscar);
    if (!p) return 0;
    return textosFormato.filter((t) => {
      p.lastIndex = 0;
      return p.test(t.texto);
    }).length;
  });
}

/**
 * Lo que se aplica al imprimir, a partir de `config.vale_impreso` del estado:
 * { textos: [{ buscar, poner }], logos: { huella: { src } | { quitar: true } } }
 */
export function identidadDe(estado) {
  const guardada = estado?.config?.vale_impreso ?? {};
  return { textos: guardada.textos ?? [], logos: guardada.logos ?? {} };
}

export const sinCambios = (identidad) => !identidad || (!identidad.textos?.length && !Object.keys(identidad.logos ?? {}).length);

/** Imágenes del formato con su reemplazo: sin las quitadas y con la imagen nueva donde se cambió. */
export function imagenesConIdentidad(imagenes, identidad) {
  if (!identidad?.logos) return imagenes;
  return imagenes
    .filter((i) => !identidad.logos[i.huella]?.quitar)
    .map((i) => (identidad.logos[i.huella]?.src ? { ...i, src: identidad.logos[i.huella].src } : i));
}

/** Junta textos fijos sin repetir, en el orden en que aparecen, contando en cuántas hojas está cada uno. */
function juntarTextos() {
  const vistos = new Map();
  return {
    agregar(valor, hoja, zona) {
      if (typeof valor !== "string") return;
      const texto = valor.trim();
      if (!texto || /^[\s\-_.:=*#/]+$/.test(texto)) return;
      if (!vistos.has(texto)) vistos.set(texto, { texto, hojas: new Set(), marca: inventarioDelNombre(texto), zona });
      vistos.get(texto).hojas.add(hoja);
    },
    lista: () => [...vistos.values()].map((t) => ({ ...t, hojas: t.hojas.size })),
  };
}

function agregarPagina(textos, modelo) {
  for (const seccion of [modelo.pagina?.encabezado, modelo.pagina?.pie]) {
    if (seccion) for (const parte of [seccion.izq, seccion.centro, seccion.der]) textos.agregar(parte, modelo.hoja, "pie");
  }
}

/**
 * Textos fijos de las hojas-formulario (sin repetir), en el orden en que aparecen: para elegir qué
 * debe decir distinto. `marca` = el inventario que nombra (p. ej. DLTA), para sugerirlo.
 * @param modelos  resultado de analizarFormulario de cada hoja
 */
export function textosDelFormato(modelos) {
  const textos = juntarTextos();
  for (const modelo of modelos) {
    for (const { r } of modelo.filas) for (const { c } of modelo.columnas) textos.agregar(modelo.valor(r, c), modelo.hoja, "hoja");
    agregarPagina(textos, modelo);
  }
  return textos.lista();
}

/**
 * El encabezado del formato tal como viene en el archivo: los textos fijos arriba de "Origen" / de las
 * partidas (nombre del almacén, dirección…) y los del encabezado y pie de página, sin las celdas que
 * llena el vale (fecha, folio, X de salida). Es lo que normalmente cambia de un inventario a otro.
 * @returns [{ texto, hojas, marca, zona: "encabezado" | "pie" }]
 */
export function encabezadoDelFormato(modelos) {
  const textos = juntarTextos();
  for (const modelo of modelos) {
    const campos = modelo.campos ?? {};
    const tope = Math.min(campos.origen?.r ?? Infinity, campos.lineas?.filas?.[0] ?? Infinity);
    const delVale = new Set(
      Object.values(campos)
        .filter((x) => x && Number.isInteger(x.r) && Number.isInteger(x.c))
        .map((x) => `${x.r},${x.c}`),
    );
    for (const { r } of modelo.filas) {
      if (r >= tope) continue;
      for (const { c } of modelo.columnas) if (!delVale.has(`${r},${c}`)) textos.agregar(modelo.valor(r, c), modelo.hoja, "encabezado");
    }
    agregarPagina(textos, modelo);
  }
  return textos.lista();
}

/**
 * Logos del formato (sin repetir): cada imagen fija de las hojas-formulario con su huella, su tamaño
 * impreso y en cuántas hojas está. Las fotos del vale (NOV) no cuentan.
 */
export function logosDelFormato(modelos) {
  const vistos = new Map();
  for (const modelo of modelos) {
    for (const imagen of modelo.imagenes) {
      if (!vistos.has(imagen.huella)) vistos.set(imagen.huella, { huella: imagen.huella, src: imagen.src, ancho: imagen.ancho, alto: imagen.alto, hojas: new Set() });
      vistos.get(imagen.huella).hojas.add(modelo.hoja);
    }
  }
  return [...vistos.values()].map((l) => ({ ...l, hojas: l.hojas.size }));
}
