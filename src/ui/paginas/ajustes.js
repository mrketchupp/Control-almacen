import { useEffect, useState } from "preact/hooks";
import { fijarAjuste } from "../../servicios/catalogos.js";
import { POSICIONES_AVISOS, TEMAS, guardarPersonalizacion, personalizacion } from "../../servicios/preferencias.js";
import { Boton, Segmentos, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { TarjetaCarpetas } from "./carpetas.js";
import { ValeImpreso } from "./valeImpreso.js";

/** Tema claro u oscuro, dónde salen los avisos y animaciones (por almacenista). */
export function Personalizacion() {
  const sesion = useSesion();
  const actual = personalizacion(sesion.estado, sesion.usuario);
  const cambiar = (cambios) =>
    sesion.almacen.modificar((e) => guardarPersonalizacion(e, sesion.usuario, cambios)).catch((e) => sesion.avisar("error", e.message));
  return html`<${Tarjeta} titulo="Personalización">
    <p class="nota">
      ${sesion.usuario ? html`Se guarda para <strong>${sesion.usuario}</strong> y se aplica cuando está en turno.` : "Nadie en turno: se guarda para este equipo."}
      Es la misma en DLTA y GSM.
    </p>
    <div class="personalizacion">
      <${Segmentos} etiqueta="Tema" valor=${actual.tema} opciones=${TEMAS} alCambiar=${(tema) => cambiar({ tema })} />
      <${Segmentos} etiqueta="Avisos" valor=${actual.avisos} opciones=${POSICIONES_AVISOS} alCambiar=${(avisos) => cambiar({ avisos })} />
      <${Segmentos}
        etiqueta="Animaciones"
        valor=${actual.animaciones ? "si" : "no"}
        opciones=${{ si: "Sí", no: "No, sin movimiento" }}
        alCambiar=${(v) => cambiar({ animaciones: v === "si" })}
      />
    </div>
    <p class="nota">En vales de entrada y con una ventana abierta, los avisos salen abajo para no tapar los botones.</p>
  <//>`;
}

function NpEnLote() {
  const sesion = useSesion();
  const guardado = Boolean(sesion.estado.config?.np_en_lote);
  const [activo, setActivo] = useState(guardado);
  useEffect(() => setActivo(guardado), [guardado]);
  const cambiar = (valor) => {
    setActivo(valor);
    sesion.almacen.modificar((e) => fijarAjuste(e, "np_en_lote", valor, sesion.usuario)).catch((e) => {
      setActivo(guardado);
      sesion.avisar("error", e.message);
    });
  };
  return html`<${Tarjeta} titulo="NP en el lote">
    <p class="nota">Es el mismo en DLTA y GSM. Solo cambia las partidas que agregues después.</p>
    <label class="casilla">
      <input type="checkbox" checked=${activo} onChange=${(e) => cambiar(e.currentTarget.checked)} />
      <span>
        <strong>Poner el NP en el lote</strong> de las partidas del vale de salida. Si está apagado, el NP solo se ve como
        referencia al buscar y en la lista, y el lote queda libre.
      </span>
    </label>
  <//>`;
}

/** El tipo con que empiezan las partidas nuevas de una entrada (Ronda 39, §10). */
function TipoPartidaEntrada() {
  const sesion = useSesion();
  const guardado = sesion.estado.config?.tipo_partida_entrada === "INV" ? "INV" : "CONS";
  const cambiar = (valor) =>
    sesion.almacen.modificar((e) => fijarAjuste(e, "tipo_partida_entrada", valor, sesion.usuario)).catch((e) => sesion.avisar("error", e.message));
  return html`<${Tarjeta} titulo="Partidas nuevas en las entradas">
    <p class="nota">Lo que no tiene existencia ni es consumible por regla. Es el mismo en DLTA y GSM.</p>
    <${Segmentos} etiqueta="Entran como" valor=${guardado} opciones=${{ CONS: "Consumible", INV: "Inventariable" }} alCambiar=${cambiar} />
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
      sesion.avisar("exito", "Etapa de perforación guardada: se usará en los vales nuevos de DLTA y GSM.");
    });
  return html`<${Tarjeta} titulo="Etapa de perforación">
    <p class="nota">
      Es la línea de las observaciones que cambia en los vales internos. Cada vale nuevo la trae prellenada con este valor,
      y al emitir un vale con otra etapa, esa pasa a ser la actual. <strong>Es la misma en DLTA y GSM</strong> (es del pozo):
      si la cambias en uno, el otro la toma al abrirlo.
    </p>
    <div class="acciones-linea">
      <input value=${valor} onInput=${(e) => setValor(e.currentTarget.value)} placeholder='Ej. 12 1/4"' aria-label="Etapa de perforación actual" />
      <${Boton} onClick=${guardar} disabled=${valor.trim() === actual}>Guardar etapa<//>
    </div>
  <//>`;
}

export function PaginaAjustes() {
  return html`
    <${Personalizacion} />
    <${NpEnLote} />
    <${TipoPartidaEntrada} />
    <${ValeImpreso} />
    <${TarjetaCarpetas} />
    <${Etapa} />
    <p class="nota">Las áreas (plantillas del vale) y las personas se editan en <a href="#areas">Áreas y personas</a>.</p>
  `;
}
