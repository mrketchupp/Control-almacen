"""Asistente de primera carga: archivos → revisión (opcional) → conteo base → ensayo → carga."""

from __future__ import annotations

import datetime as dt
import logging
import shutil
import tempfile
from pathlib import Path

from nicegui import events, run, ui

from control_almacen.db.sesion import BaseDatos
from control_almacen.importadores.inventario_fisico import leer_inventario
from control_almacen.importadores.vales import leer_vales
from control_almacen.servicios import revision as rv
from control_almacen.servicios.primera_carga import (
    OpcionesPrimeraCarga,
    ReporteCarga,
    ejecutar_primera_carga,
    fecha_desde_nombre,
    sugerir_folio_corte,
)
from control_almacen.ui.estado import Estado
from control_almacen.ui.marco import abrir_carpeta, marco

log = logging.getLogger(__name__)


class Asistente:
    def __init__(self, estado: Estado) -> None:
        self.estado = estado
        self.entrada = estado.rutas.datos / "entrada"
        self.entrada.mkdir(parents=True, exist_ok=True)
        self.inventario: Path | None = None
        self.vales: Path | None = None
        self.revision: Path | None = None
        self.respuestas = None
        self.libro_vales = None
        self.fecha = dt.date.today()
        self.folio_corte: int | None = None
        self.reporte: ReporteCarga | None = None

    def opciones(self, carpeta_plantillas: Path | None) -> OpcionesPrimeraCarga:
        return OpcionesPrimeraCarga(
            ruta_inventario=self.inventario,
            ruta_vales=self.vales,
            folio_corte=int(self.folio_corte or 0),
            fecha_conteo=self.fecha,
            usuario=self.estado.usuario,
            respuestas=self.respuestas,
            carpeta_plantillas=carpeta_plantillas,
        )


def registrar(estado: Estado) -> None:
    @ui.page("/primera-carga")
    def pagina() -> None:
        with marco(estado, "Primera carga"):
            if not estado.base_vacia():
                ui.label(
                    "La base ya tiene datos. La primera carga solo se hace una vez, sobre una base vacía."
                )
                return
            construir(estado)


