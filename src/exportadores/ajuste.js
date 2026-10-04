// Solicitud de ajuste (RF-54, docs/06-formatos-excel.md §E): un archivo NUEVO con la misma hoja y las
// mismas 10 columnas del reporte de AX, más "Existencia física", "Folios que justifican" y "Estado".
// Solo van los renglones INV con diferencia (o todos, si se pide); al final, lo físico que no está en
// AX. Cada fila lleva el color de su estado (verde = cuadra, azul = explicada por vales, amarillo =
// sobrante, rojo = faltante, gris = por confirmar).

import { CERO, dec } from "../nucleo/decimal.js";
import { conciliar, etiquetaEstado, foliosTexto } from "../servicios/conciliacion.js";
import { letraColumna } from "../xlsx/celdas.js";
import { LibroNuevo } from "../xlsx/nuevo.js";

export const HOJA_AJUSTE = "rptInventSumDateTransForDimensi";
export const ENCABEZADOS_AJUSTE = [
  "Código de Artículo",
  "Nombre del Artículo",
  "Modelo de Inventario",
  "Unidad de Medida",
  "Almacén",
  "Tamaño",
  "Color",
  "Disponible",
  "Valor Financiero",
  "Valor de Inventario",
  "Existencia física",
  "Folios que justifican",
  "Estado",
];
const ANCHOS = [14, 38, 12, 10, 13, 14, 14, 12, 14, 14, 14, 30, 20];

/** Relleno de la fila según el estado (colores suaves de Excel: buena, neutral, incorrecta…). */
export const COLORES_ESTADO = {
  cuadra: "C6EFCE",
  explicada: "DDEBF7",
  sobrante: "FFEB9C",
  faltante: "FFC7CE",
  por_confirmar: "E7E6E6",
};

const FUENTE = { nombre: "Arial", tam: 10 };
const BORDE = "BFBFBF";
const ENCABEZADO = { fuente: { ...FUENTE, negrita: true }, relleno: "D9E1F2", borde: BORDE, envolver: true, vertical: "center" };
const AGREGADO = { ...ENCABEZADO, relleno: "FFF2CC" };
const CELDA = { fuente: FUENTE, borde: BORDE };
const NUMERO = { ...CELDA, formato: "#,##0.00" };

/** SOLICITUD DE AJUSTE RIG 91 DDMMAA.xlsx (con la fecha del corte de AX). */
export function nombreSolicitud(fecha) {
  const [anio, mes, dia] = String(fecha).split("-");
  return `SOLICITUD DE AJUSTE RIG 91 ${dia}${mes}${anio.slice(2)}.xlsx`;
}

const codigoTexto = (codigo) => String(codigo).padStart(9, "0");

/**
 * Filas de la solicitud a partir de una conciliación ya hecha (`conciliar`); la última columna es
 * el estado (cuadra, explicada, sobrante, faltante, por_confirmar).
 * @param todos  también las partidas que cuadran
 */
export function filasSolicitud(c, corte, { todos = false } = {}) {
  const porVariante = new Map(c.renglones.map((r) => [r.variante_id, r]));
  const conFisico = new Set();
  const filas = [];
  for (const p of c.pares) {
    const l = p.linea;
    let fisico;
    let folios = "";
    let conDiferencia;
    let estadoFila;
    if (!p.confirmado) {
      // Sin confirmar no se sabe con qué se compara: se marca para revisarlo.
      fisico = null;
      folios = "POR CONFIRMAR";
      conDiferencia = true;
      estadoFila = "por_confirmar";
    } else if (p.variante_id === null) {
      fisico = CERO;
      const disponible = dec(l.disponible) ?? CERO;
      conDiferencia = !disponible.eq(0);
      estadoFila = disponible.gt(0) ? "faltante" : disponible.lt(0) ? "sobrante" : "cuadra";
    } else {
      const r = porVariante.get(p.variante_id);
      // Si varios renglones de AX son la misma variante, el físico va en el primero.
      const primero = !conFisico.has(p.variante_id);
      conFisico.add(p.variante_id);
      fisico = primero ? r.fisico : CERO;
      folios = primero ? foliosTexto(r.folios) : "";
      conDiferencia = r.estado !== "cuadra";
      estadoFila = r.estado;
    }
    if (!todos && !conDiferencia) continue;
    filas.push([
      l.codigo_texto || codigoTexto(l.codigo),
      l.nombre,
      l.modelo,
      l.um,
      l.almacen || corte.almacen,
      l.tamano,
      l.color,
      dec(l.disponible),
      dec(l.valor_financiero),
      dec(l.valor_inventario),
      fisico,
      folios,
      estadoFila,
    ]);
  }
  for (const r of c.fisicoSinAx) {
    filas.push([
      codigoTexto(r.codigo),
      r.descripcion,
      "",
      r.variante.um ?? "",
      corte.almacen,
      r.variante.dimension ?? "",
      "", // AX no trae NP: la dimensión completa va en Tamaño
      CERO,
      null,
      null,
      r.fisico,
      foliosTexto(r.folios),
      r.estado,
    ]);
  }
  return filas;
}

/**
 * @param todos  también las partidas que cuadran
 * @returns {{ datos: Uint8Array, nombre, renglones, porConfirmar }}
 */
export function exportarSolicitudAjuste(estado, corte, { todos = false } = {}) {
  const c = conciliar(estado, corte);
  const filas = filasSolicitud(c, corte, { todos });
  const libro = new LibroNuevo();
  const ws = libro.agregarHoja(HOJA_AJUSTE);
  ENCABEZADOS_AJUSTE.forEach((titulo, i) => ws.poner(1, i + 1, titulo, i >= 10 ? AGREGADO : ENCABEZADO));
  filas.forEach((valores, k) => {
    const estadoFila = valores[valores.length - 1];
    const relleno = COLORES_ESTADO[estadoFila];
    valores[valores.length - 1] = estadoFila === "por_confirmar" ? "Por confirmar" : etiquetaEstado(estadoFila);
    valores.forEach((valor, i) => ws.poner(k + 2, i + 1, valor, { ...(i >= 7 && i <= 10 ? NUMERO : CELDA), relleno }));
  });
  ANCHOS.forEach((ancho, i) => ws.anchos.set(i + 1, ancho));
  ws.alturas.set(1, 30);
  ws.congelar = "A2";
  ws.filtro = `A1:${letraColumna(ENCABEZADOS_AJUSTE.length)}${Math.max(2, filas.length + 1)}`;
  return { datos: libro.generar(), nombre: nombreSolicitud(corte.fecha), renglones: filas.length, porConfirmar: c.porConfirmar.length };
}
