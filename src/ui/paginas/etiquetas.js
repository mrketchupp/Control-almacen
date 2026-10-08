// Etiquetas de almacén (Ronda 20): lo que hacía el generador de etiquetas, dentro de la herramienta y
// con sus datos. Se agregan desde el inventario, desde un vale de entrada (por su folio), a mano o desde
// una lista .json del generador; se revisan en la lista por imprimir y se imprimen en hojas con la
// cuadrícula que cabe en el papel. Al registrar una entrada se sugiere hacer sus etiquetas
// (`EtiquetasDeEntrada`, también en el detalle de la entrada).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { HOJAS, MAXIMO_ETIQUETAS, PLANTILLAS, cuadricula, documentoEtiquetas, leerMedida, plantillaDe } from "../../impresion/etiquetas.js";
import { identidadDe, imagenesConIdentidad } from "../../impresion/identidad.js";
import { Indices } from "../../nucleo/estado.js";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import { INVENTARIOS, inventarioDe, inventarioPorId, otrosInventarios } from "../../nucleo/inventarios.js";
import { filasInventario } from "../../servicios/consultas.js";
import { folioEntrada } from "../../servicios/entradas.js";
import * as et from "../../servicios/etiquetas.js";
import { MAXIMO_LOGO } from "../../servicios/valeImpreso.js";
import { Aviso, Boton, Buscador, CampoSugerido, Combo, ElegirArchivo, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const OPCIONES_INVENTARIO = Object.fromEntries(INVENTARIOS.map((i) => [i.id, i.id]));
const OPCIONES_TIPO = { material: "Material", ax: "Código AX" };
const MM_A_PX = 96 / 25.4;
const CLAVE_TIPO = "control-almacen.etiquetas.tipo";

function tipoRecordado() {
  try {
    return localStorage.getItem(CLAVE_TIPO) === "ax" ? "ax" : "material";
  } catch {
    return "material";
  }
}

function recordarTipo(tipo) {
  try {
    localStorage.setItem(CLAVE_TIPO, tipo);
  } catch {
    // Sin almacenamiento (ventana privada): solo no se recuerda.
  }
}

const etiquetasDe = (n) => `${num(n)} ${n === 1 ? "etiqueta" : "etiquetas"}`;
const partidasDe = (n) => `${num(n)} ${n === 1 ? "partida" : "partidas"}`;

/** DLTA en azul y GSM en morado, en cualquier inventario abierto. */
export function PastillaInventario({ id }) {
  const inv = inventarioPorId(id).id;
  return html`<span class=${`pastilla pastilla-inv pastilla-inv-${inv.toLowerCase()}`} title=${`Inventario ${inv}`}>${inv}</span>`;
}

/** De dónde salió una etiqueta, en corto. */
function textoOrigen(origen, abierto) {
  if (!origen) return null;
  // De qué inventario salió, si no es el abierto (la lista es la misma en DLTA y GSM).
  const de = origen.inventario && origen.inventario !== abierto ? ` de ${origen.inventario}` : "";
  if (origen.tipo === "ENTRADA") return `Entrada ${origen.folio}${de}${origen.folio_externo ? ` · vale ${origen.folio_externo}` : ""}`;
  if (origen.tipo === "INVENTARIO") return `Inventario${de}${origen.hoja ? ` · ${origen.hoja}` : ""}`;
  if (origen.tipo === "ARCHIVO") return origen.archivo ? `Archivo ${origen.archivo}` : "Lista del generador";
  return null;
}

/** Guarda un cambio sin el aviso de "trabajando…" (cambios chicos que se hacen seguido). */
function useGuardar() {
  const sesion = useSesion();
  return (cambio) =>
    sesion.almacen.modificar(cambio).catch((error) => {
      console.error(error);
      sesion.avisar("error", error?.message || String(error));
      return undefined;
    });
}

/** Agrega etiquetas a la lista y avisa (con Deshacer). @returns los ids */
function useAgregar() {
  const sesion = useSesion();
  return async (tipo, etiquetas, { avisar = true } = {}) => {
    if (!etiquetas.length) return [];
    const ids = await sesion.tarea("Agregando…", () => sesion.almacen.modificar((e) => et.agregarEtiquetas(e, tipo, etiquetas)));
    if (ids && avisar) {
      const total = et.totalEtiquetas(etiquetas);
      sesion.avisar("exito", `Se agregaron ${partidasDe(etiquetas.length)} (${etiquetasDe(total)}) a la lista de ${OPCIONES_TIPO[tipo]}.`, 6000, {
        etiqueta: "Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => et.quitarEtiquetas(e, tipo, ids)),
      });
    }
    return ids ?? [];
  };
}

// ---------------------------------------------------------------- vista previa e impresión

/** Ajusta el zoom para que la hoja quepa a lo ancho de su contenedor. */
function useZoom(anchoMm, maximo = 1) {
  const ref = useRef(null);
  const [zoom, setZoom] = useState(0.5);
  useLayoutEffect(() => {
    const medir = () => {
      const ancho = ref.current?.clientWidth ?? 0;
      if (ancho) setZoom(Math.min(maximo, (ancho - 8) / (anchoMm * MM_A_PX)));
    };
    medir();
    const observador = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null;
    if (observador && ref.current) observador.observe(ref.current);
    return () => observador?.disconnect();
  }, [anchoMm, maximo]);
  return [ref, zoom];
}

/**
 * Hojas como saldrán impresas y el botón de imprimir. Después de imprimir pregunta si salieron bien:
 * así queda en la bitácora (y en las entradas) y salen de la lista.
 */
export function VistaPreviaEtiquetas({ tipo, ids, alCerrar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const { diseno, identidad } = et.configEtiquetas(estado);
  const elegidas = useMemo(() => {
    const quiero = new Set(ids);
    return et.etiquetasPorImprimir(estado, tipo).filter((e) => quiero.has(e.id));
  }, [estado, tipo, ids]);
  const vista = useMemo(() => documentoEtiquetas(elegidas, { tipo, diseno, identidad, vista: true }), [elegidas, tipo, JSON.stringify(diseno), identidad]);
  const [hojasRef, zoom] = useZoom(vista.cuadricula.hoja.ancho);
  const [impreso, setImpreso] = useState(false);
  const c = vista.cuadricula;
  const demasiadas = vista.etiquetas > MAXIMO_ETIQUETAS;
  const imprimir = () =>
    sesion.tarea("Preparando impresión…", async () => {
      await sesion.imprimirDocumento(documentoEtiquetas(elegidas, { tipo, diseno, identidad }));
      setImpreso(true);
    });
  const registrar = (quitar) =>
    sesion.tarea("Guardando…", async () => {
      const registro = await sesion.almacen.modificar((e) => et.registrarImpresion(e, tipo, elegidas.map((x) => x.id), { usuario: sesion.usuario, quitar }));
      const folios = registro.vales.length ? ` de ${registro.vales.length === 1 ? "la entrada" : "las entradas"} ${registro.vales.map((id) => folioEntrada(estado.vales.find((v) => v.id === id)?.folio)).join(", ")}` : "";
      sesion.avisar("exito", `Listo: ${etiquetasDe(registro.etiquetas)} impresas${folios}.${quitar ? " Salieron de la lista." : ""}`);
      alCerrar();
    });
  return html`<div class="vista-previa vista-etiquetas" role="dialog" aria-modal="true" aria-label="Vista previa de las etiquetas">
    <div class="vista-barra">
      <strong>
        ${`${etiquetasDe(vista.etiquetas)} · ${vista.hojas} ${vista.hojas === 1 ? "hoja" : "hojas"} ${c.hoja.nombre.toLowerCase()} · ${c.columnas} × ${c.filas} (${c.porHoja} por hoja)`}
      </strong>
      ${impreso
        ? html`<div class="acciones-linea etq-salieron">
            <span>¿Salieron bien?</span>
            <${Boton} tipo="primario" onClick=${() => registrar(true)}>Sí, quitarlas de la lista<//>
            <${Boton} onClick=${() => registrar(false)}>Sí, pero dejarlas en la lista<//>
            <${Boton} tipo="texto" onClick=${() => setImpreso(false)}>No, volver a intentar<//>
          </div>`
        : html`<div class="acciones-linea">
            <${Boton} tipo="primario" disabled=${!vista.hojas || demasiadas} onClick=${imprimir}>🖨 Imprimir<//>
            <${Boton} onClick=${alCerrar}>Cerrar<//>
          </div>`}
    </div>
    <div class="vista-hojas" ref=${hojasRef}>
      <p class="etq-consejo">Lo que ves es lo que sale. En el cuadro de impresión deja la escala al 100 % y quita «Encabezados y pies de página».</p>
      ${c.avisos.length ? html`<${Aviso} tipo="error" titulo="No cabe en la hoja">${c.avisos.join(" ")} Ajusta el diseño.<//>` : null}
      ${demasiadas ? html`<${Aviso} tipo="error" titulo="Demasiadas etiquetas">Son ${num(vista.etiquetas)}; el máximo por impresión es ${num(MAXIMO_ETIQUETAS)}. Revisa las cantidades.<//>` : null}
      <style>${vista.css}</style>
      <div class="etq-previa" style=${`zoom:${zoom}`} dangerouslySetInnerHTML=${{ __html: vista.html }}></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- editor de una etiqueta

/** Formulario de una etiqueta (a mano o para corregir una de la lista). */
function EditorEtiqueta({ tipo, inicial, titulo, textoGuardar, alGuardar, alCerrar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const nombres = useMemo(() => et.nombresAx(estado), [estado.cortes_ax]);
  const [datos, setDatos] = useState(() => ({ cantidad: 1, codigo: "", nombre: "", dimension: "", np: "", descripcion: "", area: "", inventario: sesion.inventario.id, ...inicial }));
  // El nombre se llena solo mientras no se escriba a mano.
  const [nombreAuto, setNombreAuto] = useState(() => !inicial?.nombre);
  const poner = (campo) => (valor) => setDatos((d) => ({ ...d, [campo]: valor }));
  const conCodigo = (codigo) => {
    const n = String(codigo).trim();
    setDatos((d) => ({ ...d, codigo: n, ...(nombreAuto || !d.nombre ? { nombre: et.nombreDe(estado, n, { nombres }) } : {}) }));
    if (!datos.nombre) setNombreAuto(true);
  };
  const sugerencias = useMemo(() => et.sugerenciasCodigo(estado, datos.codigo, { nombres }), [datos.codigo, nombres]);
  const claves = useMemo(() => et.clavesDeCodigo(estado, datos.codigo), [datos.codigo, estado.variantes]);
  const falta = !String(datos.codigo).trim() && !String(datos.nombre).trim();
  const campo = (etiqueta, nombre, extra = {}) =>
    html`<label class="campo"><span>${etiqueta}</span><input value=${datos[nombre]} onInput=${(e) => poner(nombre)(e.currentTarget.value)} ...${extra} /></label>`;
  return html`<${Ventana} titulo=${titulo} alCerrar=${alCerrar} clase="ventana-etiqueta">
    <div class="etq-editor">
      <label class="campo campo-cantidad">
        <span>Etiquetas</span>
        <input type="number" min="1" max=${et.MAXIMO_POR_PARTIDA} value=${datos.cantidad} onInput=${(e) => poner("cantidad")(e.currentTarget.value)} />
      </label>
      <div class="campo">
        <span>Código AX</span>
        <${Combo}
          valor=${String(datos.codigo)}
          alEscribir=${conCodigo}
          opciones=${sugerencias}
          clave=${(o) => o.codigo}
          render=${(o) => html`<strong>${o.codigo}</strong> <span>${o.nombre}</span>${o.descripcion && o.descripcion !== o.nombre ? html`<span class="res-detalle">${o.descripcion}</span>` : null}`}
          alElegir=${(o) => conCodigo(o.codigo)}
          placeholder="Código o nombre"
          ariaLabel="Código AX"
          autoMarcar=${false}
        />
      </div>
      <label class="campo campo-ancho">
        <span>Nombre ${nombreAuto && datos.nombre ? html`<small class="nota">(de AX o del inventario)</small>` : null}</span>
        <input
          value=${datos.nombre}
          onInput=${(e) => {
            setNombreAuto(false);
            poner("nombre")(e.currentTarget.value);
          }}
        />
      </label>
      ${tipo === "material"
        ? html`<div class="campo campo-ancho">
              <span>Dimensión / clave de almacén</span>
              <${CampoSugerido} valor=${datos.dimension} alCambiar=${poner("dimension")} sugerencias=${claves.dimensiones} ariaLabel="Dimensión" placeholder="Ej. 6309-2Z/C3" />
            </div>
            <div class="campo">
              <span>No. parte</span>
              <${CampoSugerido} valor=${datos.np} alCambiar=${poner("np")} sugerencias=${claves.nps} ariaLabel="Número de parte" />
            </div>
            ${campo("Descripción", "descripcion", { placeholder: "Ej. OC: 4500123" })} ${campo("Área", "area", { placeholder: "Ej. TALLER MECÁNICO" })}`
        : null}
      <div class="campo campo-ancho">
        <${Segmentos} etiqueta="Inventario (su logo va en la etiqueta)" valor=${datos.inventario} opciones=${OPCIONES_INVENTARIO} alCambiar=${poner("inventario")} />
      </div>
    </div>
    <div class="acciones-linea pie-editor">
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <span class="espaciador"></span>
      <${Boton} tipo="primario" disabled=${falta} onClick=${() => alGuardar(datos)}>${textoGuardar}<//>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- de qué inventario (Ronda 21)

/**
 * Los datos de `inventario` para LEERLOS: los del abierto o una copia de los del otro, tal como quedaron
 * guardados en su base (nada se escribe en él). estado = null si ese inventario aún no tiene datos.
 * @returns {{ estado, cargando, error }}
 */
function useEstadoDe(inventario) {
  const sesion = useSesion();
  const propio = inventario === sesion.inventario.id;
  const [leido, setLeido] = useState({ inventario: null, estado: undefined, error: null });
  useEffect(() => {
    if (propio) return undefined;
    let vigente = true;
    sesion.estadoDeInventario(inventario).then(
      (estado) => vigente && setLeido({ inventario, estado, error: null }),
      (error) => vigente && setLeido({ inventario, estado: null, error: error?.message || String(error) }),
    );
    return () => {
      vigente = false;
    };
  }, [inventario, propio]);
  if (propio) return { estado: sesion.estado, cargando: false, error: null };
  if (leido.inventario !== inventario) return { estado: undefined, cargando: true, error: null };
  return { estado: leido.estado, cargando: false, error: leido.error };
}

/** De qué inventario se toman los datos (sin cambiar el abierto). */
function DeInventario({ valor, alCambiar }) {
  const sesion = useSesion();
  return html`<div class="etq-de-inventario">
    <${Segmentos} etiqueta="Datos de" valor=${valor} opciones=${OPCIONES_INVENTARIO} alCambiar=${alCambiar} />
    <span class="nota">
      ${valor === sesion.inventario.id
        ? `Del inventario abierto. También puedes traer material de ${otrosInventarios(valor).join(" o ")} sin cambiar de inventario.`
        : `Se leen los datos de ${valor} como quedaron guardados; en ${valor} no cambia nada. Sus etiquetas van a la misma lista.`}
    </span>
  </div>`;
}

/** Mientras se lee el otro inventario, o si no tiene datos. */
function SinDatos({ inventario, cargando, error, alCerrar }) {
  return html`<div class="etq-sin-datos">
    ${cargando
      ? html`<p class="nota">Leyendo los datos de ${inventario}…</p>`
      : error
        ? html`<${Aviso} tipo="error" titulo=${`No se pudieron leer los datos de ${inventario}`}>${error}<//>`
        : html`<${Aviso} tipo="info" titulo=${`${inventario} aún no tiene datos`}>Haz su <em>Primera carga</em> (cámbiate a ${inventario} arriba) para traer su material.<//>`}
    <div class="acciones-linea pie-editor"><span class="espaciador"></span><${Boton} onClick=${alCerrar}>Cerrar<//></div>
  </div>`;
}

// ---------------------------------------------------------------- desde el inventario

function VentanaInventario({ tipo, alCerrar }) {
  const sesion = useSesion();
  const [inventario, setInventario] = useState(sesion.inventario.id);
  const fuente = useEstadoDe(inventario);
  return html`<${Ventana} titulo=${`Etiquetas de ${OPCIONES_TIPO[tipo].toLowerCase()} desde el inventario`} alCerrar=${alCerrar} clase="ventana-ancha ventana-etq ventana-etq-inventario">
    <${DeInventario} valor=${inventario} alCambiar=${setInventario} />
    ${fuente.estado
      ? html`<${PartidasDelInventario} key=${inventario} estado=${fuente.estado} inventario=${inventario} tipo=${tipo} alCerrar=${alCerrar} />`
      : html`<${SinDatos} inventario=${inventario} cargando=${fuente.cargando} error=${fuente.error} alCerrar=${alCerrar} />`}
  <//>`;
}

/** Buscar y marcar partidas del inventario `estado` (el abierto o una copia del otro). */
function PartidasDelInventario({ estado, inventario, tipo, alCerrar }) {
  const agregar = useAgregar();
  const filas = useMemo(() => filasInventario(estado), [estado]);
  const [texto, setTexto] = useState("");
  const [hoja, setHoja] = useState("");
  const [conExistencia, setConExistencia] = useState(false);
  const [elegidas, setElegidas] = useState(() => new Set());
  const hojas = useMemo(() => [...new Set(filas.map((f) => f.hoja))], [filas]);
  const porTexto = useFiltroTexto(filas, texto, ["codigo", "descripcion", "dimension", "np", "nota"]);
  const visibles = porTexto.filter((f) => (!hoja || f.hoja === hoja) && (!conExistencia || f.total > 0));
  const todasVisibles = visibles.length > 0 && visibles.every((f) => elegidas.has(f.id));
  const alternar = (id) =>
    setElegidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const alternarVisibles = () =>
    setElegidas((s) => {
      const n = new Set(s);
      for (const f of visibles) todasVisibles ? n.delete(f.id) : n.add(f.id);
      return n;
    });
  const listo = async () => {
    const indices = new Indices(estado);
    const nombres = et.nombresAx(estado);
    const orden = filas.filter((f) => elegidas.has(f.id));
    const etiquetas = orden.map((f) => et.etiquetaDeExistencia(estado, f.id, { indices, nombres, inventario }));
    const ids = await agregar(tipo, etiquetas);
    if (ids.length) alCerrar();
  };
  return html`
    <p class="nota">Una etiqueta por partida (la del lugar); la cantidad se cambia después en la lista. El nombre es el de AX cuando el código viene en un reporte importado.</p>
    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Buscar código, descripción, dimensión o NP…" />
      <div class="filtro">
        <span>Contenedor</span>
        <${Lista} valor=${hoja} alCambiar=${setHoja} ariaLabel="Contenedor" opciones=${[{ valor: "", etiqueta: "Todos" }, ...hojas.map((h) => ({ valor: h, etiqueta: h }))]} />
      </div>
      <label class="casilla"><input type="checkbox" checked=${conExistencia} onChange=${(e) => setConExistencia(e.currentTarget.checked)} /> Solo con existencia</label>
    </div>
    <${Tabla}
      limite=${150}
      filas=${visibles}
      vacia="Nada coincide con la búsqueda."
      columnas=${[
        {
          titulo: html`<input type="checkbox" aria-label="Marcar todo lo visible" checked=${todasVisibles} onChange=${alternarVisibles} />`,
          ancho: "34px",
          render: (f) => html`<input type="checkbox" aria-label=${`Elegir ${f.codigo} ${f.dimension}`} checked=${elegidas.has(f.id)} onChange=${() => alternar(f.id)} />`,
        },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { titulo: "Dimensión", render: (f) => f.dimension || "—" },
        { titulo: "NP", render: (f) => f.np || "—" },
        { titulo: "Lugar", render: (f) => html`<span class="sin-corte" title=${f.hoja}>#${f.contenedor} ${f.clase === "Inventariable" ? "Inv." : "Cons."}</span>` },
        { titulo: "Hay", numero: true, render: (f) => `${num(f.total)} ${f.um}` },
      ]}
    />
    <div class="acciones-linea pie-editor">
      <span class="nota">${partidasDe(elegidas.size)} ${elegidas.size === 1 ? "elegida" : "elegidas"} de ${inventario}</span>
      ${elegidas.size ? html`<${Boton} tipo="texto" onClick=${() => setElegidas(new Set())}>Quitar las marcas<//>` : null}
      <span class="espaciador"></span>
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <${Boton} tipo="primario" disabled=${!elegidas.size} onClick=${listo}>Agregar ${partidasDe(elegidas.size)}<//>
    </div>
  `;
}

// ---------------------------------------------------------------- desde un vale de entrada

/**
 * Cómo van las etiquetas de una entrada de `inventario` (el del estado, si no se dice): impresas (cuándo),
 * en la lista o faltan. `estado` es el abierto: su lista y su bitácora son las de los dos inventarios.
 */
export function EstadoEtiquetas({ estado, valeId, inventario = null, corto = false, impresas: porVale = null, enLista = null }) {
  const inv = inventario ?? inventarioDe(estado).id;
  const impresas = (porVale ?? et.impresionesPorVale(estado, inv)).get(valeId);
  if (impresas?.length) {
    const ultima = impresas[0];
    return html`<${Pastilla} tono="ok" titulo=${`${etiquetasDe(ultima.etiquetas)} el ${fmtFechaHora(ultima.fecha_hora)}${ultima.usuario ? ` · ${ultima.usuario}` : ""}`}
      >${corto ? "✓ " : "Etiquetas impresas "}${fmtFecha(ultima.fecha_hora.slice(0, 10))}<//
    >`;
  }
  if ((enLista ?? et.entradasEnLista(estado, inv)).has(valeId)) return html`<${Pastilla} tono="info" titulo="Sus etiquetas están en la lista por imprimir">En la lista<//>`;
  return corto ? html`<span class="nota">—</span>` : null;
}

/** Buscar una entrada de `estado` (el abierto o una copia del otro) por su folio. */
function BuscarEntrada({ estado, inventario, alElegir }) {
  const sesion = useSesion();
  const [consulta, setConsulta] = useState("");
  const hallados = useMemo(() => et.buscarEntradas(estado, consulta), [estado, consulta]);
  return html`<div class="etq-buscar-entrada">
    <label class="campo">
      <span>Folio de la entrada (E-0005) o del vale de la base</span>
      <input
        value=${consulta}
        onInput=${(e) => setConsulta(e.currentTarget.value)}
        onKeyDown=${(e) => {
          if (e.key === "Enter" && hallados.length === 1) alElegir(hallados[0].vale.id);
        }}
        placeholder="Ej. E-0005 o 12345"
        aria-label="Folio de la entrada"
        autofocus
      />
    </label>
    ${hallados.length
      ? html`<p class="nota">${consulta.trim() ? "Coinciden:" : `Las más recientes de ${inventario}:`}</p>
          <ul class="etq-entradas">
            ${hallados.map(
              ({ vale, por }) => html`<li key=${vale.id}>
                <button type="button" class="etq-entrada" onClick=${() => alElegir(vale.id)}>
                  <strong>${folioEntrada(vale.folio)}</strong>
                  <span>${vale.folio_externo ? `Vale ${vale.folio_externo}` : "Sin folio de la base"}${por === "base" ? " ✓" : ""}</span>
                  <span class="nota">${fmtFecha(vale.fecha)} · ${vale.origen || "—"} · ${partidasDe(vale.lineas.length)}</span>
                  <${EstadoEtiquetas} estado=${sesion.estado} valeId=${vale.id} inventario=${inventario} />
                </button>
              </li>`,
            )}
          </ul>`
      : html`<p class="vacio">${consulta.trim() ? `No hay una entrada de ${inventario} con ese folio.` : `${inventario} aún no tiene entradas registradas.`}</p>`}
  </div>`;
}

/** Las partidas de una entrada como etiquetas: se marcan las que van y se ajusta cuántas. */
function PartidasDeEntrada({ estado, inventarioEntrada, valeId, tipo, setTipo, alCambiarEntrada, alAgregar, alCerrar }) {
  const sesion = useSesion();
  const vale = estado.vales.find((v) => v.id === valeId);
  const [inventario, setInventario] = useState(inventarioEntrada);
  const [filas, setFilas] = useState(() => et.etiquetasDeEntrada(estado, valeId, { inventario: inventarioEntrada }).map((f) => ({ ...f, texto: String(f.etiqueta.cantidad) })));
  const cambiar = (i, cambios) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
  // La cantidad se escribe libre; al usarla se limpia (1–999).
  const elegidas = filas.filter((f) => f.incluir).map((f) => ({ ...f.etiqueta, cantidad: et.etiquetaLimpia({ cantidad: f.texto }).cantidad, inventario }));
  const total = et.totalEtiquetas(elegidas);
  const otro = inventarioEntrada !== sesion.inventario.id;
  return html`
    <div class="etq-entrada-cabeza">
      <div>
        ${otro ? html`<${PastillaInventario} id=${inventarioEntrada} /> ` : null}<strong>Entrada ${folioEntrada(vale.folio)}</strong>${vale.folio_externo ? ` · vale ${vale.folio_externo}` : ""} · ${fmtFecha(vale.fecha)}${vale.origen ? ` · ${vale.origen}` : ""}
        <${EstadoEtiquetas} estado=${sesion.estado} valeId=${valeId} inventario=${inventarioEntrada} />
      </div>
      ${alCambiarEntrada ? html`<${Boton} tipo="texto" tamano="chico" onClick=${alCambiarEntrada}>Otra entrada…<//>` : null}
    </div>
    <div class="acciones-linea">
      <${Segmentos} etiqueta="Tipo de etiqueta" valor=${tipo} opciones=${OPCIONES_TIPO} alCambiar=${setTipo} />
      <${Segmentos} etiqueta="Inventario en la etiqueta" valor=${inventario} opciones=${OPCIONES_INVENTARIO} alCambiar=${setInventario} />
    </div>
    <p class="nota">Una etiqueta por pieza (una sola si es metro, litro, kilo… o una cantidad con decimales). NOMBRE de AX; DESCRIPCIÓN con la O.C.</p>
    <${Tabla}
      filas=${filas}
      claveFila=${(f) => f.linea.id}
      columnas=${[
        {
          titulo: "Va",
          ancho: "34px",
          render: (f) => html`<input type="checkbox" aria-label=${`Incluir ${f.etiqueta.codigo}`} checked=${f.incluir} onChange=${(e) => cambiar(filas.indexOf(f), { incluir: e.currentTarget.checked })} />`,
        },
        {
          titulo: "Etiquetas",
          ancho: "90px",
          render: (f) => html`<input
            class="entrada-cantidad"
            type="number"
            min="1"
            max=${et.MAXIMO_POR_PARTIDA}
            aria-label=${`Etiquetas de ${f.etiqueta.codigo}`}
            value=${f.texto}
            disabled=${!f.incluir}
            onInput=${(e) => cambiar(filas.indexOf(f), { texto: e.currentTarget.value })}
            onBlur=${() => cambiar(filas.indexOf(f), { texto: String(et.etiquetaLimpia({ cantidad: f.texto }).cantidad) })}
          />`,
        },
        { titulo: "Entró", numero: true, render: (f) => `${num(Number(f.linea.cantidad))} ${f.linea.um ?? ""}` },
        { titulo: "Código", numero: true, render: (f) => f.etiqueta.codigo },
        { titulo: "Nombre", render: (f) => f.etiqueta.nombre },
        ...(tipo === "material"
          ? [
              { titulo: "Dimensión", render: (f) => f.etiqueta.dimension || "—" },
              { titulo: "NP", render: (f) => f.etiqueta.np || "—" },
              { titulo: "Descripción", render: (f) => f.etiqueta.descripcion || "—" },
            ]
          : []),
        { titulo: "", render: (f) => (f.sinExistencia ? html`<${Pastilla} tono="alerta" titulo="No lleva existencia (diésel, gases…)">sin existencia<//>` : null) },
      ]}
    />
    <div class="acciones-linea pie-editor">
      <span class="nota">${partidasDe(elegidas.length)} · ${etiquetasDe(total)}</span>
      <span class="espaciador"></span>
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <${Boton} disabled=${!elegidas.length} onClick=${() => alAgregar(elegidas, false)}>Agregar a la lista<//>
      <${Boton} tipo="primario" disabled=${!elegidas.length} onClick=${() => alAgregar(elegidas, true)}>🖨 Imprimir ahora<//>
    </div>
  `;
}

/**
 * Etiquetas de un vale de entrada: si no se da `valeId`, primero se busca por folio (en el inventario
 * abierto o en el otro). «Imprimir ahora» las agrega a la lista y abre la vista previa con solo esas.
 * `inventario` = de qué inventario es la entrada (el abierto, si no se dice).
 */
export function EtiquetasDeEntrada({ valeId: inicial = null, inventario: inventarioInicial = null, tipo: tipoInicial = "material", alCerrar }) {
  const sesion = useSesion();
  const agregar = useAgregar();
  const [valeId, setValeId] = useState(inicial);
  const [inventario, setInventario] = useState(inventarioInicial ?? sesion.inventario.id);
  const [tipo, setTipo] = useState(tipoInicial);
  const [imprimir, setImprimir] = useState(null); // ids recién agregados
  const fuente = useEstadoDe(inventario);
  if (imprimir) return html`<${VistaPreviaEtiquetas} tipo=${tipo} ids=${imprimir} alCerrar=${alCerrar} />`;
  const alAgregar = async (etiquetas, yImprimir) => {
    const ids = await agregar(tipo, etiquetas, { avisar: !yImprimir });
    if (!ids.length) return;
    if (yImprimir) setImprimir(ids);
    else alCerrar();
  };
  const elegir = (id) => {
    setInventario(id);
    setValeId(null);
  };
  return html`<${Ventana} titulo="Etiquetas de un vale de entrada" alCerrar=${alCerrar} clase="ventana-ancha ventana-etq ventana-etq-entrada">
    ${inicial === null ? html`<${DeInventario} valor=${inventario} alCambiar=${elegir} />` : null}
    ${!fuente.estado
      ? html`<${SinDatos} inventario=${inventario} cargando=${fuente.cargando} error=${fuente.error} alCerrar=${alCerrar} />`
      : valeId === null
        ? html`<${BuscarEntrada} key=${inventario} estado=${fuente.estado} inventario=${inventario} alElegir=${setValeId} />`
        : fuente.estado.vales.some((v) => v.id === valeId)
          ? html`<${PartidasDeEntrada}
              key=${`${inventario}-${valeId}`}
              estado=${fuente.estado}
              inventarioEntrada=${inventario}
              valeId=${valeId}
              tipo=${tipo}
              setTipo=${setTipo}
              alCambiarEntrada=${inicial === null ? () => setValeId(null) : null}
              alAgregar=${alAgregar}
              alCerrar=${alCerrar}
            />`
          : html`<${SinDatos} inventario=${inventario} error=${"Esa entrada ya no está."} alCerrar=${alCerrar} />`}
  <//>`;
}

// ---------------------------------------------------------------- diseño, logos y texto

/** Convierte un data: URL en archivo (para pasarlo por el mismo reductor que un logo subido). */
function archivoDeDataUrl(src, nombre) {
  const [cabeza, datos] = src.split(",");
  const tipo = /data:([^;]+)/.exec(cabeza)?.[1] ?? "image/png";
  const binario = atob(datos);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], nombre, { type: tipo });
}

