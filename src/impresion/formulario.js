// Hoja-formulario del usuario (p. ej. 'MECANICO ' del libro de vales) convertida a un
// modelo imprimible: área de impresión, anchos, altos, celdas combinadas, estilos, logo
// y la ubicación de cada campo del vale, encontrada por sus etiquetas ("No. folio",
// "Origen:", "CANTIDAD", "Nombre:", …). Así la impresión sale igual que en Excel aunque
// cada hoja tenga las firmas en otra fila.

import { sinAcentos } from "../nucleo/normalizar.js";
import { indiceColumna, separarReferencia } from "../xlsx/celdas.js";
import { EstilosLibro, formatearValor } from "../xlsx/estilos.js";
import { LibroLeido } from "../xlsx/leer.js";
import { carpeta, rutaRels, unir } from "../xlsx/rutas.js";
import { atributos, desescapar } from "../xlsx/xml.js";

const TIPO_DIBUJO = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const EMU_POR_PX = 9525;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };
export const CARTA = { ancho: 8.5, alto: 11 };

export class ErrorFormulario extends Error {}

/** Etiqueta normalizada: 'Departamento:  ' → 'DEPARTAMENTO'. */
export function etiqueta(valor) {
  if (typeof valor !== "string") return "";
  return sinAcentos(valor.toUpperCase()).replace(/\s+/g, " ").replace(/[:\s]+$/, "").trim();
}

const anchoPx = (caracteres) => Math.trunc(((256 * caracteres + Math.trunc(128 / 7)) / 256) * 7);
const altoPx = (puntos) => Math.round((puntos * 96) / 72);

function base64(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 8192) binario += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return typeof btoa === "function" ? btoa(binario) : Buffer.from(binario, "binary").toString("base64");
}

/** Encabezado o pie de página de Excel ('&LFORMATO-PRUEBA &REmision: X') en secciones. */
export function seccionesPie(crudo, nombreHoja = "") {
  if (!crudo) return null;
  const texto = desescapar(crudo);
  const secciones = { izq: "", centro: "", der: "" };
  let actual = "centro";
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch !== "&") {
      secciones[actual] += ch;
      continue;
    }
    const sig = texto[i + 1];
    if (sig === undefined) break;
    if (sig === "&") {
      secciones[actual] += "&";
      i++;
    } else if (sig === "L" || sig === "C" || sig === "R") {
      actual = { L: "izq", C: "centro", R: "der" }[sig];
      i++;
    } else if (sig === '"') {
      i = texto.indexOf('"', i + 2);
      if (i < 0) break;
    } else if (/\d/.test(sig)) {
      while (/\d/.test(texto[i + 1] ?? "")) i++;
    } else {
      const sustituto = { P: "1", N: "1", A: nombreHoja.trim(), D: "", T: "", F: "", Z: "" }[sig];
      if (sustituto !== undefined) secciones[actual] += sustituto;
      i++;
    }
  }
  for (const k of Object.keys(secciones)) secciones[k] = secciones[k].trim();
  return secciones.izq || secciones.centro || secciones.der ? secciones : null;
}

/** Hojas del libro que son formularios de vale (tienen "Origen" y el encabezado de renglones). */
export function hojasFormulario(libro) {
  const salida = [];
  for (const info of libro.hojas) {
    if (info.nombre === "DIARIO") continue;
    const hoja = libro.hoja(info.nombre, { hastaFila: 30 });
    let origen = false;
    let cantidad = false;
    for (const celdas of hoja.filas.values()) {
      for (const v of celdas.values()) {
        const e = etiqueta(v);
        if (e === "ORIGEN") origen = true;
        if (e === "CANTIDAD") cantidad = true;
      }
    }
    if (origen && cantidad) salida.push(info.nombre);
  }
  return salida;
}

