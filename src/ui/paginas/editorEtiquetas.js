// Editor de diseños de etiqueta (Ronda 22), en primer plano y a pantalla completa. Tres zonas:
// - izquierda: los diseños (los de fábrica, con candado, son de solo lectura: se duplican para editarlos),
//   nuevo / duplicar / renombrar / borrar (con Deshacer) y qué lista imprime con cada uno;
// - centro: la etiqueta grande, al tamaño de la plantilla actual (mm reales escalados), con los datos de la
//   primera etiqueta de la lista o de la muestra, vista como Material o Código AX y como DLTA o GSM. Cada
//   elemento se dibuja con el MISMO HTML que se imprime (`htmlElemento`) y encima va una capa con su marco,
//   las 8 asas, la cuadrícula y las guías;
// - derecha: agregar elementos y las propiedades del elegido.
// La geometría, el imán, las guías y el deshacer viven en impresion/lienzo.js (se prueban en Node); aquí
// solo se traduce el ratón y el teclado. Se guarda con servicios/etiquetas.js `guardarModeloEtiqueta`.

import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { codigo128 } from "../../impresion/barras.js";
import { avisosElemento, cssEtiqueta, htmlElemento, llenarPlantilla, muestraEtiqueta } from "../../impresion/etiquetas.js";
import * as lz from "../../impresion/lienzo.js";
import { ALINEACIONES, CAMPOS_ETIQUETA, ESPACIADO, FABRICA_POR_TIPO, LARGOS, LETRA, MAXIMO_ELEMENTOS, PROPIEDADES, TIPOS_ELEMENTO, esModeloDeFabrica, normalizarElemento, VERTICALES } from "../../impresion/modelos.js";
import { INVENTARIOS } from "../../nucleo/inventarios.js";
import * as et from "../../servicios/etiquetas.js";
import { Aviso, Boton, Lista, Pastilla, Segmentos, Teclas, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const TIPOS = et.TIPOS_ETIQUETA;
const OPCIONES_INVENTARIO = Object.fromEntries(INVENTARIOS.map((i) => [i.id, i.id]));
const CLAVE_PREFERENCIAS = "control-almacen.editor-etiquetas";

/** Lo que se ofrece en «Agregar», en este orden («Campo…» va aparte, con su lista). */
const AGREGAR_ANTES = [
  ["titulo", "Título"],
  ["texto_almacen", "Texto de almacén"],
  ["logo_izq", "Logo izq."],
  ["logo_der", "Logo der."],
];
const AGREGAR_DESPUES = [
  ["texto", "Texto libre"],
  ["qr", "Código QR"],
  ["barras", "Código de barras"],
];

const CURSOR_ASA = { no: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize", se: "nwse-resize", s: "ns-resize", so: "nesw-resize", o: "ew-resize" };
const NOMBRE_ASA = { no: "arriba a la izquierda", n: "arriba", ne: "arriba a la derecha", e: "derecha", se: "abajo a la derecha", s: "abajo", so: "abajo a la izquierda", o: "izquierda" };

const elementosDe = (n) => `${num(n)} ${n === 1 ? "elemento" : "elementos"}`;
const redondo = (n) => String(Math.round(n * 100) / 100);

function preferenciasGuardadas() {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS) ?? "{}");
    return { cuadricula: p.cuadricula !== false, iman: p.iman !== false, paso: lz.PASOS_CUADRICULA.includes(p.paso) ? p.paso : 1 };
  } catch {
    return { cuadricula: true, iman: true, paso: 1 };
  }
}

function recordarPreferencias(p) {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(p));
  } catch {
    // Sin almacenamiento (ventana privada): solo no se recuerda.
  }
}

/** Cómo se llama un elemento en la interfaz. */
export function nombreElemento(el) {
  if (el.tipo === "campo") return `Campo: ${CAMPOS_ETIQUETA[el.campo] ?? el.campo}`;
  return TIPOS_ELEMENTO[el.tipo] ?? el.tipo;
}

/** Por qué un elemento no se dibuja con estos datos (su marco lo dice). */
function porQueNoSeVe(el, etiqueta) {
  const inv = etiqueta?.inventario ?? "";
  switch (el.tipo) {
    case "logo_izq":
    case "logo_der":
      return `${TIPOS_ELEMENTO[el.tipo]}: ${inv} no tiene (Hoja y logos)`;
    case "texto_almacen":
      return `Texto de almacén: ${inv} no tiene (Hoja y logos)`;
    case "qr":
    case "barras":
      return `${TIPOS_ELEMENTO[el.tipo]}: sin datos que poner`;
    default:
      return `${nombreElemento(el)}: no se dibuja`;
  }
}

/** Si el texto de un elemento ya dibujado no cabe en su caja (se corta o se sale). */
function desborda(caja) {
  const tol = 1;
  if (caja.scrollHeight > caja.clientHeight + tol || caja.scrollWidth > caja.clientWidth + tol) return true;
  const dentro = caja.querySelector(".etq-t, .etq-bar-txt");
  if (!dentro) return false;
  if (dentro.scrollHeight > dentro.clientHeight + tol || dentro.scrollWidth > dentro.clientWidth + tol) return true;
  for (const s of dentro.querySelectorAll("span")) if (s.scrollWidth > s.clientWidth + tol) return true;
  const a = dentro.getBoundingClientRect();
  const b = caja.getBoundingClientRect();
  return a.height > b.height + 0.5;
}

/** Una tecla que cambiaría el texto (para avisar en un diseño de fábrica). */
const esIntento = (e) => !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete");

// ---------------------------------------------------------------- campos del panel

/** Número escrito a mano: se usa al salir del campo o con Enter; flechas ↑ ↓ suben o bajan `paso` (Shift: ×10). */
let siguienteId = 0;

function CampoNumero({ etiqueta, valor, alCambiar, paso = 0.5, detalle = null, soloLectura = false, alIntentar, ayuda = null }) {
  const [texto, setTexto] = useState(null);
  const idDetalle = useRef(null);
  idDetalle.current ??= `edd-detalle-${++siguienteId}`;
  const mostrado = texto ?? redondo(valor);
  const fijar = () => {
    if (texto === null) return;
    const n = Number(String(texto).trim().replace(",", "."));
    setTexto(null);
    if (String(texto).trim() !== "" && Number.isFinite(n) && n !== valor) alCambiar(n);
  };
  return html`<label class="campo edd-num" title=${ayuda}>
    <span>${etiqueta}</span>
    <input
      type="text"
      inputmode="decimal"
      aria-label=${etiqueta}
      aria-describedby=${detalle ? idDetalle.current : undefined}
      value=${mostrado}
      readOnly=${soloLectura}
      onInput=${(e) => setTexto(e.currentTarget.value)}
      onBlur=${fijar}
      onPaste=${(e) => {
        if (soloLectura) {
          e.preventDefault();
          alIntentar();
        }
      }}
      onKeyDown=${(e) => {
        if (soloLectura) {
          if (esIntento(e) || e.key === "ArrowUp" || e.key === "ArrowDown") alIntentar();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          fijar();
        } else if (e.key === "Escape" && texto !== null) {
          e.stopPropagation();
          setTexto(null);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = Number(String(mostrado).replace(",", "."));
          const n = (Number.isFinite(base) ? base : valor) + (e.key === "ArrowUp" ? 1 : -1) * paso * (e.shiftKey ? 10 : 1);
          setTexto(null);
          alCambiar(Math.round(n * 100) / 100);
        }
      }}
    />
    ${detalle ? html`<small id=${idDetalle.current}>${detalle}</small>` : null}
  </label>`;
}

