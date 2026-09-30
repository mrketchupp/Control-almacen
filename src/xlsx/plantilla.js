// Edición mínima de libros de Excel (OOXML) usando el archivo del usuario como plantilla.
//
// Un .xlsx/.xlsm es un ZIP de partes XML. Aquí solo se reescriben las partes que cambian
// y, dentro de ellas, solo los fragmentos necesarios; el resto (macros, botones, logos,
// customXml, configuración de impresora) se copia byte a byte.
// Ver docs/03-arquitectura.md y docs/06-formatos-excel.md.

import { FechaCelda } from "../nucleo/fechas.js";
import { Big } from "../nucleo/decimal.js";
import { desplazarFormula, desplazarFormula2D, indiceColumna, separarRango, separarReferencia } from "./celdas.js";
import { carpeta, rutaRels, TIPOS, unir } from "./rutas.js";
import { atributos, atributosATexto, cambiarEtiqueta, desescapar, escaparTexto, escaparX, ponerAtributo } from "./xml.js";
import { bytesATexto, descomprimir, escribirZip, leerZip, reemplazarEntrada, textoABytes } from "./zip.js";

export class ErrorPlantilla extends Error {}

export class PaqueteOOXML {
  constructor(datos) {
    this.entradas = leerZip(datos);
    this.porNombre = new Map(this.entradas.map((e) => [e.nombre, e]));
    this.modificadas = new Map(); // parte → Uint8Array
    this.eliminadas = new Set();
  }

  partes() {
    return this.entradas.map((e) => e.nombre).filter((n) => !this.eliminadas.has(n));
  }

  existe(parte) {
    return this.porNombre.has(parte) && !this.eliminadas.has(parte);
  }

  bytes(parte) {
    if (this.modificadas.has(parte)) return this.modificadas.get(parte);
    const entrada = this.porNombre.get(parte);
    if (!entrada) throw new ErrorPlantilla(`La plantilla no tiene la parte ${parte}`);
    return descomprimir(entrada);
  }

  texto(parte) {
    return bytesATexto(this.bytes(parte));
  }

  /** Texto "binario" (1 carácter por byte): para partes que no son UTF-8 (VML). */
  textoBinario(parte) {
    const bytes = this.bytes(parte);
    let salida = "";
    for (let i = 0; i < bytes.length; i += 8192) salida += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return salida;
  }

  escribir(parte, datos) {
    if (!this.porNombre.has(parte)) throw new ErrorPlantilla(`No se agregan partes nuevas a la plantilla: ${parte}`);
    const bytes = typeof datos === "string" ? textoABytes(datos) : datos;
    const original = descomprimir(this.porNombre.get(parte));
    if (bytes.length === original.length && bytes.every((b, i) => b === original[i])) this.modificadas.delete(parte);
    else this.modificadas.set(parte, bytes);
  }

  escribirBinario(parte, texto) {
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xff;
    this.escribir(parte, bytes);
  }

  eliminar(parte) {
    if (this.porNombre.has(parte)) this.eliminadas.add(parte);
  }

  /** Partes cambiadas ("-parte" = eliminada), en orden alfabético. */
  get partesModificadas() {
    return [...this.modificadas.keys(), ...[...this.eliminadas].map((p) => `-${p}`)].sort();
  }

  generar() {
    const salida = [];
    for (const entrada of this.entradas) {
      if (this.eliminadas.has(entrada.nombre)) continue;
      salida.push(this.modificadas.has(entrada.nombre) ? reemplazarEntrada(entrada, this.modificadas.get(entrada.nombre)) : entrada);
    }
    return escribirZip(salida);
  }

  // ------------------------------------------------------------ relaciones

  relaciones(parte) {
    const rels = rutaRels(parte);
    if (!this.existe(rels)) return [];
    const base = carpeta(parte);
    const salida = [];
    for (const m of this.texto(rels).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      if (a.TargetMode === "External") continue;
      salida.push({ id: a.Id, tipo: a.Type, destino: unir(base, a.Target) });
    }
    return salida;
  }

  relacionDeTipo(parte, tipo) {
    return this.relaciones(parte).find((r) => r.tipo === tipo)?.destino ?? null;
  }

  /** [[nombre exacto de la hoja, ruta de su parte]] en el orden del libro. */
  hojas() {
    const rutas = new Map(this.relaciones("xl/workbook.xml").map((r) => [r.id, r.destino]));
    const salida = [];
    for (const m of this.texto("xl/workbook.xml").matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      const rid = Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
      salida.push([a.name, rutas.get(rid)]);
    }
    return salida;
  }

