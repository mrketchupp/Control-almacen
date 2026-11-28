import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { tipoDeArea } from "../../nucleo/areas.js";
import { Indices, npMostrado } from "../../nucleo/estado.js";
import { ahoraIso } from "../../nucleo/fechas.js";
import {
  ErrorVale,
  borrador as buscarBorrador,
  conEntregaEnTurno,
  descartarBorrador,
  emitirBorrador,
  fechaDelBorrador,
  lineasCapturadas,
  loteDeRenglon,
  nuevoBorrador,
  pideEtapa,
  requiereAutoriza,
  siguienteFolio,
  validarVale,
} from "../../servicios/vales.js";
import { Aviso, Boton, Combo, Pastilla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { irArriba } from "../desplazamiento.js";
import { Icono } from "../iconos.js";
import { VentanaCopiarVale, crearSalidaDesdeVale } from "./copiarVale.js";
import { PasosVale, ResumenParaQuien, enterAlBajar, enterParaAvanzar } from "./pasosVale.js";
import { PasoParaQuien } from "./paraQuien.js";
import { PasoMaterial } from "./material.js";
import { faltaParaAvanzar, nombrePaso, paraEmitir, pasoDe, pendientesParaEmitir } from "../../servicios/pasosVale.js";
import { PasoEmitir } from "./emitir.js";

// ---------------------------------------------------------------- utilidades

export const normal = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim();

export const palabras = (t) => normal(t).split(/\s+/).filter(Boolean);

/** Artículos del catálogo para buscar por código AX (o por descripción). */
export function indiceArticulos(estado, indices) {
  const renglones = new Map();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const codigo = indices.variante(e.variante_id).codigo;
    renglones.set(codigo, (renglones.get(codigo) ?? 0) + 1);
  }
  return Object.values(estado.articulos)
    .filter((a) => a.activo !== false)
    .map((a) => ({ codigo: a.codigo, descripcion: a.descripcion, renglones: renglones.get(a.codigo) ?? 0, texto: normal(`${a.codigo} ${a.descripcion}`) }));
}

function buscarArticulos(items, consulta, limite = 10) {
  const q = consulta.trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const n = q.replace(/^0+/, "") || "0";
    return items
      .filter((i) => String(i.codigo).startsWith(n))
      .sort((a, b) => Number(String(b.codigo) === n) - Number(String(a.codigo) === n) || a.codigo - b.codigo)
      .slice(0, limite);
  }
  const ps = palabras(q);
  return items
    .filter((i) => ps.every((p) => i.texto.includes(p)))
    .sort((a, b) => b.renglones - a.renglones || a.codigo - b.codigo)
    .slice(0, limite);
}

