"""Punto de entrada del ejecutable empaquetado (PyInstaller)."""

import multiprocessing
import os
import sys

if __name__ in {"__main__", "__mp_main__"}:
    # La ventana nativa corre en un proceso aparte: requerido al congelar la app.
    multiprocessing.freeze_support()
    # Sin consola (modo ventana) stdout/stderr son None y algunas bibliotecas fallan al escribir.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115

    from control_almacen.app import main

    main()
