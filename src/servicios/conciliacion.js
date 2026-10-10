// Conciliación contra AX (Fase 4, RF-50 a RF-55). Funciona como una conciliación bancaria: AX es el
// estado de cuenta, el inventario físico es la chequera y los vales posteriores al corte son los
// "cheques en tránsito". Ver docs/05-flujos.md §5.
//
// 1. Se importa un corte (reporte de AX filtrado al almacén) y se guarda con su fecha. Solo se
//    concilian los renglones con Modelo de Inventario "INV" (los demás no llevan existencia en AX).
// 2. Cada renglón de AX (código + tamaño + color) se empareja con una variante del inventario. En AX
//    la dimensión es Tamaño + Color (AX no trae NP; corta el Tamaño a 10 caracteres). Exacto tras
//    normalizar o aproximado con puntaje (se sugiere y el usuario confirma). Confirmar una pareja
//    CORRIGE la dimensión del inventario a Tamaño + Color: la siguiente vez ya empareja exacto.
//    "No está en físico" se guarda solo en ese corte.
// 3. Por variante: físico (TOTAL de todos sus renglones) − AX + salidas en tránsito − entradas en
//    tránsito. Si da 0, la diferencia la explican los vales; si no, es sobrante o faltante.
// Las cantidades del inventario no se tocan: solo se compara y se exporta la solicitud de ajuste.

import { CERO, dec, decTexto, sumar } from "../nucleo/decimal.js";
import { ratio } from "../nucleo/difflib.js";
import { Indices, auditar, dimensionMostrada, npMostrado, siguienteId, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos, cuentaParaSaldo } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../nucleo/fechas.js";
import { fechaMinimaPropuesta, valeAdmitido } from "../nucleo/justificantes.js";
import { claveEstricta, claveLaxa, compactar, mayusculas, sinDimension, unidad } from "../nucleo/normalizar.js";
import { folioEntrada } from "./entradas.js";
import { ErrorCorreccion, corregirDimensionNp, lugarCorto, previaCorreccion } from "./inventario.js";
import { estadoAxDeVales, sinAplicar } from "./seguimiento.js";
import { candidatosExactos, indiceExistencias } from "./primeraCarga.js";
import { agregarEtiquetas, etiquetaDeExistencia } from "./etiquetas.js";

export class ErrorConciliacion extends Error {}

const hay = (v) => v !== null && v !== undefined;
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** Llave de un renglón de AX (las equivalencias guardadas antes de la Ronda 9 la usan). */
export const claveAx = (r) => `${r.codigo}|${claveEstricta(r.tamano)}|${claveEstricta(r.color)}`;

// Unidades que AX y el inventario escriben distinto (solo para comparar).
const UM_IGUALES = [
  ["PZA", "PZ", "PZAS", "PIEZA", "PIEZAS"],
  ["M", "MT", "MTS", "METRO", "METROS"],
  ["L", "LT", "LTS", "LITRO", "LITROS"],
  ["KG", "KGS", "KILO", "KILOS"],
  ["CUB", "CUBETA", "CUBETAS"],
  ["JGO", "JUEGO", "JUEGOS"],
  ["GAL", "GALON", "GALONES"],
  ["CJA", "CAJA", "CAJAS"],
  ["ROL", "ROLLO", "ROLLOS"],
];
export function umComparable(um) {
  const u = unidad(um);
  return UM_IGUALES.find((g) => g.includes(u))?.[0] ?? u;
}

export function unidadesCompatibles(a, b) {
  const una = umComparable(a), otra = umComparable(b);
  return !una || !otra || una === otra;
}

// ---------------------------------------------------------------- cortes

/** El corte ya importado con ese archivo (para avisar si se importa dos veces). */
export function corteConHuella(estado, huella) {
  return huella ? ((estado.cortes_ax ?? []).find((c) => c.huella === huella) ?? null) : null;
}

/**
 * Guarda un corte de AX (RF-50): fecha de corte, almacén y sus renglones ya filtrados.
 * folioSalida (opcional): último folio de salida que la base ya capturó en AX (P-03).
 */
export function registrarCorteAx(estado, { fecha, almacen, archivo = null, huella = null, folioSalida = null, renglones }, usuario = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fecha))) throw new ErrorConciliacion("Falta la fecha del corte de AX.");
  if (!renglones?.length) throw new ErrorConciliacion(`El reporte no trae partidas del almacén ${almacen}.`);
  const folio = hay(folioSalida) && texto(folioSalida) !== "" ? Number(folioSalida) : null;
  if (folio !== null && (!Number.isInteger(folio) || folio < 0)) throw new ErrorConciliacion("El folio de corte debe ser un número entero.");
  estado.cortes_ax ??= [];
  const corte = {
    id: siguienteId(estado, "corte_ax"),
    fecha,
    fecha_minima_vales: fechaMinimaPropuesta(fecha),
    almacen,
    archivo,
    huella,
    folio_salida: folio,
    importado_en: ahoraIso(),
    importado_por: usuario,
    lineas: renglones.map((r, i) => ({ id: i + 1, ...r })),
    asignaciones: [],
    vinculos_fisicos: [],
  };
  estado.cortes_ax.push(corte);
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion: "IMPORTAR", despues: { fecha, almacen, archivo, renglones: corte.lineas.length } });
  return corte;
}

export function corteAx(estado, id) {
  return (estado.cortes_ax ?? []).find((c) => c.id === id) ?? null;
}

const esInv = (l) => mayusculas(l.modelo) === "INV";

/** Renglones del corte que se concilian: Modelo de Inventario = INV (si el reporte no trae la columna, todos). */
export function lineasInv(corte) {
  return corte.lineas.some((l) => texto(l.modelo)) ? corte.lineas.filter(esInv) : corte.lineas;
}

/** Códigos que en el corte solo vienen con otro modelo (no INV): su físico tampoco se compara. */
export function codigosNoInv(corte) {
  const inv = new Set(lineasInv(corte).map((l) => l.codigo));
  return new Set(corte.lineas.filter((l) => !inv.has(l.codigo)).map((l) => l.codigo));
}

