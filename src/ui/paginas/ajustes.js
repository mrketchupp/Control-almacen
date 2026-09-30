import { useEffect, useState } from "preact/hooks";
import { fijarAjuste } from "../../servicios/catalogos.js";
import { Boton, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";

function Captura() {
  const sesion = useSesion();
  const guardado = Boolean(sesion.estado.config?.captura_rapida);
  const [rapida, setRapida] = useState(guardado);
  useEffect(() => setRapida(guardado), [guardado]);
  const cambiar = (valor) => {
    setRapida(valor);
    sesion.almacen.modificar((e) => fijarAjuste(e, "captura_rapida", valor, sesion.usuario)).catch((e) => {
      setRapida(guardado);
      sesion.avisar("error", e.message);
    });
  };
  return html`<${Tarjeta} titulo="Captura de partidas">
    <div class="opciones-radio">
      <label>
        <input type="radio" name="captura" checked=${!rapida} onChange=${() => cambiar(false)} />
        <span>
          <strong>Paso a paso</strong> (recomendada): escribes el código AX, luego eliges la clave de ese código (con su
          contenedor y existencia) y la cantidad.
        </span>
      </label>
      <label>
        <input type="radio" name="captura" checked=${rapida} onChange=${() => cambiar(true)} />
        <span>
          <strong>Paso a paso + búsqueda rápida:</strong> además aparece arriba de las partidas un buscador por cualquier dato
          (código, descripción, dimensión o NP) que llena la partida completa con Enter.
        </span>
      </label>
    </div>
  <//>`;
}

function Etapa() {
  const sesion = useSesion();
  const actual = sesion.estado.config?.etapa_perforacion ?? "";
  const [valor, setValor] = useState(actual);
  useEffect(() => setValor(actual), [actual]);
  const guardar = () =>
    sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => fijarAjuste(e, "etapa_perforacion", valor, sesion.usuario));
      sesion.avisar("exito", "Etapa de perforación guardada: se usará en los vales nuevos.");
    });
  return html`<${Tarjeta} titulo="Etapa de perforación">
    <p class="nota">
      Es la línea de las observaciones que cambia en los vales internos. Cada vale nuevo la trae prellenada con este valor,
      y al emitir un vale con otra etapa, esa pasa a ser la actual.
    </p>
    <div class="acciones-linea">
      <input value=${valor} onInput=${(e) => setValor(e.currentTarget.value)} placeholder='Ej. 12 1/4"' aria-label="Etapa de perforación actual" />
      <${Boton} onClick=${guardar} disabled=${valor.trim() === actual}>Guardar etapa<//>
    </div>
  <//>`;
}

export function PaginaAjustes() {
  return html`
    <${Captura} />
    <${Etapa} />
    <p class="nota">Las áreas (plantillas del vale) y las personas se editan en <a href="#areas">Áreas y personas</a>.</p>
  `;
}
