import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero, dec } from "../../nucleo/decimal.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../../nucleo/fechas.js";
import {
  ErrorVale,
  aplicarPlantilla,
  borrador as buscarBorrador,
  descartarBorrador,
  disponibles,
  emitirBorrador,
  lineaDesdeExistencia,
  lineaNoInventariada,
  nuevoBorrador,
  requiereAutoriza,
  siguienteFolio,
  validarVale,
} from "../../servicios/vales.js";
import { Aviso, Boton, Tarjeta, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

// ---------------------------------------------------------------- utilidades

const normal = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

function lugarDe(ubicacion) {
  return `#${ubicacion.contenedor} ${ubicacion.clase === "INV" ? "Inv." : "Cons."}`;
}

/** Todo lo que se puede agregar a un vale: renglones del inventario y artículos del catálogo. */
function indiceBusqueda(estado) {
  const indices = new Indices(estado);
  const saldos = calcularSaldos(estado);
  const items = [];
  const conExistencia = new Set();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    const descripcion = indices.articulo(v.codigo)?.descripcion ?? "";
    const dimension = dimensionMostrada(e, v) || "";
    const np = npMostrado(e, v) || "";
    conExistencia.add(v.codigo);
    items.push({
      tipo: "existencia",
      id: e.id,
      codigo: v.codigo,
      descripcion,
      dimension,
      np,
      um: umMostrada(e, v) || "",
      lugar: lugarDe(u),
      hoja: u.hoja_excel.trim(),
      total: aNumero(saldos.get(e.id).total),
      texto: normal(`${v.codigo} ${descripcion} ${dimension} ${np} ${u.hoja_excel}`),
    });
  }
  for (const a of Object.values(estado.articulos)) {
    if (conExistencia.has(a.codigo) || a.activo === false) continue;
    items.push({ tipo: "articulo", codigo: a.codigo, descripcion: a.descripcion, texto: normal(`${a.codigo} ${a.descripcion}`) });
  }
  return items;
}

