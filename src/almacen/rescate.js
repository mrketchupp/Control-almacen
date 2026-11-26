// Restaurar de emergencia (Ronda 36, pedido del usuario: tras un corte de luz la herramienta no abría y preguntó si
// había forma de borrar los datos y empezar desde un respaldo). Se usa desde la pantalla de carga, sin la herramienta
// abierta: primero intenta guardar una copia de lo que hay (si se puede leer a tiempo), revisa el respaldo elegido y
// reemplaza con él los datos de ESE inventario. Si la base no responde o falla, la borra completa y lo intenta en una
// nueva. Nunca toca el otro inventario. Sin navegador (las pruebas lo corren en Node con BackendMemoria).

import { estaVacio, migrarEstado } from "../nucleo/estado.js";
import { fechaDelDia } from "../nucleo/fechas.js";
import { inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { Almacen } from "./almacen.js";
import { ErrorRespaldo, leerRespaldo, revisarInventario } from "./respaldos.js";
import { conTiempo } from "./tiempo.js";

export const LIMITE_LEER_MS = 8000;
export const LIMITE_RESTAURAR_MS = 60000;
export const LIMITE_BORRAR_MS = 20000;

/** Para comparar lo que hay con un respaldo: cuántos vales, último folio de salida y de entrada y último día con vales. */
export function resumenDeDatos(estado) {
  let salida = 0;
  let entrada = 0;
  let dia = null;
  for (const v of estado?.vales ?? []) {
    if (v.tipo === "SALIDA" && v.folio > salida) salida = v.folio;
    if (v.tipo === "ENTRADA" && v.folio > entrada) entrada = v.folio;
    const fecha = fechaDelDia(v);
    if (fecha && (!dia || fecha > dia)) dia = fecha;
  }
  return { vales: estado?.vales?.length ?? 0, ultimaSalida: salida || null, ultimaEntrada: entrada || null, ultimoDia: dia };
}

/**
 * Abre un respaldo y revisa que sirva para `inventario` (lanza ErrorRespaldo si no). Nada se guarda.
 * @returns { inventario, fecha_hora, motivo, vales, ultimaSalida, ultimaEntrada, ultimoDia }
 */
export function revisarRespaldo(datos, inventario) {
  const { estado, manifiesto } = leerRespaldo(datos);
  const migrado = migrarEstado(estado);
  revisarInventario(migrado, inventario);
  return { inventario: inventarioDe(migrado).id, fecha_hora: manifiesto?.fecha_hora ?? null, motivo: manifiesto?.motivo ?? null, ...resumenDeDatos(migrado) };
}

/**
 * Lo que se perdería al restaurar: vales de este equipo posteriores al respaldo (por folio).
 * @returns { salidas: [desde, hasta] | null, entradas: [desde, hasta] | null }
 */
export function loQueSePierde(actual, respaldo) {
  const rango = (hasta, desde) => (hasta && hasta > (desde ?? 0) ? [(desde ?? 0) + 1, hasta] : null);
  return { salidas: rango(actual?.ultimaSalida, respaldo?.ultimaSalida), entradas: rango(actual?.ultimaEntrada, respaldo?.ultimaEntrada) };
}

/**
 * Copia de lo que hay en este equipo antes de reemplazarlo, si se puede leer a tiempo (un .zip de respaldo normal,
 * con motivo «rescate»).
 * @returns { nombre, datos, fecha_hora, resumen } | null si no hay datos
 * @throws ErrorTiempo si la base no responde (entonces hay que recargar para soltarla antes de restaurar)
 */
export async function copiaDeRescate(backend, { inventario, version = "", limiteMs = LIMITE_LEER_MS } = {}) {
  const crudo = await conTiempo(backend.leerEstado(), limiteMs, "Los datos de este equipo no se pudieron leer a tiempo");
  if (!crudo || estaVacio(crudo)) return null;
  let estado = crudo;
  try {
    estado = migrarEstado(structuredClone(crudo));
  } catch {
    // se copia tal como está: al restaurarla se vuelve a intentar
  }
  const almacen = new Almacen(backend, { inventario, version });
  almacen.estado = estado;
  const respaldo = await conTiempo(almacen.respaldo("rescate"), limiteMs * 2, "Las plantillas de este equipo no se pudieron leer a tiempo");
  return { ...respaldo, resumen: resumenDeDatos(estado) };
}

/**
 * Reemplaza los datos de `inventario` por los del respaldo. Primero sobre la base que hay (conserva sus copias
 * internas); si no responde o falla, la borra completa (`borrarBase`) y restaura en una nueva.
 * @param abrirBackend () => backend nuevo de ESE inventario
 * @param borrarBase   () => Promise (borra la base de ESE inventario)
 * @returns { borrada, manifiesto, motivo } (motivo: por qué se borró la base)
 * @throws ErrorRespaldo si el respaldo no sirve (no se toca nada); ErrorTiempo si ni borrando se pudo
 */
export async function restaurarDeEmergencia({ abrirBackend, borrarBase, inventario, version = "", datos, limiteMs = LIMITE_RESTAURAR_MS, limiteBorrarMs = LIMITE_BORRAR_MS }) {
  const id = inventarioPorId(inventario).id;
  revisarRespaldo(datos, id);
  const intentar = async () => {
    const backend = abrirBackend();
    try {
      const almacen = new Almacen(backend, { inventario: id, version });
      return await conTiempo(almacen.restaurar(datos), limiteMs, "La base de este equipo no respondió al restaurar");
    } finally {
      backend.cerrar();
    }
  };
  let motivo;
  try {
    return { borrada: false, manifiesto: await intentar(), motivo: null };
  } catch (error) {
    if (error instanceof ErrorRespaldo) throw error;
    motivo = error;
  }
  await conTiempo(borrarBase(), limiteBorrarMs, "El navegador no dejó borrar la base de este equipo");
  return { borrada: true, manifiesto: await intentar(), motivo };
}
