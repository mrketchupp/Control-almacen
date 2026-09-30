import { useEffect, useState } from "preact/hooks";
import { fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { descargar, leerArchivoSubido, leerDeCarpeta } from "../../almacen/archivos.js";
import { leerRespaldo } from "../../almacen/respaldos.js";
import { CARPETA_RESPALDOS } from "../sesion.js";
import { Aviso, Boton, ElegirArchivo, Tabla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { EstadoAlmacenamiento } from "./inicio.js";

const MB = 1048576;

const MOTIVOS = {
  inicio: "Automático (inicio del día)",
  exportacion: "Automático (después de exportar)",
  "primera-carga": "Primera carga",
  manual: "Manual",
  "antes-de-restaurar": "Antes de restaurar",
  "antes-de-borrar": "Antes de borrar",
  descarga: "Descarga",
};

export const motivoLegible = (motivo) => MOTIVOS[motivo] || motivo.replace(/-/g, " ");

function haceCuanto(fechaHora) {
  const dias = Math.round((Date.parse(hoyIso()) - Date.parse(fechaHora.slice(0, 10))) / 86400000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

/** Pide confirmación mostrando qué contiene el respaldo y luego restaura. */
export function restaurarConConfirmacion(sesion, datos, origen, alTerminar = async () => {}) {
  let resumen = "";
  try {
    const { manifiesto } = leerRespaldo(datos);
    resumen = `\n\nContiene: ${manifiesto.vales ?? "?"} vales y ${manifiesto.existencias ?? "?"} renglones de inventario (${fmtFechaHora(manifiesto.fecha_hora || "")}).`;
  } catch (error) {
    sesion.avisar("error", error.message);
    return undefined;
  }
  const aviso = sesion.almacen.vacio
    ? `¿Restaurar ${origen}?${resumen}`
    : `¿Restaurar ${origen}?${resumen}\n\nLos datos actuales se reemplazan (antes se crea un respaldo de ellos).`;
  if (!confirmar(aviso)) return undefined;
  return sesion.tarea("Restaurando…", async () => {
    const manifiesto = await sesion.restaurar(datos);
    sesion.avisar("exito", `Restaurado el respaldo del ${fmtFechaHora(manifiesto.fecha_hora || "")}.`);
    await alTerminar();
  });
}

/** El respaldo más reciente de la carpeta (o null). */
export function useRespaldoReciente(sesion) {
  const [reciente, setReciente] = useState(null);
  useEffect(() => {
    let vigente = true;
    sesion
      .listarRespaldos()
      .then((lista) => vigente && setReciente(lista[0] ?? null))
      .catch(() => vigente && setReciente(null));
    return () => {
      vigente = false;
    };
  }, [sesion.permiso, sesion.carpeta]);
  return reciente;
}

/** El respaldo más reciente, en grande, con su botón de restaurar. */
export function RespaldoReciente({ respaldo, alRestaurar }) {
  return html`<div class="respaldo-reciente">
    <div>
      <span class="dato-etiqueta">Respaldo más reciente</span>
      <span class="respaldo-fecha">${fmtFechaHora(respaldo.info.fecha_hora)}</span>
      <span class="dato-detalle">${haceCuanto(respaldo.info.fecha_hora)} · ${motivoLegible(respaldo.info.motivo)} · ${(respaldo.tamano / MB).toFixed(1)} MB</span>
    </div>
    <${Boton} tipo="primario" tamano="grande" onClick=${alRestaurar}>↺ Restaurar este respaldo<//>
  </div>`;
}

export function PaginaRespaldos() {
  const sesion = useSesion();
  const [respaldos, setRespaldos] = useState([]);
  const [copias, setCopias] = useState([]);
  const vacio = sesion.almacen.vacio;

  const refrescar = async () => {
    try {
      setRespaldos(await sesion.listarRespaldos());
    } catch (error) {
      setRespaldos([]);
      console.warn(error);
    }
    setCopias(await sesion.backend.listarInstantaneas());
  };
  useEffect(() => {
    refrescar();
  }, [sesion.permiso, sesion.carpeta, sesion.ultimoRespaldo, sesion.estado]);

  const restaurarDatos = (datos, origen) => restaurarConConfirmacion(sesion, datos, origen, refrescar);

  const respaldarAhora = () =>
    sesion.tarea("Creando respaldo…", async () => {
      const destino = await sesion.respaldar("manual");
      sesion.avisar("exito", `Respaldo guardado en ${destino}`);
      await refrescar();
    });

  const borrarTodo = () => {
    const texto = window.prompt(
      "Esto borra TODOS los datos de la herramienta en este navegador (se crea antes un respaldo). Escribe BORRAR para confirmar:",
    );
    if (texto !== "BORRAR") return;
    return sesion.tarea("Borrando…", async () => {
      if (!vacio) await sesion.respaldar("antes-de-borrar");
      await sesion.almacen.borrarTodo();
      await sesion.backend.guardarAjuste("ultimo_respaldo", null);
      sesion.ultimoRespaldo = null;
      sesion.avisar("exito", "Datos borrados de este navegador. La herramienta quedó vacía.");
      location.hash = "#inicio";
    });
  };

  return html`
    <${Tarjeta} titulo="Carpeta de respaldos">
      ${sesion.soportaCarpetas
        ? html`
            <p>
              Elige una carpeta dentro de <strong>OneDrive</strong> (por ejemplo <code>OneDrive\\ControlAlmacen</code>).
              Ahí se crea un respaldo al día, otro después de cada exportación, y se guardan los Excel exportados. Se
              conservan los últimos 30 días y 12 meses.
            </p>
            <div class="acciones-linea">
              <${Boton} tipo=${sesion.carpeta ? "secundario" : "primario"} onClick=${() => sesion.tarea("Eligiendo carpeta…", () => sesion.elegirCarpeta())}>
                ${sesion.carpeta ? "Cambiar carpeta" : "Elegir carpeta"}
              <//>
              ${sesion.carpeta && sesion.permiso !== "granted"
                ? html`<${Boton} tipo="primario" onClick=${() => sesion.tarea("Pidiendo permiso…", () => sesion.activarCarpeta())}>Permitir acceso a ${sesion.carpeta.name}<//>`
                : null}
              ${sesion.carpeta ? html`<span>Actual: <code>${sesion.carpeta.name}</code> ${sesion.permiso === "granted" ? html`<span class="ok">✓ lista</span>` : html`<span class="alerta">sin permiso</span>`}</span>` : null}
            </div>
          `
        : html`<${Aviso} tipo="advertencia">Este navegador no permite elegir carpetas. Usa Microsoft Edge o Google Chrome para respaldos automáticos; mientras tanto los respaldos se descargan.<//>`}
    <//>

    ${!vacio
      ? html`<${Tarjeta} titulo="Respaldar">
          <p>
            Último respaldo: <strong>${sesion.ultimoRespaldo ? `${fmtFechaHora(sesion.ultimoRespaldo.fecha_hora)} → ${sesion.ultimoRespaldo.destino}` : "ninguno"}</strong>
          </p>
          <div class="acciones-linea">
            <${Boton} tipo="primario" onClick=${respaldarAhora}>Respaldar ahora<//>
            ${sesion.carpetaLista
              ? html`<${Boton} onClick=${() => sesion.tarea("Preparando descarga…", async () => {
                  const r = await sesion.almacen.respaldo("descarga");
                  descargar(r.nombre, r.datos);
                })}>Descargar una copia<//>`
              : null}
          </div>
        <//>`
      : null}

    <${Tarjeta} titulo="Restaurar">
      <p>Reemplaza los datos de este navegador por los de un respaldo (.zip). Útil al cambiar de equipo o de navegador.</p>
      ${respaldos.length
        ? html`<${RespaldoReciente}
            respaldo=${respaldos[0]}
            alRestaurar=${async () =>
              restaurarDatos(await leerDeCarpeta(sesion.carpeta, CARPETA_RESPALDOS, respaldos[0].nombre), respaldos[0].nombre)}
          />`
        : sesion.carpetaLista
          ? html`<p class="nota">No hay respaldos en <code>${sesion.carpeta.name}/${CARPETA_RESPALDOS}</code>.</p>`
          : null}
      <div class="acciones-linea">
        <${ElegirArchivo} etiqueta="↥ Restaurar desde un archivo…" acepta=".zip" alElegir=${async (archivo) => restaurarDatos(await leerArchivoSubido(archivo), archivo.name)} />
      </div>
      ${respaldos.length > 1
        ? html`<h3>Otros respaldos en la carpeta</h3>
            <${Tabla}
              limite=${15}
              filas=${respaldos.slice(1).map((r) => ({ ...r, id: r.nombre }))}
              columnas=${[
                { titulo: "Fecha", render: (r) => fmtFechaHora(r.info.fecha_hora) },
                { titulo: "Motivo", render: (r) => motivoLegible(r.info.motivo) },
                { titulo: "Tamaño", numero: true, render: (r) => `${(r.tamano / MB).toFixed(1)} MB` },
                {
                  titulo: "Acción",
                  render: (r) =>
                    html`<${Boton} tamano="chico" onClick=${async () =>
                      restaurarDatos(await leerDeCarpeta(sesion.carpeta, CARPETA_RESPALDOS, r.nombre), r.nombre)}>↺ Restaurar<//>`,
                },
              ]}
            />`
        : null}
      ${copias.length
        ? html`<h3>Copias internas del navegador</h3>
            <p class="nota">Se guardan solas al inicio de cada día y antes de restaurar (últimas 10). No sustituyen a los respaldos en OneDrive.</p>
            <${Tabla}
              filas=${copias.map((c) => ({ ...c, id: c.clave }))}
              columnas=${[
                { titulo: "Fecha", render: (c) => fmtFechaHora(c.fecha_hora) },
                { clave: "motivo", titulo: "Motivo" },
                {
                  titulo: "Acción",
                  render: (c) =>
                    html`<${Boton} tamano="chico" onClick=${() => {
                      if (!confirmar("¿Volver a esta copia interna? Los datos actuales se guardan antes como otra copia.")) return;
                      return sesion.tarea("Restaurando…", async () => {
                        await sesion.almacen.restaurarInstantanea(c.clave);
                        sesion.avisar("exito", "Copia interna restaurada.");
                      });
                    }}>↺ Volver a esta copia<//>`,
                },
              ]}
            />`
        : null}
    <//>

    <${EstadoAlmacenamiento} />

    ${!vacio
      ? html`<${Tarjeta} titulo="Zona de cuidado" clase="peligro">
          <p>Deja la herramienta vacía en este navegador (por ejemplo, después de una prueba). Antes se crea un respaldo.</p>
          <${Boton} tipo="peligro" onClick=${borrarTodo}>Borrar todos los datos de este navegador<//>
        <//>`
      : null}
  `;
}
