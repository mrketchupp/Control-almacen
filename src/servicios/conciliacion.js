// Conciliación contra AX (Fase 4, RF-50 a RF-55). Funciona como una conciliación bancaria: AX es el
// estado de cuenta, el inventario físico es la chequera y los vales posteriores al corte son los
// "cheques en tránsito". Ver docs/05-flujos.md §5.
//
// 1. Se importa un corte (reporte de AX filtrado al almacén) y se guarda con su fecha.
// 2. Cada renglón de AX (código + tamaño + color) se empareja con una variante del inventario:
//    nivel 1, equivalencias ya confirmadas (memoria); nivel 2, exacto tras normalizar (incluye el
//    Tamaño que AX corta a 10 caracteres y el NP en Color); nivel 3, aproximado con puntaje (se
//    sugiere y el usuario confirma). Lo confirmado se recuerda para los siguientes cortes.
// 3. Por variante: físico (TOTAL de todos sus renglones) − AX + salidas en tránsito − entradas en
//    tránsito. Si da 0, la diferencia la explican los vales; si no, es sobrante o faltante.
// Nada de esto cambia el inventario: solo compara y, al final, se exporta la solicitud de ajuste.

import { CERO, dec, decTexto, sumar } from "../nucleo/decimal.js";
import { ratio } from "../nucleo/difflib.js";
import { Indices, auditar, dimensionMostrada, npMostrado, siguienteId, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos, cuentaParaSaldo } from "../nucleo/existencias.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { claveEstricta, claveLaxa, compactar, unidad } from "../nucleo/normalizar.js";
import { folioEntrada } from "./entradas.js";
import { lugarCorto } from "./inventario.js";
import { candidatosExactos, indiceExistencias } from "./primeraCarga.js";

export class ErrorConciliacion extends Error {}

const hay = (v) => v !== null && v !== undefined;
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** Llave de un renglón de AX para la memoria de equivalencias. */
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
  if (!renglones?.length) throw new ErrorConciliacion(`El reporte no trae renglones del almacén ${almacen}.`);
  const folio = hay(folioSalida) && texto(folioSalida) !== "" ? Number(folioSalida) : null;
  if (folio !== null && (!Number.isInteger(folio) || folio < 0)) throw new ErrorConciliacion("El folio de corte debe ser un número entero.");
  estado.cortes_ax ??= [];
  const corte = {
    id: siguienteId(estado, "corte_ax"),
    fecha,
    almacen,
    archivo,
    huella,
    folio_salida: folio,
    importado_en: ahoraIso(),
    importado_por: usuario,
    lineas: renglones.map((r, i) => ({ id: i + 1, ...r })),
  };
  estado.cortes_ax.push(corte);
  auditar(estado, { usuario, entidad: "corte_ax", entidadId: corte.id, accion: "IMPORTAR", despues: { fecha, almacen, archivo, renglones: corte.lineas.length } });
  return corte;
}

export function corteAx(estado, id) {
  return (estado.cortes_ax ?? []).find((c) => c.id === id) ?? null;
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
  if (vale.estado !== "EMITIDO" || !vale.fecha) return false;
  if (vale.tipo === "SALIDA") return hay(corte.folio_salida) ? vale.folio > corte.folio_salida : vale.fecha > corte.fecha;
  if (vale.tipo === "ENTRADA") return vale.fecha > corte.fecha;
  return false;
}

const folioDeVale = (v) => (v.tipo === "ENTRADA" ? `${folioEntrada(v.folio)} (E)` : `${v.folio} (S)`);

/**
 * Vales en tránsito (RF-53) por variante y por código: cuánto salió y entró después del corte y
 * con qué folios.
 *
 * Una partida sin renglón del inventario (vales migrados o por ubicar) se busca por código y clave:
 *  - si el vale es anterior al conteo de ese renglón, la cantidad contada ya la refleja, así que
 *    cuenta como tránsito (caso típico del primer corte: AX al 27, conteo el 28 y vales en medio);
 *  - si es posterior (está en Pendientes, por ubicar), aún no mueve la existencia: no cuenta y se
 *    muestra como pista.
 */
