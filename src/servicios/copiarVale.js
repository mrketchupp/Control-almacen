// Vale de salida a partir de otro vale (Ronda 33, pedido del usuario): el material que se recibió
// y se entregó el mismo día ya está capturado en su entrada; sus partidas pasan a un borrador de
// salida que sale de la misma partida del inventario a la que entró. También sirve para repetir un
// vale de salida (misma área y personas). Es solo un borrador: no gasta folio ni mueve existencias
// hasta que se emite, y el vale original no se toca.

import { decTexto, dec } from "../nucleo/decimal.js";
import { Indices } from "../nucleo/estado.js";
import { clavesPropias } from "../nucleo/catalogo.js";
import { fechaDelDia, hoyIso } from "../nucleo/fechas.js";
import { claveEstricta } from "../nucleo/normalizar.js";
import { cantidadEnInventario, fraccionMovimiento, unidadesCompatibles } from "../nucleo/unidades.js";
import { folioEntrada } from "./entradas.js";
import {
  ErrorVale,
  aplicarPlantilla,
  areaDeVale,
  conArticulo,
  conExistencia,
  conFirmasPorPapel,
  firmasExtraDe,
  lineaNoInventariada,
  lineaVacia,
  nuevoBorrador,
  observacionesDelVale,
  opcionesDeClave,
  requiereAutoriza,
} from "./vales.js";
import { tieneDatosFijos } from "../nucleo/areas.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const hay = (v) => v !== null && v !== undefined;
const copiable = (v) => (v.tipo === "SALIDA" || v.tipo === "ENTRADA") && v.estado === "EMITIDO";
const conCodigo = (vale) => vale.lineas.filter((l) => Number.isInteger(l.codigo));

/** Cómo se nombra el vale en los avisos: «la entrada E-0012» o «el vale 1234». */
export function nombreDeVale(vale) {
  return vale.tipo === "ENTRADA" ? `la entrada ${folioEntrada(vale.folio)}` : `el vale ${vale.folio}`;
}

/** «de la entrada E-0012» / «del vale 1234». */
export const deVale = (vale) => (vale.tipo === "ENTRADA" ? `de ${nombreDeVale(vale)}` : `del vale ${vale.folio}`);

/** Folio con que se muestra: E-0012 (entrada) o 1234 (salida). */
export const folioDeVale = (vale) => (vale.tipo === "ENTRADA" ? folioEntrada(vale.folio) : String(vale.folio));

// ---------------------------------------------------------------- buscar el vale

/**
 * Vales que se pueden copiar a una salida, por lo escrito: «E-12» / «E12» = entrada; un número = el
 * vale de salida con ese folio, la entrada con ese folio de la base y la E-0012; otro texto = folio de
 * la base de una entrada. Sin consulta: lo recibido hoy primero (el caso de uso: entró y salió el mismo
 * día) y luego las entradas y salidas más recientes.
 * @returns [{ vale, por: 'hoy' | 'salida' | 'interno' | 'base' | null, exacto }]
 */
export function buscarValesParaCopiar(estado, consulta, { hoy = hoyIso(), limite = 12 } = {}) {
  const vales = estado.vales.filter(copiable);
  const q = texto(consulta);
  const recientes = (tipo) => vales.filter((v) => v.tipo === tipo).sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  if (!q) {
    const entradas = recientes("ENTRADA");
    const deHoy = entradas.filter((v) => fechaDelDia(v) === hoy);
    const otras = [...entradas.filter((v) => fechaDelDia(v) !== hoy).slice(0, 4), ...recientes("SALIDA").slice(0, 4)];
    return [...deHoy.map((vale) => ({ vale, por: "hoy", exacto: false })), ...otras.map((vale) => ({ vale, por: null, exacto: false }))].slice(0, Math.max(limite, deHoy.length));
  }
  const interno = /^E\s*-?\s*0*(\d+)$/i.exec(q);
  const numero = /^\d+$/.test(q) ? Number(q) : null;
  const clave = claveEstricta(q);
  const hallados = [];
  if (numero !== null) for (const vale of recientes("SALIDA")) if (vale.folio === numero) hallados.push({ vale, por: "salida", exacto: true });
  for (const vale of recientes("ENTRADA")) {
    const base = claveEstricta(vale.folio_externo);
    if (interno && vale.folio === Number(interno[1])) hallados.push({ vale, por: "interno", exacto: true });
    else if (!interno && clave && base === clave) hallados.push({ vale, por: "base", exacto: true });
    else if (numero !== null && vale.folio === numero) hallados.push({ vale, por: "interno", exacto: false });
    else if (!interno && clave.length >= 2 && base.includes(clave)) hallados.push({ vale, por: "base", exacto: false });
  }
  return hallados.sort((a, b) => Number(b.exacto) - Number(a.exacto)).slice(0, limite);
}

