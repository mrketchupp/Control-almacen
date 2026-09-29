"""Marco común de todas las páginas: encabezado, menú lateral y usuario en turno."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from nicegui import ui

from control_almacen import __version__
from control_almacen.servicios import consultas
from control_almacen.ui.estado import Estado

MENU = [
    ("/", "Inicio", "home"),
    ("/inventario", "Inventario", "inventory_2"),
    ("/vales", "Historial de vales", "receipt_long"),
    ("/pendientes", "Pendientes", "rule"),
    ("/exportar", "Exportar a Excel", "file_download"),
    ("/respaldos", "Respaldos", "backup"),
]


@contextmanager
def marco(estado: Estado, titulo: str) -> Iterator[ui.column]:
    ui.colors(primary="#1F3864", secondary="#2E75B6", accent="#C55A11")
    ui.query("body").style("background-color: #F5F7FA")
    with estado.sesion() as s:
        resumen = consultas.resumen(s)
        nombres = consultas.almacenistas(s)
        en_turno = consultas.usuario_en_turno(s)

    with ui.header(elevated=True).classes("items-center justify-between px-4 py-2"):
        with ui.row().classes("items-center gap-3"):
            ui.button(icon="menu", on_click=lambda: menu.toggle()).props("flat round color=white")
            ui.label("Control de Almacén · RIG 91").classes("text-lg font-semibold")
        if nombres:
            opciones = sorted(set(nombres) | ({en_turno} if en_turno else set()))
            ui.select(
                opciones,
                value=en_turno,
                label="Almacenista en turno",
                on_change=lambda e: (
                    estado.fijar_usuario(e.value),
                    ui.notify(f"En turno: {e.value}"),
                ),
            ).props("dense outlined dark options-dense").classes("w-72 bg-white/10 rounded")

    with ui.left_drawer(value=True, bordered=True).classes("bg-white") as menu:
        destinos = (
            MENU
            if not resumen.vacia
            else [
                ("/", "Inicio", "home"),
                ("/primera-carga", "Primera carga", "upload_file"),
                ("/respaldos", "Respaldos", "backup"),
            ]
        )
        with ui.list().props("padding").classes("w-full"):
            for ruta, texto, icono in destinos:
                with ui.item(on_click=lambda r=ruta: ui.navigate.to(r)).props("clickable"):
                    with ui.item_section().props("avatar"):
                        ui.icon(icono, color="primary")
                    with ui.item_section():
                        ui.item_label(texto)
                    if ruta == "/pendientes" and resumen.por_ubicar:
                        with ui.item_section().props("side"):
                            ui.badge(str(resumen.por_ubicar), color="accent")
        ui.space()
        ui.label(f"Versión {__version__}").classes("text-xs text-gray-400 px-4 pb-2")

    with ui.column().classes("w-full max-w-7xl mx-auto p-4 gap-4") as contenido:
        ui.label(titulo).classes("text-2xl font-semibold text-gray-800")
        if nombres and not en_turno:
            with ui.row().classes("items-center gap-2 text-orange-800"):
                ui.icon("person_alert", color="accent")
                ui.label(
                    "Elige arriba a la derecha quién está en turno: se registra en cada movimiento."
                )
        yield contenido


def tarjeta(
    titulo: str, valor: str, detalle: str = "", icono: str = "info", alerta: bool = False
) -> None:
    color = "text-orange-700" if alerta else "text-gray-900"
    with ui.card().classes("min-w-56 flex-1"), ui.row().classes("items-start gap-3 no-wrap"):
        ui.icon(icono, size="md", color="accent" if alerta else "primary")
        with ui.column().classes("gap-0"):
            ui.label(titulo).classes("text-sm text-gray-500")
            ui.label(valor).classes(f"text-2xl font-semibold {color}")
            if detalle:
                ui.label(detalle).classes("text-xs text-gray-500")


def abrir_carpeta(ruta: Path) -> None:
    """Abre la carpeta en el explorador de archivos del sistema."""
    ruta = ruta if ruta.is_dir() else ruta.parent
    if sys.platform == "win32":
        os.startfile(ruta)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(ruta)])
    else:
        subprocess.Popen(
            ["xdg-open", str(ruta)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
