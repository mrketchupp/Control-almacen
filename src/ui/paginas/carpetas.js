// Ronda 30 — carpetas del reporte diario: «Descargar» guarda cada archivo en su lugar sin «Guardar como».
// El inventario va a <base>/<ruta con {año} y {mes}> (del día del reporte, también uno anterior) y el libro de
// vales reemplaza el archivo fijado (el del Escritorio). Lo que no tiene destino abre «Guardar como» como antes.
// Nada se guarda solo: solo al pulsar «Descargar».

import { useEffect, useMemo, useState } from "preact/hooks";
import { ErrorEscritura, SIN_RESPUESTA, SinElegir, descargar, estaPerdido, explicarErrorEscritura, permisoCarpeta, soportaCarpetas, textoSinRespuesta } from "../../almacen/archivos.js";
import { LIBROS, RUTAS, VARIABLES, abrirRuta, carpetasPara, hayArchivo, problemaDeRuta } from "../../almacen/destinos.js";
import { anotar, borrarRegistro, describirHandle, registro, suscribirRegistro, textoRegistro } from "../../almacen/registro.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { Aviso, Boton, Detalles, Tarjeta, Ventana, confirmar, useSesion } from "../componentes.js";
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
export async function guardarEnSuLugar(sesion, tipo, alTerminarOriginal = null, opciones = {}, { antes = null } = {}) {
  const destino = sesion.destinoReporte(tipo);
  const fecha = opciones.corte ?? hoyIso();
  if (!destino) {
    anotar("descargar", `${tipo} del ${fecha}: sin carpeta fijada, se abre «Guardar como»`);
    return exportarConDialogo(sesion, tipo, alTerminarOriginal, opciones);
  }
  const alTerminar = (resultado) => {
    anotar("descargar", `${tipo} del ${fecha}: ${resultado.motivo ? `no quedó en su lugar (${resultado.motivo}); quedó en ${resultado.destino}` : `guardado en ${resultado.destino}`}`);
    alTerminarOriginal?.(resultado);
  };
  const conPermiso = destino.clase === "carpeta" ? destino.raiz : destino.archivo;
  // Ronda 38: Edge perdió esta carpeta o este libro (tras el apagón no responde): se elige otra vez y se guarda ahí,
  // en el mismo clic (el explorador solo abre dentro de un clic).
  if (estaPerdido(conPermiso)) return elegirOtraVez(sesion, tipo, destino, alTerminarOriginal, opciones, { antes });
  const clave = `${tipo}|${fecha}`;
  if (enCurso.has(clave)) return; // doble clic: ya se está guardando
  enCurso.add(clave);
  try {
    const otroLugar = { etiqueta: "Guardar como…", alHacer: () => exportarConDialogo(sesion, tipo, alTerminar, opciones) };
    const reintentar = () => guardarEnSuLugar(sesion, tipo, alTerminar, opciones, { antes });
    anotar("descargar", `${tipo} del ${fecha} → ${destino.clase === "carpeta" ? `${describirHandle(destino.raiz)} / ${destino.ruta}` : describirHandle(destino.archivo)}`);
    const permiso = await permisoCarpeta(conPermiso, true);
    if (permiso === SIN_RESPUESTA) {
      anotar("descargar", `${tipo}: Edge no responde con «${conPermiso.name}», no se generó`);
      sesion.avisar("advertencia", textoPerdido(conPermiso, destino), 20000, {
        etiqueta: destino.clase === "carpeta" ? "Elegir la carpeta…" : "Elegir el libro…",
        alHacer: () => elegirOtraVez(sesion, tipo, destino, alTerminarOriginal, opciones, { antes }),
      });
      return;
    }
    if (permiso !== "granted") {
      anotar("descargar", `${tipo}: sin permiso de Edge (${permiso}), no se generó`);
      sesion.avisar(
        "advertencia",
        `Edge no dio permiso para guardar en «${conPermiso.name}». Pulsa otra vez «Descargar» y elige «Editar archivos» (si ya no lo pregunta, recarga la página).`,
        15000,
        otroLugar,
      );
      return;
    }
    if (destino.clase === "archivo") {
      if (antes && !antes()) {
        anotar("descargar", `${tipo}: no se quiso reemplazar (vales posteriores)`);
        return;
      }
      await generar(sesion, tipo, destino.archivo, opciones, alTerminar, { reintentar });
      return;
    }
    const nombre = sesion.almacen.nombreExportacion(tipo, fecha, opciones);
    const camino = await abrirRuta(destino.raiz, destino.ruta, fecha);
    anotar("descargar", `${tipo}: ${camino.texto}${camino.nuevas.length ? ` (por crear: ${camino.nuevas.join(", ")})` : ""}${camino.falta ? ` — falta «${camino.falta.nombre}» en ${camino.falta.dentro}; hay: ${camino.falta.hay.join(", ") || "nada parecido"}` : ""}`);
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
    if (nombre && (await hayArchivo(camino.carpeta, nombre)) && !confirmar(`Ya existe «${nombre}» en ${camino.texto}.\n\n¿Reemplazarlo con el inventario al cierre del ${fmtFecha(fecha)}?`)) {
      anotar("descargar", `${tipo}: ya existía «${nombre}» y no se quiso reemplazar`);
      return;
    }
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
    anotar("descargar", `${tipo}: se detuvo`, error);
    sesion.avisar("error", error?.message || String(error));
  } finally {
    enCurso.delete(clave);
  }
}

