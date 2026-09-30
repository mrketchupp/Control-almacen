import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../../nucleo/fechas.js";
import {
  ErrorEntrada,
  MOTIVOS_ENTRADA,
  borradorEntrada,
  conOtroContenedor,
  conRenglonExistente,
  conVarianteNueva,
  confirmarEntrada,
  datosDeDevolucion,
  descartarBorradorEntrada,
  destinosDeCodigo,
  entradaConArticulo,
  entradaConFolioBase,
  entradaSinExistencia,
  folioEntrada,
  lineaEntradaVacia,
  lineasEntradaCapturadas,
  nuevoBorradorEntrada,
  validarEntrada,
  vistaPreviaEntrada,
} from "../../servicios/entradas.js";
import { lugarCorto, renglonDe, ubicacionesSugeridas, variantesParecidas } from "../../servicios/inventario.js";
import { preferenciasVale } from "../../servicios/preferencias.js";
import { siguienteFolio } from "../../servicios/vales.js";
import { Aviso, Boton, CampoSugerido, Combo, Lista, Pastilla, Tarjeta, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Campo, CeldaCodigo, ListaErrores, indiceArticulos, listas, normal, palabras } from "./vales.js";

const hay = (v) => v !== null && v !== undefined;

// ---------------------------------------------------------------- destino de un renglón

/** Contenedores para la variante del renglón: dónde ya tiene renglón y dónde sería uno nuevo. */
function opcionesContenedor(estado, linea, indices) {
  const varianteId = linea.variante_id ?? (hay(linea.existencia_id) ? indices.existencia(linea.existencia_id)?.variante_id : null);
  return ubicacionesSugeridas(estado, linea.codigo, { indices }).map(({ ubicacion }) => {
    const propio = hay(varianteId) ? renglonDe(estado, varianteId, ubicacion.id) : null;
    return { valor: ubicacion.id, etiqueta: lugarCorto(ubicacion), detalle: `${ubicacion.hoja_excel.trim()} · ${propio ? "ya tiene su renglón" : "renglón nuevo"}` };
  });
}

/** Clave / dimensión: renglones del inventario de ese código (el sugerido primero) o una variante nueva. */
function CeldaDestino({ linea, opciones, alElegir, alNueva, alSinExistencia, alEscribir, error }) {
  const elegida = opciones.find((o) => o.id === linea.existencia_id) ?? null;
  const filtradas = useMemo(() => {
    const q = normal(linea.clave);
    const base = !q || (elegida && normal(elegida.clave) === q) ? opciones : opciones.filter((o) => palabras(q).every((p) => normal(`${o.clave} ${o.lugar} ${o.hoja}`).includes(p)));
    const texto = linea.clave && !elegida ? ` "${linea.clave.toUpperCase()}"` : "";
    return [
      ...base,
      { especial: "nueva", etiqueta: `＋ Otra dimensión${texto}: variante nueva (renglón nuevo en el contenedor que elijas)` },
      { especial: "sin", etiqueta: "Sin existencia (diésel, gases…): queda en el historial y no suma" },
    ];
  }, [opciones, linea.clave, elegida]);
  if (!Number.isInteger(linea.codigo)) return html`<input class="entrada-clave" disabled placeholder="Primero el código" aria-label="Clave / dimensión" />`;
  return html`<${Combo}
    id=${`eclv-${linea.uid}`}
    clase=${error ? "con-error" : ""}
    valor=${linea.clave}
    alEscribir=${alEscribir}
    opciones=${filtradas}
    clave=${(o) => o.id ?? o.especial}
    render=${(o) =>
      o.especial
        ? html`<span class="opcion-especial">${o.etiqueta}</span>`
        : html`<span class="opcion-principal">${o.clave}</span>
            <${Pastilla} tono="lugar" titulo=${o.hoja}>${o.lugar}<//>
            <${Pastilla} tono=${o.total > 0 ? "ok" : "alerta"}>hay ${num(o.total)} ${o.um}<//>
            ${o.sugerida && o.enVarios ? html`<${Pastilla} tono="info" titulo="Es el contenedor donde hay más de esta variante">★ sugerido<//>` : null}`}
    alElegir=${(o, mover = true) => (o.especial === "nueva" ? alNueva() : o.especial === "sin" ? alSinExistencia() : alElegir(o, mover))}
    alSalir=${() => {
      const exactas = opciones.filter((o) => normal(o.clave) === normal(linea.clave));
      const sugerida = exactas.find((o) => o.sugerida) ?? exactas[0];
      if (sugerida && !elegida) alElegir(sugerida, false);
    }}
    placeholder="Clave / dimensión"
    ariaLabel="Clave / dimensión"
  />`;
}