/** Logos del libro de vales del inventario abierto (con lo corregido en Ajustes → Vale impreso), de izquierda a derecha. */
async function logosDelVale(sesion) {
  const identidad = identidadDe(sesion.estado);
  const vistos = new Map();
  for (const modelo of await sesion.modelosFormato()) {
    for (const imagen of imagenesConIdentidad(modelo.imagenes, identidad)) {
      const previo = vistos.get(imagen.src);
      if (!previo || imagen.x < previo.x) vistos.set(imagen.src, { src: imagen.src, x: imagen.x });
    }
  }
  return [...vistos.values()].sort((a, b) => a.x - b.x);
}

function LogoEtiqueta({ titulo, logo, delVale, alCambiar }) {
  const sesion = useSesion();
  const [eligiendo, setEligiendo] = useState(false);
  const usar = (archivo) =>
    sesion.tarea("Guardando el logo…", async () => {
      alCambiar(await sesion.leerLogo(archivo));
      setEligiendo(false);
    });
  // El del vale se reduce como uno subido; si el navegador no lo puede redibujar, va tal cual (si es PNG o JPG chico).
  const usarDelVale = (l, i) =>
    sesion.tarea("Guardando el logo…", async () => {
      const nombre = `logo del vale ${i + 1}`;
      let logo;
      try {
        logo = await sesion.leerLogo(archivoDeDataUrl(l.src, nombre));
      } catch (error) {
        if (!/^data:image\/(png|jpeg);base64,/.test(l.src) || l.src.length > MAXIMO_LOGO) throw error;
        logo = { src: l.src, nombre };
      }
      alCambiar(logo);
      setEligiendo(false);
    });
  return html`<div class="etq-logo-campo">
    <span class="etq-logo-titulo">${titulo}</span>
    <div class=${`logo-marco ${logo ? "" : "logo-vacio"}`}>${logo ? html`<img src=${logo.src} alt=${titulo} />` : "Sin logo"}</div>
    <div class="acciones-linea">
      ${delVale?.length ? html`<${Boton} tamano="chico" onClick=${() => setEligiendo(!eligiendo)}>Del vale…<//>` : null}
      <${ElegirArchivo} etiqueta="Subir…" acepta="image/png,image/jpeg" alElegir=${usar} />
      ${logo ? html`<${Boton} tamano="chico" tipo="texto" onClick=${() => alCambiar(null)}>Quitar<//>` : null}
    </div>
    ${eligiendo
      ? html`<ul class="etq-logos-vale" aria-label="Logos del vale">
          ${delVale.map(
            (l, i) => html`<li key=${i}>
              <button type="button" class="logo-marco" title="Usar este logo" onClick=${() => usarDelVale(l, i)}><img src=${l.src} alt=${`Logo ${i + 1} del vale`} /></button>
            </li>`,
          )}
        </ul>`
      : null}
  </div>`;
}

/** Logos y texto de almacén de un inventario. Los del vale solo se leen del inventario abierto. */
function IdentidadInventario({ inventario, identidad, delVale }) {
  const sesion = useSesion();
  const guardar = useGuardar();
  const [texto, setTexto] = useState(identidad.texto);
  const abierto = inventario === sesion.inventario.id;
  const cambiar = (cambios) => guardar((e) => et.fijarIdentidad(e, inventario, cambios, sesion.usuario));
  return html`<fieldset class="etq-identidad">
    <legend><${PastillaInventario} id=${inventario} /> ${abierto ? "(abierto)" : ""}</legend>
    <div class="etq-logos">
      <${LogoEtiqueta} titulo="Logo izquierdo" logo=${identidad.logo_izq} delVale=${abierto ? delVale : null} alCambiar=${(logo) => cambiar({ logo_izq: logo })} />
      <${LogoEtiqueta} titulo="Logo derecho" logo=${identidad.logo_der} delVale=${abierto ? delVale : null} alCambiar=${(logo) => cambiar({ logo_der: logo })} />
    </div>
    <label class="campo">
      <span>Texto de almacén (bajo el título; vacío = sin esa línea)</span>
      <input value=${texto} placeholder="Ej. BRONCO RIG-91" onInput=${(e) => setTexto(e.currentTarget.value)} onBlur=${() => texto !== identidad.texto && cambiar({ texto })} />
    </label>
    ${!abierto ? html`<p class="nota">Los logos del vale de ${inventario} se ofrecen cuando abres ese inventario; aquí puedes subirlos de un archivo.</p>` : null}
  </fieldset>`;
}

const CAMPOS_DISENO = [
  ["margen_sup", "Margen superior e inferior"],
  ["margen_lat", "Margen izquierdo y derecho"],
  ["ancho", "Ancho de la etiqueta"],
  ["alto", "Alto de la etiqueta"],
  ["sep_x", "Separación horizontal"],
  ["sep_y", "Separación vertical"],
];

const MUESTRA = { cantidad: 1, codigo: "1739", nombre: "BANDA", dimension: "3VX900", np: "", descripcion: "OC: 4500123", area: "" };

function VentanaDiseno({ tipo, alCerrar }) {
  const sesion = useSesion();
  const guardar = useGuardar();
  const config = et.configEtiquetas(sesion.estado);
  const [textos, setTextos] = useState(() => Object.fromEntries(CAMPOS_DISENO.map(([k]) => [k, String(config.diseno[k])])));
  const [delVale, setDelVale] = useState(null);
  useEffect(() => {
    let vigente = true;
    logosDelVale(sesion)
      .then((logos) => vigente && setDelVale(logos))
      .catch(() => vigente && setDelVale([]));
    return () => (vigente = false);
  }, []);
  const diseno = config.diseno;
  const c = cuadricula(diseno);
  const plantilla = plantillaDe(diseno);
  const fijar = (cambios) => guardar((e) => et.fijarDiseno(e, { ...diseno, ...cambios }, sesion.usuario));
  const usarPlantilla = (id) => {
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p) return;
    setTextos(Object.fromEntries(CAMPOS_DISENO.map(([k]) => [k, String(p.diseno[k])])));
    fijar(p.diseno);
  };
  const medida = (clave) => {
    const n = leerMedida(textos[clave]);
    if (n === null || ((clave === "ancho" || clave === "alto") && !(n > 0))) {
      setTextos({ ...textos, [clave]: String(diseno[clave]) });
      return;
    }
    setTextos({ ...textos, [clave]: String(n) });
    if (n !== diseno[clave]) fijar({ [clave]: n });
  };
  const muestra = useMemo(() => {
    const etiquetas = Array.from({ length: Math.max(1, c.porHoja) }, (_, i) => ({ ...MUESTRA, inventario: i % 2 && INVENTARIOS[1] ? INVENTARIOS[1].id : INVENTARIOS[0].id }));
    return documentoEtiquetas(etiquetas, { tipo, diseno, identidad: config.identidad, vista: true, ambito: "etq-muestra" });
  }, [JSON.stringify(diseno), config.identidad, tipo]);
  const sola = useMemo(
    () => documentoEtiquetas([{ ...MUESTRA, inventario: sesion.inventario.id }], { tipo, diseno: { ...diseno, margen_sup: 0, margen_lat: 0 }, identidad: config.identidad, vista: true, ambito: "etq-sola" }),
    [JSON.stringify(diseno), config.identidad, tipo],
  );
  const [hojaRef, zoom] = useZoom(c.hoja.ancho, 0.6);
  return html`<${Ventana} titulo="Diseño de las etiquetas" alCerrar=${alCerrar} clase="ventana-ancha ventana-etq-diseno">
    <div class="etq-diseno">
      <div class="etq-diseno-campos">
        <p class="nota">El diseño es el mismo para DLTA y GSM. Las filas y columnas se calculan con lo que cabe en la hoja.</p>
        <div class="campo">
          <span>Plantilla</span>
          <${Lista}
            valor=${plantilla?.id ?? ""}
            alCambiar=${usarPlantilla}
            ariaLabel="Plantilla"
            placeholder="Personalizada"
            opciones=${PLANTILLAS.map((p) => ({ valor: p.id, etiqueta: p.nombre, detalle: p.detalle }))}
          />
        </div>
        <${Segmentos}
          etiqueta="Hoja"
          valor=${diseno.hoja}
          opciones=${Object.fromEntries(Object.entries(HOJAS).map(([k, h]) => [k, `${h.nombre} (${h.detalle})`]))}
          alCambiar=${(hoja) => fijar({ hoja })}
        />
        <div class="etq-medidas">
          ${CAMPOS_DISENO.map(
            ([clave, etiqueta]) => html`<label class="campo" key=${clave}>
              <span>${etiqueta} (mm)</span>
              <input
                value=${textos[clave]}
                onInput=${(e) => setTextos({ ...textos, [clave]: e.currentTarget.value })}
                onBlur=${() => medida(clave)}
                onKeyDown=${(e) => e.key === "Enter" && medida(clave)}
                placeholder="mm, cm o in (4in)"
              />
            </label>`,
          )}
          <label class="campo">
            <span>Letra (px)</span>
            <input
              type="number"
              min="5"
              max="40"
              step="0.5"
              value=${diseno.fuente}
              onChange=${(e) => {
                const fuente = Number(e.currentTarget.value);
                if (e.currentTarget.value !== "" && fuente >= 5 && fuente <= 40) fijar({ fuente });
                else e.currentTarget.value = String(diseno.fuente);
              }}
            />
          </label>
          <label class="casilla"><input type="checkbox" checked=${diseno.borde} onChange=${(e) => fijar({ borde: e.currentTarget.checked })} /> Imprimir el borde (quítalo en hojas precortadas)</label>
        </div>
        <p class=${c.porHoja ? "nota" : "alerta"}>
          ${c.porHoja ? `Caben ${c.columnas} × ${c.filas} = ${c.porHoja} por hoja.` : c.avisos.join(" ")} Medidas en mm; también acepta cm o pulgadas («4in»).
        </p>
        <${Boton} tamano="chico" tipo="texto" onClick=${() => usarPlantilla(PLANTILLAS[0].id)}>Volver al diseño estándar<//>
        <h3>Logos y texto de cada inventario</h3>
        <p class="nota">Cada etiqueta lleva los de su inventario. ${delVale === null ? "Leyendo los logos del vale…" : delVale.length ? "«Del vale…» ofrece los logos del libro de vales de este inventario." : "El libro de vales no tiene logos: súbelos de un archivo."}</p>
        ${INVENTARIOS.map((i) => html`<${IdentidadInventario} key=${i.id} inventario=${i.id} identidad=${config.identidad[i.id]} delVale=${delVale} />`)}
      </div>
      <figure class="etq-diseno-previa">
        <figcaption>Una etiqueta a tamaño real</figcaption>
        <style>${sola.css}</style>
        <div class="etq-previa etq-previa-sola" dangerouslySetInnerHTML=${{ __html: sola.html }}></div>
        <figcaption>La hoja ${c.hoja.nombre.toLowerCase()}</figcaption>
        <div ref=${hojaRef} class="etq-previa-marco">
          <style>${muestra.css}</style>
          <div class="etq-previa" style=${`zoom:${zoom}`} dangerouslySetInnerHTML=${{ __html: muestra.html }}></div>
        </div>
      </figure>
    </div>
  <//>`;
}