/** Cambia el folio de corte (hasta qué vale de salida ya está en AX). */
export function fijarFolioCorte(estado, corteId, folioSalida, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  const folio = texto(folioSalida) === "" ? null : Number(folioSalida);
  if (folio !== null && (!Number.isInteger(folio) || folio < 0)) throw new ErrorConciliacion("El folio de corte debe ser un número entero.");
  const antes = corte.folio_salida;
  corte.folio_salida = folio;
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion: "EDITAR", antes: { folio_salida: antes }, despues: { folio_salida: folio } });
}

/** Quita un corte importado por error (las equivalencias confirmadas se conservan). */
export function quitarCorteAx(estado, corteId, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) return;
  estado.cortes_ax = estado.cortes_ax.filter((c) => c.id !== corteId);
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corteId, accion: "QUITAR", antes: { fecha: corte.fecha, archivo: corte.archivo, renglones: corte.lineas.length } });
}

// ---------------------------------------------------------------- físico y tránsito

/** Existencia física por variante: TOTAL de todos sus renglones del inventario. */
export function fisicoPorVariante(estado, { indices = new Indices(estado), saldos = null } = {}) {
  const totales = saldos ?? calcularSaldos(estado);
  const porVariante = new Map();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const v = indices.variante(e.variante_id);
    if (!v) continue;
    let r = porVariante.get(v.id);
    if (!r) {
      r = { variante: v, total: CERO, renglones: [] };
      porVariante.set(v.id, r);
    }
    const total = totales.get(e.id)?.total ?? CERO;
    r.total = r.total.plus(total);
    r.renglones.push({ existencia: e, ubicacion: indices.ubicacion(e.ubicacion_id), total });
  }
  return porVariante;
}

/** ¿El vale es posterior al corte? Salidas por folio (si se indicó) o por fecha; entradas por fecha. */
export function enTransito(corte, vale) {
  if (vale.estado !== "EMITIDO" || !valeAdmitido(corte, vale)) return false;
  if (vale.tipo === "SALIDA") return hay(corte.folio_salida) ? vale.folio > corte.folio_salida : vale.fecha > corte.fecha;
  if (vale.tipo === "ENTRADA") return vale.fecha > corte.fecha;
  return false;
}

/**
 * Folio con el que la base reconoce el vale: el de salida, o en las entradas el folio del vale de la base
 * (con el que la base tiene registrado ese material; el interno E-0001 no le dice nada). "(S)" = salida,
 * "(E)" = entrada.
 */
export const folioDeVale = (v, marca = null) =>
  v.tipo === "ENTRADA" ? `${texto(v.folio_externo) || folioEntrada(v.folio)} (E)` : marca ? `${v.folio} (S, ${marca})` : `${v.folio} (S)`;

/**
 * Vales en tránsito (RF-53) por variante y por código: lo que salió o entró y AX aún no refleja, con
 * sus folios. Lo que es posterior al corte (por folio o fecha) siempre está en tránsito: el reporte de
 * AX es una foto de ese día. Con el archivo de la base (Rondas 12 y 13), una salida anterior al corte
 * también lo está si no tiene folio IN / TR (INV sin folio, sin revisar, que la base no tiene o
 * posterior a su archivo; de una aplicación parcial, lo que falta): folio "9 (S, sin IN/TR)". Lo que la
 * base marca NO INV / CONPROV no se descuenta en AX y no justifica diferencias: queda como pista
 * (noSeDescuentan). Una partida duplicada que la base no tiene es un error del vale: no cuenta.
 *
 * Una partida sin renglón del inventario (vales migrados o por ubicar) se busca por código y clave:
 *  - si el vale es anterior al conteo de ese renglón, la cantidad contada ya la refleja, así que
 *    cuenta como tránsito (caso típico del primer corte: AX al 27, conteo el 28 y vales en medio);
 *  - si es posterior (está en Pendientes, por ubicar), aún no mueve la existencia: no cuenta y se
 *    muestra como pista.
 * Las partidas que el usuario asignó a un faltante (Ronda 14, corte.asignaciones) cuentan para ese
 * faltante, dentro del periodo admitido: "466 (S, asignado)".
 *
 * @returns {{ porVariante, porCodigo, porLineaAx, porUbicar, noSeDescuentan, porLinea }}
 *   cada grupo: { salidas, entradas, folios, partidas: [{ vale, linea, cantidad, marca }] };
 *   porLinea: id de partida → { donde: "variante" | "asignada" | "ubicar", variante_id, motivo, cantidad, marca }
 *   (motivo de "ubicar": "sin_variante", "varias" o "posterior_conteo").
 */
