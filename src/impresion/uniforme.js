// Vale impreso uniforme (Ronda 25, decisiones del usuario V-1 a V-7): las hojas-formulario estándar se
// imprimen con el mismo formato aunque en el libro de vales cada una traiga sus diferencias. Solo cambia lo
// que se imprime: el libro de vales y su hoja-formulario no se tocan.
//
//   V-1  Fecha y No. folio con línea sencilla (un borde delgado alrededor del valor).
//   V-2  Las partidas en una sola letra (Arial 9, centrada) y con todas sus líneas (bordes delgados).
//   V-3  El título «OBSERVACIÓN» y 21 partidas: una hoja con menos (MECANICO, OPERACION DIA) gana filas
//        iguales a su última partida; lo de abajo (observaciones y firmas) baja con ellas.
//   V-4  Sin el punto suelto (una celda fija que solo tiene «.»).
//   V-5  El logo se queda. V-7  El pie de página es correcto (ninguno de los dos cambia).
//   V-6  La columna PRESENTACIÓN, ancha para que quepa su título; el ancho sale de la descripción, así la
//        hoja conserva su ancho y su escala.
//
// NOV (fotos y segunda fila de firmas) y TRANSFERENCIAS (quien autoriza) tienen su propio formato y se
// imprimen como vienen; de V-3 y V-4 solo les toca el texto (título con acento, sin el punto suelto).
// En el Inventario B solo cambian el logo y los textos del inventario (`impresion/identidad.js`).

import { formatearValor } from "../xlsx/estilos.js";

export const PARTIDAS_UNIFORMES = 21;
export const TITULO_OBSERVACIONES = "OBSERVACIÓN";
const DELGADO = "1px solid #000000";
const LADOS = ["border-left", "border-right", "border-top", "border-bottom"];
/** V-2: la letra de las partidas. */
export const LETRA_PARTIDAS = {
  "font-family": '"Arial", Arial, sans-serif',
  "font-size": "9pt",
  "font-weight": null,
  "font-style": null,
  "text-decoration": null,
  color: "#000000",
  "text-align": "center",
  "vertical-align": "middle",
};

/**
 * Estilos del libro más estilos derivados, solo para imprimir: `derivar(indice, { bordes, texto })` da un
 * índice nuevo ("d0", "d1"…) con esos lados de borde (null = sin borde) y esas propiedades de CSS (null = se
 * quita). Los índices del libro siguen igual y el libro no cambia.
 */
export function estilosDerivables(base) {
  if (base?.derivar) return base;
  const derivados = [];
  const claves = new Map();
  const memoria = new Map();
  const de = (indice) => (typeof indice === "string" && indice.startsWith("d") ? derivados[Number(indice.slice(1))] : undefined);
  return {
    base,
    derivar(indice, { bordes = {}, texto = {} } = {}) {
      const previo = de(indice);
      const cambio = { origen: previo ? previo.origen : indice, bordes: { ...previo?.bordes, ...bordes }, texto: { ...previo?.texto, ...texto } };
      const clave = JSON.stringify(cambio);
      if (!claves.has(clave)) {
        claves.set(clave, `d${derivados.length}`);
        derivados.push(cambio);
      }
      return claves.get(clave);
    },
    codigoFormato: (indice) => base.codigoFormato(de(indice)?.origen ?? indice),
    bordesCss(indice) {
      const d = de(indice);
      if (!d) return base.bordesCss(indice);
      const css = { ...base.bordesCss(d.origen) };
      for (const [lado, valor] of Object.entries(d.bordes)) {
        if (valor) css[lado] = valor;
        else delete css[lado];
      }
      return css;
    },
    css(indice) {
      const d = de(indice);
      if (!d) return base.css(indice);
      if (!memoria.has(indice)) {
        const estilo = base.css(d.origen);
        const css = { ...estilo.css };
        for (const [propiedad, valor] of Object.entries(d.texto)) {
          if (valor === null) delete css[propiedad];
          else css[propiedad] = valor;
        }
        memoria.set(indice, { ...estilo, css, alineado: estilo.alineado || Boolean(d.texto["text-align"]) });
      }
      return memoria.get(indice);
    },
  };
}