function buscar(items, consulta, limite = 12) {
  const palabras = normal(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  const codigo = /^\d+$/.test(consulta.trim()) ? Number(consulta.trim()) : null;
  const encontrados = items.filter((i) => palabras.every((p) => i.texto.includes(p)));
  const puntaje = (i) =>
    (codigo !== null && i.codigo === codigo ? 0 : codigo !== null && String(i.codigo).startsWith(String(codigo)) ? 1 : 2) * 10 +
    (i.tipo === "existencia" ? (i.total > 0 ? 0 : 1) : 2);
  return encontrados.sort((a, b) => puntaje(a) - puntaje(b) || (b.total ?? 0) - (a.total ?? 0)).slice(0, limite);
}

// ---------------------------------------------------------------- buscador

function BuscadorArticulos({ items, alElegir, alManual }) {
  const [consulta, setConsulta] = useState("");
  const [marcado, setMarcado] = useState(0);
  const resultados = useMemo(() => buscar(items, consulta), [items, consulta]);
  const elegir = (item) => {
    alElegir(item);
    setConsulta("");
    setMarcado(0);
  };
  const tecla = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarcado(Math.min(marcado + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarcado(Math.max(marcado - 1, 0));
    } else if (e.key === "Enter" && resultados[marcado]) {
      e.preventDefault();
      elegir(resultados[marcado]);
    } else if (e.key === "Escape") setConsulta("");
  };
  return html`<div class="buscador-articulos">
    <input
      id="buscar-articulo"
      type="search"
      class="buscador"
      autocomplete="off"
      placeholder="Agregar renglón: código, descripción, dimensión o NP…  (Enter agrega el primero)"
      value=${consulta}
      onInput=${(e) => {
        setConsulta(e.currentTarget.value);
        setMarcado(0);
      }}
      onKeyDown=${tecla}
      aria-label="Buscar artículo para agregar"
    />
    ${consulta.trim()
      ? html`<ul class="resultados" role="listbox">
          ${resultados.map(
            (r, i) => html`<li
              key=${`${r.tipo}${r.id ?? r.codigo}`}
              class=${i === marcado ? "marcado" : ""}
              role="option"
              aria-selected=${i === marcado}
              onMouseDown=${(e) => {
                e.preventDefault();
                elegir(r);
              }}
            >
              <strong>${r.codigo}</strong> · ${r.descripcion}
              ${r.tipo === "existencia"
                ? html`<span class="res-detalle">${[r.dimension, r.np && `NP ${r.np}`].filter(Boolean).join(" · ") || "S/D"}</span>
                    <span class=${`res-lugar ${r.total > 0 ? "" : "sin-existencia"}`}>${r.lugar} · hay ${num(r.total)} ${r.um}</span>`
                : html`<span class="res-lugar no-inv">sin existencia (no inventariado)</span>`}
            </li>`,
          )}
          ${!resultados.length ? html`<li class="vacio">Sin coincidencias.</li>` : null}
          <li class="manual" onMouseDown=${(e) => {
            e.preventDefault();
            alManual(consulta);
            setConsulta("");
          }}>＋ Capturar código a mano…</li>
        </ul>`
      : null}
  </div>`;
}

// ---------------------------------------------------------------- editor

function listas(estado) {
  const unicos = (valores) => [...new Set(valores.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    personas: unicos(estado.personas.filter((p) => p.activo !== false).map((p) => p.nombre)),
    deptos: unicos([...estado.plantillas_area.flatMap((p) => [p.depto_destino, p.depto_origen]), ...estado.vales.slice(-400).flatMap((v) => [v.depto_destino, v.depto_origen])]),
    lugares: unicos([...estado.plantillas_area.flatMap((p) => [p.destino, p.origen]), ...estado.vales.slice(-400).flatMap((v) => [v.destino, v.origen])]),
    puestos: unicos(estado.personas.map((p) => p.puesto)),
  };
}

function Campo({ etiqueta, error, children, ancho }) {
  return html`<label class=${`campo ${error ? "con-error" : ""} ${ancho ? `campo-${ancho}` : ""}`}>
    <span>${etiqueta}</span>
    ${children}
  </label>`;
}

/**
 * Editor de un vale (borrador nuevo o corrección de uno emitido).
 * @param datos     vale en edición
 * @param alCambiar recibe los datos actualizados
 */
export function EditorVale({ datos, alCambiar, errores = [], excluirValeId = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const items = useMemo(() => indiceBusqueda(estado), [estado.existencias, estado.vales, estado.articulos]);
  const opciones = useMemo(() => listas(estado), [estado.personas, estado.plantillas_area]);
  const indices = useMemo(() => new Indices(estado), [estado]);
  const errorEn = (campo, renglon = null) => errores.find((e) => e.campo === campo && e.renglon === renglon);
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });
  const cambiarLinea = (uid, cambios) => cambiar({ lineas: datos.lineas.map((l) => (l.uid === uid ? { ...l, ...cambios } : l)) });
  // Al agregar un renglón, el foco pasa a su cantidad en cuanto se pinta (sin perder teclas).
  const enfocar = useRef(null);
  useLayoutEffect(() => {
    if (!enfocar.current) return;
    const entrada = document.getElementById(`cant-${enfocar.current}`);
    if (entrada) {
      entrada.focus();
      entrada.select();
      enfocar.current = null;
    }
  });

  const ids = datos.lineas.map((l) => l.existencia_id).filter((x) => x !== null && x !== undefined);
  const hay = useMemo(() => disponibles(estado, [...new Set(ids)], excluirValeId), [estado, ids.join(","), excluirValeId]);
  const pedidos = new Map();
  for (const l of datos.lineas) {
    if (l.existencia_id === null || l.existencia_id === undefined) continue;
    pedidos.set(l.existencia_id, (pedidos.get(l.existencia_id) ?? dec(0)).plus(dec(l.cantidad) ?? 0));
  }

  const agregar = (item) => {
    const base = item.tipo === "existencia" ? lineaDesdeExistencia(estado, item.id, indices) : lineaNoInventariada(estado, item.codigo);
    const area = estado.plantillas_area.find((p) => p.id === datos.plantilla_area_id);
    const linea = { ...base, lote: area?.lote_defecto ?? "" };
    enfocar.current = linea.uid;
    cambiar({ lineas: [...datos.lineas, linea] });
  };
  const manual = (consulta) => {
    const codigo = Number((window.prompt("Código AX:", /^\d+$/.test(consulta.trim()) ? consulta.trim() : "") || "").trim());
    if (!Number.isInteger(codigo) || codigo <= 0) return;
    const conocido = estado.articulos[codigo]?.descripcion;
    const descripcion = conocido ?? (window.prompt("Descripción del artículo (quedará por confirmar en el catálogo):") || "").trim().toUpperCase();
    if (!descripcion) return;
    const linea = lineaNoInventariada(estado, codigo, descripcion);
    enfocar.current = linea.uid;
    cambiar({ lineas: [...datos.lineas, linea] });
  };
  const elegirOrigen = (linea, valor) => {
    if (valor === "no") {
      cambiarLinea(linea.uid, { existencia_id: null, variante_id: null, no_inventariado: true });
      return;
    }
    const nueva = lineaDesdeExistencia(estado, Number(valor), indices);
    cambiarLinea(linea.uid, { existencia_id: nueva.existencia_id, variante_id: nueva.variante_id, no_inventariado: false, clave: nueva.clave, um: linea.um || nueva.um });
  };
  const alternativas = (codigo) => items.filter((i) => i.tipo === "existencia" && i.codigo === codigo);
  const autoriza = requiereAutoriza(estado, datos);
  const areas = estado.plantillas_area.filter((p) => p.activo !== false);
  const persona = (campoNombre, campoPuesto) => (e) => {
    const nombre = e.currentTarget.value;
    const conocido = estado.personas.find((p) => p.nombre === nombre.trim().toUpperCase());
    cambiar({ [campoNombre]: nombre, ...(conocido?.puesto && campoPuesto && !datos[campoPuesto] ? { [campoPuesto]: conocido.puesto } : {}) });
  };

  return html`
    <datalist id="lista-personas">${opciones.personas.map((p) => html`<option value=${p} />`)}</datalist>
    <datalist id="lista-deptos">${opciones.deptos.map((p) => html`<option value=${p} />`)}</datalist>
    <datalist id="lista-lugares">${opciones.lugares.map((p) => html`<option value=${p} />`)}</datalist>
    <datalist id="lista-puestos">${opciones.puestos.map((p) => html`<option value=${p} />`)}</datalist>

    <div class="editor-encabezado">
      <${Campo} etiqueta="Área (plantilla)" ancho="2">
        <select
          value=${datos.plantilla_area_id ?? ""}
          onChange=${(e) => {
            const copia = structuredClone(datos);
            aplicarPlantilla(estado, copia, e.currentTarget.value ? Number(e.currentTarget.value) : null);
            alCambiar(copia);
          }}
        >
          <option value="">— Sin área —</option>
          ${areas.map((a) => html`<option value=${a.id}>${a.nombre}${a.naturaleza === "TRANSFERENCIA" ? " (transferencia)" : ""}</option>`)}
        </select>
      <//>
      <${Campo} etiqueta="Fecha" error=${errorEn("fecha")}>
        <input type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
      <//>
      <${Campo} etiqueta="Origen"><input list="lista-lugares" value=${datos.origen} onInput=${(e) => cambiar({ origen: e.currentTarget.value })} /><//>
      <${Campo} etiqueta="Depto. origen"><input list="lista-deptos" value=${datos.depto_origen} onInput=${(e) => cambiar({ depto_origen: e.currentTarget.value })} /><//>
      <${Campo} etiqueta="Destino"><input list="lista-lugares" value=${datos.destino} onInput=${(e) => cambiar({ destino: e.currentTarget.value })} /><//>
      <${Campo} etiqueta="Depto. destino" error=${errorEn("depto_destino")}>
        <input list="lista-deptos" value=${datos.depto_destino} onInput=${(e) => cambiar({ depto_destino: e.currentTarget.value })} />
      <//>
      <${Campo} etiqueta="Entregó" error=${errorEn("entrego_nombre")}>
        <input list="lista-personas" value=${datos.entrego_nombre} onInput=${persona("entrego_nombre", "entrego_puesto")} />
      <//>
      <${Campo} etiqueta="Puesto (entregó)"><input list="lista-puestos" value=${datos.entrego_puesto} onInput=${(e) => cambiar({ entrego_puesto: e.currentTarget.value })} /><//>
      <${Campo} etiqueta="Recibió" error=${errorEn("recibio_nombre")}>
        <input list="lista-personas" value=${datos.recibio_nombre} onInput=${persona("recibio_nombre", "recibio_puesto")} />
      <//>
      <${Campo} etiqueta="Puesto (recibió)"><input list="lista-puestos" value=${datos.recibio_puesto} onInput=${(e) => cambiar({ recibio_puesto: e.currentTarget.value })} /><//>
      <${Campo} etiqueta=${autoriza ? "Autorizó (obligatorio)" : "Autorizó"} error=${errorEn("autorizo_nombre")}>
        <input list="lista-personas" value=${datos.autorizo_nombre} onInput=${(e) => cambiar({ autorizo_nombre: e.currentTarget.value })} />
      <//>
      <${Campo} etiqueta="Observaciones" ancho="todo">
        <textarea rows="2" value=${datos.observaciones} onInput=${(e) => cambiar({ observaciones: e.currentTarget.value })}></textarea>
      <//>
    </div>

    <${BuscadorArticulos} items=${items} alElegir=${agregar} alManual=${manual} />

    ${datos.lineas.length
      ? html`<div class="tabla-contenedor editor-lineas">
          <table class="tabla">
            <thead>
              <tr>
                <th>#</th><th>Artículo</th><th>Sale de</th><th>Clave</th><th class="numero">Cantidad</th><th>UM</th><th>O.C.</th><th>Lote</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${datos.lineas.map((l, i) => {
                const n = i + 1;
                const opcionesOrigen = alternativas(l.codigo);
                const existencia = l.existencia_id !== null && l.existencia_id !== undefined;
                const disponible = existencia ? hay.get(l.existencia_id) : null;
                const excede = existencia && disponible && pedidos.get(l.existencia_id)?.gt(disponible);
                return html`<tr key=${l.uid} class=${errores.some((e) => e.renglon === n) ? "fila-error" : ""}>
                    <td class="numero">${n}</td>
                    <td class="articulo">
                      <strong>${l.codigo}</strong>
                      ${l.no_inventariado && !opcionesOrigen.length
                        ? html`<input class="entrada-descripcion" value=${l.descripcion} onInput=${(e) => cambiarLinea(l.uid, { descripcion: e.currentTarget.value })} />`
                        : html` · ${l.descripcion}`}
                    </td>
                    <td>
                      <select value=${existencia ? String(l.existencia_id) : "no"} onChange=${(e) => elegirOrigen(l, e.currentTarget.value)} class=${errorEn("existencia_id", n) ? "con-error" : ""}>
                        ${!existencia && !l.no_inventariado ? html`<option value="" disabled selected>— Elige —</option>` : null}
                        ${opcionesOrigen.map(
                          (o) => html`<option value=${String(o.id)}>${o.lugar} · ${[o.dimension, o.np && `NP ${o.np}`].filter(Boolean).join(" · ") || "S/D"} · hay ${num(o.total)}</option>`,
                        )}
                        <option value="no">No inventariado (no descuenta)</option>
                      </select>
                    </td>
                    <td><input class="entrada-clave" value=${l.clave} onInput=${(e) => cambiarLinea(l.uid, { clave: e.currentTarget.value })} /></td>
                    <td>
                      <input
                        id=${`cant-${l.uid}`}
                        class=${`entrada-cantidad ${errorEn("cantidad", n) ? "con-error" : ""}`}
                        inputmode="decimal"
                        value=${l.cantidad}
                        onInput=${(e) => cambiarLinea(l.uid, { cantidad: e.currentTarget.value.replace(",", ".") })}
                        onKeyDown=${(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            document.getElementById("buscar-articulo")?.focus();
                          }
                        }}
                      />
                    </td>
                    <td><input class=${`entrada-um ${errorEn("um", n) ? "con-error" : ""}`} value=${l.um} onInput=${(e) => cambiarLinea(l.uid, { um: e.currentTarget.value })} /></td>
                    <td><input class="entrada-oc" placeholder="S/OC" value=${l.oc} onInput=${(e) => cambiarLinea(l.uid, { oc: e.currentTarget.value })} /></td>
                    <td><input class="entrada-lote" value=${l.lote} onInput=${(e) => cambiarLinea(l.uid, { lote: e.currentTarget.value })} /></td>
                    <td><button type="button" class="quitar" title="Quitar renglón" onClick=${() => cambiar({ lineas: datos.lineas.filter((x) => x.uid !== l.uid) })}>×</button></td>
                  </tr>
                  ${excede
                    ? html`<tr class="fila-aviso" key=${`${l.uid}-aviso`}>
                        <td></td>
                        <td colspan="8">
                          <span class="alerta">Existencia en ${opcionesOrigen.find((o) => o.id === l.existencia_id)?.lugar ?? "ese contenedor"}: ${num(aNumero(disponible))}.</span>
                          Justificación para continuar:
                          <input class=${`entrada-justificacion ${errorEn("justificacion", n) ? "con-error" : ""}`} value=${l.justificacion} onInput=${(e) => cambiarLinea(l.uid, { justificacion: e.currentTarget.value })} placeholder="Ej. material recibido sin vale de entrada" />
                        </td>
                      </tr>`
                    : null}`;
              })}
            </tbody>
          </table>
        </div>`
      : html`<p class="vacio">Aún no hay renglones. Busca un artículo arriba y pulsa Enter.</p>`}
  `;
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

