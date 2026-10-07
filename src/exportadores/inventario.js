// Exporta INVENTARIO DE REFACCIONAMIENTO…xlsx sobre la plantilla del usuario.
//
// Por cada hoja de contenedor se reescriben los renglones de la tabla, la fila de
// totales, el rango de la tabla, las áreas de impresión/filtro, las notas y la fecha
// del encabezado de página. Ver docs/06-formatos-excel.md, sección A.

import { CERO, dec } from "../nucleo/decimal.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { codigoAx, textoONumero } from "../nucleo/normalizar.js";
import { cambiarUltimaFila, desplazarFormula, separarReferencia } from "../xlsx/celdas.js";
import { HojaXML, PaqueteOOXML, ErrorPlantilla, cambiarNombresDefinidos, celda, celdaFormula } from "../xlsx/plantilla.js";
import { TIPOS } from "../xlsx/rutas.js";
import { atributos, cambiarEtiqueta, ponerAtributo } from "../xlsx/xml.js";

export const HOJA_CATALOGO = "ARTICULOS_MX";
const COLUMNAS = "ABCDEFGHIJ".split("");

/**
 * @param plantilla  bytes del inventario del usuario
 * @param fecha  AAAA-MM-DD del inventario: va en el encabezado de página y define el día (como el Excel
 *   diario: CANTIDAD = lo que había al empezar ese día; CONSUMO e INGRESO = solo los vales de ese día)
 * @returns {{ datos: Uint8Array, renglones, hojas, partesModificadas, advertencias }}
 */
export function exportarInventario(estado, plantilla, { fecha = null } = {}) {
  const paquete = new PaqueteOOXML(plantilla);
  const hojas = paquete.hojas();
  const indiceHoja = new Map(hojas.map(([nombre], i) => [nombre, i]));
  const partes = new Map(hojas);
  const saldos = calcularSaldos(estado, null, { dia: fecha });
  const indices = new Indices(estado);
  let libro = paquete.texto("xl/workbook.xml");
  const advertencias = [];
  let totalRenglones = 0;

  const ubicaciones = [...estado.ubicaciones].sort((a, b) => a.orden - b.orden);
  for (const ubicacion of ubicaciones) {
    if (!partes.has(ubicacion.hoja_excel)) {
      throw new ErrorPlantilla(`La plantilla no tiene la hoja '${ubicacion.hoja_excel}'`);
    }
    const existencias = estado.existencias
      .filter((e) => e.ubicacion_id === ubicacion.id && e.activo !== false)
      .sort((a, b) => a.orden - b.orden);
    const ultima = exportarHoja(paquete, partes.get(ubicacion.hoja_excel), existencias, indices, saldos, advertencias, fecha);
    libro = ajustarNombres(libro, indiceHoja.get(ubicacion.hoja_excel), ultima);
    totalRenglones += existencias.length;
  }

  if (partes.has(HOJA_CATALOGO)) actualizarCatalogo(paquete, partes.get(HOJA_CATALOGO), estado);
  if (libro !== paquete.texto("xl/workbook.xml")) paquete.escribir("xl/workbook.xml", libro);
  paquete.eliminarCalcChain();
  return {
    datos: paquete.generar(),
    renglones: totalRenglones,
    hojas: ubicaciones.length,
    partesModificadas: paquete.partesModificadas,
    advertencias,
  };
}

// --------------------------------------------------------------------- hoja