/** Edge perdió la carpeta base o el libro de vales: qué hacer, en una línea. */
export const textoPerdido = (handle, destino) =>
  destino.clase === "carpeta" ? `Edge perdió la carpeta «${handle.name}». Elígela otra vez.` : `Edge perdió «${handle.name}». Elígelo otra vez.`;

/**
 * Ronda 38 (fallo reportado tras el apagón): la carpeta base o el libro de vales que Edge perdió se elige otra vez en el
 * explorador (queda fijado; la base nueva no espera a la perdida) y el archivo del día se guarda ahí mismo. El libro de
 * vales se elige con «Guardar como» con su nombre, que ya trae el permiso de escribir.
 */
async function elegirOtraVez(sesion, tipo, destino, alTerminar, opciones, { antes = null } = {}) {
  const fecha = opciones.corte ?? hoyIso();
  const avisarError = (error) => {
    console.warn(error);
    if (error instanceof SinElegir || error?.causa === "colgado") sesion.avisar("advertencia", error.message, 20000);
    else sesion.avisar("error", error?.message || String(error));
  };
  if (destino.clase === "archivo") {
    let archivo;
    try {
      archivo = await sesion.elegirLibroValesGuardando(destino.id, sesion.almacen.nombreExportacion(tipo, fecha, opciones));
    } catch (error) {
      avisarError(error);
      return;
    }
    if (!archivo) return; // canceló «Guardar como»
    anotar("descargar", `${tipo}: libro de vales elegido otra vez: ${describirHandle(archivo)}`);
    if (antes && !antes()) return;
    await generar(sesion, tipo, archivo, opciones, alTerminar, { reintentar: () => guardarEnSuLugar(sesion, tipo, alTerminar, opciones, { antes }) });
    return;
  }
  // Mientras el explorador está abierto y luego se buscan las carpetas de cada inventario dentro de la base.
  const fallo = await sesion.tarea("Eligiendo la carpeta…", async () => {
    try {
      await sesion.elegirCarpetaReporte();
      return null;
    } catch (error) {
      return error;
    }
  });
  if (fallo) {
    avisarError(fallo);
    return;
  }
  anotar("descargar", `${tipo}: carpeta base elegida otra vez: ${describirHandle(sesion.destinos.raiz)}`);
  if (!sesion.destinoReporte(tipo)) return exportarConDialogo(sesion, tipo, alTerminar, opciones);
  return guardarEnSuLugar(sesion, tipo, alTerminar, opciones, { antes });
}

/** Qué dice la tarjeta del reporte de dónde va a quedar (sin revisar el disco). */
export function textoDestino(sesion, tipo, fecha) {
  const destino = sesion.destinoReporte(tipo);
  if (!destino) return null;
  const handle = destino.clase === "archivo" ? destino.archivo : destino.raiz;
  if (estaPerdido(handle)) return `⚠ Al descargar, elíge${destino.clase === "archivo" ? "lo" : "la"} otra vez`;
  if (destino.clase === "archivo") return `Reemplaza ${destino.archivo.name}`;
  return [destino.raiz.name, ...carpetasPara(destino.ruta, fecha).map((c) => c.nombre)].join(" › ");
}

