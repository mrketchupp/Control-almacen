// Base oficial: el conteo de la auditoría REEMPLAZA lo inventariable del inventario (Ronda 24).
//
// El Kardex de auditoría es el reporte de AX de cada inventario (una hoja por inventario) con dos
// columnas que llenó el conteo oficial: Conteo (o Conteo Fisico) y Contenedor. El usuario dice qué hoja es
// de qué inventario (la herramienta no lo adivina). Al aplicarlo, sin preguntar partida por partida:
//  - solo cambia lo INVENTARIABLE; lo consumible no se toca (decisión del usuario). En GSM y FX los códigos
//    de 3 dígitos siempre son consumibles (`soloConsumible`): esas partidas del Kardex no se aplican;
//  - la partida que es IDÉNTICA a una del Kardex (mismo código y dimensión, una con una) se conserva con su
//    NP, nota, lugar e id, y toma el conteo;
//  - todo lo demás del Kardex es una partida nueva con la escritura de AX, en la hoja inventariable del
//    contenedor que anotó el conteo. Una partida de AX sin dimensión que en el físico eran varias (p. ej.
//    botoneras que se distinguían por NP) queda como UNA partida con el total: el Kardex las cuenta juntas;
//  - las partidas inventariables que no quedaron (sustituidas por el Kardex o que el Kardex no trae) se dan
//    de BAJA: no se borran (sus vales y el historial las siguen viendo) y dejan de salir en el Excel. Quedan
//    en dos listas para revisarlas a mano o en físico (impresas): los NP que se perdieron y las partidas que
//    salieron;
//  - los vales emitidos después del conteo sobre una partida sustituida pasan a la que la reemplaza (no
//    cambia nada del vale, solo de qué partida descuenta);
//  - en GSM, lo que cuenta la hoja de FX queda marcado como de FX (`existencia.dueno`).
// Cada partida contada apunta a un conteo nuevo (tipo AUDITORIA) con el corte por folio del día del conteo:
// los vales posteriores se descuentan solos. Aplicar dos veces el mismo Kardex no cambia nada.
//
// Ver docs/05-flujos.md §4.3.

import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../nucleo/fechas.js";
import { DUENO_FX, duenoDe, inventarioDe, soloConsumible } from "../nucleo/inventarios.js";
import { mayusculas, sinDimension, unidad } from "../nucleo/normalizar.js";
import { corteConHuella, dimensionAx, emparejar, fisicoPorVariante, registrarCorteAx, umComparable } from "./conciliacion.js";
import { crearRenglon, lugarCorto, ubicacionesOrdenadas } from "./inventario.js";

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
 * Lee las hojas que el usuario relacionó con este inventario y busca, para cada partida del Kardex, la
 * variante idéntica del inventario (como la conciliación: código + Tamaño + Color = la dimensión).
 * @param hojas  [{ hoja, uso: "propio" | "FX", tabla }] (la tabla de `leerReporteAx(...).tablas`)
 * @returns {{ fecha, corte, indices, saldos, lineas, contadas, pares, sinConteo, porRegla }}
 *   cada línea: el renglón de AX con id = "hoja#fila", hoja, dueno (null o "FX") y modelo_ax (el original);
 *   porRegla: las de código de 3 dígitos en GSM / FX (consumibles: no se aplican)
 */