  parteDeHoja(nombre) {
    const hoja = this.hojas().find(([h]) => h === nombre);
    if (!hoja) throw new ErrorPlantilla(`La plantilla no tiene la hoja '${nombre}'`);
    return hoja[1];
  }

  // ------------------------------------------------------------ cálculo

  /** Quita calcChain.xml y pide a Excel recalcular todo al abrir. */
  eliminarCalcChain() {
    const libroRels = rutaRels("xl/workbook.xml");
    const cadena = this.relacionDeTipo("xl/workbook.xml", TIPOS.calcChain);
    if (cadena) {
      this.eliminar(cadena);
      const rels = this.texto(libroRels).replace(/<Relationship\b[^>]*?\/>|<Relationship\b[^>]*?>[\s\S]*?<\/Relationship>/g, (r) =>
        atributos(r).Type === TIPOS.calcChain ? "" : r,
      );
      this.escribir(libroRels, rels);
      const tipos = this.texto("[Content_Types].xml").replace(/<Override\b[^>]*?\/>/g, (o) =>
        atributos(o).PartName === `/${cadena}` ? "" : o,
      );
      this.escribir("[Content_Types].xml", tipos);
    }
    let libro = this.texto("xl/workbook.xml");
    if (/<calcPr\b/.test(libro)) {
      libro = cambiarEtiqueta(libro, "calcPr", (e) => ponerAtributo(e, "fullCalcOnLoad", "1"));
    } else {
      const calc = '<calcPr fullCalcOnLoad="1"/>';
      const despues = /<\/definedNames>|<definedNames\s*\/>|<\/sheets>/.exec(libro);
      const i = despues ? despues.index + despues[0].length : libro.lastIndexOf("</workbook>");
      libro = libro.slice(0, i) + calc + libro.slice(i);
    }
    this.escribir("xl/workbook.xml", libro);
  }
}

// ---------------------------------------------------------------- celdas

function textoCelda(texto) {
  return escaparTexto(escaparX(texto));
}

/** <c> para un valor: número, fecha (FechaCelda), texto (en línea) o vacío. */
export function celda(referencia, valor, estilo = null) {
  const s = estilo !== null && estilo !== undefined ? ` s="${estilo}"` : "";
  if (valor === null || valor === undefined) return `<c r="${referencia}"${s}/>`;
  if (typeof valor === "boolean") return `<c r="${referencia}"${s} t="b"><v>${valor ? 1 : 0}</v></c>`;
  if (typeof valor === "number") return `<c r="${referencia}"${s}><v>${Number.isInteger(valor) ? valor : new Big(String(valor)).toFixed()}</v></c>`;
  if (valor instanceof Big) return `<c r="${referencia}"${s}><v>${valor.eq(0) ? "0" : valor.toFixed()}</v></c>`;
  if (valor instanceof FechaCelda) return `<c r="${referencia}"${s}><v>${valor.serial}</v></c>`;
  const texto = String(valor);
  const preservar = texto !== texto.trim() || texto.includes("\n") ? ' xml:space="preserve"' : "";
  return `<c r="${referencia}"${s} t="inlineStr"><is><t${preservar}>${textoCelda(texto)}</t></is></c>`;
}

export function celdaFormula(referencia, formula, estilo = null) {
  const s = estilo !== null && estilo !== undefined ? ` s="${estilo}"` : "";
  return `<c r="${referencia}"${s}><f>${escaparTexto(formula)}</f></c>`;
}

// ---------------------------------------------------------------- hoja

function parsearCelda(texto) {
  const m = /^<c\b([^>]*?)(\/>|>([\s\S]*)<\/c>)$/.exec(texto);
  const a = atributos(m[1]);
  const contenido = m[3] || "";
  let formula = null;
  const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(contenido);
  if (f) formula = { atributos: atributos(f[1]), texto: f[2] !== undefined ? desescapar(f[2]) : null, crudo: f[0] };
  return { texto, atributos: a, contenido, formula };
}

