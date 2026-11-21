// Ronda 34, paso 3 · Revisar y emitir (docs/13-rediseno-vale-salida.md §5): lo que falta antes de emitir, el resumen de
// para quién y del material, las fotos del formato (NOV) y la vista previa real — el mismo HTML de impresión
// (`documentoImpresion`) en miniatura y ampliada con zoom —, con *Emitir* siempre a la vista.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Boton, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { ResumenMaterial, ResumenParaQuien } from "./pasosVale.js";
import { EditorVale } from "./vales.js";

// Ancho de la hoja carta en pantalla con sus márgenes (8.5 in + 0.4 in por lado, a 96 px por pulgada).
const ANCHO_HOJA = 9.3 * 96;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

/**
 * El vale como saldrá impreso, en hojas del formato (una por folio si se divide), con `BORRADOR` en el folio. Se vuelve
 * a armar poco después de cada cambio.
 */
function useDocumento(vales) {
  const sesion = useSesion();
  const [documento, setDocumento] = useState(null);
  const [error, setError] = useState(null);
  const clave = JSON.stringify(vales);
  useEffect(() => {
    let vivo = true;
    const espera = setTimeout(() => {
      sesion
        .documentoVales(vales)
        .then((d) => vivo && (setDocumento(d), setError(null)))
        .catch((e) => vivo && setError(e.message));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [clave]);
  return { documento, error };
}

/** Las hojas del documento a una escala: `escala` fija, o la que llena el ancho de la caja (`ajustar`). */
function HojasEscaladas({ documento, escala = null }) {
  const caja = useRef(null);
  const hojas = useRef(null);
  const [medida, setMedida] = useState({ escala: escala ?? 0.4, alto: 0 });
  useLayoutEffect(() => {
    const medir = () => {
      if (!caja.current || !hojas.current) return;
      const s = escala ?? caja.current.clientWidth / ANCHO_HOJA;
      setMedida({ escala: s, alto: hojas.current.scrollHeight * s });
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja.current);
    return () => observador.disconnect();
  }, [documento, escala]);
  return html`<div ref=${caja} class="hojas-escaladas" style=${{ height: `${Math.ceil(medida.alto)}px` }}>
    <style>${documento.css}</style>
    <div ref=${hojas} class="hojas-vale" style=${{ width: `${ANCHO_HOJA}px`, transform: `scale(${medida.escala})` }} dangerouslySetInnerHTML=${{ __html: documento.html }}></div>
  </div>`;
}

/** «Lo que falta antes de emitir» (§5.1): una fila por problema, con su botón o, si es justificación, su campo. */
function PendientesVale({ pendientes, bloquea, lineas, alIr, alJustificar }) {
  if (!pendientes.length) return null;
  const titulo = bloquea ? `Falta${bloquea === 1 ? "" : "n"} ${bloquea} ${bloquea === 1 ? "cosa" : "cosas"} antes de emitir` : "Justificaciones";
  return html`<section class=${`pendientes-vale ${bloquea ? "" : "resuelto"}`} aria-labelledby="t-pendiente">
    <h2 id="t-pendiente">${titulo}</h2>
    <ul>
      ${pendientes.map((p, i) => {
        if (p.tipo === "justificacion") {
          const l = lineas.find((x) => x.uid === p.uid);
          return html`<li key=${`j${p.uid}`} class=${p.pendiente ? "pendiente" : "listo"}>
            <label class="campo">
              <span>${p.mensaje}</span>
              <input value=${l?.justificacion ?? ""} placeholder="Ej. llegaron con la entrada E-0005, aún sin ubicar"
                onInput=${(e) => alJustificar(p.uid, e.currentTarget.value)} />
            </label>
          </li>`;
        }
        return html`<li key=${i} class="pendiente">
          <span>${p.mensaje}</span>
          ${p.tipo === "cantidad"
            ? html`<${Boton} tamano="chico" onClick=${() => alIr(p)}>Ir a la partida<//>`
            : p.tipo === "fotos"
              ? html`<${Boton} tamano="chico" onClick=${() => document.querySelector(".fotos-paso .foto-agregar")?.scrollIntoView?.({ block: "center" })}>Ver las fotos<//>`
              : p.paso
                ? html`<${Boton} tamano="chico" onClick=${() => alIr(p)}>Corregir<//>`
                : null}
        </li>`;
      })}
    </ul>
  </section>`;
}

/**
 * Vista previa ampliada (§5.3): a pantalla completa, zoom de 50 a 200 % (− / + / Ctrl −, Ctrl +), *Ajustar al ancho* y
 * abajo, siempre a la vista, cómo está y *Emitir*. Esc cierra.
 */
function VistaAmpliada({ documento, hojas, resumen, estadoTexto, listo, folio, alEmitir, alCerrar }) {
  const [zoom, setZoom] = useState(100);
  const caja = useRef(null);
  const cambiar = (d) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + d) / 25) * 25)));
  const ajustar = () => {
    const ancho = (caja.current?.clientWidth ?? ANCHO_HOJA) - 40;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.floor((ancho / ANCHO_HOJA) * 100))));
  };
  useEffect(() => {
    caja.current?.closest(".vista-ampliada")?.querySelector(".ampliada-cerrar")?.focus();
    const tecla = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        alCerrar();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        cambiar(25);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        cambiar(-25);
      }
    };
    document.addEventListener("keydown", tecla, true);
    return () => document.removeEventListener("keydown", tecla, true);
  }, []);
  return html`<div class="vista-ampliada" role="dialog" aria-modal="true" aria-labelledby="t-ampliada">
    <div class="ampliada-barra">
      <div class="ampliada-titulo">
        <h2 id="t-ampliada">Así saldrá impreso</h2>
        <span>${resumen}${hojas > 1 ? ` · ${hojas} hojas` : ""}</span>
      </div>
      <div class="ampliada-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Alejar" title="Alejar (Ctrl −)" disabled=${zoom <= ZOOM_MIN} onClick=${() => cambiar(-25)}>−</button>
        <span aria-live="polite">${zoom} %</span>
        <button type="button" aria-label="Acercar" title="Acercar (Ctrl +)" disabled=${zoom >= ZOOM_MAX} onClick=${() => cambiar(25)}>+</button>
        <button type="button" class="ampliada-ajustar" onClick=${ajustar}>Ajustar al ancho</button>
      </div>
      <button type="button" class="ampliada-cerrar" aria-label="Cerrar la vista ampliada (Esc)" title="Cerrar (Esc)" onClick=${alCerrar}>
        <${Icono} nombre="cerrar" tam=${20} />
      </button>
    </div>
    <div class="ampliada-hojas" ref=${caja}>
      <div class="ampliada-centro" style=${{ width: `${(ANCHO_HOJA * zoom) / 100}px` }}>
        <${HojasEscaladas} documento=${documento} escala=${zoom / 100} />
      </div>
    </div>
    <div class="ampliada-pie">
      <span class=${`ampliada-estado ${listo ? "listo" : ""}`}>${estadoTexto}</span>
      <span class="espaciador"></span>
      <${Boton} tamano="grande" onClick=${alCerrar}>← Seguir revisando<//>
      <${Boton} tipo="primario" tamano="grande" disabled=${!listo} onClick=${alEmitir}>Emitir vale · folio ${folio}<//>
    </div>
  </div>`;
}

