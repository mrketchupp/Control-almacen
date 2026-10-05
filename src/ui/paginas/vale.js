import { useEffect, useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import {
  ErrorVale,
  bitacoraDeVale,
  conFirmasPorPapel,
  corregirVale,
  datosParaCorregir,
  esHistorial,
  firmasExtraDe,
  partidasDuplicadas,
  plantillaArea,
  resumenCambios,
  validarVale,
} from "../../servicios/vales.js";
import { estadoAxDeVales } from "../../servicios/seguimiento.js";
import { Aviso, Boton, Dato, Insignia, Pastilla, Tabla, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { PastillaAx } from "./base.js";
import { EditorVale, ListaErrores, VistaPrevia } from "./vales.js";

const ACCIONES = { EMITIR: "Emitido", CORREGIR: "Corregido", CANCELAR: "Cancelado", UBICAR: "Ubicado" };

export function valeDeRuta() {
  const m = /^#vale\/(\d+)/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

/**
 * Corregir el vale. Con `quitar` (ids de partidas) empieza ya sin ellas: así se quitan las duplicadas
 * y el motivo dice por qué.
 */
function Correccion({ vale, alTerminar, quitar = null }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState(() => {
    const base = datosParaCorregir(sesion.estado, vale.id);
    return quitar ? { ...base, lineas: base.lineas.filter((l) => !quitar.has(l.id)) } : base;
  });
  // El motivo se llena solo con lo que cambió; si lo editas, se respeta tu texto.
  const [motivoPropio, setMotivoPropio] = useState(null);
  const [errores, setErrores] = useState([]);
  const historial = esHistorial(sesion.estado, vale);
  const cambios = useMemo(() => resumenCambios(sesion.estado, vale, datos), [datos, vale]);
  const automatico = [quitar ? "Partidas duplicadas: el formulario de Excel guardó el vale dos veces." : "", ...cambios].filter(Boolean).join("\n");
  const motivo = motivoPropio ?? automatico;
  const guardar = () =>
    sesion.tarea("Guardando corrección…", async () => {
      const faltan = [...validarVale(sesion.estado, datos, { excluirValeId: vale.id, historial }).errores];
      if (!cambios.length) faltan.push({ renglon: null, campo: "vale", mensaje: "No has cambiado nada del vale." });
      else if (!motivo.trim()) faltan.push({ renglon: null, campo: "motivo", mensaje: "Escribe el motivo de la corrección." });
      setErrores(faltan);
      if (faltan.length) return;
      try {
        await sesion.almacen.modificar((e) => corregirVale(e, vale.id, datos, motivo, sesion.usuario));
        sesion.avisar("exito", `Vale ${vale.folio} corregido. Queda en la bitácora.`);
        alTerminar();
      } catch (error) {
        if (error instanceof ErrorVale) setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
        else throw error;
      }
    });
  return html`<${Tarjeta} titulo=${`Corregir vale ${vale.folio}`} clase="tarjeta-correccion">
    ${historial
      ? html`<${Aviso} tipo="info">Este vale es anterior al conteo físico: la corrección solo cambia el historial y el DIARIO; no mueve existencias.<//>`
      : null}
    <${EditorVale}
      datos=${datos}
      alCambiar=${setDatos}
      errores=${errores}
      excluirValeId=${vale.id}
      entrego=${{ nombre: conFirmasPorPapel(sesion.estado, vale).entrego_nombre || "—", puesto: conFirmasPorPapel(sesion.estado, vale).entrego_puesto || "" }}
      pie=${html`<div class="campo motivo">
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
            placeholder="Cambia algo del vale y aquí aparece qué cambió."
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
  const estado = sesion.estado;
  const id = valeDeRuta();
  const vale = estado.vales.find((v) => v.id === id);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [previa, setPrevia] = useState(false);
  const indices = useMemo(() => new Indices(estado), [estado]);
  const ax = useMemo(() => estadoAxDeVales(estado), [estado]);
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
    <div class="cabeza-vale">
      <div>
        <span class="folio-grande">Folio ${vale.folio}</span>
        <${Insignia} tono=${cancelado ? "error" : "ok"}>${cancelado ? "CANCELADO" : vale.estado}<//>
        ${vale.migrado ? html`<${Insignia}>Migrado del Excel<//>` : null}
        ${esHistorial(estado, vale) ? html`<${Insignia}>Anterior al conteo<//>` : null}
      </div>
      <div class="acciones-linea">
        <${Boton} tipo="primario" onClick=${() => setPrevia(true)}>🖨 Imprimir<//>
        ${!cancelado && !corrigiendo ? html`<${Boton} onClick=${() => setCorrigiendo(true)}>Corregir<//>` : null}
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
      ? html`<${Correccion} vale=${vale} quitar=${corrigiendo === "duplicadas" ? new Set(duplicadas.keys()) : null} alTerminar=${() => setCorrigiendo(false)} />`
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

    <${Tarjeta} titulo="Bitácora">
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
    <//>

    ${previa ? html`<${VistaPrevia} vales=${[vale]} alCerrar=${() => setPrevia(false)} />` : null}
  `;
}
