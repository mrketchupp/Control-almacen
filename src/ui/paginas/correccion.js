// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §8): corregir un vale de salida o una entrada abre directo en la
// revisión. Arriba, la franja azul («Corrigiendo el vale N»); a la izquierda las secciones del flujo nuevo con «Editar»
// (salida: *Para quién* y *Material*; entrada: *De dónde viene*, *Material* y *Dónde quedó cada partida*), con lo que
// cambió en ámbar; a la derecha la tarjeta *Cambios · N* con el motivo, *Guardar* y *Cancelar*. «Editar» abre ese paso
// en modo corrección (los mismos componentes; su botón dice *Listo* y regresa a la revisión). Nada cambia hasta Guardar.

import { useMemo, useState } from "preact/hooks";
import { Indices, npMostrado } from "../../nucleo/estado.js";
import { hoyIso } from "../../nucleo/fechas.js";
import { efectosEnInventario, encabezadoCambiado, partidasCambiadas } from "../../servicios/correccion.js";
import { ErrorEntrada, corregirEntrada, datosParaCorregirEntrada, folioEntrada, lineasEntradaCapturadas, resumenCambiosEntrada, validarEntrada } from "../../servicios/entradas.js";
import { camposDeLinea } from "../../servicios/materialEntrada.js";
import { faltaDeDondeViene } from "../../servicios/pasosEntrada.js";
import { esTransferencia } from "../../servicios/pasosVale.js";
import {
  ErrorVale,
  corregirVale,
  datosParaCorregir,
  esHistorial,
  fechaDelBorrador,
  lineasCapturadas,
  loteDeRenglon,
  pideEtapa,
  plantillaArea,
  requiereAutoriza,
  resumenCambios,
  validarVale,
} from "../../servicios/vales.js";
import { Boton, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { PasoAcomodo } from "./acomodo.js";
import { FOCO_DE_DONDE_VIENE, PasoDeDondeViene } from "./deDondeViene.js";
import { PasoMaterial } from "./material.js";
import { PasoMaterialEntrada } from "./materialEntrada.js";
import { PasoParaQuien } from "./paraQuien.js";
import { ResumenMaterial, ResumenParaQuien } from "./pasosVale.js";
import { DondeQuedo, ResumenOrigenEntrada } from "./registrarEntrada.js";
import { EditorVale, ListaErrores } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const hay = (v) => v !== null && v !== undefined;

/** «Corrigiendo el vale 7 · Nada cambia hasta «Guardar»…» (sin botones, §8). */
export function FranjaCorreccion({ que }) {
  return html`<div class="franja-correccion" role="status">
    <span class="franja-correccion-icono" aria-hidden="true"><${Icono} nombre="lapiz" tam=${18} /></span>
    <span class="franja-correccion-texto">
      <strong>Corrigiendo ${que}</strong>
      <span>Nada cambia hasta «Guardar». El folio no cambia y la corrección queda en la bitácora.</span>
    </span>
  </div>`;
}

/**
 * *Cambios · N* (§8): lo que cambió (las frases de la bitácora), su efecto en el inventario, el motivo (se llena solo
 * con los cambios; si se edita, se respeta) y **Guardar** / **Cancelar**. Sin cambios, *Guardar* no se puede pulsar.
 */
function TarjetaCambios({ cambios, efectos = [], avisos = [], motivo, propio, alMotivo, alRestaurar, errores, alGuardar, alCancelar }) {
  return html`<aside class="tarjeta-cambios" aria-labelledby="t-cambios">
    <h2 id="t-cambios">Cambios · ${cambios.length}</h2>
    ${cambios.length
      ? html`<ul class="lista-cambios">${cambios.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>`
      : html`<p class="nota sin-cambios">No has cambiado nada.</p>`}
    ${efectos.length
      ? html`<div class="efectos-cambios">
          <span class="etiqueta-grupo">En el inventario</span>
          <ul>${efectos.map((e, i) => html`<li key=${i}>${e}</li>`)}</ul>
        </div>`
      : null}
    ${avisos.length ? html`<ul class="avisos-cambios">${avisos.map((a, i) => html`<li key=${i}>⚠ ${a}</li>`)}</ul>` : null}
    <label class="campo motivo-cambios">
      <span class="etiqueta-grupo">Motivo · se llena solo, puedes agregar el porqué</span>
      <textarea rows=${Math.min(8, Math.max(3, motivo.split("\n").length + 1))} value=${motivo} aria-label="Motivo de la corrección"
        placeholder="Cambia algo y aquí aparece qué cambió." onInput=${(e) => alMotivo(e.currentTarget.value)}></textarea>
    </label>
    ${propio ? html`<button type="button" class="enlace-boton" onClick=${alRestaurar}>↺ Volver a llenarlo con los cambios</button>` : null}
    <${ListaErrores} errores=${errores} />
    <${Boton} tipo="primario" tamano="grande" disabled=${!cambios.length} onClick=${alGuardar}>Guardar<//>
    <${Boton} tamano="grande" onClick=${alCancelar}>Cancelar<//>
  </aside>`;
}

/** El botón del pie en modo corrección: regresa a la revisión. */
const BotonListo = ({ alHacer }) => html`<${Boton} tipo="primario" tamano="grande" onClick=${alHacer}>Listo<//>`;

// ---------------------------------------------------------------- vale de salida

/**
 * Corregir un vale de salida. Con `quitar` (ids de partidas) empieza ya sin ellas: así se quitan las duplicadas y el
 * motivo dice por qué. Un vale anterior al conteo o migrado (`esHistorial`) solo cambia el historial y el DIARIO: sus
 * partidas sin ligar al inventario se ven en gris.
 */
export function CorreccionSalida({ vale, alTerminar, quitar = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const [original] = useState(() => datosParaCorregir(estado, vale.id));
  const [datos, setDatos] = useState(() => (quitar ? { ...original, lineas: original.lineas.filter((l) => !quitar.has(l.id)) } : original));
  const [seccion, setSeccion] = useState(null); // null = la revisión; "quien" | "material"
  const [motivoPropio, setMotivoPropio] = useState(null);
  const [errores, setErrores] = useState([]);
  const historial = esHistorial(estado, vale);
  const cambios = useMemo(() => resumenCambios(estado, vale, datos), [datos, vale]);
  const automatico = [quitar ? "Partidas duplicadas: el formulario de Excel guardó el vale dos veces." : "", ...cambios].filter(Boolean).join("\n");
  const motivo = motivoPropio ?? automatico;
  const efectos = useMemo(() => efectosEnInventario(estado, vale, datos, { indices, historial }), [estado, datos, vale]);
  const guardar = () =>
    sesion.tarea("Guardando corrección…", async () => {
      const faltan = [...validarVale(sesion.estado, datos, { excluirValeId: vale.id, historial }).errores];
      if (!motivo.trim()) faltan.push({ renglon: null, campo: "motivo", mensaje: "Escribe el motivo de la corrección." });
      setErrores(faltan);
      if (faltan.length) return;
      try {
        await sesion.almacen.modificar((e) => corregirVale(e, vale.id, datos, motivo, sesion.usuario));
        sesion.avisar("exito", `Vale ${vale.folio} corregido. Queda en la bitácora.`);
        alTerminar();
      } catch (error) {
        if (error instanceof ErrorVale) setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
        else throw error;
      }
    });

  const area = plantillaArea(estado, datos.plantilla_area_id);
  const resumen = {
    // Un vale migrado sin área reconocida muestra el destino y el departamento que trae (§8).
    area: area?.nombre ?? ([texto(datos.destino), texto(datos.depto_destino)].filter(Boolean).join(" · ") || null),
    transferencia: esTransferencia(estado, datos),
    destino: datos.destino || null,
    recibe: datos.recibio_nombre,
    puesto: datos.recibio_puesto,
    autoriza: requiereAutoriza(estado, datos) || texto(datos.autorizo_nombre) ? datos.autorizo_nombre || "" : null,
    etapa: pideEtapa(estado, datos) ? datos.etapa_perforacion || "" : null,
    fecha: fechaDelBorrador(datos),
    entrega: datos.entrego_nombre || null,
    folio: vale.folio,
    emitido: true,
  };
  const listo = () => setSeccion(null);
  const que = `el vale ${vale.folio}`;

  if (seccion === "quien") {
    return html`<${FranjaCorreccion} que=${que} />
      <div class="paso-vale paso-vale-1 paso-correccion">
        <${PasoParaQuien} datos=${datos} alCambiar=${setDatos} correccion=${true} pie=${html`<${BotonListo} alHacer=${listo} />`} />
      </div>`;
  }
  if (seccion === "material") {
    return html`<${FranjaCorreccion} que=${que} />
      <div class="paso-vale paso-vale-2 paso-correccion">
        <${PasoMaterial}
          datos=${datos}
          alCambiar=${setDatos}
          resumen=${resumen}
          alEditar=${() => setSeccion("quien")}
          capacidad=${null}
          alRegresar=${null}
          avanzar=${html`<${BotonListo} alHacer=${listo} />`}
          excluirValeId=${vale.id}
          historial=${historial}
        />
      </div>`;
  }
  const lineas = lineasCapturadas(datos.lineas);
  const partidas = lineas.map((l) => {
    const existencia = hay(l.existencia_id) ? indices.existencia(l.existencia_id) : null;
    const variante = existencia ? indices.variante(existencia.variante_id) : null;
    return {
      uid: l.uid,
      justificacion: l.justificacion ?? "",
      cantidad: texto(l.cantidad),
      um: l.um,
      clave: l.clave,
      np: variante ? loteDeRenglon(npMostrado(existencia, variante)) : "",
      codigo: l.codigo,
      descripcion: l.descripcion,
      lote: texto(l.lote),
      oc: texto(l.oc),
      sinLigar: historial && !existencia && !l.no_inventariado,
    };
  });
  return html`<${FranjaCorreccion} que=${que} />
    <div class="correccion-layout">
      <div class="correccion-secciones">
        ${historial ? html`<p class="nota-correccion">Este vale es anterior al conteo: la corrección solo cambia el historial y el DIARIO.</p>` : null}
        <${ResumenParaQuien} datos=${resumen} alEditar=${() => setSeccion("quien")} cambiados=${encabezadoCambiado(original, datos)} />
        <${ResumenMaterial} partidas=${partidas} alEditar=${() => setSeccion("material")} cambios=${partidasCambiadas(lineasCapturadas(original.lineas), lineas)} />
        <${EditorVale} seccion="fotos" datos=${datos} alCambiar=${setDatos} />
      </div>
      <${TarjetaCambios}
        cambios=${cambios}
        efectos=${efectos}
        motivo=${motivo}
        propio=${motivoPropio !== null}
        alMotivo=${setMotivoPropio}
        alRestaurar=${() => setMotivoPropio(null)}
        errores=${errores}
        alGuardar=${guardar}
        alCancelar=${alTerminar}
      />
    </div>`;
}

// ---------------------------------------------------------------- entrada

/** Corregir una entrada: *De dónde viene*, *Material* y *Dónde quedó cada partida*, como el paso 4. */
export function CorreccionEntrada({ vale, alTerminar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const [original] = useState(() => datosParaCorregirEntrada(estado, vale.id));
  const [datos, setDatos] = useState(original);
  const [seccion, setSeccion] = useState(null); // null = la revisión; "origen" | "material" | "acomodo"
  const [marcar, setMarcar] = useState(false);
  const [motivoPropio, setMotivoPropio] = useState(null);
  const [errores, setErrores] = useState([]);
  const cambios = useMemo(() => resumenCambiosEntrada(estado, vale, datos), [datos, vale]);
  const vivo = useMemo(() => validarEntrada(estado, datos, { excluirValeId: vale.id }), [estado, datos, vale]);
  const efectos = useMemo(() => efectosEnInventario(estado, vale, datos, { indices }), [estado, datos, vale]);
  const motivo = motivoPropio ?? cambios.join("\n");
  // Recibido: no después del día en que se registró la entrada.
  const maxRecibido = texto(vale.emitido_en ?? vale.creado_en).slice(0, 10) || hoyIso();
  const faltanOrigen = faltaDeDondeViene(estado, datos, { excluirValeId: vale.id });
  const guardar = () =>
    sesion.tarea("Guardando corrección…", async () => {
      const faltan = [...validarEntrada(sesion.estado, datos, { excluirValeId: vale.id }).errores];
      if (!motivo.trim()) faltan.push({ renglon: null, campo: "motivo", mensaje: "Escribe el motivo de la corrección." });
      setErrores(faltan);
      if (faltan.length) return;
      try {
        await sesion.almacen.modificar((e) => corregirEntrada(e, vale.id, datos, motivo, sesion.usuario));
        sesion.avisar("exito", `Entrada ${folioEntrada(vale.folio)} corregida. Queda en la bitácora.`);
        alTerminar();
      } catch (error) {
        if (error instanceof ErrorEntrada) setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
        else throw error;
      }
    });
  const listo = () => {
    setMarcar(false);
    setSeccion(null);
  };
  const que = `la entrada ${folioEntrada(vale.folio)}`;

  if (seccion === "origen") {
    // Lo que falta de *De dónde viene* se marca al pulsar Listo, como Continuar en la captura.
    const listoOrigen = () => {
      if (!faltanOrigen.length) return listo();
      setMarcar(true);
      document.querySelector(FOCO_DE_DONDE_VIENE[faltanOrigen[0].campo])?.focus();
    };
    return html`<${FranjaCorreccion} que=${que} />
      <div id="paso-entrada" class="paso-vale paso-entrada paso-entrada-1 paso-correccion">
        <${PasoDeDondeViene}
          datos=${datos}
          alCambiar=${setDatos}
          faltan=${faltanOrigen}
          marcar=${marcar}
          avisos=${vivo.avisos}
          correccion=${{ excluirValeId: vale.id, maxRecibido }}
          pie=${html`<${BotonListo} alHacer=${listoOrigen} />`}
        />
      </div>`;
  }
  if (seccion === "material") {
    return html`<${FranjaCorreccion} que=${que} />
      <div class="paso-vale paso-entrada paso-entrada-2 paso-correccion">
        <${PasoMaterialEntrada}
          datos=${datos}
          alCambiar=${setDatos}
          alEditarOrigen=${() => setSeccion("origen")}
          alRegresar=${null}
          avanzar=${html`<${BotonListo} alHacer=${listo} />`}
        />
      </div>`;
  }
  if (seccion === "acomodo") {
    return html`<${FranjaCorreccion} que=${que} />
      <div class="paso-vale paso-entrada paso-entrada-3 paso-correccion">
        <${PasoAcomodo} datos=${datos} alCambiar=${setDatos} alRegresar=${null} avanzar=${html`<${BotonListo} alHacer=${listo} />`} excluirValeId=${vale.id} />
      </div>`;
  }
  const lineas = lineasEntradaCapturadas(datos.lineas);
  const cambiadas = partidasCambiadas(lineasEntradaCapturadas(original.lineas), lineas);
  const partidas = lineas.map((l) => {
    const c = camposDeLinea(l, indices);
    return {
      uid: l.uid,
      cantidad: texto(l.cantidad),
      um: l.um,
      clave: l.no_inventariado ? texto(l.clave) || "S/D" : c.dimension || "S/D",
      np: l.no_inventariado ? "" : c.np,
      codigo: l.codigo,
      descripcion: l.descripcion,
      lote: texto(l.lote),
      oc: texto(l.oc),
    };
  });
  return html`<${FranjaCorreccion} que=${que} />
    <div class="correccion-layout">
      <div class="correccion-secciones">
        <${ResumenOrigenEntrada} datos=${datos} alEditar=${() => setSeccion("origen")} marcados=${encabezadoCambiado(original, datos, "ENTRADA")} />
        <${ResumenMaterial} partidas=${partidas} alEditar=${() => setSeccion("material")} cambios=${cambiadas} />
        <${DondeQuedo} datos=${datos} alEditar=${() => setSeccion("acomodo")} excluirValeId=${vale.id} cambiadas=${new Set(cambiadas.keys())} />
      </div>
      <${TarjetaCambios}
        cambios=${cambios}
        efectos=${efectos}
        avisos=${vivo.avisos.filter((a) => a.campo === "cantidad").map((a) => a.mensaje)}
        motivo=${motivo}
        propio=${motivoPropio !== null}
        alMotivo=${setMotivoPropio}
        alRestaurar=${() => setMotivoPropio(null)}
        errores=${errores}
        alGuardar=${guardar}
        alCancelar=${alTerminar}
      />
    </div>`;
}
