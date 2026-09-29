import datetime as dt
from decimal import Decimal

from control_almacen.importadores.vales import leer_vales
from control_almacen.servicios.limpieza import RespuestasRevision, limpiar_diario
from tests.fixtures.generar import CATALOGO


def _vales(archivos, respuestas=None):
    libro = leer_vales(archivos["vales"])
    return limpiar_diario(libro.renglones, CATALOGO, respuestas)


def test_agrupa_por_folio_y_detecta_faltantes(archivos):
    resultado = _vales(archivos)
    assert [v.folio for v in resultado.vales] == [1, 2, 3, 4, 5, 6, 7, 9]
    assert resultado.folios_faltantes == [8]
    assert resultado.omitidos == [(8, "Renglón perdido: sin folio ni código (#REF!)")]


def test_sin_revision_no_elimina_duplicados(archivos):
    folio2 = next(v for v in _vales(archivos).vales if v.folio == 2)
    assert len(folio2.lineas) == 2


def test_encabezado_perdido_se_completa_con_otro_renglon(archivos):
    folio3 = next(v for v in _vales(archivos).vales if v.folio == 3)
    assert (folio3.origen, folio3.depto_origen, folio3.destino) == (
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
    )
    assert "Datos perdidos" in folio3.lineas[0].notas[0]


def test_descripcion_con_error_de_dedo_usa_catalogo(archivos):
    resultado = _vales(archivos)
    folio7 = next(v for v in resultado.vales if v.folio == 7)
    assert folio7.lineas[0].descripcion == "FILTROS"
    assert (13, "descripcion", "FILTRO", "FILTROS") in resultado.correcciones


def test_codigo_fuera_de_catalogo(archivos):
    assert _vales(archivos).codigos_nuevos == {799: "ARTICULO NUEVO"}


def test_fecha_texto_y_cantidad_con_unidad(archivos):
    folio4 = next(v for v in _vales(archivos).vales if v.folio == 4)
    assert folio4.fecha == dt.date(2026, 9, 3)
    assert folio4.lineas[0].cantidad == Decimal(15)
    assert "15LTS" in folio4.lineas[0].notas[0]


def test_aplica_respuestas_de_revision(archivos):
    respuestas = RespuestasRevision(
        eliminar={5},
        alias={"MECANICO UNOO": "MECANICO UNO"},
        normalizaciones={("destino", "(vacío)"): "RIG 91"},
        correcciones={6: {"lote": "NUEVO"}},
        codigos={799: (None, "ARTICULO CONFIRMADO")},
    )
    resultado = _vales(archivos, respuestas)
    vales = {v.folio: v for v in resultado.vales}
    assert len(vales[2].lineas) == 1
    assert vales[7].recibio == "MECANICO UNO"
    assert vales[5].destino == "RIG 91"
    assert vales[3].lineas[0].lote == "NUEVO"
    assert resultado.codigos_nuevos == {799: "ARTICULO CONFIRMADO"}
    assert (5, "Eliminado según la revisión (duplicado o renglón inválido)") in resultado.omitidos


def test_renglon_con_encabezado_distinto_se_conserva(archivos):
    # Folio 3: primer renglón perdió origen/deptos; el segundo es el bueno.
    folio3 = next(v for v in _vales(archivos).vales if v.folio == 3)
    assert folio3.lineas[0].encabezado_original == {}
    assert folio3.lineas[1].encabezado_original == {}
