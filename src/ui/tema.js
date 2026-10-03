// Aplica la personalización (tema, avisos, animaciones) al documento. Se recuerda también en
// este navegador para que al abrir la herramienta no parpadee el tema antes de leer los datos.

const CLAVE = "control-almacen-personalizacion";

export function aplicarPersonalizacion({ tema, avisos, animaciones }) {
  const raiz = document.documentElement;
  raiz.dataset.tema = tema;
  raiz.dataset.avisos = avisos;
  raiz.dataset.animaciones = animaciones ? "si" : "no";
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ tema, avisos, animaciones }));
  } catch {
    // Sin almacenamiento del navegador: solo no se recuerda para el arranque.
  }
}

/** Al arrancar: la última personalización usada en este navegador (si la hay). */
export function personalizacionRecordada() {
  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    return guardada && typeof guardada === "object" ? guardada : null;
  } catch {
    return null;
  }
}

/** ¿Se anima? (no, si el almacenista las quitó o Windows pide reducir el movimiento). */
export function hayAnimaciones() {
  if (document.documentElement.dataset.animaciones === "no") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