// ---------------------------------------------------------------- partidas

/**
 * La partida del inventario de la que sale lo que el vale movía: la misma si sigue activa; si no
 * (se juntó, se dio de baja o el vale migrado no la tenía), la del mismo código con la misma variante
 * o la misma clave (también una escritura anterior), la que tenga más existencia.
 */
function partidaParaSalir(estado, l, indices) {
  const existencia = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
  if (existencia && existencia.activo !== false) return existencia.id;
  const opciones = opcionesDeClave(estado, l.codigo, { indices });
  if (!opciones.length) return null;
  const mayor = (lista) => (lista.length ? lista.reduce((a, b) => (b.total > a.total ? b : a)).id : null);
  const varianteDe = (o) => indices.variante(indices.existencia(o.id).variante_id);
  const deVariante = hay(l.variante_id) ? opciones.filter((o) => varianteDe(o).id === l.variante_id) : [];
  if (deVariante.length) return mayor(deVariante);
  const clave = claveEstricta(l.clave);
  if (!clave) return opciones.length === 1 ? opciones[0].id : null;
  const mismaClave = opciones.filter((o) => claveEstricta(o.clave) === clave);
  if (mismaClave.length) return mayor(mismaClave);
  return mayor(opciones.filter((o) => clavesPropias(varianteDe(o)).has(clave)));
}

/**
 * Una partida del vale como partida de salida, con su cantidad. Lo que entró a una partida del
 * inventario sale de ella; lo que entró sin existencia (diésel, gases) sale igual. En las salidas se
 * conserva el LOTE; en las entradas el LOTE era quien solicita, así que se usa el NP de la partida.
 * @returns { linea, aviso }
 */
function partidaDeSalida(estado, l, { indices, desdeSalida }) {
  const base = { ...lineaVacia(desdeSalida ? texto(l.lote) : ""), oc: texto(l.oc) };
  const id = l.no_inventariado && !hay(l.existencia_id) ? null : partidaParaSalir(estado, l, indices);
  let linea;
  let aviso = null;
  if (id !== null) {
    linea = conExistencia(estado, base, id, indices);
    // Se conserva el LOTE de la salida (FX, el del área…); si era el NP, sigue cambiando con la clave.
    if (desdeSalida && texto(l.lote)) linea = { ...linea, lote: texto(l.lote), lote_np: texto(l.lote) === linea.lote_np ? linea.lote_np : null };
  } else if (l.no_inventariado || !opcionesDeClave(estado, l.codigo, { indices }).length) {
    linea = { ...lineaNoInventariada(estado, l.codigo, texto(l.descripcion)), lote: base.lote, oc: base.oc, clave: texto(l.clave) || "S/D", um: texto(l.um) };
    if (!l.no_inventariado) aviso = `${l.codigo}: ya no está en el inventario; va como partida sin existencia.`;
  } else {
    linea = { ...conArticulo(estado, base, l.codigo, { indices, descripcion: texto(l.descripcion) }), oc: base.oc };
    if (!hay(linea.existencia_id)) aviso = `${l.codigo}: elige la clave (la partida ${texto(l.clave) || "del vale"} ya no está en el inventario).`;
  }
  // La cantidad, en la unidad que hoy tiene la partida (si se convirtió al conciliar con AX).
  let cantidad = dec(l.cantidad);
  if (cantidad !== null && hay(linea.existencia_id)) {
    const existencia = indices.existencia(linea.existencia_id);
    const fraccion = fraccionMovimiento(existencia, l);
    if (!fraccion.numerador.eq(fraccion.denominador)) cantidad = cantidadEnInventario(existencia, l);
    else if (!unidadesCompatibles(l.um, linea.um)) aviso ??= `${l.codigo}: el vale lo traía en ${texto(l.um)} y la partida está en ${linea.um}; revisa la cantidad.`;
  }
  return { linea: { ...linea, cantidad: decTexto(cantidad) ?? "" }, aviso };
}

