// Transición: trae a la herramienta los vales que se siguieron haciendo en el Excel
// después de la primera carga (folios mayores al último que la herramienta conoce).
// Así el siguiente folio que emita la herramienta nunca choca con uno hecho en papel.

import { Indices, auditar } from "../nucleo/estado.js";
import { cortesVigentes } from "../nucleo/existencias.js";
import { limpiarDiario, respuestasVacias } from "./limpieza.js";
import { agregarValesMigrados } from "./primeraCarga.js";

export function ultimoFolioConocido(estado, tipo = "SALIDA") {
  return estado.vales.filter((v) => v.tipo === tipo).reduce((m, v) => Math.max(m, v.folio ?? 0), 0);
}

function respuestasDesdeEstado(estado) {
  const respuestas = respuestasVacias();
  const nombres = new Map(estado.personas.map((p) => [p.id, p.nombre]));
  for (const [variante, id] of Object.entries(estado.alias)) {
    if (nombres.has(id)) respuestas.alias.set(variante, nombres.get(id));
  }
  return respuestas;
}

/** Vista previa: qué traería del libro de vales (leerVales) sin cambiar nada. */
export function revisarValesNuevos(estado, libroVales) {
  const desde = ultimoFolioConocido(estado);
  const renglones = libroVales.renglones.filter((r) => r.folio !== null && r.folio > desde);
  const catalogo = new Map(Object.values(estado.articulos).map((a) => [a.codigo, a.descripcion]));
  const resultado = limpiarDiario(renglones, catalogo, respuestasDesdeEstado(estado));
  return { desde, renglones: renglones.length, resultado, folios: resultado.vales.map((v) => v.folio) };
}

/** Agrega esos vales como migrados (se ligan al inventario cuando no hay duda). */
export function importarValesNuevos(estado, libroVales, usuario = null) {
  const { desde, resultado } = revisarValesNuevos(estado, libroVales);
  const indices = new Indices(estado);
  for (const [codigo, descripcion] of resultado.codigos_nuevos) indices.obtenerOCrearArticulo(codigo, descripcion, "DIARIO");
  const reporte = { lineas_ubicadas: 0, lineas_migradas: 0, por_ubicar: [] };
  // Se ligan al inventario los posteriores al conteo más antiguo vigente; en cada renglón solo
  // descuentan los posteriores a su propio conteo.
  agregarValesMigrados(estado, indices, resultado.vales, { folioCorte: cortesVigentes(estado).salida, usuario }, reporte);
  auditar(estado, {
    usuario,
    entidad: "sistema",
    accion: "IMPORTAR_VALES",
    despues: { desde_folio: desde + 1, folios: resultado.vales.map((v) => v.folio), omitidos: resultado.omitidos.length },
  });
  return { ...reporte, vales: resultado.vales.length, folios: resultado.vales.map((v) => v.folio), omitidos: resultado.omitidos };
}