export function analizarKardex(estado, hojas, { fecha, folioSalida = null } = {}) {
  const indices = new Indices(estado);
  const corte = corteAlDia(estado, fecha, folioSalida);
  const saldos = saldosAlCorte(estado, corte);
  const fisico = fisicoPorVariante(estado, { indices, saldos });
  const inv = inventarioDe(estado).id;
  const lineas = [];
  for (const h of hojas) {
    if (!h.uso) continue;
    const dueno = h.uso === DUENO_FX ? DUENO_FX : null;
    for (const r of h.tabla.renglones) lineas.push({ ...r, id: `${h.hoja}#${r.fila}`, hoja: h.hoja, dueno, modelo_ax: r.modelo, modelo: "INV" });
  }
  const conConteo = lineas.filter((l) => dec(l.conteo) !== null);
  const porRegla = conConteo.filter((l) => soloConsumible(inv, l.codigo));
  const contadas = conConteo.filter((l) => !soloConsumible(inv, l.codigo));
  // Cada hoja se empareja por su lado (como un reporte de AX): la de GSM y la de FX pueden traer el mismo
  // artículo y las dos deben encontrar su partida. Solo cuentan las parejas exactas (sin parecidos).
  const pares = [...new Set(contadas.map((l) => l.hoja))].flatMap((hoja) =>
    emparejar(estado, { lineas: contadas.filter((l) => l.hoja === hoja), sin_pareja: [] }, { indices, fisico }),
  );
  return { fecha, corte, indices, saldos, lineas, contadas, pares, sinConteo: lineas.filter((l) => dec(l.conteo) === null), porRegla };
}

/**
 * La vista previa del reemplazo.
 * @param decisiones { ubicaciones: { [clave]: ubicacionId } }  dónde va una partida nueva cuyo contenedor
 *   no existe (el conteo anotó 0, 6, nada…); es lo único que se pregunta.
 * @returns {{ conservadas, nuevas, sustituidas, retiradas, sinRetirar, soloConsumible, porRegla, ignoradas,
 *   sinAlta, porCodigo, listaNp, listaRetiradas, religar, errores, avisos, resumen, corte }}
 *   conservadas: [{ existencia, linea, actual, cantidad, dueno, dueno_antes, … }]; nuevas: [{ clave, linea,
 *   ubicacion, … }]; sustituidas / retiradas: partidas que se dan de baja (su código viene o no en el Kardex);
 *   sinRetirar: las que no se dan de baja porque tienen vales después del conteo y nada las sustituye.
 */
