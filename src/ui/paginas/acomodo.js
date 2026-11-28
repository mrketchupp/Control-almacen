// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §6, versión C): paso 3 · Acomodo del vale de entrada, contenedor
// por contenedor. A la derecha se elige un contenedor (los del inventario, los que haya); a la izquierda se marca lo que
// se guarda en él: primero lo que falta por acomodar y luego lo que ya está ahí (plegado si son más de 5). Lo que vive en
// un solo contenedor de su tipo llega ya acomodado (★). Teclas: 1…9 eligen el contenedor; ↑ ↓ y Espacio, las partidas.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { decTexto } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { ErrorAcomodo, acomodar, acomodoDe, avanceAcomodo, claseDeLinea, contenedoresDe, desacomodar } from "../../servicios/acomodoEntrada.js";
import { lineasEntradaCapturadas, vistaPreviaEntrada } from "../../servicios/entradas.js";
import { camposDeLinea } from "../../servicios/materialEntrada.js";
import { useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const enCampo = (el) => Boolean(el?.closest?.("input, textarea, select, [contenteditable=true]"));
/** «#1 y #3», «#1, #2 y #4». */
const enLista = (numeros) => {
  const t = numeros.map((n) => `#${n}`);
  return t.length < 2 ? (t[0] ?? "") : `${t.slice(0, -1).join(", ")} y ${t.at(-1)}`;
};
/** Una partida en pocas palabras: «BALEROS 6311-2RS». */
export const nombreCorto = (l, indices) => {
  const c = camposDeLinea(l, indices);
  return [texto(l.descripcion), l.no_inventariado ? texto(l.clave) || "S/D" : c.dimension || "S/D"].filter(Boolean).join(" ");
};

/** El punto de tipo (§7): relleno = inventariable, contorno = consumible; sin texto, con su nombre para el lector. */
export function PuntoTipo({ clase }) {
  const nombre = clase === "INV" ? "Inventariable" : "Consumible";
  return html`<span class=${`punto-tipo punto-${clase === "INV" ? "inv" : "cons"}`} role="img" aria-label=${nombre} title=${nombre}></span>`;
}

/** Una partida para marcar (§6): casilla · punto de tipo · qué es · lo que se sabe de dónde va · cantidad. */
function FilaAcomodo({ l, estado, indices, previa, marcada, deshabilitada, alMarcar }) {
  const a = acomodoDe(estado, l, { indices });
  const c = camposDeLinea(l, indices);
  const clase = claseDeLinea(l, indices) ?? "CONS";
  let pista = null;
  if (a.estado === "falta") pista = html`<span class="pista-alerta">${a.falta === "codigo" ? "Falta el código" : "Falta elegir la clave"}: corrígela en Material</span>`;
  else if (a.estado === "pendiente") {
    pista = a.donde.length
      ? html`<span class="pista-alerta">Con existencia en ${enLista(a.donde)}</span>`
      : l.alta
        ? html`<span class="pista-alerta">Variante nueva · sin existencia en ningún contenedor</span>`
        : html`<span class="pista-alerta">Sin existencia como ${clase === "INV" ? "inventariable" : "consumible"}</span>`;
  } else if (a.estado === "acomodada") {
    const cuanto = previa ? (previa.renglon_nuevo ? `nueva → ${decTexto(previa.queda) ?? ""}` : `${decTexto(previa.habia) ?? "0"} → ${decTexto(previa.queda) ?? ""}`) : "";
    pista = a.ya
      ? html`<span class="pista-ok">★ ya tiene existencia aquí${cuanto ? ` · ${cuanto}` : ""}${a.fx ? " · FX" : ""}</span>`
      : html`<span class="pista-nueva">Partida nueva en esta hoja${cuanto ? ` · ${cuanto}` : ""}</span>`;
  }
  const dimension = c.dimension || "S/D";
  return html`<li class=${`fila-acomodo ${marcada ? "marcada" : ""} ${deshabilitada ? "deshabilitada" : ""}`}>
    <label>
      <input type="checkbox" checked=${marcada} disabled=${deshabilitada} onChange=${(e) => alMarcar(e.currentTarget.checked)}
        aria-label=${`${dimension}${c.np ? ` NP ${c.np}` : ""} · ${l.codigo ?? ""} ${l.descripcion ?? ""} · ${texto(l.cantidad)} ${texto(l.um)}`} />
      <${PuntoTipo} clase=${clase} />
      <span class="fila-acomodo-que">
        <span class="clave-entrada">${dimension}${c.np ? html` <span class="np-entrada">· NP ${c.np}</span>` : null}</span>
        <span class="codigo-entrada">${l.codigo ?? "Sin código"} · ${l.descripcion || "—"}</span>
        ${pista}
      </span>
      <span class="fila-acomodo-cantidad">${texto(l.cantidad) || "—"} ${texto(l.um)}</span>
    </label>
  </li>`;
}

/** Paso 3. `alRegresar` / `avanzar`: los botones del pie (el de avanzar, deshabilitado mientras falte alguna). */
export function PasoAcomodo({ datos, alCambiar, alRegresar, avanzar, excluirValeId = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const contenedores = useMemo(() => contenedoresDe(estado), [estado.ubicaciones]);
  const partidas = lineasEntradaCapturadas(datos.lineas);
  const avance = avanceAcomodo(estado, partidas, { indices });
  // En una corrección, «hay» no cuenta lo que la entrada misma ya sumaba.
  const previa = useMemo(() => new Map(vistaPreviaEntrada(estado, datos, { excluirValeId }).map((p) => [p.uid, p])), [estado, datos, excluirValeId]);
  const [elegido, setElegido] = useState(null);
  const [anuncio, setAnuncio] = useState("");
  const [error, setError] = useState(null);
  const [verYa, setVerYa] = useState(null); // null = según cuántas (plegado con más de 5)
  const actual = useRef({ datos, alCambiar });
  actual.current = { datos, alCambiar };
  const lista = useRef(null);

  const aplicar = (fn) => {
    const hoy = actual.current.datos;
    const nuevo = { ...hoy, lineas: fn(lineasEntradaCapturadas(hoy.lineas)) };
    actual.current = { ...actual.current, datos: nuevo };
    actual.current.alCambiar(nuevo);
    return nuevo;
  };
  const anunciar = (frase, lineas) => {
    const { faltan } = avanceAcomodo(estado, lineas, { indices });
    setAnuncio(`${frase} ${faltan.length ? `Faltan ${faltan.length}.` : "Todo acomodado."}`);
  };
  const marcar = (l, si) => {
    setError(null);
    try {
      const nuevo = aplicar((lineas) => lineas.map((x) => (x.uid === l.uid ? (si ? acomodar(estado, x, elegido, { indices }) : desacomodar(x, indices)) : x)));
      anunciar(si ? `Partida acomodada en el #${elegido}.` : "Partida regresada a «Faltan por acomodar».", nuevo.lineas);
    } catch (e) {
      if (!(e instanceof ErrorAcomodo)) throw e;
      setError(e.message);
      setAnuncio(e.message);
    }
  };
  const elegir = (numero) => {
    setElegido(numero);
    setError(null);
    setVerYa(null);
  };
  // 1…9 eligen el contenedor de esa posición (fuera de los campos y sin ventana encima, §12).
  const teclas = useRef(null);
  teclas.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
    if (enCampo(e.target) || document.querySelector(".ventana")) return;
    const c = contenedores[Number(e.key) - 1];
    if (!c) return;
    e.preventDefault();
    elegir(c.numero);
    requestAnimationFrame(() => document.getElementById(`contenedor-${c.numero}`)?.focus());
  };
  useEffect(() => {
    const escuchar = (e) => teclas.current(e);
    document.addEventListener("keydown", escuchar);
    return () => document.removeEventListener("keydown", escuchar);
  }, []);
  // ↑ ↓ recorren las casillas de la izquierda (Espacio marca, como siempre).
  const flechas = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const casillas = [...lista.current.querySelectorAll("input[type=checkbox]:not(:disabled)")];
    const i = casillas.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    casillas[Math.min(casillas.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };
  // ← → entre los contenedores (como pestañas).
  const flechasContenedores = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const i = contenedores.findIndex((c) => `contenedor-${c.numero}` === document.activeElement?.id);
    if (i < 0) return;
    e.preventDefault();
    const paso = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const otro = contenedores[(i + paso + contenedores.length) % contenedores.length];
    elegir(otro.numero);
    document.getElementById(`contenedor-${otro.numero}`)?.focus();
  };

  const faltan = avance.faltan;
  const yaAqui = elegido === null ? [] : partidas.filter((l) => {
    const a = acomodoDe(estado, l, { indices });
    return a.estado === "acomodada" && a.contenedor === elegido;
  });
  const plegar = verYa === null ? yaAqui.length > 5 : !verYa;
  const elegidoC = contenedores.find((c) => c.numero === elegido) ?? null;
  const fila = (l, marcada) => {
    const a = acomodoDe(estado, l, { indices });
    return html`<${FilaAcomodo}
      key=${l.uid}
      l=${l}
      estado=${estado}
      indices=${indices}
      previa=${previa.get(l.uid)}
      marcada=${marcada}
      deshabilitada=${elegido === null || a.estado === "falta"}
      alMarcar=${(si) => marcar(l, si)}
    />`;
  };
  const yaAcomodadas = avance.acomodadas;

  return html`<div class="paso-acomodo">
    <section
      class="acomodo-izq"
      id="panel-acomodo"
      role=${elegidoC ? "tabpanel" : undefined}
      aria-labelledby=${elegidoC ? `contenedor-${elegido}` : "t-faltan"}
      ref=${lista}
      onKeyDown=${flechas}
      data-sin-avanzar
    >
      ${elegidoC
        ? html`<h2 class="acomodo-titulo">¿Qué guardas en el contenedor #${elegido}? <span class="nota">marca una o varias · se acomodan al marcarlas</span></h2>
            ${error ? html`<p class="aviso-acomodo-error" role="alert">${error}</p>` : null}
            <p class="etiqueta-grupo" id="t-faltan">Faltan por acomodar · ${faltan.length}</p>
            ${faltan.length ? html`<ul class="lista-acomodo">${faltan.map((l) => fila(l, false))}</ul>` : html`<p class="acomodo-vacio">✓ Ya no falta ninguna.</p>`}
            <details class="grupo-ya" open=${!plegar} onToggle=${(e) => setVerYa(e.currentTarget.open)}>
              <summary>Ya en el #${elegido} · ${yaAqui.length}</summary>
              ${yaAqui.length ? html`<ul class="lista-acomodo">${yaAqui.map((l) => fila(l, true))}</ul>` : html`<p class="acomodo-vacio">Nada de esta entrada todavía.</p>`}
            </details>`
        : html`<h2 class="acomodo-titulo" id="t-faltan">Faltan por acomodar · ${faltan.length}</h2>
            <p class="aviso-acomodo"><${Icono} nombre="caja" tam=${16} /><span><strong>Elige un contenedor</strong> y marca aquí lo que guardas en él.</span></p>
            ${faltan.length ? html`<ul class="lista-acomodo">${faltan.map((l) => fila(l, false))}</ul>` : html`<p class="acomodo-vacio">✓ Todo quedó acomodado.</p>`}
            ${yaAcomodadas
              ? html`<p class="nota">${yaAcomodadas === 1 ? "La otra ya quedó" : `Las otras ${yaAcomodadas} ya quedaron`} en su contenedor (★ donde ya tenían existencia). Para verlas o cambiarlas, entra a su contenedor.</p>`
              : null}`}
    </section>

    <div class="acomodo-der">
      <h2 class="acomodo-subtitulo" id="t-contenedores">Contenedores</h2>
      <div class="rejilla-contenedores" role="tablist" aria-labelledby="t-contenedores" onKeyDown=${flechasContenedores}>
        ${contenedores.map((c, i) => {
          const cuantas = avance.porContenedor.get(c.numero) ?? 0;
          const activo = c.numero === elegido;
          return html`<button
            type="button"
            key=${c.numero}
            id=${`contenedor-${c.numero}`}
            role="tab"
            aria-selected=${activo}
            aria-controls="panel-acomodo"
            aria-keyshortcuts=${i < 9 ? String(i + 1) : undefined}
            tabIndex=${activo || (elegido === null && i === 0) ? 0 : -1}
            class=${`boton-contenedor ${activo ? "elegido" : ""}`}
            onClick=${() => elegir(c.numero)}
          >
            <${Icono} nombre="caja" tam=${22} />
            <span class="boton-contenedor-texto">
              <strong>Contenedor #${c.numero}</strong>
              <span>${cuantas} de esta entrada${!c.hojas.INV ? " · sin hoja de inventariables" : !c.hojas.CONS ? " · sin hoja de consumibles" : ""}</span>
            </span>
            ${i < 9 ? html`<span class="tecla-opcion" aria-hidden="true">${i + 1}</span>` : null}
          </button>`;
        })}
      </div>
      <div class="avance-acomodo" role="status">
        <strong>${avance.acomodadas} de ${avance.total} acomodadas</strong>
        <div class="barra-avance" aria-hidden="true"><span style=${{ width: `${avance.total ? Math.round((avance.acomodadas / avance.total) * 100) : 100}%` }}></span></div>
        ${faltan.length
          ? html`<p class="faltan-acomodo"><strong>Faltan ${faltan.length}:</strong> ${faltan.map((l) => nombreCorto(l, indices)).join(" · ")}</p>`
          : html`<p class="todo-acomodado">✓ Todo acomodado</p>`}
      </div>
      ${avance.sinExistencia.length
        ? html`<div class="sin-existencia-acomodo">
            <p class="etiqueta-grupo">Sin existencia · no se acomoda</p>
            <div class="pastillas-sin">
              ${avance.sinExistencia.map(
                (l) => html`<span class="pastilla-sin" key=${l.uid}><strong>${texto(l.cantidad)} ${texto(l.um)}</strong> <span class="clave-entrada">${texto(l.clave) || "S/D"}</span> · ${l.descripcion}</span>`,
              )}
            </div>
          </div>`
        : null}
      <div class="pie-paso pie-acomodo">
        ${alRegresar}
        ${avanzar}
      </div>
    </div>
    <div class="solo-lector" aria-live="polite">${anuncio}</div>
  </div>`;
}