// ---------------------------------------------------------------- lista por imprimir

function FilaEtiqueta({ etiqueta, tipo, incluida, alIncluir, alEditar }) {
  const sesion = useSesion();
  const guardar = useGuardar();
  const [cantidad, setCantidad] = useState(String(etiqueta.cantidad));
  const fijarCantidad = () => {
    const limpia = et.etiquetaLimpia({ cantidad }).cantidad;
    setCantidad(String(limpia));
    if (limpia !== etiqueta.cantidad) guardar((e) => et.cambiarEtiqueta(e, tipo, etiqueta.id, { cantidad: limpia }));
  };
  const quitar = async () => {
    const quitadas = await guardar((e) => et.quitarEtiquetas(e, tipo, [etiqueta.id]));
    if (quitadas)
      sesion.avisar("info", `Se quitó ${etiqueta.codigo || etiqueta.nombre || "la etiqueta"} de la lista.`, 6000, {
        etiqueta: "Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => et.reponerEtiquetas(e, tipo, quitadas)),
      });
  };
  const origen = textoOrigen(etiqueta.origen, sesion.inventario.id);
  return html`<li class=${`etq-fila ${incluida ? "" : "etq-fuera"}`}>
    <input type="checkbox" checked=${incluida} onChange=${(e) => alIncluir(e.currentTarget.checked)} aria-label=${`Imprimir ${etiqueta.codigo}`} title="Imprimir esta" />
    <label class="etq-cantidad" title="Cuántas etiquetas">
      <input
        type="number"
        min="1"
        max=${et.MAXIMO_POR_PARTIDA}
        value=${cantidad}
        onInput=${(e) => setCantidad(e.currentTarget.value)}
        onBlur=${fijarCantidad}
        onKeyDown=${(e) => e.key === "Enter" && fijarCantidad()}
        aria-label=${`Etiquetas de ${etiqueta.codigo}`}
      />
      <small>×</small>
    </label>
    <div class="etq-fila-texto">
      <div><strong>${etiqueta.codigo || "S/C"}</strong> ${etiqueta.nombre || html`<span class="nota">sin nombre</span>`}</div>
      <div class="etq-fila-datos">
        <${PastillaInventario} id=${etiqueta.inventario} />
        ${tipo === "material"
          ? html`${etiqueta.dimension ? html`<${Pastilla} tono="lugar" titulo="Dimensión">${etiqueta.dimension}<//>` : null}
            ${etiqueta.np ? html`<${Pastilla} titulo="No. parte">NP ${etiqueta.np}<//>` : null}
            ${etiqueta.descripcion ? html`<${Pastilla} titulo="Descripción">${etiqueta.descripcion}<//>` : null}
            ${etiqueta.area ? html`<${Pastilla} titulo="Área">${etiqueta.area}<//>` : null}`
          : null}
        ${origen ? html`<span class="nota etq-origen">${origen}</span>` : null}
      </div>
    </div>
    <div class="etq-fila-acciones">
      <button type="button" class="boton boton-texto boton-chico" onClick=${alEditar} title="Editar">Editar</button>
      <button type="button" class="boton boton-texto boton-chico" onClick=${() => guardar((e) => et.duplicarEtiqueta(e, tipo, etiqueta.id))} title="Duplicar">Duplicar</button>
      <button type="button" class="boton-quitar-regla" onClick=${quitar} title="Quitar de la lista" aria-label=${`Quitar ${etiqueta.codigo} de la lista`}>×</button>
    </div>
  </li>`;
}

