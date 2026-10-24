// Plantilla y vales inventados para reproducir un DIARIO filtrado y filas modelo ocultas.
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { exportarVales } from "../src/exportadores/vales.js";
import { emitirBorrador, lineaNoInventariada, nuevoBorrador } from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { HojaXML, PaqueteOOXML } from "../src/xlsx/plantilla.js";
import { letraColumna } from "../src/xlsx/celdas.js";
import { rutaRels, TIPOS } from "../src/xlsx/rutas.js";
import { atributos, cambiarEtiqueta, escaparTexto, ponerAtributo } from "../src/xlsx/xml.js";
import { bytesATexto, crearZip, descomprimirZip, textoABytes } from "../src/xlsx/zip.js";
import { bytesInventario, bytesVales, cargaSintetica } from "./ayuda.js";

export const FECHA_ANTERIOR_GSM = "2026-10-07";
export const FECHA_REPORTE_GSM = "2026-10-23";
export const PRIMER_FOLIO_GSM = 2930;
export const ULTIMO_FOLIO_GSM = 2964;
export const TABLA_DIARIO_GSM = "xl/tables/tablaDiarioSintetica.xml";

export function estadoReporteGsm(inventario = "GSM") {
  const { estado } = cargaSintetica({ idInventario: inventario });
  estado.vales = [];
  estado.borradores = [];
  estado.envios = [];
  estado.config.usuario_en_turno = "ALMACENISTA UNO";
  const area = estado.plantillas_area.find((p) => p.nombre === "MECANICO");
  const emitir = (fecha) => {
    const b = nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: area.id, fecha });
    b.recibio_nombre = "PERSONA SINTETICA";
    b.recibio_puesto = "MECANICO";
    b.lineas.push({ ...lineaNoInventariada(estado, 136), cantidad: "1", um: "LTS" });
    return emitirBorrador(estado, b.id, { usuario: "ALMACENISTA UNO" })[0];
  };
  const primero = emitir(FECHA_ANTERIOR_GSM);
  // Sólo el fixture ajusta su punto de partida; los demás folios se asignan por la API de emisión.
  primero.folio = PRIMER_FOLIO_GSM;
  primero.lineas[0].fila_diario_origen = 2;
  for (let folio = PRIMER_FOLIO_GSM + 1; folio <= ULTIMO_FOLIO_GSM; folio++) emitir(FECHA_REPORTE_GSM);
  return estado;
}

