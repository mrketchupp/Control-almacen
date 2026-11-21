// Ronda 34, paso 2 · Material (docs/13-rediseno-vale-salida.md §4): el buscador fijo con sus resultados agrupados por
// código (izquierda) y el vale en curso con su propio scroll (derecha). En ventana angosta, una sola columna y la lista
// se abre desde una barra abajo.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero, dec } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import {
  ALCANCES,
  agregarPartida,
  buscarMaterial,
  contarPartidas,
  estadoPartida,
  filasEnOrden,
  indiceMaterial,
  partidasDelVale,
  ultimasDeArea,
} from "../../servicios/buscarMaterial.js";
import { disponibles, plantillaArea } from "../../servicios/vales.js";
import { Lista, Pastilla, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { BotonDescripcion } from "./descripcion.js";
import { ResumenParaQuien } from "./pasosVale.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const partidasDe = (n) => `${n} ${n === 1 ? "partida" : "partidas"}`;
const enfocar = (id, seleccionar = false) =>
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.focus();
    if (seleccionar) el?.select?.();
  });

/** Alto que queda en la ventana desde donde empieza `ref` (sin scroll de la página completa, §8). */
function useAltoDisponible(ref, activo = true) {
  const [alto, setAlto] = useState(null);
  useLayoutEffect(() => {
    if (!activo) return undefined;
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      // Lo que se deja abajo: un margen o, en ventana angosta, la barra de la lista y la de navegación (--reserva-abajo).
      const contenido = el.closest(".contenido");
      const relleno = contenido ? parseFloat(getComputedStyle(contenido).paddingBottom) || 0 : 0;
      const reserva = Math.max(parseFloat(getComputedStyle(el).getPropertyValue("--reserva-abajo")) || 24, relleno);
      const arriba = el.getBoundingClientRect().top + window.scrollY;
      setAlto(Math.max(420, Math.floor(window.innerHeight - arriba - reserva)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [activo]);
  return alto;
}

/** Una clave de un código en los resultados: dimensión · NP · contenedor · hay · ＋. */
function FilaResultado({ fila, indice, marcada, ultima, nombreArea, alMarcar, alAgregar }) {
  const articulo = fila.tipo === "articulo";
  return html`<div
    role="option"
    id=${`res-${indice}`}
    aria-selected=${marcada}
    class=${`fila-resultado ${marcada ? "marcada" : ""}`}
    onMouseDown=${(e) => e.preventDefault()}
    onClick=${() => alMarcar(indice)}
    onDblClick=${() => alAgregar(fila, false)}
  >
    <span class="res-clave">${articulo ? "—" : fila.clave}</span>
    <span class="res-np">${fila.np || "—"}</span>
    <span class="res-contenedor">
      ${articulo
        ? html`<${Pastilla}>No inventariado<//>`
        : html`<span>${fila.lugar}${fila.fx ? html` <${Pastilla} tono="fx">FX<//>` : null}</span>
            ${ultima ? html`<span class="res-ultima">La última de ${nombreArea}</span>` : null}`}
    </span>
    <span class=${`res-hay ${!articulo && fila.total <= 0 ? "sin-existencia" : ""}`}>
      ${articulo ? "—" : html`<strong>${num(fila.total)}</strong> ${fila.um}`}
    </span>
    <button
      type="button"
      class="res-agregar"
      tabIndex="-1"
      aria-label=${`Agregar ${fila.codigo} ${articulo ? fila.descripcion : `${fila.clave}${fila.np ? ` NP ${fila.np}` : ""}`}`}
      title="Agregar al vale"
      onClick=${(e) => {
        e.stopPropagation();
        alAgregar(fila, false);
      }}
    >
      <${Icono} nombre="agregar" tam=${20} />
    </button>
  </div>`;
}

/** Una partida del vale en curso (§4.3): dimensión · NP / código · descripción / contenedor · hay / lote y O.C. */
function PartidaVale({ l, n, estado, indices, np, hay, pedido, alCambiar, alQuitar, alTab, alEnter, alDescripcion }) {
  const e = estadoPartida(estado, l, { indices });
  const existencia = l.existencia_id !== null && l.existencia_id !== undefined ? indices.existencia(l.existencia_id) : null;
  const ubicacion = existencia ? indices.ubicacion(existencia.ubicacion_id) : null;
  const excede = existencia && hay !== null && pedido?.gt(hay);
  const titulo = [l.codigo, l.descripcion, l.clave, np ? `NP ${np}` : null].filter(Boolean).join(" · ");
  return html`<li class=${`partida-vale ${e.sinCantidad ? "falta-cantidad" : ""}`} data-partida=${l.uid}>
    <span class="partida-numero" aria-hidden="true">${n}</span>
    <div class="partida-cuerpo" title=${titulo}>
      <div class="partida-clave">${l.clave || "SIN CLAVE"}${np ? html`<span class="partida-np"> · NP ${np}</span>` : null}</div>
      <div class="partida-desc">
        <span class="partida-desc-texto"><span class="solo-lector">Partida ${n}: </span>${l.codigo} · ${l.descripcion || "—"}</span>
        ${Number.isInteger(l.codigo) && estado.articulos[l.codigo] ? html`<${BotonDescripcion} codigo=${l.codigo} alCambiar=${alDescripcion} />` : null}
      </div>
      <div class="partida-lugar">
        ${existencia ? html`<span>#${ubicacion.contenedor} ${ubicacion.clase === "INV" ? "Inv." : "Cons."} · hay ${num(aNumero(hay ?? dec(0)))}</span>` : null}
        ${e.noDescuenta ? html`<${Pastilla} tono="alerta">No descuenta<//>` : null}
        ${e.noInventariado ? html`<${Pastilla}>No inventariado<//>` : null}
        ${e.sinClave ? html`<${Pastilla} tono="alerta">Falta la clave<//>` : null}
        ${existencia && existencia.dueno === "FX" ? html`<${Pastilla} tono="fx">FX<//>` : null}
      </div>
      ${excede ? html`<div class="partida-aviso">Solo hay ${num(aNumero(hay))} · al emitir pedirá justificación</div>` : null}
    </div>
    <div class="partida-extra">
      <label><span>Lote</span><input value=${l.lote ?? ""} placeholder="opcional" aria-label=${`Lote de la partida ${n}`} onInput=${(ev) => alCambiar({ lote: ev.currentTarget.value })} /></label>
      <label><span>O.C.</span><input value=${l.oc ?? ""} placeholder="opcional" aria-label=${`O.C. de la partida ${n}`} onInput=${(ev) => alCambiar({ oc: ev.currentTarget.value })} /></label>
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
          if (ev.key === "Tab" && alTab(l.uid, ev.shiftKey ? -1 : 1)) ev.preventDefault();
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
  </li>`;
}

/**
 * Paso 2. `datos` / `alCambiar(nuevo)`: el borrador. `resumen` y `alEditar`: el resumen de *Para quién*. `capacidad`:
 * partidas del formato impreso del área. `alRegresar` / `avanzar`: los botones de abajo (los pone la página).
 */
export function PasoMaterial({ datos, alCambiar, resumen, alEditar, capacidad, alRegresar, avanzar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const items = useMemo(() => indiceMaterial(estado, { indices, saldos }), [estado.articulos, estado.existencias, saldos]);
  // El NP de cada partida del inventario: se ve como referencia aunque no vaya en el lote.
  const npPorPartida = useMemo(() => new Map(items.filter((i) => i.id !== null).map((i) => [i.id, i.np])), [items]);
  const [consulta, setConsulta] = useState("");
  const [alcance, setAlcance] = useState("todo");
  const [marcado, setMarcado] = useState(0);
  const [listaAbierta, setListaAbierta] = useState(false); // ventana angosta: la lista encima
  const [anuncio, setAnuncio] = useState("");
  const { grupos, mas } = useMemo(() => buscarMaterial(items, consulta, { alcance }), [items, consulta, alcance]);
  const filas = filasEnOrden(grupos);
  const area = plantillaArea(estado, datos.plantilla_area_id);
  const ultimas = useMemo(() => ultimasDeArea(estado, datos), [estado.vales, datos.plantilla_area_id, datos.depto_destino]);
  const partidas = partidasDelVale(datos.lineas);
  const cuenta = contarPartidas(estado, partidas, { indices });
  const ids = [...new Set(partidas.map((l) => l.existencia_id).filter((x) => x !== null && x !== undefined))];
  const hay = useMemo(() => disponibles(estado, ids), [estado, ids.join(",")]);
  const pedidos = new Map();
  for (const l of partidas) {
    if (l.existencia_id === null || l.existencia_id === undefined) continue;
    pedidos.set(l.existencia_id, (pedidos.get(l.existencia_id) ?? dec(0)).plus(dec(l.cantidad) ?? 0));
  }

  // Lo más reciente, para «Deshacer» al quitar una partida.
  const actual = useRef({ datos, alCambiar });
  actual.current = { datos, alCambiar };
  const raiz = useRef(null);
  const lista = useRef(null);
  const alto = useAltoDisponible(raiz);
  const [nueva, setNueva] = useState(null);

  useEffect(() => enfocar("buscar-material"), []);
  // Al volver de otra ventana o pestaña, el foco regresa al buscador.
  useEffect(() => {
    const volver = () => {
      if (document.activeElement && document.activeElement !== document.body) return;
      if (document.querySelector(".ventana, .vista-previa")) return;
      enfocar("buscar-material");
    };
    window.addEventListener("focus", volver);
    return () => window.removeEventListener("focus", volver);
  }, []);
  useEffect(() => setMarcado(0), [consulta, alcance]);
  useEffect(() => {
    document.getElementById(`res-${marcado}`)?.scrollIntoView?.({ block: "nearest" });
  }, [marcado, consulta]);
  // La partida nueva se ve al final de la lista.
  useEffect(() => {
    if (!nueva) return;
    lista.current?.querySelector(`[data-partida="${nueva}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [nueva]);

  const agregar = (fila, aCantidad) => {
    const { datos: conNueva, linea } = agregarPartida(estado, datos, fila, { indices });
    alCambiar(conNueva);
    setNueva(linea.uid);
    const c = contarPartidas(estado, conNueva.lineas, { indices });
    setAnuncio(`Agregado ${fila.descripcion} ${linea.clave || ""}. ${partidasDe(c.total)}${c.sinCantidad ? `, ${c.sinCantidad} sin cantidad` : ""}.`);
    if (aCantidad) enfocar(`cant-${linea.uid}`);
    else enfocar("buscar-material", true);
  };
  // Tras corregir la descripción de un código en el catálogo, sus partidas de este vale la toman también.
  const conDescripcion = (codigo, descripcion) => {
    const { datos: hoy, alCambiar: cambiarHoy } = actual.current;
    cambiarHoy({ ...hoy, lineas: hoy.lineas.map((l) => (l.codigo === codigo ? { ...l, descripcion } : l)) });
  };
  const cambiarLinea = (uid, cambios) => alCambiar({ ...datos, lineas: datos.lineas.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)) });
  const quitar = (uid) => {
    const i = datos.lineas.findIndex((l) => l.uid === uid);
    const quitada = datos.lineas[i];
    alCambiar({ ...datos, lineas: datos.lineas.filter((l) => l.uid !== uid) });
    sesion.avisar("info", `Partida quitada: ${quitada.codigo} · ${quitada.descripcion || ""} ${quitada.clave || ""}`.trim(), 8000, {
      etiqueta: "↶ Deshacer",
      alHacer: () => {
        const { datos: hoy, alCambiar: cambiarHoy } = actual.current;
        if (hoy.id !== datos.id || hoy.lineas.some((l) => l.uid === uid)) return;
        const lineas = [...hoy.lineas];
        lineas.splice(Math.min(i, lineas.length), 0, quitada);
        cambiarHoy({ ...hoy, lineas });
      },
    });
    enfocar("buscar-material");
  };
  // Tab / Shift+Tab van de cantidad en cantidad; en la primera o la última, Tab sigue normal.
  const tab = (uid, paso) => {
    const i = partidas.findIndex((l) => l.uid === uid);
    const otra = partidas[i + paso];
    if (!otra) return false;
    enfocar(`cant-${otra.uid}`, true);
    return true;
  };
  const tecla = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!filas.length) return;
      e.preventDefault();
      setMarcado((m) => Math.min(filas.length - 1, Math.max(0, m + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && filas.length) {
      e.preventDefault();
      agregar(filas[Math.min(marcado, filas.length - 1)], e.shiftKey);
    } else if (e.key === "Escape" && consulta) {
      e.stopPropagation();
      setConsulta("");
    }
  };

  const excedido = capacidad && cuenta.total > capacidad;
  const hojas = excedido ? Math.ceil(cuenta.total / capacidad) : 1;
  let indice = -1;
  return html`<div ref=${raiz} class=${`paso-material ${listaAbierta ? "lista-abierta" : ""}`} style=${alto ? { "--alto-material": `${alto}px` } : null}>
    <div class="material-buscar">
      <div class="buscador-material">
        <div class="campo buscar-en">
          <span id="buscar-en-etiqueta">Buscar en</span>
          <${Lista}
            id="buscar-en"
            valor=${alcance}
            opciones=${ALCANCES}
            alCambiar=${(valor) => {
              setAlcance(valor);
              enfocar("buscar-material");
            }}
            ariaLabel="Buscar en"
          />
        </div>
        <label class="campo buscador-grande">
          <span>Siguiente material · código, descripción, dimensión o NP</span>
          <input
            id="buscar-material"
            value=${consulta}
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded=${filas.length > 0}
            aria-controls="resultados-material"
            aria-activedescendant=${filas.length ? `res-${Math.min(marcado, filas.length - 1)}` : undefined}
            onInput=${(e) => setConsulta(e.currentTarget.value)}
            onKeyDown=${tecla}
            placeholder=${alcance === "codigo" ? "Ej. 711" : "Ej. foco led, 6309, X00489…"}
          />
        </label>
      </div>

      <div class="resultados-material">
        ${!texto(consulta)
          ? html`<p class="resultados-vacio">Escribe un código, una descripción, una dimensión o un NP.</p>`
          : !grupos.length
            ? html`<p class="resultados-vacio">No hay material con «${consulta}»${alcance !== "todo" ? ` en ${ALCANCES.find((a) => a.valor === alcance).etiqueta.toLowerCase()}` : ""}.</p>`
            : html`<div role="listbox" id="resultados-material" aria-label="Resultados">
                ${grupos.map(
                  (g) => html`<div role="group" key=${g.codigo} aria-labelledby=${`grupo-${g.codigo}`} class="grupo-resultados">
                    <div class="grupo-cabeza" id=${`grupo-${g.codigo}`}>
                      <span class="grupo-titulo"><span class="grupo-codigo">${g.codigo}</span> · ${g.descripcion || "—"}</span>
                      <span class="grupo-claves">${g.filas[0].tipo === "articulo" ? "sin existencia" : `${g.filas.length} ${g.filas.length === 1 ? "clave" : "claves"}`}</span>
                    </div>
                    <div class="encabezado-resultados" aria-hidden="true">
                      <span>Dimensión</span><span>NP</span><span>Contenedor</span><span>Hay</span><span></span>
                    </div>
                    ${g.filas.map((fila) => {
                      indice += 1;
                      return html`<${FilaResultado}
                        key=${fila.id ?? `a${fila.codigo}`}
                        fila=${fila}
                        indice=${indice}
                        marcada=${indice === Math.min(marcado, filas.length - 1)}
                        ultima=${fila.id !== null && ultimas.get(fila.codigo) === fila.id}
                        nombreArea=${area?.nombre ?? ""}
                        alMarcar=${setMarcado}
                        alAgregar=${agregar}
                      />`;
                    })}
                  </div>`,
                )}
                ${mas ? html`<p class="resultados-vacio">${mas} ${mas === 1 ? "código más" : "códigos más"}: escribe más para encontrarlo.</p>` : null}
              </div>`}
      </div>
      <p class="ayuda-resultados" aria-hidden="true">
        <span><strong>＋</strong> o <strong>doble clic</strong> agrega</span>
        <span><strong>↑ ↓ Enter</strong> agrega la resaltada</span>
        <span><strong>Shift + Enter</strong> agrega y vas a su cantidad</span>
      </p>
    </div>

    <aside class="vale-en-curso" aria-label="Vale en curso" onKeyDown=${(e) => e.key === "Escape" && listaAbierta && setListaAbierta(false)}>
      <${ResumenParaQuien} datos=${resumen} alEditar=${alEditar} />
      <div class="partidas-titulo">
        <h2>Partidas · ${cuenta.total}</h2>
        <span class="partidas-pendientes">
          ${cuenta.sinCantidad ? html`<${Pastilla} tono="alerta">${cuenta.sinCantidad} sin cantidad<//>` : null}
          ${cuenta.noDescuentan ? html`<${Pastilla} tono="alerta">${cuenta.noDescuentan} no ${cuenta.noDescuentan === 1 ? "descuenta" : "descuentan"}<//>` : null}
          ${cuenta.sinClave ? html`<${Pastilla} tono="alerta">${cuenta.sinClave} sin clave<//>` : null}
        </span>
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
                np=${l.existencia_id != null ? (npPorPartida.get(l.existencia_id) ?? "") : ""}
                hay=${l.existencia_id != null ? (hay.get(l.existencia_id) ?? null) : null}
                pedido=${l.existencia_id != null ? (pedidos.get(l.existencia_id) ?? null) : null}
                alCambiar=${(cambios) => cambiarLinea(l.uid, cambios)}
                alQuitar=${() => quitar(l.uid)}
                alTab=${tab}
                alEnter=${() => enfocar("buscar-material", true)}
                alDescripcion=${(descripcion) => conDescripcion(l.codigo, descripcion)}
              />`,
            )}
          </ol>`
        : html`<p class="lista-vacia">Busca un material a la izquierda para agregarlo.</p>`}
      <div class="pie-material">
        <p class=${`nota ${excedido ? "pie-excedido" : ""}`}>
          Tab salta entre cantidades ·
          ${excedido ? ` se dividirá en ${hojas} folios (${capacidad} por hoja)` : ` cabe en 1 hoja${capacidad ? ` (${capacidad})` : ""}`}
        </p>
        <div class="pie-material-botones">
          ${alRegresar}
          ${avanzar}
        </div>
      </div>
    </aside>

    <button type="button" class="barra-lista" aria-expanded=${listaAbierta} onClick=${() => setListaAbierta(!listaAbierta)}>
      <span>${partidasDe(cuenta.total)}${cuenta.sinCantidad ? ` · ${cuenta.sinCantidad} sin cantidad` : ""}</span>
      <span aria-hidden="true">${listaAbierta ? "▾" : "▴"}</span>
    </button>
    <div class="solo-lector" aria-live="polite">${anuncio}</div>
  </div>`;
}
