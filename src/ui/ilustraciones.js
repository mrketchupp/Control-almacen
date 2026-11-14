// Dibujos de Windows para explicar con imágenes lo que pasó (p. ej. el libro está abierto en Excel y el
// archivo quedó en Descargas). Son HTML y SVG propios, con los colores en variables de `.ilus` (claro y
// oscuro en estilos.css): sin imágenes ni fuentes externas. Íconos genéricos, parecidos a los de Windows 11.

import { html } from "./html.js";

const svg = (tam, contenido, clase = "") =>
  html`<svg class=${`ilus-svg ${clase}`} width=${tam} height=${tam} viewBox="0 0 24 24" aria-hidden="true">${contenido}</svg>`;

// ------------------------------------------------------------------ íconos de la barra de tareas

export const IcoInicio = ({ tam = 22 }) =>
  svg(tam, html`<rect class="f-azul" x="3" y="3" width="8.4" height="8.4" rx="1.4" /><rect class="f-azul" x="12.6" y="3" width="8.4" height="8.4" rx="1.4" />
    <rect class="f-azul" x="3" y="12.6" width="8.4" height="8.4" rx="1.4" /><rect class="f-azul" x="12.6" y="12.6" width="8.4" height="8.4" rx="1.4" />`);

export const IcoBuscar = ({ tam = 22 }) =>
  svg(tam, html`<circle class="t-texto" cx="10.5" cy="10.5" r="6" /><path class="t-texto" d="M15 15l5 5" />`);

export const IcoCarpeta = ({ tam = 22 }) =>
  svg(tam, html`<path class="f-amarillo2" d="M2 6.5A1.5 1.5 0 0 1 3.5 5H9l2 2h9.5A1.5 1.5 0 0 1 22 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" />
    <path class="f-amarillo" d="M2 9.5h20V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" />`);

/** El explorador de archivos: la carpeta con una franja azul. */
export const IcoExplorador = ({ tam = 22 }) =>
  svg(tam, html`<path class="f-amarillo2" d="M2 6.5A1.5 1.5 0 0 1 3.5 5H9l2 2h9.5A1.5 1.5 0 0 1 22 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" />
    <path class="f-amarillo" d="M2 9.5h20V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" /><rect class="f-azul" x="2" y="12" width="20" height="2.6" />`);

/** Navegador genérico (círculo con una ola). */
export const IcoNavegador = ({ tam = 22 }) =>
  svg(tam, html`<circle class="f-azul2" cx="12" cy="12" r="9.5" /><path class="f-verde-azul" d="M3 13.5a9.5 9.5 0 0 0 18.4 1.7c-2.6 2.3-7 2.2-8.9-.5-1.4-2 .3-4.5 2.9-4.2 2.4.3 3.6 2 3.6 2 .3-4.3-3.5-7.6-8-7.2C6.6 5.7 3.2 9.2 3 13.5z" />`);

/** Hoja de cálculo verde con una X (como Excel). */
export const IcoExcel = ({ tam = 22 }) =>
  svg(tam, html`<rect class="f-verde2" x="7" y="3" width="14.5" height="18" rx="2" />
    <path class="t-blanco-tenue" d="M14 7.5h5M14 11h5M14 14.5h5M14 18h5" />
    <rect class="f-verde" x="2.5" y="6.5" width="11" height="11" rx="2" />
    <path class="t-blanco" d="M5.6 9.3l4.8 5.4M10.4 9.3l-4.8 5.4" />`);

/** Nube de OneDrive; `sincronizando` agrega las flechas que giran. */
export const IcoNube = ({ tam = 18, sincronizando = false }) =>
  svg(tam, html`<path class="f-azul" d="M6.8 18.5a4.6 4.6 0 0 1-.7-9.1 6 6 0 0 1 11.4-1.3 4.7 4.7 0 0 1 .3 10.4z" />
    ${sincronizando ? html`<g class="ilus-gira"><circle class="f-fondo-barra" cx="18" cy="17" r="5" /><path class="t-azul" d="M15.4 16.2a2.7 2.7 0 0 1 4.8-1.2M20.6 17.8a2.7 2.7 0 0 1-4.8 1.2M20.4 13.8v1.4H19M15.6 20.2v-1.4H17" /></g>` : null}`);