function etiquetaBorrador(estado, b) {
  const area = estado.plantillas_area.find((p) => p.id === b.plantilla_area_id);
  return `${area?.nombre ?? (b.depto_destino || "Sin área")} · ${b.lineas.length} reng.`;
}

function EmitidoOk({ vales, alNuevo }) {
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
    </div>
  <//>`;
}

export function PaginaNuevoVale() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(estado.borradores[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [errores, setErrores] = useState([]);
  const [emitidos, setEmitidos] = useState(null);
  const [previa, setPrevia] = useState(null);
  const pendiente = useRef(null);

  // Carga el borrador activo en el editor (solo al cambiar de pestaña).
  useEffect(() => {
    const b = buscarBorrador(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setErrores([]);
  }, [activo]);

  const guardar = async (valor) => {
    clearTimeout(pendiente.current);
    pendiente.current = null;
    await sesion.almacen.modificar((e) => {
      const b = buscarBorrador(e, valor.id);
      if (b) Object.assign(b, structuredClone(valor), { actualizado_en: ahoraIso() });
    });
  };
  const cambiar = (valor) => {
    setDatos(valor);
    if (errores.length) setErrores(validarVale(estado, valor).errores);
    clearTimeout(pendiente.current);
    pendiente.current = setTimeout(() => guardar(valor).catch((e) => sesion.avisar("error", e.message)), 600);
  };
  useEffect(() => () => clearTimeout(pendiente.current), []);

  const nuevo = () =>
    sesion.tarea("Creando borrador…", async () => {
      if (datos && pendiente.current) await guardar(datos);
      const creado = await sesion.almacen.modificar((e) => nuevoBorrador(e, { usuario: sesion.usuario }).id);
      setEmitidos(null);
      setActivo(creado);
    });
  const cambiarPestana = async (id) => {
    if (datos && pendiente.current) await guardar(datos);
    setEmitidos(null);
    setActivo(id);
  };
  const descartar = () => {
    if (datos.lineas.length && !confirmar("¿Descartar este borrador? No consume folio.")) return;
    return sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      await sesion.almacen.modificar((e) => descartarBorrador(e, datos.id));
      setActivo(sesion.estado.borradores[0]?.id ?? null);
    });
  };
  const emitir = () =>
    sesion.tarea("Emitiendo…", async () => {
      const { errores: faltan } = validarVale(sesion.estado, datos);
      setErrores(faltan);
      if (faltan.length) return;
      if (!sesion.usuario && !confirmar("No has elegido quién está en turno (arriba a la derecha). ¿Emitir de todos modos?")) return;
      const capacidad = await sesion.capacidadPara(datos);
      let dividir = false;
      if (datos.lineas.length > capacidad) {
        const hojas = Math.ceil(datos.lineas.length / capacidad);
        if (!confirmar(`El formato impreso de esta área admite ${capacidad} renglones y el vale tiene ${datos.lineas.length}. ¿Dividirlo en ${hojas} vales con folios consecutivos?`)) return;
        dividir = true;
      }
      const folio = siguienteFolio(sesion.estado);
      if (!confirmar(`¿Emitir el vale con el folio ${folio}${dividir ? ` y siguientes` : ""}? Después solo se puede corregir o cancelar con motivo.`)) return;
      clearTimeout(pendiente.current);
      pendiente.current = null;
      try {
        const vales = await sesion.almacen.modificar((e) => {
          const b = buscarBorrador(e, datos.id);
          Object.assign(b, structuredClone(datos));
          return emitirBorrador(e, datos.id, { usuario: sesion.usuario, capacidad, dividir });
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
  return html`
    <div class="pestanas" role="tablist">
      ${borradores.map(
        (b) => html`<button
          type="button"
          role="tab"
          aria-selected=${b.id === activo && !emitidos}
          class=${`pestana ${b.id === activo && !emitidos ? "activa" : ""}`}
          onClick=${() => cambiarPestana(b.id)}
        >
          ${etiquetaBorrador(estado, b.id === datos?.id ? datos : b)}
        </button>`,
      )}
      <button type="button" class="pestana nueva" onClick=${nuevo}>＋ Nuevo vale</button>
    </div>

    ${emitidos ? html`<${EmitidoOk} vales=${emitidos} alNuevo=${nuevo} />` : null}

    ${!emitidos && datos
      ? html`<${Tarjeta}
          titulo=${`Borrador · se emitirá con el folio ${siguienteFolio(estado)}`}
          acciones=${html`<span class="nota">Se guarda solo · creado ${fmtFecha(datos.creado_en)}</span>`}
        >
          <${EditorVale} datos=${datos} alCambiar=${cambiar} errores=${errores} />
          <${ListaErrores} errores=${errores} />
          <div class="acciones-linea pie-editor">
            <${Boton} tipo="peligro-texto" onClick=${descartar}>Descartar borrador<//>
            <span class="espaciador"></span>
            <${Boton} disabled=${!datos.lineas.length} onClick=${() => setPrevia([{ ...datos, folio: null, tipo: "SALIDA" }])}>Vista previa<//>
            <${Boton} tipo="primario" tamano="grande" disabled=${!datos.lineas.length} onClick=${emitir}>Emitir vale · folio ${siguienteFolio(estado)}<//>
          </div>
        <//>`
      : null}

    ${!emitidos && !datos
      ? html`<${Tarjeta}>
          <p>No hay vales en captura. Cada vale nuevo se guarda solo como borrador y no consume folio hasta que lo emites.</p>
          <${Boton} tipo="primario" tamano="grande" onClick=${nuevo}>＋ Nuevo vale<//>
        <//>`
      : null}

    ${previa ? html`<${VistaPrevia} vales=${previa} alCerrar=${() => setPrevia(null)} />` : null}
  `;
}
