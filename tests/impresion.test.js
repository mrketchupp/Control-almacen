// Impresión del vale sobre la hoja-formulario del usuario.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FechaCelda, isoDesdeSerial } from "../src/nucleo/fechas.js";
import { analizarFormulario, hojasFormulario, seccionesPie } from "../src/impresion/formulario.js";
import { capaFondos, documentoImpresion, enRejilla, grosorEscalado, observacionesDeHoja, paginaHtml, valoresDeVale } from "../src/impresion/vale.js";
import * as v from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesVales, cargaSintetica } from "./ayuda.js";

const libro = new LibroLeido(bytesVales());
const ref = (celda) => `${String.fromCharCode(64 + celda.c)}${celda.r}`;

function valeDePrueba(estado, hoja = "MECANICO", renglones = 2) {
  const area = estado.plantillas_area.find((p) => p.nombre === hoja);
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: area.id, fecha: "2026-10-01" });
  for (let i = 0; i < renglones; i++) b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: String(10 + i), um: "LTS" });
  return v.emitirBorrador(estado, b.id, { capacidad: 50 })[0];
}

test("encuentra las hojas-formulario del libro de vales", () => {
  assert.deepEqual(hojasFormulario(libro), ["SOLDADOR", "MECANICO ", "TRANSFERENCIAS", "NOV"]);
});

test("ubica los campos por sus etiquetas", () => {
  const m = analizarFormulario(libro, "SOLDADOR");
  const c = m.campos;
  assert.deepEqual([c.fecha, c.folio, c.salida, c.origen, c.depto_destino].map(ref), ["J6", "K8", "K11", "E17", "I18"]);
  assert.equal(m.capacidad, 21);
  assert.deepEqual(c.lineas.columnas, { oc: 3, cantidad: 4, codigo: 5, descripcion: 6, clave: 9, um: 10, lote: 11 });
  assert.deepEqual([c.entrega_nombre, c.recibe_nombre, c.recibe_puesto].map(ref), ["D52", "I52", "I53"]);
  assert.equal(m.imagenes.length, 1); // el logo; el botón con macro no se imprime
  assert.deepEqual(m.pagina.pie, { izq: "FORMATO-PRUEBA", centro: "", der: "Emision: X" });
  assert.equal(m.pagina.escala, 0.59);
  assert.match(observacionesDeHoja(m), /ESPECIFICACIONES/);
});

test("cada hoja tiene su propia capacidad y posición de firmas", () => {
  const mecanico = analizarFormulario(libro, "MECANICO ");
  assert.equal(mecanico.capacidad, 19);
  assert.equal(ref(mecanico.campos.entrega_nombre), "D50");
  const nov = analizarFormulario(libro, "NOV");
  assert.equal(ref(nov.campos.entrega_nombre), "I52"); // el almacenista firma a la derecha
  assert.equal(ref(nov.campos.recibe_nombre), "D52");
  assert.equal(ref(analizarFormulario(libro, "TRANSFERENCIAS").campos.autoriza), "G58");
});

test("el vale llena folio, fecha, renglones y firmas y limpia lo que traía la hoja", () => {
  const { estado } = cargaSintetica();
  const vale = valeDePrueba(estado);
  const m = analizarFormulario(libro, "MECANICO ");
  const valores = valoresDeVale(m, vale);
  assert.equal(valores.get("8,11"), 10); // K8 = folio
  assert.ok(valores.get("6,10") instanceof FechaCelda);
  assert.equal(isoDesdeSerial(valores.get("6,10").serial), "2026-10-01");
  assert.equal(valores.get("11,11"), "XXXXX");
  assert.equal(valores.get("21,4"), 10);
  assert.equal(valores.get("22,6"), "SUMINISTRO DE DIESEL Y COMBUSTIBLE");
  assert.equal(valores.get("21,3"), "S/OC");
  assert.equal(valores.get("23,4"), null); // renglón sin usar queda vacío
  assert.equal(valores.get("23,6"), null); // y sin la fórmula de la hoja
  assert.equal(valores.get("50,4"), "ALMACENISTA UNO");
  assert.equal(valores.get("50,9"), "MECANICO UNO");
  const html = paginaHtml(m, valores);
  assert.match(html, />10</);
  assert.match(html, /SUMINISTRO DE DIESEL Y COMBUSTIBLE/);
  assert.match(html, /FORMATO-PRUEBA/);
  assert.match(html, /colspan="3"/); // descripción en F:H combinadas
});

test("observaciones propias reemplazan a las de la hoja; sin observaciones se respetan", () => {
  const { estado } = cargaSintetica();
  const vale = valeDePrueba(estado, "SOLDADOR");
  const m = analizarFormulario(libro, "SOLDADOR");
  vale.observaciones = "ENTREGA PARCIAL\nFALTA 1 PIEZA";
  let valores = valoresDeVale(m, vale);
  const obs = m.campos.observaciones;
  assert.equal(valores.get(`${obs.textos[0].r},3`), "ENTREGA PARCIAL");
  assert.equal(valores.get(`${obs.textos[1].r},3`), "FALTA 1 PIEZA");
  vale.observaciones = null; // vale migrado: se imprimen las de la hoja
  valores = valoresDeVale(m, vale);
  assert.ok(!valores.has(`${obs.textos[0].r},3`));
});

