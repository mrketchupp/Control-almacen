import { useEffect, useMemo, useState } from "preact/hooks";
import { hoyIso, fmtFechaHora } from "../nucleo/fechas.js";
import { agregarAlmacenista, almacenistas, fijarUsuarioEnTurno, lineasPorUbicar } from "../servicios/consultas.js";
import { Boton, ContextoSesion, Lista, useSesion } from "./componentes.js";
import { html } from "./html.js";
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
import { PaginaVale } from "./paginas/vale.js";
import { PaginaValesSalida } from "./paginas/vales.js";
import { valesPorEnviar } from "../servicios/vales.js";

const PAGINAS = {
  inicio: { titulo: "Inicio", componente: PaginaInicio },
  carga: { titulo: "Primera carga", componente: PaginaPrimeraCarga, soloVacia: true },
  vales: { titulo: "Vales de salida", componente: PaginaValesSalida, requiereDatos: true },
  historial: { titulo: "Historial de vales", componente: PaginaHistorial, requiereDatos: true },
  vale: { titulo: "Vale", componente: PaginaVale, requiereDatos: true, oculta: true },
  inventario: { titulo: "Inventario", componente: PaginaInventario, requiereDatos: true },
  pendientes: { titulo: "Pendientes", componente: PaginaPendientes, requiereDatos: true },
  exportar: { titulo: "Exportar y enviar", componente: PaginaExportar, requiereDatos: true },
  areas: { titulo: "Áreas y personas", componente: PaginaAreas, requiereDatos: true },
  ajustes: { titulo: "Ajustes", componente: PaginaAjustes, requiereDatos: true },
  respaldos: { titulo: "Respaldos", componente: PaginaRespaldos },
  ayuda: { titulo: "Ayuda", componente: PaginaAyuda },
};

function paginaDeHash(hash = location.hash) {
  const clave = hash.replace(/^#\/?/, "").split("/")[0];
  return PAGINAS[clave] ? clave : "inicio";
}

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
        <button type="button" class="cerrar" aria-label="Cerrar" onClick=${() => sesion.quitarAviso(a.id)}>×</button>
      </div>`,
    )}
  </div>`;
}

function Navegacion({ actual }) {
  const sesion = useSesion();
  const vacia = sesion.almacen.vacio;
  const pendientes = useMemo(() => (sesion.estado && !vacia ? lineasPorUbicar(sesion.estado).length : 0), [sesion.estado]);
  const porEnviar = useMemo(() => (sesion.estado && !vacia ? valesPorEnviar(sesion.estado).length : 0), [sesion.estado]);
  const borradores = sesion.estado?.borradores?.length ?? 0;
  const enlaces = Object.entries(PAGINAS).filter(([, p]) => !p.oculta && (vacia ? !p.requiereDatos : !p.soloVacia));
  const insignia = { pendientes, exportar: porEnviar, vales: borradores };
  return html`<nav class="navegacion" aria-label="Secciones">
    ${enlaces.map(
      ([clave, p]) => html`<a href=${`#${clave}`} class=${clave === actual ? "activo" : ""} aria-current=${clave === actual ? "page" : null}>
        ${p.titulo}
        ${insignia[clave] ? html`<span class=${`contador ${clave === "vales" ? "contador-suave" : ""}`} title=${clave === "vales" ? "Borradores en captura" : clave === "exportar" ? "Vales por enviar a la base" : "Renglones por ubicar"}>${insignia[clave]}</span>` : null}
      </a>`,
    )}
  </nav>`;
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
  const pagina = paginaDeHash(ruta);
  useEffect(() => {
    const alCambiar = () => {
      setRuta(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  let clave = pagina;
  const definicion = PAGINAS[clave];
  const activa = clave === "vale" ? "historial" : clave;
  if (definicion.requiereDatos && sesion.almacen.vacio) clave = "inicio";
  if (definicion.soloVacia && !sesion.almacen.vacio) clave = "inicio";
  const Componente = PAGINAS[clave].componente;
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
      <${Navegacion} actual=${activa} />
      <main class="contenido">
        ${clave === "vale" ? null : html`<h1>${PAGINAS[clave].titulo}</h1>`}
        <${Componente} key=${clave === "vale" ? ruta : clave} />
      </main>
    </div>
    ${sesion.ocupado ? html`<div class="ocupado" role="status"><div class="giro"></div>${sesion.ocupado}</div>` : null}
    <${Avisos} />
  </div>`;
}

export function App({ sesion }) {
  return html`<${ContextoSesion.Provider} value=${sesion}><${Marco} /><//>`;
}
