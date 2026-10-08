// Etiquetas de almacén (Ronda 20): lo que hacía el generador de etiquetas aparte, ahora con los datos
// que ya tiene la herramienta. Se cargan desde el inventario, desde un vale de entrada (por su folio
// E-0001 o por el de la base), a mano o desde una lista .json exportada del generador.
//
// Estado (formato 10): `estado.etiquetas = { material: [...], ax: [...] }` = lo que está por imprimir
// (va en los respaldos) y `estado.impresiones_etiquetas` = cada vez que se imprimieron (y de qué
// entradas: así se sabe a cuáles les faltan). El diseño de la hoja y la identidad de cada inventario
// (logos y texto de almacén) van en `config.etiquetas`, compartido entre DLTA y GSM
// (almacen/compartidos.js): una etiqueta de GSM lleva el logo de GSM aunque se imprima desde DLTA.
//
// Las etiquetas nunca cambian el inventario ni los vales.

import { dec } from "../nucleo/decimal.js";
import { Indices, auditar, dimensionMostrada, npMostrado, siguienteId } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { INVENTARIOS, inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { claveEstricta, sinAcentos, sinDimension, unidad } from "../nucleo/normalizar.js";
import { normalizarDiseno } from "../impresion/etiquetas.js";
import { folioEntrada } from "./entradas.js";
import { MAXIMO_LOGO } from "./valeImpreso.js";

export class ErrorEtiquetas extends Error {}

export const TIPOS_ETIQUETA = { material: "Material", ax: "Código AX" };
/** Etiquetas de una partida como máximo (se escriben a mano; más es casi seguro un error). */
export const MAXIMO_POR_PARTIDA = 999;

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const hay = (v) => v !== null && v !== undefined;

// Unidades que no se cuentan por pieza: 12.5 M de cable o 20 LTS de aceite llevan una etiqueta.
const CONTINUAS =
  /^(M|MT|MTS|MTRS?|METROS?|CM|MM|KM|FT|PIES?|PULG|LTS?|L|LITROS?|ML|GAL|GALON(ES)?|GL|KGS?|KILOS?|KILOGRAMOS?|GRS?|G|GRAMOS?|LBS?|TONS?|M2|M3|MT2|MT3|MTS2|MTS3)$/;

/**
 * Cuántas etiquetas se proponen para una cantidad: una por pieza (como hacía el generador con la foto
 * del vale); 1 si es una unidad continua (metros, litros, kilos…) o si la cantidad no es entera.
 */
export function cantidadPropuesta(cantidad, um) {
  const d = dec(cantidad);
  if (!d || d.lte(0) || CONTINUAS.test(sinAcentos(unidad(um))) || !d.round(0, 0).eq(d)) return 1;
  return Math.min(Number(d.toFixed()), MAXIMO_POR_PARTIDA);
}

const entero = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAXIMO_POR_PARTIDA) : 1;
};

// ---------------------------------------------------------------- configuración

/** Diseño de la hoja y, por inventario, sus logos (izquierdo / derecho) y su texto de almacén. */
export function configEtiquetas(estado) {
  const guardada = estado?.config?.etiquetas ?? {};
  const identidad = {};
  for (const { id } of INVENTARIOS) {
    const g = guardada.identidad?.[id] ?? {};
    identidad[id] = { logo_izq: g.logo_izq ?? null, logo_der: g.logo_der ?? null, texto: texto(g.texto) };
  }
  return { diseno: normalizarDiseno(guardada.diseno), identidad };
}

