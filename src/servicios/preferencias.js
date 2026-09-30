// Preferencias de pantalla de cada almacenista (Ajustes → Mi pantalla de vales): el orden de
// los bloques de datos del vale y de qué lado van los datos y las partidas. Se guardan en el
// estado por nombre de almacenista (viajan en los respaldos) y se aplican según quién está en turno.

export const BLOQUES_VALE = [
  { id: "area", etiqueta: "Área que recibe", detalle: "La plantilla del vale" },
  { id: "fecha", etiqueta: "Fecha" },
  { id: "origen_destino", etiqueta: "Origen y destino", detalle: "Solo en transferencias; en las demás se llenan solos" },
  { id: "recibio", etiqueta: "Recibió y su puesto" },
  { id: "firmas_extra", etiqueta: "Firmas de NOV", detalle: "Personal de la compañía y patrimonial" },
  { id: "autorizo", etiqueta: "Autorizó y su puesto", detalle: "Solo en transferencias" },
  { id: "etapa", etiqueta: "Etapa de perforación" },
  { id: "observaciones", etiqueta: "Observaciones", detalle: "Solo en transferencias; en las demás son fijas" },
  { id: "automaticos", etiqueta: "Se llenan solos", detalle: "Entrega, sale de, llega a y observaciones fijas" },
];

export const ORDEN_DEFECTO = BLOQUES_VALE.map((b) => b.id);

export const LADOS = {
  "datos-izquierda": "Datos a la izquierda, partidas a la derecha",
  "partidas-izquierda": "Partidas a la izquierda, datos a la derecha",
};
export const LADO_DEFECTO = "datos-izquierda";

export class ErrorPreferencias extends Error {}

/**
 * Orden válido: solo bloques conocidos, sin repetir. Los que falten (p. ej. bloques nuevos de
 * una versión posterior) se insertan donde van en el orden por defecto.
 */
export function normalizarOrden(orden) {
  const resultado = [];
  for (const id of Array.isArray(orden) ? orden : []) if (ORDEN_DEFECTO.includes(id) && !resultado.includes(id)) resultado.push(id);
  ORDEN_DEFECTO.forEach((id, k) => {
    if (resultado.includes(id)) return;
    const anterior = ORDEN_DEFECTO.slice(0, k).reverse().find((x) => resultado.includes(x));
    resultado.splice(anterior ? resultado.indexOf(anterior) + 1 : 0, 0, id);
  });
  return resultado;
}

/** Preferencias de un almacenista (o las de fábrica si no tiene). */
export function preferenciasVale(estado, usuario) {
  const guardadas = usuario ? estado?.config?.preferencias_vale?.[usuario] : null;
  return {
    orden: normalizarOrden(guardadas?.orden ?? ORDEN_DEFECTO),
    lado: LADOS[guardadas?.lado] ? guardadas.lado : LADO_DEFECTO,
    propias: Boolean(guardadas),
  };
}

export function guardarPreferenciasVale(estado, usuario, { orden, lado }) {
  if (!usuario) throw new ErrorPreferencias("Elige quién está en turno para guardar sus preferencias.");
  estado.config.preferencias_vale ??= {};
  estado.config.preferencias_vale[usuario] = { orden: normalizarOrden(orden), lado: LADOS[lado] ? lado : LADO_DEFECTO };
}

export function restablecerPreferenciasVale(estado, usuario) {
  if (estado.config.preferencias_vale) delete estado.config.preferencias_vale[usuario];
}

/** El orden con un bloque movido a otra posición (índice en el orden resultante). */
export function moverBloque(orden, id, destino) {
  const resto = orden.filter((x) => x !== id);
  const i = Math.max(0, Math.min(destino, resto.length));
  return [...resto.slice(0, i), id, ...resto.slice(i)];
}
