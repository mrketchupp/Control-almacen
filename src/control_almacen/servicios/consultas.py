"""Consultas y acciones pequeñas que usa la interfaz (sin lógica de pantalla)."""

from __future__ import annotations

import datetime as dt
import difflib
import json
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from control_almacen.db import modelos as m
from control_almacen.dominio.catalogo import claves_de_busqueda
from control_almacen.dominio.existencias import calcular_saldos
from control_almacen.dominio.normalizar import clave_laxa

CLAVE_USUARIO = "usuario_en_turno"


def _numero(valor: Decimal | None) -> float | int | None:
    """Decimal → número para mostrar en tablas (entero si no tiene decimales)."""
    if valor is None:
        return None
    return int(valor) if valor == valor.to_integral_value() else float(valor)


@dataclass
class Resumen:
    vacia: bool
    existencias: int
    ubicaciones: int
    articulos: int
    vales: int
    ultimo_folio: int | None
    fecha_ultimo_vale: dt.date | None
    por_ubicar: int
    por_confirmar: int
    conteo_fecha: dt.date | None
    conteo_folio: int | None
    ultima_exportacion: dict[str, dt.datetime]


def resumen(sesion: Session) -> Resumen:
    existencias = sesion.scalar(select(func.count(m.Existencia.id))) or 0
    vales = sesion.scalar(select(func.count(m.Vale.id)).where(m.Vale.tipo == "SALIDA")) or 0
    ultimo = sesion.scalar(
        select(m.Vale)
        .where(m.Vale.tipo == "SALIDA", m.Vale.folio.is_not(None))
        .order_by(m.Vale.folio.desc())
        .limit(1)
    )
    conteo = sesion.scalar(select(m.Conteo).order_by(m.Conteo.id.desc()).limit(1))
    exportaciones: dict[str, dt.datetime] = {}
    for e in sesion.scalars(select(m.Exportacion).order_by(m.Exportacion.fecha_hora)):
        exportaciones[e.tipo] = e.fecha_hora
    return Resumen(
        vacia=existencias == 0 and vales == 0,
        existencias=existencias,
        ubicaciones=sesion.scalar(select(func.count(m.Ubicacion.id))) or 0,
        articulos=sesion.scalar(select(func.count(m.Articulo.codigo))) or 0,
        vales=vales,
        ultimo_folio=ultimo.folio if ultimo else None,
        fecha_ultimo_vale=ultimo.fecha if ultimo else None,
        por_ubicar=len(lineas_por_ubicar(sesion)),
        por_confirmar=sesion.scalar(
            select(func.count(m.Articulo.codigo)).where(m.Articulo.por_confirmar)
        )
        or 0,
        conteo_fecha=conteo.fecha if conteo else None,
        conteo_folio=conteo.ultimo_folio_salida if conteo else None,
        ultima_exportacion=exportaciones,
    )


# ---------------------------------------------------------------- inventario


def filas_inventario(sesion: Session) -> list[dict]:
    saldos = calcular_saldos(sesion)
    existencias = sesion.scalars(
        select(m.Existencia)
        .options(
            joinedload(m.Existencia.variante).joinedload(m.Variante.articulo),
            joinedload(m.Existencia.ubicacion),
        )
        .join(m.Ubicacion)
        .order_by(m.Ubicacion.orden, m.Existencia.orden)
    ).all()
    filas = []
    for e in existencias:
        saldo = saldos[e.id]
        filas.append(
            {
                "id": e.id,
                "contenedor": e.ubicacion.contenedor,
                "clase": "Inventariable" if e.ubicacion.clase == "INV" else "Consumible",
                "hoja": e.ubicacion.nombre,
                "codigo": e.variante.codigo,
                "descripcion": e.variante.articulo.descripcion,
                "dimension": e.dimension_mostrada or "",
                "np": e.np_mostrado or "",
                "um": e.um_mostrada or "",
                "cantidad": _numero(saldo.cantidad),
                "consumo": _numero(saldo.consumo) or None,
                "ingreso": _numero(saldo.ingreso) or None,
                "total": _numero(saldo.total),
                "nota": e.nota or "",
            }
        )
    return filas


# ------------------------------------------------------------------ historial


def filas_historial(sesion: Session, tipo: str = "SALIDA") -> list[dict]:
    vales = sesion.scalars(
        select(m.Vale)
        .options(selectinload(m.Vale.lineas))
        .where(m.Vale.tipo == tipo)
        .order_by(m.Vale.folio.desc())
    )
    filas = []
    for vale in vales:
        for linea in vale.lineas:
            filas.append(
                {
                    "id": linea.id,
                    "folio": vale.folio,
                    "fecha": vale.fecha.strftime("%d/%m/%Y") if vale.fecha else "",
                    "estado": vale.estado,
                    "destino": vale.destino or "",
                    "depto": vale.depto_destino or "",
                    "recibio": vale.recibio_nombre or "",
                    "cantidad": _numero(linea.cantidad),
                    "um": linea.um or "",
                    "codigo": linea.codigo,
                    "descripcion": linea.descripcion or "",
                    "clave": linea.clave or "",
                    "oc": linea.oc or "S/OC",
                    "notas": linea.notas or "",
                }
            )
    return filas


