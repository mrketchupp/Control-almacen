// Lista de revisión del historial (formato v2): se genera desde los archivos del usuario,
// el usuario la contesta en Excel y la herramienta aplica sus respuestas en la primera carga.
// Es un archivo NUEVO (no una plantilla del usuario).

import { esErrorDeDedo } from "../nucleo/catalogo.js";
import { ratio } from "../nucleo/difflib.js";
import { FechaCelda, fmtFecha, hoyIso, serialExcel, sumarDias } from "../nucleo/fechas.js";
import * as n from "../nucleo/normalizar.js";
import { esPerdido } from "../importadores/vales.js";
import { letraColumna } from "../xlsx/celdas.js";
import { LibroLeido } from "../xlsx/leer.js";
import { LibroNuevo } from "../xlsx/nuevo.js";
import { VACIO, claveNormalizacion, mismoValor, respuestasVacias } from "./limpieza.js";

export const MARCA_FORMATO = "REVISION-V2";
const SI = "Sí";
const NO = "No";

export const HOJA_RENGLONES = "1 Renglones a corregir";
export const HOJA_DUPLICADOS = "2 Duplicados";
export const HOJA_FOLIOS = "3 Folios a verificar";
export const HOJA_CODIGOS = "4 Códigos fuera de catálogo";
export const HOJA_NOMBRES = "5 Nombres a unificar";
export const HOJA_VALORES = "6 Valores a normalizar";
export const HOJA_INVENTARIO = "7 Inventario físico";

// Columnas editables de la hoja 1: [encabezado, campo del renglón]
export const EDITABLES = [
  ["Fecha", "fecha"],
  ["Origen", "origen"],
  ["Depto. origen", "depto_origen"],
  ["Destino", "destino"],
  ["Depto. destino", "depto_destino"],
  ["O.C.", "oc"],
  ["Cantidad", "cantidad"],
  ["Código", "codigo"],
  ["Descripción", "descripcion"],
  ["Clave", "clave"],
  ["U.M.", "um"],
  ["Lote", "lote"],
  ["Entregó", "entrego"],
  ["Recibió", "recibio"],
  ["Autorizó", "autorizo"],
];
export const FIJAS_HOJA1 = ["Prioridad", "Fila en DIARIO", "Folio", "Situación"];
export const CAMPOS_VALORES = {
  "U.M.": "um",
  "Lote / C.U": "lote",
  Origen: "origen",
  "Depto. origen": "depto_origen",
  Destino: "destino",
  "Depto. destino": "depto_destino",
};
const SINONIMOS = {
  um: { CUB: "CUBETA", LITROS: "LTS", LT: "LTS", M: "MTS", MT: "MTS", PZAS: "PZA", PZ: "PZA" },
  lote: { NEUVO: "NUEVO", NUEV0: "NUEVO", NUEVA: "NUEVO", O: VACIO },
};
const CAMPOS_SUGERIBLES = ["fecha", "origen", "depto_origen", "destino", "depto_destino", "entrego", "recibio", "autorizo"];

const FUENTE = "Arial";
const BORDE = "BFBFBF";
const COLORES = { encabezado: "1F3864", editable: "FFF2CC", perdido: "F8CBAD" };
const PRIORIDAD = { Alta: "F8CBAD", Media: "FFE699", Baja: "E2EFDA" };

export class ErrorRevision extends Error {}

// ======================================================================
// Utilidades
// ======================================================================

/** Contador al estilo collections.Counter: conserva el orden de primera aparición. */
function contar(valores) {
  const conteo = new Map();
  for (const v of valores) conteo.set(v, (conteo.get(v) || 0) + 1);
  return conteo;
}

function masComun(conteo) {
  let mejor = null;
  let veces = 0;
  for (const [valor, n] of conteo) {
    if (n > veces) {
      mejor = valor;
      veces = n;
    }
  }
  return mejor;
}

