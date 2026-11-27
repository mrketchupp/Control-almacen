import { useMemo } from "preact/hooks";
import { vigilarDialogo } from "../../almacen/archivos.js";

export { ESPERA_TRAS_DIALOGO_MS, vigilarDialogo } from "../../almacen/archivos.js";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { registrarEnvio, ultimoEnvio, valesPorEnviar } from "../../servicios/vales.js";
import { Boton, Tabla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";

const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };

/**
 * Exporta un libro: primero "Guardar como" (tiene que abrirse directo desde el clic), luego se
 * genera el archivo. tipo: 'VALES' | 'INVENTARIO' | 'ENTRADAS' | 'AJUSTE'. opciones: { corte }
 * (AAAA-MM-DD, el libro al cierre de ese día) o { corteAx, todos } (solicitud de ajuste).
 * alTerminar recibe { nombre, destino, elegido, motivo, causa } (ver Sesion.exportar). Nunca termina en
 * silencio: si «Guardar como» se cierra sin archivo, un aviso ofrece guardarlo en Descargas; si no quedó
 * donde se eligió, se explica con dibujos en una ventana al centro (AvisoNoGuardado) que permite reintentar.
 */
const enCurso = new Set();

export async function exportarConDialogo(sesion, tipo, alTerminar = null, opciones = {}) {
  const clave = `${tipo}|${opciones.corte ?? ""}|${opciones.corteAx ?? ""}`;
  if (enCurso.has(clave)) return; // doble clic: ya se está generando
  let archivo;
  let fallo = null;
  try {
    archivo = await vigilarDialogo(sesion.elegirDestinoExportacion(tipo, opciones), {
      // Edge respondió tarde (ya se guardó en Descargas): también se guarda donde se eligió.
      alLlegarTarde: (tardio) => generar(sesion, tipo, tardio, opciones, alTerminar, { tardio: true }),
    });
  } catch (error) {
    // Se eligió dónde guardar, pero Windows no dejó crear o reemplazar ese archivo (casi siempre está
    // abierto en Excel) o Edge no respondió: el Excel se genera igual y queda en Descargas.
    console.warn(error);
    fallo = error;
    archivo = undefined;
  }
  if (archivo === null) {
    // Se cerró sin archivo: el usuario canceló o Edge no pudo usar la carpeta (y responde igual que al
    // cancelar). Que no quede en silencio: se puede guardar en Descargas con un clic.
    const nombre = sesion.almacen.nombreExportacion(tipo, opciones.corte ?? hoyIso(), opciones);
    sesion.avisar("info", `No se guardó${nombre ? ` «${nombre}»` : " el Excel"}.`, 12000, {
      etiqueta: "Guardar en Descargas",
      ocupado: "Generando Excel…",
      alHacer: () => generar(sesion, tipo, undefined, opciones, alTerminar, { descargar: true }),
    });
    return;
  }
  enCurso.add(clave);
  try {
    await generar(sesion, tipo, archivo, opciones, alTerminar, { fallo });
  } finally {
    enCurso.delete(clave);
  }
}

/** "INVENTARIO DIARIO/ALMACEN DLTA/…/archivo.xlsx" → "INVENTARIO DIARIO › ALMACEN DLTA › …" (la carpeta, sin el archivo). */
export function carpetaLegible(destino) {
  const partes = String(destino ?? "").split("/").filter(Boolean);
  return partes.length > 1 ? partes.slice(0, -1).join(" › ") : partes.join("");
}

/** El aviso de «Listo»: dónde quedó y, si se creó, la carpeta nueva del mes o del año. */
export function textoListo(resultado, { tardio = false } = {}) {
  if (tardio) return `Edge respondió: también quedó en ${resultado.destino}`;
  const nuevas = resultado.nuevas?.length ? ` (carpeta nueva: ${resultado.nuevas.join(" › ")})` : "";
  return resultado.enSuCarpeta ? `Listo: «${resultado.nombre}» en ${carpetaLegible(resultado.destino)}${nuevas}` : `Listo: ${resultado.destino}`;
}

/**
 * Genera y guarda (archivo elegido, su carpeta del reporte o Descargas) y avisa: «Listo» o la ventana con
 * dibujos. `enCarpeta` (Ronda 30): directo a la carpeta fijada (ver Sesion.exportar); `reintentar`: qué hace
 * «Guardar otra vez» (por omisión, abrir «Guardar como»).
 */
