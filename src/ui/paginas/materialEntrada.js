// Ronda 39 (docs/14-rediseno-entradas-y-correccion.md §5): paso 2 · Material del vale de entrada. A la izquierda (~40 %)
// *De dónde viene* con «Editar» y *Agregar partidas* (lo de Copilot y el buscador de dos campos del vale de salida); a
// la derecha (~60 %) la lista: fondo gris, una tarjeta blanca por partida, la cabeza con los filtros y el pie con los
// botones fijos. Cada partida: cantidad, qué material es, su tipo (Consumible | Inventariable), «Editar» y quién lo
// solicita y la O.C. Editar una partida cambia el panel de la izquierda por *Editando la partida N* (§5.2).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { problemaDeCantidad } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { acomodoDe, conTipo } from "../../servicios/acomodoEntrada.js";
import { indiceMaterial } from "../../servicios/buscarMaterial.js";
import { destinosDeCodigo, lineasEntradaCapturadas } from "../../servicios/entradas.js";
import {
  FILTROS_MATERIAL,
  TIPOS,
  camposDeLinea,
  conCamposEditados,
  filtrosDeMaterial,
  partidaDesdeResultado,
  porRevisar,
  sinOc,
  sinSolicitante,
  tipoDeLinea,
  tipoPorDefecto,
  varianteEscrita,
} from "../../servicios/materialEntrada.js";
import { AyudaAtajos, Boton, CampoSugerido, Pastilla, Tecla, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { ResumenDeDondeViene } from "./deDondeViene.js";
import { BotonDescripcion } from "./descripcion.js";
import { BotonMasDibujado, Buscador, DobleClic, Resultados, enfocar, escEnCampo, useAltoDisponible, useBusqueda } from "./material.js";
import { BotonEditar } from "./pasosVale.js";
import { listas } from "./vales.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const partidasDe = (n) => `${n} ${n === 1 ? "partida" : "partidas"}`;
const hay = (v) => v !== null && v !== undefined;

/** Consumible | Inventariable, como DLTA | GSM; el punto dice cuál (contorno = consumible, relleno = inventariable). */
function InterruptorTipo({ n, clase, bloqueado, alCambiar }) {
  return html`<div class=${`interruptor-tipo ${bloqueado ? "bloqueado" : ""}`} role="radiogroup" aria-label=${`Tipo de la partida ${n}`}>
    ${["CONS", "INV"].map(
      (c) => html`<button
        type="button"
        key=${c}
        role="radio"
        aria-checked=${clase === c}
        disabled=${bloqueado && c !== clase}
        onClick=${() => clase !== c && alCambiar(c)}
      >
        <span class=${`punto-tipo punto-${c.toLowerCase()}`} aria-hidden="true"></span>${TIPOS[c]}
      </button>`,
    )}
  </div>`;
}

/** Lo que es la partida: «dimensión · NP» y debajo «código · descripción», con sus pastillas. */
function QueEs({ l, indices, estado }) {
  const campos = camposDeLinea(l, indices);
  const dimension = l.no_inventariado ? texto(l.clave) || "S/D" : campos.dimension || "S/D";
  const np = l.no_inventariado ? "" : campos.np;
  const a = acomodoDe(estado, l, { indices });
  const nuevoCodigo = Number.isInteger(l.codigo) && !estado.articulos[l.codigo];
  const titulo = [l.codigo, l.descripcion, dimension, np ? `NP ${np}` : null].filter(Boolean).join(" · ");
  return html`<div class="que-entrada" title=${titulo}>
    <span class="clave-entrada">${dimension}${np ? html` <span class="np-entrada">· NP ${np}</span>` : null}</span>
    <span class="codigo-entrada">${Number.isInteger(l.codigo) ? l.codigo : "Sin código"} · ${l.descripcion || "—"}</span>
    <span class="pastillas-entrada">
      ${l.alta ? html`<${Pastilla} tono="info">Variante nueva<//>` : null}
      ${nuevoCodigo ? html`<${Pastilla} tono="alerta">Código nuevo<//>` : null}
      ${l.no_inventariado ? html`<${Pastilla} tono="oscura">Sin existencia · no suma<//>` : null}
      ${a.estado === "acomodada" && a.fx ? html`<${Pastilla} tono="fx">FX<//>` : null}
    </span>
  </div>`;
}

/** Una partida de la lista (§5): tarjeta blanca; lo que necesita atención, con su franja ámbar arriba. */
function PartidaEntrada({ l, n, estado, indices, editando, nueva, solicitantes, alCambiar, alReemplazar, alEditar, alQuitar, alEnter }) {
  const revisar = porRevisar(estado, l, { indices });
  const tipo = tipoDeLinea(estado, l, { indices });
  const cantidadFalta = Boolean(problemaDeCantidad(l.cantidad));
  // La unidad se escribe solo si no es de una variante del inventario (variante nueva, sin existencia o sin código).
  const umEditable = l.no_inventariado || l.alta || !Number.isInteger(l.codigo);
  return html`<li
    class=${`tarjeta-entrada ${editando ? "editando" : ""} ${revisar ? "por-revisar" : ""} ${nueva ? "recien" : ""}`}
    data-partida=${l.uid}
    aria-current=${editando ? "true" : undefined}
    aria-label=${`Partida ${n}`}
  >
    ${editando ? html`<span class="etiqueta-editando">Editando</span>` : null}
    ${revisar
      ? html`<div class="franja-revisar">
          <${Icono} nombre="alerta" tam=${16} />
          <span><strong>Por revisar:</strong> ${revisar.texto}</span>
          ${revisar.tipo === "copilot"
            ? html`<button type="button" class="boton boton-secundario boton-chico" onClick=${() => alCambiar({ dudoso: false })}>Está bien</button>`
            : html`<button type="button" class="boton boton-secundario boton-chico" onClick=${alEditar}>Elegir</button>`}
        </div>`
      : null}
    <div class="tarjeta-entrada-uno">
      <span class="n-entrada" aria-hidden="true">${n}</span>
      <div class=${`cantidad-entrada ${cantidadFalta ? "falta-dato" : ""}`}>
        <input
          id=${`cant-${l.uid}`}
          value=${l.cantidad ?? ""}
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          aria-label=${`Cantidad de la partida ${n}`}
          onInput=${(e) => alCambiar({ cantidad: e.currentTarget.value.replace(",", ".") })}
          onKeyDown=${(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              alEnter();
            }
          }}
        />
        ${umEditable
          ? html`<input
              id=${`um-${l.uid}`}
              class=${`um-entrada-campo ${texto(l.um) ? "" : "falta-um"}`}
              value=${l.um ?? ""}
              autocomplete="off"
              placeholder="U.M."
              aria-label=${`Unidad de la partida ${n}`}
              onInput=${(e) => alCambiar({ um: e.currentTarget.value.toUpperCase() })}
            />`
          : html`<span class="um-entrada">${texto(l.um) || "U.M."}</span>`}
      </div>
      <${QueEs} l=${l} indices=${indices} estado=${estado} />
      ${l.no_inventariado
        ? html`<span class="tipo-vacio"></span>`
        : html`<div class="tipo-entrada">
            <${InterruptorTipo} n=${n} clase=${tipo.clase} bloqueado=${tipo.bloqueado} alCambiar=${(clase) => alReemplazar((x) => conTipo(estado, x, clase, { indices }))} />
            ${tipo.nota ? html`<span class="nota-tipo">${tipo.nota}</span>` : null}
          </div>`}
      <div class="acciones-entrada">
        <${BotonEditar} etiqueta=${`Editar la partida ${n}`} onClick=${alEditar} />
        <button type="button" class="boton-quitar-partida" aria-label=${`Quitar la partida ${n}`} title="Quitar" onClick=${alQuitar}>
          <${Icono} nombre="cerrar" tam=${16} />
        </button>
      </div>
    </div>
    <div class="tarjeta-entrada-dos">
      <label class=${`campo-linea ${sinSolicitante(l) ? "falta-dato" : ""}`}>
        <span>Solicita</span>
        <${CampoSugerido}
          id=${`lote-${l.uid}`}
          valor=${l.lote ?? ""}
          alCambiar=${(lote) => alCambiar({ lote: lote.toUpperCase() })}
          sugerencias=${solicitantes}
          placeholder="Falta solicitante"
          ariaLabel=${`Quién solicita la partida ${n} (va en LOTE)`}
        />
      </label>
      <label class=${`campo-linea campo-oc ${sinOc(l) ? "falta-dato" : ""}`}>
        <span>O.C.</span>
        <input
          id=${`oc-${l.uid}`}
          value=${l.oc ?? ""}
          autocomplete="off"
          placeholder="Falta O.C."
          aria-label=${`O.C. de la partida ${n}`}
          onInput=${(e) => alCambiar({ oc: e.currentTarget.value.toUpperCase() })}
        />
      </label>
    </div>
  </li>`;
}

/**
 * *Editando la partida N* (§5.2): código, dimensión, NP y U.M.; las claves con existencia de ese código («Actual» la de
 * la partida, «Usar esta» las demás) y, si lo escrito no está, la variante nueva. «Listo» guarda; «Cancelar · Esc»
 * deja la partida como estaba.
 */
function EditarPartidaEntrada({ linea, n, estado, indices, saldos, alListo, alCancelar, alDescripcion }) {
  const [campos, setCampos] = useState(() => camposDeLinea(linea, indices));
  const [existenciaId, setExistenciaId] = useState(() => (hay(linea.existencia_id) ? linea.existencia_id : null));
  const codigo = /^\d+$/.test(campos.codigo) ? Number(campos.codigo) : null;
  const articulo = codigo !== null ? estado.articulos[codigo] : null;
  const claves = useMemo(() => (codigo !== null ? destinosDeCodigo(estado, codigo, { indices, saldos }) : []), [codigo, estado, saldos]);
  const variante = existenciaId !== null ? (indices.variante(indices.existencia(existenciaId)?.variante_id) ?? null) : varianteEscrita(indices, codigo, campos);
  const nueva = !campos.sinExistencia && codigo !== null && !variante && texto(campos.dimension + campos.np) !== "";
  const cambiar = (cambios) => {
    setCampos((c) => ({ ...c, ...cambios }));
    setExistenciaId(null);
  };
  const usar = (o) => {
    setCampos((c) => ({ ...c, dimension: o.clave === "SIN DIMENSIÓN" ? "" : o.clave, np: o.np, um: o.um, sinExistencia: false }));
    setExistenciaId(o.id);
  };
  const listo = () => alListo({ ...campos, existenciaId });
  useEffect(() => enfocar("editar-dimension", true), []);
  const tecla = (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.stopPropagation();
      alCancelar();
    } else if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.getAttribute("aria-expanded") !== "true") {
      e.preventDefault();
      listo();
    }
  };
  const quien = [linea.codigo, linea.descripcion, camposDeLinea(linea, indices).dimension].filter(Boolean).join(" · ");
  return html`<section class="panel-editar-entrada" aria-label=${`Editando la partida ${n}`} onKeyDown=${tecla} data-sin-avanzar>
    <header class="panel-editar-cabeza">
      <${Icono} nombre="lapiz" tam=${18} />
      <span class="panel-editar-titulo"><strong>Editando la partida ${n}</strong><span>${quien}</span></span>
      <button type="button" class="boton boton-secundario boton-chico" onClick=${alCancelar}>Cancelar · Esc</button>
    </header>
    <div class="campos-editar">
      <label class="campo campo-grande campo-codigo-editar">
        <span>Código</span>
        <input id="editar-codigo" value=${campos.codigo} inputmode="numeric" autocomplete="off" onInput=${(e) => cambiar({ codigo: e.currentTarget.value.trim() })} />
      </label>
      <label class="campo campo-grande">
        <span>Dimensión</span>
        <input id="editar-dimension" value=${campos.dimension} autocomplete="off" placeholder="S/D" onInput=${(e) => cambiar({ dimension: e.currentTarget.value.toUpperCase() })} />
      </label>
      <label class="campo campo-grande">
        <span>NP</span>
        <input id="editar-np" value=${campos.np} autocomplete="off" placeholder="Sin NP" onInput=${(e) => cambiar({ np: e.currentTarget.value.toUpperCase() })} />
      </label>
      <label class="campo campo-grande campo-um-editar">
        <span>U.M.</span>
        <input id="editar-um" value=${campos.um} autocomplete="off" onInput=${(e) => cambiar({ um: e.currentTarget.value.toUpperCase() })} />
      </label>
    </div>
    ${codigo !== null && !articulo
      ? html`<label class="campo campo-grande">
          <span>Descripción (código nuevo)</span>
          <input id="editar-descripcion" value=${campos.descripcion} autocomplete="off" onInput=${(e) => setCampos((c) => ({ ...c, descripcion: e.currentTarget.value.toUpperCase() }))} />
        </label>`
      : null}
    ${codigo !== null
      ? html`<div class="claves-codigo">
          <div class="claves-codigo-titulo">
            <span><strong>${codigo} · ${articulo?.descripcion ?? (campos.descripcion || "código nuevo")}</strong> · ${claves.length ? "claves con existencia" : "sin existencia"}</span>
            ${articulo ? html`<${BotonDescripcion} codigo=${codigo} alCambiar=${alDescripcion} />` : null}
          </div>
          <ul class="claves-lista">
            ${claves.map((o) => {
              const actual = existenciaId !== null ? o.id === existenciaId : !campos.sinExistencia && variante?.id === o.variante_id;
              return html`<li key=${o.id} class=${actual ? "actual" : ""}>
                <span class="punto-tipo punto-inv" aria-hidden="true"></span>
                <span class="clave-texto">${o.clave}${o.np ? html` <span class="np-entrada">· NP ${o.np}</span>` : null}</span>
                <span class="clave-donde">${o.lugar}${o.fx ? " · FX" : ""} · hay <strong>${num(o.total)}</strong></span>
                ${actual
                  ? html`<span class="clave-actual">Actual</span>`
                  : html`<button type="button" class="boton boton-primario boton-chico" aria-label=${`Usar ${o.clave}${o.np ? ` NP ${o.np}` : ""} de ${o.lugar}`} onClick=${() => usar(o)}>Usar esta</button>`}
              </li>`;
            })}
            ${nueva
              ? html`<li class="variante-nueva actual">
                  <${Pastilla} tono="info">Variante nueva<//>
                  <span class="clave-texto">Se queda como ${texto(campos.dimension) || "S/D"}${texto(campos.np) ? ` · NP ${campos.np}` : ""}</span>
                  <span class="clave-actual">Actual</span>
                </li>`
              : null}
          </ul>
        </div>`
      : html`<p class="falta">Escribe el código del material.</p>`}
    <label class="casilla">
      <input type="checkbox" checked=${campos.sinExistencia} onChange=${(e) => setCampos((c) => ({ ...c, sinExistencia: e.currentTarget.checked }))} />
      <span>No lleva existencia (diésel, gases): no suma al inventario</span>
    </label>
    <p class="nota">Cantidad, tipo, solicita y O.C. se conservan; esos se cambian directo en la tarjeta.</p>
    <div class="panel-editar-pie">
      <${Boton} tipo="primario" tamano="grande" onClick=${listo}>Listo<//>
    </div>
  </section>`;
}

/**
 * Paso 2. `alEditarOrigen`: «Editar» de *De dónde viene*; `alCopilot`: abre *Llenar con Copilot*; `alRegresar` /
 * `avanzar`: los botones del pie; `falta`: lo que falta para continuar (se dice al pulsar *Continuar*).
 */
export function PasoMaterialEntrada({ datos, alCambiar, alEditarOrigen, alCopilot = null, alRegresar, avanzar, falta = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const items = useMemo(() => indiceMaterial(estado, { indices, saldos }), [estado.articulos, estado.existencias, saldos]);
  const solicitantes = useMemo(
    () => [...new Set([...estado.vales.filter((v) => v.tipo === "ENTRADA").flatMap((v) => v.lineas.map((l) => texto(l.lote))), ...listas(estado).personas].filter(Boolean))],
    [estado.vales, estado.personas],
  );
  const b = useBusqueda(items, estado);
  const [filtro, setFiltro] = useState("todas");
  const [editando, setEditando] = useState(null); // uid de la partida que se edita
  const [nueva, setNueva] = useState(null);
  const [anuncio, setAnuncio] = useState("");
  const [agregarAbierto, setAgregarAbierto] = useState(true); // ventana angosta: el panel se pliega
  const raiz = useRef(null);
  const lista = useRef(null);
  const alto = useAltoDisponible(raiz);
  const actual = useRef({ datos, alCambiar });
  actual.current = { datos, alCambiar };

  const partidas = lineasEntradaCapturadas(datos.lineas);
  const { cuenta, prueba } = filtrosDeMaterial(estado, partidas, { indices });
  const visibles = partidas.filter(prueba[filtro]);
  const deCopilot = partidas.filter((l) => l.ia).length;
  const lineaEditada = editando ? (partidas.find((l) => l.uid === editando) ?? null) : null;

  useEffect(() => enfocar("buscar-material"), []);
  useEffect(() => {
    document.getElementById(`buscar-material-op-${b.marcado}`)?.scrollIntoView?.({ block: "nearest" });
  }, [b.marcado, b.material, b.dimension]);
  useEffect(() => {
    if (!nueva) return;
    lista.current?.querySelector(`[data-partida="${nueva}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [nueva]);
  // Un filtro que ya no tiene partidas vuelve a «Todas».
  useEffect(() => {
    if (filtro !== "todas" && !cuenta[filtro]) setFiltro("todas");
  }, [cuenta[filtro]]);

  // Cada cambio parte del último (aunque la página aún no se vuelva a dibujar): dos campos seguidos no se pisan.
  const aplicar = (nuevo) => {
    actual.current = { ...actual.current, datos: nuevo };
    actual.current.alCambiar(nuevo);
  };
  const cambiarLineas = (fn) => {
    const hoy = actual.current.datos;
    aplicar({ ...hoy, lineas: fn(lineasEntradaCapturadas(hoy.lineas)) });
  };
  const cambiarLinea = (uid, cambios) => cambiarLineas((lineas) => lineas.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)));
  const reemplazarLinea = (uid, fn) => cambiarLineas((lineas) => lineas.map((l) => (l.uid === uid ? fn(l) : l)));
  const conDescripcion = (codigo, descripcion) => cambiarLineas((lineas) => lineas.map((l) => (l.codigo === codigo ? { ...l, descripcion } : l)));

  const agregar = (fila, aCantidad) => {
    const linea = partidaDesdeResultado(estado, fila, { indices });
    const hoy = actual.current.datos;
    const lineas = [...lineasEntradaCapturadas(hoy.lineas), linea];
    aplicar({ ...hoy, lineas });
    setNueva(linea.uid);
    setFiltro("todas");
    b.setDimension("");
    setAnuncio(`Agregada ${linea.codigo ?? ""} ${linea.descripcion ?? ""}. ${partidasDe(lineas.length)}.`);
    if (fila.tipo === "codigo" && !texto(linea.descripcion)) setEditando(linea.uid);
    else if (aCantidad) enfocar(`cant-${linea.uid}`, true);
    else enfocar("buscar-material", true);
  };
  const quitar = (uid) => {
    const hoy = actual.current.datos;
    const lineas = lineasEntradaCapturadas(hoy.lineas);
    const i = lineas.findIndex((l) => l.uid === uid);
    const quitada = lineas[i];
    if (editando === uid) setEditando(null);
    aplicar({ ...hoy, lineas: lineas.filter((l) => l.uid !== uid) });
    sesion.avisar("info", `Partida quitada: ${quitada.codigo ?? ""} ${quitada.descripcion || ""}`.trim(), 8000, {
      etiqueta: "↶ Deshacer",
      alHacer: () => {
        const ahora = actual.current.datos;
        if (ahora.id !== hoy.id || ahora.lineas.some((l) => l.uid === uid)) return;
        const otra = lineasEntradaCapturadas(ahora.lineas);
        otra.splice(Math.min(i, otra.length), 0, quitada);
        aplicar({ ...ahora, lineas: otra });
      },
    });
    enfocar("buscar-material");
  };
  const tecla = (e, cual) => {
    if (b.mover(e)) return;
    if (e.key === "Enter" && b.opciones.length) {
      e.preventDefault();
      agregar(b.opciones[b.marcado], e.shiftKey);
    } else escEnCampo(e, b, cual);
  };
  const siguiente = (uid) => {
    const i = visibles.findIndex((l) => l.uid === uid);
    const otra = visibles[i + 1];
    if (otra) enfocar(`cant-${otra.uid}`, true);
    else enfocar("buscar-material", true);
  };
  const terminarEdicion = () => {
    const uid = editando;
    setEditando(null);
    requestAnimationFrame(() => document.querySelector(`[data-partida="${uid}"] .boton-editar`)?.focus() ?? enfocar("buscar-material"));
  };

  const izquierda = lineaEditada
    ? html`<${EditarPartidaEntrada}
        key=${lineaEditada.uid}
        linea=${lineaEditada}
        n=${partidas.indexOf(lineaEditada) + 1}
        estado=${estado}
        indices=${indices}
        saldos=${saldos}
        alListo=${(campos) => {
          reemplazarLinea(lineaEditada.uid, (l) => conCamposEditados(estado, l, campos, { indices }));
          terminarEdicion();
        }}
        alCancelar=${terminarEdicion}
        alDescripcion=${(descripcion) => conDescripcion(lineaEditada.codigo, descripcion)}
      />`
    : html`<section class=${`panel-agregar ${agregarAbierto ? "" : "plegado"}`} aria-labelledby="t-agregar">
        <h2 id="t-agregar" class="titulo-agregar">Agregar partidas</h2>
        <button type="button" class="boton-plegar-agregar" aria-expanded=${agregarAbierto} onClick=${() => setAgregarAbierto(!agregarAbierto)}>
          <span>Agregar partidas</span><span aria-hidden="true">${agregarAbierto ? "▾" : "▸"}</span>
        </button>
        ${!alCopilot
          ? null
          : deCopilot
          ? html`<div class="copilot-estado" role="status">
              <strong><${Icono} nombre="chispa" tam=${16} /> Copilot leyó ${partidasDe(deCopilot)}</strong>
              <span>Solo las marcadas en ámbar necesitan tu atención.</span>
              <span class="acciones-linea">
                <${Boton} tamano="chico" onClick=${alCopilot}>Pegar otra respuesta<//>
                <${Boton} tamano="chico" onClick=${alCopilot}>Ver instrucciones<//>
              </span>
            </div>`
          : html`<button type="button" class="boton boton-secundario boton-copilot-chico" onClick=${alCopilot}>
              <${Icono} nombre="chispa" tam=${16} /> Llenar con Copilot
            </button>`}
        <div class="material-buscar">
          <${Buscador}
            id="buscar-material"
            material=${b.material}
            dimension=${b.dimension}
            alMaterial=${b.setMaterial}
            alDimension=${b.setDimension}
            total=${b.opciones.length}
            marcado=${b.marcado}
            alTecla=${tecla}
            etiquetaMaterial="Agregar a mano · código o descripción"
          />
          <${Resultados}
            idLista="buscar-material"
            b=${b}
            marcado=${b.marcado}
            alMarcar=${b.setMarcado}
            ultimas=${new Map()}
            nombreArea=""
            alElegir=${agregar}
            entrada=${true}
            vacio="Escribe el código o la descripción del material y, si quieres, su dimensión o NP."
            alMoverADimension=${() => {
              b.setDimension(b.material);
              b.setMaterial("");
              enfocar("buscar-material-dimension");
            }}
          />
          <${AyudaAtajos} atajos=${[
            { teclas: html`<${BotonMasDibujado} /> o <${DobleClic} />`, texto: "agrega" },
            { teclas: html`<${Tecla}>⇧ Shift<//> + <${Tecla}>Enter ↵<//>`, texto: "agrega y vas a su cantidad" },
          ]} />
        </div>
      </section>`;

  return html`<div ref=${raiz} class="paso-material-entrada" style=${alto ? { "--alto-material": `${alto}px` } : null}>
    <div class="material-entrada-izq">
      <${ResumenDeDondeViene} datos=${datos} alEditar=${alEditarOrigen} />
      ${izquierda}
    </div>
    <section class="lista-entrada" aria-labelledby="t-partidas-entrada"
      onKeyDown=${(e) => {
        if (e.key === "Escape" && editando) terminarEdicion();
      }}>
      <header class="lista-entrada-cabeza">
        <div class="lista-entrada-titulo">
          <h2 id="t-partidas-entrada">Partidas · ${partidas.length}</h2>
          <span class="nota">Nuevas entran como ${TIPOS[tipoPorDefecto(estado)]}; cambia a ${TIPOS[tipoPorDefecto(estado) === "CONS" ? "INV" : "CONS"]} las que lo sean</span>
        </div>
        ${partidas.length
          ? html`<div class="filtros-entrada" role="group" aria-label="Ver partidas">
              ${FILTROS_MATERIAL.map(
                (f) => html`<button
                  type="button"
                  key=${f.id}
                  class=${`chip-filtro-entrada ${filtro === f.id ? "activo" : ""} ${f.id !== "todas" && cuenta[f.id] ? "con-pendiente" : ""}`}
                  aria-pressed=${filtro === f.id}
                  disabled=${f.id !== "todas" && !cuenta[f.id]}
                  onClick=${() => setFiltro(f.id)}
                >${f.nombre} · ${cuenta[f.id]}</button>`,
              )}
            </div>`
          : null}
      </header>
      <div class="lista-entrada-cuerpo" ref=${lista}>
        ${partidas.length
          ? html`<ol class="lista-tarjetas-entrada" aria-label="Partidas de la entrada" data-sin-avanzar>
              ${visibles.map((l) => {
                const n = partidas.indexOf(l) + 1;
                return html`<${PartidaEntrada}
                  key=${l.uid}
                  l=${l}
                  n=${n}
                  estado=${estado}
                  indices=${indices}
                  editando=${l.uid === editando}
                  nueva=${l.uid === nueva}
                  solicitantes=${solicitantes}
                  alCambiar=${(cambios) => cambiarLinea(l.uid, cambios)}
                  alReemplazar=${(fn) => reemplazarLinea(l.uid, fn)}
                  alEditar=${() => setEditando(l.uid)}
                  alQuitar=${() => quitar(l.uid)}
                  alEnter=${() => siguiente(l.uid)}
                />`;
              })}
            </ol>`
          : html`<p class="lista-vacia">Busca un material a la izquierda o llena la entrada con Copilot.</p>`}
      </div>
      <footer class="lista-entrada-pie">
        ${falta ? html`<span class="falta" role="alert">${falta}</span>` : null}
        <span class="espaciador"></span>
        ${alRegresar}
        ${avanzar}
      </footer>
    </section>
    <div class="solo-lector" aria-live="polite">${anuncio}</div>
  </div>`;
}
