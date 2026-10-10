// Fechas como texto ISO 'AAAA-MM-DD' dentro del estado. Hacia Excel: número de serie.

const DIA_MS = 86400000;

/** Valor numérico de una celda con formato de fecha en Excel (número de serie). */
export class FechaCelda {
  constructor(serial) {
    this.serial = serial;
  }
}
const BASE_EXCEL = Date.UTC(1899, 11, 30);

const dos = (n) => String(n).padStart(2, "0");

export function isoDesdePartes(anio, mes, dia) {
  const t = Date.UTC(anio, mes - 1, dia);
  const d = new Date(t);
  if (anio < 1 || anio > 9999) return null;
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(anio).padStart(4, "0")}-${dos(mes)}-${dos(dia)}`;
}

export function isoDesdeSerial(serial) {
  const d = new Date(BASE_EXCEL + Math.trunc(serial) * DIA_MS);
  return isoDesdePartes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Número de serie de Excel (sistema 1900) para una fecha ISO. */
export function serialExcel(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - BASE_EXCEL) / DIA_MS);
}

export function sumarDias(iso, dias) {
  return isoDesdeSerial(serialExcel(iso) + dias);
}

export function hoyIso(ahora = new Date()) {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/** Fecha y hora local 'AAAA-MM-DDTHH:MM:SS'. */
export function ahoraIso(ahora = new Date()) {
  return `${hoyIso(ahora)}T${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:${dos(ahora.getSeconds())}`;
}

/**
 * Día en que un vale mueve el inventario (inventario del día, reporte diario, inicio, historial): en las
 * entradas, el día en que se **recibió** el material (Ronda 22; editable, así que ya no sigue el orden de los
 * folios); en las salidas, su fecha. La fecha del vale de entrada (cuando la base lo envió) sigue mandando en
 * la conciliación con AX y con el archivo de la base.
 */
export function fechaDelDia(vale) {
  if (!vale) return null;
  return (vale.tipo === "ENTRADA" ? vale.fecha_recibido || vale.fecha : vale.fecha) || null;
}

/** '2026-09-28' → '28/09/2026' */
export function fmtFecha(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** '2026-09-28T13:05:00' → '28/09/2026 13:05' */
export function fmtFechaHora(iso) {
  if (!iso) return "";
  return `${fmtFecha(iso)} ${iso.slice(11, 16)}`;
}

/** '2026-09-28' → '280926' (DDMMAA, como en los nombres de archivo del usuario). */
export function ddmmaa(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}${m}${a.slice(2)}`;
}