function areaImpresion(libro, nombreHoja) {
  const indice = libro.hojas.findIndex((h) => h.nombre === nombreHoja);
  const xml = libro.texto("xl/workbook.xml");
  for (const m of xml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const a = atributos(m[1]);
    if (a.name !== "_xlnm.Print_Area" || a.localSheetId !== String(indice)) continue;
    const primero = desescapar(m[2]).split(",")[0];
    const rango = primero.slice(primero.lastIndexOf("!") + 1).replace(/\$/g, "");
    const [x, y] = rango.split(":");
    const a1 = separarReferencia(x);
    const a2 = separarReferencia(y || x);
    return { c1: a1.columna, r1: a1.fila, c2: a2.columna, r2: a2.fila };
  }
  return null;
}

function leerImagenes(libro, parteHoja) {
  const rel = libro.relaciones(parteHoja).find((r) => r.tipo === TIPO_DIBUJO);
  if (!rel || !libro.existe(rel.destino)) return [];
  const xml = libro.texto(rel.destino);
  const relsDibujo = new Map(libro.relaciones(rel.destino).map((r) => [r.id, r.destino]));
  const imagenes = [];
  const punto = (bloque, nombre) => {
    const m = new RegExp(
      `<xdr:${nombre}>\\s*<xdr:col>(\\d+)</xdr:col>\\s*<xdr:colOff>(-?\\d+)</xdr:colOff>\\s*<xdr:row>(\\d+)</xdr:row>\\s*<xdr:rowOff>(-?\\d+)</xdr:rowOff>\\s*</xdr:${nombre}>`,
    ).exec(bloque);
    return m ? { col: Number(m[1]), colOff: Number(m[2]), row: Number(m[3]), rowOff: Number(m[4]) } : null;
  };
  for (const m of xml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
    const cuerpo = m[2];
    // Solo imágenes sueltas: los grupos y formas son botones de macro (GRABAR, LIMPIAR).
    if (/<xdr:(grpSp|sp|graphicFrame)\b/.test(cuerpo) || !/<xdr:pic\b/.test(cuerpo)) continue;
    const embed = /r:embed="([^"]+)"/.exec(cuerpo)?.[1];
    const ruta = relsDibujo.get(embed);
    const extension = ruta?.split(".").pop().toLowerCase();
    if (!ruta || !MIME[extension] || !libro.existe(ruta)) continue;
    const desde = punto(cuerpo, "from");
    if (!desde) continue;
    const hasta = m[1] === "twoCellAnchor" ? punto(cuerpo, "to") : null;
    const ext = /<xdr:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(cuerpo) || /<a:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(cuerpo);
    imagenes.push({
      desde,
      hasta,
      tamano: ext ? { ancho: Number(ext[1]) / EMU_POR_PX, alto: Number(ext[2]) / EMU_POR_PX } : null,
      src: `data:${MIME[extension]};base64,${base64(libro.bytes(ruta))}`,
    });
  }
  return imagenes;
}

/**
 * @param fuente   bytes del libro de vales o un LibroLeido
 * @returns modelo con celdas, medidas, imágenes, página y campos del vale
 */