/**
 * Texto: se aplica mientras se escribe (lo que se ve es lo escrito; el diseño lo guarda limpio). Los
 * marcadores ({codigo}…) se insertan donde está el cursor.
 */
function CampoTexto({ etiqueta, valor, alCambiar, placeholder = "", largo = 200, ayuda = null, marcadores = null, soloLectura = false, alIntentar }) {
  const ref = useRef(null);
  const [texto, setTexto] = useState(null);
  const mostrado = texto ?? valor ?? "";
  const cambiar = (v) => {
    setTexto(v);
    alCambiar(v);
  };
  const insertar = (m) => {
    if (soloLectura) return alIntentar();
    const input = ref.current;
    const a = input?.selectionStart ?? mostrado.length;
    const b = input?.selectionEnd ?? a;
    const nuevo = `${mostrado.slice(0, a)}${m}${mostrado.slice(b)}`.slice(0, largo);
    cambiar(nuevo);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(a + m.length, a + m.length);
    });
    return undefined;
  };
  return html`<div class="edd-texto">
    <label class="campo">
      <span>${etiqueta}</span>
      <input
        ref=${ref}
        value=${mostrado}
        placeholder=${placeholder}
        maxlength=${largo}
        readOnly=${soloLectura}
        onInput=${(e) => cambiar(e.currentTarget.value)}
        onBlur=${() => setTexto(null)}
        onPaste=${(e) => {
          if (soloLectura) {
            e.preventDefault();
            alIntentar();
          }
        }}
        onKeyDown=${(e) => {
          if (soloLectura && esIntento(e)) alIntentar();
        }}
      />
    </label>
    ${marcadores
      ? html`<div class="edd-marcadores" role="group" aria-label="Insertar un dato de la etiqueta">
          ${marcadores.map(
            (m) => html`<button type="button" class="edd-marcador" title=${`Insertar ${m}`} onMouseDown=${(e) => e.preventDefault()} onClick=${() => insertar(m)}>${m}</button>`,
          )}
        </div>`
      : null}
    ${ayuda ? html`<small class="nota">${ayuda}</small>` : null}
  </div>`;
}

function Casilla({ etiqueta, valor, alCambiar, soloLectura = false, alIntentar, ayuda = null }) {
  return html`<label class="casilla edd-casilla">
    <input
      type="checkbox"
      checked=${Boolean(valor)}
      onClick=${(e) => {
        if (soloLectura) {
          e.preventDefault();
          alIntentar();
        }
      }}
      onChange=${(e) => !soloLectura && alCambiar(e.currentTarget.checked)}
    />
    <span>${etiqueta}${ayuda ? html` <small class="nota">${ayuda}</small>` : null}</span>
  </label>`;
}

// ---------------------------------------------------------------- propiedades del elegido

function Propiedades({ el, etiqueta, diseno, avisos, ed }) {
  const [libre, setLibre] = useState(false);
  const props = PROPIEDADES[el.tipo] ?? [];
  const tiene = (p) => props.includes(p);
  const solo = ed.deFabrica;
  const intentar = ed.ofrecer;
  // Lo que se escribe seguido en un campo es un solo paso para deshacer; una casilla, un paso cada vez.
  const cambiar = (prop, juntar = true) => (valor) => ed.cambiarProp(el.id, { [prop]: valor }, juntar ? `${el.id}:${prop}` : null);
  const ancho = diseno.ancho;
  const alto = diseno.alto;
  const caja = (prop, etiquetaCampo, lado) =>
    html`<${CampoNumero}
      etiqueta=${etiquetaCampo}
      valor=${el[prop]}
      detalle=${`${lz.porcientoAMm(el[prop], lado)} mm`}
      soloLectura=${solo}
      alIntentar=${intentar}
      alCambiar=${(v) => ed.cambiarCaja(el.id, { [prop]: v }, `${el.id}:${prop}`)}
    />`;
  const letra = lz.letraEnMedidas(el.letra ?? LETRA.defecto, alto);
  const predefinido = el.datos !== undefined ? lz.datosPredefinidos(el.datos) : null;
  const verLibre = predefinido === "libre" || libre;
  const llenado = el.datos !== undefined ? llenarPlantilla(el.datos, etiqueta) : "";
  const enBarras = el.tipo === "barras" ? codigo128(llenado) : null;
  return html`<section class="edd-props" aria-label="Propiedades del elemento">
    <header class="edd-props-cabeza">
      <h3>${nombreElemento(el)}</h3>
      <div class="edd-props-acciones">
        <${Boton} tamano="chico" title="Duplicar (Ctrl+D)" onClick=${ed.duplicarSel}>Duplicar<//>
        <${Boton} tamano="chico" title="Que quede encima de los demás" onClick=${() => ed.ordenar(el.id, "frente")}>Al frente<//>
        <${Boton} tamano="chico" title="Que quede debajo de los demás" onClick=${() => ed.ordenar(el.id, "fondo")}>Atrás<//>
        <${Boton} tamano="chico" tipo="texto" title="Quitar (Supr)" onClick=${ed.quitarSel}>Quitar<//>
      </div>
    </header>
    ${avisos.length
      ? html`<${Aviso} tipo="advertencia" titulo="Revisa">
          <ul>
            ${avisos.map((a) => html`<li>${a}</li>`)}
          </ul>
        <//>`
      : null}
    <fieldset class="edd-grupo">
      <legend>Lugar y tamaño (% de la etiqueta)</legend>
      <div class="edd-medidas">
        ${caja("x", "X (izquierda)", ancho)} ${caja("y", "Y (arriba)", alto)} ${caja("w", "Ancho", ancho)} ${caja("h", "Alto", alto)}
      </div>
    </fieldset>
    ${tiene("campo")
      ? html`<div class="campo">
          <span>Campo</span>
          <${Lista}
            valor=${el.campo}
            ariaLabel="Campo"
            opciones=${Object.entries(CAMPOS_ETIQUETA).map(([valor, etiquetaCampo]) => ({ valor, etiqueta: etiquetaCampo }))}
            alCambiar=${(campo) => ed.cambiarProp(el.id, { campo })}
          />
        </div>`
      : null}
    ${tiene("etiqueta")
      ? html`<${CampoTexto}
          etiqueta="Título del campo"
          valor=${el.etiqueta}
          largo=${LARGOS.etiqueta}
          ayuda="Va en negritas antes del valor. Vacío = solo el valor."
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("etiqueta")}
        />`
      : null}
    ${tiene("texto")
      ? html`<${CampoTexto}
          etiqueta="Texto"
          valor=${el.texto}
          largo=${LARGOS.texto}
          marcadores=${el.tipo === "texto" ? lz.MARCADORES : null}
          ayuda=${el.tipo === "texto" ? `Los {campos} se llenan con los datos de cada etiqueta. Con estos datos: «${llenarPlantilla(el.texto, etiqueta).trim() || el.vacio || "—"}».` : null}
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("texto")}
        />`
      : null}
    ${tiene("vacio")
      ? html`<${CampoTexto}
          etiqueta="Si viene vacío, poner"
          valor=${el.vacio}
          largo=${LARGOS.vacio}
          placeholder="(nada)"
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("vacio")}
        />`
      : null}
    ${tiene("datos")
      ? html`<div class="edd-datos">
          <${Segmentos}
            etiqueta="Qué lleva"
            valor=${verLibre ? "libre" : predefinido}
            opciones=${{ ...Object.fromEntries(Object.entries(lz.DATOS_PREDEFINIDOS).map(([k, p]) => [k, p.nombre])), libre: "Libre" }}
            alCambiar=${(clave) => {
              if (clave === "libre") return setLibre(true);
              setLibre(false);
              return ed.cambiarProp(el.id, { datos: lz.DATOS_PREDEFINIDOS[clave].datos });
            }}
          />
          ${verLibre
            ? html`<${CampoTexto}
                etiqueta="Datos"
                valor=${el.datos}
                largo=${LARGOS.datos}
                marcadores=${lz.MARCADORES}
                soloLectura=${solo}
                alIntentar=${intentar}
                alCambiar=${cambiar("datos")}
              />`
            : null}
          <p class="nota edd-lleva">
            Con estos datos lleva: <code>${(enBarras ? enBarras.texto : llenado.trim()) || "(nada)"}</code>
          </p>
        </div>`
      : null}
    ${tiene("texto_visible")
      ? html`<${Casilla} etiqueta="Mostrar el texto debajo de las barras" valor=${el.texto_visible} soloLectura=${solo} alIntentar=${intentar} alCambiar=${cambiar("texto_visible", false)} />`
      : null}
    ${tiene("letra")
      ? html`<${CampoNumero}
          etiqueta=${el.tipo === "barras" ? "Letra del texto (% del alto)" : "Letra (% del alto de la etiqueta)"}
          valor=${el.letra}
          paso=${0.1}
          detalle=${`≈ ${letra.mm} mm · ${letra.px} px en esta plantilla`}
          ayuda=${`De ${LETRA.minimo} a ${LETRA.maximo} %. En proporción: crece o se encoge con la etiqueta.`}
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("letra")}
        />`
      : null}
    ${tiene("negrita")
      ? html`<${Casilla}
          etiqueta=${el.tipo === "campo" ? "Valor en negritas" : "Negritas"}
          ayuda=${el.tipo === "campo" ? "(el título siempre va en negritas)" : null}
          valor=${el.negrita}
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("negrita", false)}
        />`
      : null}
    ${tiene("alinear") ? html`<${Segmentos} etiqueta="Alinear" valor=${el.alinear} opciones=${ALINEACIONES} alCambiar=${(v) => ed.cambiarProp(el.id, { alinear: v })} />` : null}
    ${tiene("vertical") ? html`<${Segmentos} etiqueta="Vertical" valor=${el.vertical} opciones=${VERTICALES} alCambiar=${(v) => ed.cambiarProp(el.id, { vertical: v })} />` : null}
    ${tiene("linea_abajo") ? html`<${Casilla} etiqueta="Línea abajo" valor=${el.linea_abajo} soloLectura=${solo} alIntentar=${intentar} alCambiar=${cambiar("linea_abajo", false)} />` : null}
    ${tiene("varias_lineas")
      ? html`<${Casilla}
          etiqueta="Varias líneas"
          ayuda="(si no, un renglón que se corta con «…»)"
          valor=${el.varias_lineas}
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("varias_lineas", false)}
        />`
      : null}
    ${tiene("espaciado")
      ? html`<${CampoNumero}
          etiqueta="Espacio entre letras (em)"
          valor=${el.espaciado}
          paso=${0.01}
          ayuda=${`De ${ESPACIADO.minimo} a ${ESPACIADO.maximo}.`}
          soloLectura=${solo}
          alIntentar=${intentar}
          alCambiar=${cambiar("espaciado")}
        />`
      : null}
    ${el.tipo === "logo_izq" || el.tipo === "logo_der"
      ? html`<p class="nota">La imagen es la del inventario de cada etiqueta; se elige en <em>Hoja y logos</em>. Se ajusta a la caja sin deformarse.</p>`
      : null}
    ${el.tipo === "texto_almacen" ? html`<p class="nota">El texto es el de cada inventario; se escribe en <em>Hoja y logos</em>.</p>` : null}
  </section>`;
}

// ---------------------------------------------------------------- ventanas chicas

/** Hay cambios sin guardar: Guardar / Descartar / Seguir editando. */
function PreguntaCambios({ nombre, alGuardar, alDescartar, alSeguir }) {
  return html`<${Ventana} titulo="Cambios sin guardar" alCerrar=${alSeguir} clase="ventana-edd-pregunta">
    <p>«${nombre}» tiene cambios sin guardar. ¿Qué hago con ellos?</p>
    <div class="acciones-linea pie-editor">
      <${Boton} tipo="texto" onClick=${alSeguir}>Seguir editando<//>
      <span class="espaciador"></span>
      <${Boton} onClick=${alDescartar}>Descartar los cambios<//>
      <${Boton} tipo="primario" onClick=${alGuardar}>Guardar<//>
    </div>
  <//>`;
}

