// Ronda 34 (docs/13-rediseno-vale-salida.md §2): el vale de salida se llena en 3 pasos, uno por decisión. Aquí,
// sin navegador, en qué paso está un borrador y qué falta para pasar al siguiente. El paso se guarda en el borrador
// (`paso`, opcional como `copia_de`: no cambia el formato del estado) y nunca llega al vale emitido.

import { ORIGEN_EQUIPO, conUsoEn, tieneUsoEn, tipoDeArea } from "../nucleo/areas.js";
import { decTexto } from "../nucleo/decimal.js";
import {
  aplicarPlantilla,
  conDatosFijos,
  conEntregaEnTurno,
  lineasCapturadas,
  observacionesDelVale,
  pideEtapa,
  plantillaArea,
  requiereAutoriza,
  validarVale,
} from "./vales.js";

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
 * Ronda 35: es la lista de fábrica; en *Áreas y destinos* se agregan otros (`config.destinos_transferencia`).
 */
export const DESTINOS_TRANSFERENCIA = Object.freeze(["RIG 48", "RIG 90", "RIG 91", "RIG 165", "RIG 256", "BASE IXACHI", "BASE MARIN"]);

export const igualLugar = (a, b) => texto(a).toUpperCase().replace(/\s+/g, " ") === texto(b).toUpperCase().replace(/\s+/g, " ");

/** La lista de destinos: la del usuario (compartida entre DLTA y GSM) o, si no ha cambiado nada, la de fábrica. */
export const listaDestinos = (estado) => (Array.isArray(estado?.config?.destinos_transferencia) ? estado.config.destinos_transferencia : DESTINOS_TRANSFERENCIA);

/** Los destinos que se muestran como botones: todos menos el equipo de donde sale el vale. */
export const destinosTransferencia = (estado, origen = ORIGEN_EQUIPO) => listaDestinos(estado).filter((d) => !igualLugar(d, origen));

/** ¿El destino escrito es uno de los botones? (si no, se ve en *Otro destino*). */
export const esDestinoConocido = (estado, destino, origen = ORIGEN_EQUIPO) => destinosTransferencia(estado, origen).some((d) => igualLugar(d, destino));

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
 * Cambia entre *Consumo interno* y *Transferencia* (a otro RIG o pozo, que es lo mismo). No se recuerda lo de antes
 * (decisión del usuario): en consumo se elige el área desde cero y en transferencia, el destino. Las partidas, la fecha
 * y la etapa no cambian.
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

/**
 * Con otro destino (transferencia): la línea «… PARA USO EN …» de las observaciones dice ese destino (Ronda 35; antes
 * se quedaba el texto fijo del formato). Si después se editan las observaciones, se respeta lo escrito hasta que se
 * vuelva a cambiar el destino.
 * @returns copia de `datos`
 */
export function conDestino(datos, destino) {
  return { ...datos, destino, observaciones: conUsoEn(datos.observaciones, destino) };
}

/**
 * Texto del pie del paso 1: «Observaciones de MECANICO y etapa 12 1/4" se llenan solas.»; en una transferencia,
 * «Las observaciones dicen «PARA USO EN RIG 48» y la etapa 8 1/2".»
 */
export function textoObservaciones(estado, datos) {
  const area = plantillaArea(estado, datos.plantilla_area_id);
  if (!area) return "";
  const etapa = pideEtapa(estado, datos) ? texto(datos.etapa_perforacion) : "";
  if (esTransferencia(estado, datos) && tieneUsoEn(datos.observaciones)) {
    const destino = texto(datos.destino).replace(/\s+/g, " ").toUpperCase();
    if (!destino) return "Al elegir el destino, las observaciones dicen «PARA USO EN …».";
    return `Las observaciones dicen «PARA USO EN ${destino}»${etapa ? ` y la etapa ${etapa}` : ""}.`;
  }
  return etapa ? `Observaciones de ${area.nombre} y etapa ${etapa} se llenan solas.` : `Observaciones de ${area.nombre} se llenan solas.`;
}

// ---------------------------------------------------------------- paso 3 · revisar y emitir (§5)

/** Los datos del vale tal como se emitirán (entrega quien está en turno, datos fijos del área, sin filas en blanco). */
export function paraEmitir(estado, datos, usuario) {
  const listo = conDatosFijos(estado, conEntregaEnTurno(estado, datos, usuario));
  return { ...listo, observaciones: observacionesDelVale(estado, listo), lineas: lineasCapturadas(listo.lineas) };
}

