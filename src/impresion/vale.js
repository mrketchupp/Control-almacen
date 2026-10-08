// Vale imprimible: el modelo de la hoja-formulario (formulario.js) con los datos del vale.
// Genera HTML + CSS de página (carta) sin tocar el DOM, para poder probarlo en Node.

import { dec } from "../nucleo/decimal.js";
import { FechaCelda, serialExcel } from "../nucleo/fechas.js";
import { formatearValor } from "../xlsx/estilos.js";
import { CARTA } from "./formulario.js";
import { imagenesConIdentidad, reemplazarTextos } from "./identidad.js";

const MARCA = "XXXXX";

export function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const clave = (celda) => `${celda.r},${celda.c}`;

/** Texto de observaciones que trae la hoja (igual que lo lee la primera carga). */
export function observacionesDeHoja(modelo) {
  return modelo.campos.observaciones.textos.map((t) => t.texto).join("\n");
}

/**
 * Valores que reemplazan a los de la hoja: Map 'fila,columna' → valor.
 * @param vale  vale emitido o borrador (sin folio)
 */
export function valoresDeVale(modelo, vale) {
  const { campos } = modelo;
  const valores = new Map();
  const poner = (celda, valor) => {
    if (celda) valores.set(clave(celda), valor === "" || valor === undefined ? null : valor);
  };
  poner(campos.fecha, vale.fecha ? new FechaCelda(serialExcel(vale.fecha)) : null);
  poner(campos.folio, vale.folio ?? "BORRADOR");
  poner(campos.entrada, vale.tipo === "ENTRADA" ? MARCA : null);
  poner(campos.salida, vale.tipo === "ENTRADA" ? null : MARCA);
  poner(campos.origen, vale.origen);
  poner(campos.depto_origen, vale.depto_origen);
  poner(campos.destino, vale.destino);
  poner(campos.depto_destino, vale.depto_destino);

  const { filas, columnas } = campos.lineas;
  const cols = Object.values(columnas);
  const primera = Math.min(...cols);
  const ultima = Math.max(...cols);
  filas.forEach((r, i) => {
    for (let c = primera; c <= ultima; c++) valores.set(`${r},${c}`, null);
    const l = vale.lineas[i];
    if (!l) return;
    const cantidad = dec(l.cantidad);
    const celda = (c) => (c === undefined ? null : { r, c });
    poner(celda(columnas.oc), l.oc || "S/OC");
    poner(celda(columnas.cantidad), cantidad === null ? l.cantidad : Number(cantidad.toFixed()));
    poner(celda(columnas.codigo), l.codigo);
    poner(celda(columnas.descripcion), l.descripcion);
    poner(celda(columnas.clave), l.clave);
    poner(celda(columnas.um), l.um);
    poner(celda(columnas.lote), l.lote);
  });

  const obs = campos.observaciones;
  const propias = (vale.observaciones ?? "").trim();
  // Sin observaciones propias (vales migrados) se imprimen las de la hoja.
  if (vale.observaciones !== null && vale.observaciones !== undefined && propias !== observacionesDeHoja(modelo).trim()) {
    for (const t of obs.textos) valores.set(`${t.r},${obs.columna}`, null);
    const inicio = obs.textos.length ? obs.filas.indexOf(obs.textos[0].r) : 0;
    const renglones = propias ? propias.split("\n") : [];
    renglones.forEach((texto, i) => {
      const r = obs.filas[inicio + i];
      if (r !== undefined) valores.set(`${r},${obs.columna}`, texto);
    });
  }

  // El puesto: el del vale; si no trae y es la misma persona que la hoja, el de la hoja.
  const firma = (celdaNombre, celdaPuesto, nombre, puesto) => {
    const nombreHoja = celdaNombre ? String(modelo.valor(celdaNombre.r, celdaNombre.c) ?? "").trim().toUpperCase() : "";
    poner(celdaNombre, nombre);
    if (puesto || !nombre || nombreHoja !== String(nombre).trim().toUpperCase()) poner(celdaPuesto, puesto);
  };
  // Los vales migrados del DIARIO traen las firmas por posición (así las guardaba la macro).
  const porPosicion = vale.migrado && campos.almacenistaALaDerecha;
  const entrega = porPosicion ? [vale.recibio_nombre, vale.recibio_puesto] : [vale.entrego_nombre, vale.entrego_puesto];
  const recibe = porPosicion ? [vale.entrego_nombre, vale.entrego_puesto] : [vale.recibio_nombre, vale.recibio_puesto];
  firma(campos.entrega_nombre, campos.entrega_puesto, ...entrega);
  firma(campos.recibe_nombre, campos.recibe_puesto, ...recibe);
  if (campos.autoriza) firma(campos.autoriza, campos.autoriza_puesto, vale.autorizo_nombre, vale.autorizo_puesto);
  // Segunda fila de firmas (NOV): lo que trae el vale; en blanco si no trae (no los nombres del ejemplo).
  const extra = campos.firmas_extra;
  if (extra) {
    for (const lado of ["izq", "der"]) {
      poner(extra[lado].nombre, vale[`firma_extra_${lado}_nombre`] ?? null);
      poner(extra[lado].puesto, vale[`firma_extra_${lado}_puesto`] ?? null);
    }
  }
  return valores;
}

