// Justificar faltantes (Ronda 14): asignar a cada faltante de la conciliación los vales que ya salieron
// del almacén y que AX aún no descuenta. Se sugieren (código, dimensión y cantidad) y se aprueban una
// por una o todas; también se eligen a mano. Lo asignado sale en la hoja VALES POR APLICAR.

import { useEffect, useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { fmtFecha } from "../../nucleo/fechas.js";
import { fechaMinimaJustificantes, valeAdmitido } from "../../nucleo/justificantes.js";
import { dimensionAx, textoFisico } from "../../servicios/conciliacion.js";
import {
  ESTADOS_CANDIDATO,
  ErrorJustificacion,
  asignarSugeridas,
  asignarVales,
  candidatos,
  destinoDe,
  fijarFechaMinimaVales,
  justificables,
  quitarAsignaciones,
} from "../../servicios/justificacion.js";
import { Boton, Buscador, Pastilla, Segmentos, Tabla, Ventana, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { PastillaAx } from "./base.js";
import { ElegirFisicoAx } from "./fisicoAx.js";

const n = (d) => (d === null || d === undefined ? "—" : num(aNumero(d)));
const describir = (v) => (v ? `${v.dimension || "SIN DIMENSIÓN"}${v.np ? ` · NP ${v.np}` : ""}` : "—");
const enAx = (fila) => (fila.lineas ?? [fila.linea]).map((l) => dimensionAx(l) || "SIN DIMENSIÓN").join(" / ");

const TONO_CANDIDATO = { libre: "ok", otra: "alerta", en_ax: "neutro", sin_base: "neutro", posterior_conteo: "error", aqui: "info" };
const TEXTO_CANDIDATO = {
  libre: "Sin IN / TR",
  otra: "Justifica otra",
  en_ax: "Ya en AX",
  sin_base: "Sin archivo de la base",
  posterior_conteo: "Por ubicar",
  aqui: "Ya justifica aquí",
};

/** Asigna, avisa y ofrece Deshacer. */
function useAsignar(corte) {
  const sesion = useSesion();
  return (destino, partidas, metodo, mensaje) =>
    sesion.tarea("Asignando…", async () => {
      let nuevas;
      try {
        nuevas = await sesion.almacen.modificar((e) => asignarVales(e, { corteId: corte.id, destino, partidas, metodo }, sesion.usuario));
      } catch (error) {
        if (error instanceof ErrorJustificacion) return sesion.avisar("error", error.message);
        throw error;
      }
      sesion.avisar("exito", mensaje, 10000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => quitarAsignaciones(e, { corteId: corte.id, ids: nuevas.map((a) => a.id) }, sesion.usuario)),
      });
    });
}

