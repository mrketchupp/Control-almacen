// Archivo de vales de la base (Ronda 12): qué partidas ya aplicó la base en AX (IN / TR). Pastilla del
// estado en AX de una partida, importar el archivo, y su mosaico y ventana en la conciliación.

import { useMemo, useState } from "preact/hooks";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { sha256 } from "../../almacen/almacen.js";
import { decTexto } from "../../nucleo/decimal.js";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { ErrorArchivoBase, leerArchivoBase } from "../../importadores/base.js";
import { ESTADOS_AX, ErrorSeguimiento, estadoAxDeVales, etiquetaAx, quitarSeguimiento, registrarSeguimiento, seguimientoConHuella } from "../../servicios/seguimiento.js";
import { Boton, Buscador, ElegirArchivo, Pastilla, Segmentos, Tabla, Ventana, confirmar, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";

const TONOS_AX = { aplicada: "ok", parcial: "alerta", pendiente: "alerta", no_inv: "neutro", sin_revisar: "neutro", sin_registro: "alerta" };

/** Estado en AX de una partida: "IN00000182", "Pendiente en AX", "NO INV"… con los avisos en el título. */
export function PastillaAx({ info }) {
  if (!info) return html`<span class="nota" title="Posterior al último folio del archivo de la base">—</span>`;
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
        setPrevia({ nombre: archivo.name, leido: leerArchivoBase(datos, archivo.name), huella: await sha256(datos) });
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
  const [fecha, setFecha] = useState(leido.fechaSugerida ?? hoyIso());
  // Vista previa: cómo quedarían las partidas con este archivo (sin guardarlo todavía).
  const ax = useMemo(() => estadoAxDeVales(sesion.estado, { partidas: leido.partidas, ultimo_folio: leido.ultimoFolio }), [sesion.estado, leido]);
  const repetido = seguimientoConHuella(sesion.estado, previa.huella);
  const mismoDia = (sesion.estado.seguimientos_base ?? []).find((x) => x.fecha === fecha);
  const importar = () =>
    sesion.tarea("Importando…", async () => {
      try {
        await sesion.almacen.modificar((e) =>
          registrarSeguimiento(e, { fecha, archivo: previa.nombre, huella: previa.huella, partidas: leido.partidas, ultimoFolio: leido.ultimoFolio }, sesion.usuario),
        );
        sesion.avisar("exito", `Archivo de la base al ${fmtFecha(fecha)} importado: ${ax.resumen.aplicada + ax.resumen.parcial} partidas ya en AX, ${ax.resumen.pendiente + ax.resumen.parcial} pendientes.`);
        alCerrar();
      } catch (error) {
        if (error instanceof ErrorSeguimiento) sesion.avisar("error", error.message);
        else throw error;
      }
    });
  return html`<${Ventana} titulo="Importar vales de la base" alCerrar=${alCerrar}>
    <p><strong>${previa.nombre}</strong> · hoja <code>${leido.hoja}</code> · ${leido.partidas.length} partidas hasta el folio ${leido.ultimoFolio}</p>
    <label class="campo">
      <span>¿De qué día es lo que dice la base?</span>
      <input type="date" value=${fecha} max=${hoyIso()} onChange=${(e) => setFecha(e.currentTarget.value)} />
      <small class="ayuda">
        ${leido.guardado ? html`Excel lo guardó por última vez el ${fmtFechaHora(leido.guardado)}. ` : ""}Lo que la base aplicó después de ese día no aparece.
      </small>
    </label>
    <${ResumenAx} resumen=${ax.resumen} />
    ${repetido ? html`<p class="alerta">Este mismo archivo ya se importó (al ${fmtFecha(repetido.fecha)}).</p>` : null}
    ${mismoDia && !repetido ? html`<p class="nota">Reemplaza al archivo que ya tenías del ${fmtFecha(fecha)} (${mismoDia.archivo ?? "sin nombre"}).</p>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!fecha} onClick=${importar}>Importar<//>
      <${Boton} tipo="texto" onClick=${alCerrar}>Cancelar<//>
    </div>
  <//>`;
}

