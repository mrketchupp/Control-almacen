"""Conexión a SQLite y aplicación de migraciones (Alembic)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as ConfigAlembic
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

CARPETA_MIGRACIONES = Path(__file__).parent / "migraciones"


def crear_motor(ruta: Path) -> Engine:
    """Motor SQLite con llaves foráneas activas y modo WAL."""
    motor = create_engine(f"sqlite:///{ruta}")

    @event.listens_for(motor, "connect")
    def _pragmas(conexion, _registro):
        cursor = conexion.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return motor


def config_alembic(motor: Engine) -> ConfigAlembic:
    """Configuración de Alembic sin URL: siempre se le pasa la conexión abierta.

    No se usa set_main_option("sqlalchemy.url"): en Windows la ruta se codifica con '%'
    (C%3A%5C…) y configparser la interpreta como variable, lo que rompía el arranque.
    """
    config = ConfigAlembic()
    config.set_main_option("script_location", str(CARPETA_MIGRACIONES).replace("%", "%%"))
    return config


def migrar(motor: Engine) -> None:
    """Lleva el esquema a la última versión."""
    config = config_alembic(motor)
    with motor.begin() as conexion:
        config.attributes["connection"] = conexion
        command.upgrade(config, "head")


class BaseDatos:
    """Punto de acceso único a la base de datos."""

    def __init__(self, ruta: Path) -> None:
        self.ruta = ruta
        ruta.parent.mkdir(parents=True, exist_ok=True)
        self.motor = crear_motor(ruta)
        migrar(self.motor)
        self._fabrica = sessionmaker(self.motor, expire_on_commit=False)

    @contextmanager
    def sesion(self) -> Iterator[Session]:
        """Sesión transaccional: confirma al salir o revierte ante error."""
        sesion = self._fabrica()
        try:
            yield sesion
            sesion.commit()
        except Exception:
            sesion.rollback()
            raise
        finally:
            sesion.close()

    def cerrar(self) -> None:
        self.motor.dispose()
