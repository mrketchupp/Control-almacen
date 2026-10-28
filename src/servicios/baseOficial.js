// Base oficial (Ronda 20): el conteo de la auditoría pasa a ser la CANTIDAD del inventario.
//
// El Kardex de auditoría es el reporte de AX de cada inventario (una hoja por inventario) con dos
// columnas que llenó el conteo oficial: Conteo (o Conteo Fisico) y Contenedor. Al aplicarlo:
//  - solo cambian las partidas INVENTARIABLES; lo consumible no se toca (decisión del usuario);
//  - cada partida contada apunta a un conteo nuevo (tipo AUDITORIA) con el corte por folio del día del
//    conteo: los vales posteriores se descuentan solos, aunque el almacén ya se haya abierto;
//  - lo que el Kardex contó y no estaba en el inventario se da de alta en la hoja inventariable del
//    contenedor que anotó el conteo;
//  - si el físico tiene el artículo repetido en varias partidas, el conteo queda en una y las demás se
//    dan de BAJA (no se borran: quedan con su motivo y dejan de salir en el Excel);
//  - lo que se escribe distinto que en AX se confirma y la variante toma la escritura de AX (como en
//    Conciliación AX);
//  - en GSM, lo que cuenta la hoja de FX queda marcado como de FX (`existencia.dueno`); si el físico
//    tenía en una sola partida lo de GSM y lo de FX, se separan.
// Nada cambia hasta aplicar: `analizarKardex` + `planBaseOficial` arman la vista previa con las
// decisiones del usuario y `aplicarBaseOficial` lo hace todo en un solo cambio.
//
// Ver docs/05-flujos.md §4.3.

import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../nucleo/fechas.js";
import { DUENO_FX, duenoDe } from "../nucleo/inventarios.js";
import { claveEstricta, mayusculas, unidad } from "../nucleo/normalizar.js";
import { dimensionAx, emparejar, fisicoPorVariante, registrarCorteAx, umComparable, valoresAx, varianteVigente } from "./conciliacion.js";
import { ErrorCorreccion, corregirDimensionNp, crearRenglon, lugarCorto, ordenSiguiente, ubicacionesOrdenadas } from "./inventario.js";

export class ErrorBaseOficial extends Error {
  constructor(mensaje, errores = []) {
    super(mensaje);
    this.errores = errores;
  }
}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const esInv = (l) => !texto(l.modelo_ax) || mayusculas(l.modelo_ax) === "INV";
const conteoDe = (l) => dec(l.conteo) ?? CERO;
const sumar = (xs) => xs.reduce((a, x) => a.plus(x), CERO);

/** Número de contenedor que anotó el conteo ("3", "#3", "C-3"); null si no dice (vacío o 0). */
export function contenedorDe(valor) {
  const m = texto(valor).match(/\d+/);
  const n = m ? Number(m[0]) : 0;
  return n > 0 ? n : null;
}

/** Costo unitario de una partida de AX: Valor Financiero / Cantidad Financiera (o / Disponible). */
export function costoUnitario(l) {
  const valor = dec(l.valor_financiero);
  const cantidad = dec(l.cantidad_financiera) ?? dec(l.disponible);
  return valor && cantidad && !cantidad.eq(0) ? valor.div(cantidad) : null;
}

/**
 * Último folio de salida y de entrada emitidos hasta ese día: lo que el conteo ya refleja. Con
 * `folioSalida` se usa ese (si se sabe que algún vale de ese día salió después de contar).
 */
export function corteAlDia(estado, fecha, folioSalida = null) {
  let salida = 0;
  let entrada = 0;
  for (const v of estado.vales) {
    if (v.estado !== "EMITIDO" || !Number.isInteger(v.folio) || !v.fecha || v.fecha > fecha) continue;
    if (v.tipo === "SALIDA") salida = Math.max(salida, v.folio);
    else if (v.tipo === "ENTRADA") entrada = Math.max(entrada, v.folio);
  }
  const elegido = texto(folioSalida) === "" ? null : Number(folioSalida);
  return { salida: Number.isInteger(elegido) && elegido >= 0 ? elegido : salida, entrada };
}

/** Saldo de cada partida como estaba al corte (sin los vales posteriores). */
export function saldosAlCorte(estado, corte) {
  const vales = estado.vales.filter((v) => !(v.folio > (v.tipo === "ENTRADA" ? corte.entrada : corte.salida)));
  return calcularSaldos({ ...estado, vales });
}

/**
 * Empareja las partidas del Kardex (con conteo) con las variantes del inventario, como la conciliación.
 * @param hojas  las de clasificarHojas (kardex.js); se usan las que tienen `uso` ("propio" o "FX")
 * @returns {{ fecha, corte, indices, saldos, lineas, contadas, pares, sinConteo }}
 *   cada línea: el renglón de AX con id = "hoja#fila", hoja, dueno (null o "FX") y modelo_ax (el original)
 */