function guardarConfig(estado, cambio) {
  estado.config ??= {};
  const actual = structuredClone(estado.config.etiquetas ?? {});
  cambio(actual);
  estado.config.etiquetas = actual;
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Guarda el diseño de la hoja (vale para DLTA y GSM). @returns true si cambió */
export function fijarDiseno(estado, diseno, usuario = null) {
  const antes = configEtiquetas(estado).diseno;
  const nuevo = normalizarDiseno(diseno);
  if (igual(antes, nuevo) && estado.config?.etiquetas?.diseno) return false;
  guardarConfig(estado, (c) => (c.diseno = nuevo));
  auditar(estado, { usuario, entidad: "config", entidadId: "etiquetas.diseno", accion: "EDITAR", antes, despues: nuevo });
  return true;
}

const describirLogo = (logo) => (logo ? `imagen ${logo.nombre || "sin nombre"}` : "sin logo");

/**
 * Cambia la identidad de un inventario en sus etiquetas: { logo_izq, logo_der } = { src, nombre } o
 * null (sin logo); { texto } = texto de almacén bajo el título (vacío = no se imprime esa línea).
 */
export function fijarIdentidad(estado, inventario, cambios, usuario = null) {
  const id = inventarioPorId(inventario).id;
  const antes = configEtiquetas(estado).identidad[id];
  const despues = { ...antes };
  for (const lado of ["logo_izq", "logo_der"]) {
    if (!(lado in cambios)) continue;
    const logo = cambios[lado];
    if (logo) {
      if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo.src ?? "")) throw new ErrorEtiquetas("El logo debe ser una imagen PNG o JPG.");
      if (logo.src.length > MAXIMO_LOGO) throw new ErrorEtiquetas("El logo es muy grande: usa uno de menos de 300 KB.");
      despues[lado] = { src: logo.src, nombre: texto(logo.nombre) || null };
    } else despues[lado] = null;
  }
  if ("texto" in cambios) despues.texto = texto(cambios.texto);
  if (igual(antes, despues)) return false;
  guardarConfig(estado, (c) => {
    c.identidad ??= {};
    c.identidad[id] = despues;
  });
  const resumen = (x) => ({ logo_izq: describirLogo(x.logo_izq), logo_der: describirLogo(x.logo_der), texto: x.texto });
  auditar(estado, { usuario, entidad: "config", entidadId: `etiquetas.${id}`, accion: "EDITAR", antes: resumen(antes), despues: resumen(despues) });
  return true;
}

// ---------------------------------------------------------------- datos de una etiqueta

/** Nombre de cada código en AX (del reporte más reciente que lo trae). */
export function nombresAx(estado) {
  const nombres = new Map();
  const cortes = [...(estado.cortes_ax ?? [])].sort((a, b) => texto(a.fecha).localeCompare(texto(b.fecha)) || a.id - b.id);
  for (const corte of cortes) for (const l of corte.lineas ?? []) if (Number.isInteger(l.codigo) && texto(l.nombre)) nombres.set(l.codigo, texto(l.nombre));
  return nombres;
}

/** NOMBRE de la etiqueta: el de AX si el código viene en un reporte; si no, la descripción del inventario. */
export function nombreDe(estado, codigo, { nombres = nombresAx(estado), respaldo = "" } = {}) {
  const n = Number(codigo);
  if (!Number.isInteger(n)) return texto(respaldo);
  return nombres.get(n) || texto(estado.articulos?.[n]?.descripcion) || texto(respaldo);
}

/** Una etiqueta limpia: textos recortados, cantidad entera (1–999) e inventario válido. */
export function etiquetaLimpia(datos, inventario) {
  const d = datos ?? {};
  return {
    cantidad: entero(d.cantidad),
    codigo: texto(d.codigo),
    nombre: texto(d.nombre),
    dimension: texto(d.dimension),
    np: texto(d.np),
    descripcion: texto(d.descripcion),
    area: texto(d.area),
    inventario: inventarioPorId(texto(d.inventario) || inventario).id,
    origen: d.origen ?? { tipo: "MANUAL" },
  };
}

/** Lo que lleva la etiqueta de código AX (código en grande y nombre). */
export function comoAx(etiqueta) {
  const { cantidad, codigo, nombre, inventario, origen } = etiqueta;
  return { cantidad, codigo, nombre, inventario, origen };
}

/** Etiqueta de una partida del inventario: una por partida (la etiqueta del lugar). */
export function etiquetaDeExistencia(estado, existenciaId, { indices = new Indices(estado), nombres = nombresAx(estado), inventario = inventarioDe(estado).id } = {}) {
  const e = indices.existencia(existenciaId);
  if (!e) throw new ErrorEtiquetas("Esa partida ya no está en el inventario.");
  const v = indices.variante(e.variante_id);
  const u = indices.ubicacion(e.ubicacion_id);
  return etiquetaLimpia(
    {
      cantidad: 1,
      codigo: v.codigo,
      nombre: nombreDe(estado, v.codigo, { nombres }),
      dimension: dimensionMostrada(e, v),
      np: npMostrado(e, v),
      inventario,
      origen: { tipo: "INVENTARIO", existencia_id: e.id, hoja: texto(u?.hoja_excel) },
    },
    inventario,
  );
}

const esEntrada = (v) => v.tipo === "ENTRADA" && v.estado !== "CANCELADO";
const ocDe = (oc) => (texto(oc) && !/^S\s*\/?\s*OC$/i.test(texto(oc)) ? `OC: ${texto(oc)}` : "");

