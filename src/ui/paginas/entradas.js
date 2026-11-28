import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ahoraIso, fechaDelDia, fmtFecha } from "../../nucleo/fechas.js";
import {
  ErrorEntrada,
  borradorEntrada,
  confirmarEntrada,
  descartarBorradorEntrada,
  folioEntrada,
  lineasEntradaCapturadas,
  nuevoBorradorEntrada,
  validarEntrada,
} from "../../servicios/entradas.js";

import { etiquetasDeEntrada } from "../../servicios/etiquetas.js";
import {
  PASOS_ENTRADA,
  antesDeRegistrar,
  faltaDeDondeViene,
  faltaParaAvanzarEntrada,
  nombrePasoEntrada,
  pasoDeEntrada,
} from "../../servicios/pasosEntrada.js";
import { siguienteFolio } from "../../servicios/vales.js";
import { Boton, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { irArriba } from "../desplazamiento.js";
import { Icono } from "../iconos.js";
import { hayAnimaciones } from "../tema.js";
import { PasoAcomodo } from "./acomodo.js";
import { FOCO_DE_DONDE_VIENE, PasoDeDondeViene, VentanaCopilotEntrada } from "./deDondeViene.js";
import { PasoMaterialEntrada } from "./materialEntrada.js";
import { PasoRegistrar } from "./registrarEntrada.js";
import { EtiquetasDeEntrada } from "./etiquetas.js";
import { PasosVale, enterAlBajar, enterParaAvanzar } from "./pasosVale.js";

const hay = (v) => v !== null && v !== undefined;

// ---------------------------------------------------------------- página

function ConfirmadaOk({ vale, alNueva }) {
  const sesion = useSesion();
  const [etiquetas, setEtiquetas] = useState(false);
  const renglones = vale.lineas.filter((l) => hay(l.existencia_id)).length;
  // Ronda 20: lo que entró lleva etiqueta; se sugiere hacerlas (una por pieza) sin salir de aquí.
  const propuestas = useMemo(() => {
    try {
      return etiquetasDeEntrada(sesion.estado, vale.id).filter((p) => p.incluir);
    } catch {
      return [];
    }
  }, [vale.id]);
  const cuantas = propuestas.reduce((t, p) => t + p.etiqueta.cantidad, 0);
  return html`<${Tarjeta} titulo=${`✓ Entrada ${folioEntrada(vale.folio)} registrada`} clase="tarjeta-exito">
    <p>
      ${vale.folio_externo ? html`Vale <strong>${vale.folio_externo}</strong>${vale.origen ? ` de ${vale.origen}` : ""}.${" "}` : null}Sumó al INGRESO de ${renglones}${" "}
      ${renglones === 1 ? "partida" : "partidas"} del inventario del <strong>${fmtFecha(fechaDelDia(vale))}</strong> (recibido). Queda en el historial de entradas.
    </p>
    ${propuestas.length
      ? html`<div class="sugerencia-etiquetas">
          <${Icono} nombre="etiqueta" tam=${22} />
          <span>
            <strong>¿Le hacemos sus etiquetas?</strong>
            <small>${propuestas.length} ${propuestas.length === 1 ? "partida" : "partidas"} · ${cuantas} ${cuantas === 1 ? "etiqueta" : "etiquetas"} (una por pieza; se ajusta antes de imprimir)</small>
          </span>
          <${Boton} tipo="primario" onClick=${() => setEtiquetas(true)}>Hacer etiquetas<//>
        </div>`
      : null}
    <div class="acciones-linea">
      <a class="boton boton-secundario" href=${`#entrada/${vale.id}`}>Ver entrada ${folioEntrada(vale.folio)}</a>
      <${Boton} tipo=${propuestas.length ? "secundario" : "primario"} onClick=${alNueva}>＋ Nueva entrada<//>
    </div>
    ${etiquetas ? html`<${EtiquetasDeEntrada} valeId=${vale.id} alCerrar=${() => setEtiquetas(false)} />` : null}
  <//>`;
}

/**
 * Ronda 39 (docs/14 §3): la entrada en 4 pasos — De dónde viene → Material → Acomodo → Revisar y registrar —, como el
 * vale de salida. El paso se guarda con el borrador; regresar nunca borra nada. Enter avanza (y en el 4 registra).
 */
export function PaginaValesEntrada() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(() => sesion.tomarPestana("borradores_entrada") ?? estado.borradores_entrada[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [confirmada, setConfirmada] = useState(null);
  const [ventanaIA, setVentanaIA] = useState(false);
  const [cerrandoIA, setCerrandoIA] = useState(false);
  // §11: lo que falta se marca al pulsar «Continuar» (o al traer de Copilot un vale sin esos datos).
  const [marcar, setMarcar] = useState(false);
  useEffect(() => {
    const abrir = () => {
      const id = sesion.tomarPestana("borradores_entrada");
      if (id === null) return;
      setConfirmada(null);
      setActivo(id);
    };
    window.addEventListener("borrador-restaurado", abrir);
    return () => window.removeEventListener("borrador-restaurado", abrir);
  }, []);
  const pendiente = useRef(null);
  const porGuardar = useRef(null);
  // Al cambiar de paso: el foco al paso (o al campo que se pidió) y el área de trabajo arriba.
  const enfocarPaso = useRef(false);
  const contenedorPaso = useRef(null);
  useLayoutEffect(() => {
    if (!enfocarPaso.current) return;
    const foco = enfocarPaso.current;
    enfocarPaso.current = false;
    contenedorPaso.current?.focus({ preventScroll: true });
    irArriba();
    if (typeof foco === "string") requestAnimationFrame(() => document.querySelector(foco)?.focus());
  });

  useEffect(() => {
    const b = borradorEntrada(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setMarcar(false);
  }, [activo]);

  const guardar = async (valor) => {
    clearTimeout(pendiente.current);
    pendiente.current = null;
    porGuardar.current = null;
    await sesion.almacen.modificar((e) => {
      const b = borradorEntrada(e, valor.id);
      if (b) Object.assign(b, structuredClone(valor), { actualizado_en: ahoraIso() });
    });
  };
  const cambiar = (valor) => {
    setDatos(valor);
    clearTimeout(pendiente.current);
    porGuardar.current = valor;
    pendiente.current = setTimeout(() => guardar(valor).catch((e) => sesion.avisar("error", e.message)), 600);
  };
  useEffect(
    () => () => {
      if (pendiente.current && porGuardar.current) guardar(porGuardar.current).catch((e) => sesion.avisar("error", e.message));
    },
    [],
  );
  const validacion = useMemo(
    () => (datos ? validarEntrada(estado, { ...datos, recibio_nombre: sesion.usuario || datos.recibio_nombre }) : { errores: [], avisos: [] }),
    [estado, datos, sesion.usuario],
  );

  const paso = datos ? pasoDeEntrada(datos) : 1;
  const faltan = datos ? faltaParaAvanzarEntrada(estado, datos, paso, { usuario: sesion.usuario }) : [];
  const revision = useMemo(() => (datos && paso === 4 ? antesDeRegistrar(estado, datos, { usuario: sesion.usuario }) : null), [estado, datos, paso, sesion.usuario]);
  const irA = (n, foco = null) => {
    enfocarPaso.current = foco ?? true;
    setMarcar(false);
    cambiar({ ...datos, paso: n });
  };
  // Lo que falta del encabezado se corrige en el paso 1, marcado y con el foco en el campo.
  const alPaso1 = (campo, valor = datos) => {
    enfocarPaso.current = FOCO_DE_DONDE_VIENE[campo] ?? true;
    setMarcar(true);
    cambiar({ ...valor, paso: 1 });
  };
  // «Continuar» del paso 1 y del 2 no se deshabilita (§11): si falta algo, lo dice y lleva al primero.
  const continuar = () => {
    if (!faltan.length) {
      irA(paso + 1);
      return;
    }
    setMarcar(true);
    if (paso === 1) document.querySelector(FOCO_DE_DONDE_VIENE[faltan[0].campo])?.focus();
    else if (paso === 2) document.getElementById("buscar-material")?.focus();
  };
  // Lo que impide registrar lleva a su paso y a su partida o campo (§7).
  const irAPendiente = (p) => {
    if (p.paso === 1) return alPaso1(p.campo);
    if (p.paso === 3) return irA(3);
    const foco = p.uid ? (p.campo === "cantidad" ? `#cant-${p.uid}` : `[data-partida="${p.uid}"] .boton-editar`) : null;
    irA(2, foco);
  };

  const nueva = () =>
    sesion.tarea("Creando entrada…", async () => {
      if (datos && pendiente.current) await guardar(datos);
      const creada = await sesion.almacen.modificar((e) => nuevoBorradorEntrada(e, { usuario: sesion.usuario }).id);
      setConfirmada(null);
      setActivo(creada);
    });
  const cambiarPestana = async (id) => {
    if (datos && pendiente.current) await guardar(datos);
    setConfirmada(null);
    setActivo(id);
  };
  const descartar = () =>
    sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      porGuardar.current = null;
      const copia = structuredClone(datos);
      const indice = await sesion.almacen.modificar((e) => {
        const i = e.borradores_entrada.findIndex((b) => b.id === datos.id);
        descartarBorradorEntrada(e, datos.id);
        return i;
      });
      setActivo(sesion.estado.borradores_entrada[0]?.id ?? null);
      const n = lineasEntradaCapturadas(copia.lineas).length;
      sesion.avisar("info", `Entrada en borrador descartada${n ? ` (${n} ${n === 1 ? "partida" : "partidas"})` : ""}. No gastó folio.`, 15000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.restaurarBorrador("borradores_entrada", copia, indice, "entradas"),
      });
    });
  const registrar = () =>
    sesion.tarea("Registrando entrada…", async () => {
      const listo = { ...datos, recibio_nombre: sesion.usuario || datos.recibio_nombre };
      const { errores } = validarEntrada(sesion.estado, listo);
      if (errores.length) {
        const r = antesDeRegistrar(sesion.estado, datos, { usuario: sesion.usuario });
        if (r.bloquean[0]) irAPendiente(r.bloquean[0]);
        return;
      }
      const folio = folioEntrada(siguienteFolio(sesion.estado, "ENTRADA"));
      const n = lineasEntradaCapturadas(datos.lineas).length;
      const dia = fmtFecha(listo.fecha_recibido);
      if (!confirmar(`¿Registrar la entrada ${folio} con ${n} ${n === 1 ? "partida" : "partidas"}? Suma al inventario del ${dia} (recibido); después solo se puede corregir (con motivo).`)) return;
      clearTimeout(pendiente.current);
      pendiente.current = null;
      try {
        const vale = await sesion.almacen.modificar((e) => {
          Object.assign(borradorEntrada(e, datos.id), structuredClone(datos));
          return confirmarEntrada(e, datos.id, { usuario: sesion.usuario });
        });
        setConfirmada(vale);
        setActivo(sesion.estado.borradores_entrada[0]?.id ?? null);
        sesion.avisar("exito", `Entrada ${folioEntrada(vale.folio)} registrada.`);
      } catch (error) {
        if (!(error instanceof ErrorEntrada)) throw error;
        sesion.avisar("error", error.message);
      }
    });
  // Enter avanza; en el paso 4 registra (siempre con la confirmación del folio, como el clic).
  const listaAbierta = useRef(false);
  const teclaPaso = (e) => {
    if (!enterParaAvanzar(e, { abiertaAlPresionar: listaAbierta.current })) return;
    e.preventDefault();
    if (paso === 4) {
      if (revision && !revision.bloquean.length) registrar();
    } else if (paso === 3) {
      if (!faltan.length) irA(4);
    } else continuar();
  };
  // «Ver las partidas →» de *Llenar con Copilot* (§4.1): lo leído entra al borrador (las partidas, después de las que
  // ya había). Desde el paso 1 lleva al 2 si ya está lo que pide el 1; si no, se queda en el 1 con lo que falta marcado.
  const aplicarCopilot = (leido) => {
    const nuevo = { ...leido.datos, modo: "asistida" };
    const falta = faltaDeDondeViene(sesion.estado, nuevo, { usuario: sesion.usuario });
    const terminar = () => {
      setVentanaIA(false);
      setCerrandoIA(false);
      if (paso !== 1) cambiar(nuevo);
      else if (falta.length) alPaso1(falta[0].campo, nuevo);
      else {
        enfocarPaso.current = true;
        setMarcar(false);
        cambiar({ ...nuevo, paso: 2 });
      }
    };
    if (hayAnimaciones()) {
      setCerrandoIA(true);
      setTimeout(terminar, 380);
    } else terminar();
  };

  const borradores = estado.borradores_entrada;
  const folio = folioEntrada(siguienteFolio(estado, "ENTRADA"));
  const nombreDe = (b, i) => (b.folio_externo ? `Vale ${b.folio_externo}` : b.origen ? `De ${b.origen}` : borradores.length > 1 ? `Entrada ${i + 1}` : "Entrada nueva");

  const pestanas = borradores.length
    ? html`<div class="franja-borradores">
        <div class="pestanas" role="tablist" aria-label="Entradas en borrador">
          ${borradores.map((b, i) => {
            const actual = b.id === datos?.id ? datos : b;
            const n = lineasEntradaCapturadas(actual.lineas).length;
            const activa = b.id === activo && !confirmada;
            return html`<button type="button" role="tab" aria-selected=${activa} class=${`pestana ${activa ? "activa" : ""}`} onClick=${() => cambiarPestana(b.id)}>
              ${nombreDe(actual, i)}
              <span class="pastilla-conteo" title=${`${n} ${n === 1 ? "partida" : "partidas"}`}>${n}</span>
            </button>`;
          })}
        </div>
        <button type="button" class="pestana nueva" onClick=${nueva}>＋ Nueva entrada</button>
        ${!confirmada && datos ? html`<button type="button" class="boton boton-peligro-texto descartar-borrador" onClick=${descartar}>Descartar borrador</button>` : null}
      </div>`
    : null;

  let contenido = null;
  if (!confirmada && datos) {
    const boton = (etiqueta, deshabilitado = false) => html`<${Boton} tipo="primario" tamano="grande" disabled=${deshabilitado} onClick=${continuar}>
      ${etiqueta} <span class="tecla-boton" aria-hidden="true">Enter</span>
    <//>`;
    let cuerpo;
    if (paso === 1) {
      cuerpo = html`<${PasoDeDondeViene}
        datos=${datos}
        alCambiar=${cambiar}
        faltan=${faltan}
        marcar=${marcar}
        avisos=${validacion.avisos}
        alCopilot=${() => setVentanaIA(true)}
        pie=${boton("Continuar a material →")}
      />`;
    } else if (paso === 2) {
      cuerpo = html`<${PasoMaterialEntrada}
        datos=${datos}
        alCambiar=${cambiar}
        alEditarOrigen=${() => irA(1)}
        alCopilot=${() => setVentanaIA(true)}
        alRegresar=${html`<${Boton} tamano="grande" onClick=${() => irA(1)}>← De dónde viene<//>`}
        avanzar=${boton("Continuar a acomodo →")}
        falta=${marcar && faltan.length ? faltan[0].mensaje : null}
      />`;
    } else if (paso === 3) {
      cuerpo = html`<${PasoAcomodo}
        datos=${datos}
        alCambiar=${cambiar}
        alRegresar=${html`<${Boton} tamano="grande" onClick=${() => irA(2)}>← Material<//>`}
        avanzar=${html`<${Boton} tipo="primario" tamano="grande" disabled=${faltan.length > 0} onClick=${() => irA(4)}>
          Revisar y registrar → <span class="tecla-boton" aria-hidden="true">Enter</span>
        <//>`}
      />`;
    } else {
      cuerpo = html`<${PasoRegistrar} datos=${datos} folio=${folio} revision=${revision} alRegistrar=${registrar} alIrA=${(n) => irA(n)} alIr=${irAPendiente} />`;
    }
    contenido = html`
      <p class="linea-borrador">Se registrará como <strong>${folio}</strong>${paso < 4 ? " · Se guarda solo" : ""}</p>
      <${PasosVale} paso=${paso} lista=${PASOS_ENTRADA} etiqueta="Pasos de la entrada" />
      <div id="paso-entrada" ref=${contenedorPaso} class=${`paso-vale paso-entrada paso-entrada-${paso}`} tabindex="-1"
        aria-label=${`Paso ${paso} · ${nombrePasoEntrada(paso)}`}
        onKeyDownCapture=${(e) => (listaAbierta.current = enterAlBajar(e))} onKeyDown=${teclaPaso}>
        ${cuerpo}
      </div>
      ${ventanaIA ? html`<${VentanaCopilotEntrada} datos=${datos} cerrando=${cerrandoIA} alAplicar=${aplicarCopilot} alCerrar=${() => setVentanaIA(false)} />` : null}`;
  }

  return html`
    ${pestanas}

    ${confirmada ? html`<${ConfirmadaOk} vale=${confirmada} alNueva=${nueva} />` : null}

    ${contenido}

    ${!confirmada && !datos && !borradores.length
      ? html`<${Tarjeta} clase="tarjeta-inicio-vales">
          <p>
            Registra el material que llega de la base o de otro equipo, a mano o desde la foto del vale con Copilot: de
            dónde viene, qué material es, en qué contenedor se guarda y listo.
          </p>
          <${Boton} tipo="primario" tamano="grande" onClick=${nueva}>＋ Nueva entrada · ${folio}<//>
        <//>`
      : null}
  `;
}