function porFolio(renglones) {
  const grupos = new Map();
  for (const r of renglones) {
    if (r.folio === null) continue;
    if (!grupos.has(r.folio)) grupos.set(r.folio, []);
    grupos.get(r.folio).push(r);
  }
  return grupos;
}

function fechasFolio(grupos) {
  const fechas = new Map();
  for (const [folio, filas] of grupos) {
    const validas = filas.map((r) => r.fecha).filter(Boolean);
    if (validas.length) fechas.set(folio, masComun(contar(validas)));
  }
  return fechas;
}

const ordenarNumeros = (lista) => [...lista].sort((a, b) => a - b);
const minimo = (lista) => lista.reduce((a, b) => (b < a ? b : a));
const maximo = (lista) => lista.reduce((a, b) => (b > a ? b : a));

/** Clave de igualdad para comparar valores crudos de celda (duplicados). */
function claveCruda(valores) {
  return JSON.stringify(
    valores.map((v) => (v instanceof FechaCelda ? `f:${v.serial}` : typeof v === "number" ? `n:${v}` : v)),
  );
}

// ======================================================================
// Detección
// ======================================================================

export function detectarRenglones(renglones, catalogo) {
  const grupos = porFolio(renglones);
  const fechas = fechasFolio(grupos);
  const folios = ordenarNumeros(fechas.keys());
  const hallazgos = [];
  for (const r of renglones) {
    const motivos = [];
    let prioridad = null;
    let eliminar = false;
    if (esPerdido(r)) {
      motivos.push("Renglón completamente perdido (#REF!). Si el PDF no muestra un renglón faltante, elimínalo.");
      prioridad = "Alta";
      eliminar = true;
    } else {
      const criticosPosibles = ["fecha", "folio", "cantidad", "codigo", "origen", "destino", "depto_origen", "depto_destino"];
      const criticos = [...r.errores].filter((e) => criticosPosibles.includes(e));
      if (criticos.length) {
        motivos.push(`Datos perdidos (#REF!): ${criticos.sort().join(", ")}`);
        prioridad = "Alta";
      }
      const otros = [...r.errores].filter(
        (e) => !criticosPosibles.includes(e) && !["pase_entrada", "pase_salida", "lote"].includes(e),
      );
      if (otros.length) {
        motivos.push(`Datos perdidos (#REF!): ${otros.sort().join(", ")}`);
        prioridad = prioridad || "Media";
      }
      const soloLote = r.errores.size === 1 && r.errores.has("lote");
      const menores = r.errores.size && [...r.errores].every((e) => ["lote", "pase_entrada", "pase_salida"].includes(e));
      if (soloLote || menores) {
        motivos.push("Solo se perdió el LOTE / C.U. Si el PDF no dice nada, déjalo vacío.");
        prioridad = prioridad || "Baja";
      }
      if (typeof r.crudo[0] === "string" && r.fecha) {
        motivos.push("Fecha escrita como texto (se convertirá)");
        prioridad = prioridad || "Baja";
      }
      if (r.fecha && fechas.has(r.folio) && folios.length) {
        const i = folios.indexOf(r.folio);
        const vecinas = folios.slice(Math.max(0, i - 1), i + 2).map((f) => fechas.get(f));
        if (r.fecha < sumarDias(minimo(vecinas), -20) || r.fecha > sumarDias(maximo(vecinas), 20)) {
          motivos.push(`Fecha ${fmtFecha(r.fecha)} fuera de rango respecto a los folios vecinos`);
          prioridad = prioridad || "Media";
        }
      }
      if (r.cantidad === null || r.cantidad.lte(0) || r.resto_cantidad) {
        motivos.push(`Cantidad inválida: ${n.repr(r.crudo[9])}`);
        prioridad = prioridad || "Media";
      }
      if (r.codigo === null && !r.errores.has("codigo")) {
        motivos.push("Sin código");
        prioridad = prioridad || "Media";
      }
      const oficial = r.codigo ? catalogo.get(r.codigo) : null;
      if (
        oficial &&
        r.descripcion &&
        !esErrorDeDedo(r.descripcion, oficial) &&
        n.claveLaxa(r.descripcion) !== n.claveLaxa(oficial)
      ) {
        let sugerido = null;
        for (const [c, d] of catalogo) {
          if (n.claveLaxa(d) === n.claveLaxa(r.descripcion) && c !== r.codigo) {
            sugerido = c;
            break;
          }
        }
        let texto = `La descripción '${r.descripcion}' no corresponde al código ${r.codigo} (${oficial})`;
        if (sugerido) texto += `. ¿Debía ser el código ${sugerido}?`;
        motivos.push(texto);
        prioridad = prioridad || "Media";
      }
    }
    if (motivos.length) hallazgos.push({ renglon: r, prioridad: prioridad || "Baja", situacion: motivos.join(" · "), eliminar });
  }
  const orden = { Alta: 0, Media: 1, Baja: 2 };
  return hallazgos.sort((a, b) => orden[a.prioridad] - orden[b.prioridad] || a.renglon.fila - b.renglon.fila);
}

