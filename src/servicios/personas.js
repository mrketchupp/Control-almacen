// Unificar personas repetidas (Áreas y personas): el mismo almacenista o trabajador escrito de
// varias formas ("FULANO MENGANO", "MENGANO FULANO", "F. MÉNGANO ZUTANO", "FULANO MENGANA"). Se deja un solo
// nombre en la lista y los demás quedan como alias de esa persona (`estado.alias`), así las
// sugerencias y los conteos de firmas los juntan.
//
// Unificar conserva el historial. Al guardar un puesto desde Personas, el usuario puede confirmar
// que ese puesto se corrija también en las firmas de los vales existentes, conservando sus nombres.

import { auditar, siguienteId } from "../nucleo/estado.js";
import { ratio } from "../nucleo/difflib.js";
import { ahoraIso } from "../nucleo/fechas.js";

export class ErrorPersonas extends Error {}

// Palabras que no distinguen a una persona (títulos y conectores de apellidos).
const IGNORAR = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "ING", "LIC", "SR", "SRA", "TEC", "C", "DR", "ARQ", "MTRO"]);

/** Nombre sin acentos ni signos, en mayúsculas y con un solo espacio. */
export function nombreBase(nombre) {
  return String(nombre ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9Ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const palabras = (nombre) => nombreBase(nombre).split(" ").filter((p) => p && !IGNORAR.has(p));

/** Dos palabras de un nombre coinciden: iguales, una es la inicial de la otra o casi iguales (MENGANA / MENGANO). */
function coincide(a, b) {
  if (a === b) return "igual";
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? "inicial" : null;
  if (Math.min(a.length, b.length) >= 5 && ratio(a, b) >= 0.8) return "parecida";
  return null;
}

/**
 * ¿Parecen la misma persona? Cada palabra del nombre más corto debe coincidir con una distinta
 * del más largo (en cualquier orden), con al menos dos palabras y una completa.
 */
export function parecenLaMisma(nombreA, nombreB) {
  const a = palabras(nombreA);
  const b = palabras(nombreB);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length < 2) return false;
  const libres = [...largo];
  let completas = 0;
  for (const p of corto) {
    // Primero una igual, luego una parecida, al final una inicial.
    const orden = ["igual", "parecida", "inicial"];
    let mejor = -1;
    let tipo = null;
    for (const t of orden) {
      mejor = libres.findIndex((q) => coincide(p, q) === t);
      if (mejor >= 0) {
        tipo = t;
        break;
      }
    }
    if (mejor < 0) return false;
    if (tipo !== "inicial") completas += 1;
    libres.splice(mejor, 1);
  }
  return completas >= 1;
}

/** Cuántas veces aparece cada nombre en las firmas de los vales (para proponer cuál conservar). */
export function usosPorNombre(estado) {
  const usos = new Map();
  const sumar = (nombre) => nombre && usos.set(nombre, (usos.get(nombre) ?? 0) + 1);
  for (const v of estado.vales) {
    for (const [campo, valor] of Object.entries(v)) if (campo.endsWith("_nombre")) sumar(valor);
    for (const lado of ["izq", "der"]) sumar(v.firmas_extra?.[lado]?.nombre);
  }
  return usos;
}

const clavePar = (a, b) => [a, b].sort((x, y) => x - y).join("|");

/**
 * Grupos de personas que parecen la misma (para sugerir unificarlas), sin los pares marcados
 * como "son distintas". Cada grupo viene con sus usos, el más usado primero.
 * @returns [[{ persona, usos }]]
 */
export function personasRepetidas(estado) {
  const personas = estado.personas;
  const distintas = new Set(estado.config?.personas_distintas ?? []);
  const padre = personas.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const bases = personas.map((p) => palabras(p.nombre));
  for (let i = 0; i < personas.length; i++) {
    for (let j = i + 1; j < personas.length; j++) {
      // Atajo: deben compartir al menos la inicial de alguna palabra.
      if (!bases[i].some((p) => bases[j].some((q) => p[0] === q[0]))) continue;
      if (distintas.has(clavePar(personas[i].id, personas[j].id))) continue;
      if (parecenLaMisma(personas[i].nombre, personas[j].nombre)) padre[raiz(i)] = raiz(j);
    }
  }
  const usos = usosPorNombre(estado);
  const grupos = new Map();
  personas.forEach((p, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push({ persona: p, usos: usos.get(p.nombre) ?? 0 });
  });
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => Number(b.persona.es_almacenista) - Number(a.persona.es_almacenista) || b.usos - a.usos || b.persona.nombre.length - a.persona.nombre.length))
    .sort((a, b) => a[0].persona.nombre.localeCompare(b[0].persona.nombre, "es"));
}

