// Ronda 35 (pedido del usuario): solo hay tres plantillas del vale — Consumo interno, NOV y Transferencia —. Un área es un
// nombre con su plantilla; los destinos de una transferencia son los nombres de la plantilla Transferencia. El formato
// impreso (la hoja del libro de vales) y las observaciones son de la plantilla: se cambian una vez y quedan iguales en
// todas sus áreas. No cambia el formato del estado: cada área sigue guardando su hoja y sus observaciones (así se
// imprimen sus vales); la plantilla es la vista de esas áreas y guardarla las iguala. Sin navegador.

import { ORIGEN_EQUIPO, tipoDeArea } from "../nucleo/areas.js";
import { auditar } from "../nucleo/estado.js";
import { ErrorCatalogo, guardarArea, usosDeArea } from "./catalogos.js";
import { DESTINOS_TRANSFERENCIA, igualLugar, listaDestinos } from "./pasosVale.js";
import { areaDeVale } from "./vales.js";

export const PLANTILLAS_VALE = Object.freeze([
  Object.freeze({ tipo: "INTERNO", nombre: "Consumo interno", detalle: "Departamentos del equipo: mecánico, soldador…" }),
  Object.freeze({ tipo: "EXTERNO", nombre: "NOV", detalle: "Otra compañía dentro del equipo, con sus firmas" }),
  Object.freeze({ tipo: "TRANSFERENCIA", nombre: "Transferencia", detalle: "A otro RIG, pozo o base" }),
]);

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mayus = (v) => texto(v).replace(/\s+/g, " ").toUpperCase();

/** «Consumo interno», «NOV» o «Transferencia». */
export const nombrePlantilla = (tipo) => PLANTILLAS_VALE.find((p) => p.tipo === tipo)?.nombre ?? tipo;

