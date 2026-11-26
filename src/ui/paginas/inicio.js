import { useEffect, useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { fijarAjuste } from "../../servicios/catalogos.js";
import { resumen } from "../../servicios/consultas.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { siguienteFolio } from "../../servicios/vales.js";
import { Bento, Boton, ElegirArchivo, Tarjeta, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { SubirSharePoint } from "./sharepoint.js";
import { SIN_RESPUESTA, leerArchivoSubido, leerDeCarpeta, textoSinRespuesta } from "../../almacen/archivos.js";
import { CARPETA_RESPALDOS } from "../sesion.js";
import { RespaldoReciente, restaurarConConfirmacion, useRespaldoReciente } from "./respaldos.js";
import { ZonaSoltar } from "./carpetas.js";

/** El camino de la bienvenida que se abre desde el hash (`#inicio/cero`, `#inicio/respaldo`): Regresar de la carga. */
const caminoDelHash = () => {
  const camino = location.hash.replace(/^#\/?/, "").split("/")[1];
  return camino === "cero" || camino === "respaldo" ? camino : null;
};

/**
 * Inicio sin datos (Ronda 35, pedido del usuario): poco texto y dos caminos grandes — empezar desde cero (la carpeta
 * de trabajo y luego la primera carga) o seguir desde un respaldo —; cada uno sigue paso a paso con Continuar y Regresar.
 */
function Bienvenida() {
  const sesion = useSesion();
  const [camino, setCamino] = useState(caminoDelHash);
  if (camino) return html`<${CarpetaDeTrabajo} camino=${camino} alRegresar=${() => setCamino(null)} />`;
  return html`<div class="bienvenida">
    <header class="bienvenida-cabeza">
      <h2>Bienvenido</h2>
      <p>Inventario ${sesion.inventario.id} · ¿cómo quieres empezar?</p>
    </header>
    <div class="bienvenida-caminos">
      <button type="button" class="camino camino-principal" onClick=${() => setCamino("cero")}>
        <span class="camino-icono" aria-hidden="true"><${Icono} nombre="carga" tam=${30} /></span>
        <strong>Empezar desde cero</strong>
        <span>Con tu inventario y tu libro de vales de Excel.</span>
      </button>
      <button type="button" class="camino" onClick=${() => setCamino("respaldo")}>
        <span class="camino-icono" aria-hidden="true"><${Icono} nombre="respaldos" tam=${30} /></span>
        <strong>Seguir desde un respaldo</strong>
        <span>Si ya trabajabas con la herramienta en otro equipo o navegador.</span>
      </button>
    </div>
  </div>`;
}

/** «1 · Carpeta de trabajo  2 · Primera carga» (o «2 · Restaurar»): dónde va, como en la primera carga. */
export function PasosBienvenida({ camino, actual }) {
  const pasos = camino === "respaldo" ? ["Carpeta de trabajo", "Restaurar"] : ["Carpeta de trabajo", "Primera carga"];
  return html`<ol class="carga-progreso pasos-bienvenida" aria-label="Pasos">
    ${pasos.map((nombre, i) => html`<li key=${nombre} class=${i + 1 < actual ? "completo" : i + 1 === actual ? "actual" : ""}>${i + 1}. ${nombre}</li>`)}
  </ol>`;
}

/**
 * Elegir la carpeta de trabajo (donde quedan los respaldos y los Excel exportados), con el explorador o arrastrándola.
 * Desde cero: Continuar lleva a la primera carga. Desde un respaldo: con la carpeta se ve su respaldo más reciente
 * para restaurarlo, o se elige un .zip de cualquier lugar.
 */
function CarpetaDeTrabajo({ camino, alRegresar }) {
  const sesion = useSesion();
  const reciente = useRespaldoReciente(sesion);
  const [nota, setNota] = useState(null);
  const lista = sesion.carpeta && sesion.permiso === "granted";
  const desdeRespaldo = camino === "respaldo";
  const elegir = () =>
    sesion.tarea("Eligiendo carpeta…", async () => {
      try {
        await sesion.elegirCarpeta();
        setNota(null);
      } catch (error) {
        if (error?.name !== "AbortError") throw error;
        setNota("¿La elegiste y no pasó nada? Arrástrala desde el Explorador de Windows al recuadro punteado.");
      }
    });
  const soltar = (promesa) =>
    sesion.tarea("Usando la carpeta…", async () => {
      await sesion.fijarCarpeta(await promesa);
      setNota(null);
    });
  const restaurarReciente = async () => restaurarConConfirmacion(sesion, await leerDeCarpeta(sesion.carpeta, CARPETA_RESPALDOS, reciente.nombre), reciente.nombre);
  return html`<div class="bienvenida paso-bienvenida">
    <${PasosBienvenida} camino=${camino} actual=${desdeRespaldo && lista ? 2 : 1} />
    <section class="tarjeta paso-bienvenida-cuerpo" aria-labelledby="t-carpeta">
      <span class="camino-icono" aria-hidden="true"><${Icono} nombre="carpeta" tam=${30} /></span>
      <h2 id="t-carpeta">${desdeRespaldo ? "¿Dónde están tus respaldos?" : "Elige tu carpeta de trabajo"}</h2>
      <p class="nota">
        ${desdeRespaldo
          ? "La carpeta de trabajo que usabas (por ejemplo, OneDrive › ControlAlmacen)."
          : "Ahí se guardan los respaldos y los Excel que exportes (por ejemplo, OneDrive › ControlAlmacen)."}
      </p>
      ${sesion.soportaCarpetas
        ? html`<${ZonaSoltar} clase="soltar-carpeta" tipo="directory" etiqueta="carpeta de trabajo" alSoltar=${soltar}>
            <${Boton} tipo=${sesion.carpeta ? "secundario" : "primario"} tamano="grande" onClick=${elegir}>
              ${sesion.carpeta ? `Carpeta: ${sesion.carpeta.name} · cambiar` : "Elegir carpeta"}
            <//>
            <span class="nota">o arrástrala aquí desde el Explorador</span>
          <//>`
        : html`<p class="aviso aviso-info">Este navegador guardará los archivos en Descargas.</p>`}
      ${nota ? html`<p class="nota nota-pendiente">${nota}</p>` : null}
      ${sesion.carpeta && sesion.permiso !== "granted"
        ? html`<${Boton} tipo="primario" onClick=${() => sesion.tarea("Pidiendo permiso…", () => sesion.activarCarpeta())}>Permitir usar «${sesion.carpeta.name}»<//>`
        : null}
      ${sesion.carpeta && sesion.permiso === SIN_RESPUESTA ? html`<p class="nota nota-pendiente">${textoSinRespuesta(sesion.carpeta.name)}</p>` : null}
      ${lista && reciente
        ? html`<div class="bienvenida-respaldo">
            ${desdeRespaldo ? null : html`<p class="nota">En esta carpeta ya hay un respaldo: puedes seguir desde ahí.</p>`}
            <${RespaldoReciente} respaldo=${reciente} alRestaurar=${restaurarReciente} />
          </div>`
        : null}
      ${desdeRespaldo && lista && !reciente ? html`<p class="nota">En esta carpeta no hay respaldos de ${sesion.inventario.id}.</p>` : null}
      ${desdeRespaldo
        ? html`<div class="acciones-linea">
            <${ElegirArchivo} etiqueta="Elegir un respaldo (.zip)…" acepta=".zip"
              alElegir=${async (archivo) => restaurarConConfirmacion(sesion, await leerArchivoSubido(archivo), archivo.name)} />
          </div>`
        : null}
    </section>
    <div class="carga-navegacion">
      <${Boton} tamano="grande" onClick=${alRegresar}>← Regresar<//>
      ${desdeRespaldo
        ? null
        : html`<a class=${`boton boton-primario boton-grande ${sesion.carpeta || !sesion.soportaCarpetas ? "" : "deshabilitado"}`}
            href="#carga" aria-disabled=${sesion.carpeta || !sesion.soportaCarpetas ? undefined : "true"}
            onClick=${(e) => !(sesion.carpeta || !sesion.soportaCarpetas) && e.preventDefault()}>Continuar →</a>`}
    </div>
  </div>`;
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

/** Etapa de perforación actual (va en las observaciones de los vales internos); se cambia aquí mismo. */
function BentoEtapa() {
  const sesion = useSesion();
  const actual = sesion.estado.config?.etapa_perforacion ?? "";
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(actual);
  useEffect(() => setValor(actual), [actual]);
  useEffect(() => {
    if (!editando) return;
    const campo = document.getElementById("etapa-inicio");
    campo?.focus();
    campo?.select();
  }, [editando]);
  const cancelar = () => {
    setValor(actual);
    setEditando(false);
  };
  const guardar = () =>
    sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => fijarAjuste(e, "etapa_perforacion", valor.trim(), sesion.usuario));
      setEditando(false);
      sesion.avisar("exito", "Etapa de perforación guardada: se usará en los vales nuevos de DLTA y GSM.");
    });
  return html`<section class="bento-celda bento-etapa">
    <header class="bento-cabeza">
      <span class="cabeza-icono"><${Icono} nombre="etapa" /></span>
      <h2>Etapa de perforación</h2>
    </header>
    ${editando
      ? html`<div class="etapa-editar">
          <input
            id="etapa-inicio"
            value=${valor}
            onInput=${(e) => setValor(e.currentTarget.value)}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && valor.trim() !== actual) guardar();
              if (e.key === "Escape") cancelar();
            }}
            placeholder='Ej. 12 1/4"'
            aria-label="Etapa de perforación actual"
          />
          <div class="acciones-linea">
            <${Boton} tipo="primario" tamano="chico" disabled=${valor.trim() === actual} onClick=${guardar}>Guardar<//>
            <${Boton} tipo="texto" tamano="chico" onClick=${cancelar}>Cancelar<//>
          </div>
        </div>`
      : html`<p class="dato-grande dato-etapa" title=${actual}>${actual || "—"}</p>`}
    <p class="nota">Va en las observaciones de los vales internos; cada vale nuevo la trae puesta. Es la misma en DLTA y GSM.</p>
    ${editando ? null : html`<button type="button" class="enlace-boton enlace-flecha" onClick=${() => setEditando(true)}>Cambiar etapa →</button>`}
  </section>`;
}

export function PaginaInicio() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const datos = useMemo(() => (estado && !sesion.almacen.vacio ? resumen(estado) : null), [estado]);
  if (!datos) return html`<${Bienvenida} />`;
  const hoy = hoyIso();
  const ahora = new Date();
  const entradasHoy = datos.entradas_hoy; // recibidas hoy (fecha de recibido)
  const enCurso = estado.conteo_en_curso;
  const contados = enCurso ? Object.keys(enCurso.capturas ?? {}).length : 0;
  const alertas = [
    !sesion.usuario && html`<a href="#inicio" onClick=${(e) => { e.preventDefault(); document.querySelector(".lista-usuario .lista-boton")?.click(); }}>Elige quién está en turno</a>`,
    !sesion.respaldoDeHoy && (sesion.carpetaLista ? null : html`<a href="#respaldos">Sin respaldo de hoy</a>`),
    datos.por_ubicar && html`<a href="#pendientes">${datos.por_ubicar} partida(s) por ubicar</a>`,
    datos.por_confirmar && html`<a href="#inventario">${datos.por_confirmar} artículo(s) por confirmar</a>`,
  ].filter(Boolean);
  return html`
    <div class="saludo">
      <div>
        <h2>${saludo(ahora)}${sesion.usuario ? `, ${sesion.usuario.split(" ")[0].charAt(0)}${sesion.usuario.split(" ")[0].slice(1).toLowerCase()}` : ""}</h2>
        <p class="nota">Inventario ${sesion.inventario.id} · ${DIAS[ahora.getDay()]} ${ahora.getDate()} de ${MESES[ahora.getMonth()]} · ${datos.vales_hoy} ${datos.vales_hoy === 1 ? "vale" : "vales"} y ${entradasHoy} ${entradasHoy === 1 ? "entrada" : "entradas"} hoy</p>
      </div>
      ${alertas.length ? html`<div class="alertas-inicio">${alertas.map((a) => html`<span class="chip-alerta">⚠ ${a}</span>`)}</div>` : null}
    </div>

    <${Bento} clase="bento-inicio" etiqueta="Inicio">
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
      <${Accion} href="#reporte" icono="reporte" titulo="Crear reporte diario" detalle="Libro de vales e inventario al cierre del día" />
      <${Accion}
        href="#conteo"
        icono="conteo"
        titulo="Conteo físico"
        tono=${enCurso ? "accion-en-curso" : ""}
        detalle=${enCurso ? `En captura · ${contados} partidas capturadas` : "Todo el inventario o algunos contenedores"}
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
          ${datos.conteos > 1 ? "Cada partida descuenta desde su propio conteo." : `Descuenta desde el folio ${(datos.conteo_folio ?? 0) + 1}.`}
        </p>
        <a class="enlace-flecha" href="#conteo">Ver conteos →</a>
      </section>

      <${BentoEtapa} />

      <section class="bento-celda bento-completa">
        <header class="bento-cabeza">
          <span class="cabeza-icono"><${Icono} nombre="ayuda" /></span>
          <h2>Uso diario</h2>
        </header>
        <ol class="pasos pasos-columnas">
          <li><strong>Elige quién está en turno</strong> (arriba a la derecha).</li>
          <li><strong><a href="#vales">Haz los vales</a>:</strong> área, quién recibe y partidas (código → clave → cantidad). El folio se asigna solo; imprímelo para las firmas.</li>
          <li><strong>Cuando llegue material</strong>, regístralo en <a href="#entradas">Vales de entrada</a> (puedes capturarlo desde la foto con Copilot).</li>
          <li><strong>Al final del día</strong>, <a href=${`#reporte/${hoy}`}>crea el reporte diario</a>: descarga el libro de vales y el inventario de ese día, súbelos al SharePoint y márcalo con "Ya lo subí".</li>
        </ol>
      </section>
    <//>
  `;
}
