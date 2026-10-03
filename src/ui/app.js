import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { hoyIso, fmtFechaHora } from "../nucleo/fechas.js";
import { agregarAlmacenista, almacenistas, fijarUsuarioEnTurno, lineasPorUbicar } from "../servicios/consultas.js";
import { Boton, ContextoSesion, Lista, Ventana, useSesion } from "./componentes.js";
import { html } from "./html.js";
import { Icono } from "./iconos.js";
import { PaginaAyuda } from "./paginas/ayuda.js";
import { PaginaExportar } from "./paginas/exportar.js";
import { PaginaHistorial } from "./paginas/historial.js";
import { PaginaInicio } from "./paginas/inicio.js";
import { PaginaInventario } from "./paginas/inventario.js";
import { PaginaPendientes } from "./paginas/pendientes.js";
import { PaginaPrimeraCarga } from "./paginas/primeraCarga.js";
import { PaginaRespaldos } from "./paginas/respaldos.js";
import { PaginaAjustes } from "./paginas/ajustes.js";
import { PaginaAreas } from "./paginas/areas.js";
import { PaginaConteo } from "./paginas/conteo.js";
import { PaginaEntrada } from "./paginas/entrada.js";
import { PaginaValesEntrada } from "./paginas/entradas.js";
import { PaginaReporte } from "./paginas/reporte.js";
import { PaginaVale } from "./paginas/vale.js";
import { PaginaValesSalida } from "./paginas/vales.js";
import { valesPorEnviar } from "../servicios/vales.js";
import { personalizacion } from "../servicios/preferencias.js";
import { aplicarPersonalizacion } from "./tema.js";

// grupo "mas": se abren en la vista "Ajustes y más" (en primer plano, sobre la página en la que
// estabas) para que el menú sea corto.
const PAGINAS = {
  inicio: { titulo: "Inicio", componente: PaginaInicio, icono: "inicio" },
  carga: { titulo: "Primera carga", componente: PaginaPrimeraCarga, soloVacia: true, icono: "carga" },
  vales: { titulo: "Vales de salida", componente: PaginaValesSalida, requiereDatos: true, icono: "salida" },
  entradas: { titulo: "Vales de entrada", componente: PaginaValesEntrada, requiereDatos: true, icono: "entrada" },
  historial: { titulo: "Historial de vales", componente: PaginaHistorial, requiereDatos: true, icono: "historial" },
  vale: { titulo: "Vale", componente: PaginaVale, requiereDatos: true, oculta: true },
  entrada: { titulo: "Entrada", componente: PaginaEntrada, requiereDatos: true, oculta: true },
  inventario: { titulo: "Inventario", componente: PaginaInventario, requiereDatos: true, icono: "inventario" },
  conteo: { titulo: "Conteo físico", componente: PaginaConteo, requiereDatos: true, icono: "conteo" },
  reporte: { titulo: "Reporte diario", componente: PaginaReporte, requiereDatos: true, oculta: true },
  pendientes: { titulo: "Pendientes", componente: PaginaPendientes, requiereDatos: true, icono: "pendientes", soloConAviso: true },
  exportar: { titulo: "Exportar y enviar", componente: PaginaExportar, requiereDatos: true, grupo: "mas", icono: "exportar", detalle: "Libros de Excel y SharePoint" },
  areas: { titulo: "Áreas y personas", componente: PaginaAreas, requiereDatos: true, grupo: "mas", icono: "personas", detalle: "Plantillas del vale y personal" },
  ajustes: { titulo: "Ajustes", componente: PaginaAjustes, requiereDatos: true, grupo: "mas", icono: "ajustes", detalle: "Captura y tu pantalla de vales" },
  respaldos: { titulo: "Respaldos", componente: PaginaRespaldos, grupo: "mas", icono: "respaldos", detalle: "Copias en tu carpeta de OneDrive" },
  ayuda: { titulo: "Ayuda", componente: PaginaAyuda, grupo: "mas", icono: "ayuda", detalle: "Preguntas y dónde quedan los datos" },
};