export function transitoDesde(estado, corte, { indices = new Indices(estado), ax = estadoAxDeVales(estado) } = {}) {
  const porVariante = new Map();
  const porCodigo = new Map();
  const porLineaAx = new Map();
  const porUbicar = new Map();
  const noSeDescuentan = new Map();
  const porLinea = new Map();
  const asignadas = new Map((corte.asignaciones ?? []).map((a) => [a.partida_id, a]));
  const lineasAx = new Map(corte.lineas.map((l) => [l.id, l]));
  const sumarA = (mapa, clave, vale, linea, cantidad, marca) => {
    let t = mapa.get(clave);
    if (!t) {
      t = { salidas: CERO, entradas: CERO, folios: [], partidas: [] };
      mapa.set(clave, t);
    }
    if (vale.tipo === "SALIDA") t.salidas = t.salidas.plus(cantidad);
    else t.entradas = t.entradas.plus(cantidad);
    const folio = folioDeVale(vale, marca);
    if (!t.folios.includes(folio)) t.folios.push(folio);
    t.partidas.push({ vale, linea, cantidad, marca });
  };
  let indice = null;
  const vales = estado.vales
    .filter((v) => v.estado === "EMITIDO" && valeAdmitido(corte, v))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.folio - b.folio));
  for (const vale of vales) {
    const porFecha = enTransito(corte, vale);
    const conAsignadas = asignadas.size > 0 && vale.lineas.some((l) => asignadas.has(l.id));
    if (!porFecha && !conAsignadas && (vale.tipo !== "SALIDA" || !ax)) continue;
    for (const l of vale.lineas) {
      const asignada = asignadas.get(l.id);
      if (asignada) {
        const cantidad = dec(asignada.cantidad) ?? CERO;
        if (cantidad.eq(0)) continue;
        if (hay(asignada.variante_id)) {
          const varianteId = varianteVigente(indices, asignada.variante_id);
          sumarA(porVariante, varianteId, vale, l, cantidad, "asignado");
          sumarA(porCodigo, indices.variante(varianteId)?.codigo ?? l.codigo, vale, l, cantidad, "asignado");
        } else {
          sumarA(porLineaAx, asignada.linea_ax_id, vale, l, cantidad, "asignado");
          sumarA(porCodigo, lineasAx.get(asignada.linea_ax_id)?.codigo ?? l.codigo, vale, l, cantidad, "asignado");
        }
        porLinea.set(l.id, { donde: "asignada", asignacion: asignada, cantidad, marca: "asignado" });
        continue;
      }
      if (!porFecha && (vale.tipo !== "SALIDA" || !ax)) continue;
      if (l.no_inventariado || !Number.isInteger(l.codigo)) continue;
      const total = dec(l.cantidad);
      if (!total || total.eq(0)) continue;
      const info = vale.tipo === "SALIDA" ? ax?.porLinea.get(l.id) : null;
      if (info?.estado === "no_inv") {
        const folio = folioDeVale(vale);
        if (!noSeDescuentan.has(l.codigo)) noSeDescuentan.set(l.codigo, []);
        if (!noSeDescuentan.get(l.codigo).includes(folio)) noSeDescuentan.get(l.codigo).push(folio);
        continue;
      }
      let cantidad = null;
      let marca = null;
      if (porFecha) cantidad = total;
      else if (sinAplicar(info)) {
        cantidad = info.pendiente;
        marca = info.estado === "parcial" ? `${decTexto(info.pendiente)} sin IN/TR` : "sin IN/TR";
      }
      if (!cantidad || cantidad.eq(0)) continue;
      let existencia = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
      if (!existencia) {
        indice ??= indiceExistencias(estado, indices);
        const candidatos = candidatosExactos(indice, indices, l.codigo, l.clave).filter((e) => e.activo !== false);
        const variantes = new Set(candidatos.map((e) => e.variante_id));
        const yaContado = (e) => !cuentaParaSaldo(e.conteo_id !== null && e.conteo_id !== undefined ? indices.conteos.get(e.conteo_id) : null, vale);
        if (variantes.size === 1 && candidatos.every(yaContado)) existencia = candidatos[0];
        else {
          sumarA(porUbicar, l.codigo, vale, l, cantidad, marca);
          const motivo = !candidatos.length ? "sin_variante" : variantes.size > 1 ? "varias" : "posterior_conteo";
          porLinea.set(l.id, { donde: "ubicar", motivo, cantidad, marca });
          continue;
        }
      }
      sumarA(porVariante, existencia.variante_id, vale, l, cantidad, marca);
      sumarA(porCodigo, l.codigo, vale, l, cantidad, marca);
      porLinea.set(l.id, { donde: "variante", variante_id: existencia.variante_id, cantidad, marca });
    }
  }
  return { porVariante, porCodigo, porLineaAx, porUbicar, noSeDescuentan, porLinea };
}

/** La variante en la que quedó una que se juntó con otra al corregir su dimensión (unida_a). */
export function varianteVigente(indices, varianteId) {
  let id = varianteId;
  for (let i = 0; i < 10; i++) {
    const v = indices.variante(id);
    if (!v || v.activo !== false || !hay(v.unida_a)) break;
    id = v.unida_a;
  }
  return id;
}

/**
 * Junta las parejas confirmadas que comparten alguna variante (una partida de AX puede traer varias en su
 * grupo). @returns [{ pares, varianteIds }] en el orden de las partidas de AX.
 */
function agruparPares(pares) {
  const raiz = new Map();
  const buscar = (x) => {
    while (raiz.get(x) !== x) x = raiz.get(x);
    return x;
  };
  for (const p of pares) {
    const ids = p.grupo ?? [p.variante_id];
    for (const id of ids) if (!raiz.has(id)) raiz.set(id, id);
    for (const id of ids.slice(1)) raiz.set(buscar(id), buscar(ids[0]));
  }
  const grupos = new Map();
  for (const p of pares) {
    const r = buscar(p.variante_id);
    if (!grupos.has(r)) grupos.set(r, { pares: [], varianteIds: [] });
    const g = grupos.get(r);
    g.pares.push(p);
    for (const id of p.grupo ?? [p.variante_id]) if (!g.varianteIds.includes(id)) g.varianteIds.push(id);
  }
  return [...grupos.values()];
}

/** Junta el tránsito de varias llaves (una variante y las partidas de AX que le asignaron vales). */
function juntarTransito(...grupos) {
  const ts = grupos.filter(Boolean);
  if (ts.length <= 1) return ts[0] ?? null;
  return {
    salidas: sumar(...ts.map((t) => t.salidas)),
    entradas: sumar(...ts.map((t) => t.entradas)),
    folios: [...new Set(ts.flatMap((t) => t.folios))],
    partidas: ts.flatMap((t) => t.partidas),
  };
}

// ---------------------------------------------------------------- emparejamiento

function formasAx(r) {
  return {
    t: claveEstricta(r.tamano),
    c: claveEstricta(r.color),
    tc: claveEstricta(`${r.tamano ?? ""} ${r.color ?? ""}`),
    laxa: claveLaxa(`${r.tamano ?? ""}${r.color ?? ""}`),
    crudo: compactar(r.tamano) ?? "",
    um: umComparable(r.um),
  };
}

function formasFisico(v) {
  return {
    d: claveEstricta(v.dimension),
    n: claveEstricta(v.np),
    dn: claveEstricta(`${v.dimension ?? ""} ${v.np ?? ""}`),
    laxa: claveLaxa(`${v.dimension ?? ""}${v.np ?? ""}`),
    crudo: compactar(v.dimension) ?? "",
    um: umComparable(v.um),
  };
}

/**
 * Iguales tras normalizar: la dimensión = Tamaño + Color (también si el inventario anotó el Color
 * en NP), o el Tamaño cortado a 10 caracteres con el que empieza la dimensión (y termina con el Color).
 */
function esExacto(ax, f) {
  const colorOk = !ax.c || ax.c === f.n;
  if (ax.t === f.d && colorOk) return true;
  if (ax.c && (ax.tc === f.d || ax.tc === f.dn)) return true;
  // AX corta el Tamaño a 10 caracteres: la dimensión física debe empezar igual.
  if (ax.crudo.length === 10 && f.crudo.length > 10 && f.crudo.startsWith(ax.crudo) && (colorOk || f.d.endsWith(ax.c))) return true;
  return false;
}

