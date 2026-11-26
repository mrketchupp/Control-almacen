// Pantallas del arranque (Ronda 36, fallo reportado: tras un corte de luz la herramienta se quedaba en «Cargando…»
// para siempre y la otra ventana decía «ya está abierta», sin nada que hacer). Se dibujan antes de que exista la
// sesión, así que no usan useSesion: main.js les pasa lo que necesitan.
//
//   PantallaCarga     el paso en que va y, si un paso tarda, qué hacer: Recargar, Restaurar un respaldo…, diagnóstico
//   PantallaYaAbierta otra ventana tiene la herramienta: Abrir aquí (la otra deja de guardar) o Reintentar
//   PantallaRobada    la herramienta se abrió en otra ventana: esta ya no guarda; Usar esta ventana
//   PantallaError     no se pudo abrir: el error y las mismas salidas
//   PantallaRescate   restaurar de emergencia: copia de lo que hay, elegir el respaldo, revisar y restaurar

import { useEffect, useState } from "preact/hooks";
import { descargar } from "../almacen/archivos.js";
import { anotar, textoError, textoRegistro } from "../almacen/registro.js";
import { ErrorRespaldo } from "../almacen/respaldos.js";
import { loQueSePierde } from "../almacen/rescate.js";
import { esTiempo } from "../almacen/tiempo.js";
import { fmtFechaHora } from "../nucleo/fechas.js";
import { Boton, ElegirArchivo } from "./componentes.js";
import { html } from "./html.js";
import { Icono } from "./iconos.js";

// Textos cortos y de acción (pedido del usuario): quien usa la herramienta no lee explicaciones.
export const TEXTOS_PASO = Object.freeze({
  candado: "Abriendo…",
  datos: "Leyendo datos…",
  compartidos: "Leyendo ajustes…",
  carpeta: "Revisando la carpeta…",
  abrir: "Abriendo…",
});

/** Si un paso tarda más que esto, la pantalla de carga ofrece qué hacer. */
export const AYUDA_TRAS_MS = 12000;

const folioE = (n) => `E-${String(n).padStart(4, "0")}`;

/** Navegador y cómo se abrió (para el diagnóstico). */
export function navegadorYVentana() {
  const agente = globalThis.navigator?.userAgent ?? "";
  const edge = /Edg\/([\d.]+)/.exec(agente)?.[1];
  const chrome = /Chrome\/([\d.]+)/.exec(agente)?.[1];
  const app = ["standalone", "minimal-ui", "fullscreen"].some((m) => globalThis.matchMedia?.(`(display-mode: ${m})`).matches);
  return {
    navegador: edge ? `Edge ${edge}` : chrome ? `Chrome ${chrome}` : agente || "?",
    ventana: `${globalThis.location?.protocol ?? "?"} en ${app ? "ventana de aplicación" : "pestaña"}`,
  };
}

/** El registro (con el arranque) listo para pegar en la conversación. */
export function textoDiagnostico({ inventario, version, situacion = "" }) {
  const { navegador, ventana } = navegadorYVentana();
  return textoRegistro([
    ["Herramienta", version ?? "?"],
    ["Inventario", inventario?.id ?? "?"],
    ["Navegador", navegador],
    ["Abierta como", ventana],
    ["Hora", new Date().toLocaleString("es-MX")],
    ...(situacion ? [["Situación", situacion]] : []),
  ]);
}

