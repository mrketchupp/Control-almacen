"""Genera tests/fixtures/barras-referencia.json: códigos de barras Code 128 de referencia para probar
src/impresion/barras.js.

Necesita la biblioteca `python-barcode` (se probó con python-barcode 0.16.1). NO es dependencia del
proyecto y no va en requirements.txt: se usó una vez para generar la referencia, que queda versionada.
Para regenerarla, en un entorno aparte (fuera del repo):

    python -m venv /tmp/venv-barras && /tmp/venv-barras/bin/pip install python-barcode==0.16.1
    /tmp/venv-barras/bin/python tests/fixtures/barras_referencia.py

Los textos son inventados (códigos y dimensiones de ejemplo, como las fixtures de generar.py).

Se guarda:
- `tabla`: los 107 patrones de Code 128 de la biblioteca (valores 0–105 y, al final, la parada
  completa de 13 módulos). La prueba decodifica con esta tabla, no con la de barras.js.
- por cada caso, `patron` = `barcode.get("code128", texto).build()[0]` ("1" = barra, "0" = espacio,
  con inicio, datos, dígito de control y parada, sin zona muda) y `valores` = los símbolos que usó la
  biblioteca (inicio, datos y dígito de control), para ver dónde cambia de conjunto.

barras.js no tiene que dar el mismo patrón: solo uno que se lea igual y que no sea más largo. La
biblioteca cambia a C con 4 dígitos o más en cualquier lugar y, si son impares, deja el último dígito
en B; al final del texto eso le cuesta un símbolo más (p. ej. "A12345").
"""

from __future__ import annotations

import json
from importlib.metadata import version as version_de
from pathlib import Path

import barcode
from barcode.charsets import code128

# Los 100 valores del conjunto C (00–99) en tramos de 48 dígitos (24 pares), el largo máximo.
PARES = "".join(f"{n:02d}" for n in range(100))
TRAMOS_C = [PARES[i : i + 48] for i in range(0, len(PARES), 48)]

# Los 95 caracteres del conjunto B (ASCII 32–126) en tramos de 48, con el espacio en medio: barras.js
# quita los espacios de los extremos y cada texto de referencia debe llegar igual al codificador.
IMPRIMIBLES = "".join(chr(c) for c in range(33, 127))
IMPRIMIBLES = IMPRIMIBLES[:10] + " " + IMPRIMIBLES[10:]
TRAMOS_B = [IMPRIMIBLES[i : i + 48] for i in range(0, len(IMPRIMIBLES), 48)]

CASOS = [
    ("un dígito", "7"),
    ("dos dígitos", "12"),
    ("tres dígitos", "123"),
    ("cuatro dígitos", "1234"),
    ("cinco dígitos", "12345"),
    ("seis dígitos", "123456"),
    ("código corto", "701"),
    ("código AX con ceros", "000000670"),
    ("ocho dígitos", "00000067"),
    ("48 dígitos", "1234567890" * 4 + "12345678"),
    ("47 dígitos", "1234567890" * 4 + "1234567"),
    ("dimensión de balero", "6309-2Z/C3"),
    ("letras, siete dígitos, letras", "ABC1234567DEF"),
    ("letras, seis dígitos, letras", "ABC123456DEF"),
    ("letras, cinco dígitos, letras", "ABC12345DEF"),
    ("letras, cuatro dígitos, letras", "ABC1234DEF"),
    ("termina con tres dígitos", "A123"),
    ("termina con cuatro dígitos", "A1234"),
    ("termina con cinco dígitos", "A12345"),
    ("empieza con tres dígitos", "123A"),
    ("empieza con cuatro dígitos", "1234A"),
    ("empieza con cinco dígitos", "12345A"),
    ("B, C, B, C", "X123456Y7890123Z45678901"),
    ("alternado", "A1B2C3D4"),
    ("dígitos sueltos", "0A1B2C3D4E5F6G7H8I9J"),
    ("con espacios", "RIG 91 ALMACEN"),
    ("orden de compra", "OC: 4500012345"),
    ("código y dimensión", "000000670 6309-2Z/C3"),
    ("sin dimensión con NP", "S/D NP: 12345678"),
    ("minúsculas", "abcdefghijklmnopqrstuvwxyz"),
    ("minúsculas y dígitos", "abc123456def"),
    ("símbolos", "!\"#$%&'()*+,-./:;<=>? @[\\]^_`{|}~"),
    ("tilde sola", "~"),
    ("48 caracteres", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-ABCDEFGHIJK"),
    *((f"conjunto C {i + 1}", t) for i, t in enumerate(TRAMOS_C)),
    *((f"conjunto B {i + 1}", t) for i, t in enumerate(TRAMOS_B)),
]

PARADA = code128.STOP + "11"  # build() agrega la barra final de 2 módulos.


def caso(nombre: str, texto: str) -> dict:
    patron = barcode.get("code128", texto).build()[0]
    simbolos = barcode.get("code128", texto)._build()
    cuenta = simbolos[0] + sum(i * v for i, v in enumerate(simbolos[1:], start=1))
    valores = [*simbolos, cuenta % 103]
    armado = "".join(code128.CODES[v] for v in valores) + PARADA
    assert armado == patron, f"{nombre}: el patrón no coincide con los valores"
    return {"nombre": nombre, "texto": texto, "patron": patron, "valores": valores}


def main() -> None:
    assert len(code128.CODES) == 106
    datos = {
        "generado_con": f"python-barcode {version_de('python-barcode')}",
        "tabla": [*code128.CODES, PARADA],
        "casos": [caso(nombre, texto) for nombre, texto in CASOS],
    }
    destino = Path(__file__).with_name("barras-referencia.json")
    # Un patrón y un caso por renglón: se lee y se compara fácil.
    renglones = lambda lista: ",\n".join(f"  {json.dumps(x, ensure_ascii=False)}" for x in lista)
    texto = (
        f'{{\n "generado_con": {json.dumps(datos["generado_con"])},\n'
        f' "tabla": [\n{renglones(datos["tabla"])}\n ],\n'
        f' "casos": [\n{renglones(datos["casos"])}\n ]\n}}\n'
    )
    assert json.loads(texto) == datos
    destino.write_text(texto, encoding="utf-8")
    print(f"{destino}: {len(datos['casos'])} casos")


if __name__ == "__main__":
    main()
