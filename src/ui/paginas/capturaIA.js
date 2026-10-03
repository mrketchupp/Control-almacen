import { useState } from "preact/hooks";
import { ErrorCapturaIA, INSTRUCCIONES, leerRespuesta } from "../../servicios/capturaIA.js";
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
 * Panel "Capturar desde una foto con tu asistente de IA": 1) copiar instrucciones, 2) pegarlas en
 * Copilot con la foto o el PDF, 3) pegar aquí el bloque JSON de la respuesta.
 * @param tipo      'entrada' | 'conteo'
 * @param alCargar  (respuesta) => reporte en texto (lista de líneas); lanza ErrorCapturaIA si no sirve
 */
export function CapturaIA({ tipo, alCargar, abierto = false }) {
  const sesion = useSesion();
  const instrucciones = INSTRUCCIONES[tipo];
  const [pegado, setPegado] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState(null);
  const copiar = async () => {
    const ok = await copiarTexto(instrucciones.texto);
    setCopiado(ok);
    if (!ok) sesion.avisar("advertencia", "No se pudo copiar automáticamente: selecciona el texto de las instrucciones y cópialo.");
  };
  const cargar = () => {
    setError(null);
    try {
      const lineas = alCargar(leerRespuesta(pegado));
      setReporte(lineas);
      setPegado("");
    } catch (e) {
      if (e instanceof ErrorCapturaIA) setError(e.message);
      else throw e;
    }
  };
  return html`<details class="captura-ia" open=${abierto}>
    <summary><span class="icono-ia" aria-hidden="true">✨</span> Capturar desde la foto o PDF con tu asistente (Copilot)</summary>
    <div class="captura-ia-cuerpo">
      <ol class="pasos-ia">
        <li>
          <strong>Copia las instrucciones</strong>
          <div class="acciones-linea">
            <${Boton} tipo="primario" tamano="chico" onClick=${copiar}>${copiado ? "✓ Copiadas" : "📋 Copiar instrucciones"}<//>
            <details class="ver-instrucciones"><summary>Ver texto</summary><pre>${instrucciones.texto}</pre></details>
          </div>
        </li>
        <li>
          <strong>Abre tu asistente</strong> (Copilot de Microsoft 365 con tu cuenta de trabajo), adjunta la foto o el PDF
          ${tipo === "entrada" ? " del vale" : " de la hoja de conteo"} y pega las instrucciones.
        </li>
        <li>
          <strong>Copia el bloque de código</strong> que te devuelva y pégalo aquí:
          <textarea
            class="pegar-ia"
            rows="5"
            value=${pegado}
            onInput=${(e) => setPegado(e.currentTarget.value)}
            placeholder='{ "tipo": ... }'
            aria-label="Respuesta del asistente (JSON)"
          ></textarea>
          <div class="acciones-linea">
            <${Boton} tipo="primario" disabled=${!pegado.trim()} onClick=${cargar}>Cargar al borrador<//>
            <span class="nota">Se llena el borrador; revisa lo marcado y confirma como siempre.</span>
          </div>
        </li>
      </ol>
      ${error ? html`<p class="alerta">${error}</p>` : null}
      ${reporte ? html`<ul class="reporte-ia">${reporte.map((r) => html`<li class=${r.startsWith("⚠") ? "alerta" : ""}>${r}</li>`)}</ul>` : null}
      <p class="nota">
        La herramienta no se conecta a ningún servicio: la foto la subes tú a tu asistente y aquí solo se lee el texto que pegas.
      </p>
    </div>
  </details>`;
}