/** Copiar el diagnóstico; si el navegador no deja, se muestra para copiarlo a mano o se descarga. */
function Diagnostico({ texto }) {
  const [estado, setEstado] = useState(null); // null | "copiado" | "manual"
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto());
      setEstado("copiado");
    } catch {
      setEstado("manual");
    }
  };
  const bajar = () => descargar(`diagnostico control almacen ${new Date().toISOString().slice(0, 10)}.txt`, new TextEncoder().encode(texto()));
  return html`<div class="arranque-diagnostico">
    <${Boton} tipo="texto" onClick=${copiar}><${Icono} nombre="copiar" tam=${16} /> ${estado === "copiado" ? "Diagnóstico copiado ✓" : "Copiar diagnóstico"}<//>
    ${estado === "manual"
      ? html`<textarea class="arranque-texto" readonly rows="5" onFocus=${(e) => e.currentTarget.select()} aria-label="Diagnóstico">${texto()}</textarea>
          <${Boton} tipo="texto" onClick=${bajar}><${Icono} nombre="descargar" tam=${16} /> Descargar .txt<//>`
      : null}
  </div>`;
}

function Tarjeta({ icono = null, tono = "", titulo, children }) {
  return html`<div class="arranque">
    <div class=${`arranque-tarjeta ${tono ? `arranque-tarjeta-${tono}` : ""}`} role="region" aria-label=${titulo}>
      <h1 class="arranque-titulo">${icono ? html`<span class="arranque-icono" aria-hidden="true"><${Icono} nombre=${icono} tam=${22} /></span>` : null}${titulo}</h1>
      ${children}
    </div>
  </div>`;
}

/** Lo que se puede hacer si no abre: Recargar, Restaurar respaldo…, diagnóstico. */
function Salidas({ alRecargar, alRestaurar, diagnostico }) {
  return html`<div class="arranque-ayuda">
    <div class="arranque-acciones">
      <${Boton} tipo="primario" onClick=${alRecargar}>Recargar<//>
      ${alRestaurar ? html`<${Boton} onClick=${alRestaurar}><${Icono} nombre="respaldos" tam=${18} /> Restaurar respaldo…<//>` : null}
    </div>
    <${Diagnostico} texto=${diagnostico} />
  </div>`;
}

/**
 * Mientras abre. `paso` es uno de TEXTOS_PASO y `desde`, cuándo empezó (ms). Si tarda más de AYUDA_TRAS_MS en un
 * paso, dice por qué puede ser y ofrece las salidas.
 */
export function PantallaCarga({ inventario, paso, desde, alRecargar, alRestaurar, diagnostico }) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const segundos = Math.max(0, Math.floor((ahora - desde) / 1000));
  const atorada = ahora - desde >= AYUDA_TRAS_MS;
  return html`<${Tarjeta} titulo=${`Control de Almacén · ${inventario.id}`}>
    <p class="arranque-paso" aria-live="polite">
      <span class="arranque-giro" aria-hidden="true"></span>
      <span>${TEXTOS_PASO[paso] ?? "Cargando…"}${segundos >= 3 ? html` <span class="arranque-segundos">${segundos} s</span>` : null}</span>
    </p>
    ${atorada
      ? html`<div class="arranque-atorada">
          <p><strong>Se quedó aquí.</strong></p>
          <${Salidas} alRecargar=${alRecargar} alRestaurar=${alRestaurar} diagnostico=${diagnostico} />
        </div>`
      : null}
  <//>`;
}

/** Otra ventana tiene la herramienta. */
export function PantallaYaAbierta({ alAbrirAqui, alReintentar }) {
  const [ocupado, setOcupado] = useState(null);
  const [sigue, setSigue] = useState(false);
  const hacer = (cual, accion) => async () => {
    setOcupado(cual);
    const pudo = await accion();
    setOcupado(null);
    if (!pudo) setSigue(true);
  };
  return html`<${Tarjeta} icono="candado" titulo="Ya está abierta en otra ventana">
    <p class="arranque-nota">«Abrir aquí»: la otra deja de guardar.</p>
    <div class="arranque-acciones">
      <${Boton} tipo="primario" disabled=${Boolean(ocupado)} onClick=${hacer("aqui", alAbrirAqui)}>${ocupado === "aqui" ? "Abriendo…" : "Abrir aquí"}<//>
      <${Boton} disabled=${Boolean(ocupado)} onClick=${hacer("reintentar", alReintentar)}>${ocupado === "reintentar" ? "Revisando…" : "Reintentar"}<//>
    </div>
    ${sigue ? html`<p class="arranque-nota" role="status">Sigue abierta.</p>` : null}
  <//>`;
}