/** Nivel 3: qué tanto se parecen (0 a 1). */
function parecido(ax, f) {
  let p = ax.laxa || f.laxa ? (ax.laxa && f.laxa ? ratio(ax.laxa, f.laxa) : 0) : 1;
  if (ax.t && f.d) p = Math.max(p, ratio(ax.t, f.d));
  if (ax.crudo && f.crudo && (f.crudo.startsWith(ax.crudo) || ax.crudo.startsWith(f.crudo))) p = Math.max(p, 0.8);
  if (ax.c && f.n && ax.c === f.n) p = Math.max(p, 0.75);
  return ax.um && f.um && ax.um !== f.um ? p * 0.9 : p;
}

export const PUNTAJE_SUGERENCIA = 0.5;
export const PUNTAJE_SEGURO = 0.85;

/** Físico que se compara con el corte: sin los códigos que en AX no son INV. */
function fisicoComparable(estado, corte, indices, fisico = null) {
  const todo = fisico ?? fisicoPorVariante(estado, { indices });
  const fuera = codigosNoInv(corte);
  if (!fuera.size) return todo;
  return new Map([...todo].filter(([, r]) => !fuera.has(r.variante.codigo)));
}

/**
 * Empareja cada renglón INV del corte con una variante del inventario.
 * @returns [{ linea, variante_id, grupo, metodo, puntaje, confirmado, candidatos: [{ variante_id, puntaje }], ocupadas }]
 *   grupo: variantes que AX no distingue por NP, o elegidas manualmente para este corte.
 *   También las que junta una partida de AX SIN dimensión (Tamaño y Color vacíos, "S/D"…):
 *   AX no las distingue. Si es la única partida del código en AX es el código completo ("todo_el_codigo");
 *   si no, las variantes sin dimensión del código ("sin_dimension"). variante_id = la de más existencia.
 *   candidatos: solo variantes libres (ninguna que ya sea pareja de otra partida de AX);
 *   ocupadas: cuántas variantes del código ya tienen su pareja (no se ofrecen).
 *   metodo: 'exacto' (confirmado), 'aproximado' | 'unico' | 'recordada' | 'sin_sugerencia' (por
 *   confirmar), 'sin_pareja' (se decidió que no está en físico) o 'sin_fisico' (el código no tiene
 *   ningún renglón en el inventario).
 */