export function planBaseOficial(estado, analisis, decisiones = {}) {
  const D = { ubicaciones: {}, ...decisiones };
  const { indices, saldos, pares, corte } = analisis;
  const errores = [];
  const avisos = [];
  const actualDe = (e) => saldos.get(e.id)?.total ?? CERO;
  const ubicacionesInv = ubicacionesOrdenadas(estado).filter((u) => u.clase === "INV");
  const invDeContenedor = (n) => (n ? (ubicacionesInv.find((u) => u.contenedor === n) ?? null) : null);
  const esInvE = (e) => indices.ubicacion(e.ubicacion_id)?.clase === "INV";
  const activas = estado.existencias.filter((e) => e.activo !== false);
  const porVariante = new Map();
  for (const e of activas) {
    if (!porVariante.has(e.variante_id)) porVariante.set(e.variante_id, []);
    porVariante.get(e.variante_id).push(e);
  }
  // Partidas con vales (o borradores) después del conteo: si se sustituyen, sus vales pasan a la nueva.
  const posteriores = new Map();
  const anotar = (id, ref) => {
    if (!posteriores.has(id)) posteriores.set(id, []);
    posteriores.get(id).push(ref);
  };
  for (const v of estado.vales) {
    if (v.estado !== "EMITIDO" || !(v.folio > (v.tipo === "ENTRADA" ? corte.entrada : corte.salida))) continue;
    for (const l of v.lineas) if (l.existencia_id != null) anotar(l.existencia_id, { tipo: "vale", vale_id: v.id, linea_id: l.id });
  }
  for (const [coleccion, lista] of [
    ["borradores", estado.borradores ?? []],
    ["borradores_entrada", estado.borradores_entrada ?? []],
  ]) {
    for (const b of lista) for (const l of b.lineas ?? []) if (l.existencia_id != null) anotar(l.existencia_id, { tipo: coleccion, borrador_id: b.id, linea_id: l.id });
  }

  const describir = (e) => {
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    return {
      existencia: e,
      existencia_id: e.id,
      codigo: v.codigo,
      descripcion: indices.articulo(v.codigo)?.descripcion ?? "",
      dimension: dimensionMostrada(e, v) || "",
      np: npMostrado(e, v) || "",
      um: umMostrada(e, v) || "",
      ubicacion: u,
      hoja: u.hoja_excel.trim(),
      lugar: lugarCorto(u),
      actual: actualDe(e),
      dueno_antes: duenoDe(e),
    };
  };

  // La variante idéntica a una partida de AX (o null) y las que AX junta. Solo cuentan las variantes que aún
  // tienen partidas inventariables (la escritura anterior que el Kardex ya sustituyó no hace que AX "junte"
  // dos) y, si las hay, las del mismo dueño (la hoja de FX no toma las de GSM). Si AX junta varias pero una
  // se escribe exactamente como AX, esa es la idéntica (salvo sin dimensión: AX junta lo que el físico
  // separaba por NP). Así, aplicar dos veces el mismo Kardex no cambia nada.
  const conInv = (id, dueno) => (porVariante.get(id) ?? []).some((e) => esInvE(e) && (dueno === undefined || duenoDe(e) === dueno));
  const varianteIdentica = (l, ids) => {
    if (!ids) return { varianteId: null, grupo: null };
    const vivas = ids.filter((id) => conInv(id));
    const delDueno = vivas.filter((id) => conInv(id, l.dueno ?? null));
    const grupo = delDueno.length ? delDueno : vivas.length ? vivas : ids;
    if (grupo.length === 1) return { varianteId: grupo[0], grupo };
    const escritura = mayusculas(dimensionAx(l));
    const iguales = sinDimension(escritura) ? [] : grupo.filter((id) => mayusculas(indices.variante(id)?.dimension ?? "") === escritura);
    return { varianteId: iguales.length === 1 ? iguales[0] : null, grupo };
  };

  // 1. Cada partida del Kardex: ¿hay una partida idéntica que la conserve? Solo con UNA variante (una
  //    partida de AX sin dimensión que junta varias variantes del físico no conserva ninguna).
  const ignoradas = [];
  const sinAlta = [];
  const soloCons = [];
  const pendientes = []; // { linea, varianteId | null }
  for (const p of pares) {
    const l = p.linea;
    const ids = p.confirmado && p.variante_id !== null ? (p.grupo ?? [p.variante_id]) : null;
    if (ids) {
      const todas = ids.flatMap((id) => porVariante.get(id) ?? []);
      if (!todas.some(esInvE) && todas.length) {
        soloCons.push({ linea: l, partidas: todas.map(describir) }); // está en una hoja de consumible: no se toca
        continue;
      }
    }
    pendientes.push({ linea: l, ...varianteIdentica(l, ids) });
  }

  // 2. Una con una: cada partida del Kardex toma una partida idéntica (primero las del mismo dueño, luego
  //    las del contenedor que anotó el conteo y la cantidad más parecida). Lo de GSM antes que lo de FX.
  const usadas = new Set();
  const conservadas = [];
  const asignar = (r, soloMismoDueno) => {
    if (r.partida || !r.varianteId) return;
    const n = contenedorDe(r.linea.contenedor);
    const libres = (porVariante.get(r.varianteId) ?? []).filter((e) => esInvE(e) && !usadas.has(e.id) && (!soloMismoDueno || duenoDe(e) === r.linea.dueno));
    if (!libres.length) return;
    const conteo = conteoDe(r.linea);
    const orden = (e) => [indices.ubicacion(e.ubicacion_id).contenedor === n ? 0 : 1, actualDe(e).minus(conteo).abs()];
    const e = [...libres].sort((a, b) => {
      const [a1, a2] = orden(a);
      const [b1, b2] = orden(b);
      return a1 - b1 || a2.cmp(b2) || indices.ubicacion(a.ubicacion_id).orden - indices.ubicacion(b.ubicacion_id).orden || a.orden - b.orden;
    })[0];
    usadas.add(e.id);
    r.partida = e;
  };
  const enOrden = [...pendientes].sort((a, b) => Number(Boolean(a.linea.dueno)) - Number(Boolean(b.linea.dueno)));
  for (const r of enOrden) asignar(r, true);
  for (const r of enOrden) asignar(r, false);

  // 3. Lo que no se conserva: partida nueva con la escritura de AX.
  const nuevas = [];
  for (const r of pendientes) {
    const l = r.linea;
    if (r.partida) {
      conservadas.push({ ...describir(r.partida), clave: `e:${r.partida.id}`, linea: l, cantidad: conteoDe(l), dueno: l.dueno });
      continue;
    }
    if (!esInv(l)) {
      ignoradas.push({ linea: l, motivo: "no_inv" }); // otro modelo (p. ej. CONPROV) que no está en el inventario
      continue;
    }
    if (conteoDe(l).lte(0)) {
      sinAlta.push(l); // AX lo tiene, el conteo encontró 0 y no hay partida: nada que dar de alta
      continue;
    }
    const clave = `n:${l.id}`;
    const delCodigo = activas.filter((e) => esInvE(e) && indices.variante(e.variante_id)?.codigo === l.codigo);
    const anotado = invDeContenedor(contenedorDe(l.contenedor));
    const elegida = D.ubicaciones[clave] !== undefined ? indices.ubicacion(Number(D.ubicaciones[clave])) : null;
    // Si el contenedor que anotó el conteo no existe, donde estaba el código (si estaba en uno solo).
    const dondeEstaba = [...new Set(delCodigo.map((e) => e.ubicacion_id))];
    const ubicacion = elegida ?? anotado ?? (dondeEstaba.length === 1 ? indices.ubicacion(dondeEstaba[0]) : null);
    const dimension = dimensionAx(l);
    nuevas.push({
      clave,
      linea: l,
      codigo: l.codigo,
      descripcion: indices.articulo(l.codigo)?.descripcion ?? l.nombre,
      dimension,
      np: "",
      um: umPara(estado, l.codigo, l.um),
      ubicacion,
      ubicacion_id: ubicacion?.id ?? null,
      lugar: ubicacion ? lugarCorto(ubicacion) : "",
      contenedor_anotado: texto(l.contenedor),
      cantidad: conteoDe(l),
      dueno: l.dueno,
      grupo: r.grupo ?? [], // las variantes del físico que esta partida de AX junta
      junta: r.grupo && r.grupo.length > 1 ? r.grupo.length : 0, // variantes del físico que AX cuenta juntas
    });
    if (!ubicacion) errores.push({ clave, mensaje: `${l.codigo} ${dimension || "SIN DIMENSIÓN"}: el conteo anotó el contenedor "${texto(l.contenedor) || "—"}", que no existe; elige dónde va.` });
  }

  // 4. Lo inventariable que no quedó se da de baja. Solo lo de los dueños de las hojas relacionadas (si no
  //    se relacionó la hoja de FX, lo de FX no se toca). Sustituida = su código viene en el Kardex.
  const duenos = new Set(analisis.contadas.map((l) => l.dueno));
  const codigosKardex = new Set(analisis.contadas.map((l) => l.codigo));
  const resultadoPorCodigo = new Map(); // código → partidas que quedan (conservadas y nuevas)
  for (const x of [...conservadas, ...nuevas]) {
    if (!resultadoPorCodigo.has(x.codigo)) resultadoPorCodigo.set(x.codigo, []);
    resultadoPorCodigo.get(x.codigo).push(x);
  }
  const sustituidas = [];
  const retiradas = [];
  const sinRetirar = [];
  const religar = [];
  const inv = inventarioDe(estado).id;
  for (const e of activas) {
    if (!esInvE(e) || usadas.has(e.id) || !duenos.has(duenoDe(e))) continue;
    const d = { ...describir(e), clave: `e:${e.id}` };
    if (soloConsumible(inv, d.codigo)) continue; // consumible por regla aunque esté en una hoja inventariable
    // La reemplaza la que quedó de ese código (del mismo dueño, la misma variante o el mismo contenedor).
    const delCodigo = resultadoPorCodigo.get(d.codigo) ?? [];
    const quedan = delCodigo.filter((x) => x.dueno === d.dueno_antes);
    const mismaVariante = (x) => (x.existencia ? x.existencia.variante_id === e.variante_id : x.grupo.includes(e.variante_id));
    const mismoLugar = (x) => (x.ubicacion?.id ?? x.ubicacion_id) === e.ubicacion_id;
    const reemplazo =
      quedan.find(mismaVariante) ??
      quedan.find((x) => !x.existencia && mismoLugar(x)) ??
      quedan.find((x) => !x.existencia) ??
      quedan.find(mismoLugar) ??
      quedan[0] ??
      delCodigo[0] ??
      null;
    if (reemplazo) {
      sustituidas.push({ ...d, reemplazo });
      for (const ref of posteriores.get(e.id) ?? []) religar.push({ ...ref, de: e.id, a: reemplazo });
    } else if (posteriores.has(e.id)) sinRetirar.push(d);
    else if (codigosKardex.has(d.codigo)) sustituidas.push({ ...d, reemplazo: null }); // el Kardex lo trae en 0 o en consumible
    else retiradas.push(d);
  }
  if (sinRetirar.length) avisos.push(`${sinRetirar.length} partidas no se dan de baja porque tienen vales después del ${fmtFecha(analisis.fecha)} y el Kardex no trae con qué reemplazarlas.`);

  // Conteos posteriores al de la auditoría (se reemplazarían).
  const conteos = new Map(estado.conteos.map((c) => [c.id, c]));
  const conPosterior = conservadas.filter((c) => (conteos.get(c.existencia.conteo_id)?.fecha ?? "") > analisis.fecha).length;
  if (conPosterior) avisos.push(`${conPosterior} partidas tienen un conteo posterior al ${fmtFecha(analisis.fecha)}: tomarán el de la auditoría.`);

  // 5. Por código: lo que había (inventariable) y lo que queda, con su impacto en $.
  const porCodigo = new Map();
  const fila = (codigo) => {
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, { codigo, descripcion: indices.articulo(codigo)?.descripcion ?? "", antes: CERO, despues: CERO, costo: null, conservadas: 0, nuevas: 0, bajas: 0, lineas: [], detalle: [] });
    return porCodigo.get(codigo);
  };
  for (const c of conservadas) {
    const f = fila(c.codigo);
    f.antes = f.antes.plus(c.actual);
    f.despues = f.despues.plus(c.cantidad);
    f.conservadas += 1;
    f.lineas.push(c.linea);
    f.detalle.push({ accion: "conserva", lugar: c.lugar, texto: textoClave(c), antes: c.actual, despues: c.cantidad, dueno: c.dueno });
  }
  for (const n of nuevas) {
    const f = fila(n.codigo);
    f.despues = f.despues.plus(n.cantidad);
    f.nuevas += 1;
    f.lineas.push(n.linea);
    f.detalle.push({ accion: "nueva", lugar: n.lugar, texto: textoClave(n), antes: null, despues: n.cantidad, dueno: n.dueno, junta: n.junta });
  }
  for (const s of sustituidas) {
    const f = fila(s.codigo);
    f.antes = f.antes.plus(s.actual);
    f.bajas += 1;
    f.detalle.push({ accion: "baja", lugar: s.lugar, texto: textoClave(s), antes: s.actual, despues: null, dueno: s.dueno_antes });
  }
  for (const f of porCodigo.values()) {
    f.costo = f.lineas.length ? costoUnitario(f.lineas[0]) : null;
    f.diferencia = f.despues.minus(f.antes);
    f.impacto = f.costo ? f.diferencia.times(f.costo) : null;
    f.cambia = f.nuevas > 0 || f.bajas > 0 || f.detalle.some((d) => d.accion === "conserva" && !d.antes.eq(d.despues));
  }

  // 6. Las listas para revisar a mano o en físico (también se guardan en el conteo).
  const listaNp = sustituidas.filter((s) => s.np).map((s) => renglonDeLista(s, s.reemplazo));
  const listaRetiradas = retiradas.map((s) => renglonDeLista(s));

  const resumen = {
    lineas: analisis.contadas.length,
    conservadas: conservadas.length,
    conservadasCambian: conservadas.filter((c) => !c.actual.eq(c.cantidad) || c.dueno !== c.dueno_antes).length,
    nuevas: nuevas.length,
    sustituidas: sustituidas.length,
    retiradas: retiradas.length,
    retiradasConExistencia: retiradas.filter((r) => r.actual.gt(0)).length,
    npPerdidos: listaNp.length,
    sinRetirar: sinRetirar.length,
    religadas: religar.length,
    fx: [...conservadas, ...nuevas].filter((x) => x.dueno === DUENO_FX).length,
    soloConsumible: soloCons.length,
    porRegla: analisis.porRegla.length,
    ignoradas: ignoradas.length + analisis.sinConteo.length,
    sinAlta: sinAlta.length,
  };
  return {
    conservadas,
    nuevas,
    sustituidas,
    retiradas,
    sinRetirar,
    soloConsumible: soloCons,
    porRegla: analisis.porRegla,
    ignoradas,
    sinAlta,
    porCodigo: [...porCodigo.values()],
    listaNp,
    listaRetiradas,
    religar,
    errores,
    avisos,
    resumen,
    corte,
  };
}

