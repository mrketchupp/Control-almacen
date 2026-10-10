// Corregir la dimensión y el NP de un renglón del inventario o de toda su variante (Ronda 9):
// lo usan la conciliación con AX (Por confirmar) y la página de Inventario.

import { useMemo, useState } from "preact/hooks";
import { Indices } from "../../nucleo/estado.js";
import { ErrorConciliacion, cuadraConAx, dimensionAx, etiquetaEstado, lineasInv, unidadesCompatibles, valoresAx } from "../../servicios/conciliacion.js";
import { preverCorreccionAx } from "../../servicios/correccionAx.js";
import { datosCorreccion, deshacerCorreccion } from "../../servicios/deshacerCorreccion.js";
import { ErrorCorreccion, lugarCorto, previaCorreccion, sugerenciasClave } from "../../servicios/inventario.js";
import { Boton, Combo, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const sinAcentos = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
export const escrituraClave = (dimension, np) => [texto(dimension) || "SIN DIMENSIÓN", texto(np) ? `NP ${texto(np)}` : ""].filter(Boolean).join(" · ");

/** Campo con sugerencias que dicen de dónde vienen (AX o el inventario). */
function CampoClave({ id, etiqueta, valor, alCambiar, alElegir = null, sugerencias, placeholder = "" }) {
  // Siempre se ven todas (son pocas): primero las que contienen lo escrito.
  const opciones = useMemo(() => {
    const palabras = sinAcentos(valor).split(/\s+/).filter(Boolean);
    const exacto = sinAcentos(valor).trim();
    const otras = sugerencias.filter((s) => s.lineaId != null || sinAcentos(s.valor).trim() !== exacto);
    const coincide = (s) => palabras.length > 0 && palabras.every((w) => sinAcentos(s.valor).includes(w));
    return [...otras.filter(coincide), ...otras.filter((s) => !coincide(s))];
  }, [valor, sugerencias]);
  return html`<label class="campo" for=${id}>
    <span>${etiqueta}</span>
    <${Combo}
      id=${id}
      valor=${valor}
      alEscribir=${alCambiar}
      alElegir=${(o) => alElegir ? alElegir(o) : alCambiar(o.valor)}
      opciones=${opciones}
      clave=${(o) => `${o.valor}-${o.lineaId ?? ""}`}
      render=${(o) => html`<span class="opcion-principal">${o.valor}</span><span class="res-detalle">${o.detalle}</span>`}
      placeholder=${placeholder}
      ariaLabel=${etiqueta}
      autoMarcar=${false}
    />
  </label>`;
}

export function ResultadoCorreccionAx({ comparacion }) {
  const r = comparacion;
  const n = (v) => num(Number(v));
  return html`<div aria-live="polite">
    ${r ? html`<p>Después: AX <strong>${n(r.ax)}</strong> · Físico <strong>${n(r.fisico)}</strong> · Resultado: <strong>${r.estado === "faltante" ? `Faltan ${n(r.sin_explicar.abs())}` : r.estado === "sobrante" ? `Sobran ${n(r.sin_explicar)}` : etiquetaEstado(r.estado)}</strong></p>
      ${r.folios.length ? html`<p class="nota">Vales en tránsito: ${r.folios.join(", ")}</p>` : null}`
      : html`<p class="nota">La partida de AX seguirá por confirmar con estos valores.</p>`}
  </div>`;
}

/**
 * Editor de dimensión y NP con lo que pasará antes de aplicar.
 *   cual: { existenciaId } (un renglón) o { varianteId } (todos sus renglones)
 *   linea: renglón de AX con el que debe cuadrar (conciliación); avisa si no cuadrará
 *   alAplicar({ dimension, np, motivo, cual })
 */
export function EditorClave({ cual, codigo, actual, inicial = actual, linea = null, corte = null, confirmar = false, conMotivo = false, textoAplicar = "Corregir", alAplicar, alCancelar, alVincular = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const [dimension, setDimension] = useState(texto(inicial.dimension));
  const [np, setNp] = useState(texto(inicial.np));
  const [motivo, setMotivo] = useState("");
  const [todos, setTodos] = useState(false);
  const [lineaId, setLineaId] = useState(linea?.id ?? null);
  const [revisando, setRevisando] = useState(false);
  const destino = linea ?? corte?.lineas.find((l) => l.id === lineaId) ?? null;
  const sugerencias = useMemo(() => {
    const s = sugerenciasClave(estado, codigo);
    if (!corte) return s;
    const actuales = lineasInv(corte).filter((l) => l.codigo === codigo).map((l) => ({ valor: dimensionAx(l) || "", lineaId: l.id,
      detalle: `AX del corte ${corte.fecha} · ${num(Number(l.disponible))} ${l.um || ""} · ${l.nombre || ""}` }));
    const valores = new Set(actuales.map((o) => sinAcentos(o.valor)));
    return { ...s, dimensiones: [...actuales, ...s.dimensiones.filter((o) => !valores.has(sinAcentos(o.valor)))] };
  }, [estado, codigo, corte]);
  const cambiarDimension = (v) => { setDimension(v); setRevisando(false); };
  const cambiarNp = (v) => { setNp(v); setRevisando(false); };
  const elegirDimension = (o) => {
    cambiarDimension(o.valor);
    if (!linea && o.lineaId != null) {
      setLineaId(o.lineaId);
      const l = corte.lineas.find((l) => l.id === o.lineaId);
      cambiarNp(valoresAx(l, { np }).np);
    } else if (!linea) setLineaId(null);
  };
  const existencia = cual.existenciaId !== undefined && cual.existenciaId !== null ? indices.existencia(cual.existenciaId) : null;
  const otrosPartidas = existencia ? estado.existencias.filter((e) => e.variante_id === existencia.variante_id && e.id !== existencia.id) : [];
  const alcance = existencia && todos ? { varianteId: existencia.variante_id } : cual;
  let previa = null;
  try {
    previa = previaCorreccion(estado, alcance, { dimension, np }, { indices });
  } catch {
    previa = null;
  }
  const lugaresDe = (variante) =>
    estado.existencias.filter((e) => e.variante_id === variante.id && e.activo !== false).map((e) => lugarCorto(indices.ubicacion(e.ubicacion_id)));
  const cuadra = destino ? cuadraConAx(destino, { dimension, np, um: actual.um }) : null;
  const cortado = destino && texto(destino.tamano).length === 10;
  const resumen = useMemo(() => {
    if (!corte) return null;
    try { return preverCorreccionAx(estado, { corteId: corte.id, lineaId: destino?.id ?? null, cual: alcance, dimension, np }, confirmar); }
    catch (e) { return { error: e.message }; }
  }, [estado, corte, destino, cual, todos, dimension, np, confirmar]);
  const uid = `${cual.existenciaId ?? ""}-${cual.varianteId ?? ""}-${linea?.id ?? ""}`;
  return html`<div class="editor-clave">
    <p class="clave-antes-despues">
      <span><span class="nota">Ahora</span> <code>${escrituraClave(actual.dimension, actual.np)}</code></span>
      <span aria-hidden="true">→</span>
      <span><span class="nota">Quedará</span> <code class="clave-nueva">${escrituraClave(dimension, np)}</code></span>
    </p>
    <div class="campos-clave">
      <${CampoClave} id=${`dim-${uid}`} etiqueta="Dimensión" valor=${dimension} alCambiar=${cambiarDimension} alElegir=${elegirDimension} sugerencias=${sugerencias.dimensiones} placeholder="SIN DIMENSIÓN" />
      <${CampoClave} id=${`np-${uid}`} etiqueta="NP" valor=${np} alCambiar=${cambiarNp} sugerencias=${sugerencias.nps} placeholder="Sin NP" />
      ${conMotivo
        ? html`<label class="campo"><span>Motivo (opcional)</span><input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. así viene en AX" /></label>`
        : null}
    </div>
    ${otrosPartidas.length
      ? html`<label class="casilla">
          <input type="checkbox" checked=${todos} onChange=${(e) => { setTodos(e.currentTarget.checked); setRevisando(false); }} />
          <span>También ${otrosPartidas.length === 1 ? "el otra partida" : `los otros ${otrosPartidas.length} partidas`} de esta variante (${otrosPartidas.map((e) => lugarCorto(indices.ubicacion(e.ubicacion_id))).join(", ")})</span>
        </label>`
      : null}
    <ul class="avisos-clave">
      ${previa?.otra
        ? html`<li class="info">Ya hay una variante igual (${lugaresDe(previa.otra).join(", ") || "sin partidas"}): se juntan en una.</li>`
        : null}
      ${destino && !cuadra ? html`<li class="alerta">Con estos valores la partida de AX seguirá sin pareja.</li>` : null}
      ${cortado ? html`<li class="nota">AX guarda solo los primeros 10 caracteres del Tamaño. Si la dimensión real es más larga, escríbela completa: igual empareja.</li>` : null}
      ${previa && !previa.cambia ? html`<li class="nota">Ya está así.</li>` : null}
      <li class="nota">Las cantidades no cambian y los vales anteriores siguen ligados a su partida.</li>
    </ul>
    ${corte ? html`<div class="revision-correccion-ax">
      ${destino ? html`<p><strong>Destino en AX:</strong> ${destino.codigo} ${destino.nombre} · <code>${dimensionAx(destino) || "SIN DIMENSIÓN"}</code> · ${num(Number(destino.disponible))} ${destino.um} · Corte ${corte.fecha}</p>`
        : html`<p class="nota">Elige una opción «AX del corte ${corte.fecha}» en Dimensión para ver su resultado. Las opciones «En el inventario» y de otros cortes sólo completan el texto.</p>`}
      ${resumen?.error ? html`<p class="alerta" role="alert">${resumen.error}</p>
        ${destino && alVincular && !unidadesCompatibles(actual.um, destino.um) ? html`<p class="nota">Abre «Elegir varias partidas para este AX…» para corregir la unidad e indicar su equivalencia.</p>` : null}` : html`<p><strong>Etiquetas:</strong> ${resumen?.etiquetas ?? 0} nuevas en Etiquetas → Material (una por partida física que cambia).</p>
        ${destino ? html`<${ResultadoCorreccionAx} comparacion=${resumen?.comparacion} />` : null}`}
      <p class="nota">Se corregirán las claves del inventario. AX no trae NP: conserva el actual o ajusta el campo si hace falta.</p>
    </div>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" tamano="chico" disabled=${!previa?.cambia || Boolean(resumen?.error)} onClick=${() => corte && !revisando ? setRevisando(true) : alAplicar({ dimension, np, motivo, cual: alcance, lineaId: destino?.id ?? null })}>${corte ? revisando ? "Confirmar corrección y etiquetas" : "Revisar corrección" : textoAplicar}<//>
      ${corte && revisando ? html`<${Boton} tipo="texto" tamano="chico" onClick=${() => setRevisando(false)}>Seguir editando<//>` : null}
      ${destino && alVincular ? html`<${Boton} tipo="texto" tamano="chico" onClick=${() => alVincular(destino)}>Elegir varias partidas para este AX…<//>` : null}
      ${alCancelar ? html`<${Boton} tipo="texto" tamano="chico" onClick=${alCancelar}>Cancelar<//>` : null}
    </div>
  </div>`;
}

/**
 * Aplica una corrección de dimensión/NP (accion(estado) → resultado) y ofrece "Deshacer" en el
 * aviso: regresa las variantes, los renglones tocados y las decisiones de la conciliación.
 */
export function useCorreccion() {
  const sesion = useSesion();
  return (accion, mensaje) =>
    sesion.tarea("Corrigiendo…", async () => {
      let copia, despues;
      let resultado;
      let etiquetas = [];
      try {
        resultado = await sesion.almacen.modificar((e) => {
          copia = datosCorreccion(e);
          const res = accion(e);
          despues = datosCorreccion(e);
          const idsPrevios = new Set(copia.etiquetas.map((x) => x.id));
          etiquetas = despues.etiquetas.filter((x) => !idsPrevios.has(x.id)).map((x) => x.id);
          return res;
        });
      } catch (error) {
        if (error instanceof ErrorCorreccion || error instanceof ErrorConciliacion) {
          sesion.avisar("error", error.message);
          return undefined;
        }
        throw error;
      }
      const avisoEtiquetas = etiquetas.length ? ` ${etiquetas.length === 1 ? "1 etiqueta agregada" : `${etiquetas.length} etiquetas agregadas`} a Etiquetas → Material.` : "";
      sesion.avisar("exito", mensaje(resultado) + avisoEtiquetas, 12000, {
        etiqueta: "↶ Deshacer",
        alHacer: () =>
          sesion.tarea("Deshaciendo corrección…", async () => {
            try { await sesion.almacen.modificar((e) => deshacerCorreccion(e, copia, despues, sesion.usuario)); }
            catch (error) { if (error instanceof ErrorCorreccion) sesion.avisar("error", error.message); else throw error; }
          }),
      });
      return resultado;
    });
}