export function transitoDesde(estado, corte, { indices = new Indices(estado) } = {}) {
  const porVariante = new Map();
  const porCodigo = new Map();
  const porUbicar = new Map();
  const sumarA = (mapa, clave, vale, cantidad) => {
    let t = mapa.get(clave);
    if (!t) {
      t = { salidas: CERO, entradas: CERO, folios: [] };
      mapa.set(clave, t);
    }
    if (vale.tipo === "SALIDA") t.salidas = t.salidas.plus(cantidad);
    else t.entradas = t.entradas.plus(cantidad);
    const folio = folioDeVale(vale);
    if (!t.folios.includes(folio)) t.folios.push(folio);
  };
  let indice = null;
  const vales = estado.vales.filter((v) => enTransito(corte, v)).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.folio - b.folio));
  for (const vale of vales) {
    for (const l of vale.lineas) {
      if (l.no_inventariado || !Number.isInteger(l.codigo)) continue;
      const cantidad = dec(l.cantidad);
      if (!cantidad || cantidad.eq(0)) continue;
      let existencia = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
      if (!existencia) {
        indice ??= indiceExistencias(estado, indices);
        const candidatos = candidatosExactos(indice, indices, l.codigo, l.clave).filter((e) => e.activo !== false);
        const variantes = new Set(candidatos.map((e) => e.variante_id));
        const yaContado = (e) => !cuentaParaSaldo(e.conteo_id !== null && e.conteo_id !== undefined ? indices.conteos.get(e.conteo_id) : null, vale);
        if (variantes.size === 1 && candidatos.every(yaContado)) existencia = candidatos[0];
        else {
          sumarA(porUbicar, l.codigo, vale, cantidad);
          continue;
        }
      }
      sumarA(porVariante, existencia.variante_id, vale, cantidad);
      sumarA(porCodigo, l.codigo, vale, cantidad);
    }
  }
  return { porVariante, porCodigo, porUbicar };
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

