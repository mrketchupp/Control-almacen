"""Estado compartido de la aplicación: rutas, base de datos y usuario en turno."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path

from control_almacen.config import Rutas
from control_almacen.db.sesion import BaseDatos
from control_almacen.respaldo import respaldo
from control_almacen.servicios import consultas

log = logging.getLogger(__name__)


class Estado:
    def __init__(self, rutas: Rutas) -> None:
        self.rutas = rutas
        rutas.crear_carpetas()
        self.bd = BaseDatos(rutas.base_datos)

    @contextmanager
    def sesion(self):
        with self.bd.sesion() as sesion:
            yield sesion

    @property
    def usuario(self) -> str | None:
        with self.sesion() as s:
            return consultas.usuario_en_turno(s)

    def fijar_usuario(self, nombre: str) -> None:
        with self.sesion() as s:
            consultas.fijar_usuario_en_turno(s, nombre)

    def base_vacia(self) -> bool:
        with self.sesion() as s:
            return consultas.resumen(s).vacia

    # ------------------------------------------------------------ respaldos

    def respaldar(self, motivo: str) -> Path | None:
        if self.base_vacia():
            return None
        ruta = respaldo.crear_respaldo(
            self.rutas.base_datos, self.rutas.plantillas, self.rutas.respaldos, motivo
        )
        respaldo.aplicar_retencion(self.rutas.respaldos)
        log.info("Respaldo creado: %s", ruta)
        return ruta

    def respaldo_diario(self) -> None:
        if not respaldo.hay_respaldo_de_hoy(self.rutas.respaldos):
            try:
                self.respaldar("diario")
            except Exception:  # un respaldo fallido no debe impedir trabajar
                log.exception("No se pudo crear el respaldo diario")

    def restaurar(self, archivo: Path) -> None:
        """Respalda lo actual, cierra la base, restaura y vuelve a abrir."""
        if not self.base_vacia():
            self.respaldar("antes-de-restaurar")
        self.bd.cerrar()
        try:
            respaldo.restaurar_respaldo(archivo, self.rutas.base_datos, self.rutas.plantillas)
        finally:
            self.bd = BaseDatos(self.rutas.base_datos)
        log.info("Respaldo restaurado: %s", archivo)
