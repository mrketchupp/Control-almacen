// Ronda 34, paso 2 · Material (docs/13-rediseno-vale-salida.md §4, con los cambios del usuario en la revisión de la
// etapa 3): a la izquierda el buscador fijo y sus resultados agrupados por código; a la derecha dos tarjetas, *Para
// quién* y las *Partidas* con su propio scroll. Un solo botón *Editar* en las partidas: se elige una y su edición (otra
// clave u otro material, lote, O.C., descripción) se hace a la izquierda; al terminar, vuelve la búsqueda de antes.
// Ronda 35: el buscador son dos campos («Código o descripción» y «Dimensión o NP»), cada código es una tarjeta aparte y
// los atajos se ven como teclas.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero, dec } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { hoyIso } from "../../nucleo/fechas.js";
import { DUENO_FX } from "../../nucleo/inventarios.js";
import {
  agregarPartida,
  buscarMaterial,
  codigoNuevo,
  codigosConPartidas,
  conClaveManual,
  conOtraClave,
  conPartidasDeVale,
  contarPartidas,
  dimensionEnMaterial,
  entradasDeHoy,
  estadoPartida,
  filasDeCodigo,
  indiceMaterial,
  lineaCodigoNuevo,
  opcionesEnOrden,
  partidasDelVale,
  ultimasDeArea,
} from "../../servicios/buscarMaterial.js";
import { deVale, folioDeVale } from "../../servicios/copiarVale.js";
import { disponibles, plantillaArea } from "../../servicios/vales.js";
import { AyudaAtajos, Pastilla, Tecla, num, useAtajo, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { desplazamiento } from "../desplazamiento.js";
import { Icono } from "../iconos.js";
import { VentanaCopiarVale } from "./copiarVale.js";
import { BotonDescripcion } from "./descripcion.js";
import { ResumenParaQuien } from "./pasosVale.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const partidasDe = (n) => `${n} ${n === 1 ? "partida" : "partidas"}`;
const conCodigo = (vale) => vale.lineas.filter((l) => Number.isInteger(l.codigo)).length;
export const enfocar = (id, seleccionar = false) =>
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.focus();
    if (seleccionar) el?.select?.();
  });

