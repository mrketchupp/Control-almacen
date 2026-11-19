// Ronda 30 — carpetas del reporte diario: «Descargar» guarda cada archivo en su lugar sin «Guardar como».
// El inventario va a <base>/<ruta con {año} y {mes}> (del día del reporte, también uno anterior) y el libro de
// vales reemplaza el archivo fijado (el del Escritorio). Lo que no tiene destino abre «Guardar como» como antes.
// Nada se guarda solo: solo al pulsar «Descargar».

import { useEffect, useState } from "preact/hooks";
import { ErrorEscritura, explicarErrorEscritura, permisoCarpeta, soportaCarpetas } from "../../almacen/archivos.js";
import { LIBROS, RUTAS, VARIABLES, abrirRuta, carpetasPara, hayArchivo, problemaDeRuta } from "../../almacen/destinos.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { Aviso, Boton, Tarjeta, Ventana, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { exportarConDialogo, generar } from "./sharepoint.js";

const enCurso = new Set();

const listaDeNombres = (nombres) => nombres.map((n) => `«${n}»`).join(", ");

/**
 * El clic en «Descargar» del reporte diario: con destino fijado, lo guarda ahí; si no, «Guardar como» (como
 * antes). Lo primero es el permiso (Edge lo pide una vez por sesión y solo dentro del clic). Si el archivo del
 * día ya existe en su carpeta, pregunta antes de reemplazarlo; `antes()` puede pedir otra confirmación (p. ej. el
 * libro de vales de un día con vales posteriores). Si no se puede escribir ahí, el Excel queda en Descargas y la
 * ventana con dibujos permite volver a intentarlo.
 */
export async function guardarEnSuLugar(sesion, tipo, alTerminar = null, opciones = {}, { antes = null } = {}) {
  const destino = sesion.destinoReporte(tipo);
  if (!destino) return exportarConDialogo(sesion, tipo, alTerminar, opciones);
  const fecha = opciones.corte ?? hoyIso();
  const clave = `${tipo}|${fecha}`;
  if (enCurso.has(clave)) return; // doble clic: ya se está guardando
  enCurso.add(clave);
  try {
    const otroLugar = { etiqueta: "Guardar como…", alHacer: () => exportarConDialogo(sesion, tipo, alTerminar, opciones) };
    const reintentar = () => guardarEnSuLugar(sesion, tipo, alTerminar, opciones, { antes });
    const conPermiso = destino.clase === "carpeta" ? destino.raiz : destino.archivo;
    if ((await permisoCarpeta(conPermiso, true)) !== "granted") {
      sesion.avisar(
        "advertencia",
        `Edge no dio permiso para guardar en «${conPermiso.name}». Pulsa otra vez «Descargar» y elige «Editar archivos» (si ya no lo pregunta, recarga la página).`,
        15000,
        otroLugar,
      );
      return;
    }
    if (destino.clase === "archivo") {
      if (antes && !antes()) return;
      await generar(sesion, tipo, destino.archivo, opciones, alTerminar, { reintentar });
      return;
    }
    const nombre = sesion.almacen.nombreExportacion(tipo, fecha, opciones);
    const camino = await abrirRuta(destino.raiz, destino.ruta, fecha);
    if (camino.falta) {
      const { falta } = camino;
      sesion.avisar(
        "error",
        `No encontré la carpeta «${falta.nombre}» en ${falta.dentro}${falta.hay.length ? ` (ahí hay ${listaDeNombres(falta.hay)})` : ""}. Corrige la ruta de ${destino.id} en «Carpetas…» del reporte.`,
        0,
        otroLugar,
      );
      return;
    }
    if (nombre && (await hayArchivo(camino.carpeta, nombre)) && !confirmar(`Ya existe «${nombre}» en ${camino.texto}.\n\n¿Reemplazarlo con el inventario al cierre del ${fmtFecha(fecha)}?`)) return;
    if (antes && !antes()) return;
    const enCarpeta = {
      async abrir(n) {
        try {
          const ruta = await abrirRuta(destino.raiz, destino.ruta, fecha, { crear: true });
          if (!ruta.carpeta) throw new ErrorEscritura(`la carpeta «${ruta.falta?.nombre ?? ruta.texto}» ya no existe`, { causa: "carpeta" });
          const existia = await hayArchivo(ruta.carpeta, n);
          const archivo = await ruta.carpeta.getFileHandle(n, { create: true });
          return {
            archivo,
            existia,
            nuevas: ruta.nuevas,
            ruta: [destino.raiz.name, ...ruta.carpetas.map((c) => c.nombre), n].join("/"),
            quitar: () => ruta.carpeta.removeEntry(n),
          };
        } catch (error) {
          if (error instanceof ErrorEscritura) throw error;
          throw new ErrorEscritura(explicarErrorEscritura(error, n), { cause: error });
        }
      },
    };
    await generar(sesion, tipo, undefined, opciones, alTerminar, { enCarpeta, reintentar });
  } catch (error) {
    console.error(error);
    sesion.avisar("error", error?.message || String(error));
  } finally {
    enCurso.delete(clave);
  }
}

