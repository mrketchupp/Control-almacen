"""Genera tests/fixtures/qr-referencia.json: matrices de referencia para probar src/impresion/qr.js.

Necesita la biblioteca `qrcode` de Python (se probó con qrcode 8.2). NO es dependencia del proyecto
y no va en requirements.txt: se usó una vez para generar la referencia, que queda versionada. Para
regenerarla, en un entorno aparte (fuera del repo):

    python -m venv /tmp/venv-qr && /tmp/venv-qr/bin/pip install qrcode==8.2
    /tmp/venv-qr/bin/python tests/fixtures/qr_referencia.py

Los textos son inventados (códigos y dimensiones de ejemplo, como las fixtures de generar.py).

Además de los casos con nombre, un caso por nivel (L, M, Q, H) y versión (1–10) con el texto que la
llena exactamente, y `capacidades`: los bytes que caben por nivel y versión según la biblioteca.

Por cada caso se guarda:
- la matriz con la máscara forzada (`mascara`), renglón por renglón con "0" (blanco) y "1" (negro),
  sin margen; la máscara va cambiando de un caso a otro para cubrir las 8;
- `mascara_biblioteca`: la que elige qrcode sola;
- `penalizaciones_biblioteca`: lo que qrcode calcula para elegir (`util.lost_point` sobre su matriz
  "de prueba", que deja en blanco la información de formato, la de versión y el módulo oscuro);
- `penalizaciones_simbolo`: el mismo `lost_point`, pero sobre el símbolo completo con cada máscara
  (con formato, versión y módulo oscuro), que es lo que pide ISO/IEC 18004 («the area to be evaluated
  is the complete symbol»). qr.js elige por estas.
Siempre en modo byte (QRData con MODE_8BIT_BYTE), para que la biblioteca no cambie a numérico o
alfanumérico: qr.js solo codifica en modo byte (UTF-8).
"""

from __future__ import annotations

import json
from importlib.metadata import version as version_de
from pathlib import Path

import qrcode
from qrcode import constants, util

NIVELES = {
    "L": constants.ERROR_CORRECT_L,
    "M": constants.ERROR_CORRECT_M,
    "Q": constants.ERROR_CORRECT_Q,
    "H": constants.ERROR_CORRECT_H,
}

BASE = "RIG 91 ALMACEN 701 6309-2Z/C3 000000670 BALEROS FILTROS TORNILLOS "