/** Para cada fila con encabezado perdido: el valor que tienen los otros renglones del folio. */
export function sugerenciasEncabezado(renglones) {
  const sugerencias = new Map();
  for (const filas of porFolio(renglones).values()) {
    for (const r of filas) {
      for (const [, campo] of EDITABLES) {
        if (!(r.errores.has(campo) || r[campo] === null)) continue;
        const otro = filas.find((x) => x !== r && !x.errores.has(campo) && x[campo] !== null);
        if (otro && CAMPOS_SUGERIBLES.includes(campo)) {
          if (!sugerencias.has(r.fila)) sugerencias.set(r.fila, {});
          sugerencias.get(r.fila)[campo] = otro[campo];
        }
      }
    }
  }
  return sugerencias;
}

export function detectarDuplicados(renglones) {
  const grupos = porFolio(renglones);
  const resultado = [];
  for (const folio of ordenarNumeros(grupos.keys())) {
    const filas = grupos.get(folio);
    const vistos = new Map();
    const pares = [];
    for (const r of filas) {
      const clave = claveCruda(r.crudo.slice(0, 18));
      if (vistos.has(clave)) pares.push([vistos.get(clave), r]);
      else vistos.set(clave, r);
    }
    if (pares.length) {
      const completo = filas.length === 2 * pares.length;
      const tipo = completo ? "Vale completo guardado 2 veces" : "Renglón repetido dentro del vale";
      for (const [a, b] of pares) resultado.push([a, b, tipo]);
    }
  }
  return resultado;
}

/** [prioridad, folio, situación, qué revisar] — solo informativo. */
export function detectarFolios(renglones) {
  const grupos = porFolio(renglones);
  const salida = [];
  const todos = ordenarNumeros(grupos.keys());
  if (todos.length) {
    for (let f = todos[0]; f <= todos[todos.length - 1]; f++) {
      if (!grupos.has(f)) {
        salida.push([
          "Alta",
          String(f),
          "Folio que no aparece en DIARIO",
          "¿Existe el PDF? Si existe, sus renglones se capturarán en la herramienta.",
        ]);
      }
    }
  }
  for (const folio of todos) {
    const filas = grupos.get(folio);
    if (filas.length >= 16) {
      salida.push([
        "Alta",
        String(folio),
        `${filas.length} renglones: pudo perder renglones al guardar (límite de 16–18) o se guardó dos veces`,
        "Contar los renglones del PDF.",
      ]);
    }
    const deptos = new Set(filas.filter((r) => r.depto_destino).map((r) => n.compactar(r.depto_destino)));
    if (deptos.size > 1) {
      salida.push([
        "Media",
        String(folio),
        `El folio tiene más de un departamento destino: ${[...deptos].sort().join(" / ")}`,
        "¿Son dos vales distintos con el mismo número?",
      ]);
    }
  }
  return salida;
}

