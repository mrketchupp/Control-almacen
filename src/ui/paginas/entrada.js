import { useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fechaDelDia, fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import {
  ErrorEntrada,
  corregirEntrada,
  datosParaCorregirEntrada,
  folioEntrada,
  resumenCambiosEntrada,
  validarEntrada,
} from "../../servicios/entradas.js";
import { lugarCorto } from "../../servicios/inventario.js";
import { impresionesPorVale, marcaDe } from "../../servicios/etiquetas.js";
import { bitacoraDeVale } from "../../servicios/vales.js";
import { Aviso, Boton, Dato, Insignia, Tabla, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { useMenuContextual } from "../menuContextual.js";
import { EditorEntrada } from "./entradas.js";
import { EstadoEtiquetas, EtiquetasDeEntrada } from "./etiquetas.js";
import { ListaErrores } from "./vales.js";

const ACCIONES = { EMITIR: "Registrada", CORREGIR: "Corregida", ETIQUETAS: "Etiquetas impresas" };

export function entradaDeRuta() {
  const m = /^#entrada\/(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function CorreccionEntrada({ vale, alTerminar }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState(() => datosParaCorregirEntrada(sesion.estado, vale.id));
  const [motivoPropio, setMotivoPropio] = useState(null);
  const [errores, setErrores] = useState([]);
  const cambios = useMemo(() => resumenCambiosEntrada(sesion.estado, vale, datos), [datos, vale]);
  const vivo = useMemo(() => validarEntrada(sesion.estado, datos, { excluirValeId: vale.id }), [datos, vale]);
  const { avisos } = vivo;
  // La fecha de recibido se revisa mientras se escribe (no puede ser futura ni posterior al registro); vacía, al guardar.
  const intentoRecibido = errores.some((e) => e.campo === "fecha_recibido");
  const delRecibido = vivo.errores.filter((e) => e.campo === "fecha_recibido" && (datos.fecha_recibido || intentoRecibido));
  const mostrados = [...errores.filter((e) => e.campo !== "fecha_recibido"), ...delRecibido];
  const motivo = motivoPropio ?? cambios.join("\n");
  const guardar = () =>
    sesion.tarea("Guardando corrección…", async () => {
      const faltan = [...validarEntrada(sesion.estado, datos, { excluirValeId: vale.id }).errores];
      if (!cambios.length) faltan.push({ renglon: null, campo: "vale", mensaje: "No has cambiado nada de la entrada." });
      else if (!motivo.trim()) faltan.push({ renglon: null, campo: "motivo", mensaje: "Escribe el motivo de la corrección." });
      setErrores(faltan);
      if (faltan.length) return;
      try {
        await sesion.almacen.modificar((e) => corregirEntrada(e, vale.id, datos, motivo, sesion.usuario));
        sesion.avisar("exito", `Entrada ${folioEntrada(vale.folio)} corregida. Queda en la bitácora.`);
        alTerminar();
      } catch (error) {
        if (error instanceof ErrorEntrada) setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
        else throw error;
      }
    });
  return html`<${Tarjeta} titulo=${`Corregir entrada ${folioEntrada(vale.folio)}`} clase="tarjeta-correccion">
    <${EditorEntrada}
      datos=${datos}
      alCambiar=${setDatos}
      errores=${mostrados}
      avisos=${avisos}
      excluirValeId=${vale.id}
      pie=${html`${avisos.filter((a) => a.campo === "cantidad").length
          ? html`<${Aviso} tipo="advertencia" titulo="Revisa la existencia">
              <ul>${avisos.filter((a) => a.campo === "cantidad").map((a) => html`<li>${a.mensaje}</li>`)}</ul>
            <//>`
          : null}
        <div class="campo motivo">
          <span>
            Motivo de la corrección (queda en la bitácora)
            ${motivoPropio !== null
              ? html` · <button type="button" class="enlace-boton" onClick=${() => setMotivoPropio(null)}>↺ Volver a llenarlo con los cambios</button>`
              : html` · <small class="ayuda">se llena solo con los cambios; puedes agregar el porqué</small>`}
          </span>
          <textarea
            rows=${Math.min(8, Math.max(3, motivo.split("\n").length + 1))}
            value=${motivo}
            onInput=${(e) => setMotivoPropio(e.currentTarget.value)}
            placeholder="Cambia algo de la entrada y aquí aparece qué cambió."
            aria-label="Motivo de la corrección"
          ></textarea>
        </div>
        <${ListaErrores} errores=${errores} />
        <div class="acciones-linea pie-editor">
          <${Boton} onClick=${alTerminar}>Cancelar<//>
          <span class="espaciador"></span>
          <${Boton} tipo="primario" onClick=${guardar}>Guardar corrección<//>
        </div>`}
    />
  <//>`;
}

export function PaginaEntrada() {
  const sesion = useSesion();
  const menu = useMenuContextual();
  const estado = sesion.estado;
  const id = entradaDeRuta();
  const vale = estado.vales.find((v) => v.id === id && v.tipo === "ENTRADA");
  const [corrigiendo, setCorrigiendo] = useState(() => location.hash.endsWith("/corregir") && vale?.estado === "EMITIDO");
  const [etiquetas, setEtiquetas] = useState(() => location.hash.endsWith("/etiquetas") && vale?.estado === "EMITIDO");
  const indices = useMemo(() => new Indices(estado), [estado]);
  if (!vale) return html`<${Aviso} tipo="advertencia" titulo="No se encontró la entrada">Vuelve al <a href="#historial">historial</a>.<//>`;
  const lugar = (l) => {
    if (l.existencia_id === null || l.existencia_id === undefined) return l.no_inventariado ? "Sin existencia" : "—";
    const e = indices.existencia(l.existencia_id);
    const u = e && indices.ubicacion(e.ubicacion_id);
    return u ? html`<span title=${u.hoja_excel.trim()}>${lugarCorto(u)}</span>${e.origen === `ENTRADA ${folioEntrada(vale.folio)}` ? html` <small class="nota">partida nueva</small>` : null}` : "—";
  };
  // Ronda 20: las impresiones de sus etiquetas también van en la bitácora.
  const impresas = (marcaDe(impresionesPorVale(estado), vale) ?? []).map((r) => ({ accion: "ETIQUETAS", fecha_hora: r.fecha_hora, usuario: r.usuario, etiquetas: r.etiquetas }));
  const bitacora = [...bitacoraDeVale(estado, vale.id), ...impresas].sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
  return html`
    <div class="cabeza-vale" tabindex="0" ...${menu(() => ({
      titulo: `Entrada ${folioEntrada(vale.folio)}`,
      opciones: sesion.ocupado ? [] : [
        !corrigiendo && vale.estado === "EMITIDO" && { texto: "Hacer etiquetas…", accion: () => setEtiquetas(true) },
        !corrigiendo && vale.estado === "EMITIDO" && { texto: "Corregir entrada…", accion: () => setCorrigiendo(true) },
        { texto: "Volver al historial de entradas", separador: true, accion: () => { location.hash = "#historial/entradas"; } },
      ],
    }))}>
      <div>
        <span class="folio-grande">Entrada ${folioEntrada(vale.folio)}</span>
        <${Insignia} tono="ok">REGISTRADA<//>
        ${vale.modificado_en ? html`<${Insignia}>Corregida<//>` : null}
        <${EstadoEtiquetas} estado=${estado} vale=${vale} />
      </div>
      <div class="acciones-linea">
        ${!corrigiendo ? html`<${Boton} onClick=${() => setEtiquetas(true)}>Etiquetas…<//>` : null}
        ${!corrigiendo ? html`<${Boton} onClick=${() => setCorrigiendo(true)}>Corregir<//>` : null}
        <a class="boton boton-texto" href="#historial/entradas">← Historial de entradas</a>
      </div>
    </div>
    ${etiquetas ? html`<${EtiquetasDeEntrada} valeId=${vale.id} alCerrar=${() => setEtiquetas(false)} />` : null}
    ${corrigiendo
      ? html`<${CorreccionEntrada} vale=${vale} alTerminar=${() => setCorrigiendo(false)} />`
      : html`
          <div class="datos datos-texto">
            <${Dato} etiqueta="Fecha del vale" valor=${fmtFecha(vale.fecha) || "—"} detalle="cuando la base lo envió" />
            <${Dato} etiqueta="Recibido" valor=${fmtFecha(fechaDelDia(vale)) || "—"} detalle="suma al inventario de ese día" />
            <${Dato} etiqueta="Folio del vale" valor=${vale.folio_externo || "—"} />
            <${Dato} etiqueta="Viene de" valor=${vale.origen || "—"} />
            ${vale.devolucion_folio
              ? html`<${Dato}
                  etiqueta="Partidas copiadas de"
                  valor=${html`<a href=${`#vale/${estado.vales.find((v) => v.tipo === "SALIDA" && v.folio === vale.devolucion_folio)?.id ?? ""}`}>vale de salida ${vale.devolucion_folio}</a>`}
                />`
              : null}
            <${Dato} etiqueta="Entregó" valor=${vale.entrego_nombre || "—"} detalle=${vale.entrego_puesto ?? ""} />
            <${Dato} etiqueta="Recibió" valor=${vale.recibio_nombre || "—"} detalle=${vale.recibio_puesto ?? ""} />
          </div>
          ${vale.observaciones ? html`<${Tarjeta} titulo="Observaciones"><p class="preformateado">${vale.observaciones}</p><//>` : null}
          <${Tarjeta} titulo=${`Partidas (${vale.lineas.length})`}>
            <${Tabla}
              filas=${vale.lineas}
              columnas=${[
                { clave: "renglon", titulo: "#", numero: true },
                { clave: "codigo", titulo: "Código", numero: true },
                { clave: "descripcion", titulo: "Descripción" },
                { clave: "clave", titulo: "Clave" },
                { titulo: "NP", render: (l) => (l.variante_id ? indices.variante(l.variante_id)?.np : null) || "—" },
                { titulo: "Cantidad", numero: true, render: (l) => num(aNumero(l.cantidad)) },
                { clave: "um", titulo: "UM" },
                { titulo: "O.C.", render: (l) => l.oc || "S/OC" },
                { titulo: "Solicita (lote)", render: (l) => l.lote || "—" },
                { titulo: "Entró a", render: (l) => lugar(l) },
              ]}
            />
          <//>
        `}
    <${Tarjeta} titulo="Bitácora">
      ${bitacora.length
        ? html`<ul class="bitacora">
            ${bitacora.map(
              (a) => html`<li>
                <strong>${ACCIONES[a.accion] ?? a.accion}</strong>${a.etiquetas ? ` (${a.etiquetas})` : ""} · ${fmtFechaHora(a.fecha_hora)} · ${a.usuario ?? "sin usuario"}
                ${a.accion === "CORREGIR" && a.antes?.motivo ? html`<div class="nota preformateado">${a.antes.motivo}</div>` : null}
              </li>`,
            )}
          </ul>`
        : html`<p class="nota">Sin movimientos.</p>`}
    <//>
  `;
}
