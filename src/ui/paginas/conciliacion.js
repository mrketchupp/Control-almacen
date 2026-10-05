import { useMemo, useState } from "preact/hooks";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { sha256 } from "../../almacen/almacen.js";
import { aNumero } from "../../nucleo/decimal.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { ErrorReporteAx, delAlmacen, leerReporteAx } from "../../importadores/ax.js";
import {
  ErrorConciliacion,
  PUNTAJE_SEGURO,
  conciliar,
  confirmarPareja,
  confirmarSeguras,
  corteAx,
  corteConHuella,
  etiquetaEstado,
  fijarFolioCorte,
  lineasInv,
  olvidarPareja,
  quitarCorteAx,
  registrarCorteAx,
  dimensionAx,
  valoresAx,
} from "../../servicios/conciliacion.js";
import { corregirDimensionNp } from "../../servicios/inventario.js";
import { COLORES_ESTADO, filasSolicitud, valesPorAplicar } from "../../exportadores/ajuste.js";
import { sugerencias as sugerenciasDeVales } from "../../servicios/justificacion.js";
import { Bento, Boton, Buscador, ElegirArchivo, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { ImportarBase, MosaicoBase, VentanaBase } from "./base.js";
import { EditorClave, escrituraClave, useCorreccion } from "./clave.js";
import { VentanaJustificar } from "./justificar.js";
import { exportarConDialogo } from "./sharepoint.js";

const n = (d) => (d === null || d === undefined ? "—" : num(aNumero(d)));
const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const dinero = (d) => (d === null || d === undefined ? "—" : pesos.format(aNumero(d)));
const conSigno = (d) => (d && d.gt(0) ? `+${n(d)}` : n(d));
const describir = (v) => (v ? `${v.dimension || "SIN DIMENSIÓN"}${v.np ? ` · NP ${v.np}` : ""}` : "—");
// En AX la dimensión es Tamaño + Color.
const describirAx = (l) => dimensionAx(l) || "—";
const TONOS = { cuadra: "ok", explicada: "info", sobrante: "alerta", faltante: "error", por_confirmar: "info" };

/** Pastilla del resultado: Cuadra / Explicada por vales / Sobran N / Faltan N. */
function Resultado({ r }) {
  if (!r) return html`<${Pastilla}>—<//>`;
  const texto = r.estado === "sobrante" ? `Sobran ${n(r.sin_explicar)}` : r.estado === "faltante" ? `Faltan ${n(r.sin_explicar.abs())}` : etiquetaEstado(r.estado);
  return html`<${Pastilla} tono=${TONOS[r.estado]} titulo=${r.folios.length ? `Vales en tránsito: ${r.folios.join(", ")}` : ""}>${texto}<//>`;
}

/** Salidas y entradas en tránsito con sus folios. */
function Transito({ r }) {
  if (!r.folios.length) return html`<span class="nota">—</span>`;
  return html`<span class="transito">
    ${r.salidas.gt(0) ? html`<span title="Salidas después del corte">−${n(r.salidas)}</span>` : null}
    ${r.entradas.gt(0) ? html`<span title="Entradas después del corte">+${n(r.entradas)}</span>` : null}
    <small>${r.folios.join(", ")}</small>
  </span>`;
}

/**
 * Elegir otra pareja para una partida de AX: solo variantes del mismo código que aún no son pareja de
 * otra partida de AX (las sugeridas para otra se marcan), o "no está en físico".
 */
function ElegirPareja({ par, r, alElegir, etiqueta = "Otra…" }) {
  const ocupadas = new Set(r.pares.filter((q) => q.confirmado && q.variante_id !== null).map((q) => q.variante_id));
  const sugeridaPara = new Map(r.pares.filter((q) => !q.confirmado && q.variante_id !== null && q !== par).map((q) => [q.variante_id, q.linea]));
  const candidatos = [...r.fisico.values()]
    .filter((x) => x.variante.codigo === par.linea.codigo && !ocupadas.has(x.variante.id))
    .map((x) => ({ x, puntaje: par.candidatos.find((c) => c.variante_id === x.variante.id)?.puntaje ?? null }))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
  const opciones = [
    ...candidatos.map(({ x, puntaje }) => {
      const otra = sugeridaPara.get(x.variante.id);
      return {
        valor: x.variante.id,
        etiqueta: describir(x.variante),
        render: () => html`<span class="opcion-principal">${describir(x.variante)}</span>
          <${Pastilla}>${x.variante.um || "—"}<//>
          <${Pastilla} tono=${x.total.gt(0) ? "ok" : "alerta"}>hay ${n(x.total)}<//>
          ${puntaje !== null ? html`<${Pastilla} tono="info">${Math.round(puntaje * 100)}%<//>` : null}
          ${otra ? html`<span class="res-detalle">Sugerida para ${otra.codigo} ${describirAx(otra)}</span>` : null}`,
      };
    }),
    { valor: "no", etiqueta: "No está en el físico", render: () => html`<span class="opcion-principal">No está en el físico</span><span class="res-detalle">Solo para este corte</span>` },
  ];
  return html`<${Lista}
    clase="lista-pareja"
    valor=""
    opciones=${opciones}
    placeholder=${etiqueta}
    ariaLabel=${`Elegir la pareja de ${par.linea.codigo} ${describirAx(par.linea)}`}
    alCambiar=${(valor) => alElegir(valor === "no" ? null : Number(valor))}
  />`;
}

// ---------------------------------------------------------------- importar

function VentanaImportar({ previa, alCerrar, alImportar }) {
  const sesion = useSesion();
  const [almacen, setAlmacen] = useState(previa.almacen);
  const [fecha, setFecha] = useState(previa.reporte.fechaSugerida ?? hoyIso());
  const [folio, setFolio] = useState("");
  const renglones = delAlmacen(previa.reporte.renglones, almacen);
  const inv = lineasInv({ lineas: renglones }).length;
  const repetido = corteConHuella(sesion.estado, previa.huella);
  return html`<${Ventana} titulo="Importar reporte de AX" alCerrar=${alCerrar}>
    <p><strong>${previa.nombre}</strong> · hoja <code>${previa.reporte.hoja}</code></p>
    <div class="campos-importar">
      <label class="campo">
        <span>Almacén</span>
        ${previa.reporte.almacenes.length > 1
          ? html`<${Lista}
              valor=${almacen}
              alCambiar=${setAlmacen}
              ariaLabel="Almacén"
              opciones=${previa.reporte.almacenes.map((a) => ({ valor: a.nombre, etiqueta: a.nombre || "(sin almacén)", detalle: `${a.renglones} partidas` }))}
            />`
          : html`<input value=${almacen} disabled />`}
      </label>
      <label class="campo">
        <span>Fecha del corte (AX al…)</span>
        <input type="date" value=${fecha} max=${hoyIso()} onChange=${(e) => setFecha(e.currentTarget.value)} />
        <small class="ayuda">${previa.reporte.fechaSugerida ? "Tomada del nombre del archivo: confírmala." : "No viene en el nombre: escríbela."}</small>
      </label>
      <label class="campo">
        <span>La base ya capturó hasta el folio (opcional)</span>
        <input inputmode="numeric" value=${folio} onInput=${(e) => setFolio(e.currentTarget.value)} placeholder="Ej. 545" />
        <small class="ayuda">Si lo sabes, los vales de salida en tránsito son los posteriores a ese folio; si no, los posteriores a la fecha.</small>
      </label>
    </div>
    <p>
      <strong>${inv}</strong> partidas con modelo INV de ${almacen || "este almacén"}
      ${renglones.length > inv ? html` · <span class="nota">${renglones.length - inv} de otros modelos no se concilian</span>` : null}
      ${previa.reporte.renglones.length > renglones.length ? html` · <span class="nota">${previa.reporte.renglones.length - renglones.length} de otros almacenes se ignoran</span>` : null}
    </p>
    ${repetido ? html`<p class="alerta">Este mismo archivo ya se importó como el corte del ${fmtFecha(repetido.fecha)}.</p>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!inv || !fecha} onClick=${() => alImportar({ almacen, fecha, folio, renglones })}>Importar corte<//>
      <${Boton} tipo="texto" onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- vistas

const VISTAS = { renglon: "Por partida de AX", articulo: "Por artículo", contenedor: "Por contenedor", valuada: "Valuada en $" };
const FILTROS = {
  todos: "Todos",
  diferencias: "Con diferencia",
  sin_explicar: "Sin explicar",
  sobrante: "Sobrantes",
  faltante: "Faltantes",
  explicada: "Explicadas",
  cuadra: "Cuadran",
  por_confirmar: "Por confirmar",
};
const pasa = (filtro) => (r) =>
  !r
    ? filtro === "todos"
    : filtro === "todos"
      ? true
      : filtro === "diferencias"
        ? r.estado !== "cuadra" && r.estado !== "por_confirmar"
        : filtro === "sin_explicar"
          ? r.estado === "sobrante" || r.estado === "faltante"
          : filtro === "por_confirmar"
            ? r.estado === "por_confirmar" || r.por_confirmar > 0
            : r.estado === filtro;

/** Texto en el que busca el buscador de cada ventana (también el nombre y el código con ceros de AX). */
const buscable = (x) => {
  const lineas = x.lineas ?? (x.linea ? [x.linea] : []);
  return {
    ...x,
    _buscar: [x.codigo, x.descripcion, x.variante ? describir(x.variante) : "", ...lineas.flatMap((l) => [describirAx(l), l.nombre, l.codigo_texto]), x.dimension, x.np]
      .filter(Boolean)
      .join(" "),
  };
};

/** Lo que dice el físico de una fila de la vista general. */
function EnFisico({ x }) {
  const lugares = x.lugares?.length ? html`<span class="lugares">${x.lugares.map((l) => html`<${Pastilla} tono="lugar" titulo=${l.hoja}>${l.lugar}: ${n(l.total)}<//>`)}</span>` : null;
  if (x.estado === "por_confirmar") {
    return x.variante
      ? html`<span title="Sugerida: confírmala en Por confirmar">¿${describir(x.variante)}?</span>${lugares}`
      : html`<span class="nota">sin sugerencia</span>`;
  }
  if (!x.variante) return html`<span class="nota">no está en el físico</span>`;
  return html`<span>${describir(x.variante)}</span>${lugares}`;
}

/** Vista general: todo el reporte de AX (y lo que solo está en el físico) con su resultado. */
function VistaRenglon({ r, filtro, texto, conFisico, alConfirmar }) {
  const filas = useFiltroTexto(
    r.general.filter((x) => (conFisico || x.linea || x.lineas) && pasa(filtro)(x)).map(buscable),
    texto,
    ["_buscar"],
  );
  // Con la casilla apagada, avisa si la búsqueda encuentra algo que solo está en el físico.
  const ocultas = useFiltroTexto(
    conFisico || !texto.trim() ? [] : r.general.filter((x) => !x.linea && !x.lineas && pasa(filtro)(x)).map(buscable),
    texto,
    ["_buscar"],
  );
  return html`${filtro === "todos"
      ? html`<p class="nota conteo-vista">
          ${`Todo el reporte de AX: ${r.resumen.lineas_ax} partidas INV (${r.resumen.emparejados} emparejadas, ${r.porConfirmar.length} por confirmar, ${r.axSinFisico.length} sin físico)${conFisico ? ` y ${r.fisicoSinAx.length} que solo están en el físico` : ""}.`}
        </p>`
      : null}
    <${Tabla}
      limite=${500}
      filas=${filas.map((x) => ({ ...x, id: x.linea ? `l${x.linea.id}` : `v${x.variante_id}` }))}
      vacia=${texto.trim() ? "Nada con esa búsqueda en este filtro. Prueba con «Todos»." : "Nada con este filtro."}
      columnas=${[
        { titulo: "Código", numero: true, render: (x) => x.codigo },
        { titulo: "Descripción", render: (x) => html`<span class="descripcion-corta" title=${x.descripcion}>${x.descripcion}</span>` },
        {
          titulo: "En AX",
          render: (x) =>
            x.lineas?.length
              ? html`${x.lineas.map((l) => html`<code class="dim-ax">${describirAx(l)}</code>`)}`
              : x.linea
                ? html`<code class="dim-ax">${describirAx(x.linea)}</code>`
                : html`<span class="nota">no está en AX</span>`,
        },
        { titulo: "En físico", render: (x) => html`<${EnFisico} x=${x} />` },
        { titulo: "AX", numero: true, render: (x) => n(x.ax) },
        { titulo: "Físico", numero: true, render: (x) => n(x.fisico) },
        { titulo: "Tránsito", render: (x) => html`<${Transito} r=${x} />` },
        { titulo: "Dif.", numero: true, render: (x) => conSigno(x.diferencia) },
        {
          titulo: "Resultado",
          render: (x) =>
            x.estado === "por_confirmar"
              ? html`<span class="resultado-confirmar">
                  <${Pastilla} tono="info">Por confirmar<//>
                  <button type="button" class="enlace-boton" onClick=${() => alConfirmar(x)}>Confirmar…</button>
                </span>`
              : html`<${Resultado} r=${x} />`,
        },
      ]}
    />
    ${ocultas.length
      ? html`<p class="nota">${ocultas.length === 1 ? "1 más" : `${ocultas.length} más`} con esa búsqueda que solo están en el físico: marca «Incluir lo que solo está en el físico».</p>`
      : null}`;
}

function VistaArticulo({ r, filtro, texto }) {
  const filas = useFiltroTexto(r.porCodigo.filter(pasa(filtro)).map(buscable), texto, ["_buscar"]);
  return html`<${Tabla}
    limite=${200}
    filas=${filas.map((x) => ({ ...x, id: x.codigo }))}
    vacia="Nada con este filtro."
    columnas=${[
      { titulo: "Código", numero: true, render: (x) => x.codigo },
      { titulo: "Descripción", render: (x) => x.descripcion },
      { titulo: "Partidas AX / físico", render: (x) => `${x.renglones_ax} / ${x.variantes}` },
      { titulo: "AX", numero: true, render: (x) => n(x.ax) },
      { titulo: "Físico", numero: true, render: (x) => n(x.fisico) },
      { titulo: "Tránsito", render: (x) => html`<${Transito} r=${x} />` },
      { titulo: "Dif.", numero: true, render: (x) => conSigno(x.diferencia) },
      {
        titulo: "Resultado",
        render: (x) => html`<${Resultado} r=${x} />
          ${x.por_ubicar.length ? html`<${Pastilla} tono="alerta" titulo="Partidas en tránsito sin partida del inventario (Pendientes)">por ubicar: ${x.por_ubicar.join(", ")}<//>` : null}
          ${x.no_inv.length ? html`<${Pastilla} titulo="La base las marcó NO INV / CONPROV: no se descuentan en AX ni justifican la diferencia">NO INV en la base: ${x.no_inv.join(", ")}<//>` : null}
          ${x.por_confirmar ? html`<${Pastilla} tono="info" titulo="Partidas de AX de este código que falta confirmar">${x.por_confirmar} por confirmar<//>` : null}`,
      },
    ]}
  />`;
}

function VistaContenedor({ r, filtro, texto }) {
  const contenedores = r.porContenedor
    .map((c) => ({ ...c, renglones: c.renglones.filter((x) => (filtro === "por_confirmar" ? x.por_confirmar : pasa(filtro)(x.resultado))) }))
    .filter((c) => c.renglones.length);
  const palabras = texto.trim();
  if (!contenedores.length) return html`<p class="nota">Nada con este filtro.</p>`;
  return html`<div class="vista-contenedores">
    ${contenedores.map((c) => html`<${Contenedor} key=${c.hoja} c=${c} texto=${palabras} />`)}
  </div>`;
}

function Contenedor({ c, texto }) {
  const filas = useFiltroTexto(c.renglones.map(buscable), texto, ["_buscar"]);
  if (!filas.length) return null;
  return html`<details class="contenedor-concilia" open>
    <summary><strong>${c.hoja}</strong> <span class="nota">${filas.length} ${filas.length === 1 ? "partida" : "partidas"}</span></summary>
    <${Tabla}
      limite=${300}
      filas=${filas.map((x) => ({ ...x, id: x.existencia_id }))}
      columnas=${[
        { titulo: "Código", numero: true, render: (x) => x.codigo },
        { titulo: "Descripción", render: (x) => html`<span class="descripcion-corta" title=${x.descripcion}>${x.descripcion}</span>` },
        { titulo: "Dimensión", render: (x) => x.dimension || "—" },
        { titulo: "NP", render: (x) => x.np || "—" },
        { titulo: "Aquí", numero: true, render: (x) => `${n(x.aqui)} ${x.um}` },
        { titulo: "Total físico", numero: true, render: (x) => (x.resultado ? n(x.resultado.fisico) : "—") },
        { titulo: "AX", numero: true, render: (x) => (x.resultado ? n(x.resultado.ax) : "—") },
        {
          titulo: "Resultado",
          render: (x) => (x.por_confirmar ? html`<${Pastilla} tono="info">por confirmar<//>` : x.en_ax ? html`<${Resultado} r=${x.resultado} />` : html`<${Pastilla} tono="alerta">no está en AX<//>`),
        },
      ]}
    />
  </details>`;
}

function VistaValuada({ r, filtro, texto }) {
  const filas = useFiltroTexto(
    [...r.renglones, ...r.axSinFisico, ...r.fisicoSinAx]
      .filter((x) => x.valor && !x.valor.eq(0))
      .filter(pasa(filtro))
      .map(buscable),
    texto,
    ["_buscar"],
  ).sort((a, b) => b.valor.abs().cmp(a.valor.abs()));
  return html`<div class="totales-valuada">
      <span>Sobrante sin explicar: <strong class="ok">${dinero(r.resumen.valor_sobrante)}</strong></span>
      <span>Faltante sin explicar: <strong class="alerta">${dinero(r.resumen.valor_faltante)}</strong></span>
      <span>Neto: <strong>${dinero(r.resumen.valor_sobrante.plus(r.resumen.valor_faltante))}</strong></span>
    </div>
    <${Tabla}
      limite=${200}
      filas=${filas.map((x, i) => ({ ...x, id: i }))}
      vacia="No hay diferencias con valor."
      columnas=${[
        { titulo: "Código", numero: true, render: (x) => x.codigo },
        { titulo: "Descripción", render: (x) => x.descripcion },
        { titulo: "Partida", render: (x) => (x.variante ? describir(x.variante) : x.linea ? html`<code class="dim-ax">${describirAx(x.linea)}</code>` : "—") },
        { titulo: "Sin explicar", numero: true, render: (x) => conSigno(x.sin_explicar) },
        { titulo: "Costo unitario", numero: true, render: (x) => dinero(x.costo) },
        { titulo: "Valor", numero: true, render: (x) => html`<strong class=${x.valor.gt(0) ? "ok" : "alerta"}>${dinero(x.valor)}</strong>` },
      ]}
    />
    <p class="nota">Costo unitario = Valor financiero ÷ Disponible de la partida de AX. Lo que solo está en el físico no tiene costo en AX.</p>`;
}

/** Ventana de diferencias: vista y filtro se cambian sin cerrarla; con buscador. */
function VentanaDiferencias({ r, corte, inicial, alCerrar, alConfirmar }) {
  const [vista, setVista] = useState(inicial.vista ?? "renglon");
  const [filtro, setFiltro] = useState(inicial.filtro ?? "diferencias");
  const [texto, setTexto] = useState("");
  // Lo que solo está en el físico (no está en AX) también se ve, salvo al abrir "Todo el reporte de AX".
  const [conFisico, setConFisico] = useState(inicial.conFisico ?? true);
  const props = { r, filtro, texto, conFisico, alConfirmar };
  return html`<${Ventana} titulo=${vista === "renglon" && filtro === "todos" ? "Reporte de AX completo" : "Diferencias contra AX"} clase="ventana-concilia" alCerrar=${alCerrar}>
    <div class="controles-concilia">
      <${Segmentos} etiqueta="Ver" valor=${vista} opciones=${VISTAS} alCambiar=${setVista} />
      <${Segmentos} etiqueta="Mostrar" valor=${filtro} opciones=${FILTROS} alCambiar=${setFiltro} />
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión, NP…" />
      ${vista === "renglon" && r.fisicoSinAx.length
        ? html`<label class="casilla">
            <input type="checkbox" checked=${conFisico} onChange=${(e) => setConFisico(e.currentTarget.checked)} />
            <span>Incluir lo que solo está en el físico (${r.fisicoSinAx.length})</span>
          </label>`
        : null}
    </div>
    ${vista === "renglon"
      ? html`<${VistaRenglon} ...${props} />`
      : vista === "articulo"
        ? html`<${VistaArticulo} ...${props} />`
        : vista === "contenedor"
          ? html`<${VistaContenedor} ...${props} />`
          : html`<${VistaValuada} ...${props} />`}
    <p class="nota">
      Diferencia = físico − AX. Se explica con los vales posteriores al corte${corte.folio_salida ? ` (salidas después del folio ${corte.folio_salida})` : ` (después del ${fmtFecha(corte.fecha)})`}${r.ax ? " y con las salidas anteriores que en el archivo de la base no tienen folio IN / TR («sin IN/TR»)" : ""}:
      físico − AX + salidas − entradas = 0.
    </p>
  <//>`;
}

// ---------------------------------------------------------------- por confirmar

/** Una partida de AX por confirmar: corregir el inventario a como está en AX, ajustar, elegir otra o "no está". */
function ItemConfirmar({ p, r, corte }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [editando, setEditando] = useState(null); // id de la variante que se está ajustando
  const sugerida = p.variante_id !== null ? r.fisico.get(p.variante_id) : null;
  const aplicar = (varianteId, valores = {}) =>
    corregir(
      (e) => confirmarPareja(e, { corteId: corte.id, lineaId: p.linea.id, varianteId, ...valores }, sesion.usuario),
      (res) =>
        res.sinPareja
          ? `${p.linea.codigo} ${describirAx(p.linea)}: queda como "no está en el físico" en este corte.`
          : `Listo: ${p.linea.codigo} quedó como ${res.despues} en el inventario${res.unida ? " (se juntó con la variante igual que ya existía)" : ""}.`,
    );
  const elegida = editando !== null ? r.fisico.get(editando) : null;
  const propuesta = sugerida ? valoresAx(p.linea, sugerida.variante) : null;
  return html`<li class="item-confirmar">
    <div class="lado lado-ax">
      <span class="lado-etiqueta">AX</span>
      <strong>${p.linea.codigo}</strong> ${p.linea.nombre}
      <code class="dim-ax">${describirAx(p.linea)}</code>
      <span class="nota">${n(p.linea.disponible)} ${p.linea.um}</span>
    </div>
    <span class="flecha-pareja" aria-hidden="true">→</span>
    <div class="lado lado-fisico">
      <span class="lado-etiqueta">Inventario</span>
      ${sugerida
        ? html`<strong>${describir(sugerida.variante)}</strong>
            <span class="nota">${n(sugerida.total)} ${sugerida.variante.um}</span>
            ${p.metodo === "recordada"
              ? html`<${Pastilla} tono="info" titulo="Se confirmó antes sin corregir el inventario">confirmada antes<//>`
              : html`<${Pastilla} tono=${p.puntaje >= PUNTAJE_SEGURO ? "ok" : "alerta"} titulo="Qué tanto se parecen">${Math.round(p.puntaje * 100)}%<//>`}
            <span class="quedara">Quedará <code>${escrituraClave(propuesta.dimension, propuesta.np)}</code></span>`
        : p.candidatos.length
          ? html`<span class="nota">Sin sugerencia: elige cuál es o "No está en el físico".</span>`
          : html`<span class="nota">Todas las partidas del inventario de este código ya son pareja de otra partida de AX. Si no hay otra, márcala como "No está en el físico".</span>`}
      ${p.ocupadas && p.candidatos.length
        ? html`<span class="quedara">${p.ocupadas === 1 ? "1 partida del inventario ya es pareja de otra partida de AX y no se ofrece" : `${p.ocupadas} partidas del inventario ya son pareja de otras partidas de AX y no se ofrecen`}.</span>`
        : null}
    </div>
    <div class="acciones-pareja">
      ${sugerida ? html`<${Boton} tipo="primario" tamano="chico" onClick=${() => aplicar(p.variante_id)}>✓ Corregir a como está en AX<//>` : null}
      ${sugerida && editando === null ? html`<${Boton} tipo="texto" tamano="chico" onClick=${() => setEditando(p.variante_id)}>Ajustar…<//>` : null}
      <${ElegirPareja} par=${p} r=${r} alElegir=${(varianteId) => (varianteId === null ? aplicar(null) : setEditando(varianteId))} />
    </div>
    ${elegida
      ? html`<div class="item-editor">
          <${EditorClave}
            key=${editando}
            cual=${{ varianteId: editando }}
            codigo=${p.linea.codigo}
            actual=${{ dimension: elegida.variante.dimension, np: elegida.variante.np, um: elegida.variante.um }}
            inicial=${valoresAx(p.linea, elegida.variante)}
            linea=${p.linea}
            textoAplicar="Corregir el inventario"
            alAplicar=${({ dimension, np }) => aplicar(editando, { dimension, np })}
            alCancelar=${() => setEditando(null)}
          />
        </div>`
      : null}
  </li>`;
}

const PESTANAS_EMPAREJAR = { distinto: "AX lo escribe distinto", fisico: "Solo en el físico", ax: "Solo en AX" };

/**
 * Emparejar con AX: las partidas que AX y el inventario escriben distinto (corregir el inventario), lo
 * que solo está en el físico (corregir su dimensión / NP) y lo que solo está en AX (volver a emparejar).
 */
function VentanaEmparejar({ r, corte, alCerrar, pestana: inicial = "distinto", textoInicial = "" }) {
  const [pestana, setPestana] = useState(inicial);
  const cuantas = { distinto: r.porConfirmar.length, fisico: r.fisicoSinAx.length, ax: r.axSinFisico.length };
  const opciones = Object.fromEntries(Object.entries(PESTANAS_EMPAREJAR).map(([k, v]) => [k, `${v} (${cuantas[k]})`]));
  return html`<${Ventana} titulo="Emparejar con AX" clase="ventana-concilia" alCerrar=${alCerrar}>
    <div class="controles-concilia"><${Segmentos} valor=${pestana} opciones=${opciones} alCambiar=${setPestana} /></div>
    ${pestana === "distinto"
      ? html`<${ListaConfirmar} r=${r} corte=${corte} textoInicial=${textoInicial} />`
      : pestana === "fisico"
        ? html`<${ListaFisicoSinAx} r=${r} />`
        : html`<${ListaAxSinFisico} r=${r} corte=${corte} />`}
  <//>`;
}

function ListaConfirmar({ r, corte, textoInicial = "" }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [texto, setTexto] = useState(textoInicial);
  const seguras = new Set(r.porConfirmar.filter((p) => p.variante_id !== null && p.puntaje >= PUNTAJE_SEGURO).map((p) => p.variante_id)).size;
  const items = useFiltroTexto(
    r.porConfirmar.map((p) => ({ p, _buscar: `${p.linea.codigo} ${p.linea.nombre} ${describirAx(p.linea)} ${p.variante_id !== null ? describir(r.fisico.get(p.variante_id)?.variante) : ""}` })),
    texto,
    ["_buscar"],
  );
  return html`
    <p class="nota">
      AX y el inventario escriben distinto estas partidas. Al confirmar, la <strong>dimensión y el NP del inventario se corrigen</strong> a como
      están en AX (en todas sus partidas); la siguiente vez emparejan solas. Las cantidades no cambian.
    </p>
    <div class="controles-concilia">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión…" />
      ${seguras > 1
        ? html`<${Boton}
            tipo="primario"
            tamano="chico"
            onClick=${() =>
              corregir(
                (e) => confirmarSeguras(e, corte.id, sesion.usuario),
                (hechas) => `Listo: ${hechas} ${hechas === 1 ? "partida corregida" : "partidas corregidas"} en el inventario a como están en AX.`,
              )}
            >✓ Corregir las ${seguras} seguras (≥ ${Math.round(PUNTAJE_SEGURO * 100)}%)<//>`
        : null}
    </div>
    ${r.porConfirmar.length
      ? html`<ul class="lista-confirmar">${items.map(({ p }) => html`<${ItemConfirmar} key=${p.linea.id} p=${p} r=${r} corte=${corte} />`)}</ul>`
      : html`<p class="vacio">✓ Todo emparejado.</p>`}
  `;
}

// ---------------------------------------------------------------- sin pareja

function ListaAxSinFisico({ r, corte }) {
  const sesion = useSesion();
  const [texto, setTexto] = useState("");
  const filas = useFiltroTexto(r.axSinFisico.map(buscable), texto, ["_buscar"]);
  const volver = (linea) => sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => olvidarPareja(e, { corteId: corte.id, lineaId: linea.id }, sesion.usuario)));
  return html`
    <p class="nota">Partidas de AX sin pareja en el inventario. Si en realidad sí están, vuelve a emparejarlas; si salieron con vales, justifícalas en «Justificar faltantes».</p>
    <div class="controles-concilia"><${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, tamaño…" /></div>
    <${Tabla}
      filas=${filas.map((x) => ({ ...x, id: x.linea.id }))}
      vacia="Todo lo de AX está en el inventario."
      columnas=${[
        { titulo: "Código", numero: true, render: (x) => x.codigo },
        { titulo: "Descripción", render: (x) => x.descripcion },
        { titulo: "Tamaño + Color", render: (x) => html`<code class="dim-ax">${describirAx(x.linea)}</code>` },
        { titulo: "AX", numero: true, render: (x) => `${n(x.ax)} ${x.linea.um}` },
        { titulo: "Valor", numero: true, render: (x) => dinero(x.valor) },
        {
          titulo: "",
          render: (x) =>
            x.metodo === "sin_pareja"
              ? html`<button type="button" class="enlace-boton" onClick=${() => volver(x.linea)}>Volver a emparejar</button>`
              : html`<${Pastilla} titulo="El código no tiene ninguna partida en el inventario">sin partidas<//>`,
        },
      ]}
    />
  `;
}

function ListaFisicoSinAx({ r }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState(null);
  const filas = useFiltroTexto(r.fisicoSinAx.map(buscable), texto, ["_buscar"]);
  return html`
    <p class="nota">Si AX lo tiene con otra dimensión o NP, corrígela aquí: la siguiente conciliación ya lo empareja.</p>
    <div class="controles-concilia"><${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión…" /></div>
    ${filas.length
      ? html`<ul class="lista-sin-ax">
          ${filas.map(
            (x) => html`<li key=${x.variante_id}>
              <div class="fila-sin-ax">
                <strong>${x.codigo}</strong>
                <span class="descripcion-corta" title=${x.descripcion}>${x.descripcion || "—"}</span>
                <code>${describir(x.variante)}</code>
                <span class="numero">${n(x.fisico)} ${x.variante.um ?? ""}</span>
                <span class="lugares">${x.lugares.map((l) => html`<${Pastilla} tono="lugar" titulo=${l.hoja}>${l.lugar}<//>`)}</span>
                ${editando === x.variante_id ? null : html`<${Boton} tipo="texto" tamano="chico" onClick=${() => setEditando(x.variante_id)}>Corregir dimensión / NP<//>`}
              </div>
              ${editando === x.variante_id
                ? html`<${EditorClave}
                    cual=${{ varianteId: x.variante_id }}
                    codigo=${x.codigo}
                    actual=${{ dimension: x.variante.dimension, np: x.variante.np, um: x.variante.um }}
                    alAplicar=${({ dimension, np, cual }) =>
                      corregir(
                        (e) => corregirDimensionNp(e, cual, { dimension, np }, { usuario: sesion.usuario, motivo: "Conciliación con AX" }),
                        (res) => `Listo: ${x.codigo} quedó como ${res.despues}${res.unida ? " (se juntó con la variante igual)" : ""}.`,
                      ).then((res) => res && setEditando(null))}
                    alCancelar=${() => setEditando(null)}
                  />`
                : null}
            </li>`,
          )}
        </ul>`
      : html`<p class="vacio">Todo el inventario está en AX.</p>`}
  `;
}

// ---------------------------------------------------------------- mosaicos

/** Celda del bento que abre su sección en una ventana. */
function Mosaico({ titulo, icono, dato, detalle, tono = "", clase = "", onClick, children }) {
  return html`<button type="button" class=${`bento-celda mosaico ${tono ? `mosaico-${tono}` : ""} ${clase}`} onClick=${onClick}>
    <span class="bento-cabeza">
      ${icono ? html`<span class="cabeza-icono"><${Icono} nombre=${icono} tam=${18} /></span>` : null}
      <span class="mosaico-titulo">${titulo}</span>
      <span class="mosaico-abrir" aria-hidden="true">Ver ›</span>
    </span>
    ${dato !== undefined ? html`<span class="dato-grande">${dato}</span>` : null}
    ${detalle ? html`<span class="nota">${detalle}</span>` : null}
    ${children}
  </button>`;
}

/** Fila del resumen lateral: solo informa; al pulsarla abre su detalle. */
function Cifra({ titulo, dato, detalle, tono = "", onClick, children }) {
  return html`<li>
    <button type="button" class=${`cifra ${tono ? `cifra-${tono}` : ""}`} onClick=${onClick}>
      <span class="cifra-titulo">${titulo}</span>
      <span class="cifra-dato">${dato}</span>
      ${detalle ? html`<span class="cifra-detalle">${detalle}</span>` : null}
      ${children}
    </button>
  </li>`;
}

const LEYENDA = [
  ["cuadra", "Cuadra"],
  ["explicada", "Explicada por vales"],
  ["sobrante", "Sobrante"],
  ["faltante", "Faltante"],
  ["por_confirmar", "Por confirmar"],
];

// ---------------------------------------------------------------- página

/** Conciliación contra AX (F4): importar el corte, confirmar (corrige el inventario), ver diferencias y exportar la solicitud de ajuste. */
export function PaginaConciliacion() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const cortes = [...(estado.cortes_ax ?? [])].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  const [corteId, setCorteId] = useState(cortes[0]?.id ?? null);
  const corte = corteAx(estado, corteId) ?? cortes[0] ?? null;
  const [previa, setPrevia] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [todos, setTodos] = useState(false);
  const r = useMemo(() => (corte ? conciliar(estado, corte) : null), [estado, corte]);
  const sugerencias = useMemo(() => (r ? sugerenciasDeVales(estado, r) : new Map()), [estado, r]);

  const abrir = (archivo) =>
    sesion.tarea("Leyendo el reporte de AX…", async () => {
      try {
        const datos = await leerArchivoSubido(archivo);
        const reporte = leerReporteAx(datos, archivo.name);
        const preferido = estado.config?.almacen_ax;
        const almacen = reporte.almacenes.find((a) => a.nombre.toUpperCase() === String(preferido ?? "").toUpperCase())?.nombre ?? reporte.almacenes[0]?.nombre ?? "";
        setPrevia({ nombre: archivo.name, reporte, almacen, huella: await sha256(datos) });
      } catch (error) {
        if (error instanceof ErrorReporteAx) sesion.avisar("error", error.message);
        else sesion.avisar("error", `No se pudo leer ${archivo.name}: ${error.message}`);
      }
    });
  const importar = ({ almacen, fecha, folio, renglones }) =>
    sesion.tarea("Importando el corte…", async () => {
      try {
        const nuevo = await sesion.almacen.modificar((e) => {
          e.config.almacen_ax = almacen;
          return registrarCorteAx(e, { fecha, almacen, archivo: previa.nombre, huella: previa.huella, folioSalida: folio, renglones }, sesion.usuario).id;
        });
        setPrevia(null);
        setCorteId(nuevo);
        const inv = lineasInv({ lineas: renglones }).length;
        sesion.avisar("exito", `Corte de AX al ${fmtFecha(fecha)} importado: ${inv} partidas INV.`);
      } catch (error) {
        if (error instanceof ErrorConciliacion) sesion.avisar("error", error.message);
        else throw error;
      }
    });
  const cambiarFolio = (valor) =>
    sesion.tarea("Guardando…", async () => {
      try {
        await sesion.almacen.modificar((e) => fijarFolioCorte(e, corte.id, valor, sesion.usuario));
      } catch (error) {
        if (error instanceof ErrorConciliacion) sesion.avisar("error", error.message);
        else throw error;
      }
    });
  const quitar = () => {
    if (!confirmar(`¿Quitar el corte de AX al ${fmtFecha(corte.fecha)}? No cambia el inventario (las correcciones de dimensión y NP se quedan).`)) return;
    return sesion.tarea("Quitando…", async () => {
      await sesion.almacen.modificar((e) => quitarCorteAx(e, corte.id, sesion.usuario));
      setCorteId(null);
    });
  };

  const botonImportar = html`<${ElegirArchivo} etiqueta=${html`<${Icono} nombre="subir" tam=${16} /> Importar reporte de AX`} acepta=".xlsx" tipo=${corte ? "secundario" : "primario"} alElegir=${abrir} />`;
  const ventanaImportar = previa ? html`<${VentanaImportar} previa=${previa} alCerrar=${() => setPrevia(null)} alImportar=${importar} />` : null;

  if (!corte) {
    return html`<${Tarjeta} titulo="Concilia el inventario contra AX" clase="tarjeta-inicio-vales">
        <p>
          Funciona como conciliar el banco: <strong>AX</strong> es el estado de cuenta, el <strong>inventario</strong> es tu chequera y
          los <strong>vales posteriores al corte</strong> son los cheques en tránsito. Importa el reporte de inventario de AX que manda
          la base (<code>DELTA RIG 91 &lt;fecha&gt;.xlsx</code>, completo o ya filtrado): la herramienta compara las partidas con modelo
          <strong>INV</strong>, te pide confirmar solo las que se escriben distinto (y corrige el inventario) y te dice qué diferencias
          explican los vales.
        </p>
        <div class="acciones-linea">${botonImportar}</div>
      <//>
      ${ventanaImportar}`;
  }

  const { resumen } = r;
  const cerrar = () => setAbierta(null);
  const diferencias = (vista, filtro, conFisico = true) => () => setAbierta({ tipo: "diferencias", vista, filtro, conFisico });
  const emparejar = (pestana = "distinto") => () => setAbierta({ tipo: "emparejar", pestana });
  const conDiferencia = r.porCodigo.filter((x) => x.estado !== "cuadra").length;
  const contenedoresConDif = r.porContenedor.filter((c) => c.renglones.some((x) => x.por_confirmar || !x.en_ax || (x.resultado && x.resultado.estado !== "cuadra"))).length;
  const neto = resumen.valor_sobrante.plus(resumen.valor_faltante);
  const filasAjuste = filasSolicitud(r, corte, { todos }).length;
  const porAplicar = valesPorAplicar(r, corte, { todos }).length;
  const asignadas = (corte.asignaciones ?? []).length;
  const faltantesSinExplicar = resumen.faltantes;

  return html`
    <div class="barra-cortes">
      <${Lista}
        clase="lista-cortes"
        valor=${corte.id}
        alCambiar=${(v) => setCorteId(Number(v))}
        ariaLabel="Corte de AX"
        opciones=${cortes.map((c) => ({ valor: c.id, etiqueta: `AX al ${fmtFecha(c.fecha)}`, detalle: `${c.almacen} · ${lineasInv(c).length} partidas INV · ${c.archivo ?? ""}` }))}
      />
      <label class="folio-corte" title="Los vales de salida en tránsito son los posteriores a este folio (si no se indica, los posteriores a la fecha del corte)">
        <span>Base capturó hasta el folio</span>
        <input inputmode="numeric" value=${corte.folio_salida ?? ""} placeholder="por fecha" onChange=${(e) => cambiarFolio(e.currentTarget.value)} />
      </label>
      <span class="espaciador"></span>
      <${ImportarBase} />
      ${botonImportar}
      <${Boton} tipo="peligro-texto" tamano="chico" onClick=${quitar}>Quitar corte<//>
    </div>

    <div class="concilia-layout">
      <${Bento} clase="bento-concilia" etiqueta="Qué hacer con la conciliación">
        <section class="bento-celda bento-doble bento-exportar-ajuste" aria-label="Enviar a la base">
          <header class="bento-cabeza">
            <span class="cabeza-icono"><${Icono} nombre="descargar" tam=${18} /></span>
            <h2>Enviar a la base</h2>
            <${Pastilla} tono=${filasAjuste ? "info" : "ok"}>${filasAjuste} ${filasAjuste === 1 ? "partida" : "partidas"}<//>
          </header>
          <div class="ajuste-cuerpo">
            <div>
              <p class="nota">
                La <strong>solicitud de ajuste</strong> en Excel: el reporte de AX con <em>Existencia física</em>, <em>Folios que justifican</em> y <em>Estado</em>,
                y la hoja <em>Vales por aplicar</em> (${porAplicar === 1 ? "1 partida" : `${porAplicar} partidas`} que la base aún no aplica en AX).
              </p>
              <ul class="leyenda-colores">
                ${LEYENDA.map(([clave, texto]) => html`<li><span class="muestra-color" style=${`background: #${COLORES_ESTADO[clave]}`}></span>${texto}</li>`)}
              </ul>
              <p class="nota leyenda-folios"><strong>(S)</strong> vale de salida · <strong>(E)</strong> vale de entrada (con el folio del vale de la base)</p>
            </div>
            <div class="ajuste-acciones">
              <label class="casilla"><input type="checkbox" checked=${todos} onChange=${(e) => setTodos(e.currentTarget.checked)} /> <span>Incluir también las que cuadran</span></label>
              <${Boton} tipo="primario" onClick=${() => exportarConDialogo(sesion, "AJUSTE", null, { corteAx: corte.id, todos })}><${Icono} nombre="descargar" tam=${16} /> Descargar solicitud<//>
            </div>
          </div>
          ${resumen.por_confirmar ? html`<p class="alerta">Hay ${resumen.por_confirmar} por emparejar: saldrán en gris. Empárejalas antes de enviarla.</p>` : null}
        </section>

        <section class="bento-celda bento-doble bento-resolver" aria-label="Por resolver">
          <header class="bento-cabeza">
            <span class="cabeza-icono"><${Icono} nombre="balanza" tam=${18} /></span>
            <h2>Por resolver</h2>
          </header>
          <div class="resolver-fila">
            <span class=${`resolver-dato ${r.porConfirmar.length ? "atencion" : "ok"}`}>${r.porConfirmar.length}</span>
            <div>
              <strong>Emparejar con AX</strong>
              <span class="nota">
                ${r.porConfirmar.length
                  ? "partidas que AX y el inventario escriben distinto: al emparejarlas se corrige la dimensión / NP del inventario."
                  : "Todo lo de AX tiene su pareja en el inventario."}
                ${` También: ${r.fisicoSinAx.length} solo en el físico · ${r.axSinFisico.length} solo en AX.`}
              </span>
            </div>
            <${Boton} tipo=${r.porConfirmar.length ? "primario" : "secundario"} tamano="chico" onClick=${emparejar("distinto")}>Emparejar<//>
          </div>
          <div class="resolver-fila">
            <span class=${`resolver-dato ${faltantesSinExplicar ? "error" : "ok"}`}>${faltantesSinExplicar}</span>
            <div>
              <strong>Justificar faltantes</strong>
              <span class="nota">
                ${faltantesSinExplicar ? "faltantes sin explicar: asígnales los vales sin IN / TR que ya salieron." : "No quedan faltantes sin explicar."}
                ${sugerencias.size ? ` ${sugerencias.size} con vales sugeridos.` : ""}${asignadas ? ` ${asignadas === 1 ? "1 vale asignado" : `${asignadas} vales asignados`}.` : ""}
              </span>
            </div>
            <${Boton} tipo=${sugerencias.size ? "primario" : "secundario"} tamano="chico" onClick=${() => setAbierta({ tipo: "justificar" })}>Justificar<//>
          </div>
        </section>

        <${Mosaico}
          icono="reporte"
          titulo="Diferencias contra AX"
          dato=${resumen.faltantes + resumen.sobrantes}
          detalle=${`sin explicar: faltan ${resumen.faltantes} · sobran ${resumen.sobrantes} · ${resumen.explicadas} explicadas por vales. Por partida, artículo, contenedor o en pesos.`}
          onClick=${diferencias("renglon", "diferencias")}
        />
        <${Mosaico}
          icono="inventario"
          titulo="Reporte AX"
          dato=${resumen.lineas_ax}
          detalle="Cada partida INV del kardex con su resultado (emparejadas, por confirmar y sin físico), con buscador y filtros."
          onClick=${diferencias("renglon", "todos", false)}
        />
        <${MosaicoBase} r=${r} alAbrir=${() => setAbierta({ tipo: "base" })} />
      <//>

      <aside class="concilia-resumen" aria-label="Resumen de la conciliación">
        <h2>Resumen</h2>
        <p class="nota">Solo informa. Pulsa una cifra para ver su detalle.</p>
        <ul>
          <${Cifra} titulo="Emparejadas" dato=${`${resumen.porcentaje}%`} detalle=${`${resumen.confirmados} de ${resumen.lineas_ax} partidas INV`} onClick=${diferencias("renglon", "todos", false)}>
            <span class="medidor" role="img" aria-label=${`${resumen.porcentaje}% emparejado`}><span style=${`width: ${resumen.porcentaje}%`}></span></span>
          <//>
          <${Cifra} tono="ok" titulo="Cuadran" dato=${resumen.cuadran} detalle="Físico = AX" onClick=${diferencias("renglon", "cuadra")} />
          <${Cifra} tono="info" titulo="Explicadas por vales" dato=${resumen.explicadas} onClick=${diferencias("renglon", "explicada")} />
          <${Cifra} tono="error" titulo="Faltantes" dato=${resumen.faltantes} detalle=${dinero(resumen.valor_faltante.abs())} onClick=${diferencias("renglon", "faltante")} />
          <${Cifra} tono="alerta" titulo="Sobrantes" dato=${resumen.sobrantes} detalle=${dinero(resumen.valor_sobrante)} onClick=${diferencias("renglon", "sobrante")} />
          <${Cifra} titulo="Solo en AX" dato=${r.axSinFisico.length} detalle="no están en el inventario" onClick=${emparejar("ax")} />
          <${Cifra} titulo="Solo en el físico" dato=${r.fisicoSinAx.length} detalle="no están en AX" onClick=${emparejar("fisico")} />
          <${Cifra} titulo="Valuada (neto)" dato=${dinero(neto)} onClick=${diferencias("valuada", "sin_explicar")} />
          <${Cifra} titulo="Códigos con diferencia" dato=${conDiferencia} detalle=${`de ${r.porCodigo.length}`} onClick=${diferencias("articulo", "diferencias")} />
          <${Cifra} titulo="Contenedores por revisar" dato=${contenedoresConDif} detalle=${`de ${r.porContenedor.length}`} onClick=${diferencias("contenedor", "diferencias")} />
        </ul>
      </aside>
    </div>

    ${abierta?.tipo === "emparejar" ? html`<${VentanaEmparejar} r=${r} corte=${corte} pestana=${abierta.pestana} textoInicial=${abierta.texto ?? ""} alCerrar=${cerrar} />` : null}
    ${abierta?.tipo === "justificar" ? html`<${VentanaJustificar} r=${r} corte=${corte} sugerencias=${sugerencias} alCerrar=${cerrar} />` : null}
    ${abierta?.tipo === "diferencias"
      ? html`<${VentanaDiferencias}
          r=${r}
          corte=${corte}
          inicial=${abierta}
          alCerrar=${cerrar}
          alConfirmar=${(x) => setAbierta({ tipo: "emparejar", pestana: "distinto", texto: `${x.codigo} ${describirAx(x.linea)}` })}
        />`
      : null}
    ${abierta?.tipo === "base" && r.ax ? html`<${VentanaBase} r=${r} alCerrar=${cerrar} />` : null}
    ${ventanaImportar}
  `;
}