/** 'granted' | 'prompt' | 'denied' sin pedir nada (para mostrar el estado). */
const consultar = (handle) => (handle ? permisoCarpeta(handle, false) : Promise.resolve(null));

function EstadoPermiso({ permiso, archivo = false }) {
  if (!permiso) return null;
  // Ronda 38: Edge ya no responde con ella (tras el apagón): solo sirve elegirla otra vez.
  if (permiso === SIN_RESPUESTA) return html`<span class="alerta carpeta-permiso">⚠ Edge ${archivo ? "lo" : "la"} perdió: elíge${archivo ? "lo" : "la"} otra vez</span>`;
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
 * Recuadro donde se suelta una carpeta o un archivo arrastrado desde el Explorador de Windows: no pasa por el diálogo
 * de Edge (que a veces no entrega lo elegido en carpetas de OneDrive). `alSoltar(promesa)` recibe la promesa del
 * handle (FileSystemDirectoryHandle / FileSystemFileHandle), pedida dentro del evento como lo exige el navegador.
 */
export function ZonaSoltar({ clase = "", tipo, etiqueta, deshabilitada = false, alSoltar, children }) {
  const [encima, setEncima] = useState(false);
  const conArchivos = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const sobre = (e) => {
    if (deshabilitada || !conArchivos(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!encima) setEncima(true);
  };
  const soltar = (e) => {
    if (deshabilitada || !conArchivos(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setEncima(false);
    const items = [...e.dataTransfer.items];
    anotar("arrastrar", `soltado en «${etiqueta}»: ${items.length} elemento(s), ${items.map((i) => `${i.kind}/${i.type || "sin tipo"}`).join(", ") || "ninguno"}`);
    const item = items.find((i) => i.kind === "file");
    if (!item) return;
    if (typeof item.getAsFileSystemHandle !== "function") {
      alSoltar(Promise.reject(new Error("Este navegador no deja usar lo que se arrastra: usa Microsoft Edge actualizado.")));
      return;
    }
    alSoltar(
      item.getAsFileSystemHandle().then((handle) => {
        anotar("arrastrar", `Edge entregó ${describirHandle(handle)}`);
        if (!handle) throw new Error("Edge no entregó lo que arrastraste.");
        if (handle.kind !== tipo) throw new Error(tipo === "directory" ? `«${handle.name}» es un archivo: aquí va una carpeta.` : `«${handle.name}» es una carpeta: aquí va el archivo.`);
        return handle;
      }),
    );
  };
  return html`<div
    class=${`zona-soltar ${clase} ${encima ? "encima" : ""}`}
    data-zona=${etiqueta}
    onDragEnter=${sobre}
    onDragOver=${sobre}
    onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setEncima(false)}
    onDrop=${soltar}
  >
    ${children}
  </div>`;
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

  // Lo que pasó con la última acción, dentro de la ventana (un aviso flotante se puede pasar por alto).
  const [resultado, setResultado] = useState(null);
  const contar = (tipo, texto) => {
    setResultado({ tipo, texto });
    if (tipo === "ok") sesion.avisar("exito", texto);
  };
  /**
   * Corre una acción: si el explorador se cerró sin entregar nada (SinElegir) o Edge no respondió ('colgado'), lo dice
   * en la ventana y en un aviso, con el detalle de lo que respondió Edge; otros errores (p. ej. soltar un archivo donde
   * va una carpeta), en la ventana y como error.
   */
  const hacer = (texto, funcion) =>
    sesion.tarea(texto, async () => {
      try {
        await funcion();
      } catch (error) {
        console.warn(error);
        if (!(error instanceof SinElegir) && error?.causa !== "colgado") anotar("carpetas", `${texto.replace(/…$/, "")}: no se pudo`, error);
        setResultado({ tipo: "alerta", texto: error?.message || String(error) });
        if (error instanceof SinElegir || error?.causa === "colgado") sesion.avisar("advertencia", error.message, 20000);
        else sesion.avisar("error", error?.message || String(error));
        return;
      }
      setVersion((v) => v + 1);
    });
  /** Lo que llega tarde del explorador (Edge respondió después de darlo por perdido) también se usa. */
  const tarde = (texto, usar) => (handle) => hacer(texto, () => usar(handle));

  const contarBase = ({ raiz, propuestas, error }) => {
    const halladas = RUTAS.filter((id) => propuestas[id]);
    if (error) contar("alerta", `Carpeta base: ${raiz.name}. No pude buscar adentro (${error.message}): escribe las rutas o arrastra cada carpeta a su fila.`);
    else if (halladas.length) contar("ok", `Carpeta base: ${raiz.name}. Encontré las de ${halladas.join(", ")}; revisa que estén bien.`);
    else contar("alerta", `Carpeta base: ${raiz.name}. No encontré adentro las de los inventarios: escribe su ruta, usa «Explorar…» o arrastra cada carpeta a su fila.`);
  };
  const usarBase = async (raiz) => contarBase(await sesion.fijarCarpetaReporte(raiz));
  const elegirBase = () =>
    hacer("Eligiendo la carpeta…", async () => {
      contarBase(await sesion.elegirCarpetaReporte({ alLlegarTarde: tarde("Buscando las carpetas…", usarBase) }));
    });
  const permitir = () =>
    hacer("Pidiendo permiso…", async () => {
      if ((await permisoCarpeta(destinos.raiz, true, { alLlegarTarde: () => setVersion((v) => v + 1) })) === SIN_RESPUESTA) throw new Error(textoSinRespuesta(destinos.raiz.name));
    });
  const buscar = () =>
    hacer("Buscando las carpetas…", async () => {
      const permiso = await permisoCarpeta(destinos.raiz, true);
      if (permiso === SIN_RESPUESTA) throw new Error(textoSinRespuesta(destinos.raiz.name));
      if (permiso !== "granted") throw new Error(`Edge no dio permiso para leer «${destinos.raiz.name}».`);
      const propuestas = await sesion.buscarRutasReporte();
      const halladas = RUTAS.filter((id) => propuestas[id]);
      contar(halladas.length ? "ok" : "alerta", halladas.length ? `Encontré las de ${halladas.join(", ")}.` : "No encontré las carpetas de los inventarios en la base.");
    });
  const usarRuta = (id) => async (carpeta) => {
    const ruta = await sesion.fijarRutaDesdeCarpeta(id, carpeta);
    contar("ok", `Ruta de ${id}: ${ruta}`);
  };
  const explorar = (id) =>
    hacer("Eligiendo la carpeta…", async () => {
      const ruta = await sesion.explorarRutaReporte(id, { alLlegarTarde: tarde("Leyendo la carpeta…", usarRuta(id)) });
      contar("ok", `Ruta de ${id}: ${ruta}`);
    });
  const guardarRuta = (id, texto) => {
    if ((texto ?? "") === (destinos.rutas[id] ?? "")) return;
    sesion.fijarRutaReporte(id, texto).catch((e) => sesion.avisar("error", e.message));
  };
  const usarLibro = (id) => async (archivo) => {
    const fijado = await sesion.fijarLibroVales(id, archivo);
    if (fijado) contar("ok", `Libro de vales de ${id}: «Descargar» reemplazará ${fijado.name}.`);
  };
  const elegirLibro = (id) =>
    hacer("Eligiendo el archivo…", async () => {
      const archivo = await sesion.elegirLibroVales(id, { alLlegarTarde: tarde("Leyendo el archivo…", usarLibro(id)) });
      if (archivo) contar("ok", `Libro de vales de ${id}: «Descargar» reemplazará ${archivo.name}.`);
    });
  /** Lo arrastrado desde el Explorador de Windows (sin el diálogo de Edge). */
  const soltado = (texto, usar) => (promesa) => {
    // Se atiende ya: la acción corre un momento después y una promesa rechazada sin atender sale como error de Edge.
    const llegado = promesa.then((handle) => ({ handle }), (error) => ({ error }));
    return hacer(texto, async () => {
      const { handle, error } = await llegado;
      if (error) throw error;
      await usar(handle);
    });
  };

  // Mientras la ventana está abierta, soltar un archivo fuera de un recuadro no debe abrirlo en Edge.
  useEffect(() => {
    const evitar = (e) => {
      if ([...(e.dataTransfer?.types ?? [])].includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", evitar);
    window.addEventListener("drop", evitar);
    return () => {
      window.removeEventListener("dragover", evitar);
      window.removeEventListener("drop", evitar);
    };
  }, []);

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
    ${resultado
      ? html`<p class=${`carpetas-resultado carpetas-resultado-${resultado.tipo}`} role="status">
          <${Icono} nombre=${resultado.tipo === "ok" ? "ok" : "alerta"} tam=${18} /> <span>${resultado.texto}</span>
        </p>`
      : null}

    <section class="carpetas-seccion">
      <h3><${Icono} nombre="inventario" tam=${18} /> Inventarios</h3>
      <${ZonaSoltar} clase="carpeta-base" tipo="directory" etiqueta="Carpeta base" alSoltar=${soltado("Buscando las carpetas…", usarBase)}>
        <span class="carpeta-icono"><${Icono} nombre="carpeta" tam=${22} /></span>
        <div class="carpeta-base-texto">
          <span class="nota">Carpeta base</span>
          <strong>${destinos.raiz ? destinos.raiz.name : "Sin elegir"}</strong>
          ${destinos.raiz ? html`<${EstadoPermiso} permiso=${permisos.raiz} />` : null}
          <span class="nota zona-pista">o arrástrala aquí desde el Explorador de Windows</span>
        </div>
        <div class="acciones-linea">
          <${Boton} tipo=${destinos.raiz ? "secundario" : "primario"} onClick=${elegirBase}>${destinos.raiz ? "Cambiar…" : "Elegir carpeta…"}<//>
          ${destinos.raiz && permisos.raiz && permisos.raiz !== "granted" && permisos.raiz !== SIN_RESPUESTA ? html`<${Boton} onClick=${permitir}>Revisar las carpetas<//>` : null}
          ${destinos.raiz ? html`<${Boton} tipo="texto" onClick=${buscar}>Buscar otra vez<//>` : null}
        </div>
      <//>
      <p class="nota">
        La que tiene adentro las carpetas de cada inventario (por ejemplo <code>INVENTARIO DIARIO</code>). Edge no deja elegir el
        Escritorio ni todo OneDrive: elige una carpeta dentro. Si al elegirla no pasa nada, <strong>arrástrala</strong> desde el
        Explorador de Windows al recuadro; también puedes arrastrar la carpeta de cada inventario a su fila.
      </p>
      ${RUTAS.map(
        (id) => html`<${ZonaSoltar} clase="carpeta-fila" key=${id} tipo="directory" etiqueta=${`Carpeta de ${id}`} deshabilitada=${!destinos.raiz} alSoltar=${soltado("Leyendo la carpeta…", usarRuta(id))}>
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
        <//>`,
      )}
      <p class="nota carpeta-variables">
        ${VARIABLES.map((v) => html`<span><code>${v.variable}</code> ${v.detalle} (${v.ejemplo})</span>`)}
      </p>
      <p class="nota">FX es el libro de FX del inventario de GSM. Las carpetas se reconocen aunque estén escritas un poco distinto (<code>05.MAYO</code> = <code>05. MAYO</code>).</p>
    </section>

    <section class="carpetas-seccion">
      <h3><${Icono} nombre="salida" tam=${18} /> Libros de vales de salida</h3>
      <p class="nota">Elige el archivo que ya tienes (normalmente en el Escritorio) o arrástralo a su fila: «Descargar» lo reemplaza. Ciérralo en Excel antes de guardar.</p>
      ${LIBROS.map(
        (id) => html`<${ZonaSoltar} clase="carpeta-fila carpeta-fila-libro" key=${id} tipo="file" etiqueta=${`Libro de vales de ${id}`} alSoltar=${soltado("Leyendo el archivo…", usarLibro(id))}>
          <span class=${`carpeta-id carpeta-id-${id}`}>${id}</span>
          <span class=${`carpeta-archivo ${destinos.vales[id] ? "" : "nota"}`}>
            ${destinos.vales[id] ? html`<code>${destinos.vales[id].name}</code> <${EstadoPermiso} permiso=${permisos[id]} archivo />` : "Sin archivo: «Descargar» abre «Guardar como»"}
            <span class="nota zona-pista">o arrástralo aquí</span>
          </span>
          <${Boton} tipo=${destinos.vales[id] ? "texto" : "secundario"} onClick=${() => elegirLibro(id)} aria-label=${`${destinos.vales[id] ? "Cambiar" : "Elegir"} el libro de vales de ${id}`}>${destinos.vales[id] ? "Cambiar…" : "Elegir archivo…"}<//>
          ${destinos.vales[id]
            ? html`<${Boton} tipo="texto" onClick=${() => sesion.quitarDestinoReporte({ vales: id })} aria-label=${`Quitar el libro de vales de ${id}`} title="Quitar (volver a «Guardar como»)">✕<//>`
            : null}
        <//>`,
      )}
    </section>

    <${RegistroArchivos} />

    <div class="acciones-linea carpetas-pie">
      <${Boton} tipo="primario" onClick=${alCerrar}>Listo<//>
    </div>
  <//>`;
}

/** Datos del equipo que ayudan a entender el registro (sin rutas completas: Edge no las da). */
function entorno(sesion) {
  const agente = navigator.userAgent ?? "";
  const edge = /Edg\/([\d.]+)/.exec(agente)?.[1];
  const chrome = /Chrome\/([\d.]+)/.exec(agente)?.[1];
  const ventana = ["standalone", "minimal-ui", "fullscreen"].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches) ? "ventana de aplicación" : "pestaña";
  const hay = (f) => (f in window ? "sí" : "no");
  const arrastrar = typeof DataTransferItem !== "undefined" && "getAsFileSystemHandle" in DataTransferItem.prototype ? "sí" : "no";
  const { destinos } = sesion;
  return [
    ["Herramienta", document.documentElement.dataset.version ?? "?"],
    ["Inventario abierto", sesion.inventario.id],
    ["Navegador", edge ? `Edge ${edge}` : chrome ? `Chrome ${chrome}` : agente],
    ["Abierta como", `${location.protocol} en ${ventana}`],
    ["Funciones", `elegir carpeta ${hay("showDirectoryPicker")}, elegir archivo ${hay("showOpenFilePicker")}, guardar como ${hay("showSaveFilePicker")}, arrastrar ${arrastrar}`],
    ["Carpeta base", destinos.raiz?.name ?? "—"],
    ["Rutas", RUTAS.map((id) => `${id}=${destinos.rutas[id] ?? "—"}`).join(", ")],
    ["Libros de vales", LIBROS.map((id) => `${id}=${destinos.vales[id]?.name ?? "—"}`).join(", ")],
  ];
}

/**
 * Registro de lo que pasó con el explorador, los permisos, lo arrastrado y los guardados (almacen/registro.js),
 * para copiarlo o descargarlo y pegarlo en la conversación cuando algo no funciona.
 */
function RegistroArchivos() {
  const sesion = useSesion();
  const [, setCambios] = useState(0);
  useEffect(() => suscribirRegistro(() => setCambios((n) => n + 1)), []);
  const lineas = registro();
  const texto = () => textoRegistro(entorno(sesion));
  const descargarTexto = () => {
    descargar(`registro carpetas ${hoyIso()}.txt`, new TextEncoder().encode(texto()));
    sesion.avisar("exito", "Registro descargado en Descargas: adjúntalo en la conversación.");
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto());
      sesion.avisar("exito", "Registro copiado: pégalo en la conversación.");
    } catch {
      descargar(`registro carpetas ${hoyIso()}.txt`, new TextEncoder().encode(texto()));
      sesion.avisar("info", "Edge no dejó copiarlo: se descargó como archivo de texto en Descargas.");
    }
  };
  const visibles = useMemo(
    () => lineas.slice(-80).map((e) => `${e.en.slice(11)}  [${e.que}] ${e.detalle}${e.error ? `  ✗ ${e.error}` : ""}`).join("\n"),
    [lineas.length, lineas.at(-1)?.en, lineas.at(-1)?.detalle],
  );
  return html`<section class="carpetas-seccion">
    <${Detalles} resumen=${`Registro de lo que pasó (${lineas.length})`}>
      <p class="nota">
        Si algo no funciona, cópialo o descárgalo y pégalo en la conversación: dice qué pidió la herramienta y qué respondió
        Edge en cada paso (sin rutas completas ni datos del inventario). Se queda solo en este equipo.
      </p>
      <pre class="registro-archivos" tabindex="0" aria-label="Registro de carpetas y archivos">${visibles || "(sin entradas)"}</pre>
      <div class="acciones-linea">
        <${Boton} onClick=${copiar}>Copiar registro<//>
        <${Boton} onClick=${descargarTexto}>Descargar .txt<//>
        <${Boton} tipo="texto" disabled=${!lineas.length} onClick=${() => borrarRegistro()}>Borrar<//>
      </div>
    <//>
  </section>`;
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
