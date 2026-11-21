// Ronda 34 (docs/13-rediseno-vale-salida.md §2): el vale de salida se llena en 3 pasos, uno por decisión. Aquí,
// sin navegador, en qué paso está un borrador y qué falta para pasar al siguiente. El paso se guarda en el borrador
// (`paso`, opcional como `copia_de`: no cambia el formato del estado) y nunca llega al vale emitido.

import { ORIGEN_EQUIPO, tipoDeArea } from "../nucleo/areas.js";
import { aplicarPlantilla, lineasCapturadas, pideEtapa, plantillaArea, requiereAutoriza } from "./vales.js";

export const PASOS = Object.freeze([
  Object.freeze({ numero: 1, nombre: "Para quién" }),
  Object.freeze({ numero: 2, nombre: "Material" }),
  Object.freeze({ numero: 3, nombre: "Revisar y emitir" }),
]);

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** El paso guardado en el borrador; uno sin paso (anterior a la Ronda 34) empieza en el 1, como uno nuevo. */
export const pasoDe = (borrador) => (PASOS.some((p) => p.numero === borrador?.paso) ? borrador.paso : 1);

/** Nombre del paso: «Para quién», «Material», «Revisar y emitir». */
export const nombrePaso = (numero) => PASOS.find((p) => p.numero === numero)?.nombre ?? "";

/**
 * Lo que falta para pasar de *Para quién* a *Material*: el área (o el destino, si es transferencia), el nombre de quien
 * recibe y, si el área lo pide, quién autoriza. Cada mensaje es corto: va debajo del campo que falta.
 * @returns [{ campo, mensaje }]
 */
export function faltaParaQuien(estado, datos) {
  const falta = [];
  // En una transferencia el área (TRANSFERENCIAS) ya trae su departamento: lo que se elige es el destino.
  if (esTransferencia(estado, datos) ? !texto(datos.destino) : !texto(datos.depto_destino) && !texto(datos.destino)) {
    falta.push({ campo: "depto_destino", mensaje: esTransferencia(estado, datos) ? "Falta el destino" : "Falta el área" });
  }
  if (!texto(datos.recibio_nombre)) falta.push({ campo: "recibio_nombre", mensaje: "Falta el nombre" });
  if (requiereAutoriza(estado, datos) && !texto(datos.autorizo_nombre)) falta.push({ campo: "autorizo_nombre", mensaje: "Falta quién autoriza" });
  return falta;
}

/** De *Material* a *Revisar y emitir*: al menos una partida. Las que no tienen cantidad no detienen aquí (sí al emitir). */
export function faltaMaterial(datos) {
  return lineasCapturadas(datos.lineas).length ? [] : [{ campo: "lineas", mensaje: "Agrega al menos una partida" }];
}

/** Lo que falta para avanzar desde `paso` (en el 3 no se avanza: se emite). */
export function faltaParaAvanzar(estado, datos, paso = pasoDe(datos)) {
  if (paso === 1) return faltaParaQuien(estado, datos);
  if (paso === 2) return faltaMaterial(datos);
  return [];
}

/** Cómo se ve cada paso en el indicador desde el paso actual: los anteriores, completos; los siguientes, pendientes. */
export function estadoDePasos(actual) {
  return PASOS.map((p) => ({ ...p, estado: p.numero < actual ? "completo" : p.numero === actual ? "actual" : "pendiente" }));
}

// ---------------------------------------------------------------- paso 1 · para quién (§3)

/**
 * A dónde se puede enviar una transferencia (decisión del usuario, Ronda 34): los RIG y las bases con que se
 * intercambia material. El equipo propio (`ORIGEN_EQUIPO`) no se ofrece; cualquier otro se escribe en *Otro destino*.
 */
export const DESTINOS_TRANSFERENCIA = Object.freeze(["RIG 48", "RIG 90", "RIG 91", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);

const igualLugar = (a, b) => texto(a).toUpperCase().replace(/\s+/g, " ") === texto(b).toUpperCase().replace(/\s+/g, " ");

/** Los destinos que se muestran como botones: todos menos el equipo de donde sale el vale. */
export const destinosTransferencia = (origen = ORIGEN_EQUIPO) => DESTINOS_TRANSFERENCIA.filter((d) => !igualLugar(d, origen));

/** ¿El destino escrito es uno de los botones? (si no, se ve en *Otro destino*). */
export const esDestinoConocido = (destino, origen = ORIGEN_EQUIPO) => destinosTransferencia(origen).some((d) => igualLugar(d, destino));

/** El área con que se hacen las transferencias (la primera vigente de tipo transferencia), o null si no hay. */
export function areaTransferencia(estado) {
  return estado.plantillas_area.find((p) => p.activo !== false && tipoDeArea(p) === "TRANSFERENCIA") ?? null;
}

/** ¿El vale es una transferencia (a otro RIG o pozo) o consumo del equipo (áreas internas y externas como NOV)? */
export function esTransferencia(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  return area ? tipoDeArea(area) === "TRANSFERENCIA" : datos.naturaleza === "TRANSFERENCIA";
}

/** Botones de *Área* en consumo interno: las vigentes que no son de transferencia (y la elegida, aunque ya no esté). */
export function areasConsumo(estado, elegida = null) {
  return estado.plantillas_area.filter((p) => tipoDeArea(p) !== "TRANSFERENCIA" && (p.activo !== false || p.id === elegida));
}

const ENCABEZADO_VACIO = {
  plantilla_area_id: null,
  origen: "",
  depto_origen: "",
  destino: "",
  depto_destino: "",
  recibio_nombre: "",
  recibio_puesto: "",
  autorizo_nombre: "",
  autorizo_puesto: "",
  firma_extra_izq_nombre: "",
  firma_extra_izq_puesto: "",
  firma_extra_der_nombre: "",
  firma_extra_der_puesto: "",
  observaciones: "",
  naturaleza: "CONSUMO",
};

/**
 * Cambia entre *Consumo interno* y *Enviar a otro RIG o pozo*. No se recuerda lo de antes (decisión del usuario): en
 * consumo se elige el área desde cero y en transferencia, el destino. Las partidas, la fecha y la etapa no cambian.
 * @returns copia de `datos`
 */
export function conTipoDeVale(estado, datos, transferencia) {
  const copia = { ...structuredClone(datos), ...ENCABEZADO_VACIO };
  if (!transferencia) return copia;
  const area = areaTransferencia(estado);
  if (area) aplicarPlantilla(estado, copia, area.id);
  else Object.assign(copia, { naturaleza: "TRANSFERENCIA", origen: ORIGEN_EQUIPO });
  copia.destino = "";
  return copia;
}

/** Con otra área de consumo: su plantilla (datos fijos, quién recibe, observaciones y firmas); las partidas no cambian. */
export function conArea(estado, datos, areaId) {
  const copia = structuredClone(datos);
  aplicarPlantilla(estado, copia, areaId);
  return copia;
}

/** Texto del pie del paso 1: «Observaciones de MECANICO y etapa 12 1/4" se llenan solas.» */
export function textoObservaciones(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  if (!area) return "";
  const etapa = texto(datos.etapa_perforacion);
  return pideEtapa(estado, datos) && etapa ? `Observaciones de ${area.nombre} y etapa ${etapa} se llenan solas.` : `Observaciones de ${area.nombre} se llenan solas.`;
}
