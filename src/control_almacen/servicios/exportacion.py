"""Exportaciones con nombre de archivo, carpeta por día y registro en la base."""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from control_almacen.db import modelos as m
from control_almacen.exportadores.inventario import exportar_inventario
from control_almacen.exportadores.vales import exportar_vales
from control_almacen.servicios.primera_carga import sha256


class SinPlantilla(RuntimeError):
    """No hay archivo del usuario registrado como plantilla."""


def plantilla_activa(
    sesion: Session, tipo: str, carpeta_plantillas: Path
) -> tuple[m.PlantillaExcel, Path]:
    plantilla = sesion.scalar(
        select(m.PlantillaExcel)
        .where(m.PlantillaExcel.tipo == tipo, m.PlantillaExcel.activa)
        .order_by(m.PlantillaExcel.id.desc())
    )
    if plantilla is None or not (carpeta_plantillas / plantilla.archivo).exists():
        raise SinPlantilla(f"No hay plantilla registrada para {tipo.lower()}.")
    return plantilla, carpeta_plantillas / plantilla.archivo


def nombre_con_fecha(nombre_original: str, fecha: dt.date) -> str:
    """Reemplaza la fecha DDMMAA del nombre original (o la agrega al final)."""
    base = Path(nombre_original)
    texto = fecha.strftime("%d%m%y")
    if re.search(r"\d{6}(?!\d)", base.stem):
        return re.sub(r"\d{6}(?!\d)", texto, base.stem, count=1) + base.suffix
    return f"{base.stem} {texto}{base.suffix}"


def _carpeta_del_dia(carpeta: Path, hoy: dt.date) -> Path:
    destino = carpeta / hoy.isoformat()
    destino.mkdir(parents=True, exist_ok=True)
    return destino


def exportar_vales_del_dia(
    sesion: Session,
    carpeta_plantillas: Path,
    carpeta_exportaciones: Path,
    usuario: str | None,
    hoy: dt.date | None = None,
) -> Path:
    hoy = hoy or dt.date.today()
    plantilla, ruta = plantilla_activa(sesion, "VALES", carpeta_plantillas)
    destino = _carpeta_del_dia(carpeta_exportaciones, hoy) / plantilla.nombre_original
    resultado = exportar_vales(sesion, ruta, destino)
    sesion.add(
        m.Exportacion(
            tipo="VALES",
            archivo=str(destino),
            sha256=sha256(destino),
            usuario=usuario,
            ultimo_folio=resultado.ultimo_folio,
        )
    )
    return destino


def exportar_inventario_del_dia(
    sesion: Session,
    carpeta_plantillas: Path,
    carpeta_exportaciones: Path,
    usuario: str | None,
    hoy: dt.date | None = None,
) -> Path:
    hoy = hoy or dt.date.today()
    plantilla, ruta = plantilla_activa(sesion, "INVENTARIO", carpeta_plantillas)
    destino = _carpeta_del_dia(carpeta_exportaciones, hoy) / nombre_con_fecha(
        plantilla.nombre_original, hoy
    )
    exportar_inventario(sesion, ruta, destino)
    sesion.add(
        m.Exportacion(
            tipo="INVENTARIO", archivo=str(destino), sha256=sha256(destino), usuario=usuario
        )
    )
    return destino
