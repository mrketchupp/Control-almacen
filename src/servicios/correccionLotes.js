// Correcciones parciales del encabezado: las partidas nunca se reconstruyen ni se editan.
// La interfaz ejecuta el lote completo dentro de Almacen.modificar().

import { auditar, siguienteId } from "../nucleo/estado.js";
import { ahoraIso, fmtFecha, isoDesdePartes } from "../nucleo/fechas.js";
import { nombrePersona } from "../nucleo/normalizar.js";
import { folioEntrada } from "./entradas.js";
import { ErrorVale, conFirmasPorPapel, firmasPorPosicion, requiereAutoriza } from "./vales.js";

const AMBOS = ["SALIDA", "ENTRADA"];
const SALIDAS = ["SALIDA"];
export const CAMPOS_CORRECCION_GENERAL = [
  { clave: "fecha", etiqueta: "Fecha", tipoInput: "date", obligatorio: true, tipos: AMBOS },
  { clave: "origen", etiqueta: "Origen", tipoInput: "text", tipos: AMBOS },
  { clave: "depto_origen", etiqueta: "Departamento de origen", tipoInput: "text", tipos: AMBOS },
  { clave: "destino", etiqueta: "Destino", tipoInput: "text", tipos: AMBOS },
  { clave: "depto_destino", etiqueta: "Departamento de destino", tipoInput: "text", tipos: AMBOS },
  { clave: "entrego_nombre", etiqueta: "Nombre de quien entrega", tipoInput: "text", obligatorio: true, tipos: AMBOS },
  { clave: "entrego_puesto", etiqueta: "Puesto de quien entrega", tipoInput: "text", tipos: AMBOS },
  { clave: "recibio_nombre", etiqueta: "Nombre de quien recibe", tipoInput: "text", obligatorio: true, tipos: AMBOS },
  { clave: "recibio_puesto", etiqueta: "Puesto de quien recibe", tipoInput: "text", tipos: AMBOS },
  { clave: "autorizo_nombre", etiqueta: "Nombre de quien autoriza", tipoInput: "text", tipos: SALIDAS },
  { clave: "autorizo_puesto", etiqueta: "Puesto de quien autoriza", tipoInput: "text", tipos: SALIDAS },
  { clave: "firma_extra_izq_nombre", etiqueta: "Nombre de la firma adicional izquierda", tipoInput: "text", tipos: SALIDAS },
  { clave: "firma_extra_izq_puesto", etiqueta: "Puesto de la firma adicional izquierda", tipoInput: "text", tipos: SALIDAS },
  { clave: "firma_extra_der_nombre", etiqueta: "Nombre de la firma adicional derecha", tipoInput: "text", tipos: SALIDAS },
  { clave: "firma_extra_der_puesto", etiqueta: "Puesto de la firma adicional derecha", tipoInput: "text", tipos: SALIDAS },
  { clave: "observaciones", etiqueta: "Observaciones", tipoInput: "textarea", tipos: AMBOS },
];

const CAMPOS = new Map(CAMPOS_CORRECCION_GENERAL.map((campo) => [campo.clave, campo]));
const CAMPOS_DIARIO = new Map([
  ["fecha", "fecha"], ["origen", "origen"], ["depto_origen", "depto_origen"],
  ["destino", "destino"], ["depto_destino", "depto_destino"],
  ["entrego_nombre", "entrego"], ["recibio_nombre", "recibio"], ["autorizo_nombre", "autorizo"],
]);
const texto = (valor) => valor == null ? "" : String(valor).trim();
const folioDe = (vale) => vale.tipo === "ENTRADA" ? folioEntrada(vale.folio) : String(vale.folio);
const error = (mensaje, campo = "vale", vale = null) => {
  throw new ErrorVale(mensaje, [{ campo, renglon: null, mensaje, ...(vale ? { folio: folioDe(vale) } : {}) }]);
};

