"""Reglas de normalización de texto, códigos, unidades y cantidades.

Ver docs/04-modelo-de-datos.md, sección "Reglas de normalización".
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from decimal import Decimal, InvalidOperation

ERRORES_EXCEL = frozenset(
    {"#REF!", "#N/A", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#SPILL!", "#CALC!"}
)

# Valores que en la práctica significan "sin dimensión" / "sin número".
_SIN_VALOR = frozenset({"SD", "SN", "SNP", "SINDIMENSION", "SINDIMENCION", "SINNUMERO", "NA", "0"})

_COMILLAS = str.maketrans({"”": '"', "“": '"', "″": '"', "´": "'", "’": "'", "‘": "'"})
_ESPACIOS = re.compile(r"\s+")
_NUMERO_EXCEL = re.compile(r"^(0|[1-9]\d*)(\.\d+)?$")
_CANTIDAD_INICIAL = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(.*)$")


def es_error_excel(valor: object) -> bool:
    """True si el valor es un error de Excel como #REF!."""
    return isinstance(valor, str) and valor.strip().upper() in ERRORES_EXCEL


def sin_acentos(texto: str) -> str:
    descompuesto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def valor_a_texto(valor: object) -> str | None:
    """Convierte el valor de una celda a texto limpio (sin espacios sobrantes).

    Los enteros guardados como float (126649.0) se muestran sin decimales.
    Los errores de Excel y las celdas vacías devuelven None.
    """
    if valor is None or es_error_excel(valor):
        return None
    if isinstance(valor, bool):
        return "SI" if valor else "NO"
    if isinstance(valor, int):
        return str(valor)
    if isinstance(valor, float):
        return str(int(valor)) if valor.is_integer() else repr(valor)
    if isinstance(valor, Decimal):
        return format(valor.normalize(), "f")
    if isinstance(valor, dt.datetime):
        return valor.date().isoformat()
    if isinstance(valor, dt.date):
        return valor.isoformat()
    texto = _ESPACIOS.sub(" ", str(valor).translate(_COMILLAS)).strip()
    return texto or None


def mayusculas(valor: object) -> str | None:
    texto = valor_a_texto(valor)
    return texto.upper() if texto else None


def clave_estricta(valor: object) -> str:
    """Clave para unicidad de dimensión/NP.

    Mayúsculas, sin acentos, sin espacios, guiones, puntos ni comas. Conserva
    "/" y comillas para no confundir 1/2" con 12. Los "sin dimensión" → "".
    """
    texto = mayusculas(valor)
    if not texto:
        return ""
    texto = sin_acentos(texto)
    texto = re.sub(r"[\s\-._,:;]", "", texto)
    if texto.startswith("NP") and len(texto) > 2:
        texto = texto[2:]
    return "" if texto.replace("/", "") in _SIN_VALOR else texto


def clave_laxa(valor: object) -> str:
    """Solo letras y dígitos. Se usa para SUGERIR parejas, nunca para fusionar."""
    texto = mayusculas(valor)
    if not texto:
        return ""
    return re.sub(r"[^A-Z0-9]", "", sin_acentos(texto))


def codigo_ax(valor: object) -> int | None:
    """'000000670' → 670. Devuelve None si no es un código válido."""
    if valor is None or es_error_excel(valor) or isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    if isinstance(valor, float):
        return int(valor) if valor.is_integer() else None
    texto = str(valor).strip()
    return int(texto) if texto.isdigit() else None


def unidad(valor: object) -> str:
    """Unidad de medida en mayúsculas y sin espacios ('PZ A' → 'PZA')."""
    texto = mayusculas(valor)
    return re.sub(r"\s+", "", texto) if texto else ""


def nombre_persona(valor: object) -> str | None:
    texto = mayusculas(valor)
    if not texto or texto == "0":
        return None
    return texto


def separar_cantidad(valor: object) -> tuple[Decimal | None, str | None]:
    """Devuelve (cantidad, resto). '15LTS' → (15, 'LTS'); 3 → (3, None)."""
    if valor is None or es_error_excel(valor) or isinstance(valor, bool):
        return None, None
    if isinstance(valor, int | float | Decimal):
        return decimal(valor), None
    coincidencia = _CANTIDAD_INICIAL.match(str(valor))
    if not coincidencia:
        return None, valor_a_texto(valor)
    numero = Decimal(coincidencia.group(1).replace(",", "."))
    return numero, (coincidencia.group(2).strip() or None)


def decimal(valor: object) -> Decimal | None:
    """Convierte a Decimal sin pasar por la imprecisión de float."""
    if valor is None or es_error_excel(valor) or isinstance(valor, bool):
        return None
    if isinstance(valor, Decimal):
        return valor
    try:
        return Decimal(repr(valor)) if isinstance(valor, float) else Decimal(str(valor).strip())
    except InvalidOperation:
        return None


def texto_o_numero(texto: str | None) -> str | int | Decimal | None:
    """Para exportar a Excel: '126649' → 126649; '5.5' → Decimal('5.5'); otros quedan como texto.

    Los textos con cero inicial ('0509') se conservan como texto.
    """
    if texto is None or not _NUMERO_EXCEL.match(texto):
        return texto
    if "." in texto:
        return Decimal(texto)
    return int(texto)


def fecha(valor: object) -> dt.date | None:
    """Fecha desde celda: datetime, date, número de serie o texto dd/mm/aaaa."""
    if valor is None or es_error_excel(valor):
        return None
    if isinstance(valor, dt.datetime):
        return valor.date()
    if isinstance(valor, dt.date):
        return valor
    if isinstance(valor, int | float) and not isinstance(valor, bool):
        return dt.date(1899, 12, 30) + dt.timedelta(days=int(valor))
    texto = str(valor).strip()
    for formato in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return dt.datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


def serial_excel(valor: dt.date) -> int:
    """Número de serie de Excel (sistema 1900) para una fecha."""
    return (valor - dt.date(1899, 12, 30)).days
