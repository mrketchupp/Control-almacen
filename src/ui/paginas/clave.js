// Corregir la dimensión y el NP de un renglón del inventario o de toda su variante (Ronda 9):
// lo usan la conciliación con AX (Por confirmar) y la página de Inventario.

import { useMemo, useState } from "preact/hooks";
import { Indices, auditar } from "../../nucleo/estado.js";
import { ErrorConciliacion, cuadraConAx } from "../../servicios/conciliacion.js";
import { ErrorCorreccion, lugarCorto, previaCorreccion, sugerenciasClave } from "../../servicios/inventario.js";
import { Boton, Combo, Pastilla, useSesion } from "../componentes.js";
import { html } from "../html.js";

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());
const sinAcentos = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
export const escrituraClave = (dimension, np) => [texto(dimension) || "SIN DIMENSIÓN", texto(np) ? `NP ${texto(np)}` : ""].filter(Boolean).join(" · ");

/** Campo con sugerencias que dicen de dónde vienen (AX o el inventario). */
function CampoClave({ id, etiqueta, valor, alCambiar, sugerencias, placeholder = "" }) {
  // Siempre se ven todas (son pocas): primero las que contienen lo escrito.
  const opciones = useMemo(() => {
    const palabras = sinAcentos(valor).split(/\s+/).filter(Boolean);
    const exacto = sinAcentos(valor).trim();
    const otras = sugerencias.filter((s) => sinAcentos(s.valor).trim() !== exacto);
    const coincide = (s) => palabras.length > 0 && palabras.every((w) => sinAcentos(s.valor).includes(w));
    return [...otras.filter(coincide), ...otras.filter((s) => !coincide(s))];
  }, [valor, sugerencias]);
  return html`<label class="campo" for=${id}>
    <span>${etiqueta}</span>
    <${Combo}
      id=${id}
      valor=${valor}
      alEscribir=${alCambiar}
      alElegir=${(o) => alCambiar(o.valor)}
      opciones=${opciones}
      clave=${(o) => o.valor}
      render=${(o) => html`<span class="opcion-principal">${o.valor}</span><span class="res-detalle">${o.detalle}</span>`}
      placeholder=${placeholder}
      ariaLabel=${etiqueta}
      autoMarcar=${false}
    />
  </label>`;
}

/**
 * Editor de dimensión y NP con lo que pasará antes de aplicar.
 *   cual: { existenciaId } (un renglón) o { varianteId } (todos sus renglones)
 *   linea: renglón de AX con el que debe cuadrar (conciliación); avisa si no cuadrará
 *   alAplicar({ dimension, np, motivo, cual })
 */
