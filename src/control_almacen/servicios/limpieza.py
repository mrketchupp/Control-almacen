"""Limpieza del historial DIARIO y agrupación en vales (docs/07-migracion.md).

Funciones puras: no tocan la base de datos, así se pueden probar y re-ejecutar.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field, replace
from decimal import Decimal

from control_almacen.dominio import normalizar as n
from control_almacen.dominio.catalogo import es_error_de_dedo
from control_almacen.importadores.vales import RenglonDiario

CAMPOS_ENCABEZADO = (
    "fecha", "origen", "depto_origen", "destino", "depto_destino",
    "entrego", "recibio", "autorizo",
)  # fmt: skip
CAMPOS_NORMALIZABLES = ("um", "lote", "origen", "depto_origen", "destino", "depto_destino")
VACIO = "(vacío)"


@dataclass
class RespuestasRevision:
    """Decisiones del usuario tomadas en la lista de revisión (vacías = sin decisiones)."""

    correcciones: dict[int, dict[str, object]] = field(default_factory=dict)  # fila → campo → valor
    eliminar: set[int] = field(default_factory=set)  # filas del DIARIO a omitir
    codigos: dict[int, tuple[int | None, str | None]] = field(default_factory=dict)
    alias: dict[str, str] = field(default_factory=dict)  # variante → nombre correcto
    normalizaciones: dict[tuple[str, str], str | None] = field(default_factory=dict)
    advertencias: list[str] = field(default_factory=list)


@dataclass
class LineaMigrada:
    fila: int
    oc: str | None
    cantidad: Decimal | None
    codigo: int | None
    descripcion: str | None
    clave: str | None
    um: str | None
    lote: str | None
    familia: str | None
    transferencia_consumo: str | None
    encabezado_original: dict[str, str] = field(default_factory=dict)
    notas: list[str] = field(default_factory=list)


@dataclass
class ValeMigrado:
    folio: int
    fecha: dt.date | None
    origen: str | None
    depto_origen: str | None
    destino: str | None
    depto_destino: str | None
    entrego: str | None
    recibio: str | None
    autorizo: str | None
    lineas: list[LineaMigrada]


@dataclass
class ResultadoLimpieza:
    vales: list[ValeMigrado]
    omitidos: list[tuple[int, str]]  # (fila, motivo)
    correcciones: list[tuple[int, str, object, object]]  # (fila, campo, antes, después)
    folios_faltantes: list[int]
    codigos_nuevos: dict[int, str]  # código fuera de catálogo → descripción del DIARIO


def _normalizar(campo: str, valor: str | None, respuestas: RespuestasRevision) -> str | None:
    clave = (campo, valor if valor is not None else VACIO)
    if clave in respuestas.normalizaciones:
        return respuestas.normalizaciones[clave]
    return valor


def _aplicar_correcciones(
    renglon: RenglonDiario, cambios: dict[str, object], bitacora: list
) -> RenglonDiario:
    valores = {}
    for campo, nuevo in cambios.items():
        antes = getattr(renglon, campo, None)
        if campo == "cantidad":
            nuevo = n.decimal(nuevo)
        elif campo == "codigo":
            nuevo = n.codigo_ax(nuevo)
        elif campo == "fecha":
            nuevo = n.fecha(nuevo)
        elif campo in ("entrego", "recibio", "autorizo"):
            nuevo = n.nombre_persona(nuevo)
        else:
            nuevo = n.valor_a_texto(nuevo)
            nuevo = None if nuevo == "0" else nuevo
        if nuevo != antes:
            bitacora.append((renglon.fila, campo, antes, nuevo))
        valores[campo] = nuevo
    errores = renglon.errores - set(cambios)
    return replace(renglon, errores=errores, **valores)


def limpiar_diario(
    renglones: list[RenglonDiario],
    catalogo: dict[int, str],
    respuestas: RespuestasRevision | None = None,
) -> ResultadoLimpieza:
    respuestas = respuestas or RespuestasRevision()
    omitidos: list[tuple[int, str]] = []
    bitacora: list[tuple[int, str, object, object]] = []
    grupos: dict[int, list[RenglonDiario]] = {}

    for renglon in renglones:
        if renglon.fila in respuestas.eliminar:
            omitidos.append(
                (renglon.fila, "Eliminado según la revisión (duplicado o renglón inválido)")
            )
            continue
        if renglon.fila in respuestas.correcciones:
            renglon = _aplicar_correcciones(
                renglon, respuestas.correcciones[renglon.fila], bitacora
            )
        if renglon.codigo in respuestas.codigos:
            nuevo_codigo, _ = respuestas.codigos[renglon.codigo]
            if nuevo_codigo and nuevo_codigo != renglon.codigo:
                bitacora.append((renglon.fila, "codigo", renglon.codigo, nuevo_codigo))
                renglon = replace(renglon, codigo=nuevo_codigo, descripcion=None)
        if renglon.perdido:
            omitidos.append((renglon.fila, "Renglón perdido: sin folio ni código (#REF!)"))
            continue
        if renglon.folio is None:
            omitidos.append((renglon.fila, "Renglón sin folio"))
            continue
        grupos.setdefault(renglon.folio, []).append(renglon)

    codigos_nuevos: dict[int, str] = {}
    vales: list[ValeMigrado] = []
    for folio in sorted(grupos):
        filas = grupos[folio]
        encabezado = {}
        for campo in CAMPOS_ENCABEZADO:
            valores = [getattr(r, campo) for r in filas if campo not in r.errores]
            valores = [_valor_encabezado(campo, v, respuestas) for v in valores]
            encabezado[campo] = next((v for v in valores if v is not None), None)
        lineas = []
        for renglon in filas:
            originales = {}
            for campo in CAMPOS_ENCABEZADO:
                if campo in renglon.errores:
                    continue
                propio = _valor_encabezado(campo, getattr(renglon, campo), respuestas)
                if propio is not None and propio != encabezado[campo]:
                    originales[campo] = (
                        propio.isoformat() if isinstance(propio, dt.date) else propio
                    )
            descripcion = renglon.descripcion
            notas = []
            if renglon.codigo is not None:
                oficial = catalogo.get(renglon.codigo)
                if oficial is None:
                    corregida = respuestas.codigos.get(renglon.codigo, (None, None))[1]
                    codigos_nuevos.setdefault(renglon.codigo, corregida or descripcion or "")
                elif descripcion is None or es_error_de_dedo(descripcion, oficial):
                    if descripcion and n.clave_laxa(descripcion) != n.clave_laxa(oficial):
                        bitacora.append((renglon.fila, "descripcion", descripcion, oficial))
                    descripcion = oficial
            if renglon.resto_cantidad:
                notas.append(f"Cantidad original: {renglon.crudo[9]!r}")
            if renglon.errores:
                notas.append("Datos perdidos en el DIARIO: " + ", ".join(sorted(renglon.errores)))
            lineas.append(
                LineaMigrada(
                    fila=renglon.fila,
                    oc=renglon.oc,
                    cantidad=renglon.cantidad,
                    codigo=renglon.codigo,
                    descripcion=descripcion,
                    clave=renglon.clave,
                    um=_normalizar("um", n.unidad(renglon.um) or None, respuestas),
                    lote=_normalizar("lote", renglon.lote, respuestas),
                    familia=renglon.familia,
                    transferencia_consumo=renglon.transferencia_consumo,
                    encabezado_original=originales,
                    notas=notas,
                )
            )
        vales.append(ValeMigrado(folio=folio, lineas=lineas, **encabezado))

    presentes = sorted(grupos)
    faltantes = (
        [f for f in range(presentes[0], presentes[-1] + 1) if f not in grupos] if presentes else []
    )
    return ResultadoLimpieza(
        vales=vales,
        omitidos=omitidos,
        correcciones=bitacora,
        folios_faltantes=faltantes,
        codigos_nuevos=codigos_nuevos,
    )


def _valor_encabezado(campo: str, valor, respuestas: RespuestasRevision):
    if campo in ("entrego", "recibio", "autorizo"):
        return respuestas.alias.get(valor, valor) if valor else valor
    if campo in CAMPOS_NORMALIZABLES:
        texto = n.valor_a_texto(valor)
        texto = texto.strip() if texto else None
        return _normalizar(campo, texto, respuestas)
    return valor