export function plantillaReporteGsm(estado, { conTabla = true, conTotales = false, conVistaGuardada = false, filaOculta = true, alturaCero = true, zeroHeight = false } = {}) {
  const inicial = { ...estado, vales: [estado.vales[0]] };
  const base = exportarVales(inicial, bytesVales()).datos;
  const paquete = new PaqueteOOXML(base), parte = paquete.parteDeHoja("DIARIO");
  const partes = descomprimirZip(base);
  const filtro = '<filterColumn colId="0"><filters><dateGroupItem year="2026" month="10" day="7" dateTimeGrouping="day"/></filters></filterColumn>';
  const orden = '<sortState ref="A2:T2"><sortCondition descending="1" ref="B2:B2"/></sortState>';
  let diario = bytesATexto(partes.get(parte));
  diario = cambiarEtiqueta(diario, "sheetPr", (e) => ponerAtributo(e, "filterMode", "1"));
  diario = cambiarEtiqueta(diario, "sheetFormatPr", (e) => ponerAtributo(e, "zeroHeight", zeroHeight ? "1" : "0"));
  diario = diario.replace(/<autoFilter\b[^>]*(?:\/>|>[\s\S]*?<\/autoFilter>)/,
    `<autoFilter ref="A1:T2">${filtro}${orden}</autoFilter>`);
  if (conVistaGuardada) diario = diario.replace("</autoFilter>", `</autoFilter><customSheetViews><customSheetView guid="{00000000-0000-0000-0000-000000000091}" scale="85" showGridLines="0"><selection activeCell="B2" sqref="B2"/><autoFilter ref="A1:T2">${filtro}${orden}</autoFilter></customSheetView></customSheetViews>`);
  const attrs = `${filaOculta ? ' hidden="1"' : ""}${alturaCero ? ' ht="0"' : ' ht="24"'} customHeight="1" outlineLevel="1" collapsed="1"`;
  const totales = conTabla && conTotales;
  const filaTotal = totales ? '<row r="3" ht="22" customHeight="1"><c r="B3" t="inlineStr"><is><t>TOTAL SINTETICO</t></is></c><c r="J3"><f>SUBTOTAL(109,TablaDiarioSintetica[Cantidad])</f><v>1</v></c></row>' : "";
  const modelo = totales ? 4 : 3;
  diario = diario.replace("</sheetData>", `${filaTotal}<row r="${modelo}"${attrs}><c r="A${modelo}" s="1"/></row></sheetData>`);
  if (conTabla) {
    const id = "rIdTablaSintetica";
    diario = diario.replace("</worksheet>", `<tableParts count="1"><tablePart xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${id}"/></tableParts></worksheet>`);
    const relsParte = rutaRels(parte);
    let rels = partes.has(relsParte) ? bytesATexto(partes.get(relsParte)) : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${TIPOS.tabla}" Target="../tables/tablaDiarioSintetica.xml"/></Relationships>`);
    partes.set(relsParte, textoABytes(rels));
    const usados = new Set(), hoja = new HojaXML(diario);
    // Una tabla requiere encabezados únicos: el DIARIO original admite Depto y firmas repetidos.
    const encabezados = new LibroLeido(base).hoja("DIARIO").fila(1, 1, 20).map((nombre, i) => {
      let unico = String(nombre), contador = 1;
      while (usados.has(unico.toUpperCase())) unico = `${nombre}${++contador}`;
      usados.add(unico.toUpperCase());
      if (unico !== nombre) hoja.ponerCelda(`${letraColumna(i + 1)}1`, unico);
      return unico;
    });
    diario = hoja.toString();
    const columnas = encabezados.map((nombre, i) => `<tableColumn id="${i + 1}" name="${escaparTexto(String(nombre))}"${totales && i === 1 ? ' totalsRowLabel="TOTAL SINTETICO"' : totales && i === 9 ? ' totalsRowFunction="sum"' : ""}/>`).join("");
    partes.set(TABLA_DIARIO_GSM, textoABytes(`<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="90" name="TablaDiarioSintetica" displayName="TablaDiarioSintetica" ref="A1:T${totales ? 3 : 2}" headerRowCount="1" totalsRowShown="${totales ? 1 : 0}"${totales ? ' totalsRowCount="1"' : ""}><autoFilter ref="A1:T2">${filtro}${orden}</autoFilter><tableColumns count="20">${columnas}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`));
    const tipos = bytesATexto(partes.get("[Content_Types].xml")).replace("</Types>", `<Override PartName="/${TABLA_DIARIO_GSM}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`);
    partes.set("[Content_Types].xml", textoABytes(tipos));
  }
  partes.set(parte, textoABytes(diario));
  return crearZip([...partes]);
}

export async function almacenReporteGsm({ inventario = "GSM", ...opcionesPlantilla } = {}) {
  const estado = estadoReporteGsm(inventario), plantilla = plantillaReporteGsm(estado, opcionesPlantilla);
  const almacen = new Almacen(new BackendMemoria(), { inventario, version: "prueba" });
  await almacen.iniciar();
  await almacen.cargarPrimeraVez(estado, [
    { tipo: "INVENTARIO", nombre: `INVENTARIO ${inventario} SINTETICO.xlsx`, datos: bytesInventario() },
    { tipo: "VALES", nombre: `VALES DE SALIDA ${inventario} SINTETICO.xlsm`, datos: plantilla },
  ]);
  return { almacen, estado: almacen.estado, plantilla };
}

/** Valores de atributos por etiqueta para las verificaciones XML, sin depender de un DOM. */
export function atributosEtiquetas(xml, nombre) {
  return [...xml.matchAll(new RegExp(`<${nombre}\\b([^>]*?)(?:/?>)`, "g"))].map((m) => atributos(m[1]));
}