function exportarHoja(paquete, parte, existencias, indices, saldos, advertencias, fecha) {
  const hoja = new HojaXML(paquete.texto(parte));
  const parteTabla = paquete.relacionDeTipo(parte, TIPOS.tabla);
  if (!parteTabla) throw new ErrorPlantilla(`La hoja ${parte} no tiene tabla de Excel`);
  let tabla = paquete.texto(parteTabla);
  const atributosTabla = atributos(/<table\b([^>]*?)\/?>/.exec(tabla)[1]);
  const [inicio, fin] = atributosTabla.ref.split(":");
  const filaEncabezado = separarReferencia(inicio).fila;
  const { letras: columnaFin, fila: filaFin } = separarReferencia(fin);
  const conTotales = Number(atributosTabla.totalsRowCount || 0) > 0;
  const filaTotales = conTotales ? filaFin : null;
  const ultimaDatosPlantilla = conTotales ? filaFin - 1 : filaFin;
  const filasDatos = [];
  for (let n = filaEncabezado + 1; n <= ultimaDatosPlantilla; n++) if (hoja.tieneFila(n)) filasDatos.push(n);
  const modelo =
    filasDatos.find((n) => codigoAx(hoja.valorNumerico(n, "B")) !== null) ?? (filasDatos.length ? filasDatos[0] : null);
  const estilosModelo = modelo ? hoja.estilos(modelo) : {};
  const atributosModelo = modelo ? hoja.atributosFila(modelo) : {};
  const formulasModelo = modelo ? hoja.formulas(modelo) : {};

  const nuevas = [];
  const mapaFilas = new Map();
  existencias.forEach((existencia, i) => {
    const posicion = i + 1;
    const numero = filaEncabezado + posicion;
    const variante = indices.variante(existencia.variante_id);
    const origen = existencia.fila_origen;
    let estilos, atributosFila;
    if (filasDatos.includes(origen) && codigoAx(hoja.valorNumerico(origen, "B")) === variante.codigo) {
      estilos = hoja.estilos(origen);
      atributosFila = hoja.atributosFila(origen);
      mapaFilas.set(origen, numero);
    } else {
      estilos = estilosModelo;
      atributosFila = atributosModelo;
    }
    const saldo = saldos.get(existencia.id);
    const consumo = saldo ? saldo.consumo : CERO;
    const ingreso = saldo ? saldo.ingreso : CERO;
    const valores = {
      A: posicion,
      B: variante.codigo,
      D: textoONumero(dimensionMostrada(existencia, variante)),
      E: textoONumero(npMostrado(existencia, variante)),
      F: saldo ? saldo.cantidad : dec(existencia.cantidad_conteo),
      G: umMostrada(existencia, variante) || null,
      H: consumo.eq(0) ? null : consumo,
      I: ingreso.eq(0) ? null : ingreso,
    };
    const celdas = COLUMNAS.map((columna) => {
      const referencia = `${columna}${numero}`;
      if (formulasModelo[columna]) {
        return celdaFormula(referencia, desplazarFormula(formulasModelo[columna], numero - modelo), estilos[columna]);
      }
      return celda(referencia, valores[columna] ?? null, estilos[columna]);
    });
    nuevas.push(HojaXML.nuevaFila(numero, celdas, atributosFila));
  });

  const ultimaDatos = filaEncabezado + existencias.length;
  let ultima = ultimaDatos;
  if (filaTotales !== null) {
    ultima = ultimaDatos + 1;
    nuevas.push(hoja.moverFila(filaTotales, ultima));
  }
  // Filas debajo de la tabla (formato, celdas sueltas): se recorren como lo haría Excel.
  const delta = ultima - filaFin;
  const debajo = hoja.numerosFila.filter((n) => n > filaFin).sort((a, b) => a - b);
  for (const numero of debajo) {
    nuevas.push(hoja.moverFila(numero, numero + delta));
    mapaFilas.set(numero, numero + delta);
  }
  hoja.reemplazarFilas(
    hoja.numerosFila.filter((n) => n <= filaEncabezado),
    nuevas,
  );
  hoja.ajustarDimension(Math.max(ultima, ...debajo.map((n) => n + delta)));
  paquete.escribir(parte, fecha ? conFechaEnEncabezado(hoja.toString(), fecha) : hoja.toString());

  tabla = cambiarEtiqueta(tabla, "table", (e) => ponerAtributo(e, "ref", `${inicio}:${columnaFin}${ultima}`));
  const inicioFiltro = tabla.search(/<autoFilter\b/);
  if (inicioFiltro >= 0) {
    tabla = cambiarEtiqueta(
      tabla,
      "autoFilter",
      (e) => ponerAtributo(e, "ref", cambiarUltimaFila(atributos(e).ref, Math.max(ultimaDatos, filaEncabezado + 1))),
      inicioFiltro,
    );
  }
  paquete.escribir(parteTabla, tabla);

  if (filaTotales !== null) mapaFilas.set(filaTotales, ultima);
  moverNotas(paquete, parte, mapaFilas, advertencias);
  return ultima;
}