/** Datos de una variante nueva (RF-33), con aviso de las que se le parecen. */
function FilaAlta({ linea, estado, indices, alCambiar, alUsar }) {
  const parecidas = useMemo(
    () => variantesParecidas(estado, linea.codigo, { dimension: linea.dimension, np: linea.np, um: linea.um }, { indices }),
    [estado, linea.codigo, linea.dimension, linea.np, linea.um],
  );
  return html`<div class="fila-alta">
    <span class="subtitulo-panel">Variante nueva</span>
    <label class="campo campo-chico"><span>Dimensión</span>
      <input id=${`edim-${linea.uid}`} value=${linea.dimension} onInput=${(e) => alCambiar({ dimension: e.currentTarget.value })} placeholder="S/D" />
    </label>
    <label class="campo campo-chico"><span>NP</span>
      <input value=${linea.np} onInput=${(e) => alCambiar({ np: e.currentTarget.value })} placeholder="Número de parte" />
    </label>
    <span class="nota">La unidad va en la columna U.M. y el contenedor en "Entra a".</span>
    ${parecidas.length
      ? html`<div class="parecidas">
          <span class=${parecidas[0].igual ? "alerta" : "nota"}>${parecidas[0].igual ? "Esta variante ya existe:" : "¿Es alguna de estas? (para no duplicar)"}</span>
          ${parecidas.slice(0, 4).map(
            (p) => html`<button type="button" class="boton boton-secundario boton-chico" onClick=${() => alUsar(p.variante)}>
              Usar ${[p.variante.dimension, p.variante.np ? `NP ${p.variante.np}` : ""].filter(Boolean).join(" · ") || "S/D"} ${p.variante.um}
              ${p.lugares.length ? html`<small> (${p.lugares.join(", ")})</small>` : null}
            </button>`,
          )}
        </div>`
      : null}
  </div>`;
}

// ---------------------------------------------------------------- editor

/**
 * Editor de una entrada (borrador nuevo o corrección de una confirmada).
 * @param excluirValeId  en una corrección, la entrada que se corrige
 */