export function emparejar(estado, corte, { indices = new Indices(estado), fisico = null } = {}) {
  const porVariante = fisicoComparable(estado, corte, indices, fisico);
  const porCodigo = new Map();
  for (const r of porVariante.values()) {
    if (!porCodigo.has(r.variante.codigo)) porCodigo.set(r.variante.codigo, []);
    porCodigo.get(r.variante.codigo).push(r);
  }
  const equivalencias = estado.equivalencias_ax ?? {};
  const sinPareja = new Set(corte.sin_pareja ?? []);
  const pares = lineasInv(corte).map((linea) => ({ linea, variante_id: null, metodo: null, puntaje: null, confirmado: false, candidatos: [] }));
  const tomadas = new Set();
  const duenas = new Map();
  const llave = (l) => `${claveAx(l)}|${umComparable(l.um)}`;
  const tomar = (id, linea) => { tomadas.add(id); duenas.set(id, llave(linea)); };
  const ponerGrupo = (p, grupo, metodo) => {
    const principal = [...grupo].sort((a, b) => b.total.cmp(a.total) || a.variante.id - b.variante.id)[0];
    Object.assign(p, {
      variante_id: principal.variante.id,
      grupo: [principal, ...grupo.filter((r) => r !== principal)].map((r) => r.variante.id),
      metodo, puntaje: 1, confirmado: true,
    });
    for (const r of grupo) tomar(r.variante.id, p.linea);
  };
  // Sin dimensión en AX: ni Tamaño ni Color dicen nada ("", "S/D"…). Si el Color trae algo (un NP), se empareja normal.
  const axSinDimension = (linea) => sinDimension(linea.tamano) && claveEstricta(linea.color) === "" && claveEstricta(linea.tamano) === "";
  const partidasDelCodigo = new Map();
  for (const p of pares) partidasDelCodigo.set(p.linea.codigo, (partidasDelCodigo.get(p.linea.codigo) ?? 0) + 1);
  // Las decisiones manuales pertenecen al corte y reservan sus variantes antes de sugerir parejas.
  for (const p of pares) {
    const vinculo = (corte.vinculos_fisicos ?? []).find((v) => v.linea_ax_id === p.linea.id);
    if (!vinculo) continue;
    p.vinculo_manual = true;
    const ids = [...new Set(vinculo.variante_ids.map((id) => varianteVigente(indices, id)))];
    if (!ids.length) { Object.assign(p, { metodo: "sin_pareja", confirmado: true }); continue; }
    const grupo = ids.map((id) => porVariante.get(id));
    if (grupo.some((r) => !r || r.variante.codigo !== p.linea.codigo || !unidadesCompatibles(p.linea.um, r.variante.um) ||
      (tomadas.has(r.variante.id) && duenas.get(r.variante.id) !== llave(p.linea)))) {
      p.metodo = "vinculo_pendiente";
      p.aviso = "Revisa el vínculo del inventario: alguna partida cambió o ya corresponde a otra partida de AX.";
      continue;
    }
    ponerGrupo(p, grupo, "vinculo_manual");
  }
  // Lo que se decidió en este corte: "no está en físico" (y lo que decían las versiones anteriores).
  for (const p of pares) {
    if (!p.metodo && (sinPareja.has(p.linea.id) || equivalencias[claveAx(p.linea)]?.variante_id === null)) Object.assign(p, { metodo: "sin_pareja", confirmado: true });
  }
  // Exacto tras normalizar (las partidas de AX sin dimensión van después: juntan varias variantes).
  // Primero las dimensiones más específicas: una partida sin Color no debe quitarle la pareja a
  // otra que sí distingue ese Color. Los duplicados de la misma llave AX comparten grupo y físico.
  const exactas = pares.filter((x) => !x.metodo && !axSinDimension(x.linea)).sort((a, b) =>
    Number(Boolean(formasAx(b.linea).c)) - Number(Boolean(formasAx(a.linea).c)) ||
    formasAx(b.linea).crudo.length - formasAx(a.linea).crudo.length);
  for (const p of exactas) {
    const ax = formasAx(p.linea);
    const exactos = (porCodigo.get(p.linea.codigo) ?? []).filter((r) => esExacto(ax, formasFisico(r.variante)) &&
      (!tomadas.has(r.variante.id) || duenas.get(r.variante.id) === llave(p.linea)));
    if (!exactos.length) continue;
    const compatibles = exactos.filter((r) => unidadesCompatibles(p.linea.um, r.variante.um));
    // AX no trae NP: todas las coincidencias de dimensión y unidad pertenecen a la misma partida.
    // Si las unidades no coinciden, se conserva la pareja única anterior sin sumar unidades distintas.
    const grupo = compatibles.length ? compatibles : [exactos[0]];
    ponerGrupo(p, grupo, grupo.length > 1 ? "misma_dimension" : "exacto");
  }
  // Sin dimensión en AX: AX no distingue entre las variantes que tampoco tienen dimensión (S/D, SIN
  // DIMENSIÓN, S/N… con distintos NP), así que se comparan todas juntas. Si es la única partida del código
  // en AX, representa al código completo. No se corrige nada del inventario.
  for (const p of pares.filter((x) => !x.metodo && axSinDimension(x.linea))) {
    const libres = (porCodigo.get(p.linea.codigo) ?? []).filter((r) => !tomadas.has(r.variante.id));
    const unica = partidasDelCodigo.get(p.linea.codigo) === 1;
    const grupo = unica ? libres : libres.filter((r) => sinDimension(r.variante.dimension));
    if (!grupo.length) continue;
    const principal = [...grupo].sort((a, b) => b.total.cmp(a.total) || a.variante.id - b.variante.id)[0];
    Object.assign(p, {
      variante_id: principal.variante.id,
      grupo: [principal, ...grupo.filter((r) => r !== principal)].map((r) => r.variante.id),
      metodo: unica ? "todo_el_codigo" : "sin_dimension",
      puntaje: 1,
      confirmado: true,
    });
    for (const r of grupo) tomar(r.variante.id, p.linea);
  }
  // Aproximado (sugerencia que el usuario confirma corrigiendo el inventario). Solo con variantes
  // LIBRES: una que ya es la pareja de otra partida de AX (exacta o confirmada) no se ofrece, porque
  // al corregirla se rompería esa pareja. Cada variante libre se sugiere a una sola partida de AX:
  // a la que más se le parece.
  const pendientes = pares.filter((x) => !x.metodo);
  const sugeridas = new Set();
  const propuestas = [];
  for (const p of pendientes) {
    const delCodigo = porCodigo.get(p.linea.codigo) ?? [];
    if (!delCodigo.length) {
      p.metodo = "sin_fisico";
      p.confirmado = true;
      continue;
    }
    const ax = formasAx(p.linea);
    const libres = delCodigo.filter((r) => !tomadas.has(r.variante.id));
    p.ocupadas = delCodigo.length - libres.length;
    p.candidatos = libres
      .map((r) => ({ variante_id: r.variante.id, puntaje: Math.round(parecido(ax, formasFisico(r.variante)) * 100) / 100 }))
      .sort((a, b) => b.puntaje - a.puntaje);
    // Una pareja confirmada con una versión anterior (sin corregir el inventario) se vuelve a proponer.
    const recordada = equivalencias[claveAx(p.linea)]?.variante_id;
    if (recordada && libres.some((r) => r.variante.id === recordada) && !sugeridas.has(recordada)) {
      Object.assign(p, { variante_id: recordada, metodo: "recordada", puntaje: 1 });
      sugeridas.add(recordada);
      continue;
    }
    const unico = libres.length === 1 && pendientes.filter((q) => q.linea.codigo === p.linea.codigo).length === 1;
    for (const c of p.candidatos) if (unico || c.puntaje >= PUNTAJE_SUGERENCIA) propuestas.push({ p, c, unico });
  }
  propuestas.sort((a, b) => b.c.puntaje - a.c.puntaje);
  for (const { p, c, unico } of propuestas) {
    if (p.metodo || sugeridas.has(c.variante_id)) continue;
    Object.assign(p, { variante_id: c.variante_id, metodo: unico ? "unico" : "aproximado", puntaje: c.puntaje });
    sugeridas.add(c.variante_id);
  }
  for (const p of pendientes) if (!p.metodo) p.metodo = "sin_sugerencia";
  return pares;
}

/** En AX la dimensión es Tamaño + Color (AX no trae NP). */
/** Una variante como se lee: "S/D · NP X00489" (sin dimensión → "SIN DIMENSIÓN"). */
export const textoVariante = (v) => (v ? `${v.dimension || "SIN DIMENSIÓN"}${v.np ? ` · NP ${v.np}` : ""}` : "—");

/**
 * Las partidas del inventario de una fila: una variante, o las que junta una partida de AX sin dimensión
 * ("Todo el código (9 variantes)", "Sin dimensión (3 variantes)").
 */
export function textoFisico(fila) {
  const variantes = fila.variantes ?? (fila.variante ? [fila.variante] : []);
  if (variantes.length <= 1) return textoVariante(fila.variante);
  const titulo = fila.metodos?.includes("todo_el_codigo") ? "Todo el código"
    : fila.metodos?.includes("sin_dimension") ? "Sin dimensión"
    : fila.metodos?.includes("vinculo_manual") ? "Inventario vinculado"
    : dimensionAx(fila.lineas?.[0] ?? fila.linea ?? {}) || "Misma dimensión";
  return `${titulo} (${variantes.length} variantes)`;
}

export const dimensionAx = (linea) => [texto(linea.tamano), texto(linea.color)].filter(Boolean).join(" ");

/**
 * Dimensión y NP que propone AX para una variante: la dimensión = Tamaño + Color; el NP se queda
 * como estaba (AX no lo trae), salvo que fuera el mismo Color anotado como NP. cortado: el Tamaño
 * tiene 10 caracteres (AX corta lo demás).
 */
