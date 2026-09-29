import datetime as dt
from decimal import Decimal

import pytest

from control_almacen.dominio import normalizar as n


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (None, None),
        ("#REF!", None),
        ("  PZA  ", "PZA"),
        ("6 1/2”  MLLU640HT", '6 1/2" MLLU640HT'),
        (126649.0, "126649"),
        (5.5, "5.5"),
        (126649, "126649"),
        (dt.datetime(2026, 9, 29), "2026-09-29"),
    ],
)
def test_valor_a_texto(valor, esperado):
    assert n.valor_a_texto(valor) == esperado


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ('1/2"', '1/2"'),
        ('1/2 "', '1/2"'),
        ("6309-2Z/C3", "63092Z/C3"),
        ("NP: H143405", "H143405"),
        ("S/D", ""),
        ("SIN DIMENSION", ""),
        ("SIN DIMENCION ", ""),
        (0, ""),
        ("Válvula 3/4", "VALVULA3/4"),
    ],
)
def test_clave_estricta(valor, esperado):
    assert n.clave_estricta(valor) == esperado


def test_clave_estricta_no_confunde_fracciones_con_enteros():
    assert n.clave_estricta('1/2"') != n.clave_estricta("12")
    assert n.clave_laxa('1/2"') == "12"


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [("000000670", 670), (670, 670), (670.0, 670), ("ABC", None), ("#REF!", None), (None, None)],
)
def test_codigo_ax(valor, esperado):
    assert n.codigo_ax(valor) == esperado


def test_unidad():
    assert n.unidad("PZ A") == "PZA"
    assert n.unidad("pza ") == "PZA"
    assert n.unidad(None) == ""


def test_separar_cantidad():
    assert n.separar_cantidad("15LTS") == (Decimal(15), "LTS")
    assert n.separar_cantidad(3) == (Decimal(3), None)
    assert n.separar_cantidad(0.1) == (Decimal("0.1"), None)
    assert n.separar_cantidad("#REF!") == (None, None)


def test_texto_o_numero():
    assert n.texto_o_numero("126649") == 126649
    assert n.texto_o_numero("5.5") == Decimal("5.5")
    assert n.texto_o_numero("0509") == "0509"
    assert n.texto_o_numero("6309-2Z") == "6309-2Z"
    assert n.texto_o_numero(None) is None


def test_fechas():
    assert n.fecha(" 11/04/2026") == dt.date(2026, 4, 11)
    assert n.fecha(46294) == dt.date(2026, 9, 29)
    assert n.serial_excel(dt.date(2026, 9, 29)) == 46294
    assert n.fecha("#REF!") is None


def test_nombre_persona():
    assert n.nombre_persona("  juan  perez ") == "JUAN PEREZ"
    assert n.nombre_persona(0) is None
