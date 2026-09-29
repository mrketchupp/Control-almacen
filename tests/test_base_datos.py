from decimal import Decimal

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from control_almacen.db import modelos as m


def test_migracion_crea_todas_las_tablas(bd):
    tablas = set(inspect(bd.motor).get_table_names())
    esperadas = {t.name for t in m.Base.metadata.sorted_tables}
    assert esperadas <= tablas
    assert "alembic_version" in tablas


def test_decimal_exacto(bd):
    with bd.sesion() as s:
        s.add(m.Articulo(codigo=1, descripcion="X"))
        s.flush()
        v = m.Variante(codigo=1, um="PZA")
        u = m.Ubicacion(contenedor=1, clase="INV", hoja_excel="H", orden=1)
        s.add_all([v, u])
        s.flush()
        s.add(
            m.Existencia(
                variante_id=v.id, ubicacion_id=u.id, orden=1, cantidad_conteo=Decimal("0.1")
            )
        )
    with bd.sesion() as s:
        assert s.query(m.Existencia).one().cantidad_conteo == Decimal("0.1")


def test_folio_unico_por_tipo(bd):
    with pytest.raises(IntegrityError), bd.sesion() as s:
        s.add(m.Vale(tipo="SALIDA", folio=10, estado="EMITIDO"))
        s.add(m.Vale(tipo="SALIDA", folio=10, estado="EMITIDO"))
        s.flush()


def test_borradores_sin_folio_no_chocan(bd):
    with bd.sesion() as s:
        s.add_all([m.Vale(tipo="SALIDA"), m.Vale(tipo="SALIDA")])
    with bd.sesion() as s:
        assert s.query(m.Vale).count() == 2


def test_llaves_foraneas_activas(bd):
    with pytest.raises(IntegrityError), bd.sesion() as s:
        s.add(m.Variante(codigo=999, um="PZA"))
        s.flush()


def test_ruta_con_caracteres_especiales(tmp_path):
    """En Windows la ruta C:\\… se codifica con '%' (C%3A%5C…) y Alembic la interpretaba
    como interpolación de configparser. Regresión del CI de Windows."""
    from control_almacen.db.sesion import BaseDatos

    carpeta = tmp_path / "C:\\Users\\almacen 100%"
    base = BaseDatos(carpeta / "almacen.db")
    with base.sesion() as s:
        assert s.query(m.Articulo).count() == 0
    base.cerrar()
