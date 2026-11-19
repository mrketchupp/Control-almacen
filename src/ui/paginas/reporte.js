import { useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso, sumarDias } from "../../nucleo/fechas.js";
import { hayPartidasFx } from "../../servicios/consultas.js";
import { describirCorte } from "../../servicios/corte.js";
import { reporteDelDia } from "../../servicios/reporte.js";
import { valesPorEnviar } from "../../servicios/vales.js";
import { Bento, Boton, Pastilla, Tabla, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { VentanaCarpetas, guardarEnSuLugar, textoDestino } from "./carpetas.js";
import { BotonSubido, carpetaLegible, exportarConDialogo } from "./sharepoint.js";

export function fechaDeRuta(hash = location.hash) {
  const m = /^#reporte\/(\d{4}-\d{2}-\d{2})/.exec(hash);
  return m ? m[1] : null;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00`).getDay()];
const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };
const extension = (nombre) => (/\.(\w+)$/.exec(nombre ?? "")?.[1] ?? "xlsx").toUpperCase();

/** Qué pasó con el archivo: guardado donde se eligió (o en su carpeta), o en otro lugar porque ahí no se pudo. */
function textoResultado(resultado) {
  if (!resultado) return null;
  if (!resultado.motivo) {
    if (!resultado.enSuCarpeta) return `✓ Guardado: ${resultado.destino}`;
    const nuevas = resultado.nuevas?.length ? ` (carpeta nueva: ${resultado.nuevas.join(" › ")})` : "";
    return `✓ Guardado en ${carpetaLegible(resultado.destino)}${nuevas}`;
  }
  const donde = resultado.destino.startsWith("Descargas/") ? "en Descargas" : `en ${resultado.destino}`;
  return `⚠ No quedó donde elegiste (${resultado.motivo}); se guardó ${donde}`;
}

/**
 * Tarjeta de descarga de un archivo del reporte (libro de vales o inventario al cierre del día):
 * todo es clicable y dice "Descargar"; después muestra dónde quedó de verdad. `destino`: la carpeta o el
 * archivo fijado (Ronda 30); entonces abajo hay «Guardar como…» para guardarlo en otro lugar esa vez.
 */
function BotonArchivo({ nombre, titulo, detalle, disabled, resultado, destino, onClick, alGuardarComo }) {
  const clase = resultado ? (resultado.motivo ? "descargado en-otro-lugar" : "descargado") : "";
  return html`<div class="archivo-dia">
    <button type="button" class=${`archivo-boton ${clase}`} disabled=${disabled} onClick=${onClick} aria-label=${`Descargar ${titulo}`}>
      <span class="archivo-icono">${extension(nombre)}</span>
      <span class="archivo-texto">
        <strong>${titulo}</strong>
        <span class="nota">${detalle}</span>
        <span class="archivo-nombre">${nombre ?? "Falta la plantilla: cárgala en Respaldos"}</span>
        ${destino
          ? html`<span class="archivo-destino"><${Icono} nombre="carpeta" tam=${14} /> <span>${destino}</span></span>`
          : null}
        ${resultado ? html`<span class="archivo-listo" role="status">${textoResultado(resultado)}</span>` : null}
      </span>
      <span class="archivo-accion"><${Icono} nombre="descargar" tam=${18} /> ${resultado ? "Otra vez" : "Descargar"}</span>
    </button>
    ${destino && !disabled
      ? html`<button type="button" class="boton boton-texto boton-chico archivo-otro" onClick=${alGuardarComo} aria-label=${`Guardar ${titulo} en otro lugar`}>Guardar como…</button>`
      : null}
  </div>`;
}

/**
 * Reporte diario: el libro de vales de salida y el inventario de refaccionamiento como estaban al
 * cierre del día elegido (lo hecho después no entra), y lo que falta subir al SharePoint hasta ahí.
 */
export function PaginaReporte() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const hoy = hoyIso();
  const [fecha, setFechaLocal] = useState(fechaDeRuta() ?? hoy);
  const [descargados, setDescargados] = useState({});
  const [carpetas, setCarpetas] = useState(false);
  const setFecha = (f) => {
    if (!f) return;
    setFechaLocal(f);
    setDescargados({});
    history.replaceState(null, "", `#reporte/${f}`);
  };
  const reporte = useMemo(() => reporteDelDia(estado, fecha), [estado, fecha]);
  const pendientesTotales = useMemo(() => valesPorEnviar(estado).length, [estado]);
  // ◀ ▶ van de un día en un día (aunque ese día no tenga vales); ▶ llega hasta hoy.
  const anterior = sumarDias(fecha, -1);
  const siguiente = fecha < hoy ? sumarDias(fecha, 1) : null;
  const { corte } = reporte;
  const nombreVales = sesion.almacen.nombreExportacion("VALES", fecha);
  const nombreInventario = sesion.almacen.nombreExportacion("INVENTARIO", fecha);
  const fx = useMemo(() => hayPartidasFx(estado), [estado.existencias]);
  const nombreFx = fx ? sesion.almacen.nombreExportacion("INVENTARIO_FX", fecha) : null;
  const posteriores = pendientesTotales - reporte.porSubir.length;
  const fijados = ["VALES", "INVENTARIO", ...(fx ? ["INVENTARIO_FX"] : [])].filter((t) => sesion.destinoReporte(t));
  const anotar = (tipo) => (r) => setDescargados((d) => ({ ...d, [tipo]: r }));
  // Reporte diario (Ronda 30): a su carpeta si tiene una fijada; si no, «Guardar como» como antes.
  const descargar = (tipo, extra = {}) => guardarEnSuLugar(sesion, tipo, anotar(tipo), { corte: fecha }, extra);
  const guardarComo = (tipo) => exportarConDialogo(sesion, tipo, anotar(tipo), { corte: fecha });
  // El libro de vales fijado se reemplaza: si hay vales después de este día, quedarán fuera de ese archivo.
  const antesDeVales = () =>
    !reporte.despues ||
    confirmar(
      `El libro de vales queda como estaba al cierre del ${fmtFecha(fecha)} (hasta el folio ${corte.salida}): ${reporte.despues} ${reporte.despues === 1 ? "vale posterior no estará" : "vales posteriores no estarán"} en ${sesion.destinoReporte("VALES")?.archivo.name} hasta que guardes el reporte de un día más reciente.\n\n¿Reemplazarlo?`,
    );

  return html`
    <div class="barra-fecha">
      <${Boton} tipo="texto" onClick=${() => setFecha(anterior)} title=${`Día anterior (${fmtFecha(anterior)})`} aria-label="Día anterior"><${Icono} nombre="izquierda" tam=${20} /><//>
      <label class="fecha-grande">
        <span class="nota">Día del reporte</span>
        <input type="date" value=${fecha} max=${hoy} onChange=${(e) => setFecha(e.currentTarget.value)} aria-label="Fecha del reporte" />
      </label>
      <${Boton} tipo="texto" disabled=${!siguiente} onClick=${() => setFecha(siguiente)} title=${siguiente ? `Día siguiente (${fmtFecha(siguiente)})` : "Ya es hoy"} aria-label="Día siguiente"><${Icono} nombre="derecha" tam=${20} /><//>
      <span class="nota">${diaSemana(fecha)} ${fmtFecha(fecha)}${fecha === hoy ? " · hoy" : ""}</span>
      ${fecha !== hoy ? html`<${Boton} tipo="texto" onClick=${() => setFecha(hoy)}>Hoy<//>` : null}
    </div>

    <div class="corte-aviso">
      <span class="corte-icono"><${Icono} nombre="reporte" tam=${22} /></span>
      <div>
        <strong>Los libros como estaban al cierre del ${fmtFecha(fecha)}</strong>
        <p class="nota">
          ${describirCorte(corte)} · el inventario con lo contado y movido hasta ese día.
          ${reporte.despues
            ? html` <strong>${reporte.despues} ${reporte.despues === 1 ? "vale posterior no entra" : "vales posteriores no entran"}</strong> en estos archivos.`
            : null}
        </p>
      </div>
    </div>

    <${Bento} clase="bento-reporte" etiqueta="Reporte del día">
      <section class="bento-celda bento-ancha">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="descargar" /></span>
          <h2>Descargar los archivos del día</h2>
          <${Boton} tipo="texto" tamano="chico" onClick=${() => setCarpetas(true)} title="Dónde se guarda cada archivo">
            <${Icono} nombre="carpeta" tam=${16} /> Carpetas…
          <//>
        </header>
        <p class="nota">
          ${fijados.length
            ? html`Pulsa cada archivo para guardarlo: ${fijados.length === (fx ? 3 : 2) ? "cada uno va a su carpeta" : "los que dicen su carpeta van ahí y los demás abren «Guardar como»"} (el año y el mes son los del día del reporte).`
            : html`Pulsa cada archivo para descargarlo: se abre «Guardar como» para elegir la carpeta y el nombre. En <strong>Carpetas…</strong> puedes fijar dónde va cada uno para no elegirlo cada vez.`}
          ${" "}Si vas a reemplazar uno que ya existe, <strong>ciérralo antes en Excel</strong> (Windows no deja reemplazar un archivo abierto).
        </p>
        <div class="archivos-dia">
          <${BotonArchivo}
            nombre=${nombreVales}
            titulo="Libro de vales de salida"
            detalle=${corte.salida ? `Hasta el folio ${corte.salida}` : "Aún no había vales a esa fecha"}
            disabled=${!nombreVales || !corte.salida}
            resultado=${descargados.VALES}
            destino=${textoDestino(sesion, "VALES", fecha)}
            onClick=${() => descargar("VALES", { antes: antesDeVales })}
            alGuardarComo=${() => guardarComo("VALES")}
          />
          <${BotonArchivo}
            nombre=${nombreInventario}
            titulo="Inventario de refaccionamiento"
            detalle=${`Cerrado al ${fmtFecha(fecha)}`}
            disabled=${!nombreInventario}
            resultado=${descargados.INVENTARIO}
            destino=${textoDestino(sesion, "INVENTARIO", fecha)}
            onClick=${() => descargar("INVENTARIO")}
            alGuardarComo=${() => guardarComo("INVENTARIO")}
          />
          ${fx
            ? html`<${BotonArchivo}
                nombre=${nombreFx}
                titulo="Inventario de FX"
                detalle=${`Cerrado al ${fmtFecha(fecha)}`}
                disabled=${!nombreFx}
                resultado=${descargados.INVENTARIO_FX}
                destino=${textoDestino(sesion, "INVENTARIO_FX", fecha)}
                onClick=${() => descargar("INVENTARIO_FX")}
                alGuardarComo=${() => guardarComo("INVENTARIO_FX")}
              />`
            : null}
        </div>
        <p class="nota">Salen sobre tus plantillas, igual que en Exportar y enviar.</p>
        ${carpetas ? html`<${VentanaCarpetas} fecha=${fecha} alCerrar=${() => setCarpetas(false)} />` : null}
      </section>

      <section class="bento-celda">
        <header class="bento-cabeza">
          <h2>Subir al SharePoint</h2>
          <${Pastilla} tono=${reporte.porSubir.length ? "alerta" : "ok"}>${reporte.porSubir.length} por subir<//>
        </header>
        ${reporte.porSubir.length
          ? html`<p class="nota">Vales nuevos o corregidos hasta el folio ${corte.salida}:</p>
              <div class="folios-pendientes">
                ${reporte.porSubir.map(
                  (p) => html`<a class=${`chip-folio chip-${p.motivo}`} href=${`#vale/${p.vale.id}`} title=${MOTIVOS[p.motivo]}>${p.vale.folio}</a>`,
                )}
              </div>
              <p class="nota">Sube el libro de vales de este día y márcalo:</p>
              <div class="acciones-linea"><${BotonSubido} pendientes=${reporte.porSubir.length} hastaFolio=${corte.salida} /></div>`
          : html`<p class="ok">✓ Todo lo de este día ya está subido.</p>`}
        ${posteriores > 0 ? html`<p class="nota">${posteriores} ${posteriores === 1 ? "vale posterior sigue" : "vales posteriores siguen"} pendiente(s); entran en el reporte de su día.</p>` : null}
      </section>

      <section class="bento-celda bento-ancha">
        <header class="bento-cabeza">
          <h2>Vales de salida del día</h2>
          <${Pastilla} tono=${reporte.salidas.length ? "info" : "neutro"}>${reporte.salidas.length} vales · ${reporte.partidas} partidas<//>
        </header>
        <${Tabla}
          filas=${reporte.salidas.map((s) => ({ ...s, id: s.vale.id }))}
          vacia=${`No hay vales de salida del ${fmtFecha(fecha)}.`}
          columnas=${[
            { titulo: "Folio", numero: true, render: (s) => html`<a class="enlace-folio" href=${`#vale/${s.vale.id}`}>${s.folio}</a>` },
            { clave: "area", titulo: "Área" },
            { clave: "recibio", titulo: "Recibió" },
            { clave: "partidas", titulo: "Partidas", numero: true },
            { titulo: "", render: (s) => (s.porSubir ? html`<${Pastilla} tono="alerta">por subir<//>` : html`<${Pastilla} tono="ok">subido<//>`) },
          ]}
        />
      </section>

      <section class="bento-celda">
        <header class="bento-cabeza">
          <h2>Material recibido</h2>
          <${Pastilla}>${reporte.entradas.length} entradas<//>
        </header>
        ${reporte.entradas.length
          ? html`<ul class="lista-simple">
              ${reporte.entradas.map(
                (e) => html`<li>
                  <a href=${`#entrada/${e.vale.id}`}>${e.folio}</a> · vale ${e.folio_externo || "—"}${e.origen ? ` de ${e.origen}` : ""} · ${e.partidas} partidas
                  ${e.fecha_vale && e.fecha_vale !== fecha ? html` · <span class="recibido-distinto" title="Fecha del vale: cuando lo envió la base">vale del ${fmtFecha(e.fecha_vale)}</span>` : null}
                </li>`,
              )}
            </ul>
            <p class="nota">Por su fecha de recibido: lo que llegó este día, aunque el vale sea de otro.</p>`
          : html`<p class="nota">Sin entradas recibidas este día.</p>`}
      </section>
    <//>
  `;
}