export function analizarKardex(estado, hojas, { fecha, folioSalida = null } = {}) {
  const indices = new Indices(estado);
  const corte = corteAlDia(estado, fecha, folioSalida);
  const saldos = saldosAlCorte(estado, corte);
  const fisico = fisicoPorVariante(estado, { indices, saldos });
  const lineas = [];
  for (const h of hojas) {
    if (!h.uso) continue;
    const dueno = h.uso === DUENO_FX ? DUENO_FX : null;
    // Todas se emparejan (también las de otro modelo, p. ej. CONPROV: lo contado es lo que hay); las que
    // no son INV solo se aplican si ya están en el inventario.
    for (const r of h.tabla.renglones) lineas.push({ ...r, id: `${h.hoja}#${r.fila}`, hoja: h.hoja, dueno, modelo_ax: r.modelo, modelo: "INV" });
  }
  const contadas = lineas.filter((l) => dec(l.conteo) !== null);
  // Cada hoja se empareja por su lado (como un reporte de AX): la de GSM y la de FX pueden traer el mismo
  // artículo y las dos deben encontrar sus partidas; luego se juntan por variante (agrupar).
  const pares = [...new Set(contadas.map((l) => l.hoja))].flatMap((hoja) =>
    emparejar(estado, { lineas: contadas.filter((l) => l.hoja === hoja), sin_pareja: [] }, { indices, fisico }),
  );
  // Una variante que una hoja empareja exacto no se sugiere a otra hoja por parecido (p. ej. FX "0-500 PSI"
  // con la "0-300 PSI" que ya es de GSM): si es el mismo artículo, AX lo escribiría igual.
  const exactas = new Map();
  for (const p of pares) if (p.confirmado && p.variante_id !== null) for (const id of p.grupo ?? [p.variante_id]) exactas.set(id, p.linea.hoja);
  const deOtraHoja = (id, hoja) => exactas.has(id) && exactas.get(id) !== hoja;
  for (const p of pares) {
    if (p.confirmado) continue;
    p.candidatos = p.candidatos.filter((c) => !deOtraHoja(c.variante_id, p.linea.hoja));
    if (p.variante_id !== null && deOtraHoja(p.variante_id, p.linea.hoja)) Object.assign(p, { variante_id: null, metodo: "sin_sugerencia", puntaje: null });
  }
  return { fecha, corte, indices, saldos, lineas, contadas, pares, sinConteo: lineas.filter((l) => dec(l.conteo) === null) };
}

/** Los números de un texto ("0-500 PSI 1/2" → ["0", "500", "1", "2"]). */
const numeros = (t) => texto(t).match(/\d+/g) ?? [];

/**
 * ¿Los números de la partida de AX están en la variante (dimensión o NP)? "0-500 PSI" no es "0-300 PSI"
 * aunque se parezcan mucho. El último número puede venir cortado (AX guarda 10 caracteres del Tamaño).
 */
export function mismosNumeros(linea, variante) {
  const suyos = numeros(`${variante?.dimension ?? ""} ${variante?.np ?? ""}`);
  const deAx = numeros(`${linea.tamano ?? ""} ${linea.color ?? ""}`);
  const cortado = texto(linea.tamano).length === 10;
  return deAx.every((n, i) => suyos.includes(n) || (cortado && i === numeros(linea.tamano).length - 1 && suyos.some((x) => x.startsWith(n))));
}

/**
 * Lo que se propone para una partida de AX que se escribe distinto: la sugerida si la recordaba la
 * conciliación, o si es la única o muy parecida Y tiene los mismos números; si hay otras partidas del
 * código pero ninguna segura, null (el usuario elige); si no hay ninguna, partida nueva.
 */
function propuesta(p, indices) {
  if (p.variante_id !== null && (p.metodo === "recordada" || mismosNumeros(p.linea, indices.variante(p.variante_id)))) return p.variante_id;
  return p.candidatos.length ? null : "nueva";
}

/** Une las líneas que comparten alguna variante (p. ej. la de GSM y la de FX del mismo artículo). */
function agrupar(resueltas) {
  const raiz = new Map();
  const buscar = (x) => {
    while (raiz.get(x) !== x) x = raiz.get(x);
    return x;
  };
  for (const r of resueltas) {
    for (const id of r.ids) if (!raiz.has(id)) raiz.set(id, id);
    for (const id of r.ids.slice(1)) raiz.set(buscar(id), buscar(r.ids[0]));
  }
  const grupos = new Map();
  for (const r of resueltas) {
    const k = buscar(r.ids[0]);
    if (!grupos.has(k)) grupos.set(k, { lineas: [], varianteIds: [] });
    const g = grupos.get(k);
    g.lineas.push(r);
    for (const id of r.ids) if (!g.varianteIds.includes(id)) g.varianteIds.push(id);
  }
  return [...grupos.values()];
}

