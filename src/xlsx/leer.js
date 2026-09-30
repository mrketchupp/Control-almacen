// Lector de libros de Excel (.xlsx/.xlsm) por texto: rápido y sin dependencias de DOM.
// Solo lee; nunca modifica el archivo del usuario.

import { FechaCelda } from "../nucleo/fechas.js";
import { separarRango, separarReferencia, indiceColumna } from "./celdas.js";
import { carpeta, rutaRels, TIPOS, unir } from "./rutas.js";
import { atributos, desescapar, desescaparX, textoDeRuns } from "./xml.js";
import { bytesATexto, descomprimir, leerZip } from "./zip.js";

export class ErrorLibro extends Error {}

export { FechaCelda };

const FORMATOS_FECHA_INTEGRADOS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const QUITAR_FORMATO = /\[(?!hh?\]|mm?\]|ss?\])[^\]]*\]|"[^"]*"|\\.|_.|\*./g;
const CARACTER_FECHA = /(?<![_\\])[dmhysDMHYS]/;

export function esFormatoFecha(codigo) {
  if (!codigo) return false;
  return CARACTER_FECHA.test(codigo.split(";")[0].replace(QUITAR_FORMATO, ""));
}

export class LibroLeido {
  constructor(datos) {
    this.entradas = new Map(leerZip(datos).map((e) => [e.nombre, e]));
    this._textos = new Map();
    if (!this.existe("xl/workbook.xml")) throw new ErrorLibro("El archivo no es un libro de Excel.");
    const libro = this.texto("xl/workbook.xml");
    const rels = new Map(this.relaciones("xl/workbook.xml").map((r) => [r.id, r]));
    this.hojas = [];
    for (const m of libro.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const a = atributos(m[1]);
      const rid = Object.entries(a).find(([k]) => k.endsWith(":id") || k === "id")?.[1];
      const rel = rels.get(rid);
      if (!rel) continue;
      this.hojas.push({ nombre: a.name, estado: a.state || "visible", parte: rel.destino, tipo: rel.tipo });
    }
    this._compartidos = null;
    this._estilosFecha = null;
  }

  existe(parte) {
    return this.entradas.has(parte);
  }

  bytes(parte) {
    const entrada = this.entradas.get(parte);
    if (!entrada) throw new ErrorLibro(`Falta la parte ${parte}`);
    return descomprimir(entrada);
  }

  texto(parte) {
    // Como cualquier lector de XML, los saltos de línea CR LF se normalizan a LF.
    if (!this._textos.has(parte)) this._textos.set(parte, bytesATexto(this.bytes(parte)).replace(/\r\n?/g, "\n"));
    return this._textos.get(parte);
  }

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

  get nombresHojas() {
    return this.hojas.map((h) => h.nombre);
  }

  get compartidos() {
    if (this._compartidos === null) {
      const parte = this.relacionDeTipo("xl/workbook.xml", TIPOS.textos);
      this._compartidos = [];
      if (parte && this.existe(parte)) {
        for (const m of this.texto(parte).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
          this._compartidos.push(m[1] ? textoDeRuns(m[1]) : "");
        }
      }
    }
    return this._compartidos;
  }

  /** Índices de estilo (atributo s) cuyo formato numérico es de fecha. */
  get estilosFecha() {
    if (this._estilosFecha === null) {
      this._estilosFecha = new Set();
      const parte = this.relacionDeTipo("xl/workbook.xml", TIPOS.estilos);
      if (parte && this.existe(parte)) {
        const xml = this.texto(parte);
        const propios = new Map();
        for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
          const a = atributos(m[1]);
          propios.set(Number(a.numFmtId), a.formatCode);
        }
        const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
        if (xfs) {
          let i = 0;
          for (const m of xfs[1].matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
            const id = Number(atributos(m[1]).numFmtId || 0);
            const fecha = propios.has(id) ? esFormatoFecha(propios.get(id)) : FORMATOS_FECHA_INTEGRADOS.has(id);
            if (fecha) this._estilosFecha.add(String(i));
            i++;
          }
        }
      }
    }
    return this._estilosFecha;
  }

  hoja(nombre, opciones = {}) {
    const info = this.hojas.find((h) => h.nombre === nombre);
    if (!info) throw new ErrorLibro(`El libro no tiene la hoja '${nombre}'`);
    return new HojaLeida(this, info, opciones);
  }
}

