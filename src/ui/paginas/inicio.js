import { useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { resumen } from "../../servicios/consultas.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { siguienteFolio } from "../../servicios/vales.js";
import { Boton, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { SubirSharePoint } from "./sharepoint.js";
import { leerDeCarpeta } from "../../almacen/archivos.js";
import { CARPETA_RESPALDOS } from "../sesion.js";
import { RespaldoReciente, restaurarConConfirmacion, useRespaldoReciente } from "./respaldos.js";

function Bienvenida() {
  const sesion = useSesion();
  const reciente = useRespaldoReciente(sesion);
  return html`
    ${reciente
      ? html`<${Tarjeta} titulo="Encontramos un respaldo en tu carpeta">
          <p>Si ya usabas la herramienta en otro navegador o equipo, restaura el más reciente y sigues donde te quedaste.</p>
          <${RespaldoReciente}
            respaldo=${reciente}
            alRestaurar=${async () =>
              restaurarConConfirmacion(sesion, await leerDeCarpeta(sesion.carpeta, CARPETA_RESPALDOS, reciente.nombre), reciente.nombre)}
          />
        <//>`
      : null}
    <${Tarjeta} titulo="Bienvenido">
      <p>
        La herramienta está <strong>vacía</strong>: no trae datos de nadie. Tus datos entran desde tus propios Excel y se
        quedan <strong>solo en este equipo</strong> (en el almacenamiento de Edge). Nada se envía a internet.
      </p>
      <ol class="pasos">
        <li>
          <strong>Elige una carpeta para respaldos</strong> (recomendado: <code>OneDrive\\ControlAlmacen</code>). Ahí
          se guardan respaldos diarios y los Excel exportados.
          <div class="acciones-linea">
            ${sesion.soportaCarpetas
              ? html`<${Boton} tipo=${sesion.carpeta ? "secundario" : "primario"} onClick=${() =>
                  sesion.tarea("Eligiendo carpeta…", () => sesion.elegirCarpeta())}>
                  ${sesion.carpeta ? `Carpeta: ${sesion.carpeta.name} (cambiar)` : "Elegir carpeta"}
                <//>`
              : html`<em>Este navegador no permite elegir carpeta; los archivos irán a Descargas.</em>`}
          </div>
        </li>
        <li>
          <strong>Primera carga:</strong> sube tu inventario (.xlsx) y tu libro de vales (.xlsm). Primero se hace un
          ensayo con reporte; nada se guarda hasta que lo confirmes.
          <div class="acciones-linea"><a class="boton boton-primario" href="#carga">Empezar primera carga</a></div>
        </li>
        <li>
          <strong>¿Ya tenías datos en otro equipo o navegador?</strong> Restaura un respaldo.
          <div class="acciones-linea"><a class="boton boton-secundario" href="#respaldos">Ir a respaldos</a></div>
        </li>
      </ol>
    <//>
  `;
}

export function EstadoAlmacenamiento() {
  const sesion = useSesion();
  const uso = sesion.uso;
  return html`<${Tarjeta} titulo="Dónde quedan tus datos">
    <ul class="lista-simple">
      <li>
        <strong>Datos de trabajo:</strong> almacenamiento local de este navegador, en este equipo.
        ${sesion.persistente === true
          ? html` <span class="ok">Protegidos contra limpieza automática.</span>`
          : sesion.persistente === false
            ? html` <span class="alerta">El navegador no confirmó la protección contra limpieza automática: mantén los respaldos al día.</span>`
            : null}
      </li>
      <li>
        <strong>Respaldos y exportaciones:</strong>
        ${sesion.carpeta
          ? html` carpeta <code>${sesion.carpeta.name}</code>
              ${sesion.permiso === "granted" ? html`<span class="ok"> (lista)</span>` : html`<span class="alerta"> (falta permiso)</span>`}`
          : html` carpeta Descargas (no has elegido carpeta).`}
      </li>
      ${uso?.usage
        ? html`<li><strong>Espacio usado:</strong> ${uso.usage < 1048576 ? `${Math.ceil(uso.usage / 1024)} KB` : `${(uso.usage / 1048576).toFixed(1)} MB`}</li>`
        : null}
      <li class="nota">
        Importante: si borras "datos de navegación / cookies y datos de sitios" en Edge, se borran también estos datos.
        Por eso existen los respaldos.
      </li>
    </ul>
  <//>`;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function saludo(ahora = new Date()) {
  const h = ahora.getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

/** Un acceso grande del inicio (tarjeta completa clicable). */
function Accion({ href, icono, titulo, detalle, tono = "", children = null }) {
  return html`<div class=${`bento-celda bento-accion ${tono}`}>
    <a class="accion-enlace" href=${href}>
      <span class="accion-icono"><${Icono} nombre=${icono} tam=${26} /></span>
      <strong>${titulo}</strong>
      <small>${detalle}</small>
    </a>
    ${children}
  </div>`;
}

export function PaginaInicio() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const datos = useMemo(() => (estado && !sesion.almacen.vacio ? resumen(estado) : null), [estado]);
  const [fechaReporte, setFechaReporte] = useState(hoyIso());
  if (!datos) return html`<${Bienvenida} />`;
  const hoy = hoyIso();
  const ahora = new Date();
  const entradasHoy = estado.vales.filter((v) => v.tipo === "ENTRADA" && v.estado === "EMITIDO" && v.fecha === hoy).length;
  const enCurso = estado.conteo_en_curso;
  const contados = enCurso ? Object.keys(enCurso.capturas ?? {}).length : 0;
  const alertas = [
    !sesion.usuario && html`<a href="#inicio" onClick=${(e) => { e.preventDefault(); document.querySelector(".lista-usuario .lista-boton")?.click(); }}>Elige quién está en turno</a>`,
    !sesion.respaldoDeHoy && (sesion.carpetaLista ? null : html`<a href="#respaldos">Sin respaldo de hoy</a>`),
    datos.por_ubicar && html`<a href="#pendientes">${datos.por_ubicar} renglón(es) por ubicar</a>`,
    datos.por_confirmar && html`<a href="#inventario">${datos.por_confirmar} artículo(s) por confirmar</a>`,
  ].filter(Boolean);
  return html`
    <div class="saludo">
      <div>
        <h2>${saludo(ahora)}${sesion.usuario ? `, ${sesion.usuario.split(" ")[0].charAt(0)}${sesion.usuario.split(" ")[0].slice(1).toLowerCase()}` : ""}</h2>
        <p class="nota">${DIAS[ahora.getDay()]} ${ahora.getDate()} de ${MESES[ahora.getMonth()]} · ${datos.vales_hoy} ${datos.vales_hoy === 1 ? "vale" : "vales"} y ${entradasHoy} ${entradasHoy === 1 ? "entrada" : "entradas"} hoy</p>
      </div>
      ${alertas.length ? html`<div class="alertas-inicio">${alertas.map((a) => html`<span class="chip-alerta">⚠ ${a}</span>`)}</div>` : null}
    </div>

    <div class="bento bento-inicio">
      <${Accion}
        href="#vales"
        icono="salida"
        titulo="Crear un vale"
        tono="accion-principal"
        detalle=${datos.borradores ? `${datos.borradores} en borrador · siguiente folio ${siguienteFolio(estado)}` : `Siguiente folio ${siguienteFolio(estado)}`}
      />
      <${Accion}
        href="#entradas"
        icono="entrada"
        titulo="Agregar material recibido"
        detalle=${datos.borradores_entrada ? `${datos.borradores_entrada} en borrador · ${folioEntrada(siguienteFolio(estado, "ENTRADA"))}` : `Siguiente: ${folioEntrada(siguienteFolio(estado, "ENTRADA"))}`}
      />
      <div class="bento-celda bento-accion">
        <a class="accion-enlace" href=${`#reporte/${fechaReporte}`}>
          <span class="accion-icono"><${Icono} nombre="reporte" tam=${26} /></span>
          <strong>Crear reporte diario</strong>
          <small>Imágenes de los vales del día y lo que falta subir</small>
        </a>
        <div class="accion-fecha">
          <input type="date" value=${fechaReporte} max=${hoy} onChange=${(e) => setFechaReporte(e.currentTarget.value || hoy)} aria-label="Fecha del reporte" />
          <a class="boton boton-secundario boton-chico" href=${`#reporte/${fechaReporte}`}>Abrir</a>
        </div>
      </div>
      <${Accion}
        href="#conteo"
        icono="conteo"
        titulo="Conteo físico"
        tono=${enCurso ? "accion-en-curso" : ""}
        detalle=${enCurso ? `En captura · ${contados} renglones capturados` : "Todo el inventario o algunos contenedores"}
      />

      <section class="bento-celda bento-doble">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="nube" /></span>
          <h2>Subir al SharePoint</h2>
        </header>
        <${SubirSharePoint} compacto=${true} />
      </section>

      <section class="bento-celda">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="conteo" /></span>
          <h2>Último conteo</h2>
        </header>
        <p class="dato-grande">${datos.conteo_fecha ? fmtFecha(datos.conteo_fecha) : "—"}</p>
        <p class="nota">
          ${datos.conteo_alcance === "PARCIAL" ? "Parcial. " : "Total. "}
          ${datos.conteos > 1 ? "Cada renglón descuenta desde su propio conteo." : `Descuenta desde el folio ${(datos.conteo_folio ?? 0) + 1}.`}
        </p>
        <a class="enlace-flecha" href="#conteo">Ver conteos →</a>
      </section>

      <section class="bento-celda">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="inventario" /></span>
          <h2>Inventario</h2>
        </header>
        <p class="dato-grande">${num(datos.existencias)} <small>renglones</small></p>
        <p class="nota">${datos.agotados ? html`<a href="#inventario">${num(datos.agotados)} en 0 o menos</a>` : "Ninguno en 0."} · ${datos.ubicaciones} contenedores</p>
        <a class="enlace-flecha" href="#inventario">Ver inventario →</a>
      </section>

      <section class="bento-celda bento-completa">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="ayuda" /></span>
          <h2>Uso diario</h2>
        </header>
        <ol class="pasos pasos-columnas">
          <li><strong>Elige quién está en turno</strong> (arriba a la derecha).</li>
          <li><strong><a href="#vales">Haz los vales</a>:</strong> área, quién recibe y partidas (código → clave → cantidad). El folio se asigna solo; imprímelo para las firmas.</li>
          <li><strong>Cuando llegue material</strong>, regístralo en <a href="#entradas">Vales de entrada</a> (puedes capturarlo desde la foto con Copilot).</li>
          <li><strong>Al final del día</strong>, <a href=${`#reporte/${hoy}`}>crea el reporte diario</a>: descarga las imágenes, sube el libro al SharePoint y márcalo con "Ya lo subí".</li>
        </ol>
      </section>
    </div>
  `;
}