/** Nivel 2: iguales tras normalizar (Tamaño = dimensión y Color vacío o = NP; o juntos; o Tamaño cortado a 10). */
function esExacto(ax, f) {
  const colorOk = !ax.c || ax.c === f.n;
  if (ax.t === f.d && colorOk) return true;
  if (ax.c && (ax.tc === f.d || ax.tc === f.dn)) return true;
  // AX corta el Tamaño a 10 caracteres: la dimensión física debe empezar igual.
  if (ax.crudo.length === 10 && f.crudo.length > 10 && f.crudo.startsWith(ax.crudo) && colorOk) return true;
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

/**
 * Empareja cada renglón del corte con una variante del inventario.
 * @returns [{ linea, variante_id, metodo, puntaje, confirmado, candidatos: [{ variante_id, puntaje }] }]
 *   metodo: 'equivalencia' | 'exacto' (confirmados), 'aproximado' | 'unico' | 'sin_sugerencia'
 *   (por confirmar), 'sin_pareja' (confirmado que no está en físico) o 'sin_fisico' (el código no
 *   tiene ningún renglón en el inventario).
 */
export function emparejar(estado, corte, { indices = new Indices(estado), fisico = null } = {}) {
  const porVariante = fisico ?? fisicoPorVariante(estado, { indices });
  const porCodigo = new Map();
  for (const r of porVariante.values()) {
    if (!porCodigo.has(r.variante.codigo)) porCodigo.set(r.variante.codigo, []);
    porCodigo.get(r.variante.codigo).push(r);
  }
  const equivalencias = estado.equivalencias_ax ?? {};
  const pares = corte.lineas.map((linea) => ({ linea, variante_id: null, metodo: null, puntaje: null, confirmado: false, candidatos: [] }));
  const tomadas = new Set();
  // Nivel 1: lo que el usuario ya confirmó (en este corte o en uno anterior).
  for (const p of pares) {
    const eq = equivalencias[claveAx(p.linea)];
    if (!eq) continue;
    if (eq.variante_id === null) Object.assign(p, { metodo: "sin_pareja", confirmado: true });
    else if (indices.variante(eq.variante_id)) {
      Object.assign(p, { variante_id: eq.variante_id, metodo: "equivalencia", puntaje: 1, confirmado: true });
      tomadas.add(eq.variante_id);
    }
  }
  // Nivel 2: exacto tras normalizar.
  for (const p of pares.filter((x) => !x.metodo)) {
    const ax = formasAx(p.linea);
    const exactos = (porCodigo.get(p.linea.codigo) ?? []).filter((r) => esExacto(ax, formasFisico(r.variante)));
    if (!exactos.length) continue;
    const orden = (r) => (formasFisico(r.variante).um === ax.um ? 0 : 1) + (tomadas.has(r.variante.id) ? 2 : 0);
    const elegido = [...exactos].sort((a, b) => orden(a) - orden(b))[0];
    Object.assign(p, { variante_id: elegido.variante.id, metodo: "exacto", puntaje: 1, confirmado: true });
    tomadas.add(elegido.variante.id);
  }
  // Nivel 3: aproximado (sugerencia que el usuario confirma).
  const pendientes = pares.filter((x) => !x.metodo);
  for (const p of pendientes) {
    const delCodigo = porCodigo.get(p.linea.codigo) ?? [];
    if (!delCodigo.length) {
      p.metodo = "sin_fisico";
      p.confirmado = true;
      continue;
    }
    const ax = formasAx(p.linea);
    const libres = delCodigo.filter((r) => !tomadas.has(r.variante.id));
    p.candidatos = delCodigo
      .map((r) => ({ variante_id: r.variante.id, puntaje: Math.round(parecido(ax, formasFisico(r.variante)) * (tomadas.has(r.variante.id) ? 0.8 : 1) * 100) / 100 }))
      .sort((a, b) => b.puntaje - a.puntaje);
    const unico = libres.length === 1 && pendientes.filter((q) => q.linea.codigo === p.linea.codigo).length === 1;
    const mejor = unico ? p.candidatos.find((c) => c.variante_id === libres[0].variante.id) : p.candidatos[0];
    if (mejor && (unico || mejor.puntaje >= PUNTAJE_SUGERENCIA)) Object.assign(p, { variante_id: mejor.variante_id, metodo: unico ? "unico" : "aproximado", puntaje: mejor.puntaje });
    else p.metodo = "sin_sugerencia";
  }
  return pares;
}

/** Recuerda la pareja de un renglón de AX (variante o null = "no está en físico"). */
export function confirmarPareja(estado, linea, varianteId, usuario = null) {
  estado.equivalencias_ax ??= {};
  const clave = claveAx(linea);
  const antes = estado.equivalencias_ax[clave] ?? null;
  estado.equivalencias_ax[clave] = {
    variante_id: varianteId ?? null,
    codigo: linea.codigo,
    tamano: linea.tamano,
    color: linea.color,
    confirmado_por: usuario,
    fecha: ahoraIso(),
  };
  auditar(estado, { usuario, entidad: "equivalencia_ax", entidadId: null, accion: antes ? "CAMBIAR" : "CONFIRMAR", antes, despues: { clave, variante_id: varianteId ?? null } });
}

/** Olvida lo confirmado para ese renglón (vuelve a emparejarse solo). */
export function olvidarPareja(estado, linea, usuario = null) {
  const clave = claveAx(linea);
  const antes = estado.equivalencias_ax?.[clave];
  if (!antes) return;
  delete estado.equivalencias_ax[clave];
  auditar(estado, { usuario, entidad: "equivalencia_ax", entidadId: null, accion: "OLVIDAR", antes });
}

// ---------------------------------------------------------------- comparación

const ESTADOS = { cuadra: "Cuadra", explicada: "Explicada por vales", sobrante: "Sobrante", faltante: "Faltante" };
export const etiquetaEstado = (e) => ESTADOS[e] ?? e;

function comparar({ ax, valorAx, fisico, transito }) {
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
    diferencia,
    sin_explicar: sinExplicar,
    estado,
    costo,
    valor: costo ? sinExplicar.times(costo) : null,
  };
}

