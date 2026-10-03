import { useState } from "preact/hooks";
import { ErrorCapturaIA, INSTRUCCIONES, describirArreglos, interpretarRespuesta } from "../../servicios/capturaIA.js";
import { Boton, useSesion } from "../componentes.js";
import { html } from "../html.js";

/** Copia texto al portapapeles (con respaldo para navegadores que no dejan usar la API). */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/**
 * Los tres pasos para capturar con Copilot: 1) copiar instrucciones, 2) pegarlas en Copilot con la
 * foto o el PDF, 3) pegar aquí la respuesta (se carga sola al pegar). Si el JSON viene cortado o
 * con errores de formato se arregla solo y se avisa.
 * @param tipo      'entrada' | 'conteo'
 * @param alCargar  (respuesta) => reporte en texto (lista de líneas); lanza ErrorCapturaIA si no sirve
 * @param grande    versión de pantalla completa (vale de entrada en modo "desde foto")
 * @param alReporte (lineas) => avisa el resumen de lo cargado (p. ej. para cerrar la ventana)
 */
export function PasosCopilot({ tipo, alCargar, grande = false, alReporte = null }) {
  const sesion = useSesion();
  const instrucciones = INSTRUCCIONES[tipo];
  const [pegado, setPegado] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const copiar = async () => {
    const ok = await copiarTexto(instrucciones.texto);
    setCopiado(ok);
    if (!ok) sesion.avisar("advertencia", "No se pudo copiar automáticamente: abre «Ver el texto», selecciónalo y cópialo.");
  };
  const cargar = (texto = pegado) => {
    setError(null);
    try {
      const { datos, arreglos } = interpretarRespuesta(texto);
      const lineas = alCargar(datos);
      const arreglo = describirArreglos(arreglos);
      const resumen = [...(arreglo ? [`ℹ ${arreglo}`] : []), ...(lineas ?? [])];
      setReporte(resumen);
      setPegado("");
      alReporte?.(resumen);
    } catch (e) {
      if (!(e instanceof ErrorCapturaIA)) throw e;
      setError(e.message);
      setPegado(texto);
    }
  };
  const destino = tipo === "entrada" ? "del vale" : "de la hoja de conteo";
  return html`<div class=${`pasos-copilot ${grande ? "pasos-grandes" : ""}`}>
    <ol class="pasos-ia">
      <li class="paso-ia">
        <span class="paso-numero">1</span>
        <div>
          <strong>Copia las instrucciones</strong>
          <p class="nota">Le dicen a Copilot qué leer y cómo devolverlo.</p>
          <div class="acciones-linea">
            <${Boton} tipo=${copiado ? "secundario" : "primario"} onClick=${copiar}>${copiado ? "✓ Copiadas" : "📋 Copiar instrucciones"}<//>
          </div>
          <details class="ver-instrucciones"><summary>Ver el texto</summary><pre>${instrucciones.texto}</pre></details>
        </div>
      </li>
      <li class="paso-ia">
        <span class="paso-numero">2</span>
        <div>
          <strong>Pégalas en Copilot con la foto o el PDF ${destino}</strong>
          <p class="nota">
            Abre Copilot de Microsoft 365 con tu cuenta de trabajo, adjunta la foto o el PDF (si son varias hojas, todas juntas) y
            pega las instrucciones.
          </p>
        </div>
      </li>
      <li class="paso-ia">
        <span class="paso-numero">3</span>
        <div class="paso-pegar">
          <strong>Copia su respuesta y pégala aquí</strong>
          <textarea
            class="pegar-ia"
            rows=${grande ? 7 : 5}
            value=${pegado}
            onInput=${(e) => setPegado(e.currentTarget.value)}
            onPaste=${(e) => {
              const texto = e.clipboardData?.getData("text");
              if (!texto) return;
              e.preventDefault();
              cargar(texto);
            }}
            placeholder="Pega aquí el bloque de código (se carga solo)"
            aria-label="Respuesta de Copilot (JSON)"
          ></textarea>
          <div class="acciones-linea">
            <${Boton} tipo="primario" disabled=${!pegado.trim()} onClick=${() => cargar()}>Cargar<//>
            <span class="nota">Si viene incompleto o mal cerrado, se arregla solo.</span>
          </div>
        </div>
      </li>
    </ol>
    ${error ? html`<p class="alerta" role="alert">${error}</p>` : null}
    ${reporte
      ? html`<ul class="reporte-ia" role="status">
          ${reporte.map((r) => html`<li class=${r.startsWith("⚠") ? "alerta" : r.startsWith("ℹ") ? "nota" : ""}>${r}</li>`)}
        </ul>`
      : null}
    <p class="nota privacidad-ia">La herramienta no se conecta a ningún servicio: la foto la subes tú a Copilot y aquí solo se lee el texto que pegas.</p>
  </div>`;
}

/** Panel plegable con los pasos (para el conteo en captura). */
export function CapturaIA({ tipo, alCargar, abierto = false }) {
  return html`<details class="captura-ia" open=${abierto}>
    <summary><span class="icono-ia" aria-hidden="true">✨</span> Capturar desde la foto o PDF con Copilot</summary>
    <div class="captura-ia-cuerpo">
      <${PasosCopilot} tipo=${tipo} alCargar=${alCargar} />
    </div>
  </details>`;
}
