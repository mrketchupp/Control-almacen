import { useMemo, useState } from "preact/hooks";
import { filasHistorial, filtrarHistorial } from "../../servicios/consultas.js";
import { Boton, Buscador, Tabla, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

const SIN_FILTROS = { texto: "", codigo: "", depto: "", recibio: "", estado: "", desde: "", hasta: "" };

export function PaginaHistorial() {
  const sesion = useSesion();
  const filas = useMemo(() => filasHistorial(sesion.estado), [sesion.estado]);
  const [filtros, setFiltros] = useState(SIN_FILTROS);
  const poner = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.currentTarget.value });
  const deptos = useMemo(() => [...new Set(filas.map((f) => f.depto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [filas]);
  const personas = useMemo(() => [...new Set(filas.map((f) => f.recibio).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [filas]);
  const visibles = useMemo(
    () => filtrarHistorial(filas, filtros).map((f) => (f.estado === "CANCELADO" ? { ...f, _clase: "fila-cancelada" } : f)),
    [filas, filtros],
  );
  const activos = Object.entries(filtros).filter(([, v]) => v).length;
  const folios = new Set(visibles.map((f) => f.folio)).size;
  return html`
    <div class="filtros filtros-historial">
      <${Buscador} valor=${filtros.texto} alCambiar=${(texto) => setFiltros({ ...filtros, texto })} placeholder="Buscar en todo: folio, descripción, clave, O.C.…" />
      <label class="filtro">
        <span>Código AX</span>
        <input inputmode="numeric" value=${filtros.codigo} onInput=${poner("codigo")} placeholder="Ej. 701" />
      </label>
      <label class="filtro">
        <span>Área destino</span>
        <select value=${filtros.depto} onChange=${poner("depto")}>
          <option value="">Todas</option>
          ${deptos.map((d) => html`<option value=${d}>${d}</option>`)}
        </select>
      </label>
      <label class="filtro">
        <span>Recibió</span>
        <input list="lista-recibio" value=${filtros.recibio} onInput=${poner("recibio")} placeholder="Nombre" />
        <datalist id="lista-recibio">${personas.map((p) => html`<option value=${p} />`)}</datalist>
      </label>
      <label class="filtro">
        <span>Estado</span>
        <select value=${filtros.estado} onChange=${poner("estado")}>
          <option value="">Todos</option>
          <option value="EMITIDO">Emitidos</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
      </label>
      <label class="filtro"><span>Desde</span><input type="date" value=${filtros.desde} onChange=${poner("desde")} /></label>
      <label class="filtro"><span>Hasta</span><input type="date" value=${filtros.hasta} onChange=${poner("hasta")} /></label>
      ${activos ? html`<${Boton} tipo="texto" onClick=${() => setFiltros(SIN_FILTROS)}>Quitar filtros (${activos})<//>` : null}
    </div>
    <p class="conteo">${num(visibles.length)} renglones · ${num(folios)} folios${activos ? " con los filtros elegidos" : ""}</p>
    <${Tabla}
      limite=${200}
      filas=${visibles}
      columnas=${[
        { titulo: "Folio", numero: true, render: (f) => html`<a class="enlace-folio" href=${`#vale/${f.vale_id}`} title="Ver vale">${f.folio}</a>${f.estado === "CANCELADO" ? html` <span class="insignia insignia-error">CANC.</span>` : ""}` },
        { clave: "fecha", titulo: "Fecha" },
        { clave: "depto", titulo: "Área destino" },
        { clave: "recibio", titulo: "Recibió" },
        { titulo: "Cant.", numero: true, render: (f) => num(f.cantidad) },
        { clave: "um", titulo: "UM" },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { clave: "clave", titulo: "Clave" },
        { clave: "oc", titulo: "O.C." },
        { titulo: "Notas", render: (f) => (f.notas ? html`<span class="nota-icono" title=${f.notas}>ⓘ</span>` : "") },
      ]}
      vacia="Ningún renglón coincide con los filtros."
    />
  `;
}