export function listas(estado) {
  const unicos = (valores) => [...new Set(valores.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    personas: unicos(estado.personas.filter((p) => p.activo !== false).map((p) => p.nombre)),
    deptos: unicos([...estado.plantillas_area.flatMap((p) => [p.depto_destino, p.depto_origen]), ...estado.vales.slice(-400).flatMap((v) => [v.depto_destino, v.depto_origen])]),
    lugares: unicos([...estado.plantillas_area.flatMap((p) => [p.destino, p.origen]), ...estado.vales.slice(-400).flatMap((v) => [v.destino, v.origen])]),
    puestos: unicos(estado.personas.map((p) => p.puesto)),
  };
}

/** Fotos del vale en los espacios de su formato (NOV: 3). Se guardan reducidas en el equipo. */
function FotosVale({ fotos = [], espacios, alCambiar }) {
  const sesion = useSesion();
  const [urls, setUrls] = useState({});
  const claves = espacios.map((_, i) => fotos[i] ?? null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const nuevas = {};
      for (const clave of claves) if (clave) nuevas[clave] = await sesion.urlFoto(clave);
      if (vivo) setUrls(nuevas);
    })();
    return () => {
      vivo = false;
    };
  }, [claves.join("|")]);
  const poner = (i, clave) => {
    const nuevas = [...claves];
    nuevas[i] = clave;
    alCambiar(nuevas);
  };
  const elegir = (i) => (e) => {
    const archivo = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (archivo) sesion.tarea("Guardando foto…", async () => poner(i, await sesion.agregarFoto(archivo)));
  };
  const puestas = claves.filter(Boolean).length;
  // Mismo acomodo que en el formato: cada espacio con su ancho y proporción.
  const columnas = espacios.map((e) => `${Math.round(e.ancho)}fr`).join(" ");
  return html`<section class="vale-fotos" aria-label="Fotos del vale">
    <header class="partidas-cabeza">
      <h2>Fotos</h2>
      <span class="contador-partidas">${puestas} de ${espacios.length}</span>
      <span class="nota">Se imprimen en el mismo lugar y tamaño que en tu formato. Se guardan reducidas en este equipo.</span>
    </header>
    <div class="fotos-vale" style=${`grid-template-columns:${columnas}`}>
      ${espacios.map(
        (espacio, i) => html`<div class="foto-espacio" style=${`aspect-ratio:${Math.round(espacio.ancho)}/${Math.round(espacio.alto)}`}>
          ${claves[i]
            ? html`${urls[claves[i]] ? html`<img src=${urls[claves[i]]} alt=${`Foto ${i + 1}`} />` : html`<span class="nota">Foto ${i + 1}</span>`}
                <div class="foto-acciones">
                  <button type="button" class="boton-quitar" title="Quitar esta foto" aria-label=${`Quitar foto ${i + 1}`} onClick=${() => poner(i, null)}>✕</button>
                  <label class="boton boton-secundario boton-chico">Cambiar<input type="file" accept="image/*" hidden onChange=${elegir(i)} /></label>
                </div>`
            : html`<label class="foto-agregar" title="Agregar foto">＋ Foto ${i + 1}<input type="file" accept="image/*" hidden onChange=${elegir(i)} /></label>`}
        </div>`,
      )}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- partidas

export function CeldaCodigo({ linea, articulos, alElegir, alNuevo, error }) {
  const [texto, setTexto] = useState(linea.codigo ? String(linea.codigo) : "");
  useEffect(() => setTexto(linea.codigo ? String(linea.codigo) : ""), [linea.codigo]);
  const buscando = texto.trim() !== (linea.codigo ? String(linea.codigo) : "");
  const opciones = useMemo(() => (buscando ? buscarArticulos(articulos, texto) : []), [texto, buscando, articulos]);
  const numero = /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : null;
  const existe = numero !== null && articulos.some((a) => a.codigo === numero);
  return html`<${Combo}
    id=${`cod-${linea.uid}`}
    clase=${`combo-codigo ${error ? "con-error" : ""}`}
    valor=${texto}
    alEscribir=${setTexto}
    opciones=${opciones}
    clave=${(o) => o.codigo}
    render=${(o) => html`<strong>${o.codigo}</strong> · ${o.descripcion}
      ${o.renglones
        ? html`<${Pastilla} tono="ok">${o.renglones === 1 ? "1 clave en inventario" : `${o.renglones} claves en inventario`}<//>`
        : html`<${Pastilla}>sin existencia<//>`}`}
    alElegir=${(o) => alElegir(o.codigo, true)}
    extra=${buscando && numero && !existe ? { etiqueta: `＋ Usar el código ${numero} (no está en el catálogo)`, alElegir: () => alNuevo(numero) } : null}
    alSalir=${() => {
      if (!buscando) return;
      if (existe) alElegir(numero, false);
      else setTexto(linea.codigo ? String(linea.codigo) : "");
    }}
    placeholder="Código"
    ariaLabel="Código AX"
  />`;
}

