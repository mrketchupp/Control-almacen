// Seguimiento de la base (Ronda 12): el encargado de la base copia el DIARIO de salidas y anota, por
// partida, si se descuenta en AX (INV/NINV), cómo (TIPO DE MOV: consumo o transferencia), cuánto
// (CANTIDAD) y el folio que dio AX (IN… para consumo, TRS… para transferencia). Con ese archivo se
// sabe qué partidas ya están en AX y cuáles siguen pendientes, sin depender solo de la fecha del corte.
//
// Reglas (acordadas con el usuario):
//  - Con folio IN/TRS la partida ya está en AX. CANTIDAD es lo aplicado; vacía = todo. Si es menor
//    que la del vale, lo que falta sigue pendiente.
//  - INV sin folio de AX (o "PENDIENTE"): pendiente; puede justificar diferencias en la conciliación.
//  - NO INV, CONPROV, SIN EXISTENCIA: no se descuentan en AX; no justifican diferencias.
//  - Sin INV/NINV: la base aún no la revisa.
// Las filas se emparejan con las partidas por folio y código (luego clave y cantidad); lo que no
// cuadra (clave o cantidad distinta, partidas de más o de menos) se avisa.

import { CERO, dec, decTexto } from "../nucleo/decimal.js";
import { clavesDeBusqueda, hayInterseccion } from "../nucleo/catalogo.js";
import { auditar, siguienteId } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { claveEstricta, sinAcentos } from "../nucleo/normalizar.js";
import { partidasDuplicadas } from "./vales.js";

export class ErrorSeguimiento extends Error {}

export const ESTADOS_AX = {
  aplicada: "Aplicada en AX",
  parcial: "Aplicada en parte",
  pendiente: "Pendiente en AX",
  no_inv: "No se descuenta en AX",
  sin_revisar: "Sin revisar por la base",
  sin_registro: "No está en el archivo de la base",
};

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mayus = (v) => sinAcentos(texto(v)).toUpperCase().replace(/\s+/g, " ");

// ---------------------------------------------------------------- archivos importados

/** Archivos de la base que se guardan (cada uno trae todo el DIARIO; los más viejos ya no hacen falta). */
export const MAXIMO_SEGUIMIENTOS = 12;

const porFecha = (a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id);

/**
 * Guarda un archivo de la base (fecha = a qué día corresponde lo que dice la base). Si ya había uno del
 * mismo día, lo reemplaza; se guardan los últimos MAXIMO_SEGUIMIENTOS días.
 */
export function registrarSeguimiento(estado, { fecha, archivo = null, huella = null, partidas, ultimoFolio = null }, usuario = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(fecha))) throw new ErrorSeguimiento("Falta la fecha del archivo de la base.");
  if (!partidas?.length) throw new ErrorSeguimiento("El archivo no trae partidas de vales.");
  estado.seguimientos_base ??= [];
  const seguimiento = {
    id: siguienteId(estado, "seguimiento_base"),
    fecha,
    archivo,
    huella,
    importado_en: ahoraIso(),
    importado_por: usuario,
    ultimo_folio: ultimoFolio ?? Math.max(...partidas.map((p) => p.folio)),
    partidas,
  };
  const reemplazados = estado.seguimientos_base.filter((x) => x.fecha === fecha);
  const lista = [...estado.seguimientos_base.filter((x) => x.fecha !== fecha), seguimiento].sort(porFecha);
  const viejos = lista.slice(0, Math.max(0, lista.length - MAXIMO_SEGUIMIENTOS));
  estado.seguimientos_base = lista.slice(viejos.length);
  auditar(estado, {
    usuario,
    entidad: "seguimiento_base",
    entidadId: seguimiento.id,
    accion: "IMPORTAR",
    antes: reemplazados.length || viejos.length ? { quitados: [...reemplazados, ...viejos].map((x) => ({ fecha: x.fecha, archivo: x.archivo })) } : null,
    despues: { fecha, archivo, partidas: partidas.length },
  });
  return seguimiento;
}

/** El archivo de la base más reciente (por su fecha): es el que se muestra en el historial y en los vales. */
export function seguimientoVigente(estado) {
  const lista = [...(estado.seguimientos_base ?? [])].sort(porFecha);
  return lista.length ? lista[lista.length - 1] : null;
}

const dias = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

/**
 * El archivo de la base para conciliar un corte de AX: el de la fecha más cercana a la del reporte (con
 * fechas distintas, lo que la base aplicó entre una y otra no se ve bien). Empate: el anterior al corte.
 */
export function seguimientoParaCorte(estado, corte) {
  const lista = estado.seguimientos_base ?? [];
  if (!corte?.fecha) return seguimientoVigente(estado);
  const orden = (s) => [dias(s.fecha, corte.fecha), s.fecha > corte.fecha ? 1 : 0, -s.id];
  const comparar = (a, b) => orden(a).reduce((r, x, i) => r || x - orden(b)[i], 0);
  return [...lista].sort(comparar)[0] ?? null;
}

