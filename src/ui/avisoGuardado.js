// Ventana al centro cuando un Excel no quedó donde se eligió en «Guardar como»: con dibujos en lugar de
// párrafos (Ronda 27). 1) la barra de tareas con Excel abierto: hay que cerrarlo; 2) el explorador con
// la carpeta donde sí quedó; 3) un botón grande para cerrar el aviso (y otro para volver a intentarlo).

import { Ventana, useSesion } from "./componentes.js";
import { html } from "./html.js";
import { Icono } from "./iconos.js";
import { BarraDeTareas, Explorador, ubicacionDe } from "./ilustraciones.js";

/** Qué decir en el paso 1 según la causa (causaDeError en almacen/archivos.js). */
export const CAUSAS = {
  abierto: { titulo: "Ciérralo en Excel", detalle: "Windows no deja reemplazar un libro abierto", dibujo: "excel", reintento: "Ya lo cerré: guardar otra vez" },
  sincronizando: { titulo: "Ciérralo y espera a OneDrive", detalle: "Lo estaba sincronizando", dibujo: "onedrive", reintento: "Ya lo cerré: guardar otra vez" },
  colgado: { titulo: "Espera a que OneDrive termine de subir", detalle: "Mientras sube, Edge no pudo guardar ahí", dibujo: "subiendo" },
  bloqueado: { titulo: "Edge lo bloqueó", detalle: "SmartScreen no dejó guardarlo ahí", icono: "candado" },
  permiso: { titulo: "Sin permiso en esa carpeta", detalle: "Elige otra carpeta", icono: "candado" },
  espacio: { titulo: "El disco está lleno", detalle: "Libera espacio y vuelve a intentarlo", icono: "respaldos" },
  carpeta: { titulo: "Esa carpeta ya no existe", detalle: "Elige otra carpeta", icono: "inventario" },
  otro: { titulo: "No se pudo guardar ahí", detalle: null, icono: "alerta" },
};

export function AvisoNoGuardado({ dialogo }) {
  const sesion = useSesion();
  const causa = CAUSAS[dialogo.causa] ?? CAUSAS.otro;
  const { lado } = ubicacionDe(dialogo.destino);
  const enDescargas = lado === "Descargas";
  const cerrar = () => sesion.cerrarDialogo();
  const reintentar = () => {
    const otraVez = dialogo.reintentar;
    sesion.cerrarDialogo();
    otraVez?.(); // dentro del clic: el navegador deja abrir «Guardar como»
  };
  return html`<${Ventana} titulo="No se guardó donde elegiste" clase="ventana-no-guardado" alCerrar=${cerrar}>
    <p class="no-guardado-archivo"><${Icono} nombre="alerta" tam=${18} /> <span>${dialogo.nombre}</span></p>
    <div class="no-guardado-pasos">
      <figure class="no-guardado-paso">
        <span class="paso-numero" aria-hidden="true">1</span>
        ${causa.dibujo
          ? html`<${BarraDeTareas} archivo=${dialogo.nombre} sincronizando=${causa.dibujo === "onedrive"} subiendo=${causa.dibujo === "subiendo"} />`
          : html`<div class="ilus ilus-causa" role="img" aria-label=${causa.titulo}><span class="ilus-causa-icono"><${Icono} nombre=${causa.icono} tam=${44} /></span></div>`}
        <figcaption>
          <strong>${causa.titulo}</strong>
          <span>${causa.detalle ?? dialogo.motivo}</span>
        </figcaption>
      </figure>
      <figure class="no-guardado-paso">
        <span class="paso-numero" aria-hidden="true">2</span>
        <${Explorador} destino=${dialogo.destino} />
        <figcaption>
          <strong>${enDescargas ? "Quedó en Descargas" : `Quedó en ${lado}`}</strong>
          <span>Puedes usar ese mientras tanto</span>
        </figcaption>
      </figure>
    </div>
    <div class="no-guardado-acciones">
      <button type="button" class="boton boton-primario no-guardado-cerrar" onClick=${cerrar}>
        <${Icono} nombre="ok" tam=${22} /> Cerrar aviso
      </button>
      ${dialogo.reintentar
        ? html`<button type="button" class="boton boton-secundario" onClick=${reintentar}>
            <${Icono} nombre="regresa" tam=${18} /> ${causa.reintento ?? "Guardar otra vez"}
          </button>`
        : null}
    </div>
  <//>`;
}
