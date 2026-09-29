"""Páginas de archivos: exportar a Excel y respaldos."""

from __future__ import annotations

import logging

from nicegui import events, run, ui

from control_almacen.respaldo.respaldo import ErrorRespaldo, listar_respaldos
from control_almacen.servicios.exportacion import (
    SinPlantilla,
    exportar_inventario_del_dia,
    exportar_vales_del_dia,
)
from control_almacen.ui.estado import Estado
from control_almacen.ui.marco import abrir_carpeta, marco

log = logging.getLogger(__name__)


def registrar(estado: Estado) -> None:
    @ui.page("/exportar")
    def exportar() -> None:
        with marco(estado, "Exportar a Excel"):
            ui.markdown(
                "Los archivos se generan **sobre tu último archivo real** (plantilla), así conservan macros, botones, "
                f"logos y formato. Se guardan en `{estado.rutas.exportaciones}` en una carpeta por día."
            )
            resultado = ui.column().classes("w-full")

            async def hacer(funcion, nombre: str) -> None:
                def trabajo():
                    with estado.sesion() as s:
                        return funcion(
                            s, estado.rutas.plantillas, estado.rutas.exportaciones, estado.usuario
                        )

                try:
                    ruta = await run.io_bound(trabajo)
                except SinPlantilla as error:
                    ui.notify(str(error), type="warning")
                    return
                except Exception as error:
                    log.exception("Falló la exportación de %s", nombre)
                    ui.notify(
                        f"No se pudo exportar {nombre}: {error}", type="negative", multi_line=True
                    )
                    return
                with (
                    resultado,
                    ui.card().classes("w-full bg-green-50"),
                    ui.row().classes("items-center gap-3"),
                ):
                    ui.icon("task_alt", color="positive", size="md")
                    ui.label(f"{nombre} listo: {ruta}")
                    ui.button(
                        "Abrir carpeta", icon="folder_open", on_click=lambda: abrir_carpeta(ruta)
                    ).props("flat")
                    ui.button(
                        "Descargar", icon="download", on_click=lambda: ui.download.file(ruta)
                    ).props("flat")

            with ui.row().classes("w-full gap-4"):
                with ui.card().classes("flex-1"):
                    ui.label("Vales de salida").classes("text-lg font-semibold")
                    ui.label(
                        "VALES DE SALIDA DLTA.xlsm con la hoja DIARIO actualizada. Es el archivo que envías por correo a la base."
                    ).classes("text-sm text-gray-600")
                    ui.button(
                        "Exportar vales",
                        icon="receipt_long",
                        on_click=lambda: hacer(exportar_vales_del_dia, "Vales de salida"),
                    )
                with ui.card().classes("flex-1"):
                    ui.label("Inventario de refaccionamiento").classes("text-lg font-semibold")
                    ui.label(
                        "El Excel por contenedor con CONSUMO e INGRESO calculados desde los vales."
                    ).classes("text-sm text-gray-600")
                    ui.button(
                        "Exportar inventario",
                        icon="inventory_2",
                        on_click=lambda: hacer(exportar_inventario_del_dia, "Inventario"),
                    )

    @ui.page("/respaldos")
    def respaldos() -> None:
        with marco(estado, "Respaldos"):
            ui.markdown(
                f"Los respaldos se guardan en `{estado.rutas.respaldos}`. Se crean solos al abrir (uno por día) y al cerrar. "
                "Si reinstalas el equipo, restaura el más reciente."
            )
            tabla_contenedor = ui.column().classes("w-full")

            def dibujar() -> None:
                tabla_contenedor.clear()
                lista = listar_respaldos(estado.rutas.respaldos)
                with tabla_contenedor:
                    if not lista:
                        ui.label("Aún no hay respaldos.").classes("text-gray-600")
                    for info in lista[:60]:
                        with ui.row().classes("w-full items-center gap-4 border-b py-1"):
                            ui.label(info.fecha_hora.strftime("%d/%m/%Y %H:%M:%S")).classes("w-44")
                            ui.label(info.motivo).classes("w-48 text-gray-600")
                            ui.label(f"{info.tamano / 1024:,.0f} KB").classes(
                                "w-24 text-right text-gray-600"
                            )
                            ui.button(
                                "Restaurar", icon="restore", on_click=lambda i=info: confirmar(i)
                            ).props("flat dense color=accent")

            def confirmar(info) -> None:
                with ui.dialog() as dialogo, ui.card():
                    ui.label(
                        f"¿Restaurar el respaldo del {info.fecha_hora:%d/%m/%Y %H:%M}?"
                    ).classes("text-lg")
                    ui.label(
                        "Antes se respalda el estado actual, así que esta acción se puede deshacer."
                    ).classes("text-sm")
                    with ui.row():
                        ui.button(
                            "Restaurar", on_click=lambda: (dialogo.close(), restaurar(info))
                        ).props("color=accent")
                        ui.button("Cancelar", on_click=dialogo.close).props("flat")
                dialogo.open()

            async def restaurar(info) -> None:
                try:
                    await run.io_bound(estado.restaurar, info.ruta)
                except ErrorRespaldo as error:
                    ui.notify(str(error), type="negative")
                    return
                ui.notify("Respaldo restaurado", type="positive")
                ui.navigate.to("/")

            async def crear() -> None:
                ruta = await run.io_bound(estado.respaldar, "manual")
                ui.notify(
                    f"Respaldo creado: {ruta.name}" if ruta else "No hay datos que respaldar",
                    type="positive" if ruta else "warning",
                )
                dibujar()

            async def subir(e: events.UploadEventArguments) -> None:
                destino = estado.rutas.respaldos / e.file.name
                await e.file.save(destino)
                dibujar()
                ui.notify("Archivo agregado a la lista; usa 'Restaurar' para aplicarlo.")

            with ui.row().classes("gap-3 items-center"):
                ui.button("Crear respaldo ahora", icon="backup", on_click=crear)
                ui.button(
                    "Abrir carpeta",
                    icon="folder_open",
                    on_click=lambda: abrir_carpeta(estado.rutas.respaldos),
                ).props("flat")
                ui.upload(
                    label="Traer un respaldo de otra carpeta (.zip)",
                    auto_upload=True,
                    on_upload=subir,
                ).props('accept=".zip" flat bordered')
            dibujar()
