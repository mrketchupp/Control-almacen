// Ronda 34, paso 1 · Para quién (docs/13-rediseno-vale-salida.md §3): consumo interno (área + quién lo lleva) o
// transferencia (destino + quién lo transporta y quién autoriza), la fecha y, en áreas como NOV, sus firmas extra.
// Ronda 35: «Consumo interno» / «Transferencia» (RIG y pozo son lo mismo) y el destino va en las observaciones.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { PUESTOS_AUTORIZAN, conEtapa, sinEtapa } from "../../nucleo/areas.js";
import { hoyIso } from "../../nucleo/fechas.js";
import { buscarPersonas, personasParaFirma } from "../../servicios/consultas.js";
import {
  areaTransferencia,
  areasConsumo,
  conArea,
  conDestino,
  conTipoDeVale,
  destinosTransferencia,
  esDestinoConocido,
  esTransferencia,
  textoObservaciones,
} from "../../servicios/pasosVale.js";
import { firmasExtraDe, observacionesDelVale, pideEtapa, plantillaArea, requiereAutoriza } from "../../servicios/vales.js";
import { Boton, CampoSugerido, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { fechaCorta } from "./pasosVale.js";
import { listas } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const mismo = (a, b) => texto(a).toUpperCase() === texto(b).toUpperCase();
const enCampo = (el) => Boolean(el?.closest?.("input, textarea, select, [contenteditable=true]"));

/** «Falta el nombre»: texto corto debajo de lo que falta para continuar (§2). */
const Falta = ({ mensaje }) => (mensaje ? html`<small class="falta">${mensaje}</small>` : null);

/**
 * Botones grandes de una sola elección (áreas, destinos), en 2 columnas, como `radiogroup`: las flechas mueven el foco
 * y Enter o Espacio eligen. Con `teclas`, las 10 primeras muestran su tecla (1…9, 0) a la derecha.
 */
function RejillaOpciones({ etiquetaId, opciones, elegida, alElegir, teclas = false }) {
  const raiz = useRef(null);
  const enfocable = Math.max(0, opciones.findIndex((o) => o.valor === elegida));
  const flechas = (e) => {
    const pasos = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 };
    if (!(e.key in pasos)) return;
    const botones = [...raiz.current.querySelectorAll("button[role=radio]")];
    const i = botones.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    botones[Math.min(botones.length - 1, Math.max(0, i + pasos[e.key]))]?.focus();
  };
  return html`<div ref=${raiz} class="rejilla-opciones" role="radiogroup" aria-labelledby=${etiquetaId} onKeyDown=${flechas}>
    ${opciones.map((o, i) => {
      const tecla = teclas && i < 10 ? String((i + 1) % 10) : null;
      const activa = o.valor === elegida;
      return html`<button
        type="button"
        key=${o.valor}
        role="radio"
        aria-checked=${activa}
        aria-keyshortcuts=${tecla ?? undefined}
        tabIndex=${i === enfocable ? 0 : -1}
        class=${`opcion-grande ${activa ? "elegida" : ""}`}
        title=${o.etiqueta}
        onClick=${() => alElegir(o.valor)}
      >
        <span>${o.etiqueta}</span>${tecla ? html`<span class="tecla-opcion" aria-hidden="true">${tecla}</span>` : null}
      </button>`;
    })}
  </div>`;
}

/**
 * Nombre + puesto de una firma, lado a lado y del mismo tamaño (§3.1). Al elegir a alguien, el puesto se llena con el
 * último que tuvo; se corrige escribiendo. Debajo, las personas que suelen firmar ahí: siempre a la vista
 * (`listaVisible`) o solo mientras se escribe. Escribir filtra la lista; ↑ ↓ y Enter eligen; Enter sin lista avanza.
 */