function agruparVariantes(conteo, umbral = 0.88) {
  const nombres = [...conteo.keys()].sort((a, b) => conteo.get(b) - conteo.get(a));
  const usados = new Set();
  const grupos = [];
  for (const a of nombres) {
    if (usados.has(a)) continue;
    const grupo = [a];
    usados.add(a);
    for (const b of nombres) {
      if (usados.has(b)) continue;
      const la = n.claveLaxa(a);
      const lb = n.claveLaxa(b);
      const parecidos = la === lb || ratio(la, lb) >= umbral;
      const prefijo = lb.length > 8 && (la.startsWith(lb) || lb.startsWith(la));
      if (parecidos || prefijo) {
        grupo.push(b);
        usados.add(b);
      }
    }
    if (grupo.length > 1) grupos.push(grupo.map((x) => [x, conteo.get(x)]));
  }
  return grupos;
}

/** [grupo, variante, veces, nombre propuesto] */
export function detectarNombres(renglones) {
  const conteo = contar(renglones.flatMap((r) => [r.entrego, r.recibio, r.autorizo]).filter(Boolean));
  const salida = [];
  agruparVariantes(conteo, 0.86).forEach((grupo, i) => {
    const propuesto = [...grupo].sort(
      (x, y) => y[0].split(/\s+/).filter(Boolean).length - x[0].split(/\s+/).filter(Boolean).length || y[1] - x[1],
    )[0][0];
    for (const [nombre, veces] of grupo) salida.push([i + 1, nombre, veces, propuesto]);
  });
  return salida;
}

/** [campo, valor encontrado, renglones, valor propuesto] */
export function detectarValores(renglones) {
  const salida = [];
  for (const [etiqueta, campo] of Object.entries(CAMPOS_VALORES)) {
    const conteo = contar(
      renglones
        .filter((r) => !esPerdido(r) && !r.errores.has(campo))
        .map((r) => (campo === "um" ? n.unidad(r[campo]) : r[campo]) || VACIO),
    );
    const propuestas = new Map();
    for (const valor of conteo.keys()) {
      const sinonimos = SINONIMOS[campo] || {};
      if (Object.hasOwn(sinonimos, valor)) propuestas.set(valor, sinonimos[valor]);
    }
    const sinVacio = new Map([...conteo].filter(([k]) => k !== VACIO));
    for (const grupo of agruparVariantes(sinVacio)) {
      const canonico = grupo[0][0];
      for (const [valor] of grupo.slice(1)) if (!propuestas.has(valor)) propuestas.set(valor, canonico);
    }
    if (campo === "destino" && conteo.get(VACIO)) {
      const cercano = masComun(contar(renglones.filter((r) => r.destino).map((r) => r.destino)));
      propuestas.set(VACIO, cercano ?? "");
    }
    for (const [valor, propuesto] of propuestas) {
      if (valor !== propuesto) salida.push([etiqueta, valor, conteo.get(valor), propuesto]);
    }
  }
  return salida;
}

/** [código, descripción en DIARIO, renglones, folios] de códigos fuera del catálogo. */
export function detectarCodigos(renglones, catalogo) {
  const grupos = new Map();
  for (const r of renglones) {
    if (r.codigo !== null && !catalogo.has(r.codigo)) {
      if (!grupos.has(r.codigo)) grupos.set(r.codigo, []);
      grupos.get(r.codigo).push(r);
    }
  }
  return ordenarNumeros(grupos.keys()).map((codigo) => {
    const filas = grupos.get(codigo);
    const descripcion = masComun(contar(filas.map((r) => r.descripcion).filter(Boolean)));
    const folios = ordenarNumeros(new Set(filas.map((r) => r.folio).filter((f) => f !== null)));
    return [codigo, descripcion ?? "", filas.length, folios.join(", ")];
  });
}