/** La herramienta se abrió en otra ventana: esta ya no guarda. */
export function PantallaRobada({ alUsarEsta }) {
  return html`<${Tarjeta} icono="candado" titulo="Se abrió en otra ventana">
    <p class="arranque-nota">Esta ya no guarda.</p>
    <div class="arranque-acciones">
      <${Boton} onClick=${alUsarEsta}>Usar esta ventana<//>
    </div>
  <//>`;
}

/** No se pudo abrir: el error y las salidas. */
export function PantallaError({ titulo, texto, inventario, alRecargar, alRestaurar, diagnostico }) {
  return html`<${Tarjeta} icono="error" tono="error" titulo=${titulo}>
    <p>${texto}</p>
    ${inventario ? html`<${Salidas} alRecargar=${alRecargar} alRestaurar=${alRestaurar} diagnostico=${diagnostico} />` : null}
  <//>`;
}

function Resumen({ r }) {
  const partes = [r.ultimaSalida ? `hasta el vale ${r.ultimaSalida}` : "sin vales", r.ultimaEntrada ? `entrada ${folioE(r.ultimaEntrada)}` : null].filter(Boolean);
  return html`<span>${partes.join(" · ")}</span>`;
}

/** Cómo borrar a mano la base de este inventario cuando ni la herramienta puede. */
function LimpiarAMano({ inventario }) {
  return html`<div class="arranque-manual">
    <p><strong>No se pudo borrar desde aquí.</strong> A mano:</p>
    <ol>
      <li>Cierra las demás ventanas de la herramienta.</li>
      <li><kbd class="tecla">F12</kbd> → <strong>Aplicación</strong> → <strong>IndexedDB</strong> → clic derecho en <strong>${inventario.bd}</strong> → <strong>Eliminar base de datos</strong>.</li>
      <li><kbd class="tecla">F5</kbd> → <strong>Seguir desde un respaldo</strong>.</li>
    </ol>
  </div>`;
}

/**
 * Restaurar de emergencia. main.js da las funciones:
 *   copiar()          copia de lo que hay ({ nombre, datos, resumen } | null); ErrorTiempo si la base no responde
 *   alColgada()       la copia no respondió: recargar en modo rescate sin volver a intentarla
 *   revisar(datos)    resumen del respaldo (ErrorRespaldo si no sirve)
 *   restaurar(datos)  { borrada } (ErrorTiempo si ni borrando se pudo)
 *   alSalir()         volver sin restaurar · alTerminar() abrir la herramienta ya restaurada
 */
