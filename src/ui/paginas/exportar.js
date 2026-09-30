import { useMemo, useState } from "preact/hooks";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { leerArchivoSubido, soportaGuardarComo } from "../../almacen/archivos.js";
import { leerVales } from "../../importadores/vales.js";
import { lineasPorUbicar } from "../../servicios/consultas.js";
import { importarValesNuevos, revisarValesNuevos } from "../../servicios/sincronizar.js";
import { registrarEnvio, ultimoEnvio, valesPorEnviar } from "../../servicios/vales.js";
import { Aviso, Boton, ElegirArchivo, Tabla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";

const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };

function PorEnviar() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const pendientes = useMemo(() => valesPorEnviar(estado), [estado]);
  const ultimo = ultimoEnvio(estado);
  const marcar = () => {
    if (!confirmar(`¿Ya enviaste a la base el archivo de vales con ${pendientes.length} cambio(s)? Se marcarán como enviados.`)) return;
    return sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => registrarEnvio(e, sesion.usuario));
      sesion.avisar("exito", "Envío registrado.");
    });
  };
  return html`<${Tarjeta} titulo=${`Por enviar a la base (${pendientes.length})`}>
    <p class="nota">
      ${ultimo
        ? `Último envío: ${fmtFechaHora(ultimo.fecha_hora)}${ultimo.usuario ? ` · ${ultimo.usuario}` : ""}.`
        : "Aún no registras envíos desde la herramienta."}${" "}
      Aquí aparecen los vales nuevos, corregidos o cancelados desde entonces, para avisarle a la base qué cambió.
    </p>
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
          <div class="acciones-linea">
            <${Boton} onClick=${marcar}>✓ Ya lo envié: marcar como enviado<//>
          </div>`
      : html`<p class="ok">Nada pendiente de enviar.</p>`}
  <//>`;
}

function TraerDelExcel() {
  const sesion = useSesion();
  const [vista, setVista] = useState(null);
  const revisar = (archivo) =>
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
        `Se agregaron ${reporte.vales} vale(s): ${reporte.folios.join(", ") || "ninguno"}.${reporte.por_ubicar.length ? ` ${reporte.por_ubicar.length} renglón(es) quedaron en Pendientes.` : ""}`,
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
            ${vista.resultado.omitidos.length ? html`<br />Se omitirán ${vista.resultado.omitidos.length} renglón(es) sin folio o dañados.` : null}
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
  const exportar = async (tipo) => {
    // Primero "Guardar como" (tiene que abrirse directo desde el clic); luego se genera el archivo.
    let archivo;
    try {
      archivo = await sesion.elegirDestinoExportacion(tipo);
    } catch (error) {
      sesion.avisar("error", `No se pudo abrir la ventana para guardar: ${error.message}`);
      return;
    }
    if (archivo === null) return; // canceló
    await sesion.tarea("Generando Excel…", async () => {
      const destino = await sesion.exportar(tipo, archivo);
      sesion.avisar("exito", `Listo: ${destino}`);
      if (tipo === "VALES") setExportoVales(true);
    });
  };
  const destino = sesion.carpetaLista ? `${sesion.carpeta.name}/exportaciones/${hoyIso()}/` : "tu carpeta de Descargas";
  const conDialogo = soportaGuardarComo();
  const historial = [...estado.exportaciones].reverse().slice(0, 20);
  const porEnviar = valesPorEnviar(estado).length;
  return html`
    <p class="introduccion">
      Se generan sobre <strong>tus propios archivos</strong> (las plantillas que subiste en la primera carga), así que
      conservan logos, botones, macros, formatos y la configuración de impresión.${" "}
      ${conDialogo
        ? "Al exportar se abre el explorador de archivos para que elijas la carpeta (recuerda la última que usaste)."
        : html`Se guardan en <code>${destino}</code>.`}
    </p>
    ${pendientes
      ? html`<${Aviso} tipo="advertencia" titulo=${`${pendientes} renglón(es) por ubicar`}>
          El inventario exportado no descontará esos renglones hasta que los ubiques en <a href="#pendientes">Pendientes</a>.
        <//>`
      : null}
    <div class="rejilla-2">
      <${Tarjeta} titulo="Vales de salida (.xlsm)">
        <p>Reescribe solo la hoja <strong>DIARIO</strong> con el historial completo. Es el archivo que envías a la base.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("VALES")}>${conDialogo ? "Exportar vales…" : "Exportar vales"}<//>
        ${exportoVales && porEnviar
          ? html`<p class="nota">Cuando lo envíes por correo, márcalo como enviado abajo.</p>`
          : null}
      <//>
      <${Tarjeta} titulo="Inventario (.xlsx)">
        <p>Actualiza CONSUMO e INGRESO por contenedor con los vales posteriores al conteo. El nombre lleva la fecha de hoy.</p>
        <${Boton} tipo="primario" onClick=${() => exportar("INVENTARIO")}>${conDialogo ? "Exportar inventario…" : "Exportar inventario"}<//>
      <//>
    </div>
    <${PorEnviar} />
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