def construir(estado: Estado) -> None:
    a = Asistente(estado)

    with ui.stepper().props("vertical animated").classes("w-full") as pasos:
        # ------------------------------------------------ 1. archivos
        with ui.step("Tus archivos de Excel"):
            ui.markdown(
                "Sube tu **inventario de refaccionamiento** (.xlsx) y tu **libro de vales** (.xlsm). "
                "Se copian a la carpeta de la herramienta; los originales no se tocan."
            )
            info_inv = ui.label().classes("text-sm text-gray-600")
            info_val = ui.label().classes("text-sm text-gray-600")

            async def subir_inventario(e: events.UploadEventArguments) -> None:
                destino = a.entrada / e.file.name
                await e.file.save(destino)
                try:
                    libro = await run.io_bound(leer_inventario, destino)
                except Exception as error:
                    ui.notify(
                        f"No se pudo leer el inventario: {error}", type="negative", multi_line=True
                    )
                    return
                a.inventario = destino
                a.fecha = fecha_desde_nombre(destino.name) or a.fecha
                fecha.value = a.fecha.isoformat()
                total = sum(len(h.renglones) for h in libro.hojas)
                info_inv.text = (
                    f"Inventario: {destino.name} · {len(libro.hojas)} hojas · {total} renglones"
                )
                _actualizar_corte()

            async def subir_vales(e: events.UploadEventArguments) -> None:
                destino = a.entrada / e.file.name
                await e.file.save(destino)
                try:
                    a.libro_vales = await run.io_bound(leer_vales, destino)
                except Exception as error:
                    ui.notify(
                        f"No se pudo leer el libro de vales: {error}",
                        type="negative",
                        multi_line=True,
                    )
                    return
                a.vales = destino
                folios = sorted({r.folio for r in a.libro_vales.renglones if r.folio})
                info_val.text = (
                    f"Vales: {destino.name} · {len(a.libro_vales.renglones)} renglones · "
                    f"folios {folios[0]}–{folios[-1]}"
                    if folios
                    else f"Vales: {destino.name}"
                )
                _actualizar_corte()

            with ui.row().classes("gap-6"):
                ui.upload(
                    label="Inventario (.xlsx)", auto_upload=True, on_upload=subir_inventario
                ).props('accept=".xlsx" flat bordered')
                ui.upload(label="Vales (.xlsm)", auto_upload=True, on_upload=subir_vales).props(
                    'accept=".xlsm" flat bordered'
                )
            with ui.stepper_navigation():
                ui.button(
                    "Siguiente",
                    on_click=lambda: _siguiente_si(
                        a.inventario and a.vales, pasos, "Sube los dos archivos."
                    ),
                )

        # ------------------------------------------------ 2. revisión
        with ui.step("Lista de revisión (opcional)"):
            ui.markdown(
                "La herramienta detecta renglones con datos perdidos (#REF!), duplicados, nombres escritos distinto, etc. "
                "Puedes **generar la lista**, contestarla en Excel con tus PDF escaneados y **subirla**. "
                "Si no subes nada, se aplican solo las limpiezas automáticas."
            )
            estado_revision = ui.label().classes("text-sm text-gray-600")

            async def generar() -> None:
                inventario = await run.io_bound(leer_inventario, a.inventario)
                catalogo = dict(inventario.catalogo)
                for codigo, descripcion in a.libro_vales.catalogo.items():
                    catalogo.setdefault(codigo, descripcion)
                carpeta = estado.rutas.exportaciones / "revision"
                carpeta.mkdir(parents=True, exist_ok=True)
                destino = carpeta / f"Revision_historial_{dt.date.today():%Y-%m-%d}.xlsx"
                await run.io_bound(
                    rv.generar_revision, a.libro_vales, inventario, catalogo, destino
                )
                estado_revision.text = f"Lista generada en: {destino}"
                ui.download.file(destino)
                ui.notify("Lista de revisión generada", type="positive")

            async def subir_revision(e: events.UploadEventArguments) -> None:
                destino = a.entrada / e.file.name
                await e.file.save(destino)
                try:
                    a.respuestas = rv.leer_revision(destino, a.libro_vales.renglones)
                except rv.ErrorRevision as error:
                    ui.notify(str(error), type="negative")
                    return
                r = a.respuestas
                estado_revision.text = (
                    f"Respuestas cargadas: {len(r.correcciones)} renglones corregidos · {len(r.eliminar)} a eliminar · "
                    f"{len(r.alias)} nombres unificados · {len(r.normalizaciones)} valores normalizados · "
                    f"{len(r.codigos)} códigos · {len(r.advertencias)} avisos"
                )

            with ui.row().classes("gap-4 items-center"):
                ui.button("Generar lista de revisión", icon="checklist", on_click=generar).props(
                    "outline"
                )
                ui.button(
                    "Abrir carpeta",
                    icon="folder_open",
                    on_click=lambda: abrir_carpeta(estado.rutas.exportaciones / "revision"),
                ).props("flat")
                ui.upload(
                    label="Subir lista contestada", auto_upload=True, on_upload=subir_revision
                ).props('accept=".xlsx" flat bordered')
            with ui.stepper_navigation():
                ui.button("Siguiente", on_click=pasos.next)
                ui.button("Atrás", on_click=pasos.previous).props("flat")

        # ------------------------------------------------ 3. conteo base
        with ui.step("Conteo base"):
            ui.markdown(
                "El inventario que subiste es la **foto física** en una fecha. Los vales con folio **mayor** "
                "al folio de corte se descontarán de esa foto; los anteriores quedan solo como historial."
            )
            with ui.row().classes("gap-6 items-end"):
                fecha = ui.input("Fecha del conteo", value=a.fecha.isoformat()).props(
                    "type=date outlined"
                )
                corte = ui.number(
                    "Folio de corte (último ya reflejado)", value=None, format="%d", min=0
                ).props("outlined")
            sugerencia = ui.label().classes("text-sm text-gray-600")

            def _actualizar_corte() -> None:
                if a.libro_vales is None:
                    return
                sugerido = sugerir_folio_corte(a.libro_vales.renglones, a.fecha)
                if sugerido is not None:
                    corte.value = sugerido
                    sugerencia.text = f"Sugerido: {sugerido} (último folio con fecha anterior al {a.fecha:%d/%m/%Y})"

            def _cambiar_fecha(e) -> None:
                try:
                    a.fecha = dt.date.fromisoformat(e.value)
                except (TypeError, ValueError):
                    return
                _actualizar_corte()

            fecha.on_value_change(_cambiar_fecha)
            with ui.stepper_navigation():
                ui.button(
                    "Siguiente",
                    on_click=lambda: (setattr(a, "folio_corte", corte.value), pasos.next()),
                )
                ui.button("Atrás", on_click=pasos.previous).props("flat")

        # ------------------------------------------------ 4. ensayo
        with ui.step("Ensayo"):
            ui.markdown(
                "Se hace una carga de **prueba** en una base temporal y se muestra el reporte de verificación. "
                "Nada se guarda todavía."
            )
            contenedor_reporte = ui.column().classes("w-full")

            async def ensayar() -> None:
                a.folio_corte = corte.value
                contenedor_reporte.clear()
                with contenedor_reporte:
                    ui.spinner(size="lg")
                try:
                    a.reporte = await run.io_bound(_ensayo, a)
                except Exception as error:
                    log.exception("Falló el ensayo")
                    contenedor_reporte.clear()
                    ui.notify(f"El ensayo falló: {error}", type="negative", multi_line=True)
                    return
                contenedor_reporte.clear()
                with contenedor_reporte:
                    mostrar_reporte(a.reporte)

            with ui.stepper_navigation():
                ui.button("Ejecutar ensayo", icon="science", on_click=ensayar)
                ui.button(
                    "Siguiente",
                    on_click=lambda: _siguiente_si(a.reporte, pasos, "Primero ejecuta el ensayo."),
                )
                ui.button("Atrás", on_click=pasos.previous).props("flat")

        # ------------------------------------------------ 5. carga definitiva
        with ui.step("Cargar"):
            ui.markdown(
                "Se carga todo en la base de la herramienta, se registran tus archivos como **plantillas** para exportar "
                "y se crea el primer respaldo. Después podrás resolver los pendientes."
            )

            async def cargar() -> None:
                boton.disable()
                try:
                    await run.io_bound(
                        ejecutar_primera_carga, estado.bd, a.opciones(estado.rutas.plantillas)
                    )
                    await run.io_bound(estado.respaldar, "primera-carga")
                except Exception as error:
                    log.exception("Falló la primera carga")
                    ui.notify(f"No se pudo cargar: {error}", type="negative", multi_line=True)
                    boton.enable()
                    return
                ui.notify("Primera carga terminada", type="positive")
                ui.navigate.to("/")

            with ui.stepper_navigation():
                boton = ui.button("Cargar definitivamente", icon="done_all", on_click=cargar).props(
                    "color=positive"
                )
                ui.button("Atrás", on_click=pasos.previous).props("flat")


