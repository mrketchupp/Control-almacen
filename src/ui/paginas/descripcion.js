// Corregir la descripción de un código del catálogo desde donde se ve: partidas de vales y entradas, conteo e inventario.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { fmtFechaHora } from "../../nucleo/fechas.js";
import { ErrorArticulo, bitacoraDeDescripcion, corregirDescripcion, descripcionLimpia } from "../../servicios/articulos.js";
import { Boton, Ventana, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

/**
 * Ventana para cambiar la descripción de un código.
 * alTerminar(descripcion) al guardar (con la descripción nueva); sin argumento si se cancela.
 */
export function EditorDescripcion({ codigo, alTerminar }) {
  const sesion = useSesion();
  const actual = sesion.estado.articulos[codigo]?.descripcion ?? "";
  const [texto, setTexto] = useState(actual);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const campo = useRef(null);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);
  const previas = useMemo(() => bitacoraDeDescripcion(sesion.estado, codigo).slice(0, 3), [sesion.estado.auditoria, codigo]);
  const cambia = descripcionLimpia(texto) !== "" && descripcionLimpia(texto) !== actual;
  const guardar = () =>
    sesion.tarea("Guardando la descripción…", async () => {
      try {
        const r = await sesion.almacen.modificar((e) => corregirDescripcion(e, codigo, texto, { usuario: sesion.usuario, motivo }));
        sesion.avisar("exito", `Código ${codigo}: descripción corregida.${r.partidas ? ` Se actualizó también en ${r.partidas === 1 ? "1 partida" : `${r.partidas} partidas`} de borradores abiertos.` : ""}`);
        alTerminar(r.despues);
      } catch (e) {
        if (e instanceof ErrorArticulo) setError(e.message);
        else throw e;
      }
    });
  return html`<${Ventana} titulo=${`Descripción del código ${codigo}`} alCerrar=${() => alTerminar()} clase="ventana-descripcion">
    <form
      class="editor-descripcion"
      onSubmit=${(e) => {
        e.preventDefault();
        if (cambia) guardar();
      }}
    >
      <p class="nota">
        Es la descripción del catálogo: la usan el inventario, los vales y entradas nuevos, las etiquetas nuevas y el Excel del inventario.
        Los vales ya emitidos conservan la suya (se corrigen desde el historial).
      </p>
      <p class="clave-antes-despues">
        <span><span class="nota">Ahora</span> <code>${actual || "—"}</code></span>
      </p>
      <label class="campo">
        <span>Descripción nueva</span>
        <textarea
          ref=${campo}
          rows="3"
          value=${texto}
          aria-label=${`Descripción del código ${codigo}`}
          onInput=${(e) => {
            setTexto(e.currentTarget.value.replace(/\s*[\r\n]+\s*/g, " "));
            setError(null);
          }}
          onKeyDown=${(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (cambia) guardar();
          }}
        ></textarea>
      </label>
      <label class="campo">
        <span>Motivo (opcional)</span>
        <input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. así viene en AX" />
      </label>
      ${error ? html`<p class="alerta" role="alert">${error}</p>` : null}
      ${previas.length
        ? html`<div class="nota">
            <strong>Correcciones anteriores</strong>
            <ul class="descripciones-previas">
              ${previas.map((a) => html`<li>${fmtFechaHora(a.fecha_hora)}${a.usuario ? ` · ${a.usuario}` : ""}: antes decía <code>${a.antes?.descripcion ?? "—"}</code></li>`)}
            </ul>
          </div>`
        : null}
      <div class="acciones-linea">
        <${Boton} onClick=${() => alTerminar()}>Cancelar<//>
        <${Boton} tipo="primario" disabled=${!cambia} onClick=${guardar}>Guardar descripción<//>
      </div>
    </form>
  <//>`;
}

/**
 * Botón ✎ junto a la descripción de un código del catálogo: abre la ventana para corregirla.
 * alCambiar(descripcion): la descripción nueva, para que la pantalla actualice las partidas que está editando.
 */
export function BotonDescripcion({ codigo, alCambiar = null }) {
  const sesion = useSesion();
  const [abierta, setAbierta] = useState(false);
  // La ventana guarda de forma asíncrona: al terminar se llama a la versión más reciente del que edita.
  const ultimo = useRef(alCambiar);
  ultimo.current = alCambiar;
  return html`<button
      type="button"
      class="boton-descripcion"
      disabled=${Boolean(sesion.ocupado)}
      title="Corregir la descripción de este código en el catálogo"
      aria-label=${`Corregir la descripción del código ${codigo}`}
      onClick=${() => setAbierta(true)}
    >
      <${Icono} nombre="lapiz" tam=${14} />
    </button>
    ${abierta
      ? html`<${EditorDescripcion}
          codigo=${codigo}
          alTerminar=${(descripcion) => {
            setAbierta(false);
            if (descripcion !== undefined) ultimo.current?.(descripcion);
          }}
        />`
      : null}`;
}
