"""Rutas y parámetros de la aplicación.

La base de datos viva vive en la carpeta local del usuario de Windows
(%LOCALAPPDATA%\\ControlAlmacen). Los respaldos y exportaciones van a OneDrive
cuando está disponible. Las variables de entorno permiten redirigir todo
(pruebas y desarrollo).
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

NOMBRE_APP = "ControlAlmacen"
ALMACEN_AX_DEFECTO = "RIG91-IX25"

VAR_DATOS = "CONTROL_ALMACEN_DATOS"
VAR_RESPALDOS = "CONTROL_ALMACEN_RESPALDOS"
VAR_EXPORTACIONES = "CONTROL_ALMACEN_EXPORTACIONES"


def carpeta_datos_defecto() -> Path:
    """Carpeta de datos local (no sincronizada)."""
    if valor := os.environ.get(VAR_DATOS):
        return Path(valor)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / NOMBRE_APP
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "control-almacen"


def carpeta_onedrive() -> Path | None:
    """Carpeta raíz de OneDrive (empresarial o personal), si existe."""
    for variable in ("OneDriveCommercial", "OneDriveConsumer", "OneDrive"):
        valor = os.environ.get(variable)
        if valor and Path(valor).is_dir():
            return Path(valor)
    return None


@dataclass(frozen=True)
class Rutas:
    """Todas las rutas que usa la aplicación."""

    datos: Path
    respaldos: Path
    exportaciones: Path

    @property
    def base_datos(self) -> Path:
        return self.datos / "almacen.db"

    @property
    def plantillas(self) -> Path:
        return self.datos / "plantillas"

    @property
    def logs(self) -> Path:
        return self.datos / "logs"

    def crear_carpetas(self) -> None:
        for carpeta in (self.datos, self.plantillas, self.logs, self.respaldos, self.exportaciones):
            carpeta.mkdir(parents=True, exist_ok=True)

    @classmethod
    def desde_entorno(cls) -> Rutas:
        datos = carpeta_datos_defecto()
        onedrive = carpeta_onedrive()
        base_nube = onedrive / NOMBRE_APP if onedrive else datos
        respaldos = Path(os.environ.get(VAR_RESPALDOS) or base_nube / "respaldos")
        exportaciones = Path(os.environ.get(VAR_EXPORTACIONES) or base_nube / "exportaciones")
        return cls(datos=datos, respaldos=respaldos, exportaciones=exportaciones)
