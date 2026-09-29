"""Páginas de consulta: inventario, historial de vales y pendientes por ubicar."""

from __future__ import annotations

from nicegui import ui

from control_almacen.servicios import consultas
from control_almacen.ui.estado import Estado
from control_almacen.ui.marco import marco

COLUMNAS_INVENTARIO = [
    ("contenedor", "Cont.", "center"),
    ("clase", "Clase", "left"),
    ("codigo", "Código", "left"),
    ("descripcion", "Descripción", "left"),
    ("dimension", "Dimensión", "left"),
    ("np", "NP", "left"),
    ("um", "UM", "center"),
    ("cantidad", "Cantidad", "right"),
    ("consumo", "Consumo", "right"),
    ("ingreso", "Ingreso", "right"),
    ("total", "Total", "right"),
]
COLUMNAS_VALES = [
    ("folio", "Folio", "left"),
    ("fecha", "Fecha", "left"),
    ("depto", "Depto. destino", "left"),
    ("destino", "Destino", "left"),
    ("recibio", "Recibió", "left"),
    ("cantidad", "Cant.", "right"),
    ("um", "UM", "center"),
    ("codigo", "Código", "left"),
    ("descripcion", "Descripción", "left"),
    ("clave", "Clave", "left"),
    ("oc", "O.C.", "left"),
]


def _columnas(definicion) -> list[dict]:
    return [
        {"name": k, "label": t, "field": k, "align": a, "sortable": True} for k, t, a in definicion
    ]


def registrar(estado: Estado) -> None:
    @ui.page("/inventario")
    def inventario() -> None:
        with estado.sesion() as s:
            filas = consultas.filas_inventario(s)
        with marco(estado, "Inventario por contenedor"):
            with ui.row().classes("w-full items-end gap-4"):
                buscar = (
                    ui.input("Buscar (código, descripción, dimensión, NP)")
                    .props("clearable outlined dense")
                    .classes("w-96")
                )
                contenedor = (
                    ui.select(
                        {
                            0: "Todos",
                            **{
                                i: f"Contenedor {i}"
                                for i in sorted({f["contenedor"] for f in filas})
                            },
                        },
                        value=0,
                        label="Contenedor",
                    )
                    .props("outlined dense")
                    .classes("w-48")
                )
                clase = (
                    ui.select(
                        ["Todas", "Inventariable", "Consumible"], value="Todas", label="Clase"
                    )
                    .props("outlined dense")
                    .classes("w-48")
                )
                solo_con_movimiento = ui.checkbox("Solo con consumo o ingreso")
            resumen = ui.label().classes("text-sm text-gray-600")
            tabla = (
                ui.table(
                    columns=_columnas(COLUMNAS_INVENTARIO), rows=filas, row_key="id", pagination=25
                )
                .classes("w-full")
                .props("dense flat bordered")
            )
            tabla.add_slot(
                "body-cell-descripcion",
                r"""<q-td :props="props">{{ props.value }}<q-icon v-if="props.row.nota" name="sticky_note_2" color="orange" class="q-ml-xs"><q-tooltip>{{ props.row.nota }}</q-tooltip></q-icon></q-td>""",
            )
            buscar.bind_value_to(tabla, "filter")

            def filtrar() -> None:
                visibles = [
                    f
                    for f in filas
                    if (not contenedor.value or f["contenedor"] == contenedor.value)
                    and (clase.value == "Todas" or f["clase"] == clase.value)
                    and (not solo_con_movimiento.value or f["consumo"] or f["ingreso"])
                ]
                tabla.rows = visibles
                con_existencia = sum(1 for f in visibles if f["total"])
                resumen.text = f"{len(visibles)} renglones · {con_existencia} con existencia"

            for control in (contenedor, clase, solo_con_movimiento):
                control.on_value_change(filtrar)
            filtrar()

    @ui.page("/vales")
    def vales() -> None:
        with estado.sesion() as s:
            filas = consultas.filas_historial(s)
        with marco(estado, "Historial de vales de salida (DIARIO)"):
            buscar = (
                ui.input("Buscar (folio, artículo, persona, departamento…)")
                .props("clearable outlined dense")
                .classes("w-96")
            )
            ui.label(f"{len({f['folio'] for f in filas})} vales · {len(filas)} renglones").classes(
                "text-sm text-gray-600"
            )
            tabla = (
                ui.table(columns=_columnas(COLUMNAS_VALES), rows=filas, row_key="id", pagination=30)
                .classes("w-full")
                .props("dense flat bordered")
            )
            tabla.add_slot(
                "body-cell-descripcion",
                r"""<q-td :props="props">{{ props.value }}<q-icon v-if="props.row.notas" name="info" color="grey" class="q-ml-xs"><q-tooltip style="white-space: pre-line">{{ props.row.notas }}</q-tooltip></q-icon></q-td>""",
            )
            buscar.bind_value_to(tabla, "filter")

    @ui.page("/pendientes")
    def pendientes() -> None:
        with marco(estado, "Pendientes por ubicar"):
            ui.markdown(
                "Estos renglones de vale son **posteriores al conteo base**, pero no se pudo saber automáticamente "
                "de qué renglón del inventario salieron (la dimensión no coincide o el artículo está en varios contenedores). "
                "Elige el renglón correcto o márcalo como **no inventariado** (no descuenta existencia)."
            )
            lista = ui.column().classes("w-full gap-3")

            def dibujar() -> None:
                lista.clear()
                with estado.sesion() as s:
                    lineas = consultas.lineas_por_ubicar(s)
                with lista:
                    if not lineas:
                        with ui.row().classes("items-center gap-2"):
                            ui.icon("check_circle", color="positive", size="md")
                            ui.label("No hay pendientes.")
                        return
                    for linea in lineas:
                        _tarjeta_pendiente(linea)

            def _tarjeta_pendiente(linea: dict) -> None:
                opciones = {
                    c["id"]: ("★ " if c["coincide"] else "") + c["etiqueta"]
                    for c in linea["candidatos"]
                }
                opciones[-1] = "No inventariado (no descuenta existencia)"
                with (
                    ui.card().classes("w-full"),
                    ui.row().classes("w-full items-center gap-4 no-wrap"),
                ):
                    with ui.column().classes("gap-0 min-w-72"):
                        ui.label(f"Vale {linea['folio']} · renglón {linea['renglon']}").classes(
                            "font-semibold"
                        )
                        ui.label(
                            f"{linea['cantidad']} × {linea['codigo']} {linea['descripcion']}"
                        ).classes("text-sm")
                        ui.label(f"Clave en el vale: {linea['clave'] or '—'}").classes(
                            "text-xs text-gray-500"
                        )
                    seleccion = (
                        ui.select(opciones, label="Renglón del inventario")
                        .props("outlined dense")
                        .classes("flex-1")
                    )

                    def guardar(linea_id=linea["id"], control=seleccion) -> None:
                        if control.value is None:
                            ui.notify("Elige una opción", type="warning")
                            return
                        with estado.sesion() as s:
                            consultas.ubicar_linea(
                                s,
                                linea_id,
                                None if control.value == -1 else control.value,
                                estado.usuario,
                            )
                        ui.notify("Guardado", type="positive")
                        dibujar()

                    ui.button("Guardar", icon="save", on_click=guardar)

            dibujar()
