import { useMemo } from "preact/hooks";
import { fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { lineasPorUbicar } from "../../servicios/consultas.js";
import { Aviso, Boton, Tabla, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";

export function PaginaExportar() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const pendientes = useMemo(() => lineasPorUbicar(estado).length, [estado]);
  const exportar = (tipo) =>
    sesion.tarea("Generando Excel…", async () => {
      const destino = await sesion.exportar(tipo);
      sesion.avisar("exito", `Listo: ${destino}`);
    });
  const destino = sesion.carpetaLista ? `${sesion.carpeta.name}/exportaciones/${hoyIso()}/` : "tu carpeta de Descargas";
  const historial = [...estado.exportaciones].reverse().slice(0, 20);
  return html`
    <p class="introduccion">
      Se generan sobre <strong>tus propios archivos</strong> (las plantillas que subiste en la primera carga), así que
      conservan logos, botones, macros, formatos y la configuración de impresión. Se guardan en <code>${destino}</code>.
    </p>
    ${pendientes
      ? html`<${Aviso} tipo="advertencia" titulo=${`${pendientes} renglón(es) por ubicar`}>
          El inventario exportado no descontará esos renglones hasta que los ubiques en <a href="#pendientes">Pendientes</a>.
        <//>`
      : null}
    <div class="rejilla-2">
      <${Tarjeta} titulo="Vales de salida (.xlsm)">
        <p>Reescribe solo la hoja <strong>DIARIO</strong> con el historial completo. Es el archivo que envías a la base.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("VALES")}>Exportar vales<//>
      <//>
      <${Tarjeta} titulo="Inventario (.xlsx)">
        <p>Actualiza CONSUMO e INGRESO por contenedor con los vales posteriores al conteo. El nombre lleva la fecha de hoy.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("INVENTARIO")}>Exportar inventario<//>
      <//>
    </div>
    <${Tarjeta} titulo="Exportaciones recientes">
      <${Tabla}
        filas=${historial}
        vacia="Aún no has exportado."
        columnas=${[
          { titulo: "Fecha", render: (e) => fmtFechaHora(e.fecha_hora) },
          { clave: "tipo", titulo: "Tipo" },
          { clave: "archivo", titulo: "Archivo" },
          { clave: "usuario", titulo: "Usuario" },
          { clave: "ultimo_folio", titulo: "Último folio", numero: true },
        ]}
      />
    <//>
  `;
}
