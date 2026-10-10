// Revisión de correcciones y vínculo: simular nunca modifica el estado del almacén.
import { dimensionMostrada, npMostrado } from "../nucleo/estado.js";
import { claveEstricta } from "../nucleo/normalizar.js";
import { confirmarPareja, conciliar, corregirInventarioParaAx, corteAx, ErrorConciliacion, valoresAx } from "./conciliacion.js";
import { previaCorreccion } from "./inventario.js";
import { resultadoLineasAx, vincularFisico } from "./vinculosAx.js";

const texto = (v) => String(v ?? "").trim();

/** Una corrección individual muestra exactamente el resultado de la acción que se confirmará. */
export function preverCorreccionAx(estado, datos, confirmar = false) {
  const copia = structuredClone(estado);
  const previa = previaCorreccion(copia, datos.cual, datos);
  const resultado = previa.cambia
    ? confirmar
      ? confirmarPareja(copia, { ...datos, varianteId: previa.variante.id })
      : corregirInventarioParaAx(copia, datos)
    : { etiquetas: [] };
  const corte = corteAx(copia, datos.corteId);
  if (!corte) throw new ErrorConciliacion("El corte ya no existe.");
  return { etiquetas: resultado.etiquetas.length,
    comparacion: datos.lineaId == null ? null : resultadoLineasAx(conciliar(copia, corte), [datos.lineaId]) };
}

function aplicar(estado, datos, usuario) {
  const corte = corteAx(estado, datos.corteId);
  const linea = corte?.lineas.find((l) => l.id === datos.lineaIds[0]);
  if (!linea) throw new ErrorConciliacion("Esa partida de AX ya no existe.");
  if (!claveEstricta(linea.tamano) && !claveEstricta(linea.color)) {
    throw new ErrorConciliacion("AX no indica una dimensión que copiar. Conserva las claves y confirma sólo el vínculo.");
  }
  // Capturar las partidas antes de las posibles uniones: una unión no debe repetir una corrección.
  const partidas = estado.existencias.filter((e) => e.activo !== false && datos.varianteIds.includes(e.variante_id));
  const propuestas = partidas.map((e) => {
    const variante = estado.variantes.find((v) => v.id === e.variante_id);
    const ahora = { dimension: dimensionMostrada(e, variante), np: npMostrado(e, variante) };
    const quedara = valoresAx(linea, { np: ahora.np });
    return { existenciaId: e.id, ahora, quedara,
      cambia: texto(ahora.dimension) !== texto(quedara.dimension) || texto(ahora.np) !== texto(quedara.np) };
  });
  const etiquetas = [];
  for (const p of propuestas.filter((p) => p.cambia)) {
    const res = corregirInventarioParaAx(estado, { corteId: corte.id, lineaId: linea.id,
      cual: { existenciaId: p.existenciaId }, dimension: p.quedara.dimension, np: p.quedara.np }, usuario);
    etiquetas.push(...res.etiquetas);
  }
  const varianteIds = [...new Set(partidas.map((e) => e.variante_id))];
  const cambio = vincularFisico(estado, { ...datos, varianteIds }, usuario);
  return { cambio, propuestas, etiquetas, comparacion: resultadoLineasAx(conciliar(estado, corte), datos.lineaIds) };
}

/** Valida la selección antes de corregir; una selección inválida no deja cambios parciales. */
function simular(estado, datos) {
  const copia = structuredClone(estado);
  vincularFisico(copia, datos); // Comprueba código, unidades y partidas ya asignadas.
  return aplicar(copia, datos, null);
}

export function preverVinculoCorregido(estado, datos) {
  const res = simular(estado, datos);
  return { ...res, etiquetas: res.etiquetas.length };
}

/** Cambia las claves elegidas, prepara etiquetas y guarda el vínculo en una misma operación. */
export function corregirYVincularFisico(estado, datos, usuario = null) {
  simular(estado, datos);
  return aplicar(estado, datos, usuario);
}