/**
 * La vista previa: qué le pasa a cada partida con las decisiones del usuario (todas opcionales).
 * @param decisiones {
 *   parejas:     { [lineaId]: varianteId | "nueva" }  (las que se escriben distinto; por omisión, la sugerida)
 *   cantidades:  { [clave]: "4" }   reparto a mano (clave "e:<id>" de la partida o "n:<lineaId>" de una nueva)
 *   bajas:       { [clave]: bool }  dar de baja (la cantidad debe quedar en 0)
 *   duenos:      { [clave]: null | "FX" }
 *   mover:       { [clave]: bool }  moverla al contenedor que anotó el conteo
 *   ubicaciones: { [clave]: ubicacionId }  dónde va una partida nueva
 *   omitir:      { [clave]: bool }  no dar de alta esa partida nueva
 *   sinKardex:   { [existenciaId]: "dejar" | "baja" }  partidas inventariables que el Kardex no trae
 * }
 * @returns {{ grupos, nuevas, porConfirmar, soloConsumible, sinKardex, ignoradas, noEncontradas, errores, avisos, resumen, corte }}
 */
export function planBaseOficial(estado, analisis, decisiones = {}) {
  const D = { parejas: {}, cantidades: {}, bajas: {}, duenos: {}, mover: {}, ubicaciones: {}, omitir: {}, sinKardex: {}, ...decisiones };
  const { indices, saldos, pares, corte } = analisis;
  const errores = [];
  const avisos = [];
  const actualDe = (e) => saldos.get(e.id)?.total ?? CERO;
  const ubicacionesInv = ubicacionesOrdenadas(estado).filter((u) => u.clase === "INV");
  const invDeContenedor = (n) => (n ? (ubicacionesInv.find((u) => u.contenedor === n) ?? null) : null);
  const esInvE = (e) => indices.ubicacion(e.ubicacion_id)?.clase === "INV";
  const activasPorVariante = new Map();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    if (!activasPorVariante.has(e.variante_id)) activasPorVariante.set(e.variante_id, []);
    activasPorVariante.get(e.variante_id).push(e);
  }
  // Una partida con vales posteriores al conteo (o en un borrador) no se puede dar de baja.
  const conMovimientos = new Set();
  for (const v of estado.vales) {
    if (v.estado !== "EMITIDO" || !(v.folio > (v.tipo === "ENTRADA" ? corte.entrada : corte.salida))) continue;
    for (const l of v.lineas) if (l.existencia_id != null) conMovimientos.add(l.existencia_id);
  }
  for (const b of [...(estado.borradores ?? []), ...(estado.borradores_entrada ?? [])]) for (const l of b.lineas ?? []) if (l.existencia_id != null) conMovimientos.add(l.existencia_id);

  const describir = (e) => {
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    return {
      existencia: e,
      codigo: v.codigo,
      descripcion: indices.articulo(v.codigo)?.descripcion ?? "",
      dimension: dimensionMostrada(e, v) || "",
      np: npMostrado(e, v) || "",
      um: umMostrada(e, v) || "",
      ubicacion: u,
      lugar: lugarCorto(u),
      actual: actualDe(e),
    };
  };
  const partidaDe = (e) => ({
    ...describir(e),
    clave: `e:${e.id}`,
    existencia_id: e.id,
    nueva: false,
    cantidad: actualDe(e).lt(0) ? CERO : actualDe(e),
    dueno: duenoDe(e),
    dueno_antes: duenoDe(e),
    baja: false,
    puede_baja: !conMovimientos.has(e.id),
    mover: false,
    mover_a: null,
    lineas: [],
  });
  const nuevaDe = (l, varianteId, ubicacion, revisar) => ({
    clave: `n:${l.id}`,
    existencia_id: null,
    nueva: true,
    linea: l,
    variante_id: varianteId,
    codigo: l.codigo,
    descripcion: indices.articulo(l.codigo)?.descripcion ?? l.nombre,
    dimension: varianteId ? (indices.variante(varianteId)?.dimension ?? "") : dimensionAx(l),
    np: varianteId ? (indices.variante(varianteId)?.np ?? "") : "",
    um: varianteId ? (indices.variante(varianteId)?.um ?? "") : umPara(estado, l.codigo, l.um),
    ubicacion_id: ubicacion?.id ?? null,
    ubicacion: ubicacion ?? null,
    lugar: ubicacion ? lugarCorto(ubicacion) : "",
    actual: CERO,
    cantidad: conteoDe(l),
    dueno: l.dueno,
    dueno_antes: null,
    baja: false,
    puede_baja: false,
    mover: false,
    mover_a: null,
    lineas: [l.id],
    revisar,
  });

  // 1. Cada línea del Kardex: con qué variante(s) va.
  const resueltas = [];
  const porConfirmar = [];
  const sinVariante = [];
  const ignoradas = [];
  for (const p of pares) {
    const l = p.linea;
    let ids = null;
    let corrige = null;
    if (p.confirmado && p.variante_id !== null) ids = p.grupo ?? [p.variante_id];
    else if (!p.confirmado) {
      const pedida = D.parejas[l.id];
      const elegida = pedida === undefined ? propuesta(p, indices) : pedida;
      const variante = elegida === "nueva" || elegida === null ? null : indices.variante(Number(elegida));
      const decision = variante ? variante.id : elegida === null ? null : "nueva";
      porConfirmar.push({ linea: l, par: p, decision, sugerida: p.variante_id, candidatos: p.candidatos, metodo: p.metodo, puntaje: p.puntaje, inv: esInv(l) });
      if (decision === null) {
        errores.push({ clave: l.id, mensaje: `${l.codigo} ${dimensionAx(l) || "SIN DIMENSIÓN"} (conteo ${decTexto(conteoDe(l))}): elige si es una de tus partidas o una nueva.` });
        continue;
      }
      if (variante) {
        ids = [variante.id];
        corrige = variante.id;
      }
    }
    if (!ids) {
      if (esInv(l)) sinVariante.push(l);
      else ignoradas.push({ linea: l, motivo: "no_inv" });
      continue;
    }
    resueltas.push({ linea: l, ids, corrige, metodo: p.metodo });
  }

  // 2. Grupos de variantes con sus partidas inventariables.
  const grupos = [];
  const soloConsumible = [];
  const nuevas = [];
  const usadas = new Set();
  for (const g of agrupar(resueltas)) {
    const todas = g.varianteIds.flatMap((id) => activasPorVariante.get(id) ?? []);
    const inv = todas.filter(esInvE).sort((a, b) => indices.ubicacion(a.ubicacion_id).orden - indices.ubicacion(b.ubicacion_id).orden || a.orden - b.orden);
    const cons = todas.filter((e) => !esInvE(e));
    if (!inv.length) {
      if (cons.length) soloConsumible.push({ lineas: g.lineas.map((r) => r.linea), partidas: cons.map(describir) });
      else for (const r of g.lineas) sinVariante.push(r.linea);
      continue;
    }
    for (const e of inv) usadas.add(e.id);
    const { partidas, revisar } = repartir(g, inv.map(partidaDe), { invDeContenedor, nuevaDe });
    grupos.push({ clave: `g:${g.lineas[0].linea.id}`, lineas: g.lineas.map((r) => r.linea), varianteIds: g.varianteIds, partidas, revisar, consumible: cons.map(describir) });
  }

  // 3. Lo que el Kardex contó y no está en el inventario: partida nueva.
  const noEncontradas = [];
  for (const l of sinVariante) {
    if (conteoDe(l).lte(0)) {
      noEncontradas.push(l); // AX lo tiene, el conteo no lo encontró y no hay partida: nada que dar de alta
      continue;
    }
    const delCodigo = estado.existencias.filter((e) => e.activo !== false && indices.variante(e.variante_id)?.codigo === l.codigo && esInvE(e));
    const sugerida = invDeContenedor(contenedorDe(l.contenedor));
    const otra = delCodigo.length ? indices.ubicacion(delCodigo[0].ubicacion_id) : null;
    const misma = estado.variantes.find(
      (v) => v.activo !== false && v.codigo === l.codigo && v.dimension_clave === claveEstricta(dimensionAx(l)) && !v.np_clave && umComparable(v.um) === umComparable(l.um),
    );
    nuevas.push(nuevaDe(l, misma?.id ?? null, sugerida ?? otra, !sugerida));
  }

  // 4. Decisiones del usuario sobre cada partida.
  const aplicarDecisiones = (pt) => {
    const k = pt.clave;
    if (D.cantidades[k] !== undefined) {
      const c = dec(D.cantidades[k]);
      if (c === null || c.lt(0)) errores.push({ clave: k, mensaje: `${pt.codigo} ${pt.lugar}: la cantidad debe ser un número (0 o más).` });
      else pt.cantidad = c;
    }
    if (D.duenos[k] !== undefined) pt.dueno = D.duenos[k] === DUENO_FX ? DUENO_FX : null;
    if (D.bajas[k] !== undefined) pt.baja = Boolean(D.bajas[k]);
    if (D.mover[k] !== undefined) pt.mover = Boolean(D.mover[k]) && Boolean(pt.mover_a);
    if (pt.nueva && D.ubicaciones[k] !== undefined) {
      const u = indices.ubicacion(Number(D.ubicaciones[k]));
      if (u) Object.assign(pt, { ubicacion_id: u.id, ubicacion: u, lugar: lugarCorto(u), revisar: false });
    }
    if (pt.nueva) pt.omitida = Boolean(D.omitir[k]);
  };
  for (const g of grupos) {
    for (const pt of g.partidas) aplicarDecisiones(pt);
    // Lo que queda en cada dueño debe ser lo que contó su hoja.
    for (const dueno of new Set([...g.lineas.map((l) => l.dueno), ...g.partidas.map((p) => p.dueno)])) {
      const contado = sumar(g.lineas.filter((l) => l.dueno === dueno).map(conteoDe));
      const repartido = sumar(g.partidas.filter((p) => p.dueno === dueno && !p.omitida).map((p) => p.cantidad));
      if (!contado.eq(repartido)) {
        errores.push({ clave: g.clave, mensaje: `${g.lineas[0].codigo} ${dimensionAx(g.lineas[0]) || "SIN DIMENSIÓN"}: el conteo${dueno ? ` de ${dueno}` : ""} es ${decTexto(contado)} y en las partidas suman ${decTexto(repartido)}.` });
      }
    }
    for (const pt of g.partidas) {
      if (pt.baja && !pt.cantidad.eq(0)) errores.push({ clave: pt.clave, mensaje: `${pt.codigo} ${pt.lugar}: para darla de baja su cantidad debe quedar en 0.` });
      if (pt.baja && !pt.puede_baja) errores.push({ clave: pt.clave, mensaje: `${pt.codigo} ${pt.lugar}: tiene vales posteriores al conteo; no se puede dar de baja.` });
      if (pt.nueva && !pt.omitida && !pt.ubicacion_id) errores.push({ clave: pt.clave, mensaje: `${pt.codigo}: elige en qué contenedor va la partida nueva.` });
    }
    g.cambia = g.partidas.some((p) => p.nueva || p.baja || p.mover || !p.cantidad.eq(p.actual) || p.dueno !== p.dueno_antes);
  }
  for (const pt of nuevas) {
    aplicarDecisiones(pt);
    if (!pt.omitida && !pt.ubicacion_id) errores.push({ clave: pt.clave, mensaje: `${pt.codigo} ${pt.dimension || "SIN DIMENSIÓN"}: elige en qué contenedor va la partida nueva.` });
  }

  // 5. Partidas inventariables que el Kardex no trae: se quedan como están, salvo que se digan que no existen.
  const sinKardex = [];
  for (const e of estado.existencias) {
    if (e.activo === false || usadas.has(e.id) || !esInvE(e)) continue;
    const decision = D.sinKardex[e.id] === "baja" ? "baja" : "dejar";
    const d = { ...describir(e), clave: `e:${e.id}`, dueno: duenoDe(e), decision, puede_baja: !conMovimientos.has(e.id) };
    if (decision === "baja" && !d.puede_baja) errores.push({ clave: d.clave, mensaje: `${d.codigo} ${d.lugar}: tiene vales posteriores al conteo; no se puede dar de baja.` });
    sinKardex.push(d);
  }

  // Avisos: conteos posteriores al de la auditoría (se reemplazarían).
  const conteos = new Map(estado.conteos.map((c) => [c.id, c]));
  const posteriores = [...usadas].filter((id) => {
    const c = conteos.get(indices.existencia(id)?.conteo_id);
    return c && c.fecha > analisis.fecha;
  }).length;
  if (posteriores) avisos.push(`${posteriores} partidas tienen un conteo posterior al ${fmtFecha(analisis.fecha)}: tomarán el de la auditoría.`);

  const todas = [...grupos.flatMap((g) => g.partidas), ...nuevas.filter((n) => !n.omitida)];
  const resumen = {
    lineas: analisis.contadas.length,
    cuadran: grupos.filter((g) => !g.cambia).length,
    cambian: grupos.filter((g) => g.cambia).length,
    nuevas: todas.filter((p) => p.nueva && !p.omitida).length,
    bajas: todas.filter((p) => p.baja).length + sinKardex.filter((s) => s.decision === "baja").length,
    fx: todas.filter((p) => p.dueno === DUENO_FX && !p.baja).length,
    porConfirmar: porConfirmar.length,
    porDecidir: porConfirmar.filter((x) => x.decision === null).length,
    soloConsumible: soloConsumible.length,
    sinKardex: sinKardex.length,
    ignoradas: ignoradas.length + analisis.sinConteo.length,
    noEncontradas: noEncontradas.length,
  };
  return { grupos, nuevas, porConfirmar, soloConsumible, sinKardex, ignoradas, noEncontradas, errores, avisos, resumen, corte };
}