/** [hoja, fila, código, descripción, dimensión, NP, cantidad, situación] */
export function detectarInventario(inventario, catalogo) {
  const salida = [];
  const porNp = new Map();
  const fila = (hoja, r, situacion) => [
    hoja.nombre.trim(), r.fila, r.codigo, r.descripcion, r.dimension, r.np, r.cantidad, situacion,
  ];
  for (const hoja of inventario.hojas) {
    const claves = new Map();
    for (const r of hoja.renglones) {
      const clave = `${r.codigo}\u0000${n.claveEstricta(r.dimension)}\u0000${n.claveEstricta(r.np)}`;
      if (!claves.has(clave)) claves.set(clave, []);
      claves.get(clave).push(r);
      for (const texto of [r.dimension, r.np]) {
        const laxa = n.claveLaxa(texto);
        if (laxa.length >= 6) {
          if (!porNp.has(laxa)) porNp.set(laxa, new Set());
          porNp.get(laxa).add(r.codigo);
        }
      }
      if (!catalogo.has(r.codigo)) salida.push(fila(hoja, r, "Código que no está en el catálogo ARTICULOS_MX"));
    }
    for (const filas of claves.values()) {
      if (filas.length > 1) {
        const lista = filas.map((x) => x.fila).join(", ");
        for (const r of filas) {
          salida.push(
            fila(hoja, r, `Renglón repetido en la misma hoja (filas ${lista}): ¿lotes distintos o doble captura?`),
          );
        }
      }
    }
  }
  for (const hoja of inventario.hojas) {
    for (const r of hoja.renglones) {
      for (const texto of [r.dimension, r.np]) {
        const codigos = porNp.get(n.claveLaxa(texto)) || new Set();
        if (codigos.size > 1) {
          const lista = `[${ordenarNumeros(codigos).join(", ")}]`;
          salida.push(fila(hoja, r, `'${texto}' aparece con los códigos ${lista}: ¿posible doble conteo?`));
          break;
        }
      }
    }
  }
  return salida;
}

// ======================================================================
// Generación del Excel
// ======================================================================

const estiloEncabezado = {
  fuente: { nombre: FUENTE, negrita: true, color: "FFFFFF", tam: 10 },
  relleno: COLORES.encabezado,
  borde: BORDE,
  envolver: true,
  vertical: "center",
};

function estiloCelda(relleno = null, formato = null) {
  const estilo = { fuente: { nombre: FUENTE, tam: 10 }, borde: BORDE, envolver: true, vertical: "top" };
  if (relleno) estilo.relleno = relleno;
  if (formato) estilo.formato = formato;
  return estilo;
}

function crearHoja(libro, titulo, encabezados, filas, anchos, editables, { siNo = null, prioridad = null } = {}) {
  const ws = libro.agregarHoja(titulo);
  ws.agregarFila(encabezados, estiloEncabezado);
  for (const fila of filas) ws.agregarFila(fila.map((v) => v ?? null));
  const ultima = Math.max(ws.maxFila, 2);
  for (let f = 2; f <= ws.maxFila; f++) {
    for (let c = 1; c <= encabezados.length; c++) {
      const valor = ws.valor(f, c);
      let relleno = editables.has(c) ? COLORES.editable : null;
      if (prioridad && c === prioridad && PRIORIDAD[valor]) relleno = PRIORIDAD[valor];
      ws.poner(f, c, valor, estiloCelda(relleno));
    }
  }
  anchos.forEach((ancho, i) => ws.anchos.set(i + 1, ancho));
  ws.alturas.set(1, 32);
  ws.congelar = "A2";
  ws.filtro = `A1:${letraColumna(encabezados.length)}${ultima}`;
  if (siNo) {
    const letra = letraColumna(siNo);
    ws.validaciones.push({ ref: `${letra}2:${letra}${ultima}`, opciones: [SI, NO] });
  }
  return ws;
}