/** Qué dice la tarjeta del reporte de dónde va a quedar (sin revisar el disco). */
export function textoDestino(sesion, tipo, fecha) {
  const destino = sesion.destinoReporte(tipo);
  if (!destino) return null;
  if (destino.clase === "archivo") return `Reemplaza ${destino.archivo.name}`;
  return [destino.raiz.name, ...carpetasPara(destino.ruta, fecha).map((c) => c.nombre)].join(" › ");
}

/** 'granted' | 'prompt' | 'denied' sin pedir nada (para mostrar el estado). */
const consultar = (handle) => (handle ? permisoCarpeta(handle, false) : Promise.resolve(null));

function EstadoPermiso({ permiso }) {
  if (!permiso) return null;
  return permiso === "granted"
    ? html`<span class="ok carpeta-permiso">✓ con permiso</span>`
    : html`<span class="nota carpeta-permiso">Edge pedirá permiso al guardar</span>`;
}

/** Cómo queda la ruta de un inventario el día de la vista previa: las carpetas, cuál existe y cuál se creará. */
function VistaRuta({ raiz, ruta, fecha, revision, permiso }) {
  if (!raiz) return null;
  if (!ruta) return html`<p class="nota carpeta-vista">Sin carpeta: «Descargar» abre «Guardar como».</p>`;
  const problema = problemaDeRuta(ruta);
  if (problema) return html`<p class="alerta carpeta-vista">⚠ ${problema}</p>`;
  if (revision?.error) return html`<p class="alerta carpeta-vista">⚠ No se pudo revisar: ${revision.error}</p>`;
  if (revision?.falta) {
    const { falta } = revision;
    return html`<p class="alerta carpeta-vista">✗ No existe «${falta.nombre}» en ${falta.dentro}${falta.hay.length ? html`. Ahí hay ${listaDeNombres(falta.hay)}.` : "."}</p>`;
  }
  const carpetas = revision?.carpetas ?? carpetasPara(ruta, fecha).map((c) => ({ ...c, existe: null }));
  return html`<p class="carpeta-vista">
    <span class="nota">Para el ${fmtFecha(fecha)}:</span>
    <span class="carpeta-migas">
      <span>${raiz.name}</span>
      ${carpetas.map((c) => html`<span class="carpeta-sep" aria-hidden="true">›</span><span class=${c.existe === false ? "carpeta-nueva" : ""} title=${c.existe === false ? "No existe: se crea al guardar" : ""}>${c.nombre}${c.existe === false ? " (nueva)" : ""}</span>`)}
    </span>
    ${revision ? (revision.nuevas.length ? html`<span class="nota"> · se crea al guardar</span>` : html`<span class="ok"> ✓</span>`) : permiso === "granted" ? null : html`<span class="nota"> · sin revisar</span>`}
  </p>`;
}