const descripcionDe = (estado, codigo, porDefecto = "") => estado.articulos?.[codigo]?.descripcion ?? porDefecto;

/**
 * Concilia un corte contra el inventario de hoy (RF-52 a RF-55).
 * @returns {{ corte, pares, renglones, porCodigo, porContenedor, axSinFisico, fisicoSinAx, porConfirmar, resumen }}
 */
export function conciliar(estado, corte) {
  const indices = new Indices(estado);
  const fisico = fisicoPorVariante(estado, { indices });
  const pares = emparejar(estado, corte, { indices, fisico });
  const transito = transitoDesde(estado, corte, { indices });

  // Por variante (renglón de AX ↔ variante del inventario).
  const grupos = new Map();
  for (const p of pares) {
    if (!p.confirmado || p.variante_id === null) continue;
    if (!grupos.has(p.variante_id)) grupos.set(p.variante_id, []);
    grupos.get(p.variante_id).push(p);
  }
  const renglones = [...grupos].map(([varianteId, ps]) => {
    const f = fisico.get(varianteId);
    const variante = f?.variante ?? indices.variante(varianteId);
    const lineas = ps.map((p) => p.linea);
    return {
      variante_id: varianteId,
      codigo: variante.codigo,
      descripcion: descripcionDe(estado, variante.codigo, lineas[0].nombre),
      variante,
      lineas,
      metodos: [...new Set(ps.map((p) => p.metodo))],
      lugares: (f?.renglones ?? []).map((r) => ({ lugar: lugarCorto(r.ubicacion), hoja: r.ubicacion.hoja_excel.trim(), total: r.total })),
      ...comparar({
        ax: sumar(...lineas.map((l) => dec(l.disponible) ?? CERO)),
        valorAx: sumar(...lineas.map((l) => dec(l.valor_financiero) ?? CERO)),
        fisico: f?.total ?? CERO,
        transito: transito.porVariante.get(varianteId),
      }),
    };
  });
  const enAx = new Set(grupos.keys());
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
      ...comparar({ ax: dec(p.linea.disponible) ?? CERO, valorAx: dec(p.linea.valor_financiero), fisico: CERO, transito: null }),
    }));

  const porConfirmar = pares.filter((p) => !p.confirmado);

  // Por artículo (código): no depende del emparejamiento.
  const codigos = new Set([...corte.lineas.map((l) => l.codigo), ...[...fisico.values()].filter((r) => !r.total.eq(0)).map((r) => r.variante.codigo)]);
  const porCodigo = [...codigos]
    .map((codigo) => {
      const lineas = corte.lineas.filter((l) => l.codigo === codigo);
      const variantes = [...fisico.values()].filter((r) => r.variante.codigo === codigo);
      const pista = transito.porUbicar.get(codigo);
      return {
        codigo,
        descripcion: descripcionDe(estado, codigo, lineas[0]?.nombre ?? ""),
        renglones_ax: lineas.length,
        variantes: variantes.length,
        por_ubicar: pista ? pista.folios : [],
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
  const resultadoDe = new Map([...renglones, ...fisicoSinAx].map((r) => [r.variante_id, r]));
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
  return { corte, pares, renglones, porCodigo, porContenedor, axSinFisico, fisicoSinAx, porConfirmar, transito, fisico, resumen };
}

/** Texto de los folios en tránsito para la solicitud de ajuste: "9 (S), E-0003 (E)". */
export const foliosTexto = (folios) => folios.join(", ");

export const cantidadTexto = (d) => (d === null || d === undefined ? "" : decTexto(d));
