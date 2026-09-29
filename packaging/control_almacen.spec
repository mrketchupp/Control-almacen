# -*- mode: python ; coding: utf-8 -*-
# Especificación de PyInstaller. Uso (desde la raíz del repositorio):
#   pyinstaller packaging/control_almacen.spec --noconfirm
# Resultado: dist/ControlAlmacen/ControlAlmacen.exe (modo carpeta, arranca más rápido que onefile).
from pathlib import Path

import nicegui
from PyInstaller.utils.hooks import collect_submodules

RAIZ = Path(SPECPATH).parent
PAQUETE = RAIZ / "src" / "control_almacen"

datas = [
    (str(Path(nicegui.__file__).parent), "nicegui"),
    # Alembic lee las migraciones como archivos, no desde el PYZ.
    (str(PAQUETE / "db" / "migraciones"), "control_almacen/db/migraciones"),
    (str(PAQUETE / "ui" / "icono.png"), "control_almacen/ui"),
]
hiddenimports = (
    collect_submodules("control_almacen", filter=lambda nombre: ".migraciones" not in nombre)
    + collect_submodules("alembic")
    + ["sqlalchemy.dialects.sqlite", "mako", "mako.template"]
)

a = Analysis(
    [str(RAIZ / "packaging" / "lanzador.py")],
    pathex=[str(RAIZ / "src")],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "pandas", "numpy", "pytest", "playwright"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ControlAlmacen",
    console=False,
    icon=str(RAIZ / "packaging" / "icono.ico"),
)
coll = COLLECT(exe, a.binaries, a.datas, name="ControlAlmacen")
