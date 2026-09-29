"""Punto de entrada de la aplicación de escritorio."""

from __future__ import annotations

import argparse
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from control_almacen import __version__
from control_almacen.config import Rutas


def configurar_registro(rutas: Rutas) -> None:
    rutas.logs.mkdir(parents=True, exist_ok=True)
    manejador = RotatingFileHandler(
        rutas.logs / "app.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8"
    )
    manejador.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    manejadores: list[logging.Handler] = [manejador]
    if sys.stderr is not None:
        manejadores.append(logging.StreamHandler(sys.stderr))
    logging.basicConfig(level=logging.INFO, handlers=manejadores)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="control-almacen", description="Control de almacén del RIG 91"
    )
    parser.add_argument(
        "--navegador", action="store_true", help="abrir en el navegador en lugar de ventana propia"
    )
    parser.add_argument("--puerto", type=int, default=8765, help="puerto en modo navegador")
    parser.add_argument("--sin-abrir", action="store_true", help="no abrir el navegador (pruebas)")
    argumentos = parser.parse_args(argv)

    rutas = Rutas.desde_entorno()
    rutas.crear_carpetas()
    configurar_registro(rutas)
    log = logging.getLogger("control_almacen")
    log.info("Iniciando Control de Almacén %s · datos en %s", __version__, rutas.datos)

    from nicegui import app, ui

    from control_almacen.ui import archivos, consultas_ui, inicio, primera_carga
    from control_almacen.ui.estado import Estado

    estado = Estado(rutas)
    estado.respaldo_diario()
    for modulo in (inicio, primera_carga, consultas_ui, archivos):
        modulo.registrar(estado)

    def al_cerrar() -> None:
        try:
            estado.respaldar("cierre")
        except Exception:
            log.exception("No se pudo crear el respaldo al cerrar")
        estado.bd.cerrar()

    app.on_shutdown(al_cerrar)
    nativo = not argumentos.navegador
    if nativo:
        app.native.settings["ALLOW_DOWNLOADS"] = True
    ui.run(
        title="Control de Almacén · RIG 91",
        native=nativo,
        window_size=(1366, 860) if nativo else None,
        port=None if nativo else argumentos.puerto,
        reload=False,
        show=not argumentos.sin_abrir,
        language="es",
        favicon=Path(__file__).parent / "ui" / "icono.png",
        show_welcome_message=False,
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
