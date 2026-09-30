// Lectura del libro de vales (VALES DE SALIDA DLTA.xlsm): DIARIO, formularios y catálogo.
// Solo lee; nunca modifica el archivo. Ver docs/06-formatos-excel.md, sección B.

import * as n from "../nucleo/normalizar.js";
import { indiceColumna } from "../xlsx/celdas.js";
import { LibroLeido } from "../xlsx/leer.js";

export const HOJA_DIARIO = "DIARIO";
export const COLUMNAS_DIARIO = [
  "fecha", "folio", "pase_entrada", "pase_salida", "origen", "depto_origen", "destino",
  "depto_destino", "oc", "cantidad", "codigo", "descripcion", "clave", "um", "lote",
  "entrego", "recibio", "autorizo", "familia", "transferencia_consumo",
];
const ENCABEZADOS_ESPERADOS = ["FECHA", "NO. FOLIO", "PASE DE ENTRADA", "PASE DE SALIDA"];
const FILAS_FORMULARIO = 62;
const COLUMNAS_FORMULARIO = 11;

export class ErrorFormato extends Error {}

/** Texto limpio; el 0 que dejaba la macro en campos vacíos se lee como vacío. */
function textoCeroNulo(valor) {
  if (typeof valor === "number" && valor === 0) return null;
  const texto = n.valorATexto(valor);
  return texto === null || texto === "0" ? null : texto;
}

/** Un renglón del DIARIO tal como está, más sus valores interpretados. */
export function interpretarRenglon(fila, valores) {
  const crudo = COLUMNAS_DIARIO.map((_, i) => valores[i] ?? null);
  const v = Object.fromEntries(COLUMNAS_DIARIO.map((c, i) => [c, crudo[i]]));
  const errores = new Set(COLUMNAS_DIARIO.filter((c) => n.esErrorExcel(v[c])));
  const [cantidad, resto] = n.separarCantidad(v.cantidad);
  return {
    fila,
    crudo,
    fecha: n.fecha(v.fecha),
    folio: n.codigoAx(v.folio),
    pase_entrada: textoCeroNulo(v.pase_entrada),
    pase_salida: textoCeroNulo(v.pase_salida),
    origen: textoCeroNulo(v.origen),
    depto_origen: textoCeroNulo(v.depto_origen),
    destino: textoCeroNulo(v.destino),
    depto_destino: textoCeroNulo(v.depto_destino),
    oc: textoCeroNulo(v.oc),
    cantidad,
    resto_cantidad: resto,
    codigo: n.codigoAx(v.codigo) || null,
    descripcion: textoCeroNulo(v.descripcion),
    clave: textoCeroNulo(v.clave),
    um: textoCeroNulo(v.um),
    lote: textoCeroNulo(v.lote),
    entrego: n.nombrePersona(v.entrego),
    recibio: n.nombrePersona(v.recibio),
    autorizo: n.nombrePersona(v.autorizo),
    familia: textoCeroNulo(v.familia),
    transferencia_consumo: textoCeroNulo(v.transferencia_consumo),
    errores,
  };
}

/** Renglón sin folio ni código (p. ej., todo #REF!). */
export const esPerdido = (r) => r.folio === null && r.codigo === null;

export function leerVales(datos, nombre = "vales.xlsm") {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  if (!libro.nombresHojas.includes(HOJA_DIARIO)) throw new ErrorFormato("El archivo no tiene la hoja DIARIO.");
  const renglones = leerDiario(libro.hoja(HOJA_DIARIO));
  const plantillas = [];
  let catalogo = new Map();
  for (const nombreHoja of libro.nombresHojas) {
    if (nombreHoja === HOJA_DIARIO) continue;
    if (!catalogo.size) {
      const ws = libro.hoja(nombreHoja);
      const plantilla = leerFormulario(nombreHoja, filasFormulario(ws));
      if (plantilla) plantillas.push(plantilla);
      catalogo = leerCatalogoFormulario(ws);
    } else {
      const ws = libro.hoja(nombreHoja, { hastaFila: FILAS_FORMULARIO });
      const plantilla = leerFormulario(nombreHoja, filasFormulario(ws));
      if (plantilla) plantillas.push(plantilla);
    }
  }
  return { nombre, renglones, plantillas, catalogo };
}

