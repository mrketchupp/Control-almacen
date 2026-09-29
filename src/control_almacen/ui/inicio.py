"""Página de inicio: resumen y alertas."""

from __future__ import annotations

from nicegui import ui

from control_almacen.respaldo.respaldo import listar_respaldos
from control_almacen.servicios import consultas
from control_almacen.ui.estado import Estado
from control_almacen.ui.marco import marco, tarjeta


def registrar(estado: Estado) -> None:
    @ui.page("/")
    def inicio() -> None:
        with estado.sesion() as s:
            r = consultas.resumen(s)
        respaldos = listar_respaldos(estado.rutas.respaldos)
        with marco(estado, "Inicio"):
            if r.vacia:
                _bienvenida()
                return
            with ui.row().classes("w-full gap-4"):
                tarjeta(
                    "Renglones de inventario",
                    f"{r.existencias:,}",
                    f"{r.ubicaciones} hojas / contenedores",
                    "inventory_2",
                )
                tarjeta(
                    "Artículos en catálogo",
                    f"{r.articulos:,}",
                    f"{r.por_confirmar} por confirmar con AX" if r.por_confirmar else "",
                    "category",
                    alerta=bool(r.por_confirmar),
                )
                tarjeta(
                    "Último vale de salida",
                    f"Folio {r.ultimo_folio}" if r.ultimo_folio else "—",
                    r.fecha_ultimo_vale.strftime("%d/%m/%Y") if r.fecha_ultimo_vale else "",
                    "receipt_long",
                )
                tarjeta(
                    "Conteo base",
                    r.conteo_fecha.strftime("%d/%m/%Y") if r.conteo_fecha else "—",
                    f"descuentan los folios mayores a {r.conteo_folio}"
                    if r.conteo_folio is not None
                    else "",
                    "fact_check",
                )
            with ui.row().classes("w-full gap-4"):
                tarjeta(
                    "Pendientes por ubicar",
                    str(r.por_ubicar),
                    "renglones de vale sin renglón de inventario"
                    if r.por_ubicar
                    else "todo ubicado",
                    "rule",
                    alerta=bool(r.por_ubicar),
                )
                exportado = r.ultima_exportacion.get("VALES")
                tarjeta(
                    "Última exportación de vales",
                    exportado.strftime("%d/%m/%Y %H:%M") if exportado else "Nunca",
                    "",
                    "file_download",
                )
                ultimo = respaldos[0] if respaldos else None
                tarjeta(
                    "Último respaldo",
                    ultimo.fecha_hora.strftime("%d/%m/%Y %H:%M") if ultimo else "Ninguno",
                    "\\".join(estado.rutas.respaldos.parts[-3:]),
                    "backup",
                    alerta=ultimo is None,
                )
            if r.por_ubicar:
                with (
                    ui.card().classes("w-full bg-orange-50"),
                    ui.row().classes("items-center gap-3"),
                ):
                    ui.icon("warning", color="accent")
                    ui.label(
                        f"Hay {r.por_ubicar} renglón(es) de vale posteriores al conteo que no se sabe de qué "
                        "renglón del inventario salieron. Hasta resolverlos, no se descuentan."
                    )
                    ui.button("Resolver", on_click=lambda: ui.navigate.to("/pendientes")).props(
                        "color=accent"
                    )


def _bienvenida() -> None:
    with ui.card().classes("w-full max-w-3xl p-6"):
        ui.label("La herramienta está vacía").classes("text-xl font-semibold")
        ui.markdown(
            "Se instaló sin datos. Para empezar hay dos caminos:\n\n"
            "1. **Primera carga:** importar tus archivos actuales de Excel (inventario y vales). "
            "Los archivos originales no se modifican.\n"
            "2. **Restaurar un respaldo:** si reinstalaste el equipo, recupera tus datos desde OneDrive."
        )
        with ui.row().classes("gap-3 mt-2"):
            ui.button(
                "Primera carga",
                icon="upload_file",
                on_click=lambda: ui.navigate.to("/primera-carga"),
            )
            ui.button(
                "Restaurar respaldo", icon="restore", on_click=lambda: ui.navigate.to("/respaldos")
            ).props("outline")