function TarjetaPersona({ id, titulo, campo, datos, alCambiar, depto = null, puestos = [], limite = 6, listaVisible = false, tituloLista = "", ayuda = null, falta = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const personas = useMemo(() => personasParaFirma(estado, `${campo}_nombre`), [estado.personas, estado.vales, campo]);
  const sugeridosPuesto = useMemo(() => [...new Set([...puestos, ...listas(estado).puestos])], [estado.personas, puestos.join()]);
  const [consulta, setConsulta] = useState(null); // null = muestra el nombre elegido
  const [marcado, setMarcado] = useState(-1);
  const nombre = datos[`${campo}_nombre`] ?? "";
  const puesto = datos[`${campo}_puesto`] ?? "";
  const escribiendo = consulta !== null && consulta.trim() !== "";
  const opciones = useMemo(
    () => buscarPersonas(personas, escribiendo ? consulta : "", { depto, puestos, limite }),
    [personas, consulta, depto, puestos.join(), limite],
  );
  const conLista = opciones.length > 0 && (listaVisible || escribiendo);
  const abierta = conLista && (escribiendo || marcado >= 0);
  const idLista = `${id}-lista`;
  const elegir = (p) => {
    setConsulta(null);
    setMarcado(-1);
    alCambiar({ [`${campo}_nombre`]: p.nombre, [`${campo}_puesto`]: p.puesto ?? puesto });
  };
  const tecla = (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && conLista) {
      e.preventDefault();
      const desde = marcado < 0 ? (e.key === "ArrowDown" ? -1 : opciones.length) : marcado;
      setMarcado(Math.min(opciones.length - 1, Math.max(0, desde + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && abierta) {
      e.preventDefault();
      elegir(opciones[Math.max(0, marcado)]);
    } else if (e.key === "Escape" && (escribiendo || marcado >= 0)) {
      e.stopPropagation();
      setConsulta(null);
      setMarcado(-1);
    }
  };
  return html`<section class="tarjeta-paso tarjeta-persona" aria-labelledby=${`${id}-titulo`}>
    <h2 id=${`${id}-titulo`}>${titulo}</h2>
    <div class="persona-campos">
      <label class=${`campo campo-grande ${falta ? "con-falta" : ""}`}>
        <span>Nombre</span>
        <input
          id=${id}
          value=${consulta ?? nombre}
          placeholder="Nombre o puesto…"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded=${abierta}
          aria-controls=${conLista ? idLista : undefined}
          aria-activedescendant=${abierta ? `${id}-op-${Math.max(0, marcado)}` : undefined}
          onInput=${(e) => {
            setConsulta(e.currentTarget.value);
            setMarcado(e.currentTarget.value.trim() ? 0 : -1);
            alCambiar({ [`${campo}_nombre`]: e.currentTarget.value });
          }}
          onKeyDown=${tecla}
          onBlur=${() => {
            setConsulta(null);
            setMarcado(-1);
          }}
        />
        <${Falta} mensaje=${falta} />
      </label>
      <label class="campo campo-grande">
        <span>Puesto</span>
        <${CampoSugerido}
          id=${`${id}-puesto`}
          valor=${puesto}
          alCambiar=${(valor) => alCambiar({ [`${campo}_puesto`]: valor })}
          sugerencias=${sugeridosPuesto}
          ariaLabel=${`Puesto (${titulo.replace(/[¿?]/g, "").toLowerCase()})`}
        />
      </label>
    </div>
    ${ayuda ? html`<p class="nota">${ayuda}</p>` : null}
    ${conLista
      ? html`<div class="lista-personas">
          <div class="lista-personas-titulo" id=${`${idLista}-titulo`}>${escribiendo ? "Coinciden" : tituloLista}</div>
          <ul role="listbox" id=${idLista} aria-labelledby=${`${idLista}-titulo`}>
            ${opciones.map(
              (p, i) => html`<li
                key=${p.id}
                id=${`${id}-op-${i}`}
                role="option"
                aria-selected=${i === marcado || (marcado < 0 && mismo(p.nombre, nombre))}
                class=${`${i === marcado ? "marcado" : ""} ${mismo(p.nombre, nombre) ? "elegida" : ""}`}
                onMouseDown=${(e) => {
                  e.preventDefault();
                  elegir(p);
                }}
              >
                <span class="persona-nombre">${p.nombre}</span>
                <span class="persona-puesto">${p.puesto ?? "sin puesto"}</span>
              </li>`,
            )}
          </ul>
        </div>`
      : null}
  </section>`;
}

/** «Fecha: hoy · 21 nov ▾»: abre el calendario del navegador para capturar un vale de otro día. */
function BotonFecha({ fecha, alCambiar }) {
  const campo = useRef(null);
  const hoy = hoyIso();
  const abrir = () => {
    try {
      campo.current.showPicker();
    } catch {
      campo.current.focus();
    }
  };
  return html`<div class="fecha-vale">
    <button type="button" class=${`boton boton-secundario boton-fecha ${fecha && fecha !== hoy ? "fecha-distinta" : ""}`} onClick=${abrir}>
      Fecha: ${fecha === hoy ? `hoy · ${fechaCorta(fecha).replace("Hoy · ", "")}` : fechaCorta(fecha)} <span aria-hidden="true">▾</span>
    </button>
    <input ref=${campo} type="date" class="fecha-oculta" tabIndex="-1" aria-label="Fecha del vale" value=${fecha}
      onChange=${(e) => e.currentTarget.value && alCambiar(e.currentTarget.value)} />
  </div>`;
}

/**
 * Paso 1. `datos`: el borrador; `alCambiar(nuevo)`; `faltan`: [{ campo, mensaje }] de `faltaParaQuien`; `pie`: el botón
 * para continuar (lo pone la página).
 */
export function PasoParaQuien({ datos, alCambiar, faltan = [], pie }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const transferencia = esTransferencia(estado, datos);
  const conTransferencias = Boolean(areaTransferencia(estado)) || transferencia;
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const areas = areasConsumo(estado, datos.plantilla_area_id);
  const destinos = destinosTransferencia(datos.origen || undefined);
  const lugares = useMemo(() => listas(estado).lugares, [estado.plantillas_area, estado.vales]);
  const extras = firmasExtraDe(estado, datos);
  const autoriza = requiereAutoriza(estado, datos);
  const etapa = pideEtapa(estado, datos);
  const [editarEtapa, setEditarEtapa] = useState(false);
  const [editarObservaciones, setEditarObservaciones] = useState(false);
  const faltaEn = (campo) => faltan.find((f) => f.campo === campo)?.mensaje ?? null;
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });
  const enfocarNombre = () => requestAnimationFrame(() => document.getElementById("quien-recibe")?.focus());
  const elegirArea = (id) => {
    alCambiar(conArea(estado, datos, id));
    enfocarNombre();
  };
  // 1…9, 0 eligen una de las 10 primeras áreas cuando el foco no está en un campo ni hay una ventana encima (§9).
  const teclas = useRef(null);
  teclas.current = (e) => {
    if (transferencia || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || !/^[0-9]$/.test(e.key)) return;
    if (enCampo(e.target) || document.querySelector(".ventana, .vista-previa")) return;
    const elegida = areas[e.key === "0" ? 9 : Number(e.key) - 1];
    if (!elegida) return;
    e.preventDefault();
    elegirArea(elegida.id);
  };
  useEffect(() => {
    const escuchar = (e) => teclas.current(e);
    document.addEventListener("keydown", escuchar);
    return () => document.removeEventListener("keydown", escuchar);
  }, []);
  const observaciones = observacionesDelVale(estado, datos) ?? "";
  const personaDe = (props) => html`<${TarjetaPersona} datos=${datos} alCambiar=${cambiar} ...${props} />`;

  return html`<div class="paso-quien">
    <div class="paso-quien-barra">
      ${conTransferencias
        ? html`<div class="interruptor" role="radiogroup" aria-label="Tipo de vale">
            <button type="button" role="radio" aria-checked=${!transferencia} onClick=${() => transferencia && alCambiar(conTipoDeVale(estado, datos, false))}>Consumo interno</button>
            <button type="button" role="radio" aria-checked=${transferencia} onClick=${() => !transferencia && alCambiar(conTipoDeVale(estado, datos, true))}>Transferencia</button>
          </div>`
        : html`<span></span>`}
      <${BotonFecha} fecha=${datos.fecha} alCambiar=${(fecha) => cambiar({ fecha })} />
    </div>

    <div class="paso-quien-mitades">
      ${transferencia
        ? html`<section class="tarjeta-paso" aria-labelledby="t-destino">
            <h2 id="t-destino">¿A dónde se envía?</h2>
            <${RejillaOpciones}
              etiquetaId="t-destino"
              opciones=${destinos.map((d) => ({ valor: d, etiqueta: d }))}
              elegida=${destinos.find((d) => mismo(d, datos.destino)) ?? null}
              alElegir=${(destino) => {
                alCambiar(conDestino(datos, destino));
                enfocarNombre();
              }}
            />
            <label class="campo">
              <span>Otro destino</span>
              <${CampoSugerido}
                id="otro-destino"
                valor=${esDestinoConocido(datos.destino, datos.origen || undefined) ? "" : datos.destino}
                alCambiar=${(destino) => alCambiar(conDestino(datos, destino))}
                sugerencias=${lugares.filter((l) => !esDestinoConocido(l, datos.origen || undefined) && !mismo(l, datos.origen))}
                placeholder="Escribe otro destino…"
                ariaLabel="Otro destino"
              />
            </label>
            <${Falta} mensaje=${faltaEn("depto_destino")} />
          </section>`
        : html`<section class="tarjeta-paso" aria-labelledby="t-area">
            <h2 id="t-area">Área</h2>
            <${RejillaOpciones}
              etiquetaId="t-area"
              teclas=${true}
              opciones=${areas.map((a) => ({ valor: a.id, etiqueta: a.nombre }))}
              elegida=${datos.plantilla_area_id}
              alElegir=${elegirArea}
            />
            <${Falta} mensaje=${faltaEn("depto_destino")} />
          </section>`}

      <div class=${`columna-personas ${(extras ? 2 : 0) + (autoriza ? 1 : 0) ? "varias" : ""}`}>
        ${personaDe({
          id: "quien-recibe",
          // NOV (decisión del usuario): la primera firma es la del personal químico, como «Personal de NOV» y «Patrimonial».
          titulo: transferencia ? "¿Quién lo transporta?" : extras ? "Personal químico" : "¿Quién lo lleva?",
          campo: "recibio",
          depto: transferencia ? null : datos.depto_destino || null,
          listaVisible: !transferencia,
          tituloLista: area && !transferencia ? `Suelen recibir en ${area.nombre}` : "Suelen recibir",
          ayuda: transferencia ? null : "El puesto se llena con el último que tuvo; si está mal o vacío, escríbelo.",
          falta: faltaEn("recibio_nombre"),
        })}
        ${autoriza
          ? personaDe({
              id: "quien-autoriza",
              titulo: "¿Quién autoriza?",
              campo: "autorizo",
              puestos: PUESTOS_AUTORIZAN,
              limite: 4,
              listaVisible: true,
              tituloLista: "Suelen autorizar",
              falta: faltaEn("autorizo_nombre"),
            })
          : null}
        ${extras
          ? html`${personaDe({ id: "firma-izq", titulo: extras.izq, campo: "firma_extra_izq", limite: 4 })}
              ${personaDe({ id: "firma-der", titulo: extras.der, campo: "firma_extra_der", limite: 4 })}`
          : null}
      </div>
    </div>

    ${etapa && (editarEtapa || !texto(datos.etapa_perforacion))
      ? html`<div class="tarjeta-paso editor-etapa">
          <label class="campo">
            <span>Etapa de perforación</span>
            <input id="etapa-vale" value=${datos.etapa_perforacion ?? ""} placeholder='Ej. 12 1/4"' onInput=${(e) => cambiar({ etapa_perforacion: e.currentTarget.value })}
              onKeyDown=${(e) => {
                if (e.key === "Enter" && texto(datos.etapa_perforacion)) {
                  e.preventDefault();
                  setEditarEtapa(false);
                }
              }} />
            ${!texto(datos.etapa_perforacion) ? html`<${Falta} mensaje="Falta la etapa de perforación" />` : null}
          </label>
          ${texto(datos.etapa_perforacion) ? html`<${Boton} onClick=${() => setEditarEtapa(false)}>Listo<//>` : null}
        </div>`
      : null}

    ${transferencia && editarObservaciones
      ? html`<div class="tarjeta-paso observaciones-transferencia">
          <label class="campo">
            <span>Observaciones</span>
            <textarea rows="4" aria-label="Observaciones de la transferencia"
              value=${etapa ? sinEtapa(observaciones) : observaciones}
              onInput=${(e) => cambiar({ observaciones: etapa ? conEtapa(e.currentTarget.value, datos.etapa_perforacion ?? "") : e.currentTarget.value })}></textarea>
          </label>
          <${Boton} aria-label="Terminar edición de observaciones" onClick=${() => setEditarObservaciones(false)}>Terminar edición<//>
        </div>`
      : null}

    <div class="pie-paso">
      <span class="pie-observaciones">
        ${area ? html`<span class="nota">${textoObservaciones(estado, datos)}</span>` : null}
        ${etapa && texto(datos.etapa_perforacion) && !editarEtapa ? html`<${Boton} tamano="chico" onClick=${() => setEditarEtapa(true)}>Cambiar etapa<//>` : null}
        ${transferencia && !editarObservaciones
          ? html`<${Boton} tamano="chico" aria-label="Editar observaciones de esta transferencia" onClick=${() => setEditarObservaciones(true)}>Editar observaciones<//>`
          : null}
      </span>
      <span class="espaciador"></span>
      ${pie}
    </div>
  </div>`;
}