export function valoresAx(linea, variante = null) {
  const tamano = texto(linea.tamano);
  const np = texto(variante?.np);
  const colorEnNp = np && claveEstricta(np) === claveEstricta(linea.color);
  return { dimension: dimensionAx(linea), np: colorEnNp ? "" : np, cortado: tamano.length === 10 };
}

/** ¿Con esa dimensión y NP el renglón de AX empareja exacto? */
export function cuadraConAx(linea, { dimension, np, um = "" }) {
  return esExacto(formasAx(linea), formasFisico({ dimension, np, um }));
}

function lineaDelCorte(estado, corteId, lineaId) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  const linea = corte.lineas.find((l) => l.id === lineaId);
  if (!linea) throw new ErrorConciliacion("Esa partida de AX ya no existe.");
  return { corte, linea };
}

/**
 * Corrige la dimensión / NP del inventario durante la conciliación y agrega a Material una
 * etiqueta con los datos vigentes por cada partida física modificada.
 * @returns el resultado de corregirDimensionNp y los ids de las etiquetas nuevas
 */
export function corregirInventarioParaAx(estado, { corteId, cual, dimension, np, lineaId = null }, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  const linea = lineaId === null ? null : lineaDelCorte(estado, corteId, lineaId).linea;
  const previa = previaCorreccion(estado, cual, { dimension, np });
  if (linea && linea.codigo !== previa.variante.codigo) throw new ErrorConciliacion("La partida de AX debe ser del mismo código que el inventario.");
  if (linea && !unidadesCompatibles(linea.um, previa.variante.um)) throw new ErrorConciliacion("La partida de AX tiene otra unidad de medida.");
  // Una etiqueta por partida física que cambia, incluso si la variante está en varios contenedores.
  const partidas = previa.renglones.filter((e) => e.activo !== false && (
    texto(dimensionMostrada(e, previa.variante)) !== texto(dimension) || texto(npMostrado(e, previa.variante)) !== texto(np)
  )).map((e) => e.id);
  const resultado = corregirDimensionNp(estado, cual, { dimension, np }, { usuario, motivo: `Conciliación con AX del ${fmtFecha(corte.fecha)}` });
  const etiquetas = agregarEtiquetas(estado, "material", partidas.map((id) => {
    const etiqueta = etiquetaDeExistencia(estado, id);
    etiqueta.nombre = texto(linea?.nombre) || etiqueta.nombre;
    etiqueta.origen = { ...etiqueta.origen, corte_ax_id: corte.id, linea_ax_id: lineaId };
    return etiqueta;
  }));
  return { ...resultado, etiquetas };
}

/**
 * Confirma la pareja de un renglón de AX corrigiendo el inventario y preparando sus etiquetas.
 * Con varianteId null, anota que ese renglón no está en físico; no genera etiquetas.
 */
export function confirmarPareja(estado, { corteId, lineaId, varianteId, dimension = null, np = null }, usuario = null) {
  const { corte, linea } = lineaDelCorte(estado, corteId, lineaId);
  if (estado.equivalencias_ax?.[claveAx(linea)]) delete estado.equivalencias_ax[claveAx(linea)];
  if (varianteId === null || varianteId === undefined) {
    corte.vinculos_fisicos = (corte.vinculos_fisicos ?? []).filter((v) => v.linea_ax_id !== lineaId);
    corte.sin_pareja = [...new Set([...(corte.sin_pareja ?? []), lineaId])];
    auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion: "SIN_PAREJA", despues: { linea: lineaId, codigo: linea.codigo, tamano: linea.tamano, color: linea.color } });
    return { sinPareja: true };
  }
  const variante = new Indices(estado).variante(varianteId);
  if (!variante) throw new ErrorConciliacion("Esa variante ya no existe.");
  const propuesta = valoresAx(linea, variante);
  const valores = { dimension: dimension ?? propuesta.dimension, np: np ?? propuesta.np };
  // Una partida del inventario solo puede ser pareja de una partida de AX: ni la elegida ni aquella
  // con la que se juntaría al corregirla pueden ser ya la pareja de otra.
  const otras = emparejar(estado, corte).filter((q) => q.linea.id !== lineaId && q.confirmado && q.variante_id !== null);
  const previa = previaCorreccion(estado, { varianteId }, valores);
  const destino = previa.otra;
  const ocupada = otras.find((q) => (q.grupo ?? [q.variante_id]).some((id) => id === varianteId || id === destino?.id));
  if (ocupada) {
    throw new ErrorConciliacion(
      `Esa partida del inventario ya es la pareja de ${ocupada.linea.codigo} ${dimensionAx(ocupada.linea) || "SIN DIMENSIÓN"} en AX. Si esta no tiene otra, márcala como "No está en el físico".`,
    );
  }
  corte.sin_pareja = (corte.sin_pareja ?? []).filter((id) => id !== lineaId);
  try {
    const resultado = corregirInventarioParaAx(estado, { corteId, cual: { varianteId }, ...valores, lineaId }, usuario);
    corte.vinculos_fisicos = (corte.vinculos_fisicos ?? []).filter((v) => v.linea_ax_id !== lineaId);
    return resultado;
  } catch (error) {
    if (error instanceof ErrorCorreccion) throw new ErrorConciliacion(error.message);
    throw error;
  }
}

/**
 * Confirma de una vez las sugerencias seguras (puntaje ≥ PUNTAJE_SEGURO), cada variante una sola
 * vez. @returns cuántas se corrigieron
 */
export function confirmarSeguras(estado, corteId, usuario = null) {
  const corte = corteAx(estado, corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  const usadas = new Set();
  let hechas = 0;
  for (const p of emparejar(estado, corte)) {
    if (p.confirmado || p.variante_id === null || p.puntaje < PUNTAJE_SEGURO || usadas.has(p.variante_id)) continue;
    usadas.add(p.variante_id);
    try {
      confirmarPareja(estado, { corteId, lineaId: p.linea.id, varianteId: p.variante_id }, usuario);
      hechas += 1;
    } catch (error) {
      if (!(error instanceof ErrorConciliacion)) throw error;
    }
  }
  return hechas;
}

/** Deshace "no está en físico" (y lo que recordaban las versiones anteriores) para ese renglón. */
export function olvidarPareja(estado, { corteId, lineaId }, usuario = null) {
  const { corte, linea } = lineaDelCorte(estado, corteId, lineaId);
  const antes = { sin_pareja: (corte.sin_pareja ?? []).includes(lineaId), equivalencia: estado.equivalencias_ax?.[claveAx(linea)] ?? null,
    vinculos: (corte.vinculos_fisicos ?? []).filter((v) => v.linea_ax_id === lineaId) };
  if (!antes.sin_pareja && !antes.equivalencia && !antes.vinculos.length) return;
  corte.sin_pareja = (corte.sin_pareja ?? []).filter((id) => id !== lineaId);
  corte.vinculos_fisicos = (corte.vinculos_fisicos ?? []).filter((v) => v.linea_ax_id !== lineaId);
  if (antes.equivalencia) delete estado.equivalencias_ax[claveAx(linea)];
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion: "OLVIDAR", antes: { linea: lineaId, ...antes } });
}

