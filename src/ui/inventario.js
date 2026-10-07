// Inventario abierto (DLTA o GSM): el selector de la cabecera y el aviso cuando un archivo
// parece del otro. Cada inventario tiene su propia base en el navegador; cambiar no mezcla nada.

import { INVENTARIOS, deOtroInventario } from "../nucleo/inventarios.js";
import { confirmar, useSesion } from "./componentes.js";
import { html } from "./html.js";

/** DLTA | GSM en la cabecera: el activo va en su color; el otro se abre en esta misma pestaña. */
export function SelectorInventario() {
  const sesion = useSesion();
  if (!sesion.cambiarInventario) return null;
  const actual = sesion.inventario.id;
  const cambiar = (id) => {
    if (id === actual || sesion.ocupado) return;
    return sesion.tarea(`Abriendo el inventario ${id}…`, () => sesion.cambiarInventario(id));
  };
  return html`<div class="selector-inventario" role="radiogroup" aria-label="Inventario">
    <span class="selector-inventario-etiqueta">Inventario</span>
    ${INVENTARIOS.map(
      (i) => html`<button
        type="button"
        role="radio"
        aria-checked=${i.id === actual}
        class=${`inventario-opcion ${i.id === actual ? "activo" : ""}`}
        title=${i.id === actual ? `Estás en ${i.id}: vales, inventario, respaldos y conciliación de ${i.id}` : `Abrir ${i.id} (sus datos van por separado)`}
        onClick=${() => cambiar(i.id)}
      >
        ${i.id}
      </button>`,
    )}
  </div>`;
}

/**
 * Antes de leer un archivo: si su nombre dice que es del otro inventario (p. ej. "…DLTA…" estando en
 * GSM), pide confirmar. @returns true si se sigue
 */
export function seguirConArchivo(sesion, nombre) {
  const aqui = sesion.inventario.id;
  const otro = deOtroInventario(nombre, aqui);
  if (!otro) return true;
  return confirmar(
    `«${nombre}» parece del inventario ${otro} y estás en ${aqui}.\n\n¿Seguro que es de ${aqui}? Si no, cancela y cámbiate a ${otro} (arriba, junto al nombre de la herramienta).`,
  );
}
