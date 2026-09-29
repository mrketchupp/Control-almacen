from pathlib import Path

import pytest

from control_almacen.db.sesion import BaseDatos
from tests.fixtures.generar import generar_todo


@pytest.fixture
def bd(tmp_path: Path):
    base = BaseDatos(tmp_path / "almacen.db")
    yield base
    base.cerrar()


@pytest.fixture(scope="session")
def archivos(tmp_path_factory) -> dict[str, Path]:
    """Excel sintéticos (sin datos reales), generados una vez por sesión de pruebas."""
    return generar_todo(tmp_path_factory.mktemp("fixtures"))
