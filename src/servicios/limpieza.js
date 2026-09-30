// Limpieza del historial DIARIO y agrupación en vales (docs/07-migracion.md).
// Funciones puras: no tocan el estado guardado, así se pueden probar y re-ejecutar.

import { dec } from "../nucleo/decimal.js";
import { esErrorDeDedo } from "../nucleo/catalogo.js";
import * as n from "../nucleo/normalizar.js";
import { esPerdido } from "../importadores/vales.js";

export const CAMPOS_ENCABEZADO = [
  "fecha", "origen", "depto_origen", "destino", "depto_destino", "entrego", "recibio", "autorizo",
];
export const CAMPOS_NORMALIZABLES = ["um", "lote", "origen", "depto_origen", "destino", "depto_destino"];
export const VACIO = "(vacío)";
const PERSONAS = ["entrego", "recibio", "autorizo"];

/** Decisiones del usuario tomadas en la lista de revisión (vacías = sin decisiones). */
export function respuestasVacias() {
  return {
    correcciones: new Map(), // fila → { campo: valor }
    eliminar: new Set(), // filas del DIARIO a omitir
    codigos: new Map(), // código → [código correcto | null, descripción | null]
    alias: new Map(), // variante → nombre correcto
    normalizaciones: new Map(), // `${campo}\u0000${valor}` → valor | null
    advertencias: [],
  };
}

export const claveNormalizacion = (campo, valor) => `${campo}\u0000${valor}`;

/** Igualdad al estilo Python entre valores de celda ya interpretados. */
export function mismoValor(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const x = typeof a === "object" || typeof a === "number" ? dec(a) : null;
  const y = typeof b === "object" || typeof b === "number" ? dec(b) : null;
  if (x !== null && y !== null) return x.eq(y);
  return false;
}

function normalizar(campo, valor, respuestas) {
  const clave = claveNormalizacion(campo, valor ?? VACIO);
  return respuestas.normalizaciones.has(clave) ? respuestas.normalizaciones.get(clave) : valor;
}

function aplicarCorrecciones(renglon, cambios, bitacora) {
  const valores = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    const antes = renglon[campo] ?? null;
    let nuevo;
    if (campo === "cantidad") nuevo = n.separarCantidad(valor)[0];
    else if (campo === "codigo") nuevo = n.codigoAx(valor);
    else if (campo === "fecha") nuevo = n.fecha(valor);
    else if (PERSONAS.includes(campo)) nuevo = n.nombrePersona(valor);
    else {
      nuevo = n.valorATexto(valor);
      if (nuevo === "0") nuevo = null;
    }
    if (!mismoValor(nuevo, antes)) bitacora.push([renglon.fila, campo, antes, nuevo]);
    valores[campo] = nuevo;
  }
  if ("codigo" in valores && !("descripcion" in valores) && valores.codigo !== renglon.codigo) {
    valores.descripcion = null; // se tomará la del catálogo del código corregido
  }
  const errores = new Set([...renglon.errores].filter((c) => !(c in cambios)));
  return { ...renglon, ...valores, errores };
}

function valorEncabezado(campo, valor, respuestas) {
  if (PERSONAS.includes(campo)) return valor ? (respuestas.alias.get(valor) ?? valor) : valor;
  if (CAMPOS_NORMALIZABLES.includes(campo)) {
    const texto = n.valorATexto(valor);
    return normalizar(campo, texto ? texto.trim() : null, respuestas);
  }
  return valor;
}

/**
 * @param renglones  renglones del DIARIO (importadores/vales.js)
 * @param catalogo   Map código → descripción oficial
 */