/** Acceso a las filas de una hoja para reemplazarlas conservando estilos. */
export class HojaXML {
  constructor(xml) {
    const inicio = xml.search(/<sheetData\b/);
    if (inicio < 0) throw new ErrorPlantilla("La hoja no tiene sheetData");
    const cierreApertura = xml.indexOf(">", inicio);
    const vacia = xml[cierreApertura - 1] === "/";
    this.antes = xml.slice(0, inicio);
    if (vacia) {
      this.contenido = "";
      this.despues = xml.slice(cierreApertura + 1);
    } else {
      const fin = xml.indexOf("</sheetData>", cierreApertura);
      this.contenido = xml.slice(cierreApertura + 1, fin);
      this.despues = xml.slice(fin + "</sheetData>".length);
    }
    this.aperturaDatos = vacia ? xml.slice(inicio, cierreApertura - 1).trimEnd() + ">" : xml.slice(inicio, cierreApertura + 1);
    this.filas = new Map(); // número → { texto, atributos, celdas: Map(letras → celda) }
    this.compartidas = new Map(); // si → { texto, fila, columna }
    let actual = 0;
    for (const m of this.contenido.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const a = atributos(m[1]);
      actual = a.r ? Number(a.r) : actual + 1;
      const celdas = new Map();
      let columna = 0;
      for (const c of (m[2] || "").matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
        const celdaLeida = parsearCelda(c[0]);
        const ref = celdaLeida.atributos.r;
        const partes = ref ? separarReferencia(ref) : null;
        columna = partes ? partes.columna : columna + 1;
        const letras = partes ? partes.letras : letraDe(columna);
        celdas.set(letras, celdaLeida);
        const f = celdaLeida.formula;
        if (f && f.atributos.t === "shared" && f.texto && f.atributos.si !== undefined) {
          this.compartidas.set(f.atributos.si, { texto: f.texto, fila: actual, columna });
        }
      }
      this.filas.set(actual, { texto: m[0], atributos: a, celdas });
    }
  }

  get numerosFila() {
    return [...this.filas.keys()];
  }

  tieneFila(numero) {
    return this.filas.has(numero);
  }

  celdas(numero) {
    return this.filas.get(numero)?.celdas ?? new Map();
  }

  estilos(numero) {
    const salida = {};
    for (const [letras, c] of this.celdas(numero)) if (c.atributos.s !== undefined) salida[letras] = c.atributos.s;
    return salida;
  }

  /** Texto de la fórmula de una celda (las compartidas se reconstruyen desde su maestra). */
  formulaDe(numero, letras) {
    const c = this.celdas(numero).get(letras);
    const f = c?.formula;
    if (!f) return null;
    if (f.texto) return f.texto;
    if (f.atributos.t === "shared" && this.compartidas.has(f.atributos.si)) {
      const maestra = this.compartidas.get(f.atributos.si);
      return desplazarFormula2D(maestra.texto, numero - maestra.fila, indiceColumna(letras) - maestra.columna);
    }
    return null;
  }

  formulas(numero) {
    const salida = {};
    for (const letras of this.celdas(numero).keys()) {
      const f = this.formulaDe(numero, letras);
      if (f) salida[letras] = f;
    }
    return salida;
  }

  atributosFila(numero) {
    const a = { ...(this.filas.get(numero)?.atributos ?? {}) };
    delete a.r;
    delete a.spans;
    return a;
  }