/**
 * Paso 3. `datos` / `alCambiar(nuevo)`: el borrador. `listo`: los datos como se emitirán (`paraEmitir`). `pendientes` /
 * `bloquea`: de `pendientesParaEmitir`. `alIr(pendiente)`: lleva al paso y campo que lo corrige. `alEmitir`: emite
 * (con la confirmación del folio).
 */
export function PasoEmitir({ datos, alCambiar, listo, resumen, partidas, pendientes, bloquea, errores = [], capacidad, folio, alIrA, alIr, alEmitir }) {
  const [ampliada, setAmpliada] = useState(false);
  const porHoja = capacidad || listo.lineas.length || 1;
  const vales = [];
  for (let i = 0; i < Math.max(1, listo.lineas.length); i += porHoja) vales.push({ ...listo, lineas: listo.lineas.slice(i, i + porHoja), folio: null, tipo: "SALIDA" });
  const { documento, error } = useDocumento(vales);
  const justificar = (uid, justificacion) => alCambiar({ ...datos, lineas: datos.lineas.map((l) => (l.uid === uid ? { ...l, justificacion } : l)) });
  const textoResumen = [resumen.transferencia ? resumen.destino : resumen.area, resumen.recibe, `${listo.lineas.length} ${listo.lineas.length === 1 ? "partida" : "partidas"}`, `folio ${folio} al emitir`]
    .filter(Boolean)
    .join(" · ");
  const estadoTexto = bloquea ? `Falta${bloquea === 1 ? "" : "n"} ${bloquea}: ${pendientes.find((p) => p.pendiente)?.mensaje ?? ""}` : "✓ Todo listo";
  const listoParaEmitir = !bloquea && listo.lineas.length > 0;
  return html`<div class="paso-emitir">
    <div class="emitir-revision">
      ${errores.map((e, i) => html`<div class="aviso aviso-error" role="alert" key=${i}>${e.mensaje}</div>`)}
      <${PendientesVale} pendientes=${pendientes} bloquea=${bloquea} lineas=${datos.lineas} alIr=${alIr} alJustificar=${justificar} />
      <${ResumenParaQuien} datos=${resumen} alEditar=${() => alIrA(1)} />
      <${ResumenMaterial} partidas=${partidas} alEditar=${() => alIrA(2)} />
      <div class="fotos-paso"><${EditorVale} seccion="fotos" datos=${datos} alCambiar=${alCambiar} /></div>
    </div>

    <aside class="emitir-previa" aria-labelledby="t-impreso">
      <div class="previa-cabeza">
        <h2 id="t-impreso">Así saldrá impreso</h2>
        <button type="button" class="boton-editar" disabled=${!documento} onClick=${() => setAmpliada(true)}>
          <${Icono} nombre="ampliar" tam=${15} /><span>Ampliar</span>
        </button>
      </div>
      ${error
        ? html`<div class="aviso aviso-error">No se pudo preparar la vista previa: ${error}</div>`
        : documento
          ? html`<button type="button" class="miniatura-vale" aria-label="Ampliar la vista previa" onClick=${() => setAmpliada(true)}>
              <${HojasEscaladas} documento=${documento} />
            </button>`
          : html`<p class="nota miniatura-vacia">Preparando la vista previa…</p>`}
      ${vales.length > 1 ? html`<p class="nota pie-excedido">Se dividirá en ${vales.length} folios (${capacidad} partidas por hoja).</p>` : null}
      <div class="emitir-fijo">
        <${Boton} tipo="primario" tamano="grande" disabled=${!listoParaEmitir} onClick=${alEmitir}>
          Emitir vale · folio ${folio} <span class="tecla-boton" aria-hidden="true">Enter</span>
        <//>
        <p class="nota">${listoParaEmitir ? "Al emitir se asigna el folio; después lo imprimes." : "Se habilita al resolver lo pendiente."}</p>
      </div>
    </aside>

    ${ampliada && documento
      ? html`<${VistaAmpliada}
          documento=${documento}
          hojas=${vales.length}
          resumen=${textoResumen}
          estadoTexto=${estadoTexto}
          listo=${listoParaEmitir}
          folio=${folio}
          alEmitir=${() => {
            setAmpliada(false);
            alEmitir();
          }}
          alCerrar=${() => setAmpliada(false)}
        />`
      : null}
  </div>`;
}
