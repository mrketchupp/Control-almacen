import { useEffect, useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import {
  bitacoraDeVale,
  conFirmasPorPapel,
  esHistorial,
  firmasExtraDe,
  partidasDuplicadas,
  plantillaArea,
} from "../../servicios/vales.js";
import { estadoAxDeVales } from "../../servicios/seguimiento.js";
import { Aviso, Boton, Dato, Insignia, Pastilla, Tabla, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { useMenuContextual } from "../menuContextual.js";
import { PastillaAx } from "./base.js";
import { VistaPrevia } from "./vales.js";
import { CorreccionSalida } from "./correccion.js";
import { useSalidaDesdeVale } from "./copiarVale.js";
import { Icono } from "../iconos.js";

const ACCIONES = { EMITIR: "Emitido", CORREGIR: "Corregido", CANCELAR: "Cancelado", UBICAR: "Ubicado" };

export function valeDeRuta() {
  const m = /^#vale\/(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function FotosDelVale({ fotos }) {
  const sesion = useSesion();
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    let vivo = true;
    Promise.all(fotos.map((c) => (c ? sesion.urlFoto(c) : null))).then((u) => vivo && setUrls(u));
    return () => {
      vivo = false;
    };
  }, [fotos.join("|")]);
  return html`<${Tarjeta} titulo=${`Fotos (${fotos.filter(Boolean).length})`}>
    <div class="fotos-detalle">
      ${fotos.map((c, i) => (c ? html`<figure><img src=${urls[i] ?? ""} alt=${`Foto ${i + 1}`} /><figcaption>Foto ${i + 1}</figcaption></figure>` : null))}
    </div>
  <//>`;
}