function valorCelda(libro, a, contenido) {
  const tipo = a.t || "n";
  if (tipo === "inlineStr") {
    const is = /<is(?:\s[^>]*)?>([\s\S]*?)<\/is>/.exec(contenido);
    return is ? textoDeRuns(is[1]) : null;
  }
  const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(contenido);
  if (!v || v[1] === "") return null;
  const crudo = v[1];
  switch (tipo) {
    case "s":
      return libro.compartidos[Number(crudo)] ?? null;
    case "str":
      return desescaparX(desescapar(crudo));
    case "b":
      return crudo === "1" || crudo === "true";
    case "e":
      return desescapar(crudo);
    case "d": {
      const t = Date.parse(crudo);
      return Number.isNaN(t) ? desescapar(crudo) : new FechaCelda(t / 86400000 + 25569);
    }
    default: {
      const numero = Number(crudo);
      if (Number.isNaN(numero)) return desescapar(crudo);
      return a.s !== undefined && libro.estilosFecha.has(a.s) ? new FechaCelda(numero) : numero;
    }
  }
}

export class HojaLeida {
  /**
   * @param opciones.hastaFila  deja de leer después de esa fila (hojas enormes)
   */
  constructor(libro, info, opciones = {}) {
    this.libro = libro;
    this.nombre = info.nombre;
    this.parte = info.parte;
    this.estado = info.estado;
    this.filas = new Map(); // fila → Map(columna → valor)
    this.formulas = new Map(); // 'A1' → texto
    this.maxFila = 0;
    const xml = libro.texto(info.parte);
    const inicio = xml.indexOf("<sheetData");
    if (inicio < 0) return;
    const fin = xml.indexOf("</sheetData>", inicio);
    const datos = fin < 0 ? "" : xml.slice(inicio, fin);
    const hasta = opciones.hastaFila ?? Infinity;
    let filaActual = 0;
    for (const f of datos.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const af = atributos(f[1]);
      filaActual = af.r ? Number(af.r) : filaActual + 1;
      if (filaActual > hasta) break;
      if (!f[2]) continue;
      const celdas = new Map();
      let columna = 0;
      for (const c of f[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = atributos(c[1]);
        columna = a.r ? separarReferencia(a.r).columna : columna + 1;
        const contenido = c[2] || "";
        const valor = contenido ? valorCelda(libro, a, contenido) : null;
        if (valor !== null) celdas.set(columna, valor);
        if (contenido.indexOf("<f") >= 0) {
          const fm = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(contenido);
          if (fm) this.formulas.set(a.r, desescapar(fm[1]));
        }
      }
      if (celdas.size) {
        this.filas.set(filaActual, celdas);
        this.maxFila = Math.max(this.maxFila, filaActual);
      }
    }
  }

  valor(fila, columna) {
    return this.filas.get(fila)?.get(columna) ?? null;
  }

  valorRef(referencia) {
    const { fila, columna } = separarReferencia(referencia);
    return this.valor(fila, columna);
  }

  /** Valores de la fila entre las columnas indicadas (1 = A), con null en las vacías. */
  fila(numero, desde = 1, hasta = null) {
    const celdas = this.filas.get(numero);
    const ultima = hasta ?? (celdas && celdas.size ? Math.max(...celdas.keys()) : desde - 1);
    const salida = [];
    for (let c = desde; c <= ultima; c++) salida.push(celdas?.get(c) ?? null);
    return salida;
  }

  tablas() {
    return this.libro
      .relaciones(this.parte)
      .filter((r) => r.tipo === TIPOS.tabla)
      .map((r) => {
        const a = atributos(/<table\b([^>]*?)\/?>/.exec(this.libro.texto(r.destino))[1]);
        return {
          parte: r.destino,
          nombre: a.name,
          displayName: a.displayName || a.name,
          ref: a.ref,
          totalsRowCount: Number(a.totalsRowCount || 0),
          headerRowCount: a.headerRowCount === undefined ? 1 : Number(a.headerRowCount),
          rango: separarRango(a.ref),
        };
      });
  }

  /** Notas de celda: Map 'D4' → texto. */
  comentarios() {
    const salida = new Map();
    const parte = this.libro.relacionDeTipo(this.parte, TIPOS.comentarios);
    if (!parte || !this.libro.existe(parte)) return salida;
    for (const m of this.libro.texto(parte).matchAll(/<comment\b([^>]*?)>([\s\S]*?)<\/comment>/g)) {
      const a = atributos(m[1]);
      salida.set(a.ref, textoDeRuns(m[2]));
    }
    return salida;
  }
}

export { indiceColumna };
