// Punto de entrada: una sola pestaña a la vez, datos en IndexedDB de este equipo.
// Dos inventarios (DLTA y GSM), cada uno con su propia base: se cambia de uno a otro en la
// misma pestaña y se recuerda el último que se usó.

import { render } from "preact";
import { Almacen } from "./almacen/almacen.js";
import { BackendIndexedDB } from "./almacen/bd.js";
import { INVENTARIO_DEFECTO, inventarioPorId } from "./nucleo/inventarios.js";
import { App } from "./ui/app.js";
import { html } from "./ui/html.js";
import { Sesion } from "./ui/sesion.js";
import { aplicarPersonalizacion, personalizacionRecordada } from "./ui/tema.js";

const VERSION = typeof __VERSION__ === "undefined" ? "desarrollo" : __VERSION__;
const raiz = document.getElementById("app");
const CLAVE_INVENTARIO = "control-almacen:inventario";

function pantalla(titulo, texto) {
  raiz.innerHTML = "";
  render(
    html`<div class="pantalla-mensaje"><div class="tarjeta"><h1>${titulo}</h1><p>${texto}</p></div></div>`,
    raiz,
  );
}

function requisitos() {
  const faltan = [];
  if (!("indexedDB" in window)) faltan.push("almacenamiento local (IndexedDB)");
  if (!window.crypto?.subtle) faltan.push("cifrado (crypto.subtle)");
  if (typeof structuredClone !== "function") faltan.push("structuredClone");
  return faltan;
}

/** El último inventario abierto en este navegador (solo para el arranque; si no se puede leer, DLTA). */
function inventarioRecordado() {
  try {
    return inventarioPorId(localStorage.getItem(CLAVE_INVENTARIO) ?? INVENTARIO_DEFECTO).id;
  } catch {
    return INVENTARIO_DEFECTO;
  }
}

function recordarInventario(id) {
  try {
    localStorage.setItem(CLAVE_INVENTARIO, id);
  } catch {
    // sin almacenamiento local: la próxima vez abre DLTA
  }
}

/** Marca la página con el inventario abierto (título de la pestaña y color de la cabecera). */
function marcarInventario(id) {
  document.title = `Control de Almacén · ${id}`;
  document.documentElement.dataset.inventario = id;
}

let abierta = null; // la sesión del inventario abierto

/** Abre un inventario con su propia base y dibuja la herramienta para él. */
async function abrirInventario(id) {
  const inventario = inventarioPorId(id);
  const backend = new BackendIndexedDB(inventario.bd);
  const almacen = new Almacen(backend, { version: VERSION, inventario: inventario.id });
  const sesion = new Sesion(almacen, backend, { cambiarInventario });
  try {
    await sesion.iniciar();
  } catch (error) {
    backend.cerrar();
    throw error;
  }
  const anterior = abierta;
  abierta = sesion;
  recordarInventario(inventario.id);
  marcarInventario(inventario.id);
  if (!anterior) raiz.innerHTML = ""; // quita el "Cargando…" del HTML
  render(html`<${App} key=${inventario.id} sesion=${sesion} />`, raiz);
  anterior?.backend.cerrar();
  return sesion;
}

/** Cambia de inventario sin recargar: el otro se abre desde el inicio. */
async function cambiarInventario(id) {
  if (inventarioPorId(id).id === abierta?.almacen.inventario) return abierta;
  if (location.hash && location.hash !== "#inicio") history.replaceState(null, "", "#inicio");
  return abrirInventario(id);
}

async function arrancar() {
  const faltan = requisitos();
  if (faltan.length) {
    pantalla("Navegador no compatible", `Abre la herramienta en Microsoft Edge o Google Chrome actualizados. Falta: ${faltan.join(", ")}.`);
    return;
  }
  try {
    await abrirInventario(inventarioRecordado());
  } catch (error) {
    console.error(error);
    pantalla(
      "No se pudo abrir el almacenamiento local",
      `El navegador no permitió guardar datos (${error.message}). Si estás en una ventana InPrivate, abre una ventana normal.`,
    );
    return;
  }
  window.addEventListener("beforeunload", (e) => {
    if (abierta?.ocupado) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

marcarInventario(inventarioRecordado());
aplicarPersonalizacion({ tema: "sistema", avisos: "arriba", animaciones: true, ...personalizacionRecordada() });
document.documentElement.dataset.version = VERSION;

/**
 * Candado de pestaña única. Al recargar (F5) el navegador puede tardar un momento en
 * soltar el candado de la página anterior, así que se reintenta unos segundos.
 */
async function tomarCandado(intentos = 20) {
  for (let i = 0; i < intentos; i++) {
    const tomado = await new Promise((resolver) => {
      navigator.locks
        .request("control-almacen", { ifAvailable: true }, async (candado) => {
          if (!candado) {
            resolver(false);
            return;
          }
          resolver(true);
          await new Promise(() => {}); // se conserva mientras la pestaña siga abierta
        })
        .catch(() => resolver(false));
    });
    if (tomado) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (navigator.locks?.request) {
  tomarCandado().then((tomado) => {
    if (tomado) arrancar().catch((error) => pantalla("Error al iniciar", error.message));
    else {
      pantalla(
        "La herramienta ya está abierta",
        "Está abierta en otra pestaña o ventana de este navegador. Ciérrala o usa esa para no pisar los cambios.",
      );
    }
  });
} else {
  arrancar();
}
