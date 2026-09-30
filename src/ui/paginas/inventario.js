import { useMemo, useState } from "preact/hooks";
import { filasInventario } from "../../servicios/consultas.js";
import { Buscador, Tabla, num, useFiltroTexto, useSesion, Lista } from "../componentes.js";
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
      <${Lista}
        clase="lista-filtro"
        valor=${hoja}
        alCambiar=${setHoja}
        ariaLabel="Contenedor"
        opciones=${[{ valor: "", etiqueta: "Todos los contenedores" }, ...hojas.map((h) => ({ valor: h, etiqueta: h }))]}
      />
      <${Lista}
        clase="lista-filtro"
        valor=${vista}
        alCambiar=${setVista}
        ariaLabel="Vista"
        opciones=${[
          { valor: "todos", etiqueta: "Todos los renglones" },
          { valor: "movimiento", etiqueta: "Con consumo o ingreso" },
          { valor: "agotado", etiqueta: "Existencia 0 o negativa" },
          { valor: "notas", etiqueta: "Con nota" },
        ]}
      />
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
