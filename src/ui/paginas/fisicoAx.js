import { useMemo, useState } from "preact/hooks";
import { aNumero, dec, sumar } from "../../nucleo/decimal.js";
import { ErrorConciliacion, dimensionAx, etiquetaEstado, textoVariante } from "../../servicios/conciliacion.js";
import { corregirYVincularFisico, preverVinculoCorregido } from "../../servicios/correccionAx.js";
import { candidatosFisicos, deshacerVinculoFisico, previaVinculoFisico, quitarVinculosFisicos, vincularFisico } from "../../servicios/vinculosAx.js";
import { lugarCorto } from "../../servicios/inventario.js";
import { Boton, Buscador, Pastilla, Tabla, Ventana, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { escrituraClave, ResultadoCorreccionAx, useCorreccion } from "./clave.js";

const n = (d) => num(aNumero(d));

/** Selección y revisión del físico que corresponde a una fila de AX. */
export function ElegirFisicoAx({ r, corte, fila, alCerrar }) {
  const sesion = useSesion();
  const aplicarCorreccion = useCorreccion();
  const lineas = fila.lineas ?? [fila.linea];
  const lineaIds = lineas.map((l) => l.id);
  const unidadesAx = [...new Set(lineas.map((l) => String(l.um ?? "").trim() || "Sin unidad"))].join(" / ");
  const opciones = candidatosFisicos(r, lineaIds);
  const [seleccion, setSeleccion] = useState(() => new Set((fila.variante_ids ?? []).filter((id) =>
    opciones.some((f) => f.variante.id === id && !f.ocupada && f.compatible))));
  const [texto, setTexto] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState("");
  const [corregir, setCorregir] = useState(false);
  const [corregirUnidades, setCorregirUnidades] = useState(false);
  const [equivalencias, setEquivalencias] = useState({});
  const elegidas = opciones.filter((f) => seleccion.has(f.variante.id));
  const equivalenciasElegidas = Object.fromEntries(elegidas.map((f) => [f.variante.id,
    equivalencias[f.variante.id] ?? { origen: "1", destino: f.compatible ? "1" : "" }]));
  const datos = { corteId: corte.id, lineaIds, varianteIds: [...seleccion], corregirClaves: corregir, corregirUnidades, equivalencias: equivalenciasElegidas };
  const conCorreccion = corregir || corregirUnidades;
  const total = corregirUnidades ? sumar(...elegidas.map((f) => {
    const eq = equivalenciasElegidas[f.variante.id], origen = dec(eq.origen), destino = dec(eq.destino);
    return origen?.gt(0) && destino?.gt(0) ? f.total.times(destino).div(origen) : null;
  })) : sumar(...elegidas.map((f) => f.total));
  const totalValido = !corregirUnidades || elegidas.every((f) => {
    const eq = equivalenciasElegidas[f.variante.id]; return dec(eq.origen)?.gt(0) && dec(eq.destino)?.gt(0);
  });
  const previa = useMemo(() => previaVinculoFisico(sesion.estado,
    { corteId: corte.id, lineaIds, varianteIds: [...seleccion] }), [sesion.estado, corte, [...seleccion].join(",")]);
  const correccion = useMemo(() => {
    if (!conCorreccion) return null;
    try { return preverVinculoCorregido(sesion.estado, datos); }
    catch (e) { return { error: e.message }; }
  }, [sesion.estado, corte, [...seleccion].join(","), corregir, corregirUnidades, JSON.stringify(equivalencias)]);
  const manual = (corte.vinculos_fisicos ?? []).some((v) => lineaIds.includes(v.linea_ax_id));
  const visibles = useFiltroTexto(opciones.map((f) => ({ ...f, id: f.variante.id,
    _buscar: `${textoVariante(f.variante)} ${f.renglones.map((p) => lugarCorto(p.ubicacion)).join(" ")}`,
  })), texto, ["_buscar"]);
  const marcar = (id, incluido) => {
    setSeleccion((antes) => { const s = new Set(antes); if (incluido) s.add(id); else s.delete(id); return s; });
    setError("");
  };
  const guardar = (automatico = false) => sesion.tarea("Actualizando conciliación…", async () => {
    try {
      const cambio = await sesion.almacen.modificar((e) => automatico
        ? quitarVinculosFisicos(e, { corteId: corte.id, lineaIds }, sesion.usuario)
        : vincularFisico(e, { corteId: corte.id, lineaIds, varianteIds: [...seleccion] }, sesion.usuario));
      alCerrar();
      sesion.avisar("exito", automatico ? "Se restableció el emparejamiento automático." : `${fila.codigo}: inventario vinculado; se recalculó la conciliación.`, 10000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => deshacerVinculoFisico(e, { corteId: corte.id, cambio }, sesion.usuario)),
      });
    } catch (e) {
      if (e instanceof ErrorConciliacion) setError(e.message);
      else throw e;
    }
  });
  const guardarCorreccion = async () => {
    const res = await aplicarCorreccion((e) => corregirYVincularFisico(e,
      datos, sesion.usuario),
    () => `${fila.codigo}: corrección guardada en el inventario para los siguientes cortes de AX.`);
    if (res) alCerrar();
  };
  const columnas = [
    { titulo: "Dimensión / NP", render: (f) => textoVariante(f.variante) },
    { titulo: "UM", render: (f) => f.variante.um || "—" },
    { titulo: "Físico", numero: true, render: (f) => n(f.total) },
    { titulo: "Partidas", render: (f) => f.renglones.map((p) => html`<span class="lugares"><${Pastilla} tono="lugar">${lugarCorto(p.ubicacion)}: ${n(p.total)}<//></span>`) },
  ];
  const partidas = new Map(elegidas.flatMap((f) => f.renglones.map((p) => [p.existencia.id, p])));
  const revisionClaves = [
    { titulo: "Partida", render: (p) => lugarCorto(partidas.get(p.existenciaId).ubicacion) },
    { titulo: "Ahora", render: (p) => html`${escrituraClave(p.ahora.dimension, p.ahora.np)}<div>${n(p.ahora.cantidad)} ${p.ahora.um}</div>` },
    { titulo: "Quedará en inventario", render: (p) => html`${escrituraClave(p.quedara.dimension, p.quedara.np)}<div>${n(p.quedara.cantidad)} ${p.quedara.um}</div>` },
    { titulo: "Equivalencia", render: (p) => p.equivalencia ? `${p.equivalencia.origen} ${p.ahora.um} = ${p.equivalencia.destino} ${p.quedara.um}` : "Sin conversión" },
    { titulo: "Etiqueta", render: (p) => p.cambia ? "1 nueva" : "Sin cambio" },
  ];
  return html`<${Ventana} titulo=${revisando ? "Revisar vínculo del inventario" : "Elegir partidas del inventario"} clase="ventana-concilia" alCerrar=${alCerrar}>
    <p><strong>${fila.codigo} ${fila.descripcion}</strong> · AX: ${[...new Set(lineas.map((l) => dimensionAx(l) || "SIN DIMENSIÓN"))].join(" / ")}</p>
    <p><strong>Unidad en AX:</strong> <code>${unidadesAx}</code></p>
    <p class="nota">Elige todas las partidas físicas de este material que AX reúne. Cada opción suma las partidas de la misma dimensión y NP en sus contenedores. El vínculo se guarda para este corte.</p>
    <label class="casilla"><input type="checkbox" checked=${corregir} disabled=${sesion.ocupado} onChange=${(e) => { setCorregir(e.currentTarget.checked); setRevisando(false); setError(""); }} />
      <span>También corregir las claves del inventario a como están en AX y preparar etiquetas</span></label>
    <label class="casilla"><input type="checkbox" checked=${corregirUnidades} disabled=${sesion.ocupado || !lineas[0].um}
      onChange=${(e) => { const activar = e.currentTarget.checked; setCorregirUnidades(activar); setRevisando(false); setError("");
        if (!activar) setSeleccion((s) => new Set([...s].filter((id) => opciones.some((f) => f.variante.id === id && f.compatible)))); }} />
      <span>Corregir la unidad del inventario a la de AX</span></label>
    <p class="nota">${conCorreccion ? "La corrección se guarda en el inventario y se usará en las próximas conciliaciones. Se prepara una etiqueta por partida que cambie. Los vales conservan su captura original."
      : "Sólo vincular: conserva dimensiones, NP, cantidades y vales. Etiquetas: 0 nuevas."}</p>
    ${corregir ? html`<p class="nota">Se corregirá la dimensión a Tamaño + Color de AX. Se conserva el NP, salvo si repite el Color de AX.</p>` : null}
    ${revisando
      ? conCorreccion ? html`<${Tabla} filas=${correccion?.propuestas ?? []} claveFila=${(p) => p.existenciaId} columnas=${revisionClaves} vacia="Sin partidas del inventario: se comparará AX contra físico 0." />`
        : html`<${Tabla} filas=${elegidas} claveFila=${(f) => f.variante.id} columnas=${columnas} vacia="Sin partidas del inventario: se comparará AX contra físico 0." />`
      : html`<${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Dimensión, NP, contenedor…" />
        <${Tabla} filas=${visibles} columnas=${[
          { titulo: "Incluir", render: (f) => html`<input type="checkbox" checked=${seleccion.has(f.variante.id)}
            disabled=${sesion.ocupado || (((!f.compatible && !corregirUnidades) || Boolean(f.ocupada)) && !seleccion.has(f.variante.id))}
            aria-label=${`Incluir ${textoVariante(f.variante)}`} onChange=${(e) => marcar(f.variante.id, e.currentTarget.checked)} />` },
          ...columnas,
          { titulo: "Disponibilidad", render: (f) => f.ocupada
            ? html`<span class="nota">Ya corresponde a AX ${dimensionAx(f.ocupada) || "SIN DIMENSIÓN"}</span>`
            : !f.compatible ? html`<span class="alerta">Unidad de medida distinta: AX <code>${unidadesAx}</code> · físico <code>${f.variante.um || "Sin unidad"}</code></span>`
            : html`<span class="nota">${seleccion.has(f.variante.id) ? "Seleccionada" : "Disponible"}</span>` },
        ]} vacia="No hay partidas de este código con esa búsqueda." />`}
    ${opciones.some((f) => !f.compatible) ? html`<p class="nota">Si son medidas diferentes (por ejemplo, caja y pieza), se necesita una conversión antes de sumar sus cantidades. Activa la corrección de unidad e indica su equivalencia.</p>` : null}
    ${corregirUnidades && !revisando ? html`<div class="revision-correccion-ax">
      <p>Indica la equivalencia de cada opción seleccionada. Por ejemplo: 1 CJA = 12 PZA. Si sólo estaba mal anotada la unidad, indica 1 = 1.</p>
      ${elegidas.map((f) => {
        const id = f.variante.id, eq = equivalenciasElegidas[id];
        const cambiar = (campo, valor) => { setEquivalencias((a) => ({ ...a, [id]: { ...eq, [campo]: valor.replace(",", ".") } })); setError(""); };
        return html`<div><strong>${textoVariante(f.variante)}</strong><div class="campos-clave">
          <label class="campo"><span>Cantidad en ${f.variante.um}</span><input inputmode="decimal" aria-label=${`Equivalencia origen ${textoVariante(f.variante)}`} value=${eq.origen} onInput=${(e) => cambiar("origen", e.currentTarget.value)} /></label>
          <label class="campo"><span>Equivale a esta cantidad en AX (${unidadesAx})</span><input inputmode="decimal" aria-label=${`Equivalencia destino ${textoVariante(f.variante)}`} value=${eq.destino} onInput=${(e) => cambiar("destino", e.currentTarget.value)} /></label>
        </div></div>`;
      })}
    </div>` : null}
    <div class="acciones-linea">
      <span>AX: <strong>${n(fila.ax)}</strong></span>
      <span>Físico actual: <strong>${fila.fisico === null ? "—" : n(fila.fisico)}</strong></span>
      <span>Físico seleccionado: <strong>${totalValido ? n(total) : "Indica la equivalencia"}</strong>${corregirUnidades ? ` ${unidadesAx}` : ""}</span>
      <span>Diferencia física: <strong>${totalValido ? n(total.minus(fila.ax)) : "—"}</strong></span>
    </div>
    ${conCorreccion ? html`<div class="revision-correccion-ax">
      ${correccion?.error ? html`<p class="alerta" role="alert">${correccion.error}</p>`
        : html`<p><strong>Etiquetas:</strong> ${correccion?.etiquetas ?? 0} nuevas en Etiquetas → Material (una por partida física que cambia).</p>
          <${ResultadoCorreccionAx} comparacion=${correccion?.comparacion} />
          ${correccion?.comparacion && !correccion.comparacion.fisico.eq(total) ? html`<p class="alerta">Ya hay partidas con la clave de destino: se unirán y el físico después será ${n(correccion.comparacion.fisico)}. Revisa también ese total.</p>` : null}`}
    </div>` : html`<p aria-live="polite">Resultado con esta selección: <strong>${!previa ? "Por confirmar"
      : previa.estado === "faltante" ? `Faltan ${n(previa.sin_explicar.abs())}`
      : previa.estado === "sobrante" ? `Sobran ${n(previa.sin_explicar)}` : etiquetaEstado(previa.estado)}</strong>
      ${previa?.folios.length ? html` · Vales en tránsito: ${previa.folios.join(", ")}` : null}</p>`}
    ${revisando ? html`<p>Confirma que estas ${elegidas.length} opciones corresponden al material de AX. La conciliación sumará su existencia y los vales en tránsito que les correspondan.</p>` : null}
    ${error ? html`<p class="alerta" role="alert">${error}</p>` : null}
    <div class="acciones-linea">
      ${revisando
        ? html`<${Boton} tipo="primario" disabled=${sesion.ocupado || Boolean(correccion?.error)} onClick=${() => conCorreccion ? guardarCorreccion() : guardar()}>${conCorreccion ? "Confirmar corrección, vínculo y etiquetas" : "Confirmar vínculo"}<//>
          <${Boton} disabled=${sesion.ocupado} onClick=${() => setRevisando(false)}>Cambiar selección<//>`
        : html`<${Boton} tipo="primario" disabled=${sesion.ocupado || Boolean(correccion?.error)} onClick=${() => setRevisando(true)}>Revisar vínculo<//>
          ${manual ? html`<${Boton} disabled=${sesion.ocupado} onClick=${() => guardar(true)}>Usar emparejamiento automático<//>` : null}`}
      <${Boton} tipo="texto" disabled=${sesion.ocupado} onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}