/**
 * Ventana para fijar dónde se guarda cada archivo del reporte diario: la carpeta base de los inventarios y la
 * ruta de cada uno (DLTA, GSM, FX), y el libro de vales de cada inventario. Es lo mismo en DLTA y GSM.
 * `fecha`: el día del reporte, para la vista previa de las carpetas de año y mes.
 */
export function VentanaCarpetas({ fecha = hoyIso(), alCerrar }) {
  const sesion = useSesion();
  const { destinos } = sesion;
  const [textos, setTextos] = useState(destinos.rutas);
  const [permisos, setPermisos] = useState({});
  const [revisiones, setRevisiones] = useState({});
  const [version, setVersion] = useState(0); // revisar otra vez (tras dar permiso)
  const rutasGuardadas = RUTAS.map((id) => destinos.rutas[id] ?? "").join("|");
  useEffect(() => setTextos(destinos.rutas), [rutasGuardadas]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const salida = { raiz: await consultar(destinos.raiz) };
      for (const id of LIBROS) salida[id] = await consultar(destinos.vales[id]);
      if (vigente) setPermisos(salida);
    })();
    return () => {
      vigente = false;
    };
  }, [destinos, version]);

  useEffect(() => {
    if (!destinos.raiz || permisos.raiz !== "granted") {
      setRevisiones({});
      return undefined;
    }
    let vigente = true;
    const espera = setTimeout(async () => {
      const salida = {};
      for (const id of RUTAS) {
        const ruta = textos[id];
        if (!ruta || problemaDeRuta(ruta)) continue;
        try {
          salida[id] = await abrirRuta(destinos.raiz, ruta, fecha);
        } catch (error) {
          salida[id] = { error: error?.message || String(error) };
        }
      }
      if (vigente) setRevisiones(salida);
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [destinos.raiz, permisos.raiz, textos, fecha]);

  const hacer = (texto, funcion) => sesion.tarea(texto, funcion);
  const elegirBase = () =>
    hacer("Buscando las carpetas…", async () => {
      const elegida = await sesion.elegirCarpetaReporte();
      if (!elegida) return;
      const halladas = RUTAS.filter((id) => elegida.propuestas[id]);
      sesion.avisar(
        halladas.length ? "exito" : "info",
        halladas.length
          ? `Carpeta base: ${elegida.raiz.name}. Encontré las de ${halladas.join(", ")}; revisa que estén bien.`
          : `Carpeta base: ${elegida.raiz.name}. No encontré las de los inventarios: escribe su ruta o usa «Explorar…».`,
      );
      setVersion((v) => v + 1);
    });
  const permitir = () =>
    hacer("Pidiendo permiso…", async () => {
      await permisoCarpeta(destinos.raiz, true);
      setVersion((v) => v + 1);
    });
  const buscar = () =>
    hacer("Buscando las carpetas…", async () => {
      if ((await permisoCarpeta(destinos.raiz, true)) !== "granted") throw new Error(`Edge no dio permiso para leer «${destinos.raiz.name}».`);
      const propuestas = await sesion.buscarRutasReporte();
      const halladas = RUTAS.filter((id) => propuestas[id]);
      sesion.avisar(halladas.length ? "exito" : "info", halladas.length ? `Encontré las de ${halladas.join(", ")}.` : "No encontré las carpetas de los inventarios en la base.");
      setVersion((v) => v + 1);
    });
  const explorar = (id) =>
    hacer("Eligiendo carpeta…", async () => {
      const ruta = await sesion.explorarRutaReporte(id);
      if (ruta) setVersion((v) => v + 1);
    });
  const guardarRuta = (id, texto) => {
    if ((texto ?? "") === (destinos.rutas[id] ?? "")) return;
    sesion.fijarRutaReporte(id, texto).catch((e) => sesion.avisar("error", e.message));
  };
  const elegirLibro = (id) =>
    hacer("Eligiendo archivo…", async () => {
      const archivo = await sesion.elegirLibroVales(id);
      if (archivo) sesion.avisar("exito", `Libro de vales de ${id}: «Descargar» reemplazará ${archivo.name}.`);
    });

  if (!soportaCarpetas()) {
    return html`<${Ventana} titulo="Carpetas del reporte diario" clase="ventana-carpetas" alCerrar=${alCerrar}>
      <${Aviso} tipo="advertencia">Este navegador no deja guardar directo en una carpeta. Usa Microsoft Edge; mientras tanto, «Descargar» abre «Guardar como».<//>
    <//>`;
  }

  return html`<${Ventana} titulo="Carpetas del reporte diario" clase="ventana-carpetas" alCerrar=${alCerrar}>
    <p class="nota">
      Con su carpeta fijada, <strong>«Descargar»</strong> guarda cada archivo ahí sin preguntar dónde; el año y el mes salen del
      día del reporte (también de días anteriores) y, si su carpeta aún no existe, se crea. Lo que no tenga carpeta sigue abriendo
      «Guardar como». Nada se guarda solo. <strong>Es lo mismo en DLTA y GSM</strong> y se queda en este equipo.
    </p>

    <section class="carpetas-seccion">
      <h3><${Icono} nombre="inventario" tam=${18} /> Inventarios</h3>
      <div class="carpeta-base">
        <span class="carpeta-icono"><${Icono} nombre="carpeta" tam=${22} /></span>
        <div class="carpeta-base-texto">
          <span class="nota">Carpeta base</span>
          <strong>${destinos.raiz ? destinos.raiz.name : "Sin elegir"}</strong>
          ${destinos.raiz ? html`<${EstadoPermiso} permiso=${permisos.raiz} />` : null}
        </div>
        <div class="acciones-linea">
          <${Boton} tipo=${destinos.raiz ? "secundario" : "primario"} onClick=${elegirBase}>${destinos.raiz ? "Cambiar…" : "Elegir carpeta…"}<//>
          ${destinos.raiz && permisos.raiz && permisos.raiz !== "granted" ? html`<${Boton} onClick=${permitir}>Revisar las carpetas<//>` : null}
          ${destinos.raiz ? html`<${Boton} tipo="texto" onClick=${buscar}>Buscar otra vez<//>` : null}
        </div>
      </div>
      <p class="nota">
        La que tiene adentro las carpetas de cada inventario (por ejemplo <code>INVENTARIO DIARIO</code>). Edge no deja elegir el
        Escritorio ni todo OneDrive: elige una carpeta dentro.
      </p>
      ${RUTAS.map(
        (id) => html`<div class="carpeta-fila" key=${id}>
          <span class=${`carpeta-id carpeta-id-${id}`}>${id}</span>
          <input
            class="carpeta-ruta"
            value=${textos[id] ?? ""}
            placeholder=${destinos.raiz ? "Sin carpeta: abre «Guardar como»" : "Primero elige la carpeta base"}
            disabled=${!destinos.raiz}
            spellcheck="false"
            aria-label=${`Ruta del inventario de ${id} dentro de la carpeta base`}
            onInput=${(e) => setTextos((t) => ({ ...t, [id]: e.currentTarget.value }))}
            onChange=${(e) => guardarRuta(id, e.currentTarget.value)}
            onKeyDown=${(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <${Boton} tipo="texto" disabled=${!destinos.raiz} onClick=${() => explorar(id)} title="Elegir la carpeta en el explorador" aria-label=${`Explorar la carpeta de ${id}`}>Explorar…<//>
          ${destinos.rutas[id]
            ? html`<${Boton} tipo="texto" onClick=${() => sesion.quitarDestinoReporte({ ruta: id })} aria-label=${`Quitar la carpeta de ${id}`} title="Quitar (volver a «Guardar como»)">✕<//>`
            : null}
          <${VistaRuta} raiz=${destinos.raiz} ruta=${textos[id]} fecha=${fecha} revision=${revisiones[id]} permiso=${permisos.raiz} />
        </div>`,
      )}
      <p class="nota carpeta-variables">
        ${VARIABLES.map((v) => html`<span><code>${v.variable}</code> ${v.detalle} (${v.ejemplo})</span>`)}
      </p>
      <p class="nota">FX es el libro de FX del inventario de GSM. Las carpetas se reconocen aunque estén escritas un poco distinto (<code>05.MAYO</code> = <code>05. MAYO</code>).</p>
    </section>

    <section class="carpetas-seccion">
      <h3><${Icono} nombre="salida" tam=${18} /> Libros de vales de salida</h3>
      <p class="nota">Elige el archivo que ya tienes (normalmente en el Escritorio): «Descargar» lo reemplaza. Ciérralo en Excel antes de guardar.</p>
      ${LIBROS.map(
        (id) => html`<div class="carpeta-fila carpeta-fila-libro" key=${id}>
          <span class=${`carpeta-id carpeta-id-${id}`}>${id}</span>
          <span class=${`carpeta-archivo ${destinos.vales[id] ? "" : "nota"}`}>
            ${destinos.vales[id] ? html`<code>${destinos.vales[id].name}</code> <${EstadoPermiso} permiso=${permisos[id]} />` : "Sin archivo: «Descargar» abre «Guardar como»"}
          </span>
          <${Boton} tipo=${destinos.vales[id] ? "texto" : "secundario"} onClick=${() => elegirLibro(id)} aria-label=${`${destinos.vales[id] ? "Cambiar" : "Elegir"} el libro de vales de ${id}`}>${destinos.vales[id] ? "Cambiar…" : "Elegir archivo…"}<//>
          ${destinos.vales[id]
            ? html`<${Boton} tipo="texto" onClick=${() => sesion.quitarDestinoReporte({ vales: id })} aria-label=${`Quitar el libro de vales de ${id}`} title="Quitar (volver a «Guardar como»)">✕<//>`
            : null}
        </div>`,
      )}
    </section>

    <div class="acciones-linea carpetas-pie">
      <${Boton} tipo="primario" onClick=${alCerrar}>Listo<//>
    </div>
  <//>`;
}

/** Resumen para *Ajustes*: qué tiene destino y un botón para cambiarlo. */
export function TarjetaCarpetas() {
  const sesion = useSesion();
  const [abierta, setAbierta] = useState(false);
  const { destinos } = sesion;
  const fijadas = [
    ...RUTAS.filter((id) => destinos.raiz && destinos.rutas[id]).map((id) => `inventario ${id}`),
    ...LIBROS.filter((id) => destinos.vales[id]).map((id) => `vales ${id}`),
  ];
  return html`<${Tarjeta} titulo="Carpetas del reporte diario">
    <p class="nota">
      ${fijadas.length
        ? html`«Descargar» del reporte guarda directo: ${fijadas.join(", ")}${destinos.raiz ? html` (base <code>${destinos.raiz.name}</code>)` : null}. Lo demás abre «Guardar como».`
        : "Sin carpetas fijadas: «Descargar» del reporte abre «Guardar como» para cada archivo."}
      Es lo mismo en DLTA y GSM.
    </p>
    <div class="acciones-linea">
      <${Boton} onClick=${() => setAbierta(true)}><${Icono} nombre="carpeta" tam=${16} /> ${fijadas.length ? "Cambiar carpetas…" : "Fijar carpetas…"}<//>
    </div>
    ${abierta ? html`<${VentanaCarpetas} alCerrar=${() => setAbierta(false)} />` : null}
  <//>`;
}
