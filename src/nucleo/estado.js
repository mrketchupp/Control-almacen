// Modelo de datos: un solo objeto JSON (el "estado") que se guarda completo en el
// navegador (IndexedDB) y en los respaldos. Reemplaza a la base SQLite de la versión
// de escritorio conservando las mismas entidades (docs/04-modelo-de-datos.md).
//
// Cantidades como texto decimal ("12.5"); fechas como texto ISO.

import { esInterna, etapaDe, normalizarArea, tieneDatosFijos } from "./areas.js";
import { ahoraIso } from "./fechas.js";
import { INVENTARIO_DEFECTO, inventarioPorId } from "./inventarios.js";
import { claveEstricta } from "./normalizar.js";

// Formato 2 (Fase 2): borradores de vales y envíos a la base.
// Formato 3: tipo de área (interna / externa / transferencia) y etapa de perforación.
// Formato 4: sin cancelación ni folio mínimo; puesto de quien autoriza, segunda fila de
// firmas (NOV) y fotos de los vales.
// Formato 5 (Fase 3): vales de entrada en borrador, conteo en curso y reacomodos entre
// contenedores. Cada conteo guarda su alcance y sus renglones contados.
// Formato 9: dos inventarios (DLTA y GSM), cada uno con su estado; `config.inventario` dice de cuál es.
// Formato 10 (Ronda 20): etiquetas por imprimir y la bitácora de las impresas.
// Formato 11 (Ronda 21): esa lista y esa bitácora son las mismas en DLTA y GSM: ids con el inventario.
export const FORMATO_ESTADO = 11;
export const ALMACEN_AX_DEFECTO = "RIG91-IX25";

export function estadoVacio(inventario = INVENTARIO_DEFECTO) {
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
    borradores: [], // vales en captura: no tienen folio
    envios: [], // cada vez que el DIARIO exportado se envió a la base
    borradores_entrada: [], // vales de entrada en captura: no tienen folio
    conteo_en_curso: null, // conteo físico capturándose (aún no cambia el inventario)
    reacomodos: [], // movimientos entre contenedores (no cambian el total)
    cortes_ax: [], // reportes de inventario de AX importados (conciliación)
    equivalencias_ax: {}, // renglón de AX (código|tamaño|color) → variante, confirmado por el usuario
    seguimientos_base: [], // archivos de vales de la base (qué partidas ya aplicó en AX, con IN / TR)
    etiquetas: { material: [], ax: [], cambiado_en: null }, // etiquetas por imprimir, de DLTA y GSM (servicios/etiquetas.js)
    impresiones_etiquetas: [], // cada vez que se imprimieron etiquetas (y de qué entradas)
    config: { inventario: inventarioPorId(inventario).id }, // DLTA o GSM: nunca se mezclan
  };
}

/**
 * Lleva un estado guardado con un formato anterior al actual. Se aplica al abrir la
 * herramienta, al restaurar un respaldo y al volver a una copia interna.
 */
