// Íconos de línea propios (SVG en el mismo HTML, sin fuentes ni archivos externos).

import { html } from "./html.js";

const TRAZOS = {
  inicio: ["M3 11 12 4l9 7", "M5 9.5V20h5v-6h4v6h5V9.5"],
  salida: ["M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5", "M12 15V4", "M8 8l4-4 4 4"],
  entrada: ["M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5", "M12 4v11", "M8 11l4 4 4-4"],
  historial: ["M12 21a9 9 0 1 0-9-9", "M3 12V7", "M3 12h5", "M12 7v5l3 2"],
  inventario: ["M3 7.5 12 3l9 4.5-9 4.5z", "M3 7.5V17l9 4.5 9-4.5V7.5", "M12 12v9.5"],
  conteo: ["M8 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2", "M9 3h6v3H9z", "M9 13l2 2 4-4"],
  pendientes: ["M12 3 2.5 20h19z", "M12 10v4", "M12 17h.01"],
  exportar: ["M12 15V3", "M8 7l4-4 4 4", "M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"],
  personas: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M3 20a6 6 0 0 1 12 0", "M17 11a2.5 2.5 0 1 0 0-5", "M16.5 14.5A5 5 0 0 1 21 20"],
  ajustes: ["M4 6h9", "M17 6h3", "M4 12h3", "M11 12h9", "M4 18h11", "M19 18h1", "M15 4v4", "M9 10v4", "M17 16v4"],
  respaldos: ["M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z", "M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6", "M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"],
  ayuda: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4", "M12 17h.01"],
  reporte: ["M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M4 10h16", "M8 3v4", "M16 3v4", "M8 14h3", "M8 17h6"],
  carga: ["M12 3v12", "M8 11l4 4 4-4", "M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"],
  mas: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  imagen: ["M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M4 16l5-5 4 4 2-2 5 5", "M15.5 9a1.5 1.5 0 1 0 0-.01"],
  nube: ["M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z", "M12 11v5", "M10 13l2-2 2 2"],
  teclado: ["M3 7h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z", "M6 11h.01", "M10 11h.01", "M14 11h.01", "M18 11h.01", "M7 14.5h10"],
  chispa: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  regresa: ["M9 14 4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  caja: ["M3 8l9-5 9 5v8l-9 5-9-5z", "M3 8l9 5 9-5", "M12 13v8"],
  tema: ["M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"],
  cerrar: ["M6 6l12 12", "M18 6 6 18"],
  etapa: ["M10 3h4v5h-4z", "M8 8h8v3H8z", "M10 11l2 10 2-10", "M4 21h16"],
  descargar: ["M12 4v11", "M8 11l4 4 4-4", "M5 19h14"],
};

/** <Icono nombre="salida" /> */
export function Icono({ nombre, tam = 18, clase = "" }) {
  const trazos = TRAZOS[nombre];
  if (!trazos) return null;
  return html`<svg
    class=${`icono ${clase}`}
    width=${tam}
    height=${tam}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${trazos.map((d) => html`<path d=${d} />`)}
  </svg>`;
}
