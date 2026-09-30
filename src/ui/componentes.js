import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { html } from "./html.js";

export const ContextoSesion = createContext(null);

/** La sesión y un contador que cambia cada vez que algo cambia (para volver a dibujar). */
export function useSesion() {
  const sesion = useContext(ContextoSesion);
  const [, setVersion] = useState(sesion.version);
  useEffect(() => sesion.suscribir(setVersion), [sesion]);
  return sesion;
}

export const formatoNumero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 });
export const num = (v) => (v === null || v === undefined || v === "" ? "" : formatoNumero.format(v));

export function Tarjeta({ titulo, children, acciones, clase = "" }) {
  return html`<section class=${`tarjeta ${clase}`}>
    ${titulo || acciones
      ? html`<header class="tarjeta-cabeza">
          ${titulo ? html`<h2>${titulo}</h2>` : null}
          ${acciones ? html`<div class="acciones">${acciones}</div>` : null}
        </header>`
      : null}
    ${children}
  </section>`;
}

export function Aviso({ tipo = "info", titulo, children }) {
  return html`<div class=${`aviso aviso-${tipo}`} role=${tipo === "error" ? "alert" : "status"}>
    ${titulo ? html`<strong>${titulo}</strong>` : null}
    <div>${children}</div>
  </div>`;
}

export function Dato({ etiqueta, valor, detalle, tono }) {
  return html`<div class=${`dato ${tono ? `dato-${tono}` : ""}`}>
    <span class="dato-etiqueta">${etiqueta}</span>
    <span class="dato-valor">${valor ?? "—"}</span>
    ${detalle ? html`<span class="dato-detalle">${detalle}</span>` : null}
  </div>`;
}

export function Insignia({ tono = "neutro", children }) {
  return html`<span class=${`insignia insignia-${tono}`}>${children}</span>`;
}

export function Boton({ tipo = "secundario", tamano = "", children, ...props }) {
  return html`<button type="button" class=${`boton boton-${tipo} ${tamano ? `boton-${tamano}` : ""}`} ...${props}>${children}</button>`;
}

/** Botón que abre el selector de archivos. */
export function ElegirArchivo({ etiqueta, acepta, alElegir, tipo = "secundario", deshabilitado }) {
  return html`<label class=${`boton boton-${tipo} ${deshabilitado ? "deshabilitado" : ""}`}>
    ${etiqueta}
    <input
      type="file"
      accept=${acepta}
      disabled=${deshabilitado}
      onChange=${(e) => {
        const archivo = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (archivo) alElegir(archivo);
      }}
      hidden
    />
  </label>`;
}

export function Detalles({ resumen, children, abierto = false }) {
  return html`<details class="detalles" open=${abierto}>
    <summary>${resumen}</summary>
    <div class="detalles-cuerpo">${children}</div>
  </details>`;
}

/**
 * Tabla simple con encabezado fijo. columnas: [{ clave, titulo, numero, ancho, render }]
 */
