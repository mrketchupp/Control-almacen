// Catálogos editables (RF-05): áreas (plantillas del vale), personas y ajustes.

import { normalizarArea, tipoDeArea } from "../nucleo/areas.js";
import { auditar, siguienteId } from "../nucleo/estado.js";
import { nombrePersona } from "../nucleo/normalizar.js";
import { actualizarPuestoEnVales } from "./personas.js";

export class ErrorCatalogo extends Error {}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mayus = (v) => texto(v).toUpperCase() || null;

export const CAMPOS_AREA = [
  "nombre", "tipo", "hoja_excel", "origen", "depto_origen", "destino", "depto_destino",
  "recibe_nombre", "recibe_puesto", "autoriza_nombre", "autoriza_puesto", "observaciones", "lote_defecto",
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
    autoriza_puesto: "",
    firmas_extra: null,
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
    autoriza_puesto: mayus(datos.autoriza_puesto),
    firmas_extra: datos.firmas_extra
      ? Object.fromEntries(
          ["izq", "der"].map((lado) => [
            lado,
            { titulo: datos.firmas_extra[lado]?.titulo ?? null, nombre: nombrePersona(datos.firmas_extra[lado]?.nombre), puesto: mayus(datos.firmas_extra[lado]?.puesto) },
          ]),
        )
      : null,
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

/** Cuántos vales (emitidos) y borradores usan el área. */
export function usosDeArea(estado, id) {
  return {
    vales: estado.vales.filter((v) => v.plantilla_area_id === id).length,
    borradores: (estado.borradores ?? []).filter((b) => b.plantilla_area_id === id).length,
  };
}

/**
 * Descarta un área (deja de salir al hacer vales) o la recupera. Los vales que ya la usan no cambian
 * y se siguen imprimiendo con su formato.
 */
export function descartarArea(estado, id, descartar = true, usuario = null) {
  const area = estado.plantillas_area.find((p) => p.id === id);
  if (!area) throw new ErrorCatalogo("El área ya no existe.");
  const antes = area.activo !== false;
  area.activo = !descartar;
  if (antes !== area.activo) auditar(estado, { usuario, entidad: "plantilla_area", entidadId: id, accion: descartar ? "DESCARTAR" : "RECUPERAR", antes: { activo: antes }, despues: { activo: area.activo } });
  return area;
}

/**
 * Borra un área que ningún vale ni borrador usa (si alguno la usa, solo se puede descartar).
 * @returns { area, indice } para poder deshacerlo con `reponerArea`
 */
export function borrarArea(estado, id, usuario = null) {
  const indice = estado.plantillas_area.findIndex((p) => p.id === id);
  if (indice < 0) throw new ErrorCatalogo("El área ya no existe.");
  const area = estado.plantillas_area[indice];
  const usos = usosDeArea(estado, id);
  if (usos.vales || usos.borradores) {
    throw new ErrorCatalogo(`${area.nombre} la usan ${usos.vales} vale(s) y ${usos.borradores} borrador(es): no se borra, solo se puede descartar.`);
  }
  estado.plantillas_area.splice(indice, 1);
  auditar(estado, { usuario, entidad: "plantilla_area", entidadId: id, accion: "BORRAR", antes: { ...area }, despues: null });
  return { area, indice };
}

/** Vuelve a poner un área borrada (Deshacer), en su lugar. */
export function reponerArea(estado, { area, indice }, usuario = null) {
  if (estado.plantillas_area.some((p) => p.id === area.id)) return;
  if (estado.plantillas_area.some((p) => p.nombre.toUpperCase() === area.nombre.toUpperCase())) {
    throw new ErrorCatalogo(`Ya hay otra área llamada ${area.nombre}.`);
  }
  estado.plantillas_area.splice(Math.min(indice, estado.plantillas_area.length), 0, area);
  auditar(estado, { usuario, entidad: "plantilla_area", entidadId: area.id, accion: "REPONER", antes: null, despues: { ...area } });
}

/**
 * Crea o actualiza una persona. `actualizarVales` solo se habilita después de confirmar
 * la propagación del puesto; los demás usos del catálogo conservan el historial.
 */
export function guardarPersona(estado, datos, usuario = null, { actualizarVales = false } = {}) {
  const nombre = nombrePersona(datos.nombre);
  if (!nombre) throw new ErrorCatalogo("Falta el nombre.");
  if (estado.personas.some((p) => p.id !== datos.id && p.nombre === nombre)) throw new ErrorCatalogo(`Ya existe ${nombre}.`);
  const unificada = estado.personas.find((p) => p.id === estado.alias?.[nombre] && p.id !== datos.id);
  if (unificada) throw new ErrorCatalogo(`${nombre} ya está unificado con ${unificada.nombre}.`);
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
  if (actualizarVales) actualizarPuestoEnVales(estado, persona.id, usuario, { nombreAnterior: antes?.nombre });
  return persona;
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