/** Hoja estándar: sin quien autoriza (TRANSFERENCIAS) y sin segunda fila de firmas ni fotos (NOV). */
export function esHojaEstandar(modelo) {
  const { campos } = modelo;
  return !campos.autoriza && !campos.firmas_extra && !(modelo.fotos ?? []).length;
}

const vacia = (valor) => valor === null || valor === undefined || (typeof valor === "string" && !valor.trim());

/** Columnas de la tabla de partidas: de la primera a la última, con lo que abarquen sus combinaciones. */
function columnasDePartidas(modelo) {
  const { campos } = modelo;
  const cols = Object.values(campos.lineas.columnas);
  let primera = Math.min(...cols);
  let ultima = Math.max(...cols);
  const r = campos.lineas.filas[0];
  if (r !== undefined) {
    primera = Math.min(primera, modelo.combinadaEn.get(`${r},${primera}`)?.c1 ?? primera);
    ultima = Math.max(ultima, modelo.combinadaEn.get(`${r},${ultima}`)?.c2 ?? ultima);
  }
  return { primera, ultima };
}

/** Grosor de un borde en CSS («2px solid #000000» → 2); un doble cuenta como grueso. */
const grosor = (borde) => (borde ? (/double/.test(borde) ? 3 : Number.parseFloat(borde) || 0) : 0);

/**
 * Lo que la hoja estándar imprime distinto (V-1 a V-4). Se aplica al modelo de `analizarFormulario`, ya con
 * sus campos y sus fotos: cambia sus filas (las partidas que faltan), sus valores (título, punto suelto) y sus
 * estilos (fecha, folio y partidas) solo para imprimir. Pone `modelo.uniforme` en las hojas estándar.
 */
export function formatoUniforme(modelo) {
  modelo.estilos = estilosDerivables(modelo.estilos);
  textosFijos(modelo);
  if (!esHojaEstandar(modelo) || !modelo.campos.lineas.filas.length) return modelo;
  const propios = new Map();
  const anterior = modelo.estiloDe;
  const { nuevas, copiaDe } = completarPartidas(modelo, PARTIDAS_UNIFORMES);
  // Las filas nuevas copian todo de la última partida (también el marco fuera de las partidas).
  modelo.estiloDe = (r, c) => propios.get(`${r},${c}`) ?? anterior(nuevas.get(r) ?? r, c);
  letraDePartidas(modelo, propios, (r, c) => anterior(copiaDe.get(r) ?? r, c));
  lineaSencilla(modelo, propios);
  modelo.capacidad = modelo.campos.lineas.filas.length;
  modelo.uniforme = true;
  return modelo;
}

/** V-3 (título) y V-4 (punto suelto) en lo fijo de la hoja: en todas las hojas, también NOV y TRANSFERENCIAS. */
function textosFijos(modelo) {
  const { area } = modelo;
  const celdas = new Set();
  for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) celdas.add(`${r},${c}`);
  // Una combinación puede empezar fuera del área (ver paginaHtml): su texto está en su primera celda.
  for (const rango of modelo.combinadaEn.values()) celdas.add(`${rango.r1},${rango.c1}`);
  const cambios = new Map();
  for (const celda of celdas) {
    const [r, c] = celda.split(",").map(Number);
    const valor = modelo.valor(r, c);
    if (typeof valor !== "string") continue;
    const texto = valor.trim();
    if (/^\.+$/.test(texto)) cambios.set(celda, null);
    else if (/^OBSERVACI[OÓ]N(ES)?\s*:?$/i.test(texto) && texto !== TITULO_OBSERVACIONES) cambios.set(celda, TITULO_OBSERVACIONES);
  }
  if (!cambios.size) return;
  const valorAnterior = modelo.valor;
  modelo.valor = (r, c) => {
    const celda = `${r},${c}`;
    return cambios.has(celda) ? cambios.get(celda) : valorAnterior(r, c);
  };
}

