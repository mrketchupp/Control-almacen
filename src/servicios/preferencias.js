// Personalización de cada almacenista (Ajustes → Personalización): tema, dónde salen los avisos y animaciones.
// Se guarda en el estado por nombre de almacenista (viaja en los respaldos); sin nadie en turno se usa la del
// equipo (clave "*"). "Mi pantalla de vales" (el orden de los bloques del vale) se quitó en la Ronda 34: el vale
// de salida ahora va en 3 pasos (docs/13-rediseno-vale-salida.md §11).

export const TEMAS = { sistema: "Como Windows", claro: "Claro", oscuro: "Oscuro" };
export const POSICIONES_AVISOS = { arriba: "Arriba", abajo: "Abajo" };
export const PERSONALIZACION_DEFECTO = { tema: "sistema", avisos: "arriba", animaciones: true };
const EQUIPO = "*";

/** Personalización de un almacenista (o la del equipo, o la de fábrica). */
export function personalizacion(estado, usuario) {
  const todas = estado?.config?.personalizacion ?? {};
  const guardada = (usuario && todas[usuario]) || todas[EQUIPO] || {};
  return {
    tema: TEMAS[guardada.tema] ? guardada.tema : PERSONALIZACION_DEFECTO.tema,
    avisos: POSICIONES_AVISOS[guardada.avisos] ? guardada.avisos : PERSONALIZACION_DEFECTO.avisos,
    animaciones: typeof guardada.animaciones === "boolean" ? guardada.animaciones : PERSONALIZACION_DEFECTO.animaciones,
    propia: Boolean(usuario && todas[usuario]),
  };
}

export function guardarPersonalizacion(estado, usuario, cambios) {
  const actual = personalizacion(estado, usuario);
  const nueva = { tema: actual.tema, avisos: actual.avisos, animaciones: actual.animaciones, ...cambios };
  estado.config.personalizacion ??= {};
  estado.config.personalizacion[usuario || EQUIPO] = {
    tema: TEMAS[nueva.tema] ? nueva.tema : PERSONALIZACION_DEFECTO.tema,
    avisos: POSICIONES_AVISOS[nueva.avisos] ? nueva.avisos : PERSONALIZACION_DEFECTO.avisos,
    animaciones: Boolean(nueva.animaciones),
  };
  return personalizacion(estado, usuario);
}