/**
 * Entradas que coinciden con lo escrito: el folio interno ("E-0005", "E5" o "5") o el folio del vale
 * de la base ("B-100"; también la parte de él). Sin texto, las más recientes.
 * @returns [{ vale, por: "interno" | "base" | null, exacto }]
 */
export function buscarEntradas(estado, consulta, { limite = 12 } = {}) {
  const entradas = estado.vales.filter(esEntrada).sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  const q = texto(consulta);
  if (!q) return entradas.slice(0, limite).map((vale) => ({ vale, por: null, exacto: false }));
  const interno = /^E\s*-?\s*0*(\d+)$/i.exec(q);
  const numero = /^\d+$/.test(q) ? Number(q) : interno ? Number(interno[1]) : null;
  const clave = claveEstricta(q);
  const hallados = [];
  for (const vale of entradas) {
    const base = claveEstricta(vale.folio_externo);
    if (numero !== null && vale.folio === numero) hallados.push({ vale, por: "interno", exacto: true });
    else if (!interno && clave && base === clave) hallados.push({ vale, por: "base", exacto: true });
    else if (!interno && clave.length >= 2 && base.includes(clave)) hallados.push({ vale, por: "base", exacto: false });
  }
  return hallados.sort((a, b) => Number(b.exacto) - Number(a.exacto)).slice(0, limite);
}

/**
 * Lo que se propone imprimir de una entrada, partida por partida: una etiqueta por pieza (1 si es
 * metro, litro, etc.), NOMBRE de AX, DESCRIPCIÓN = «OC: …» si trae orden de compra, ÁREA vacía e
 * INVENTARIO = el abierto. Las partidas sin existencia (diésel, gases…) se proponen sin marcar.
 * @returns [{ linea, sinExistencia, incluir, etiqueta }]
 */
export function etiquetasDeEntrada(estado, valeId, { indices = new Indices(estado), nombres = nombresAx(estado), inventario = inventarioDe(estado).id } = {}) {
  const vale = estado.vales.find((v) => v.id === valeId && esEntrada(v));
  if (!vale) throw new ErrorEtiquetas("No se encontró esa entrada.");
  const origen = { tipo: "ENTRADA", vale_id: vale.id, folio: folioEntrada(vale.folio), folio_externo: texto(vale.folio_externo) || null };
  return vale.lineas.map((l) => {
    const e = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
    const v = e ? indices.variante(e.variante_id) : hay(l.variante_id) ? indices.variante(l.variante_id) : null;
    // Sin partida del inventario, la clave que se guardó ("S/D" o "SIN DIMENSIÓN" si no traía) no es una dimensión.
    const dimension = e && v ? dimensionMostrada(e, v) : v ? v.dimension : sinDimension(l.clave) ? "" : l.clave;
    const np = e && v ? npMostrado(e, v) : v?.np;
    const etiqueta = etiquetaLimpia(
      {
        cantidad: cantidadPropuesta(l.cantidad, l.um),
        codigo: l.codigo,
        nombre: nombreDe(estado, l.codigo, { nombres, respaldo: l.descripcion }),
        dimension,
        np,
        descripcion: ocDe(l.oc),
        inventario,
        origen: { ...origen, linea_id: l.id },
      },
      inventario,
    );
    return { linea: l, sinExistencia: !e, incluir: Boolean(e), etiqueta };
  });
}

/**
 * Códigos para escribir a mano: por código (los que empiezan igual primero) o por nombre / descripción.
 * @returns [{ codigo, nombre, descripcion }]
 */
export function sugerenciasCodigo(estado, consulta, { nombres = nombresAx(estado), limite = 10 } = {}) {
  const q = sinAcentos(texto(consulta)).toUpperCase();
  if (!q) return [];
  const palabras = q.split(/\s+/).filter(Boolean);
  const codigos = new Set([...Object.keys(estado.articulos ?? {}).map(Number), ...nombres.keys()]);
  const hallados = [];
  for (const codigo of codigos) {
    if (!Number.isInteger(codigo)) continue;
    const c = String(codigo);
    const nombre = nombres.get(codigo) ?? "";
    const descripcion = texto(estado.articulos?.[codigo]?.descripcion);
    const enTexto = sinAcentos(`${nombre} ${descripcion}`).toUpperCase();
    let puntos;
    if (c === q) puntos = 0;
    else if (c.startsWith(q)) puntos = 1;
    else if (palabras.every((p) => enTexto.includes(p))) puntos = 2;
    else continue;
    hallados.push({ puntos, codigo, nombre: nombre || descripcion, descripcion });
  }
  return hallados
    .sort((a, b) => a.puntos - b.puntos || a.codigo - b.codigo)
    .slice(0, limite)
    .map(({ codigo, nombre, descripcion }) => ({ codigo, nombre, descripcion }));
}

