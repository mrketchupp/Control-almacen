import { useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { describirCorte } from "../../servicios/corte.js";
import { fechasConVales, reporteDelDia } from "../../servicios/reporte.js";
import { valesPorEnviar } from "../../servicios/vales.js";
import { Bento, Boton, Pastilla, Tabla, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { BotonSubido, exportarConDialogo } from "./sharepoint.js";

export function fechaDeRuta(hash = location.hash) {
  const m = /^#reporte\/(\d{4}-\d{2}-\d{2})/.exec(hash);
  return m ? m[1] : null;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00`).getDay()];
const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };
const extension = (nombre) => (/\.(\w+)$/.exec(nombre ?? "")?.[1] ?? "xlsx").toUpperCase();

/**
 * Tarjeta de descarga de un archivo del reporte (libro de vales o inventario al cierre del día):
 * todo es clicable y dice "Descargar"; después muestra dónde quedó.
 */
function BotonArchivo({ nombre, titulo, detalle, disabled, descargado, onClick }) {
  return html`<button type="button" class=${`archivo-boton ${descargado ? "descargado" : ""}`} disabled=${disabled} onClick=${onClick} aria-label=${`Descargar ${titulo}`}>
    <span class="archivo-icono">${extension(nombre)}</span>
    <span class="archivo-texto">
      <strong>${titulo}</strong>
      <span class="nota">${detalle}</span>
      <span class="archivo-nombre">${nombre ?? "Falta la plantilla: cárgala en Respaldos"}</span>
      ${descargado ? html`<span class="archivo-listo">✓ Descargado: ${descargado}</span>` : null}
    </span>
    <span class="archivo-accion"><${Icono} nombre="descargar" tam=${18} /> ${descargado ? "Otra vez" : "Descargar"}</span>
  </button>`;
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
  const setFecha = (f) => {
    if (!f) return;
    setFechaLocal(f);
    setDescargados({});
    history.replaceState(null, "", `#reporte/${f}`);
  };
  const reporte = useMemo(() => reporteDelDia(estado, fecha), [estado, fecha]);
  const fechas = useMemo(() => fechasConVales(estado), [estado.vales]);
  const pendientesTotales = useMemo(() => valesPorEnviar(estado).length, [estado]);
  const anterior = fechas.find((f) => f < fecha);
  // Después del último día con vales, ▶ lleva a hoy (aunque hoy todavía no haya vales).
  const siguiente = [...fechas].reverse().find((f) => f > fecha && f <= hoy) ?? (fecha < hoy ? hoy : null);
  const tituloSiguiente = siguiente === hoy && !fechas.includes(hoy) ? "Hoy" : "Día siguiente con vales";
  const { corte } = reporte;
  const nombreVales = sesion.almacen.nombreExportacion("VALES", fecha);
  const nombreInventario = sesion.almacen.nombreExportacion("INVENTARIO", fecha);
  const posteriores = pendientesTotales - reporte.porSubir.length;

  return html`
    <div class="barra-fecha">
      <${Boton} tipo="texto" disabled=${!anterior} onClick=${() => setFecha(anterior)} title="Día anterior con vales" aria-label="Día anterior con vales">◀<//>
      <label class="fecha-grande">
        <span class="nota">Día del reporte</span>
        <input type="date" value=${fecha} max=${hoy} onChange=${(e) => setFecha(e.currentTarget.value)} aria-label="Fecha del reporte" />
      </label>
      <${Boton} tipo="texto" disabled=${!siguiente} onClick=${() => setFecha(siguiente)} title=${tituloSiguiente} aria-label=${tituloSiguiente}>▶<//>
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
        </header>
        <p class="nota">Pulsa cada archivo para descargarlo: se abre «Guardar como» para elegir la carpeta y el nombre.</p>
        <div class="archivos-dia">
          <${BotonArchivo}
            nombre=${nombreVales}
            titulo="Libro de vales de salida"
            detalle=${corte.salida ? `Hasta el folio ${corte.salida}` : "Aún no había vales a esa fecha"}
            disabled=${!nombreVales || !corte.salida}
            descargado=${descargados.VALES}
            onClick=${() => exportarConDialogo(sesion, "VALES", (destino) => setDescargados((d) => ({ ...d, VALES: destino })), { corte: fecha })}
          />
          <${BotonArchivo}
            nombre=${nombreInventario}
            titulo="Inventario de refaccionamiento"
            detalle=${`Cerrado al ${fmtFecha(fecha)}`}
            disabled=${!nombreInventario}
            descargado=${descargados.INVENTARIO}
            onClick=${() => exportarConDialogo(sesion, "INVENTARIO", (destino) => setDescargados((d) => ({ ...d, INVENTARIO: destino })), { corte: fecha })}
          />
        </div>
        <p class="nota">Salen sobre tus plantillas, igual que en Exportar y enviar.</p>
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
                (e) => html`<li><a href=${`#entrada/${e.vale.id}`}>${e.folio}</a> · vale ${e.folio_externo || "—"}${e.origen ? ` de ${e.origen}` : ""} · ${e.partidas} partidas</li>`,
              )}
            </ul>`
          : html`<p class="nota">Sin entradas este día.</p>`}
      </section>
    <//>
  `;
}