const IcoWifi = ({ tam = 16 }) => svg(tam, html`<path class="t-texto" d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.4a4 4 0 0 1 6 0" /><circle class="f-texto" cx="12" cy="19.4" r="1.2" />`);
const IcoVolumen = ({ tam = 16 }) => svg(tam, html`<path class="f-texto" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path class="t-texto" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />`);

/** La flecha del mouse. */
const Cursor = () =>
  html`<svg class="ilus-cursor" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path class="f-cursor" d="M5 3l13 12.2-5.6.5 3.3 6.5-2.6 1.3-3.3-6.6L5 20.5z" /></svg>`;

// ------------------------------------------------------------------ íconos del explorador

const IcoCasa = ({ tam = 16 }) => svg(tam, html`<path class="t-texto" d="M4 11l8-6.5 8 6.5M6 9.5V19h4.5v-5h3v5H18V9.5" />`);
const IcoEscritorio = ({ tam = 16 }) => svg(tam, html`<rect class="f-azul" x="2.5" y="4" width="19" height="12.5" rx="1.6" /><path class="t-texto" d="M9 20h6M12 16.5V20" />`);
const IcoDescargas = ({ tam = 16 }) => svg(tam, html`<path class="t-verde-azul grueso" d="M12 3.5v11M7 10l5 5 5-5" /><path class="t-verde-azul grueso" d="M4.5 20h15" />`);
const IcoDocumentos = ({ tam = 16 }) => svg(tam, html`<path class="f-azul2" d="M6 2.5h8l4.5 4.5v14.5H6z" /><path class="t-blanco" d="M9 11h6.5M9 14h6.5M9 17h4.5" />`);
const IcoImagenes = ({ tam = 16 }) => svg(tam, html`<rect class="f-azul2" x="2.5" y="4.5" width="19" height="15" rx="2" /><path class="f-blanco" d="M5 17l4.5-5.5 3.5 4 2-2.3L19 17z" /><circle class="f-amarillo" cx="16.5" cy="8.5" r="1.7" />`);
const IcoPin = () => svg(12, html`<path class="t-tenue" d="M9.5 3.5l5 5M8 9l7-2.5-3.5 7M10.5 13.5l-6 6" />`, "ilus-pin");

/** Archivo de Excel en la lista: hoja blanca con la esquina doblada y la insignia verde. */
const IcoArchivoExcel = ({ tam = 20 }) =>
  svg(tam, html`<path class="f-hoja t-borde" d="M7 2.5h8l4.5 4.5v14.5H7z" /><path class="t-borde" d="M15 2.5V7h4.5" />
    <rect class="f-verde" x="2.5" y="10" width="10" height="10" rx="1.8" /><path class="t-blanco" d="M5.3 12.6l4.4 4.8M9.7 12.6l-4.4 4.8" />`);
const IcoArchivo = ({ tam = 20 }) => svg(tam, html`<path class="f-hoja t-borde" d="M6 2.5h8l4.5 4.5v14.5H6z" /><path class="t-borde" d="M14 2.5V7h4.5" />`);

// ------------------------------------------------------------------ escenas

/**
 * La barra de tareas de Windows con Excel abierto y la vista previa de su ventana, con el mouse sobre la
 * ✕ para cerrarla. `sincronizando`: la nube de OneDrive en la bandeja con sus flechas.
 */