export function PaginaVale() {
  const sesion = useSesion();
  const menu = useMenuContextual();
  const estado = sesion.estado;
  const id = valeDeRuta();
  const vale = estado.vales.find((v) => v.id === id);
  const [corrigiendo, setCorrigiendo] = useState(() => location.hash.endsWith("/corregir") && vale?.estado === "EMITIDO");
  const [previa, setPrevia] = useState(false);
  const indices = useMemo(() => new Indices(estado), [estado]);
  const ax = useMemo(() => estadoAxDeVales(estado), [estado]);
  const aSalida = useSalidaDesdeVale();
  if (!vale) return html`<${Aviso} tipo="advertencia" titulo="No se encontró el vale">Vuelve al <a href="#historial">historial</a>.<//>`;

  const area = plantillaArea(estado, vale.plantilla_area_id);
  const cancelado = vale.estado === "CANCELADO";
  const lugar = (l) => {
    if (l.existencia_id === null || l.existencia_id === undefined) return l.no_inventariado ? "No inventariado" : esHistorial(estado, vale) ? "—" : "Por ubicar";
    const e = indices.existencia(l.existencia_id);
    const u = e && indices.ubicacion(e.ubicacion_id);
    return u ? u.hoja_excel.trim() : "—";
  };
  const extras = firmasExtraDe(estado, vale);
  const firmas = conFirmasPorPapel(estado, vale);
  const bitacora = bitacoraDeVale(estado, vale.id).reverse();
  const duplicadas = partidasDuplicadas(vale);

  return html`
    <div class="cabeza-vale" tabindex="0" ...${menu(() => ({
      titulo: `Vale de salida ${vale.folio}`,
      opciones: sesion.ocupado ? [] : [
        !corrigiendo && { texto: "Vista previa e imprimir…", accion: () => setPrevia(true) },
        !cancelado && !corrigiendo && { texto: "Corregir vale…", accion: () => setCorrigiendo(true) },
        !cancelado && !corrigiendo && { texto: "Copiar a un vale nuevo", accion: () => aSalida(vale.id) },
        { texto: "Volver al historial", separador: true, accion: () => { location.hash = "#historial"; } },
      ],
    }))}>
      <div>
        <span class="folio-grande">Folio ${vale.folio}</span>
        <${Insignia} tono=${cancelado ? "error" : "ok"}>${cancelado ? "CANCELADO" : vale.estado}<//>
        ${vale.migrado ? html`<${Insignia}>Migrado del Excel<//>` : null}
        ${esHistorial(estado, vale) ? html`<${Insignia}>Anterior al conteo<//>` : null}
      </div>
      <div class="acciones-linea">
        ${corrigiendo ? null : html`<${Boton} tipo="primario" onClick=${() => setPrevia(true)}>🖨 Imprimir<//>`}
        ${!cancelado && !corrigiendo ? html`<${Boton} onClick=${() => setCorrigiendo(true)}>Corregir<//>` : null}
        ${!cancelado && !corrigiendo
          ? html`<${Boton} onClick=${() => aSalida(vale.id)} disabled=${Boolean(sesion.ocupado)} title="Un borrador nuevo con estas partidas, la misma área y quién recibe">
              <${Icono} nombre="copiar" /> Copiar a un vale nuevo
            <//>`
          : null}
        <a class="boton boton-texto" href="#historial">← Historial</a>
      </div>
    </div>
    ${cancelado ? html`<${Aviso} tipo="error" titulo="Vale cancelado (versión anterior de la herramienta)">${fmtFechaHora(vale.cancelado_en)} · ${vale.motivo_cancelacion}<//>` : null}

    ${!cancelado && !corrigiendo && duplicadas.size
      ? html`<${Aviso} tipo="advertencia" titulo=${duplicadas.size === 1 ? "1 partida parece duplicada" : `${duplicadas.size} partidas parecen duplicadas`}>
          Tienen el mismo código, clave y cantidad que otra partida de este vale (el formulario de Excel a veces guardaba el vale dos veces).
          <div class="acciones-linea"><${Boton} tamano="chico" onClick=${() => setCorrigiendo("duplicadas")}>Quitar duplicadas…<//></div>
        <//>`
      : null}
    ${corrigiendo
      ? html`<${CorreccionSalida} vale=${vale} quitar=${corrigiendo === "duplicadas" ? new Set(duplicadas.keys()) : null} alTerminar=${() => setCorrigiendo(false)} />`
      : html`
          <div class="datos datos-texto">
            <${Dato} etiqueta="Fecha" valor=${fmtFecha(vale.fecha)} />
            <${Dato} etiqueta="Área" valor=${area?.nombre ?? "—"} detalle=${vale.naturaleza ?? ""} />
            <${Dato} etiqueta="Origen" valor=${vale.depto_origen || "—"} detalle=${vale.origen ?? ""} />
            <${Dato} etiqueta="Destino" valor=${vale.depto_destino || "—"} detalle=${vale.destino ?? ""} />
            <${Dato} etiqueta="Entregó" valor=${firmas.entrego_nombre || "—"} detalle=${firmas.entrego_puesto ?? ""} />
            <${Dato} etiqueta="Recibió" valor=${firmas.recibio_nombre || "—"} detalle=${firmas.recibio_puesto ?? ""} />
            ${vale.autorizo_nombre ? html`<${Dato} etiqueta="Autorizó" valor=${vale.autorizo_nombre} detalle=${vale.autorizo_puesto ?? ""} />` : null}
            ${extras && vale.firma_extra_izq_nombre ? html`<${Dato} etiqueta=${extras.izq} valor=${vale.firma_extra_izq_nombre} detalle=${vale.firma_extra_izq_puesto ?? ""} />` : null}
            ${extras && vale.firma_extra_der_nombre ? html`<${Dato} etiqueta=${extras.der} valor=${vale.firma_extra_der_nombre} detalle=${vale.firma_extra_der_puesto ?? ""} />` : null}
          </div>
          ${(vale.fotos ?? []).some(Boolean) ? html`<${FotosDelVale} fotos=${vale.fotos} />` : null}
          ${vale.observaciones ? html`<${Tarjeta} titulo="Observaciones"><p class="preformateado">${vale.observaciones}</p><//>` : null}
          <${Tarjeta} titulo=${`Partidas (${vale.lineas.length})`}>
            <${Tabla}
              filas=${vale.lineas}
              columnas=${[
                { clave: "renglon", titulo: "#", numero: true },
                { clave: "codigo", titulo: "Código", numero: true },
                { clave: "descripcion", titulo: "Descripción" },
                { clave: "clave", titulo: "Clave" },
                { titulo: "Cantidad", numero: true, render: (l) => num(aNumero(l.cantidad)) },
                { clave: "um", titulo: "UM" },
                { titulo: "O.C.", render: (l) => l.oc || "S/OC" },
                { clave: "lote", titulo: "Lote" },
                { titulo: "Salió de", render: (l) => lugar(l) },
                ...(ax && vale.tipo === "SALIDA" && !cancelado ? [{ titulo: "AX (base)", render: (l) => html`<${PastillaAx} info=${ax.porLinea.get(l.id)} />` }] : []),
                {
                  titulo: "Notas",
                  render: (l) => html`${duplicadas.has(l.id) ? html`<${Pastilla} tono="alerta" titulo="Mismo código, clave y cantidad">duplicada de la ${duplicadas.get(l.id)}<//> ` : ""}${[
                    l.justificacion && `Justificación: ${l.justificacion}`,
                    l.notas,
                  ]
                    .filter(Boolean)
                    .join(" · ")}`,
                },
              ]}
            />
          <//>
        `}

    ${corrigiendo ? null : html`<${Tarjeta} titulo="Bitácora">
      ${bitacora.length
        ? html`<ul class="bitacora">
            ${bitacora.map(
              (a) => html`<li>
                <strong>${ACCIONES[a.accion] ?? a.accion}</strong> · ${fmtFechaHora(a.fecha_hora)} · ${a.usuario ?? "sin usuario"}
                ${a.accion === "CORREGIR" && a.antes?.motivo ? html`<div class="nota preformateado">${a.antes.motivo}</div>` : null}
                ${a.accion === "CANCELAR" ? html`<div class="nota">Motivo: ${a.despues?.motivo}</div>` : null}
              </li>`,
            )}
          </ul>`
        : html`<p class="nota">${vale.migrado ? "Vale migrado del Excel en la primera carga; sin cambios desde entonces." : "Sin movimientos."}</p>`}
    <//>`}

    ${previa ? html`<${VistaPrevia} vales=${[vale]} alCerrar=${() => setPrevia(false)} />` : null}
  `;
}
