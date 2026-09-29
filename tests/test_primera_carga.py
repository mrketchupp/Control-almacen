import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy import select

from control_almacen.db import modelos as m
from control_almacen.dominio.existencias import calcular_saldos
from control_almacen.servicios.primera_carga import (
    BaseNoVacia,
    OpcionesPrimeraCarga,
    ejecutar_primera_carga,
    fecha_desde_nombre,
)
from tests.fixtures.generar import FOLIO_CORTE


def _opciones(archivos, tmp_path, **extra):
    return OpcionesPrimeraCarga(
        ruta_inventario=archivos["inventario"],
        ruta_vales=archivos["vales"],
        folio_corte=FOLIO_CORTE,
        fecha_conteo=dt.date(2026, 9, 3),
        usuario="PRUEBA",
        carpeta_plantillas=tmp_path / "plantillas",
        **extra,
    )


@pytest.fixture
def reporte(bd, archivos, tmp_path):
    return ejecutar_primera_carga(bd, _opciones(archivos, tmp_path))


def test_carga_inventario_completo(bd, reporte):
    assert reporte.existencias == 14
    assert [h.renglones for h in reporte.hojas] == [5, 5, 2, 2]
    with bd.sesion() as s:
        hojas = [u.hoja_excel for u in s.scalars(select(m.Ubicacion).order_by(m.Ubicacion.orden))]
        assert "CONTENEDOR #1 CONSUMIBLE " in hojas
        # misma variante en dos ubicaciones → una sola variante
        baleros = s.scalars(select(m.Variante).where(m.Variante.codigo == 701)).all()
        assert len(baleros) == 2
        # 1/2" y 12 no se confunden
        mangueras = s.scalars(select(m.Variante).where(m.Variante.codigo == 705)).all()
        assert len(mangueras) == 2


def test_vales_migrados(bd, reporte):
    assert reporte.vales == 8
    assert reporte.folios_faltantes == [8]
    with bd.sesion() as s:
        vale = s.scalar(select(m.Vale).where(m.Vale.folio == 7))
        assert vale.estado == "EMITIDO" and vale.migrado
        assert [linea.fila_diario_origen for linea in vale.lineas] == [13, 14]


def test_lineas_posteriores_al_corte_se_ubican(bd, reporte):
    # folio 6: 701 está en 2 contenedores (ambiguo); 706 555001 solo en uno
    # folio 7: 702 P551317 único; 704 6" está duplicado en la misma hoja (ambiguo)
    # folio 9: 705 1/2" único (no se confunde con "12")
    assert reporte.lineas_ubicadas == 3
    assert sorted((p.folio, p.codigo) for p in reporte.por_ubicar) == [(6, 701), (7, 704)]
    with bd.sesion() as s:
        diesel = s.scalar(select(m.ValeLinea).where(m.ValeLinea.codigo == 136))
        assert diesel.existencia_id is None  # folio 5 es anterior al corte: solo historial


def test_verificacion_cruzada_senala_diferencias(reporte):
    diferencias = {(d.hoja, d.fila): d for d in reporte.diferencias}
    # 706 ya tenía CONSUMO 1 en el archivo y el vale 6 lo explica → sin diferencia
    assert ("CONTENEDOR #1 INVENTARIABLE", 6) not in diferencias
    # 702 P551317: el vale 7 descuenta 4 que el archivo no tenía
    d = diferencias[("CONTENEDOR #1 CONSUMIBLE ", 2)]
    assert (d.archivo_consumo, d.calculado_consumo) == (0, 4)
    # ISOFLEX tenía INGRESO 2 sin vale de entrada que lo respalde
    assert diferencias[("CONTENEDOR #1 CONSUMIBLE ", 6)].archivo_ingreso == 2
    assert not reporte.cuadra


def test_saldos(bd, reporte):
    with bd.sesion() as s:
        sellos = s.scalar(select(m.Existencia).join(m.Variante).where(m.Variante.codigo == 706))
        saldo = calcular_saldos(s, [sellos.id])[sellos.id]
        assert (saldo.cantidad, saldo.consumo, saldo.total) == (Decimal(2), Decimal(1), Decimal(1))


def test_plantillas_personas_y_archivos(bd, reporte, tmp_path):
    assert reporte.plantillas_area == 3
    with bd.sesion() as s:
        transferencias = s.scalar(
            select(m.PlantillaArea).where(m.PlantillaArea.nombre == "TRANSFERENCIAS")
        )
        assert transferencias.naturaleza == "TRANSFERENCIA" and transferencias.requiere_autoriza
        assert s.scalar(select(m.Persona).where(m.Persona.nombre == "ALMACENISTA UNO"))
        plantillas = s.scalars(select(m.PlantillaExcel)).all()
        assert {p.tipo for p in plantillas} == {"INVENTARIO", "VALES"}
    assert len(list((tmp_path / "plantillas").iterdir())) == 2


def test_no_se_carga_dos_veces(bd, reporte, archivos, tmp_path):
    with pytest.raises(BaseNoVacia):
        ejecutar_primera_carga(bd, _opciones(archivos, tmp_path))


def test_articulos_por_confirmar(reporte):
    assert (799, "CÓDIGO 799") in reporte.articulos_por_confirmar or any(
        c == 799 for c, _ in reporte.articulos_por_confirmar
    )


@pytest.mark.parametrize(
    ("nombre", "fecha"),
    [
        ("INVENTARIO_DE_REFACCIONAMIENTO_DLTA_DE_ALMACEN_280926.xlsx", dt.date(2026, 9, 28)),
        ("DELTA RIG 91 27-09-26.xlsx", dt.date(2026, 9, 27)),
        ("sin fecha.xlsx", None),
    ],
)
def test_fecha_desde_nombre(nombre, fecha):
    assert fecha_desde_nombre(nombre) == fecha
