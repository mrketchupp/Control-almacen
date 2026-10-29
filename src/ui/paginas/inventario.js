import { useMemo, useState } from "preact/hooks";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { DUENO_FX } from "../../nucleo/inventarios.js";
import { npAnteriores } from "../../servicios/baseOficial.js";
import { filasInventario } from "../../servicios/consultas.js";
import { corregirDimensionNp, lugarCorto, renglonDe, sugerenciasClave, ubicacionesOrdenadas } from "../../servicios/inventario.js";
import { ErrorReacomodo, historialReacomodos, reacomodar } from "../../servicios/reacomodos.js";
import { Boton, Buscador, CampoSugerido, Detalles, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { EditorClave, useCorreccion } from "./clave.js";
import { BotonDescripcion, EditorDescripcion } from "./descripcion.js";

/** La descripción con el lápiz pegado a su última palabra (si la descripción se parte en líneas, no queda solo). */
function descripcionConLapiz({ codigo, descripcion }) {
  const corte = descripcion.lastIndexOf(" ") + 1;
  return html`${descripcion.slice(0, corte)}<span class="sin-corte">${descripcion.slice(corte)}<${BotonDescripcion} codigo=${codigo} /></span>`;
}

/** Corregir la dimensión y el NP de una partida del inventario (o de todas las de su variante), con sugerencias de AX. */
function CorregirClave({ fila, alTerminar }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  return html`<${Ventana} titulo="Corregir dimensión y NP" alCerrar=${alTerminar}>
    <p>
      <strong>${fila.codigo}</strong> ${fila.descripcion}
      <${Pastilla} tono="lugar" titulo=${fila.hoja}>${lugarCorto({ contenedor: fila.contenedor, clase: fila.clase === "Inventariable" ? "INV" : "CONS" })}<//>
      <${Pastilla} tono=${fila.total > 0 ? "ok" : "alerta"}>hay ${num(fila.total)} ${fila.um}<//>
    </p>
    <p class="nota">Las sugerencias dicen cómo lo escribe AX (su dimensión es Tamaño + Color; AX no trae NP) y cómo está en otras partidas.</p>
    <${EditorClave}
      cual=${{ existenciaId: fila.id }}
      codigo=${fila.codigo}
      actual=${{ dimension: fila.dimension, np: fila.np, um: fila.um }}
      conMotivo=${true}
      textoAplicar="Guardar"
      alAplicar=${({ dimension, np, motivo, cual }) =>
        corregir(
          (e) => corregirDimensionNp(e, cual, { dimension, np }, { usuario: sesion.usuario, motivo }),
          (r) => `Listo: ${fila.codigo} quedó como ${r.despues}${r.renglones > 1 ? ` en ${r.renglones} partidas` : ""}${r.unida ? " (se juntó con la variante igual)" : ""}.`,
        ).then((r) => r && alTerminar())}
      alCancelar=${alTerminar}
    />
  <//>`;
}

/**
 * Anotar o cambiar solo el NP de una partida (Ronda 24): el NP es una ayuda para identificar el material.
 * Sugiere los NP que tenía el código antes del conteo de auditoría y los de sus otras partidas.
 */
function EditarNp({ fila, alTerminar }) {
  const sesion = useSesion();
  const corregir = useCorreccion();
  const [np, setNp] = useState(fila.np ?? "");
  const anteriores = useMemo(() => npAnteriores(sesion.estado, fila.codigo), [sesion.estado, fila.codigo]);
  const sugerencias = useMemo(() => {
    const otros = sugerenciasClave(sesion.estado, fila.codigo).nps.map((x) => x.valor);
    return [...new Set([...anteriores.map((x) => x.np), ...otros])].filter((x) => x && x !== fila.np);
  }, [sesion.estado, anteriores, fila.codigo, fila.np]);
  const guardar = () =>
    corregir(
      (e) => corregirDimensionNp(e, { existenciaId: fila.id }, { dimension: fila.dimension, np: np.trim() }, { usuario: sesion.usuario, motivo: "NP anotado en el inventario" }),
      (r) => `Listo: ${fila.codigo} quedó como ${r.despues}.`,
    ).then((r) => r && alTerminar());
  const cambia = np.trim() !== (fila.np ?? "");
  return html`<${Ventana} titulo=${fila.np ? "Cambiar el NP" : "Anotar el NP"} alCerrar=${alTerminar}>
    <p>
      <strong>${fila.codigo}</strong> ${fila.descripcion} · ${fila.dimension || "SIN DIMENSIÓN"}
      <${Pastilla} tono="lugar" titulo=${fila.hoja}>${lugarCorto({ contenedor: fila.contenedor, clase: fila.clase === "Inventariable" ? "INV" : "CONS" })}<//>
      <${Pastilla} tono=${fila.total > 0 ? "ok" : "alerta"}>hay ${num(fila.total)} ${fila.um}<//>
    </p>
    <label class="campo">
      <span>NP (número de parte)</span>
      <${CampoSugerido} id="np-rapido" valor=${np} alCambiar=${setNp} sugerencias=${sugerencias} placeholder="Vacío = sin NP" ariaLabel="NP" />
    </label>
    ${anteriores.length
      ? html`<div class="np-anteriores">
          <p class="nota">Antes del conteo de auditoría este código tenía:</p>
          <ul>
            ${anteriores.map((a) => html`<li key=${a.np}><button type="button" class="boton boton-texto" onClick=${() => setNp(a.np)}>${a.np}</button> <span class="nota">${a.detalle}</span></li>`)}
          </ul>
        </div>`
      : null}
    <p class="nota">Solo cambia el NP de esta partida; la dimensión, la cantidad y los vales se quedan igual.</p>
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!cambia || sesion.ocupado} onClick=${guardar}>Guardar<//>
      <${Boton} onClick=${alTerminar}>Cancelar<//>
    </div>
  <//>`;
}

/** Mover material de un renglón a otro contenedor sin cambiar el total (RF-42). */
function MoverRenglon({ fila, alTerminar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const existencia = estado.existencias.find((e) => e.id === fila.id);
  const [cantidad, setCantidad] = useState(String(Math.max(0, fila.total)));
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [error, setError] = useState(null);
  const opciones = ubicacionesOrdenadas(estado)
    .filter((u) => u.id !== fila.ubicacion_id)
    .map((u) => ({ valor: String(u.id), etiqueta: u.hoja_excel.trim(), detalle: renglonDe(estado, existencia.variante_id, u.id) ? "ya tiene su partida" : "partida nueva" }));
  const mover = () =>
    sesion.tarea("Moviendo…", async () => {
      try {
        const r = await sesion.almacen.modificar((e) => reacomodar(e, { desdeId: fila.id, ubicacionId: Number(destino), cantidad, motivo, usuario: sesion.usuario, fecha }));
        sesion.avisar("exito", `Se movieron ${r.cantidad} ${r.um} a ${r.hacia_hoja}.`);
        alTerminar();
      } catch (e) {
        if (e instanceof ErrorReacomodo) setError(e.message);
        else throw e;
      }
    });
  return html`<${Tarjeta} titulo="Mover a otro contenedor" clase="tarjeta-correccion">
    <p>
      <strong>${fila.codigo}</strong> ${fila.descripcion} · ${[fila.dimension, fila.np && `NP ${fila.np}`].filter(Boolean).join(" · ") || "S/D"}
      <${Pastilla} tono="lugar" titulo=${fila.hoja}>${lugarCorto({ contenedor: fila.contenedor, clase: fila.clase === "Inventariable" ? "INV" : "CONS" })}<//>
      <${Pastilla} tono=${fila.total > 0 ? "ok" : "alerta"}>hay ${num(fila.total)} ${fila.um}<//>
    </p>
    <div class="acciones-linea">
      <label class="filtro"><span>Cantidad a mover</span><input class="entrada-cantidad" inputmode="decimal" value=${cantidad} onInput=${(e) => setCantidad(e.currentTarget.value.replace(",", "."))} /></label>
      <div class="filtro">
        <span>A qué contenedor</span>
        <${Lista} valor=${destino} alCambiar=${setDestino} ariaLabel="Contenedor de destino" placeholder="— Elige —" opciones=${opciones} />
      </div>
      <label class="filtro"><span>Fecha</span><input type="date" value=${fecha} onChange=${(e) => setFecha(e.currentTarget.value)} /></label>
      <label class="filtro filtro-ancho"><span>Motivo (opcional)</span><input value=${motivo} onInput=${(e) => setMotivo(e.currentTarget.value)} placeholder="Ej. se reacomodó el contenedor 2" /></label>
    </div>
    <p class="nota">
      El total no cambia: las dos partidas quedan como recién contadas (CANTIDAD = lo que queda en cada una). Si el material no tiene
      partida en ese contenedor, se agrega al final de su hoja.
    </p>
    ${error ? html`<p class="alerta">${error}</p>` : null}
    <div class="acciones-linea">
      <${Boton} onClick=${alTerminar}>Cancelar<//>
      <${Boton} tipo="primario" disabled=${!destino} onClick=${mover}>Mover<//>
    </div>
  <//>`;
}

function Reacomodos() {
  const sesion = useSesion();
  const filas = useMemo(() => historialReacomodos(sesion.estado), [sesion.estado.reacomodos]);
  if (!filas.length) return null;
  return html`<${Detalles} resumen=${`Movimientos entre contenedores (${filas.length})`}>
    <${Tabla}
      limite=${50}
      filas=${filas}
      columnas=${[
        { clave: "fecha_texto", titulo: "Fecha" },
        { clave: "codigo", titulo: "Código", numero: true },
        { clave: "descripcion", titulo: "Descripción" },
        { clave: "clave", titulo: "Clave" },
        { titulo: "Cantidad", numero: true, render: (r) => `${num(r.cantidad_numero)} ${r.um}` },
        { titulo: "De → a", render: (r) => html`<span class="sin-corte">${r.desde_hoja} → ${r.hacia_hoja}</span>${r.renglon_nuevo ? html` <${Pastilla} tono="info">partida nueva<//>` : null}` },
        { titulo: "Quién / motivo", render: (r) => [r.usuario, r.motivo].filter(Boolean).join(" · ") },
      ]}
    />
  <//>`;
}

export function PaginaInventario() {
  const sesion = useSesion();
  // Como el Excel diario: CANTIDAD = lo que había al empezar hoy; CONSUMO e INGRESO = los vales de hoy.
  const dia = hoyIso();
  const filas = useMemo(() => filasInventario(sesion.estado, { dia }), [sesion.estado, dia]);
  const [texto, setTexto] = useState("");
  const [hoja, setHoja] = useState("");
  const [vista, setVista] = useState("todos");
  // En GSM, las partidas de FX (las marcó el conteo de auditoría).
  const conFx = useMemo(() => filas.some((f) => f.dueno === DUENO_FX), [filas]);
  const [dueno, setDueno] = useState("todo");
  const [moviendo, setMoviendo] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [describiendo, setDescribiendo] = useState(null);
  const [anotandoNp, setAnotandoNp] = useState(null);
  const hojas = useMemo(() => [...new Set(filas.map((f) => f.hoja))], [filas]);
  const porTexto = useFiltroTexto(filas, texto, ["codigo", "descripcion", "dimension", "np", "nota"]);
  const visibles = porTexto.filter((f) => {
    if (hoja && f.hoja !== hoja) return false;
    if (conFx && dueno !== "todo" && (dueno === DUENO_FX) !== (f.dueno === DUENO_FX)) return false;
    if (vista === "movimiento") return f.consumo || f.ingreso;
    if (vista === "agotado") return f.total <= 0;
    if (vista === "notas") return Boolean(f.nota);
    if (vista === "nuevos") return Boolean(f.origen);
    return true;
  });
  const fila = moviendo ? filas.find((f) => f.id === moviendo) : null;
  const aCorregir = corrigiendo ? filas.find((f) => f.id === corrigiendo) : null;
  const conNp = anotandoNp ? filas.find((f) => f.id === anotandoNp) : null;
  return html`
    ${fila ? html`<${MoverRenglon} key=${fila.id} fila=${fila} alTerminar=${() => setMoviendo(null)} />` : null}
    ${aCorregir ? html`<${CorregirClave} key=${aCorregir.id} fila=${aCorregir} alTerminar=${() => setCorrigiendo(null)} />` : null}
    ${conNp ? html`<${EditarNp} key=${conNp.id} fila=${conNp} alTerminar=${() => setAnotandoNp(null)} />` : null}
    ${describiendo !== null ? html`<${EditorDescripcion} key=${describiendo} codigo=${describiendo} alTerminar=${() => setDescribiendo(null)} />` : null}
    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión, NP…" />
      <${Lista}
        clase="lista-filtro"
        valor=${hoja}
        alCambiar=${setHoja}
        ariaLabel="Contenedor"
        opciones=${[{ valor: "", etiqueta: "Todos los contenedores" }, ...hojas.map((h) => ({ valor: h, etiqueta: h }))]}
      />
      <${Lista}
        clase="lista-filtro"
        valor=${vista}
        alCambiar=${setVista}
        ariaLabel="Vista"
        opciones=${[
          { valor: "todos", etiqueta: "Todas las partidas" },
          { valor: "movimiento", etiqueta: "Con consumo o ingreso hoy" },
          { valor: "agotado", etiqueta: "Existencia 0 o negativa" },
          { valor: "notas", etiqueta: "Con nota" },
          { valor: "nuevos", etiqueta: "Agregados en la herramienta" },
        ]}
      />
      ${conFx ? html`<${Segmentos} etiqueta="Material" valor=${dueno} alCambiar=${setDueno} opciones=${{ todo: "Todo", propio: sesion.inventario.id, [DUENO_FX]: "FX" }} />` : null}
      <span class="conteo">${num(visibles.length)} de ${num(filas.length)}</span>
    </div>
    <p class="nota nota-inventario-dia">
      Como el Excel diario: <strong>Cantidad</strong> es lo que había al empezar hoy (${fmtFecha(dia)});
      <strong>Consumo</strong> e <strong>Ingreso</strong> son solo los vales de hoy (las entradas, por el día en que se recibieron). Los de días
      anteriores ya están en la cantidad.
    </p>
    <${Tabla}
      limite=${300}
      filas=${visibles.map((f) => ({ ...f, _clase: f.total < 0 ? "fila-negativa" : "" }))}
      menuFila=${(f) => ({
        titulo: `Inventario: ${f.codigo} ${f.dimension || ""}`,
        opciones: sesion.ocupado ? [] : [
          { texto: f.np ? "Cambiar el NP…" : "Anotar el NP…", accion: () => setAnotandoNp(f.id) },
          { texto: "Editar dimensión y NP…", accion: () => setCorrigiendo(f.id) },
          { texto: "Editar la descripción del código…", accion: () => setDescribiendo(f.codigo) },
          { texto: "Mover a otro contenedor…", accion: () => { setMoviendo(f.id); window.scrollTo(0, 0); } },
        ],
      })}
      columnas=${[
        {
          titulo: "Cont.",
          render: (f) => html`<span class="sin-corte" title=${f.hoja}>#${f.contenedor} ${f.clase === "Inventariable" ? "Inv." : "Cons."}</span>`,
        },
        { clave: "codigo", titulo: "Código", numero: true },
        {
          titulo: "Descripción",
          render: (f) => html`${descripcionConLapiz(f)}${f.dueno === DUENO_FX ? html` <${Pastilla} tono="fx" titulo="Material de FX (se descuenta en los vales de GSM)">FX<//>` : null}`,
        },
        { clave: "dimension", titulo: "Dimensión" },
        {
          titulo: "NP",
          render: (f) => html`<span class="sin-corte">${f.np}<button
              type="button"
              class="boton-descripcion"
              disabled=${Boolean(sesion.ocupado)}
              title=${f.np ? "Cambiar el NP de esta partida" : "Anotar el NP de esta partida"}
              aria-label=${`${f.np ? "Cambiar" : "Anotar"} el NP de ${f.codigo} ${f.dimension || ""}`}
              onClick=${() => setAnotandoNp(f.id)}
            ><${Icono} nombre="lapiz" tam=${14} /></button></span>`,
        },
        { clave: "um", titulo: "UM" },
        { titulo: html`<span title="Lo que había al empezar el día">Cantidad</span>`, numero: true, render: (f) => num(f.cantidad) },
        { titulo: html`<span title="Vales de salida de hoy">Consumo</span>`, numero: true, render: (f) => num(f.consumo) },
        { titulo: html`<span title="Vales de entrada de hoy">Ingreso</span>`, numero: true, render: (f) => num(f.ingreso) },
        { titulo: "Total", numero: true, render: (f) => html`<strong>${num(f.total)}</strong>` },
        {
          titulo: "Nota",
          render: (f) => html`${f.nota ? html`<span class="nota-icono" title=${f.nota}>✎</span>` : ""}${f.origen ? html`<span class="nota-icono" title=${`Agregado por ${f.origen.toLowerCase()}`}>✚</span>` : ""}`,
        },
        {
          titulo: "",
          render: (f) => html`<span class="acciones-fila">
            <button type="button" class="boton boton-texto boton-mover" title="Corregir la dimensión o el NP" onClick=${() => setCorrigiendo(f.id)}>Editar</button>
            <button type="button" class="boton boton-texto boton-mover" title="Mover a otro contenedor" onClick=${() => {
              setMoviendo(f.id);
              window.scrollTo(0, 0);
            }}>Mover</button>
          </span>`,
        },
      ]}
      vacia="Ninguna partida coincide con el filtro."
    />
    <${Reacomodos} />
  `;
}