/** La partida que se queda con el conteo: la del contenedor que anotó el conteo, del mismo dueño y la más parecida. */
function elegir(candidatas, l) {
  const n = contenedorDe(l.contenedor);
  const conteo = conteoDe(l);
  const puntos = (p) => [p.ubicacion.contenedor === n ? 0 : 1, p.dueno_antes === l.dueno ? 0 : 1, p.actual.minus(conteo).abs()];
  return [...candidatas].sort((a, b) => {
    const [a1, a2, a3] = puntos(a);
    const [b1, b2, b3] = puntos(b);
    return a1 - b1 || a2 - b2 || a3.cmp(b3) || a.ubicacion.orden - b.ubicacion.orden || a.existencia.orden - b.existencia.orden;
  })[0];
}

/** El conteo dice que está en otro contenedor (inventariable): se ofrece moverla. */
function ofrecerMover(p, l, invDeContenedor) {
  const destino = invDeContenedor(contenedorDe(l.contenedor));
  if (destino && destino.id !== p.ubicacion.id) Object.assign(p, { mover_a: destino.id, mover_lugar: lugarCorto(destino) });
}

/**
 * Reparte el conteo de las líneas de un grupo entre sus partidas inventariables.
 *  - Con líneas de los dos dueños (la hoja de GSM y la de FX traen el mismo artículo), primero se decide
 *    qué partidas son de cada uno: las que ya estaban marcadas se quedan con su dueño; si ninguna lo
 *    estaba, la combinación cuyas cantidades se acercan más a lo que contó cada hoja. Al dueño que se
 *    queda sin partida se le da una nueva en el mismo contenedor.
 *  - Luego, en cada dueño (distribuir): una partida toma el conteo; varias que ya suman el conteo se
 *    quedan (está repartido en dos lugares); varias de la misma variante que no lo suman son repetidas:
 *    el conteo va a una y las demás, en 0 y de baja; varias variantes (AX sin dimensión): se conserva el
 *    reparto y la diferencia va a la de más existencia.
 */
