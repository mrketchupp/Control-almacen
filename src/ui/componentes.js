import { createContext } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
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

/**
 * Ventana en primer plano sobre la página, con el fondo oscurecido. Se cierra con ✕, con Escape
 * o con un clic fuera de ella.
 */
export function Ventana({ titulo, alCerrar, children, clase = "", etiqueta, cabeza = null, cerrando = false }) {
  const caja = useRef(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  useEffect(() => {
    const previo = document.activeElement;
    const tecla = (e) => {
      // Escape primero cierra la lista abierta de un campo; la ventana, después (solo la de arriba).
      if (e.key !== "Escape" || caja.current?.querySelector(".resultados")) return;
      const ventanas = document.querySelectorAll(".ventana");
      if (ventanas[ventanas.length - 1] !== caja.current) return;
      e.stopPropagation();
      cerrar.current();
    };
    document.addEventListener("keydown", tecla);
    document.body.classList.add("con-ventana");
    if (!caja.current?.contains(document.activeElement)) caja.current?.focus();
    return () => {
      document.removeEventListener("keydown", tecla);
      if (document.querySelectorAll(".ventana").length <= 1) document.body.classList.remove("con-ventana");
      if (previo && document.contains(previo)) previo.focus?.();
    };
  }, []);
  // Siempre sobre toda la página (aunque se abra dentro de otra ventana o de un contenedor).
  return createPortal(
    html`<div
    class=${`ventana-fondo ${cerrando ? "cerrando" : ""}`}
    onMouseDown=${(e) => {
      if (e.target === e.currentTarget) alCerrar();
    }}
  >
    <div class=${`ventana ${clase}`} role="dialog" aria-modal="true" aria-label=${etiqueta ?? titulo} tabindex="-1" ref=${caja}>
      <header class="ventana-cabeza">
        ${cabeza ?? html`<h2>${titulo}</h2>`}
        <button type="button" class="ventana-cerrar" onClick=${alCerrar} title="Cerrar (Esc)" aria-label="Cerrar">✕</button>
      </header>
      <div class="ventana-cuerpo">${children}</div>
    </div>
  </div>`,
    document.body,
  );
}

/** Botones de opción en fila (un solo valor elegido). */
export function Segmentos({ etiqueta, valor, opciones, alCambiar }) {
  return html`<div class="segmentos-campo">
    ${etiqueta ? html`<span class="segmentos-etiqueta">${etiqueta}</span>` : null}
    <div class="segmentos" role="radiogroup" aria-label=${etiqueta}>
      ${Object.entries(opciones).map(
        ([clave, texto]) => html`<button
          type="button"
          role="radio"
          aria-checked=${String(valor) === clave}
          class=${`segmento ${String(valor) === clave ? "activo" : ""}`}
          onClick=${() => alCambiar(clave)}
        >
          ${texto}
        </button>`,
      )}
    </div>
  </div>`;
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
  autoMarcar = true,
}) {
  const inicial = autoMarcar ? 0 : -1;
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(inicial);
  const lista = useRef(null);
  useEffect(() => {
    lista.current?.querySelector("li.marcado")?.scrollIntoView?.({ block: "nearest" });
  }, [marcado, abierto]);
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
      if (abierto && total && marcado >= 0) elegir(Math.min(marcado, total - 1));
      else {
        setAbierto(false);
        alEnter?.(e);
      }
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
        setMarcado(inicial);
      }}
      onFocus=${() => {
        if (abrirAlEnfocar) setAbierto(true);
        setMarcado(inicial);
      }}
      onBlur=${() => {
        setAbierto(false);
        alSalir?.();
      }}
      onKeyDown=${tecla}
    />
    ${abierto && total
      ? html`<ul class="resultados" role="listbox" ref=${lista}>
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

const sinAcentos = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

/**
 * Lista desplegable con el estilo de la herramienta (sustituye a <select>, cuya lista la
 * dibuja el navegador y no se puede estilizar). opciones: [{ valor, etiqueta, detalle? }]
 */
/**
 * Lista desplegable (sustituye a <select>). mostrar(actual): contenido del botón (si no, la
 * etiqueta de la opción elegida); cada opción puede traer render() para dibujarse distinto.
 */
export function Lista({ id, valor, opciones, alCambiar, ariaLabel, placeholder = "— Elige —", clase = "", deshabilitado = false, mostrar = null, titulo }) {
  const [abierta, setAbierta] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const lista = useRef(null);
  const igual = (o) => String(o.valor ?? "") === String(valor ?? "");
  const actual = opciones.find(igual);
  useEffect(() => {
    lista.current?.querySelector("li.marcado")?.scrollIntoView?.({ block: "nearest" });
  }, [marcado, abierta]);
  const abrir = () => {
    setMarcado(Math.max(0, opciones.findIndex(igual)));
    setAbierta(true);
  };
  const elegir = (o) => {
    setAbierta(false);
    if (!igual(o)) alCambiar(o.valor);
  };
  const tecla = (e) => {
    if (!abierta) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarcado(Math.min(marcado + 1, opciones.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarcado(Math.max(marcado - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (opciones[marcado]) elegir(opciones[marcado]);
    } else if (e.key === "Escape" || e.key === "Tab") setAbierta(false);
    else if (e.key.length === 1) {
      // Salta a la siguiente opción que empieza con esa letra.
      const letra = sinAcentos(e.key);
      const orden = [...opciones.keys()].map((i) => (marcado + 1 + i) % opciones.length);
      const i = orden.find((j) => sinAcentos(opciones[j].etiqueta).trim().startsWith(letra));
      if (i !== undefined) setMarcado(i);
    }
  };
  return html`<div class=${`lista ${clase}`}>
    <button
      type="button"
      id=${id}
      class="lista-boton"
      aria-haspopup="listbox"
      aria-expanded=${abierta}
      aria-label=${ariaLabel}
      title=${titulo}
      disabled=${deshabilitado}
      onClick=${() => (abierta ? setAbierta(false) : abrir())}
      onKeyDown=${tecla}
      onBlur=${() => setAbierta(false)}
    >
      ${mostrar ? mostrar(actual) : html`<span class=${`lista-valor ${actual ? "" : "lista-vacia"}`}>${actual ? actual.etiqueta : placeholder}</span>`}
      <span class="lista-flecha" aria-hidden="true">▾</span>
    </button>
    ${abierta && opciones.length
      ? html`<ul class="resultados" role="listbox" ref=${lista}>
          ${opciones.map(
            (o, i) => html`<li
              key=${String(o.valor ?? "")}
              role="option"
              aria-selected=${igual(o)}
              class=${`${i === marcado ? "marcado" : ""} ${igual(o) ? "elegida" : ""}`}
              onMouseDown=${(e) => {
                e.preventDefault();
                elegir(o);
              }}
            >
              ${o.render ? o.render() : html`<span>${o.etiqueta}</span>${o.detalle ? html`<span class="res-detalle">${o.detalle}</span>` : null}`}
            </li>`,
          )}
        </ul>`
      : null}
  </div>`;
}

/** Campo de texto libre con sugerencias (sustituye a <input list> + <datalist>). */
export function CampoSugerido({ id, valor, alCambiar, sugerencias, placeholder = "", ariaLabel, clase = "", limite = 12 }) {
  const texto = valor ?? "";
  const opciones = useMemo(() => {
    const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
    const exacto = sinAcentos(texto).trim();
    return sugerencias
      .filter((x) => sinAcentos(x).trim() !== exacto && palabras.every((w) => sinAcentos(x).includes(w)))
      .slice(0, limite);
  }, [texto, sugerencias, limite]);
  return html`<${Combo}
    id=${id}
    clase=${clase}
    valor=${texto}
    alEscribir=${alCambiar}
    opciones=${opciones}
    clave=${(x) => x}
    render=${(x) => x}
    alElegir=${alCambiar}
    placeholder=${placeholder}
    ariaLabel=${ariaLabel || placeholder}
    autoMarcar=${false}
  />`;
}