/**
 * Las fotos del vale en los espacios de su formato (NOV: 3), para el paso 3 del vale y la corrección. Sin espacios en
 * el formato, nada. (Ronda 39: el editor completo de antes, `EditorVale`, se quitó; la corrección usa los pasos.)
 */
export function FotosDelFormato({ datos, alCambiar }) {
  const sesion = useSesion();
  const [espacios, setEspacios] = useState([]);
  useEffect(() => {
    let vivo = true;
    sesion
      .espaciosFotos(datos)
      .then((e) => vivo && setEspacios(e))
      .catch(() => vivo && setEspacios([]));
    return () => {
      vivo = false;
    };
  }, [datos.plantilla_area_id, datos.depto_destino]);
  return espacios.length ? html`<${FotosVale} fotos=${datos.fotos ?? []} espacios=${espacios} alCambiar=${(fotos) => alCambiar({ ...datos, fotos })} />` : null;
}

export function ListaErrores({ errores }) {
  if (!errores.length) return null;
  return html`<${Aviso} tipo="error" titulo="Falta completar">
    <ul>${errores.map((e) => html`<li>${e.mensaje}</li>`)}</ul>
  <//>`;
}

// ---------------------------------------------------------------- vista previa

export function VistaPrevia({ vales, alCerrar }) {
  const sesion = useSesion();
  const [documento, setDocumento] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    sesion
      .documentoVales(vales)
      .then(setDocumento)
      .catch((e) => setError(e.message));
  }, []);
  return html`<div class="vista-previa" role="dialog" aria-modal="true" aria-label="Vista previa del vale">
    <div class="vista-barra">
      <strong>Vista previa (${vales.length === 1 ? "1 hoja" : `${vales.length} hojas`}, tamaño carta)</strong>
      <div class="acciones-linea">
        <${Boton} tipo="primario" onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirVales(vales))}>🖨 Imprimir / Guardar PDF<//>
        <${Boton} onClick=${alCerrar}>Cerrar<//>
      </div>
    </div>
    <div class="vista-hojas">
      ${error ? html`<${Aviso} tipo="error" titulo="No se pudo preparar la impresión">${error}<//>` : null}
      ${documento
        ? html`<style>${documento.css}</style><div dangerouslySetInnerHTML=${{ __html: documento.html }}></div>`
        : !error
          ? html`<p class="nota">Preparando…</p>`
          : null}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- página

function EmitidoOk({ vales, alNuevo, alCopiar }) {
  const sesion = useSesion();
  const folios = vales.map((v) => v.folio).join(", ");
  return html`<${Tarjeta} titulo=${vales.length === 1 ? `✓ Vale ${folios} emitido` : `✓ Vales ${folios} emitidos`} clase="tarjeta-exito">
    <p>
      Quedó en el historial y ya descontó existencia. Imprímelo para las firmas; el vale firmado es el documento oficial.
    </p>
    <div class="acciones-linea">
      <${Boton} tipo="primario" tamano="grande" onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirVales(vales))}>🖨 Imprimir ${vales.length === 1 ? "vale" : "vales"}<//>
      ${vales.map((v) => html`<a class="boton boton-secundario" href=${`#vale/${v.id}`}>Ver vale ${v.folio}</a>`)}
      <${Boton} onClick=${alNuevo}>＋ Nuevo vale<//>
      <${Boton} onClick=${alCopiar}><${Icono} nombre="copiar" /> Desde un vale…<//>
    </div>
  <//>`;
}