function repartir(g, partidas, ctx) {
  const lineas = g.lineas.map((r) => r.linea);
  const idsDe = new Map(g.lineas.map((r) => [r.linea.id, r.ids]));
  const duenos = [...new Set(lineas.map((l) => l.dueno))].sort((a, b) => Number(Boolean(a)) - Number(Boolean(b)));
  const objetivo = (d) => sumar(lineas.filter((l) => l.dueno === d).map(conteoDe));
  let porDueno;
  let revisar = false;
  if (duenos.length === 1) porDueno = new Map([[duenos[0], partidas]]);
  else if (partidas.some((p) => p.dueno_antes)) porDueno = new Map(duenos.map((d) => [d, partidas.filter((p) => p.dueno_antes === d)]));
  else {
    const r = repartirEntreDuenos(partidas, duenos, objetivo, lineas, idsDe);
    porDueno = r.porDueno;
    revisar = !r.exacto;
  }
  const salida = [];
  for (const d of duenos) {
    const r = distribuir(porDueno.get(d) ?? [], lineas.filter((l) => l.dueno === d), objetivo(d), d, { ...ctx, idsDe, ubicacionDelGrupo: partidas[0]?.ubicacion ?? null });
    salida.push(...r.partidas);
    revisar ||= r.revisar;
  }
  // Las partidas que no tomó ningún dueño (no debería haber) se quedan como estaban.
  for (const p of partidas) if (!salida.includes(p)) salida.push(p);
  return { partidas: salida, revisar };
}

