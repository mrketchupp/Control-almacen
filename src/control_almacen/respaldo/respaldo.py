"""Respaldos consistentes (API de backup de SQLite) y restauración.

La base viva no está en OneDrive; aquí se generan copias .zip hacia la carpeta de
respaldos (OneDrive si existe). Ver docs/03-arquitectura.md.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from control_almacen import __version__

NOMBRE_BD = "almacen.db"
MANIFIESTO = "manifiesto.json"
_PATRON = re.compile(r"^almacen_(\d{4}-\d{2}-\d{2})_(\d{6})(?:_(.+))?\.zip$")


class ErrorRespaldo(RuntimeError):
    pass


@dataclass(frozen=True)
class InfoRespaldo:
    ruta: Path
    fecha_hora: dt.datetime
    motivo: str
    tamano: int


def _copia_consistente(origen: Path, destino: Path) -> None:
    fuente = sqlite3.connect(origen)
    try:
        copia = sqlite3.connect(destino)
        try:
            fuente.backup(copia)
        finally:
            copia.close()
    finally:
        fuente.close()


def verificar_integridad(ruta_bd: Path) -> None:
    conexion = sqlite3.connect(ruta_bd)
    try:
        resultado = conexion.execute("PRAGMA integrity_check").fetchone()[0]
        tablas = {
            fila[0]
            for fila in conexion.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conexion.close()
    if resultado != "ok":
        raise ErrorRespaldo(f"La base de datos del respaldo está dañada: {resultado}")
    if "vale" not in tablas or "existencia" not in tablas:
        raise ErrorRespaldo("El archivo no es una base de datos de Control de Almacén.")


def crear_respaldo(
    ruta_bd: Path, carpeta_plantillas: Path, carpeta_respaldos: Path, motivo: str = "manual"
) -> Path:
    """Crea almacen_AAAA-MM-DD_HHMMSS_<motivo>.zip con la base y las plantillas."""
    if not ruta_bd.exists():
        raise ErrorRespaldo("No hay base de datos que respaldar.")
    carpeta_respaldos.mkdir(parents=True, exist_ok=True)
    ahora = dt.datetime.now()
    motivo_limpio = re.sub(r"[^a-z0-9-]+", "-", motivo.lower()).strip("-") or "manual"
    destino = carpeta_respaldos / f"almacen_{ahora:%Y-%m-%d_%H%M%S}_{motivo_limpio}.zip"
    with tempfile.TemporaryDirectory() as temporal:
        copia = Path(temporal) / NOMBRE_BD
        _copia_consistente(ruta_bd, copia)
        verificar_integridad(copia)
        parcial = destino.with_suffix(".zip.parcial")
        with zipfile.ZipFile(parcial, "w", zipfile.ZIP_DEFLATED) as archivo:
            archivo.write(copia, NOMBRE_BD)
            if carpeta_plantillas.exists():
                for plantilla in sorted(carpeta_plantillas.iterdir()):
                    if plantilla.is_file():
                        archivo.write(plantilla, f"plantillas/{plantilla.name}")
            archivo.writestr(
                MANIFIESTO,
                json.dumps(
                    {
                        "version_app": __version__,
                        "fecha_hora": ahora.isoformat(timespec="seconds"),
                        "motivo": motivo,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
        parcial.replace(destino)
    return destino


def listar_respaldos(carpeta: Path) -> list[InfoRespaldo]:
    """Respaldos del más reciente al más antiguo."""
    if not carpeta.exists():
        return []
    respaldos = []
    for ruta in carpeta.glob("almacen_*.zip"):
        coincidencia = _PATRON.match(ruta.name)
        if not coincidencia:
            continue
        fecha_hora = dt.datetime.strptime(
            f"{coincidencia.group(1)} {coincidencia.group(2)}", "%Y-%m-%d %H%M%S"
        )
        respaldos.append(
            InfoRespaldo(ruta, fecha_hora, coincidencia.group(3) or "", ruta.stat().st_size)
        )
    return sorted(respaldos, key=lambda r: r.fecha_hora, reverse=True)


def hay_respaldo_de_hoy(carpeta: Path) -> bool:
    hoy = dt.date.today()
    return any(r.fecha_hora.date() == hoy for r in listar_respaldos(carpeta))


def aplicar_retencion(carpeta: Path, diarios: int = 30, mensuales: int = 12) -> list[Path]:
    """Conserva el último respaldo de cada uno de los últimos `diarios` días y de los
    últimos `mensuales` meses. Devuelve los archivos eliminados."""
    respaldos = listar_respaldos(carpeta)
    conservar: set[Path] = set()
    dias: dict[dt.date, Path] = {}
    meses: dict[tuple[int, int], Path] = {}
    for r in respaldos:  # del más reciente al más antiguo
        dias.setdefault(r.fecha_hora.date(), r.ruta)
        meses.setdefault((r.fecha_hora.year, r.fecha_hora.month), r.ruta)
    conservar.update(list(dias.values())[:diarios])
    conservar.update(list(meses.values())[:mensuales])
    eliminados = []
    for r in respaldos:
        if r.ruta not in conservar:
            r.ruta.unlink()
            eliminados.append(r.ruta)
    return eliminados


def restaurar_respaldo(respaldo: Path, ruta_bd: Path, carpeta_plantillas: Path) -> None:
    """Reemplaza la base y las plantillas por las del respaldo.

    La base debe estar CERRADA. El llamador debe haber respaldado el estado actual antes.
    """
    with tempfile.TemporaryDirectory() as temporal:
        carpeta = Path(temporal)
        with zipfile.ZipFile(respaldo) as archivo:
            if NOMBRE_BD not in archivo.namelist():
                raise ErrorRespaldo("El archivo no contiene una base de datos.")
            archivo.extractall(carpeta)
        verificar_integridad(carpeta / NOMBRE_BD)
        ruta_bd.parent.mkdir(parents=True, exist_ok=True)
        for sufijo in ("-wal", "-shm"):
            residuo = ruta_bd.with_name(ruta_bd.name + sufijo)
            if residuo.exists():
                residuo.unlink()
        shutil.copy2(carpeta / NOMBRE_BD, ruta_bd)
        origen_plantillas = carpeta / "plantillas"
        if origen_plantillas.exists():
            carpeta_plantillas.mkdir(parents=True, exist_ok=True)
            for plantilla in origen_plantillas.iterdir():
                shutil.copy2(plantilla, carpeta_plantillas / plantilla.name)