function paginaDeHash(hash = location.hash) {
  const clave = hash.replace(/^#\/?/, "").split("/")[0];
  return PAGINAS[clave] ? clave : "inicio";
}

const esDeMas = (hash) => PAGINAS[paginaDeHash(hash)].grupo === "mas";

export function irA(pagina) {
  location.hash = `#${pagina}`;
}

function SelectorUsuario() {
  const sesion = useSesion();
  const estado = sesion.estado;
  if (!estado) return null;
  const actual = sesion.usuario;
  const opciones = almacenistas(estado);
  if (actual && !opciones.includes(actual)) opciones.unshift(actual);
  const cambiar = async (valor) => {
    if (valor === "__nuevo__") {
      const nombre = (window.prompt("Nombre del almacenista (como firma los vales):") || "").trim().toUpperCase();
      if (!nombre) return;
      await sesion.tarea("Guardando…", () =>
        sesion.almacen.modificar((e) => {
          agregarAlmacenista(e, nombre);
          fijarUsuarioEnTurno(e, nombre);
        }),
      );
      return;
    }
    await sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => fijarUsuarioEnTurno(e, valor || null)));
  };
  return html`<label class="usuario">
    <span>En turno</span>
    <${Lista}
      clase="lista-usuario"
      valor=${actual || ""}
      alCambiar=${cambiar}
      ariaLabel="Almacenista en turno"
      placeholder="— Elige —"
      opciones=${[...opciones.map((n) => ({ valor: n, etiqueta: n })), { valor: "__nuevo__", etiqueta: "＋ Agregar almacenista…" }]}
    />
  </label>`;
}

function EstadoGuardado() {
  const sesion = useSesion();
  if (!sesion.estado) return null;
  const ultimo = sesion.ultimoRespaldo;
  let tono = "ok";
  let texto = ultimo ? `Respaldo: ${fmtFechaHora(ultimo.fecha_hora)}` : "Sin respaldos";
  if (!ultimo || ultimo.fecha_hora.slice(0, 10) !== hoyIso()) tono = "alerta";
  if (sesion.carpeta && sesion.permiso !== "granted") {
    tono = "alerta";
    texto = "Carpeta de respaldos sin permiso";
  }
  return html`<a class=${`estado-guardado estado-${tono}`} href="#respaldos" title="Ver respaldos">
    <span class="punto"></span>${texto}
  </a>`;
}

function Avisos() {
  const sesion = useSesion();
  return html`<div class="avisos" aria-live="polite">
    ${sesion.avisos.map(
      (a) => html`<div key=${a.id} class=${`toast toast-${a.tipo}`}>
        <span>${a.texto}</span>
        ${a.accion
          ? html`<button
              type="button"
              class="boton boton-secundario boton-chico toast-accion"
              onClick=${() => {
                sesion.quitarAviso(a.id);
                sesion.tarea("Recuperando…", () => a.accion.alHacer());
              }}
            >
              ${a.accion.etiqueta}
            </button>`
          : null}
        <button type="button" class="cerrar" aria-label="Cerrar" onClick=${() => sesion.quitarAviso(a.id)}>×</button>
      </div>`,
    )}
  </div>`;
}

function Insignia({ clave, valor, titulos }) {
  if (!valor) return null;
  const suaves = new Set(["vales", "entradas", "conteo"]);
  return html`<span class=${`contador ${suaves.has(clave) ? "contador-suave" : ""}`} title=${titulos[clave]}>${valor}</span>`;
}

// Última sección abierta de "Ajustes y más" (al volver a abrir, aparece esa).
let ultimaSeccion = null;

