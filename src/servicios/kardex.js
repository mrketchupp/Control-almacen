// Hojas de un reporte de AX o de un Kardex de auditoría. El libro puede traer una hoja por inventario (FX,
// GSM y la de DLTA, que no dice su nombre). Qué hoja es de qué inventario lo decide el usuario (Ronda 24:
// lo relaciona en la pantalla del conteo de auditoría); aquí solo se propone por el nombre, sin revisar
// códigos: los inventarios pueden tener códigos parecidos y cada hoja se registra en su lugar.

import { DUENO_FX, diceFx, inventarioDelNombre } from "../nucleo/inventarios.js";

/** De quién dice ser la hoja por su nombre o su almacén: "FX", "DLTA", "GSM" o null. */
export function marcaDeHoja(tabla) {
  if (diceFx(tabla.hoja) || diceFx(tabla.almacenes?.[0]?.nombre ?? "")) return DUENO_FX;
  return inventarioDelNombre(tabla.hoja);
}

/**
 * La hoja que se propone para conciliar en el inventario abierto: la que dice su nombre; si ninguna, la
 * primera que no dice otro inventario ni FX; si no, la primera. El usuario puede elegir otra.
 * @returns el nombre de la hoja
 */
export function hojaParaConciliar(reporte, inventario) {
  const tablas = reporte.tablas ?? [reporte];
  const propia = tablas.find((t) => marcaDeHoja(t) === inventario) ?? tablas.find((t) => !marcaDeHoja(t)) ?? tablas[0];
  return propia.hoja;
}