function valorRevision(valor) {
  // Fechas ISO → fecha de Excel; decimales → número.
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return new FechaCelda(serialExcel(valor));
  return valor ?? null;
}

/**
 * @returns {Uint8Array} el .xlsx de la lista de revisión
 */
export function generarRevision(vales, inventario, catalogo, { hoy = hoyIso() } = {}) {
  const renglones = vales.renglones;
  const libro = new LibroNuevo();
  const instrucciones = libro.agregarHoja("Instrucciones");

  // 1 Renglones a corregir
  const hallazgos = detectarRenglones(renglones, catalogo);
  const sugerencias = sugerenciasEncabezado(renglones);
  const filas = [];
  const perdidas = [];
  hallazgos.forEach((h, indice) => {
    const numero = indice + 2;
    const r = h.renglon;
    const fila = [h.prioridad, r.fila, r.folio, h.situacion];
    EDITABLES.forEach(([, campo], i) => {
      const columna = FIJAS_HOJA1.length + 1 + i;
      let valor = r[campo];
      if (r.errores.has(campo) || valor === null) {
        valor = sugerencias.get(r.fila)?.[campo] ?? null;
        if (r.errores.has(campo)) perdidas.push([numero, columna]);
      }
      if (campo === "cantidad" && r.resto_cantidad) valor = r.crudo[9];
      fila.push(campo === "fecha" ? valorRevision(valor) : valor);
    });
    fila.push(h.eliminar ? SI : null, null);
    filas.push(fila);
  });
  const encabezados = [...FIJAS_HOJA1, ...EDITABLES.map(([e]) => e), "¿Eliminar renglón? (Sí/No)", "Comentario"];
  const editables = new Set();
  for (let c = FIJAS_HOJA1.length + 1; c <= encabezados.length; c++) editables.add(c);
  const ws = crearHoja(
    libro,
    HOJA_RENGLONES,
    encabezados,
    filas,
    [8, 9, 7, 46, ...EDITABLES.map(() => 12), 12, 24],
    editables,
    { siNo: encabezados.length - 1, prioridad: 1 },
  );
  for (const [f, c] of perdidas) ws.poner(f, c, ws.valor(f, c), estiloCelda(COLORES.perdido));
  ws.congelar = "E2";
  const columnaFecha = FIJAS_HOJA1.length + 1;
  for (let f = 2; f <= ws.maxFila; f++) {
    const relleno = perdidas.some(([pf, pc]) => pf === f && pc === columnaFecha) ? COLORES.perdido : COLORES.editable;
    ws.poner(f, columnaFecha, ws.valor(f, columnaFecha), estiloCelda(relleno, "dd/mm/yyyy"));
  }

  // 2 Duplicados
  const duplicados = detectarDuplicados(renglones).map(([a, b, tipo]) => [
    a.folio, valorRevision(a.fecha), a.fila, b.fila, a.cantidad, a.codigo, a.descripcion, a.clave, tipo,
    tipo.startsWith("Vale completo") ? SI : null, null,
  ]);
  crearHoja(
    libro,
    HOJA_DUPLICADOS,
    ["Folio", "Fecha", "Fila original", "Fila repetida", "Cantidad", "Código", "Descripción", "Clave", "Tipo",
      "¿Eliminar la fila repetida? (Sí/No)", "Comentario"],
    duplicados,
    [8, 11, 9, 9, 9, 8, 28, 20, 26, 16, 24],
    new Set([10, 11]),
    { siNo: 10 },
  );
  const hojaDuplicados = libro.hoja(HOJA_DUPLICADOS);
  for (let f = 2; f <= hojaDuplicados.maxFila; f++) {
    hojaDuplicados.poner(f, 2, hojaDuplicados.valor(f, 2), estiloCelda(null, "dd/mm/yyyy"));
  }

  // 3 Folios
  crearHoja(
    libro,
    HOJA_FOLIOS,
    ["Prioridad", "Folio", "Situación", "Qué revisar", "Resultado (informativo)"],
    detectarFolios(renglones).map((x) => [...x, null]),
    [9, 10, 56, 48, 34],
    new Set([5]),
    { prioridad: 1 },
  );

  // 4 Códigos
  crearHoja(
    libro,
    HOJA_CODIGOS,
    ["Código en DIARIO", "Descripción en DIARIO", "Renglones", "Folios", "Código correcto (si es otro)",
      "Descripción correcta", "Comentario"],
    detectarCodigos(renglones, catalogo).map((x) => [...x, null, null, null]),
    [10, 30, 9, 32, 14, 30, 24],
    new Set([5, 6, 7]),
  );

  // 5 Nombres
  crearHoja(
    libro,
    HOJA_NOMBRES,
    ["Grupo", "Variante encontrada", "Veces", "Nombre correcto (edítalo si no es)", "¿Es otra persona? (Sí/No)"],
    detectarNombres(renglones).map((x) => [...x, null]),
    [8, 38, 8, 40, 14],
    new Set([4, 5]),
    { siNo: 5 },
  );

  // 6 Valores
  crearHoja(
    libro,
    HOJA_VALORES,
    ["Campo", "Valor encontrado", "Renglones", "Valor correcto (edítalo; vacío = dejar igual)", "Comentario"],
    detectarValores(renglones).map((x) => [...x, null]),
    [16, 30, 10, 40, 30],
    new Set([4, 5]),
  );

  // 7 Inventario
  crearHoja(
    libro,
    HOJA_INVENTARIO,
    ["Hoja", "Fila", "Código", "Descripción", "Dimensión", "NP", "Cantidad", "Situación", "Resultado (informativo)"],
    detectarInventario(inventario, catalogo).map((x) => [...x, null]),
    [28, 6, 8, 30, 22, 20, 9, 46, 30],
    new Set([9]),
  );

  escribirInstrucciones(instrucciones, vales.nombre, inventario.nombre, hoy);
  return libro.generar();
}

