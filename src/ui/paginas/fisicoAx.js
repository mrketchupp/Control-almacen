import { useMemo, useState } from "preact/hooks";
import { aNumero, sumar } from "../../nucleo/decimal.js";
import { ErrorConciliacion, dimensionAx, etiquetaEstado, textoVariante } from "../../servicios/conciliacion.js";
import { candidatosFisicos, deshacerVinculoFisico, previaVinculoFisico, quitarVinculosFisicos, vincularFisico } from "../../servicios/vinculosAx.js";
import { lugarCorto } from "../../servicios/inventario.js";
import { Boton, Buscador, Pastilla, Tabla, Ventana, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

const n = (d) => num(aNumero(d));

/** Selección y revisión del físico que corresponde a una fila de AX. */
export function ElegirFisicoAx({ r, corte, fila, alCerrar }) {
  const sesion = useSesion();
  const lineas = fila.lineas ?? [fila.linea];
  const lineaIds = lineas.map((l) => l.id);
  const opciones = candidatosFisicos(r, lineaIds);
  const [seleccion, setSeleccion] = useState(() => new Set((fila.variante_ids ?? []).filter((id) =>
    opciones.some((f) => f.variante.id === id && !f.ocupada && f.compatible))));
  const [texto, setTexto] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState("");
  const elegidas = opciones.filter((f) => seleccion.has(f.variante.id));
  const total = sumar(...elegidas.map((f) => f.total));
  const previa = useMemo(() => previaVinculoFisico(sesion.estado,
    { corteId: corte.id, lineaIds, varianteIds: [...seleccion] }), [sesion.estado, corte, [...seleccion].join(",")]);
  const manual = (corte.vinculos_fisicos ?? []).some((v) => lineaIds.includes(v.linea_ax_id));
  const visibles = useFiltroTexto(opciones.map((f) => ({ ...f, id: f.variante.id,
    _buscar: `${textoVariante(f.variante)} ${f.renglones.map((p) => lugarCorto(p.ubicacion)).join(" ")}`,
  })), texto, ["_buscar"]);
  const marcar = (id, incluido) => {
    setSeleccion((antes) => { const s = new Set(antes); if (incluido) s.add(id); else s.delete(id); return s; });
    setError("");
  };
  const guardar = (automatico = false) => sesion.tarea("Actualizando conciliación…", async () => {
    try {
      const cambio = await sesion.almacen.modificar((e) => automatico
        ? quitarVinculosFisicos(e, { corteId: corte.id, lineaIds }, sesion.usuario)
        : vincularFisico(e, { corteId: corte.id, lineaIds, varianteIds: [...seleccion] }, sesion.usuario));
      alCerrar();
      sesion.avisar("exito", automatico ? "Se restableció el emparejamiento automático." : `${fila.codigo}: inventario vinculado; se recalculó la conciliación.`, 10000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => deshacerVinculoFisico(e, { corteId: corte.id, cambio }, sesion.usuario)),
      });
    } catch (e) {
      if (e instanceof ErrorConciliacion) setError(e.message);
      else throw e;
    }
  });
  const columnas = [
    { titulo: "Dimensión / NP", render: (f) => textoVariante(f.variante) },
    { titulo: "UM", render: (f) => f.variante.um || "—" },
    { titulo: "Físico", numero: true, render: (f) => n(f.total) },
    { titulo: "Partidas", render: (f) => f.renglones.map((p) => html`<span class="lugares"><${Pastilla} tono="lugar">${lugarCorto(p.ubicacion)}: ${n(p.total)}<//></span>`) },
  ];
  return html`<${Ventana} titulo=${revisando ? "Revisar vínculo del inventario" : "Elegir partidas del inventario"} clase="ventana-concilia" alCerrar=${alCerrar}>
    <p><strong>${fila.codigo} ${fila.descripcion}</strong> · AX: ${[...new Set(lineas.map((l) => dimensionAx(l) || "SIN DIMENSIÓN"))].join(" / ")}</p>
    <p class="nota">Elige todas las partidas físicas de este material que AX reúne. Cada opción suma las partidas de la misma dimensión y NP en sus contenedores. El vínculo se guarda para este corte; las cantidades, las claves y los vales conservan sus datos.</p>
    ${revisando
      ? html`<${Tabla} filas=${elegidas} claveFila=${(f) => f.variante.id} columnas=${columnas} vacia="Sin partidas del inventario: se comparará AX contra físico 0." />`
      : html`<${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Dimensión, NP, contenedor…" />
        <${Tabla} filas=${visibles} columnas=${[
          { titulo: "Incluir", render: (f) => html`<input type="checkbox" checked=${seleccion.has(f.variante.id)}
            disabled=${sesion.ocupado || ((!f.compatible || Boolean(f.ocupada)) && !seleccion.has(f.variante.id))}
            aria-label=${`Incluir ${textoVariante(f.variante)}`} onChange=${(e) => marcar(f.variante.id, e.currentTarget.checked)} />` },
          ...columnas,
          { titulo: "Disponibilidad", render: (f) => f.ocupada
            ? html`<span class="nota">Ya corresponde a AX ${dimensionAx(f.ocupada) || "SIN DIMENSIÓN"}</span>`
            : !f.compatible ? html`<span class="alerta">Unidad de medida distinta</span>`
            : html`<span class="nota">${seleccion.has(f.variante.id) ? "Seleccionada" : "Disponible"}</span>` },
        ]} vacia="No hay partidas de este código con esa búsqueda." />`}
    <div class="acciones-linea">
      <span>AX: <strong>${n(fila.ax)}</strong></span>
      <span>Físico actual: <strong>${fila.fisico === null ? "—" : n(fila.fisico)}</strong></span>
      <span>Físico seleccionado: <strong>${n(total)}</strong></span>
      <span>Diferencia física: <strong>${n(total.minus(fila.ax))}</strong></span>
    </div>
    <p aria-live="polite">Resultado con esta selección: <strong>${!previa ? "Por confirmar"
      : previa.estado === "faltante" ? `Faltan ${n(previa.sin_explicar.abs())}`
      : previa.estado === "sobrante" ? `Sobran ${n(previa.sin_explicar)}` : etiquetaEstado(previa.estado)}</strong>
      ${previa?.folios.length ? html` · Vales en tránsito: ${previa.folios.join(", ")}` : null}</p>
    ${revisando ? html`<p>Confirma que estas ${elegidas.length} opciones corresponden al material de AX. La conciliación sumará su existencia y los vales en tránsito que les correspondan.</p>` : null}
    ${error ? html`<p class="alerta" role="alert">${error}</p>` : null}
    <div class="acciones-linea">
      ${revisando
        ? html`<${Boton} tipo="primario" disabled=${sesion.ocupado} onClick=${() => guardar()}>Confirmar vínculo<//>
          <${Boton} disabled=${sesion.ocupado} onClick=${() => setRevisando(false)}>Cambiar selección<//>`
        : html`<${Boton} tipo="primario" disabled=${sesion.ocupado} onClick=${() => setRevisando(true)}>Revisar vínculo<//>
          ${manual ? html`<${Boton} disabled=${sesion.ocupado} onClick=${() => guardar(true)}>Usar emparejamiento automático<//>` : null}`}
      <${Boton} tipo="texto" disabled=${sesion.ocupado} onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}
