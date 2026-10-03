// Captura asistida con un asistente de IA externo (p. ej. Copilot de la cuenta de trabajo).
// La herramienta NO se conecta a nada: da unas instrucciones para copiar, el usuario las pega en
// su asistente junto con la foto o el PDF del vale / de la hoja de conteo, y pega aquí el JSON que
// le devuelve. Aquí se lee ese JSON y se llena el borrador; lo que no se reconoce se reporta para
// revisarlo a mano. Nada se registra hasta que el usuario confirma como siempre.

import { dec, decTexto } from "../nucleo/decimal.js";
import { Indices } from "../nucleo/estado.js";
import { claveEstricta, claveLaxa, codigoAx, fecha as fechaIso, unidad } from "../nucleo/normalizar.js";
import { conRenglonExistente, conVarianteNueva, destinosDeCodigo, entradaConArticulo, lineaEntradaVacia, lineasEntradaCapturadas } from "./entradas.js";
import { nuevoSobrante } from "./conteos.js";

export class ErrorCapturaIA extends Error {}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ---------------------------------------------------------------- instrucciones para copiar

const REGLAS = [
  "Responde ÚNICAMENTE con un bloque de código ```json con el formato de abajo, sin texto antes ni después.",
  "No inventes datos. Si algo no se lee bien, déjalo como \"\" y pon \"dudoso\": true en ese renglón.",
  "Las cantidades van como número (usa punto decimal). Los códigos, tal como están escritos (con sus ceros).",
  "Las fechas en formato AAAA-MM-DD.",
  "Copia los textos en MAYÚSCULAS, tal como aparecen (dimensión, NP, unidad).",
];

export const INSTRUCCIONES = {
  entrada: {
    titulo: "Vale de entrada (material recibido)",
    texto: [
      "Te adjunto la foto o el PDF de un vale de material de almacén (formato de vale con renglones).",
      "Extrae el encabezado y TODOS los renglones con datos (ignora los renglones vacíos).",
      ...REGLAS,
      "Formato:",
      "```json",
      JSON.stringify(
        {
          tipo: "vale_entrada",
          folio: "número de folio del vale",
          fecha: "AAAA-MM-DD",
          viene_de: "origen (base o equipo)",
          entrego: "nombre de quien entrega",
          partidas: [{ oc: "orden de compra o S/OC", cantidad: 0, codigo: "código AX", descripcion: "", dimension: "clave / dimensión", np: "", um: "", dudoso: false }],
        },
        null,
        2,
      ),
      "```",
    ].join("\n"),
  },
  conteo: {
    titulo: "Hoja de conteo (lo anotado a mano)",
    texto: [
      "Te adjunto la foto o el PDF de una o varias hojas de conteo físico de almacén.",
      "Cada hoja dice arriba su contenedor (por ejemplo \"CONTENEDOR #1 INVENTARIABLE\") y tiene las columnas ITEM, CÓDIGO, DESCRIPCIÓN, DIMENSIÓN, NP, UM, CONTADO y OBSERVACIONES.",
      "Extrae SOLO los renglones donde se escribió algo en CONTADO (incluye los renglones en blanco del final que se llenaron a mano).",
      ...REGLAS,
      "Formato:",
      "```json",
      JSON.stringify(
        {
          tipo: "conteo",
          fecha: "AAAA-MM-DD",
          hojas: [{ contenedor: "CONTENEDOR #1 INVENTARIABLE", renglones: [{ item: 1, codigo: "701", dimension: "", np: "", um: "", contado: 0, observaciones: "", dudoso: false }] }],
        },
        null,
        2,
      ),
      "```",
    ].join("\n"),
  },
};

// ---------------------------------------------------------------- leer lo pegado

/** JSON de la respuesta pegada (con o sin ```json, con texto alrededor). */
export function leerRespuesta(pegado) {
  const t = texto(pegado);
  if (!t) throw new ErrorCapturaIA("Pega primero la respuesta del asistente.");
  const bloque = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  let cuerpo = bloque ? bloque[1] : t;
  const inicio = cuerpo.indexOf("{");
  const fin = cuerpo.lastIndexOf("}");
  if (inicio < 0 || fin < inicio) throw new ErrorCapturaIA("No encontré un bloque JSON en lo que pegaste. Copia el bloque de código completo de la respuesta.");
  cuerpo = cuerpo.slice(inicio, fin + 1).replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cuerpo);
  } catch (error) {
    throw new ErrorCapturaIA(`El JSON pegado está incompleto o mal formado (${error.message}). Copia otra vez el bloque de código completo.`);
  }
}

const cantidadDe = (v) => {
  const n = dec(typeof v === "string" ? v.replace(",", ".").replace(/[^\d.\-]/g, "") : v);
  return n === null ? "" : decTexto(n);
};