/** Área de impresión y filtro de la hoja al nuevo último renglón. */
function ajustarNombres(libro, indice, ultima) {
  return cambiarNombresDefinidos(libro, (nombre, local, texto) => {
    if (local !== String(indice)) return null;
    if (nombre === "_xlnm.Print_Area") return cambiarUltimaFila(texto, ultima);
    if (nombre === "_xlnm._FilterDatabase") return cambiarUltimaFila(texto, Math.max(ultima - 1, 2));
    return null;
  });
}

// ------------------------------------------------------- encabezado de página

const DIAS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
// "LUNES 28 SEPTIEMBRE DE  2026", "DOMINGO 19 DE ABRIL 2026", "28 de septiembre de 2026"…
const FECHA_LARGA = new RegExp(
  `(LUNES|MARTES|MI[EÉ]RCOLES|JUEVES|VIERNES|S[AÁ]BADO|DOMINGO)?(\\s*,?\\s*)(\\d{1,2})(\\s+DE)?(\\s+)(${MESES.join("|")})(\\s+DE)?(\\s+)(\\d{4})`,
  "gi",
);
const FECHA_CORTA = /(?<!\d)\d{1,2}\/\d{1,2}\/\d{4}(?!\d)/g;

/** Como venía escrito: MAYÚSCULAS, minúsculas o Inicial. */
function comoEn(muestra, texto) {
  if (muestra === muestra.toUpperCase()) return texto.toUpperCase();
  if (muestra === muestra.toLowerCase()) return texto.toLowerCase();
  return texto.charAt(0) + texto.slice(1).toLowerCase();
}

/** Texto del encabezado con la fecha cambiada por `iso`, respetando cómo estaba escrita. */
export function fechaEnTexto(texto, iso) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const semana = DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return texto
    .replace(FECHA_LARGA, (_, nombreDia, sep, d, de1, esp, nombreMes, de2, esp2) => {
      const conDia = nombreDia ? comoEn(nombreDia, semana) : "";
      return `${conDia}${sep}${d.startsWith("0") ? String(dia).padStart(2, "0") : dia}${de1 ?? ""}${esp}${comoEn(nombreMes, MESES[mes - 1])}${de2 ?? ""}${esp2}${anio}`;
    })
    .replace(FECHA_CORTA, () => `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${anio}`);
}

/** La fecha del encabezado de página (`oddHeader`, `evenHeader`, `firstHeader`); si no tiene fecha, no cambia. */
export function conFechaEnEncabezado(xml, iso) {
  return xml.replace(/(<(oddHeader|evenHeader|firstHeader)\b[^>]*>)([\s\S]*?)(<\/\2>)/g, (_, apertura, __, contenido, cierre) => apertura + fechaEnTexto(contenido, iso) + cierre);
}

// -------------------------------------------------------------------- notas

