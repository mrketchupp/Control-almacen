import { useMemo, useState } from "preact/hooks";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { leerArchivoSubido, soportaGuardarComo } from "../../almacen/archivos.js";
import { leerVales } from "../../importadores/vales.js";
import { lineasPorUbicar } from "../../servicios/consultas.js";
import { importarValesNuevos, revisarValesNuevos } from "../../servicios/sincronizar.js";
import { valesPorEnviar } from "../../servicios/vales.js";
import { Aviso, Boton, ElegirArchivo, Tabla, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { seguirConArchivo } from "../inventario.js";
import { SubirSharePoint, exportarConDialogo } from "./sharepoint.js";

function TraerDelExcel() {
  const sesion = useSesion();
  const [vista, setVista] = useState(null);
  const revisar = (archivo) =>
    seguirConArchivo(sesion, archivo.name) &&
    sesion.tarea(`Leyendo ${archivo.name}…`, async () => {
      const libro = leerVales(await leerArchivoSubido(archivo), archivo.name);
      setVista({ nombre: archivo.name, libro, ...revisarValesNuevos(sesion.estado, libro) });
    });
  const importar = () =>
    sesion.tarea("Agregando vales…", async () => {
      const reporte = await sesion.almacen.modificar((e) => importarValesNuevos(e, vista.libro, sesion.usuario));
      setVista(null);
      sesion.avisar(
        "exito",
        `Se agregaron ${reporte.vales} vale(s): ${reporte.folios.join(", ") || "ninguno"}.${reporte.por_ubicar.length ? ` ${reporte.por_ubicar.length} partida(s) quedaron en Pendientes.` : ""}`,
      );
    });
  return html`<${Tarjeta} titulo="Traer vales hechos en el Excel">
    <p>
      Si después de la primera carga se siguieron haciendo vales en el libro de Excel, súbelo aquí: se agregan solo los
      folios mayores al último que conoce la herramienta, así el siguiente folio nunca choca con uno hecho en papel.
    </p>
    <div class="acciones-linea">
      <${ElegirArchivo} etiqueta="Elegir libro de vales (.xlsm)…" acepta=".xlsm,.xlsx" alElegir=${revisar} />
    </div>
    ${vista
      ? vista.folios.length
        ? html`<${Aviso} tipo="info" titulo=${`${vista.folios.length} vale(s) nuevo(s) en ${vista.nombre}`}>
            Folios ${vista.folios.join(", ")} (la herramienta llega hasta el ${vista.desde}).
            ${vista.resultado.omitidos.length ? html`<br />Se omitirán ${vista.resultado.omitidos.length} partida(s) sin folio o dañadas.` : null}
            <div class="acciones-linea">
              <${Boton} tipo="primario" onClick=${importar}>Agregar estos vales<//>
              <${Boton} onClick=${() => setVista(null)}>Cancelar<//>
            </div>
          <//>`
        : html`<${Aviso} tipo="exito">El Excel no tiene vales posteriores al folio ${vista.desde}. Todo está al día.<//>`
      : null}
  <//>`;
}

export function PaginaExportar() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const pendientes = useMemo(() => lineasPorUbicar(estado).length, [estado]);
  const [exportoVales, setExportoVales] = useState(false);
  const exportar = (tipo) => exportarConDialogo(sesion, tipo, () => tipo === "VALES" && setExportoVales(true));
  const destino = sesion.carpetaLista ? `${sesion.carpeta.name}/exportaciones/${hoyIso()}/` : "tu carpeta de Descargas";
  const conDialogo = soportaGuardarComo();
  const historial = [...estado.exportaciones].reverse().slice(0, 20);
  const porEnviar = valesPorEnviar(estado).length;
  const entradas = estado.vales.filter((v) => v.tipo === "ENTRADA").length;
  return html`
    <p class="introduccion">
      Se generan sobre <strong>tus propios archivos</strong> (las plantillas que subiste en la primera carga), así que
      conservan logos, botones, macros, formatos y la configuración de impresión.${" "}
      ${conDialogo
        ? "Al exportar se abre el explorador de archivos para que elijas la carpeta (recuerda la última que usaste)."
        : html`Se guardan en <code>${destino}</code>.`}
    </p>
    ${pendientes
      ? html`<${Aviso} tipo="advertencia" titulo=${`${pendientes} partida(s) por ubicar`}>
          El inventario exportado no descontará esas partidas hasta que las ubiques en <a href="#pendientes">Pendientes</a>.
        <//>`
      : null}
    <div class="rejilla-2">
      <${Tarjeta} titulo="Vales de salida (.xlsm)">
        <p>Reescribe solo la hoja <strong>DIARIO</strong> con el historial completo. Es el archivo que subes al SharePoint para la base.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("VALES")}>${conDialogo ? "Exportar vales…" : "Exportar vales"}<//>
        ${exportoVales && porEnviar
          ? html`<p class="nota">Cuando lo subas al SharePoint, márcalo abajo con "Ya lo subí".</p>`
          : null}
      <//>
      <${Tarjeta} titulo="Inventario (.xlsx)">
        <p>Actualiza CONSUMO e INGRESO por contenedor con los vales posteriores al conteo. El nombre lleva la fecha de hoy.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("INVENTARIO")}>${conDialogo ? "Exportar inventario…" : "Exportar inventario"}<//>
      <//>
      <${Tarjeta} titulo="Vales de entrada (.xlsx)">
        <p>
          Historial de entradas con las columnas del DIARIO (B = folio de la base, U = folio interno E-0001). Es un archivo nuevo;
          envíalo solo si la base lo pide.
        </p>
        <${Boton} disabled=${!entradas} onClick=${() => exportar("ENTRADAS")}>${conDialogo ? "Exportar entradas…" : "Exportar entradas"}<//>
        ${entradas ? null : html`<p class="nota">Aún no hay entradas registradas.</p>`}
      <//>
    </div>
    <${SubirSharePoint} />
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
    <${TraerDelExcel} />
  `;
}