/** Las partidas del vale como partidas de un vale de salida, y lo que hay que revisar. */
export function partidasParaSalida(estado, vale, { indices = new Indices(estado) } = {}) {
  const desdeSalida = vale.tipo === "SALIDA";
  const avisos = [];
  const lineas = conCodigo(vale).map((l) => {
    const r = partidaDeSalida(estado, l, { indices, desdeSalida });
    if (r.aviso) avisos.push(r.aviso);
    return r.linea;
  });
  return { lineas, avisos };
}

// ---------------------------------------------------------------- encabezado

/**
 * Lo de un vale de salida que se repite: el área (con sus datos fijos) y quién recibe; quién autoriza
 * y las firmas de la segunda fila, solo si el área las lleva (si no, saldrían impresas sin verse).
 */
function conEncabezadoDe(estado, b, vale) {
  const fuente = conFirmasPorPapel(estado, vale);
  const area = areaDeVale(estado, vale);
  if (area && area.activo !== false) aplicarPlantilla(estado, b, area.id);
  else Object.assign(b, { naturaleza: vale.naturaleza || "CONSUMO" });
  if (!tieneDatosFijos(area && area.activo !== false ? area : null)) {
    for (const campo of ["origen", "depto_origen", "destino", "depto_destino"]) if (texto(fuente[campo])) b[campo] = fuente[campo];
    if (texto(fuente.observaciones)) b.observaciones = fuente.observaciones;
  }
  const copiar = (campos) => {
    for (const campo of campos) if (texto(fuente[campo])) b[campo] = fuente[campo];
  };
  copiar(["recibio_nombre", "recibio_puesto"]);
  if (requiereAutoriza(estado, b)) copiar(["autorizo_nombre", "autorizo_puesto"]);
  if (firmasExtraDe(estado, b)) copiar(["firma_extra_izq_nombre", "firma_extra_izq_puesto", "firma_extra_der_nombre", "firma_extra_der_puesto"]);
  b.observaciones = observacionesDelVale(estado, b) ?? "";
}

// ---------------------------------------------------------------- borrador

/**
 * Borrador de salida nuevo con las partidas de un vale (entrada o salida). La fecha es la de hoy;
 * entrega quien está en turno. De una salida también se repiten el área y las personas; de una
 * entrada, no (venía de la base): se elige el área como en cualquier vale.
 * @returns { borrador, avisos, partidas }
 */
export function borradorDesdeVale(estado, valeId, { usuario = null, fecha = hoyIso() } = {}) {
  const vale = estado.vales.find((v) => v.id === valeId);
  if (!vale || !copiable(vale)) throw new ErrorVale("No se encontró ese vale (solo se copian entradas y salidas emitidas).");
  if (!conCodigo(vale).length) throw new ErrorVale(`${nombreDeVale(vale)[0].toUpperCase()}${nombreDeVale(vale).slice(1)} no tiene partidas con código.`);
  const indices = new Indices(estado);
  const { lineas, avisos } = partidasParaSalida(estado, vale, { indices });
  const b = nuevoBorrador(estado, { usuario, fecha });
  b.lineas = lineas;
  b.copia_de = { tipo: vale.tipo, vale_id: vale.id, folio: folioDeVale(vale) };
  if (vale.tipo === "SALIDA") conEncabezadoDe(estado, b, vale);
  return { borrador: b, avisos, partidas: lineas.length };
}