/** Dimensiones y NP que tiene un código en el inventario (para sugerirlos al escribir a mano). */
export function clavesDeCodigo(estado, codigo) {
  const n = Number(codigo);
  const dimensiones = new Set();
  const nps = new Set();
  for (const v of estado.variantes) {
    if (v.codigo !== n || v.activo === false) continue;
    if (texto(v.dimension)) dimensiones.add(texto(v.dimension));
    if (texto(v.np)) nps.add(texto(v.np));
  }
  return { dimensiones: [...dimensiones].sort(), nps: [...nps].sort() };
}

// ---------------------------------------------------------------- lista por imprimir

function lista(estado, tipo) {
  if (!TIPOS_ETIQUETA[tipo]) throw new ErrorEtiquetas(`Tipo de etiqueta desconocido: ${tipo}.`);
  estado.etiquetas ??= { material: [], ax: [] };
  estado.etiquetas[tipo] ??= [];
  return estado.etiquetas[tipo];
}

export const etiquetasPorImprimir = (estado, tipo) => estado.etiquetas?.[tipo] ?? [];

/** Total de etiquetas (cada partida, tantas como su cantidad). */
export const totalEtiquetas = (etiquetas) => etiquetas.reduce((t, e) => t + entero(e.cantidad), 0);

/** Agrega etiquetas al final de la lista. @returns sus ids */
export function agregarEtiquetas(estado, tipo, etiquetas) {
  const inventario = inventarioDe(estado).id;
  const destino = lista(estado, tipo);
  const ids = [];
  for (const datos of etiquetas) {
    const limpia = etiquetaLimpia(datos, inventario);
    const etiqueta = { id: siguienteId(estado, "etiqueta"), ...(tipo === "ax" ? comoAx(limpia) : limpia), agregada_en: ahoraIso() };
    destino.push(etiqueta);
    ids.push(etiqueta.id);
  }
  return ids;
}

/** Cambia los datos de una etiqueta de la lista (solo los campos que trae `cambios`). */
export function cambiarEtiqueta(estado, tipo, id, cambios) {
  const etiqueta = lista(estado, tipo).find((e) => e.id === id);
  if (!etiqueta) throw new ErrorEtiquetas("Esa etiqueta ya no está en la lista.");
  const limpia = etiquetaLimpia({ ...etiqueta, ...cambios }, etiqueta.inventario);
  for (const campo of Object.keys(cambios)) if (campo in limpia && campo !== "origen") etiqueta[campo] = limpia[campo];
  return etiqueta;
}

/** Copia una etiqueta justo debajo de ella. @returns el id de la copia */
export function duplicarEtiqueta(estado, tipo, id) {
  const destino = lista(estado, tipo);
  const i = destino.findIndex((e) => e.id === id);
  if (i < 0) throw new ErrorEtiquetas("Esa etiqueta ya no está en la lista.");
  const copia = { ...structuredClone(destino[i]), id: siguienteId(estado, "etiqueta"), agregada_en: ahoraIso() };
  destino.splice(i + 1, 0, copia);
  return copia.id;
}

/** Quita etiquetas de la lista. @returns [{ etiqueta, indice }] para poder reponerlas (Deshacer) */
export function quitarEtiquetas(estado, tipo, ids) {
  const quitar = new Set(ids);
  const destino = lista(estado, tipo);
  const quitadas = destino.map((etiqueta, indice) => ({ etiqueta, indice })).filter((q) => quitar.has(q.etiqueta.id));
  estado.etiquetas[tipo] = destino.filter((e) => !quitar.has(e.id));
  return quitadas;
}

/** Vuelve a poner las etiquetas quitadas en su lugar (las que ya están no se repiten). */
export function reponerEtiquetas(estado, tipo, quitadas) {
  const destino = lista(estado, tipo);
  const presentes = new Set(destino.map((e) => e.id));
  for (const { etiqueta, indice } of [...quitadas].sort((a, b) => a.indice - b.indice)) {
    if (presentes.has(etiqueta.id)) continue;
    destino.splice(Math.min(indice, destino.length), 0, structuredClone(etiqueta));
  }
}

