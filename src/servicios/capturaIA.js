// Captura asistida con un asistente de IA externo (p. ej. Copilot de la cuenta de trabajo).
// La herramienta NO se conecta a nada: da unas instrucciones para copiar, el usuario las pega en
// su asistente junto con la foto o el PDF del vale / de la hoja de conteo, y pega aquí el JSON que
// le devuelve. Aquí se lee ese JSON y se llena el borrador; lo que no se reconoce se reporta para
// revisarlo a mano. Nada se registra hasta que el usuario confirma como siempre.

import { dec, decTexto } from "../nucleo/decimal.js";
import { Indices } from "../nucleo/estado.js";
import { claveEstricta, claveLaxa, codigoAx, fecha as fechaIso, nombrePersona, unidad } from "../nucleo/normalizar.js";
import {
  conRenglonExistente,
  conVarianteNueva,
  contenedorSugerido,
  destinosDeCodigo,
  entradaConArticulo,
  lineaEntradaVacia,
  lineasEntradaCapturadas,
  separarNp,
} from "./entradas.js";
import { nuevoSobrante } from "./conteos.js";
import { ErrorJson, estaIncompleto, leerJsonTolerante } from "./jsonTolerante.js";

export class ErrorCapturaIA extends Error {}

const texto = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? "" : String(v).trim());
const verdadero = (v) => v === true || /^(true|s[ií]|1|yes|verdadero)$/i.test(texto(v));

// ---------------------------------------------------------------- instrucciones para copiar

const REGLAS = [
  "Responde ÚNICAMENTE con un bloque de código ```json con el formato de abajo, sin texto antes ni después.",
  "No inventes datos. Si algo no se lee bien, déjalo como \"\" y pon \"dudoso\": true en esa partida.",
  "Las cantidades van como número (usa punto decimal). Los códigos, tal como están escritos (con sus ceros).",
  "Las fechas en formato AAAA-MM-DD.",
  "Copia los textos en MAYÚSCULAS, tal como aparecen (dimensión, NP, unidad).",
  "Si son varias hojas o fotos, pon todo en un solo bloque.",
];