function escribirInstrucciones(ws, archivoVales, archivoInventario, hoy) {
  ws.poner(1, 1, "Revisión del historial antes de la primera carga", { fuente: { nombre: FUENTE, negrita: true, tam: 14 } });
  ws.poner(2, 1, `Generado el ${fmtFecha(hoy)} a partir de: ${archivoVales} y ${archivoInventario}`, {
    fuente: { nombre: FUENTE, cursiva: true, tam: 9, color: "595959" },
  });
  ws.poner(1, 8, MARCA_FORMATO, { fuente: { nombre: FUENTE, tam: 8, color: "FFFFFF" } });
  const lineas = [
    ["Cómo usar este archivo", true],
    ["1. Llena solo las celdas amarillas. Las naranjas son datos que se perdieron (#REF!): complétalos con el PDF escaneado.", false],
    ["2. Hoja 1: cada renglón ya trae los valores actuales o una sugerencia tomada de otros renglones del mismo folio. Corrige lo que no coincida con el PDF.", false],
    ["3. Hojas 2 y 5: responde Sí/No. Hojas 4 y 6: escribe el valor correcto solo si cambia.", false],
    ["4. Las hojas 3 y 7 son informativas: sirven para revisar físicamente o contra el PDF.", false],
    ["5. Guarda el archivo y cárgalo en la herramienta en el paso 'Primera carga'. Tus archivos originales no se modifican.", false],
    ["6. Puedes volver a generar esta lista cuantas veces quieras; la herramienta valida que cada fila siga correspondiendo al mismo folio.", false],
  ];
  lineas.forEach(([texto, negrita], i) => {
    ws.poner(4 + i, 1, texto, { fuente: { nombre: FUENTE, negrita, tam: negrita ? 11 : 10 } });
  });
  ws.anchos.set(1, 120);
}