function ResumenAx({ resumen }) {
  const filas = [
    ["aplicada", "ya en AX (IN / TR)"],
    ["parcial", "aplicadas en parte"],
    ["pendiente", "pendientes en AX"],
    ["no_inv", "no se descuentan (NO INV, CONPROV…)"],
    ["sin_revisar", "sin revisar por la base"],
    ["sin_registro", "no están en el archivo"],
  ];
  return html`<ul class="resumen-ax">
    ${filas.map(([clave, texto]) => html`<li><${Pastilla} tono=${TONOS_AX[clave]}>${resumen[clave]}<//> ${texto}</li>`)}
    ${resumen.avisos ? html`<li><span class="ax-aviso">⚠</span> ${resumen.avisos} avisos de diferencias</li>` : null}
  </ul>`;
}

/** Qué se ve mal cuando el archivo de la base y el reporte de AX son de días distintos. */
export function avisoFechas(base, ax) {
  return base < ax
    ? `La base es del ${fmtFecha(base)} y AX del ${fmtFecha(ax)}: lo que la base aplicó entre esas fechas sigue contando como pendiente. Pide el archivo de la base del ${fmtFecha(ax)}.`
    : `La base es del ${fmtFecha(base)} y AX del ${fmtFecha(ax)}: lo que la base aplicó después del ${fmtFecha(ax)} ya no cuenta como tránsito, aunque el reporte de AX aún no lo traiga.`;
}

/** Mosaico de la conciliación: el archivo de la base para este corte (o cómo importarlo). */
export function MosaicoBase({ r, corte, alAbrir }) {
  if (!r.ax) {
    return html`<section class="bento-celda mosaico-base-vacio">
      <header class="bento-cabeza">
        <span class="cabeza-icono"><${Icono} nombre="historial" tam=${18} /></span>
        <h2>Vales en la base</h2>
      </header>
      <p class="nota">Importa el archivo de vales de la base (con INV/NINV, TR e IN) para saber qué vales ya están en AX. Sin él, el tránsito se toma por la fecha del corte.</p>
      <${ImportarBase} />
    </section>`;
  }
  const { seguimiento, resumen } = r.ax;
  const pendientes = resumen.pendiente + resumen.parcial;
  const otraFecha = seguimiento.fecha !== corte.fecha;
  return html`<button type="button" class=${`bento-celda mosaico ${otraFecha ? "mosaico-atencion" : ""}`} onClick=${alAbrir}>
    <span class="bento-cabeza">
      <span class="cabeza-icono"><${Icono} nombre="historial" tam=${18} /></span>
      <span class="mosaico-titulo">Vales en la base</span>
      <span class="mosaico-abrir" aria-hidden="true">Ver ›</span>
    </span>
    <span class="dato-grande">${pendientes}</span>
    <span class="nota">partidas pendientes en AX · ${resumen.aplicada + resumen.parcial} ya aplicadas · ${resumen.no_inv} no se descuentan${resumen.avisos ? ` · ⚠ ${resumen.avisos} avisos` : ""}</span>
    <span class="nota">Archivo al ${fmtFecha(seguimiento.fecha)} · hasta el folio ${seguimiento.ultimo_folio}</span>
    ${otraFecha ? html`<span class="ax-fechas">${avisoFechas(seguimiento.fecha, corte.fecha)}</span>` : null}
  </button>`;
}

const VISTAS_BASE = { avisos: "Avisos de diferencias", pendientes: "Pendientes en AX", no_inv: "No se descuentan" };

/** Ventana del archivo de la base: avisos, pendientes y lo que no se descuenta; quitar o reemplazar el archivo. */
export function VentanaBase({ r, alCerrar }) {
  const sesion = useSesion();
  const { seguimiento, porLinea, avisos } = r.ax;
  const archivos = [...(sesion.estado.seguimientos_base ?? [])].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  const [vista, setVista] = useState(avisos.length ? "avisos" : "pendientes");
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
  const deVista = vista === "pendientes" ? partidas.filter((p) => p.info.estado === "pendiente" || p.info.estado === "parcial") : partidas.filter((p) => p.info.estado === "no_inv");
  const filas = useFiltroTexto(deVista, texto, ["_buscar"]);
  const avisosFiltrados = useFiltroTexto(
    avisos.map((a, i) => ({ ...a, id: i, _buscar: `${a.folio} ${a.codigo} ${a.texto}` })),
    texto,
    ["_buscar"],
  );
  const quitar = (x) => {
    if (!confirmar(`¿Quitar el archivo de la base del ${fmtFecha(x.fecha)}?${archivos.length === 1 ? " La conciliación vuelve a tomar el tránsito solo por la fecha del corte." : ""}`)) return;
    return sesion.tarea("Quitando…", async () => {
      await sesion.almacen.modificar((e) => quitarSeguimiento(e, x.id, sesion.usuario));
      if (archivos.length === 1) alCerrar();
    });
  };
  const opciones = Object.fromEntries(Object.entries(VISTAS_BASE).map(([k, v]) => [k, `${v} (${k === "avisos" ? avisos.length : k === "pendientes" ? partidas.filter((p) => p.info.estado === "pendiente" || p.info.estado === "parcial").length : partidas.filter((p) => p.info.estado === "no_inv").length})`]));
  return html`<${Ventana} titulo="Vales en la base" clase="ventana-concilia" alCerrar=${alCerrar}>
    <p class="nota">
      <strong>${seguimiento.archivo ?? "Archivo de la base"}</strong> al ${fmtFecha(seguimiento.fecha)} · hasta el folio ${seguimiento.ultimo_folio}. Las partidas
      pendientes en AX cuentan como tránsito en la conciliación aunque el vale sea anterior al corte; las que no se descuentan
      (NO INV, CONPROV) no justifican diferencias.
    </p>
    ${seguimiento.fecha !== r.corte.fecha ? html`<p class="ax-fechas">${avisoFechas(seguimiento.fecha, r.corte.fecha)}</p>` : null}
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
          vacia=${vista === "pendientes" ? "La base ya aplicó todo lo que revisó." : "Nada marcado como NO INV."}
          columnas=${[
            { titulo: "Folio", numero: true, render: (p) => html`<a class="enlace-folio" href=${`#vale/${p.vale.id}`}>${p.vale.folio}</a>` },
            { titulo: "Fecha", render: (p) => fmtFecha(p.vale.fecha) },
            { titulo: "Código", numero: true, render: (p) => p.linea.codigo },
            { titulo: "Descripción", render: (p) => p.linea.descripcion },
            { titulo: "Clave", render: (p) => p.linea.clave },
            { titulo: vista === "pendientes" ? "Pendiente" : "Cant.", numero: true, render: (p) => (p.info.estado === "parcial" ? `${decTexto(p.info.pendiente)} de ${p.linea.cantidad}` : p.linea.cantidad) },
            { titulo: "En la base", render: (p) => html`<${PastillaAx} info=${p.info} />` },
          ]}
        />`}
    <section class="archivos-base">
      <h3>Archivos de la base guardados</h3>
      <ul>
        ${archivos.map(
          (x) => html`<li key=${x.id}>
            <span><strong>${fmtFecha(x.fecha)}</strong> · ${x.archivo ?? "sin nombre"} · hasta el folio ${x.ultimo_folio}</span>
            ${x.id === seguimiento.id ? html`<${Pastilla} tono="info">con este corte<//>` : null}
            <${Boton} tipo="peligro-texto" tamano="chico" onClick=${() => quitar(x)}>Quitar<//>
          </li>`,
        )}
      </ul>
      <p class="nota">Con cada corte de AX se usa el archivo de la fecha más cercana; el historial y los vales muestran el más reciente.</p>
      <${ImportarBase} etiqueta="Importar otro archivo" />
    </section>
  <//>`;
}
