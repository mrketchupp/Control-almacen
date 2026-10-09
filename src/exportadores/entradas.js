// Exporta el historial de entradas a VALES DE ENTRADA DLTA.xlsx (GSM: … GSM.xlsx) (RF-62, docs/06 §C).
//
// Es un archivo NUEVO (no hay plantilla del usuario que conservar): hoja DIARIO con las mismas
// columnas A–T del DIARIO de salidas, una columna U con el folio interno (E-0001) y una V con la
// fecha de recibido (Ronda 22: el día en que entró al inventario; A sigue siendo la fecha del vale).
// B = folio del vale de la base (P-05); C = XXXXX y D = 0 marcan la entrada.

import { folioEntrada } from "../servicios/entradas.js";
import { FechaCelda, fechaDelDia, serialExcel } from "../nucleo/fechas.js";
import { INVENTARIO_DEFECTO, inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { textoONumero } from "../nucleo/normalizar.js";
import { letraColumna } from "../xlsx/celdas.js";
import { LibroNuevo } from "../xlsx/nuevo.js";
import { valoresRenglon } from "./vales.js";

/** VALES DE ENTRADA DLTA.xlsx · VALES DE ENTRADA GSM.xlsx */
export const nombreEntradas = (inventario = INVENTARIO_DEFECTO) => `VALES DE ENTRADA ${inventarioPorId(inventario).id}.xlsx`;
export const HOJA_ENTRADAS = "DIARIO";
export const ENCABEZADOS_ENTRADAS = [
  "FECHA", "No. folio", "Pase de Entrada", "Pase de Salida", "Origen:", "Depto", "Destino", "Depto", "OC",
  "Cantidad", "Código", "Descripción", "CLAVE", "U.M.", "C.U", "Entrego/Recibio", "Entrego/Recibio", "Autorizo",
  "FAMILIA", "TRANSFERENCIA/CONSUMO", "Folio interno", "FECHA RECIBIDO",
];
const ANCHOS = [11, 10, 9, 9, 16, 16, 12, 12, 12, 9, 9, 42, 20, 7, 8, 24, 24, 12, 10, 14, 11, 11];
// Columnas con fecha (índice desde 0): A = la del vale, V = la de recibido.
const COLUMNAS_FECHA = new Set([0, ENCABEZADOS_ENTRADAS.length - 1]);

const FUENTE = { nombre: "Arial", tam: 10 };
const BORDE = "BFBFBF";
const ENCABEZADO = { fuente: { ...FUENTE, negrita: true }, relleno: "D9E1F2", borde: BORDE, envolver: true, vertical: "center" };
const CELDA = { fuente: FUENTE, borde: BORDE };
const FECHA = { ...CELDA, formato: "dd/mm/yyyy" };

/** [[vale, línea]] de las entradas confirmadas, por folio interno y renglón. */
export function renglonesEntradas(estado) {
  const renglones = [];
  const vales = estado.vales.filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO").sort((a, b) => a.folio - b.folio);
  for (const vale of vales) for (const linea of [...vale.lineas].sort((a, b) => a.renglon - b.renglon)) renglones.push([vale, linea]);
  return renglones;
}

/** Los 22 valores (A–V) de un renglón de entrada. */
export function valoresEntrada(vale, linea) {
  const valores = valoresRenglon(vale, linea);
  const base = vale.folio_externo ? textoONumero(vale.folio_externo) : vale.motivo === "DEVOLUCION" ? `DEV. ${vale.devolucion_folio}` : null;
  valores[1] = base ?? folioEntrada(vale.folio);
  valores.push(folioEntrada(vale.folio));
  const recibido = fechaDelDia(vale);
  valores.push(recibido ? new FechaCelda(serialExcel(recibido)) : null);
  return valores;
}

/** @returns {{ datos: Uint8Array, renglones, ultimoFolio }} */
export function exportarEntradas(estado) {
  const libro = new LibroNuevo();
  const ws = libro.agregarHoja(HOJA_ENTRADAS);
  ws.agregarFila(ENCABEZADOS_ENTRADAS, ENCABEZADO);
  const renglones = renglonesEntradas(estado);
  for (const [vale, linea] of renglones) {
    const fila = ws.agregarFila([]);
    valoresEntrada(vale, linea).forEach((valor, i) => ws.poner(fila, i + 1, valor, COLUMNAS_FECHA.has(i) ? FECHA : CELDA));
  }
  ANCHOS.forEach((ancho, i) => ws.anchos.set(i + 1, ancho));
  ws.alturas.set(1, 30);
  ws.congelar = "A2";
  ws.filtro = `A1:${letraColumna(ENCABEZADOS_ENTRADAS.length)}${Math.max(2, renglones.length + 1)}`;
  const folios = renglones.map(([v]) => v.folio);
  return { datos: libro.generar(), nombre: nombreEntradas(inventarioDe(estado).id), renglones: renglones.length, ultimoFolio: folios.length ? Math.max(...folios) : null };
}
