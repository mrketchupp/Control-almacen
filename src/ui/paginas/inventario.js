import { useMemo, useState } from "preact/hooks";
import { filasInventario } from "../../servicios/consultas.js";
import { Buscador, Tabla, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

export function PaginaInventario() {
  const sesion = useSesion();
  const filas = useMemo(() => filasInventario(sesion.estado), [sesion.estado]);
  const [texto, setTexto] = useState("");
  const [hoja, setHoja] = useState("");
  const [vista, setVista] = useState("todos");
  const hojas = useMemo(() => [...new Set(filas.map((f) => f.hoja))], [filas]);
  const porTexto = useFiltroTexto(filas, texto, ["codigo", "descripcion", "dimension", "np", "nota"]);
  const visibles = porTexto.filter((f) => {
    if (hoja && f.hoja !== hoja) return false;
    if (vista === "movimiento") return f.consumo || f.ingreso;
    if (vista === "agotado") return f.total <= 0;
    if (vista === "notas") return Boolean(f.nota);
    return true;
  });
  return html`
    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión, NP…" />
      <select value=${hoja} onChange=${(e) => setHoja(e.currentTarget.value)} aria-label="Contenedor">
        <option value="">Todos los contenedores</option>
        ${hojas.map((h) => html`<option value=${h}>${h}</option>`)}
      </select>
      <select value=${vista} onChange=${(e) => setVista(e.currentTarget.value)} aria-label="Vista">
        <option value="todos">Todos los renglones</option>
        <option value="movimiento">Con consumo o ingreso</option>
        <option value="agotado">Existencia 0 o negativa</option>
        <option value="notas">Con nota</option>
      </select>
      <span class="conteo">${num(visibles.length)} de ${num(filas.length)}</span>
    </div>
    <${Tabla}
      limite=${300}
      filas=${visibles.map((f) => ({ ...f, _clase: f.total < 0 ? "fila-negativa" : "" }))}
      columnas=${[
        {
          titulo: "Cont.",
          render: (f) => html`<span class="sin-corte" title=${f.hoja}>#${f.contenedor} ${f.clase === "Inventariable" ? "Inv." : "Cons."}</span>`,
        },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { clave: "dimension", titulo: "Dimensión" },
        { clave: "np", titulo: "NP" },
        { clave: "um", titulo: "UM" },
        { titulo: "Cantidad", numero: true, render: (f) => num(f.cantidad) },
        { titulo: "Consumo", numero: true, render: (f) => num(f.consumo) },
        { titulo: "Ingreso", numero: true, render: (f) => num(f.ingreso) },
        { titulo: "Total", numero: true, render: (f) => html`<strong>${num(f.total)}</strong>` },
        { titulo: "Nota", render: (f) => (f.nota ? html`<span class="nota-icono" title=${f.nota}>✎</span>` : "") },
      ]}
      vacia="Ningún renglón coincide con el filtro."
    />
  `;
}