/** "6309-2Z/C3 · NP X1" (sin dimensión → "SIN DIMENSIÓN"). */
const textoClave = (x) => `${x.dimension || "SIN DIMENSIÓN"}${x.np ? ` · NP ${x.np}` : ""}`;

/** Un renglón de las listas de revisión (texto, para imprimirlas aunque el inventario cambie después). */
function renglonDeLista(s, reemplazo = null) {
  return {
    existencia_id: s.existencia_id,
    codigo: s.codigo,
    descripcion: s.descripcion,
    dimension: s.dimension,
    np: s.np,
    um: s.um,
    hoja: s.hoja,
    lugar: s.lugar,
    cantidad: decTexto(s.actual),
    dueno: s.dueno_antes,
    reemplazo: reemplazo ? `${textoClave(reemplazo)} · ${reemplazo.lugar} · ${decTexto(reemplazo.cantidad)}` : "",
  };
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
 * Aplica el reemplazo (en un solo cambio). Vuelve a armar el plan sobre el estado actual; si tiene errores
 * no cambia nada.
 * El Disponible de AX de la hoja propia queda además como reporte de AX con la fecha del conteo (para
 * justificar faltantes en la conciliación sin volver a importar el archivo); si ese archivo ya estaba
 * importado (misma huella), no se repite.
 * @returns {{ conteo, resumen, corteAx }} corteAx = el reporte de AX registrado ahora (null si ya estaba)
 */
export function aplicarBaseOficial(estado, { hojas, fecha, folioSalida = null, decisiones = {}, archivo = null, huella = null }, usuario = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fecha))) throw new ErrorBaseOficial("Falta la fecha del conteo.");
  const analisis = analizarKardex(estado, hojas, { fecha, folioSalida });
  if (!analisis.contadas.length) throw new ErrorBaseOficial("El Kardex no trae partidas con conteo para este inventario.");
  const plan = planBaseOficial(estado, analisis, decisiones);
  if (plan.errores.length) throw new ErrorBaseOficial("La vista previa tiene pendientes.", plan.errores);
  const motivo = `Conteo de auditoría del ${fmtFecha(fecha)}`;
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
    religadas: [],
    revision: { np: plan.listaNp, retiradas: plan.listaRetiradas },
  });
  const tocadas = new Set();
  const ponerDueno = (e, dueno) => {
    if (dueno) e.dueno = dueno;
    else delete e.dueno;
  };
  const contar = (e, cantidad, teorico, extra = {}) => {
    const linea = {
      existencia_id: e.id,
      contado: decTexto(cantidad),
      teorico: decTexto(teorico),
      cantidad_anterior: e.cantidad_conteo,
      conteo_anterior_id: e.conteo_id ?? null,
      dueno_anterior: duenoDe(e),
      ...extra,
    };
    conteo.lineas.push(linea);
    e.cantidad_conteo = decTexto(cantidad);
    e.conteo_id = conteo.id;
    tocadas.add(e.ubicacion_id);
    return linea;
  };
  const baja = (e, actual, porque) => {
    // Como al quitar una partida en un conteo: la línea guarda si estaba activa (el reporte de un día anterior la repone).
    const linea = contar(e, CERO, actual);
    linea.activo_anterior = e.activo ?? null;
    e.activo = false;
    e.baja = { fecha, motivo: porque, conteo_id: conteo.id, usuario, en: ahoraIso() };
    conteo.bajas.push(e.id);
  };

  for (const c of plan.conservadas) {
    const e = indices.existencia(c.existencia_id);
    contar(e, c.cantidad, c.actual, { kardex: [c.linea.id] });
    ponerDueno(e, c.dueno);
  }
  const creadas = new Map(); // clave de la nueva → partida
  for (const n of plan.nuevas) {
    const l = n.linea;
    indices.obtenerOCrearArticulo(l.codigo, mayusculas(l.nombre) ?? "", "AUDITORIA");
    const variante = indices.obtenerOCrearVariante(l.codigo, texto(n.dimension) || null, null, n.um);
    const renglon = crearRenglon(estado, indices, { varianteId: variante.id, ubicacionId: n.ubicacion_id, cantidad: decTexto(n.cantidad), conteoId: conteo.id, origen: `AUDITORÍA ${fmtFecha(fecha)}` });
    ponerDueno(renglon, n.dueno);
    conteo.nuevos.push(renglon.id);
    conteo.lineas.push({ existencia_id: renglon.id, contado: decTexto(n.cantidad), teorico: "0", cantidad_anterior: null, conteo_anterior_id: null, dueno_anterior: null, kardex: [l.id] });
    tocadas.add(renglon.ubicacion_id);
    creadas.set(n.clave, renglon);
  }
  for (const s of plan.sustituidas) baja(indices.existencia(s.existencia_id), s.actual, `Sustituida por el ${motivo.toLowerCase()}`);
  for (const s of plan.retiradas) baja(indices.existencia(s.existencia_id), s.actual, `No viene en el ${motivo.toLowerCase()}`);

  // Los vales y borradores posteriores al conteo que descontaban de una partida sustituida pasan a la que
  // la reemplaza: el vale no cambia (código, clave, cantidad), solo de qué partida descuenta.
  const valesPorId = new Map(estado.vales.map((v) => [v.id, v]));
  const borradoresPorId = { borradores: new Map((estado.borradores ?? []).map((b) => [b.id, b])), borradores_entrada: new Map((estado.borradores_entrada ?? []).map((b) => [b.id, b])) };
  for (const r of plan.religar) {
    const destino = r.a.existencia ? indices.existencia(r.a.existencia_id) : creadas.get(r.a.clave);
    if (!destino) continue;
    const contenedor = r.tipo === "vale" ? valesPorId.get(r.vale_id) : borradoresPorId[r.tipo]?.get(r.borrador_id);
    const linea = contenedor?.lineas.find((x) => x.id === r.linea_id);
    if (!linea || linea.existencia_id !== r.de) continue;
    linea.existencia_id = destino.id;
    if (linea.variante_id !== undefined) linea.variante_id = destino.variante_id;
    conteo.religadas.push({ tipo: r.tipo, vale_id: r.vale_id ?? null, borrador_id: r.borrador_id ?? null, linea_id: r.linea_id, de: r.de, a: destino.id });
  }
  conteo.ubicaciones = ubicacionesOrdenadas(estado)
    .map((u) => u.id)
    .filter((id) => tocadas.has(id));

  // El Disponible de AX de la hoja propia como reporte de AX de ese día (conciliación), una sola vez por archivo.
  let corteAx = null;
  const propia = hojas.find((h) => h.uso === "propio");
  if (propia?.tabla.renglones.length && !corteConHuella(estado, huella)) {
    corteAx = registrarCorteAx(estado, { fecha, almacen: propia.tabla.almacenes?.[0]?.nombre ?? "", archivo, huella, renglones: propia.tabla.renglones }, usuario);
    corteAx.hoja = propia.hoja;
    corteAx.base_oficial = conteo.id;
  }

  const resumen = { ...plan.resumen, partidas: conteo.lineas.length, diferencias: conteo.lineas.filter((l) => !dec(l.contado).eq(dec(l.teorico))).length };
  auditar(estado, { usuario, entidad: "conteo", entidadId: conteo.id, accion: "BASE_OFICIAL", despues: { archivo, fecha, corte: plan.corte, ...resumen, corte_ax: corteAx?.id ?? null } });
  return { conteo, resumen, corteAx };
}

