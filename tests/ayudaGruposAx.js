// Escenario inventado: AX reúne dos NP del mismo tamaño. Ningún dato de usuario.
import { Indices, estadoVacio, siguienteId } from "../src/nucleo/estado.js";
import { registrarCorteAx } from "../src/servicios/conciliacion.js";

export function escenarioGruposAx(estado = estadoVacio(), { segundaDimension = "150VA", segundaUm = "PZA", lineas = null } = {}) {
  const codigo = 8426;
  const indices = new Indices(estado);
  indices.obtenerOCrearArticulo(codigo, "TRANSFORMADOR SINTÉTICO", "prueba");
  if (!estado.ubicaciones.length) estado.ubicaciones.push({ id: siguienteId(estado, "ubicacion"), contenedor: 5, tipo: "INVENTARIABLE", hoja_excel: "CONTENEDOR SINTETICO", nombre: "#5 Inv." });
  const crear = (dimension, np, cantidad, um = "PZA") => {
    const v = indices.obtenerOCrearVariante(codigo, dimension, np, um);
    const e = indices.agregarExistencia({ variante_id: v.id, ubicacion_id: estado.ubicaciones[0].id, orden: 90 + estado.existencias.length, cantidad_conteo: cantidad, conteo_id: null });
    return { v, e };
  };
  const uno = crear("150VA", "NP-SINTETICO-A", "2");
  const dos = crear(segundaDimension, "NP-SINTETICO-B", "2", segundaUm);
  const otra = crear("100VA", "NP-SINTETICO-C", "4");
  const linea = (tamano, disponible, color = "", um = "PZA") => ({ codigo, codigo_texto: String(codigo), nombre: "TRANSFORMADOR SINTÉTICO", modelo: "INV", um, almacen: "ALMACEN SINTETICO", tamano, color, disponible, valor_financiero: "40", valor_inventario: "40" });
  const corte = registrarCorteAx(estado, { fecha: "2026-09-05", almacen: "ALMACEN SINTETICO", renglones: lineas ? lineas(linea) : [linea("150VA", "4"), linea("100VA", "4")] }, "PERSONA SINTETICA");
  return { estado, corte, codigo, uno, dos, otra, linea };
}
