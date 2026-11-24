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
    <${Icono} nombre="lapiz" tam=${15} /><span class="boton-editar-texto">Editar</span>
  </button>`;
}

function DatoResumen({ etiqueta, children, falta = false, pendiente = null, alIr = null }) {
  return html`<div class=${`dato-resumen ${falta || pendiente ? "dato-falta" : ""}`}>
    <dt>${etiqueta}</dt>
    <dd>${children}${pendiente && pendiente.paso && alIr
      ? html` <button type="button" class="enlace-boton corregir-dato" aria-label=${`Corregir: ${pendiente.corto}`} onClick=${() => alIr(pendiente)}>Corregir</button>`
      : null}</dd>
  </div>`;
}

/** Lo que falta, marcado donde se ve (Ronda 35): ⚠ el texto corto y, si se puede, su botón para corregirlo. */
function LineaPendiente({ p, alIr, boton = "Corregir" }) {
  return html`<li class="pendiente-linea">
    <span class="pendiente-texto"><span aria-hidden="true">⚠ </span>${p.corto ?? p.mensaje}</span>
    ${p.paso && alIr ? html`<button type="button" class="boton boton-secundario boton-chico" onClick=${() => alIr(p)}>${boton}</button>` : null}
  </li>`;
}

// Qué fila del resumen de *Para quién* marca cada dato que falta (Ronda 35); lo demás va abajo de la tarjeta.
const FILA_DEL_CAMPO = { depto_destino: "area", recibio_nombre: "recibe", fecha: "fecha", entrego_nombre: "entrega", autorizo_nombre: "autoriza", etapa_perforacion: "etapa" };

/**
 * Lo elegido en *Para quién*, con «Editar» (principio 2). `datos`: { area, transferencia, destino, recibe, puesto,
 * autoriza, etapa, fecha, entrega, folio }; lo que falta se ve como «—». `autoriza` / `etapa` (null = no aplica) se
 * ven en el paso 3. `pendientes` (paso 3): lo que falta de este paso se marca en su fila con «Corregir» (`alIr`).
 */
export function ResumenParaQuien({ datos, alEditar, titulo = "Para quién", pendientes = [], alIr = null }) {
  const o = (v) => (v ? String(v) : "—");
  const enFila = new Map();
  const sueltos = [];
  for (const p of pendientes) {
    const fila = FILA_DEL_CAMPO[p.campo];
    if (fila && !enFila.has(fila)) enFila.set(fila, p);
    else if (!fila) sueltos.push(p);
  }
  const fila = (clave, etiqueta, valor, falta = false) =>
    html`<${DatoResumen} etiqueta=${etiqueta} falta=${falta} pendiente=${enFila.get(clave) ?? null} alIr=${alIr}>${valor}<//>`;
  const conPendiente = enFila.size > 0 || sueltos.length > 0;
  return html`<section class=${`resumen-vale ${conPendiente ? "con-pendiente" : ""}`} aria-label=${titulo}>
    <header class="resumen-cabeza">
      <h2>${titulo}</h2>
      <${BotonEditar} etiqueta="Editar para quién" onClick=${alEditar} />
    </header>
    <dl class="resumen-datos">
      ${datos.transferencia ? fila("area", "Destino", o(datos.destino), !datos.destino) : fila("area", "Área", o(datos.area), !datos.area)}
      ${fila("recibe", "Recibe", o(datos.recibe), !datos.recibe)}
      <${DatoResumen} etiqueta="Puesto">${o(datos.puesto)}<//>
      ${datos.autoriza !== null && datos.autoriza !== undefined ? fila("autoriza", "Autoriza", o(datos.autoriza), !datos.autoriza) : null}
      ${datos.etapa !== null && datos.etapa !== undefined ? fila("etapa", "Etapa", o(datos.etapa), !datos.etapa) : null}
      ${fila("fecha", "Fecha", fechaCorta(datos.fecha))}
      ${fila("entrega", "Entrega", datos.entrega || "Elige quién está en turno", !datos.entrega)}
      <${DatoResumen} etiqueta="Folio">${datos.folio} <small>al emitir</small><//>
    </dl>
    ${sueltos.length ? html`<ul class="pendientes-tarjeta">${sueltos.map((p, i) => html`<${LineaPendiente} key=${i} p=${p} alIr=${alIr} />`)}</ul>` : null}
    <p class="resumen-linea" aria-hidden="true">
      ${[datos.transferencia ? datos.destino : datos.area, datos.recibe, fechaCorta(datos.fecha)].filter(Boolean).join(" · ") || "Falta elegir para quién"}
    </p>
  </section>`;
}

/**
 * Las partidas del vale, una fila cada una (Ronda 35, pedido del usuario): cantidad + UM · código y descripción
 * (recortada; completa al pasar el cursor) · la dimensión, con «NP:», «Lote:» y «O.C.:» a su lado si tienen.
 * `partidas`: [{ uid, cantidad, um, clave, np, codigo, descripcion, lote, oc, justificacion }]. `pendientes` (paso 3):
 * lo que falta de cada partida va en su fila con «Ir a la partida» / «Corregir» (`alIr`); la justificación de lo que
 * sale de más se escribe en el paso 2 y aquí solo se lee.
 */