/** Folios internos: las entradas aceptan E-0001 o 1, nunca el folio externo de la base. */
export function resolverLoteCorreccion(estado, lista, tipo = "SALIDA") {
  if (!AMBOS.includes(tipo)) error("Elige vales de entrada o de salida.", "tipo");
  const porFolio = new Map(estado.vales.filter((vale) => vale.tipo === tipo).map((vale) => [vale.folio, vale]));
  const vales = [], faltantes = [];
  const invalidos = new Set(), repetidos = new Set(), vistos = new Set();
  for (const escrito of texto(lista).split(/[\s,;]+/u).filter(Boolean)) {
    const digitos = tipo === "ENTRADA" ? escrito.replace(/^E-/i, "") : escrito;
    const folio = Number(digitos);
    if (!/^\d+$/.test(digitos) || !Number.isSafeInteger(folio) || folio <= 0) {
      invalidos.add(escrito);
      continue;
    }
    if (vistos.has(folio)) {
      repetidos.add(folio);
      continue;
    }
    vistos.add(folio);
    const vale = porFolio.get(folio);
    if (vale) vales.push(vale);
    else faltantes.push(folio);
  }
  return {
    vales, faltantes, invalidos: [...invalidos], repetidos: [...repetidos],
    cancelados: vales.filter((vale) => vale.estado === "CANCELADO").map((vale) => vale.folio),
  };
}

function limpiar(clave, valor) {
  const escrito = texto(valor);
  if (clave === "fecha") return escrito;
  if (clave.endsWith("_nombre")) return nombrePersona(escrito);
  if (clave === "observaciones") return escrito || null;
  return escrito.toUpperCase() || null;
}

function prepararCambios(cambios) {
  if (!cambios || typeof cambios !== "object" || Array.isArray(cambios) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(cambios))) {
    error("Los cambios deben contener únicamente datos generales del vale.");
  }
  const claves = Reflect.ownKeys(cambios);
  if (!claves.length) error("Selecciona al menos un dato general para corregir.");
  const limpio = {};
  for (const clave of claves) {
    if (!CAMPOS.has(clave)) error(`No se permite corregir ${String(clave)} por lotes.`, String(clave));
    const valor = cambios[clave];
    if (valor !== null && typeof valor !== "string") error(`Escribe un texto válido en ${CAMPOS.get(clave).etiqueta}.`, clave);
    limpio[clave] = limpiar(clave, valor);
    if (CAMPOS.get(clave).obligatorio && !limpio[clave]) error(`Falta ${CAMPOS.get(clave).etiqueta.toLowerCase()}.`, clave);
    if (clave === "fecha") {
      const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio.fecha);
      if (!partes || isoDesdePartes(...partes.slice(1).map(Number)) !== limpio.fecha) {
        error("Escribe una fecha válida (AAAA-MM-DD).", clave);
      }
    }
  }
  return limpio;
}

function claveGuardada(clave, porPosicion) {
  if (!porPosicion) return clave;
  if (clave.startsWith("entrego_")) return clave.replace(/^entrego_/, "recibio_");
  if (clave.startsWith("recibio_")) return clave.replace(/^recibio_/, "entrego_");
  return clave;
}