/** Las notas de celda siguen a su renglón (ref en comments y fila en el VML). */
function moverNotas(paquete, parte, mapa, advertencias) {
  const parteNotas = paquete.relacionDeTipo(parte, TIPOS.comentarios);
  if (!parteNotas) return;
  const eliminadas = new Set();
  let cambio = false;
  const notas = paquete.texto(parteNotas).replace(/<comment\b([^>]*?)(?:\/>|>[\s\S]*?<\/comment>)/g, (nota, attrs) => {
    const { letras, fila } = separarReferencia(atributos(attrs).ref);
    if (!mapa.has(fila)) {
      if (fila > 1) {
        eliminadas.add(fila);
        cambio = true;
        return "";
      }
      return nota;
    }
    if (mapa.get(fila) === fila) return nota;
    cambio = true;
    return nota.replace(/^<comment\b[^>]*?(?=\/?>)/, (apertura) => ponerAtributo(apertura, "ref", `${letras}${mapa.get(fila)}`));
  });
  if (eliminadas.size) {
    advertencias.push(`${parte}: se quitaron notas de filas que ya no existen ${[...eliminadas].sort((a, b) => a - b).join(", ")}`);
  }
  if (!cambio) return;
  paquete.escribir(parteNotas, notas);
  const parteVml = paquete.relacionDeTipo(parte, TIPOS.vml);
  if (!parteVml) return;
  const texto = paquete.textoBinario(parteVml);
  const nuevo = texto.replace(/<v:shape\b[\s\S]*?<\/v:shape>/g, (bloque) => {
    const filaVml = /<x:Row>(\d+)<\/x:Row>/.exec(bloque);
    if (!filaVml) return bloque;
    const anterior = Number(filaVml[1]) + 1;
    if (!mapa.has(anterior)) return eliminadas.has(anterior) ? "" : bloque;
    const delta = mapa.get(anterior) - anterior;
    if (!delta) return bloque;
    return bloque
      .replace(/(<x:Row>)(\d+)(<\/x:Row>)/g, (_, a, n, c) => `${a}${Number(n) + delta}${c}`)
      .replace(/(<x:Anchor>)([^<]*)(<\/x:Anchor>)/g, (todo, a, contenido, c) => {
        const numeros = contenido.split(",").map((x) => x.trim());
        if (numeros.length !== 8) return todo;
        numeros[2] = String(Number(numeros[2]) + delta);
        numeros[6] = String(Number(numeros[6]) + delta);
        return `${a}${numeros.join(", ")}${c}`;
      });
  });
  paquete.escribirBinario(parteVml, nuevo);
}

// ----------------------------------------------------------------- catálogo

/** Reescribe ARTICULOS_MX solo si hay códigos que la plantilla no tiene. */
function actualizarCatalogo(paquete, parte, estado) {
  const hoja = new HojaXML(paquete.texto(parte));
  const enPlantilla = new Set();
  for (const numero of hoja.numerosFila) {
    const valor = hoja.valorNumerico(numero, "A");
    const codigo = codigoAx(valor ? valor.split(".")[0] : null);
    if (codigo !== null) enPlantilla.add(codigo);
  }
  const articulos = Object.values(estado.articulos).sort((a, b) => a.codigo - b.codigo);
  if (articulos.every((a) => enPlantilla.has(a.codigo))) return;
  const conValor = hoja.numerosFila.filter((n) => hoja.valorNumerico(n, "A"));
  const primeraDatos = conValor.length ? Math.min(...conValor) : 3;
  const estilos = hoja.estilos(primeraDatos);
  const atributosFila = hoja.atributosFila(primeraDatos);
  const nuevas = articulos.map((articulo, i) => {
    const numero = primeraDatos + i;
    return HojaXML.nuevaFila(
      numero,
      [celda(`A${numero}`, articulo.codigo, estilos.A), celda(`B${numero}`, articulo.descripcion, estilos.B)],
      atributosFila,
    );
  });
  hoja.reemplazarFilas(
    hoja.numerosFila.filter((n) => n < primeraDatos),
    nuevas,
  );
  hoja.ajustarDimension(primeraDatos + articulos.length - 1);
  paquete.escribir(parte, hoja.toString());
}
