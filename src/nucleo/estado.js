// Modelo de datos: un solo objeto JSON (el "estado") que se guarda completo en el
// navegador (IndexedDB) y en los respaldos. Reemplaza a la base SQLite de la versión
// de escritorio conservando las mismas entidades (docs/04-modelo-de-datos.md).
//
// Cantidades como texto decimal ("12.5"); fechas como texto ISO.

import { ahoraIso } from "./fechas.js";
import { claveEstricta } from "./normalizar.js";

export const FORMATO_ESTADO = 1;
export const ALMACEN_AX_DEFECTO = "RIG91-IX25";

export function estadoVacio() {
  return {
    formato: FORMATO_ESTADO,
    creado_en: ahoraIso(),
    secuencias: {},
    articulos: {}, // código → artículo
    variantes: [],
    ubicaciones: [],
    conteos: [],
    existencias: [],
    personas: [],
    alias: {}, // variante escrita → id de persona
    plantillas_area: [],
    vales: [],
    plantillas_excel: [],
    exportaciones: [],
    auditoria: [],
    config: {},
  };
}

export function siguienteId(estado, coleccion) {
  const actual = estado.secuencias[coleccion] || 0;
  estado.secuencias[coleccion] = actual + 1;
  return actual + 1;
}

export function estaVacio(estado) {
  return !estado || (!estado.existencias.length && !estado.vales.length);
}

export function auditar(estado, { usuario = null, entidad, entidadId = null, accion, antes = null, despues = null }) {
  estado.auditoria.push({
    id: siguienteId(estado, "auditoria"),
    fecha_hora: ahoraIso(),
    usuario,
    entidad,
    entidad_id: entidadId === null ? null : String(entidadId),
    accion,
    antes,
    despues,
  });
}

/**
 * Índices para búsquedas rápidas. Se construyen al vuelo a partir del estado y se
 * actualizan cuando se agrega algo por medio de estas funciones.
 */
export class Indices {
  constructor(estado) {
    this.estado = estado;
    this.variantes = new Map(estado.variantes.map((v) => [v.id, v]));
    this.porClave = new Map(estado.variantes.map((v) => [claveVariante(v.codigo, v.dimension_clave, v.np_clave, v.um), v]));
    this.ubicaciones = new Map(estado.ubicaciones.map((u) => [u.id, u]));
    this.conteos = new Map(estado.conteos.map((c) => [c.id, c]));
    this.existencias = new Map(estado.existencias.map((e) => [e.id, e]));
    this.personas = new Map(estado.personas.map((p) => [p.nombre, p]));
  }

  variante(id) {
    return this.variantes.get(id);
  }

  ubicacion(id) {
    return this.ubicaciones.get(id);
  }

  existencia(id) {
    return this.existencias.get(id);
  }

  articulo(codigo) {
    return this.estado.articulos[codigo] ?? null;
  }

  obtenerOCrearArticulo(codigo, descripcion, origen) {
    let articulo = this.estado.articulos[codigo];
    if (!articulo) {
      articulo = {
        codigo,
        descripcion: descripcion || `CÓDIGO ${codigo}`,
        clase: null,
        modelo_ax: null,
        origen,
        por_confirmar: true,
        activo: true,
      };
      this.estado.articulos[codigo] = articulo;
    }
    return articulo;
  }

  obtenerOCrearVariante(codigo, dimension, np, um) {
    const dimensionClave = claveEstricta(dimension);
    const npClave = claveEstricta(np);
    const clave = claveVariante(codigo, dimensionClave, npClave, um);
    let variante = this.porClave.get(clave);
    if (!variante) {
      variante = {
        id: siguienteId(this.estado, "variante"),
        codigo,
        dimension: dimension ?? null,
        np: np ?? null,
        um,
        dimension_clave: dimensionClave,
        np_clave: npClave,
        activo: true,
      };
      this.estado.variantes.push(variante);
      this.variantes.set(variante.id, variante);
      this.porClave.set(clave, variante);
    }
    return variante;
  }

  agregarUbicacion(datos) {
    const ubicacion = { id: siguienteId(this.estado, "ubicacion"), ...datos };
    this.estado.ubicaciones.push(ubicacion);
    this.ubicaciones.set(ubicacion.id, ubicacion);
    return ubicacion;
  }

  agregarConteo(datos) {
    const conteo = { id: siguienteId(this.estado, "conteo"), creado_en: ahoraIso(), ...datos };
    this.estado.conteos.push(conteo);
    this.conteos.set(conteo.id, conteo);
    return conteo;
  }

  agregarExistencia(datos) {
    const existencia = { id: siguienteId(this.estado, "existencia"), activo: true, ...datos };
    this.estado.existencias.push(existencia);
    this.existencias.set(existencia.id, existencia);
    return existencia;
  }

  /** Persona por nombre; si existe, completa los datos que le falten. */
  persona(nombre, datos = {}) {
    if (!nombre) return null;
    let persona = this.personas.get(nombre);
    if (!persona) {
      persona = {
        id: siguienteId(this.estado, "persona"),
        nombre,
        puesto: null,
        area: null,
        es_almacenista: false,
        activo: true,
        ...datos,
      };
      for (const [k, v] of Object.entries(datos)) if (v === undefined) persona[k] = null;
      this.estado.personas.push(persona);
      this.personas.set(nombre, persona);
    } else {
      for (const [clave, valor] of Object.entries(datos)) if (valor && !persona[clave]) persona[clave] = valor;
    }
    return persona;
  }
}

export function claveVariante(codigo, dimensionClave, npClave, um) {
  return `${codigo}\u0000${dimensionClave}\u0000${npClave}\u0000${um}`;
}

// Lo que se muestra y exporta de un renglón: la escritura de la hoja si difiere de la variante.
export const dimensionMostrada = (e, v) => (e.dimension_hoja ?? v.dimension) ?? null;
export const npMostrado = (e, v) => (e.np_hoja ?? v.np) ?? null;
export const umMostrada = (e, v) => (e.um_hoja ?? v.um) ?? null;

/** Todas las líneas de vale con su vale: [{ vale, linea }]. */
export function* lineasDeVales(estado) {
  for (const vale of estado.vales) for (const linea of vale.lineas) yield { vale, linea };
}

export function ultimoConteo(estado) {
  return estado.conteos.length ? estado.conteos[estado.conteos.length - 1] : null;
}