// ---------------------------------------------------------------- comparación

const ESTADOS = { cuadra: "Cuadra", explicada: "Explicada por vales", sobrante: "Sobrante", faltante: "Faltante", por_confirmar: "Por confirmar" };
export const etiquetaEstado = (e) => ESTADOS[e] ?? e;

export function comparar({ ax, valorAx, fisico, transito }) {
  const salidas = transito?.salidas ?? CERO;
  const entradas = transito?.entradas ?? CERO;
  const diferencia = fisico.minus(ax);
  const sinExplicar = diferencia.plus(salidas).minus(entradas);
  const estado = sinExplicar.eq(0) ? (diferencia.eq(0) ? "cuadra" : "explicada") : sinExplicar.gt(0) ? "sobrante" : "faltante";
  const costo = ax.gt(0) && valorAx && valorAx.gt(0) ? valorAx.div(ax) : null;
  return {
    ax,
    fisico,
    salidas,
    entradas,
    folios: transito?.folios ?? [],
    partidas: transito?.partidas ?? [],
    diferencia,
    sin_explicar: sinExplicar,
    estado,
    costo,
    valor: costo ? sinExplicar.times(costo) : null,
  };
}

const claveGeneral = (x) => {
  const linea = x.lineas?.[0] ?? x.linea;
  return linea ? dimensionAx(linea) : (x.variante?.dimension ?? "");
};

const descripcionDe = (estado, codigo, porDefecto = "") => estado.articulos?.[codigo]?.descripcion ?? porDefecto;

/**
 * Concilia un corte contra el inventario de hoy (RF-52 a RF-55).
 * @returns {{ corte, pares, renglones, porCodigo, porContenedor, axSinFisico, fisicoSinAx, porConfirmar, general, resumen }}
 *   general = todas las partidas INV del reporte (emparejadas, por confirmar —estado "por_confirmar"— y sin
 *   físico) más lo que solo está en el físico: la vista "Todos".
 */
