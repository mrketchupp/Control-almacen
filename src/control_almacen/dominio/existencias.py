"""Cálculo de existencias a partir de los movimientos.

Regla (docs/04, "Cálculo de existencias"): para cada renglón de inventario,
CONSUMO = salidas emitidas con folio posterior al del último conteo y
INGRESO = entradas emitidas con folio posterior al del último conteo.
TOTAL = CANTIDAD + INGRESO − CONSUMO.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from control_almacen.db import modelos as m

CERO = Decimal(0)


@dataclass
class Saldo:
    existencia_id: int
    cantidad: Decimal
    consumo: Decimal = CERO
    ingreso: Decimal = CERO

    @property
    def total(self) -> Decimal:
        return self.cantidad + self.ingreso - self.consumo


def cuenta_para_saldo(existencia: m.Existencia, vale: m.Vale) -> bool:
    """¿Este vale afecta el saldo del renglón según el corte de su conteo?"""
    if vale.estado != "EMITIDO" or vale.folio is None:
        return False
    conteo = existencia.conteo
    if conteo is None:
        return True
    corte = conteo.ultimo_folio_salida if vale.tipo == "SALIDA" else conteo.ultimo_folio_entrada
    return vale.folio > corte


def calcular_saldos(
    sesion: Session, existencia_ids: Iterable[int] | None = None
) -> dict[int, Saldo]:
    consulta = select(m.Existencia).options(joinedload(m.Existencia.conteo))
    if existencia_ids is not None:
        consulta = consulta.where(m.Existencia.id.in_(list(existencia_ids)))
    existencias = {e.id: e for e in sesion.scalars(consulta)}
    saldos = {i: Saldo(i, e.cantidad_conteo or CERO) for i, e in existencias.items()}
    lineas = sesion.scalars(
        select(m.ValeLinea)
        .options(joinedload(m.ValeLinea.vale))
        .where(m.ValeLinea.existencia_id.in_(list(existencias)))
    )
    for linea in lineas:
        existencia = existencias[linea.existencia_id]
        if linea.cantidad is None or not cuenta_para_saldo(existencia, linea.vale):
            continue
        saldo = saldos[linea.existencia_id]
        if linea.vale.tipo == "SALIDA":
            saldo.consumo += linea.cantidad
        else:
            saldo.ingreso += linea.cantidad
    return saldos
