// Rutas internas de un paquete OOXML (estilo POSIX, sin "/" inicial).

export function carpeta(ruta) {
  const i = ruta.lastIndexOf("/");
  return i < 0 ? "" : ruta.slice(0, i);
}

export function normalizar(ruta) {
  const salida = [];
  for (const parte of ruta.split("/")) {
    if (!parte || parte === ".") continue;
    if (parte === "..") salida.pop();
    else salida.push(parte);
  }
  return salida.join("/");
}

export function unir(base, relativa) {
  if (relativa.startsWith("/")) return normalizar(relativa);
  return normalizar(base ? `${base}/${relativa}` : relativa);
}

/** 'xl/worksheets/sheet1.xml' → 'xl/worksheets/_rels/sheet1.xml.rels' */
export function rutaRels(parte) {
  const base = carpeta(parte);
  const nombre = parte.slice(base ? base.length + 1 : 0);
  return base ? `${base}/_rels/${nombre}.rels` : `_rels/${nombre}.rels`;
}

export const TIPOS = {
  hoja: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  calcChain: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain",
  tabla: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
  comentarios: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  vml: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  textos: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
  estilos: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
};
