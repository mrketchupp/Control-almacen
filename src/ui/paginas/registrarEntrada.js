// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §7): paso 4 · Revisar y registrar. A la izquierda, sobre gris,
// *Dónde quedó cada partida*, agrupado por contenedor y con filtros (los contenedores que tienen partidas y *Sin
// existencia*); a la derecha *De dónde viene*, *Antes de registrar* (lo revisado, lo que solo informa y lo que impide
// registrar, con el botón que lleva a arreglarlo) y **Registrar entrada · E-000N**. No repite el vale completo: solo lo
// que hace falta para confirmar.

import { useMemo, useState } from "preact/hooks";
import { decTexto } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { acomodoDe, claseDeLinea } from "../../servicios/acomodoEntrada.js";
import { lineasEntradaCapturadas, vistaPreviaEntrada } from "../../servicios/entradas.js";
import { camposDeLinea } from "../../servicios/materialEntrada.js";
import { useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { PuntoTipo } from "./acomodo.js";
import { BotonEditar } from "./pasosVale.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const diaMes = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** *De dónde viene* (§7): viene de · folio, fecha del vale, recibido y quién entregó, con «Editar» (→ paso 1). */
export function ResumenOrigenEntrada({ datos, alEditar, titulo = "De dónde viene", marcados = null }) {
  const hoy = hoyIso();
  const dato = (clave, etiqueta, valor) => html`<div class=${`dato-resumen ${marcados?.has(clave) ? "dato-cambiado" : ""}`}><dt>${etiqueta}</dt><dd>${valor || "—"}</dd></div>`;
  return html`<section class="resumen-vale resumen-origen" aria-label=${titulo}>
    <header class="resumen-cabeza">
      <h2>${titulo}</h2>
      ${alEditar ? html`<${BotonEditar} etiqueta="Editar de dónde viene" onClick=${alEditar} />` : null}
    </header>
    <dl class="resumen-datos resumen-origen-datos">
      ${dato("origen", "Viene de · folio", [texto(datos.origen), texto(datos.folio_externo)].filter(Boolean).join(" · "))}
      ${dato("fecha", "Fecha del vale", datos.fecha ? fmtFecha(datos.fecha) : "")}
      ${dato("fecha_recibido", "Recibido", datos.fecha_recibido === hoy ? `Hoy · ${diaMes(hoy)}` : datos.fecha_recibido ? fmtFecha(datos.fecha_recibido) : "")}
      ${dato("entrego_nombre", "Entregó", texto(datos.entrego_nombre))}
    </dl>
  </section>`;
}

/**
 * *Dónde quedó cada partida* (§7): agrupadas por contenedor; cada fila con el punto de tipo, cantidad, dimensión · NP,
 * código · descripción y *hay → queda* («nueva → N», «no suma»). `excluirValeId`: en una corrección, lo que la entrada
 * ya sumaba no cuenta en «hay». `cambiadas`: uids marcados en ámbar (corrección).
 */
export function DondeQuedo({ datos, alEditar, excluirValeId = null, cambiadas = null, titulo = "Dónde quedó cada partida", grisEnSinLigar = false }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const partidas = lineasEntradaCapturadas(datos.lineas);
  const previa = useMemo(() => new Map(vistaPreviaEntrada(estado, datos, { excluirValeId }).map((p) => [p.uid, p])), [estado, datos, excluirValeId]);
  const [filtro, setFiltro] = useState("todos");
  const grupos = new Map();
  for (const l of partidas) {
    const a = acomodoDe(estado, l, { indices });
    const clave = a.estado === "acomodada" ? `c${a.contenedor}` : a.estado === "sin_existencia" ? "sin" : "falta";
    if (!grupos.has(clave)) grupos.set(clave, { clave, contenedor: a.contenedor ?? null, lineas: [] });
    grupos.get(clave).lineas.push(l);
  }
  const orden = [...grupos.values()].sort((a, b) => (a.clave === "falta" ? -1 : b.clave === "falta" ? 1 : a.clave === "sin" ? 1 : b.clave === "sin" ? -1 : a.contenedor - b.contenedor));
  const nombre = (g) => (g.clave === "sin" ? "Sin existencia" : g.clave === "falta" ? "Sin acomodar" : `#${g.contenedor}`);
  const visibles = filtro === "todos" ? orden : orden.filter((g) => g.clave === filtro);
  return html`<section class="donde-quedo" aria-labelledby="t-donde-quedo">
    <header class="donde-quedo-cabeza">
      <div class="donde-quedo-titulo">
        <h2 id="t-donde-quedo">${titulo}</h2>
        ${alEditar ? html`<${BotonEditar} etiqueta="Editar acomodo" onClick=${alEditar} />` : null}
      </div>
      ${orden.length > 1
        ? html`<div class="filtros-entrada" role="group" aria-label="Ver por contenedor">
            <button type="button" class=${`chip-filtro-entrada ${filtro === "todos" ? "activo" : ""}`} aria-pressed=${filtro === "todos"} onClick=${() => setFiltro("todos")}>Todos · ${partidas.length}</button>
            ${orden.map(
              (g) => html`<button type="button" key=${g.clave} class=${`chip-filtro-entrada ${filtro === g.clave ? "activo" : ""} ${g.clave === "falta" ? "con-pendiente" : ""}`}
                aria-pressed=${filtro === g.clave} onClick=${() => setFiltro(g.clave)}>${nombre(g)} · ${g.lineas.length}</button>`,
            )}
          </div>`
        : null}
    </header>
    <div class="donde-quedo-cuerpo">
      ${visibles.map(
        (g) => html`<div class="grupo-donde" key=${g.clave}>
          <h3 class=${`grupo-donde-cabeza ${g.clave === "falta" ? "falta" : ""}`}>
            ${g.clave.startsWith("c") ? html`<${Icono} nombre="caja" tam=${16} />` : null}
            ${g.clave === "sin" ? "Sin existencia · no suma" : g.clave === "falta" ? "Sin acomodar" : `Contenedor #${g.contenedor}`}
            <span class="nota"> · ${g.lineas.length}</span>
          </h3>
          <ul class="filas-donde">
            ${g.lineas.map((l) => {
              const c = camposDeLinea(l, indices);
              const p = previa.get(l.uid);
              const sinLigar = grisEnSinLigar && g.clave === "sin" && Number.isInteger(l.codigo);
              const cuanto = g.clave === "sin" ? (sinLigar ? "sin ligar al inventario · anterior al conteo" : "no suma") : g.clave === "falta" ? "falta acomodar" : p?.renglon_nuevo ? `nueva → ${decTexto(p.queda) ?? ""}` : p ? `${decTexto(p.habia) ?? "0"} → ${decTexto(p.queda) ?? ""}` : "";
              return html`<li key=${l.uid} class=${`fila-donde ${cambiadas?.has(l.uid) ? "cambiada" : ""} ${sinLigar ? "sin-ligar" : ""}`}>
                ${g.clave === "sin" ? html`<span class="punto-tipo punto-sin" aria-hidden="true"></span>` : html`<${PuntoTipo} clase=${claseDeLinea(l, indices) ?? "CONS"} />`}
                <span class="fila-donde-cantidad">${texto(l.cantidad) || "—"} ${texto(l.um)}</span>
                <span class="fila-donde-que">
                  <span class="clave-entrada">${l.no_inventariado ? texto(l.clave) || "S/D" : c.dimension || "S/D"}${c.np && !l.no_inventariado ? html` <span class="np-entrada">· NP ${c.np}</span>` : null}</span>
                  <span class="codigo-entrada" title=${l.descripcion}>${l.codigo ?? "—"} · ${l.descripcion || "—"}</span>
                </span>
                <span class=${`fila-donde-cuanto ${g.clave === "falta" ? "falta" : ""}`}>${cuanto}</span>
              </li>`;
            })}
          </ul>
        </div>`,
      )}
      ${partidas.length ? null : html`<p class="lista-vacia">La entrada no tiene partidas.</p>`}
    </div>
  </section>`;
}

/**
 * *Antes de registrar* (§7): ✓ lo revisado, en azul lo que solo informa y en ámbar lo que impide registrar, cada uno con
 * su botón (`alIr(pendiente)`).
 */
export function AntesDeRegistrar({ revision, alIr, titulo = "Antes de registrar" }) {
  return html`<section class="antes-registrar" aria-labelledby="t-antes">
    <h2 id="t-antes">${titulo}</h2>
    <ul class="lista-antes">
      ${revision.revisado.map(
        (r) => html`<li key=${r.id} class=${r.listo ? "listo" : "pendiente"}>
          <span class="marca-antes" aria-hidden="true">${r.listo ? "✓" : "!"}</span>
          <span>${r.texto}</span>
          ${!r.listo && r.id === "copilot" ? html`<button type="button" class="boton boton-secundario boton-chico" onClick=${() => alIr({ paso: 2, filtro: "revisar" })}>Revisar</button>` : null}
        </li>`,
      )}
      ${revision.bloquean.map(
        (b, i) => html`<li key=${`b${i}`} class="bloquea">
          <span class="marca-antes" aria-hidden="true">!</span>
          <span>${b.texto}</span>
          <button type="button" class="boton boton-secundario boton-chico" onClick=${() => alIr(b)}>${b.paso === 1 ? "Corregir" : b.paso === 3 ? "Acomodar" : "Ir a la partida"}</button>
        </li>`,
      )}
      ${revision.informa.map(
        (t, i) => html`<li key=${`i${i}`} class="informa">
          <span class="marca-antes" aria-hidden="true">i</span>
          <span>${t}</span>
        </li>`,
      )}
    </ul>
  </section>`;
}

/** Paso 4. `revision`: lo de `antesDeRegistrar`; `alRegistrar`; `alIrA(paso)`; `alIr(pendiente)`. */
export function PasoRegistrar({ datos, folio, revision, alRegistrar, alIrA, alIr }) {
  const bloquea = revision.bloquean.length > 0;
  return html`<div class="paso-registrar">
    <${DondeQuedo} datos=${datos} alEditar=${() => alIrA(3)} />
    <div class="registrar-der">
      <${ResumenOrigenEntrada} datos=${datos} alEditar=${() => alIrA(1)} />
      <${AntesDeRegistrar} revision=${revision} alIr=${alIr} />
      <div class="registrar-accion">
        <button type="button" class="boton boton-primario boton-registrar" disabled=${bloquea} onClick=${alRegistrar}>
          Registrar entrada · ${folio} <span class="tecla-boton" aria-hidden="true">Enter</span>
        </button>
        <p class="nota">${bloquea ? "Resuelve lo marcado para registrar." : `Suma al inventario del ${diaMes(datos.fecha_recibido)}. Se puede corregir después con motivo.`}</p>
        <button type="button" class="boton boton-secundario boton-grande" onClick=${() => alIrA(3)}>← Acomodo</button>
      </div>
    </div>
  </div>`;
}
