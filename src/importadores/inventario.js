// Lectura del Excel de inventario físico (INVENTARIO DE REFACCIONAMIENTO…xlsx).
// Solo lee; nunca modifica el archivo. Ver docs/06-formatos-excel.md, sección A.

import { CERO, sumar } from "../nucleo/decimal.js";
import * as n from "../nucleo/normalizar.js";
import { LibroLeido } from "../xlsx/leer.js";
import { TIPOS } from "../xlsx/rutas.js";

export const HOJA_CATALOGO = "ARTICULOS_MX";
export const COLUMNAS = [
  "ITEM", "CODIGO AX", "DESCRIPCIÓN", "DIMENSION", "NP", "CANTIDAD", "UM", "CONSUMO", "INGRESO", "TOTAL",
];
const NOMBRE_HOJA = /CONTENEDOR\s*#?\s*(\d+)\s+(INVENTARIABLE|CONSUMIBLE)/i;

export class ErrorFormato extends Error {}

export function sumaCantidad(hoja) {
  return sumar(...hoja.renglones.map((r) => r.cantidad));
}

export function sumaTotal(hoja) {
  return sumar(...hoja.renglones.map((r) => r.total ?? CERO));
}

/** @returns {{ nombre, hojas: HojaInventario[], catalogo: Map<number,string> }} */
export function leerInventario(datos, nombre = "inventario.xlsx") {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  const hojas = [];
  const hojasTrabajo = libro.hojas.filter((h) => h.tipo === TIPOS.hoja);
  hojasTrabajo.forEach((info, i) => {
    const orden = i + 1;
    const coincidencia = NOMBRE_HOJA.exec(info.nombre);
    if (!coincidencia || info.estado !== "visible") return;
    const ws = libro.hoja(info.nombre);
    const contenedor = Number(coincidencia[1]);
    const clase = coincidencia[2].toUpperCase().startsWith("INV") ? "INV" : "CONS";
    const tabla = ws.tablas()[0] ?? null;
    let minCol, minFila, maxCol, maxFila, conTotales;
    if (tabla) {
      ({ columna: minCol, fila: minFila } = tabla.rango.inicio);
      ({ columna: maxCol, fila: maxFila } = tabla.rango.fin);
      conTotales = tabla.totalsRowCount > 0;
    } else {
      [minCol, minFila, maxCol, maxFila, conTotales] = [1, 1, 10, ws.maxFila, false];
    }
    const encabezados = ws.fila(minFila, minCol, maxCol).map((v) => n.mayusculas(v));
    const indice = {};
    for (const columna of COLUMNAS) {
      const i = encabezados.indexOf(columna);
      if (i >= 0) indice[columna] = i;
    }
    const faltantes = COLUMNAS.filter((c) => !(c in indice));
    if (faltantes.length) {
      throw new ErrorFormato(`La hoja '${info.nombre}' no tiene las columnas ${faltantes.join(", ")}`);
    }
    const notas = ws.comentarios();
    const ultimaDatos = conTotales ? maxFila - 1 : maxFila;
    const hoja = {
      nombre: info.nombre,
      tabla: tabla ? tabla.displayName : null,
      contenedor,
      clase,
      orden,
      fila_totales: conTotales ? maxFila : null,
      renglones: [],
      filas_vacias: [],
    };
    for (let fila = minFila + 1; fila <= ultimaDatos; fila++) {
      const celdas = ws.fila(fila, minCol, maxCol);
      const valor = (columna) => celdas[indice[columna]] ?? null;
      const codigo = n.codigoAx(valor("CODIGO AX"));
      if (codigo === null) {
        hoja.filas_vacias.push(fila);
        continue;
      }
      hoja.renglones.push({
        fila,
        item: n.valorATexto(valor("ITEM")),
        codigo,
        descripcion: n.valorATexto(valor("DESCRIPCIÓN")),
        dimension: n.valorATexto(valor("DIMENSION")),
        np: n.valorATexto(valor("NP")),
        cantidad: n.decimal(valor("CANTIDAD")) ?? CERO,
        um: n.unidad(valor("UM")),
        um_hoja: n.valorATexto(valor("UM")),
        consumo: n.decimal(valor("CONSUMO")),
        ingreso: n.decimal(valor("INGRESO")),
        total: n.decimal(valor("TOTAL")),
        nota: notasDeFila(notas, fila, minCol, maxCol),
      });
    }
    hojas.push(hoja);
  });
  if (!hojas.length) throw new ErrorFormato("No se encontraron hojas 'CONTENEDOR #n INVENTARIABLE/CONSUMIBLE'.");
  const catalogo = libro.nombresHojas.includes(HOJA_CATALOGO) ? leerCatalogoInventario(libro) : new Map();
  return { nombre, hojas, catalogo };
}

function notasDeFila(notas, fila, minCol, maxCol) {
  const textos = [];
  for (const [referencia, texto] of notas) {
    const m = /^([A-Z]+)(\d+)$/.exec(referencia);
    if (!m || Number(m[2]) !== fila) continue;
    const columna = [...m[1]].reduce((v, l) => v * 26 + l.charCodeAt(0) - 64, 0);
    if (columna < minCol || columna > maxCol) continue;
    const limpio = texto.trim();
    if (limpio) textos.push([columna, limpio]);
  }
  textos.sort((a, b) => a[0] - b[0]);
  return textos.map((t) => t[1]).join("\n") || null;
}

/** Hoja oculta ARTICULOS_MX: código → producto. */
export function leerCatalogoInventario(libro) {
  const ws = libro.hoja(HOJA_CATALOGO);
  const catalogo = new Map();
  for (let fila = 1; fila <= ws.maxFila; fila++) {
    const [codigoCelda, descripcion] = ws.fila(fila, 1, 2);
    const codigo = n.codigoAx(codigoCelda);
    if (codigo !== null && descripcion !== null && descripcion !== "" && descripcion !== 0 && descripcion !== false) {
      catalogo.set(codigo, n.valorATexto(descripcion));
    }
  }
  return catalogo;
}