/** Partidas candidatas de un faltante: para asignarlas a mano, con su estado y avisos. */
function ElegirVales({ r, corte, fila, alTerminar }) {
  const sesion = useSesion();
  const asignar = useAsignar(corte);
  const [texto, setTexto] = useState("");
  const [todas, setTodas] = useState(false);
  const lista = useMemo(() => candidatos(sesion.estado, r, fila), [sesion.estado, r, fila]);
  const ocultas = lista.filter((k) => k.estado === "en_ax" || k.estado === "aqui").length;
  const visibles = useFiltroTexto(
    lista
      .filter((k) => todas || (k.estado !== "en_ax" && k.estado !== "aqui"))
      .map((k) => ({ ...k, id: k.linea.id, _buscar: `${k.vale.folio} ${k.linea.clave ?? ""} ${k.linea.descripcion ?? ""} ${k.vale.depto_destino ?? ""}` })),
    texto,
    ["_buscar"],
  );
  const advertencia = (k) =>
    k.estado === "otra"
      ? `Hoy justifica ${describir(k.otra)}: si la asignas aquí, deja de contar allá.`
      : k.estado === "en_ax"
        ? "La base ya le puso IN / TR. Asígnala solo si AX la aplicó después del reporte."
        : k.estado === "sin_base"
          ? "Sin el archivo de la base se supone que ya está en AX."
          : "";
  const elegir = (k) => {
    const aviso = advertencia(k);
    if (aviso && !confirmar(`Vale ${k.vale.folio}: ${aviso}\n\n¿Asignarla de todos modos?`)) return;
    return asignar(destinoDe(fila), [{ partida_id: k.linea.id, cantidad: k.cantidad }], "manual", `Vale ${k.vale.folio} asignado a ${fila.codigo} ${enAx(fila)}.`);
  };
  return html`<div class="elegir-vales">
    <p class="nota">Solo se muestran vales desde el ${fmtFecha(fechaMinimaJustificantes(corte))}.</p>
    <div class="controles-elegir">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Folio, clave, área…" />
      ${ocultas
        ? html`<label class="casilla">
            <input type="checkbox" checked=${todas} onChange=${(e) => setTodas(e.currentTarget.checked)} />
            <span>Mostrar también las que ya están en AX o ya justifican aquí (${ocultas})</span>
          </label>`
        : null}
      <${Boton} tipo="texto" tamano="chico" onClick=${alTerminar}>Cerrar<//>
    </div>
    <${Tabla}
      limite=${50}
      filas=${visibles}
      vacia=${lista.length ? "Nada con ese filtro." : `No hay vales de salida del código ${fila.codigo} que se puedan asignar.`}
      columnas=${[
        { titulo: "Folio", numero: true, render: (k) => html`<a class="enlace-folio" href=${`#vale/${k.vale.id}`}>${k.vale.folio}</a>` },
        { titulo: "Fecha", render: (k) => fmtFecha(k.vale.fecha) },
        { titulo: "Clave", render: (k) => html`${k.linea.clave || "—"}${k.coincide === "exacta" ? html` <${Pastilla} tono="ok" titulo="La clave del vale es la dimensión de esta partida">misma dimensión<//>` : ""}` },
        { titulo: "Cant.", numero: true, render: (k) => `${n(k.cantidad)} ${k.linea.um ?? ""}` },
        { titulo: "En la base", render: (k) => html`<${PastillaAx} info=${k.info} />` },
        {
          titulo: "Estado",
          render: (k) => html`<${Pastilla} tono=${TONO_CANDIDATO[k.estado]} titulo=${ESTADOS_CANDIDATO[k.estado]}>${TEXTO_CANDIDATO[k.estado]}<//>
            ${k.estado === "posterior_conteo" ? html`<span class="nota"> ubícala en Pendientes</span>` : null}`,
        },
        {
          titulo: "",
          render: (k) =>
            k.estado === "posterior_conteo" || k.estado === "aqui"
              ? null
              : html`<${Boton} tamano="chico" tipo=${k.estado === "libre" ? "secundario" : "texto"} onClick=${() => elegir(k)}>Asignar<//>`,
        },
      ]}
    />
  </div>`;
}

/** Un faltante: sus cifras, la sugerencia (para aprobar), lo asignado y elegir a mano. */
function ItemJustificar({ j, sugerencia, r, corte }) {
  const sesion = useSesion();
  const asignar = useAsignar(corte);
  const [eligiendo, setEligiendo] = useState(false);
  const [inventario, setInventario] = useState(false);
  const { fila } = j;
  const vales = new Map(sesion.estado.vales.map((v) => [v.id, v]));
  const quitar = (a) =>
    sesion.tarea("Quitando…", () => sesion.almacen.modificar((e) => quitarAsignaciones(e, { corteId: corte.id, ids: [a.id] }, sesion.usuario)));
  const aprobar = () =>
    asignar(
      destinoDe(fila),
      sugerencia.partidas.map((p) => ({ partida_id: p.linea.id, cantidad: p.cantidad })),
      "sugerida",
      `${fila.codigo} ${enAx(fila)}: ${sugerencia.partidas.length === 1 ? "1 vale asignado" : `${sugerencia.partidas.length} vales asignados`}.`,
    );
  return html`<li class="item-justificar">
    <div class="just-cabeza">
      <div class="just-partida">
        <strong>${fila.codigo}</strong> <span class="descripcion-corta" title=${fila.descripcion}>${fila.descripcion}</span>
        <code class="dim-ax">${enAx(fila)}</code>
        ${fila.variante ? html`<span class="nota" title=${(fila.variantes ?? [fila.variante]).map(describir).join("\n")}>físico: ${textoFisico(fila)}</span>` : html`<span class="nota">no está en el físico</span>`}
      </div>
      <div class="just-cifras">
        <span>AX <strong>${n(fila.ax)}</strong></span>
        <span>Físico <strong>${n(fila.fisico)}</strong></span>
        ${fila.folios.length ? html`<span title=${fila.folios.join(", ")}>Vales <strong>−${n(fila.salidas)}</strong></span>` : null}
        ${j.falta.gt(0) ? html`<${Pastilla} tono="error">Faltan ${n(j.falta)}<//>` : html`<${Pastilla} tono=${fila.estado === "explicada" ? "info" : "alerta"}>${fila.estado === "explicada" ? "Explicada" : `Sobran ${n(fila.sin_explicar)}`}<//>`}
      </div>
    </div>
    ${sugerencia
      ? html`<div class="just-sugerencia">
          <span class="nota">Sugerido:</span>
          ${sugerencia.partidas.map(
            (p) => html`<span class="vale-sugerido">
              Vale <a class="enlace-folio" href=${`#vale/${p.vale.id}`}>${p.vale.folio}</a> <span class="nota">${fmtFecha(p.vale.fecha)} · ${p.linea.clave || "—"}</span>
              <strong>${n(p.cantidad)} ${p.linea.um ?? ""}</strong>
              ${p.coincide === "unica" ? html`<${Pastilla} tono="alerta" titulo="La clave del vale no es la dimensión, pero el código tiene una sola partida">otra clave<//>` : null}
            </span>`,
          )}
          <${Pastilla} tono=${sugerencia.exacta ? "ok" : "alerta"}>${sugerencia.exacta ? "cubre todo" : `cubre ${n(sugerencia.suma)} de ${n(j.falta)}`}<//>
          <${Boton} tipo="primario" tamano="chico" onClick=${aprobar}>✓ Asignar<//>
        </div>`
      : null}
    ${j.asignadas.length
      ? html`<div class="just-asignadas">
          <span class="nota">Asignados:</span>
          ${j.asignadas.map((a) => {
            const vale = vales.get(a.vale_id);
            const linea = vale?.lineas.find((l) => l.id === a.partida_id);
            return html`<span class="vale-asignado">
              Vale ${vale ? html`<a class="enlace-folio" href=${`#vale/${vale.id}`}>${a.folio}</a>` : a.folio}
              <span class="nota">${linea?.clave || ""}</span>
              ${!valeAdmitido(corte, vale) ? html`<${Pastilla} tono="error">Fuera del periodo: no justifica<//>` : null}
              <strong>${n(a.cantidad)} ${linea?.um ?? ""}</strong>
              <span class="nota">${a.metodo === "sugerida" ? "sugerido" : "a mano"}</span>
              <button type="button" class="enlace-boton peligro" onClick=${() => quitar(a)} aria-label=${`Quitar el vale ${a.folio}`}>Quitar</button>
            </span>`;
          })}
        </div>`
      : null}
    ${eligiendo
      ? html`<${ElegirVales} r=${r} corte=${corte} fila=${fila} alTerminar=${() => setEligiendo(false)} />`
      : html`<div class="acciones-linea"><${Boton} tipo="texto" tamano="chico" onClick=${() => setEligiendo(true)}>Elegir vales…<//></div>`}
    <div class="acciones-linea"><${Boton} tipo="texto" tamano="chico" onClick=${() => setInventario(true)}>Elegir del inventario…<//></div>
    ${inventario ? html`<${ElegirFisicoAx} r=${r} corte=${corte} fila=${fila} alCerrar=${() => setInventario(false)} />` : null}
  </li>`;
}

const VISTAS = { sugeridos: "Con sugerencia", faltantes: "Faltantes", asignados: "Con vales asignados" };

/** Ventana para justificar los faltantes con vales. */
export function VentanaJustificar({ r, corte, sugerencias, alCerrar }) {
  const sesion = useSesion();
  const minima = fechaMinimaJustificantes(corte);
  const [fecha, setFecha] = useState(minima);
  const [errorFecha, setErrorFecha] = useState("");
  useEffect(() => { setFecha(minima); setErrorFecha(""); }, [corte.id, minima]);
  const guardarFecha = () => sesion.tarea("Guardando límite anual…", async () => {
    try {
      await sesion.almacen.modificar((e) => fijarFechaMinimaVales(e, corte.id, fecha, sesion.usuario));
      setErrorFecha("");
      sesion.avisar("exito", `Se aceptan vales desde el ${fmtFecha(fecha)} en este corte.`);
    } catch (error) {
      if (error instanceof ErrorJustificacion) setErrorFecha(error.message);
      else throw error;
    }
  });
  const excluidos = sesion.estado.vales.filter((v) => v.tipo === "SALIDA" && v.estado === "EMITIDO" && !valeAdmitido(corte, v)).length;
  const lista = useMemo(() => justificables(sesion.estado, r), [sesion.estado, r]);
  const cuantas = {
    sugeridos: lista.filter((j) => sugerencias.has(j.clave)).length,
    faltantes: lista.filter((j) => j.falta.gt(0)).length,
    asignados: lista.filter((j) => j.asignadas.length).length,
  };
  const [vista, setVista] = useState(cuantas.sugeridos ? "sugeridos" : "faltantes");
  const [texto, setTexto] = useState("");
  const deVista = lista.filter((j) => (vista === "sugeridos" ? sugerencias.has(j.clave) : vista === "faltantes" ? j.falta.gt(0) : j.asignadas.length));
  const filas = useFiltroTexto(
    deVista.map((j) => ({ ...j, _buscar: `${j.codigo} ${j.fila.descripcion ?? ""} ${enAx(j.fila)} ${(j.fila.variantes ?? [j.fila.variante]).map(describir).join(" ")}` })),
    texto,
    ["_buscar"],
  );
  const partidasSugeridas = [...sugerencias.values()].reduce((suma, s) => suma + s.partidas.length, 0);
  const asignarTodas = () => {
    if (!confirmar(`¿Asignar ${partidasSugeridas === 1 ? "1 vale" : `${partidasSugeridas} vales`} a ${sugerencias.size === 1 ? "1 faltante" : `${sugerencias.size} faltantes`}, como se sugiere? Puedes quitar cualquiera después.`)) return;
    return sesion.tarea("Asignando…", async () => {
      const hecho = await sesion.almacen.modificar((e) => asignarSugeridas(e, corte.id, sesion.usuario));
      sesion.avisar("exito", `Listo: ${hecho.partidas} vales asignados a ${hecho.faltantes} faltantes.`);
    });
  };
  const opciones = Object.fromEntries(Object.entries(VISTAS).map(([k, v]) => [k, `${v} (${cuantas[k]})`]));
  return html`<${Ventana} titulo="Justificar faltantes" clase="ventana-concilia" alCerrar=${alCerrar}>
    <p class="nota">
      Un faltante se justifica con vales que ya salieron del almacén y que AX aún no descuenta (sin IN / TR). Lo que asignes cuenta para ese
      faltante si su fecha pertenece al periodo admitido y sale en la hoja <strong>VALES POR APLICAR</strong> de la solicitud, para que la base lo registre
      como consumo o transferencia. Las cantidades y los vales no cambian.
    </p>
    <div class="limite-justificantes">
      <label class="campo"><span>Aceptar vales desde</span><input type="date" value=${fecha ?? ""} max=${corte.fecha} onInput=${(e) => setFecha(e.currentTarget.value)} aria-label="Aceptar vales desde" /></label>
      <${Boton} tamano="chico" disabled=${fecha === minima || sesion.ocupado} onClick=${guardarFecha}>Guardar límite<//>
      <p class="nota">Inicio propuesto: 1 de noviembre del año anterior al reporte AX. Ajusta la fecha si el corte anual se retrasa o tiene prórroga. Se guarda por corte; los vales anteriores quedan fuera de las sugerencias, las asignaciones y la solicitud.</p>
      ${excluidos ? html`<p class="nota">${num(excluidos)} ${excluidos === 1 ? "vale queda" : "vales quedan"} fuera del periodo. Las asignaciones guardadas fuera del periodo se conservan para revisión y no justifican diferencias.</p>` : null}
      ${errorFecha ? html`<p class="alerta" role="alert">${errorFecha}</p>` : null}
    </div>
    <div class="controles-concilia">
      <${Segmentos} valor=${vista} opciones=${opciones} alCambiar=${setVista} />
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión…" />
      ${sugerencias.size
        ? html`<${Boton} tipo="primario" tamano="chico" onClick=${asignarTodas}>✓ Asignar las ${sugerencias.size} sugerencias<//>`
        : null}
    </div>
    ${filas.length
      ? html`<ul class="lista-justificar">
          ${filas.map((j) => html`<${ItemJustificar} key=${j.clave} j=${j} sugerencia=${sugerencias.get(j.clave)} r=${r} corte=${corte} />`)}
        </ul>`
      : html`<p class="vacio">${vista === "sugeridos" ? "No hay sugerencias: elige los vales a mano en «Faltantes»." : vista === "faltantes" ? "✓ No quedan faltantes sin explicar." : "Aún no asignas vales."}</p>`}
  <//>`;
}