def relleno(n: int) -> str:
    """Texto ASCII de exactamente n bytes."""
    return (BASE * (n // len(BASE) + 1))[:n]


def acentos(n: int) -> str:
    """Texto con acentos y Ñ de a lo más n bytes en UTF-8 (sin partir un carácter)."""
    texto = ""
    for letra in "ÁÉÍÓÚ ÑÑ 701 DESCRIPCIÓN " * 20:
        if len((texto + letra).encode("utf-8")) > n:
            break
        texto += letra
    return texto


# (nombre, texto, corrección)
CASOS = [
    ("una letra", "A", "M"),
    ("código corto", "701", "M"),
    ("código AX y dimensión", "000000670 6309-2Z/C3", "M"),
    ("ascii corto", "Hola mundo", "M"),
    ("hoja con espacio final", "CONTENEDOR #1 CONSUMIBLE ", "M"),
    ("acentos y eñe", "DESCRIPCIÓN: BALERO AÑO ÑANDÚ", "M"),
    ("una eñe", "Ñ", "M"),
    ("emoji", "CAJA 📦 701", "M"),
    ("límite de v1 (14 bytes)", relleno(14), "M"),
    ("v2 por un byte (15 bytes)", relleno(15), "M"),
    ("7 eñes = 14 bytes (v1)", "Ñ" * 7, "M"),
    ("7 eñes + 1 = 15 bytes (v2)", "Ñ" * 7 + "A", "M"),
    ("límite de v2 (26 bytes)", relleno(26), "M"),
    ("v3 (40 bytes)", relleno(40), "M"),
    ("v4 (60 bytes)", relleno(60), "M"),
    ("v5 (80 bytes)", relleno(80), "M"),
    ("v6 (100 bytes)", relleno(100), "M"),
    ("v7 (107 bytes, información de versión)", relleno(107), "M"),
    ("límite de v7 (122 bytes)", relleno(122), "M"),
    ("v8 (140 bytes)", relleno(140), "M"),
    ("v9 (170 bytes)", relleno(170), "M"),
    ("v10 (181 bytes, cuenta de 16 bits)", relleno(181), "M"),
    ("v10 con acentos (204 bytes)", acentos(205), "M"),
    ("límite de v10-M (213 bytes)", relleno(213), "M"),
    ("se pasa de v10-M (214 bytes)", relleno(214), "M"),
    # Otros niveles (L, Q, H): límites de algunas versiones y grupos de bloques de dos tamaños.
    ("L v1 (17 bytes)", relleno(17), "L"),
    ("Q v1 (11 bytes)", relleno(11), "Q"),
    ("H v1 (7 bytes)", relleno(7), "H"),
    ("Q v5 (60 bytes, dos grupos)", relleno(60), "Q"),
    ("H v7 (60 bytes, dos grupos)", relleno(60), "H"),
    ("L v10 (271 bytes)", relleno(271), "L"),
    ("Q v10 (151 bytes)", relleno(151), "Q"),
    ("H v10 (119 bytes)", relleno(119), "H"),
    ("H se pasa de v10 (120 bytes)", relleno(120), "H"),
]


def armar(datos: bytes, nivel: int, mascara: int | None) -> qrcode.QRCode:
    qr = qrcode.QRCode(version=None, error_correction=nivel, border=0, mask_pattern=mascara)
    qr.add_data(util.QRData(datos, mode=util.MODE_8BIT_BYTE))
    qr.make(fit=True)
    return qr


def renglones(modulos) -> list[str]:
    return ["".join("1" if m else "0" for m in fila) for fila in modulos]


def capacidad(nivel: int, version: int) -> int:
    """Bytes máximos en modo byte que qrcode acomoda en esa versión (o menos), buscando el límite."""
    n = 0
    while armar(relleno(n + 1).encode("utf-8"), nivel, 0).version <= version:
        n += 1
    return n


def main() -> None:
    # Bytes que caben por nivel y versión (1–10), según la biblioteca.
    capacidades = {c: [capacidad(NIVELES[c], v) for v in range(1, 11)] for c in "LMQH"}
    # Además de los casos con nombre, el texto que llena exactamente cada versión en cada nivel.
    lista = list(CASOS)
    ya = {(c, len(t.encode("utf-8"))) for _, t, c in CASOS}
    for c in "LMQH":
        for v, n in enumerate(capacidades[c], start=1):
            if (c, n) not in ya:
                lista.append((f"límite de v{v}-{c} ({n} bytes)", relleno(n), c))
    casos = []
    for i, (nombre, texto, correccion) in enumerate(lista):
        datos = texto.encode("utf-8")
        nivel = NIVELES[correccion]
        mascara = i % 8
        qr = armar(datos, nivel, mascara)
        caso = {
            "nombre": nombre,
            "texto": texto,
            "bytes": len(datos),
            "correccion": correccion,
            "version": qr.version,
        }
        if qr.version > 10:
            caso["excede"] = True
            casos.append(caso)
            continue
        simbolo = [util.lost_point(armar(datos, nivel, m).modules) for m in range(8)]
        auto = armar(datos, nivel, None)
        prueba = []
        for m in range(8):
            auto.makeImpl(True, m)
            prueba.append(util.lost_point(auto.modules))
        caso.update(
            {
                "mascara": mascara,
                "modulos": renglones(qr.get_matrix()),
                "mascara_biblioteca": auto.best_mask_pattern(),
                "penalizaciones_biblioteca": prueba,
                "penalizaciones_simbolo": simbolo,
            }
        )
        casos.append(caso)

    salida = {
        "generado_con": f"qrcode {version_de('qrcode')}",
        "capacidades": capacidades,
        "casos": casos,
    }
    destino = Path(__file__).with_name("qr-referencia.json")
    destino.write_text(json.dumps(salida, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(casos)} casos → {destino}")


if __name__ == "__main__":
    main()