function VentanaRenombrar({ nombre, alGuardar, alCerrar }) {
  const [texto, setTexto] = useState(nombre);
  const [error, setError] = useState(null);
  const listo = async () => {
    const r = await alGuardar(texto);
    if (r) setError(r);
    else alCerrar();
  };
  return html`<${Ventana} titulo="Renombrar el diseño" alCerrar=${alCerrar} clase="ventana-edd-pregunta">
    <label class="campo">
      <span>Nombre</span>
      <input
        value=${texto}
        maxlength=${LARGOS.nombre}
        autofocus
        onInput=${(e) => setTexto(e.currentTarget.value)}
        onKeyDown=${(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            listo();
          }
        }}
      />
    </label>
    ${error ? html`<${Aviso} tipo="error" titulo="No se pudo renombrar">${error}<//>` : null}
    <div class="acciones-linea pie-editor">
      <span class="espaciador"></span>
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <${Boton} tipo="primario" disabled=${!texto.trim()} onClick=${listo}>Renombrar<//>
    </div>
  <//>`;
}

/** Primer plano a pantalla completa: como `Ventana` (portal sobre body, foco, sin scroll detrás). */
function PantallaCompleta({ etiqueta, raiz, children }) {
  useEffect(() => {
    const previo = document.activeElement;
    document.body.classList.add("con-ventana");
    if (!raiz.current?.contains(document.activeElement)) raiz.current?.focus();
    return () => {
      if (document.querySelectorAll(".ventana").length <= 1) document.body.classList.remove("con-ventana");
      if (previo && document.contains(previo)) previo.focus?.();
    };
  }, []);
  return createPortal(
    html`<div class="ventana-fondo edd-fondo">
      <div class="ventana edd" role="dialog" aria-modal="true" aria-label=${etiqueta} tabindex="-1" ref=${raiz}>${children}</div>
    </div>`,
    document.body,
  );
}

// ---------------------------------------------------------------- el editor

/**
 * Editor de diseños. `tipo` = la lista desde la que se abrió (su diseño es el que se abre primero).
 */
