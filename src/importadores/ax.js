// Lectura del reporte de inventario de AX (rptInventSumDateTransForDimensions, "DELTA RIG 91 <fecha>.xlsx").
// Solo lee. Las columnas se buscan por nombre en la fila de encabezados; acepta el reporte completo
// (todos los almacenes) o ya filtrado. Ver docs/06-formatos-excel.md, sección D.

import { decTexto } from "../nucleo/decimal.js";
import * as n from "../nucleo/normalizar.js";
import { LibroLeido } from "../xlsx/leer.js";
import { TIPOS } from "../xlsx/rutas.js";

export class ErrorReporteAx extends Error {}

// Campo → encabezado del reporte (sin acentos, en mayúsculas).
export const COLUMNAS_AX = {
  codigo: "CODIGO DE ARTICULO",
  nombre: "NOMBRE DEL ARTICULO",
  modelo: "MODELO DE INVENTARIO",
  um: "UNIDAD DE MEDIDA",
  almacen: "ALMACEN",
  tamano: "TAMANO",
  color: "COLOR",
  disponible: "DISPONIBLE",
  valor_financiero: "VALOR FINANCIERO",
  valor_inventario: "VALOR DE INVENTARIO",
};
const OBLIGATORIAS = ["codigo", "disponible"];

const encabezado = (v) => n.sinAcentos(n.valorATexto(v) ?? "").toUpperCase().replace(/\s+/g, " ").trim();
// Los textos se guardan como vienen (la solicitud de ajuste repite el reporte); se normalizan al comparar.
const textoCelda = (v) => n.valorATexto(v) ?? "";
const decimalTexto = (v) => {
  const d = n.decimal(v);
  return d === null ? null : decTexto(d);
};

/** Fecha de corte del nombre del archivo: "DELTA RIG 91 270926.xlsx", "… 27-09-26", "… 27.09.2026". */
export function fechaDeNombre(nombre) {
  const t = String(nombre ?? "").replace(/\.[a-z0-9]+$/i, "");
  // Se prueban todas las posiciones (los números pueden encimarse: "RIG 91 27-09-26") y gana la última fecha válida.
  const patron = /(?<!\d)(\d{2})[-_. ]?(\d{2})[-_. ]?(\d{4}|\d{2})(?!\d)/y;
  let encontrada = null;
  for (let i = 0; i < t.length; i++) {
    patron.lastIndex = i;
    const m = patron.exec(t);
    if (!m) continue;
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia) {
      encontrada = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }
  return encontrada;
}

/** La hoja y la fila de encabezados del reporte (busca "Código de Artículo" en las primeras filas). */
function ubicarTabla(libro) {
  const hojas = libro.hojas.filter((h) => h.tipo === TIPOS.hoja && h.estado === "visible");
  // Primero la hoja con el nombre del reporte; luego las demás.
  hojas.sort((a, b) => Number(/^rptInvent/i.test(b.nombre)) - Number(/^rptInvent/i.test(a.nombre)));
  for (const info of hojas) {
    const ws = libro.hoja(info.nombre);
    for (let fila = 1; fila <= Math.min(ws.maxFila, 25); fila++) {
      const valores = ws.fila(fila).map(encabezado);
      if (!valores.includes(COLUMNAS_AX.codigo)) continue;
      const columnas = {};
      for (const [campo, titulo] of Object.entries(COLUMNAS_AX)) {
        const i = valores.indexOf(titulo);
        if (i >= 0) columnas[campo] = i + 1;
      }
      return { ws, fila, columnas };
    }
  }
  return null;
}

/**
 * @returns {{ hoja, renglones: [{ fila, codigo, codigo_texto, nombre, modelo, um, almacen, tamano, color,
 *   disponible, valor_financiero, valor_inventario }], almacenes: [{ nombre, renglones }], fechaSugerida, ignoradas }}
 */
export function leerReporteAx(datos, nombreArchivo = "reporte AX.xlsx") {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  const tabla = ubicarTabla(libro);
  if (!tabla) throw new ErrorReporteAx('No encontré la columna "Código de Artículo". ¿Es el reporte de inventario de AX?');
  const { ws, fila: filaEncabezados, columnas } = tabla;
  const faltan = OBLIGATORIAS.filter((c) => !columnas[c]);
  if (faltan.length) throw new ErrorReporteAx(`Al reporte le faltan las columnas: ${faltan.map((c) => COLUMNAS_AX[c]).join(", ")}.`);
  const valor = (f, campo) => (columnas[campo] ? ws.valor(f, columnas[campo]) : null);
  const renglones = [];
  let ignoradas = 0;
  for (let f = filaEncabezados + 1; f <= ws.maxFila; f++) {
    if (!ws.filas.has(f)) continue;
    const codigo = n.codigoAx(valor(f, "codigo"));
    if (codigo === null) {
      ignoradas += 1; // renglón de totales o vacío
      continue;
    }
    renglones.push({
      fila: f,
      codigo,
      codigo_texto: textoCelda(valor(f, "codigo")),
      nombre: textoCelda(valor(f, "nombre")),
      modelo: textoCelda(valor(f, "modelo")),
      um: textoCelda(valor(f, "um")),
      almacen: textoCelda(valor(f, "almacen")),
      tamano: textoCelda(valor(f, "tamano")),
      color: textoCelda(valor(f, "color")),
      disponible: decimalTexto(valor(f, "disponible")) ?? "0",
      valor_financiero: decimalTexto(valor(f, "valor_financiero")),
      valor_inventario: decimalTexto(valor(f, "valor_inventario")),
    });
  }
  const conteo = new Map();
  for (const r of renglones) conteo.set(r.almacen, (conteo.get(r.almacen) ?? 0) + 1);
  return {
    hoja: ws.nombre,
    renglones,
    almacenes: [...conteo].map(([nombre, cuantos]) => ({ nombre, renglones: cuantos })).sort((a, b) => b.renglones - a.renglones),
    fechaSugerida: fechaDeNombre(nombreArchivo),
    ignoradas,
  };
}

/** Solo los renglones del almacén (sin distinguir mayúsculas). Los que no dicen almacén se conservan. */
export function delAlmacen(renglones, almacen) {
  const buscado = n.mayusculas(almacen);
  return renglones.filter((r) => !r.almacen || n.mayusculas(r.almacen) === buscado);
}
