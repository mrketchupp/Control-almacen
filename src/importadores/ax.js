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
  sitio: "SITIO",
  cantidad_financiera: "CANTIDAD FINANCIERA",
};
// El Kardex de auditoría (base oficial) trae además lo que llenó el conteo.
export const COLUMNAS_CONTEO = { conteo: ["CONTEO FISICO", "CONTEO"], contenedor: ["CONTENEDOR"] };
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

/**
 * Las hojas con la tabla del reporte (busca "Código de Artículo" en las primeras filas), cada una con su
 * fila de encabezados. Un libro puede traer varias (el Kardex de auditoría trae una por inventario).
 */
function ubicarTablas(libro) {
  const hojas = libro.hojas.filter((h) => h.tipo === TIPOS.hoja && h.estado === "visible");
  // Primero la hoja con el nombre del reporte; luego las demás.
  hojas.sort((a, b) => Number(/^rptInvent/i.test(b.nombre)) - Number(/^rptInvent/i.test(a.nombre)));
  const tablas = [];
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
      for (const [campo, titulos] of Object.entries(COLUMNAS_CONTEO)) {
        const i = titulos.map((t) => valores.indexOf(t)).find((x) => x >= 0);
        if (i !== undefined) columnas[campo] = i + 1;
      }
      tablas.push({ ws, fila, columnas });
      break;
    }
  }
  return tablas;
}

function leerTabla({ ws, fila: filaEncabezados, columnas }) {
  const faltan = OBLIGATORIAS.filter((c) => !columnas[c]);
  if (faltan.length) throw new ErrorReporteAx(`A la hoja ${ws.nombre} le faltan las columnas: ${faltan.map((c) => COLUMNAS_AX[c]).join(", ")}.`);
  const valor = (f, campo) => (columnas[campo] ? ws.valor(f, columnas[campo]) : null);
  const conConteo = Boolean(columnas.conteo);
  const renglones = [];
  let ignoradas = 0;
  for (let f = filaEncabezados + 1; f <= ws.maxFila; f++) {
    if (!ws.filas.has(f)) continue;
    const codigo = n.codigoAx(valor(f, "codigo"));
    if (codigo === null) {
      ignoradas += 1; // renglón de totales o vacío
      continue;
    }
    const renglon = {
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
    };
    if (columnas.sitio) renglon.sitio = textoCelda(valor(f, "sitio"));
    if (columnas.cantidad_financiera) renglon.cantidad_financiera = decimalTexto(valor(f, "cantidad_financiera"));
    if (conConteo) {
      renglon.conteo = decimalTexto(valor(f, "conteo"));
      renglon.contenedor = textoCelda(valor(f, "contenedor"));
    }
    renglones.push(renglon);
  }
  const conteo = new Map();
  for (const r of renglones) conteo.set(r.almacen, (conteo.get(r.almacen) ?? 0) + 1);
  return {
    hoja: ws.nombre,
    renglones,
    almacenes: [...conteo].map(([nombre, cuantos]) => ({ nombre, renglones: cuantos })).sort((a, b) => b.renglones - a.renglones),
    ignoradas,
    conConteo,
  };
}

/**
 * @returns {{ hoja, renglones: [{ fila, codigo, codigo_texto, nombre, modelo, um, almacen, tamano, color,
 *   disponible, valor_financiero, valor_inventario, sitio?, cantidad_financiera?, conteo?, contenedor? }],
 *   almacenes: [{ nombre, renglones }], fechaSugerida, ignoradas, tablas }}
 *   La primera tabla va arriba; `tablas` = todas las hojas con el reporte (mismo formato), para elegir la
 *   del inventario abierto (Ronda 20: el Kardex de auditoría trae FX, GSM y DLTA en el mismo libro).
 */
export function leerReporteAx(datos, nombreArchivo = "reporte AX.xlsx") {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  const encontradas = ubicarTablas(libro);
  if (!encontradas.length) throw new ErrorReporteAx('No encontré la columna "Código de Artículo". ¿Es el reporte de inventario de AX?');
  const tablas = [];
  let error = null;
  for (const t of encontradas) {
    try {
      tablas.push(leerTabla(t));
    } catch (e) {
      if (!(e instanceof ErrorReporteAx)) throw e;
      error ??= e;
    }
  }
  if (!tablas.length) throw error;
  return { ...tablas[0], fechaSugerida: fechaDeNombre(nombreArchivo), tablas };
}

/** Solo los renglones del almacén (sin distinguir mayúsculas). Los que no dicen almacén se conservan. */
export function delAlmacen(renglones, almacen) {
  const buscado = n.mayusculas(almacen);
  return renglones.filter((r) => !r.almacen || n.mayusculas(r.almacen) === buscado);
}