/** Alto que queda en la ventana desde donde empieza `ref` (sin scroll de la página completa, §8). */
export function useAltoDisponible(ref) {
  const [alto, setAlto] = useState(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      // Lo que se deja abajo: el relleno de la página o, en ventana angosta, la barra de la lista y la de navegación.
      const contenido = el.closest(".contenido");
      const relleno = contenido ? parseFloat(getComputedStyle(contenido).paddingBottom) || 0 : 0;
      const reserva = Math.max(parseFloat(getComputedStyle(el).getPropertyValue("--reserva-abajo")) || 24, relleno);
      const arriba = el.getBoundingClientRect().top + desplazamiento().y;
      setAlto(Math.max(420, Math.floor(window.innerHeight - arriba - reserva)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return alto;
}

// ---------------------------------------------------------------- buscador y resultados

/** El botón ＋ de los resultados y el ratón, dibujados para la ayuda de atajos. */
export const BotonMasDibujado = () => html`<span class="tecla-mas"><${Icono} nombre="agregar" tam=${14} /></span>`;
export const DobleClic = () => html`<span class="tecla-raton"><${Icono} nombre="raton" tam=${15} />doble clic</span>`;

/**
 * Los dos campos del buscador (Ronda 35): «Código o descripción» (el código AX o palabras de su descripción) y
 * «Dimensión o NP» (la clave). Los dos son `combobox` de la misma lista de resultados; con texto, una ✕ limpia cada uno.
 */
export function Buscador({ id, material, dimension, alMaterial, alDimension, total, marcado, alTecla, etiquetaMaterial = "Código o descripción" }) {
  const campo = (cual, valor, alEscribir, etiqueta, placeholder) => {
    const idCampo = cual === "material" ? id : `${id}-dimension`;
    // El nombre del campo es solo su etiqueta (sin la ✕ de limpiar, que está dentro de la misma etiqueta).
    return html`<label class=${`campo buscador-grande campo-busqueda-${cual}`}>
      <span id=${`${idCampo}-etiqueta`}>${etiqueta}</span>
      <span class="buscador-caja">
        <input
          id=${idCampo}
          aria-labelledby=${`${idCampo}-etiqueta`}
          value=${valor}
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded=${total > 0}
          aria-controls=${`${id}-resultados`}
          aria-activedescendant=${total ? `${id}-op-${Math.min(marcado, total - 1)}` : undefined}
          onInput=${(e) => alEscribir(e.currentTarget.value)}
          onKeyDown=${(e) => alTecla(e, cual)}
          placeholder=${placeholder}
        />
        ${valor
          ? html`<button type="button" class="limpiar-busqueda" aria-label=${`Limpiar ${etiqueta.toLowerCase()}`} title="Limpiar (Esc)"
              onClick=${() => {
                alEscribir("");
                enfocar(idCampo);
              }}><${Icono} nombre="cerrar" tam=${18} /></button>`
          : null}
      </span>
    </label>`;
  };
  return html`<div class="buscador-material">
    ${campo("material", material, alMaterial, etiquetaMaterial, "Ej. 505 o filtro")}
    ${campo("dimension", dimension, alDimension, "Dimensión o NP", 'Ej. 4" X 3M o P550…')}
  </div>`;
}

/** Una clave en los resultados: dimensión · NP · contenedor · hay · ＋ (o *Actual* / *Usar esta* al editar). */
function FilaResultado({ idLista, fila, indice, marcada, ultima, nombreArea, editando, actual, alMarcar, alElegir, entrada = false }) {
  const articulo = fila.tipo === "articulo";
  const descripcionFila = `${fila.codigo} ${articulo ? fila.descripcion : `${fila.clave}${fila.np ? ` NP ${fila.np}` : ""}`}`;
  return html`<div
    role="option"
    id=${`${idLista}-op-${indice}`}
    aria-selected=${marcada}
    class=${`fila-resultado ${marcada ? "marcada" : ""} ${actual ? "actual" : ""}`}
    onMouseDown=${(e) => e.preventDefault()}
    onClick=${() => alMarcar(indice)}
    onDblClick=${() => !actual && alElegir(fila, false)}
  >
    <span class="res-clave">${articulo ? "—" : fila.clave}</span>
    <span class="res-np">${fila.np || "—"}</span>
    <span class="res-contenedor">
      ${articulo
        ? html`<${Pastilla}>${entrada ? "Sin existencia" : "No inventariado"}<//>`
        : html`<span>${fila.lugar}${fila.fx ? html` <${Pastilla} tono="fx">FX<//>` : null}</span>
            ${ultima ? html`<span class="res-ultima">La última de ${nombreArea}</span>` : null}`}
    </span>
    <span class=${`res-hay ${!articulo && fila.total <= 0 ? "sin-existencia" : ""}`}>${articulo ? "—" : html`<strong>${num(fila.total)}</strong> ${fila.um}`}</span>
    ${editando
      ? actual
        ? html`<span class="res-actual">Actual</span>`
        : html`<button type="button" class="res-usar" tabIndex="-1" aria-label=${`Usar ${descripcionFila}`}
            onClick=${(e) => {
              e.stopPropagation();
              alElegir(fila, false);
            }}>Usar esta</button>`
      : html`<button type="button" class="res-agregar" tabIndex="-1" aria-label=${`Agregar ${descripcionFila}`} title=${entrada ? "Agregar a la entrada" : "Agregar al vale"}
          onClick=${(e) => {
            e.stopPropagation();
            alElegir(fila, false);
          }}><${Icono} nombre="agregar" tam=${20} /></button>`}
  </div>`;
}

/** «Usar «4" X 3M»» (clave que el código no tiene) o «Agregar código 1399» (código que no está): borde punteado. */
function FilaEspecial({ idLista, especial, indice, marcada, editando, alElegir, entrada = false }) {
  return html`<div role="option" id=${`${idLista}-op-${indice}`} aria-selected=${marcada} class=${`fila-especial ${marcada ? "marcada" : ""}`}
    onMouseDown=${(e) => e.preventDefault()} onClick=${() => alElegir(especial, false)}>
    <span class="especial-icono" aria-hidden="true"><${Icono} nombre="agregar" tam=${18} /></span>
    ${especial.tipo === "clave"
      ? entrada
        ? html`<span class="especial-texto"><strong>Usar «<i>${especial.clave}</i>» en ${especial.codigo}</strong>
              <span>No está en el inventario: entra como variante nueva.</span></span>
            <${Pastilla} tono="info">Variante nueva<//>`
        : html`<span class="especial-texto"><strong>Usar «<i>${especial.clave}</i>» en ${especial.codigo}</strong>
              <span>No está en el inventario: queda en el vale y el historial, pero no descuenta existencia.</span></span>
            <${Pastilla} tono="alerta">No descuenta<//>`
      : html`<span class="especial-texto"><strong>Agregar código ${especial.codigo}${especial.descripcion ? ` · ${especial.descripcion}` : ""}${especial.clave ? ` · «${especial.clave}»` : ""}</strong>
            <span>${entrada ? "No está en el catálogo: escribe su descripción; se da de alta al registrar." : "No está en el catálogo: escribe su descripción en la partida; queda por confirmar."}</span></span>
          <${Pastilla} tono="alerta">Código nuevo<//>`}
  </div>`;
}

/**
 * Resultados como un `listbox`: cada código es una tarjeta (su cabeza con el código y la descripción, sus claves y, si
 * la dimensión escrita no está, «Usar «…»» al final de la tarjeta). El código nuevo va al final. `vacio`: lo que se ve
 * sin nada escrito. `alMoverADimension`: lo escrito en el primer campo es una dimensión; pasarlo al segundo.
 */
export function Resultados({ idLista, b, marcado, alMarcar, ultimas, nombreArea, editando = false, actualId = null, alElegir, vacio, alMoverADimension = null, entrada = false }) {
  const { grupos, mas, nuevo, material, dimension } = b;
  if (!texto(material) && !texto(dimension)) return html`<div class="resultados-material"><p class="resultados-vacio">${vacio}</p></div>`;
  // Lo escrito como material es una dimensión o NP (p. ej. «6309»): se ofrece pasarlo al otro campo.
  const comoDimension = !grupos.length && alMoverADimension ? b.comoDimension : 0;
  const pista = comoDimension
    ? html`<button type="button" class="boton boton-secundario mover-dimension" onClick=${alMoverADimension}>
        «${material}» está como dimensión o NP en ${comoDimension} ${comoDimension === 1 ? "clave" : "claves"} · buscarlo en «Dimensión o NP»
      </button>`
    : null;
  if (!grupos.length && !nuevo) {
    return html`<div class="resultados-material">
      <p class="resultados-vacio">
        ${!texto(material)
          ? html`Ninguna clave trae «${dimension}». Escribe también el código o la descripción para usarla aunque no esté en el inventario.`
          : html`No hay material con «${material}»${texto(dimension) ? ` y «${dimension}»` : ""}.`}
      </p>
      ${pista}
    </div>`;
  }
  let indice = -1;
  return html`<div class="resultados-material">
    ${pista}
    <div role="listbox" id=${`${idLista}-resultados`} aria-label="Resultados">
      ${grupos.map((g) => {
        const filas = g.filas.map((fila) => {
          indice += 1;
          return html`<${FilaResultado}
            key=${fila.id ?? `a${fila.codigo}`}
            idLista=${idLista}
            fila=${fila}
            indice=${indice}
            marcada=${indice === marcado}
            ultima=${fila.id !== null && ultimas.get(fila.codigo) === fila.id}
            nombreArea=${nombreArea}
            editando=${editando}
            actual=${editando && fila.id !== null && fila.id === actualId}
            alMarcar=${alMarcar}
            alElegir=${alElegir}
            entrada=${entrada}
          />`;
        });
        const usar = g.usar ? ((indice += 1), html`<${FilaEspecial} idLista=${idLista} especial=${g.usar} indice=${indice} marcada=${indice === marcado} editando=${editando} alElegir=${alElegir} entrada=${entrada} />`) : null;
        const claves = g.filas.length && g.filas[0].tipo === "articulo" ? "sin existencia" : `${g.filas.length} ${g.filas.length === 1 ? "clave" : "claves"}`;
        return html`<div role="group" key=${g.codigo} aria-labelledby=${`${idLista}-g${g.codigo}`} class="grupo-resultados">
          <div class="grupo-cabeza" id=${`${idLista}-g${g.codigo}`}>
            <span class="grupo-titulo"><span class="grupo-codigo">${g.codigo}</span> · ${g.descripcion || "—"}</span>
            <span class="grupo-claves">${g.sinCoincidencia ? `Ninguna clave trae «${dimension}» · estas son las que hay` : g.filas.length ? claves : `Ninguna clave trae «${dimension}»`}</span>
          </div>
          ${g.filas.length ? html`<div class="encabezado-resultados" aria-hidden="true"><span>Dimensión</span><span>NP</span><span>Contenedor</span><span>Hay</span><span></span></div>` : null}
          ${filas}
          ${usar}
        </div>`;
      })}
      ${nuevo ? ((indice += 1), html`<${FilaEspecial} idLista=${idLista} especial=${nuevo} indice=${indice} marcada=${indice === marcado} editando=${editando} alElegir=${alElegir} entrada=${entrada} />`) : null}
      ${mas ? html`<p class="resultados-vacio">${mas} ${mas === 1 ? "código más" : "códigos más"}: escribe más para encontrarlo.</p>` : null}
    </div>
  </div>`;
}

/**
 * Lo que se busca y cómo se mueve el resaltado (lo usan agregar y editar, cada uno con su estado): el material (código o
 * descripción), la dimensión o NP, los grupos, el código nuevo y las opciones en el orden en que se ven.
 */
export function useBusqueda(items, estado, { inicial = "", conCodigoNuevo = true } = {}) {
  const [material, setMaterial] = useState(inicial);
  const [dimension, setDimension] = useState("");
  const [marcado, setMarcado] = useState(0);
  const { grupos, mas } = useMemo(() => buscarMaterial(items, { material, dimension }), [items, material, dimension]);
  const nuevo = conCodigoNuevo ? codigoNuevo(estado, material, { hayResultados: grupos.length > 0, dimension }) : null;
  const comoDimension = useMemo(() => (grupos.length ? 0 : dimensionEnMaterial(items, material)), [items, material, grupos.length]);
  const opciones = [...opcionesEnOrden(grupos), ...(nuevo ? [nuevo] : [])];
  useEffect(() => setMarcado(0), [material, dimension]);
  const mover = (e) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !opciones.length) return false;
    e.preventDefault();
    setMarcado((m) => Math.min(opciones.length - 1, Math.max(0, m + (e.key === "ArrowDown" ? 1 : -1))));
    return true;
  };
  return {
    material,
    setMaterial,
    dimension,
    setDimension,
    marcado: Math.min(marcado, Math.max(0, opciones.length - 1)),
    setMarcado,
    grupos,
    mas,
    nuevo,
    comoDimension,
    opciones,
    mover,
  };
}

/** Esc en un campo del buscador: borra ese campo (y, si ya estaba vacío, nada). @returns true si lo usó */
export function escEnCampo(e, b, cual) {
  if (e.key !== "Escape") return false;
  const valor = cual === "material" ? b.material : b.dimension;
  if (!valor) return false;
  e.stopPropagation();
  (cual === "material" ? b.setMaterial : b.setDimension)("");
  return true;
}

// ---------------------------------------------------------------- partidas

/** Una partida de la lista (§4.3): dimensión · NP / código · descripción / contenedor · hay; lote y O.C. si tienen. */
function PartidaVale({ l, n, estado, indices, conPartidas, np, hay, pedido, editando, elegida, alElegir, alCambiar, alQuitar, alTab, alEnter, historial = false }) {
  const e = estadoPartida(estado, l, { indices, codigosConPartidas: conPartidas });
  const existencia = l.existencia_id !== null && l.existencia_id !== undefined ? indices.existencia(l.existencia_id) : null;
  const ubicacion = existencia ? indices.ubicacion(existencia.ubicacion_id) : null;
  const nuevo = Number.isInteger(l.codigo) && !estado.articulos[l.codigo];
  const excede = existencia && hay !== null && pedido?.gt(hay);
  const titulo = [l.codigo, l.descripcion, l.clave, np ? `NP ${np}` : null].filter(Boolean).join(" · ");
  const extra = [texto(l.lote) ? `Lote ${l.lote}` : null, texto(l.oc) ? `O.C. ${l.oc}` : null].filter(Boolean).join(" · ");
  const clave = html`<span class="partida-clave">${l.clave || "S/D"}${np ? html`<span class="partida-np"> · NP ${np}</span>` : null}</span>`;
  return html`<li
    class=${`partida-vale ${e.sinCantidad ? "falta-cantidad" : ""} ${editando ? "seleccionable" : ""} ${elegida ? "editando" : ""}`}
    data-partida=${l.uid}
    onClick=${(ev) => editando && !ev.target.closest("input, button") && alElegir()}
  >
    <span class="partida-numero" aria-hidden="true">${n}</span>
    <div class="partida-cuerpo" title=${titulo}>
      ${editando
        ? html`<button type="button" class="partida-elegir" aria-pressed=${elegida} onClick=${alElegir}><span class="solo-lector">Editar la partida ${n}: </span>${clave}</button>`
        : clave}
      ${nuevo
        ? html`<label class="partida-desc partida-desc-nueva"><span>${l.codigo} ·</span>
            <input value=${l.descripcion ?? ""} placeholder="Descripción (código nuevo)" aria-label=${`Descripción del código nuevo ${l.codigo}`}
              onInput=${(ev) => alCambiar({ descripcion: ev.currentTarget.value })} /></label>`
        : html`<div class="partida-desc"><span class="solo-lector">Partida ${n}: </span>${l.codigo} · ${l.descripcion || "—"}</div>`}
      <div class="partida-lugar">
        ${existencia ? html`<span>#${ubicacion.contenedor} ${ubicacion.clase === "INV" ? "Inv." : "Cons."} · hay ${num(aNumero(hay ?? dec(0)))}</span>` : null}
        ${e.noDescuenta ? html`<${Pastilla} tono="alerta">No descuenta<//>` : null}
        ${e.noInventariado && !nuevo ? html`<${Pastilla}>No inventariado<//>` : null}
        ${nuevo ? html`<${Pastilla} tono="alerta">Código nuevo<//>` : null}
        ${e.sinClave && historial ? html`<${Pastilla}>Sin ligar al inventario · anterior al conteo<//>` : null}
        ${e.sinClave && !historial ? html`<${Pastilla} tono="alerta">Falta la clave<//>` : null}
        ${existencia?.activo === false ? html`<${Pastilla} tono="alerta">Ya no está en el inventario<//>` : null}
        ${existencia && existencia.dueno === DUENO_FX ? html`<${Pastilla} tono="fx">FX<//>` : null}
      </div>
      ${extra ? html`<div class="partida-lote">${extra}</div>` : null}
    </div>
    <div class="partida-cantidad">
      <input
        id=${`cant-${l.uid}`}
        class="cantidad-partida"
        inputmode="decimal"
        autocomplete="off"
        value=${l.cantidad ?? ""}
        placeholder="Cant."
        aria-label=${`Cantidad de la partida ${n}`}
        onInput=${(ev) => alCambiar({ cantidad: ev.currentTarget.value.replace(",", ".") })}
        onKeyDown=${(ev) => {
          // Si saca más de lo que hay, Tab va primero a su justificación (abajo de la partida).
          if (ev.key === "Tab" && !ev.shiftKey && excede) {
            ev.preventDefault();
            enfocar(`just-${l.uid}`);
          } else if (ev.key === "Tab" && alTab(l.uid, ev.shiftKey ? -1 : 1)) ev.preventDefault();
          else if (ev.key === "Enter") {
            ev.preventDefault();
            alEnter();
          }
        }}
      />
      ${existencia
        ? html`<span class="partida-um">${l.um}</span>`
        : html`<input class="partida-um-campo" value=${l.um ?? ""} placeholder="UM" aria-label=${`Unidad de la partida ${n}`}
            onInput=${(ev) => alCambiar({ um: ev.currentTarget.value.toUpperCase() })} />`}
    </div>
    <button type="button" class="partida-quitar" aria-label=${`Quitar la partida ${n}`} title="Quitar" onClick=${alQuitar}>
      <span aria-hidden="true">×</span>
    </button>
    ${excede
      ? html`<label class=${`campo partida-justificar ${texto(l.justificacion) ? "listo" : "pendiente"}`}>
          <span>Solo hay ${num(aNumero(hay))} ${l.um || ""}. ¿Por qué sacas más?</span>
          <input
            id=${`just-${l.uid}`}
            value=${l.justificacion ?? ""}
            autocomplete="off"
            placeholder="Ej. llegaron con la entrada E-0005, aún sin ubicar"
            onInput=${(ev) => alCambiar({ justificacion: ev.currentTarget.value })}
            onKeyDown=${(ev) => {
              if (ev.key === "Tab" && ev.shiftKey) {
                ev.preventDefault();
                enfocar(`cant-${l.uid}`, true);
              } else if (ev.key === "Tab" && alTab(l.uid, 1)) ev.preventDefault();
              else if (ev.key === "Enter") {
                ev.preventDefault();
                alEnter();
              }
            }}
          />
        </label>`
      : null}
  </li>`;
}

// ---------------------------------------------------------------- editar una partida (a la izquierda)

/**
 * Edición de la partida elegida (§4.4 con el flujo del usuario): la franja ámbar, su lote y O.C. (y la UM si no sale del
 * inventario), corregir la descripción del código y el buscador con el código de la partida y sus claves (*Actual* /
 * *Usar esta*, o «Usar «clave»» si en «Dimensión o NP» se escribe una que no está). Otro material la reemplaza (conserva
 * cantidad, lote y O.C.). Esc termina.
 */
function EditarPartida({ linea, n, items, estado, indices, np, ultimas, nombreArea, alCambiar, alDescripcion, alTerminar }) {
  const b = useBusqueda(items, estado, { inicial: String(linea.codigo ?? "") });
  const existencia = linea.existencia_id !== null && linea.existencia_id !== undefined;
  const conocido = Number.isInteger(linea.codigo) && Boolean(estado.articulos[linea.codigo]);
  useEffect(() => enfocar("editar-material", true), []);
  useEffect(() => {
    document.getElementById(`editar-material-op-${b.marcado}`)?.scrollIntoView?.({ block: "nearest" });
  }, [b.marcado]);
  // `alCambiar(l => nueva)`: el cambio se aplica sobre la partida como está en ese momento.
  const usar = (fila) => {
    if (fila.tipo === "clave") {
      // La clave escrita, en el código de la partida o en otro (que la reemplaza con su descripción).
      alCambiar((l) => conClaveManual(l.codigo === fila.codigo ? l : conOtraClave(estado, l, filasDeCodigo(items, fila.codigo)[0], { indices }), fila.clave));
    } else if (fila.tipo === "codigo") {
      alCambiar((l) => ({ ...lineaCodigoNuevo(fila.codigo, fila.descripcion, l.lote, fila.clave), uid: l.uid, cantidad: l.cantidad ?? "", oc: l.oc ?? "" }));
    } else alCambiar((l) => conOtraClave(estado, l, fila, { indices }));
    b.setMaterial(String(fila.codigo ?? linea.codigo));
    b.setDimension("");
    enfocar("editar-material", true);
  };
  const tecla = (e) => {
    if (b.mover(e)) return;
    if (e.key === "Enter" && b.opciones.length) {
      e.preventDefault();
      const fila = b.opciones[b.marcado];
      if (fila && !(fila.id != null && fila.id === linea.existencia_id)) usar(fila);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      alTerminar();
    }
  };
  return html`<div class="editar-partida">
    <div class="franja-editando" role="status">
      <div>
        <strong>Editando la partida ${n}</strong> · ${linea.descripcion || linea.codigo} ${linea.clave || ""}${np ? ` · NP ${np}` : ""} — elige otra clave o
        cambia lo de abajo. La cantidad se conserva.
      </div>
      <button type="button" class="boton boton-secundario" onClick=${alTerminar}>Terminar · Esc</button>
    </div>
    <div class="datos-partida">
      <label class="campo"><span>Lote</span>
        <input value=${linea.lote ?? ""} placeholder="opcional" onInput=${(e) => {
          const lote = e.currentTarget.value;
          alCambiar((l) => ({ ...l, lote, lote_np: null, lote_fx: null }));
        }} /></label>
      <label class="campo"><span>O.C.</span>
        <input value=${linea.oc ?? ""} placeholder="opcional" onInput=${(e) => {
          const oc = e.currentTarget.value;
          alCambiar((l) => ({ ...l, oc }));
        }} /></label>
      ${!existencia
        ? html`<label class="campo campo-um"><span>Unidad</span>
            <input value=${linea.um ?? ""} placeholder="UM" onInput=${(e) => {
              const um = e.currentTarget.value.toUpperCase();
              alCambiar((l) => ({ ...l, um }));
            }} /></label>`
        : null}
      ${conocido
        ? html`<span class="corregir-descripcion"><${BotonDescripcion} codigo=${linea.codigo} alCambiar=${alDescripcion} texto="Corregir la descripción del código" /></span>`
        : null}
    </div>
    <${Buscador}
      id="editar-material"
      material=${b.material}
      dimension=${b.dimension}
      alMaterial=${b.setMaterial}
      alDimension=${b.setDimension}
      total=${b.opciones.length}
      marcado=${b.marcado}
      alTecla=${tecla}
      etiquetaMaterial="Otro material · código o descripción"
    />
    <${Resultados}
      idLista="editar-material"
      b=${b}
      marcado=${b.marcado}
      alMarcar=${b.setMarcado}
      ultimas=${ultimas}
      nombreArea=${nombreArea}
      editando=${true}
      actualId=${linea.existencia_id ?? null}
      alElegir=${usar}
      vacio="Escribe el código para ver sus claves, o busca otro material para reemplazar la partida."
    />
    <${AyudaAtajos} atajos=${[
      { teclas: html`<span class="tecla-usar">Usar esta</span> o <${DobleClic} />`, texto: "cambia la clave" },
      { teclas: html`<${Tecla}>Esc<//>`, texto: "termina y vuelve a la búsqueda" },
    ]} />
  </div>`;
}

// ---------------------------------------------------------------- paso 2

/**
 * Paso 2. `datos` / `alCambiar(nuevo)`: el borrador. `resumen` y `alEditar`: el resumen de *Para quién*. `capacidad`:
 * partidas del formato impreso del área. `alRegresar` / `avanzar`: los botones de abajo (los pone la página).
 */
export function PasoMaterial({ datos, alCambiar, resumen, alEditar, capacidad, alRegresar, avanzar, inicio = null, alUsarInicio = null, excluirValeId = null, historial = false }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const items = useMemo(() => indiceMaterial(estado, { indices, saldos }), [estado.articulos, estado.existencias, saldos]);
  // El NP de cada partida del inventario: se ve como referencia aunque no vaya en el lote.
  const npPorPartida = useMemo(() => new Map(items.filter((i) => i.id !== null).map((i) => [i.id, i.np])), [items]);
  const conPartidas = useMemo(() => codigosConPartidas(items), [items]);
  const b = useBusqueda(items, estado);
  const [listaAbierta, setListaAbierta] = useState(false); // ventana angosta: la lista encima
  const [editando, setEditando] = useState(false);
  const [elegida, setElegida] = useState(null); // uid de la partida que se edita
  const [trayendo, setTrayendo] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const ultimas = useMemo(() => ultimasDeArea(estado, datos), [estado.vales, datos.plantilla_area_id, datos.depto_destino]);
  const deHoy = useMemo(() => entradasDeHoy(estado, hoyIso()), [estado.vales]);
  const partidas = partidasDelVale(datos.lineas);
  const cuenta = contarPartidas(estado, partidas, { indices, codigosConPartidas: conPartidas });
  const ids = [...new Set(partidas.map((l) => l.existencia_id).filter((x) => x !== null && x !== undefined))];
  // En una corrección (Ronda 39), «hay» no cuenta lo que el vale mismo ya sacó.
  const hay = useMemo(() => disponibles(estado, ids, excluirValeId), [estado, ids.join(","), excluirValeId]);
  const pedidos = new Map();
  for (const l of partidas) {
    if (l.existencia_id === null || l.existencia_id === undefined) continue;
    pedidos.set(l.existencia_id, (pedidos.get(l.existencia_id) ?? dec(0)).plus(dec(l.cantidad) ?? 0));
  }
  const lineaElegida = editando ? (partidas.find((l) => l.uid === elegida) ?? null) : null;

  // Lo más reciente, para «Deshacer» y lo que termina después (corregir descripción, traer partidas).
  const actual = useRef({ datos, alCambiar });
  actual.current = { datos, alCambiar };
  const raiz = useRef(null);
  const lista = useRef(null);
  const alto = useAltoDisponible(raiz);
  const [nueva, setNueva] = useState(null);

  // Al entrar: el buscador o, si se viene de «Ir a la partida» / «Corregir» del paso 3, esa partida.
  useEffect(() => {
    const destino = inicio && partidasDelVale(datos.lineas).some((l) => l.uid === inicio.uid) ? inicio : null;
    alUsarInicio?.();
    if (!destino) return enfocar("buscar-material");
    const en = (selector) => requestAnimationFrame(() => {
      const el = document.querySelector(`[data-partida="${destino.uid}"] ${selector}`);
      el?.scrollIntoView?.({ block: "nearest" });
      el?.focus();
    });
    if (destino.campo === "cantidad") en(".cantidad-partida");
    else if (destino.campo === "justificacion") en(".partida-justificar input");
    else if (destino.campo === "descripcion") en(".partida-desc-nueva input");
    else if (destino.campo === "um") en(".partida-um-campo");
    else {
      setEditando(true);
      setElegida(destino.uid);
    }
  }, []);
  // Al volver de otra ventana o pestaña, el foco regresa al buscador.
  useEffect(() => {
    const volver = () => {
      if (document.activeElement && document.activeElement !== document.body) return;
      if (document.querySelector(".ventana, .vista-previa")) return;
      enfocar(editando ? "editar-material" : "buscar-material");
    };
    window.addEventListener("focus", volver);
    return () => window.removeEventListener("focus", volver);
  }, [editando]);
  useEffect(() => {
    document.getElementById(`buscar-material-op-${b.marcado}`)?.scrollIntoView?.({ block: "nearest" });
  }, [b.marcado, b.material, b.dimension]);
  // La partida nueva se ve al final de la lista.
  useEffect(() => {
    if (!nueva) return;
    lista.current?.querySelector(`[data-partida="${nueva}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [nueva]);

  // Cada cambio parte del último (aunque la página aún no se vuelva a dibujar): dos campos escritos seguidos no se pisan.
  const aplicar = (nuevo) => {
    actual.current = { ...actual.current, datos: nuevo };
    actual.current.alCambiar(nuevo);
  };
  const cambiarLineas = (fn) => {
    const hoy = actual.current.datos;
    aplicar({ ...hoy, lineas: fn(hoy.lineas) });
  };
  const anunciar = (inicio, lineas) => {
    const c = contarPartidas(estado, lineas, { indices, codigosConPartidas: conPartidas });
    setAnuncio(`${inicio} ${partidasDe(c.total)}${c.sinCantidad ? `, ${c.sinCantidad} sin cantidad` : ""}.`);
  };
  const agregar = (fila, aCantidad) => {
    const datos = actual.current.datos;
    let linea;
    if (fila.tipo === "clave") {
      // Clave que no está en el inventario: la partida del código (descripción, UM) con la clave escrita; no descuenta.
      const base = filasDeCodigo(items, fila.codigo)[0];
      const desde = base ? agregarPartida(estado, datos, base, { indices }).linea : lineaCodigoNuevo(fila.codigo, fila.descripcion);
      linea = conClaveManual(desde, fila.clave);
    } else if (fila.tipo === "codigo") linea = lineaCodigoNuevo(fila.codigo, fila.descripcion, area?.lote_defecto ?? "", fila.clave);
    else linea = agregarPartida(estado, datos, fila, { indices }).linea;
    const conNueva = { ...datos, lineas: [...partidasDelVale(datos.lineas), linea] };
    aplicar(conNueva);
    setNueva(linea.uid);
    // La dimensión ya se usó; el código se queda (seleccionado) por si sigue otra clave del mismo material.
    b.setDimension("");
    anunciar(`Agregado ${fila.descripcion ?? ""} ${linea.clave || ""}.`, conNueva.lineas);
    if (fila.tipo === "codigo" && !fila.descripcion) {
      requestAnimationFrame(() => document.querySelector(`[data-partida="${linea.uid}"] .partida-desc-nueva input`)?.focus());
    } else if (aCantidad) enfocar(`cant-${linea.uid}`);
    else enfocar("buscar-material", true);
  };
  const cambiarLinea = (uid, cambios) => cambiarLineas((lineas) => lineas.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)));
  const reemplazarLinea = (uid, cambio) => cambiarLineas((lineas) => lineas.map((l) => (l.uid === uid ? cambio(l) : l)));
  // Tras corregir la descripción de un código en el catálogo, sus partidas de este vale la toman también.
  const conDescripcion = (codigo, descripcion) => cambiarLineas((lineas) => lineas.map((l) => (l.codigo === codigo ? { ...l, descripcion } : l)));
  const quitar = (uid) => {
    const datos = actual.current.datos;
    const i = datos.lineas.findIndex((l) => l.uid === uid);
    const quitada = datos.lineas[i];
    if (elegida === uid) setElegida(null);
    aplicar({ ...datos, lineas: datos.lineas.filter((l) => l.uid !== uid) });
    sesion.avisar("info", `Partida quitada: ${quitada.codigo} · ${quitada.descripcion || ""} ${quitada.clave || ""}`.trim(), 8000, {
      etiqueta: "↶ Deshacer",
      alHacer: () => {
        const hoy = actual.current.datos;
        if (hoy.id !== datos.id || hoy.lineas.some((l) => l.uid === uid)) return;
        const lineas = [...hoy.lineas];
        lineas.splice(Math.min(i, lineas.length), 0, quitada);
        aplicar({ ...hoy, lineas });
      },
    });
    enfocar(editando ? "editar-material" : "buscar-material");
  };
  // Tab / Shift+Tab van de cantidad en cantidad; en la primera o la última, Tab sigue normal.
  const tab = (uid, paso) => {
    const i = partidas.findIndex((l) => l.uid === uid);
    const otra = partidas[i + paso];
    if (!otra) return false;
    enfocar(`cant-${otra.uid}`, true);
    return true;
  };
  const tecla = (e, cual) => {
    if (b.mover(e)) return;
    if (e.key === "Enter" && b.opciones.length) {
      e.preventDefault();
      agregar(b.opciones[b.marcado], e.shiftKey);
    } else escEnCampo(e, b, cual);
  };
  const terminarEdicion = () => {
    setEditando(false);
    setElegida(null);
    enfocar("buscar-material");
  };
  // Alt + N: otra partida = al buscador (termina la edición y, en ventana angosta, cierra la lista).
  useAtajo(
    { alt: true, codigo: "KeyN" },
    () => {
      setListaAbierta(false);
      setEditando(false);
      setElegida(null);
      enfocar("buscar-material", true);
    },
    raiz,
  );
  const traer = (valeId) =>
    sesion.tarea("Trayendo partidas…", async () => {
      const vale = estado.vales.find((v) => v.id === valeId);
      const r = conPartidasDeVale(estado, actual.current.datos, valeId, { indices });
      aplicar(r.datos);
      setTrayendo(false);
      const aviso = `${partidasDe(r.partidas)} ${deVale(vale)} al final de la lista. Ajusta las cantidades a lo que se entrega.`;
      if (r.avisos.length) sesion.avisar("advertencia", `${aviso}\n${r.avisos.join("\n")}`, 15000);
      else sesion.avisar("exito", aviso);
      anunciar(`Se trajeron ${partidasDe(r.partidas)}.`, r.datos.lineas);
      enfocar("buscar-material");
    });

  const excedido = capacidad && cuenta.total > capacidad;
  const hojas = excedido ? Math.ceil(cuenta.total / capacidad) : 1;
  const nElegida = lineaElegida ? partidas.indexOf(lineaElegida) + 1 : null;
  let izquierda;
  if (lineaElegida) {
    izquierda = html`<${EditarPartida}
      key=${lineaElegida.uid}
      linea=${lineaElegida}
      n=${nElegida}
      items=${items}
      estado=${estado}
      indices=${indices}
      np=${lineaElegida.existencia_id != null ? (npPorPartida.get(lineaElegida.existencia_id) ?? "") : ""}
      ultimas=${ultimas}
      nombreArea=${area?.nombre ?? ""}
      alCambiar=${(cambio) => reemplazarLinea(lineaElegida.uid, cambio)}
      alDescripcion=${(descripcion) => conDescripcion(lineaElegida.codigo, descripcion)}
      alTerminar=${terminarEdicion}
    />`;
  } else if (editando) {
    izquierda = html`<div class="franja-editando" role="status">
      <div><strong>Editar partidas</strong> — elige en la lista la partida que quieres cambiar.</div>
      <button type="button" class="boton boton-secundario" onClick=${terminarEdicion}>Terminar · Esc</button>
    </div>`;
  } else {
    izquierda = html`<${Buscador}
        id="buscar-material"
        material=${b.material}
        dimension=${b.dimension}
        alMaterial=${b.setMaterial}
        alDimension=${b.setDimension}
        total=${b.opciones.length}
        marcado=${b.marcado}
        alTecla=${tecla}
      />
      <${Resultados}
        idLista="buscar-material"
        b=${b}
        marcado=${b.marcado}
        alMarcar=${b.setMarcado}
        ultimas=${ultimas}
        nombreArea=${area?.nombre ?? ""}
        alElegir=${agregar}
        vacio="Escribe el código o la descripción del material y, si quieres, su dimensión o NP."
        alMoverADimension=${() => {
          b.setDimension(b.material);
          b.setMaterial("");
          enfocar("buscar-material-dimension");
        }}
      />
      <${AyudaAtajos} atajos=${[
        { teclas: html`<${BotonMasDibujado} /> o <${DobleClic} />`, texto: "agrega" },
        { teclas: html`<${Tecla}>↑<//><${Tecla}>↓<//> y <${Tecla}>Enter ↵<//>`, texto: "agrega la resaltada" },
        { teclas: html`<${Tecla}>⇧ Shift<//> + <${Tecla}>Enter ↵<//>`, texto: "agrega y vas a su cantidad" },
      ]} />
      <div class="traer-partidas">
        <span>¿Es material que acabas de recibir?</span>
        ${deHoy.map(
          (v) => html`<button type="button" class="boton boton-secundario" key=${v.id} onClick=${() => traer(v.id)}>
            Traer partidas de ${folioDeVale(v)} · hoy · ${conCodigo(v)}
          </button>`,
        )}
        <button type="button" class="boton boton-opcional" onClick=${() => setTrayendo(true)}>${deHoy.length ? "Otra entrada o vale…" : "Traer de una entrada o vale…"}</button>
      </div>`;
  }

  return html`<div ref=${raiz} class=${`paso-material ${listaAbierta ? "lista-abierta" : ""} ${editando ? "modo-editar" : ""}`} style=${alto ? { "--alto-material": `${alto}px` } : null}>
    <div class="material-buscar">${izquierda}</div>

    <div class="columna-vale">
      <div class="tarjeta-resumen-vale">
        <${ResumenParaQuien} datos=${resumen} alEditar=${alEditar} />
      </div>
      <section
        class="vale-en-curso"
        aria-label="Vale en curso"
        onKeyDown=${(e) => {
          if (e.key !== "Escape") return;
          if (editando) terminarEdicion();
          else if (listaAbierta) setListaAbierta(false);
        }}
      >
        <div class="partidas-titulo">
          <h2>Partidas · ${cuenta.total}</h2>
          <span class="partidas-pendientes">
            ${cuenta.sinCantidad ? html`<${Pastilla} tono="alerta">${cuenta.sinCantidad} sin cantidad<//>` : null}
            ${cuenta.noDescuentan ? html`<${Pastilla} tono="alerta">${cuenta.noDescuentan} no ${cuenta.noDescuentan === 1 ? "descuenta" : "descuentan"}<//>` : null}
            ${cuenta.sinClave ? html`<${Pastilla} tono="alerta">${cuenta.sinClave} sin clave<//>` : null}
          </span>
          ${partidas.length
            ? html`<button
                type="button"
                class=${`boton-editar editar-partidas ${editando ? "activo" : ""}`}
                aria-pressed=${editando}
                aria-label=${editando ? "Terminar de editar las partidas" : "Editar las partidas"}
                onClick=${() => {
                  if (editando) terminarEdicion();
                  else {
                    setEditando(true);
                    setElegida(null);
                  }
                }}
              >
                <${Icono} nombre=${editando ? "ok" : "lapiz"} tam=${15} /><span>${editando ? "Listo" : "Editar"}</span>
              </button>`
            : null}
          <button type="button" class="cerrar-lista" aria-label="Cerrar la lista" onClick=${() => setListaAbierta(false)}>▾</button>
        </div>
        ${partidas.length
          ? html`<ol class="lista-vale" ref=${lista} aria-label="Partidas del vale" data-sin-avanzar>
              ${partidas.map(
                (l, i) => html`<${PartidaVale}
                  key=${l.uid}
                  l=${l}
                  n=${i + 1}
                  estado=${estado}
                  indices=${indices}
                  conPartidas=${conPartidas}
                  np=${l.existencia_id != null ? (npPorPartida.get(l.existencia_id) ?? "") : ""}
                  hay=${l.existencia_id != null ? (hay.get(l.existencia_id) ?? null) : null}
                  pedido=${l.existencia_id != null ? (pedidos.get(l.existencia_id) ?? null) : null}
                  editando=${editando}
                  elegida=${l.uid === elegida}
                  alElegir=${() => {
                    setElegida(l.uid);
                    setListaAbierta(false);
                  }}
                  alCambiar=${(cambios) => cambiarLinea(l.uid, cambios)}
                  alQuitar=${() => quitar(l.uid)}
                  alTab=${tab}
                  alEnter=${() => enfocar(lineaElegida ? "editar-material" : "buscar-material", !lineaElegida)}
                  historial=${historial}
                />`,
              )}
            </ol>`
          : html`<p class="lista-vacia">Busca un material a la izquierda para agregarlo.</p>`}
        <div class="pie-material">
          <p class=${`nota ${excedido ? "pie-excedido" : ""}`}>
            <${Tecla}>Tab ⇥<//> salta entre cantidades ·
            ${excedido ? ` se dividirá en ${hojas} folios (${capacidad} por hoja)` : ` cabe en 1 hoja${capacidad ? ` (${capacidad})` : ""}`}
          </p>
          <div class="pie-material-botones">
            ${alRegresar}
            ${avanzar}
          </div>
        </div>
      </section>
    </div>

    <button type="button" class="barra-lista" aria-expanded=${listaAbierta} onClick=${() => setListaAbierta(!listaAbierta)}>
      <span>${partidasDe(cuenta.total)}${cuenta.sinCantidad ? ` · ${cuenta.sinCantidad} sin cantidad` : ""}</span>
      <span aria-hidden="true">${listaAbierta ? "▾" : "▴"}</span>
    </button>
    <div class="solo-lector" aria-live="polite">${anuncio}</div>
    ${trayendo
      ? html`<${VentanaCopiarVale}
          titulo="Traer partidas a este vale"
          nota="Las partidas de la entrada o del vale que elijas se agregan al final de este vale, cada una de la misma partida del inventario y con su cantidad. El vale original no cambia."
          alElegir=${traer}
          alCerrar=${() => setTrayendo(false)}
        />`
      : null}
  </div>`;
}