export function conciliar(estado, corte) {
  const indices = new Indices(estado);
  const fisico = fisicoComparable(estado, corte, indices);
  const lineasCorte = lineasInv(corte);
  const pares = emparejar(estado, corte, { indices, fisico });
  const ax = estadoAxDeVales(estado);
  const transito = transitoDesde(estado, corte, { indices, ax });

  // Filas: cada partida de AX con su(s) variante(s). Las que comparten variante van juntas: varias de
  // AX con una variante, o una de AX sin dimensión con varias variantes (grupo).
  const renglones = agruparPares(pares.filter((p) => p.confirmado && p.variante_id !== null)).map(({ pares: ps, varianteIds }) => {
    const principalId = ps[0].variante_id;
    const variantes = varianteIds.map((id) => fisico.get(id)?.variante ?? indices.variante(id)).filter(Boolean);
    const variante = variantes.find((v) => v.id === principalId) ?? variantes[0];
    const lineas = ps.map((p) => p.linea);
    const fs = varianteIds.map((id) => fisico.get(id)).filter(Boolean);
    return {
      variante_id: principalId,
      variante_ids: varianteIds,
      codigo: variante.codigo,
      descripcion: descripcionDe(estado, variante.codigo, lineas[0].nombre),
      variante,
      variantes,
      lineas,
      metodos: [...new Set(ps.map((p) => p.metodo))],
      lugares: fs.flatMap((f) =>
        f.renglones.map((r) => ({
          lugar: lugarCorto(r.ubicacion),
          hoja: r.ubicacion.hoja_excel.trim(),
          total: r.total,
          detalle: varianteIds.length > 1 ? [f.variante.dimension, f.variante.np ? `NP ${f.variante.np}` : ""].filter(Boolean).join(" · ") || "SIN DIMENSIÓN" : "",
        })),
      ),
      ...comparar({
        ax: sumar(...lineas.map((l) => dec(l.disponible) ?? CERO)),
        valorAx: sumar(...lineas.map((l) => dec(l.valor_financiero) ?? CERO)),
        fisico: sumar(...fs.map((f) => f.total)),
        transito: juntarTransito(...varianteIds.map((id) => transito.porVariante.get(id)), ...lineas.map((l) => transito.porLineaAx.get(l.id))),
      }),
    };
  });
  const enAx = new Set(renglones.flatMap((r) => r.variante_ids));
  const sugeridas = new Set(pares.filter((p) => !p.confirmado && hay(p.variante_id)).map((p) => p.variante_id));

  // Físico sin renglón en AX (RF-55): variantes con existencia que ningún renglón confirmado toma.
  const fisicoSinAx = [...fisico.values()]
    .filter((r) => !enAx.has(r.variante.id) && !sugeridas.has(r.variante.id) && !r.total.eq(0))
    .map((r) => ({
      variante_id: r.variante.id,
      codigo: r.variante.codigo,
      descripcion: descripcionDe(estado, r.variante.codigo),
      variante: r.variante,
      lugares: r.renglones.map((x) => ({ lugar: lugarCorto(x.ubicacion), hoja: x.ubicacion.hoja_excel.trim(), total: x.total })),
      ...comparar({ ax: CERO, valorAx: null, fisico: r.total, transito: transito.porVariante.get(r.variante.id) }),
    }))
    .sort((a, b) => a.codigo - b.codigo);

  // AX sin físico (RF-55): confirmados como "no está" o sin ningún renglón de ese código.
  const axSinFisico = pares
    .filter((p) => p.confirmado && p.variante_id === null)
    .map((p) => ({
      linea: p.linea,
      metodo: p.metodo,
      codigo: p.linea.codigo,
      descripcion: descripcionDe(estado, p.linea.codigo, p.linea.nombre),
      ...comparar({ ax: dec(p.linea.disponible) ?? CERO, valorAx: dec(p.linea.valor_financiero), fisico: CERO, transito: transito.porLineaAx.get(p.linea.id) ?? null }),
    }));

  const porConfirmar = pares.filter((p) => !p.confirmado);
  // Las partidas de AX por confirmar también se ven en la vista general (con su sugerencia, sin resultado aún).
  const porConfirmarFilas = porConfirmar.map((p) => {
    const sugerida = hay(p.variante_id) ? fisico.get(p.variante_id) : null;
    return {
      linea: p.linea,
      lineas: [p.linea],
      codigo: p.linea.codigo,
      descripcion: descripcionDe(estado, p.linea.codigo, p.linea.nombre),
      variante: sugerida?.variante ?? null,
      aviso: p.aviso ?? null,
      sugerida: Boolean(sugerida),
      lugares: (sugerida?.renglones ?? []).map((x) => ({ lugar: lugarCorto(x.ubicacion), hoja: x.ubicacion.hoja_excel.trim(), total: x.total })),
      ax: dec(p.linea.disponible) ?? CERO,
      fisico: null,
      salidas: CERO,
      entradas: CERO,
      folios: [],
      partidas: [],
      diferencia: null,
      sin_explicar: null,
      estado: "por_confirmar",
      costo: null,
      valor: null,
    };
  });

  // Por artículo (código): no depende del emparejamiento.
  const codigos = new Set([...lineasCorte.map((l) => l.codigo), ...[...fisico.values()].filter((r) => !r.total.eq(0)).map((r) => r.variante.codigo)]);
  const porCodigo = [...codigos]
    .map((codigo) => {
      const lineas = lineasCorte.filter((l) => l.codigo === codigo);
      const variantes = [...fisico.values()].filter((r) => r.variante.codigo === codigo);
      const pista = transito.porUbicar.get(codigo);
      return {
        codigo,
        descripcion: descripcionDe(estado, codigo, lineas[0]?.nombre ?? ""),
        renglones_ax: lineas.length,
        variantes: variantes.length,
        por_ubicar: pista ? pista.folios : [],
        no_inv: transito.noSeDescuentan.get(codigo) ?? [],
        por_confirmar: porConfirmar.filter((p) => p.linea.codigo === codigo).length,
        ...comparar({
          ax: sumar(...lineas.map((l) => dec(l.disponible) ?? CERO)),
          valorAx: sumar(...lineas.map((l) => dec(l.valor_financiero) ?? CERO)),
          fisico: sumar(...variantes.map((r) => r.total)),
          transito: transito.porCodigo.get(codigo),
        }),
      };
    })
    .sort((a, b) => a.codigo - b.codigo);

  // Por contenedor: cada renglón del inventario con el resultado de su variante.
  const resultadoDe = new Map([...renglones.flatMap((r) => r.variante_ids.map((id) => [id, r])), ...fisicoSinAx.map((r) => [r.variante_id, r])]);
  const contenedores = new Map();
  for (const r of fisico.values()) {
    for (const x of r.renglones) {
      const u = x.ubicacion;
      if (!contenedores.has(u.id)) contenedores.set(u.id, { ubicacion: u, lugar: lugarCorto(u), hoja: u.hoja_excel.trim(), renglones: [] });
      const resultado = resultadoDe.get(r.variante.id) ?? null;
      contenedores.get(u.id).renglones.push({
        existencia_id: x.existencia.id,
        codigo: r.variante.codigo,
        descripcion: descripcionDe(estado, r.variante.codigo),
        dimension: dimensionMostrada(x.existencia, r.variante) ?? "",
        np: npMostrado(x.existencia, r.variante) ?? "",
        um: umMostrada(x.existencia, r.variante) ?? "",
        aqui: x.total,
        resultado,
        en_ax: enAx.has(r.variante.id),
        por_confirmar: sugeridas.has(r.variante.id),
      });
    }
  }
  const porContenedor = [...contenedores.values()]
    .sort((a, b) => a.ubicacion.orden - b.ubicacion.orden)
    .map((c) => ({ ...c, renglones: c.renglones.sort((a, b) => indices.existencia(a.existencia_id).orden - indices.existencia(b.existencia_id).orden) }));

  const todos = [...renglones, ...fisicoSinAx, ...axSinFisico];
  const cuenta = (e) => todos.filter((r) => r.estado === e).length;
  const valorDe = (signo) => sumar(...todos.filter((r) => r.valor && (signo > 0 ? r.valor.gt(0) : r.valor.lt(0))).map((r) => r.valor));
  const confirmados = pares.filter((p) => p.confirmado).length;
  const resumen = {
    lineas_ax: pares.length,
    no_inv: corte.lineas.length - lineasCorte.length,
    confirmados,
    emparejados: pares.filter((p) => p.confirmado && p.variante_id !== null).length,
    por_confirmar: porConfirmar.length,
    porcentaje: pares.length ? Math.round((confirmados / pares.length) * 1000) / 10 : 100,
    cuadran: cuenta("cuadra"),
    explicadas: cuenta("explicada"),
    sobrantes: cuenta("sobrante"),
    faltantes: cuenta("faltante"),
    ax_sin_fisico: axSinFisico.length,
    fisico_sin_ax: fisicoSinAx.length,
    valor_sobrante: valorDe(1),
    valor_faltante: valorDe(-1),
  };
  // Vista general: TODO el reporte de AX (emparejadas, por confirmar y sin físico) y lo que solo está en el físico.
  const general = [...renglones, ...porConfirmarFilas, ...axSinFisico, ...fisicoSinAx].sort(
    (a, b) => a.codigo - b.codigo || claveGeneral(a).localeCompare(claveGeneral(b)),
  );
  return { corte, pares, renglones, porCodigo, porContenedor, axSinFisico, fisicoSinAx, porConfirmar, general, transito, fisico, resumen, ax };
}

/** Texto de los folios en tránsito para la solicitud de ajuste: "9 (S), E-0003 (E)". */
export const foliosTexto = (folios) => folios.join(", ");

export const cantidadTexto = (d) => (d === null || d === undefined ? "" : decTexto(d));
