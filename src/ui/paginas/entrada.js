import { useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fechaDelDia, fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { lugarCorto } from "../../servicios/inventario.js";
import { impresionesPorVale, marcaDe } from "../../servicios/etiquetas.js";
import { bitacoraDeVale } from "../../servicios/vales.js";
import { Aviso, Boton, Dato, Insignia, Tabla, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { useMenuContextual } from "../menuContextual.js";
import { CorreccionEntrada } from "./correccion.js";
import { EstadoEtiquetas, EtiquetasDeEntrada } from "./etiquetas.js";
import { useSalidaDesdeVale } from "./copiarVale.js";
import { Icono } from "../iconos.js";

const ACCIONES = { EMITIR: "Registrada", CORREGIR: "Corregida", ETIQUETAS: "Etiquetas impresas" };

export function entradaDeRuta() {
  const m = /^#entrada\/(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : null;
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
  const aSalida = useSalidaDesdeVale();
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
        !corrigiendo && vale.estado === "EMITIDO" && { texto: "Hacer vale de salida con estas partidas", accion: () => aSalida(vale.id) },
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
        ${!corrigiendo && vale.estado === "EMITIDO"
          ? html`<${Boton} onClick=${() => aSalida(vale.id)} disabled=${Boolean(sesion.ocupado)} title="Material que se entregó tal como llegó: un borrador de salida con estas partidas, de la misma partida del inventario">
              <${Icono} nombre="salida" /> Vale de salida
            <//>`
          : null}
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
    ${corrigiendo ? null : html`<${Tarjeta} titulo="Bitácora">
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
    <//>`}
  `;
}
