// Punto de entrada: una sola pestaña a la vez, datos en IndexedDB de este equipo.

import { render } from "preact";
import { Almacen } from "./almacen/almacen.js";
import { BackendIndexedDB } from "./almacen/bd.js";
import { App } from "./ui/app.js";
import { html } from "./ui/html.js";
import { Sesion } from "./ui/sesion.js";
import { aplicarPersonalizacion, personalizacionRecordada } from "./ui/tema.js";

const VERSION = typeof __VERSION__ === "undefined" ? "desarrollo" : __VERSION__;
const raiz = document.getElementById("app");

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

async function arrancar() {
  const faltan = requisitos();
  if (faltan.length) {
    pantalla("Navegador no compatible", `Abre la herramienta en Microsoft Edge o Google Chrome actualizados. Falta: ${faltan.join(", ")}.`);
    return;
  }
  const backend = new BackendIndexedDB();
  const almacen = new Almacen(backend, { version: VERSION });
  const sesion = new Sesion(almacen, backend);
  try {
    await sesion.iniciar();
  } catch (error) {
    console.error(error);
    pantalla(
      "No se pudo abrir el almacenamiento local",
      `El navegador no permitió guardar datos (${error.message}). Si estás en una ventana InPrivate, abre una ventana normal.`,
    );
    return;
  }
  raiz.innerHTML = "";
  render(html`<${App} sesion=${sesion} />`, raiz);
  window.addEventListener("beforeunload", (e) => {
    if (sesion.ocupado) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

document.title = "Control de Almacén";
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