export function generar(sesion, tipo, archivo, opciones, alTerminar, { fallo = null, descargar = false, tardio = false, enCarpeta = null, reintentar = null } = {}) {
  return sesion.tarea("Generando Excel…", async () => {
    const resultado = await sesion.exportar(tipo, archivo, opciones, { fallo, descargar, enCarpeta });
    if (!resultado.motivo) sesion.avisar("exito", textoListo(resultado, { tardio }));
    else {
      sesion.mostrarDialogo({
        tipo: "no-guardado",
        ...resultado,
        // El clic en "Guardar otra vez" vuelve a intentarlo (el navegador exige un clic para «Guardar como» y permisos).
        reintentar: reintentar ?? (() => exportarConDialogo(sesion, tipo, alTerminar, opciones)),
      });
    }
    alTerminar?.(resultado);
  });
}

/**
 * Botón de completado: "ya subí el libro de vales al SharePoint". Con hastaFolio y hastaFecha (reporte de un
 * día) solo se marcan los vales que van en ese libro (hasta ese día); los demás siguen pendientes.
 */
export function BotonSubido({ pendientes, tamano = "", hastaFolio = null, hastaFecha = null }) {
  const sesion = useSesion();
  const marcar = () => {
    const hasta = hastaFolio ? ` (hasta el folio ${hastaFolio})` : "";
    if (!confirmar(`¿Ya subiste al SharePoint el libro de vales${hasta} con ${pendientes} cambio(s)? Se marcarán como subidos.`)) return;
    return sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => registrarEnvio(e, sesion.usuario, { hastaFolio, hastaFecha }));
      sesion.avisar("exito", "Listo: marcado como subido al SharePoint.");
    });
  };
  return html`<${Boton} tipo="primario" tamano=${tamano} onClick=${marcar}>✓ Ya lo subí<//>`;
}

/**
 * Vales nuevos o corregidos desde la última vez que se subió el libro al SharePoint (RF-21).
 * compacto: versión para el inicio (folios en pastillas y los dos botones).
 */
export function SubirSharePoint({ compacto = false }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const pendientes = useMemo(() => valesPorEnviar(estado), [estado]);
  const ultimo = ultimoEnvio(estado);
  const ultimoTexto = ultimo ? `Última vez: ${fmtFechaHora(ultimo.fecha_hora)}${ultimo.usuario ? ` · ${ultimo.usuario}` : ""}.` : "Aún no se ha marcado ninguna subida.";
  if (compacto) {
    return html`<div class="sharepoint-compacto">
      ${pendientes.length
        ? html`<div class="folios-pendientes">
              ${pendientes.slice(0, 12).map(
                (p) => html`<a class=${`chip-folio chip-${p.motivo}`} href=${`#vale/${p.vale.id}`} title=${MOTIVOS[p.motivo]}>${p.vale.folio}</a>`,
              )}
              ${pendientes.length > 12 ? html`<span class="nota">y ${pendientes.length - 12} más</span>` : null}
            </div>
            <div class="acciones-linea">
              <${Boton} onClick=${() => exportarConDialogo(sesion, "VALES")}>⬇ Libro de vales<//>
              <${BotonSubido} pendientes=${pendientes.length} />
            </div>`
        : html`<p class="ok">✓ Todo está subido.</p>`}
      <p class="nota">${ultimoTexto}</p>
    </div>`;
  }
  return html`<${Tarjeta} titulo=${`Por subir al SharePoint (${pendientes.length})`}>
    <p class="nota">${ultimoTexto} Aquí aparecen los vales nuevos o corregidos desde entonces, para avisarle a la base qué cambió.</p>
    ${pendientes.length
      ? html`<${Tabla}
            filas=${pendientes.map((p) => ({ id: p.vale.id, folio: p.vale.folio, fecha: fmtFecha(p.vale.fecha), destino: p.vale.depto_destino ?? "", motivo: MOTIVOS[p.motivo] }))}
            columnas=${[
              { titulo: "Folio", numero: true, render: (f) => html`<a class="enlace-folio" href=${`#vale/${f.id}`}>${f.folio}</a>` },
              { clave: "fecha", titulo: "Fecha" },
              { clave: "destino", titulo: "Área" },
              { clave: "motivo", titulo: "Cambio" },
            ]}
          />
          <div class="acciones-linea"><${BotonSubido} pendientes=${pendientes.length} /></div>`
      : html`<p class="ok">✓ Todo está subido.</p>`}
  <//>`;
}
