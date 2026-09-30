import { useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import {
  ErrorVale,
  bitacoraDeVale,
  cancelarVale,
  corregirVale,
  datosParaCorregir,
  esHistorial,
  plantillaArea,
  validarVale,
} from "../../servicios/vales.js";
import { Aviso, Boton, Dato, Insignia, Tabla, Tarjeta, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { EditorVale, ListaErrores, VistaPrevia } from "./vales.js";

const ACCIONES = { EMITIR: "Emitido", CORREGIR: "Corregido", CANCELAR: "Cancelado", UBICAR: "Ubicado" };

export function valeDeRuta() {
  const m = /^#vale\/(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function Correccion({ vale, alTerminar }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState(() => datosParaCorregir(sesion.estado, vale.id));
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState([]);
  const historial = esHistorial(sesion.estado, vale);
  const guardar = () =>
    sesion.tarea("Guardando corrección…", async () => {
      const faltan = [...validarVale(sesion.estado, datos, { excluirValeId: vale.id, historial }).errores];
      if (!motivo.trim()) faltan.push({ renglon: null, campo: "motivo", mensaje: "Escribe el motivo de la corrección." });
      setErrores(faltan);
      if (faltan.length) return;
      try {
        await sesion.almacen.modificar((e) => corregirVale(e, vale.id, datos, motivo, sesion.usuario));
        sesion.avisar("exito", `Vale ${vale.folio} corregido. Queda en la bitácora.`);
        alTerminar();
      } catch (error) {
        if (error instanceof ErrorVale) setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
        else throw error;
      }
    });
  return html`<${Tarjeta} titulo=${`Corregir vale ${vale.folio}`} clase="tarjeta-correccion">
    ${historial
      ? html`<${Aviso} tipo="info">Este vale es anterior al conteo físico: la corrección solo cambia el historial y el DIARIO; no mueve existencias.<//>`
      : null}
    <${EditorVale}
      datos=${datos}
      alCambiar=${setDatos}
      errores=${errores}
      excluirValeId=${vale.id}
      entrego=${{ nombre: vale.entrego_nombre || "—", puesto: vale.entrego_puesto || "" }}
      pie=${html`<label class="campo motivo">
          <span>Motivo de la corrección (obligatorio, queda en la bitácora)</span>
          <input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. se entregaron 3 piezas, no 2" />
        </label>
        <${ListaErrores} errores=${errores} />
        <div class="acciones-linea pie-editor">
          <${Boton} onClick=${alTerminar}>Cancelar<//>
          <span class="espaciador"></span>
          <${Boton} tipo="primario" onClick=${guardar}>Guardar corrección<//>
        </div>`}
    />
  <//>`;
}

export function PaginaVale() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const id = valeDeRuta();
  const vale = estado.vales.find((v) => v.id === id);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [previa, setPrevia] = useState(false);
  const indices = useMemo(() => new Indices(estado), [estado]);
  if (!vale) return html`<${Aviso} tipo="advertencia" titulo="No se encontró el vale">Vuelve al <a href="#historial">historial</a>.<//>`;

  const area = plantillaArea(estado, vale.plantilla_area_id);
  const cancelado = vale.estado === "CANCELADO";
  const lugar = (l) => {
    if (l.existencia_id === null || l.existencia_id === undefined) return l.no_inventariado ? "No inventariado" : esHistorial(estado, vale) ? "—" : "Por ubicar";
    const e = indices.existencia(l.existencia_id);
    const u = e && indices.ubicacion(e.ubicacion_id);
    return u ? u.hoja_excel.trim() : "—";
  };
  const cancelar = () => {
    const motivo = (window.prompt(`Motivo para cancelar el vale ${vale.folio} (el folio no se reutiliza y la existencia se devuelve):`) || "").trim();
    if (!motivo) return;
    return sesion.tarea("Cancelando…", async () => {
      await sesion.almacen.modificar((e) => cancelarVale(e, vale.id, motivo, sesion.usuario));
      sesion.avisar("exito", `Vale ${vale.folio} cancelado.`);
    });
  };
  const bitacora = bitacoraDeVale(estado, vale.id).reverse();

  return html`
    <div class="cabeza-vale">
      <div>
        <span class="folio-grande">Folio ${vale.folio}</span>
        <${Insignia} tono=${cancelado ? "error" : "ok"}>${cancelado ? "CANCELADO" : vale.estado}<//>
        ${vale.migrado ? html`<${Insignia}>Migrado del Excel<//>` : null}
        ${esHistorial(estado, vale) ? html`<${Insignia}>Anterior al conteo<//>` : null}
      </div>
      <div class="acciones-linea">
        <${Boton} tipo="primario" onClick=${() => setPrevia(true)}>🖨 Imprimir<//>
        ${!cancelado && !corrigiendo ? html`<${Boton} onClick=${() => setCorrigiendo(true)}>Corregir<//>` : null}
        ${!cancelado && !corrigiendo ? html`<${Boton} tipo="peligro-texto" onClick=${cancelar}>Cancelar vale<//>` : null}
        <a class="boton boton-texto" href="#historial">← Historial</a>
      </div>
    </div>
    ${cancelado ? html`<${Aviso} tipo="error" titulo="Vale cancelado">${fmtFechaHora(vale.cancelado_en)} · ${vale.motivo_cancelacion}<//>` : null}

    ${corrigiendo
      ? html`<${Correccion} vale=${vale} alTerminar=${() => setCorrigiendo(false)} />`
      : html`
          <div class="datos datos-texto">
            <${Dato} etiqueta="Fecha" valor=${fmtFecha(vale.fecha)} />
            <${Dato} etiqueta="Área" valor=${area?.nombre ?? "—"} detalle=${vale.naturaleza ?? ""} />
            <${Dato} etiqueta="Origen" valor=${vale.depto_origen || "—"} detalle=${vale.origen ?? ""} />
            <${Dato} etiqueta="Destino" valor=${vale.depto_destino || "—"} detalle=${vale.destino ?? ""} />
            <${Dato} etiqueta="Entregó" valor=${vale.entrego_nombre || "—"} detalle=${vale.entrego_puesto ?? ""} />
            <${Dato} etiqueta="Recibió" valor=${vale.recibio_nombre || "—"} detalle=${vale.recibio_puesto ?? ""} />
            ${vale.autorizo_nombre ? html`<${Dato} etiqueta="Autorizó" valor=${vale.autorizo_nombre} />` : null}
          </div>
          ${vale.observaciones ? html`<${Tarjeta} titulo="Observaciones"><p class="preformateado">${vale.observaciones}</p><//>` : null}
          <${Tarjeta} titulo=${`Renglones (${vale.lineas.length})`}>
            <${Tabla}
              filas=${vale.lineas}
              columnas=${[
                { clave: "renglon", titulo: "#", numero: true },
                { clave: "codigo", titulo: "Código", numero: true },
                { clave: "descripcion", titulo: "Descripción" },
                { clave: "clave", titulo: "Clave" },
                { titulo: "Cantidad", numero: true, render: (l) => num(aNumero(l.cantidad)) },
                { clave: "um", titulo: "UM" },
                { titulo: "O.C.", render: (l) => l.oc || "S/OC" },
                { clave: "lote", titulo: "Lote" },
                { titulo: "Salió de", render: (l) => lugar(l) },
                { titulo: "Notas", render: (l) => [l.justificacion && `Justificación: ${l.justificacion}`, l.notas].filter(Boolean).join(" · ") },
              ]}
            />
          <//>
        `}

    <${Tarjeta} titulo="Bitácora">
      ${bitacora.length
        ? html`<ul class="bitacora">
            ${bitacora.map(
              (a) => html`<li>
                <strong>${ACCIONES[a.accion] ?? a.accion}</strong> · ${fmtFechaHora(a.fecha_hora)} · ${a.usuario ?? "sin usuario"}
                ${a.accion === "CORREGIR" && a.antes?.motivo ? html`<div class="nota">Motivo: ${a.antes.motivo}</div>` : null}
                ${a.accion === "CANCELAR" ? html`<div class="nota">Motivo: ${a.despues?.motivo}</div>` : null}
              </li>`,
            )}
          </ul>`
        : html`<p class="nota">${vale.migrado ? "Vale migrado del Excel en la primera carga; sin cambios desde entonces." : "Sin movimientos."}</p>`}
    <//>

    ${previa ? html`<${VistaPrevia} vales=${[vale]} alCerrar=${() => setPrevia(false)} />` : null}
  `;
}