export function seguimientoConHuella(estado, huella) {
  return huella ? ((estado.seguimientos_base ?? []).find((s) => s.huella === huella) ?? null) : null;
}

export function quitarSeguimiento(estado, id, usuario = null) {
  const s = (estado.seguimientos_base ?? []).find((x) => x.id === id);
  if (!s) return;
  estado.seguimientos_base = estado.seguimientos_base.filter((x) => x.id !== id);
  auditar(estado, { usuario, entidad: "seguimiento_base", entidadId: id, accion: "QUITAR", antes: { fecha: s.fecha, archivo: s.archivo } });
}

// ---------------------------------------------------------------- una fila de la base

/** Folios de AX anotados en TR / IN: "IN00000182", "TRS000000287", "IN598/IN651" → [..]. */
export function foliosAx(fila) {
  const folios = [];
  for (const valor of [fila.tr, fila.in]) {
    for (const m of mayus(valor).matchAll(/\b(TRS?|IN)\s*-?\s*(\d+)\b/g)) {
      const folio = `${m[1]}${m[2]}`;
      if (!folios.includes(folio)) folios.push(folio);
    }
  }
  return folios;
}

/** CANTIDAD aplicada: "12" → 12, "4 Y 2" → 6, "2|" → 2; sin números ("REGRESAR") o vacía → null. */
export function cantidadAplicada(valor) {
  const numeros = texto(valor).match(/\d+(?:[.,]\d+)?/g);
  if (!numeros) return null;
  return numeros.reduce((suma, x) => suma.plus(dec(x.replace(",", ".")) ?? CERO), CERO);
}

const NO_SE_DESCUENTA = /NO ?INV|NINV|CONPROV|SIN EX/;

/**
 * Estado en AX de una fila de la base.
 * @returns {{ estado, folios, mov, aplicada: Big|null, pendiente: Big, avisos: string[] }}
 */
export function clasificar(fila) {
  const inv = mayus(fila.inv);
  const folios = foliosAx(fila);
  const total = dec(fila.cantidad) ?? CERO;
  const avisos = [];
  const mov = mayus(fila.mov);
  if (folios.length) {
    if (NO_SE_DESCUENTA.test(inv)) avisos.push(`La base la marcó ${texto(fila.inv)} pero anotó ${folios.join(", ")}.`);
    const u = cantidadAplicada(fila.aplicada);
    if (texto(fila.aplicada) && u === null) avisos.push(`La base anotó "${texto(fila.aplicada)}" en CANTIDAD; se toma como aplicada completa.`);
    if (u !== null && u.lt(total)) {
      avisos.push(`La base aplicó ${decTexto(u)} de ${decTexto(total)}: faltan ${decTexto(total.minus(u))} en AX.`);
      return { estado: "parcial", folios, mov, aplicada: u, pendiente: total.minus(u), avisos };
    }
    if (u !== null && u.gt(total)) avisos.push(`La base aplicó ${decTexto(u)} y el vale dice ${decTexto(total)}.`);
    return { estado: "aplicada", folios, mov, aplicada: u ?? total, pendiente: CERO, avisos };
  }
  if (NO_SE_DESCUENTA.test(inv)) return { estado: "no_inv", folios, mov, aplicada: null, pendiente: CERO, avisos };
  if (inv === "INV") return { estado: "pendiente", folios, mov, aplicada: null, pendiente: total, avisos };
  if (inv) avisos.push(`INV/NINV dice "${texto(fila.inv)}".`);
  return { estado: "sin_revisar", folios, mov, aplicada: null, pendiente: CERO, avisos };
}

// ---------------------------------------------------------------- filas ↔ partidas de los vales

const mismaClave = (a, b) => claveEstricta(a) === claveEstricta(b) || hayInterseccion(clavesDeBusqueda(texto(a)), clavesDeBusqueda(texto(b)));
const mismaCantidad = (a, b) => {
  const x = dec(a);
  const y = dec(b);
  return x !== null && y !== null && x.eq(y);
};
const describir = (codigo, clave, cantidad) => `${codigo}${texto(clave) ? ` ${texto(clave)}` : ""}${cantidad !== null && cantidad !== undefined ? ` (${decTexto(dec(cantidad) ?? CERO)})` : ""}`;

/**
 * Estado en AX de cada partida de los vales de salida según el archivo de la base.
 * @returns {null | { seguimiento, porLinea: Map<lineaId, info>, avisos: [{ folio, codigo, vale_id, texto }],
 *   resumen: { aplicada, parcial, pendiente, no_inv, sin_revisar, sin_registro, avisos } }}
 *   info = clasificar(fila) + { fila } (o { estado: "sin_registro" } si la base no la tiene).
 *   Las partidas de vales posteriores al último folio del archivo no tienen info (la base aún no los ve).
 */
