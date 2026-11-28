import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { ahoraIso, fechaDelDia, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import {
  ErrorEntrada,
  borradorEntrada,
  conClaveEscrita,
  conClaveYNp,
  conContenedor,
  conMaterialNuevo,
  conNpEscrito,
  conRenglonExistente,
  confirmarEntrada,
  contenedorDeLinea,
  datosDeDevolucion,
  descartarBorradorEntrada,
  destinosDeCodigo,
  entradaConArticulo,
  entradaConFolioBase,
  folioEntrada,
  lineaEntradaVacia,
  lineasEntradaCapturadas,
  nuevoBorradorEntrada,
  opcionesEntraA,
  validarEntrada,
  vistaPreviaEntrada,
} from "../../servicios/entradas.js";
import { variantesParecidas } from "../../servicios/inventario.js";
import { etiquetasDeEntrada } from "../../servicios/etiquetas.js";
import { PASOS_ENTRADA, antesDeRegistrar, faltaDeDondeViene, faltaParaAvanzarEntrada, nombrePasoEntrada, pasoDeEntrada } from "../../servicios/pasosEntrada.js";
import { siguienteFolio } from "../../servicios/vales.js";
import { Boton, CampoSugerido, Combo, Lista, Pastilla, Tarjeta, Teclas, confirmar, num, useAtajo, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { irArriba } from "../desplazamiento.js";
import { Icono } from "../iconos.js";
import { hayAnimaciones } from "../tema.js";
import { PasoAcomodo } from "./acomodo.js";
import { FOCO_DE_DONDE_VIENE, PasoDeDondeViene, VentanaCopilotEntrada } from "./deDondeViene.js";
import { PasoMaterialEntrada } from "./materialEntrada.js";
import { PasoRegistrar } from "./registrarEntrada.js";
import { BotonDescripcion } from "./descripcion.js";
import { EtiquetasDeEntrada } from "./etiquetas.js";
import { PasosVale, enterAlBajar, enterParaAvanzar } from "./pasosVale.js";
import { CeldaCodigo, indiceArticulos, listas, normal, palabras, partidaConFoco } from "./vales.js";

const hay = (v) => v !== null && v !== undefined;
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ---------------------------------------------------------------- partes de una partida

/** Clave / dimensión: los renglones del inventario de ese código; si se escribe otra, es una variante nueva. */
function CeldaClave({ linea, opciones, alElegir, alEscribir, alSalir, error }) {
  const elegida = opciones.find((o) => o.id === linea.existencia_id) ?? null;
  const filtradas = useMemo(() => {
    const q = normal(linea.clave);
    if (!q || (elegida && normal(elegida.clave) === q)) return opciones;
    return opciones.filter((o) => palabras(q).every((p) => normal(`${o.clave} ${o.np ?? ""} ${o.lugar} ${o.hoja} ${o.fx ? "FX" : ""}`).includes(p)));
  }, [opciones, linea.clave, elegida]);
  if (!Number.isInteger(linea.codigo)) return html`<input class="entrada-clave" disabled placeholder="Primero el código" aria-label="Clave / dimensión" />`;
  return html`<${Combo}
    id=${`eclv-${linea.uid}`}
    clase=${error ? "con-error" : ""}
    valor=${linea.clave}
    alEscribir=${alEscribir}
    opciones=${filtradas}
    clave=${(o) => o.id}
    render=${(o) => html`<span class="opcion-principal">${o.clave}</span>
      ${o.np ? html`<${Pastilla} titulo="Número de parte">NP ${o.np}<//>` : null}
      ${o.fx ? html`<${Pastilla} tono="fx" titulo="Material de FX: se descuenta en AX de su propio almacén">FX<//>` : null}
      <${Pastilla} tono="lugar" titulo=${o.hoja}>${o.lugar}<//>
      <${Pastilla} tono=${o.total > 0 ? "ok" : "alerta"}>hay ${num(o.total)} ${o.um}<//>
      ${o.sugerida && o.enVarios ? html`<${Pastilla} tono="info" titulo="Es el contenedor donde hay más de esta variante">★ sugerido<//>` : null}`}
    alElegir=${(o, mover = true) => alElegir(o, mover)}
    alSalir=${alSalir}
    placeholder=${linea.material_nuevo ? "Dimensión del material nuevo" : opciones.length ? "Elige o escribe" : "Escribe la clave"}
    autoMarcar=${!linea.material_nuevo}
    ariaLabel="Clave / dimensión"
  />`;
}

/** "Entra a": contenedor de la partida (donde ya tiene su renglón, uno nuevo o sin existencia). */
function SelectorEntraA({ linea, opciones, indices, faltaClave, error, alCambiar }) {
  const valor = contenedorDeLinea(linea, indices);
  const lista = [
    ...opciones.map((o) => ({
      valor: o.valor,
      etiqueta: o.etiqueta,
      render: () => html`<span class="opcion-principal">${o.etiqueta}</span>
        ${o.propio ? html`<${Pastilla} tono="ok">ya tiene su partida<//>` : html`<${Pastilla}>partida nueva<//>`}
        <span class="res-detalle">${o.detalle}</span>`,
    })),
    {
      valor: "sin",
      etiqueta: "Sin existencia",
      render: () => html`<span class="opcion-principal">Sin existencia</span><span class="res-detalle">Diésel, gases…: queda en el historial y no suma</span>`,
    },
  ];
  return html`<${Lista}
    id=${`entra-${linea.uid}`}
    clase=${`lista-entra ${error ? "con-error" : ""} ${valor === null ? "sin-elegir" : ""}`}
    valor=${valor ?? ""}
    opciones=${lista}
    deshabilitado=${!Number.isInteger(linea.codigo) || faltaClave}
    ariaLabel="Entra a (contenedor)"
    titulo=${faltaClave ? "Primero elige o escribe la clave" : "A qué contenedor del inventario entra"}
    mostrar=${(actual) =>
      html`<span class="entra-valor">
        <${Icono} nombre="caja" tam=${15} />
        ${actual ? html`<strong>${actual.etiqueta}</strong>` : html`<span class="lista-vacia">${faltaClave ? "Primero la clave" : Number.isInteger(linea.codigo) ? "¿A qué contenedor?" : "—"}</span>`}
      </span>`}
    alCambiar=${alCambiar}
  />`;
}

/** Cuánto había y cuánto queda en el destino (o por qué no suma). */
function Indicador({ fila, linea }) {
  if (!fila) return null;
  const um = texto(linea.um);
  if (fila.tipo === "renglon") {
    const negativo = fila.queda && fila.queda.lt(0);
    return html`<span class=${`indicador ${negativo ? "indicador-alerta" : "indicador-ok"}`} title="Existencia de esa partida antes y después de esta entrada">
      hay ${num(aNumero(fila.habia))} <span aria-hidden="true">→</span> <strong>${fila.queda ? num(aNumero(fila.queda)) : "—"}</strong> ${um}
    </span>`;
  }
  if (fila.tipo === "nuevo") {
    return html`<span class="indicador indicador-info" title="Se agrega al final de esa hoja del inventario">
      partida nueva <span aria-hidden="true">→</span> <strong>${fila.queda ? num(aNumero(fila.queda)) : "0"}</strong> ${um}
    </span>`;
  }
  if (fila.tipo === "sin_existencia") return html`<span class="indicador">no suma al inventario</span>`;
  if (fila.tipo === "invalido") return html`<span class="indicador indicador-error">el destino ya no existe</span>`;
  return Number.isInteger(linea.codigo) ? html`<span class="indicador indicador-error">falta a dónde entra</span>` : null;
}

/** Variantes parecidas a una clave nueva (para no duplicar): "¿Es la misma que …?". */
function Parecidas({ estado, indices, linea, alUsar }) {
  const parecidas = useMemo(
    () => variantesParecidas(estado, linea.codigo, { dimension: linea.dimension, np: linea.np, um: linea.um }, { indices }).filter((p) => p.lugares.length).slice(0, 3),
    [estado, linea.codigo, linea.dimension, linea.np, linea.um],
  );
  if (!parecidas.length) return null;
  return html`<div class="partida-sugerencia">
    <span>${parecidas[0].igual ? "Esa clave ya existe:" : "¿Es la misma que"}</span>
    ${parecidas.map(
      (p) => html`<button type="button" class="chip-sugerencia" onClick=${() => alUsar(p.variante)} title="Usar esa partida del inventario">
        ${[p.variante.dimension, p.variante.np ? `NP ${p.variante.np}` : ""].filter(Boolean).join(" · ") || "SIN DIMENSIÓN"} ${p.variante.um}
        <small>${p.lugares.join(", ")}</small>
      </button>`,
    )}
    ${parecidas[0].igual ? null : html`<span>?</span>`}
  </div>`;
}

// ---------------------------------------------------------------- editor

/**
 * Editor de una entrada (borrador nuevo o corrección de una confirmada): datos del vale arriba y
 * cada partida como una tarjeta de dos líneas (lo del vale | a dónde entra, quién solicita y O.C.).
 * @param excluirValeId  en una corrección, la entrada que se corrige
 * @param avisos   los de validarEntrada: los de la fecha de recibido se muestran junto a ella (no bloquean)
 * @param filtro   { etiqueta, uids, resueltas, alQuitar }: solo esas partidas (lo que requiere atención)
 * @param entrando las partidas aparecen escalonadas (al llegar de la captura con Copilot)
 * @param recientes uids recién cargados (se resaltan un momento)
 */
/**
 * El formulario de la entrada: encabezado y partidas. `sinEncabezado` (Ronda 39, paso 2 de la captura): solo las
 * partidas, porque el encabezado ya se llenó en *De dónde viene*. La corrección lo usa completo.
 */
export function EditorEntrada({ datos, alCambiar, errores = [], avisos = [], excluirValeId = null, pie = null, filtro = null, entrando = false, recientes = null, sinEncabezado = false }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const articulos = useMemo(() => indiceArticulos(estado, indices), [estado.articulos, estado.existencias]);
  const sugerencias = useMemo(() => listas(estado), [estado.personas, estado.plantillas_area]);
  const solicitantes = useMemo(
    () => [...new Set([...estado.vales.filter((v) => v.tipo === "ENTRADA").flatMap((v) => v.lineas.map((l) => l.lote)), ...sugerencias.personas].filter(Boolean))],
    [estado.vales, sugerencias],
  );
  const lugares = useMemo(
    () => [...new Set([...sugerencias.lugares, ...estado.vales.filter((v) => v.tipo === "ENTRADA").map((v) => v.origen)].filter(Boolean))],
    [sugerencias, estado.vales],
  );
  const errorEn = (campo, renglon = null) => errores.find((e) => e.campo === campo && e.renglon === renglon);
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });
  const [folioDevolucion, setFolioDevolucion] = useState(datos.devolucion_folio ? String(datos.devolucion_folio) : "");
  const [copiando, setCopiando] = useState(false);
  const [verObservaciones, setVerObservaciones] = useState(Boolean(texto(datos.observaciones)));

  const enfocar = useRef(null);
  useLayoutEffect(() => {
    if (!enfocar.current) return;
    const campo = document.getElementById(enfocar.current);
    if (campo) {
      campo.focus();
      campo.select?.();
      enfocar.current = null;
    }
  });
  const cambiarLinea = (uid, cambio, siguiente = null) => {
    if (siguiente) enfocar.current = siguiente;
    let cambio_ = false;
    const lineas = datos.lineas.map((l) => {
      if (l.uid !== uid) return l;
      const nueva = typeof cambio === "function" ? cambio(l) : { ...l, ...cambio };
      if (nueva !== l) cambio_ = true;
      return nueva;
    });
    if (cambio_) cambiar({ lineas });
  };
  // Tras corregir la descripción de un código en el catálogo, sus partidas de esta entrada la toman también.
  const conDescripcion = (codigo, descripcion) => cambiar({ lineas: datos.lineas.map((l) => (l.codigo === codigo ? { ...l, descripcion } : l)) });
  const agregarLinea = (tras = null) => {
    const nueva = lineaEntradaVacia();
    enfocar.current = `cod-${nueva.uid}`;
    const lineas = [...datos.lineas];
    const i = tras ? lineas.findIndex((l) => l.uid === tras) : -1;
    lineas.splice(i >= 0 ? i + 1 : lineas.length, 0, nueva);
    cambiar({ lineas });
  };
  const siguienteFila = (uid) => {
    const i = datos.lineas.findIndex((l) => l.uid === uid);
    const siguiente = datos.lineas[i + 1];
    if (siguiente) document.getElementById(`cod-${siguiente.uid}`)?.focus();
    else agregarLinea(uid);
  };
  const quitar = (uid) => cambiar({ lineas: datos.lineas.filter((l) => l.uid !== uid) });
  // Alt+N: partida nueva debajo de la que tiene el foco (o al final). Con un filtro puesto no se agrega.
  const raiz = useRef(null);
  useAtajo({ alt: true, codigo: "KeyN" }, () => !filtro && agregarLinea(partidaConFoco(raiz, datos.lineas)), raiz);
  const opcionesPorCodigo = useMemo(() => new Map(), [estado]);
  const opcionesDe = (codigo) => {
    if (!opcionesPorCodigo.has(codigo)) opcionesPorCodigo.set(codigo, destinosDeCodigo(estado, codigo, { indices, saldos }));
    return opcionesPorCodigo.get(codigo);
  };
  const previa = useMemo(() => vistaPreviaEntrada(estado, datos, { excluirValeId }), [estado, datos, excluirValeId]);
  const repetida = entradaConFolioBase(estado, datos.folio_externo, excluirValeId);
  // Material que regresa: copia las partidas de un vale de salida (cada una vuelve a su renglón).
  const copiarDeSalida = () => {
    try {
      const traidos = datosDeDevolucion(estado, folioDevolucion);
      if (lineasEntradaCapturadas(datos.lineas).length && !confirmar(`¿Cambiar las partidas de esta entrada por las del vale ${traidos.devolucion_folio}?`)) return;
      cambiar({ ...traidos, origen: datos.origen || traidos.origen, entrego_nombre: datos.entrego_nombre || traidos.entrego_nombre });
      setCopiando(false);
      sesion.avisar("exito", `Se copiaron las partidas del vale ${traidos.devolucion_folio}: ajusta las cantidades a lo que regresó.`);
    } catch (error) {
      if (error instanceof ErrorEntrada) sesion.avisar("error", error.message);
      else throw error;
    }
  };
  const capturadas = lineasEntradaCapturadas(datos.lineas).length;
  let numero = 0;
  // Recibido: no después de hoy (al capturar) ni del día en que se registró (al corregir).
  const registrada = excluirValeId !== null ? estado.vales.find((v) => v.id === excluirValeId) : null;
  const maxRecibido = (registrada?.emitido_en ?? registrada?.creado_en ?? "").slice(0, 10) || hoyIso();
  const errorRecibido = errorEn("fecha_recibido");
  const avisosRecibido = avisos.filter((a) => a.campo === "fecha_recibido");

  let indiceVisible = 0;

  return html`<div ref=${raiz} class=${`editor-entrada ${entrando ? "entrando" : ""}`}>
    ${sinEncabezado ? null : html`<section class="entrada-encabezado" aria-label="Datos del vale">
      <div class="encabezado-campos">
        <label class=${`campo ${errorEn("folio_externo") ? "con-error" : ""}`}>
          <span>Folio del vale</span>
          <input id="folio-base" value=${datos.folio_externo ?? ""} onInput=${(e) => cambiar({ folio_externo: e.currentTarget.value, folio_repetido: false })} placeholder="El del vale en papel" />
        </label>
        <label class=${`campo campo-ancho ${errorEn("origen") ? "con-error" : ""}`}>
          <span>Viene de</span>
          <${CampoSugerido} id="viene-de" valor=${datos.origen} alCambiar=${(origen) => cambiar({ origen })} sugerencias=${lugares} ariaLabel="Viene de" placeholder="Base o equipo" />
        </label>
        <label class=${`campo ${errorEn("fecha") ? "con-error" : ""}`} title="La del vale en papel: cuando lo envió la base">
          <span>Fecha del vale</span>
          <input id="fecha-entrada" type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
        </label>
        <label class=${`campo campo-recibido ${errorRecibido ? "con-error" : ""}`} title="El día en que llegó el material: ese día suma al inventario y cuenta en el reporte diario">
          <span>Recibido</span>
          <input
            id="recibido-entrada"
            type="date"
            value=${datos.fecha_recibido ?? ""}
            max=${maxRecibido}
            onChange=${(e) => cambiar({ fecha_recibido: e.currentTarget.value })}
            aria-describedby="recibido-nota"
          />
        </label>
        <label class="campo campo-ancho">
          <span>Entregó</span>
          <${CampoSugerido} valor=${datos.entrego_nombre} alCambiar=${(entrego_nombre) => cambiar({ entrego_nombre })} sugerencias=${sugerencias.personas} ariaLabel="Entregó" placeholder="Chofer, almacenista de la base…" />
        </label>
      </div>
      <div id="recibido-nota" class="recibido-nota" aria-live="polite">
        ${errorRecibido ? html`<p class="recibido-error">⚠ ${errorRecibido.mensaje}</p>` : null}
        ${avisosRecibido.map((a) => html`<p class="recibido-aviso">${a.mensaje}</p>`)}
        ${!errorRecibido && !avisosRecibido.length && datos.fecha_recibido
          ? html`<p class="nota">Suma al inventario del <strong>${fmtFecha(datos.fecha_recibido)}</strong> y cuenta en el reporte diario de ese día.</p>`
          : null}
      </div>
      ${repetida
        ? html`<label class="casilla aviso-folio">
            <input type="checkbox" checked=${Boolean(datos.folio_repetido)} onChange=${(e) => cambiar({ folio_repetido: e.currentTarget.checked })} />
            <span>
              El folio ${datos.folio_externo} ya se registró en la entrada <a href=${`#entrada/${repetida.id}`}>${folioEntrada(repetida.folio)}</a>
              (recibida el ${fmtFecha(fechaDelDia(repetida))}). Márcalo solo si es <strong>otro vale</strong> con el mismo folio.
            </span>
          </label>`
        : null}
      <div class="encabezado-pie">
        <span class="fijos" title="Se llenan solos">
          Depto. <strong>ALMACEN</strong> · llega a <strong>${datos.destino || "RIG 91"} · ${datos.depto_destino || "ALMACEN"}</strong> · recibe${" "}
          ${excluirValeId !== null
            ? html`<strong>${datos.recibio_nombre || "—"}</strong>`
            : sesion.usuario
              ? html`<strong>${sesion.usuario}</strong> (en turno)`
              : html`<span class="alerta">elige quién está en turno (arriba a la derecha)</span>`}
          ${datos.devolucion_folio ? html` · copia del vale de salida <strong>${datos.devolucion_folio}</strong>` : null}
        </span>
        ${verObservaciones
          ? html`<label class="campo campo-observaciones">
              <span>Observaciones</span>
              <input value=${datos.observaciones ?? ""} onInput=${(e) => cambiar({ observaciones: e.currentTarget.value })} />
            </label>`
          : html`<button type="button" class="enlace-boton" onClick=${() => setVerObservaciones(true)}>＋ Observaciones</button>`}
      </div>
    </section>`}

    <section class="entrada-partidas" aria-label="Partidas de la entrada">
      <header class="partidas-cabeza">
        <h2>Partidas</h2>
        <span class="contador-partidas">${capturadas}</span>
        <span class="nota">Código → clave → cantidad. Abajo de cada una: a qué contenedor entra, quién la solicita y la O.C.</span>
      </header>
      <div class="partidas-titulos" aria-hidden="true">
        <span>#</span><span>Código</span><span>Descripción</span><span>Clave / dimensión</span><span>NP</span><span>Cantidad</span><span>U.M.</span><span></span>
      </div>
      ${filtro
        ? html`<div class="filtro-partidas" role="status">
            <span>
              ${filtro.resueltas.size >= filtro.uids.size
                ? html`<strong>✓ Listo:</strong> ya no queda nada ${filtro.etiqueta}.`
                : html`Mostrando <strong>${filtro.uids.size} ${filtro.uids.size === 1 ? "partida" : "partidas"}</strong> ${filtro.etiqueta}${filtro.resueltas.size ? ` · ${filtro.resueltas.size} ya resuelta(s)` : ""}.`}
            </span>
            <${Boton} tamano="chico" onClick=${filtro.alQuitar}>Ver todas las partidas<//>
          </div>`
        : null}
      <ol class="lista-partidas">
        ${datos.lineas.map((l) => {
          const blanco = !Number.isInteger(l.codigo) && !texto(l.cantidad) && !texto(l.clave) && !l.alta;
          if (!blanco) numero += 1;
          const n = blanco ? null : numero;
          if (filtro && !filtro.uids.has(l.uid)) return null;
          const orden = Math.min(indiceVisible++, 14);
          const mensajes = n ? errores.filter((e) => e.renglon === n) : [];
          const opciones = Number.isInteger(l.codigo) ? opcionesDe(l.codigo) : [];
          const conocido = Number.isInteger(l.codigo) && Boolean(estado.articulos[l.codigo]);
          const fila = previa.find((p) => p.uid === l.uid);
          const faltaClave = !hay(l.existencia_id) && !l.alta && !l.no_inventariado && !hay(l.ubicacion_id) && opciones.length > 0;
          const conError = n && errores.some((e) => e.renglon === n);
          const entraA = Number.isInteger(l.codigo) && !faltaClave ? opcionesEntraA(estado, l, { indices, saldos }) : [];
          const usarVariante = (variante) => {
            const renglon = opciones.find((o) => o.variante_id === variante.id && o.sugerida);
            if (renglon) cambiarLinea(l.uid, (actual) => conRenglonExistente(estado, actual, renglon.id, indices), `cant-${l.uid}`);
          };
          const resuelta = filtro?.resueltas.has(l.uid);
          return html`<li
            key=${l.uid}
            id=${`partida-${l.uid}`}
            data-partida=${l.uid}
            style=${`--i: ${orden}`}
            class=${`partida-entrada ${blanco ? "partida-vacia" : ""} ${conError ? "con-error" : ""} ${l.dudoso ? "dudosa" : ""} ${recientes?.has(l.uid) ? "reciente" : ""} ${resuelta ? "resuelta" : ""}`}
          >
            ${Number.isInteger(l.codigo) && !l.no_inventariado ? html`<div class="partida-modo-material">
              ${l.material_nuevo
                ? html`<span class="nota"><strong>Material nuevo:</strong> captura dimensión, NP opcional, unidad y contenedor.</span>
                    <${Boton} tipo="texto" tamano="chico" onClick=${() => cambiarLinea(l.uid, { material_nuevo: false }, `eclv-${l.uid}`)}>Elegir existente<//>`
                : html`<span class="nota">¿Es otra variante o llega sin NP?</span>
                    <${Boton} tipo="texto" tamano="chico" onClick=${() => cambiarLinea(l.uid, (actual) => conMaterialNuevo(estado, actual, { indices }), `np-${l.uid}`)}>Crear material nuevo<//>`}
            </div>` : null}
            <div class="partida-linea1">
              <span class="partida-num" aria-label=${n ? `Partida ${n}` : "Partida nueva"}>${n ?? "＋"}</span>
              <div class="pf pf-codigo">
                <span class="mini">Código</span>
                <${CeldaCodigo}
                  linea=${l}
                  articulos=${articulos}
                  error=${n && errorEn("codigo", n)}
                  alElegir=${(codigo, mover) => {
                    if (codigo === l.codigo) {
                      if (mover) enfocar.current = hay(l.existencia_id) ? `cant-${l.uid}` : `eclv-${l.uid}`;
                      return;
                    }
                    const nueva = entradaConArticulo(estado, l, codigo, { indices });
                    cambiarLinea(l.uid, nueva, mover ? (hay(nueva.existencia_id) ? `cant-${l.uid}` : `eclv-${l.uid}`) : null);
                  }}
                  alNuevo=${(codigo) => cambiarLinea(l.uid, { ...entradaConArticulo(estado, l, codigo, { indices }), descripcion: "" }, `desc-${l.uid}`)}
                />
              </div>
              <div class="pf pf-desc">
                <span class="mini">Descripción</span>
                ${Number.isInteger(l.codigo) && !conocido
                  ? html`<input
                      id=${`desc-${l.uid}`}
                      class=${n && errorEn("descripcion", n) ? "con-error" : ""}
                      value=${l.descripcion}
                      placeholder="Descripción (código nuevo)"
                      onInput=${(e) => cambiarLinea(l.uid, { descripcion: e.currentTarget.value })}
                    />`
                  : html`<div class="descripcion-codigo">
                      <span class="descripcion" title=${l.descripcion}>${l.descripcion || html`<span class="nota">—</span>`}</span>
                      ${conocido ? html`<${BotonDescripcion} codigo=${l.codigo} alCambiar=${(descripcion) => conDescripcion(l.codigo, descripcion)} />` : null}
                    </div>`}
              </div>
              <div class="pf pf-clave">
                <span class="mini">Clave / dimensión</span>
                <${CeldaClave}
                  linea=${l}
                  opciones=${opciones}
                  error=${n && faltaClave && errorEn("destino", n)}
                  alElegir=${(o, mover) => cambiarLinea(l.uid, (actual) => conRenglonExistente(estado, actual, o.id, indices), mover ? `cant-${l.uid}` : null)}
                  alEscribir=${(valor) => cambiarLinea(l.uid, (actual) => conClaveEscrita(estado, actual, valor, { indices, opciones }))}
                  alSalir=${() => cambiarLinea(l.uid, (actual) => conClaveYNp(estado, actual, { indices, opciones }))}
                />
              </div>
              <div class="pf pf-np">
                <span class="mini">NP</span>
                <input
                  id=${`np-${l.uid}`}
                  value=${l.np ?? ""}
                  disabled=${!Number.isInteger(l.codigo) || l.no_inventariado}
                  placeholder=${Number.isInteger(l.codigo) ? "Sin NP" : ""}
                  title="Número de parte (NP del inventario). Si la clave lo trae, se pasa aquí solo."
                  onInput=${(e) => cambiarLinea(l.uid, (actual) => conNpEscrito(estado, actual, e.currentTarget.value, { indices, opciones }))}
                  onBlur=${() => cambiarLinea(l.uid, (actual) => conClaveYNp(estado, actual, { indices, opciones }))}
                  aria-label="NP (número de parte)"
                />
              </div>
              <div class="pf pf-cant">
                <span class="mini">Cantidad</span>
                <input
                  id=${`cant-${l.uid}`}
                  class=${`entrada-cantidad ${n && errorEn("cantidad", n) ? "con-error" : ""}`}
                  inputmode="decimal"
                  value=${l.cantidad}
                  placeholder="0"
                  onInput=${(e) => cambiarLinea(l.uid, { cantidad: e.currentTarget.value.replace(",", ".") })}
                  onKeyDown=${(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      siguienteFila(l.uid);
                    }
                  }}
                  aria-label="Cantidad"
                />
              </div>
              <div class="pf pf-um">
                <span class="mini">U.M.</span>
                <input
                  id=${`um-${l.uid}`}
                  class=${`entrada-um ${n && errorEn("um", n) ? "con-error" : ""}`}
                  value=${l.um}
                  onInput=${(e) => cambiarLinea(l.uid, (actual) => ({ ...actual, um: e.currentTarget.value }))}
                  aria-label="Presentación (UM)"
                />
              </div>
              ${blanco
                ? html`<span class="pf-quitar"></span>`
                : html`<button type="button" class="boton-quitar pf-quitar" title="Quitar esta partida" aria-label=${`Quitar la partida ${n}`} onClick=${() => quitar(l.uid)}>✕</button>`}
            </div>
            ${blanco
              ? null
              : html`<div class="partida-linea2">
                  <div class="pf-entra">
                    <span class="mini-linea">Entra a</span>
                    <${SelectorEntraA}
                      linea=${l}
                      alCambiar=${(valor) => cambiarLinea(l.uid, (actual) => conContenedor(estado, actual, valor, indices), `cant-${l.uid}`)}
                      opciones=${entraA}
                      indices=${indices}
                      faltaClave=${faltaClave}
                      error=${n && !faltaClave && errorEn("destino", n)}
                    />
                    <${Indicador} fila=${fila} linea=${l} />
                    ${fila?.variante_nueva ? html`<${Pastilla} tono="info" titulo="La clave no está en el inventario: se da de alta con lo que escribiste">variante nueva<//>` : null}
                  </div>
                  <label class="pf-solicita">
                    <span class="mini-linea">Solicita</span>
                    <${CampoSugerido}
                      valor=${l.lote ?? ""}
                      alCambiar=${(lote) => cambiarLinea(l.uid, { lote })}
                      sugerencias=${solicitantes}
                      ariaLabel="Quién solicita (va en LOTE)"
                      placeholder="Nombre (va en LOTE)"
                    />
                  </label>
                  <label class="pf-oc">
                    <span class="mini-linea">O.C.</span>
                    <input class="entrada-oc" placeholder="S/OC" value=${l.oc} onInput=${(e) => cambiarLinea(l.uid, { oc: e.currentTarget.value })} aria-label="O.C." />
                  </label>
                  ${l.dudoso
                    ? html`<span class="pf-revisar">
                        <${Pastilla} tono="alerta" titulo="Copilot no estaba seguro de esta partida: revísala con el vale">revisar<//>
                        <button type="button" class="enlace-boton" onClick=${() => cambiarLinea(l.uid, { dudoso: false })}>✓ ya la revisé</button>
                      </span>`
                    : null}
                </div>`}
            ${mensajes.length
              ? html`<ul class="partida-errores">
                  ${mensajes.map((e) => {
                    const m = e.mensaje.replace(/^Partida \d+: /, "");
                    return html`<li>${m.charAt(0).toUpperCase()}${m.slice(1)}</li>`;
                  })}
                </ul>`
              : null}
            ${resuelta ? html`<span class="partida-resuelta">✓ resuelta</span>` : null}
            ${fila?.variante_nueva && texto(l.dimension) ? html`<${Parecidas} estado=${estado} indices=${indices} linea=${l} alUsar=${usarVariante} />` : null}
          </li>`;
        })}
      </ol>
      <div class="acciones-linea" hidden=${Boolean(filtro)}>
        <${Boton} onClick=${() => agregarLinea()} title="Agregar partida (Alt + N)">＋ Agregar partida <${Teclas} teclas=${["Alt", "N"]} /><//>
        ${copiando
          ? html`<span class="copiar-salida">
              <input
                id="folio-devolucion"
                inputmode="numeric"
                value=${folioDevolucion}
                onInput=${(e) => setFolioDevolucion(e.currentTarget.value)}
                onKeyDown=${(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    copiarDeSalida();
                  }
                }}
                placeholder="Folio de salida"
                aria-label="Folio del vale de salida"
              />
              <${Boton} tamano="chico" tipo="primario" onClick=${copiarDeSalida} disabled=${!folioDevolucion.trim()}>Copiar partidas<//>
              <${Boton} tamano="chico" tipo="texto" onClick=${() => setCopiando(false)}>Cancelar<//>
            </span>`
          : html`<${Boton} tipo="texto" onClick=${() => setCopiando(true)} title="Material que regresa: cada partida vuelve a la partida de la que salió">↩ Copiar partidas de un vale de salida<//>`}
      </div>
    </section>
    ${pie ? html`<div class="vale-pie">${pie}</div>` : null}
  </div>`;
}

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
