// Inventarios del RIG 91 que lleva la herramienta: DLTA y GSM. Usan el mismo formato de archivos
// (vales de salida, inventario, reporte de AX y archivo de vales de la base) pero cada uno va por
// separado: su propia base de datos en el navegador, sus folios, plantillas, respaldos,
// configuración y conciliación. Nunca se mezclan (ver docs/04 §Inventarios).

/**
 * id          como se guarda en `estado.config.inventario` y se muestra
 * bd          base de IndexedDB (DLTA conserva la de siempre)
 * respaldo    prefijo de sus respaldos .zip (DLTA, el de siempre: los anteriores siguen siendo suyos)
 * almacenAx   almacén de AX que se propone al importar el primer reporte (null = el primero del reporte)
 * marcas      palabras que, en el nombre de un archivo, dicen de qué inventario es
 * reporteAx   cómo se llama el reporte de AX que manda la base (solo para orientar)
 */
export const INVENTARIOS = [
  {
    id: "DLTA",
    bd: "control-almacen",
    respaldo: "almacen_",
    almacenAx: "RIG91-IX25",
    marcas: ["DLTA", "DELTA"],
    reporteAx: "DELTA RIG 91 <fecha>.xlsx",
  },
  {
    id: "GSM",
    bd: "control-almacen-gsm",
    respaldo: "almacen_GSM_",
    almacenAx: null,
    marcas: ["GSM"],
    reporteAx: null,
  },
];

export const INVENTARIO_DEFECTO = "DLTA";

/** El inventario con ese id (sin importar mayúsculas); si no existe, DLTA. */
export function inventarioPorId(id) {
  const buscado = String(id ?? "").trim().toUpperCase();
  return INVENTARIOS.find((i) => i.id === buscado) ?? INVENTARIOS.find((i) => i.id === INVENTARIO_DEFECTO);
}

/** Los ids de los demás inventarios (para decir "GSM lleva sus datos aparte"). */
export const otrosInventarios = (id) => INVENTARIOS.filter((i) => i.id !== inventarioPorId(id).id).map((i) => i.id);

/** El inventario al que pertenece un estado (los anteriores a GSM son de DLTA). */
export const inventarioDe = (estado) => inventarioPorId(estado?.config?.inventario);

const conMarca = (nombre, marca) => new RegExp(`(^|[^A-Z])${marca}([^A-Z]|$)`).test(nombre);

/**
 * De qué inventario dice ser un archivo por su nombre ("VALES_DE_SALIDA_DLTA.xlsm" → DLTA,
 * "INVENTARIO … GSM 280926.xlsx" → GSM). null si no lo dice o si nombra a más de uno.
 */
export function inventarioDelNombre(nombre) {
  const texto = String(nombre ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  const ids = INVENTARIOS.filter((i) => i.marcas.some((m) => conMarca(texto, m))).map((i) => i.id);
  return ids.length === 1 ? ids[0] : null;
}

/** Si el nombre del archivo dice que es de OTRO inventario, su id (para avisar antes de leerlo). */
export function deOtroInventario(nombre, actual) {
  const id = inventarioDelNombre(nombre);
  return id && id !== inventarioPorId(actual).id ? id : null;
}