// A qué paso lleva «Corregir» cada dato del encabezado.
const PASO_DEL_CAMPO = { fecha: 1, depto_destino: 1, recibio_nombre: 1, autorizo_nombre: 1, etapa_perforacion: 1, lineas: 2 };

/** «Partida 3: falta la unidad (UM).» → «Falta la unidad (UM).» (en su fila ya se sabe cuál partida es). */
const sinPartida = (mensaje) => {
  const t = String(mensaje ?? "").replace(/^Partida \d+:\s*/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Lo que falta antes de emitir (§5.1), uno por problema: partida sin cantidad («Ir a la partida»), cantidad mayor que la
 * existencia (la justificación se escribe ahí mismo; se queda aunque ya tenga texto, para no perder el campo al
 * escribir), fotos del formato que faltan y cualquier otro error de `validarVale` con el paso que lo corrige.
 * `espacios`: cuántas fotos pide el formato del área (NOV: 3); faltar una bloquea *Emitir* (decisión del usuario).
 * Ronda 35: cada uno dice dónde se marca en el resumen (`donde`: «quien», «partida» con su `uid`, «material» o «fotos»)
 * y trae el texto corto para ahí (`corto`), sin repetir la partida: ya no hay una lista aparte arriba.
 * @returns { pendientes: [{ tipo, mensaje, corto, donde, paso, campo, uid, pendiente, … }], bloquea }
 */
export function pendientesParaEmitir(estado, datos, { usuario = null, espacios = 0 } = {}) {
  const listo = paraEmitir(estado, datos, usuario);
  const lineas = listo.lineas;
  const { errores, avisos } = validarVale(estado, listo);
  const nombre = (l) => [l?.descripcion, l?.clave].filter(Boolean).join(" ") || `código ${l?.codigo ?? "—"}`;
  const pendientes = [];
  for (const e of errores) {
    if (e.campo === "justificacion") continue; // va con su aviso de existencia
    const l = e.renglon ? lineas[e.renglon - 1] : null;
    if (e.campo === "cantidad") {
      pendientes.push({
        tipo: "cantidad",
        mensaje: `Partida ${e.renglon} · ${nombre(l)}: falta la cantidad.`,
        corto: texto(l?.cantidad) ? "La cantidad debe ser mayor que 0." : "Falta la cantidad.",
        donde: "partida",
        paso: 2,
        campo: "cantidad",
        uid: l?.uid ?? null,
        pendiente: true,
      });
    } else if (e.renglon) {
      pendientes.push({ tipo: "corregir", mensaje: e.mensaje, corto: sinPartida(e.mensaje), donde: "partida", paso: 2, campo: e.campo, uid: l?.uid ?? null, pendiente: true });
    } else {
      pendientes.push({
        tipo: e.campo === "entrego_nombre" ? "aviso" : "corregir",
        mensaje: e.mensaje,
        corto: e.mensaje,
        donde: e.campo === "lineas" ? "material" : "quien",
        paso: PASO_DEL_CAMPO[e.campo] ?? null,
        campo: e.campo,
        uid: null,
        pendiente: true,
      });
    }
  }
  for (const a of avisos) {
    const l = lineas[a.renglon - 1];
    pendientes.push({
      tipo: "justificacion",
      mensaje: `${nombre(l)}: sacas ${decTexto(a.pedido)} y el inventario dice que hay ${decTexto(a.disponible)}. ¿Por qué?`,
      corto: `Sacas ${decTexto(a.pedido)} y el inventario dice que hay ${decTexto(a.disponible)}. ¿Por qué?`,
      donde: "partida",
      paso: 3,
      campo: "justificacion",
      uid: l?.uid ?? null,
      pendiente: !String(l?.justificacion ?? "").trim(),
    });
  }
  const puestas = (datos.fotos ?? []).slice(0, espacios).filter(Boolean).length;
  if (espacios > puestas) {
    const faltan = espacios - puestas;
    const mensaje = `${faltan === 1 ? "Falta 1 foto" : `Faltan ${faltan} fotos`} del formato (${puestas} de ${espacios}).`;
    pendientes.push({ tipo: "fotos", mensaje, corto: mensaje, donde: "fotos", paso: 3, campo: "fotos", uid: null, pendiente: true });
  }
  return { pendientes, bloquea: pendientes.filter((p) => p.pendiente).length };
}