function prepararLote(estado, elegidos, cambios) {
  const limpio = prepararCambios(cambios);
  if (!Array.isArray(elegidos) || !elegidos.length) error("Indica al menos un vale para corregir.");
  const porId = new Map(estado.vales.map((vale) => [vale.id, vale]));
  const vistos = new Set();
  const planes = [];
  for (const elegido of elegidos) {
    const id = typeof elegido === "object" && elegido !== null ? elegido.id : elegido;
    if (!Number.isSafeInteger(id) || id <= 0 || !porId.has(id)) error(`No existe el vale ${texto(id) || "indicado"}.`);
    if (vistos.has(id)) continue;
    vistos.add(id);
    const vale = porId.get(id);
    if (!AMBOS.includes(vale.tipo) || vale.estado !== "EMITIDO") {
      error(`El vale ${folioDe(vale)} no está emitido; no se puede corregir por lotes.`, "vale", vale);
    }
    const porPosicion = firmasPorPosicion(estado, vale);
    const porPapel = conFirmasPorPapel(estado, vale);
    const nuevo = { ...porPapel, ...limpio };
    if (("destino" in limpio || "depto_destino" in limpio) && !texto(nuevo.destino) && !texto(nuevo.depto_destino)) {
      error(`El vale ${folioDe(vale)} debe conservar un destino o departamento de destino.`, "destino", vale);
    }
    if ("autorizo_nombre" in limpio && requiereAutoriza(estado, vale) && !nuevo.autorizo_nombre) {
      error(`El vale ${folioDe(vale)} requiere el nombre de quien autoriza.`, "autorizo_nombre", vale);
    }
    const detalle = [], encabezado = {}, columnas = [];
    for (const [clave, despues] of Object.entries(limpio)) {
      const campo = CAMPOS.get(clave);
      if (!campo.tipos.includes(vale.tipo)) error(`${campo.etiqueta} sólo se corrige en vales de salida.`, clave, vale);
      const guardada = claveGuardada(clave, porPosicion);
      const columna = CAMPOS_DIARIO.get(claveGuardada(clave, porPosicion || Boolean(vale.almacenista_derecha && !vale.migrado)));
      const antes = limpiar(clave, porPapel[clave]);
      // Una partida migrada puede conservar un encabezado distinto: unificar sólo este campo
      // cambia su exportación, sin tocar los bytes ni la identidad de la partida.
      const originalDistinto = columna && !(vale.campos_encabezado_corregidos ?? []).includes(columna) &&
        (vale.lineas ?? []).some((linea) => Object.hasOwn(linea.encabezado_original ?? {}, columna) &&
          limpiar(clave, linea.encabezado_original[columna]) !== despues);
      const vacioExplicito = antes === null && despues === null &&
        (clave.endsWith("_puesto") || clave === "observaciones") &&
        !(vale.campos_encabezado_corregidos ?? []).includes(guardada);
      if (antes === despues && !originalDistinto && !vacioExplicito) continue;
      const mostrado = (valor) => clave === "fecha" ? fmtFecha(valor) : valor || "—";
      const descripcion = vacioExplicito
        ? `${campo.etiqueta}: dejar vacío`
        : antes === despues
          ? `${campo.etiqueta}: se unificó el encabezado en ${mostrado(despues)}`
          : `${campo.etiqueta}: ${mostrado(antes)} → ${mostrado(despues)}`;
      detalle.push({ clave, etiqueta: campo.etiqueta, antes, despues, descripcion });
      encabezado[guardada] = despues;
      // Los campos sin columna en el DIARIO también recuerdan una corrección explícita:
      // al imprimir, un vacío debe quedar vacío y no heredar el texto de la plantilla.
      columnas.push(columna ?? guardada);
    }
    planes.push({ vale, porPosicion, encabezado, columnas, cambios: detalle });
  }
  return planes;
}

/** Previsualiza y valida todo el lote sin modificar ningún dato. */
export function revisarCorreccionGeneral(estado, vales, cambios) {
  const planes = prepararLote(estado, vales, cambios);
  return {
    vales: planes.map(({ vale, cambios: detalle }) => ({ vale, id: vale.id, folio: vale.folio, tipo: vale.tipo, cambios: detalle })),
    corregidos: planes.filter((plan) => plan.cambios.length).map((plan) => plan.vale),
    sinCambios: planes.filter((plan) => !plan.cambios.length).map((plan) => plan.vale),
    resumen: planes.flatMap(({ vale, cambios: detalle }) => detalle.map((cambio) => `[${folioDe(vale)}] ${cambio.descripcion}`)),
  };
}

/** Aplica sólo los campos elegidos; todo se valida antes del primer cambio. */
export function corregirDatosGeneralesLote(estado, valeIds, cambios, motivo, usuario = null) {
  if (!texto(motivo)) error("Escribe el motivo de la corrección.", "motivo");
  const planes = prepararLote(estado, valeIds, cambios);
  const corregidos = [], sinCambios = [];
  const ahora = ahoraIso();
  for (const { vale, porPosicion, encabezado, columnas, cambios: detalle } of planes) {
    if (!detalle.length) {
      sinCambios.push(vale);
      continue;
    }
    const antes = structuredClone(vale);
    Object.assign(vale, encabezado, { modificado_en: ahora });
    if (vale.migrado) vale.firmas_por_posicion = porPosicion;
    if (columnas.length) vale.campos_encabezado_corregidos = [...new Set([...(vale.campos_encabezado_corregidos ?? []), ...columnas])];
    if (vale.tipo === "SALIDA") vale.cambio = siguienteId(estado, "cambio");
    const { motivo: motivoEntrada, ...previo } = antes;
    auditar(estado, {
      usuario, entidad: "vale", entidadId: vale.id, accion: "CORREGIR",
      antes: {
        ...previo, ...(vale.tipo === "ENTRADA" ? { motivo_entrada: motivoEntrada } : {}),
        motivo: texto(motivo), cambios: detalle.map((cambio) => cambio.descripcion),
      },
      despues: structuredClone(vale),
    });
    corregidos.push(vale);
  }
  return { corregidos, sinCambios };
}