def _siguiente_si(condicion, pasos, mensaje: str) -> None:
    if condicion:
        pasos.next()
    else:
        ui.notify(mensaje, type="warning")


def _ensayo(a: Asistente) -> ReporteCarga:
    with tempfile.TemporaryDirectory() as carpeta:
        bd = BaseDatos(Path(carpeta) / "ensayo.db")
        try:
            return ejecutar_primera_carga(bd, a.opciones(None))
        finally:
            bd.cerrar()
            shutil.rmtree(carpeta, ignore_errors=True)


def mostrar_reporte(r: ReporteCarga) -> None:
    color = "positive" if r.cuadra else "warning"
    with ui.row().classes("items-center gap-2"):
        ui.icon("check_circle" if r.cuadra else "info", color=color, size="md")
        ui.label(
            "El inventario calculado cuadra con tu archivo."
            if r.cuadra
            else "Hay diferencias entre el archivo y lo calculado con los vales: revísalas abajo."
        ).classes("text-base")
    ui.markdown(
        f"- **{r.existencias}** renglones de inventario · **{r.variantes}** variantes · **{r.articulos}** artículos\n"
        f"- **{r.vales}** vales migrados con **{r.lineas_migradas}** renglones (de {r.renglones_diario} en DIARIO)\n"
        f"- **{len(r.omitidos)}** renglones omitidos · **{len(r.correcciones)}** correcciones aplicadas · "
        f"folios faltantes: {', '.join(map(str, r.folios_faltantes)) or 'ninguno'}\n"
        f"- Renglones posteriores al corte ubicados automáticamente: **{r.lineas_ubicadas}** · por ubicar: **{len(r.por_ubicar)}**\n"
        f"- **{r.personas}** personas · **{r.plantillas_area}** plantillas por área"
    )
    with ui.expansion("Totales por hoja", icon="table_chart", value=True).classes("w-full"):
        ui.table(
            columns=[
                {"name": "hoja", "label": "Hoja", "field": "hoja", "align": "left"},
                {"name": "renglones", "label": "Renglones", "field": "renglones"},
                {"name": "archivo", "label": "TOTAL en archivo", "field": "archivo"},
                {"name": "calculado", "label": "TOTAL calculado", "field": "calculado"},
                {"name": "ok", "label": "", "field": "ok"},
            ],
            rows=[
                {
                    "hoja": h.hoja,
                    "renglones": h.renglones,
                    "archivo": str(h.total_archivo),
                    "calculado": str(h.total_calculado),
                    "ok": "✔" if h.total_archivo == h.total_calculado else "≠",
                }
                for h in r.hojas
            ],
            row_key="hoja",
        ).classes("w-full").props("dense flat")
    if r.diferencias:
        with ui.expansion(
            f"Diferencias por renglón ({len(r.diferencias)})", icon="compare_arrows"
        ).classes("w-full"):
            ui.label(
                "CONSUMO/INGRESO que dice el archivo contra lo que resulta de los vales posteriores al corte."
            ).classes("text-sm")
            ui.table(
                columns=[
                    {"name": k, "label": t, "field": k, "align": "left"}
                    for k, t in (
                        ("hoja", "Hoja"),
                        ("fila", "Fila"),
                        ("codigo", "Código"),
                        ("dimension", "Dimensión"),
                        ("consumo", "Consumo archivo → calculado"),
                        ("ingreso", "Ingreso archivo → calculado"),
                    )
                ],
                rows=[
                    {
                        "hoja": d.hoja.strip(),
                        "fila": d.fila,
                        "codigo": d.codigo,
                        "dimension": d.dimension or "",
                        "consumo": f"{d.archivo_consumo} → {d.calculado_consumo}",
                        "ingreso": f"{d.archivo_ingreso} → {d.calculado_ingreso}",
                    }
                    for d in r.diferencias
                ],
                row_key="fila",
            ).classes("w-full").props("dense flat")
    if r.por_ubicar:
        with ui.expansion(f"Renglones por ubicar ({len(r.por_ubicar)})", icon="rule").classes(
            "w-full"
        ):
            ui.label(
                "Vales posteriores al corte cuyo código existe en el inventario pero no se pudo saber de qué renglón salieron. Se resuelven después en 'Pendientes'."
            ).classes("text-sm")
            ui.table(
                columns=[
                    {"name": k, "label": t, "field": k, "align": "left"}
                    for k, t in (
                        ("folio", "Folio"),
                        ("codigo", "Código"),
                        ("descripcion", "Descripción"),
                        ("clave", "Clave"),
                        ("cantidad", "Cantidad"),
                        ("candidatos", "Coincidencias"),
                    )
                ],
                rows=[{**p.__dict__, "cantidad": str(p.cantidad)} for p in r.por_ubicar],
                row_key="renglon",
            ).classes("w-full").props("dense flat")
    if r.omitidos or r.correcciones:
        with ui.expansion(
            f"Omitidos y correcciones ({len(r.omitidos)} / {len(r.correcciones)})", icon="build"
        ).classes("w-full"):
            for fila, motivo in r.omitidos:
                ui.label(f"Fila {fila}: {motivo}").classes("text-sm")
            for fila, campo, antes, despues in r.correcciones[:300]:
                ui.label(f"Fila {fila} · {campo}: {antes!s} → {despues!s}").classes(
                    "text-sm text-gray-600"
                )
    if r.articulos_por_confirmar:
        with ui.expansion(
            f"Artículos por confirmar con AX ({len(r.articulos_por_confirmar)})", icon="help"
        ).classes("w-full"):
            for codigo, descripcion in r.articulos_por_confirmar:
                ui.label(f"{codigo} · {descripcion}").classes("text-sm")
    for aviso in r.advertencias:
        ui.label(f"Aviso: {aviso}").classes("text-sm text-orange-700")
