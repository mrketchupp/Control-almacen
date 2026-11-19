import { useMemo } from "preact/hooks";
import { ErrorEscritura } from "../../almacen/archivos.js";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import { registrarEnvio, ultimoEnvio, valesPorEnviar } from "../../servicios/vales.js";
import { Boton, Tabla, Tarjeta, confirmar, useSesion } from "../componentes.js";
import { html } from "../html.js";

const MOTIVOS = { nuevo: "Nuevo", corregido: "Corregido", cancelado: "Cancelado" };

/** Tras cerrarse «Guardar como» (la ventana vuelve a tener el foco), cuánto se espera a que Edge responda. */
export const ESPERA_TRAS_DIALOGO_MS = 5000;

/**
 * La respuesta de «Guardar como», vigilada: si la ventana ya recuperó el foco (el diálogo se cerró) y Edge
 * no responde en `ms`, rechaza con ErrorEscritura 'colgado' (pasa mientras OneDrive sube archivos). Si Edge
 * responde después con el archivo, `alLlegarTarde(archivo)` lo recibe para guardar ahí de todos modos.
 */
export function vigilarDialogo(promesa, { ms = ESPERA_TRAS_DIALOGO_MS, alLlegarTarde = null } = {}) {
  return new Promise((resolver, rechazar) => {
    let vencida = false;
    let temporizador = null;
    const limpiar = () => {
      clearTimeout(temporizador);
      window.removeEventListener("focus", alFoco);
      window.removeEventListener("blur", alPerderFoco);
    };
    function alFoco() {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (!document.hasFocus()) return;
        vencida = true;
        limpiar();
        rechazar(new ErrorEscritura("Edge no respondió al guardar en esa carpeta (pasa mientras OneDrive sube archivos)", { causa: "colgado" }));
      }, ms);
    }
    function alPerderFoco() {
      clearTimeout(temporizador);
    }
    window.addEventListener("focus", alFoco);
    window.addEventListener("blur", alPerderFoco);
    Promise.resolve(promesa).then(
      (archivo) => {
        limpiar();
        if (!vencida) resolver(archivo);
        else if (archivo) alLlegarTarde?.(archivo);
      },
      (error) => {
        limpiar();
        if (!vencida) rechazar(error);
      },
    );
  });
}

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

/** Genera y guarda (archivo elegido, o Descargas) y avisa: «Listo» o la ventana con dibujos. */
function generar(sesion, tipo, archivo, opciones, alTerminar, { fallo = null, descargar = false, tardio = false } = {}) {
  return sesion.tarea("Generando Excel…", async () => {
    const resultado = await sesion.exportar(tipo, archivo, opciones, { fallo, descargar });
    if (!resultado.motivo) sesion.avisar("exito", tardio ? `Edge respondió: también quedó en ${resultado.destino}` : `Listo: ${resultado.destino}`);
    else {
      sesion.mostrarDialogo({
        tipo: "no-guardado",
        ...resultado,
        // El clic en "Guardar otra vez" abre «Guardar como» de nuevo (el navegador lo exige desde un clic).
        reintentar: () => exportarConDialogo(sesion, tipo, alTerminar, opciones),
      });
    }
    alTerminar?.(resultado);
  });
}

/**
 * Botón de completado: "ya subí el libro de vales al SharePoint". Con hastaFolio (reporte de un
 * día) solo se marcan los vales hasta ese folio; los posteriores siguen pendientes.
 */
export function BotonSubido({ pendientes, tamano = "", hastaFolio = null }) {
  const sesion = useSesion();
  const marcar = () => {
    const hasta = hastaFolio ? ` (hasta el folio ${hastaFolio})` : "";
    if (!confirmar(`¿Ya subiste al SharePoint el libro de vales${hasta} con ${pendientes} cambio(s)? Se marcarán como subidos.`)) return;
    return sesion.tarea("Guardando…", async () => {
      await sesion.almacen.modificar((e) => registrarEnvio(e, sesion.usuario, { hastaFolio }));
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
