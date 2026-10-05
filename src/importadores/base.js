// Lectura del archivo de seguimiento de la base ("VALES DE SALIDA DELTA RIG91.xlsm"): es el DIARIO de los
// vales de salida al que el encargado de la base le agrega INV/NINV (si se descuenta en AX), TIPO DE MOV
// (consumo o transferencia), CANTIDAD (lo aplicado), TR / IN (folio que da AX) y COMENTARIOS.
// Solo lee; las columnas se buscan por nombre. Ver docs/06-formatos-excel.md, sección G.

import { decTexto } from "../nucleo/decimal.js";
import { ahoraIso } from "../nucleo/fechas.js";
import * as n from "../nucleo/normalizar.js";
import { LibroLeido } from "../xlsx/leer.js";
import { TIPOS } from "../xlsx/rutas.js";

export class ErrorArchivoBase extends Error {}

const encabezado = (v) => n.sinAcentos(n.valorATexto(v) ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const texto = (v) => (n.valorATexto(v) ?? "").trim();

/** Encabezado → campo. "CANTIDAD" aparece dos veces: la del vale y, después de INV/NINV, lo aplicado en AX. */
const COLUMNAS = {
  FECHA: "fecha",
  "NO. FOLIO": "folio",
  "PASE DE ENTRADA": "entrada",
  "PASE DE SALIDA": "salida",
  CANTIDAD: "cantidad",
  CODIGO: "codigo",
  DESCRIPCION: "descripcion",
  CLAVE: "clave",
  "U.M.": "um",
  "INV/NINV": "inv",
  "TIPO DE MOV": "mov",
  TR: "tr",
  IN: "in",
  COMENTARIOS: "comentario",
};

/** Cuándo se guardó el archivo por última vez (docProps/core.xml), en hora local: "2026-10-04T18:39:13". */
export function guardadoEl(libro) {
  if (!libro.existe("docProps/core.xml")) return null;
  const m = /<dcterms:modified\b[^>]*>([^<]+)</.exec(libro.texto("docProps/core.xml"));
  const fecha = m ? new Date(m[1].trim()) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? ahoraIso(fecha) : null;
}

function ubicarTabla(libro) {
  const hojas = libro.hojas.filter((h) => h.tipo === TIPOS.hoja && h.estado === "visible");
  hojas.sort((a, b) => Number(encabezado(b.nombre) === "DIARIO") - Number(encabezado(a.nombre) === "DIARIO"));
  for (const info of hojas) {
    const ws = libro.hoja(info.nombre);
    for (let fila = 1; fila <= Math.min(ws.maxFila, 10); fila++) {
      const valores = ws.fila(fila).map(encabezado);
      if (!valores.includes("NO. FOLIO") || !valores.includes("INV/NINV")) continue;
      const columnas = {};
      valores.forEach((titulo, i) => {
        const campo = COLUMNAS[titulo];
        if (!campo) return;
        if (campo === "cantidad" && columnas.inv) columnas.aplicada ??= i + 1;
        else columnas[campo] ??= i + 1;
      });
      return { ws, fila, columnas };
    }
  }
  return null;
}

/**
 * @returns {{ hoja, partidas: [{ fila, fecha, folio, codigo, clave, cantidad, entrada, inv, mov, aplicada,
 *   tr, in, comentario }], ultimoFolio, guardado, ignoradas }}
 *   Los textos de la base (INV/NINV, TIPO DE MOV, CANTIDAD aplicada, TR, IN) se guardan como vienen.
 *   guardado: cuándo lo guardó Excel (solo informativo: la fecha del archivo no cambia nada).
 */
export function leerArchivoBase(datos) {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  const tabla = ubicarTabla(libro);
  if (!tabla) throw new ErrorArchivoBase('No encontré las columnas "No. folio" e "INV/NINV". ¿Es el archivo de vales que lleva la base?');
  const { ws, fila: filaEncabezados, columnas } = tabla;
  const faltan = ["folio", "codigo"].filter((c) => !columnas[c]);
  if (faltan.length) throw new ErrorArchivoBase(`Al archivo le faltan las columnas: ${faltan.join(", ")}.`);
  const valor = (f, campo) => (columnas[campo] ? ws.valor(f, columnas[campo]) : null);
  const partidas = [];
  let ignoradas = 0;
  let ultimoFolio = null;
  for (let f = filaEncabezados + 1; f <= ws.maxFila; f++) {
    if (!ws.filas.has(f)) continue;
    const folio = n.codigoAx(valor(f, "folio"));
    const codigo = n.codigoAx(valor(f, "codigo"));
    if (folio === null || codigo === null) {
      if (ws.fila(f).some((v) => texto(v) !== "")) ignoradas += 1;
      continue;
    }
    const cantidad = n.decimal(valor(f, "cantidad"));
    partidas.push({
      fila: f,
      fecha: n.fecha(valor(f, "fecha")),
      folio,
      codigo,
      clave: texto(valor(f, "clave")),
      cantidad: cantidad === null ? null : decTexto(cantidad),
      entrada: /X{3,}/i.test(texto(valor(f, "entrada"))),
      inv: texto(valor(f, "inv")),
      mov: texto(valor(f, "mov")),
      aplicada: texto(valor(f, "aplicada")),
      tr: texto(valor(f, "tr")),
      in: texto(valor(f, "in")),
      comentario: texto(valor(f, "comentario")),
    });
    if (ultimoFolio === null || folio > ultimoFolio) ultimoFolio = folio;
  }
  return { hoja: ws.nombre, partidas, ultimoFolio, guardado: guardadoEl(libro), ignoradas };
}
