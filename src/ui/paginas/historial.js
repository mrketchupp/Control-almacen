import { useMemo, useState } from "preact/hooks";
import { filasHistorial, filtrarHistorial } from "../../servicios/consultas.js";
import { filasEntradas, filtrarEntradas } from "../../servicios/entradas.js";
import { Boton, Buscador, CampoSugerido, Lista, Tabla, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

const SIN_FILTROS = { texto: "", codigo: "", depto: "", recibio: "", estado: "", desde: "", hasta: "" };

const SIN_FILTROS_ENTRADAS = { texto: "", folio: "", codigo: "", oc: "", desde: "", hasta: "" };

function HistorialEntradas() {
  const sesion = useSesion();
  const filas = useMemo(() => filasEntradas(sesion.estado), [sesion.estado]);
  const [filtros, setFiltros] = useState(SIN_FILTROS_ENTRADAS);
  const poner = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.currentTarget.value });
  const visibles = useMemo(() => filtrarEntradas(filas, filtros), [filas, filtros]);
  const activos = Object.values(filtros).filter(Boolean).length;
  const folios = new Set(visibles.map((f) => f.folio)).size;
  return html`
    <div class="filtros filtros-historial">
      <${Buscador} valor=${filtros.texto} alCambiar=${(texto) => setFiltros({ ...filtros, texto })} placeholder="Buscar en todo: folio, descripción, clave, origen…" />
      <label class="filtro"><span>Folio de la base</span><input value=${filtros.folio} onInput=${poner("folio")} placeholder="Ej. 12345" /></label>
      <label class="filtro"><span>Código AX</span><input inputmode="numeric" value=${filtros.codigo} onInput=${poner("codigo")} placeholder="Ej. 701" /></label>
      <label class="filtro"><span>O.C.</span><input value=${filtros.oc} onInput=${poner("oc")} placeholder="Orden de compra" /></label>
      <label class="filtro"><span>Desde</span><input type="date" value=${filtros.desde} onChange=${poner("desde")} /></label>
      <label class="filtro"><span>Hasta</span><input type="date" value=${filtros.hasta} onChange=${poner("hasta")} /></label>
      ${activos ? html`<${Boton} tipo="texto" onClick=${() => setFiltros(SIN_FILTROS_ENTRADAS)}>Quitar filtros (${activos})<//>` : null}
    </div>
    <p class="conteo">${num(visibles.length)} renglones · ${num(folios)} entradas${activos ? " con los filtros elegidos" : ""}</p>
    <${Tabla}
      limite=${200}
      filas=${visibles}
      columnas=${[
        { titulo: "Folio", render: (f) => html`<a class="enlace-folio" href=${`#entrada/${f.vale_id}`} title="Ver entrada">${f.folio_texto}</a>` },
        { clave: "folio_externo", titulo: "Folio base" },
        { clave: "fecha", titulo: "Fecha" },
        { clave: "origen", titulo: "Viene de" },
        { titulo: "Cant.", numero: true, render: (f) => num(f.cantidad) },
        { clave: "um", titulo: "UM" },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { clave: "clave", titulo: "Clave" },
        { clave: "oc", titulo: "O.C." },
        { titulo: "Entró a", render: (f) => html`<span class="sin-corte" title=${f.hoja}>${f.lugar}</span>` },
      ]}
      vacia=${filas.length ? "Ningún renglón coincide con los filtros." : "Aún no hay entradas. Se registran en Vales de entrada."}
    />
  `;
}

export function PaginaHistorial() {
  const [vista, setVista] = useState(() => (/^#historial\/entradas/.test(location.hash) ? "entradas" : "salidas"));
  return html`
    <div class="pestanas pestanas-vista" role="tablist" aria-label="Tipo de vale">
      ${[
        ["salidas", "Vales de salida"],
        ["entradas", "Vales de entrada"],
      ].map(
        ([clave, titulo]) => html`<button type="button" role="tab" aria-selected=${vista === clave} class=${`pestana ${vista === clave ? "activa" : ""}`} onClick=${() => setVista(clave)}>
          ${titulo}
        </button>`,
      )}
    </div>
    ${vista === "entradas" ? html`<${HistorialEntradas} />` : html`<${HistorialSalidas} />`}
  `;
}

function HistorialSalidas() {
  const sesion = useSesion();
  const filas = useMemo(() => filasHistorial(sesion.estado), [sesion.estado]);
  const [filtros, setFiltros] = useState(SIN_FILTROS);
  const poner = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.currentTarget.value });
  const fijar = (clave) => (valor) => setFiltros({ ...filtros, [clave]: valor });
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
      <div class="filtro">
        <span>Área destino</span>
        <${Lista}
          valor=${filtros.depto}
          alCambiar=${fijar("depto")}
          ariaLabel="Área destino"
          opciones=${[{ valor: "", etiqueta: "Todas" }, ...deptos.map((d) => ({ valor: d, etiqueta: d }))]}
        />
      </div>
      <div class="filtro">
        <span>Recibió</span>
        <${CampoSugerido} valor=${filtros.recibio} alCambiar=${fijar("recibio")} sugerencias=${personas} placeholder="Nombre" ariaLabel="Recibió" />
      </div>
      ${filas.some((f) => f.estado === "CANCELADO")
        ? html`<div class="filtro">
            <span>Estado</span>
            <${Lista}
              valor=${filtros.estado}
              alCambiar=${fijar("estado")}
              ariaLabel="Estado"
              opciones=${[
                { valor: "", etiqueta: "Todos" },
                { valor: "EMITIDO", etiqueta: "Emitidos" },
                { valor: "CANCELADO", etiqueta: "Cancelados (versiones anteriores)" },
              ]}
            />
          </div>`
        : null}
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
