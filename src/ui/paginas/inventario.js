import { useMemo, useState } from "preact/hooks";
import { hoyIso } from "../../nucleo/fechas.js";
import { filasInventario } from "../../servicios/consultas.js";
import { lugarCorto, renglonDe, ubicacionesOrdenadas } from "../../servicios/inventario.js";
import { ErrorReacomodo, historialReacomodos, reacomodar } from "../../servicios/reacomodos.js";
import { Boton, Buscador, Detalles, Lista, Pastilla, Tabla, Tarjeta, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

/** Mover material de un renglón a otro contenedor sin cambiar el total (RF-42). */
function MoverRenglon({ fila, alTerminar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const existencia = estado.existencias.find((e) => e.id === fila.id);
  const [cantidad, setCantidad] = useState(String(Math.max(0, fila.total)));
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [error, setError] = useState(null);
  const opciones = ubicacionesOrdenadas(estado)
    .filter((u) => u.id !== fila.ubicacion_id)
    .map((u) => ({ valor: String(u.id), etiqueta: u.hoja_excel.trim(), detalle: renglonDe(estado, existencia.variante_id, u.id) ? "ya tiene su renglón" : "renglón nuevo" }));
  const mover = () =>
    sesion.tarea("Moviendo…", async () => {
      try {
        const r = await sesion.almacen.modificar((e) => reacomodar(e, { desdeId: fila.id, ubicacionId: Number(destino), cantidad, motivo, usuario: sesion.usuario, fecha }));
        sesion.avisar("exito", `Se movieron ${r.cantidad} ${r.um} a ${r.hacia_hoja}.`);
        alTerminar();
      } catch (e) {
        if (e instanceof ErrorReacomodo) setError(e.message);
        else throw e;
      }
    });
  return html`<${Tarjeta} titulo="Mover a otro contenedor" clase="tarjeta-correccion">
    <p>
      <strong>${fila.codigo}</strong> ${fila.descripcion} · ${[fila.dimension, fila.np && `NP ${fila.np}`].filter(Boolean).join(" · ") || "S/D"}
      <${Pastilla} tono="lugar" titulo=${fila.hoja}>${lugarCorto({ contenedor: fila.contenedor, clase: fila.clase === "Inventariable" ? "INV" : "CONS" })}<//>
      <${Pastilla} tono=${fila.total > 0 ? "ok" : "alerta"}>hay ${num(fila.total)} ${fila.um}<//>
    </p>
    <div class="acciones-linea">
      <label class="filtro"><span>Cantidad a mover</span><input class="entrada-cantidad" inputmode="decimal" value=${cantidad} onInput=${(e) => setCantidad(e.currentTarget.value.replace(",", "."))} /></label>
      <div class="filtro">
        <span>A qué contenedor</span>
        <${Lista} valor=${destino} alCambiar=${setDestino} ariaLabel="Contenedor de destino" placeholder="— Elige —" opciones=${opciones} />
      </div>
      <label class="filtro"><span>Fecha</span><input type="date" value=${fecha} onChange=${(e) => setFecha(e.currentTarget.value)} /></label>
      <label class="filtro filtro-ancho"><span>Motivo (opcional)</span><input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. se reacomodó el contenedor 2" /></label>
    </div>
    <p class="nota">
      El total no cambia: los dos renglones quedan como recién contados (CANTIDAD = lo que queda en cada uno). Si el material no tiene
      renglón en ese contenedor, se agrega al final de su hoja.
    </p>
    ${error ? html`<p class="alerta">${error}</p>` : null}
    <div class="acciones-linea">
      <${Boton} onClick=${alTerminar}>Cancelar<//>
      <${Boton} tipo="primario" disabled=${!destino} onClick=${mover}>Mover<//>
    </div>
  <//>`;
}

function Reacomodos() {
  const sesion = useSesion();
  const filas = useMemo(() => historialReacomodos(sesion.estado), [sesion.estado.reacomodos]);
  if (!filas.length) return null;
  return html`<${Detalles} resumen=${`Movimientos entre contenedores (${filas.length})`}>
    <${Tabla}
      limite=${50}
      filas=${filas}
      columnas=${[
        { clave: "fecha_texto", titulo: "Fecha" },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { clave: "clave", titulo: "Clave" },
        { titulo: "Cantidad", numero: true, render: (r) => `${num(r.cantidad_numero)} ${r.um}` },
        { titulo: "De → a", render: (r) => html`<span class="sin-corte">${r.desde_hoja} → ${r.hacia_hoja}</span>${r.renglon_nuevo ? html` <${Pastilla} tono="info">renglón nuevo<//>` : null}` },
        { titulo: "Quién / motivo", render: (r) => [r.usuario, r.motivo].filter(Boolean).join(" · ") },
      ]}
    />
  <//>`;
}

export function PaginaInventario() {
  const sesion = useSesion();
  const filas = useMemo(() => filasInventario(sesion.estado), [sesion.estado]);
  const [texto, setTexto] = useState("");
  const [hoja, setHoja] = useState("");
  const [vista, setVista] = useState("todos");
  const [moviendo, setMoviendo] = useState(null);
  const hojas = useMemo(() => [...new Set(filas.map((f) => f.hoja))], [filas]);
  const porTexto = useFiltroTexto(filas, texto, ["codigo", "descripcion", "dimension", "np", "nota"]);
  const visibles = porTexto.filter((f) => {
    if (hoja && f.hoja !== hoja) return false;
    if (vista === "movimiento") return f.consumo || f.ingreso;
    if (vista === "agotado") return f.total <= 0;
    if (vista === "notas") return Boolean(f.nota);
    if (vista === "nuevos") return Boolean(f.origen);
    return true;
  });
  const fila = moviendo ? filas.find((f) => f.id === moviendo) : null;
  return html`
    ${fila ? html`<${MoverRenglon} key=${fila.id} fila=${fila} alTerminar=${() => setMoviendo(null)} />` : null}
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
          { valor: "nuevos", etiqueta: "Agregados en la herramienta" },
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
        {
          titulo: "Nota",
          render: (f) => html`${f.nota ? html`<span class="nota-icono" title=${f.nota}>✎</span>` : ""}${f.origen ? html`<span class="nota-icono" title=${`Agregado por ${f.origen.toLowerCase()}`}>✚</span>` : ""}`,
        },
        {
          titulo: "",
          render: (f) => html`<button type="button" class="boton boton-texto boton-mover" title="Mover a otro contenedor" onClick=${() => {
            setMoviendo(f.id);
            window.scrollTo(0, 0);
          }}>Mover</button>`,
        },
      ]}
      vacia="Ningún renglón coincide con el filtro."
    />
    <${Reacomodos} />
  `;
}