// ---------------------------------------------------------------- vale de entrada

/**
 * Llena un borrador de entrada con la respuesta del asistente. Las partidas se agregan después de
 * las que ya tenía; cada una busca su renglón del inventario por código + dimensión/NP y, si no lo
 * encuentra, queda como variante nueva por revisar.
 * @returns {{ datos, reporte: { partidas, conRenglon, nuevas, sinCodigo: [n], dudosas: [n] } }}
 */
export function aplicarEntradaIA(estado, borrador, respuesta, { indices = new Indices(estado) } = {}) {
  if (!respuesta || typeof respuesta !== "object") throw new ErrorCapturaIA("La respuesta no tiene el formato esperado.");
  const partidas = Array.isArray(respuesta.partidas) ? respuesta.partidas : Array.isArray(respuesta.renglones) ? respuesta.renglones : null;
  if (!partidas) throw new ErrorCapturaIA('La respuesta no trae "partidas". ¿Copiaste las instrucciones del vale de entrada?');
  const datos = structuredClone(borrador);
  if (texto(respuesta.folio)) datos.folio_externo = texto(respuesta.folio);
  const fecha = fechaIso(texto(respuesta.fecha));
  if (fecha) datos.fecha = fecha;
  if (texto(respuesta.viene_de)) datos.origen = texto(respuesta.viene_de).toUpperCase();
  if (texto(respuesta.entrego)) datos.entrego_nombre = texto(respuesta.entrego).toUpperCase();
  const reporte = { partidas: 0, conRenglon: 0, nuevas: 0, sinCodigo: [], dudosas: [] };
  const nuevas = [];
  const previas = lineasEntradaCapturadas(datos.lineas).length;
  partidas.forEach((p, i) => {
    const n = previas + i + 1;
    const codigo = codigoAx(texto(p.codigo).replace(/\s/g, ""));
    let linea = { ...lineaEntradaVacia(), oc: texto(p.oc).toUpperCase() === "S/OC" ? "" : texto(p.oc).toUpperCase(), cantidad: cantidadDe(p.cantidad), ia: true, dudoso: Boolean(p.dudoso) };
    if (p.dudoso) reporte.dudosas.push(n);
    if (codigo === null) {
      reporte.sinCodigo.push(n);
      nuevas.push({ ...linea, descripcion: texto(p.descripcion).toUpperCase(), clave: texto(p.dimension).toUpperCase(), um: unidad(p.um) });
      return;
    }
    linea = entradaConArticulo(estado, linea, codigo, { indices, descripcion: texto(p.descripcion).toUpperCase() || null });
    if (!estado.articulos[codigo]) linea.descripcion = texto(p.descripcion).toUpperCase();
    const dimension = claveEstricta(p.dimension);
    const np = claveEstricta(p.np);
    const opciones = destinosDeCodigo(estado, codigo, { indices });
    const iguales = opciones.filter((o) => {
      const mismaDim = claveEstricta(o.clave) === dimension || (!dimension && claveEstricta(o.clave) === "");
      return mismaDim && (!np || claveEstricta(o.np) === np);
    });
    const elegida = iguales.find((o) => o.sugerida) ?? iguales[0];
    if (elegida) {
      linea = conRenglonExistente(estado, linea, elegida.id, indices);
      reporte.conRenglon += 1;
    } else if (linea.existencia_id === null || linea.existencia_id === undefined || dimension) {
      linea = { ...conVarianteNueva(linea, { dimension: texto(p.dimension), np: texto(p.np), um: texto(p.um) || linea.um }), alta: true };
      reporte.nuevas += 1;
    } else {
      reporte.conRenglon += 1;
    }
    if (!texto(linea.um) && texto(p.um)) linea.um = unidad(p.um);
    nuevas.push(linea);
  });
  reporte.partidas = nuevas.length;
  datos.lineas = [...lineasEntradaCapturadas(datos.lineas), ...nuevas, lineaEntradaVacia()];
  return { datos, reporte };
}

// ---------------------------------------------------------------- conteo físico

/** Ubicación por el nombre que trae la hoja ("CONTENEDOR #1 INVENTARIABLE", "#1 Inv.", "C1 CONS"…). */
export function ubicacionPorNombre(estado, nombre) {
  const t = claveLaxa(nombre);
  if (!t) return null;
  const exacta = estado.ubicaciones.find((u) => claveLaxa(u.hoja_excel) === t);
  if (exacta) return exacta;
  const numero = /(\d+)/.exec(t)?.[1];
  const clase = /CONS/.test(t) ? "CONS" : /INV/.test(t) ? "INV" : null;
  const candidatas = estado.ubicaciones.filter((u) => String(u.contenedor) === numero && (!clase || u.clase === clase));
  return candidatas.length === 1 ? candidatas[0] : null;
}