// ======================================================================
// Lectura de respuestas
// ======================================================================

function esSi(valor) {
  return ["SI", "S"].includes((n.mayusculas(valor) || "").replace("Í", "I"));
}

function filas(ws, desde = 2) {
  const salida = [];
  for (let f = desde; f <= ws.maxFila; f++) salida.push(ws.fila(f, 1, 25));
  return salida;
}

export function leerRevision(datos, renglones) {
  const libro = datos instanceof LibroLeido ? datos : new LibroLeido(datos);
  if (!libro.nombresHojas.includes("Instrucciones") || libro.hoja("Instrucciones").valorRef("H1") !== MARCA_FORMATO) {
    throw new ErrorRevision("El archivo no es una lista de revisión generada por la herramienta (formato v2).");
  }
  const porFila = new Map(renglones.map((r) => [r.fila, r]));
  const respuestas = respuestasVacias();

  // 1 Renglones
  for (const valores of filas(libro.hoja(HOJA_RENGLONES))) {
    if (valores[1] === null) continue;
    const fila = Math.trunc(Number(valores[1]));
    const folio = valores[2];
    const actual = porFila.get(fila);
    if (!actual || (folio !== null && actual.folio !== null && Math.trunc(Number(folio)) !== actual.folio)) {
      respuestas.advertencias.push(`Hoja 1: la fila ${fila} ya no corresponde al folio ${folio}; se ignoró.`);
      continue;
    }
    if (esSi(valores[FIJAS_HOJA1.length + EDITABLES.length])) {
      respuestas.eliminar.add(fila);
      continue;
    }
    const cambios = {};
    EDITABLES.forEach(([, campo], i) => {
      let nuevo = valores[FIJAS_HOJA1.length + i];
      if (campo === "fecha") nuevo = nuevo === null ? null : n.fecha(nuevo);
      const anterior = actual[campo];
      if (campo === "cantidad") {
        if (!mismoValor(n.decimal(nuevo), anterior) || actual.resto_cantidad) cambios[campo] = nuevo;
      } else if (actual.errores.has(campo) || n.valorATexto(nuevo) !== n.valorATexto(anterior)) {
        cambios[campo] = nuevo;
      }
    });
    if (Object.keys(cambios).length) respuestas.correcciones.set(fila, cambios);
  }

  // 2 Duplicados
  for (const valores of filas(libro.hoja(HOJA_DUPLICADOS))) {
    if (valores[3] !== null && esSi(valores[9])) respuestas.eliminar.add(Math.trunc(Number(valores[3])));
  }

  // 4 Códigos
  for (const valores of filas(libro.hoja(HOJA_CODIGOS))) {
    if (valores[0] === null) continue;
    const correcto = n.codigoAx(valores[4]);
    const descripcion = n.valorATexto(valores[5]);
    if (correcto || descripcion) respuestas.codigos.set(Math.trunc(Number(valores[0])), [correcto, descripcion]);
  }

  // 5 Nombres
  for (const valores of filas(libro.hoja(HOJA_NOMBRES))) {
    if (!valores[1]) continue;
    const variante = n.nombrePersona(valores[1]);
    const correcto = n.nombrePersona(valores[3]);
    if (correcto && variante !== correcto && !esSi(valores[4])) respuestas.alias.set(variante, correcto);
  }

  // 6 Valores
  for (const valores of filas(libro.hoja(HOJA_VALORES))) {
    if (!valores[0] || valores[1] === null) continue;
    const campo = CAMPOS_VALORES[valores[0]];
    const nuevo = n.valorATexto(valores[3]);
    if (campo && nuevo) {
      respuestas.normalizaciones.set(claveNormalizacion(campo, String(valores[1])), nuevo === VACIO ? null : nuevo);
    }
  }
  return respuestas;
}