/** Las listas de revisión de los conteos de auditoría (las que aún tienen algo), del más reciente al más antiguo. */
export function listasDeRevision(estado) {
  return [...(estado.conteos ?? [])]
    .filter((c) => c.tipo === "AUDITORIA" && (c.revision?.np?.length || c.revision?.retiradas?.length))
    .reverse()
    .map((c) => ({ conteo_id: c.id, fecha: c.fecha, archivo: c.archivo ?? null, np: c.revision.np ?? [], retiradas: c.revision.retiradas ?? [] }));
}

const LISTAS_REVISION = ["np", "retiradas"];

function revisionDe(estado, conteoId, tipo) {
  const conteo = (estado.conteos ?? []).find((c) => c.id === conteoId && c.tipo === "AUDITORIA");
  if (!conteo) throw new ErrorBaseOficial("Ese conteo de auditoría ya no existe.");
  if (!LISTAS_REVISION.includes(tipo)) throw new ErrorBaseOficial("Esa lista de revisión no existe.");
  conteo.revision ??= {};
  return conteo;
}

/**
 * Limpia una lista de revisión ("np" o "retiradas") de un conteo de auditoría cuando ya se revisó. No cambia el
 * inventario; los NP de esa lista dejan de sugerirse.
 * @returns las partidas que tenía (para Deshacer con `reponerListaRevision`)
 */
