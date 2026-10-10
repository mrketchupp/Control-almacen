// El mismo texto permite pegar un elemento entre diseños y entre ventanas de la app.
// Si el navegador no da acceso al portapapeles, conserva la copia durante esta sesión.
import { normalizarElemento } from "../impresion/modelos.js";
const FORMATO = "control-almacen.elemento";
let copia = null;

export function textoElemento(elemento) {
  return JSON.stringify({ formato: FORMATO, version: 1, elemento });
}
export function elementoDelTexto(texto) {
  if (typeof texto !== "string" || texto.length > 32768) return null;
  try {
    const datos = JSON.parse(texto);
    return datos.formato === FORMATO && datos.version === 1 ? normalizarElemento(datos.elemento) : null;
  } catch { return null; }
}
export function recordarElemento(texto) { copia = elementoDelTexto(texto) ? texto : null; }
export function hayElementoCopiado() { return copia !== null; }

export async function copiarElemento(elemento) {
  const texto = textoElemento(elemento);
  recordarElemento(texto);
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // copy mediante una acción explícita también funciona al abrir el HTML como archivo.
    const escribir = (e) => { e.clipboardData?.setData("text/plain", texto); e.preventDefault(); };
    document.addEventListener("copy", escribir);
    try { document.execCommand("copy"); } catch { /* queda la copia de la sesión */ }
    finally { document.removeEventListener("copy", escribir); }
    recordarElemento(texto);
  }
}
export async function leerElementoCopiado() {
  try {
    const texto = await navigator.clipboard.readText();
    recordarElemento(texto);
    return elementoDelTexto(texto);
  } catch {
    return elementoDelTexto(copia);
  }
}
