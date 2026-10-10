// Solicitud de ajuste (RF-54, docs/06-formatos-excel.md §E): un archivo NUEVO con la misma hoja y las
// mismas 10 columnas del reporte de AX, más "Existencia física", "Folios que justifican" y "Estado".
// Solo van los renglones INV con diferencia (o todos, si se pide); al final, lo físico que no está en
// AX. Cada fila lleva el color de su estado (verde = cuadra, azul = explicada por vales, amarillo =
// sobrante, rojo = faltante, gris = por confirmar).
// Ronda 14: antes va la hoja LEYENDA (qué significa cada color, (S) / (E) y las marcas de los folios)
// y después la hoja VALES POR APLICAR: las partidas que justifican diferencias y que la base aún no
// aplica en AX, para que las registre como consumo o transferencia. La hoja de AX no cambia.

import { CERO, dec } from "../nucleo/decimal.js";
import { fmtFecha, serialExcel } from "../nucleo/fechas.js";
import { INVENTARIO_DEFECTO, inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { conciliar, dimensionAx, etiquetaEstado, foliosTexto } from "../servicios/conciliacion.js";
import { etiquetaAx } from "../servicios/seguimiento.js";
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

export const HOJA_LEYENDA = "LEYENDA";
export const HOJA_VALES = "VALES POR APLICAR";

/** Qué significa cada color de la columna Estado (en el mismo orden que la pantalla). */
export const LEYENDA_ESTADOS = [
  ["cuadra", "Cuadra", "El físico es igual a lo que dice AX."],
  ["explicada", "Explicada por vales", "La diferencia la cubren los vales de «Folios que justifican»."],
  ["sobrante", "Sobrante", "Hay más en el físico que en AX y ningún vale lo explica."],
  ["faltante", "Faltante", "Hay menos en el físico que en AX y ningún vale lo explica."],
  ["por_confirmar", "Por confirmar", "Falta confirmar con qué partida del inventario se compara."],
];

/** Cómo leer «Folios que justifican». */
export const LEYENDA_FOLIOS = [
  ["545 (S)", "Vale de SALIDA del almacén con ese folio."],
  ["12345 (E)", "Vale de ENTRADA: el folio del vale de la base con el que llegó el material."],
  ["545 (S, sin IN/TR)", "Salida que en el archivo de la base aún no tiene folio IN / TR: falta aplicarla en AX."],
  ["545 (S, 2 sin IN/TR)", "De esa partida la base aplicó una parte; faltan 2 por aplicar."],
  ["545 (S, asignado)", "El almacén asignó ese vale para justificar la diferencia: falta aplicarlo en AX."],
  ["POR CONFIRMAR", "Todavía no se sabe con qué partida del inventario se compara."],
];

const FUENTE = { nombre: "Arial", tam: 10 };
const BORDE = "BFBFBF";
const ENCABEZADO = { fuente: { ...FUENTE, negrita: true }, relleno: "D9E1F2", borde: BORDE, envolver: true, vertical: "center" };
const AGREGADO = { ...ENCABEZADO, relleno: "FFF2CC" };
const CELDA = { fuente: FUENTE, borde: BORDE };
const NUMERO = { ...CELDA, formato: "#,##0.00" };
const FECHA = { ...CELDA, formato: "dd/mm/yyyy" };

/** SOLICITUD DE AJUSTE RIG 91 DLTA DDMMAA.xlsx (con el inventario y la fecha del corte de AX). */
export function nombreSolicitud(fecha, inventario = INVENTARIO_DEFECTO) {
  const [anio, mes, dia] = String(fecha).split("-");
  return `SOLICITUD DE AJUSTE RIG 91 ${inventarioPorId(inventario).id} ${dia}${mes}${anio.slice(2)}.xlsx`;
}

const codigoTexto = (codigo) => String(codigo).padStart(9, "0");

/**
 * Filas de la solicitud a partir de una conciliación ya hecha (`conciliar`); la última columna es
 * el estado (cuadra, explicada, sobrante, faltante, por_confirmar).
 * @param todos  también las partidas que cuadran
 */
export function filasSolicitud(c, corte, { todos = false } = {}) {
  // Una fila puede juntar varias variantes (partida de AX sin dimensión): cualquiera lleva a su fila.
  const porVariante = new Map(c.renglones.flatMap((r) => (r.variante_ids ?? [r.variante_id]).map((id) => [id, r])));
  const sinFisico = new Map(c.axSinFisico.map((r) => [r.linea.id, r]));
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
      // En AX y no en el físico: lo pueden explicar los vales que se le asignaron.
      const r = sinFisico.get(l.id);
      fisico = CERO;
      folios = r ? foliosTexto(r.folios) : "";
      const disponible = dec(l.disponible) ?? CERO;
      conDiferencia = !disponible.eq(0);
      estadoFila = r ? r.estado : disponible.gt(0) ? "faltante" : disponible.lt(0) ? "sobrante" : "cuadra";
    } else {
      const r = porVariante.get(p.variante_id);
      // Si varios renglones de AX son la misma fila, el físico va en el primero.
      const primero = !conFisico.has(r);
      conFisico.add(r);
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
 * Partidas de salida que justifican las diferencias de la solicitud y que la base aún no aplica en AX
 * (sin IN / TR, asignadas por el almacén o posteriores al reporte sin folio). Sin las entradas ni lo
 * que la base ya aplicó. @returns [{ vale, linea, cantidad, fila, como, enBase }]
 */
export function valesPorAplicar(c, corte, { todos = false } = {}) {
  const asignaciones = new Map((corte.asignaciones ?? []).map((a) => [a.partida_id, a]));
  const filas = [...c.renglones.filter((r) => todos || r.estado !== "cuadra"), ...c.axSinFisico, ...c.fisicoSinAx];
  const vistas = new Set();
  const salida = [];
  for (const fila of filas) {
    for (const p of fila.partidas ?? []) {
      if (p.vale.tipo !== "SALIDA" || vistas.has(p.linea.id)) continue;
      const info = c.ax?.porLinea.get(p.linea.id) ?? null;
      const asignada = asignaciones.get(p.linea.id);
      if (!asignada && info?.estado === "aplicada") continue;
      vistas.add(p.linea.id);
      const como = asignada
        ? asignada.metodo === "sugerida"
          ? "Asignado por el almacén (sugerencia aprobada)"
          : "Asignado por el almacén"
        : p.marca
          ? "Sin IN / TR en el archivo de la base"
          : "Posterior al reporte de AX";
      const um = p.um ?? p.linea.um;
      const detalle = um !== p.linea.um ? `${como}. Vale original: ${p.linea.cantidad} ${p.linea.um}; cantidad por aplicar expresada en ${um}` : como;
      salida.push({ vale: p.vale, linea: p.linea, cantidad: p.cantidad, um, fila, como: detalle, enBase: c.ax ? etiquetaAx(info) || "—" : "Sin archivo de la base" });
    }
  }
  return salida.sort((a, b) => a.vale.folio - b.vale.folio || (a.linea.renglon ?? 0) - (b.linea.renglon ?? 0));
}

export const ENCABEZADOS_VALES = [
  "Folio",
  "Fecha",
  "Tipo de mov.",
  "Área",
  "Código de Artículo",
  "Descripción",
  "Clave",
  "Cantidad por aplicar",
  "U.M.",
  "Justifica en AX (Tamaño + Color)",
  "Estado en la solicitud",
  "Cómo se identificó",
  "En el archivo de la base",
];
const ANCHOS_VALES = [9, 12, 15, 18, 14, 34, 18, 12, 8, 26, 18, 34, 22];

const justificaEnAx = (fila) => {
  const lineas = fila.lineas ?? (fila.linea ? [fila.linea] : []);
  if (lineas.length) return lineas.map((l) => dimensionAx(l) || "SIN DIMENSIÓN").join(" / ");
  return `No está en AX (físico: ${fila.variante?.dimension || "SIN DIMENSIÓN"})`;
};

function hojaVales(libro, c, corte, partidas) {
  const ws = libro.agregarHoja(HOJA_VALES);
  ENCABEZADOS_VALES.forEach((titulo, i) => ws.poner(1, i + 1, titulo, ENCABEZADO));
  partidas.forEach((p, k) => {
    const relleno = COLORES_ESTADO[p.fila.estado];
    const mov = c.ax?.porLinea.get(p.linea.id)?.mov || p.vale.naturaleza || "";
    const valores = [
      p.vale.folio,
      p.vale.fecha ? serialExcel(p.vale.fecha) : null,
      mov.toUpperCase(),
      p.vale.depto_destino ?? "",
      codigoTexto(p.linea.codigo),
      p.linea.descripcion ?? "",
      p.linea.clave ?? "",
      p.cantidad,
      p.um ?? "",
      justificaEnAx(p.fila),
      etiquetaEstado(p.fila.estado),
      p.como,
      p.enBase,
    ];
    valores.forEach((valor, i) => ws.poner(k + 2, i + 1, valor, { ...(i === 1 ? FECHA : i === 7 ? NUMERO : CELDA), relleno: i === 10 ? relleno : undefined }));
  });
  ANCHOS_VALES.forEach((ancho, i) => ws.anchos.set(i + 1, ancho));
  ws.alturas.set(1, 30);
  ws.congelar = "A2";
  ws.filtro = `A1:${letraColumna(ENCABEZADOS_VALES.length)}${Math.max(2, partidas.length + 1)}`;
}

/** Primera hoja: qué significan los colores, (S) / (E) y las marcas de los folios. No toca los datos. */
function hojaLeyenda(libro, corte, { renglones, vales, inventario }) {
  const ws = libro.agregarHoja(HOJA_LEYENDA);
  const titulo = { fuente: { ...FUENTE, tam: 13, negrita: true } };
  const subtitulo = { fuente: { ...FUENTE, negrita: true }, relleno: "D9E1F2", borde: BORDE };
  const texto = { fuente: FUENTE };
  let f = 1;
  ws.poner(f++, 1, `SOLICITUD DE AJUSTE RIG 91 · INVENTARIO ${inventario} · AX al ${fmtFecha(corte.fecha)} (${corte.almacen})`, titulo);
  const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
  ws.poner(f++, 1, `Hoja «${HOJA_AJUSTE}»: el reporte de AX con 3 columnas agregadas (${plural(renglones, "partida", "partidas")}). Hoja «${HOJA_VALES}»: ${plural(vales, "partida de vale", "partidas de vale")} por aplicar en AX.`, texto);
  f++;
  ws.poner(f, 1, "Color", subtitulo);
  ws.poner(f, 2, "Estado", subtitulo);
  ws.poner(f++, 3, "Qué significa", subtitulo);
  for (const [clave, nombre, explicacion] of LEYENDA_ESTADOS) {
    ws.poner(f, 1, "", { ...CELDA, relleno: COLORES_ESTADO[clave] });
    ws.poner(f, 2, nombre, { ...CELDA, relleno: COLORES_ESTADO[clave] });
    ws.poner(f++, 3, explicacion, { ...CELDA, envolver: true });
  }
  f++;
  ws.poner(f, 1, "En «Folios que justifican»", subtitulo);
  ws.poner(f, 2, "", subtitulo);
  ws.poner(f++, 3, "Qué significa", subtitulo);
  ws.poner(f, 1, "(S)", CELDA);
  ws.poner(f, 2, "Salida", CELDA);
  ws.poner(f++, 3, `Vale de salida: material que salió del almacén ${inventario} del RIG 91.`, { ...CELDA, envolver: true });
  ws.poner(f, 1, "(E)", CELDA);
  ws.poner(f, 2, "Entrada", CELDA);
  ws.poner(f++, 3, "Vale de entrada: material que llegó de la base (con el folio de su vale).", { ...CELDA, envolver: true });
  for (const [ejemplo, explicacion] of LEYENDA_FOLIOS) {
    ws.poner(f, 1, ejemplo, CELDA);
    ws.poner(f, 2, "", CELDA);
    ws.poner(f++, 3, explicacion, { ...CELDA, envolver: true });
  }
  f++;
  ws.poner(f++, 1, "Diferencia = físico − AX. Se explica con los vales: físico − AX + salidas − entradas = 0.", texto);
  [24, 22, 80].forEach((ancho, i) => ws.anchos.set(i + 1, ancho));
}

/**
 * @param todos  también las partidas que cuadran
 * @returns {{ datos: Uint8Array, nombre, renglones, porConfirmar, vales }}
 */
export function exportarSolicitudAjuste(estado, corte, { todos = false } = {}) {
  const c = conciliar(estado, corte);
  const filas = filasSolicitud(c, corte, { todos });
  const partidas = valesPorAplicar(c, corte, { todos });
  const inventario = inventarioDe(estado).id;
  const libro = new LibroNuevo();
  hojaLeyenda(libro, corte, { renglones: filas.length, vales: partidas.length, inventario });
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
  hojaVales(libro, c, corte, partidas);
  return { datos: libro.generar(), nombre: nombreSolicitud(corte.fecha, inventario), renglones: filas.length, porConfirmar: c.porConfirmar.length, vales: partidas.length };
}
