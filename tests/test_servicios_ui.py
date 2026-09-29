"""Servicios que usa la interfaz: consultas, pendientes, exportación con registro."""

import datetime as dt
import zipfile

import pytest
from sqlalchemy import select

from control_almacen.db import modelos as m
from control_almacen.importadores.vales import leer_vales
from control_almacen.servicios import consultas
from control_almacen.servicios.exportacion import (
    SinPlantilla,
    exportar_inventario_del_dia,
    exportar_vales_del_dia,
    nombre_con_fecha,
)
from control_almacen.servicios.primera_carga import (
    OpcionesPrimeraCarga,
    ejecutar_primera_carga,
    sugerir_folio_corte,
)
from tests.fixtures.generar import FOLIO_CORTE


@pytest.fixture
def cargada(bd, archivos, tmp_path):
    ejecutar_primera_carga(
        bd,
        OpcionesPrimeraCarga(
            ruta_inventario=archivos["inventario"],
            ruta_vales=archivos["vales"],
            folio_corte=FOLIO_CORTE,
            fecha_conteo=dt.date(2026, 9, 3),
            carpeta_plantillas=tmp_path / "plantillas",
        ),
    )
    return bd


def test_base_vacia(bd):
    with bd.sesion() as s:
        assert consultas.resumen(s).vacia


def test_resumen(cargada):
    with cargada.sesion() as s:
        r = consultas.resumen(s)
    assert not r.vacia
    assert (r.existencias, r.ultimo_folio, r.conteo_folio, r.por_ubicar) == (14, 9, FOLIO_CORTE, 2)


def test_filas_inventario_y_historial(cargada):
    with cargada.sesion() as s:
        inventario = consultas.filas_inventario(s)
        historial = consultas.filas_historial(s)
    sellos = next(f for f in inventario if f["codigo"] == 706)
    assert (sellos["cantidad"], sellos["consumo"], sellos["total"]) == (2, 1, 1)
    assert len(historial) == 13
    assert historial[0]["folio"] == 9  # más reciente primero


def test_resolver_pendiente(cargada):
    with cargada.sesion() as s:
        pendiente = next(p for p in consultas.lineas_por_ubicar(s) if p["codigo"] == 701)
        # los 3 renglones del código 701; primero los 2 que coinciden con la clave del vale
        assert [c["coincide"] for c in pendiente["candidatos"]] == [True, True, False]
        consultas.ubicar_linea(
            s, pendiente["id"], pendiente["candidatos"][1]["id"], "ALMACENISTA UNO"
        )
    with cargada.sesion() as s:
        restantes = consultas.lineas_por_ubicar(s)
        assert all(p["codigo"] != 701 for p in restantes)
        auditoria = s.scalar(select(m.Auditoria).where(m.Auditoria.accion == "UBICAR"))
        assert auditoria.usuario == "ALMACENISTA UNO"
        otro = restantes[0]
        consultas.ubicar_linea(s, otro["id"], None, "ALMACENISTA UNO")  # no inventariado
    with cargada.sesion() as s:
        assert consultas.lineas_por_ubicar(s) == []


def test_candidatos_ordenados_por_parecido(cargada):
    with cargada.sesion() as s:
        candidatos = consultas.candidatos_para(s, 702, "P551318")  # error de dedo de P551317
    assert "P551317" in candidatos[0]["etiqueta"]


def test_usuario_en_turno(cargada):
    with cargada.sesion() as s:
        assert "ALMACENISTA UNO" not in consultas.almacenistas(s)  # pocas entregas en la muestra
        consultas.fijar_usuario_en_turno(s, "ALMACENISTA UNO")
    with cargada.sesion() as s:
        assert consultas.usuario_en_turno(s) == "ALMACENISTA UNO"


def test_exportacion_del_dia_registra(cargada, tmp_path):
    hoy = dt.date(2026, 10, 1)
    with cargada.sesion() as s:
        vales = exportar_vales_del_dia(
            s, tmp_path / "plantillas", tmp_path / "exp", "ALMACENISTA UNO", hoy
        )
        inventario = exportar_inventario_del_dia(
            s, tmp_path / "plantillas", tmp_path / "exp", None, hoy
        )
    assert vales.parent.name == "2026-10-01" and vales.name == "VALES SINTETICO.xlsm"
    assert inventario.name == "INVENTARIO SINTETICO 011026.xlsx"
    assert zipfile.is_zipfile(vales) and zipfile.is_zipfile(inventario)
    with cargada.sesion() as s:
        registros = s.scalars(select(m.Exportacion).order_by(m.Exportacion.id)).all()
        assert [(r.tipo, r.ultimo_folio) for r in registros] == [("VALES", 9), ("INVENTARIO", None)]


def test_exportar_sin_plantilla(bd, tmp_path):
    with pytest.raises(SinPlantilla), bd.sesion() as s:
        exportar_vales_del_dia(s, tmp_path, tmp_path, None)


def test_nombre_con_fecha():
    fecha = dt.date(2026, 10, 1)
    assert (
        nombre_con_fecha("INVENTARIO DE REFACCIONAMIENTO_280926.xlsx", fecha)
        == "INVENTARIO DE REFACCIONAMIENTO_011026.xlsx"
    )
    assert nombre_con_fecha("INVENTARIO.xlsx", fecha) == "INVENTARIO 011026.xlsx"


def test_sugerir_folio_corte(archivos):
    renglones = leer_vales(archivos["vales"]).renglones
    assert sugerir_folio_corte(renglones, dt.date(2026, 9, 4)) == 5
    assert sugerir_folio_corte(renglones, dt.date(2026, 1, 1)) is None