// ---------------------------------------------------------------- impresiones

/**
 * Las etiquetas salieron bien: queda en la bitácora (cuántas, quién, de qué entradas) y, si `quitar`,
 * salen de la lista. @returns el registro
 */
export function registrarImpresion(estado, tipo, ids, { usuario = null, quitar = true } = {}) {
  const elegidas = new Set(ids);
  const impresas = lista(estado, tipo).filter((e) => elegidas.has(e.id));
  if (!impresas.length) throw new ErrorEtiquetas("No hay etiquetas que registrar.");
  const vales = [...new Set(impresas.filter((e) => e.origen?.tipo === "ENTRADA").map((e) => e.origen.vale_id))];
  estado.impresiones_etiquetas ??= [];
  const registro = {
    id: siguienteId(estado, "impresion_etiquetas"),
    fecha_hora: ahoraIso(),
    usuario,
    tipo,
    partidas: impresas.length,
    etiquetas: totalEtiquetas(impresas),
    vales,
  };
  estado.impresiones_etiquetas.push(registro);
  if (quitar) quitarEtiquetas(estado, tipo, ids);
  return registro;
}

/** Impresiones de etiquetas de cada entrada: vale_id → [registros], del más reciente al más viejo. */
export function impresionesPorVale(estado) {
  const porVale = new Map();
  for (const r of [...(estado.impresiones_etiquetas ?? [])].reverse()) {
    for (const id of r.vales ?? []) {
      if (!porVale.has(id)) porVale.set(id, []);
      porVale.get(id).push(r);
    }
  }
  return porVale;
}

/** Entradas que tienen etiquetas en la lista por imprimir: vale_id → cuántas partidas. */
export function entradasEnLista(estado) {
  const enLista = new Map();
  for (const tipo of Object.keys(TIPOS_ETIQUETA)) {
    for (const e of etiquetasPorImprimir(estado, tipo)) {
      if (e.origen?.tipo === "ENTRADA") enLista.set(e.origen.vale_id, (enLista.get(e.origen.vale_id) ?? 0) + 1);
    }
  }
  return enLista;
}

/** Las entradas más recientes que aún no tienen etiquetas impresas ni en la lista. */
export function entradasSinEtiquetas(estado, { limite = 6 } = {}) {
  const impresas = impresionesPorVale(estado);
  const enLista = entradasEnLista(estado);
  return estado.vales
    .filter((v) => esEntrada(v) && !impresas.has(v.id) && !enLista.has(v.id))
    .sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0))
    .slice(0, limite);
}

// ---------------------------------------------------------------- lista del generador

/**
 * Lee una lista exportada del generador de etiquetas (formato "etiquetas-almacen"). La CONDICIÓN del
 * generador no se usa: el INVENTARIO es el abierto (se cambia por etiqueta). Se cuida cada campo.
 * @returns {{ material, ax, exportado }}
 */
export function leerListaGenerador(contenido, { inventario = "DLTA", archivo = null } = {}) {
  let datos;
  try {
    datos = JSON.parse(contenido);
  } catch {
    throw new ErrorEtiquetas("El archivo no es un .json válido.");
  }
  if (!datos || datos.format !== "etiquetas-almacen") throw new ErrorEtiquetas("El archivo no es una lista exportada del generador de etiquetas.");
  const origen = { tipo: "ARCHIVO", archivo: texto(archivo) || null };
  const comoObjeto = (x) => (x && typeof x === "object" ? x : {});
  const material = (Array.isArray(datos.materials) ? datos.materials : []).map(comoObjeto).map((m) =>
    etiquetaLimpia(
      { cantidad: m.cantidad, codigo: m.codigoAx, nombre: m.nombre, dimension: m.dimension, np: m.noParte, descripcion: m.descripcion, area: m.area ?? m.categoria, inventario, origen },
      inventario,
    ),
  );
  const ax = (Array.isArray(datos.axItems) ? datos.axItems : []).map(comoObjeto).map((m) => comoAx(etiquetaLimpia({ cantidad: m.cantidad, codigo: m.codigoAx, nombre: m.nombre, inventario, origen }, inventario)));
  if (!material.length && !ax.length) throw new ErrorEtiquetas("El archivo no trae partidas.");
  return { material, ax, exportado: texto(datos.exportedAt) || null };
}
