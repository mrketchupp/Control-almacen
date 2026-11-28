// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §4): paso 1 del vale de entrada, *De dónde viene*, su resumen
// con «Editar» para los pasos siguientes y la ventana de *Llenar con Copilot* (§4.1). La página que los junta es
// `PaginaValesEntrada` (entradas.js).

import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { fechaDelDia, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { ErrorCapturaIA, INSTRUCCIONES, describirArreglos, interpretarRespuesta } from "../../servicios/capturaIA.js";
import { entradaConFolioBase, folioEntrada } from "../../servicios/entradas.js";
import { esOrigenFrecuente, leerRespuestaCopilot, origenesFrecuentes, puestoDeQuienEntrega, quienesEntregan } from "../../servicios/pasosEntrada.js";
import { Boton, CampoSugerido, Ventana, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { copiarTexto } from "./capturaIA.js";
import { RejillaOpciones } from "./paraQuien.js";
import { BotonEditar } from "./pasosVale.js";
import { listas } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mismo = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase();
/** '2026-11-20' → «20/11». */
const diaMes = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso ?? "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** Lo que falta en un campo, debajo de él. */
const Falta = ({ mensaje }) => (mensaje ? html`<small class="falta">${mensaje}</small>` : null);

/** Dónde poner el foco para lo primero que falta del paso 1. */
export const FOCO_DE_DONDE_VIENE = {
  origen: "#paso-entrada .rejilla-opciones button[tabindex='0'], #viene-de",
  folio_externo: "#folio-base",
  fecha: "#fecha-entrada",
  fecha_recibido: "#recibido-entrada",
  devolucion_folio: "#folio-base",
};

// Lo que el paso muestra debajo de su campo; lo demás que falte va arriba del botón para continuar.
const CON_CAMPO = new Set(["origen", "folio_externo", "fecha", "fecha_recibido", "recibio_nombre"]);

/**
 * Paso 1. `faltan`: [{ campo, mensaje }] de `faltaDeDondeViene`; se ven con `marcar` (después de pulsar *Continuar*,
 * §11), salvo una fecha de recibido escrita que no se puede usar, que se dice al momento (como antes). `avisos`: los
 * de `validarEntrada` (los de la fecha de recibido van debajo de ella). `alCopilot`: abre *Llenar con Copilot*.
 * `pie`: el botón para continuar (lo pone la página).
 */
export function PasoDeDondeViene({ datos, alCambiar, faltan = [], marcar = false, avisos = [], alCopilot, pie }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const origenes = useMemo(() => origenesFrecuentes(estado), [estado.vales]);
  const lugares = useMemo(
    () =>
      [...new Set([...listas(estado).lugares, ...estado.vales.filter((v) => v.tipo === "ENTRADA").map((v) => texto(v.origen))])].filter(
        (l) => l && !esOrigenFrecuente(origenes, l),
      ),
    [estado.plantillas_area, estado.vales, origenes],
  );
  const entregan = useMemo(() => quienesEntregan(estado), [estado.vales, estado.personas]);
  const [editarObservaciones, setEditarObservaciones] = useState(false);
  const faltaEn = (campo) => {
    const f = faltan.find((x) => x.campo === campo);
    if (!f) return null;
    if (marcar || (campo === "fecha_recibido" && texto(datos.fecha_recibido))) return f.mensaje;
    return null;
  };
  const sueltos = marcar ? faltan.filter((f) => !CON_CAMPO.has(f.campo)) : [];
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });
  const frecuente = esOrigenFrecuente(origenes, datos.origen);
  const repetida = entradaConFolioBase(estado, datos.folio_externo, null);
  const avisosRecibido = avisos.filter((a) => a.campo === "fecha_recibido");
  // El puesto se llena con el último de esa persona (como en salida), salvo que ya se haya escrito otro a mano.
  const cambiarEntrego = (nombre) => {
    const anterior = puestoDeQuienEntrega(estado, datos.entrego_nombre);
    const automatico = !texto(datos.entrego_puesto) || mismo(datos.entrego_puesto, anterior);
    cambiar({ entrego_nombre: nombre, ...(automatico ? { entrego_puesto: puestoDeQuienEntrega(estado, nombre) } : {}) });
  };
  const observaciones = texto(datos.observaciones);
  const abrirObservaciones = () => {
    setEditarObservaciones(true);
    requestAnimationFrame(() => document.getElementById("observaciones-entrada")?.focus());
  };

  return html`<div class="paso-de-donde">
    <section class="franja-copilot" aria-label="Llenar con Copilot">
      <span class="franja-copilot-icono" aria-hidden="true"><${Icono} nombre="chispa" tam=${22} /></span>
      <span class="franja-copilot-texto">
        <strong>¿Tienes foto o PDF del vale?</strong>
        <span>Copilot llena este paso y las partidas. Después solo revisas lo que no tenga claro.</span>
      </span>
      <${Boton} tipo="primario" tamano="grande" onClick=${alCopilot}><${Icono} nombre="chispa" tam=${18} /> Llenar con Copilot<//>
    </section>

    <div class="paso-quien-mitades">
      <section class="tarjeta-paso" aria-labelledby="t-vale-base">
        <h2 id="t-vale-base">El vale de la base</h2>
        <div class=${`grupo-campo ${faltaEn("origen") ? "con-falta" : ""}`}>
          <span id="t-viene-de" class="etiqueta-campo">Viene de</span>
          ${origenes.length
            ? html`<${RejillaOpciones}
                etiquetaId="t-viene-de"
                opciones=${origenes.map((o) => ({ valor: o, etiqueta: o }))}
                elegida=${origenes.find((o) => mismo(o, datos.origen)) ?? null}
                alElegir=${(origen) => cambiar({ origen })}
              />`
            : null}
          <div class="campo-otro-origen">
            <${CampoSugerido}
              id="viene-de"
              valor=${frecuente ? "" : datos.origen}
              alCambiar=${(origen) => cambiar({ origen: origen.toUpperCase() })}
              sugerencias=${lugares}
              placeholder=${origenes.length ? "Otro origen…" : "Base o equipo"}
              ariaLabel=${origenes.length ? "Otro origen" : "Viene de"}
            />
          </div>
          <${Falta} mensaje=${faltaEn("origen")} />
        </div>
        <div class="campos-dos">
          <label class=${`campo campo-grande ${faltaEn("folio_externo") ? "con-falta" : ""}`}>
            <span>Folio del vale</span>
            <input
              id="folio-base"
              value=${datos.folio_externo ?? ""}
              autocomplete="off"
              placeholder="El del vale en papel"
              onInput=${(e) => cambiar({ folio_externo: e.currentTarget.value, folio_repetido: false })}
            />
            <${Falta} mensaje=${faltaEn("folio_externo")} />
          </label>
          <label class=${`campo campo-grande ${faltaEn("fecha") ? "con-falta" : ""}`}>
            <span>Fecha del vale</span>
            <input id="fecha-entrada" type="date" value=${datos.fecha ?? ""} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
            <${Falta} mensaje=${faltaEn("fecha")} />
          </label>
        </div>
        ${repetida
          ? html`<label class="casilla aviso-folio">
              <input type="checkbox" checked=${Boolean(datos.folio_repetido)} onChange=${(e) => cambiar({ folio_repetido: e.currentTarget.checked })} />
              <span>
                El folio ${datos.folio_externo} ya está en la entrada <a href=${`#entrada/${repetida.id}`}>${folioEntrada(repetida.folio)}</a>
                (recibida el ${fmtFecha(fechaDelDia(repetida))}). Márcalo solo si es <strong>otro vale</strong> con el mismo folio.
              </span>
            </label>`
          : null}
        <p class="nota">La fecha del vale es la que usa la conciliación con AX.</p>
      </section>

      <section class="tarjeta-paso" aria-labelledby="t-llega">
        <h2 id="t-llega">Cuándo llega y quién lo trae</h2>
        <div class="campos-dos">
          <label class=${`campo campo-grande ${faltaEn("fecha_recibido") ? "con-falta" : ""}`}>
            <span>Recibido</span>
            <input
              id="recibido-entrada"
              type="date"
              value=${datos.fecha_recibido ?? ""}
              max=${hoyIso()}
              onChange=${(e) => cambiar({ fecha_recibido: e.currentTarget.value })}
              aria-describedby="recibido-nota"
            />
            <${Falta} mensaje=${faltaEn("fecha_recibido")} />
          </label>
          <div class=${`campo campo-grande ${faltaEn("recibio_nombre") ? "con-falta" : ""}`}>
            <span>Recibe</span>
            ${sesion.usuario
              ? html`<span class="valor-fijo"><strong>${sesion.usuario}</strong><span class="nota">en turno</span></span>`
              : html`<span class="valor-fijo valor-falta">Elige quién está en turno (arriba a la derecha)</span>`}
          </div>
        </div>
        <div id="recibido-nota" aria-live="polite">
          ${avisosRecibido.length
            ? avisosRecibido.map((a) => html`<p class="recibido-aviso">${a.mensaje}</p>`)
            : html`<p class="nota">Suma al inventario el día de <strong>recibido</strong> y cuenta en ese reporte diario.</p>`}
        </div>
        <div class="campos-dos">
          <div class="campo campo-grande">
            <span>Entregó · nombre</span>
            <${CampoSugerido}
              id="entrego-nombre"
              valor=${datos.entrego_nombre ?? ""}
              alCambiar=${(nombre) => cambiarEntrego(nombre.toUpperCase())}
              sugerencias=${entregan}
              placeholder="Chofer o almacenista de la base"
              ariaLabel="Entregó · nombre"
            />
          </div>
          <label class="campo campo-grande">
            <span>Entregó · puesto</span>
            <input
              id="entrego-puesto"
              value=${datos.entrego_puesto ?? ""}
              autocomplete="off"
              placeholder="Se llena con el último"
              onInput=${(e) => cambiar({ entrego_puesto: e.currentTarget.value.toUpperCase() })}
            />
          </label>
        </div>
      </section>
    </div>

    ${editarObservaciones
      ? html`<div class="tarjeta-paso observaciones-entrada">
          <label class="campo">
            <span>Observaciones</span>
            <textarea id="observaciones-entrada" rows="3" value=${datos.observaciones ?? ""} onInput=${(e) => cambiar({ observaciones: e.currentTarget.value })}></textarea>
          </label>
          <${Boton} onClick=${() => setEditarObservaciones(false)}>Listo<//>
        </div>`
      : null}

    ${sueltos.length
      ? html`<ul class="pendientes-tarjeta">
          ${sueltos.map((f) => html`<li key=${f.campo} class="pendiente-linea"><span class="pendiente-texto"><span aria-hidden="true">⚠ </span>${f.mensaje}</span></li>`)}
        </ul>`
      : null}

    <div class="pie-paso">
      <span class="pie-observaciones">
        ${observaciones && !editarObservaciones ? html`<span class="nota" title=${observaciones}>Obs.: ${observaciones}</span>` : null}
        ${editarObservaciones
          ? null
          : html`<${Boton} tamano="chico" onClick=${abrirObservaciones}>${observaciones ? "Editar observaciones" : "＋ Observaciones"}<//>`}
      </span>
      <span class="espaciador"></span>
      ${pie}
    </div>
  </div>`;
}

/**
 * *De dónde viene* en una línea, con «Editar» (→ paso 1): «BASE PRUEBA · vale B-400» y debajo «Del 20/11 · recibido
 * hoy · entregó P. ÁVILA». Para los pasos 2 y 4 (§5, §7).
 */
export function ResumenDeDondeViene({ datos, alEditar }) {
  const hoy = hoyIso();
  const titulo = [texto(datos.origen) || "Sin origen", texto(datos.folio_externo) ? `vale ${texto(datos.folio_externo)}` : null].filter(Boolean).join(" · ");
  const linea = [
    datos.fecha ? `Del ${diaMes(datos.fecha)}` : null,
    datos.fecha_recibido ? `recibido ${datos.fecha_recibido === hoy ? "hoy" : diaMes(datos.fecha_recibido)}` : null,
    texto(datos.entrego_nombre) ? `entregó ${texto(datos.entrego_nombre)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return html`<section class="resumen-de-donde" aria-label="De dónde viene">
    <div class="resumen-de-donde-texto">
      <strong>${titulo}</strong>
      ${linea ? html`<span class="nota">${linea}</span>` : null}
    </div>
    <${BotonEditar} etiqueta="Editar de dónde viene" onClick=${alEditar} />
  </section>`;
}

// ---------------------------------------------------------------- llenar con Copilot (§4.1)

/** ✓ verde cuando el paso ya se hizo; si no, su número. */
const Marca = ({ hecho, numero }) => html`<span class=${`copilot-marca ${hecho ? "hecho" : ""}`} aria-hidden="true">${hecho ? "✓" : numero}</span>`;

/**
 * Los tres pasos de hoy en una ventana sobre el paso actual: copiar las instrucciones, adjuntar la foto o el PDF en
 * Copilot y pegar la respuesta (con *Pegar* o Ctrl + V en la ventana). Lo leído se muestra en verde y solo se usa
 * con **Ver las partidas →** (`alAplicar(leido)`: lo de `leerRespuestaCopilot` + `arreglo`); *Cancelar* no cambia
 * nada. Sin dibujos hasta tener capturas de Copilot (§4.1).
 */
export function VentanaCopilotEntrada({ datos, alAplicar, alCerrar, cerrando = false }) {
  const sesion = useSesion();
  const [copiado, setCopiado] = useState(false);
  const [leido, setLeido] = useState(null);
  const [error, setError] = useState(null);
  const [aMano, setAMano] = useState(false);
  const leer = (pegado) => {
    setError(null);
    try {
      const { datos: respuesta, arreglos } = interpretarRespuesta(pegado);
      setLeido({ ...leerRespuestaCopilot(sesion.estado, datos, respuesta), arreglo: describirArreglos(arreglos) });
      setAMano(false);
    } catch (e) {
      if (!(e instanceof ErrorCapturaIA)) throw e;
      setError(e.message);
    }
  };
  // Ctrl + V en cualquier parte de la ventana (el cuadro de texto, si se abrió, pega por su cuenta).
  const alPegar = useRef(null);
  alPegar.current = (e) => {
    if (e.defaultPrevented) return;
    const pegado = e.clipboardData?.getData("text");
    if (!pegado?.trim()) return;
    e.preventDefault();
    leer(pegado);
  };
  // Antes de que se vea la ventana: un Ctrl + V justo al abrirla también llega.
  useLayoutEffect(() => {
    const escuchar = (e) => alPegar.current(e);
    document.addEventListener("paste", escuchar);
    return () => document.removeEventListener("paste", escuchar);
  }, []);
  const copiar = async () => {
    const ok = await copiarTexto(INSTRUCCIONES.entrada.texto);
    setCopiado(ok);
    if (!ok) setError("No se pudieron copiar: abre «Ver el texto» y cópialo.");
  };
  const pegar = async () => {
    setError(null);
    let pegado = "";
    try {
      pegado = await navigator.clipboard.readText();
    } catch {
      setAMano(true);
      setError("Edge no dejó leer lo copiado: pégalo en el cuadro con Ctrl + V.");
      return;
    }
    if (!pegado.trim()) {
      setError("No hay nada copiado: en Copilot, copia el bloque de la respuesta.");
      return;
    }
    leer(pegado);
  };
  const v = leido?.leido;
  const dato = (etiqueta, valor) => html`<span>${etiqueta} <strong>${valor || "—"}</strong></span>`;

  return html`<${Ventana}
    titulo="Llenar con Copilot"
    clase="ventana-copilot ventana-copilot-entrada"
    alCerrar=${alCerrar}
    cerrando=${cerrando}
    cabeza=${html`<h2 class="copilot-titulo"><span class="franja-copilot-icono" aria-hidden="true"><${Icono} nombre="chispa" tam=${18} /></span>Llenar con Copilot</h2>`}
  >
    <ol class="copilot-pasos">
      <li class=${copiado ? "hecho" : ""}>
        <${Marca} hecho=${copiado} numero="1" />
        <div>
          <strong>Copia las instrucciones</strong>
          <div class="acciones-linea">
            ${copiado
              ? html`<${Boton} tipo="hecho" onClick=${copiar}>✓ Copiadas<//><span class="nota">puedes copiarlas otra vez</span>`
              : html`<${Boton} tipo="primario" onClick=${copiar}>Copiar instrucciones<//>`}
          </div>
          <details class="ver-instrucciones"><summary>Ver el texto</summary><pre>${INSTRUCCIONES.entrada.texto}</pre></details>
        </div>
      </li>
      <li class=${leido ? "hecho" : ""}>
        <${Marca} hecho=${Boolean(leido)} numero="2" />
        <div>
          <strong>En Copilot, adjunta la foto o el PDF del vale y pega las instrucciones</strong>
          <p class="nota">Copilot responde con un bloque de texto. Cópialo completo.</p>
        </div>
      </li>
      <li class=${leido ? "hecho" : ""}>
        <${Marca} hecho=${Boolean(leido)} numero="3" />
        <div>
          <strong>Pega aquí la respuesta</strong>
          ${leido
            ? html`<div class="copilot-leido" role="status">
                <strong class="copilot-leido-titulo">✓ Leído</strong>
                <div class="copilot-leido-datos">
                  ${dato("Viene de", v.origen)} ${dato("Folio", v.folio)} ${dato("Fecha del vale", v.fecha ? fmtFecha(v.fecha) : "")} ${dato("Entregó", v.entrego)}
                </div>
                <p class="copilot-leido-partidas">
                  <strong>${leido.partidas} ${leido.partidas === 1 ? "partida" : "partidas"}</strong>
                  ${leido.porRevisar ? html` · <span class="copilot-revisar">${leido.porRevisar} por revisar</span>` : null}
                  ${leido.variantesNuevas ? ` · ${leido.variantesNuevas} ${leido.variantesNuevas === 1 ? "variante nueva" : "variantes nuevas"}` : null}
                </p>
                ${leido.arreglo ? html`<p class="nota">${leido.arreglo}</p>` : null}
              </div>`
            : null}
          <div class="acciones-linea">
            <${Boton} tipo=${leido ? "secundario" : "primario"} onClick=${pegar}>${leido ? "Pegar otra" : "Pegar"}<//>
            <span class="nota">o Ctrl + V en esta ventana</span>
          </div>
          ${aMano
            ? html`<textarea
                class="pegar-ia"
                rows="4"
                aria-label="Respuesta de Copilot"
                placeholder="Pega aquí con Ctrl + V"
                onPaste=${(e) => {
                  const pegado = e.clipboardData?.getData("text");
                  if (!pegado) return;
                  e.preventDefault();
                  leer(pegado);
                }}
              ></textarea>`
            : null}
          ${error ? html`<p class="alerta" role="alert">${error}</p>` : null}
        </div>
      </li>
    </ol>
    <div class="ventana-pie">
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <${Boton} tipo="primario" disabled=${!leido} onClick=${() => alAplicar(leido)}>Ver las partidas →<//>
    </div>
  <//>`;
}
