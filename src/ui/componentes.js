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

export function Boton({ tipo = "secundario", children, ...props }) {
  return html`<button type="button" class=${`boton boton-${tipo}`} ...${props}>${children}</button>`;
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