test("un borrador se imprime con la leyenda BORRADOR en el folio", () => {
  const { estado } = cargaSintetica();
  const area = estado.plantillas_area.find((p) => p.nombre === "SOLDADOR");
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: area.id });
  const m = analizarFormulario(libro, "SOLDADOR");
  assert.equal(valoresDeVale(m, { ...b, folio: null }).get("8,11"), "BORRADOR");
});

test("documento de varias páginas con tamaño carta", () => {
  const { estado } = cargaSintetica();
  const m = analizarFormulario(libro, "SOLDADOR");
  const doc = documentoImpresion([
    { modelo: m, vale: valeDePrueba(estado, "SOLDADOR") },
    { modelo: m, vale: valeDePrueba(estado, "SOLDADOR") },
  ]);
  assert.match(doc.css, /@page\{size:letter portrait/);
  assert.equal((doc.html.match(/class="vale-pagina"/g) || []).length, 2);
});

test("encabezados y pies de página de Excel", () => {
  assert.deepEqual(seccionesPie("&amp;LFORMATO-PRUEBA    &amp;REmision: X"), { izq: "FORMATO-PRUEBA", centro: "", der: "Emision: X" });
  assert.deepEqual(seccionesPie('&amp;C&amp;"Arial,Negrita"&amp;12Hoja &amp;P de &amp;N'), { izq: "", centro: "Hoja 1 de 1", der: "" });
  assert.equal(seccionesPie(""), null);
});

test("el texto de una fila espaciadora de 1 px no se imprime (en Excel no se ve)", () => {
  const m = analizarFormulario(libro, "SOLDADOR");
  const fila = m.filas.find((f) => f.r === 47);
  assert.ok(fila.px <= 2, `la fila 47 mide ${fila.px}px`);
  assert.equal(m.valor(47, 3), 3);
  const html = paginaHtml(m);
  const tr = html.split("<tr ")[m.filas.findIndex((f) => f.r === 47) + 1];
  assert.doesNotMatch(tr, />3</);
  assert.ok(!m.campos.observaciones.textos.some((t) => t.r === 47), "el número no es una observación");
});

test("una combinación conserva su texto cuando el origen está oculto o fuera del área de impresión", () => {
  for (const caso of ["fila oculta", "columna oculta", "fuera del área"]) {
    const m = analizarFormulario(libro, "SOLDADOR");
    const rango = { r1: 40, r2: 41, c1: 3, c2: 11 };
    for (let r = rango.r1; r <= rango.r2; r++) {
      for (let c = rango.c1; c <= rango.c2; c++) m.combinadaEn.set(`${r},${c}`, rango);
    }
    const valorOriginal = m.valor;
    m.valor = (r, c) => (r === 40 && c === 3 ? "TÍTULO DEL FORMATO" : valorOriginal(r, c));
    if (caso === "fila oculta") m.filas = m.filas.filter((f) => f.r !== 40);
    else if (caso === "columna oculta") m.columnas = m.columnas.filter((c) => c.c !== 3);
    else {
      m.area = { ...m.area, r1: 41, c1: 4 };
      m.filas = m.filas.filter((f) => f.r >= 41);
      m.columnas = m.columnas.filter((c) => c.c >= 4);
    }
    const html = paginaHtml(m);
    const celdas = [...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
    const titulos = celdas.filter(([, , contenido]) => contenido.replace(/<[^>]+>/g, "") === "TÍTULO DEL FORMATO");
    assert.equal(titulos.length, 1, `el título aparece una vez: ${caso}`);
    assert.match(titulos[0][1], caso === "fila oculta" ? /colspan="9"/ : /colspan="8"/);
    if (caso === "columna oculta") assert.match(titulos[0][1], /rowspan="2"/);
    else assert.doesNotMatch(titulos[0][1], /rowspan=/);
  }
});

test("NOV: cuatro firmas, espacios para 3 fotos y partidas solo arriba de las fotos", () => {
  const { estado } = cargaSintetica();
  const m = analizarFormulario(libro, "NOV");
  assert.equal(m.fotos.length, 3);
  assert.ok(m.fotos.every((f) => f.ancho > 20 && f.alto > 20));
  assert.equal(m.imagenes.length, 1, "el logo se imprime; las fotos del ejemplo no");
  assert.equal(m.capacidad, 4);
  const { izq, der } = m.campos.firmas_extra;
  assert.deepEqual([ref(izq.nombre), ref(izq.puesto), ref(der.nombre), ref(der.puesto)], ["D56", "D57", "I56", "I57"]);
  const nov = estado.plantillas_area.find((p) => p.nombre === "NOV");
  const b = v.nuevoBorrador(estado, { usuario: "ALMACENISTA UNO", plantillaId: nov.id });
  b.lineas.push({ ...v.lineaNoInventariada(estado, 136), cantidad: "1000", um: "LTS", clave: "DIESEL" });
  const valores = valoresDeVale(m, { ...b, firma_extra_der_nombre: "OTRO PATRIMONIAL" });
  assert.equal(valores.get("56,4"), "PERSONAL NOV UNO");
  assert.equal(valores.get("56,9"), "OTRO PATRIMONIAL");
  assert.equal(valores.get("57,9"), "SEG PATRIMONIAL");
  // sin datos de la segunda fila (vales migrados) no se imprimen los nombres del ejemplo
  assert.equal(valoresDeVale(m, { ...b, firma_extra_izq_nombre: null }).get("56,4"), null);
  const html = paginaHtml(m, valores, ["data:image/jpeg;base64,AAAA", null, "data:image/jpeg;base64,BBBB"]);
  assert.equal((html.match(/class="vale-foto"/g) || []).length, 2);
});

test("TRANSFERENCIAS: el puesto de quien autoriza va debajo de su nombre", () => {
  const m = analizarFormulario(libro, "TRANSFERENCIAS");
  assert.deepEqual([ref(m.campos.autoriza), ref(m.campos.autoriza_puesto)], ["G58", "G59"]);
  const valores = valoresDeVale(m, { fecha: "2026-10-01", lineas: [], autorizo_nombre: "OTRA PERSONA", autorizo_puesto: "ITP" });
  assert.deepEqual([valores.get("58,7"), valores.get("59,7")], ["OTRA PERSONA", "ITP"]);
});

test("NOV migrado del DIARIO: al reimprimir, las firmas respetan su posición", () => {
  const m = analizarFormulario(libro, "NOV");
  const migrado = { migrado: true, fecha: "2026-09-03", lineas: [], entrego_nombre: "QUIMICO DOS", recibio_nombre: "ALMACENISTA UNO" };
  const valores = valoresDeVale(m, migrado);
  assert.deepEqual([valores.get("52,4"), valores.get("52,9")], ["QUIMICO DOS", "ALMACENISTA UNO"]);
  const nuevo = valoresDeVale(m, { ...migrado, migrado: false, entrego_nombre: "ALMACENISTA UNO", recibio_nombre: "QUIMICO DOS" });
  assert.deepEqual([nuevo.get("52,4"), nuevo.get("52,9")], ["QUIMICO DOS", "ALMACENISTA UNO"]);
});

test("los títulos de firma se centran sobre las columnas de su nombre y puesto", () => {
  const m = analizarFormulario(libro, "SOLDADOR");
  // En el formato, «RECIBIO/ENTREGO» es una celda suelta en J50 y el nombre ocupa I52:K52.
  const r = m.campos.recibe_nombre;
  assert.deepEqual([r.r, r.c], [52, 9]);
  assert.deepEqual(m.combinadaEn.get("50,9"), { r1: 50, r2: 50, c1: 9, c2: 11 });
  assert.deepEqual([m.valor(50, 9), m.valor(50, 10)], ["RECIBIO/ENTREGO", null]);
  assert.ok(m.centradas.has("50,9"));
  const html = paginaHtml(m);
  const celdas = [...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
  for (const titulo of ["RECIBIO/ENTREGO", "ENTREGO/RECIBIO"]) {
    const celda = celdas.find(([, , contenido]) => contenido.replace(/<[^>]+>/g, "") === titulo);
    assert.ok(celda, `se conserva el título ${titulo}`);
    assert.match(celda[1], /colspan="3"/);
    assert.match(celda[1], /text-align:center/);
  }
});

test("bordes nítidos y sin rendijas: rejilla de píxeles, grosor escalado y capa de rellenos", () => {
  // Cada orilla cae en un píxel entero ya con el zoom.
  const anchos = enRejilla([82, 96, 155], 0.59);
  let x = 0;
  for (const w of anchos) {
    x += w;
    assert.ok(Math.abs(x * 0.59 - Math.round(x * 0.59)) < 1e-9);
  }
  // Un borde de 2 px (marco) sigue midiendo 2 px después del zoom; uno de 1 px, 1 px.
  assert.equal(grosorEscalado("2px solid #000000", 0.5), "4.000px solid #000000");
  assert.equal(grosorEscalado("1px solid #000000", 0.5), "2.000px solid #000000");
  // Rellenos contiguos del mismo color se juntan en un solo rectángulo (franja morada).
  const capa = capaFondos([
    { x: 0, y: 10, w: 5, h: 2, fondo: "#7030A0" },
    { x: 5, y: 10, w: 7, h: 2, fondo: "#7030A0" },
    { x: 12, y: 10, w: 3, h: 2, fondo: "#FFFF00" },
    { x: 0, y: 12, w: 12, h: 2, fondo: "#7030A0" },
  ]);
  assert.equal((capa.match(/vale-fondo/g) ?? []).length, 2);
  assert.match(capa, /left:0\.000px;top:10\.000px;width:12\.000px;height:4\.000px;background:#7030A0/);
  // En la hoja: la franja de encabezados de la tabla va en la capa, debajo de la tabla.
  const html = paginaHtml(analizarFormulario(libro, "SOLDADOR"));
  assert.ok(html.indexOf("vale-fondo") < html.indexOf("<table"));
});