export function analizarFormulario(fuente, nombreHoja) {
  const libro = fuente instanceof LibroLeido ? fuente : new LibroLeido(fuente);
  const info = libro.hojas.find((h) => h.nombre === nombreHoja);
  if (!info) throw new ErrorFormulario(`El libro de vales no tiene la hoja '${nombreHoja}'.`);
  const estilos = libro._estilosLibro ?? (libro._estilosLibro = new EstilosLibro(libro));
  const xml = libro.texto(info.parte);

  // ---- página
  const formato = atributos(/<sheetFormatPr\b([^>]*?)\/?>/.exec(xml)?.[1]);
  const altoDefecto = Number(formato.defaultRowHeight || 15);
  const anchoDefecto = Number(formato.defaultColWidth || (formato.baseColWidth ? Number(formato.baseColWidth) + 0.71 : 8.43));
  const configuracion = atributos(/<pageSetup\b([^>]*?)\/?>/.exec(xml)?.[1]);
  const margenes = atributos(/<pageMargins\b([^>]*?)\/?>/.exec(xml)?.[1]);
  const opciones = atributos(/<printOptions\b([^>]*?)\/?>/.exec(xml)?.[1]);
  const ajustarPagina = /<pageSetUpPr\b[^>]*fitToPage="(1|true)"/.test(xml);
  const pagina = {
    horizontal: configuracion.orientation === "landscape",
    escala: Number(configuracion.scale || 100) / 100,
    ajustar: ajustarPagina,
    margenes: {
      izq: Number(margenes.left ?? 0.7),
      der: Number(margenes.right ?? 0.7),
      sup: Number(margenes.top ?? 0.75),
      inf: Number(margenes.bottom ?? 0.75),
    },
    centrado: opciones.horizontalCentered === "1" || opciones.horizontalCentered === "true",
    encabezado: seccionesPie(/<oddHeader\b[^>]*>([\s\S]*?)<\/oddHeader>/.exec(xml)?.[1], nombreHoja),
    pie: seccionesPie(/<oddFooter\b[^>]*>([\s\S]*?)<\/oddFooter>/.exec(xml)?.[1], nombreHoja),
  };

  // ---- columnas
  const columnas = new Map();
  for (const m of (/<cols>([\s\S]*?)<\/cols>/.exec(xml)?.[1] ?? "").matchAll(/<col\b([^>]*?)\/?>/g)) {
    const a = atributos(m[1]);
    for (let c = Number(a.min); c <= Math.min(Number(a.max), 200); c++) {
      columnas.set(c, { ancho: a.width ? Number(a.width) : anchoDefecto, oculta: a.hidden === "1", estilo: a.style ?? null });
    }
  }

  // ---- área de impresión (o lo usado)
  const hoja = libro.hoja(nombreHoja, { hastaFila: 400 });
  const area = areaImpresion(libro, nombreHoja) ?? {
    c1: 1,
    r1: 1,
    c2: Math.max(...[...hoja.filas.values()].flatMap((f) => [...f.keys()]), 1),
    r2: Math.max(hoja.maxFila, 1),
  };

  // ---- filas y estilos de celda (solo dentro del área)
  const filas = new Map();
  const estiloCelda = new Map();
  const datos = xml.slice(xml.indexOf("<sheetData"), xml.indexOf("</sheetData>") + 12);
  for (const f of datos.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const a = atributos(f[1]);
    const r = Number(a.r);
    if (r > area.r2 + 1) break;
    if (r < area.r1 - 1) continue;
    filas.set(r, {
      alto: a.ht ? Number(a.ht) : altoDefecto,
      oculta: a.hidden === "1",
      estilo: a.customFormat === "1" ? (a.s ?? null) : null,
    });
    for (const c of (f[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) {
      const ac = atributos(c[1]);
      if (!ac.r || ac.s === undefined) continue;
      const { fila, columna } = separarReferencia(ac.r);
      // También la celda vecina de fuera del área: su borde puede ser el marco del formato.
      if (columna >= area.c1 - 1 && columna <= area.c2 + 1) estiloCelda.set(`${fila},${columna}`, Number(ac.s));
    }
  }

  // ---- celdas combinadas
  const combinadas = [];
  for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)) {
    const [x, y] = m[1].split(":");
    const a1 = separarReferencia(x);
    const a2 = separarReferencia(y || x);
    if (a2.fila < area.r1 || a1.fila > area.r2 || a2.columna < area.c1 || a1.columna > area.c2) continue;
    combinadas.push({ r1: a1.fila, c1: a1.columna, r2: a2.fila, c2: a2.columna });
  }
  const combinadaEn = new Map();
  for (const rango of combinadas) {
    for (let r = rango.r1; r <= rango.r2; r++) for (let c = rango.c1; c <= rango.c2; c++) combinadaEn.set(`${r},${c}`, rango);
  }

  const columnasVisibles = [];
  for (let c = area.c1; c <= area.c2; c++) {
    const col = columnas.get(c) ?? { ancho: anchoDefecto, oculta: false, estilo: null };
    if (!col.oculta) columnasVisibles.push({ c, px: anchoPx(col.ancho), estilo: col.estilo });
  }
  const filasVisibles = [];
  for (let r = area.r1; r <= area.r2; r++) {
    const fila = filas.get(r) ?? { alto: altoDefecto, oculta: false, estilo: null };
    if (!fila.oculta) filasVisibles.push({ r, px: altoPx(fila.alto), estilo: fila.estilo });
  }

  const modelo = {
    hoja: nombreHoja,
    area,
    pagina,
    columnas: columnasVisibles,
    filas: filasVisibles,
    combinadas,
    combinadaEn,
    estilos,
    imagenes: [],
    valor: (r, c) => hoja.valor(r, c),
    estiloDe(r, c) {
      const propio = estiloCelda.get(`${r},${c}`);
      if (propio !== undefined) return propio;
      const fila = filas.get(r);
      if (fila?.estilo !== null && fila?.estilo !== undefined) return Number(fila.estilo);
      const col = columnas.get(c);
      return col?.estilo !== null && col?.estilo !== undefined ? Number(col.estilo) : 0;
    },
  };
  modelo.texto = (r, c) => formatearValor(modelo.valor(r, c), estilos.codigoFormato(modelo.estiloDe(r, c)));

  // ---- imágenes (posición en px relativa al área)
  const xColumna = (c0) => {
    let x = 0;
    for (const col of columnasVisibles) if (col.c < c0 + 1) x += col.px;
    for (let c = c0 + 1; c < area.c1; c++) x -= anchoPx((columnas.get(c) ?? { ancho: anchoDefecto }).ancho);
    return x;
  };
  const yFila = (r0) => {
    let y = 0;
    for (const fila of filasVisibles) if (fila.r < r0 + 1) y += fila.px;
    for (let r = r0 + 1; r < area.r1; r++) y -= altoPx(filas.get(r)?.alto ?? altoDefecto);
    return y;
  };
  for (const img of leerImagenes(libro, info.parte)) {
    const x = xColumna(img.desde.col) + img.desde.colOff / EMU_POR_PX;
    const y = yFila(img.desde.row) + img.desde.rowOff / EMU_POR_PX;
    let ancho = img.tamano?.ancho ?? 0;
    let alto = img.tamano?.alto ?? 0;
    if (img.hasta) {
      ancho = xColumna(img.hasta.col) + img.hasta.colOff / EMU_POR_PX - x;
      alto = yFila(img.hasta.row) + img.hasta.rowOff / EMU_POR_PX - y;
    }
    const anchoTotal = columnasVisibles.reduce((s, c) => s + c.px, 0);
    const altoTotal = filasVisibles.reduce((s, f) => s + f.px, 0);
    if (x + ancho <= 0 || y + alto <= 0 || x >= anchoTotal || y >= altoTotal) continue; // fuera del área
    modelo.imagenes.push({ x, y, ancho, alto, src: img.src });
  }

  modelo.campos = localizarCampos(modelo);
  modelo.capacidad = modelo.campos.lineas.filas.length;
  return modelo;
}

