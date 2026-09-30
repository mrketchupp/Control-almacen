import { useEffect, useRef, useState } from "preact/hooks";
import { fijarAjuste } from "../../servicios/catalogos.js";
import {
  BLOQUES_VALE,
  LADOS,
  guardarPreferenciasVale,
  moverBloque,
  preferenciasVale,
  restablecerPreferenciasVale,
} from "../../servicios/preferencias.js";
import { Aviso, Boton, Tarjeta, useSesion } from "../componentes.js";
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

const BLOQUE = Object.fromEntries(BLOQUES_VALE.map((b) => [b.id, b]));

/** Vista previa de la pantalla del vale: bloques que se arrastran por su asa (o con ↑ ↓) y lado de cada columna. */
function PantallaVales() {
  const sesion = useSesion();
  const usuario = sesion.usuario;
  const guardadas = preferenciasVale(sesion.estado, usuario);
  const huella = `${usuario}|${guardadas.orden.join()}|${guardadas.lado}|${guardadas.propias}`;
  const [local, setLocal] = useState(guardadas);
  useEffect(() => setLocal(guardadas), [huella]);
  // El arrastre vive en una referencia (dragover llega muchas veces por segundo); el estado solo pinta la marca.
  const arrastre = useRef(null);
  const [marca, setMarca] = useState(null);

  if (!usuario) {
    return html`<${Tarjeta} titulo="Mi pantalla de vales">
      <${Aviso}>Elige quién está en turno (arriba a la derecha): cada almacenista guarda su propio acomodo del vale.<//>
    <//>`;
  }

  const guardar = (nuevo) => {
    const anterior = local;
    setLocal({ ...nuevo, propias: true });
    sesion.almacen.modificar((e) => guardarPreferenciasVale(e, usuario, nuevo)).catch((e) => {
      setLocal(anterior);
      sesion.avisar("error", e.message);
    });
  };
  const mover = (id, posicion) => guardar({ orden: moverBloque(local.orden, id, posicion), lado: local.lado });
  const restablecer = () =>
    sesion.almacen.modificar((e) => restablecerPreferenciasVale(e, usuario)).catch((e) => sesion.avisar("error", e.message));

  // Posición de inserción (antes del bloque k) según la mitad del bloque en que está el puntero.
  const sobre = (k) => (e) => {
    if (!arrastre.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const caja = e.currentTarget.getBoundingClientRect();
    const antes = e.clientY < caja.top + caja.height / 2 ? k : k + 1;
    const desde = local.orden.indexOf(arrastre.current.id);
    const util = antes === desde || antes === desde + 1 ? null : antes;
    arrastre.current.antes = util;
    if (util !== marca) setMarca(util);
  };
  const soltar = (e) => {
    e.preventDefault();
    const { id, antes } = arrastre.current ?? {};
    arrastre.current = null;
    setMarca(null);
    if (id === undefined || antes === null || antes === undefined) return;
    const desde = local.orden.indexOf(id);
    mover(id, antes > desde ? antes - 1 : antes);
  };
  const terminar = () => {
    arrastre.current = null;
    setMarca(null);
  };
  const otroLado = local.lado === "datos-izquierda" ? "partidas-izquierda" : "datos-izquierda";
  const ultimo = local.orden.length - 1;

  return html`<${Tarjeta} titulo="Mi pantalla de vales">
    <p class="nota">
      Acomoda los datos del vale a tu gusto: arrastra cada bloque por sus puntitos (o usa ↑ ↓) y elige de qué lado van los datos y las
      partidas. Se guarda al momento para <strong>${usuario}</strong>, se aplica cuando está en turno y viaja en los respaldos. Los
      bloques que no apliquen a un área (p. ej. firmas de NOV) no aparecen en ese vale.
    </p>
    <div class=${`previa-vale ${local.lado}`}>
      <div class="previa-datos">
        <span class="subtitulo-panel">Datos del vale</span>
        <ol class="previa-bloques" aria-label="Orden de los datos del vale" onDragOver=${(e) => arrastre.current && e.preventDefault()} onDrop=${soltar}>
          ${local.orden.map((id, k) => {
            const bloque = BLOQUE[id];
            const clases = [
              "previa-bloque",
              arrastre.current?.id === id ? "arrastrando" : "",
              marca === k ? "soltar-antes" : "",
              marca === k + 1 && k === ultimo ? "soltar-despues" : "",
            ];
            return html`<li
              key=${id}
              class=${clases.filter(Boolean).join(" ")}
              data-bloque=${id}
              draggable="true"
              onDragStart=${(e) => {
                arrastre.current = { id, antes: null };
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", bloque.etiqueta);
              }}
              onDragOver=${sobre(k)}
              onDragEnd=${terminar}
            >
              <span class="asa-arrastre" title="Arrastra para reordenar" aria-hidden="true"></span>
              <span class="previa-texto">
                <strong>${bloque.etiqueta}</strong>
                ${bloque.detalle ? html`<small>${bloque.detalle}</small>` : null}
              </span>
              <span class="previa-mover">
                <button type="button" class="boton boton-texto" disabled=${k === 0} onClick=${() => mover(id, k - 1)} aria-label=${`Subir «${bloque.etiqueta}»`} title="Subir">↑</button>
                <button type="button" class="boton boton-texto" disabled=${k === ultimo} onClick=${() => mover(id, k + 1)} aria-label=${`Bajar «${bloque.etiqueta}»`} title="Bajar">↓</button>
              </span>
            </li>`;
          })}
        </ol>
      </div>
      <div class="previa-partidas" aria-hidden="true">
        <span class="subtitulo-panel">Partidas</span>
        <div class="previa-renglones"><span></span><span></span><span></span><span></span></div>
        <span class="subtitulo-panel">Fotos (solo NOV)</span>
        <div class="previa-fotos"><span></span><span></span><span></span></div>
        <span class="previa-boton">Emitir vale</span>
      </div>
    </div>
    <div class="acciones-linea">
      <${Boton} onClick=${() => guardar({ orden: local.orden, lado: otroLado })}>⇄ Cambiar de lado<//>
      <${Boton} tipo="texto" disabled=${!local.propias} onClick=${restablecer}>Restablecer como venía<//>
      <span class="nota">${LADOS[local.lado]}.</span>
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
    <${PantallaVales} />
    <${Etapa} />
    <p class="nota">Las áreas (plantillas del vale) y las personas se editan en <a href="#areas">Áreas y personas</a>.</p>
  `;
}
