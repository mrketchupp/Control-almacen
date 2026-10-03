import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../../nucleo/fechas.js";
import { aplicarEntradaIA } from "../../servicios/capturaIA.js";
import {
  ErrorEntrada,
  borradorEntrada,
  conClaveEscrita,
  conContenedor,
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
import { siguienteFolio } from "../../servicios/vales.js";
import { Boton, CampoSugerido, Combo, Lista, Pastilla, Tarjeta, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { PasosCopilot } from "./capturaIA.js";
import { CeldaCodigo, indiceArticulos, listas, normal, palabras } from "./vales.js";

const hay = (v) => v !== null && v !== undefined;
const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ---------------------------------------------------------------- partes de una partida

/** Clave / dimensión: los renglones del inventario de ese código; si se escribe otra, es una variante nueva. */
function CeldaClave({ linea, opciones, alElegir, alEscribir, error }) {
  const elegida = opciones.find((o) => o.id === linea.existencia_id) ?? null;
  const filtradas = useMemo(() => {
    const q = normal(linea.clave);
    if (!q || (elegida && normal(elegida.clave) === q)) return opciones;
    return opciones.filter((o) => palabras(q).every((p) => normal(`${o.clave} ${o.np ?? ""} ${o.lugar} ${o.hoja}`).includes(p)));
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
      <${Pastilla} tono="lugar" titulo=${o.hoja}>${o.lugar}<//>
      <${Pastilla} tono=${o.total > 0 ? "ok" : "alerta"}>hay ${num(o.total)} ${o.um}<//>
      ${o.sugerida && o.enVarios ? html`<${Pastilla} tono="info" titulo="Es el contenedor donde hay más de esta variante">★ sugerido<//>` : null}`}
    alElegir=${(o, mover = true) => alElegir(o, mover)}
    alSalir=${() => {
      // Una clave escrita igual a la de un renglón existente se elige sola (el sugerido).
      const exactas = opciones.filter((o) => normal(o.clave) === normal(linea.clave));
      const mejor = exactas.find((o) => o.ubicacion_id === linea.ubicacion_id) ?? exactas.find((o) => o.sugerida) ?? exactas[0];
      if (mejor && !elegida) alElegir(mejor, false);
    }}
    placeholder=${opciones.length ? "Elige o escribe" : "Escribe la clave"}
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
        ${o.propio ? html`<${Pastilla} tono="ok">ya tiene su renglón<//>` : html`<${Pastilla}>renglón nuevo<//>`}
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
    return html`<span class=${`indicador ${negativo ? "indicador-alerta" : "indicador-ok"}`} title="Existencia de ese renglón antes y después de esta entrada">
      hay ${num(aNumero(fila.habia))} <span aria-hidden="true">→</span> <strong>${fila.queda ? num(aNumero(fila.queda)) : "—"}</strong> ${um}
    </span>`;
  }
  if (fila.tipo === "nuevo") {
    return html`<span class="indicador indicador-info" title="Se agrega al final de esa hoja del inventario">
      renglón nuevo <span aria-hidden="true">→</span> <strong>${fila.queda ? num(aNumero(fila.queda)) : "0"}</strong> ${um}
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
      (p) => html`<button type="button" class="chip-sugerencia" onClick=${() => alUsar(p.variante)} title="Usar ese renglón del inventario">
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
 */
export function EditorEntrada({ datos, alCambiar, errores = [], excluirValeId = null, pie = null }) {
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
    cambiar({ lineas: datos.lineas.map((l) => (l.uid === uid ? (typeof cambio === "function" ? cambio(l) : { ...l, ...cambio }) : l)) });
  };
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

  return html`<div class="editor-entrada">
    <section class="entrada-encabezado" aria-label="Datos del vale">
      <div class="encabezado-campos">
        <label class=${`campo ${errorEn("folio_externo") ? "con-error" : ""}`}>
          <span>Folio del vale</span>
          <input id="folio-base" value=${datos.folio_externo ?? ""} onInput=${(e) => cambiar({ folio_externo: e.currentTarget.value, folio_repetido: false })} placeholder="El del vale en papel" />
        </label>
        <label class=${`campo campo-ancho ${errorEn("origen") ? "con-error" : ""}`}>
          <span>Viene de</span>
          <${CampoSugerido} id="viene-de" valor=${datos.origen} alCambiar=${(origen) => cambiar({ origen })} sugerencias=${lugares} ariaLabel="Viene de" placeholder="Base o equipo" />
        </label>
        <label class=${`campo ${errorEn("fecha") ? "con-error" : ""}`}>
          <span>Fecha</span>
          <input id="fecha-entrada" type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
        </label>
        <label class="campo campo-ancho">
          <span>Entregó</span>
          <${CampoSugerido} valor=${datos.entrego_nombre} alCambiar=${(entrego_nombre) => cambiar({ entrego_nombre })} sugerencias=${sugerencias.personas} ariaLabel="Entregó" placeholder="Chofer, almacenista de la base…" />
        </label>
      </div>
      ${repetida
        ? html`<label class="casilla aviso-folio">
            <input type="checkbox" checked=${Boolean(datos.folio_repetido)} onChange=${(e) => cambiar({ folio_repetido: e.currentTarget.checked })} />
            <span>
              El folio ${datos.folio_externo} ya se registró en la entrada <a href=${`#entrada/${repetida.id}`}>${folioEntrada(repetida.folio)}</a>
              (${fmtFecha(repetida.fecha)}). Márcalo solo si es <strong>otro vale</strong> con el mismo folio.
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
    </section>

    <section class="entrada-partidas" aria-label="Partidas de la entrada">
      <header class="partidas-cabeza">
        <h2>Partidas</h2>
        <span class="contador-partidas">${capturadas}</span>
        <span class="nota">Código → clave → cantidad. Abajo de cada una: a qué contenedor entra, quién la solicita y la O.C.</span>
      </header>
      <div class="partidas-titulos" aria-hidden="true">
        <span>#</span><span>Código</span><span>Descripción</span><span>Clave / dimensión</span><span>Cantidad</span><span>U.M.</span><span></span>
      </div>
      <ol class="lista-partidas">
        ${datos.lineas.map((l) => {
          const blanco = !Number.isInteger(l.codigo) && !texto(l.cantidad) && !texto(l.clave) && !l.alta;
          if (!blanco) numero += 1;
          const n = blanco ? null : numero;
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
          return html`<li
            key=${l.uid}
            id=${`partida-${l.uid}`}
            class=${`partida-entrada ${blanco ? "partida-vacia" : ""} ${conError ? "con-error" : ""} ${l.dudoso ? "dudosa" : ""}`}
          >
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
                  : html`<span class="descripcion" title=${l.descripcion}>${l.descripcion || html`<span class="nota">—</span>`}</span>`}
              </div>
              <div class="pf pf-clave">
                <span class="mini">Clave / dimensión</span>
                <${CeldaClave}
                  linea=${l}
                  opciones=${opciones}
                  error=${n && faltaClave && errorEn("destino", n)}
                  alElegir=${(o, mover) => cambiarLinea(l.uid, (actual) => conRenglonExistente(estado, actual, o.id, indices), mover ? `cant-${l.uid}` : null)}
                  alEscribir=${(valor) => cambiarLinea(l.uid, (actual) => conClaveEscrita(estado, actual, valor, { indices, opciones }))}
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
                ? html`<span></span>`
                : html`<button type="button" class="boton-quitar" title="Quitar esta partida" aria-label=${`Quitar la partida ${n}`} onClick=${() => quitar(l.uid)}>✕</button>`}
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
            ${fila?.variante_nueva && texto(l.dimension) ? html`<${Parecidas} estado=${estado} indices=${indices} linea=${l} alUsar=${usarVariante} />` : null}
          </li>`;
        })}
      </ol>
      <div class="acciones-linea">
        <${Boton} onClick=${() => agregarLinea()}>＋ Agregar partida<//>
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
          : html`<${Boton} tipo="texto" onClick=${() => setCopiando(true)} title="Material que regresa: cada partida vuelve al renglón del que salió">↩ Copiar partidas de un vale de salida<//>`}
      </div>
    </section>
    ${pie ? html`<div class="vale-pie">${pie}</div>` : null}
  </div>`;
}

// ---------------------------------------------------------------- elegir cómo capturar

function ElegirModo({ folio, alElegir, alCopiarSalida }) {
  const [folioSalida, setFolioSalida] = useState("");
  return html`<div class="elegir-modo">
    <h2>¿Cómo quieres capturar el vale?</h2>
    <p class="nota">Material que llega de la base o de otro equipo · se registrará como <strong>${folio}</strong></p>
    <div class="modos">
      <button type="button" class="modo-tarjeta" onClick=${() => alElegir("manual")}>
        <span class="modo-icono"><${Icono} nombre="teclado" tam=${30} /></span>
        <strong>Captura manual</strong>
        <span>Escribe el código, la clave y la cantidad de cada partida.</span>
        <small>Para vales cortos</small>
      </button>
      <button type="button" class="modo-tarjeta modo-destacado" onClick=${() => alElegir("asistida")}>
        <span class="modo-icono"><${Icono} nombre="chispa" tam=${30} /></span>
        <strong>Desde foto o PDF</strong>
        <span>Copilot lee el vale y aquí se llena solo; tú revisas y registras.</span>
        <small>Captura asistida · ideal para vales largos</small>
      </button>
    </div>
    <div class="modo-devolucion">
      <${Icono} nombre="regresa" />
      <span>¿Material que regresa? Copia las partidas de un vale de salida:</span>
      <input
        inputmode="numeric"
        value=${folioSalida}
        onInput=${(e) => setFolioSalida(e.currentTarget.value)}
        onKeyDown=${(e) => {
          if (e.key === "Enter" && folioSalida.trim()) alCopiarSalida(folioSalida);
        }}
        placeholder="Folio de salida"
        aria-label="Folio del vale de salida"
      />
      <${Boton} tamano="chico" disabled=${!folioSalida.trim()} onClick=${() => alCopiarSalida(folioSalida)}>Copiar partidas<//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- página

function ConfirmadaOk({ vale, alNueva }) {
  const renglones = vale.lineas.filter((l) => hay(l.existencia_id)).length;
  return html`<${Tarjeta} titulo=${`✓ Entrada ${folioEntrada(vale.folio)} registrada`} clase="tarjeta-exito">
    <p>
      ${vale.folio_externo ? html`Vale <strong>${vale.folio_externo}</strong>${vale.origen ? ` de ${vale.origen}` : ""}.${" "}` : null}Sumó al INGRESO de ${renglones}${" "}
      ${renglones === 1 ? "renglón" : "renglones"} del inventario. Queda en el historial de entradas.
    </p>
    <div class="acciones-linea">
      <a class="boton boton-secundario" href=${`#entrada/${vale.id}`}>Ver entrada ${folioEntrada(vale.folio)}</a>
      <${Boton} tipo="primario" onClick=${alNueva}>＋ Nueva entrada<//>
    </div>
  <//>`;
}

/** Barra fija arriba: estado del borrador y las acciones (siempre a la vista). */
function BarraEntrada({ folio, datos, validacion, verErrores, setVerErrores, alDescartar, alRegistrar, alCopilot }) {
  const lineas = lineasEntradaCapturadas(datos.lineas);
  const revisar = lineas.filter((l) => l.dudoso).length;
  const faltan = validacion.errores.length;
  const ir = (error) => {
    const uid = error.renglon ? lineas[error.renglon - 1]?.uid : null;
    const ids = {
      folio_externo: "folio-base",
      origen: "viene-de",
      fecha: "fecha-entrada",
      codigo: `cod-${uid}`,
      cantidad: `cant-${uid}`,
      descripcion: `desc-${uid}`,
      um: `um-${uid}`,
      destino: `eclv-${uid}`,
    };
    const destino = (error.campo === "destino" && document.getElementById(`entra-${uid}`)?.disabled === false ? document.getElementById(`entra-${uid}`) : null) ?? document.getElementById(ids[error.campo]);
    (uid ? document.getElementById(`partida-${uid}`) : destino)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    destino?.focus?.({ preventScroll: true });
  };
  return html`<div class="barra-entrada" role="region" aria-label="Acciones de la entrada">
    <div class="barra-entrada-fila">
      <div class="barra-entrada-estado">
        <span class="folio-grande" title="Folio interno con el que se registrará">${folio}</span>
        <span class="nota">Borrador · se guarda solo</span>
        <span class="chip-estado">${lineas.length} ${lineas.length === 1 ? "partida" : "partidas"}</span>
        ${revisar ? html`<span class="chip-estado chip-alerta" title="Partidas que Copilot no leyó con seguridad">${revisar} por revisar</span>` : null}
        ${faltan
          ? html`<button type="button" class=${`chip-estado chip-error ${verErrores ? "abierto" : ""}`} onClick=${() => setVerErrores(!verErrores)} aria-expanded=${verErrores}>
              ⚠ ${faltan} ${faltan === 1 ? "dato pendiente" : "datos pendientes"} ▾
            </button>`
          : lineas.length
            ? html`<span class="chip-estado chip-ok">✓ lista para registrar</span>`
            : null}
      </div>
      <div class="barra-entrada-acciones">
        <${Boton} tipo="texto" onClick=${alCopilot} title="Leer el vale desde una foto o PDF con Copilot"><${Icono} nombre="chispa" tam=${16} /> Copilot<//>
        <${Boton} tipo="peligro-texto" onClick=${alDescartar}>Descartar<//>
        <${Boton} tipo="primario" disabled=${!lineas.length} onClick=${alRegistrar}>Registrar entrada<//>
      </div>
    </div>
    ${verErrores && faltan
      ? html`<ul class="barra-errores">
          ${validacion.errores.map(
            (e) => html`<li>
              <button type="button" class="enlace-boton" onClick=${() => ir(e)}>${e.mensaje}</button>
            </li>`,
          )}
        </ul>`
      : null}
  </div>`;
}

export function PaginaValesEntrada() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(() => sesion.tomarPestana("borradores_entrada") ?? estado.borradores_entrada[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [intentado, setIntentado] = useState(false);
  const [verErrores, setVerErrores] = useState(false);
  const [confirmada, setConfirmada] = useState(null);
  const [ventanaIA, setVentanaIA] = useState(false);
  const [reporteIA, setReporteIA] = useState(null);
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

  useEffect(() => {
    const b = borradorEntrada(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setIntentado(false);
    setVerErrores(false);
    setReporteIA(null);
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
      const { errores: faltan } = validarEntrada(sesion.estado, listo);
      setIntentado(true);
      if (faltan.length) {
        setVerErrores(true);
        return;
      }
      const folio = folioEntrada(siguienteFolio(sesion.estado, "ENTRADA"));
      const n = lineasEntradaCapturadas(datos.lineas).length;
      if (!confirmar(`¿Registrar la entrada ${folio} con ${n} ${n === 1 ? "partida" : "partidas"}? Suma al inventario; después solo se puede corregir (con motivo).`)) return;
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
        setVerErrores(true);
      }
    });
  // Lo que devuelve Copilot se agrega al borrador; el resumen queda arriba de las partidas.
  const cargarIA = (respuesta) => {
    const { datos: nuevo, reporte } = aplicarEntradaIA(sesion.estado, datos, respuesta);
    cambiar({ ...nuevo, modo: nuevo.modo ?? "asistida" });
    const lineas = [
      `✓ ${reporte.partidas} ${reporte.partidas === 1 ? "partida cargada" : "partidas cargadas"}: ${reporte.conRenglon} a su renglón del inventario${reporte.nuevas ? `, ${reporte.nuevas} con clave nueva (revisa su contenedor en "Entra a")` : ""}.`,
      ...(reporte.sinCodigo.length ? [`⚠ Sin código legible: partida(s) ${reporte.sinCodigo.join(", ")}. Escríbelo a mano.`] : []),
      ...(reporte.sinClave.length ? [`⚠ Sin clave legible: partida(s) ${reporte.sinClave.join(", ")}. Elígela de la lista.`] : []),
      ...(reporte.dudosas.length ? [`⚠ Copilot marcó como dudosas las partidas ${reporte.dudosas.join(", ")} (en amarillo).`] : []),
    ];
    return lineas;
  };
  const alReporteIA = (lineas) => {
    setReporteIA(lineas);
    setVentanaIA(false);
  };
  const copiarSalidaAlEmpezar = (folio) => {
    try {
      const traidos = datosDeDevolucion(estado, folio);
      cambiar({ ...datos, ...traidos, modo: "manual", origen: datos.origen || traidos.origen, entrego_nombre: datos.entrego_nombre || traidos.entrego_nombre });
      sesion.avisar("exito", `Se copiaron las partidas del vale ${traidos.devolucion_folio}: ajusta las cantidades a lo que regresó.`);
    } catch (error) {
      if (error instanceof ErrorEntrada) sesion.avisar("error", error.message);
      else throw error;
    }
  };

  const borradores = estado.borradores_entrada;
  const folio = folioEntrada(siguienteFolio(estado, "ENTRADA"));
  const nombreDe = (b) => (b.folio_externo ? `Vale ${b.folio_externo}` : b.origen ? `De ${b.origen}` : "Entrada nueva");
  const capturadas = datos ? lineasEntradaCapturadas(datos.lineas).length : 0;
  const modo = datos ? (datos.modo ?? (capturadas || texto(datos.folio_externo) ? "manual" : null)) : null;

  return html`
    ${borradores.length
      ? html`<div class="pestanas" role="tablist" aria-label="Entradas en borrador">
          ${borradores.map((b) => {
            const actual = b.id === datos?.id ? datos : b;
            const n = lineasEntradaCapturadas(actual.lineas).length;
            const activa = b.id === activo && !confirmada;
            return html`<button type="button" role="tab" aria-selected=${activa} class=${`pestana ${activa ? "activa" : ""}`} onClick=${() => cambiarPestana(b.id)}>
              ${nombreDe(actual)}
              <span class="pastilla-conteo" title=${`${n} ${n === 1 ? "partida" : "partidas"}`}>${n}</span>
            </button>`;
          })}
          <button type="button" class="pestana nueva" onClick=${nueva}>＋ Nueva entrada</button>
        </div>`
      : null}

    ${confirmada ? html`<${ConfirmadaOk} vale=${confirmada} alNueva=${nueva} />` : null}

    ${!confirmada && datos && modo === null
      ? html`<${ElegirModo}
          folio=${folio}
          alElegir=${(m) => cambiar({ ...datos, modo: m })}
          alCopiarSalida=${copiarSalidaAlEmpezar}
        />
        <div class="acciones-linea centrado"><${Boton} tipo="peligro-texto" onClick=${descartar}>Descartar este borrador<//></div>`
      : null}

    ${!confirmada && datos && modo !== null
      ? html`<${BarraEntrada}
            folio=${folio}
            datos=${datos}
            validacion=${validacion}
            verErrores=${verErrores}
            setVerErrores=${setVerErrores}
            alDescartar=${descartar}
            alRegistrar=${registrar}
            alCopilot=${() => setVentanaIA(true)}
          />
          ${modo === "asistida" && !capturadas
            ? html`<section class="captura-asistida">
                <header>
                  <span class="modo-icono"><${Icono} nombre="chispa" tam=${26} /></span>
                  <div>
                    <h2>Captura desde foto o PDF</h2>
                    <p class="nota">Tres pasos y el borrador se llena solo. Después revisas lo marcado y registras.</p>
                  </div>
                  <button type="button" class="enlace-boton" onClick=${() => cambiar({ ...datos, modo: "manual" })}>Prefiero capturar a mano</button>
                </header>
                <${PasosCopilot} key=${`ia-${datos.id}`} tipo="entrada" grande=${true} alCargar=${cargarIA} alReporte=${alReporteIA} />
              </section>`
            : html`${reporteIA
                  ? html`<div class="reporte-ia-banner" role="status">
                      <ul class="reporte-ia">
                        ${reporteIA.map((r) => html`<li class=${r.startsWith("⚠") ? "alerta" : r.startsWith("ℹ") ? "nota" : ""}>${r}</li>`)}
                      </ul>
                      <button type="button" class="ventana-cerrar" title="Cerrar" aria-label="Cerrar el resumen" onClick=${() => setReporteIA(null)}>✕</button>
                    </div>`
                  : null}
                <${EditorEntrada} key=${datos.id} datos=${datos} alCambiar=${cambiar} errores=${intentado ? validacion.errores : []} />`}
          ${ventanaIA
            ? html`<${Ventana} titulo="Leer el vale con Copilot" clase="ventana-copilot" alCerrar=${() => setVentanaIA(false)}>
                <p class="nota">Las partidas que lea se agregan después de las que ya tienes.</p>
                <${PasosCopilot} tipo="entrada" alCargar=${cargarIA} alReporte=${alReporteIA} />
              <//>`
            : null}`
      : null}

    ${!confirmada && !datos && !borradores.length
      ? html`<${Tarjeta} clase="tarjeta-inicio-vales">
          <p>
            Registra el material que llega de la base o de otro equipo, a mano o desde la foto del vale con Copilot. Cada partida
            entra a un renglón del inventario: si el material ya está en un contenedor, se sugiere ese, y ves cuánto había y cuánto
            queda antes de registrar.
          </p>
          <${Boton} tipo="primario" tamano="grande" onClick=${nueva}>＋ Nueva entrada · ${folio}<//>
        <//>`
      : null}
  `;
}