export function PaginaValesSalida() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(() => sesion.tomarPestana("borradores") ?? estado.borradores[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [errores, setErrores] = useState([]);
  const [emitidos, setEmitidos] = useState(null);
  // "Deshacer" de un borrador descartado: se abre su pestaña.
  useEffect(() => {
    const abrir = () => {
      const id = sesion.tomarPestana("borradores");
      if (id === null) return;
      setEmitidos(null);
      setActivo(id);
    };
    window.addEventListener("borrador-restaurado", abrir);
    return () => window.removeEventListener("borrador-restaurado", abrir);
  }, []);
  const [capacidad, setCapacidad] = useState(null);
  const [copiando, setCopiando] = useState(false);
  const [espacios, setEspacios] = useState(0); // fotos que pide el formato del área (NOV)
  const [inicioMaterial, setInicioMaterial] = useState(null); // al ir del paso 3 a una partida: { uid, campo }
  const pendiente = useRef(null);
  const porGuardar = useRef(null);
  // Al cambiar de paso, el foco va al paso nuevo (y la página, arriba).
  const enfocarPaso = useRef(false);
  const contenedorPaso = useRef(null);
  useLayoutEffect(() => {
    if (!enfocarPaso.current) return;
    const foco = enfocarPaso.current;
    enfocarPaso.current = false;
    contenedorPaso.current?.focus({ preventScroll: true });
    irArriba();
    // «Corregir» desde el paso 3: el campo que lo arregla.
    if (typeof foco === "string") requestAnimationFrame(() => document.querySelector(foco)?.focus());
  });

  // Carga el borrador activo en el editor (solo al cambiar de pestaña).
  useEffect(() => {
    const b = buscarBorrador(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setErrores([]);
  }, [activo]);
  // Capacidad del formato impreso del área elegida y cuántas fotos pide.
  useEffect(() => {
    if (!datos) return;
    sesion
      .capacidadPara(datos)
      .then(setCapacidad)
      .catch(() => setCapacidad(null));
    sesion
      .espaciosFotos(datos)
      .then((e) => setEspacios(e.length))
      .catch(() => setEspacios(0));
  }, [datos?.id, datos?.plantilla_area_id, datos?.depto_destino]);

  const guardar = async (valor) => {
    clearTimeout(pendiente.current);
    pendiente.current = null;
    porGuardar.current = null;
    await sesion.almacen.modificar((e) => {
      const b = buscarBorrador(e, valor.id);
      if (b) Object.assign(b, structuredClone(valor), { actualizado_en: ahoraIso() });
    });
  };
  const cambiar = (valor) => {
    setDatos(valor);
    if (errores.length) setErrores(validarVale(estado, paraEmitir(estado, valor, sesion.usuario)).errores);
    clearTimeout(pendiente.current);
    porGuardar.current = valor;
    pendiente.current = setTimeout(() => guardar(valor).catch((e) => sesion.avisar("error", e.message)), 600);
  };
  // Al salir de la página, lo que faltaba por guardar se guarda en ese momento (no se descarta).
  useEffect(
    () => () => {
      if (pendiente.current && porGuardar.current) guardar(porGuardar.current).catch((e) => sesion.avisar("error", e.message));
    },
    [],
  );

  const nuevo = () =>
    sesion.tarea("Creando vale…", async () => {
      if (datos && pendiente.current) await guardar(datos);
      const creado = await sesion.almacen.modificar((e) => {
        const b = nuevoBorrador(e, { usuario: sesion.usuario });
        return b.id;
      });
      setEmitidos(null);
      setActivo(creado);
    });
  // Ronda 33: las partidas de una entrada (o de otro vale de salida) en un borrador nuevo.
  const desdeVale = (valeId) =>
    sesion.tarea("Creando vale de salida…", async () => {
      if (datos && pendiente.current) await guardar(datos);
      const creado = await crearSalidaDesdeVale(sesion, valeId);
      setCopiando(false);
      setEmitidos(null);
      setActivo(creado);
    });
  const cambiarPestana = async (id) => {
    if (datos && pendiente.current) await guardar(datos);
    setEmitidos(null);
    setActivo(id);
  };
  // Se descarta al momento y el aviso ofrece "Deshacer" (recupera el borrador tal como estaba).
  const descartar = () =>
    sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      porGuardar.current = null;
      const copia = structuredClone(datos);
      const indice = await sesion.almacen.modificar((e) => {
        const i = e.borradores.findIndex((b) => b.id === datos.id);
        descartarBorrador(e, datos.id);
        return i;
      });
      setActivo(sesion.estado.borradores[0]?.id ?? null);
      const n = lineasCapturadas(copia.lineas).length;
      sesion.avisar("info", `Borrador descartado${n ? ` (${n} ${n === 1 ? "partida" : "partidas"})` : ""}. No gastó folio.`, 15000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.restaurarBorrador("borradores", copia, indice, "vales"),
      });
    });
  const emitir = () =>
    sesion.tarea("Emitiendo…", async () => {
      const listo = paraEmitir(sesion.estado, datos, sesion.usuario);
      const { errores: faltan } = validarVale(sesion.estado, listo);
      setErrores(faltan);
      if (faltan.length) return;
      const capacidadFormato = await sesion.capacidadPara(datos);
      let dividir = false;
      if (listo.lineas.length > capacidadFormato) {
        const hojas = Math.ceil(listo.lineas.length / capacidadFormato);
        if (!confirmar(`El formato impreso de esta área admite ${capacidadFormato} partidas y el vale tiene ${listo.lineas.length}. ¿Dividirlo en ${hojas} vales con folios consecutivos?`)) return;
        dividir = true;
      }
      const folio = siguienteFolio(sesion.estado);
      if (!confirmar(`¿Emitir el vale con el folio ${folio}${dividir ? " y siguientes" : ""}? El folio queda usado: después solo se puede corregir (con motivo).`)) return;
      clearTimeout(pendiente.current);
      pendiente.current = null;
      try {
        const vales = await sesion.almacen.modificar((e) => {
          const b = buscarBorrador(e, datos.id);
          Object.assign(b, structuredClone(datos));
          return emitirBorrador(e, datos.id, { usuario: sesion.usuario, capacidad: capacidadFormato, dividir });
        });
        setEmitidos(vales);
        setActivo(sesion.estado.borradores[0]?.id ?? null);
        sesion.avisar("exito", `Vale ${vales.map((v) => v.folio).join(", ")} emitido.`);
      } catch (error) {
        if (error instanceof ErrorVale) {
          setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
          return;
        }
        throw error;
      }
    });

  const borradores = estado.borradores;
  // Sin área todavía: "Borrador 1", "Borrador 2"… (varios "Sin área" no se distinguían).
  const nombreDe = (b, i) => estado.plantillas_area.find((p) => p.id === b.plantilla_area_id)?.nombre ?? `Borrador ${i + 1}`;
  const folio = siguienteFolio(estado);
  const paso = datos ? pasoDe(datos) : 1;
  const falta = datos ? faltaParaAvanzar(estado, datos, paso) : [];

  // Ronda 34: cambiar de paso nunca borra nada; el paso se guarda con el borrador.
  const irA = (n, foco = null) => {
    enfocarPaso.current = foco ?? true;
    cambiar({ ...datos, paso: n });
  };
  // Lo que falta antes de emitir (paso 3) y a dónde lleva cada «Corregir».
  const revision = datos && paso === 3 ? pendientesParaEmitir(estado, datos, { usuario: sesion.usuario, espacios }) : { pendientes: [], bloquea: 0 };
  const FOCO_PASO_1 = {
    recibio_nombre: "#quien-recibe",
    autorizo_nombre: "#quien-autoriza",
    etapa_perforacion: "#etapa-vale",
    depto_destino: "#paso-vale .rejilla-opciones button[tabindex='0']",
    fecha: "#paso-vale .boton-fecha",
  };
  const irAPendiente = (p) => {
    if (p.paso === 1) irA(1, FOCO_PASO_1[p.campo] ?? null);
    else if (p.paso === 2) {
      setInicioMaterial(p.uid ? { uid: p.uid, campo: p.campo } : null);
      irA(2);
    }
  };
  // Enter avanza; en el paso 3 emite (siempre con la confirmación del folio, como el clic).
  const listaAbierta = useRef(false);
  const teclaPaso = (e) => {
    if (!enterParaAvanzar(e, { abiertaAlPresionar: listaAbierta.current })) return;
    e.preventDefault();
    if (paso === 3) {
      if (lineasCapturadas(datos.lineas).length && !revision.bloquea) emitir();
    } else if (!falta.length) irA(paso + 1);
  };

  const pestanas = borradores.length
    ? html`<div class="franja-borradores">
        <div class="pestanas" role="tablist" aria-label="Vales en borrador">
          ${borradores.map((b, i) => {
            const actual = b.id === datos?.id ? datos : b;
            const n = lineasCapturadas(actual.lineas).length;
            const activa = b.id === activo && !emitidos;
            return html`<button type="button" role="tab" aria-selected=${activa} class=${`pestana ${activa ? "activa" : ""}`} onClick=${() => cambiarPestana(b.id)}>
              ${nombreDe(actual, i)}
              <span class="pastilla-conteo" title=${`${n} ${n === 1 ? "partida" : "partidas"}`}>${n}</span>
            </button>`;
          })}
        </div>
        <button type="button" class="pestana nueva" onClick=${nuevo}>＋ Nuevo vale</button>
        <button type="button" class="pestana nueva" onClick=${() => setCopiando(true)} title="Copia las partidas de una entrada o de otro vale de salida">
          <${Icono} nombre="copiar" tam=${15} /> Desde un vale…
        </button>
        ${!emitidos && datos ? html`<button type="button" class="boton boton-peligro-texto descartar-borrador" onClick=${descartar}>Descartar borrador</button>` : null}
      </div>`
    : null;

  let contenido = null;
  if (!emitidos && datos) {
    const area = estado.plantillas_area.find((p) => p.id === datos.plantilla_area_id) ?? null;
    const transferencia = (area ? tipoDeArea(area) : datos.naturaleza === "TRANSFERENCIA" ? "TRANSFERENCIA" : null) === "TRANSFERENCIA";
    const enTurno = sesion.usuario ? conEntregaEnTurno(estado, datos, sesion.usuario) : null;
    const resumen = {
      area: area?.nombre ?? (datos.depto_destino || null),
      transferencia,
      destino: datos.destino || null,
      recibe: datos.recibio_nombre,
      puesto: datos.recibio_puesto,
      fecha: fechaDelBorrador(datos),
      entrega: enTurno?.entrego_nombre ?? null,
      folio,
      // Ronda 35: en el paso 3 también se ve quién autoriza y la etapa, si el vale los lleva (ahí se marca si faltan).
      ...(paso === 3 ? { autoriza: requiereAutoriza(estado, datos) ? datos.autorizo_nombre || "" : null, etapa: pideEtapa(estado, datos) ? datos.etapa_perforacion || "" : null } : {}),
    };
    const paraQuien = html`<${ResumenParaQuien} datos=${resumen} alEditar=${() => irA(1)} />`;
    const capturadas = lineasCapturadas(datos.lineas);
    const avanzar = (etiqueta) => html`<${Boton} tipo="primario" tamano="grande" disabled=${falta.length > 0} onClick=${() => irA(paso + 1)}>
      ${etiqueta} <span class="tecla-boton" aria-hidden="true">Enter</span>
    <//>`;
    let cuerpo;
    if (paso === 1) {
      cuerpo = html`
        <${PasoParaQuien} datos=${datos} alCambiar=${cambiar} faltan=${falta} pie=${avanzar("Continuar a material →")} />`;
    } else if (paso === 2) {
      cuerpo = html`<${PasoMaterial}
        datos=${datos}
        alCambiar=${cambiar}
        resumen=${resumen}
        alEditar=${() => irA(1)}
        capacidad=${capacidad}
        alRegresar=${html`<${Boton} tamano="grande" onClick=${() => irA(1)}>← Para quién<//>`}
        avanzar=${avanzar("Revisar y emitir →")}
        inicio=${inicioMaterial}
        alUsarInicio=${() => setInicioMaterial(null)}
      />`;
    } else {
      const listo = paraEmitir(estado, datos, sesion.usuario);
      const indicesVale = new Indices(estado);
      const partidas = capturadas.map((l) => {
        const existencia = l.existencia_id !== null && l.existencia_id !== undefined ? indicesVale.existencia(l.existencia_id) : null;
        const variante = existencia ? indicesVale.variante(existencia.variante_id) : null;
        return {
          uid: l.uid,
          justificacion: l.justificacion ?? "",
          cantidad: normal(l.cantidad) ? l.cantidad : "",
          um: l.um,
          clave: l.clave,
          np: variante ? loteDeRenglon(npMostrado(existencia, variante)) : "",
          codigo: l.codigo,
          descripcion: l.descripcion,
          lote: normal(l.lote) ? l.lote : "",
          oc: normal(l.oc) ? l.oc : "",
        };
      });
      cuerpo = html`<${PasoEmitir}
        datos=${datos}
        alCambiar=${cambiar}
        listo=${listo}
        resumen=${resumen}
        partidas=${partidas}
        pendientes=${revision.pendientes}
        bloquea=${revision.bloquea}
        errores=${errores.filter((e) => e.campo === "vale")}
        capacidad=${capacidad}
        folio=${folio}
        alIrA=${irA}
        alIr=${irAPendiente}
        alEmitir=${emitir}
      />`;
    }
    contenido = html`
      <p class="linea-borrador">
        ${datos.copia_de
          ? html`<span class="copia-de">${datos.copia_de.tipo === "ENTRADA" ? "Partidas de la entrada " : "Partidas del vale "}<a
                href=${`#${datos.copia_de.tipo === "ENTRADA" ? "entrada" : "vale"}/${datos.copia_de.vale_id}`}>${datos.copia_de.folio}</a></span> · `
          : null}Se guarda solo
      </p>
      <${PasosVale} paso=${paso} />
      <div id="paso-vale" ref=${contenedorPaso} class=${`paso-vale paso-vale-${paso}`} tabindex="-1" aria-label=${`Paso ${paso} · ${nombrePaso(paso)}`}
        onKeyDownCapture=${(e) => (listaAbierta.current = enterAlBajar(e))} onKeyDown=${teclaPaso}>
        ${cuerpo}
      </div>`;
  }

  return html`
    ${pestanas}

    ${emitidos ? html`<${EmitidoOk} vales=${emitidos} alNuevo=${nuevo} alCopiar=${() => setCopiando(true)} />` : null}

    ${contenido}

    ${!emitidos && !datos && !borradores.length
      ? html`<${Tarjeta} clase="tarjeta-inicio-vales">
          <p>
            Cada vale se guarda solo como <strong>borrador</strong> mientras lo llenas y no gasta folio hasta que lo emites.
            Puedes tener varios abiertos a la vez.
          </p>
          <div class="acciones-linea">
            <${Boton} tipo="primario" tamano="grande" onClick=${nuevo}>＋ Nuevo vale · folio ${folio}<//>
            <${Boton} tamano="grande" onClick=${() => setCopiando(true)} title="Copia las partidas de una entrada o de otro vale de salida">
              <${Icono} nombre="copiar" /> Desde un vale…
            <//>
          </div>
          <p class="nota">
            ¿Recibiste material y ya se entregó? <strong>Desde un vale…</strong> toma las partidas de su entrada (o repite un
            vale de salida) y solo eliges el área y ajustas las cantidades.
          </p>
        <//>`
      : null}

    ${copiando ? html`<${VentanaCopiarVale} alElegir=${desdeVale} alCerrar=${() => setCopiando(false)} />` : null}

  `;
}
