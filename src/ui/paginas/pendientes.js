import { useMemo, useState } from "preact/hooks";
import { lineasPorUbicar, ubicarLinea } from "../../servicios/consultas.js";
import { Aviso, Boton, Lista, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

function Renglon({ linea }) {
  const sesion = useSesion();
  const [eleccion, setEleccion] = useState(linea.candidatos[0] ? String(linea.candidatos[0].id) : "");
  const guardar = (existenciaId) =>
    sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((estado) => ubicarLinea(estado, linea.id, existenciaId, sesion.usuario));
      sesion.avisar("exito", `Folio ${linea.folio}, partida ${linea.renglon}: listo.`);
    });
  return html`<article class="pendiente">
    <div class="pendiente-datos">
      <span class="insignia insignia-neutro">Folio ${linea.folio} · partida ${linea.renglon}</span>
      <strong>${linea.codigo} · ${linea.descripcion}</strong>
      <span>Clave en el vale: <code>${linea.clave || "(vacía)"}</code> · cantidad ${num(linea.cantidad)} ${linea.um}</span>
    </div>
    <div class="pendiente-acciones">
      ${linea.candidatos.length
        ? html`<${Lista}
            valor=${eleccion}
            alCambiar=${setEleccion}
            ariaLabel="Partida del inventario"
            opciones=${linea.candidatos.map((c) => ({ valor: String(c.id), etiqueta: `${c.coincide ? "★ " : ""}${c.etiqueta}` }))}
          />`
        : html`<span class="nota">Este código no tiene partidas en el inventario.</span>`}
      <div class="acciones-linea">
        ${linea.candidatos.length ? html`<${Boton} tipo="primario" onClick=${() => guardar(Number(eleccion))}>Salió de aquí<//>` : null}
        <${Boton} onClick=${() => guardar(null)}>No inventariado<//>
      </div>
    </div>
  </article>`;
}

export function PaginaPendientes() {
  const sesion = useSesion();
  const lineas = useMemo(() => lineasPorUbicar(sesion.estado), [sesion.estado]);
  if (!lineas.length) {
    return html`<${Aviso} tipo="exito" titulo="Sin pendientes">Todos los vales posteriores al conteo están ligados al inventario.<//>`;
  }
  return html`
    <p class="introduccion">
      Estas partidas de vales posteriores al conteo no se pudieron ligar solas a una partida del inventario (hay varias
      posibles o la clave no coincide). Elige de qué contenedor salió; la opción más parecida aparece primero (★ = la
      clave coincide). Si no es un artículo del inventario (diésel, gases, etc.), elige <em>No inventariado</em>.
    </p>
    <${Tarjeta} titulo=${`${lineas.length} por ubicar`}>
      ${lineas.map((l) => html`<${Renglon} key=${l.id} linea=${l} />`)}
    <//>
  `;
}
