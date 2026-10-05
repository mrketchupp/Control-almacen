// Archivo de vales de la base (Rondas 12 y 13): qué partidas ya aplicó la base en AX (IN / TR). Pastilla
// del estado en AX de una partida, importar el archivo (sin fecha: se reemplaza), y su mosaico y ventana
// en la conciliación.

import { useMemo, useState } from "preact/hooks";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { sha256 } from "../../almacen/almacen.js";
import { decTexto } from "../../nucleo/decimal.js";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import { ErrorArchivoBase, leerArchivoBase } from "../../importadores/base.js";
import {
  ESTADOS_AX,
  ErrorSeguimiento,
  estadoAxDeVales,
  etiquetaAx,
  quitarSeguimiento,
  registrarSeguimiento,
  seguimientoConHuella,
  seguimientoVigente,
  sinAplicar,
} from "../../servicios/seguimiento.js";
import { Boton, Buscador, ElegirArchivo, Pastilla, Segmentos, Tabla, Ventana, confirmar, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const TONOS_AX = { aplicada: "ok", parcial: "alerta", pendiente: "alerta", no_inv: "neutro", sin_revisar: "alerta", sin_registro: "alerta", posterior: "neutro" };

/** Estado en AX de una partida: "IN00000182", "INV sin IN / TR", "NO INV"… con los avisos en el título. */
export function PastillaAx({ info }) {
  if (!info) return html`<span class="nota">—</span>`;
  const detalle = [
    ESTADOS_AX[info.estado],
    info.mov ? info.mov.toLowerCase() : "",
    info.aplicada ? `aplicadas ${decTexto(info.aplicada)}` : "",
    info.fila?.comentario ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  return html`<span class="ax-estado">
    <${Pastilla} tono=${TONOS_AX[info.estado]} titulo=${detalle}>${etiquetaAx(info)}<//>
    ${info.avisos?.length ? html`<span class="ax-aviso" title=${info.avisos.join("\n")} aria-label=${info.avisos.join(" ")}>⚠</span>` : null}
  </span>`;
}

/** Botón para importar el archivo de la base (abre la vista previa). */
export function ImportarBase({ tipo = "secundario", etiqueta = "Importar vales de la base" }) {
  const sesion = useSesion();
  const [previa, setPrevia] = useState(null);
  const abrir = (archivo) =>
    sesion.tarea("Leyendo el archivo de la base…", async () => {
      try {
        const datos = await leerArchivoSubido(archivo);
        setPrevia({ nombre: archivo.name, leido: leerArchivoBase(datos), huella: await sha256(datos) });
      } catch (error) {
        if (error instanceof ErrorArchivoBase) sesion.avisar("error", error.message);
        else sesion.avisar("error", `No se pudo leer ${archivo.name}: ${error.message}`);
      }
    });
  return html`<${ElegirArchivo} etiqueta=${html`<${Icono} nombre="subir" tam=${16} /> ${etiqueta}`} acepta=".xlsm,.xlsx" tipo=${tipo} alElegir=${abrir} />
    ${previa ? html`<${VentanaImportarBase} previa=${previa} alCerrar=${() => setPrevia(null)} />` : null}`;
}

function VentanaImportarBase({ previa, alCerrar }) {
  const sesion = useSesion();
  const { leido } = previa;
  // Vista previa: cómo quedarían las partidas con este archivo (sin guardarlo todavía).
  const ax = useMemo(() => estadoAxDeVales(sesion.estado, { partidas: leido.partidas, ultimo_folio: leido.ultimoFolio }), [sesion.estado, leido]);
  const repetido = seguimientoConHuella(sesion.estado, previa.huella);
  const anterior = seguimientoVigente(sesion.estado);
  const importar = () =>
    sesion.tarea("Importando…", async () => {
      try {
        await sesion.almacen.modificar((e) =>
          registrarSeguimiento(e, { archivo: previa.nombre, huella: previa.huella, guardado: leido.guardado, partidas: leido.partidas, ultimoFolio: leido.ultimoFolio }, sesion.usuario),
        );
        sesion.avisar("exito", `Archivo de la base importado: ${ax.resumen.aplicada + ax.resumen.parcial} partidas ya en AX, ${ax.resumen.sin_aplicar} sin IN / TR.`);
        alCerrar();
      } catch (error) {
        if (error instanceof ErrorSeguimiento) sesion.avisar("error", error.message);
        else throw error;
      }
    });
  return html`<${Ventana} titulo="Importar vales de la base" alCerrar=${alCerrar}>
    <p>
      <strong>${previa.nombre}</strong> · hoja <code>${leido.hoja}</code> · ${leido.partidas.length} partidas hasta el folio ${leido.ultimoFolio}
      ${leido.guardado ? html`<br /><span class="nota">Excel lo guardó el ${fmtFechaHora(leido.guardado)}.</span>` : null}
    </p>
    <p class="nota">Solo importa si cada partida tiene folio de AX (IN / TR): las que no lo tienen pueden justificar faltantes.</p>
    <${ResumenAx} resumen=${ax.resumen} />
    ${repetido ? html`<p class="alerta">Este mismo archivo ya está importado.</p>` : null}
    ${anterior && !repetido ? html`<p class="nota">Reemplaza al archivo anterior (${anterior.archivo ?? "sin nombre"}, importado el ${fmtFechaHora(anterior.importado_en)}).</p>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" onClick=${importar}>Importar<//>
      <${Boton} tipo="texto" onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}

function ResumenAx({ resumen }) {
  const filas = [
    ["aplicada", "ya en AX (IN / TR)"],
    ["parcial", "aplicadas en parte (lo que falta, sin IN / TR)"],
    ["pendiente", "INV sin IN / TR"],
    ["sin_revisar", "sin revisar por la base (sin IN / TR)"],
    ["sin_registro", "no están en el archivo"],
    ["posterior", "después del último folio del archivo"],
    ["no_inv", "no se descuentan (NO INV, CONPROV…)"],
  ];
  return html`<ul class="resumen-ax">
    ${filas.map(([clave, texto]) => html`<li><${Pastilla} tono=${TONOS_AX[clave]}>${resumen[clave]}<//> ${texto}</li>`)}
    ${resumen.avisos ? html`<li><span class="ax-aviso">⚠</span> ${resumen.avisos} avisos de diferencias</li>` : null}
  </ul>`;
}

/** Mosaico de la conciliación: el archivo de la base (o cómo importarlo). */
export function MosaicoBase({ r, alAbrir }) {
  if (!r.ax) {
    return html`<section class="bento-celda mosaico-base-vacio">
      <header class="bento-cabeza">
        <span class="cabeza-icono"><${Icono} nombre="historial" tam=${18} /></span>
        <h2>Vales en la base</h2>
      </header>
      <p class="nota">Importa el archivo de vales de la base (con INV/NINV, TR e IN) para saber qué vales ya están en AX. Sin él, el tránsito se toma solo por la fecha del corte.</p>
      <${ImportarBase} />
    </section>`;
  }
  const { seguimiento, resumen } = r.ax;
  return html`<button type="button" class="bento-celda mosaico" onClick=${alAbrir}>
    <span class="bento-cabeza">
      <span class="cabeza-icono"><${Icono} nombre="historial" tam=${18} /></span>
      <span class="mosaico-titulo">Vales en la base</span>
      <span class="mosaico-abrir" aria-hidden="true">Ver ›</span>
    </span>
    <span class="dato-grande">${resumen.sin_aplicar}</span>
    <span class="nota">partidas sin IN / TR (pueden justificar faltantes) · ${resumen.aplicada + resumen.parcial} ya en AX · ${resumen.no_inv} no se descuentan${resumen.avisos ? ` · ⚠ ${resumen.avisos} avisos` : ""}</span>
    <span class="nota">${seguimiento.archivo ?? "Archivo de la base"} · hasta el folio ${seguimiento.ultimo_folio}</span>
  </button>`;
}

const VISTAS_BASE = { avisos: "Avisos de diferencias", sin_folio: "Sin IN / TR", no_inv: "No se descuentan" };

/** Ventana del archivo de la base: avisos, lo que no tiene folio de AX y lo que no se descuenta; quitar o reemplazar. */
export function VentanaBase({ r, alCerrar }) {
  const sesion = useSesion();
  const { seguimiento, porLinea, avisos } = r.ax;
  const [vista, setVista] = useState(avisos.length ? "avisos" : "sin_folio");
  const [texto, setTexto] = useState("");
  const partidas = useMemo(() => {
    const salida = [];
    for (const vale of sesion.estado.vales) {
      if (vale.tipo !== "SALIDA") continue;
      for (const l of vale.lineas) {
        const info = porLinea.get(l.id);
        if (info) salida.push({ id: l.id, vale, linea: l, info, _buscar: `${vale.folio} ${l.codigo} ${l.descripcion ?? ""} ${l.clave ?? ""} ${etiquetaAx(info)}` });
      }
    }
    return salida.sort((a, b) => b.vale.folio - a.vale.folio);
  }, [sesion.estado, porLinea]);
  const sinFolio = partidas.filter((p) => sinAplicar(p.info));
  const noInv = partidas.filter((p) => p.info.estado === "no_inv");
  const filas = useFiltroTexto(vista === "sin_folio" ? sinFolio : noInv, texto, ["_buscar"]);
  const avisosFiltrados = useFiltroTexto(
    avisos.map((a, i) => ({ ...a, id: i, _buscar: `${a.folio} ${a.codigo} ${a.texto}` })),
    texto,
    ["_buscar"],
  );
  const quitar = () => {
    if (!confirmar("¿Quitar el archivo de la base? La conciliación vuelve a tomar el tránsito solo por la fecha del corte.")) return;
    return sesion.tarea("Quitando…", async () => {
      await sesion.almacen.modificar((e) => quitarSeguimiento(e, seguimiento.id, sesion.usuario));
      alCerrar();
    });
  };
  const cuantas = { avisos: avisos.length, sin_folio: sinFolio.length, no_inv: noInv.length };
  const opciones = Object.fromEntries(Object.entries(VISTAS_BASE).map(([k, v]) => [k, `${v} (${cuantas[k]})`]));
  return html`<${Ventana} titulo="Vales en la base" clase="ventana-concilia" alCerrar=${alCerrar}>
    <p class="nota">
      Las salidas <strong>sin folio IN / TR</strong> cuentan como tránsito en la conciliación aunque el vale sea anterior al corte (AX aún
      no las descuenta); las que tienen folio ya están en AX y no justifican diferencias, igual que las NO INV / CONPROV. Lo posterior
      al corte de AX siempre cuenta: el reporte es una foto de ese día.
    </p>
    <div class="controles-concilia">
      <${Segmentos} valor=${vista} opciones=${opciones} alCambiar=${setVista} />
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Folio, código, clave, IN / TR…" />
    </div>
    ${vista === "avisos"
      ? html`<${Tabla}
          limite=${200}
          filas=${avisosFiltrados}
          vacia="Sin diferencias entre el archivo de la base y los vales."
          columnas=${[
            { titulo: "Folio", numero: true, render: (a) => (a.vale_id ? html`<a class="enlace-folio" href=${`#vale/${a.vale_id}`}>${a.folio}</a>` : a.folio) },
            { titulo: "Código", numero: true, render: (a) => a.codigo },
            { titulo: "Aviso", render: (a) => a.texto },
          ]}
        />`
      : html`<${Tabla}
          limite=${200}
          filas=${filas}
          vacia=${vista === "sin_folio" ? "Todas las partidas tienen folio de AX." : "Nada marcado como NO INV."}
          columnas=${[
            { titulo: "Folio", numero: true, render: (p) => html`<a class="enlace-folio" href=${`#vale/${p.vale.id}`}>${p.vale.folio}</a>` },
            { titulo: "Fecha", render: (p) => fmtFecha(p.vale.fecha) },
            { titulo: "Código", numero: true, render: (p) => p.linea.codigo },
            { titulo: "Descripción", render: (p) => p.linea.descripcion },
            { titulo: "Clave", render: (p) => p.linea.clave },
            { titulo: vista === "sin_folio" ? "Sin aplicar" : "Cant.", numero: true, render: (p) => (p.info.estado === "parcial" ? `${decTexto(p.info.pendiente)} de ${p.linea.cantidad}` : p.linea.cantidad) },
            { titulo: "En la base", render: (p) => html`<${PastillaAx} info=${p.info} />` },
          ]}
        />`}
    <div class="archivo-base">
      <span class="nota">
        <strong>${seguimiento.archivo ?? "Archivo de la base"}</strong> · hasta el folio ${seguimiento.ultimo_folio} · importado el ${fmtFechaHora(seguimiento.importado_en)}
        ${seguimiento.guardado ? ` · Excel lo guardó el ${fmtFechaHora(seguimiento.guardado)}` : ""}
      </span>
      <${ImportarBase} etiqueta="Importar uno nuevo (reemplaza a este)" />
      <${Boton} tipo="peligro-texto" tamano="chico" onClick=${quitar}>Quitar<//>
    </div>
  <//>`;
}
