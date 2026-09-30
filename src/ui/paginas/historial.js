import { useMemo, useState } from "preact/hooks";
import { filasHistorial } from "../../servicios/consultas.js";
import { Buscador, Tabla, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

export function PaginaHistorial() {
  const sesion = useSesion();
  const filas = useMemo(() => filasHistorial(sesion.estado), [sesion.estado]);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const porTexto = useFiltroTexto(filas, texto, ["folio", "descripcion", "codigo", "clave", "destino", "depto", "recibio", "oc", "notas"]);
  const visibles = porTexto.filter((f) => (!desde || f.fecha_iso >= desde) && (!hasta || f.fecha_iso <= hasta));
  const folios = new Set(visibles.map((f) => f.folio)).size;
  return html`
    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Folio, código, descripción, persona, área…" />
      <label class="en-linea">Desde <input type="date" value=${desde} onChange=${(e) => setDesde(e.currentTarget.value)} /></label>
      <label class="en-linea">Hasta <input type="date" value=${hasta} onChange=${(e) => setHasta(e.currentTarget.value)} /></label>
      <span class="conteo">${num(visibles.length)} renglones · ${num(folios)} folios</span>
    </div>
    <${Tabla}
      limite=${200}
      filas=${visibles}
      columnas=${[
        { clave: "folio", titulo: "Folio", numero: true },
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
      vacia="Ningún renglón coincide con el filtro."
    />
  `;
}