export function PaginaEtiquetas() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const guardar = useGuardar();
  const agregar = useAgregar();
  const [tipo, setTipoActual] = useState(tipoRecordado);
  const [ventana, setVentana] = useState(null); // inventario | entrada | manual | diseno | { editar } | { previa } | { entrada: id }
  const [fuera, setFuera] = useState(() => new Set()); // las que no se imprimen esta vez
  const setTipo = (t) => {
    setTipoActual(t);
    recordarTipo(t);
    setFuera(new Set());
  };
  const lista = et.etiquetasPorImprimir(estado, tipo);
  const incluidas = lista.filter((e) => !fuera.has(e.id));
  const total = et.totalEtiquetas(incluidas);
  // Las recientes sin etiquetas del abierto y del otro (que se lee sin abrirlo).
  const otroInventario = otrosInventarios(sesion.inventario.id)[0];
  const otro = useEstadoDe(otroInventario);
  const sinEtiquetas = useMemo(
    () => [
      ...et.entradasSinEtiquetas(estado, { limite: 5 }).map((vale) => ({ vale, inventario: sesion.inventario.id })),
      ...(otro.estado ? et.entradasSinEtiquetas(otro.estado, { limite: 5, registro: estado }).map((vale) => ({ vale, inventario: otroInventario })) : []),
    ],
    [estado, otro.estado],
  );
  const c = cuadricula(et.configEtiquetas(estado).diseno);
  const otras = et.etiquetasPorImprimir(estado, tipo === "material" ? "ax" : "material").length;
  const cerrar = () => setVentana(null);
  const importar = (archivo) =>
    sesion.tarea("Leyendo la lista…", async () => {
      const { material, ax } = et.leerListaGenerador(await archivo.text(), { inventario: sesion.inventario.id, archivo: archivo.name });
      const ids = await sesion.almacen.modificar((e) => ({ material: et.agregarEtiquetas(e, "material", material), ax: et.agregarEtiquetas(e, "ax", ax) }));
      const partes = [material.length ? `${partidasDe(material.length)} de material` : null, ax.length ? `${partidasDe(ax.length)} de código AX` : null].filter(Boolean);
      sesion.avisar("exito", `Se agregaron ${partes.join(" y ")} de ${archivo.name}. La condición del generador no se usa: el inventario es ${sesion.inventario.id} (se cambia en cada una).`, 8000, {
        etiqueta: "Deshacer",
        alHacer: () =>
          sesion.almacen.modificar((e) => {
            et.quitarEtiquetas(e, "material", ids.material);
            et.quitarEtiquetas(e, "ax", ids.ax);
          }),
      });
      if (!material.length && ax.length && tipo === "material") setTipo("ax");
    });
  const vaciar = async () => {
    if (!confirmar(`¿Quitar las ${partidasDe(lista.length)} de la lista de ${OPCIONES_TIPO[tipo]}?`)) return;
    const quitadas = await guardar((e) => et.quitarEtiquetas(e, tipo, lista.map((x) => x.id)));
    if (quitadas)
      sesion.avisar("info", "Se vació la lista.", 8000, { etiqueta: "Deshacer", alHacer: () => sesion.almacen.modificar((e) => et.reponerEtiquetas(e, tipo, quitadas)) });
  };
  const editar = ventana?.editar ? lista.find((e) => e.id === ventana.editar) : null;
  return html`
    <div class="etq-cabeza">
      <${Segmentos} etiqueta="Tipo de etiqueta" valor=${tipo} opciones=${OPCIONES_TIPO} alCambiar=${setTipo} />
      <p class="nota">
        ${tipo === "material" ? "Etiqueta completa: código, nombre, dimensión, NP, descripción, área e inventario." : "El código AX en grande con su nombre."}
        ${otras ? html` También hay ${partidasDe(otras)} en la lista de ${OPCIONES_TIPO[tipo === "material" ? "ax" : "material"]}.` : null}
      </p>
    </div>
    <div class="etq-fuentes" role="group" aria-label="Agregar etiquetas">
      <button type="button" class="etq-fuente" onClick=${() => setVentana("entrada")}>
        <${Icono} nombre="entrada" tam=${22} /><strong>De un vale de entrada</strong><small>Por su folio E-0005 o el de la base</small>
      </button>
      <button type="button" class="etq-fuente" onClick=${() => setVentana("inventario")}>
        <${Icono} nombre="inventario" tam=${22} /><strong>Del inventario</strong><small>Busca y marca partidas</small>
      </button>
      <button type="button" class="etq-fuente" onClick=${() => setVentana("manual")}>
        <${Icono} nombre="teclado" tam=${22} /><strong>A mano</strong><small>Con el nombre de AX al escribir el código</small>
      </button>
      <label class="etq-fuente">
        <${Icono} nombre="subir" tam=${22} /><strong>Lista del generador</strong><small>El .json exportado del teléfono</small>
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange=${(e) => {
            const archivo = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (archivo) importar(archivo);
          }}
        />
      </label>
    </div>
    ${sinEtiquetas.length
      ? html`<${Tarjeta} titulo="Entradas recientes sin etiquetas" clase="etq-sugeridas">
          <ul class="etq-entradas etq-entradas-fila">
            ${sinEtiquetas.map(
              ({ vale: v, inventario }) => html`<li key=${`${inventario}-${v.id}`}>
                <button type="button" class="etq-entrada" onClick=${() => setVentana({ entrada: v.id, inventario })}>
                  <${PastillaInventario} id=${inventario} />
                  <strong>${folioEntrada(v.folio)}</strong>
                  <span>${v.folio_externo ? `Vale ${v.folio_externo}` : "Sin folio de la base"}</span>
                  <span class="nota">${fmtFecha(v.fecha)} · ${partidasDe(v.lineas.length)}</span>
                </button>
              </li>`,
            )}
          </ul>
        <//>`
      : null}
    <${Tarjeta}
      titulo=${`Por imprimir · ${OPCIONES_TIPO[tipo]}`}
      acciones=${html`<${Boton} tamano="chico" onClick=${() => setVentana("diseno")}>Diseño y logos<//>
        ${lista.length ? html`<${Boton} tamano="chico" tipo="texto" onClick=${vaciar}>Vaciar<//>` : null}`}
    >
      <p class="nota etq-compartida">La lista es la misma en DLTA y GSM: agrega de los dos (también sin cambiar de inventario) e imprime junto.</p>
      ${lista.length
        ? html`<ul class="etq-lista">
            ${lista.map(
              (e) => html`<${FilaEtiqueta}
                key=${`${e.id}-${e.cantidad}`}
                etiqueta=${e}
                tipo=${tipo}
                incluida=${!fuera.has(e.id)}
                alIncluir=${(si) =>
                  setFuera((f) => {
                    const n = new Set(f);
                    if (si) n.delete(e.id);
                    else n.add(e.id);
                    return n;
                  })}
                alEditar=${() => setVentana({ editar: e.id })}
              />`,
            )}
          </ul>`
        : html`<p class="vacio">La lista está vacía. Agrega etiquetas desde un vale de entrada, del inventario, a mano o desde la lista del generador.</p>`}
      <div class="acciones-linea pie-editor">
        <span class="nota">
          ${lista.length ? `${partidasDe(incluidas.length)} · ${etiquetasDe(total)}${c.porHoja ? ` · ${Math.ceil(total / c.porHoja)} ${Math.ceil(total / c.porHoja) === 1 ? "hoja" : "hojas"} (${c.columnas} × ${c.filas})` : ""}` : ""}
          ${fuera.size ? ` · ${fuera.size} sin marcar no se imprimen` : ""}
        </span>
        <span class="espaciador"></span>
        <${Boton} tipo="primario" disabled=${!incluidas.length} onClick=${() => setVentana({ previa: incluidas.map((e) => e.id) })}>Vista previa e imprimir<//>
      </div>
    <//>
    ${ventana === "inventario" ? html`<${VentanaInventario} tipo=${tipo} alCerrar=${cerrar} />` : null}
    ${ventana === "entrada" ? html`<${EtiquetasDeEntrada} tipo=${tipo} alCerrar=${cerrar} />` : null}
    ${ventana?.entrada ? html`<${EtiquetasDeEntrada} valeId=${ventana.entrada} inventario=${ventana.inventario} tipo=${tipo} alCerrar=${cerrar} />` : null}
    ${ventana === "diseno" ? html`<${VentanaDiseno} tipo=${tipo} alCerrar=${cerrar} />` : null}
    ${ventana?.previa ? html`<${VistaPreviaEtiquetas} tipo=${tipo} ids=${ventana.previa} alCerrar=${cerrar} />` : null}
    ${ventana === "manual"
      ? html`<${EditorEtiqueta}
          tipo=${tipo}
          titulo=${`Etiqueta de ${OPCIONES_TIPO[tipo].toLowerCase()} a mano`}
          textoGuardar="Agregar a la lista"
          alGuardar=${async (datos) => {
            const ids = await agregar(tipo, [{ ...datos, origen: { tipo: "MANUAL" } }]);
            if (ids.length) cerrar();
          }}
          alCerrar=${cerrar}
        />`
      : null}
    ${editar
      ? html`<${EditorEtiqueta}
          tipo=${tipo}
          inicial=${editar}
          titulo="Editar etiqueta"
          textoGuardar="Guardar"
          alGuardar=${async (datos) => {
            const { cantidad, codigo, nombre, dimension, np, descripcion, area, inventario } = datos;
            const cambios = tipo === "ax" ? { cantidad, codigo, nombre, inventario } : { cantidad, codigo, nombre, dimension, np, descripcion, area, inventario };
            if (await guardar((e) => et.cambiarEtiqueta(e, tipo, editar.id, cambios))) cerrar();
          }}
          alCerrar=${cerrar}
        />`
      : null}
  `;
}