export function EditorDisenos({ tipo: tipoInicial = "material", alCerrar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const config = useMemo(() => et.configEtiquetas(estado), [estado.config?.etiquetas]);
  const diseno = config.diseno;
  const porTipo = config.modelo_por_tipo;
  const modelos = useMemo(() => et.modelosEtiqueta(estado), [estado.config?.etiquetas]);
  const tipoDe = TIPOS[tipoInicial] ? tipoInicial : "material";

  const raiz = useRef(null);
  const capa = useRef(null);
  const lienzo = useRef(null);
  const dibujo = useRef(null);

  const [verTipo, setVerTipo] = useState(tipoDe);
  const [verInv, setVerInv] = useState(sesion.inventario.id);
  const [datosDe, setDatosDe] = useState("lista");
  const [abiertoId, setAbiertoEstado] = useState(() => porTipo[tipoDe]);
  const [h, setHEstado] = useState(() => lz.historial(et.modeloDe(estado, tipoDe).elementos.map((e) => ({ ...e }))));
  const [sel, setSelEstado] = useState(null);
  const [vivo, setVivoEstado] = useState(null); // { id, caja, guias } mientras se arrastra
  const [zoom, setZoom] = useState({ modo: "ajustar", valor: 4 });
  const [prefs, setPrefs] = useState(preferenciasGuardadas);
  const [error, setError] = useState(null);
  const [pregunta, setPregunta] = useState(null); // { accion }
  const [intentos, setIntentos] = useState(0);
  const [renombrando, setRenombrando] = useState(false);
  const [pestana, setPestana] = useState("etiqueta");
  const [desbordados, setDesbordados] = useState("");
  const [espacio, setEspacio] = useState({ w: 0, h: 0 });
  const [, setVersion] = useState(0);

  // Lo vigente, para los manejadores del teclado y del ratón (se registran una sola vez).
  const r = useRef({});
  const ponerH = (nuevo) => {
    r.current.h = nuevo;
    setHEstado(nuevo);
  };
  const ponerSel = (id) => {
    r.current.sel = id;
    setSelEstado(id);
  };
  const ponerVivo = (v) => {
    r.current.vivo = v;
    setVivoEstado(v);
  };
  const ponerAbierto = (id) => {
    r.current.abierto = id;
    setAbiertoEstado(id);
  };

  const guardado = modelos.find((m) => m.id === abiertoId) ?? null;
  const nombreRef = useRef(guardado?.nombre ?? "");
  if (guardado) nombreRef.current = guardado.nombre;
  const nombre = nombreRef.current;
  const deFabrica = esModeloDeFabrica(abiertoId);
  const elementos = h.presente;
  const firmaGuardado = guardado ? JSON.stringify(guardado.elementos) : null;
  const sucio = !deFabrica && JSON.stringify(elementos) !== firmaGuardado;
  const mostrados = vivo ? lz.conCaja(elementos, vivo.id, vivo.caja) : elementos;
  const elegido = sel ? (mostrados.find((e) => e.id === sel) ?? null) : null;
  Object.assign(r.current, { h, sel: elegido ? sel : null, vivo, abierto: abiertoId, deFabrica, sucio, verTipo, prefs });

  // Datos de muestra: la primera etiqueta de la lista (o la muestra), con el inventario elegido.
  const lista = et.etiquetasPorImprimir(estado, verTipo);
  const primera = datosDe === "lista" && lista.length ? lista[0] : null;
  const etiqueta = useMemo(() => {
    const base = primera ?? muestraEtiqueta(verTipo, verInv);
    return { ...(verTipo === "ax" ? et.comoAx(base) : base), inventario: verInv };
  }, [primera, verTipo, verInv]);

  // ------------------------------------------------ abrir, guardar y los cambios sin guardar

  const base = useRef(firmaGuardado);
  const abrirDirecto = (id, { mantener = false } = {}) => {
    const actual = sesion.estado;
    const m = et.modelosEtiqueta(actual).find((x) => x.id === id) ?? et.modeloDe(actual, r.current.verTipo);
    base.current = JSON.stringify(m.elementos);
    nombreRef.current = m.nombre;
    ponerAbierto(m.id);
    ponerH(lz.historial(m.elementos.map((e) => ({ ...e }))));
    ponerVivo(null);
    if (!mantener || !m.elementos.some((e) => e.id === r.current.sel)) ponerSel(null);
    setError(null);
    setIntentos(0);
  };

  // El diseño abierto cambió por fuera (sincronización con el otro inventario, Deshacer, un respaldo): si
  // no había cambios sin guardar, se toma el nuevo; si se borró, se abre el de la lista.
  useEffect(() => {
    if (firmaGuardado === base.current) return;
    const limpio = JSON.stringify(r.current.h.presente) === base.current;
    base.current = firmaGuardado;
    if (!limpio) return;
    if (guardado) ponerH(lz.historial(guardado.elementos.map((e) => ({ ...e }))));
    else if (!esModeloDeFabrica(r.current.abierto)) {
      const borrado = nombreRef.current;
      abrirDirecto(et.configEtiquetas(sesion.estado).modelo_por_tipo[r.current.verTipo]);
      sesion.avisar("info", `El diseño «${borrado}» ya no existe (se borró en el otro inventario o se restauró un respaldo).`);
    }
  }, [firmaGuardado]);

  /** Si hay cambios sin guardar, primero pregunta (Guardar / Descartar / Seguir editando). */
  const resolverCambios = (accion) => {
    if (r.current.sucio) setPregunta({ accion });
    else accion();
  };

  const ofrecer = () => setIntentos((n) => n + 1);

  const guardar = async () => {
    if (r.current.deFabrica) {
      ofrecer();
      return false;
    }
    if (!r.current.sucio) return true;
    setError(null);
    try {
      const id = await sesion.almacen.modificar((e) => et.guardarModeloEtiqueta(e, { id: r.current.abierto, nombre: nombreRef.current, elementos: r.current.h.presente }, sesion.usuario));
      if (id !== r.current.abierto) ponerAbierto(id);
      r.current.sucio = false;
      sesion.avisar("exito", `Se guardó el diseño «${nombreRef.current}».`, 3500);
      return true;
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
      return false;
    }
  };

  const guardadoActual = () => et.modelosEtiqueta(sesion.estado).find((m) => m.id === r.current.abierto) ?? null;

  const crear = async (modelo, { mantener = false, aviso }) => {
    setError(null);
    try {
      const id = await sesion.almacen.modificar((e) => et.guardarModeloEtiqueta(e, modelo, sesion.usuario));
      abrirDirecto(id, { mantener });
      setPestana("etiqueta");
      sesion.avisar("exito", aviso, 4000);
      return id;
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
      return null;
    }
  };

  const nuevoEnBlanco = () =>
    resolverCambios(() => {
      const nombreNuevo = lz.nombreLibre(et.modelosEtiqueta(sesion.estado).map((m) => m.nombre));
      return crear({ nombre: nombreNuevo, elementos: [] }, { aviso: `Se creó «${nombreNuevo}», en blanco: agrega elementos a la derecha.` });
    });

  const duplicar = () =>
    resolverCambios(() => {
      const m = guardadoActual() ?? { nombre: nombreRef.current, elementos: r.current.h.presente };
      // La copia de «Material (de fábrica)» se llama «Material (copia)».
      const nombreNuevo = et.nombreParaCopia(sesion.estado, m.fabrica ? m.nombre.replace(/\s*\(de fábrica\)\s*$/, "") : m.nombre);
      return crear({ nombre: nombreNuevo, elementos: m.elementos }, { mantener: true, aviso: `Se creó «${nombreNuevo}»: ya puedes editarlo.` });
    });

  const usar = (tipoLista) =>
    resolverCambios(async () => {
      setError(null);
      try {
        await sesion.almacen.modificar((e) => et.usarModelo(e, tipoLista, r.current.abierto, sesion.usuario));
        sesion.avisar("exito", `La lista de ${TIPOS[tipoLista]} se imprime con «${nombreRef.current}».`, 5000);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      }
    });

  const borrar = async () => {
    if (r.current.deFabrica) return;
    const nombreBorrado = nombreRef.current;
    const id = r.current.abierto;
    const existe = guardadoActual();
    if (r.current.sucio && existe && !confirmar(`«${nombreBorrado}» tiene cambios sin guardar. ¿Borrar el diseño de todos modos?`)) return;
    // Primero se abre otro (el de la lista que se está viendo, o su de fábrica).
    const elegidos = et.configEtiquetas(sesion.estado).modelo_por_tipo;
    const destino = elegidos[r.current.verTipo] !== id ? elegidos[r.current.verTipo] : FABRICA_POR_TIPO[r.current.verTipo];
    abrirDirecto(destino);
    if (!existe) return;
    setError(null);
    try {
      const info = await sesion.almacen.modificar((e) => et.borrarModeloEtiqueta(e, id, sesion.usuario));
      const listas = info.tipos.map((t) => TIPOS[t]).join(" y ");
      sesion.avisar("info", `Se borró el diseño «${nombreBorrado}».${listas ? ` ${listas} vuelve${info.tipos.length > 1 ? "n" : ""} al de fábrica.` : ""}`, 10000, {
        etiqueta: "Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => et.reponerModeloEtiqueta(e, info, sesion.usuario)),
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    }
  };

  const renombrar = async (texto) => {
    const nuevo = String(texto ?? "").trim();
    if (!nuevo) return "Ponle un nombre al diseño.";
    const m = guardadoActual();
    if (!m) {
      nombreRef.current = nuevo;
      setVersion((v) => v + 1);
      return null;
    }
    try {
      await sesion.almacen.modificar((e) => et.guardarModeloEtiqueta(e, { id: m.id, nombre: nuevo, elementos: m.elementos }, sesion.usuario));
      return null;
    } catch (e) {
      return e?.message || String(e);
    }
  };

  const abrir = (id) => {
    if (id === r.current.abierto) return;
    resolverCambios(() => {
      abrirDirecto(id);
      setPestana("etiqueta");
    });
  };

  const intentarCerrar = () => resolverCambios(alCerrar);

  // ------------------------------------------------ editar los elementos

  /** Aplica un cambio a la lista de elementos (con su paso para deshacer). Bloqueado en los de fábrica. */
  const editar = (cambio, { clave = null } = {}) => {
    if (r.current.deFabrica) {
      ofrecer();
      return false;
    }
    const actual = r.current.h;
    const nuevos = cambio(actual.presente);
    if (!nuevos || nuevos === actual.presente) return false;
    ponerH(lz.empujar(actual, nuevos.map(normalizarElemento).filter(Boolean), { clave }));
    return true;
  };

  const enfocarCaja = (id) =>
    requestAnimationFrame(() => {
      raiz.current?.querySelector(`[data-caja="${id}"]`)?.focus({ preventScroll: true });
    });

  const agregar = (tipoEl, campo = "codigo") => {
    if (r.current.deFabrica) return ofrecer();
    const res = lz.agregarElemento(r.current.h.presente, tipoEl, { campo });
    if (!res) return setError(`Un diseño lleva ${MAXIMO_ELEMENTOS} elementos como máximo.`);
    editar(() => res.elementos);
    ponerSel(res.id);
    enfocarCaja(res.id);
    return undefined;
  };

  const duplicarSel = () => {
    const id = r.current.sel;
    if (!id) return undefined;
    if (r.current.deFabrica) return ofrecer();
    const res = lz.duplicarElemento(r.current.h.presente, id);
    if (!res) return setError(`Un diseño lleva ${MAXIMO_ELEMENTOS} elementos como máximo.`);
    editar(() => res.elementos);
    ponerSel(res.id);
    enfocarCaja(res.id);
    return undefined;
  };

  const quitarSel = () => {
    const id = r.current.sel;
    if (!id) return;
    if (editar((els) => lz.quitarElemento(els, id))) ponerSel(null);
  };

  const ordenar = (id, hacia) => editar((els) => (hacia === "frente" ? lz.alFrente(els, id) : lz.alFondo(els, id)));
  const cambiarProp = (id, cambios, clave = null) => editar((els) => lz.cambiarElemento(els, id, cambios), { clave });
  const cambiarCaja = (id, cambios, clave = null) =>
    editar(
      (els) => {
        const el = els.find((x) => x.id === id);
        return el ? lz.conCaja(els, id, lz.fijarCaja(lz.cajaDe(el), cambios)) : null;
      },
      { clave },
    );

  const deshacer = () => ponerH(lz.deshacer(r.current.h));
  const rehacer = () => ponerH(lz.rehacer(r.current.h));

  const ed = { deFabrica, ofrecer, cambiarProp, cambiarCaja, duplicarSel, quitarSel, ordenar };

  // ------------------------------------------------ teclado

  const acciones = useRef({});
  acciones.current = { guardar, intentarCerrar, deshacer, rehacer, duplicarSel, quitarSel, editar };
  useEffect(() => {
    const tecla = (e) => {
      // Alt mientras se arrastra = sin imán; que no abra el menú del navegador.
      if (e.key === "Alt" && r.current.vivo) {
        e.preventDefault();
        return;
      }
      const ventanas = document.querySelectorAll(".ventana");
      if (ventanas[ventanas.length - 1] !== raiz.current) return; // hay una ventana encima
      const a = acciones.current;
      const t = e.target instanceof Element ? e.target : null;
      const escribiendo = Boolean(t?.closest("input, textarea, [contenteditable], .combo"));
      const ctrl = e.ctrlKey || e.metaKey;
      const letra = e.key.length === 1 ? e.key.toLowerCase() : "";
      if (ctrl && !e.altKey && letra === "s") {
        e.preventDefault();
        a.guardar();
        return;
      }
      if (e.key === "Escape") {
        if (raiz.current?.querySelector(".resultados")) return; // primero se cierra la lista abierta
        e.preventDefault();
        if (arrastre.current) {
          // Mientras se arrastra: se cancela y el elemento se queda donde estaba.
          arrastre.current = null;
          ponerVivo(null);
        } else if (t?.matches("input, textarea")) t.blur();
        else if (r.current.sel) ponerSel(null);
        else a.intentarCerrar();
        return;
      }
      if (escribiendo) return;
      if (ctrl && !e.altKey && (letra === "z" || letra === "y")) {
        e.preventDefault();
        if (letra === "y" || e.shiftKey) a.rehacer();
        else a.deshacer();
        return;
      }
      // Lo que actúa sobre el elemento elegido: solo con el foco en la etiqueta (no en los paneles).
      const enLienzo = !t || t === document.body || t === raiz.current || Boolean(t.closest(".edd-centro"));
      if (!enLienzo || !r.current.sel || r.current.vivo) return;
      const id = r.current.sel;
      if (ctrl && !e.altKey && letra === "d") {
        e.preventDefault();
        a.duplicarSel();
      } else if (ctrl || e.altKey) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        a.quitarSel();
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        a.editar(
          (els) => {
            const el = els.find((x) => x.id === id);
            const caja = el ? lz.moverConTecla(lz.cajaDe(el), e.key, e.shiftKey) : null;
            return caja ? lz.conCaja(els, id, caja) : null;
          },
          { clave: `${id}:flechas` },
        );
      }
    };
    const soltarAlt = (e) => {
      if (e.key === "Alt" && r.current.vivo) e.preventDefault();
    };
    document.addEventListener("keydown", tecla);
    document.addEventListener("keyup", soltarAlt);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("keyup", soltarAlt);
    };
  }, []);

  // Al salir o recargar con cambios sin guardar, el navegador pregunta.
  useEffect(() => {
    const salir = (e) => {
      if (!r.current.sucio) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", salir);
    return () => window.removeEventListener("beforeunload", salir);
  }, []);

  // ------------------------------------------------ ratón: mover y cambiar el tamaño

  const arrastre = useRef(null);
  const presionar = (e, id, asa = null) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ponerSel(id);
    (asa ? e.currentTarget.closest(".edd-caja") : e.currentTarget)?.focus({ preventScroll: true });
    const el = r.current.h.presente.find((x) => x.id === id);
    const rect = capa.current?.getBoundingClientRect();
    if (!el || !rect?.width) return;
    arrastre.current = {
      id,
      asa,
      inicio: lz.cajaDe(el),
      x0: e.clientX,
      y0: e.clientY,
      ancho: rect.width,
      alto: rect.height,
      lineas: lz.lineasGuia(r.current.h.presente, { salvo: id }),
      movido: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moverPuntero = (e) => {
    const a = arrastre.current;
    if (!a) return;
    const dxPx = e.clientX - a.x0;
    const dyPx = e.clientY - a.y0;
    if (!a.movido) {
      if (Math.hypot(dxPx, dyPx) < 3) return;
      if (r.current.deFabrica) {
        arrastre.current = null;
        ofrecer();
        return;
      }
      a.movido = true;
    }
    const p = r.current.prefs;
    const opciones = {
      lineas: a.lineas,
      umbral: { x: lz.pxAPorciento(6, a.ancho), y: lz.pxAPorciento(6, a.alto) },
      // La cuadrícula atrae solo si se ve; las guías, siempre (salvo con Alt).
      paso: p.iman && p.cuadricula ? p.paso : 0,
      iman: !e.altKey,
    };
    const dx = lz.pxAPorciento(dxPx, a.ancho);
    const dy = lz.pxAPorciento(dyPx, a.alto);
    const res = a.asa ? lz.redimensionarArrastrando(a.inicio, a.asa, dx, dy, opciones) : lz.moverArrastrando(a.inicio, dx, dy, opciones);
    ponerVivo({ id: a.id, caja: res.caja, guias: res.guias });
  };
  const soltar = (e, cancelar = false) => {
    const a = arrastre.current;
    arrastre.current = null;
    const v = r.current.vivo;
    if (v) ponerVivo(null);
    if (!a?.movido || !v || cancelar) return;
    editar((els) => lz.conCaja(els, a.id, v.caja));
  };

  // ------------------------------------------------ zoom

  useLayoutEffect(() => {
    const el = lienzo.current;
    if (!el) return undefined;
    const medir = () => {
      if (el.clientWidth && el.clientHeight) setEspacio({ w: el.clientWidth, h: el.clientHeight });
    };
    medir();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const ajustado = espacio.w ? lz.zoomParaAjustar(diseno.ancho, diseno.alto, espacio.w, espacio.h, { margen: 36 }) : 4;
  const pxPorMm = zoom.modo === "ajustar" ? ajustado : zoom.valor;
  const ancho = diseno.ancho * pxPorMm;
  const alto = diseno.alto * pxPorMm;
  const cambiarZoom = (sentido) => setZoom({ modo: "manual", valor: lz.siguienteZoom(pxPorMm, sentido) });

  const fijarPrefs = (cambios) =>
    setPrefs((p) => {
      const n = { ...p, ...cambios };
      recordarPreferencias(n);
      return n;
    });

  // ------------------------------------------------ dibujo, avisos y lo que no cabe

  const css = useMemo(() => cssEtiqueta({ diseno, vista: true, ambito: "edd-ambito" }), [JSON.stringify(diseno)]);
  const dibujados = useMemo(() => {
    const porId = {};
    for (const el of mostrados) porId[el.id] = htmlElemento(el, etiqueta, { identidad: config.identidad, diseno });
    return porId;
  }, [mostrados, etiqueta, config]);
  const avisos = useMemo(() => {
    const porId = {};
    for (const el of elementos) {
      const lista = [...avisosElemento(el, etiqueta, { diseno, tipo: verTipo }), ...lz.avisosLectura(el, etiqueta, diseno)];
      if (lista.length) porId[el.id] = lista;
    }
    return porId;
  }, [elementos, etiqueta, config, verTipo]);
  const fuera = useMemo(() => new Set(desbordados ? desbordados.split(",") : []), [desbordados]);
  const avisosDe = (id) => [...(avisos[id] ?? []), ...(fuera.has(id) ? ["El texto no cabe en su caja: se corta. Agranda la caja, baja la letra o usa varias líneas."] : [])];
  const conAvisos = mostrados.filter((el) => avisosDe(el.id).length);

  useLayoutEffect(() => {
    const raizDibujo = dibujo.current;
    if (!raizDibujo || vivo) return;
    const ids = [];
    for (const envoltura of raizDibujo.querySelectorAll(".edd-el")) {
      const caja = envoltura.firstElementChild;
      if (caja && (caja.classList.contains("etq-e-txt") || caja.classList.contains("etq-e-bar")) && desborda(caja)) ids.push(envoltura.dataset.el);
    }
    const firma = ids.join(",");
    if (firma !== desbordados) setDesbordados(firma);
  });

  // Si el elegido ya no existe (deshacer, quitar), nada queda elegido.
  useEffect(() => {
    if (sel && !elementos.some((e) => e.id === sel)) ponerSel(null);
  }, [elementos, sel]);

  // ------------------------------------------------ pantalla

  const nombreDe = (id) => modelos.find((m) => m.id === id)?.nombre ?? "—";
  const usaLista = (id) => Object.keys(TIPOS).filter((t) => porTipo[t] === id);
  const k = pxPorMm / lz.PX_POR_MM;

  const cabeza = html`<header class="edd-cabeza">
    <${Icono} nombre="lapiz" tam=${20} />
    <h2>Editor de diseños</h2>
    <span class="edd-nombre" title=${nombre}>${nombre}</span>
    ${deFabrica
      ? html`<${Pastilla} titulo="Los de fábrica no se cambian: duplícalo para editarlo"><${Icono} nombre="candado" tam=${12} /> de fábrica<//>`
      : sucio
        ? html`<span class="edd-sucio" role="status">● Cambios sin guardar</span>`
        : html`<span class="edd-guardado" role="status">Guardado</span>`}
    ${conAvisos.length
      ? html`<button
          type="button"
          class="boton boton-chico edd-avisos-boton"
          title="Ir al siguiente elemento con avisos"
          onClick=${() => {
            const i = conAvisos.findIndex((el) => el.id === sel);
            const siguiente = conAvisos[(i + 1) % conAvisos.length];
            ponerSel(siguiente.id);
            enfocarCaja(siguiente.id);
          }}
        >
          ⚠ ${conAvisos.length} ${conAvisos.length === 1 ? "aviso" : "avisos"}
        </button>`
      : null}
    <span class="espaciador"></span>
    <${Boton} tipo="primario" disabled=${!sucio} onClick=${guardar} title="Guardar (Ctrl+S)">Guardar<//>
    <button type="button" class="ventana-cerrar" onClick=${intentarCerrar} title="Cerrar (Esc)" aria-label="Cerrar el editor">✕</button>
  </header>`;

  const franjas = html`
    ${deFabrica
      ? html`<div key=${`f${intentos}`} class=${`edd-franja ${intentos ? "edd-intento" : ""}`} role=${intentos ? "alert" : "status"}>
          <${Icono} nombre="candado" tam=${16} />
          <span>
            ${intentos
              ? html`<strong>Los diseños de fábrica no se cambian.</strong> Duplícalo y edita la copia: «${nombre}» se queda como está.`
              : html`«${nombre}» es de fábrica (solo lectura). Para cambiarlo, duplícalo.`}
          </span>
          <${Boton} tamano="chico" tipo=${intentos ? "primario" : "secundario"} onClick=${duplicar}>Duplicar para editar<//>
        </div>`
      : null}
    ${!deFabrica && !guardado
      ? html`<div class="edd-franja edd-intento" role="status">
          <span>Este diseño ya no está guardado (se borró en el otro inventario o al restaurar un respaldo). Si lo guardas, se crea de nuevo.</span>
        </div>`
      : null}
    ${error
      ? html`<div class="edd-error">
          <${Aviso} tipo="error" titulo="No se pudo">${error}<//>
          <button type="button" class="ventana-cerrar" aria-label="Quitar el aviso" onClick=${() => setError(null)}>✕</button>
        </div>`
      : null}
  `;

  const panelDisenos = html`<aside class="edd-disenos" aria-label="Diseños">
    <h3>Diseños</h3>
    <div class="edd-acciones">
      <${Lista}
        valor=""
        ariaLabel="Nuevo diseño"
        clase="edd-nuevo"
        mostrar=${() => html`<span class="lista-valor">+ Nuevo</span>`}
        opciones=${[
          { valor: "blanco", etiqueta: "En blanco" },
          { valor: "copia", etiqueta: `A partir de «${nombre}»` },
        ]}
        alCambiar=${(v) => (v === "blanco" ? nuevoEnBlanco() : duplicar())}
      />
      <${Boton} tamano="chico" onClick=${duplicar} title="Una copia que sí se puede editar">Duplicar<//>
      <${Boton} tamano="chico" disabled=${deFabrica} onClick=${() => setRenombrando(true)}>Renombrar<//>
      <${Boton} tamano="chico" tipo="texto" disabled=${deFabrica} onClick=${borrar} title="Se puede deshacer">Borrar<//>
    </div>
    <div class="edd-usar" role="group" aria-label="Qué lista se imprime con este diseño">
      <span class="edd-usar-titulo">Se imprime en</span>
      ${Object.keys(TIPOS).map((t) =>
        porTipo[t] === abiertoId
          ? html`<div class="edd-usar-fila" key=${t}><${Pastilla} tono="ok">✓ ${TIPOS[t]}<//><span class="nota">usa este diseño</span></div>`
          : html`<div class="edd-usar-fila" key=${t}>
              <${Boton} tamano="chico" onClick=${() => usar(t)}>Usar para ${TIPOS[t]}<//>
              <span class="nota" title=${`Ahora: ${nombreDe(porTipo[t])}`}>ahora: ${nombreDe(porTipo[t])}</span>
            </div>`,
      )}
      <p class="nota">Vale para las etiquetas de DLTA y de GSM.</p>
    </div>
    <ul class="edd-lista-disenos">
      ${modelos.map((m) => {
        const usa = usaLista(m.id);
        const abierto = m.id === abiertoId;
        return html`<li key=${m.id}>
          <button type="button" class=${`edd-diseno ${abierto ? "abierto" : ""}`} aria-current=${abierto ? "true" : undefined} onClick=${() => abrir(m.id)}>
            <span class="edd-diseno-nombre">${m.fabrica ? html`<${Icono} nombre="candado" tam=${13} /> ` : null}${m.nombre}${abierto && sucio ? " ●" : ""}</span>
            <span class="edd-diseno-datos">
              ${m.fabrica ? html`<${Pastilla}>de fábrica<//>` : null}
              ${usa.map((t) => html`<${Pastilla} tono="info" titulo=${`La lista de ${TIPOS[t]} se imprime con este`}>${TIPOS[t]}<//>`)}
              <span class="nota">${elementosDe((abierto ? elementos : m.elementos).length)}</span>
            </span>
          </button>
        </li>`;
      })}
    </ul>
  </aside>`;

  const barra = html`<div class="edd-barra" role="toolbar" aria-label="Herramientas de la etiqueta">
    <div class="edd-grupo-barra">
      <button type="button" class="boton boton-chico edd-icono" disabled=${!lz.puedeDeshacer(h)} onClick=${deshacer} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
        <${Icono} nombre="deshacer" tam=${16} />
      </button>
      <button type="button" class="boton boton-chico edd-icono" disabled=${!lz.puedeRehacer(h)} onClick=${rehacer} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
        <${Icono} nombre="rehacer" tam=${16} />
      </button>
    </div>
    <div class="edd-grupo-barra">
      <label class="casilla"><input type="checkbox" checked=${prefs.cuadricula} onChange=${(e) => fijarPrefs({ cuadricula: e.currentTarget.checked })} /> Cuadrícula</label>
      <label class="casilla" title="Al arrastrar, se pega a la cuadrícula visible (Alt: libre, sin imán ni guías)"><input type="checkbox" checked=${prefs.iman} onChange=${(e) => fijarPrefs({ iman: e.currentTarget.checked })} /> Imán</label>
      <${Segmentos} valor=${String(prefs.paso)} opciones=${Object.fromEntries(lz.PASOS_CUADRICULA.map((p) => [String(p), `${p} %`]))} alCambiar=${(p) => fijarPrefs({ paso: Number(p) })} />
    </div>
    <div class="edd-grupo-barra">
      <button type="button" class="boton boton-chico edd-icono" onClick=${() => cambiarZoom(-1)} title="Alejar" aria-label="Alejar">−</button>
      <${Boton} tamano="chico" tipo=${zoom.modo === "ajustar" ? "primario" : "secundario"} onClick=${() => setZoom({ modo: "ajustar", valor: pxPorMm })} title="Que la etiqueta llene el espacio">Ajustar<//>
      <button type="button" class="boton boton-chico edd-icono" onClick=${() => cambiarZoom(1)} title="Acercar" aria-label="Acercar">+</button>
      <${Boton} tamano="chico" tipo="texto" onClick=${() => setZoom({ modo: "manual", valor: lz.PX_POR_MM })} title="Más o menos su tamaño impreso">Tamaño real<//>
      <span class="edd-zoom" aria-live="polite">${Math.round(k * 100)} %</span>
    </div>
  </div>`;

  const marcoLienzo = html`<div
    class="edd-lienzo"
    ref=${lienzo}
    onPointerDown=${(e) => {
      if (e.target === e.currentTarget) ponerSel(null);
    }}
  >
    <div class="edd-marco" style=${`width:${ancho}px;height:${alto}px`}>
      <style>${css}</style>
      <div class="edd-ambito" style=${`zoom:${k}`} ref=${dibujo} aria-hidden="true">
        <div class=${`etq etq-${verTipo}`}>
          ${mostrados.map((el) => html`<div key=${el.id} class="edd-el" data-el=${el.id} dangerouslySetInnerHTML=${{ __html: dibujados[el.id] ?? "" }}></div>`)}
        </div>
      </div>
      <div
        class=${`edd-capa ${prefs.cuadricula ? "con-cuadricula" : ""} ${deFabrica ? "solo-lectura" : ""}`}
        style=${`--edd-paso:${prefs.paso}%`}
        ref=${capa}
        onPointerDown=${(e) => {
          if (e.target === e.currentTarget) ponerSel(null);
        }}
        onPointerMove=${moverPuntero}
        onPointerUp=${(e) => soltar(e)}
        onPointerCancel=${(e) => soltar(e, true)}
        onLostPointerCapture=${(e) => arrastre.current && soltar(e)}
      >
        ${mostrados.map((el) => {
          const elegida = el.id === sel;
          const vacio = !dibujados[el.id];
          const avisosEl = avisosDe(el.id);
          const clases = ["edd-caja", elegida ? "elegida" : "", vacio ? "vacia" : "", avisosEl.length ? "con-aviso" : ""].join(" ");
          return html`<div
            key=${el.id}
            class=${clases}
            data-caja=${el.id}
            role="button"
            tabindex="0"
            aria-pressed=${elegida ? "true" : "false"}
            aria-label=${`${nombreElemento(el)}${avisosEl.length ? " (con avisos)" : ""}`}
            title=${`${nombreElemento(el)}${avisosEl.length ? `\n${avisosEl.join("\n")}` : ""}`}
            style=${`left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%`}
            onPointerDown=${(e) => presionar(e, el.id)}
            onFocus=${() => r.current.sel !== el.id && ponerSel(el.id)}
          >
            ${vacio ? html`<span class="edd-vacio-texto">${porQueNoSeVe(el, etiqueta)}</span>` : null}
            ${avisosEl.length ? html`<span class="edd-alerta" aria-hidden="true">!</span>` : null}
            ${elegida
              ? lz.ASAS.map(
                  (asa) => html`<span
                    key=${asa}
                    class=${`edd-asa edd-asa-${asa}`}
                    style=${`cursor:${CURSOR_ASA[asa]}`}
                    title=${`Cambiar el tamaño (${NOMBRE_ASA[asa]})`}
                    onPointerDown=${(e) => presionar(e, el.id, asa)}
                  ></span>`,
                )
              : null}
          </div>`;
        })}
        ${vivo
          ? html`${vivo.guias.x.map((x) => html`<div key=${`gx${x}`} class="edd-guia edd-guia-v" style=${`left:${x}%`}></div>`)}
            ${vivo.guias.y.map((y) => html`<div key=${`gy${y}`} class="edd-guia edd-guia-h" style=${`top:${y}%`}></div>`)}`
          : null}
      </div>
    </div>
  </div>`;

  const pie = html`<div class="edd-pie" role="group" aria-label="Con qué datos se ve">
    <${Segmentos} etiqueta="Ver como" valor=${verTipo} opciones=${TIPOS} alCambiar=${setVerTipo} />
    <${Segmentos} etiqueta="Inventario" valor=${verInv} opciones=${OPCIONES_INVENTARIO} alCambiar=${setVerInv} />
    ${lista.length ? html`<${Segmentos} etiqueta="Datos" valor=${datosDe} opciones=${{ lista: "De la lista", muestra: "De muestra" }} alCambiar=${setDatosDe} />` : null}
    <span class="nota edd-muestra" title="Los datos con que se ve la etiqueta">
      ${primera ? `Primera de la lista de ${TIPOS[verTipo]}` : "Datos de muestra"}: ${[etiqueta.codigo, etiqueta.nombre].filter(Boolean).join(" · ")}
    </span>
    <span class="nota">Plantilla ${diseno.ancho} × ${diseno.alto} mm</span>
  </div>`;

  const panelElementos = html`<aside class="edd-panel" aria-label="Agregar y propiedades">
    <section class="edd-agregar">
      <h3>Agregar</h3>
      <div class="edd-agregar-botones">
        ${AGREGAR_ANTES.map(([t, texto]) => html`<${Boton} key=${t} tamano="chico" onClick=${() => agregar(t)}>${texto}<//>`)}
        <${Lista}
          valor=""
          ariaLabel="Agregar un campo"
          clase="edd-agregar-campo"
          mostrar=${() => html`<span class="lista-valor">Campo…</span>`}
          opciones=${Object.entries(CAMPOS_ETIQUETA).map(([valor, texto]) => ({ valor, etiqueta: texto }))}
          alCambiar=${(campo) => agregar("campo", campo)}
        />
        ${AGREGAR_DESPUES.map(([t, texto]) => html`<${Boton} key=${t} tamano="chico" onClick=${() => agregar(t)}>${texto}<//>`)}
      </div>
      ${elementos.length >= MAXIMO_ELEMENTOS ? html`<p class="nota">Ya lleva ${MAXIMO_ELEMENTOS} elementos: es el máximo.</p>` : null}
    </section>
    ${elegido
      ? html`<${Propiedades} key=${elegido.id} el=${elegido} etiqueta=${etiqueta} diseno=${diseno} avisos=${avisosDe(elegido.id)} ed=${ed} />`
      : html`<section class="edd-ayuda">
          <h3>Propiedades</h3>
          <p class="nota">Elige un elemento en la etiqueta (o en la lista de abajo) para ver y cambiar sus propiedades.</p>
          <ul class="edd-teclas">
            <li>Arrastra para mover; las asas cambian el tamaño. Con <${Teclas} teclas=${["Alt"]} /> se mueve libre (sin imán ni guías).</li>
            <li>${["←", "→", "↑", "↓"].map((t) => html`<${Teclas} teclas=${[t]} /> `)} mueven 0.5 % · con <${Teclas} teclas=${["Shift"]} />, 5 %</li>
            <li><${Teclas} teclas=${["Supr"]} /> quita · <${Teclas} teclas=${["Ctrl", "D"]} /> duplica</li>
            <li><${Teclas} teclas=${["Ctrl", "Z"]} /> deshace · <${Teclas} teclas=${["Ctrl", "Y"]} /> rehace · <${Teclas} teclas=${["Ctrl", "S"]} /> guarda</li>
            <li><${Teclas} teclas=${["Esc"]} /> deja de elegir; sin nada elegido, cierra.</li>
          </ul>
        </section>`}
    <section class="edd-capas">
      <h3>Elementos <span class="nota">(${elementos.length}; el de arriba se dibuja encima)</span></h3>
      ${mostrados.length
        ? html`<ul>
            ${[...mostrados].reverse().map((el) => {
              const n = avisosDe(el.id).length;
              return html`<li key=${el.id}>
                <button
                  type="button"
                  class=${`edd-capa-boton ${el.id === sel ? "elegida" : ""}`}
                  aria-pressed=${el.id === sel ? "true" : "false"}
                  onClick=${() => {
                    ponerSel(el.id);
                    enfocarCaja(el.id);
                  }}
                >
                  <span>${nombreElemento(el)}</span>
                  ${!dibujados[el.id] ? html`<${Pastilla} titulo=${porQueNoSeVe(el, etiqueta)}>no se ve<//>` : null}
                  ${n ? html`<${Pastilla} tono="alerta">⚠ ${n}<//>` : null}
                </button>
              </li>`;
            })}
          </ul>`
        : html`<p class="vacio">El diseño está en blanco: agrega elementos arriba.</p>`}
    </section>
  </aside>`;

  return html`<${PantallaCompleta} etiqueta="Editor de diseños de etiqueta" raiz=${raiz}>
    ${cabeza} ${franjas}
    <div class="edd-pestanas segmentos" role="tablist" aria-label="Zonas del editor">
      ${[
        ["disenos", "Diseños"],
        ["etiqueta", "Etiqueta"],
        ["propiedades", elegido ? "Propiedades" : "Agregar"],
      ].map(
        ([clave, texto]) => html`<button key=${clave} type="button" role="tab" aria-selected=${pestana === clave ? "true" : "false"} class=${`segmento ${pestana === clave ? "activo" : ""}`} onClick=${() => setPestana(clave)}>
          ${texto}
        </button>`,
      )}
    </div>
    <div class="edd-cuerpo" data-pestana=${pestana}>
      ${panelDisenos}
      <main class="edd-centro">${barra} ${marcoLienzo} ${pie}</main>
      ${panelElementos}
    </div>
    ${pregunta
      ? html`<${PreguntaCambios}
          nombre=${nombre}
          alSeguir=${() => setPregunta(null)}
          alDescartar=${() => {
            const accion = pregunta.accion;
            setPregunta(null);
            const m = guardadoActual();
            if (m) {
              base.current = JSON.stringify(m.elementos);
              ponerH(lz.historial(m.elementos.map((e) => ({ ...e }))));
            }
            r.current.sucio = false;
            accion();
          }}
          alGuardar=${async () => {
            const accion = pregunta.accion;
            setPregunta(null);
            if (await guardar()) accion();
          }}
        />`
      : null}
    ${renombrando ? html`<${VentanaRenombrar} nombre=${nombre} alGuardar=${renombrar} alCerrar=${() => setRenombrando(false)} />` : null}
  <//>`;
}
