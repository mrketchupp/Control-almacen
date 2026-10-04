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
  valoresAx,
} from "../../servicios/conciliacion.js";
import { corregirDimensionNp } from "../../servicios/inventario.js";
import { COLORES_ESTADO } from "../../exportadores/ajuste.js";
import { Bento, Boton, Buscador, ElegirArchivo, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { EditorClave, escrituraClave, useCorreccion } from "./clave.js";
import { exportarConDialogo } from "./sharepoint.js";

const n = (d) => (d === null || d === undefined ? "—" : num(aNumero(d)));
const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const dinero = (d) => (d === null || d === undefined ? "—" : pesos.format(aNumero(d)));
const conSigno = (d) => (d && d.gt(0) ? `+${n(d)}` : n(d));
const describir = (v) => (v ? `${v.dimension || "SIN DIMENSIÓN"}${v.np ? ` · NP ${v.np}` : ""}` : "—");
const describirAx = (l) => `${l.tamano || "—"}${l.color ? ` · ${l.color}` : ""}`;
const TONOS = { cuadra: "ok", explicada: "info", sobrante: "alerta", faltante: "error" };

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

/** Elegir otra pareja para un renglón de AX: variantes del mismo código o "no está en físico". */
function ElegirPareja({ par, fisico, alElegir, etiqueta = "Otra…" }) {
  const candidatos = [...fisico.values()]
    .filter((r) => r.variante.codigo === par.linea.codigo)
    .map((r) => ({ r, puntaje: par.candidatos.find((c) => c.variante_id === r.variante.id)?.puntaje ?? null }))
    .sort((a, b) => (b.puntaje ?? 0) - (a.puntaje ?? 0));
  const opciones = [
    ...candidatos.map(({ r, puntaje }) => ({
      valor: r.variante.id,
      etiqueta: describir(r.variante),
      render: () => html`<span class="opcion-principal">${describir(r.variante)}</span>
        <${Pastilla}>${r.variante.um || "—"}<//>
        <${Pastilla} tono=${r.total.gt(0) ? "ok" : "alerta"}>hay ${n(r.total)}<//>
        ${puntaje !== null ? html`<${Pastilla} tono="info">${Math.round(puntaje * 100)}%<//>` : null}`,
    })),
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
const FILTROS = { todos: "Todos", diferencias: "Con diferencia", sin_explicar: "Sin explicar", sobrante: "Sobrantes", faltante: "Faltantes", explicada: "Explicadas", cuadra: "Cuadran" };
const pasa = (filtro) => (r) =>
  !r
    ? filtro === "todos"
    : filtro === "todos"
      ? true
      : filtro === "diferencias"
        ? r.estado !== "cuadra"
        : filtro === "sin_explicar"
          ? r.estado === "sobrante" || r.estado === "faltante"
          : r.estado === filtro;

/** Texto en el que busca el buscador de cada ventana. */
const buscable = (x) => ({
  ...x,
  _buscar: [x.codigo, x.descripcion, x.variante ? describir(x.variante) : "", ...(x.lineas ?? (x.linea ? [x.linea] : [])).map(describirAx), x.dimension, x.np].filter(Boolean).join(" "),
});

function VistaRenglon({ r, filtro, texto }) {
  const filas = useFiltroTexto(
    r.renglones.filter(pasa(filtro)).map(buscable),
    texto,
    ["_buscar"],
  ).sort((a, b) => a.codigo - b.codigo || describir(a.variante).localeCompare(describir(b.variante)));
  return html`<${Tabla}
    limite=${200}
    filas=${filas.map((x) => ({ ...x, id: x.variante_id }))}
    vacia="Nada con este filtro."
    columnas=${[
      { titulo: "Código", numero: true, render: (x) => x.codigo },
      { titulo: "Descripción", render: (x) => html`<span class="descripcion-corta" title=${x.descripcion}>${x.descripcion}</span>` },
      { titulo: "En AX", render: (x) => html`${x.lineas.map((l) => html`<code class="dim-ax">${describirAx(l)}</code>`)}` },
      {
        titulo: "En físico",
        render: (x) => html`<span>${describir(x.variante)}</span>
          <span class="lugares">${x.lugares.map((l) => html`<${Pastilla} tono="lugar" titulo=${l.hoja}>${l.lugar}: ${n(l.total)}<//>`)}</span>`,
      },
      { titulo: "AX", numero: true, render: (x) => n(x.ax) },
      { titulo: "Físico", numero: true, render: (x) => n(x.fisico) },
      { titulo: "Tránsito", render: (x) => html`<${Transito} r=${x} />` },
      { titulo: "Dif.", numero: true, render: (x) => conSigno(x.diferencia) },
      { titulo: "Resultado", render: (x) => html`<${Resultado} r=${x} />` },
    ]}
  />`;
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
          ${x.por_ubicar.length ? html`<${Pastilla} tono="alerta" titulo="Partidas en tránsito sin partida del inventario (Pendientes)">por ubicar: ${x.por_ubicar.join(", ")}<//>` : null}`,
      },
    ]}
  />`;
}

function VistaContenedor({ r, filtro, texto }) {
  const contenedores = r.porContenedor
    .map((c) => ({ ...c, renglones: c.renglones.filter((x) => pasa(filtro)(x.resultado)) }))
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
function VentanaDiferencias({ r, corte, inicial, alCerrar }) {
  const [vista, setVista] = useState(inicial.vista ?? "renglon");
  const [filtro, setFiltro] = useState(inicial.filtro ?? "diferencias");
  const [texto, setTexto] = useState("");
  const props = { r, filtro, texto };
  return html`<${Ventana} titulo="Diferencias contra AX" clase="ventana-concilia" alCerrar=${alCerrar}>
    <div class="controles-concilia">
      <${Segmentos} etiqueta="Ver" valor=${vista} opciones=${VISTAS} alCambiar=${setVista} />
      <${Segmentos} etiqueta="Mostrar" valor=${filtro} opciones=${FILTROS} alCambiar=${setFiltro} />
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión, NP…" />
    </div>
    ${vista === "renglon"
      ? html`<${VistaRenglon} ...${props} />`
      : vista === "articulo"
        ? html`<${VistaArticulo} ...${props} />`
        : vista === "contenedor"
          ? html`<${VistaContenedor} ...${props} />`
          : html`<${VistaValuada} ...${props} />`}
    <p class="nota">
      Diferencia = físico − AX. Se explica con los vales posteriores al corte${corte.folio_salida ? ` (salidas después del folio ${corte.folio_salida})` : ` (después del ${fmtFecha(corte.fecha)})`}:
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
        : html`<span class="nota">Sin sugerencia: elige cuál es o "No está en el físico".</span>`}
    </div>
    <div class="acciones-pareja">
      ${sugerida ? html`<${Boton} tipo="primario" tamano="chico" onClick=${() => aplicar(p.variante_id)}>✓ Corregir a como está en AX<//>` : null}
      ${sugerida && editando === null ? html`<${Boton} tipo="texto" tamano="chico" onClick=${() => setEditando(p.variante_id)}>Ajustar…<//>` : null}
      <${ElegirPareja} par=${p} fisico=${r.fisico} alElegir=${(varianteId) => (varianteId === null ? aplicar(null) : setEditando(varianteId))} />
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

function VentanaConfirmar({ r, corte, alCerrar }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [texto, setTexto] = useState("");
  const seguras = new Set(r.porConfirmar.filter((p) => p.variante_id !== null && p.puntaje >= PUNTAJE_SEGURO).map((p) => p.variante_id)).size;
  const items = useFiltroTexto(
    r.porConfirmar.map((p) => ({ p, _buscar: `${p.linea.codigo} ${p.linea.nombre} ${describirAx(p.linea)} ${p.variante_id !== null ? describir(r.fisico.get(p.variante_id)?.variante) : ""}` })),
    texto,
    ["_buscar"],
  );
  return html`<${Ventana} titulo=${`Por confirmar (${r.porConfirmar.length})`} clase="ventana-concilia" alCerrar=${alCerrar}>
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
  <//>`;
}

// ---------------------------------------------------------------- sin pareja

function VentanaAxSinFisico({ r, corte, alCerrar }) {
  const sesion = useSesion();
  const [texto, setTexto] = useState("");
  const filas = useFiltroTexto(r.axSinFisico.map(buscable), texto, ["_buscar"]);
  const volver = (linea) => sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => olvidarPareja(e, { corteId: corte.id, lineaId: linea.id }, sesion.usuario)));
  return html`<${Ventana} titulo=${`En AX y no en el físico (${r.axSinFisico.length})`} clase="ventana-concilia" alCerrar=${alCerrar}>
    <div class="controles-concilia"><${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, tamaño…" /></div>
    <${Tabla}
      filas=${filas.map((x) => ({ ...x, id: x.linea.id }))}
      vacia="Todo lo de AX está en el inventario."
      columnas=${[
        { titulo: "Código", numero: true, render: (x) => x.codigo },
        { titulo: "Descripción", render: (x) => x.descripcion },
        { titulo: "Tamaño · Color", render: (x) => html`<code class="dim-ax">${describirAx(x.linea)}</code>` },
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
  <//>`;
}

function VentanaFisicoSinAx({ r, alCerrar }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState(null);
  const filas = useFiltroTexto(r.fisicoSinAx.map(buscable), texto, ["_buscar"]);
  return html`<${Ventana} titulo=${`En el físico y no en AX (${r.fisicoSinAx.length})`} clase="ventana-concilia" alCerrar=${alCerrar}>
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
  <//>`;
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
  const diferencias = (vista, filtro) => () => setAbierta({ tipo: "diferencias", vista, filtro });
  const conDiferencia = r.porCodigo.filter((x) => x.estado !== "cuadra").length;
  const contenedoresConDif = r.porContenedor.filter((c) => c.renglones.some((x) => x.por_confirmar || !x.en_ax || (x.resultado && x.resultado.estado !== "cuadra"))).length;
  const neto = resumen.valor_sobrante.plus(resumen.valor_faltante);
  const vistaPrevia = r.porConfirmar.slice(0, 4);

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
      ${botonImportar}
      <${Boton} tipo="peligro-texto" tamano="chico" onClick=${quitar}>Quitar corte<//>
    </div>

    <${Bento} clase="bento-concilia" etiqueta="Resumen de la conciliación">
      ${r.porConfirmar.length
        ? html`<${Mosaico}
            clase="bento-doble"
            tono="atencion"
            icono="balanza"
            titulo="Por confirmar"
            dato=${r.porConfirmar.length}
            detalle="AX y el inventario lo escriben distinto. Al confirmar se corrige la dimensión / NP del inventario."
            onClick=${() => setAbierta({ tipo: "confirmar" })}
          >
            <span class="mosaico-lista">
              ${vistaPrevia.map(
                (p) => html`<span class="mosaico-item">
                  <strong>${p.linea.codigo}</strong> <code>${describirAx(p.linea)}</code>
                  ${p.variante_id !== null ? html` ← <span>${describir(r.fisico.get(p.variante_id)?.variante)}</span>` : html` <span class="nota">sin sugerencia</span>`}
                </span>`,
              )}
              ${r.porConfirmar.length > vistaPrevia.length ? html`<span class="nota">y ${r.porConfirmar.length - vistaPrevia.length} más…</span>` : null}
            </span>
          <//>`
        : null}
      <${Mosaico} titulo="Emparejadas" dato=${`${resumen.porcentaje}%`} detalle=${`${resumen.confirmados} de ${resumen.lineas_ax} partidas INV de AX${resumen.no_inv ? ` · ${resumen.no_inv} de otros modelos no se concilian` : ""}`} onClick=${diferencias("renglon", "todos")}>
        <span class="medidor" role="img" aria-label=${`${resumen.porcentaje}% emparejado`}><span style=${`width: ${resumen.porcentaje}%`}></span></span>
      <//>
      <${Mosaico} tono="error" titulo="Faltantes" dato=${resumen.faltantes} detalle=${`Sin explicar · ${dinero(resumen.valor_faltante.abs())}`} onClick=${diferencias("renglon", "faltante")} />
      <${Mosaico} tono="alerta" titulo="Sobrantes" dato=${resumen.sobrantes} detalle=${`Sin explicar · ${dinero(resumen.valor_sobrante)}`} onClick=${diferencias("renglon", "sobrante")} />
      <${Mosaico} tono="info" titulo="Explicadas por vales" dato=${resumen.explicadas} detalle="La diferencia la cubren los vales posteriores al corte" onClick=${diferencias("renglon", "explicada")} />
      <${Mosaico} tono="ok" titulo="Cuadran" dato=${resumen.cuadran} detalle="Físico = AX" onClick=${diferencias("renglon", "cuadra")} />
      <${Mosaico} titulo="En AX y no en el físico" dato=${r.axSinFisico.length} detalle="Faltan en el inventario" onClick=${() => setAbierta({ tipo: "ax" })} />
      <${Mosaico} titulo="En el físico y no en AX" dato=${r.fisicoSinAx.length} detalle="Sobran en el inventario (o AX los escribe distinto)" onClick=${() => setAbierta({ tipo: "fisico" })} />
      <${Mosaico} icono="inventario" titulo="Por artículo" dato=${conDiferencia} detalle=${`códigos con diferencia de ${r.porCodigo.length}`} onClick=${diferencias("articulo", "diferencias")} />
      <${Mosaico} icono="caja" titulo="Por contenedor" dato=${contenedoresConDif} detalle=${`contenedores con algo que revisar de ${r.porContenedor.length}`} onClick=${diferencias("contenedor", "diferencias")} />
      <${Mosaico} titulo="Valuada en $" dato=${dinero(neto)} detalle=${`Sobrante ${dinero(resumen.valor_sobrante)} · faltante ${dinero(resumen.valor_faltante)}`} onClick=${diferencias("valuada", "sin_explicar")} />
      <section class="bento-celda bento-exportar-ajuste">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="descargar" tam=${18} /></span>
          <h2>Solicitud de ajuste</h2>
        </header>
        <p class="nota">El reporte de AX con <em>Existencia física</em>, <em>Folios que justifican</em> y el <em>Estado</em> de cada partida, coloreada:</p>
        <ul class="leyenda-colores">
          ${LEYENDA.map(([clave, texto]) => html`<li><span class="muestra-color" style=${`background: #${COLORES_ESTADO[clave]}`}></span>${texto}</li>`)}
        </ul>
        <label class="casilla"><input type="checkbox" checked=${todos} onChange=${(e) => setTodos(e.currentTarget.checked)} /> <span>Incluir también las que cuadran</span></label>
        <${Boton} tipo="primario" onClick=${() => exportarConDialogo(sesion, "AJUSTE", null, { corteAx: corte.id, todos })}><${Icono} nombre="descargar" tam=${16} /> Descargar<//>
        ${resumen.por_confirmar ? html`<p class="alerta">Hay ${resumen.por_confirmar} por confirmar: saldrán en gris.</p>` : null}
      </section>
    <//>

    ${abierta?.tipo === "confirmar" ? html`<${VentanaConfirmar} r=${r} corte=${corte} alCerrar=${cerrar} />` : null}
    ${abierta?.tipo === "diferencias" ? html`<${VentanaDiferencias} r=${r} corte=${corte} inicial=${abierta} alCerrar=${cerrar} />` : null}
    ${abierta?.tipo === "ax" ? html`<${VentanaAxSinFisico} r=${r} corte=${corte} alCerrar=${cerrar} />` : null}
    ${abierta?.tipo === "fisico" ? html`<${VentanaFisicoSinAx} r=${r} alCerrar=${cerrar} />` : null}
    ${ventanaImportar}
  `;
}
