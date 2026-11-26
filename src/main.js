// Punto de entrada: una sola pestaña a la vez, datos en IndexedDB de este equipo.
// Dos inventarios (DLTA y GSM), cada uno con su propia base: se cambia de uno a otro en la
// misma pestaña y se recuerda el último que se usó.
//
// Ronda 36 (fallo reportado: tras un corte de luz se quedaba en «Cargando…» y la otra ventana decía «ya está
// abierta» sin salida): la pantalla de carga dice en qué paso va y, si tarda, ofrece Recargar, Restaurar un respaldo…
// y el diagnóstico; «ya está abierta» ofrece Abrir aquí (la otra ventana deja de guardar); el respaldo del inicio del
// día ya no detiene la apertura (Sesion.alAbrir).

import { render } from "preact";
import { Almacen } from "./almacen/almacen.js";
import { BackendIndexedDB, borrarBaseIndexedDB } from "./almacen/bd.js";
import { BD_COMUN } from "./almacen/compartidos.js";
import { anotar } from "./almacen/registro.js";
import { copiaDeRescate, restaurarDeEmergencia, revisarRespaldo } from "./almacen/rescate.js";
import { oSiNo } from "./almacen/tiempo.js";
import { INVENTARIO_DEFECTO, inventarioPorId } from "./nucleo/inventarios.js";
import { App } from "./ui/app.js";
import { PantallaCarga, PantallaError, PantallaRescate, PantallaRobada, PantallaYaAbierta, TEXTOS_PASO, textoDiagnostico } from "./ui/arranque.js";
import { html } from "./ui/html.js";
import { Sesion } from "./ui/sesion.js";
import { aplicarPersonalizacion, personalizacionRecordada } from "./ui/tema.js";

const VERSION = typeof __VERSION__ === "undefined" ? "desarrollo" : __VERSION__;
const raiz = document.getElementById("app");
const CLAVE_INVENTARIO = "control-almacen:inventario";
const NOMBRE_CANDADO = "control-almacen";
/** sessionStorage (dura lo que la ventana, también al recargar): abrir en modo rescate (`GSM` o `GSM|sin-copia`). */
const CLAVE_RESCATE = "control-almacen:rescate";
/** sessionStorage: al recargar, tomar la herramienta aunque otra ventana la tenga («Usar esta ventana»). */
const CLAVE_TOMAR = "control-almacen:tomar";
/** Tras quitarle la herramienta a otra ventana, un momento para que esa suelte su base antes de leer los datos. */
const ESPERA_TRAS_TOMAR_MS = 600;
/** Al cambiar de inventario, lo más que se espera a que lo compartido quede guardado. */
const ESPERA_COMPARTIDOS_MS = 5000;

let sinDibujar = true;
/** Dibuja en la página; la primera vez quita el «Cargando…» que trae el HTML. */
function dibujar(vnode) {
  if (sinDibujar) {
    raiz.innerHTML = "";
    sinDibujar = false;
  }
  render(vnode, raiz);
}