export function EditorClave({ cual, codigo, actual, inicial = actual, linea = null, conMotivo = false, textoAplicar = "Corregir", alAplicar, alCancelar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const [dimension, setDimension] = useState(texto(inicial.dimension));
  const [np, setNp] = useState(texto(inicial.np));
  const [motivo, setMotivo] = useState("");
  const [todos, setTodos] = useState(false);
  const sugerencias = useMemo(() => sugerenciasClave(estado, codigo), [estado, codigo]);
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
  const cuadra = linea ? cuadraConAx(linea, { dimension, np, um: actual.um }) : null;
  const cortado = linea && texto(linea.tamano).length === 10;
  const uid = `${cual.existenciaId ?? ""}-${cual.varianteId ?? ""}-${linea?.id ?? ""}`;
  return html`<div class="editor-clave">
    <p class="clave-antes-despues">
      <span><span class="nota">Ahora</span> <code>${escrituraClave(actual.dimension, actual.np)}</code></span>
      <span aria-hidden="true">→</span>
      <span><span class="nota">Quedará</span> <code class="clave-nueva">${escrituraClave(dimension, np)}</code></span>
    </p>
    <div class="campos-clave">
      <${CampoClave} id=${`dim-${uid}`} etiqueta="Dimensión" valor=${dimension} alCambiar=${setDimension} sugerencias=${sugerencias.dimensiones} placeholder="SIN DIMENSIÓN" />
      <${CampoClave} id=${`np-${uid}`} etiqueta="NP" valor=${np} alCambiar=${setNp} sugerencias=${sugerencias.nps} placeholder="Sin NP" />
      ${conMotivo
        ? html`<label class="campo"><span>Motivo (opcional)</span><input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. así viene en AX" /></label>`
        : null}
    </div>
    ${otrosPartidas.length
      ? html`<label class="casilla">
          <input type="checkbox" checked=${todos} onChange=${(e) => setTodos(e.currentTarget.checked)} />
          <span>También ${otrosPartidas.length === 1 ? "el otra partida" : `los otros ${otrosPartidas.length} partidas`} de esta variante (${otrosPartidas.map((e) => lugarCorto(indices.ubicacion(e.ubicacion_id))).join(", ")})</span>
        </label>`
      : null}
    <ul class="avisos-clave">
      ${previa?.otra
        ? html`<li class="info">Ya hay una variante igual (${lugaresDe(previa.otra).join(", ") || "sin partidas"}): se juntan en una.</li>`
        : null}
      ${linea && !cuadra ? html`<li class="alerta">Con estos valores la partida de AX seguirá sin pareja.</li>` : null}
      ${cortado ? html`<li class="nota">AX guarda solo los primeros 10 caracteres del Tamaño. Si la dimensión real es más larga, escríbela completa: igual empareja.</li>` : null}
      ${previa && !previa.cambia ? html`<li class="nota">Ya está así.</li>` : null}
      <li class="nota">Las cantidades no cambian y los vales anteriores siguen ligados a su partida.</li>
    </ul>
    <div class="acciones-linea">
      <${Boton} tipo="primario" tamano="chico" disabled=${!previa?.cambia} onClick=${() => alAplicar({ dimension, np, motivo, cual: alcance })}>${textoAplicar}<//>
      ${alCancelar ? html`<${Boton} tipo="texto" tamano="chico" onClick=${alCancelar}>Cancelar<//>` : null}
    </div>
  </div>`;
}

/** "AX: 6309-2Z/C3 · FLEXITALIC" en pastilla. */
export function PastillaAx({ linea }) {
  return html`<${Pastilla} tono="info" titulo="Como está en AX (Tamaño · Color)">AX: ${[texto(linea.tamano) || "—", texto(linea.color)].filter(Boolean).join(" · ")}<//>`;
}

/**
 * Aplica una corrección de dimensión/NP (accion(estado) → resultado) y ofrece "Deshacer" en el
 * aviso: regresa las variantes, los renglones tocados y las decisiones de la conciliación.
 */
export function useCorreccion() {
  const sesion = useSesion();
  return (accion, mensaje) =>
    sesion.tarea("Corrigiendo…", async () => {
      const e0 = sesion.estado;
      const copia = structuredClone({
        variantes: e0.variantes,
        existencias: e0.existencias.map((e) => ({ id: e.id, variante_id: e.variante_id, dimension_hoja: e.dimension_hoja, np_hoja: e.np_hoja })),
        equivalencias_ax: e0.equivalencias_ax ?? {},
        cortes: (e0.cortes_ax ?? []).map((c) => ({ id: c.id, sin_pareja: c.sin_pareja ?? [] })),
      });
      let resultado;
      try {
        resultado = await sesion.almacen.modificar((e) => accion(e));
      } catch (error) {
        if (error instanceof ErrorCorreccion || error instanceof ErrorConciliacion) {
          sesion.avisar("error", error.message);
          return undefined;
        }
        throw error;
      }
      sesion.avisar("exito", mensaje(resultado), 12000, {
        etiqueta: "↶ Deshacer",
        alHacer: () =>
          sesion.almacen.modificar((e) => {
            const variantes = new Map(copia.variantes.map((v) => [v.id, v]));
            const renglones = new Map(copia.existencias.map((x) => [x.id, x]));
            for (const ex of e.existencias) {
              const antes = renglones.get(ex.id);
              if (!antes) continue;
              ex.variante_id = antes.variante_id;
              for (const campo of ["dimension_hoja", "np_hoja"]) {
                if (antes[campo] === undefined) delete ex[campo];
                else ex[campo] = antes[campo];
              }
            }
            const enUso = new Set(e.existencias.map((ex) => ex.variante_id));
            e.variantes = e.variantes.filter((v) => variantes.has(v.id) || enUso.has(v.id)).map((v) => variantes.get(v.id) ?? v);
            e.equivalencias_ax = copia.equivalencias_ax;
            for (const c of e.cortes_ax ?? []) {
              const x = copia.cortes.find((y) => y.id === c.id);
              if (x) c.sin_pareja = x.sin_pareja;
            }
            auditar(e, { usuario: sesion.usuario, entidad: "variante", accion: "DESHACER_CORRECCION" });
          }),
      });
      return resultado;
    });
}