function filasFormulario(ws) {
  const filas = [];
  for (let f = 1; f <= FILAS_FORMULARIO; f++) filas.push(ws.fila(f, 1, COLUMNAS_FORMULARIO));
  return filas;
}

export function leerDiario(ws) {
  const encabezado = ws.fila(1, 1, 4).map((x) => n.mayusculas(x) || "");
  if (encabezado.join("|") !== ENCABEZADOS_ESPERADOS.join("|")) {
    throw new ErrorFormato(`Encabezados de DIARIO inesperados: ${ws.fila(1, 1, 4).join(", ")}`);
  }
  const renglones = [];
  for (let fila = 2; fila <= ws.maxFila; fila++) {
    const valores = ws.fila(fila, 1, 20);
    if (valores.some((x) => x !== null)) renglones.push(interpretarRenglon(fila, valores));
  }
  return renglones;
}

function celda(filas, referencia) {
  const columna = indiceColumna(referencia[0]) - 1;
  const fila = Number(referencia.slice(1)) - 1;
  if (fila >= filas.length || columna >= filas[fila].length) return null;
  return filas[fila][columna];
}

/**
 * Lee el encabezado y el bloque de firmas de una hoja-formulario. El bloque de firmas
 * se localiza por etiquetas porque no está en la misma fila en todas las hojas.
 */
export function leerFormulario(hoja, filas) {
  if (!(n.mayusculas(celda(filas, "C17")) || "").includes("ORIGEN")) return null;
  const limite = Math.min(filas.length, 62);
  let filaNombre = null;
  for (let i = 38; i < limite; i++) {
    if ((n.mayusculas(filas[i][2]) || "").startsWith("NOMBRE")) {
      filaNombre = i + 1;
      break;
    }
  }
  let autoriza = null;
  for (let i = 40; i < limite; i++) {
    if ((n.mayusculas(filas[i][6]) || "").startsWith("AUTORIZA")) {
      for (let j = i + 1; j < Math.min(filas.length, i + 4); j++) {
        const nombre = n.nombrePersona(filas[j][6]);
        if (nombre) {
          autoriza = nombre;
          break;
        }
      }
    }
  }
  const observaciones = [];
  const etiquetas = ["OBSERVACION", "ENTREGO", "FIRMA", "NOMBRE", "PUESTO"];
  for (let i = 41; i < Math.min(filas.length, 50); i++) {
    const texto = n.valorATexto(filas[i][2]);
    if (texto && !etiquetas.some((e) => texto.toUpperCase().startsWith(e)) && !/^\d+$/.test(texto)) {
      observaciones.push(texto);
    }
  }
  return {
    hoja,
    origen: n.valorATexto(celda(filas, "E17")),
    depto_origen: n.valorATexto(celda(filas, "I17")),
    destino: n.valorATexto(celda(filas, "E18")),
    depto_destino: n.valorATexto(celda(filas, "I18")),
    entrega_nombre: filaNombre ? n.nombrePersona(celda(filas, `D${filaNombre}`)) : null,
    entrega_puesto: filaNombre ? n.mayusculas(celda(filas, `D${filaNombre + 1}`)) : null,
    recibe_nombre: filaNombre ? n.nombrePersona(celda(filas, `I${filaNombre}`)) : null,
    recibe_puesto: filaNombre ? n.mayusculas(celda(filas, `I${filaNombre + 1}`)) : null,
    autoriza_nombre: autoriza,
    observaciones: observaciones.join("\n") || null,
  };
}

/** Catálogo copiado en las columnas AG:AH de las hojas-formulario. */
export function leerCatalogoFormulario(ws) {
  const catalogo = new Map();
  for (let fila = 6; fila <= ws.maxFila; fila++) {
    const [codigoCelda, descripcion] = ws.fila(fila, 33, 34);
    const codigo = n.codigoAx(codigoCelda);
    if (codigo !== null && descripcion !== null && descripcion !== "" && descripcion !== 0 && descripcion !== false) {
      catalogo.set(codigo, n.valorATexto(descripcion));
    }
  }
  return catalogo;
}