export const INSTRUCCIONES = {
  entrada: {
    titulo: "Vale de entrada (material recibido)",
    texto: [
      "Te adjunto la foto o el PDF de un vale de material de almacén (formato de vale con partidas).",
      "Extrae el encabezado y TODAS las partidas con datos (ignora las partidas vacías).",
      "En la columna LOTE viene el nombre y apellido de quien solicita el material: cópialo en \"lote\" (vacío si no hay).",
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
          partidas: [
            { oc: "orden de compra o S/OC", cantidad: 0, codigo: "código AX", descripcion: "", dimension: "clave / dimensión", np: "", um: "", lote: "quien solicita", dudoso: false },
          ],
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
      "Extrae SOLO las partidas donde se escribió algo en CONTADO (incluye las partidas en blanco del final que se llenaron a mano).",
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

// Nombres que a veces usa el asistente en lugar de los pedidos (se comparan sin acentos ni signos).
const SINONIMOS = {
  vale: {
    folio: ["folio", "no_folio", "num_folio", "numero_de_folio", "folio_del_vale", "folio_vale", "no_vale", "numero"],
    fecha: ["fecha", "fecha_del_vale", "fecha_vale"],
    viene_de: ["viene_de", "origen", "procedencia", "proviene_de", "desde", "de", "base"],
    entrego: ["entrego", "entrega", "entregado_por", "quien_entrega", "entrego_nombre"],
    partidas: ["partidas", "renglones", "lineas", "items", "materiales", "productos"],
    observaciones: ["observaciones", "notas", "comentarios"],
  },
  partida: {
    oc: ["oc", "o_c", "orden_de_compra", "orden_compra", "pedido"],
    cantidad: ["cantidad", "cant", "qty", "cantidad_recibida", "piezas"],
    codigo: ["codigo", "cod", "codigo_ax", "clave_ax", "code", "no_articulo"],
    descripcion: ["descripcion", "desc", "description", "material"],
    dimension: ["dimension", "clave", "medida", "dimensiones", "clave_dimension", "tamano"],
    np: ["np", "n_p", "no_parte", "numero_de_parte", "num_parte", "part_number"],
    um: ["um", "u_m", "unidad", "unidad_de_medida", "presentacion", "uom"],
    lote: ["lote", "solicita", "solicitante", "solicito", "quien_solicita", "solicitado_por", "pidio"],
    dudoso: ["dudoso", "duda", "revisar", "incierto"],
  },
  conteo: {
    fecha: ["fecha"],
    hojas: ["hojas", "contenedores", "paginas"],
    contenedor: ["contenedor", "hoja", "ubicacion"],
    renglones: ["renglones", "partidas", "lineas", "items"],
  },
  renglon: {
    item: ["item", "no", "num", "numero", "renglon"],
    codigo: ["codigo", "cod", "codigo_ax", "code"],
    descripcion: ["descripcion", "desc", "description"],
    dimension: ["dimension", "clave", "medida", "dimensiones"],
    np: ["np", "n_p", "no_parte", "numero_de_parte", "part_number"],
    um: ["um", "u_m", "unidad", "presentacion"],
    contado: ["contado", "cantidad", "conteo", "cantidad_contada", "fisico", "cant"],
    observaciones: ["observaciones", "notas", "comentarios"],
    dudoso: ["dudoso", "duda", "revisar", "incierto"],
  },
};

const claveNormal = (k) =>
  String(k)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** El objeto con sus nombres llevados a los pedidos (folio, partidas, codigo…). Conserva si venía cortado. */
function conNombres(objeto, tipo) {
  if (!objeto || typeof objeto !== "object" || Array.isArray(objeto)) return objeto;
  const sinonimos = SINONIMOS[tipo];
  const salida = {};
  for (const [k, v] of Object.entries(objeto)) {
    const n = claveNormal(k);
    const canonica = Object.keys(sinonimos).find((c) => c === n || sinonimos[c].includes(n)) ?? n;
    const vacio = salida[canonica] === undefined || salida[canonica] === null || salida[canonica] === "";
    if (vacio) salida[canonica] = v;
  }
  if (estaIncompleto(objeto)) salida.incompleto = true;
  return salida;
}

/** Une varios bloques (p. ej. uno por hoja): las listas se juntan y los datos sueltos se toman del primero que los tenga. */
function unir(valores) {
  if (valores.length === 1) return valores[0];
  const base = {};
  for (const v of valores) {
    const objeto = Array.isArray(v) ? { partidas: v } : v;
    if (!objeto || typeof objeto !== "object") continue;
    for (const [k, x] of Object.entries(objeto)) {
      if (Array.isArray(x)) base[k] = [...(Array.isArray(base[k]) ? base[k] : []), ...x];
      else if (base[k] === undefined || base[k] === null || base[k] === "") base[k] = x;
    }
  }
  return base;
}

/**
 * Lee lo pegado (con o sin ```json, con texto alrededor, uno o varios bloques) y arregla los
 * errores de formato comunes (llaves o corchetes sin cerrar, comas, comillas…).
 * @returns {{ datos, arreglos: [texto] }} arreglos: qué se corrigió solo
 */
export function interpretarRespuesta(pegado) {
  const t = texto(pegado);
  if (!t) throw new ErrorCapturaIA("Pega primero la respuesta del asistente.");
  const bloques = [...t.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g)].map((m) => m[1]).filter((b) => /[{[]/.test(b));
  const fuentes = bloques.length ? bloques : [t];
  const valores = [];
  const arreglos = new Set();
  for (const fuente of fuentes) {
    try {
      const { valor, arreglos: a } = leerJsonTolerante(fuente);
      if (valor && typeof valor === "object") {
        valores.push(valor);
        a.forEach((x) => arreglos.add(x));
      }
    } catch (error) {
      if (!(error instanceof ErrorJson)) throw error;
    }
  }
  if (!valores.length) throw new ErrorCapturaIA("No encontré un bloque JSON en lo que pegaste. Copia el bloque de código completo de la respuesta.");
  return { datos: unir(valores), arreglos: [...arreglos] };
}

/** JSON de la respuesta pegada (ver interpretarRespuesta). */
export function leerRespuesta(pegado) {
  return interpretarRespuesta(pegado).datos;
}

/** Frase para avisar qué se arregló solo. */
export function describirArreglos(arreglos) {
  if (!arreglos?.length) return null;
  const cortada = arreglos.includes("venía cortada");
  const otros = arreglos.filter((a) => a !== "venía cortada");
  const partes = [];
  if (cortada) partes.push("venía cortada (se cerró sola: revisa que no falte nada al final)");
  if (otros.length) partes.push(otros.join(", "));
  return `La respuesta ${partes.join(" y ")}; se corrigió automáticamente.`;
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
 * @returns {{ datos, reporte: { partidas, conRenglon, nuevas, sinCodigo: [n], sinClave: [n], dudosas: [n] } }}
 */
export function aplicarEntradaIA(estado, borrador, respuesta, { indices = new Indices(estado) } = {}) {
  if (!respuesta || typeof respuesta !== "object") throw new ErrorCapturaIA("La respuesta no tiene el formato esperado.");
  respuesta = conNombres(Array.isArray(respuesta) ? { partidas: respuesta } : respuesta, "vale");
  const partidas = Array.isArray(respuesta.partidas) ? respuesta.partidas.filter((p) => p && typeof p === "object").map((p) => conNombres(p, "partida")) : null;
  if (!partidas) throw new ErrorCapturaIA('La respuesta no trae "partidas". ¿Copiaste las instrucciones del vale de entrada?');
  const datos = structuredClone(borrador);
  if (texto(respuesta.folio)) datos.folio_externo = texto(respuesta.folio);
  const fecha = fechaIso(texto(respuesta.fecha));
  if (fecha) datos.fecha = fecha;
  if (texto(respuesta.viene_de)) datos.origen = texto(respuesta.viene_de).toUpperCase();
  if (texto(respuesta.entrego)) datos.entrego_nombre = texto(respuesta.entrego).toUpperCase();
  if (texto(respuesta.observaciones) && !texto(datos.observaciones)) datos.observaciones = texto(respuesta.observaciones).toUpperCase();
  const reporte = { partidas: 0, conRenglon: 0, nuevas: 0, sinCodigo: [], sinClave: [], dudosas: [] };
  const nuevas = [];
  const previas = lineasEntradaCapturadas(datos.lineas).length;
  partidas.forEach((p, i) => {
    const n = previas + i + 1;
    const codigo = codigoAx(texto(p.codigo).replace(/\s/g, ""));
    const dudoso = verdadero(p.dudoso) || Boolean(p.incompleto);
    let linea = {
      ...lineaEntradaVacia(),
      oc: texto(p.oc).toUpperCase() === "S/OC" ? "" : texto(p.oc).toUpperCase(),
      cantidad: cantidadDe(p.cantidad),
      lote: nombrePersona(texto(p.lote)) ?? "",
      ia: true,
      dudoso,
    };
    if (dudoso) reporte.dudosas.push(n);
    if (codigo === null) {
      reporte.sinCodigo.push(n);
      nuevas.push({ ...linea, descripcion: texto(p.descripcion).toUpperCase(), clave: texto(p.dimension).toUpperCase(), um: unidad(p.um) });
      return;
    }
    // Código del catálogo: su descripción (la leída puede venir cortada); código nuevo: la leída.
    const conocido = Boolean(estado.articulos[codigo]);
    linea = entradaConArticulo(estado, linea, codigo, { indices, descripcion: conocido ? null : texto(p.descripcion).toUpperCase() });
    // Si la clave leída trae el NP ("6309-2Z NP: SKF"), el NP va a su campo.
    const separado = separarNp(texto(p.dimension));
    const dimTexto = separado.np ? separado.dimension : texto(p.dimension);
    const npTexto = texto(p.np) || separado.np;
    const dimension = claveEstricta(dimTexto);
    const np = claveEstricta(npTexto);
    const opciones = destinosDeCodigo(estado, codigo, { indices });
    const iguales = opciones.filter((o) => {
      const mismaDim = claveEstricta(o.clave) === dimension || (!dimension && claveEstricta(o.clave) === "");
      return mismaDim && (!np || claveEstricta(o.np) === np);
    });
    const elegida = iguales.find((o) => o.sugerida) ?? iguales[0];
    const sinDestino = linea.existencia_id === null || linea.existencia_id === undefined;
    if (elegida) {
      linea = conRenglonExistente(estado, linea, elegida.id, indices);
      reporte.conRenglon += 1;
    } else if (!dimension && !np && sinDestino && opciones.length) {
      // No se leyó la clave y el código tiene varias en el inventario: se elige de la lista.
      reporte.sinClave.push(n);
    } else if (linea.existencia_id === null || linea.existencia_id === undefined || dimension) {
      // Clave que no está en el inventario: variante nueva, en el contenedor donde ya vive ese código.
      const ubicacionId = contenedorSugerido(estado, codigo, { indices });
      linea = { ...conVarianteNueva(linea, { dimension: dimTexto, np: npTexto, um: texto(p.um) || linea.um, ubicacionId }), alta: true };
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
  if (Array.isArray(respuesta)) respuesta = respuesta.some((x) => x && typeof x === "object" && ("renglones" in x || "contenedor" in x)) ? { hojas: respuesta } : { renglones: respuesta };
  respuesta = conNombres(respuesta, "conteo");
  const crudas = Array.isArray(respuesta.hojas) ? respuesta.hojas : Array.isArray(respuesta.renglones) ? [{ contenedor: respuesta.contenedor, renglones: respuesta.renglones }] : null;
  const hojas = crudas
    ?.filter((h) => h && typeof h === "object")
    .map((h) => {
      const hoja = conNombres(h, "conteo");
      return { ...hoja, renglones: Array.isArray(hoja.renglones) ? hoja.renglones.filter((r) => r && typeof r === "object").map((r) => conNombres(r, "renglon")) : [] };
    });
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
      reporte.noReconocidos.push(`Hoja "${texto(hoja.contenedor) || "sin contenedor"}" (${renglones.length} partidas): no reconocí el contenedor`);
      continue;
    }
    if (!datos.ubicaciones.includes(ubicacion.id)) {
      reporte.fueraDeAlcance.push(`${ubicacion.hoja_excel.trim()} no está en este conteo (${renglones.length} partidas)`);
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
      if (verdadero(r.dudoso) || r.incompleto) reporte.dudosos.push(etiqueta);
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
