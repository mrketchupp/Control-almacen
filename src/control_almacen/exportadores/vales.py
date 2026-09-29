"""Exporta VALES DE SALIDA DLTA.xlsm: solo se reescribe la hoja DIARIO.

Mapeo de columnas en docs/06-formatos-excel.md, sección B. Emula lo que hacía la
macro PasarDatos: los campos vacíos se escribían como 0 y la O.C. vacía como S/OC.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from control_almacen.db import modelos as m
from control_almacen.dominio.normalizar import texto_o_numero
from control_almacen.exportadores.plantilla_ooxml import (
    NS,
    HojaXML,
    PaqueteOOXML,
    cambiar_ultima_fila,
    celda,
    letra_columna,
)

HOJA_DIARIO = "DIARIO"
MARCA = "XXXXX"
COLUMNAS = 20  # A–T
FILAS_VISIBLES_AL_ABRIR = 34


@dataclass
class ResultadoExportacion:
    destino: Path
    renglones: int
    ultimo_folio: int | None
    partes_modificadas: list[str]


def _o_cero(valor):
    return 0 if valor in (None, "") else valor


def valores_renglon(vale: m.Vale, linea: m.ValeLinea | None) -> list:
    """Los 20 valores (A–T) de un renglón del DIARIO."""
    encabezado = {
        "fecha": vale.fecha,
        "origen": vale.origen,
        "depto_origen": vale.depto_origen,
        "destino": vale.destino,
        "depto_destino": vale.depto_destino,
        "entrego": vale.entrego_nombre,
        "recibio": vale.recibio_nombre,
        "autorizo": vale.autorizo_nombre,
    }
    if linea is not None and linea.encabezado_original:
        propios = json.loads(linea.encabezado_original)
        if "fecha" in propios:
            propios["fecha"] = dt.date.fromisoformat(propios["fecha"])
        encabezado.update(propios)
    es_entrada = vale.tipo == "ENTRADA"
    if linea is None:  # vale cancelado sin renglones que mostrar
        cantidad, codigo, descripcion = (
            0,
            0,
            f"CANCELADO – {vale.motivo_cancelacion or ''}".strip(" –"),
        )
        oc = clave = um = lote = familia = transferencia = None
    else:
        cantidad = linea.cantidad
        codigo, descripcion, oc = linea.codigo, linea.descripcion, linea.oc
        clave, um, lote = linea.clave, linea.um, linea.lote
        familia, transferencia = linea.familia, linea.transferencia_consumo
    return [
        encabezado["fecha"],
        vale.folio,
        MARCA if es_entrada else 0,
        0 if es_entrada else MARCA,
        _o_cero(encabezado["origen"]),
        _o_cero(encabezado["depto_origen"]),
        _o_cero(encabezado["destino"]),
        _o_cero(encabezado["depto_destino"]),
        texto_o_numero(oc) if oc else "S/OC",
        _o_cero(cantidad if isinstance(cantidad, Decimal | int) else None),
        _o_cero(codigo),
        _o_cero(descripcion),
        _o_cero(texto_o_numero(clave)),
        _o_cero(um),
        _o_cero(texto_o_numero(lote)),
        _o_cero(encabezado["entrego"]),
        _o_cero(encabezado["recibio"]),
        _o_cero(encabezado["autorizo"]),
        familia,
        transferencia,
    ]


def renglones_diario(
    sesion: Session, tipo: str = "SALIDA"
) -> list[tuple[m.Vale, m.ValeLinea | None]]:
    vales = sesion.scalars(
        select(m.Vale)
        .options(selectinload(m.Vale.lineas))
        .where(m.Vale.tipo == tipo, m.Vale.estado.in_(("EMITIDO", "CANCELADO")))
        .order_by(m.Vale.folio)
    )
    renglones: list[tuple[m.Vale, m.ValeLinea | None]] = []
    for vale in vales:
        if vale.estado == "CANCELADO":
            renglones.append((vale, None))
            continue
        renglones.extend((vale, linea) for linea in vale.lineas)
    return renglones


def exportar_vales(sesion: Session, plantilla: Path, destino: Path) -> ResultadoExportacion:
    paquete = PaqueteOOXML(plantilla)
    parte = paquete.parte_de_hoja(HOJA_DIARIO)
    hoja = HojaXML(paquete.xml(parte))
    ultima_plantilla = max(n for n in hoja.filas if n > 1) if len(hoja.filas) > 1 else 1
    estilos_defecto = hoja.estilos(ultima_plantilla)
    atributos_defecto = hoja.atributos_fila(ultima_plantilla)

    nuevas = []
    renglones = renglones_diario(sesion)
    for numero, (vale, linea) in enumerate(renglones, start=2):
        origen = linea.fila_diario_origen if linea is not None else None
        estilos = hoja.estilos(origen) if origen in hoja.filas else estilos_defecto
        atributos = hoja.atributos_fila(origen) if origen in hoja.filas else atributos_defecto
        celdas = []
        for indice, valor in enumerate(valores_renglon(vale, linea), start=1):
            columna = letra_columna(indice)
            estilo = estilos.get(columna, estilos_defecto.get(columna))
            if valor is None and estilo is None:
                continue
            celdas.append(celda(f"{columna}{numero}", valor, estilo))
        nuevas.append(HojaXML.nueva_fila(numero, celdas, atributos))

    ultima = max(1, len(renglones) + 1)
    hoja.reemplazar_filas([1], nuevas)
    hoja.ajustar_dimension(ultima)
    filtro = hoja.raiz.find("m:autoFilter", NS)
    if filtro is not None:
        filtro.set("ref", cambiar_ultima_fila(filtro.get("ref"), ultima))
    vista = hoja.raiz.find("m:sheetViews/m:sheetView/m:pane", NS)
    if vista is not None and vista.get("state") == "frozen":
        vista.set("topLeftCell", f"A{max(2, ultima - FILAS_VISIBLES_AL_ABRIR)}")
    paquete.escribir_xml(parte, hoja.raiz)
    _ajustar_nombre_filtro(paquete, HOJA_DIARIO, ultima)

    paquete.guardar(destino)
    ultimo_folio = max((v.folio for v, _ in renglones if v.folio is not None), default=None)
    return ResultadoExportacion(destino, len(renglones), ultimo_folio, sorted(paquete.modificadas))


def _ajustar_nombre_filtro(paquete: PaqueteOOXML, nombre_hoja: str, ultima: int) -> None:
    """Actualiza _xlnm._FilterDatabase de la hoja (si existe) al nuevo último renglón."""
    indice = next(i for i, (nombre, _) in enumerate(paquete.hojas()) if nombre == nombre_hoja)
    libro = paquete.xml("xl/workbook.xml")
    cambiado = False
    for nombre in libro.findall("m:definedNames/m:definedName", NS):
        if nombre.get("name") == "_xlnm._FilterDatabase" and nombre.get("localSheetId") == str(
            indice
        ):
            nombre.text = cambiar_ultima_fila(nombre.text, ultima)
            cambiado = True
    if cambiado:
        paquete.escribir_xml("xl/workbook.xml", libro)