export function limpiarDiario(renglones, catalogo, respuestas = respuestasVacias()) {
  const omitidos = [];
  const bitacora = [];
  const grupos = new Map();

  for (let renglon of renglones) {
    if (respuestas.eliminar.has(renglon.fila)) {
      omitidos.push([renglon.fila, "Eliminado según la revisión (duplicado o renglón inválido)"]);
      continue;
    }
    if (respuestas.correcciones.has(renglon.fila)) {
      renglon = aplicarCorrecciones(renglon, respuestas.correcciones.get(renglon.fila), bitacora);
    }
    if (respuestas.codigos.has(renglon.codigo)) {
      const [nuevoCodigo] = respuestas.codigos.get(renglon.codigo);
      if (nuevoCodigo && nuevoCodigo !== renglon.codigo) {
        bitacora.push([renglon.fila, "codigo", renglon.codigo, nuevoCodigo]);
        renglon = { ...renglon, codigo: nuevoCodigo, descripcion: null };
      }
    }
    if (esPerdido(renglon)) {
      omitidos.push([renglon.fila, "Renglón perdido: sin folio ni código (#REF!)"]);
      continue;
    }
    if (renglon.folio === null) {
      omitidos.push([renglon.fila, "Renglón sin folio"]);
      continue;
    }
    if (!grupos.has(renglon.folio)) grupos.set(renglon.folio, []);
    grupos.get(renglon.folio).push(renglon);
  }

  const codigosNuevos = new Map();
  const vales = [];
  const folios = [...grupos.keys()].sort((a, b) => a - b);
  for (const folio of folios) {
    const filas = grupos.get(folio);
    const encabezado = {};
    for (const campo of CAMPOS_ENCABEZADO) {
      const valores = filas
        .filter((r) => !r.errores.has(campo))
        .map((r) => valorEncabezado(campo, r[campo], respuestas));
      encabezado[campo] = valores.find((v) => v !== null && v !== undefined) ?? null;
    }
    const lineas = [];
    for (const renglon of filas) {
      const originales = {};
      for (const campo of CAMPOS_ENCABEZADO) {
        if (renglon.errores.has(campo)) continue;
        const propio = valorEncabezado(campo, renglon[campo], respuestas);
        if (propio !== null && propio !== undefined && propio !== encabezado[campo]) originales[campo] = propio;
      }
      let descripcion = renglon.descripcion;
      const notas = [];
      if (renglon.codigo !== null) {
        const oficial = catalogo.get(renglon.codigo);
        if (oficial === undefined || oficial === null) {
          const corregida = respuestas.codigos.get(renglon.codigo)?.[1] ?? null;
          if (!codigosNuevos.has(renglon.codigo)) codigosNuevos.set(renglon.codigo, corregida || descripcion || "");
        } else if (descripcion === null || esErrorDeDedo(descripcion, oficial)) {
          if (descripcion && n.claveLaxa(descripcion) !== n.claveLaxa(oficial)) {
            bitacora.push([renglon.fila, "descripcion", descripcion, oficial]);
          }
          descripcion = oficial;
        }
      }
      if (renglon.resto_cantidad) notas.push(`Cantidad original: ${n.repr(renglon.crudo[9])}`);
      if (renglon.errores.size) notas.push(`Datos perdidos en el DIARIO: ${[...renglon.errores].sort().join(", ")}`);
      lineas.push({
        fila: renglon.fila,
        oc: renglon.oc,
        cantidad: renglon.cantidad,
        codigo: renglon.codigo,
        descripcion,
        clave: renglon.clave,
        um: normalizar("um", n.unidad(renglon.um) || null, respuestas),
        lote: normalizar("lote", renglon.lote, respuestas),
        familia: renglon.familia,
        transferencia_consumo: renglon.transferencia_consumo,
        encabezado_original: originales,
        notas,
      });
    }
    vales.push({ folio, ...encabezado, lineas });
  }

  const faltantes = [];
  if (folios.length) {
    for (let f = folios[0]; f <= folios[folios.length - 1]; f++) if (!grupos.has(f)) faltantes.push(f);
  }
  return { vales, omitidos, correcciones: bitacora, folios_faltantes: faltantes, codigos_nuevos: codigosNuevos };
}