export function limpiarListaRevision(estado, conteoId, tipo, usuario = null) {
  const conteo = revisionDe(estado, conteoId, tipo);
  const filas = conteo.revision[tipo] ?? [];
  if (!filas.length) throw new ErrorBaseOficial("La lista ya está vacía.");
  conteo.revision[tipo] = [];
  auditar(estado, { usuario, entidad: "conteo", entidadId: conteo.id, accion: "LIMPIAR_LISTA_REVISION", antes: { lista: tipo, partidas: filas.length } });
  return filas;
}

/** Deshacer de `limpiarListaRevision`: vuelve a poner las partidas que tenía la lista. */
export function reponerListaRevision(estado, conteoId, tipo, filas, usuario = null) {
  const conteo = revisionDe(estado, conteoId, tipo);
  const ya = new Set((conteo.revision[tipo] ?? []).map((f) => f.existencia_id));
  conteo.revision[tipo] = [...filas.filter((f) => !ya.has(f.existencia_id)), ...(conteo.revision[tipo] ?? [])];
  auditar(estado, { usuario, entidad: "conteo", entidadId: conteo.id, accion: "REPONER_LISTA_REVISION", despues: { lista: tipo, partidas: filas.length } });
}

/** NP que tenía el código antes del reemplazo (para sugerirlos al anotar el NP de la partida nueva). */
export function npAnteriores(estado, codigo) {
  const vistos = new Map();
  for (const l of listasDeRevision(estado)) for (const r of l.np) if (r.codigo === codigo && r.np && !vistos.has(r.np)) vistos.set(r.np, { np: r.np, detalle: `Antes en ${r.lugar}: ${r.dimension || "SIN DIMENSIÓN"} · ${r.cantidad} ${r.um}` });
  return [...vistos.values()];
}
