import { useMemo, useState } from "preact/hooks";
import { filasHistorial, filtrarHistorial } from "../../servicios/consultas.js";
import { filasEntradas, filtrarEntradas } from "../../servicios/entradas.js";
import { estadoAxDeVales, etiquetaAx, sinAplicar } from "../../servicios/seguimiento.js";
import { duplicadasEnVales } from "../../servicios/vales.js";
import { Boton, Buscador, CampoSugerido, Lista, Pastilla, Tabla, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { PastillaAx } from "./base.js";
import { EstadoEtiquetas } from "./etiquetas.js";
import { entradasEnLista, impresionesPorVale, marcaDe } from "../../servicios/etiquetas.js";

const SIN_FILTROS = { texto: "", codigo: "", depto: "", recibio: "", estado: "", desde: "", hasta: "", revisar: "" };

// Filtro "Revisar": partidas duplicadas en su vale y el estado en AX según el archivo de la base.
const REVISAR = {
  duplicadas: { etiqueta: "Duplicadas en el vale", pasa: (f) => f.duplicada },
  pend_ax: { etiqueta: "Sin IN / TR (aún no en AX)", pasa: (f) => sinAplicar(f.ax), base: true },
  en_ax: { etiqueta: "Ya en AX (IN / TR)", pasa: (f) => f.ax && (f.ax.estado === "aplicada" || f.ax.estado === "parcial"), base: true },
  no_inv: { etiqueta: "No se descuentan (NO INV…)", pasa: (f) => f.ax?.estado === "no_inv", base: true },
  avisos: { etiqueta: "Con aviso de la base", pasa: (f) => f.ax?.avisos?.length > 0, base: true },
};

const SIN_FILTROS_ENTRADAS = { texto: "", folio: "", codigo: "", oc: "", desde: "", hasta: "", etiquetas: "" };

// Ronda 20: cuáles entradas ya tienen sus etiquetas impresas.
const FILTRO_ETIQUETAS = [
  { valor: "", etiqueta: "Todas" },
  { valor: "faltan", etiqueta: "Sin imprimir" },
  { valor: "impresas", etiqueta: "Impresas" },
];

function HistorialEntradas() {
  const sesion = useSesion();
  const filas = useMemo(() => filasEntradas(sesion.estado), [sesion.estado]);
  const [filtros, setFiltros] = useState(SIN_FILTROS_ENTRADAS);
  const poner = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.currentTarget.value });
  const impresas = useMemo(() => impresionesPorVale(sesion.estado), [sesion.estado.impresiones_etiquetas]);
  const enLista = useMemo(() => entradasEnLista(sesion.estado), [sesion.estado.etiquetas]);
  const valesPorId = useMemo(() => new Map(sesion.estado.vales.filter((v) => v.tipo === "ENTRADA").map((v) => [v.id, v])), [sesion.estado.vales]);
  const visibles = useMemo(() => {
    const pasan = filtrarEntradas(filas, filtros);
    if (!filtros.etiquetas) return pasan;
    return pasan.filter((f) => (filtros.etiquetas === "impresas") === Boolean(marcaDe(impresas, valesPorId.get(f.vale_id))));
  }, [filas, filtros, impresas]);
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
      <div class="filtro">
        <span>Etiquetas</span>
        <${Lista} valor=${filtros.etiquetas} alCambiar=${(etiquetas) => setFiltros({ ...filtros, etiquetas })} ariaLabel="Etiquetas" opciones=${FILTRO_ETIQUETAS} />
      </div>
      ${activos ? html`<${Boton} tipo="texto" onClick=${() => setFiltros(SIN_FILTROS_ENTRADAS)}>Quitar filtros (${activos})<//>` : null}
    </div>
    <p class="conteo">${num(visibles.length)} partidas · ${num(folios)} entradas${activos ? " con los filtros elegidos" : ""}</p>
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
        { titulo: "Etiquetas", render: (f) => html`<${EstadoEtiquetas} estado=${sesion.estado} vale=${valesPorId.get(f.vale_id)} corto=${true} impresas=${impresas} enLista=${enLista} />` },
      ]}
      vacia=${filas.length ? "Ninguna partida coincide con los filtros." : "Aún no hay entradas. Se registran en Vales de entrada."}
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
  const ax = useMemo(() => estadoAxDeVales(sesion.estado), [sesion.estado]);
  const filas = useMemo(() => {
    const duplicadas = duplicadasEnVales(sesion.estado);
    return filasHistorial(sesion.estado).map((f) => {
      const info = ax?.porLinea.get(f.id) ?? null;
      return { ...f, ax: info, ax_texto: info ? etiquetaAx(info) : "", duplicada: duplicadas.get(f.id) ?? null };
    });
  }, [sesion.estado, ax]);
  const [filtros, setFiltros] = useState(SIN_FILTROS);
  const poner = (clave) => (e) => setFiltros({ ...filtros, [clave]: e.currentTarget.value });
  const fijar = (clave) => (valor) => setFiltros({ ...filtros, [clave]: valor });
  const deptos = useMemo(() => [...new Set(filas.map((f) => f.depto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [filas]);
  const personas = useMemo(() => [...new Set(filas.map((f) => f.recibio).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [filas]);
  const visibles = useMemo(
    () =>
      filtrarHistorial(filas, filtros)
        .filter((f) => !filtros.revisar || REVISAR[filtros.revisar].pasa(f))
        .map((f) => (f.estado === "CANCELADO" ? { ...f, _clase: "fila-cancelada" } : f.duplicada ? { ...f, _clase: "fila-duplicada" } : f)),
    [filas, filtros],
  );
  const opcionesRevisar = Object.entries(REVISAR)
    .filter(([, r]) => !r.base || ax)
    .map(([valor, r]) => ({ valor, etiqueta: r.etiqueta, detalle: `${filas.filter(r.pasa).length}` }));
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
      <div class="filtro">
        <span>Revisar</span>
        <${Lista} valor=${filtros.revisar} alCambiar=${fijar("revisar")} ariaLabel="Revisar" opciones=${[{ valor: "", etiqueta: "Todas" }, ...opcionesRevisar]} />
      </div>
      ${activos ? html`<${Boton} tipo="texto" onClick=${() => setFiltros(SIN_FILTROS)}>Quitar filtros (${activos})<//>` : null}
    </div>
    <p class="conteo">
      ${num(visibles.length)} partidas · ${num(folios)} folios${activos ? " con los filtros elegidos" : ""}
      ${filtros.revisar === "duplicadas" && visibles.length ? html` · <span class="nota">abre cada vale y usa <em>Quitar duplicadas</em> para corregirlo (queda en la bitácora)</span>` : null}
    </p>
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
        ...(ax ? [{ titulo: "AX", render: (f) => (f.estado === "CANCELADO" ? "" : html`<${PastillaAx} info=${f.ax} />`) }] : []),
        {
          titulo: "Notas",
          render: (f) => html`${f.duplicada ? html`<${Pastilla} tono="alerta" titulo=${`Mismo código, clave y cantidad que la partida ${f.duplicada} del vale`}>duplicada<//> ` : ""}${f.notas ? html`<span class="nota-icono" title=${f.notas}>ⓘ</span>` : ""}`,
        },
      ]}
      vacia="Ninguna partida coincide con los filtros."
    />
  `;
}
