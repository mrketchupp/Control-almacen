// Ronda 34 (docs/13-rediseno-vale-salida.md): piezas del vale de salida en 3 pasos — el indicador de pasos, el botón
// «Editar» de los resúmenes, el resumen de *Para quién* y el de *Material*, y la regla de Enter para avanzar. La página
// que las junta es `PaginaValesSalida` (vales.js); aquí no se importa nada de ella.

import { estadoDePasos, nombrePaso } from "../../servicios/pasosVale.js";
import { hoyIso } from "../../nucleo/fechas.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** '2026-11-21' → «Hoy · 21 nov» si es hoy; si no, «18 nov 2026». */
export function fechaCorta(iso, hoy = hoyIso()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso ?? "")) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  const dia = `${Number(d)} ${MESES[Number(m) - 1]}`;
  return iso.slice(0, 10) === hoy ? `Hoy · ${dia}` : `${dia} ${a}`;
}

/**
 * Indicador de los 3 pasos: completo = verde con ✓, actual = color principal, pendiente = gris. No se puede tocar
 * (principio 9): para regresar están «← Para quién» y los «Editar» de cada resumen. En ventana angosta se resume como
 * «Paso 2 de 3 · Material» sobre las 3 barras.
 */
export function PasosVale({ paso }) {
  const pasos = estadoDePasos(paso);
  return html`<div class="pasos-vale">
    <p class="pasos-corto" aria-hidden="true">Paso ${paso} de ${pasos.length} · ${nombrePaso(paso)}</p>
    <ol aria-label="Pasos del vale">
      ${pasos.map(
        (p) => html`<li key=${p.numero} class=${`paso-${p.estado}`} aria-current=${p.estado === "actual" ? "step" : undefined}>
          <span class="paso-nombre">${p.estado === "completo" ? html`<span aria-hidden="true">✓ </span>` : null}${p.numero} · ${p.nombre}</span>
          <span class="solo-lector">${p.estado === "completo" ? " (completo)" : p.estado === "pendiente" ? " (pendiente)" : " (actual)"}</span>
        </li>`,
      )}
    </ol>
  </div>`;
}

/** «✎ Editar»: la misma palabra para la misma acción en todos lados (§6). */
export function BotonEditar({ etiqueta, onClick }) {
  return html`<button type="button" class="boton-editar" aria-label=${etiqueta} title=${etiqueta} onClick=${onClick}>
    <${Icono} nombre="lapiz" tam=${15} /> Editar
  </button>`;
}

function DatoResumen({ etiqueta, children, falta = false }) {
  return html`<div class=${`dato-resumen ${falta ? "dato-falta" : ""}`}>
    <dt>${etiqueta}</dt>
    <dd>${children}</dd>
  </div>`;
}

/**
 * Lo elegido en *Para quién*, con «Editar» (principio 2). `datos`: { area, transferencia, destino, recibe, puesto,
 * fecha, entrega, folio }; lo que falta se ve como «—».
 */
export function ResumenParaQuien({ datos, alEditar, titulo = "Para quién" }) {
  const o = (v) => (v ? String(v) : "—");
  return html`<section class="resumen-vale" aria-label=${titulo}>
    <header class="resumen-cabeza">
      <h2>${titulo}</h2>
      <${BotonEditar} etiqueta="Editar para quién" onClick=${alEditar} />
    </header>
    <dl class="resumen-datos">
      ${datos.transferencia
        ? html`<${DatoResumen} etiqueta="Destino" falta=${!datos.destino}>${o(datos.destino)}<//>`
        : html`<${DatoResumen} etiqueta="Área" falta=${!datos.area}>${o(datos.area)}<//>`}
      <${DatoResumen} etiqueta="Recibe" falta=${!datos.recibe}>${o(datos.recibe)}<//>
      <${DatoResumen} etiqueta="Puesto">${o(datos.puesto)}<//>
      <${DatoResumen} etiqueta="Fecha">${fechaCorta(datos.fecha)}<//>
      <${DatoResumen} etiqueta="Entrega" falta=${!datos.entrega}>${datos.entrega || "Elige quién está en turno"}<//>
      <${DatoResumen} etiqueta="Folio">${datos.folio} <small>al emitir</small><//>
    </dl>
  </section>`;
}

/**
 * Las partidas del vale, una fila cada una: cantidad + UM · dimensión · NP · código · descripción (recortada; completa
 * al pasar el cursor) · lote. `partidas`: [{ cantidad, um, clave, np, codigo, descripcion, lote }].
 */
export function ResumenMaterial({ partidas, alEditar }) {
  return html`<section class="resumen-vale" aria-label="Material">
    <header class="resumen-cabeza">
      <h2>Material · ${partidas.length} ${partidas.length === 1 ? "partida" : "partidas"}</h2>
      <${BotonEditar} etiqueta="Editar material" onClick=${alEditar} />
    </header>
    ${partidas.length
      ? html`<ol class="resumen-partidas">
          ${partidas.map((p, i) => {
            const titulo = [p.codigo, p.descripcion, p.clave, p.np ? `NP ${p.np}` : null, p.lote ? `lote ${p.lote}` : null].filter(Boolean).join(" · ");
            return html`<li key=${i} title=${titulo}>
              <span class=${`resumen-cantidad ${p.cantidad ? "" : "falta"}`}>${p.cantidad || "sin cantidad"} ${p.cantidad ? p.um : ""}</span>
              <span class="resumen-clave">${p.clave || "—"}${p.np ? html`<span class="resumen-np"> · NP ${p.np}</span>` : null}</span>
              <span class="resumen-descripcion">${p.codigo ?? "—"} · ${p.descripcion || "—"}</span>
              <span class="resumen-lote">${p.lote ? `lote ${p.lote}` : "sin lote"}</span>
            </li>`;
          })}
        </ol>`
      : html`<p class="vacio">Todavía no hay partidas.</p>`}
  </section>`;
}

/**
 * ¿Este Enter es para avanzar al siguiente paso? Sí, salvo que el campo lo use para otra cosa: un texto de varias
 * líneas, un botón o enlace, una lista de sugerencias abierta, o lo que el paso marcó con `data-sin-avanzar` (las
 * partidas, donde Enter pasa de un campo al siguiente). Un campo con sugerencias cerradas sí avanza.
 */
export function enterParaAvanzar(e) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
  const t = e.target;
  if (!t || typeof t.closest !== "function") return false;
  if (t.closest("textarea, button, a, [role=option], [role=listbox], [data-sin-avanzar]")) return false;
  if (t.getAttribute("aria-expanded") === "true") return false;
  // Un combo cerrado también "usa" Enter (lo cancela), pero no hace nada con él: ese sí avanza.
  return !e.defaultPrevented || t.getAttribute("role") === "combobox";
}