/** Las áreas vigentes de una plantilla, en su orden. */
export function areasDePlantilla(estado, tipo) {
  return estado.plantillas_area.filter((a) => a.activo !== false && tipoDeArea(a) === tipo).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

/**
 * La plantilla de un tipo vista desde sus áreas: el formato y las observaciones de la primera (la de referencia) y las
 * áreas que las tienen distintas (al guardar la plantilla quedan iguales).
 * @returns { tipo, nombre, detalle, referencia, hoja_excel, observaciones, areas, distintas }
 */
export function plantillaVale(estado, tipo) {
  const base = PLANTILLAS_VALE.find((p) => p.tipo === tipo);
  if (!base) throw new ErrorCatalogo(`No hay plantilla ${tipo}.`);
  const areas = areasDePlantilla(estado, tipo);
  const referencia = areas[0] ?? null;
  const hoja = referencia?.hoja_excel ?? null;
  const observaciones = referencia?.observaciones ?? "";
  const distintas = areas.slice(1).filter((a) => (a.hoja_excel ?? null) !== hoja || texto(a.observaciones) !== texto(observaciones)).map((a) => a.nombre);
  return { ...base, referencia, hoja_excel: hoja, observaciones, areas, distintas };
}

/**
 * Cambia el formato impreso (hoja del libro de vales) o las observaciones de una plantilla: quedan iguales en todas sus
 * áreas vigentes (cada cambio en la auditoría). Sin áreas de Transferencia, crea la de TRANSFERENCIAS.
 * @returns cuántas áreas cambiaron
 */
export function guardarPlantillaVale(estado, tipo, { hoja_excel = null, observaciones = "" } = {}, usuario = null) {
  const areas = areasDePlantilla(estado, tipo);
  const hoja = hoja_excel || null;
  const obs = texto(observaciones) || null;
  if (!areas.length) {
    if (tipo !== "TRANSFERENCIA") throw new ErrorCatalogo(`Agrega primero un área con la plantilla ${nombrePlantilla(tipo)}.`);
    guardarArea(estado, { nombre: "TRANSFERENCIAS", tipo, hoja_excel: hoja, observaciones: obs, origen: ORIGEN_EQUIPO, depto_origen: "ALMACEN", requiere_autoriza: true }, usuario);
    return 1;
  }
  let cambiaron = 0;
  for (const area of areas) {
    const antes = { hoja_excel: area.hoja_excel ?? null, observaciones: area.observaciones ?? null };
    if (antes.hoja_excel === hoja && texto(antes.observaciones) === texto(obs)) continue;
    area.hoja_excel = hoja;
    area.observaciones = obs;
    auditar(estado, { usuario, entidad: "plantilla_area", entidadId: area.id, accion: "PLANTILLA_VALE", antes, despues: { hoja_excel: hoja, observaciones: obs } });
    cambiaron += 1;
  }
  return cambiaron;
}

/**
 * Un área nueva con su plantilla (Consumo interno o NOV): de la plantilla toma el formato, las observaciones y, en NOV,
 * los títulos de sus firmas extra, quién firma de cada lado y si pide autoriza — nunca sus personas —. El departamento
 * que se imprime es el nombre, salvo que se escriba otro.
 * @returns el área guardada
 */
export function nuevaArea(estado, { nombre, tipo, depto_destino = "" }, usuario = null) {
  if (tipo === "TRANSFERENCIA") throw new ErrorCatalogo("Los nombres de Transferencia son destinos: agrégalo como destino.");
  const plantilla = plantillaVale(estado, tipo);
  const ref = plantilla.referencia;
  const limpio = mayus(nombre);
  const extra = ref?.firmas_extra
    ? Object.fromEntries(["izq", "der"].map((lado) => [lado, { titulo: ref.firmas_extra[lado]?.titulo ?? null, nombre: null, puesto: null }]))
    : null;
  const area = guardarArea(
    estado,
    {
      nombre: limpio,
      tipo,
      hoja_excel: plantilla.hoja_excel,
      observaciones: plantilla.observaciones,
      origen: ORIGEN_EQUIPO,
      depto_origen: "ALMACEN",
      destino: ORIGEN_EQUIPO,
      depto_destino: mayus(depto_destino) || limpio,
      firmas_extra: extra,
      requiere_autoriza: Boolean(ref?.requiere_autoriza),
      activo: true,
    },
    usuario,
  );
  if (ref?.almacenista_derecha) area.almacenista_derecha = true;
  return area;
}

/** Los vales y borradores que usan el área: por su plantilla o, los migrados del DIARIO, por su departamento. */
export function usosDelArea(estado, area) {
  const usos = usosDeArea(estado, area.id);
  const migrados = estado.vales.filter((v) => (v.plantilla_area_id === null || v.plantilla_area_id === undefined) && areaDeVale(estado, v)?.id === area.id).length;
  return { vales: usos.vales + migrados, borradores: usos.borradores };
}

/**
 * Cambia la plantilla de un área: solo si ningún vale ni borrador la usa (sus vales se imprimen con el formato del área;
 * para otro tipo con vales, se agrega un área nueva). Toma el formato y las observaciones de la nueva plantilla.
 */
export function cambiarPlantillaDeArea(estado, areaId, tipo, usuario = null) {
  const area = estado.plantillas_area.find((a) => a.id === areaId);
  if (!area) throw new ErrorCatalogo("El área ya no existe.");
  if (tipoDeArea(area) === tipo) return area;
  if (tipo === "TRANSFERENCIA") throw new ErrorCatalogo("Los nombres de Transferencia son destinos: agrégalo como destino.");
  const usos = usosDelArea(estado, area);
  if (usos.vales || usos.borradores) throw new ErrorCatalogo(`${area.nombre} ya tiene vales: para usar otra plantilla, agrega un área nueva.`);
  const plantilla = plantillaVale(estado, tipo);
  return guardarArea(estado, { ...area, tipo, hoja_excel: plantilla.hoja_excel, observaciones: plantilla.observaciones, firmas_extra: tipo === "EXTERNO" ? area.firmas_extra : null }, usuario);
}

// ---------------------------------------------------------------- destinos de transferencia

/**
 * Agrega un destino a la lista de «¿A dónde se envía?» (la plantilla Transferencia). La lista es la misma en DLTA y GSM
 * (`config.destinos_transferencia`, compartida); sin lista guardada, son los de fábrica.
 * @returns la lista nueva
 */
export function agregarDestino(estado, nombre, usuario = null) {
  const limpio = mayus(nombre);
  if (!limpio) throw new ErrorCatalogo("Escribe el nombre del destino.");
  const antes = [...listaDestinos(estado)];
  if (antes.some((d) => igualLugar(d, limpio))) throw new ErrorCatalogo(`${limpio} ya está en los destinos.`);
  return fijarDestinos(estado, [...antes, limpio], usuario);
}

/** Quita un destino de la lista (los vales que ya lo usan no cambian). @returns la lista nueva */
export function quitarDestino(estado, nombre, usuario = null) {
  return fijarDestinos(estado, listaDestinos(estado).filter((d) => !igualLugar(d, nombre)), usuario);
}

/** Deja la lista de destinos como `lista` (también para Deshacer). @returns la lista */
export function fijarDestinos(estado, lista, usuario = null) {
  const antes = [...listaDestinos(estado)];
  const nueva = [...new Set(lista.map(mayus).filter(Boolean))];
  estado.config.destinos_transferencia = nueva;
  auditar(estado, { usuario, entidad: "config", entidadId: "destinos_transferencia", accion: "EDITAR", antes, despues: [...nueva] });
  return nueva;
}

/** ¿La lista es la de fábrica? (para decir que se puede ampliar). */
export const destinosDeFabrica = (estado) =>
  listaDestinos(estado).length === DESTINOS_TRANSFERENCIA.length && listaDestinos(estado).every((d, i) => igualLugar(d, DESTINOS_TRANSFERENCIA[i]));
