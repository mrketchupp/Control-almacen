import { useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { fechasConVales, nombreImagenesDelDia, reporteDelDia } from "../../servicios/reporte.js";
import { Boton, Pastilla, Tabla, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { SubirSharePoint } from "./sharepoint.js";
import { VistaPrevia } from "./vales.js";

export function fechaDeRuta(hash = location.hash) {
  const m = /^#reporte\/(\d{4}-\d{2}-\d{2})/.exec(hash);
  return m ? m[1] : null;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const diaSemana = (iso) => DIAS[new Date(`${iso}T12:00:00`).getDay()];

/** Reporte diario: vales del día como imágenes o PDF, y lo que falta subir al SharePoint. */
export function PaginaReporte() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [fecha, setFechaLocal] = useState(fechaDeRuta() ?? hoyIso());
  const [previa, setPrevia] = useState(null);
  const setFecha = (f) => {
    if (!f) return;
    setFechaLocal(f);
    history.replaceState(null, "", `#reporte/${f}`);
  };
  const reporte = useMemo(() => reporteDelDia(estado, fecha), [estado, fecha]);
  const fechas = useMemo(() => fechasConVales(estado), [estado.vales]);
  const anterior = fechas.find((f) => f < fecha);
  const siguiente = [...fechas].reverse().find((f) => f > fecha);
  const vales = reporte.salidas.map((s) => s.vale);

  const descargarImagenes = async () => {
    const nombre = nombreImagenesDelDia(fecha);
    let archivo;
    try {
      archivo = await sesion.elegirDestino(nombre);
    } catch (error) {
      sesion.avisar("error", `No se pudo abrir la ventana para guardar: ${error.message}`);
      return;
    }
    if (archivo === null) return;
    await sesion.tarea(`Dibujando ${vales.length} ${vales.length === 1 ? "vale" : "vales"}…`, async () => {
      const destino = await sesion.guardarImagenesVales(vales, nombre, archivo);
      sesion.avisar("exito", `Imágenes guardadas: ${destino}`);
    });
  };

  return html`
    <div class="barra-fecha">
      <${Boton} tipo="texto" disabled=${!anterior} onClick=${() => setFecha(anterior)} title="Día anterior con vales">◀<//>
      <label class="fecha-grande">
        <span class="nota">Día del reporte</span>
        <input type="date" value=${fecha} onChange=${(e) => setFecha(e.currentTarget.value)} aria-label="Fecha del reporte" />
      </label>
      <${Boton} tipo="texto" disabled=${!siguiente} onClick=${() => setFecha(siguiente)} title="Día siguiente con vales">▶<//>
      <span class="nota">${diaSemana(fecha)} ${fmtFecha(fecha)}${fecha === hoyIso() ? " · hoy" : ""}</span>
      ${fecha !== hoyIso() ? html`<${Boton} tipo="texto" onClick=${() => setFecha(hoyIso())}>Hoy<//>` : null}
    </div>

    <div class="bento bento-reporte">
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

      <section class="bento-celda bento-acciones">
        <header class="bento-cabeza"><h2>Imágenes y PDF</h2></header>
        <p class="nota">Cada vale tal como se imprime, sobre tu formato.</p>
        <${Boton} tipo="primario" disabled=${!vales.length} onClick=${descargarImagenes}>🖼 Descargar imágenes<//>
        <${Boton} disabled=${!vales.length} onClick=${() => setPrevia(vales)}>🖨 Ver / imprimir / PDF<//>
        <p class="nota">Una imagen PNG por vale, en un .zip con la fecha en el nombre.</p>
      </section>

      <section class="bento-celda">
        <header class="bento-cabeza"><h2>Subir al SharePoint</h2></header>
        <${SubirSharePoint} compacto=${true} />
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
    </div>
    ${previa ? html`<${VistaPrevia} vales=${previa} alCerrar=${() => setPrevia(null)} />` : null}
  `;
}

