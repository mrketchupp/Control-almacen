// Menús optativos por elemento. No interceptan campos de captura, texto seleccionado
// ni zonas sin acciones; Mayús + clic derecho conserva el menú del navegador.
import { createContext } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { html } from "./html.js";
import { recordarElemento } from "./portapapelesElementos.js";

const ContextoMenu = createContext(null);
const CAPTURA = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Atributos para un elemento: ...menu({ titulo, opciones }) o una función con datos vigentes. */
export function useMenuContextual() {
  const abrir = useContext(ContextoMenu);
  return (datos) => ({
    onContextMenu: (e) => abrir?.(e, datos),
    onKeyDown: (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) abrir?.(e, datos);
    },
  });
}

function Menu({ datos, cerrar, sesion }) {
  const caja = useRef(null);
  const [posicion, setPosicion] = useState({ left: datos.x, top: datos.y });
  useLayoutEffect(() => {
    const r = caja.current.getBoundingClientRect();
    setPosicion({
      left: Math.max(8, Math.min(datos.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(datos.y, window.innerHeight - r.height - 8)),
    });
    caja.current.querySelector("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
  }, [datos]);
  useEffect(() => {
    const fuera = (e) => { if (!caja.current?.contains(e.target)) cerrar(false); };
    const salir = () => cerrar(false);
    const teclado = (e) => {
      // Las ventanas y el editor no deben recibir Escape, flechas o atajos mientras está abierto.
      if (!caja.current?.contains(e.target)) return;
      e.stopImmediatePropagation();
      const botones = [...caja.current.querySelectorAll("[role=menuitem]:not(:disabled)")];
      const i = botones.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const siguiente = e.key === "Home" ? 0 : e.key === "End" ? botones.length - 1
          : (i + (e.key === "ArrowDown" ? 1 : -1) + botones.length) % botones.length;
        botones[siguiente]?.focus();
      } else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        cerrar(true);
      }
    };
    const posicionScroll = (el) => el === document ? [window.scrollX, window.scrollY] : [el.scrollLeft, el.scrollTop];
    const desplazamientos = new Map([[document, posicionScroll(document)]]);
    for (let el = datos.origen; el; el = el.parentElement) desplazamientos.set(el, posicionScroll(el));
    const scroll = (e) => {
      if (caja.current?.contains(e.target)) return;
      const antes = desplazamientos.get(e.target), ahora = posicionScroll(e.target);
      // Sólo afecta el desplazamiento del elemento pulsado y sus contenedores.
      // Un evento anterior al clic o de otro panel no cambia el anclaje del menú.
      if (!antes || (antes[0] === ahora[0] && antes[1] === ahora[1])) return;
      salir();
    };
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("contextmenu", fuera, true);
    document.addEventListener("keydown", teclado, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", salir);
    window.addEventListener("blur", salir);
    window.addEventListener("hashchange", salir);
    return () => {
      document.removeEventListener("pointerdown", fuera, true);
      document.removeEventListener("contextmenu", fuera, true);
      document.removeEventListener("keydown", teclado, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", salir);
      window.removeEventListener("blur", salir);
      window.removeEventListener("hashchange", salir);
    };
  }, [datos]);
  const hacer = (opcion) => {
    cerrar(true);
    try {
      Promise.resolve(opcion.accion?.()).catch((e) => sesion.avisar("error", e?.message || String(e)));
    } catch (e) {
      sesion.avisar("error", e?.message || String(e));
    }
  };
  return createPortal(html`<div class="menu-contextual" role="menu" aria-label=${datos.titulo} ref=${caja}
    style=${`left:${posicion.left}px;top:${posicion.top}px`} onContextMenu=${(e) => e.preventDefault()}>
    <div class="menu-contextual-titulo">${datos.titulo}</div>
    ${datos.opciones.map((o, i) => html`${o.separador && i ? html`<div class="menu-contextual-separador" role="separator"></div>` : null}
      <button type="button" role="menuitem" tabindex="-1" disabled=${o.deshabilitado}
        aria-keyshortcuts=${o.atajo?.replace("Ctrl", "Control").replace("Supr", "Delete")}
        class=${o.peligro ? "menu-contextual-peligro" : ""} onClick=${() => hacer(o)}>
        <span>${o.texto}</span>${o.atajo ? html`<small aria-hidden="true">${o.atajo}</small>` : null}
      </button>`)}
  </div>`, document.body);
}

export function MenusContextuales({ children, sesion }) {
  const [datos, setDatos] = useState(null);
  const actual = useRef(null);
  const cerrar = (devolverFoco = false) => {
    const origen = actual.current?.origen;
    actual.current = null;
    setDatos(null);
    if (devolverFoco && origen?.isConnected) origen.focus?.({ preventScroll: true });
  };
  useEffect(() => sesion.suscribir(() => cerrar(false)), [sesion]);
  useEffect(() => {
    // Una copia de texto reemplaza también la copia de elementos de esta sesión.
    const limpiar = () => recordarElemento(null);
    document.addEventListener("copy", limpiar);
    document.addEventListener("cut", limpiar);
    return () => { document.removeEventListener("copy", limpiar); document.removeEventListener("cut", limpiar); };
  }, []);
  const abrir = (e, configurar) => {
    if (e.defaultPrevented || e.target?.closest?.(CAPTURA)) return;
    if (e.type === "contextmenu" && e.shiftKey) return;
    const seleccion = window.getSelection();
    if (seleccion && !seleccion.isCollapsed) return;
    const config = typeof configurar === "function" ? configurar() : configurar;
    const opciones = (config?.opciones ?? []).filter((o) => o && o.visible !== false);
    if (!opciones.some((o) => !o.deshabilitado)) return;
    e.preventDefault();
    e.stopPropagation();
    const teclado = e.type === "keydown" || (!e.clientX && !e.clientY);
    const r = e.currentTarget.getBoundingClientRect();
    const origen = e.target?.closest?.("button, a[href], [tabindex]") ?? e.currentTarget;
    const nuevo = {
      titulo: config.titulo, opciones, origen,
      x: teclado ? r.left : e.clientX, y: teclado ? r.bottom : e.clientY,
    };
    actual.current = nuevo;
    setDatos(nuevo);
  };
  return html`<${ContextoMenu.Provider} value=${abrir}>${children}
    ${datos ? html`<${Menu} datos=${datos} cerrar=${cerrar} sesion=${sesion} />` : null}
  <//>`;
}
