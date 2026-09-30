// Generador de libros de Excel NUEVOS (lista de revisión, reportes, solicitudes).
// Nunca se usa para los libros del usuario: esos se editan sobre su plantilla.

import { Big } from "../nucleo/decimal.js";
import { FechaCelda } from "../nucleo/fechas.js";
import { letraColumna } from "./celdas.js";
import { escaparAtributo, escaparTexto, escaparX } from "./xml.js";
import { crearZip } from "./zip.js";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

class RegistroEstilos {
  constructor() {
    this.fuentes = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    this.rellenos = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.bordes = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
    this.formatos = [];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.indice = new Map();
  }

  _agregar(lista, xml) {
    let i = lista.indexOf(xml);
    if (i < 0) {
      lista.push(xml);
      i = lista.length - 1;
    }
    return i;
  }

  /** estilo: { fuente: {nombre, tam, negrita, cursiva, color}, relleno, borde, envolver, vertical, formato } */
  id(estilo) {
    if (!estilo) return 0;
    const clave = JSON.stringify(estilo);
    if (this.indice.has(clave)) return this.indice.get(clave);
    const f = estilo.fuente || {};
    const fuente = this._agregar(
      this.fuentes,
      "<font>" +
        (f.negrita ? "<b/>" : "") +
        (f.cursiva ? "<i/>" : "") +
        `<sz val="${f.tam || 11}"/>` +
        (f.color ? `<color rgb="FF${f.color}"/>` : "") +
        `<name val="${escaparAtributo(f.nombre || "Calibri")}"/><family val="2"/></font>`,
    );
    const relleno = estilo.relleno
      ? this._agregar(
          this.rellenos,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${estilo.relleno}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const lado = (n) => `<${n} style="thin"><color rgb="FF${estilo.borde}"/></${n}>`;
    const borde = estilo.borde
      ? this._agregar(this.bordes, `<border>${lado("left")}${lado("right")}${lado("top")}${lado("bottom")}<diagonal/></border>`)
      : 0;
    let formato = 0;
    if (estilo.formato) {
      const i = this.formatos.indexOf(estilo.formato);
      formato = 164 + (i < 0 ? this.formatos.push(estilo.formato) - 1 : i);
    }
    const alineacion =
      estilo.envolver || estilo.vertical
        ? `<alignment${estilo.vertical ? ` vertical="${estilo.vertical}"` : ""}${estilo.envolver ? ' wrapText="1"' : ""}/>`
        : "";
    const xf =
      `<xf numFmtId="${formato}" fontId="${fuente}" fillId="${relleno}" borderId="${borde}" xfId="0"` +
      (formato ? ' applyNumberFormat="1"' : "") +
      (fuente ? ' applyFont="1"' : "") +
      (relleno ? ' applyFill="1"' : "") +
      (borde ? ' applyBorder="1"' : "") +
      (alineacion ? ` applyAlignment="1">${alineacion}</xf>` : "/>");
    const id = this._agregar(this.xfs, xf);
    this.indice.set(clave, id);
    return id;
  }

  xml() {
    const formatos = this.formatos.length
      ? `<numFmts count="${this.formatos.length}">${this.formatos
          .map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escaparAtributo(f)}"/>`)
          .join("")}</numFmts>`
      : "";
    return (
      DECL +
      `<styleSheet xmlns="${NS}">${formatos}` +
      `<fonts count="${this.fuentes.length}">${this.fuentes.join("")}</fonts>` +
      `<fills count="${this.rellenos.length}">${this.rellenos.join("")}</fills>` +
      `<borders count="${this.bordes.length}">${this.bordes.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

export class HojaNueva {
  constructor(libro, nombre) {
    this.libro = libro;
    this.nombre = nombre;
    this.celdas = new Map(); // fila → Map(columna → { valor, estilo })
    this.anchos = new Map();
    this.alturas = new Map();
    this.congelar = null;
    this.filtro = null;
    this.validaciones = [];
  }

  get maxFila() {
    return this.celdas.size ? Math.max(...this.celdas.keys()) : 0;
  }

  get maxColumna() {
    let max = 0;
    for (const fila of this.celdas.values()) for (const c of fila.keys()) max = Math.max(max, c);
    return max;
  }

  poner(fila, columna, valor, estilo = null) {
    if (!this.celdas.has(fila)) this.celdas.set(fila, new Map());
    this.celdas.get(fila).set(columna, { valor, estilo });
  }

  estilo(fila, columna, estilo) {
    const celda = this.celdas.get(fila)?.get(columna);
    if (celda) celda.estilo = estilo;
    else this.poner(fila, columna, null, estilo);
  }

  valor(fila, columna) {
    return this.celdas.get(fila)?.get(columna)?.valor ?? null;
  }

  /** Agrega una fila después de la última (como ws.append). */
  agregarFila(valores, estilo = null) {
    const fila = this.maxFila + 1;
    valores.forEach((v, i) => this.poner(fila, i + 1, v, estilo));
    if (!valores.length) this.celdas.set(fila, new Map());
    return fila;
  }

  _celdaXml(referencia, { valor, estilo }) {
    const s = estilo ? ` s="${this.libro.estilos.id(estilo)}"` : "";
    if (valor === null || valor === undefined || valor === "") return `<c r="${referencia}"${s}/>`;
    if (typeof valor === "boolean") return `<c r="${referencia}"${s} t="b"><v>${valor ? 1 : 0}</v></c>`;
    if (typeof valor === "number") return `<c r="${referencia}"${s}><v>${valor}</v></c>`;
    if (valor instanceof Big) return `<c r="${referencia}"${s}><v>${valor.toFixed()}</v></c>`;
    if (valor instanceof FechaCelda) return `<c r="${referencia}"${s}><v>${valor.serial}</v></c>`;
    const indice = this.libro.textoCompartido(String(valor));
    return `<c r="${referencia}"${s} t="s"><v>${indice}</v></c>`;
  }

  xml(seleccionada) {
    const ultimaFila = Math.max(1, this.maxFila);
    const ultimaColumna = Math.max(1, this.maxColumna);
    let vista = `<sheetView workbookViewId="0"${seleccionada ? ' tabSelected="1"' : ""}`;
    if (this.congelar) {
      const m = /^([A-Z]+)(\d+)$/.exec(this.congelar);
      const columnas = [...m[1]].reduce((v, l) => v * 26 + l.charCodeAt(0) - 64, 0) - 1;
      const filas = Number(m[2]) - 1;
      const panel = columnas && filas ? "bottomRight" : filas ? "bottomLeft" : "topRight";
      vista +=
        `><pane${columnas ? ` xSplit="${columnas}"` : ""}${filas ? ` ySplit="${filas}"` : ""}` +
        ` topLeftCell="${this.congelar}" activePane="${panel}" state="frozen"/>` +
        `<selection pane="${panel}" activeCell="${this.congelar}" sqref="${this.congelar}"/></sheetView>`;
    } else {
      vista += "/>";
    }
    const cols = [...this.anchos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`)
      .join("");
    const filas = [...this.celdas.keys()]
      .sort((a, b) => a - b)
      .map((f) => {
        const alto = this.alturas.get(f);
        const celdas = [...this.celdas.get(f).entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([c, celda]) => this._celdaXml(`${letraColumna(c)}${f}`, celda))
          .join("");
        return `<row r="${f}"${alto ? ` ht="${alto}" customHeight="1"` : ""}>${celdas}</row>`;
      })
      .join("");
    const validaciones = this.validaciones.length
      ? `<dataValidations count="${this.validaciones.length}">${this.validaciones
          .map(
            (v) =>
              `<dataValidation type="list" allowBlank="1" sqref="${v.ref}"><formula1>${escaparTexto(
                `"${v.opciones.join(",")}"`,
              )}</formula1></dataValidation>`,
          )
          .join("")}</dataValidations>`
      : "";
    return (
      DECL +
      `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<dimension ref="A1:${letraColumna(ultimaColumna)}${ultimaFila}"/>` +
      `<sheetViews>${vista}</sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${filas}</sheetData>` +
      (this.filtro ? `<autoFilter ref="${this.filtro}"/>` : "") +
      validaciones +
      '<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>' +
      "</worksheet>"
    );
  }
}

export class LibroNuevo {
  constructor() {
    this.hojas = [];
    this.estilos = new RegistroEstilos();
    this.textos = [];
    this.indiceTextos = new Map();
  }

  agregarHoja(nombre) {
    const hoja = new HojaNueva(this, nombre);
    this.hojas.push(hoja);
    return hoja;
  }

  hoja(nombre) {
    return this.hojas.find((h) => h.nombre === nombre);
  }

  textoCompartido(texto) {
    if (!this.indiceTextos.has(texto)) {
      this.indiceTextos.set(texto, this.textos.length);
      this.textos.push(texto);
    }
    return this.indiceTextos.get(texto);
  }

  generar() {
    const hojasXml = this.hojas.map((h, i) => h.xml(i === 0));
    const compartidos =
      DECL +
      `<sst xmlns="${NS}" count="${this.textos.length}" uniqueCount="${this.textos.length}">` +
      this.textos
        .map((t) => {
          const texto = escaparTexto(escaparX(t));
          const preservar = t !== t.trim() || /\n/.test(t) ? ' xml:space="preserve"' : "";
          return `<si><t${preservar}>${texto}</t></si>`;
        })
        .join("") +
      "</sst>";
    const nombresDefinidos = this.hojas
      .map((h, i) =>
        h.filtro
          ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escaparTexto(
              `'${h.nombre.replace(/'/g, "''")}'!${h.filtro.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`,
            )}</definedName>`
          : "",
      )
      .join("");
    const libro =
      DECL +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      this.hojas
        .map((h, i) => `<sheet name="${escaparAtributo(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("") +
      "</sheets>" +
      (nombresDefinidos ? `<definedNames>${nombresDefinidos}</definedNames>` : "") +
      '<calcPr calcId="191029"/></workbook>';
    const n = this.hojas.length;
    const relsLibro =
      DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      this.hojas
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${n + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/>` +
      "</Relationships>";
    const tipos =
      DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      this.hojas
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>";
    const relsRaiz =
      DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      `<Relationship Id="rId3" Type="${NS_R}/extended-properties" Target="docProps/app.xml"/>` +
      "</Relationships>";
    const ahora = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core =
      DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:creator>Control de Almacén</dc:creator>" +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${ahora}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${ahora}</dcterms:modified>` +
      "</cp:coreProperties>";
    const app =
      DECL +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      "<Application>Control de Almacén</Application></Properties>";
    return crearZip([
      ["[Content_Types].xml", tipos],
      ["_rels/.rels", relsRaiz],
      ["docProps/core.xml", core],
      ["docProps/app.xml", app],
      ["xl/workbook.xml", libro],
      ["xl/_rels/workbook.xml.rels", relsLibro],
      ["xl/styles.xml", this.estilos.xml()],
      ["xl/sharedStrings.xml", compartidos],
      ...hojasXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ]);
  }
}
