"""Artículos y variantes: altas y búsquedas."""

from __future__ import annotations

import difflib
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from control_almacen.db import modelos as m
from control_almacen.dominio import normalizar as n

# Prefijos que en la columna CLAVE del DIARIO acompañan a la dimensión real.
_RUIDO_CLAVE = re.compile(r"^\s*(S/D|S/N|SIN\s+DIMENSI[OÓ]N|SIN\s+DIMENCION)\b\s*", re.IGNORECASE)
_PREFIJO_NP = re.compile(r"\bN\.?P\.?\s*:?\s*", re.IGNORECASE)


def obtener_o_crear_articulo(
    sesion: Session, codigo: int, descripcion: str | None, origen: str
) -> m.Articulo:
    articulo = sesion.get(m.Articulo, codigo)
    if articulo is None:
        articulo = m.Articulo(
            codigo=codigo,
            descripcion=descripcion or f"CÓDIGO {codigo}",
            origen=origen,
            por_confirmar=True,
        )
        sesion.add(articulo)
        sesion.flush()
    return articulo


def obtener_o_crear_variante(
    sesion: Session, codigo: int, dimension: str | None, np: str | None, um: str
) -> m.Variante:
    clave_dim, clave_np = n.clave_estricta(dimension), n.clave_estricta(np)
    variante = sesion.scalar(
        select(m.Variante).where(
            m.Variante.codigo == codigo,
            m.Variante.dimension_clave == clave_dim,
            m.Variante.np_clave == clave_np,
            m.Variante.um == um,
        )
    )
    if variante is None:
        variante = m.Variante(
            codigo=codigo,
            dimension=dimension,
            np=np,
            um=um,
            dimension_clave=clave_dim,
            np_clave=clave_np,
        )
        sesion.add(variante)
        sesion.flush()
    return variante


def claves_de_busqueda(texto: str | None) -> set[str]:
    """Claves con las que un texto de CLAVE/dimensión puede corresponder a una variante.

    'S/D NP: 1/4"' → {'1/4"'}; '6309-2Z/C3' → {'63092Z/C3'}.
    """
    if not texto:
        return set()
    claves = {n.clave_estricta(texto)}
    limpio = _PREFIJO_NP.sub("", _RUIDO_CLAVE.sub("", texto))
    claves.add(n.clave_estricta(limpio))
    return {c for c in claves if c}


def es_error_de_dedo(texto: str | None, referencia: str | None) -> bool:
    """True si cada palabra de `texto` se parece a alguna de `referencia` (GRSA ~ GRASA)."""
    if not texto or not referencia:
        return False
    palabras_ref = re.findall(r"[A-Z0-9]+", n.sin_acentos(referencia.upper()))
    palabras = re.findall(r"[A-Z0-9]{4,}", n.sin_acentos(texto.upper()))
    if not palabras:
        return False
    return all(
        any(difflib.SequenceMatcher(None, p, r).ratio() >= 0.8 for r in palabras_ref)
        for p in palabras
    )
