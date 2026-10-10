// Revisión de correcciones y vínculo: simular nunca modifica el estado del almacén.
import { dimensionMostrada, npMostrado, umMostrada } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { dec } from "../nucleo/decimal.js";
import { claveEstricta } from "../nucleo/normalizar.js";
import { confirmarPareja, conciliar, corregirInventarioParaAx, corteAx, ErrorConciliacion, valoresAx } from "./conciliacion.js";
import { previaCorreccion } from "./inventario.js";
import { resultadoLineasAx, validarSeleccionFisica, vincularFisico } from "./vinculosAx.js";
import { corregirUnidadInventario, equivalenciaUnidad } from "./unidadesAx.js";
import { agregarEtiquetas, etiquetaDeExistencia } from "./etiquetas.js";

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
  const corregirClaves = datos.corregirClaves !== false;
  if (corregirClaves && !claveEstricta(linea.tamano) && !claveEstricta(linea.color)) {
    throw new ErrorConciliacion("AX no indica una dimensión que copiar. Conserva las claves y confirma sólo el vínculo.");
  }
  // Capturar las partidas antes de las posibles uniones: una unión no debe repetir una corrección.
  const partidas = estado.existencias.filter((e) => e.activo !== false && datos.varianteIds.includes(e.variante_id));
  const saldos = calcularSaldos(estado);
  const propuestas = partidas.map((e) => {
    const variante = estado.variantes.find((v) => v.id === e.variante_id);
    const ahora = { dimension: dimensionMostrada(e, variante), np: npMostrado(e, variante), um: umMostrada(e, variante), cantidad: saldos.get(e.id).total };
    const quedara = { ...(corregirClaves ? valoresAx(linea, { np: ahora.np }) : ahora), um: ahora.um, cantidad: ahora.cantidad };
    const eq = datos.corregirUnidades ? equivalenciaUnidad(datos.equivalencias?.[variante.id]) : null;
    if (eq) { quedara.um = linea.um; quedara.cantidad = ahora.cantidad.times(eq.destino).div(eq.origen); }
    const cambiaClave = texto(ahora.dimension) !== texto(quedara.dimension) || texto(ahora.np) !== texto(quedara.np);
    const cambiaUnidad = eq && (texto(ahora.um) !== texto(quedara.um) || !dec(eq.origen).eq(eq.destino));
    return { existenciaId: e.id, ahora, quedara, equivalencia: eq, cambiaClave, cambiaUnidad, cambia: cambiaClave || Boolean(cambiaUnidad) };
  });
  for (const p of propuestas.filter((p) => p.cambia)) {
    if (p.cambiaUnidad) corregirUnidadInventario(estado, { existenciaId: p.existenciaId, um: p.quedara.um, equivalencia: p.equivalencia }, usuario);
    if (p.cambiaClave) corregirInventarioParaAx(estado, { corteId: corte.id, lineaId: linea.id,
      cual: { existenciaId: p.existenciaId }, dimension: p.quedara.dimension, np: p.quedara.np, prepararEtiquetas: false }, usuario);
  }
  const varianteIds = [...new Set(partidas.map((e) => e.variante_id))];
  const cambio = vincularFisico(estado, { ...datos, varianteIds }, usuario);
  const etiquetas = agregarEtiquetas(estado, "material", propuestas.filter((p) => p.cambia).map((p) => {
    const e = etiquetaDeExistencia(estado, p.existenciaId);
    e.nombre = texto(linea.nombre) || e.nombre;
    if (p.cambiaUnidad) e.descripcion = `UM: ${p.quedara.um}`;
    e.origen = { ...e.origen, corte_ax_id: corte.id, linea_ax_id: linea.id };
    return e;
  }));
  return { cambio, propuestas, etiquetas, comparacion: resultadoLineasAx(conciliar(estado, corte), datos.lineaIds) };
}

/** Valida la selección antes de corregir; una selección inválida no deja cambios parciales. */
function simular(estado, datos) {
  const copia = structuredClone(estado);
  validarSeleccionFisica(copia, datos, { permitirOtraUnidad: Boolean(datos.corregirUnidades) });
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
