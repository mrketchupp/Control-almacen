import { useMemo } from "preact/hooks";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import { registrarEnvio, ultimoEnvio, valesPorEnviar } from "../../servicios/vales.js";
import { Boton, Tabla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";

const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };

/**
 * Exporta un libro: primero "Guardar como" (tiene que abrirse directo desde el clic), luego se
 * genera el archivo. tipo: 'VALES' | 'INVENTARIO' | 'ENTRADAS'. corte: AAAA-MM-DD para el libro
 * como estaba al cierre de ese día (reporte diario).
 */
export async function exportarConDialogo(sesion, tipo, alTerminar = null, { corte = null } = {}) {
  let archivo;
  try {
    archivo = await sesion.elegirDestinoExportacion(tipo, { corte });
  } catch (error) {
    sesion.avisar("error", `No se pudo abrir la ventana para guardar: ${error.message}`);
    return;
  }
  if (archivo === null) return; // canceló
  await sesion.tarea("Generando Excel…", async () => {
    const destino = await sesion.exportar(tipo, archivo, { corte });
    sesion.avisar("exito", `Listo: ${destino}`);
    alTerminar?.(destino);
  });
}

/**
 * Botón de completado: "ya subí el libro de vales al SharePoint". Con hastaFolio (reporte de un
 * día) solo se marcan los vales hasta ese folio; los posteriores siguen pendientes.
 */
export function BotonSubido({ pendientes, tamano = "", hastaFolio = null }) {
  const sesion = useSesion();
  const marcar = () => {
    const hasta = hastaFolio ? ` (hasta el folio ${hastaFolio})` : "";
    if (!confirmar(`¿Ya subiste al SharePoint el libro de vales${hasta} con ${pendientes} cambio(s)? Se marcarán como subidos.`)) return;
    return sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => registrarEnvio(e, sesion.usuario, { hastaFolio }));
      sesion.avisar("exito", "Listo: marcado como subido al SharePoint.");
    });
  };
  return html`<${Boton} tipo="primario" tamano=${tamano} onClick=${marcar}>✓ Ya lo subí<//>`;
}

/**
 * Vales nuevos o corregidos desde la última vez que se subió el libro al SharePoint (RF-21).
 * compacto: versión para el inicio (folios en pastillas y los dos botones).
 */
export function SubirSharePoint({ compacto = false }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const pendientes = useMemo(() => valesPorEnviar(estado), [estado]);
  const ultimo = ultimoEnvio(estado);
  const ultimoTexto = ultimo ? `Última vez: ${fmtFechaHora(ultimo.fecha_hora)}${ultimo.usuario ? ` · ${ultimo.usuario}` : ""}.` : "Aún no se ha marcado ninguna subida.";
  if (compacto) {
    return html`<div class="sharepoint-compacto">
      ${pendientes.length
        ? html`<div class="folios-pendientes">
              ${pendientes.slice(0, 12).map(
                (p) => html`<a class=${`chip-folio chip-${p.motivo}`} href=${`#vale/${p.vale.id}`} title=${MOTIVOS[p.motivo]}>${p.vale.folio}</a>`,
              )}
              ${pendientes.length > 12 ? html`<span class="nota">y ${pendientes.length - 12} más</span>` : null}
            </div>
            <div class="acciones-linea">
              <${Boton} onClick=${() => exportarConDialogo(sesion, "VALES")}>⬇ Libro de vales<//>
              <${BotonSubido} pendientes=${pendientes.length} />
            </div>`
        : html`<p class="ok">✓ Todo está subido.</p>`}
      <p class="nota">${ultimoTexto}</p>
    </div>`;
  }
  return html`<${Tarjeta} titulo=${`Por subir al SharePoint (${pendientes.length})`}>
    <p class="nota">${ultimoTexto} Aquí aparecen los vales nuevos o corregidos desde entonces, para avisarle a la base qué cambió.</p>
    ${pendientes.length
      ? html`<${Tabla}
            filas=${pendientes.map((p) => ({ id: p.vale.id, folio: p.vale.folio, fecha: fmtFecha(p.vale.fecha), destino: p.vale.depto_destino ?? "", motivo: MOTIVOS[p.motivo] }))}
            columnas=${[
              { titulo: "Folio", numero: true, render: (f) => html`<a class="enlace-folio" href=${`#vale/${f.id}`}>${f.folio}</a>` },
              { clave: "fecha", titulo: "Fecha" },
              { clave: "destino", titulo: "Área" },
              { clave: "motivo", titulo: "Cambio" },
            ]}
          />
          <div class="acciones-linea"><${BotonSubido} pendientes=${pendientes.length} /></div>`
      : html`<p class="ok">✓ Todo está subido.</p>`}
  <//>`;
}