/** Nombres que quedaron como alias de una persona (los que se unificaron con ella). */
export function aliasDe(estado, personaId) {
  return Object.entries(estado.alias ?? {})
    .filter(([, id]) => id === personaId)
    .map(([nombre]) => nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
}

const puestoLimpio = (puesto) => String(puesto ?? "").trim().toUpperCase() || null;
const FIRMAS = ["entrego", "recibio", "autorizo", "firma_extra_izq", "firma_extra_der"];

/** Coincidencias exactas del nombre normalizado y los alias ya unificados; no usa parecidos. */
function nombresDePersona(estado, datos) {
  const previa = estado.personas.find((p) => p.id === datos.id);
  return new Set([datos.nombre, previa?.nombre, datos.nombre_anterior, ...aliasDe(estado, datos.id)]
    .map(nombreBase).filter(Boolean));
}

function puestosPorCorregir(vale, nombres, puesto) {
  const campos = [];
  const corregidos = new Set(vale.campos_encabezado_corregidos ?? []);
  for (const firma of FIRMAS) {
    const campo = `${firma}_puesto`;
    if (nombres.has(nombreBase(vale[`${firma}_nombre`])) && (
      !Object.hasOwn(vale, campo) || (vale[campo] ?? null) !== puesto || (puesto === null && !corregidos.has(campo))
    )) {
      campos.push({ campo, antes: vale[campo] ?? null });
    }
  }
  // También se conservan las firmas adicionales de los estados antiguos, si las hay.
  for (const lado of ["izq", "der"]) {
    const firma = vale.firmas_extra?.[lado];
    const campo = `firmas_extra.${lado}.puesto`;
    if (firma && nombres.has(nombreBase(firma.nombre)) && (
      !Object.hasOwn(firma, "puesto") || (firma.puesto ?? null) !== puesto || (puesto === null && !corregidos.has(campo))
    )) {
      campos.push({ campo, lado, antes: firma.puesto ?? null });
    }
  }
  return campos;
}

/** Vista previa sin cambios: cuántos vales y firmas cambiarían al confirmar el nuevo puesto. */
export function previaActualizacionPuesto(estado, datos) {
  const nombres = nombresDePersona(estado, datos);
  const puesto = puestoLimpio(datos.puesto);
  const vales = [];
  for (const vale of estado.vales) {
    if (vale.tipo !== "SALIDA" && vale.tipo !== "ENTRADA") continue;
    const campos = puestosPorCorregir(vale, nombres, puesto);
    if (campos.length) vales.push({ id: vale.id, tipo: vale.tipo, folio: vale.folio, campos });
  }
  return {
    puesto,
    vales,
    total: vales.length,
    firmas: vales.reduce((n, v) => n + v.campos.length, 0),
    salidas: vales.filter((v) => v.tipo === "SALIDA").length,
    entradas: vales.filter((v) => v.tipo === "ENTRADA").length,
  };
}

/**
 * Aplica solo el puesto, tras la confirmación del usuario. Incluye vales antiguos y cancelados:
 * conserva su estado, nombres, folios y todas las partidas. Se llama dentro de Almacen.modificar.
 */
export function actualizarPuestoEnVales(estado, personaId, usuario = null, { nombreAnterior = null } = {}) {
  const persona = estado.personas.find((p) => p.id === personaId);
  if (!persona) throw new ErrorPersonas("La persona ya no existe.");
  const previa = previaActualizacionPuesto(estado, { ...persona, nombre_anterior: nombreAnterior });
  const porId = new Map(estado.vales.map((v) => [v.id, v]));
  const motivo = `Actualización confirmada del puesto de ${persona.nombre} desde Personas: ${previa.puesto || "sin puesto"}.`;
  for (const corregido of previa.vales) {
    const vale = porId.get(corregido.id);
    const antes = structuredClone(vale);
    for (const { campo, lado } of corregido.campos) {
      if (lado) vale.firmas_extra[lado].puesto = previa.puesto;
      else vale[campo] = previa.puesto;
    }
    // Un puesto vacío confirmado también debe prevalecer sobre el texto de la plantilla.
    vale.campos_encabezado_corregidos = [...new Set([
      ...(vale.campos_encabezado_corregidos ?? []), ...corregido.campos.map(({ campo }) => campo),
    ])];
    vale.modificado_en = ahoraIso();
    if (vale.tipo === "SALIDA") vale.cambio = siguienteId(estado, "cambio");
    const cambios = corregido.campos.map(({ campo, antes: anterior }) => `${campo}: ${anterior || "—"} → ${previa.puesto || "—"}`);
    // En entradas, el motivo del movimiento es distinto al motivo de su corrección.
    const { motivo: motivoEntrada, ...resto } = antes;
    auditar(estado, {
      usuario,
      entidad: "vale",
      entidadId: vale.id,
      accion: "CORREGIR",
      antes: { ...resto, ...(vale.tipo === "ENTRADA" ? { motivo_entrada: motivoEntrada } : {}), motivo, cambios },
      despues: structuredClone(vale),
    });
  }
  return previa;
}

/**
 * Une varias personas en una: se conserva `conservarId` (su nombre queda) y las demás pasan a
 * ser alias suyos. No cambia ningún vale emitido.
 * @returns la persona que queda
 */
export function unificarPersonas(estado, conservarId, absorberIds, usuario = null) {
  const queda = estado.personas.find((p) => p.id === conservarId);
  if (!queda) throw new ErrorPersonas("La persona que se conserva ya no existe.");
  const otras = estado.personas.filter((p) => absorberIds.includes(p.id) && p.id !== conservarId);
  if (!otras.length) throw new ErrorPersonas("Elige al menos otra persona para unir.");
  const antes = structuredClone([queda, ...otras]);
  estado.alias ??= {};
  const config = estado.config;
  for (const p of otras) {
    queda.puesto ||= p.puesto;
    queda.es_almacenista = queda.es_almacenista || p.es_almacenista;
    if (p.activo !== false) queda.activo = true;
    // Sus alias y su propio nombre ahora apuntan a la que queda.
    for (const [variante, id] of Object.entries(estado.alias)) if (id === p.id) estado.alias[variante] = queda.id;
    estado.alias[p.nombre] = queda.id;
    // Datos por defecto de las áreas (no son historial).
    for (const area of estado.plantillas_area) {
      for (const campo of ["entrega_nombre", "recibe_nombre", "autoriza_nombre"]) if (area[campo] === p.nombre) area[campo] = queda.nombre;
      for (const lado of ["izq", "der"]) if (area.firmas_extra?.[lado]?.nombre === p.nombre) area.firmas_extra[lado].nombre = queda.nombre;
    }
    // Lo que se guarda por almacenista.
    if (config.usuario_en_turno === p.nombre) config.usuario_en_turno = queda.nombre;
    for (const clave of ["preferencias_vale", "personalizacion"]) {
      const porPersona = config[clave];
      if (!porPersona?.[p.nombre]) continue;
      porPersona[queda.nombre] ??= porPersona[p.nombre];
      delete porPersona[p.nombre];
    }
  }
  delete estado.alias[queda.nombre];
  const ids = new Set(otras.map((p) => p.id));
  estado.personas = estado.personas.filter((p) => !ids.has(p.id));
  auditar(estado, {
    usuario,
    entidad: "persona",
    entidadId: queda.id,
    accion: "UNIFICAR",
    antes,
    despues: { conservada: queda.nombre, unidas: otras.map((p) => p.nombre) },
  });
  return queda;
}

/** "No son la misma persona": ese grupo ya no se vuelve a sugerir. */
export function marcarDistintas(estado, ids) {
  const pares = new Set(estado.config.personas_distintas ?? []);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pares.add(clavePar(ids[i], ids[j]));
  estado.config.personas_distintas = [...pares];
}