export function PantallaRescate({ inventario, sinCopia = false, copiar, alColgada, revisar, restaurar, alSalir, alTerminar, diagnostico }) {
  const [fase, setFase] = useState(sinCopia ? "elegir" : "copiando");
  const [copia, setCopia] = useState(sinCopia ? { estado: "colgada" } : null);
  const [respaldo, setRespaldo] = useState(null);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (sinCopia) return;
    let vivo = true;
    copiar()
      .then((c) => {
        if (!vivo) return;
        if (c) {
          descargar(c.nombre, c.datos);
          anotar("rescate", `copia de lo que había: Descargas/${c.nombre}`);
          setCopia({ estado: "guardada", nombre: c.nombre, resumen: c.resumen });
        } else setCopia({ estado: "sin-datos" });
        setFase("elegir");
      })
      .catch((e) => {
        if (!vivo) return;
        anotar("rescate", "copia de lo que había", e);
        if (esTiempo(e)) {
          setFase("recargando");
          alColgada();
          return;
        }
        setCopia({ estado: "no-se-pudo", error: e.message });
        setFase("elegir");
      });
    return () => {
      vivo = false;
    };
  }, []);

  const elegir = async (archivo) => {
    setError(null);
    try {
      const datos = new Uint8Array(await archivo.arrayBuffer());
      setRespaldo({ datos, nombre: archivo.name, resumen: revisar(datos) });
      setFase("revisado");
    } catch (e) {
      setError(e.message);
    }
  };

  const confirmar = async () => {
    setError(null);
    setFase("restaurando");
    try {
      const r = await restaurar(respaldo.datos);
      anotar("rescate", `restaurado ${respaldo.nombre}${r.borrada ? " (se borró la base: no respondía)" : ""}`, r.motivo ?? null);
      setResultado(r);
      setFase("listo");
    } catch (e) {
      anotar("rescate", `restaurar ${respaldo.nombre}`, e);
      if (e instanceof ErrorRespaldo) {
        setError(e.message);
        setFase("revisado");
      } else {
        // Ni sobre la base que había ni borrándola: hay que limpiarla a mano.
        setError(textoError(e));
        setFase("manual");
      }
    }
  };

  const pierde = respaldo && copia?.resumen ? loQueSePierde(copia.resumen, respaldo.resumen) : null;
  const rango = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);

  return html`<${Tarjeta} icono="respaldos" titulo=${`Restaurar respaldo · ${inventario.id}`}>
    ${fase === "copiando" || fase === "recargando"
      ? html`<p class="arranque-paso" aria-live="polite"><span class="arranque-giro" aria-hidden="true"></span>
          ${fase === "copiando" ? "Guardando copia de lo que hay…" : "Recargando…"}</p>`
      : null}
    ${copia?.estado === "guardada"
      ? html`<p class="arranque-ok"><${Icono} nombre="ok" tam=${18} /> Copia de lo que había: Descargas/${copia.nombre}</p>`
      : copia?.estado === "colgada" || copia?.estado === "no-se-pudo"
        ? html`<p class="arranque-alerta">No se pudo leer lo que había.</p>`
        : null}
    ${fase === "elegir"
      ? html`<p>Elige el respaldo más reciente (<code>${inventario.respaldo}…zip</code>).</p>
          <div class="arranque-acciones">
            <${ElegirArchivo} etiqueta="Elegir respaldo…" acepta=".zip" tipo="primario" alElegir=${elegir} />
            <${Boton} onClick=${alSalir}>Salir<//>
          </div>`
      : null}
    ${fase === "revisado" && respaldo
      ? html`<div class="arranque-resumen">
            <p><strong>${respaldo.nombre}</strong></p>
            <p>${respaldo.resumen.fecha_hora ? fmtFechaHora(respaldo.resumen.fecha_hora) : "?"} · <${Resumen} r=${respaldo.resumen} /></p>
          </div>
          ${pierde?.salidas || pierde?.entradas
            ? html`<p class="arranque-alerta">
                Se pierden ${pierde.salidas ? `los vales ${rango(pierde.salidas)}` : ""}${pierde.salidas && pierde.entradas ? " y " : ""}${pierde.entradas ? `las entradas ${rango(pierde.entradas.map(folioE))}` : ""}: captúralos otra vez, en orden.
              </p>`
            : copia?.estado !== "guardada" && copia?.estado !== "sin-datos"
              ? html`<p class="arranque-alerta">Revisa tu último vale impreso: lo posterior se captura otra vez, en orden.</p>`
              : null}
          <div class="arranque-acciones">
            <${Boton} tipo="peligro" onClick=${confirmar}>Restaurar<//>
            <${ElegirArchivo} etiqueta="Elegir otro…" acepta=".zip" alElegir=${elegir} />
            <${Boton} onClick=${alSalir}>Salir<//>
          </div>`
      : null}
    ${fase === "restaurando" ? html`<p class="arranque-paso" aria-live="polite"><span class="arranque-giro" aria-hidden="true"></span> Restaurando…</p>` : null}
    ${fase === "listo"
      ? html`<p class="arranque-ok" role="status"><${Icono} nombre="ok" tam=${18} /> Listo.</p>
          <div class="arranque-acciones"><${Boton} tipo="primario" onClick=${alTerminar}>Abrir la herramienta<//></div>`
      : null}
    ${fase === "manual" ? html`<${LimpiarAMano} inventario=${inventario} />` : null}
    ${error ? html`<p class="arranque-error" role="alert">${error}</p>` : null}
    ${fase === "manual" || fase === "elegir" ? html`<${Diagnostico} texto=${diagnostico} />` : null}
  <//>`;
}
