// Vale de salida a partir de otro vale (Ronda 33): la ventana para buscarlo desde *Vales de salida*
// y la acción compartida con el detalle de la entrada o del vale y con el historial.

import { useMemo, useState } from "preact/hooks";
import { fechaDelDia, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { borradorDesdeVale, buscarValesParaCopiar, deVale, folioDeVale } from "../../servicios/copiarVale.js";
import { areaDeVale } from "../../servicios/vales.js";
import { Pastilla, Ventana, useSesion } from "../componentes.js";
import { html } from "../html.js";

const partidasDe = (n) => `${n} ${n === 1 ? "partida" : "partidas"}`;
const conCodigo = (vale) => vale.lineas.filter((l) => Number.isInteger(l.codigo));

/**
 * Crea el borrador de salida con las partidas del vale y avisa qué revisar.
 * @returns el id del borrador
 */
export async function crearSalidaDesdeVale(sesion, valeId) {
  const r = await sesion.almacen.modificar((e) => {
    const { borrador, avisos, partidas } = borradorDesdeVale(e, valeId, { usuario: sesion.usuario });
    return { id: borrador.id, avisos, partidas };
  });
  const vale = sesion.estado.vales.find((v) => v.id === valeId);
  const siguiente = vale.tipo === "ENTRADA" ? "Elige el área que recibe y ajusta las cantidades a lo que se entregó." : "Revisa quién recibe y ajusta las cantidades.";
  const texto = `Vale nuevo con ${partidasDe(r.partidas)} ${deVale(vale)}. ${siguiente}`;
  if (r.avisos.length) sesion.avisar("advertencia", `${texto}\n${r.avisos.join("\n")}`, 15000);
  else sesion.avisar("exito", texto);
  return r.id;
}

/** Desde otra página: crea el borrador y abre su pestaña en *Vales de salida*. */
export function useSalidaDesdeVale() {
  const sesion = useSesion();
  return (valeId) =>
    sesion.tarea("Creando vale de salida…", async () => {
      const id = await crearSalidaDesdeVale(sesion, valeId);
      sesion.abrirBorrador("borradores", id, "vales");
    });
}

/** Las primeras descripciones del vale, para reconocerlo en la lista. */
function resumenPartidas(vale) {
  const descripciones = conCodigo(vale).map((l) => (l.descripcion || String(l.codigo)).trim());
  const primeras = descripciones.slice(0, 2).join(" · ");
  return descripciones.length > 2 ? `${primeras} · +${descripciones.length - 2}` : primeras;
}

function FilaVale({ estado, vale, por, hoy, alElegir }) {
  const n = conCodigo(vale).length;
  const entrada = vale.tipo === "ENTRADA";
  const area = entrada ? null : areaDeVale(estado, vale);
  const dia = fechaDelDia(vale);
  return html`<li>
    <button type="button" class="copiar-vale-fila" onClick=${() => alElegir(vale.id)} disabled=${!n}>
      <span class="copiar-vale-folio">
        <${Pastilla} tono=${entrada ? "info" : "neutro"}>${entrada ? "Entrada" : "Salida"}<//>
        <strong>${folioDeVale(vale)}</strong>
        ${entrada && vale.folio_externo ? html`<span>vale ${vale.folio_externo}${por === "base" ? " ✓" : ""}</span>` : null}
      </span>
      <span class="copiar-vale-datos">
        ${entrada ? (dia === hoy ? html`<${Pastilla} tono="ok">Recibida hoy<//>` : `Recibida ${fmtFecha(dia)} ·`) : null}
        ${[
          ...(entrada ? [vale.origen || "—"] : [fmtFecha(vale.fecha), area?.nombre ?? vale.depto_destino ?? "—", vale.recibio_nombre]),
          n ? partidasDe(n) : "sin partidas con código",
        ].filter(Boolean).join(" · ")}
      </span>
      <span class="nota copiar-vale-partidas">${resumenPartidas(vale)}</span>
    </button>
  </li>`;
}

/**
 * Buscar el vale (entrada o salida) del que salen las partidas. Sin escribir nada propone lo que se
 * recibió hoy y lo más reciente.
 */
export function VentanaCopiarVale({ alElegir, alCerrar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const hoy = hoyIso();
  const [consulta, setConsulta] = useState("");
  const hallados = useMemo(() => buscarValesParaCopiar(estado, consulta, { hoy }), [estado, consulta, hoy]);
  const deHoy = hallados.filter((h) => h.por === "hoy");
  const otros = hallados.filter((h) => h.por !== "hoy");
  const lista = (filas) => html`<ul class="copiar-vales">
    ${filas.map(({ vale, por }) => html`<${FilaVale} key=${vale.id} estado=${estado} vale=${vale} por=${por} hoy=${hoy} alElegir=${alElegir} />`)}
  </ul>`;
  return html`<${Ventana} titulo="Vale nuevo desde otro vale" clase="ventana-copiar-vale" alCerrar=${alCerrar}>
    <p class="nota">
      Las partidas pasan a un borrador de salida que sale de la misma partida del inventario. De una salida
      también se repiten el área y quién recibe. El vale original no cambia.
    </p>
    <label class="campo">
      <span>Folio de la entrada (E-0005), del vale de la base o del vale de salida</span>
      <input
        value=${consulta}
        onInput=${(e) => setConsulta(e.currentTarget.value)}
        onKeyDown=${(e) => {
          if (e.key === "Enter" && hallados.length === 1) alElegir(hallados[0].vale.id);
        }}
        placeholder="Ej. E-0005, 12345 o 1520"
        aria-label="Folio del vale"
        autofocus
      />
    </label>
    ${consulta.trim()
      ? hallados.length
        ? html`<p class="nota">Coinciden:</p>${lista(hallados)}`
        : html`<p class="vacio">No hay una entrada ni un vale de salida con ese folio.</p>`
      : html`
          ${deHoy.length ? html`<h3 class="copiar-vale-titulo">Recibido hoy</h3>${lista(deHoy)}` : null}
          ${otros.length ? html`<h3 class="copiar-vale-titulo">Lo más reciente</h3>${lista(otros)}` : null}
          ${!hallados.length ? html`<p class="vacio">Aún no hay entradas ni vales de salida.</p>` : null}
        `}
  <//>`;
}