/** Botón "Ajustes y más": abre la vista en primer plano. */
function BotonMas({ enlaces, abierta, insignia }) {
  const avisos = enlaces.reduce((t, [clave]) => t + (Number(insignia[clave]) || 0), 0);
  const destino = enlaces.some(([clave]) => clave === ultimaSeccion) ? ultimaSeccion : enlaces[0]?.[0];
  return html`<div class="nav-mas">
    <a class=${`nav-boton-mas ${abierta ? "activo" : ""}`} href=${`#${destino}`} aria-haspopup="dialog" aria-expanded=${abierta}>
      <${Icono} nombre="ajustes" />
      <span class="nav-texto">Ajustes y más</span>
      ${avisos ? html`<span class="contador" title="Hay pendientes adentro">${avisos}</span>` : null}
    </a>
  </div>`;
}

/** "Ajustes y más" en primer plano: secciones a la izquierda y su contenido a la derecha. */
function VistaMas({ seccion, enlaces, insignia, titulos, alCerrar }) {
  const sesion = useSesion();
  const pagina = PAGINAS[seccion];
  const Componente = pagina.componente;
  ultimaSeccion = seccion;
  return html`<${Ventana}
    clase="ventana-mas"
    etiqueta="Ajustes y más"
    alCerrar=${alCerrar}
    cabeza=${html`<div class="mas-cabeza">
      <span class="logo-mini" aria-hidden="true">▦</span>
      <span>
        <strong>Ajustes y más</strong>
        <small>${sesion.usuario ? `En turno: ${sesion.usuario}` : "Nadie en turno"}</small>
      </span>
    </div>`}
  >
    <div class="mas-cuerpo">
      <nav class="mas-secciones" aria-label="Secciones">
        ${enlaces.map(
          ([clave, p]) => html`<a href=${`#${clave}`} class=${`mas-item ${clave === seccion ? "activo" : ""}`} aria-current=${clave === seccion ? "page" : null}>
            <${Icono} nombre=${p.icono} tam=${20} />
            <span class="menu-texto"><strong>${p.titulo}</strong>${p.detalle ? html`<small>${p.detalle}</small>` : null}</span>
            <${Insignia} clave=${clave} valor=${insignia[clave]} titulos=${titulos} />
          </a>`,
        )}
      </nav>
      <section class="mas-contenido" key=${seccion} aria-label=${pagina.titulo}>
        <header class="mas-contenido-cabeza">
          <h2>${pagina.titulo}</h2>
          ${pagina.detalle ? html`<p class="nota">${pagina.detalle}</p>` : null}
        </header>
        <${Componente} />
      </section>
    </div>
  <//>`;
}

/** Enlaces del menú y sus insignias (lo comparten la barra lateral y "Ajustes y más"). */
function useEnlaces(actual) {
  const sesion = useSesion();
  const vacia = sesion.almacen.vacio;
  const pendientes = useMemo(() => (sesion.estado && !vacia ? lineasPorUbicar(sesion.estado).length : 0), [sesion.estado]);
  const porEnviar = useMemo(() => (sesion.estado && !vacia ? valesPorEnviar(sesion.estado).length : 0), [sesion.estado]);
  const borradores = sesion.estado?.borradores?.length ?? 0;
  const borradoresEntrada = sesion.estado?.borradores_entrada?.length ?? 0;
  const enlaces = Object.entries(PAGINAS).filter(([, p]) => !p.oculta && (vacia ? !p.requiereDatos : !p.soloVacia));
  const insignia = { pendientes, exportar: porEnviar, vales: borradores, entradas: borradoresEntrada, conteo: sesion.estado?.conteo_en_curso ? "•" : 0 };
  const titulos = { vales: "Borradores en captura", entradas: "Entradas en captura", conteo: "Conteo en captura", exportar: "Vales por subir al SharePoint", pendientes: "Renglones por ubicar" };
  const principales = enlaces.filter(([clave, p]) => p.grupo !== "mas" && (!p.soloConAviso || insignia[clave] || clave === actual));
  const mas = enlaces.filter(([, p]) => p.grupo === "mas");
  return { principales, mas, insignia, titulos };
}

function Navegacion({ actual, masAbierta }) {
  const { principales, mas, insignia, titulos } = useEnlaces(actual);
  return html`<nav class="navegacion" aria-label="Secciones">
    <div class="nav-principal">
      ${principales.map(
        ([clave, p]) => html`<a href=${`#${clave}`} class=${clave === actual ? "activo" : ""} aria-current=${clave === actual ? "page" : null}>
          <${Icono} nombre=${p.icono} />
          <span class="nav-texto">${p.titulo}</span>
          <${Insignia} clave=${clave} valor=${insignia[clave]} titulos=${titulos} />
        </a>`,
      )}
    </div>
    <${BotonMas} enlaces=${mas} abierta=${masAbierta} insignia=${insignia} />
  </nav>`;
}

/** La vista "Ajustes y más" con sus enlaces. */
function AjustesYMas({ seccion, alCerrar }) {
  const { mas, insignia, titulos } = useEnlaces(seccion);
  return html`<${VistaMas} seccion=${seccion} enlaces=${mas} insignia=${insignia} titulos=${titulos} alCerrar=${alCerrar} />`;
}

function BannerPermiso() {
  const sesion = useSesion();
  if (!sesion.carpeta || sesion.permiso === "granted" || sesion.almacen.vacio) return null;
  return html`<div class="banner">
    <span>Para respaldar en <strong>${sesion.carpeta.name}</strong>, el navegador pide confirmar el permiso en cada sesión.</span>
    <${Boton} tipo="primario" onClick=${() => sesion.tarea("Pidiendo permiso…", () => sesion.activarCarpeta())}>Permitir<//>
  </div>`;
}

function Marco() {
  const sesion = useSesion();
  const [ruta, setRuta] = useState(location.hash);
  const gusto = personalizacion(sesion.estado, sesion.usuario);
  useEffect(() => aplicarPersonalizacion(gusto), [gusto.tema, gusto.avisos, gusto.animaciones]);
  // Página de fondo: la última que no es de "Ajustes y más" (esa se abre encima).
  const fondo = useRef(esDeMas(location.hash) ? "#inicio" : location.hash);
  if (!esDeMas(ruta)) fondo.current = ruta;
  useEffect(() => {
    const alCambiar = () => {
      const nueva = location.hash;
      if (!esDeMas(nueva) && nueva !== fondo.current) window.scrollTo(0, 0);
      setRuta(nueva);
    };
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  const rutaFondo = esDeMas(ruta) ? fondo.current : ruta;
  let clave = paginaDeHash(rutaFondo);
  const definicion = PAGINAS[clave];
  const activa = clave === "vale" || clave === "entrada" ? "historial" : clave === "reporte" ? "inicio" : clave;
  if (definicion.requiereDatos && sesion.almacen.vacio) clave = "inicio";
  if (definicion.soloVacia && !sesion.almacen.vacio) clave = "inicio";
  const Componente = PAGINAS[clave].componente;
  let seccion = esDeMas(ruta) ? paginaDeHash(ruta) : null;
  if (seccion && PAGINAS[seccion].requiereDatos && sesion.almacen.vacio) seccion = null;
  const cerrarMas = () => {
    location.hash = fondo.current || "#inicio";
  };
  return html`<div class="marco">
    <header class="cabecera">
      <a class="marca" href="#inicio">
        <span class="logo" aria-hidden="true">▦</span>
        <span><strong>Control de Almacén</strong><small>RIG 91 · datos en este equipo</small></span>
      </a>
      <div class="cabecera-derecha">
        <${EstadoGuardado} />
        <${SelectorUsuario} />
      </div>
    </header>
    <${BannerPermiso} />
    <div class="cuerpo">
      <${Navegacion} actual=${activa} masAbierta=${Boolean(seccion)} />
      <main class="contenido" key=${clave}>
        ${["vale", "entrada", "inicio"].includes(clave) && !(clave === "inicio" && sesion.almacen.vacio) ? null : html`<h1>${PAGINAS[clave].titulo}</h1>`}
        <${Componente} key=${["vale", "entrada", "reporte"].includes(clave) ? rutaFondo : clave} />
      </main>
    </div>
    ${seccion ? html`<${AjustesYMas} seccion=${seccion} alCerrar=${cerrarMas} />` : null}
    ${sesion.ocupado ? html`<div class="ocupado" role="status"><div class="giro"></div>${sesion.ocupado}</div>` : null}
    <${Avisos} />
  </div>`;
}

export function App({ sesion }) {
  return html`<${ContextoSesion.Provider} value=${sesion}><${Marco} /><//>`;
}