export function EditorEntrada({ datos, alCambiar, errores = [], excluirValeId = null, pie = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const articulos = useMemo(() => indiceArticulos(estado, indices), [estado.articulos, estado.existencias]);
  const sugerencias = useMemo(() => listas(estado), [estado.personas, estado.plantillas_area]);
  const lugares = useMemo(
    () => [...new Set([...sugerencias.lugares, ...estado.vales.filter((v) => v.tipo === "ENTRADA").flatMap((v) => [v.origen])].filter(Boolean))],
    [sugerencias, estado.vales],
  );
  const preferencias = preferenciasVale(estado, sesion.usuario);
  const errorEn = (campo, renglon = null) => errores.find((e) => e.campo === campo && e.renglon === renglon);
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });
  const [folioDevolucion, setFolioDevolucion] = useState(datos.devolucion_folio ? String(datos.devolucion_folio) : "");

  const enfocar = useRef(null);
  useLayoutEffect(() => {
    if (!enfocar.current) return;
    const entrada = document.getElementById(enfocar.current);
    if (entrada) {
      entrada.focus();
      entrada.select?.();
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
  const repetida = datos.motivo !== "DEVOLUCION" ? entradaConFolioBase(estado, datos.folio_externo, excluirValeId) : null;
  const devolucion = datos.motivo === "DEVOLUCION";
  const traerDevolucion = () => {
    try {
      const traidos = datosDeDevolucion(estado, folioDevolucion);
      if (lineasEntradaCapturadas(datos.lineas).length && !confirmar(`¿Cambiar los renglones de esta entrada por los del vale ${traidos.devolucion_folio}?`)) return;
      cambiar(traidos);
      sesion.avisar("exito", `Se trajeron los renglones del vale ${traidos.devolucion_folio}: ajusta las cantidades a lo que regresó.`);
    } catch (error) {
      if (error instanceof ErrorEntrada) sesion.avisar("error", error.message);
      else throw error;
    }
  };
  let numero = 0;

  return html`<div class=${`editor-vale editor-entrada ${preferencias.lado}`}>
    <aside class="vale-datos" aria-label="Datos de la entrada">
      <div class="bloque-vale">
        <div class="campo">
          <span>Motivo</span>
          <${Lista}
            id="motivo-entrada"
            valor=${datos.motivo ?? "BASE"}
            alCambiar=${(motivo) => cambiar({ motivo })}
            ariaLabel="Motivo de la entrada"
            opciones=${Object.entries(MOTIVOS_ENTRADA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
          />
        </div>
        ${devolucion
          ? html`<${Campo} etiqueta="Folio del vale de salida que se devuelve" error=${errorEn("devolucion_folio")}>
              <div class="acciones-linea sin-margen">
                <input
                  id="folio-devolucion"
                  inputmode="numeric"
                  value=${folioDevolucion}
                  onInput=${(e) => {
                    setFolioDevolucion(e.currentTarget.value);
                    cambiar({ devolucion_folio: e.currentTarget.value.trim() || null });
                  }}
                  onKeyDown=${(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      traerDevolucion();
                    }
                  }}
                  placeholder="Ej. 555"
                />
                <${Boton} tamano="chico" onClick=${traerDevolucion} disabled=${!folioDevolucion.trim()}>Traer renglones<//>
              </div>
            <//>`
          : html`<${Campo} etiqueta="Folio del vale de la base" error=${errorEn("folio_externo")} ayuda="El número del vale en papel que llega con el material.">
              <input id="folio-base" value=${datos.folio_externo ?? ""} onInput=${(e) => cambiar({ folio_externo: e.currentTarget.value, folio_repetido: false })} placeholder="Ej. 12345" />
            <//>`}
        ${repetida
          ? html`<label class="casilla aviso-folio">
              <input type="checkbox" checked=${Boolean(datos.folio_repetido)} onChange=${(e) => cambiar({ folio_repetido: e.currentTarget.checked })} />
              <span>
                Ese folio ya se registró en la entrada <a href=${`#entrada/${repetida.id}`}>${folioEntrada(repetida.folio)}</a> (${fmtFecha(repetida.fecha)}).
                Márcalo solo si es <strong>otro vale</strong> con el mismo folio.
              </span>
            </label>`
          : null}
        <${Campo} etiqueta="Fecha" error=${errorEn("fecha")}>
          <input type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
        <//>
      </div>
      <div class="bloque-vale">
        <div class="rejilla-campos">
          <${Campo} etiqueta="Viene de"><${CampoSugerido} valor=${datos.origen} alCambiar=${(origen) => cambiar({ origen })} sugerencias=${lugares} ariaLabel="Viene de" placeholder="Ej. BASE" /><//>
          <${Campo} etiqueta="Depto. origen"><${CampoSugerido} valor=${datos.depto_origen} alCambiar=${(depto_origen) => cambiar({ depto_origen })} sugerencias=${sugerencias.deptos} ariaLabel="Depto. origen" /><//>
        </div>
        <${Campo} etiqueta="Entregó" ayuda="Quien trae el material (chofer, almacenista de la base…).">
          <${CampoSugerido} valor=${datos.entrego_nombre} alCambiar=${(entrego_nombre) => cambiar({ entrego_nombre })} sugerencias=${sugerencias.personas} ariaLabel="Entregó" />
        <//>
        <${Campo} etiqueta="Observaciones">
          <textarea rows="3" value=${datos.observaciones ?? ""} onInput=${(e) => cambiar({ observaciones: e.currentTarget.value })}></textarea>
        <//>
      </div>
      <div class="bloque-vale">
        <div class="datos-automaticos">
          <span class="subtitulo-panel">Se llenan solos</span>
          <dl class=${`datos-fijos ${!datos.recibio_nombre && !sesion.usuario ? "datos-fijos-error" : ""}`}>
            <dt>Llega a</dt>
            <dd>${datos.destino || "RIG 91"} · ${datos.depto_destino || "ALMACEN"}</dd>
            <dt>Recibe</dt>
            <dd>
              ${excluirValeId !== null
                ? datos.recibio_nombre || "—"
                : sesion.usuario
                  ? html`${sesion.usuario} <small>en turno</small>`
                  : html`<span class="alerta">Elige quién está en turno (arriba a la derecha)</span>`}
            </dd>
          </dl>
        </div>
      </div>
    </aside>

    <div class="vale-principal">
      <section class="vale-partidas" aria-label="Renglones de la entrada">
        <header class="partidas-cabeza">
          <h2>Renglones</h2>
          <span class="contador-partidas">${lineasEntradaCapturadas(datos.lineas).length}</span>
          <span class="nota">Código → clave (se sugiere el contenedor donde ya está) → cantidad. Lo gris es información del inventario.</span>
        </header>
        <div class="tabla-contenedor tabla-partidas">
          <table class="tabla">
            <colgroup>
              <col class="c-num" /><col class="c-oc" /><col class="c-cant" /><col class="c-cod" /><col />
              <col class="c-destino" /><col class="c-um" /><col class="c-quitar" />
            </colgroup>
            <thead class="cabecera-vale">
              <tr>
                <th class="numero">#</th>
                <th>O.C.</th>
                <th class="numero">Cantidad</th>
                <th>Código</th>
                <th class="col-descripcion">Descripción del material</th>
                <th>Clave / dimensión · entra a</th>
                <th title="Presentación (unidad de medida)">U.M.</th>
                <th><span class="solo-lector">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              ${datos.lineas.map((l) => {
                const blanco = !Number.isInteger(l.codigo) && !String(l.cantidad ?? "").trim() && !String(l.clave ?? "").trim() && !l.alta;
                if (!blanco) numero += 1;
                const n = blanco ? null : numero;
                const opciones = Number.isInteger(l.codigo) ? opcionesDe(l.codigo) : [];
                const conocido = Number.isInteger(l.codigo) && Boolean(estado.articulos[l.codigo]);
                const alta = Boolean(l.alta) && !hay(l.existencia_id) && !l.no_inventariado;
                const conVariante = hay(l.existencia_id) || (hay(l.ubicacion_id) && hay(l.variante_id));
                const elegida = opciones.find((o) => o.id === l.existencia_id) ?? null;
                const errorDestino = n && errorEn("destino", n);
                const fila = previa.find((p) => p.uid === l.uid);
                return html`<tr key=${l.uid} class=${n && errores.some((e) => e.renglon === n) ? "fila-error" : ""}>
                    <td class="numero">${n ?? ""}</td>
                    <td><input class="entrada-oc" placeholder="S/OC" value=${l.oc} onInput=${(e) => cambiarLinea(l.uid, { oc: e.currentTarget.value })} aria-label="O.C." /></td>
                    <td>
                      <input
                        id=${`cant-${l.uid}`}
                        class=${`entrada-cantidad ${n && errorEn("cantidad", n) ? "con-error" : ""}`}
                        inputmode="decimal"
                        value=${l.cantidad}
                        onInput=${(e) => cambiarLinea(l.uid, { cantidad: e.currentTarget.value.replace(",", ".") })}
                        onKeyDown=${(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            siguienteFila(l.uid);
                          }
                        }}
                        aria-label="Cantidad"
                      />
                    </td>
                    <td>
                      <${CeldaCodigo}
                        linea=${l}
                        articulos=${articulos}
                        error=${n && errorEn("codigo", n)}
                        alElegir=${(codigo, mover) => {
                          if (codigo === l.codigo) {
                            if (mover) enfocar.current = hay(l.existencia_id) ? `cant-${l.uid}` : `eclv-${l.uid}`;
                            return;
                          }
                          const nueva = { ...entradaConArticulo(estado, l, codigo, { indices }), alta: false };
                          cambiarLinea(l.uid, nueva, mover ? (hay(nueva.existencia_id) ? `cant-${l.uid}` : `eclv-${l.uid}`) : null);
                        }}
                        alNuevo=${(codigo) => cambiarLinea(l.uid, { ...entradaConArticulo(estado, l, codigo, { indices }), descripcion: "", alta: false }, `desc-${l.uid}`)}
                      />
                    </td>
                    <td class="col-descripcion">
                      ${Number.isInteger(l.codigo) && !conocido
                        ? html`<input
                            id=${`desc-${l.uid}`}
                            class=${n && errorEn("descripcion", n) ? "con-error" : ""}
                            value=${l.descripcion}
                            placeholder="Descripción (código nuevo, queda por confirmar)"
                            onInput=${(e) => cambiarLinea(l.uid, { descripcion: e.currentTarget.value })}
                          />`
                        : html`<span class="descripcion">${l.descripcion || html`<span class="nota">—</span>`}</span>`}
                    </td>
                    <td>
                      <div class="celda-clave">
                        ${alta
                          ? html`<div class="clave-alta">
                              <strong>${l.clave || "S/D"}</strong>
                              <button type="button" class="enlace-boton" onClick=${() => cambiarLinea(l.uid, { ...entradaConArticulo(estado, { ...l, clave: "" }, l.codigo, { indices }), alta: false }, `eclv-${l.uid}`)}>cambiar</button>
                            </div>`
                          : html`<${CeldaDestino}
                              linea=${l}
                              opciones=${opciones}
                              error=${errorDestino || (n && errorEn("um", n) && !l.um)}
                              alElegir=${(o, mover) => cambiarLinea(l.uid, (actual) => ({ ...conRenglonExistente(estado, actual, o.id, indices), alta: false }), mover ? `cant-${l.uid}` : null)}
                              alNueva=${() => cambiarLinea(l.uid, (actual) => ({ ...conVarianteNueva(actual, { dimension: elegida ? "" : actual.clave, um: actual.um }), alta: true }), `edim-${l.uid}`)}
                              alSinExistencia=${() => cambiarLinea(l.uid, (actual) => ({ ...entradaSinExistencia(actual), alta: false }), `cant-${l.uid}`)}
                              alEscribir=${(valor) =>
                                cambiarLinea(l.uid, (actual) => {
                                  const sigue = elegida && normal(elegida.clave) === normal(valor);
                                  return sigue ? { ...actual, clave: valor } : { ...actual, clave: valor, existencia_id: null, variante_id: null, ubicacion_id: null, no_inventariado: false };
                                })}
                            />`}
                        <div class="pastillas">
                          ${l.no_inventariado
                            ? html`<${Pastilla} titulo="Queda en el historial de entradas pero no suma a ningún renglón">Sin existencia · no suma<//>`
                            : conVariante || alta
                              ? html`<${Lista}
                                    clase=${`lista-entra ${errorDestino ? "con-error" : ""}`}
                                    valor=${fila?.tipo === "renglon" || fila?.tipo === "nuevo" ? (hay(l.existencia_id) ? indices.existencia(l.existencia_id)?.ubicacion_id : l.ubicacion_id) : ""}
                                    alCambiar=${(ubicacionId) =>
                                      cambiarLinea(l.uid, (actual) => (alta ? { ...actual, ubicacion_id: Number(ubicacionId) } : { ...conOtroContenedor(estado, actual, Number(ubicacionId), indices), alta: false }))}
                                    ariaLabel="Entra a (contenedor)"
                                    placeholder="— ¿A qué contenedor? —"
                                    opciones=${opcionesContenedor(estado, alta ? { ...l, variante_id: null, existencia_id: null } : l, indices).map((c) => ({ ...c, etiqueta: `Entra a ${c.etiqueta}` }))}
                                  />
                                  ${fila?.tipo === "renglon" ? html`<${Pastilla} tono="ok" titulo="Existencia de ese renglón antes de esta entrada">hay ${num(aNumero(fila.habia))} ${l.um}<//>` : null}
                                  ${fila?.tipo === "nuevo" ? html`<${Pastilla} tono="info" titulo="Se agrega al final de esa hoja del inventario">renglón nuevo<//>` : null}`
                              : Number.isInteger(l.codigo)
                                ? html`<${Pastilla} tono="error">Elige la clave o una nueva<//>`
                                : null}
                        </div>
                      </div>
                    </td>
                    <td><input class=${`entrada-um ${n && errorEn("um", n) ? "con-error" : ""}`} value=${l.um} onInput=${(e) => cambiarLinea(l.uid, { um: e.currentTarget.value })} aria-label="Presentación (UM)" /></td>
                    <td>
                      <button type="button" class="boton-quitar" title="Quitar este renglón" onClick=${() => quitar(l.uid)}><span aria-hidden="true">✕</span> Quitar</button>
                    </td>
                  </tr>
                  ${alta
                    ? html`<tr class="fila-aviso" key=${`${l.uid}-alta`}>
                        <td></td>
                        <td colspan="7">
                          <${FilaAlta}
                            linea=${l}
                            estado=${estado}
                            indices=${indices}
                            alCambiar=${(cambio) =>
                              cambiarLinea(l.uid, (actual) => ({
                                ...conVarianteNueva(actual, { dimension: actual.dimension, np: actual.np, um: actual.um, ubicacionId: actual.ubicacion_id, ...cambio }),
                                alta: true,
                              }))}
                            alUsar=${(variante) => {
                              const renglon = destinosDeCodigo(estado, l.codigo, { indices, saldos }).find((o) => o.variante_id === variante.id && o.sugerida);
                              if (renglon) cambiarLinea(l.uid, (actual) => ({ ...conRenglonExistente(estado, actual, renglon.id, indices), alta: false }), `cant-${l.uid}`);
                            }}
                          />
                        </td>
                      </tr>`
                    : null}`;
              })}
            </tbody>
          </table>
        </div>
        <div class="acciones-linea">
          <${Boton} onClick=${() => agregarLinea()}>＋ Agregar renglón<//>
          <span class="nota">Si el material ya está en varios contenedores, se sugiere el que tiene más (★). Puedes cambiarlo en "Entra a".</span>
        </div>
      </section>

      <section class="vale-partidas previa-entrada" aria-label="Así queda el inventario">
        <header class="partidas-cabeza">
          <h2>Así queda el inventario</h2>
          <span class="nota">Nada cambia hasta confirmar.</span>
        </header>
        ${previa.length
          ? html`<div class="tabla-contenedor">
              <table class="tabla">
                <thead>
                  <tr>
                    <th class="numero">#</th>
                    <th>Material</th>
                    <th>Hoja del inventario</th>
                    <th class="numero">Había</th>
                    <th class="numero">Entra</th>
                    <th class="numero">Queda</th>
                  </tr>
                </thead>
                <tbody>
                  ${previa.map(
                    (p) => html`<tr key=${p.uid} class=${p.tipo === "pendiente" || p.tipo === "invalido" ? "fila-error" : ""}>
                      <td class="numero">${p.renglon}</td>
                      <td>
                        <strong>${p.codigo ?? "?"}</strong> ${p.descripcion} <span class="nota">${p.clave}</span>
                        ${p.variante_nueva ? html` <${Pastilla} tono="info">variante nueva<//>` : p.renglon_nuevo ? html` <${Pastilla} tono="info">renglón nuevo<//>` : null}
                      </td>
                      <td>
                        ${p.hoja
                          ? html`<span class="sin-corte">${p.hoja}</span>`
                          : p.tipo === "sin_existencia"
                            ? html`<span class="nota">Sin existencia (no suma)</span>`
                            : html`<span class="alerta">Falta elegir a dónde entra</span>`}
                      </td>
                      <td class="numero">${p.habia ? num(aNumero(p.habia)) : "—"}</td>
                      <td class="numero">${p.entra ? `+${num(aNumero(p.entra))}` : "—"}</td>
                      <td class="numero"><strong class=${p.queda && p.queda.lt(0) ? "alerta" : ""}>${p.queda ? num(aNumero(p.queda)) : "—"}</strong> ${p.queda ? p.um : ""}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : html`<p class="nota">Captura los renglones y aquí verás cuánto había, cuánto entra y cuánto queda en cada contenedor.</p>`}
      </section>
      ${pie ? html`<div class="vale-pie">${pie}</div>` : null}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- página

function ConfirmadaOk({ vale, alNueva }) {
  const renglones = vale.lineas.filter((l) => hay(l.existencia_id)).length;
  return html`<${Tarjeta} titulo=${`✓ Entrada ${folioEntrada(vale.folio)} registrada`} clase="tarjeta-exito">
    <p>
      ${vale.folio_externo ? html`Vale de la base <strong>${vale.folio_externo}</strong>.${" "}` : null}Sumó al INGRESO de ${renglones}${" "}
      ${renglones === 1 ? "renglón" : "renglones"} del inventario. Queda en el historial de entradas.
    </p>
    <div class="acciones-linea">
      <a class="boton boton-secundario" href=${`#entrada/${vale.id}`}>Ver entrada ${folioEntrada(vale.folio)}</a>
      <${Boton} tipo="primario" onClick=${alNueva}>＋ Nueva entrada<//>
    </div>
  <//>`;
}

export function PaginaValesEntrada() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(estado.borradores_entrada[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [errores, setErrores] = useState([]);
  const [confirmada, setConfirmada] = useState(null);
  const pendiente = useRef(null);
  const porGuardar = useRef(null);

  useEffect(() => {
    const b = borradorEntrada(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setErrores([]);
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
    if (errores.length) setErrores(validarEntrada(estado, { ...valor, recibio_nombre: sesion.usuario || valor.recibio_nombre }).errores);
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
  const descartar = () => {
    if (lineasEntradaCapturadas(datos.lineas).length && !confirmar("¿Descartar esta entrada en borrador? No gasta folio.")) return;
    return sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      await sesion.almacen.modificar((e) => descartarBorradorEntrada(e, datos.id));
      setActivo(sesion.estado.borradores_entrada[0]?.id ?? null);
    });
  };
  const confirmarEsta = () =>
    sesion.tarea("Registrando entrada…", async () => {
      const listo = { ...datos, recibio_nombre: sesion.usuario || datos.recibio_nombre };
      const { errores: faltan } = validarEntrada(sesion.estado, listo);
      setErrores(faltan);
      if (faltan.length) return;
      const folio = folioEntrada(siguienteFolio(sesion.estado, "ENTRADA"));
      const n = lineasEntradaCapturadas(datos.lineas).length;
      if (!confirmar(`¿Registrar la entrada ${folio} con ${n} ${n === 1 ? "renglón" : "renglones"}? Suma al inventario; después solo se puede corregir (con motivo).`)) return;
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
        if (error instanceof ErrorEntrada) {
          setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
          return;
        }
        throw error;
      }
    });

  const borradores = estado.borradores_entrada;
  const folio = folioEntrada(siguienteFolio(estado, "ENTRADA"));
  const nombreDe = (b) => (b.motivo === "DEVOLUCION" ? `Devolución${b.devolucion_folio ? ` ${b.devolucion_folio}` : ""}` : b.folio_externo ? `Base ${b.folio_externo}` : "Entrada nueva");
  return html`
    ${borradores.length
      ? html`<div class="pestanas" role="tablist" aria-label="Entradas en borrador">
          ${borradores.map((b) => {
            const actual = b.id === datos?.id ? datos : b;
            const n = lineasEntradaCapturadas(actual.lineas).length;
            const activa = b.id === activo && !confirmada;
            return html`<button type="button" role="tab" aria-selected=${activa} class=${`pestana ${activa ? "activa" : ""}`} onClick=${() => cambiarPestana(b.id)}>
              ${nombreDe(actual)}
              <span class="pastilla-conteo" title=${`${n} ${n === 1 ? "renglón" : "renglones"}`}>${n}</span>
            </button>`;
          })}
          <button type="button" class="pestana nueva" onClick=${nueva}>＋ Nueva entrada</button>
        </div>`
      : null}

    ${confirmada ? html`<${ConfirmadaOk} vale=${confirmada} alNueva=${nueva} />` : null}

    ${!confirmada && datos
      ? html`<div class="barra-borrador">
            <span>Borrador · se registrará como <strong class="folio-grande">${folio}</strong></span>
            <span class="nota">Se guarda solo · creado ${fmtFecha(datos.creado_en)}</span>
          </div>
          <${EditorEntrada}
            key=${datos.id}
            datos=${datos}
            alCambiar=${cambiar}
            errores=${errores}
            pie=${html`<${ListaErrores} errores=${errores} />
              <div class="acciones-linea pie-editor">
                <${Boton} tipo="peligro-texto" onClick=${descartar}>Descartar borrador<//>
                <span class="espaciador"></span>
                <${Boton} tipo="primario" tamano="grande" disabled=${!lineasEntradaCapturadas(datos.lineas).length} onClick=${confirmarEsta}>Registrar entrada · ${folio}<//>
              </div>`}
          />`
      : null}

    ${!confirmada && !datos && !borradores.length
      ? html`<${Tarjeta} clase="tarjeta-inicio-vales">
          <p>
            Registra el material que llega de la base (o que se devuelve). Cada renglón entra a un renglón del inventario: si el
            material ya está en un contenedor, se sugiere ese. Antes de registrar ves cuánto había, cuánto entra y cuánto queda.
          </p>
          <${Boton} tipo="primario" tamano="grande" onClick=${nueva}>＋ Nueva entrada · ${folio}<//>
        <//>`
      : null}
  `;
}