export function estadoAxDeVales(estado, seguimiento = seguimientoVigente(estado)) {
  if (!seguimiento) return null;
  const porLinea = new Map();
  const avisos = [];
  const aviso = (folio, codigo, vale, textoAviso) => avisos.push({ folio, codigo, vale_id: vale?.id ?? null, texto: textoAviso });
  const filasPorFolio = new Map();
  for (const fila of seguimiento.partidas) {
    if (fila.entrada) continue;
    if (!filasPorFolio.has(fila.folio)) filasPorFolio.set(fila.folio, []);
    filasPorFolio.get(fila.folio).push(fila);
  }
  const valesPorFolio = new Map();
  for (const vale of estado.vales) {
    if (vale.tipo !== "SALIDA" || !Number.isInteger(vale.folio)) continue;
    if (!valesPorFolio.has(vale.folio)) valesPorFolio.set(vale.folio, []);
    valesPorFolio.get(vale.folio).push(vale);
  }
  const folios = new Set([...filasPorFolio.keys(), ...valesPorFolio.keys()]);
  for (const folio of [...folios].sort((a, b) => a - b)) {
    const filas = [...(filasPorFolio.get(folio) ?? [])];
    const partidas = (valesPorFolio.get(folio) ?? []).flatMap((vale) => vale.lineas.map((linea) => ({ vale, linea })));
    const pendientes = [...partidas];
    // De lo más parecido a lo menos: código + clave + cantidad, código + cantidad, código + clave, código.
    const pruebas = [
      (p, f) => mismaClave(p.linea.clave, f.clave) && mismaCantidad(p.linea.cantidad, f.cantidad),
      (p, f) => mismaCantidad(p.linea.cantidad, f.cantidad),
      (p, f) => mismaClave(p.linea.clave, f.clave),
      () => true,
    ];
    for (const prueba of pruebas) {
      for (const p of [...pendientes]) {
        const i = filas.findIndex((f) => f.codigo === p.linea.codigo && prueba(p, f));
        if (i < 0) continue;
        const [fila] = filas.splice(i, 1);
        pendientes.splice(pendientes.indexOf(p), 1);
        const info = { ...clasificar(fila), fila };
        if (!mismaClave(p.linea.clave, fila.clave)) info.avisos.push(`La base anotó la clave ${texto(fila.clave) || "vacía"}; el vale dice ${texto(p.linea.clave) || "vacía"}.`);
        if (fila.cantidad !== null && !mismaCantidad(p.linea.cantidad, fila.cantidad)) {
          info.avisos.push(`La base anotó ${decTexto(dec(fila.cantidad))}; el vale dice ${decTexto(dec(p.linea.cantidad) ?? CERO)}.`);
        }
        porLinea.set(p.linea.id, info);
        for (const t of info.avisos) aviso(folio, p.linea.codigo, p.vale, t);
      }
    }
    for (const fila of filas) aviso(folio, fila.codigo, partidas[0]?.vale, `La base tiene ${describir(fila.codigo, fila.clave, fila.cantidad)}, que no está en el vale.`);
    if (folio <= seguimiento.ultimo_folio) {
      for (const p of pendientes) {
        if (p.vale.estado !== "EMITIDO" || !Number.isInteger(p.linea.codigo)) continue;
        // Lo más común: la partida está dos veces en el vale (el formulario lo guardó dos veces).
        const repite = partidasDuplicadas(p.vale).get(p.linea.id);
        const textoAviso = `${describir(p.linea.codigo, p.linea.clave, p.linea.cantidad)} no está en el archivo de la base${repite ? ` (está duplicada: repite la partida ${repite})` : ""}.`;
        porLinea.set(p.linea.id, { estado: "sin_registro", folios: [], mov: "", aplicada: null, pendiente: CERO, avisos: [textoAviso], duplicada: Boolean(repite) });
        aviso(folio, p.linea.codigo, p.vale, textoAviso);
      }
    }
  }
  const resumen = { aplicada: 0, parcial: 0, pendiente: 0, no_inv: 0, sin_revisar: 0, sin_registro: 0, avisos: avisos.length };
  for (const info of porLinea.values()) resumen[info.estado] += 1;
  return { seguimiento, porLinea, avisos, resumen };
}

/** Texto corto del estado en AX de una partida: "IN00000182", "TRS000000287", "Pendiente", "12 de 36 · IN…". */
export function etiquetaAx(info) {
  if (!info) return "";
  if (info.estado === "aplicada") return info.folios.join(", ");
  if (info.estado === "parcial") return `${decTexto(info.aplicada)} de ${decTexto(info.aplicada.plus(info.pendiente))} en AX · ${info.folios.join(", ")}`;
  if (info.estado === "pendiente") return "Pendiente en AX";
  if (info.estado === "no_inv") return texto(info.fila?.inv) || "NO INV";
  if (info.estado === "sin_revisar") return "Sin revisar";
  return "No está en la base";
}