function filaEnBlanco(modelo, r) {
  for (const { c } of modelo.columnas) {
    const rango = modelo.combinadaEn.get(`${r},${c}`);
    if (!vacia(modelo.valor(rango?.r1 ?? r, rango?.c1 ?? c))) return false;
  }
  return true;
}

/**
 * V-3: lleva las partidas a `total`. Primero las filas en blanco combinadas a todo lo ancho que siguen a la
 * última partida (así quedan como en las hojas de 21); después agrega filas nuevas (`r` entre la última y la
 * siguiente: 39.01, 39.02…), con el alto, los estilos y las combinaciones de la última partida.
 * @returns { nuevas: Map fila nueva → última partida, copiaDe: Map fila agregada (nueva o convertida) → última partida }
 */
function completarPartidas(modelo, total) {
  const { campos } = modelo;
  const filas = campos.lineas.filas;
  const resultado = { nuevas: new Map(), copiaDe: new Map() };
  if (filas.length >= total) return resultado;
  const fuente = filas[filas.length - 1];
  const filaFuente = modelo.filas.find((f) => f.r === fuente);
  if (!filaFuente) return resultado;
  const { primera, ultima } = columnasDePartidas(modelo);
  const copiasDe = [...new Set(modelo.combinadaEn.values())].filter((g) => g.r1 === fuente && g.r2 === fuente);
  const antes = modelo.filas.map((f) => ({ ...f }));
  const combinar = (rango) => {
    for (let c = rango.c1; c <= rango.c2; c++) modelo.combinadaEn.set(`${rango.r1},${c}`, rango);
    modelo.combinadas.push(rango);
  };

  const convertidas = [];
  for (let i = modelo.filas.findIndex((f) => f.r === fuente) + 1; i < modelo.filas.length && filas.length + convertidas.length < total; i++) {
    const { r } = modelo.filas[i];
    const rango = modelo.combinadaEn.get(`${r},${primera}`);
    if (!rango || rango.r1 !== r || rango.r2 !== r || rango.c1 > primera || rango.c2 < ultima || !filaEnBlanco(modelo, r)) break;
    for (let c = rango.c1; c <= rango.c2; c++) modelo.combinadaEn.delete(`${r},${c}`);
    modelo.combinadas = modelo.combinadas.filter((g) => g !== rango);
    for (const copia of copiasDe) combinar({ ...copia, r1: r, r2: r });
    modelo.filas[i] = { ...modelo.filas[i], px: filaFuente.px };
    convertidas.push(r);
  }

  const tras = convertidas.length ? convertidas[convertidas.length - 1] : fuente;
  const nuevas = Array.from({ length: total - filas.length - convertidas.length }, (_, i) => tras + (i + 1) / 100);
  if (nuevas.length) {
    const posicion = modelo.filas.findIndex((f) => f.r === tras) + 1;
    modelo.filas.splice(posicion, 0, ...nuevas.map((r) => ({ r, px: filaFuente.px, estilo: filaFuente.estilo })));
    // Una combinación de varias filas que cruza el lugar de las nuevas también las cubre (como en Excel).
    for (const rango of new Set(modelo.combinadaEn.values())) {
      if (rango.r1 <= tras && rango.r2 > tras) for (const r of nuevas) for (let c = rango.c1; c <= rango.c2; c++) modelo.combinadaEn.set(`${r},${c}`, rango);
    }
    for (const r of nuevas) for (const copia of copiasDe) combinar({ ...copia, r1: r, r2: r });
    for (const r of nuevas) resultado.nuevas.set(r, fuente);
    const valorAnterior = modelo.valor;
    modelo.valor = (r, c) => (resultado.nuevas.has(r) ? null : valorAnterior(r, c));
  }
  for (const r of [...convertidas, ...nuevas]) resultado.copiaDe.set(r, fuente);
  campos.lineas.filas = [...filas, ...convertidas, ...nuevas];
  campos.observaciones.filas = campos.observaciones.filas.filter((r) => !convertidas.includes(r));
  campos.lineas.agregadas = convertidas.length + nuevas.length;

  // Los logos y demás imágenes de abajo bajan con las filas.
  const finTras = antes.reduce((s, f) => (f.r <= tras ? s + f.px : s), 0);
  const agregado = nuevas.length * filaFuente.px;
  const pxAntes = antes.map((f) => f.px);
  const pxDespues = antes.map((f) => modelo.filas.find((x) => x.r === f.r).px);
  const mover = (y) => trasladar(y, pxAntes, pxDespues) + (y >= finTras - 0.01 ? agregado : 0);
  modelo.imagenes = modelo.imagenes.map((i) => ({ ...i, y: mover(i.y), alto: mover(i.y + i.alto) - mover(i.y) }));
  return resultado;
}