export function Tabla({ columnas, filas, vacia = "Sin renglones.", limite = null, claveFila = (f, i) => f.id ?? i }) {
  const [mostrar, setMostrar] = useState(limite);
  // Vuelve al límite solo si cambia el contenido (no en cada redibujo).
  const firma = `${filas.length}:${filas.length ? claveFila(filas[0], 0) : ""}:${filas.length ? claveFila(filas[filas.length - 1], filas.length - 1) : ""}`;
  useEffect(() => setMostrar(limite), [firma, limite]);
  const visibles = mostrar ? filas.slice(0, mostrar) : filas;
  if (!filas.length) return html`<p class="vacio">${vacia}</p>`;
  return html`<div class="tabla-contenedor">
      <table class="tabla">
        <thead>
          <tr>
            ${columnas.map(
              (c) => html`<th class=${c.numero ? "numero" : ""} style=${c.ancho ? `width:${c.ancho}` : ""}>${c.titulo}</th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${visibles.map(
            (fila, i) => html`<tr key=${claveFila(fila, i)} class=${fila._clase || ""}>
              ${columnas.map(
                (c) => html`<td class=${c.numero ? "numero" : ""}>${c.render ? c.render(fila) : fila[c.clave]}</td>`,
              )}
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
    ${mostrar && filas.length > mostrar
      ? html`<div class="mas">
          <span>Mostrando ${mostrar} de ${filas.length}</span>
          <${Boton} onClick=${() => setMostrar(mostrar + limite)}>Ver ${Math.min(limite, filas.length - mostrar)} más<//>
          <${Boton} onClick=${() => setMostrar(null)}>Ver todos<//>
        </div>`
      : null}`;
}

export function Buscador({ valor, alCambiar, placeholder = "Buscar…" }) {
  return html`<input
    type="search"
    class="buscador"
    placeholder=${placeholder}
    value=${valor}
    onInput=${(e) => alCambiar(e.currentTarget.value)}
    aria-label=${placeholder}
  />`;
}

/** Filtro de texto: todas las palabras deben aparecer en alguno de los campos. */
export function useFiltroTexto(filas, texto, campos) {
  return useMemo(() => {
    const palabras = texto
      .toUpperCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .split(/\s+/)
      .filter(Boolean);
    if (!palabras.length) return filas;
    return filas.filter((f) => {
      const todo = campos
        .map((c) => f[c] ?? "")
        .join(" ")
        .toUpperCase()
        .normalize("NFKD")
        .replace(/\p{M}/gu, "");
      return palabras.every((p) => todo.includes(p));
    });
  }, [filas, texto]);
}

export function confirmar(texto) {
  return window.confirm(texto);
}

/**
 * Campo de texto con lista de opciones (combobox). El padre calcula las opciones a partir
 * del texto. Flechas para moverse, Enter elige, Escape cierra.
 *   extra: { etiqueta, alElegir } → última opción fija (p. ej. "Otra clave…")
 *   alEnter(e): Enter con la lista cerrada o vacía
 *   alSalir(): al perder el foco (sin haber elegido de la lista)
 */
export function Combo({
  id,
  valor,
  alEscribir,
  opciones,
  render,
  alElegir,
  clave = (o, i) => i,
  extra = null,
  placeholder = "",
  clase = "",
  ariaLabel,
  deshabilitado = false,
  alEnter = null,
  alSalir = null,
  abrirAlEnfocar = true,
}) {
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const total = opciones.length + (extra ? 1 : 0);
  const elegir = (i) => {
    setAbierto(false);
    if (i < opciones.length) alElegir(opciones[i]);
    else extra?.alElegir();
  };
  const tecla = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!abierto) setAbierto(true);
      else setMarcado(Math.min(marcado + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarcado(Math.max(marcado - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (abierto && total) elegir(Math.min(marcado, total - 1));
      else alEnter?.(e);
    } else if (e.key === "Escape") setAbierto(false);
  };
  return html`<div class=${`combo ${clase}`}>
    <input
      id=${id}
      value=${valor}
      placeholder=${placeholder}
      disabled=${deshabilitado}
      autocomplete="off"
      role="combobox"
      aria-expanded=${abierto && total > 0}
      aria-label=${ariaLabel || placeholder}
      onInput=${(e) => {
        alEscribir(e.currentTarget.value);
        setAbierto(true);
        setMarcado(0);
      }}
      onFocus=${() => {
        if (abrirAlEnfocar) setAbierto(true);
        setMarcado(0);
      }}
      onBlur=${() => {
        setAbierto(false);
        alSalir?.();
      }}
      onKeyDown=${tecla}
    />
    ${abierto && total
      ? html`<ul class="resultados" role="listbox">
          ${opciones.map(
            (o, i) => html`<li
              key=${clave(o, i)}
              role="option"
              aria-selected=${i === marcado}
              class=${i === marcado ? "marcado" : ""}
              onMouseDown=${(e) => {
                e.preventDefault();
                elegir(i);
              }}
            >
              ${render(o)}
            </li>`,
          )}
          ${extra
            ? html`<li
                class=${`manual ${marcado === opciones.length ? "marcado" : ""}`}
                role="option"
                onMouseDown=${(e) => {
                  e.preventDefault();
                  elegir(opciones.length);
                }}
              >
                ${extra.etiqueta}
              </li>`
            : null}
        </ul>`
      : null}
  </div>`;
}

/** Pastilla de información (secundaria al dato principal). */
export function Pastilla({ tono = "neutro", titulo, children }) {
  return html`<span class=${`pastilla pastilla-${tono}`} title=${titulo}>${children}</span>`;
}
