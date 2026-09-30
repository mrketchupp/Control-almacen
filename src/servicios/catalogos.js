// Catálogos editables (RF-05): áreas (plantillas del vale), personas y ajustes de folio.

import { normalizarArea, tipoDeArea } from "../nucleo/areas.js";
import { auditar, siguienteId } from "../nucleo/estado.js";
import { nombrePersona } from "../nucleo/normalizar.js";
import { siguienteFolio } from "./vales.js";

export class ErrorCatalogo extends Error {}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mayus = (v) => texto(v).toUpperCase() || null;

export const CAMPOS_AREA = [
  "nombre", "tipo", "hoja_excel", "origen", "depto_origen", "destino", "depto_destino",
  "recibe_nombre", "recibe_puesto", "autoriza_nombre", "observaciones", "lote_defecto",
];

export function areaVacia() {
  return {
    id: null,
    nombre: "",
    tipo: "INTERNO",
    hoja_excel: null,
    origen: "RIG 91",
    depto_origen: "ALMACEN",
    destino: "RIG 91",
    depto_destino: "",
    entrega_nombre: null,
    entrega_puesto: null,
    recibe_nombre: "",
    recibe_puesto: "",
    autoriza_nombre: "",
    requiere_autoriza: false,
    naturaleza: "CONSUMO",
    observaciones: "",
    lote_defecto: "",
    activo: true,
  };
}

/** Crea o actualiza un área. Devuelve el área guardada. */
export function guardarArea(estado, datos, usuario = null) {
  const nombre = mayus(datos.nombre);
  if (!nombre) throw new ErrorCatalogo("El área necesita un nombre.");
  if (estado.plantillas_area.some((p) => p.id !== datos.id && p.nombre.toUpperCase() === nombre)) {
    throw new ErrorCatalogo(`Ya existe un área llamada ${nombre}.`);
  }
  const tipo = tipoDeArea(datos);
  const limpio = {
    nombre,
    tipo,
    hoja_excel: datos.hoja_excel || null,
    origen: mayus(datos.origen),
    depto_origen: mayus(datos.depto_origen),
    destino: mayus(datos.destino),
    depto_destino: mayus(datos.depto_destino),
    recibe_nombre: nombrePersona(datos.recibe_nombre),
    recibe_puesto: mayus(datos.recibe_puesto),
    autoriza_nombre: nombrePersona(datos.autoriza_nombre),
    requiere_autoriza: Boolean(datos.requiere_autoriza) || tipo === "TRANSFERENCIA",
    naturaleza: tipo === "TRANSFERENCIA" ? "TRANSFERENCIA" : "CONSUMO",
    observaciones: texto(datos.observaciones) || null,
    lote_defecto: mayus(datos.lote_defecto),
    activo: datos.activo !== false,
  };
  normalizarArea(limpio);
  let area = estado.plantillas_area.find((p) => p.id === datos.id);
  const antes = area ? { ...area } : null;
  if (area) Object.assign(area, limpio);
  else {
    area = {
      id: siguienteId(estado, "plantilla_area"),
      entrega_nombre: null,
      entrega_puesto: null,
      orden: estado.plantillas_area.length + 1,
      ...limpio,
    };
    estado.plantillas_area.push(area);
  }
  auditar(estado, { usuario, entidad: "plantilla_area", entidadId: area.id, accion: antes ? "EDITAR" : "ALTA", antes, despues: { ...area } });
  return area;
}

/** Crea o actualiza una persona (nombre, puesto, almacenista, activa). */
export function guardarPersona(estado, datos, usuario = null) {
  const nombre = nombrePersona(datos.nombre);
  if (!nombre) throw new ErrorCatalogo("Falta el nombre.");
  if (estado.personas.some((p) => p.id !== datos.id && p.nombre === nombre)) throw new ErrorCatalogo(`Ya existe ${nombre}.`);
  let persona = estado.personas.find((p) => p.id === datos.id);
  const antes = persona ? { ...persona } : null;
  const limpio = {
    nombre,
    puesto: mayus(datos.puesto),
    es_almacenista: Boolean(datos.es_almacenista),
    activo: datos.activo !== false,
  };
  if (persona) Object.assign(persona, limpio);
  else {
    persona = { id: siguienteId(estado, "persona"), area: null, ...limpio };
    estado.personas.push(persona);
  }
  auditar(estado, { usuario, entidad: "persona", entidadId: persona.id, accion: antes ? "EDITAR" : "ALTA", antes, despues: { ...persona } });
  return persona;
}

/**
 * Siguiente folio mínimo (si se usaron folios en papel fuera de la herramienta).
 * Solo puede subir: nunca se reutiliza un folio.
 */
export function fijarFolioMinimo(estado, folio, usuario = null) {
  const valor = Number(folio);
  if (!Number.isInteger(valor) || valor <= 0) throw new ErrorCatalogo("Escribe un número de folio válido.");
  const actual = siguienteFolio(estado, "SALIDA");
  if (valor < actual) throw new ErrorCatalogo(`El siguiente folio ya es ${actual}; solo se puede aumentar.`);
  const antes = estado.config.folio_minimo_salida ?? null;
  estado.config.folio_minimo_salida = valor;
  auditar(estado, { usuario, entidad: "config", entidadId: "folio_minimo_salida", accion: "EDITAR", antes, despues: valor });
}

/** Ajustes generales guardados en el estado (van en los respaldos). */
export const AJUSTES = {
  captura_rapida: { tipo: "booleano", defecto: false },
  etapa_perforacion: { tipo: "texto", defecto: "" },
};

export function fijarAjuste(estado, clave, valor, usuario = null) {
  const def = AJUSTES[clave];
  if (!def) throw new ErrorCatalogo(`Ajuste desconocido: ${clave}`);
  const nuevo = def.tipo === "booleano" ? Boolean(valor) : texto(valor);
  const antes = estado.config[clave] ?? def.defecto;
  if (antes === nuevo) return;
  estado.config[clave] = nuevo;
  auditar(estado, { usuario, entidad: "config", entidadId: clave, accion: "EDITAR", antes, despues: nuevo });
}
