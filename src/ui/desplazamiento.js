// Ronda 39 (docs/14 §1): la página nunca se desplaza; lo que se desplaza es el área de trabajo (main.contenido). Aquí
// se pide y se mueve su desplazamiento (sin el marco, como en las pantallas del arranque, el de la página).

/** El elemento que se desplaza: el área de trabajo o, sin ella, la página. */
export function areaDeTrabajo() {
  if (typeof document === "undefined") return null;
  return document.querySelector(".cuerpo > main.contenido") ?? document.scrollingElement ?? document.documentElement;
}

/** Lleva el área de trabajo al principio (al cambiar de sección o de paso). */
export function irArriba({ suave = false } = {}) {
  const area = areaDeTrabajo();
  if (!area) return;
  if (typeof area.scrollTo === "function") area.scrollTo({ top: 0, left: 0, behavior: suave ? "smooth" : "auto" });
  else {
    area.scrollTop = 0;
    area.scrollLeft = 0;
  }
}

/** Cuánto está desplazada el área de trabajo. */
export function desplazamiento() {
  const area = areaDeTrabajo();
  return { x: area?.scrollLeft ?? 0, y: area?.scrollTop ?? 0 };
}

/** Desplaza el área de trabajo a una posición. */
export function desplazarA(x, y) {
  const area = areaDeTrabajo();
  if (!area) return;
  if (typeof area.scrollTo === "function") area.scrollTo(x, y);
  else {
    area.scrollLeft = x;
    area.scrollTop = y;
  }
}
