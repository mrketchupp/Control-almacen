// Ronda 34 (docs/13-rediseno-vale-salida.md §2): el vale de salida se llena en 3 pasos, uno por decisión. Aquí,
// sin navegador, en qué paso está un borrador y qué falta para pasar al siguiente. El paso se guarda en el borrador
// (`paso`, opcional como `copia_de`: no cambia el formato del estado) y nunca llega al vale emitido.

import { lineasCapturadas, requiereAutoriza } from "./vales.js";

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
  if (!texto(datos.depto_destino) && !texto(datos.destino)) {
    falta.push({ campo: "depto_destino", mensaje: datos.naturaleza === "TRANSFERENCIA" ? "Falta el destino" : "Falta el área" });
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
