// Utilidades de texto XML. Los libros se editan como texto (sin reconstruir el
// árbol) para que todo lo que no se toca quede byte a byte igual.

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function desescapar(texto) {
  if (!texto || texto.indexOf("&") < 0) return texto;
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] === "#") {
      const codigo = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(codigo);
    }
    return ENTIDADES[e];
  });
}

export function escaparTexto(texto) {
  return String(texto).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escaparAtributo(texto) {
  return escaparTexto(texto)
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

/** Excel codifica caracteres de control como _xHHHH_. */
export function desescaparX(texto) {
  if (!texto || texto.indexOf("_x") < 0) return texto;
  return texto.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function escaparX(texto) {
  return String(texto)
    .replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`);
}

/** Atributos de una etiqueta: 'r="A1" s="3"' → { r: "A1", s: "3" } (en orden). */
export function atributos(texto) {
  const salida = {};
  if (!texto) return salida;
  const patron = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = patron.exec(texto))) salida[m[1]] = desescapar(m[2] !== undefined ? m[2] : m[3]);
  return salida;
}

export function atributosATexto(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escaparAtributo(v)}"`)
    .join("");
}

/**
 * Cambia (o agrega) un atributo en la PRIMERA etiqueta de apertura que empieza en `inicio`.
 * `etiqueta` es el texto completo de la etiqueta de apertura, p. ej. '<dimension ref="A1:J5"/>'.
 */
export function ponerAtributo(etiqueta, nombre, valor) {
  const patron = new RegExp(`(\\s${nombre.replace(/[.:]/g, "\\$&")}\\s*=\\s*)("[^"]*"|'[^']*')`);
  const escapado = `"${escaparAtributo(valor)}"`;
  if (patron.test(etiqueta)) return etiqueta.replace(patron, (_, a) => `${a}${escapado}`);
  return etiqueta.replace(/^(<[\w:.-]+)/, `$1 ${nombre}=${escapado}`);
}

export function quitarAtributo(etiqueta, nombre) {
  const patron = new RegExp(`\\s${nombre.replace(/[.:]/g, "\\$&")}\\s*=\\s*("[^"]*"|'[^']*')`);
  return etiqueta.replace(patron, "");
}

/** Primera etiqueta de apertura (o vacía) con ese nombre: { texto, inicio, fin } o null. */
export function buscarEtiqueta(xml, nombre, desde = 0) {
  const patron = new RegExp(`<${nombre.replace(/[.:]/g, "\\$&")}(?=[\\s/>])[^>]*>`, "g");
  patron.lastIndex = desde;
  const m = patron.exec(xml);
  return m ? { texto: m[0], inicio: m.index, fin: m.index + m[0].length } : null;
}

/** Reemplaza la primera etiqueta con ese nombre aplicando `cambio(textoEtiqueta)`. */
export function cambiarEtiqueta(xml, nombre, cambio, desde = 0) {
  const e = buscarEtiqueta(xml, nombre, desde);
  if (!e) return xml;
  return xml.slice(0, e.inicio) + cambio(e.texto) + xml.slice(e.fin);
}

/** Texto de todos los <t> (ignora la fonética <rPh>). */
export function textoDeRuns(xml) {
  const limpio = xml.indexOf("<rPh") >= 0 ? xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : xml;
  let salida = "";
  const patron = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = patron.exec(limpio))) salida += m[1] ? desescapar(m[1]) : "";
  return desescaparX(salida);
}