export function migrarEstado(estado) {
  if (!estado) return estado;
  if (estado.formato < 2) {
    estado.borradores ??= [];
    estado.envios ??= [];
    estado.formato = 2;
  }
  if (estado.formato < 3) {
    // Los vales internos salen de RIG 91 · ALMACEN y llegan al mismo equipo.
    for (const area of estado.plantillas_area) normalizarArea(area);
    estado.config ??= {};
    const interna = estado.plantillas_area.find((a) => esInterna(a) && etapaDe(a.observaciones) !== null);
    estado.config.etapa_perforacion ??= interna ? etapaDe(interna.observaciones) : "";
    estado.config.captura_rapida ??= false;
    for (const b of estado.borradores) {
      b.etapa_perforacion ??= etapaDe(b.observaciones) ?? estado.config.etapa_perforacion;
      const area = estado.plantillas_area.find((a) => a.id === b.plantilla_area_id);
      if (esInterna(area)) Object.assign(b, { origen: area.origen, depto_origen: area.depto_origen, destino: area.destino });
    }
    estado.formato = 3;
  }
  if (estado.formato < 4) {
    // NOV (externa) también lleva datos fijos; los folios ya no se saltan.
    for (const area of estado.plantillas_area) normalizarArea(area);
    delete estado.config.folio_minimo_salida;
    // El puesto de quien autoriza y las firmas de NOV se leen otra vez de la hoja-formulario
    // (lo hace el almacén al abrir, porque necesita la plantilla guardada).
    estado.config.completar_areas = true;
    for (const b of estado.borradores) {
      b.fotos ??= [];
      const area = estado.plantillas_area.find((a) => a.id === b.plantilla_area_id);
      if (tieneDatosFijos(area)) Object.assign(b, { origen: area.origen, depto_origen: area.depto_origen, destino: area.destino, depto_destino: area.depto_destino });
    }
    estado.formato = 4;
  }
  if (estado.formato < 5) {
    estado.borradores_entrada ??= [];
    estado.conteo_en_curso ??= null;
    estado.reacomodos ??= [];
    // Los conteos anteriores (la primera carga) abarcaban todo el inventario.
    for (const conteo of estado.conteos) conteo.alcance ??= "TOTAL";
    estado.formato = 5;
  }
  if (estado.formato < 6) {
    // Conciliación contra AX (F4): cortes importados y memoria de equivalencias.
    estado.cortes_ax ??= [];
    estado.equivalencias_ax ??= {};
    estado.config ??= {};
    estado.config.almacen_ax ??= ALMACEN_AX_DEFECTO;
    estado.formato = 6;
  }
  if (estado.formato < 7) {
    // Archivo de vales de la base: qué partidas ya se aplicaron en AX (IN / TR).
    estado.seguimientos_base ??= [];
    estado.formato = 7;
  }
  if (estado.formato < 8) {
    // Vales asignados a mano (o por sugerencia aprobada) para justificar faltantes de cada corte de AX.
    for (const corte of estado.cortes_ax ?? []) corte.asignaciones ??= [];
    estado.formato = 8;
  }
  if (estado.formato < 9) {
    // Antes solo había un inventario: el de DLTA.
    estado.config ??= {};
    estado.config.inventario ??= INVENTARIO_DEFECTO;
    estado.formato = 9;
  }
  if (estado.formato < 10) {
    // Etiquetas de almacén (antes en el generador aparte): lista por imprimir y bitácora.
    estado.etiquetas ??= { material: [], ax: [] };
    estado.impresiones_etiquetas ??= [];
    estado.formato = 10;
  }
  if (estado.formato < 11) {
    // La lista y la bitácora de etiquetas se comparten con el otro inventario: los ids llevan el de este
    // (no chocan), el origen dice de cuál es, y una lista que ya traía etiquetas se junta con la del otro.
    const inventario = inventarioPorId(estado.config?.inventario).id;
    const etiquetas = estado.etiquetas ?? { material: [], ax: [] };
    for (const tipo of ["material", "ax"]) {
      etiquetas[tipo] ??= [];
      for (const e of etiquetas[tipo]) {
        if (typeof e.id === "number") e.id = `${inventario}-${e.id}`;
        if (e.origen?.tipo === "ENTRADA" || e.origen?.tipo === "INVENTARIO") e.origen.inventario ??= inventario;
      }
    }
    etiquetas.cambiado_en ??= null;
    if (etiquetas.material.length || etiquetas.ax.length) etiquetas.juntar = true;
    estado.etiquetas = etiquetas;
    for (const r of estado.impresiones_etiquetas ?? []) {
      if (typeof r.id === "number") r.id = `${inventario}-${r.id}`;
      r.vales = (r.vales ?? []).map((v) => (typeof v === "object" && v !== null ? v : { inventario, vale_id: v }));
    }
    estado.impresiones_etiquetas ??= [];
    estado.formato = 11;
  }
  return estado;
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
    // Un nombre unificado con otra persona (alias) lleva a esa persona: no se vuelve a crear repetida.
    const porId = new Map(estado.personas.map((p) => [p.id, p]));
    for (const [nombre, id] of Object.entries(estado.alias ?? {})) if (!this.personas.has(nombre) && porId.has(id)) this.personas.set(nombre, porId.get(id));
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