// Margen alrededor de la tabla: con bordes colapsados, la mitad exterior del marco queda fuera de
// la tabla y el lienzo (overflow hidden) la recortaba; el borde derecho casi no se veía.
const ORILLA = 3;

/**
 * Anchos (o altos) acomodados a la rejilla de píxeles ya escalada: cada orilla de celda cae en un píxel
 * exacto después del zoom, así las líneas salen nítidas (no grises) y las celdas no dejan rendijas.
 */
export function enRejilla(medidas, escala) {
  const salida = [];
  let acumulado = 0;
  let previo = 0;
  for (const m of medidas) {
    acumulado += m;
    const fin = Math.round(acumulado * escala);
    salida.push((fin - previo) / escala);
    previo = fin;
  }
  return salida;
}

/** Grosor de un borde para que, ya con el zoom de la hoja, mida sus píxeles de Excel (1 fino, 2 medio, 3 grueso). */
export function grosorEscalado(borde, escala) {
  return String(borde).replace(/^(\d+(?:\.\d+)?)px/, (_, n) => `${(Number(n) / escala).toFixed(3)}px`);
}

function medidas(modelo) {
  const ancho = modelo.columnas.reduce((s, c) => s + c.px, 0) + 2 * ORILLA;
  const alto = modelo.filas.reduce((s, f) => s + f.px, 0) + 2 * ORILLA;
  const { margenes, horizontal } = modelo.pagina;
  const paginaAncho = (horizontal ? CARTA.alto : CARTA.ancho) - margenes.izq - margenes.der;
  const paginaAlto = (horizontal ? CARTA.ancho : CARTA.alto) - margenes.sup - margenes.inf;
  // Espacio para el pie de página, que aquí se dibuja dentro del área imprimible.
  const reserva = modelo.pagina.pie || modelo.pagina.encabezado ? 0.25 : 0;
  const ajuste = Math.min((paginaAncho * 96) / ancho, ((paginaAlto - reserva) * 96) / alto);
  // Con "ajustar a 1 página" Excel guarda la escala que calculó; se respeta sin salirse de la hoja.
  const escala = Math.min(modelo.pagina.escala || 1, ajuste);
  return { ancho, alto, escala: Math.round(escala * 1000) / 1000, paginaAlto };
}

