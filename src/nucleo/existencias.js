// Cálculo de existencias a partir de los movimientos (docs/04, "Cálculo de existencias"):
// para cada renglón de inventario,
//   CONSUMO = salidas emitidas con folio posterior al del último conteo,
//   INGRESO = entradas emitidas con folio posterior al del último conteo,
//   TOTAL   = CANTIDAD + INGRESO − CONSUMO.

import { CERO, dec } from "./decimal.js";

export class Saldo {
  constructor(existenciaId, cantidad) {
    this.existencia_id = existenciaId;
    this.cantidad = cantidad;
    this.consumo = CERO;
    this.ingreso = CERO;
  }

  get total() {
    return this.cantidad.plus(this.ingreso).minus(this.consumo);
  }
}

/** ¿Este vale afecta el saldo del renglón según el corte de su conteo? */
export function cuentaParaSaldo(conteo, vale) {
  if (vale.estado !== "EMITIDO" || vale.folio === null || vale.folio === undefined) return false;
  if (!conteo) return true;
  const corte = vale.tipo === "SALIDA" ? conteo.ultimo_folio_salida : conteo.ultimo_folio_entrada;
  return vale.folio > corte;
}

/** Map id de existencia → Saldo. */
export function calcularSaldos(estado, idsExistencia = null) {
  const filtro = idsExistencia ? new Set(idsExistencia) : null;
  const conteos = new Map(estado.conteos.map((c) => [c.id, c]));
  const existencias = new Map();
  const saldos = new Map();
  for (const e of estado.existencias) {
    if (filtro && !filtro.has(e.id)) continue;
    existencias.set(e.id, e);
    saldos.set(e.id, new Saldo(e.id, dec(e.cantidad_conteo) ?? CERO));
  }
  for (const vale of estado.vales) {
    for (const linea of vale.lineas) {
      if (linea.existencia_id === null || linea.existencia_id === undefined) continue;
      const existencia = existencias.get(linea.existencia_id);
      if (!existencia) continue;
      const cantidad = dec(linea.cantidad);
      if (cantidad === null || !cuentaParaSaldo(conteos.get(existencia.conteo_id), vale)) continue;
      const saldo = saldos.get(existencia.id);
      if (vale.tipo === "SALIDA") saldo.consumo = saldo.consumo.plus(cantidad);
      else saldo.ingreso = saldo.ingreso.plus(cantidad);
    }
  }
  return saldos;
}