/**
 * Qué partidas son de cada dueño cuando ninguna estaba marcada: se prueban las combinaciones (hasta 12
 * partidas) y gana la que deja a cada dueño lo más cerca de lo que contó su hoja; en empate, la que cuadra
 * exacto en más dueños, la que respeta la variante que emparejó cada hoja, el contenedor que anotó el
 * conteo y la que pasa menos partidas a FX.
 */
function repartirEntreDuenos(partidas, duenos, objetivo, lineas, idsDe) {
  const [propio, otro] = duenos;
  const n = Math.min(partidas.length, 12);
  const meta = { [propio]: objetivo(propio), [otro]: objetivo(otro) };
  const delDueno = (d) => lineas.filter((l) => l.dueno === d);
  const afin = (p, d) => delDueno(d).some((l) => (idsDe.get(l.id) ?? []).includes(p.existencia.variante_id));
  const enSuContenedor = (p, d) => delDueno(d).some((l) => contenedorDe(l.contenedor) === p.ubicacion.contenedor);
  const positivo = (p) => (p.actual.lt(0) ? CERO : p.actual);
  let mejor = null;
  for (let mascara = 0; mascara < 1 << n; mascara++) {
    const de = (i) => (i < n && mascara & (1 << i) ? otro : propio);
    const sumas = { [propio]: CERO, [otro]: CERO };
    let afinidad = 0;
    let contenedor = 0;
    let aOtro = 0;
    partidas.forEach((p, i) => {
      const d = de(i);
      sumas[d] = sumas[d].plus(positivo(p));
      if (afin(p, d)) afinidad += 1;
      if (enSuContenedor(p, d)) contenedor += 1;
      if (d === otro) aOtro += 1;
    });
    const costo = sumas[propio].minus(meta[propio]).abs().plus(sumas[otro].minus(meta[otro]).abs());
    const exactos = Number(sumas[propio].eq(meta[propio])) + Number(sumas[otro].eq(meta[otro]));
    const clave = [costo, -exactos, -afinidad, -contenedor, aOtro];
    const menor = (a, b) => {
      const c = a[0].cmp(b[0]);
      if (c) return c < 0;
      for (let k = 1; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
      return false;
    };
    if (!mejor || menor(clave, mejor.clave)) mejor = { clave, mascara, exacto: costo.eq(0) };
  }
  const porDueno = new Map([
    [propio, []],
    [otro, []],
  ]);
  partidas.forEach((p, i) => porDueno.get(i < n && mejor.mascara & (1 << i) ? otro : propio).push(p));
  return { porDueno, exacto: mejor.exacto };
}

/** El conteo de un dueño entre sus partidas (ver repartir). */
function distribuir(partidas, lineas, conteo, dueno, { invDeContenedor, nuevaDe, idsDe, ubicacionDelGrupo }) {
  let revisar = false;
  const l = lineas[0];
  for (const p of partidas) Object.assign(p, { dueno, lineas: lineas.map((x) => x.id) });
  if (!partidas.length) {
    // Este dueño no tenía partida (el físico tenía GSM y FX juntos, o no lo tenía): una nueva al lado.
    if (conteo.lte(0)) return { partidas: [], revisar };
    const ubicacion = invDeContenedor(contenedorDe(l.contenedor)) ?? ubicacionDelGrupo;
    const nueva = nuevaDe(l, (idsDe.get(l.id) ?? [])[0] ?? null, ubicacion, !ubicacion);
    nueva.cantidad = conteo;
    nueva.lineas = lineas.map((x) => x.id);
    return { partidas: [nueva], revisar: true };
  }
  const suma = sumar(partidas.map((p) => p.cantidad));
  if (partidas.length === 1) {
    partidas[0].cantidad = conteo;
    if (lineas.length === 1) ofrecerMover(partidas[0], l, invDeContenedor);
  } else if (suma.eq(conteo)) {
    // Ya está repartido así (p. ej. en dos contenedores).
  } else if (new Set(partidas.map((p) => p.existencia.variante_id)).size === 1) {
    const principal = elegir(partidas, l);
    principal.cantidad = conteo;
    for (const p of partidas) {
      if (p === principal) continue;
      p.cantidad = CERO;
      p.baja = p.puede_baja;
    }
    revisar = true;
  } else {
    let dif = conteo.minus(suma);
    const orden = [...partidas].sort((a, b) => b.cantidad.cmp(a.cantidad));
    if (dif.gt(0)) orden[0].cantidad = orden[0].cantidad.plus(dif);
    else {
      for (const p of orden) {
        if (dif.eq(0)) break;
        const quita = p.cantidad.lt(dif.abs()) ? p.cantidad : dif.abs();
        p.cantidad = p.cantidad.minus(quita);
        dif = dif.plus(quita);
      }
    }
    revisar = true;
  }
  return { partidas, revisar };
}

/**
 * UM para una variante nueva: la que ya usa el código en el inventario si es la misma; si no, como se
 * escribe esa unidad en el inventario ("m" de AX → "MTS"); si no la usa nadie, la de AX.
 */
function umPara(estado, codigo, umAx) {
  const comparable = umComparable(umAx);
  const igual = estado.variantes.find((v) => v.codigo === codigo && v.activo !== false && umComparable(v.um) === comparable);
  if (igual) return igual.um;
  const usos = new Map();
  for (const v of estado.variantes) if (v.activo !== false && v.um && umComparable(v.um) === comparable) usos.set(v.um, (usos.get(v.um) ?? 0) + 1);
  return [...usos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? unidad(umAx);
}

/**
 * Aplica el conteo de auditoría (en un solo cambio). Vuelve a armar el plan sobre el estado actual con
 * las mismas decisiones; si tiene errores no cambia nada.
 * @param registrarCorte  guardar también el Disponible de la hoja propia como corte de AX de ese día
 *   (para justificar los faltantes en Conciliación AX)
 * @returns {{ conteo, resumen, corteAx }}
 */
export function aplicarBaseOficial(estado, { hojas, fecha, folioSalida = null, decisiones = {}, archivo = null, huella = null, registrarCorte = false }, usuario = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fecha))) throw new ErrorBaseOficial("Falta la fecha del conteo.");
  const analisis = analizarKardex(estado, hojas, { fecha, folioSalida });
  if (!analisis.contadas.length) throw new ErrorBaseOficial("El Kardex no trae partidas con conteo para este inventario.");
  const plan = planBaseOficial(estado, analisis, decisiones);
  if (plan.errores.length) throw new ErrorBaseOficial("La vista previa tiene pendientes.", plan.errores);
  const motivo = `Conteo de auditoría del ${fmtFecha(fecha)}`;

  // 1. Lo que se escribe distinto: la variante toma la escritura de AX.
  for (const pc of plan.porConfirmar) {
    if (pc.decision === "nueva") continue;
    const v = new Indices(estado).variante(pc.decision);
    if (!v || v.activo === false) continue;
    try {
      corregirDimensionNp(estado, { varianteId: v.id }, valoresAx(pc.linea, v), { usuario, motivo });
    } catch (error) {
      if (!(error instanceof ErrorCorreccion)) throw error; // "ya están así"
    }
  }

  // 2. El conteo: cada partida contada apunta a él.
  const indices = new Indices(estado);
  const conteo = indices.agregarConteo({
    tipo: "AUDITORIA",
    fecha,
    descripcion: `Conteo de auditoría (base oficial)${archivo ? ` · ${archivo}` : ""}`,
    alcance: "PARCIAL",
    ubicaciones: [],
    usuario,
    ultimo_folio_salida: plan.corte.salida,
    ultimo_folio_entrada: plan.corte.entrada,
    aplicado_en: ahoraIso(),
    archivo,
    huella,
    hojas: hojas.filter((h) => h.uso).map((h) => ({ hoja: h.hoja, dueno: h.uso === DUENO_FX ? DUENO_FX : null })),
    observaciones: null,
    lineas: [],
    nuevos: [],
    bajas: [],
    movidas: [],
  });
  const tocadas = new Set();
  const ponerDueno = (e, dueno) => {
    if (dueno) e.dueno = dueno;
    else delete e.dueno;
  };
  const contar = (e, cantidad, teorico, extra = {}) => {
    conteo.lineas.push({
      existencia_id: e.id,
      contado: decTexto(cantidad),
      teorico: decTexto(teorico),
      cantidad_anterior: e.cantidad_conteo,
      conteo_anterior_id: e.conteo_id ?? null,
      dueno_anterior: duenoDe(e),
      ...extra,
    });
    e.cantidad_conteo = decTexto(cantidad);
    e.conteo_id = conteo.id;
    tocadas.add(e.ubicacion_id);
  };
  const baja = (e, porque) => {
    // Como al quitar una partida en un conteo: la línea guarda si estaba activa (el reporte de un día anterior la repone).
    const linea = conteo.lineas.findLast((l) => l.existencia_id === e.id);
    if (linea) linea.activo_anterior = e.activo ?? null;
    e.activo = false;
    e.baja = { fecha, motivo: porque, conteo_id: conteo.id, usuario, en: ahoraIso() };
    conteo.bajas.push(e.id);
  };
  const crear = (pt) => {
    const l = pt.linea;
    indices.obtenerOCrearArticulo(l.codigo, mayusculas(l.nombre) ?? "", "AUDITORIA");
    const variante = pt.variante_id
      ? indices.variante(varianteVigente(indices, pt.variante_id))
      : indices.obtenerOCrearVariante(l.codigo, texto(dimensionAx(l)) || null, null, umPara(estado, l.codigo, l.um));
    const renglon = crearRenglon(estado, indices, { varianteId: variante.id, ubicacionId: pt.ubicacion_id, cantidad: decTexto(pt.cantidad), conteoId: conteo.id, origen: `AUDITORÍA ${fmtFecha(fecha)}` });
    ponerDueno(renglon, pt.dueno);
    conteo.nuevos.push(renglon.id);
    conteo.lineas.push({ existencia_id: renglon.id, contado: decTexto(pt.cantidad), teorico: "0", cantidad_anterior: null, conteo_anterior_id: null, dueno_anterior: null, kardex: [l.id] });
    tocadas.add(renglon.ubicacion_id);
  };

  for (const g of plan.grupos) {
    for (const pt of g.partidas) {
      if (pt.nueva) {
        if (!pt.omitida) crear(pt);
        continue;
      }
      const e = indices.existencia(pt.existencia_id);
      contar(e, pt.cantidad, pt.actual, { kardex: pt.lineas });
      ponerDueno(e, pt.dueno);
      if (pt.mover) {
        conteo.movidas.push({ existencia_id: e.id, de: e.ubicacion_id, a: pt.mover_a, orden_anterior: e.orden });
        e.ubicacion_id = pt.mover_a;
        e.orden = ordenSiguiente(estado, pt.mover_a);
        tocadas.add(pt.mover_a);
      }
      if (pt.baja) {
        const queda = g.partidas.find((p) => p !== pt && !p.baja && !p.omitida);
        baja(e, queda ? `Repetida: el conteo de auditoría quedó en ${queda.lugar}` : motivo);
      }
    }
  }
  for (const pt of plan.nuevas) if (!pt.omitida) crear(pt);
  for (const s of plan.sinKardex) {
    if (s.decision !== "baja") continue;
    const e = indices.existencia(s.existencia.id);
    contar(e, CERO, s.actual);
    baja(e, `No existe (${motivo.toLowerCase()})`);
  }
  conteo.ubicaciones = ubicacionesOrdenadas(estado)
    .map((u) => u.id)
    .filter((id) => tocadas.has(id));

  // 3. Opcional: el Disponible de AX de la hoja propia como corte de ese día (Conciliación AX).
  let corteAx = null;
  const propia = hojas.find((h) => h.uso === "propio");
  if (registrarCorte && propia) {
    corteAx = registrarCorteAx(estado, { fecha, almacen: propia.tabla.almacenes?.[0]?.nombre ?? "", archivo, huella, renglones: propia.tabla.renglones }, usuario);
    corteAx.hoja = propia.hoja;
    corteAx.base_oficial = conteo.id;
  }

  const resumen = { ...plan.resumen, partidas: conteo.lineas.length, diferencias: conteo.lineas.filter((l) => !dec(l.contado).eq(dec(l.teorico))).length };
  auditar(estado, { usuario, entidad: "conteo", entidadId: conteo.id, accion: "BASE_OFICIAL", despues: { archivo, fecha, corte: plan.corte, ...resumen, corte_ax: corteAx?.id ?? null } });
  return { conteo, resumen, corteAx };
}