/** Posición en px con las medidas `antes` llevada a las medidas `despues` (las mismas filas o columnas, en orden). */
export function trasladar(posicion, antes, despues) {
  let a = 0;
  let d = 0;
  for (let i = 0; i < antes.length; i++) {
    if (posicion < a + antes[i]) return d + (antes[i] ? ((posicion - a) * despues[i]) / antes[i] : 0);
    a += antes[i];
    d += despues[i];
  }
  return d + posicion - a;
}

/**
 * V-2: cada celda de las partidas en Arial 9, centrada y con sus cuatro líneas delgadas. Las orillas de la
 * tabla conservan un borde más grueso si la hoja lo trae (el marco del formato).
 */
function letraDePartidas(modelo, propios, estiloBase) {
  const { campos } = modelo;
  const { primera, ultima } = columnasDePartidas(modelo);
  const filas = campos.lineas.filas;
  const columnas = modelo.columnas.map(({ c }) => c).filter((c) => c >= primera && c <= ultima);
  if (!columnas.length) return;
  const izquierda = columnas[0];
  const derecha = columnas[columnas.length - 1];
  filas.forEach((r, i) => {
    for (const c of columnas) {
      const base = estiloBase(r, c);
      const actuales = modelo.estilos.bordesCss(base);
      const orilla = { "border-left": c === izquierda, "border-right": c === derecha, "border-top": i === 0, "border-bottom": i === filas.length - 1 };
      const bordes = {};
      for (const lado of LADOS) bordes[lado] = orilla[lado] && grosor(actuales[lado]) > 1 ? actuales[lado] : DELGADO;
      propios.set(`${r},${c}`, modelo.estilos.derivar(base, { bordes, texto: LETRA_PARTIDAS }));
    }
  });
}

/** V-1: el valor de la fecha y del folio con una línea delgada alrededor (también donde lo toca la vecina). */
function lineaSencilla(modelo, propios) {
  const { campos } = modelo;
  const estilo = (r, c) => modelo.estiloDe(r, c);
  const poner = (r, c, bordes) => propios.set(`${r},${c}`, modelo.estilos.derivar(estilo(r, c), { bordes }));
  for (const campo of [campos.fecha, campos.folio]) {
    if (!campo) continue;
    const rango = modelo.combinadaEn.get(`${campo.r},${campo.c}`) ?? { r1: campo.r, r2: campo.r, c1: campo.c, c2: campo.c };
    for (let r = rango.r1; r <= rango.r2; r++) {
      for (let c = rango.c1; c <= rango.c2; c++) poner(r, c, Object.fromEntries(LADOS.map((lado) => [lado, DELGADO])));
    }
    // Con bordes colapsados gana el más grueso: el de la vecina que toca el valor también queda delgado.
    const vecina = (r, c, lado) => {
      if (grosor(modelo.estilos.bordesCss(estilo(r, c))[lado]) > 1) poner(r, c, { [lado]: DELGADO });
    };
    for (let r = rango.r1; r <= rango.r2; r++) {
      vecina(r, rango.c1 - 1, "border-right");
      vecina(r, rango.c2 + 1, "border-left");
    }
    for (let c = rango.c1; c <= rango.c2; c++) {
      vecina(rango.r1 - 1, c, "border-bottom");
      vecina(rango.r2 + 1, c, "border-top");
    }
  }
}

// Por medidor (el del navegador al imprimir varios vales): el ancho en que cabe cada texto en una línea.
const memoriaAnchos = new WeakMap();