// ------------------------------------------------------------------ campos

function localizarCampos(modelo) {
  const { area } = modelo;
  const etiquetas = [];
  for (let r = area.r1; r <= area.r2; r++) {
    for (let c = area.c1; c <= area.c2; c++) {
      const e = etiqueta(modelo.valor(r, c));
      if (e) etiquetas.push({ r, c, e });
    }
  }
  const origenDe = (r, c) => {
    const rango = modelo.combinadaEn.get(`${r},${c}`);
    return rango ? { r: rango.r1, c: rango.c1 } : { r, c };
  };
  const derecha = (r, c) => {
    const rango = modelo.combinadaEn.get(`${r},${c}`);
    const siguiente = (rango ? rango.c2 : c) + 1;
    return siguiente <= area.c2 ? origenDe(r, siguiente) : null;
  };
  const buscar = (prueba, desde = area.r1) => etiquetas.find((x) => x.r >= desde && prueba(x.e));

  const campos = {};
  const fecha = buscar((e) => e === "FECHA");
  if (fecha) campos.fecha = derecha(fecha.r, fecha.c);
  const folio = buscar((e) => /^(NO\.? ?)?FOLIO$/.test(e));
  if (folio) campos.folio = derecha(folio.r, folio.c);
  const entrada = buscar((e) => e.startsWith("ENTRADA"));
  if (entrada) campos.entrada = derecha(entrada.r, entrada.c);
  const salida = buscar((e) => e.startsWith("SALIDA"));
  if (salida) campos.salida = derecha(salida.r, salida.c);
  for (const [clave, texto] of [["origen", "ORIGEN"], ["destino", "DESTINO"]]) {
    const x = buscar((e) => e === texto);
    if (!x) continue;
    campos[clave] = derecha(x.r, x.c);
    const depto = etiquetas.find((y) => y.r === x.r && y.c > x.c && y.e.startsWith("DEPARTAMENTO"));
    if (depto) campos[`depto_${clave}`] = derecha(depto.r, depto.c);
  }

  // ---- renglones
  const encabezado = etiquetas.find((x) => x.e === "CANTIDAD" && etiquetas.some((y) => y.r === x.r && y.e.startsWith("CODIGO")));
  if (!encabezado) throw new ErrorFormulario(`La hoja '${modelo.hoja}' no tiene el encabezado de renglones (CANTIDAD, CODIGO…).`);
  const columnasLinea = {};
  for (const x of etiquetas.filter((y) => y.r === encabezado.r)) {
    if (/^O\.? ?C\.?$/.test(x.e)) columnasLinea.oc = x.c;
    else if (x.e === "CANTIDAD") columnasLinea.cantidad = x.c;
    else if (x.e.startsWith("CODIGO")) columnasLinea.codigo = x.c;
    else if (x.e.startsWith("DESCRIPCION")) columnasLinea.descripcion = x.c;
    else if (x.e.startsWith("CLAVE")) columnasLinea.clave = x.c;
    else if (x.e.startsWith("PRESENTACION") || x.e === "UM" || x.e === "U.M" || x.e === "UNIDAD") columnasLinea.um = x.c;
    else if (x.e.startsWith("LOTE")) columnasLinea.lote = x.c;
  }
  const colsLinea = Object.values(columnasLinea);
  const primera = Math.min(...colsLinea);
  const ultima = Math.max(...colsLinea);
  const esFinDeRenglones = (r) => {
    for (let c = primera; c <= ultima; c++) {
      const rango = modelo.combinadaEn.get(`${r},${c}`);
      if (rango && rango.c1 <= primera && rango.c2 >= ultima) return true;
      const e = etiqueta(modelo.valor(r, c));
      if (/^(OBSERVACION|ESTE MATERIAL|MATERIAL SUMINISTRADO|ENTREGO|RECIBIO|FIRMA|NOMBRE|PUESTO|AUTORIZA)/.test(e)) return true;
    }
    return false;
  };
  const filasLinea = [];
  const visibles = new Set(modelo.filas.map((f) => f.r));
  for (let r = encabezado.r + 1; r <= area.r2 && filasLinea.length < 60; r++) {
    if (!visibles.has(r)) continue;
    if (esFinDeRenglones(r)) break;
    filasLinea.push(r);
  }
  campos.lineas = { filas: filasLinea, columnas: columnasLinea };
  const finLineas = filasLinea.length ? filasLinea[filasLinea.length - 1] : encabezado.r;

  // ---- firmas
  const cabezaFirmas = buscar((e) => /^(ENTREG|RECIB|FIRMA|NOMBRE)/.test(e), finLineas + 1);
  const limiteObs = cabezaFirmas ? cabezaFirmas.r : area.r2 + 1;
  const celdasTrasEtiqueta = (x) => {
    const salidaCeldas = [];
    const vistos = new Set();
    for (let c = x.c + 1; c <= area.c2; c++) {
      const o = origenDe(x.r, c);
      const clave = `${o.r},${o.c}`;
      if (vistos.has(clave) || (o.r === x.r && o.c <= x.c)) continue;
      const combinada = modelo.combinadaEn.get(`${x.r},${c}`);
      if (combinada || modelo.valor(x.r, c) !== null) {
        vistos.add(clave);
        salidaCeldas.push(o);
      }
    }
    return salidaCeldas;
  };
  const nombre = buscar((e) => e === "NOMBRE", finLineas + 1);
  if (nombre) {
    const celdas = celdasTrasEtiqueta(nombre);
    if (celdas.length) campos.entrega_nombre = celdas[0];
    if (celdas.length > 1) campos.recibe_nombre = celdas[celdas.length - 1];
  }
  const puesto = buscar((e) => e === "PUESTO", finLineas + 1);
  if (puesto) {
    const celdas = celdasTrasEtiqueta(puesto);
    if (celdas.length) campos.entrega_puesto = celdas[0];
    if (celdas.length > 1) campos.recibe_puesto = celdas[celdas.length - 1];
  }
  // Si la fila de puesto no tiene celdas propias, usa las columnas de la fila de nombre.
  if (puesto && campos.entrega_nombre && !campos.entrega_puesto) campos.entrega_puesto = origenDe(puesto.r, campos.entrega_nombre.c);
  if (puesto && campos.recibe_nombre && !campos.recibe_puesto) campos.recibe_puesto = origenDe(puesto.r, campos.recibe_nombre.c);
  // En algunas hojas (NOV) el almacenista firma del lado derecho: se decide por el puesto.
  const puestoEn = (celda) => etiqueta(celda ? modelo.valor(celda.r, celda.c) : null);
  if (campos.recibe_puesto && /ALMACEN/.test(puestoEn(campos.recibe_puesto)) && !/ALMACEN/.test(puestoEn(campos.entrega_puesto))) {
    [campos.entrega_nombre, campos.recibe_nombre] = [campos.recibe_nombre, campos.entrega_nombre];
    [campos.entrega_puesto, campos.recibe_puesto] = [campos.recibe_puesto, campos.entrega_puesto];
    campos.almacenistaALaDerecha = true;
  }
  const autoriza = buscar((e) => e.startsWith("AUTORIZA"), finLineas + 1);
  if (autoriza) {
    let destino = null;
    for (let r = autoriza.r + 1; r <= Math.min(area.r2, autoriza.r + 4) && !destino; r++) {
      const rango = modelo.combinadaEn.get(`${r},${autoriza.c}`);
      if ((rango && rango.r1 === r) || modelo.valor(r, autoriza.c) !== null) destino = origenDe(r, autoriza.c);
    }
    campos.autoriza = destino ?? origenDe(Math.min(area.r2, autoriza.r + 2), autoriza.c);
  }

  // ---- observaciones: filas entre los renglones y las firmas
  const filasObs = [];
  const textosObs = [];
  for (let r = finLineas + 1; r < limiteObs; r++) {
    if (!visibles.has(r)) continue;
    const valor = modelo.valor(r, primera);
    const e = etiqueta(valor);
    if (e.startsWith("OBSERVACION")) continue;
    filasObs.push(r);
    const texto = typeof valor === "string" ? valor.trim() : null;
    if (texto && !/^\d+$/.test(texto)) textosObs.push({ r, texto });
  }
  campos.observaciones = { filas: filasObs, columna: primera, textos: textosObs };
  return campos;
}