/**
 * Carga lo contado que devolvió el asistente en el conteo en captura. Cada renglón se ubica por su
 * contenedor + ITEM (la posición en la hoja de conteo) y se confirma con el código; si no coincide,
 * se busca por código + dimensión en ese contenedor. Lo que no está en la lista entra como renglón
 * encontrado. Lo dudoso o no reconocido se reporta.
 * @returns {{ datos, reporte: { capturados, sobrantes, fueraDeAlcance: [texto], noReconocidos: [texto], dudosos: [texto] } }}
 */
export function aplicarConteoIA(estado, conteo, respuesta, { indices = new Indices(estado) } = {}) {
  if (!respuesta || typeof respuesta !== "object") throw new ErrorCapturaIA("La respuesta no tiene el formato esperado.");
  const hojas = Array.isArray(respuesta.hojas) ? respuesta.hojas : Array.isArray(respuesta.renglones) ? [{ contenedor: respuesta.contenedor, renglones: respuesta.renglones }] : null;
  if (!hojas) throw new ErrorCapturaIA('La respuesta no trae "hojas". ¿Copiaste las instrucciones de la hoja de conteo?');
  const datos = structuredClone(conteo);
  const fecha = fechaIso(texto(respuesta.fecha));
  if (fecha) datos.fecha = fecha;
  const reporte = { capturados: 0, sobrantes: 0, fueraDeAlcance: [], noReconocidos: [], dudosos: [] };
  const unaSola = datos.ubicaciones.length === 1 ? indices.ubicacion(datos.ubicaciones[0]) : null;
  for (const hoja of hojas) {
    const ubicacion = ubicacionPorNombre(estado, hoja.contenedor) ?? (hojas.length === 1 ? unaSola : null);
    const renglones = Array.isArray(hoja.renglones) ? hoja.renglones : [];
    if (!ubicacion) {
      reporte.noReconocidos.push(`Hoja "${texto(hoja.contenedor) || "sin contenedor"}" (${renglones.length} renglones): no reconocí el contenedor`);
      continue;
    }
    if (!datos.ubicaciones.includes(ubicacion.id)) {
      reporte.fueraDeAlcance.push(`${ubicacion.hoja_excel.trim()} no está en este conteo (${renglones.length} renglones)`);
      continue;
    }
    const lista = estado.existencias.filter((e) => e.ubicacion_id === ubicacion.id && e.activo !== false).sort((a, b) => a.orden - b.orden);
    for (const r of renglones) {
      const contado = cantidadDe(r.contado);
      const codigo = codigoAx(texto(r.codigo).replace(/\s/g, ""));
      const etiqueta = `${ubicacion.hoja_excel.trim()} · ${r.item ? `ITEM ${r.item} · ` : ""}${codigo ?? "sin código"} ${texto(r.dimension)}`.trim();
      if (contado === "") {
        reporte.noReconocidos.push(`${etiqueta}: no se leyó la cantidad`);
        continue;
      }
      if (r.dudoso) reporte.dudosos.push(etiqueta);
      const porItem = Number.isInteger(Number(r.item)) && Number(r.item) > 0 ? lista[Number(r.item) - 1] : null;
      const codigoDe = (e) => indices.variante(e.variante_id)?.codigo;
      let renglon = porItem && (codigo === null || codigoDe(porItem) === codigo) ? porItem : null;
      if (!renglon && codigo !== null) {
        const mismos = lista.filter((e) => codigoDe(e) === codigo);
        const dim = claveEstricta(r.dimension);
        // Con dimensión, debe coincidir; sin dimensión, solo si ese código tiene un único renglón ahí.
        renglon = dim ? (mismos.find((e) => indices.variante(e.variante_id).dimension_clave === dim) ?? null) : mismos.length === 1 ? mismos[0] : null;
      }
      if (renglon) {
        datos.capturas = { ...datos.capturas, [renglon.id]: contado };
        reporte.capturados += 1;
      } else if (codigo !== null) {
        datos.nuevos = [
          ...(datos.nuevos ?? []),
          { ...nuevoSobrante(ubicacion.id), codigo, descripcion: (estado.articulos[codigo]?.descripcion ?? texto(r.descripcion)).toUpperCase(), dimension: texto(r.dimension).toUpperCase(), np: texto(r.np).toUpperCase(), um: unidad(r.um), cantidad: contado },
        ];
        reporte.sobrantes += 1;
      } else {
        reporte.noReconocidos.push(`${etiqueta}: sin código ni ITEM que coincida`);
      }
    }
  }
  return { datos, reporte };
}
