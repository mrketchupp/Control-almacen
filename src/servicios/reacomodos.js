// Reacomodo entre contenedores (Fase 3, RF-42): mover material de un renglón del inventario a
// otro contenedor sin cambiar el total. Los dos renglones quedan como recién contados: su
// CANTIDAD pasa a ser lo que queda en cada uno y CONSUMO / INGRESO vuelven a empezar (un
// "conteo" de tipo REACOMODO guarda el corte de folios). Así CONSUMO e INGRESO siguen siendo
// solo vales y la CANTIDAD nunca queda negativa. Si la variante no está en el contenedor de
// destino, se crea su renglón al final de esa hoja. Queda en el historial y en la bitácora.

import { dec, decTexto } from "../nucleo/decimal.js";
import { Indices, auditar, siguienteId } from "../nucleo/estado.js";
import { calcularSaldos } from "../nucleo/existencias.js";
import { ahoraIso, fmtFecha, hoyIso } from "../nucleo/fechas.js";
import { crearRenglon, describirRenglon, lugarCorto, renglonDe } from "./inventario.js";
import { siguienteFolio } from "./vales.js";

export class ErrorReacomodo extends Error {}

const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * @param desdeId      renglón de donde sale
 * @param ubicacionId  contenedor a donde va
 * @returns el registro del reacomodo
 */
export function reacomodar(estado, { desdeId, ubicacionId, cantidad, motivo = "", usuario = null, fecha = hoyIso() }) {
  const indices = new Indices(estado);
  const desde = indices.existencia(desdeId);
  if (!desde || desde.activo === false) throw new ErrorReacomodo("La partida de origen ya no existe.");
  const destino = indices.ubicacion(ubicacionId);
  if (!destino) throw new ErrorReacomodo("Elige el contenedor de destino.");
  if (destino.id === desde.ubicacion_id) throw new ErrorReacomodo("El material ya está en ese contenedor: elige otro.");
  const n = dec(cantidad);
  if (n === null || n.lte(0)) throw new ErrorReacomodo("La cantidad a mover debe ser mayor que 0.");
  const saldos = calcularSaldos(estado);
  const total = saldos.get(desde.id).total;
  if (n.gt(total)) throw new ErrorReacomodo(`Solo hay ${decTexto(total)} en esa partida; no se puede mover ${decTexto(n)}.`);
  const antes = describirRenglon(estado, desde.id, { indices, saldos });
  let hacia = renglonDe(estado, desde.variante_id, destino.id);
  const nuevo = !hacia;
  if (nuevo) {
    hacia = crearRenglon(estado, indices, { varianteId: desde.variante_id, ubicacionId: destino.id, cantidad: "0", origen: `REACOMODO desde ${lugarCorto(antes.ubicacion)}` });
  }
  const totalHacia = nuevo ? dec(0) : saldos.get(hacia.id).total;
  const conteo = indices.agregarConteo({
    fecha,
    tipo: "REACOMODO",
    descripcion: `Reacomodo ${lugarCorto(antes.ubicacion)} → ${lugarCorto(destino)}`,
    alcance: "PARCIAL",
    ubicaciones: [desde.ubicacion_id, destino.id],
    usuario,
    ultimo_folio_salida: siguienteFolio(estado, "SALIDA") - 1,
    ultimo_folio_entrada: siguienteFolio(estado, "ENTRADA") - 1,
    aplicado_en: ahoraIso(),
    lineas: [],
    nuevos: nuevo ? [hacia.id] : [],
  });
  for (const [renglon, queda, teorico] of [
    [desde, total.minus(n), total],
    [hacia, totalHacia.plus(n), totalHacia],
  ]) {
    conteo.lineas.push({
      existencia_id: renglon.id,
      contado: decTexto(queda),
      teorico: decTexto(teorico),
      cantidad_anterior: renglon.cantidad_conteo,
      conteo_anterior_id: renglon.conteo_id ?? null,
    });
    renglon.cantidad_conteo = decTexto(queda);
    renglon.conteo_id = conteo.id;
  }
  const registro = {
    id: siguienteId(estado, "reacomodo"),
    fecha,
    registrado_en: ahoraIso(),
    usuario,
    desde_existencia_id: desde.id,
    hacia_existencia_id: hacia.id,
    renglon_nuevo: nuevo,
    codigo: antes.codigo,
    descripcion: antes.descripcion,
    clave: [antes.dimension, antes.np ? `NP ${antes.np}` : ""].filter(Boolean).join(" · "),
    um: antes.um,
    cantidad: decTexto(n),
    desde_hoja: antes.hoja,
    hacia_hoja: destino.hoja_excel.trim(),
    conteo_id: conteo.id,
    motivo: texto(motivo) || null,
  };
  estado.reacomodos.push(registro);
  auditar(estado, {
    usuario,
    entidad: "reacomodo",
    entidadId: registro.id,
    accion: "MOVER",
    despues: { codigo: registro.codigo, cantidad: registro.cantidad, desde: registro.desde_hoja, hacia: registro.hacia_hoja, renglon_nuevo: nuevo, motivo: registro.motivo },
  });
  return registro;
}

/** Historial de reacomodos, del más reciente al más antiguo. */
export function historialReacomodos(estado) {
  return [...(estado.reacomodos ?? [])].reverse().map((r) => ({ ...r, fecha_texto: fmtFecha(r.fecha), cantidad_numero: Number(r.cantidad) }));
}