function cssEnLinea(objeto) {
  return Object.entries(objeto)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * HTML de una página con el vale sobre la hoja-formulario.
 * @param fotos      src (data:/blob:) de las fotos del vale, en el orden de los espacios de la hoja
 * @param identidad  logos y textos del inventario (`identidadDe`): cambian solo lo fijo del formato
 */
export function paginaHtml(modelo, valores = new Map(), fotos = [], identidad = null) {
  const { estilos } = modelo;
  const { escala, paginaAlto } = medidas(modelo);
  // Todo en la rejilla de píxeles ya escalada (ver enRejilla).
  const orilla = Math.max(1, Math.round(ORILLA * escala)) / escala;
  const anchoCol = enRejilla(modelo.columnas.map((c) => c.px), escala);
  const altoFil = enRejilla(modelo.filas.map((f) => f.px), escala);
  const ancho = anchoCol.reduce((a, b) => a + b, 0) + 2 * orilla;
  const alto = altoFil.reduce((a, b) => a + b, 0) + 2 * orilla;
  const xCol = new Map();
  const wCol = new Map();
  modelo.columnas.reduce((x, { c }, i) => (xCol.set(c, x), wCol.set(c, anchoCol[i]), x + anchoCol[i]), 0);
  const yFil = new Map();
  const hFil = new Map();
  modelo.filas.reduce((y, { r }, i) => (yFil.set(r, y), hFil.set(r, altoFil[i]), y + altoFil[i]), 0);
  const fondos = []; // rellenos de color de cada celda, para la capa de abajo (sin rendijas)
  const colVisible = new Set(modelo.columnas.map((c) => c.c));
  const filaVisible = new Set(modelo.filas.map((f) => f.r));
  const fijo = (valor) => (identidad ? reemplazarTextos(valor, identidad.textos) : valor);
  const valorEn = (r, c) => (valores.has(`${r},${c}`) ? valores.get(`${r},${c}`) : fijo(modelo.valor(r, c)));
  const textoEn = (r, c) => formatearValor(valorEn(r, c), estilos.codigoFormato(modelo.estiloDe(r, c)));
  const altoFila = hFil;
  const bordeIzquierdo = (r) =>
    estilos.bordesCss(modelo.estiloDe(r, modelo.area.c1))["border-left"] ||
    estilos.bordesCss(modelo.estiloDe(r, modelo.area.c1 - 1))["border-right"] ||
    null;

  const filasHtml = modelo.filas.map(({ r }) => {
    const px = hFil.get(r);
    const celdas = [];
    for (const { c } of modelo.columnas) {
      const rango = modelo.combinadaEn.get(`${r},${c}`);
      if (rango && (rango.r1 !== r || rango.c1 !== c)) continue;
      let colspan = 1;
      let rowspan = 1;
      let bordes = estilos.bordesCss(modelo.estiloDe(r, c));
      const finCol = rango ? rango.c2 : c;
      const finFila = rango ? rango.r2 : r;
      if (rango) {
        colspan = [...colVisible].filter((x) => x >= rango.c1 && x <= rango.c2).length;
        rowspan = [...filaVisible].filter((x) => x >= rango.r1 && x <= rango.r2).length;
        const der = estilos.bordesCss(modelo.estiloDe(rango.r1, rango.c2));
        const inf = estilos.bordesCss(modelo.estiloDe(rango.r2, rango.c1));
        bordes = { ...bordes, "border-right": der["border-right"], "border-bottom": inf["border-bottom"] };
        for (const lado of ["border-right", "border-bottom"]) if (!bordes[lado]) delete bordes[lado];
      }
      // En las orillas del área, el borde puede venir de la celda vecina de fuera (marco).
      const { area } = modelo;
      if (c === area.c1 && !bordes["border-left"]) {
        const v = estilos.bordesCss(modelo.estiloDe(r, c - 1))["border-right"];
        if (v) bordes["border-left"] = v;
      }
      if (finCol === area.c2 && !bordes["border-right"]) {
        // El marco es parejo: sin borde derecho, se usa el de la celda vecina o el izquierdo de la fila.
        const v = estilos.bordesCss(modelo.estiloDe(r, finCol + 1))["border-left"] || bordeIzquierdo(r);
        if (v) bordes["border-right"] = v;
      }
      if (r === area.r1 && !bordes["border-top"]) {
        const v = estilos.bordesCss(modelo.estiloDe(r - 1, c))["border-bottom"];
        if (v) bordes["border-top"] = v;
      }
      if (finFila === area.r2 && !bordes["border-bottom"]) {
        const v = estilos.bordesCss(modelo.estiloDe(finFila + 1, c))["border-top"];
        if (v) bordes["border-bottom"] = v;
      }
      for (const lado of Object.keys(bordes)) bordes[lado] = grosorEscalado(bordes[lado], escala);
      const estilo = estilos.css(modelo.estiloTextoDe?.(r, c) ?? modelo.estiloDe(r, c));
      const valor = valorEn(r, c);
      const texto = textoEn(r, c);
      const css = { ...estilo.css, ...bordes };
      if (modelo.centradas?.has(`${r},${c}`)) css["text-align"] = "center";
      const fondo = estilos.css(modelo.estiloDe(r, c)).css.background;
      if (fondo && !/^#?(fff|ffffff)$/i.test(fondo.replace("#", ""))) {
        let w = 0;
        for (const x of colVisible) if (x >= c && x <= finCol) w += wCol.get(x);
        let h = 0;
        for (const y of filaVisible) if (y >= r && y <= finFila) h += hFil.get(y);
        fondos.push({ x: xCol.get(c), y: yFil.get(r), w, h, fondo });
      }
      if (!estilo.alineado && typeof valor === "number") css["text-align"] = "right";
      if (!estilo.ajustar) {
        css["white-space"] = "nowrap";
        const siguiente = (rango ? rango.c2 : c) + 1;
        css.overflow = siguiente <= modelo.area.c2 && textoEn(r, siguiente) ? "hidden" : "visible";
      }
      const atributos = `${colspan > 1 ? ` colspan="${colspan}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}`;
      // Excel recorta el texto que no cabe en la altura de la fila (filas espaciadoras de 1-2 px);
      // en HTML la fila crecería, así que se recorta igual.
      let contenido = escaparHtml(texto);
      if (texto !== "") {
        let altura = 0;
        for (let f = r; f <= finFila; f++) altura += altoFila.get(f) ?? 0;
        const puntos = Number.parseFloat(css["font-size"]) || 11;
        const linea = puntos * (96 / 72);
        // En una fila espaciadora (1–2 px) Excel no deja ver nada del texto: no se imprime.
        if (altura < linea * 0.3) contenido = "";
        else if (altura < linea * 1.1) contenido = `<div style="height:${+altura.toFixed(3)}px;overflow:hidden">${contenido}</div>`;
      }
      celdas.push(`<td${atributos} style="${escaparHtml(cssEnLinea(css))}">${contenido}</td>`);
    }
    return `<tr style="height:${+px.toFixed(3)}px">${celdas.join("")}</tr>`;
  });
  const columnas = anchoCol.map((w) => `<col style="width:${w.toFixed(3)}px">`).join("");
  const imagenes = imagenesConIdentidad(modelo.imagenes, identidad)
    .map(
      (i) =>
        `<img alt="" src="${i.src}" style="left:${(i.x + orilla).toFixed(1)}px;top:${(i.y + orilla).toFixed(1)}px;width:${i.ancho.toFixed(1)}px;height:${i.alto.toFixed(1)}px">`,
    )
    .join("") +
    (modelo.fotos ?? [])
      .map((f, i) =>
        fotos[i]
          ? `<img alt="" class="vale-foto" src="${escaparHtml(fotos[i])}" style="left:${(f.x + orilla).toFixed(1)}px;top:${(f.y + orilla).toFixed(1)}px;width:${f.ancho.toFixed(1)}px;height:${f.alto.toFixed(1)}px">`
          : "",
      )
      .join("");
  const centrado = modelo.pagina.centrado ? "margin-left:auto;margin-right:auto;" : "";
  const seccion = (partes, clase) =>
    partes
      ? `<div class="${clase}"><span>${escaparHtml(fijo(partes.izq))}</span><span>${escaparHtml(fijo(partes.centro))}</span><span>${escaparHtml(fijo(partes.der))}</span></div>`
      : "";
  return (
    `<section class="vale-pagina" style="height:${(paginaAlto - 0.02).toFixed(2)}in">` +
    seccion(modelo.pagina.encabezado, "vale-encabezado") +
    `<div class="vale-lienzo" style="${centrado}width:${ancho.toFixed(3)}px;height:${alto.toFixed(3)}px;padding:${orilla.toFixed(3)}px;zoom:${escala}">` +
    capaFondos(fondos, orilla) +
    `<table class="vale-tabla" style="width:${(ancho - 2 * orilla).toFixed(3)}px"><colgroup>${columnas}</colgroup><tbody>${filasHtml.join("")}</tbody></table>` +
    `${imagenes}</div>${seccion(modelo.pagina.pie, "vale-pie")}</section>`
  );
}

/**
 * Capa de color debajo de la tabla: los rellenos iguales y contiguos se juntan en un solo rectángulo, así
 * entre celda y celda (franjas moradas, encabezados amarillos) no se cuela una rendija blanca al escalar.
 * Las celdas conservan su propio relleno encima.
 */
export function capaFondos(fondos, orilla = 0) {
  const cerca = (a, b) => Math.abs(a - b) < 0.01;
  const juntar = (lista, clave, inicio, largo) => {
    const grupos = new Map();
    for (const f of lista) {
      const k = clave(f);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push({ ...f });
    }
    const salida = [];
    for (const grupo of grupos.values()) {
      grupo.sort((a, b) => a[inicio] - b[inicio]);
      for (const f of grupo) {
        const ultimo = salida[salida.length - 1];
        if (ultimo && clave(ultimo) === clave(f) && cerca(ultimo[inicio] + ultimo[largo], f[inicio])) ultimo[largo] = f[inicio] + f[largo] - ultimo[inicio];
        else salida.push(f);
      }
    }
    return salida;
  };
  const filas = juntar(fondos, (f) => `${f.y.toFixed(2)}|${f.h.toFixed(2)}|${f.fondo}`, "x", "w");
  const bloques = juntar(filas, (f) => `${f.x.toFixed(2)}|${f.w.toFixed(2)}|${f.fondo}`, "y", "h");
  return bloques
    .map(
      (f) =>
        `<div class="vale-fondo" style="left:${(f.x + orilla).toFixed(3)}px;top:${(f.y + orilla).toFixed(3)}px;width:${f.w.toFixed(3)}px;height:${f.h.toFixed(3)}px;background:${f.fondo}"></div>`,
    )
    .join("");
}

/** CSS de impresión: tamaño carta y márgenes de la hoja. */
export function cssImpresion(modelo) {
  const { margenes, horizontal } = modelo.pagina;
  return (
    `@page{size:letter ${horizontal ? "landscape" : "portrait"};margin:${margenes.sup}in ${margenes.der}in ${margenes.inf}in ${margenes.izq}in}` +
    ".vale-pagina{position:relative;overflow:hidden;break-after:page;page-break-after:always}.vale-pagina:last-child{break-after:auto;page-break-after:auto}" +
    ".vale-pie,.vale-encabezado{display:flex;justify-content:space-between;font:7pt Arial,sans-serif;color:#000}" +
    ".vale-pie{position:absolute;left:0;right:0;bottom:0}.vale-pie span,.vale-encabezado span{flex:1}.vale-pie span:nth-child(2),.vale-encabezado span:nth-child(2){text-align:center}.vale-pie span:last-child,.vale-encabezado span:last-child{text-align:right}" +
    ".vale-pagina,.vale-pagina *{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".vale-lienzo{position:relative;overflow:hidden;box-sizing:border-box;background:#fff;color:#000}" +
    ".vale-tabla{position:relative;table-layout:fixed;border-collapse:collapse;color:#000}" +
    ".vale-fondo{position:absolute}" +
    ".vale-tabla td{padding:0 2px;line-height:1.1;box-sizing:border-box}" +
    ".vale-lienzo img{position:absolute}.vale-lienzo img.vale-foto{object-fit:cover}"
  );
}

/**
 * Documento para imprimir varios vales (uno por hoja).
 * @param paginas    [{ modelo, vale }]
 * @param identidad  logos y textos del inventario (`identidadDe(estado)`)
 */
export function documentoImpresion(paginas, identidad = null) {
  if (!paginas.length) return { css: "", html: "" };
  return {
    css: cssImpresion(paginas[0].modelo),
    html: paginas.map(({ modelo, vale, fotos = [] }) => paginaHtml(modelo, valoresDeVale(modelo, vale), fotos, identidad)).join(""),
  };
}
