import datetime as dt
from decimal import Decimal

import pytest

from control_almacen.importadores.inventario_fisico import leer_inventario
from control_almacen.importadores.vales import leer_vales


def test_inventario_detecta_hojas_con_nombre_exacto(archivos):
    libro = leer_inventario(archivos["inventario"])
    nombres = [h.nombre for h in libro.hojas]
    assert nombres == [
        "CONTENEDOR #1 INVENTARIABLE",
        "CONTENEDOR #1 CONSUMIBLE ",  # espacio final conservado
        "CONTENEDOR #2 INVENTARIABLE",
        "CONTENEDOR #2 CONSUMIBLE",
    ]
    assert [(h.contenedor, h.clase) for h in libro.hojas] == [
        (1, "INV"),
        (1, "CONS"),
        (2, "INV"),
        (2, "CONS"),
    ]
    assert all(h.tabla for h in libro.hojas)


def test_inventario_renglones_y_totales(archivos):
    hojas = {h.nombre: h for h in leer_inventario(archivos["inventario"]).hojas}
    c1 = hojas["CONTENEDOR #1 INVENTARIABLE"]
    assert len(c1.renglones) == 5
    assert c1.suma_cantidad == Decimal(19)
    assert c1.fila_totales == 7
    sellos = c1.renglones[4]
    assert (sellos.codigo, sellos.dimension, sellos.consumo) == (706, "555001", Decimal(1))
    assert c1.renglones[1].um == "PZA"  # 'PZA ' normalizada
    assert c1.renglones[3].item is None
    consumible = hojas["CONTENEDOR #1 CONSUMIBLE "]
    assert consumible.filas_vacias == [7]  # renglón vacío dentro de la tabla


def test_inventario_notas_y_catalogo(archivos):
    libro = leer_inventario(archivos["inventario"])
    c1 = libro.hojas[0]
    assert "Revisar dimensión" in (c1.renglones[2].nota or "")
    assert libro.catalogo[701] == "BALEROS"


def test_diario_interpreta_errores(archivos):
    libro = leer_vales(archivos["vales"])
    renglones = {r.fila: r for r in libro.renglones}
    assert len(libro.renglones) == 14
    assert renglones[8].perdido
    assert {"origen", "pase_entrada", "lote"} <= renglones[6].errores
    assert renglones[9].fecha == dt.date(2026, 9, 3)  # fecha escrita como texto
    assert (renglones[9].cantidad, renglones[9].resto_cantidad) == (Decimal(15), "LTS")
    assert renglones[10].destino is None  # "0" de la macro = vacío
    assert renglones[14].oc == "11536"
    assert renglones[2].depto_destino == "MECANICO"


def test_formularios_con_firmas_desplazadas(archivos):
    plantillas = {p.hoja: p for p in leer_vales(archivos["vales"]).plantillas}
    assert set(plantillas) == {"SOLDADOR", "MECANICO ", "TRANSFERENCIAS"}
    mecanico = plantillas["MECANICO "]
    assert (mecanico.entrega_nombre, mecanico.recibe_nombre) == ("ALMACENISTA UNO", "MECANICO UNO")
    assert mecanico.recibe_puesto == "MECANICO"
    assert plantillas["TRANSFERENCIAS"].autoriza_nombre == "AUTORIZADOR UNO"
    assert "ESPECIFICACIONES" in plantillas["SOLDADOR"].observaciones
    assert "NOMBRE" not in (mecanico.observaciones or "").upper()


def test_catalogo_de_formulario(archivos):
    catalogo = leer_vales(archivos["vales"]).catalogo
    assert catalogo[721] == "CODIGO SOLO EN CATALOGO DE VALES"


@pytest.mark.parametrize("nombre", ["no_existe.xlsx"])
def test_archivo_inexistente(tmp_path, nombre):
    with pytest.raises(FileNotFoundError):
        leer_inventario(tmp_path / nombre)