# --------------------------------------------------------- renglones por ubicar


def folio_corte_actual(sesion: Session) -> int:
    conteo = sesion.scalar(select(m.Conteo).order_by(m.Conteo.id.desc()).limit(1))
    return conteo.ultimo_folio_salida if conteo else 0


def lineas_por_ubicar(sesion: Session) -> list[dict]:
    """Renglones de vales posteriores al conteo que aún no se ligan a un renglón del inventario."""
    corte = folio_corte_actual(sesion)
    lineas = sesion.scalars(
        select(m.ValeLinea)
        .join(m.Vale)
        .options(joinedload(m.ValeLinea.vale))
        .where(
            m.Vale.estado == "EMITIDO",
            m.Vale.folio > corte,
            m.ValeLinea.existencia_id.is_(None),
            m.ValeLinea.no_inventariado.is_(False),
            m.ValeLinea.codigo.is_not(None),
        )
        .order_by(m.Vale.tipo, m.Vale.folio, m.ValeLinea.renglon)
    ).all()
    salida = []
    for linea in lineas:
        candidatos = candidatos_para(sesion, linea.codigo, linea.clave)
        salida.append(
            {
                "id": linea.id,
                "tipo": linea.vale.tipo,
                "folio": linea.vale.folio,
                "renglon": linea.renglon,
                "codigo": linea.codigo,
                "descripcion": linea.descripcion or "",
                "clave": linea.clave or "",
                "cantidad": _numero(linea.cantidad),
                "candidatos": candidatos,
            }
        )
    return salida


def candidatos_para(sesion: Session, codigo: int | None, clave: str | None) -> list[dict]:
    """Renglones del inventario con el mismo código; primero los que coinciden con la clave."""
    if codigo is None:
        return []
    existencias = sesion.scalars(
        select(m.Existencia)
        .join(m.Variante)
        .options(joinedload(m.Existencia.variante), joinedload(m.Existencia.ubicacion))
        .where(m.Variante.codigo == codigo)
    ).all()
    claves = claves_de_busqueda(clave)
    saldos = calcular_saldos(sesion, [e.id for e in existencias])

    def coincide(e: m.Existencia) -> bool:
        propias = {e.variante.dimension_clave, e.variante.np_clave} - {""}
        return bool(claves & propias)

    laxa = clave_laxa(clave)

    def parecido(e: m.Existencia) -> float:
        texto = clave_laxa(f"{e.dimension_mostrada or ''}{e.np_mostrado or ''}")
        return difflib.SequenceMatcher(None, laxa, texto).ratio() if laxa and texto else 0.0

    existencias.sort(key=lambda e: (not coincide(e), -parecido(e), e.ubicacion.orden, e.orden))
    return [
        {
            "id": e.id,
            "etiqueta": f"{e.ubicacion.nombre} · {e.dimension_mostrada or 'S/D'}"
            + (f" · NP {e.np_mostrado}" if e.np_mostrado else "")
            + f" · existencia {_numero(saldos[e.id].total)} {e.um_mostrada or ''}".rstrip(),
            "coincide": coincide(e),
        }
        for e in existencias
    ]


def ubicar_linea(
    sesion: Session, linea_id: int, existencia_id: int | None, usuario: str | None
) -> None:
    """Liga un renglón de vale a un renglón del inventario (o lo marca como no inventariado)."""
    linea = sesion.get(m.ValeLinea, linea_id)
    antes = {"existencia_id": linea.existencia_id, "no_inventariado": linea.no_inventariado}
    if existencia_id is None:
        linea.no_inventariado = True
        linea.existencia_id = None
    else:
        existencia = sesion.get(m.Existencia, existencia_id)
        linea.existencia_id = existencia.id
        linea.variante_id = existencia.variante_id
        linea.no_inventariado = False
    sesion.add(
        m.Auditoria(
            usuario=usuario,
            entidad="vale_linea",
            entidad_id=str(linea_id),
            accion="UBICAR",
            antes=json.dumps(antes),
            despues=json.dumps(
                {"existencia_id": linea.existencia_id, "no_inventariado": linea.no_inventariado}
            ),
        )
    )


# ----------------------------------------------------------------- usuarios


def almacenistas(sesion: Session) -> list[str]:
    return list(
        sesion.scalars(
            select(m.Persona.nombre)
            .where(m.Persona.es_almacenista, m.Persona.activo)
            .order_by(m.Persona.nombre)
        )
    )


def usuario_en_turno(sesion: Session) -> str | None:
    config = sesion.get(m.Config, CLAVE_USUARIO)
    return config.valor if config else None


def fijar_usuario_en_turno(sesion: Session, nombre: str) -> None:
    sesion.merge(m.Config(clave=CLAVE_USUARIO, valor=nombre))