/** El ancho más chico (px, ±0.25) en que `texto` cabe en una línea con ese CSS, según `medirTexto`. */
export function anchoDeUnaLinea(texto, css, medirTexto) {
  if (!memoriaAnchos.has(medirTexto)) memoriaAnchos.set(medirTexto, new Map());
  const memoria = memoriaAnchos.get(medirTexto);
  const clave = JSON.stringify([texto, css["font-family"], css["font-size"], css["font-weight"], css["font-style"]]);
  if (memoria.has(clave)) return memoria.get(clave);
  const unaLinea = medirTexto(texto, css, 100000);
  const cabe = (ancho) => medirTexto(texto, css, ancho) <= unaLinea + 0.5;
  let bajo = 0;
  let alto = 64;
  for (let i = 0; i < 12 && !cabe(alto); i++) alto *= 2;
  for (let i = 0; i < 24 && alto - bajo > 0.25; i++) {
    const medio = (bajo + alto) / 2;
    if (cabe(medio)) alto = medio;
    else bajo = medio;
  }
  memoria.set(clave, alto);
  return alto;
}

/**
 * V-6: si el título de PRESENTACIÓN no cabe en una línea, la columna se ensancha lo necesario y ese ancho
 * sale de la columna más ancha de la descripción (sin dejarla en menos de la mitad). Devuelve otro modelo
 * (el de la hoja no cambia); las imágenes conservan su lugar sobre las columnas.
 * @param medirTexto altura del texto con su CSS y un ancho interior, en px (la del navegador al imprimir)
 * @param fijo       los textos del inventario (`identidad`) sobre lo fijo de la hoja
 */
export function ensancharPresentacion(modelo, medirTexto, fijo = (valor) => valor) {
  if (!modelo.uniforme) return modelo;
  const { columnas: cl, encabezado, filas } = modelo.campos.lineas;
  if (cl.um === undefined || encabezado === undefined) return modelo;
  const rangoDe = (r, c) => modelo.combinadaEn.get(`${r},${c}`) ?? { r1: r, r2: r, c1: c, c2: c };
  const titulo = rangoDe(encabezado, cl.um);
  const indice = modelo.estiloDe(titulo.r1, titulo.c1);
  const texto = formatearValor(fijo(modelo.valor(titulo.r1, titulo.c1)), modelo.estilos.codigoFormato(indice)).trim();
  if (!texto) return modelo;
  const css = modelo.estilos.css(indice).css;
  const propias = modelo.columnas.filter(({ c }) => c >= titulo.c1 && c <= titulo.c2);
  if (!propias.length) return modelo;
  // Interior: la sangría del texto (2 px por lado), las líneas y un poco de aire para que no las toque.
  const orilla = 4 + 2 + 4;
  const ancho = propias.reduce((s, col) => s + col.px, 0);
  const necesario = anchoDeUnaLinea(texto, css, medirTexto);
  if (necesario <= ancho - orilla) return modelo;
  const extra = Math.ceil(necesario + orilla - ancho);
  const ensanchar = propias.reduce((a, b) => (b.px > a.px ? b : a));
  const descripcion = cl.descripcion === undefined || !filas.length ? null : rangoDe(filas[0], cl.descripcion);
  const donantes = descripcion ? modelo.columnas.filter(({ c }) => c >= descripcion.c1 && c <= descripcion.c2 && !propias.some((p) => p.c === c)) : [];
  const donante = donantes.length ? donantes.reduce((a, b) => (b.px > a.px ? b : a)) : null;
  const quitar = donante ? Math.min(extra, Math.floor(donante.px / 2)) : 0;
  const columnas = modelo.columnas.map((col) => (col === ensanchar ? { ...col, px: col.px + extra } : col === donante ? { ...col, px: col.px - quitar } : col));
  const antes = modelo.columnas.map((c) => c.px);
  const despues = columnas.map((c) => c.px);
  const mover = (imagen) => {
    const x = trasladar(imagen.x, antes, despues);
    return { ...imagen, x, ancho: trasladar(imagen.x + imagen.ancho, antes, despues) - x };
  };
  return { ...modelo, columnas, imagenes: modelo.imagenes.map(mover), fotos: modelo.fotos?.map(mover) };
}
