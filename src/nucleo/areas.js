// Áreas (plantillas del vale): tipo de área, datos fijos de los vales internos y la
// línea "ETAPA DE PERFORACION" de las observaciones. Reglas puras, sin estado.

export const TIPOS_AREA = {
  INTERNO: "Interna (departamento del equipo)",
  EXTERNO: "Externa (otra compañía, p. ej. NOV)",
  TRANSFERENCIA: "Transferencia (a otro equipo)",
};

// Un vale interno siempre sale del almacén del equipo y llega al mismo equipo.
export const ORIGEN_EQUIPO = "RIG 91";
export const DEPTO_ALMACEN = "ALMACEN";

const limpio = (v) =>
  String(v ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]/g, "");

/** Tipo de un área; si no lo tiene guardado, se deduce de sus datos. */
export function tipoDeArea(area) {
  if (!area) return "INTERNO";
  if (TIPOS_AREA[area.tipo]) return area.tipo;
  if (area.naturaleza === "TRANSFERENCIA" || limpio(area.nombre).includes("TRANSFER")) return "TRANSFERENCIA";
  const origen = limpio(area.origen);
  const destino = limpio(area.destino);
  return origen && destino && origen !== destino ? "EXTERNO" : "INTERNO";
}

export const esInterna = (area) => Boolean(area) && tipoDeArea(area) === "INTERNO";

/**
 * ¿Los datos del vale salen fijos del área? Internas y externas (NOV) sí: origen, destino y
 * observaciones son los del formato y solo cambia la etapa. Las transferencias se editan.
 */
export const tieneDatosFijos = (area) => Boolean(area) && tipoDeArea(area) !== "TRANSFERENCIA";

// Puestos que suelen autorizar (se sugieren primero en "Autorizó").
export const PUESTOS_AUTORIZAN = ["RIG MANAGER", "ITP"];

/** Nombre para mostrar de las firmas de la segunda fila (NOV: personal de la compañía y patrimonial). */
export function etiquetasFirmasExtra(area) {
  const extra = area?.firmas_extra;
  if (!extra) return null;
  const nombreDe = (lado, defecto) => {
    const titulo = String(extra[lado]?.titulo ?? "").trim();
    if (titulo && !/RECIBE|ENTREGA|AUTORIZA/i.test(titulo)) return titulo.charAt(0) + titulo.slice(1).toLowerCase();
    return defecto;
  };
  const compania = String(area.depto_destino ?? "").trim() || "la compañía";
  return { izq: nombreDe("izq", `Personal de ${compania}`), der: nombreDe("der", "Segunda firma") };
}

/**
 * Deja el área con su tipo y, si es interna, con los datos fijos: sale de RIG 91 · ALMACEN
 * y llega a RIG 91 · <departamento del área>.
 */
export function normalizarArea(area) {
  area.tipo = tipoDeArea(area);
  if (area.tipo === "TRANSFERENCIA") {
    area.naturaleza = "TRANSFERENCIA";
    area.requiere_autoriza = true;
  }
  if (area.tipo === "INTERNO") {
    area.origen = area.origen || ORIGEN_EQUIPO;
    area.depto_origen = DEPTO_ALMACEN;
    area.destino = area.origen;
    area.naturaleza = "CONSUMO";
  }
  if (area.tipo === "EXTERNO") {
    // Externas (NOV): salen del almacén del equipo hacia la compañía.
    area.origen = area.origen || ORIGEN_EQUIPO;
    area.depto_origen = DEPTO_ALMACEN;
    area.naturaleza = "CONSUMO";
  }
  return area;
}

// ---------------------------------------------------------------- etapa de perforación

const RE_ETAPA = /^\s*ETAPA\s+DE\s+PERFORACI[OÓ]N\b.*$/im;

/** El valor de la línea "ETAPA DE PERFORACION: …" de unas observaciones (o null). */
export function etapaDe(observaciones) {
  const linea = RE_ETAPA.exec(String(observaciones ?? ""));
  if (!linea) return null;
  const i = linea[0].indexOf(":");
  return i < 0 ? "" : linea[0].slice(i + 1).trim();
}

export const tieneEtapa = (observaciones) => RE_ETAPA.test(String(observaciones ?? ""));

/** Las mismas observaciones con otra etapa; si no traen la línea, se agrega al final. */
export function conEtapa(observaciones, etapa) {
  const texto = String(observaciones ?? "");
  const valor = String(etapa ?? "").trim();
  if (!RE_ETAPA.test(texto)) return [texto.trimEnd(), `ETAPA DE PERFORACION: ${valor}`].filter(Boolean).join("\n");
  return texto.replace(RE_ETAPA, (linea) => {
    const i = linea.indexOf(":");
    return i < 0 ? `${linea.trimEnd()}: ${valor}` : `${linea.slice(0, i + 1)} ${valor}`;
  });
}