function pantalla(titulo, texto) {
  dibujar(html`<div class="pantalla-mensaje"><div class="tarjeta"><h1>${titulo}</h1><p>${texto}</p></div></div>`);
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

const deVentana = {
  leer(clave) {
    try {
      return sessionStorage.getItem(clave);
    } catch {
      return null;
    }
  },
  poner(clave, valor) {
    try {
      if (valor === null) sessionStorage.removeItem(clave);
      else sessionStorage.setItem(clave, valor);
    } catch {
      // sin sessionStorage: el modo rescate y «Usar esta ventana» no sobreviven a recargar
    }
  },
};

/** Marca la página con el inventario abierto (título de la pestaña y color de la cabecera). */
function marcarInventario(id) {
  document.title = `Control de Almacén · ${id}`;
  document.documentElement.dataset.inventario = id;
}

let abierta = null; // la sesión del inventario abierto
let comun = null; // lo que comparten los inventarios (etapa de perforación)
let perdida = false; // la herramienta se abrió en otra ventana: esta ya no guarda
/** Las bases que esta ventana tiene abiertas: si la herramienta se abre en otra, se sueltan todas. */
const bases = new Set();

function baseDe(nombre) {
  const backend = new BackendIndexedDB(nombre);
  if (perdida) backend.soltar();
  bases.add(backend);
  return backend;
}

function cerrarBase(backend) {
  backend?.cerrar();
  bases.delete(backend);
}

// ---------------------------------------------------------------- pantalla de carga

const carga = { paso: "candado", desde: Date.now(), inicio: Date.now(), pasos: [] };

const diagnostico = (situacion = "") => () => textoDiagnostico({ inventario: inventarioPorId(inventarioRecordado()), version: VERSION, situacion });

function recargar() {
  location.reload();
}

/** Recarga en modo rescate: nada abre la base antes de elegir el respaldo (lo que se quedó esperando se suelta). */
function aRescate(inventario = inventarioRecordado(), { sinCopia = false } = {}) {
  deVentana.poner(CLAVE_RESCATE, sinCopia ? `${inventario}|sin-copia` : inventario);
  location.reload();
}

function dibujarCarga() {
  if (abierta || perdida) return;
  const inventario = inventarioPorId(inventarioRecordado());
  dibujar(
    html`<${PantallaCarga}
      inventario=${inventario}
      paso=${carga.paso}
      desde=${carga.desde}
      alRecargar=${recargar}
      alRestaurar=${() => aRescate(inventario.id)}
      diagnostico=${diagnostico(`se quedó en «${TEXTOS_PASO[carga.paso] ?? carga.paso}»`)}
    />`,
  );
}

/** Pasa al paso `id` de la carga (lo anota en el registro si el anterior tardó). */
function paso(id) {
  const ahora = Date.now();
  const tardo = ahora - carga.desde;
  carga.pasos.push(`${carga.paso} ${(tardo / 1000).toFixed(1)} s`);
  if (tardo > 5000) anotar("arranque", `${TEXTOS_PASO[carga.paso] ?? carga.paso} tardó ${(tardo / 1000).toFixed(1)} s`);
  carga.paso = id;
  carga.desde = ahora;
  dibujarCarga();
}

// ---------------------------------------------------------------- abrir un inventario

/**
 * El estado guardado del OTRO inventario, solo para leerlo (etiquetas, Ronda 21): se abre su base, se
 * lee y se cierra. Si esa base aún no existe no se crea (null).
 */
async function leerOtroInventario(id) {
  const inventario = inventarioPorId(id);
  const existentes = indexedDB.databases ? await indexedDB.databases().catch(() => null) : null;
  if (existentes && !existentes.some((b) => b.name === inventario.bd)) return null;
  const backend = baseDe(inventario.bd);
  try {
    return await backend.leerEstado();
  } finally {
    cerrarBase(backend);
  }
}

/** Abre un inventario con su propia base y dibuja la herramienta para él. */
async function abrirInventario(id, { alPaso = () => {} } = {}) {
  const inventario = inventarioPorId(id);
  const backend = baseDe(inventario.bd);
  const almacen = new Almacen(backend, { version: VERSION, inventario: inventario.id });
  comun ??= baseDe(BD_COMUN);
  const sesion = new Sesion(almacen, backend, { cambiarInventario, comun, leerOtroInventario });
  try {
    await sesion.iniciar({ alPaso });
  } catch (error) {
    cerrarBase(backend);
    throw error;
  }
  if (perdida) return null;
  const anterior = abierta;
  abierta = sesion;
  recordarInventario(inventario.id);
  marcarInventario(inventario.id);
  dibujar(html`<${App} key=${inventario.id} sesion=${sesion} />`);
  anterior?.cerrar();
  anterior?.compartidos?.cerrar();
  if (anterior) cerrarBase(anterior.backend);
  // El respaldo del inicio del día, ya abierta (si la carpeta no responde, no detiene nada).
  sesion.alAbrir();
  return sesion;
}

/** Cambia de inventario sin recargar: el otro se abre desde el inicio (o en `pagina`, p. ej. "#conteo"). */
async function cambiarInventario(id, { pagina = "#inicio" } = {}) {
  if (inventarioPorId(id).id === abierta?.almacen.inventario) return abierta;
  // Que la etapa recién cambiada ya esté guardada (si la base común no responde, no se espera para siempre).
  await oSiNo(abierta?.compartidos?.terminar(), ESPERA_COMPARTIDOS_MS, null);
  if ((location.hash || "#inicio") !== pagina) history.replaceState(null, "", pagina);
  return abrirInventario(id);
}

function pantallaError(titulo, texto) {
  const inventario = inventarioPorId(inventarioRecordado());
  dibujar(
    html`<${PantallaError}
      titulo=${titulo}
      texto=${texto}
      inventario=${inventario}
      alRecargar=${recargar}
      alRestaurar=${() => aRescate(inventario.id)}
      diagnostico=${diagnostico(titulo)}
    />`,
  );
}

async function arrancar() {
  const faltan = requisitos();
  if (faltan.length) {
    pantalla("Navegador no compatible", `Abre la herramienta en Microsoft Edge o Google Chrome actualizados. Falta: ${faltan.join(", ")}.`);
    return;
  }
  try {
    await abrirInventario(inventarioRecordado(), { alPaso: paso });
  } catch (error) {
    if (perdida) return;
    console.error(error);
    anotar("arranque", "no se pudo abrir", error);
    pantallaError("No abrió", `No se pudieron leer los datos (${error.message}).`);
    return;
  }
  if (!perdida) anotar("arranque", `abierta en ${((Date.now() - carga.inicio) / 1000).toFixed(1)} s (${carga.pasos.join(", ")})`);
  window.addEventListener("beforeunload", (e) => {
    if (abierta?.ocupado && !perdida) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

// ---------------------------------------------------------------- restaurar de emergencia

function modoRescate(valor) {
  const [id, marca] = String(valor).split("|");
  const inventario = inventarioPorId(id);
  marcarInventario(inventario.id);
  const salir = () => {
    deVentana.poner(CLAVE_RESCATE, null);
    location.reload();
  };
  dibujar(
    html`<${PantallaRescate}
      inventario=${inventario}
      sinCopia=${marca === "sin-copia"}
      copiar=${async () => {
        const backend = baseDe(inventario.bd);
        try {
          return await copiaDeRescate(backend, { inventario: inventario.id, version: VERSION });
        } finally {
          cerrarBase(backend);
        }
      }}
      alColgada=${() => aRescate(inventario.id, { sinCopia: true })}
      revisar=${(datos) => revisarRespaldo(datos, inventario.id)}
      restaurar=${(datos) =>
        restaurarDeEmergencia({
          abrirBackend: () => baseDe(inventario.bd),
          borrarBase: () => borrarBaseIndexedDB(inventario.bd),
          inventario: inventario.id,
          version: VERSION,
          datos,
        })}
      alSalir=${salir}
      alTerminar=${() => {
        recordarInventario(inventario.id);
        salir();
      }}
      diagnostico=${diagnostico("restaurar de emergencia")}
    />`,
  );
}

// ---------------------------------------------------------------- una sola ventana a la vez

/** La herramienta se abrió en otra ventana («Abrir aquí»): esta suelta sus bases y deja de guardar. */
function perderCandado() {
  if (perdida) return;
  perdida = true;
  anotar("arranque", "la herramienta se abrió en otra ventana: esta dejó de guardar");
  abierta?.cerrar();
  abierta?.compartidos?.cerrar();
  for (const backend of bases) backend.soltar();
  dibujar(
    html`<${PantallaRobada}
      alUsarEsta=${() => {
        deVentana.poner(CLAVE_TOMAR, "1");
        location.reload();
      }}
    />`,
  );
}

/** Pide el candado una vez. `tomar`: quitárselo a la ventana que lo tenga. @returns si se obtuvo */
function pedirCandado(tomar) {
  return new Promise((resolver) => {
    let obtenido = false;
    navigator.locks
      .request(NOMBRE_CANDADO, tomar ? { steal: true } : { ifAvailable: true }, async (candado) => {
        if (!candado) {
          resolver(false);
          return;
        }
        obtenido = true;
        resolver(true);
        await new Promise(() => {}); // se conserva mientras la ventana siga abierta
      })
      .catch(() => {
        // Otra ventana se lo quitó («Abrir aquí»), o el navegador no lo dio.
        if (obtenido) perderCandado();
        else resolver(false);
      });
  });
}

/**
 * Candado de pestaña única. Al recargar (F5) el navegador puede tardar un momento en soltar el candado de la página
 * anterior, así que se reintenta unos segundos. Con `tomar`, se le quita a la otra ventana.
 */
async function tomarCandado({ tomar = false, intentos = 20 } = {}) {
  if (tomar) {
    if (!(await pedirCandado(true))) return false;
    anotar("arranque", "se abrió aquí: la otra ventana dejó de guardar");
    await new Promise((r) => setTimeout(r, ESPERA_TRAS_TOMAR_MS));
    return true;
  }
  for (let i = 0; i < intentos; i++) {
    if (await pedirCandado(false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function seguir() {
  carga.inicio = carga.desde = Date.now();
  const rescate = deVentana.leer(CLAVE_RESCATE);
  if (rescate) modoRescate(rescate);
  else arrancar().catch((error) => pantallaError("No abrió", error.message));
}

function yaAbierta() {
  dibujar(
    html`<${PantallaYaAbierta}
      alAbrirAqui=${async () => {
        const pudo = await tomarCandado({ tomar: true });
        if (pudo) seguir();
        return pudo;
      }}
      alReintentar=${async () => {
        const pudo = await tomarCandado({ intentos: 4 });
        if (pudo) seguir();
        return pudo;
      }}
    />`,
  );
}

// ---------------------------------------------------------------- inicio

marcarInventario(inventarioRecordado());
aplicarPersonalizacion({ tema: "sistema", avisos: "arriba", animaciones: true, ...personalizacionRecordada() });
document.documentElement.dataset.version = VERSION;

if (navigator.locks?.request) {
  const tomar = deVentana.leer(CLAVE_TOMAR) === "1";
  deVentana.poner(CLAVE_TOMAR, null);
  dibujarCarga();
  tomarCandado({ tomar }).then((tomado) => {
    if (tomado) seguir();
    else yaAbierta();
  });
} else {
  dibujarCarga();
  seguir();
}
