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
  corteAx,
  corteConHuella,
  etiquetaEstado,
  fijarFolioCorte,
  olvidarPareja,
  quitarCorteAx,
  registrarCorteAx,
} from "../../servicios/conciliacion.js";
import { Boton, ElegirArchivo, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
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
    { valor: "no", etiqueta: "No está en el físico", render: () => html`<span class="opcion-principal">No está en el físico</span><span class="res-detalle">Se recuerda para los siguientes cortes</span>` },
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
              opciones=${previa.reporte.almacenes.map((a) => ({ valor: a.nombre, etiqueta: a.nombre || "(sin almacén)", detalle: `${a.renglones} renglones` }))}
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
      <strong>${renglones.length}</strong> renglones de ${almacen || "este almacén"}
      ${previa.reporte.renglones.length > renglones.length ? html` · <span class="nota">${previa.reporte.renglones.length - renglones.length} de otros almacenes se ignoran</span>` : null}
    </p>
    ${repetido ? html`<p class="alerta">Este mismo archivo ya se importó como el corte del ${fmtFecha(repetido.fecha)}.</p>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!renglones.length || !fecha} onClick=${() => alImportar({ almacen, fecha, folio, renglones })}>Importar corte<//>
      <${Boton} tipo="texto" onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- vistas

const VISTAS = { renglon: "Por renglón de AX", articulo: "Por artículo", contenedor: "Por contenedor", valuada: "Valuada en $" };
const FILTROS = { todos: "Todos", diferencias: "Con diferencia", sin_explicar: "Sin explicar", sobrante: "Sobrantes", faltante: "Faltantes", explicada: "Explicadas" };
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

function VistaRenglon({ r, filtro, fisico, alCambiar }) {
  const filas = r.renglones.filter(pasa(filtro)).sort((a, b) => a.codigo - b.codigo || describir(a.variante).localeCompare(describir(b.variante)));
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
      {
        titulo: "",
        render: (x) =>
          html`<${ElegirPareja}
            par=${{ linea: x.lineas[0], candidatos: [] }}
            fisico=${fisico}
            etiqueta="Cambiar"
            alElegir=${(varianteId) => alCambiar(x.lineas, varianteId)}
          />`,
      },
    ]}
  />`;
}

function VistaArticulo({ r, filtro }) {
  const filas = r.porCodigo.filter(pasa(filtro));
  return html`<${Tabla}
    limite=${200}
    filas=${filas.map((x) => ({ ...x, id: x.codigo }))}
    vacia="Nada con este filtro."
    columnas=${[
      { titulo: "Código", numero: true, render: (x) => x.codigo },
      { titulo: "Descripción", render: (x) => x.descripcion },
      { titulo: "Renglones AX / físico", render: (x) => `${x.renglones_ax} / ${x.variantes}` },
      { titulo: "AX", numero: true, render: (x) => n(x.ax) },
      { titulo: "Físico", numero: true, render: (x) => n(x.fisico) },
      { titulo: "Tránsito", render: (x) => html`<${Transito} r=${x} />` },
      { titulo: "Dif.", numero: true, render: (x) => conSigno(x.diferencia) },
      {
        titulo: "Resultado",
        render: (x) => html`<${Resultado} r=${x} />
          ${x.por_ubicar.length ? html`<${Pastilla} tono="alerta" titulo="Partidas en tránsito sin renglón del inventario (Pendientes)">por ubicar: ${x.por_ubicar.join(", ")}<//>` : null}`,
      },
    ]}
  />`;
}

function VistaContenedor({ r, filtro }) {
  const contenedores = r.porContenedor
    .map((c) => ({ ...c, renglones: c.renglones.filter((x) => pasa(filtro)(x.resultado)) }))
    .filter((c) => c.renglones.length);
  if (!contenedores.length) return html`<p class="nota">Nada con este filtro.</p>`;
  return html`<div class="vista-contenedores">
    ${contenedores.map(
      (c) => html`<details class="contenedor-concilia" open>
        <summary><strong>${c.hoja}</strong> <span class="nota">${c.renglones.length} renglones</span></summary>
        <${Tabla}
          limite=${300}
          filas=${c.renglones.map((x) => ({ ...x, id: x.existencia_id }))}
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
      </details>`,
    )}
  </div>`;
}

function VistaValuada({ r, filtro }) {
  const filas = [...r.renglones, ...r.axSinFisico, ...r.fisicoSinAx]
    .filter((x) => x.valor && !x.valor.eq(0))
    .filter(pasa(filtro))
    .sort((a, b) => b.valor.abs().cmp(a.valor.abs()));
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
        { titulo: "Renglón", render: (x) => (x.variante ? describir(x.variante) : x.linea ? html`<code class="dim-ax">${describirAx(x.linea)}</code>` : "—") },
        { titulo: "Sin explicar", numero: true, render: (x) => conSigno(x.sin_explicar) },
        { titulo: "Costo unitario", numero: true, render: (x) => dinero(x.costo) },
        { titulo: "Valor", numero: true, render: (x) => html`<strong class=${x.valor.gt(0) ? "ok" : "alerta"}>${dinero(x.valor)}</strong>` },
      ]}
    />
    <p class="nota">Costo unitario = Valor financiero ÷ Disponible del renglón de AX. Lo que solo está en el físico no tiene costo en AX.</p>`;
}

// ---------------------------------------------------------------- página

/** Conciliación contra AX (F4): importar el corte, confirmar parejas, ver diferencias y exportar la solicitud de ajuste. */
export function PaginaConciliacion() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const cortes = [...(estado.cortes_ax ?? [])].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
  const [corteId, setCorteId] = useState(cortes[0]?.id ?? null);
  const corte = corteAx(estado, corteId) ?? cortes[0] ?? null;
  const [previa, setPrevia] = useState(null);
  const [vista, setVista] = useState("renglon");
  const [filtro, setFiltro] = useState("diferencias");
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
        sesion.avisar("exito", `Corte de AX al ${fmtFecha(fecha)} importado: ${renglones.length} renglones.`);
      } catch (error) {
        if (error instanceof ErrorConciliacion) sesion.avisar("error", error.message);
        else throw error;
      }
    });
  const elegir = (lineas, varianteId) =>
    sesion.tarea("Guardando…", () =>
      sesion.almacen.modificar((e) => {
        for (const linea of lineas) confirmarPareja(e, linea, varianteId, sesion.usuario);
      }),
    );
  const confirmarSeguras = (pares) =>
    sesion.tarea("Confirmando…", async () => {
      await sesion.almacen.modificar((e) => {
        for (const p of pares) confirmarPareja(e, p.linea, p.variante_id, sesion.usuario);
      });
      sesion.avisar("exito", `${pares.length} parejas confirmadas: se recuerdan para los siguientes cortes.`);
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
    if (!confirmar(`¿Quitar el corte de AX al ${fmtFecha(corte.fecha)}? No cambia el inventario y las parejas confirmadas se conservan.`)) return;
    return sesion.tarea("Quitando…", async () => {
      await sesion.almacen.modificar((e) => quitarCorteAx(e, corte.id, sesion.usuario));
      setCorteId(null);
    });
  };

  const botonImportar = html`<${ElegirArchivo} etiqueta=${html`<${Icono} nombre="subir" tam=${16} /> Importar reporte de AX`} acepta=".xlsx" tipo=${corte ? "secundario" : "primario"} alElegir=${abrir} />`;
  const ventana = previa ? html`<${VentanaImportar} previa=${previa} alCerrar=${() => setPrevia(null)} alImportar=${importar} />` : null;

  if (!corte) {
    return html`<${Tarjeta} titulo="Concilia el inventario contra AX" clase="tarjeta-inicio-vales">
        <p>
          Funciona como conciliar el banco: <strong>AX</strong> es el estado de cuenta, el <strong>inventario</strong> es tu chequera y
          los <strong>vales posteriores al corte</strong> son los cheques en tránsito. Importa el reporte de inventario de AX que manda
          la base (<code>DELTA RIG 91 &lt;fecha&gt;.xlsx</code>, completo o ya filtrado): la herramienta empareja cada renglón con tu
          inventario, te pide confirmar solo los que se escriben distinto y te dice qué diferencias explican los vales.
        </p>
        <div class="acciones-linea">${botonImportar}</div>
      <//>
      ${ventana}`;
  }

  const { resumen } = r;
  const seguras = r.porConfirmar.filter((p) => p.variante_id !== null && p.puntaje >= PUNTAJE_SEGURO);
  return html`
    <div class="barra-cortes">
      <${Lista}
        clase="lista-cortes"
        valor=${corte.id}
        alCambiar=${(v) => setCorteId(Number(v))}
        ariaLabel="Corte de AX"
        opciones=${cortes.map((c) => ({ valor: c.id, etiqueta: `AX al ${fmtFecha(c.fecha)}`, detalle: `${c.almacen} · ${c.lineas.length} renglones · ${c.archivo ?? ""}` }))}
      />
      <label class="folio-corte" title="Los vales de salida en tránsito son los posteriores a este folio (si no se indica, los posteriores a la fecha del corte)">
        <span>Base capturó hasta el folio</span>
        <input inputmode="numeric" value=${corte.folio_salida ?? ""} placeholder="por fecha" onChange=${(e) => cambiarFolio(e.currentTarget.value)} />
      </label>
      <span class="espaciador"></span>
      ${botonImportar}
      <${Boton} tipo="peligro-texto" tamano="chico" onClick=${quitar}>Quitar corte<//>
    </div>

    <div class="bento bento-concilia">
      <section class="bento-celda">
        <header class="bento-cabeza"><h2>Emparejados</h2></header>
        <p class="dato-grande">${resumen.porcentaje}%</p>
        <div class="medidor" role="img" aria-label=${`${resumen.porcentaje}% emparejado`}><span style=${`width: ${resumen.porcentaje}%`}></span></div>
        <p class="nota">${resumen.confirmados} de ${resumen.lineas_ax} renglones de AX${resumen.por_confirmar ? ` · ${resumen.por_confirmar} por confirmar` : ""}</p>
      </section>
      <section class="bento-celda">
        <header class="bento-cabeza"><h2>Cuadran</h2></header>
        <p class="dato-grande">${resumen.cuadran + resumen.explicadas}</p>
        <p class="nota">${resumen.cuadran} iguales · ${resumen.explicadas} explicadas por vales en tránsito</p>
      </section>
      <section class="bento-celda">
        <header class="bento-cabeza"><h2>Sin explicar</h2></header>
        <p class="dato-grande">${resumen.sobrantes + resumen.faltantes}</p>
        <p class="nota">${resumen.sobrantes} sobrantes (${dinero(resumen.valor_sobrante)}) · ${resumen.faltantes} faltantes (${dinero(resumen.valor_faltante)})</p>
      </section>
      <section class="bento-celda bento-exportar-ajuste">
        <header class="bento-cabeza"><h2>Solicitud de ajuste</h2></header>
        <p class="nota">El reporte de AX con <em>Existencia física</em> y <em>Folios que justifican</em>.</p>
        <label class="casilla"><input type="checkbox" checked=${todos} onChange=${(e) => setTodos(e.currentTarget.checked)} /> <span>Incluir también los que cuadran</span></label>
        <${Boton} tipo="primario" onClick=${() => exportarConDialogo(sesion, "AJUSTE", null, { corteAx: corte.id, todos })}><${Icono} nombre="descargar" tam=${16} /> Descargar<//>
        ${resumen.por_confirmar ? html`<p class="alerta">Hay ${resumen.por_confirmar} por confirmar: saldrán marcados.</p>` : null}
      </section>
    </div>

    ${r.porConfirmar.length
      ? html`<${Tarjeta}
          titulo=${`Por confirmar (${r.porConfirmar.length})`}
          clase="tarjeta-confirmar"
          acciones=${seguras.length > 1 ? html`<${Boton} tipo="primario" tamano="chico" onClick=${() => confirmarSeguras(seguras)}>✓ Confirmar las ${seguras.length} seguras<//>` : null}
        >
          <p class="nota">AX y el inventario escriben distinto estos renglones. Confírmalos una vez: se recuerdan para los siguientes cortes.</p>
          <ul class="lista-confirmar">
            ${r.porConfirmar.map((p) => {
              const sugerida = p.variante_id !== null ? r.fisico.get(p.variante_id) : null;
              return html`<li key=${p.linea.id}>
                <div class="lado lado-ax">
                  <span class="lado-etiqueta">AX</span>
                  <strong>${p.linea.codigo}</strong> ${p.linea.nombre}
                  <code class="dim-ax">${describirAx(p.linea)}</code>
                  <span class="nota">${n(p.linea.disponible)} ${p.linea.um}</span>
                </div>
                <span class="flecha-pareja" aria-hidden="true">→</span>
                <div class="lado lado-fisico">
                  <span class="lado-etiqueta">Físico</span>
                  ${sugerida
                    ? html`<strong>${describir(sugerida.variante)}</strong>
                        <span class="nota">${n(sugerida.total)} ${sugerida.variante.um}</span>
                        <${Pastilla} tono=${p.puntaje >= PUNTAJE_SEGURO ? "ok" : "alerta"} titulo="Qué tanto se parecen">${Math.round(p.puntaje * 100)}%<//>`
                    : html`<span class="nota">Sin sugerencia: elige la que es o "No está en el físico".</span>`}
                </div>
                <div class="acciones-pareja">
                  ${sugerida ? html`<${Boton} tipo="primario" tamano="chico" onClick=${() => elegir([p.linea], p.variante_id)}>✓ Es esta<//>` : null}
                  <${ElegirPareja} par=${p} fisico=${r.fisico} alElegir=${(varianteId) => elegir([p.linea], varianteId)} />
                </div>
              </li>`;
            })}
          </ul>
        <//>`
      : null}

    <${Tarjeta} titulo="Diferencias" clase="tarjeta-diferencias">
      <div class="controles-concilia">
        <${Segmentos} valor=${vista} opciones=${VISTAS} alCambiar=${setVista} />
        <${Segmentos} valor=${filtro} opciones=${FILTROS} alCambiar=${setFiltro} />
      </div>
      ${vista === "renglon"
        ? html`<${VistaRenglon}
            r=${r}
            filtro=${filtro}
            fisico=${r.fisico}
            alCambiar=${(lineas, varianteId) => elegir(lineas, varianteId)}
          />`
        : vista === "articulo"
          ? html`<${VistaArticulo} r=${r} filtro=${filtro} />`
          : vista === "contenedor"
            ? html`<${VistaContenedor} r=${r} filtro=${filtro} />`
            : html`<${VistaValuada} r=${r} filtro=${filtro} />`}
      <p class="nota">
        Diferencia = físico − AX. Se explica con los vales posteriores al corte${corte.folio_salida ? ` (salidas después del folio ${corte.folio_salida})` : ` (después del ${fmtFecha(corte.fecha)})`}:
        físico − AX + salidas − entradas = 0.
      </p>
    <//>

    <div class="bento bento-sin-pareja">
      <${Tarjeta} titulo=${`En AX y no en el físico (${r.axSinFisico.length})`}>
        <${Tabla}
          filas=${r.axSinFisico.map((x) => ({ ...x, id: x.linea.id }))}
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
                  ? html`<button type="button" class="enlace-boton" onClick=${() => sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => olvidarPareja(e, x.linea, sesion.usuario)))}>Volver a emparejar</button>`
                  : html`<${Pastilla} titulo="El código no tiene ningún renglón en el inventario">sin renglones<//>`,
            },
          ]}
        />
      <//>
      <${Tarjeta} titulo=${`En el físico y no en AX (${r.fisicoSinAx.length})`}>
        <${Tabla}
          filas=${r.fisicoSinAx.map((x) => ({ ...x, id: x.variante_id }))}
          vacia="Todo el inventario está en AX."
          columnas=${[
            { titulo: "Código", numero: true, render: (x) => x.codigo },
            { titulo: "Descripción", render: (x) => x.descripcion || "—" },
            { titulo: "Renglón", render: (x) => describir(x.variante) },
            { titulo: "Físico", numero: true, render: (x) => `${n(x.fisico)} ${x.variante.um ?? ""}` },
            { titulo: "Dónde", render: (x) => html`${x.lugares.map((l) => html`<${Pastilla} tono="lugar" titulo=${l.hoja}>${l.lugar}<//>`)}` },
          ]}
        />
      <//>
    </div>
    ${ventana}
  `;
}