  /** Valor crudo <v> de una celda numérica (null si es texto o está vacía). */
  valorNumerico(numero, letras) {
    const c = this.celdas(numero).get(letras);
    if (!c || ["s", "inlineStr", "str"].includes(c.atributos.t)) return null;
    const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c.contenido);
    return v ? v[1] : null;
  }

  static nuevaFila(numero, celdas, atributos = {}) {
    return `<row r="${numero}"${atributosATexto(atributos)}>${celdas.join("")}</row>`;
  }

  /** Copia una fila existente a otro número de fila (ajusta referencias y fórmulas). */
  moverFila(anterior, numero) {
    const fila = this.filas.get(anterior);
    const delta = numero - anterior;
    const celdas = [];
    for (const [letras, c] of fila.celdas) {
      let texto = c.texto.replace(/^<c\b[^>]*?(?=\/?>)/, (apertura) => ponerAtributo(apertura, "r", `${letras}${numero}`));
      if (c.formula) {
        const formula = this.formulaDe(anterior, letras);
        const a = { ...c.formula.atributos };
        if (a.t === "shared") {
          delete a.t;
          delete a.ref;
          delete a.si;
        } else if (a.ref) {
          const { inicio, fin } = separarRango(a.ref);
          a.ref = `${inicio.letras}${inicio.fila + delta}:${fin.letras}${fin.fila + delta}`;
        }
        const nueva = formula === null ? c.formula.crudo : `<f${atributosATexto(a)}>${escaparTexto(desplazarFormula(formula, delta))}</f>`;
        texto = texto.replace(c.formula.crudo, nueva).replace(/<v(?:\s[^>]*)?>[\s\S]*?<\/v>|<v\/>/, "");
      }
      celdas.push(texto);
    }
    return HojaXML.nuevaFila(numero, celdas, this.atributosFila(anterior));
  }

  /** Escribe un valor en una celda conservando su estilo (crea la fila o la celda si falta). */
  ponerCelda(referencia, valor) {
    const { letras, fila, columna } = separarReferencia(referencia);
    const existente = this.filas.get(fila);
    const anterior = existente?.celdas.get(letras);
    const nueva = celda(`${letras}${fila}`, valor, anterior?.atributos.s ?? null);
    if (!existente) {
      const texto = HojaXML.nuevaFila(fila, [nueva]);
      const siguiente = this.numerosFila.filter((n) => n > fila).sort((a, b) => a - b)[0];
      if (siguiente === undefined) this.contenido += texto;
      else this.contenido = this.contenido.replace(this.filas.get(siguiente).texto, texto + this.filas.get(siguiente).texto);
    } else {
      const celdas = [...existente.celdas.entries()]
        .filter(([l]) => l !== letras)
        .map(([l, c]) => [indiceColumna(l), c.texto]);
      celdas.push([columna, nueva]);
      celdas.sort((a, b) => a[0] - b[0]);
      const apertura = existente.texto.match(/^<row\b[^>]*?(?=\/?>)/)[0];
      const texto = `${apertura}>${celdas.map((c) => c[1]).join("")}</row>`;
      this.contenido = this.contenido.replace(existente.texto, texto);
    }
    // Se vuelve a leer para mantener el índice de filas al día.
    const actualizada = new HojaXML(this.toString());
    Object.assign(this, actualizada);
  }

  /** Deja en sheetData solo las filas `conservar` (sin cambios) seguidas de `nuevas`. */
  reemplazarFilas(conservar, nuevas) {
    const partes = [...conservar]
      .sort((a, b) => a - b)
      .filter((n) => this.filas.has(n))
      .map((n) => this.filas.get(n).texto);
    this.contenido = partes.join("") + nuevas.join("");
  }

  ajustarDimension(ultima) {
    this.antes = cambiarEtiqueta(this.antes, "dimension", (etiqueta) => {
      const ref = atributos(etiqueta).ref;
      if (!ref) return etiqueta;
      const [inicio, fin] = ref.split(":");
      const columnaFin = separarReferencia(fin || inicio).letras;
      return ponerAtributo(etiqueta, "ref", `${fin ? inicio : "A1"}:${columnaFin}${ultima}`);
    });
  }

  /** Cambia el rango del autofiltro de la hoja (no el de las tablas). */
  cambiarAutoFiltro(cambio) {
    this.despues = cambiarEtiqueta(this.despues, "autoFilter", (etiqueta) => {
      const ref = atributos(etiqueta).ref;
      return ref ? ponerAtributo(etiqueta, "ref", cambio(ref)) : etiqueta;
    });
  }

  /** Panel inmovilizado: primera celda visible al abrir. */
  cambiarPanel(celdaSuperior) {
    this.antes = cambiarEtiqueta(this.antes, "pane", (etiqueta) =>
      atributos(etiqueta).state === "frozen" ? ponerAtributo(etiqueta, "topLeftCell", celdaSuperior) : etiqueta,
    );
  }

  toString() {
    return `${this.antes}${this.aperturaDatos}${this.contenido}</sheetData>${this.despues}`;
  }
}

function letraDe(columna) {
  let letras = "";
  while (columna > 0) {
    const resto = (columna - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    columna = Math.floor((columna - 1) / 26);
  }
  return letras;
}

/** Nombres definidos del libro: aplica `cambio(nombre, localSheetId, texto)` a cada uno. */
export function cambiarNombresDefinidos(libro, cambio) {
  return libro.replace(/(<definedName\b([^>]*)>)([\s\S]*?)(<\/definedName>)/g, (todo, apertura, attrs, texto, cierre) => {
    const a = atributos(attrs);
    const nuevo = cambio(a.name, a.localSheetId, texto);
    return nuevo === null || nuevo === undefined || nuevo === texto ? todo : `${apertura}${nuevo}${cierre}`;
  });
}