export function BarraDeTareas({ archivo, sincronizando = false, ahora = new Date() }) {
  const dos = (n) => String(n).padStart(2, "0");
  return html`<div class="ilus ilus-escritorio" role="img" aria-label=${`Barra de tareas de Windows con Excel abierto en «${archivo}»`}>
    <div class="ilus-tareas">
      <div class="ilus-tareas-centro">
        <span class="ilus-app"><${IcoInicio} /></span>
        <span class="ilus-app"><${IcoBuscar} /></span>
        <span class="ilus-app abierta"><${IcoExplorador} /></span>
        <span class="ilus-app abierta activa resaltada">
          <span class="ilus-vista">
            <span class="ilus-vista-cabeza">
              <${IcoExcel} tam=${14} />
              <span class="ilus-vista-nombre">${archivo}</span>
              <span class="ilus-vista-x">✕</span>
              <${Cursor} />
            </span>
            <span class="ilus-vista-hoja"></span>
          </span>
          <${IcoExcel} />
        </span>
        <span class="ilus-app abierta"><${IcoNavegador} /></span>
      </div>
      <div class="ilus-bandeja">
        <span class=${`ilus-bandeja-nube ${sincronizando ? "resaltada" : ""}`}><${IcoNube} sincronizando=${sincronizando} /></span>
        <span class="ilus-bandeja-extra"><${IcoWifi} /><${IcoVolumen} /></span>
        <span class="ilus-hora">${ahora.getHours()}:${dos(ahora.getMinutes())}<br />${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}</span>
      </div>
    </div>
  </div>`;
}

/** Dónde quedó: "Descargas/NOMBRE" o "Carpeta/exportaciones/AAAA-MM-DD/NOMBRE". */
export function ubicacionDe(destino) {
  const partes = String(destino ?? "").split("/").filter(Boolean);
  const archivo = partes.pop() ?? "";
  if (!partes.length || partes[0] === "Descargas") return { lado: "Descargas", ruta: ["Descargas"], archivo };
  return { lado: partes[0], ruta: partes, archivo };
}

const FIJADOS = [
  ["Escritorio", IcoEscritorio],
  ["Descargas", IcoDescargas],
  ["Documentos", IcoDocumentos],
  ["Imágenes", IcoImagenes],
];

/** El explorador de archivos con los accesos fijados a la izquierda y el archivo nuevo resaltado. */
export function Explorador({ destino }) {
  const { lado, ruta, archivo } = ubicacionDe(destino);
  const fijados = FIJADOS.some(([n]) => n === lado) ? FIJADOS : [...FIJADOS, [lado, IcoCarpeta]];
  return html`<div class="ilus ilus-explorador" role="img" aria-label=${`Explorador de archivos en ${ruta.join(" › ")} con «${archivo}»`}>
    <div class="ilus-exp-titulo">
      <${IcoExplorador} tam=${16} />
      <span class="ilus-exp-nombre">${ruta.at(-1)}</span>
      <span class="ilus-exp-controles"><span>—</span><span>▢</span><span>✕</span></span>
    </div>
    <div class="ilus-exp-ruta">
      <span class="ilus-exp-flechas">‹ › ↑</span>
      <span class="ilus-exp-migas">${ruta.map((p, i) => html`${i ? html`<span class="ilus-exp-sep">›</span>` : null}<span>${p}</span>`)}</span>
    </div>
    <div class="ilus-exp-cuerpo">
      <ul class="ilus-exp-lado">
        <li><${IcoCasa} /> <span>Inicio</span></li>
        <li class="ilus-exp-raya"></li>
        ${fijados.map(([nombre, Ico]) => html`<li class=${nombre === lado ? "activo" : ""}><${Ico} tam=${16} /> <span>${nombre}</span><${IcoPin} /></li>`)}
      </ul>
      <div class="ilus-exp-lista">
        <div class="ilus-exp-grupo">Hoy</div>
        <div class="ilus-exp-fila nuevo"><${IcoArchivoExcel} /><span class="ilus-exp-archivo">${archivo}</span></div>
        <div class="ilus-exp-grupo">Antes</div>
        <div class="ilus-exp-fila tenue"><${IcoArchivo} /><span class="ilus-exp-barra"></span></div>
        <div class="ilus-exp-fila tenue"><${IcoArchivo} /><span class="ilus-exp-barra corta"></span></div>
      </div>
    </div>
  </div>`;
}