export function ResumenMaterial({ partidas, alEditar, pendientes = [], alIr = null }) {
  const porPartida = new Map();
  for (const p of pendientes) if (p.donde === "partida" && p.uid) porPartida.set(p.uid, [...(porPartida.get(p.uid) ?? []), p]);
  const generales = pendientes.filter((p) => p.donde === "material");
  const porResolver = pendientes.filter((p) => p.pendiente && (p.donde === "partida" || p.donde === "material")).length;
  return html`<section class=${`resumen-vale ${porResolver ? "con-pendiente" : ""}`} aria-label="Material">
    <header class="resumen-cabeza">
      <h2>Material · ${partidas.length} ${partidas.length === 1 ? "partida" : "partidas"}</h2>
      ${porResolver ? html`<span class="pastilla pastilla-alerta">${porResolver} por resolver</span>` : null}
      <${BotonEditar} etiqueta="Editar material" onClick=${alEditar} />
    </header>
    ${partidas.length
      ? html`<ol class="resumen-partidas">
          <li class="resumen-encabezado" aria-hidden="true"><span>Cantidad</span><span>Código y descripción</span><span>Dimensión</span></li>
          ${partidas.map((p, i) => {
            const suyos = porPartida.get(p.uid) ?? [];
            const titulo = [p.codigo, p.descripcion, p.clave, p.np ? `NP ${p.np}` : null, p.lote ? `Lote ${p.lote}` : null, p.oc ? `O.C. ${p.oc}` : null].filter(Boolean).join(" · ");
            return html`<li key=${p.uid ?? i} class=${suyos.some((x) => x.pendiente) ? "con-pendiente" : ""}>
              <span class=${`resumen-cantidad ${p.cantidad ? "" : "falta"}`}>${p.cantidad || "sin cantidad"} ${p.cantidad ? p.um : ""}</span>
              <span class="resumen-descripcion" title=${titulo}><span class="resumen-codigo">${p.codigo ?? "—"}</span> · ${p.descripcion || "—"}</span>
              <span class="resumen-clave">
                <span class="resumen-dimension">${p.clave || "—"}</span>
                ${p.np ? html`<span class="resumen-dato">NP: ${p.np}</span>` : null}
                ${p.lote ? html`<span class="resumen-dato">Lote: ${p.lote}</span>` : null}
                ${p.oc ? html`<span class="resumen-dato">O.C.: ${p.oc}</span>` : null}
              </span>
              ${suyos.map((x) =>
                x.tipo === "justificacion" && !x.pendiente
                  ? html`<p key=${`j${p.uid}`} class="resumen-justificacion"><span>Justificación:</span> ${p.justificacion}</p>`
                  : html`<ul key=${x.campo} class="pendientes-tarjeta">
                      <${LineaPendiente} p=${x} alIr=${alIr} boton=${x.tipo === "cantidad" || x.tipo === "justificacion" ? "Ir a la partida" : "Corregir"} />
                    </ul>`,
              )}
            </li>`;
          })}
        </ol>`
      : html`<p class="vacio">Todavía no hay partidas.</p>`}
    ${generales.length ? html`<ul class="pendientes-tarjeta">${generales.map((p, i) => html`<${LineaPendiente} key=${i} p=${p} alIr=${alIr} />`)}</ul>` : null}
  </section>`;
}

/**
 * ¿Este Enter es para avanzar al siguiente paso? Sí, salvo que el campo lo use para otra cosa: un texto de varias
 * líneas, un botón o enlace, una lista de sugerencias abierta, o lo que el paso marcó con `data-sin-avanzar` (las
 * partidas, donde Enter pasa de un campo al siguiente). Un campo con sugerencias cerradas sí avanza.
 */
export function enterParaAvanzar(e, { abiertaAlPresionar = false } = {}) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return false;
  const t = e.target;
  if (!t || typeof t.closest !== "function") return false;
  if (t.closest("textarea, button, a, [role=option], [role=listbox], [data-sin-avanzar]")) return false;
  // La lista se cierra al elegir antes de que el Enter llegue aquí: cuenta cómo estaba al presionar (`enterAlBajar`).
  if (abiertaAlPresionar || t.getAttribute("aria-expanded") === "true") return false;
  // Un combo cerrado también "usa" Enter (lo cancela), pero no hace nada con él: ese sí avanza.
  return !e.defaultPrevented || t.getAttribute("role") === "combobox";
}

/** Al bajar (fase de captura, antes que el campo): ¿el Enter llegó con una lista de sugerencias abierta? */
export const enterAlBajar = (e) => e.key === "Enter" && e.target?.getAttribute?.("aria-expanded") === "true";
