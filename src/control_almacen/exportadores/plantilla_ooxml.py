"""Edición mínima de libros de Excel (OOXML) usando el archivo del usuario como plantilla.

Un .xlsx/.xlsm es un ZIP de partes XML. Aquí solo se reescriben las partes que
cambian; el resto (macros, botones, logos, customXml, configuración de impresora)
se copia intacto. Ver docs/03-arquitectura.md y docs/06-formatos-excel.md.

Está prohibido usar openpyxl.save() sobre los libros del usuario: pierde dibujos y macros.
"""

from __future__ import annotations

import datetime as dt
import os
import posixpath
import re
import tempfile
import zipfile
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

from lxml import etree

from control_almacen.dominio.normalizar import serial_excel

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS = {"m": NS_MAIN, "r": NS_R, "rel": NS_REL, "ct": NS_CT}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

TIPO_CALCCHAIN = f"{NS_R}/calcChain"
TIPO_TABLA = f"{NS_R}/table"
TIPO_COMENTARIOS = f"{NS_R}/comments"
TIPO_VML = f"{NS_R}/vmlDrawing"

_PARSER = etree.XMLParser(remove_blank_text=False, huge_tree=True, resolve_entities=False)


def q(etiqueta: str) -> str:
    """Nombre calificado en el espacio de nombres principal: q('row') → '{…main}row'."""
    return f"{{{NS_MAIN}}}{etiqueta}"


class ErrorPlantilla(ValueError):
    """La plantilla no tiene la estructura esperada."""


class PaqueteOOXML:
    """Un libro de Excel abierto como paquete ZIP para edición quirúrgica."""

    def __init__(self, ruta: Path) -> None:
        self.ruta = Path(ruta)
        with zipfile.ZipFile(self.ruta) as archivo:
            self._infos = archivo.infolist()
            self._datos = {info.filename: archivo.read(info.filename) for info in self._infos}
        self.modificadas: set[str] = set()
        self.eliminadas: set[str] = set()

    # ------------------------------------------------------------ partes

    def partes(self) -> list[str]:
        return [i.filename for i in self._infos if i.filename not in self.eliminadas]

    def existe(self, parte: str) -> bool:
        return parte in self._datos and parte not in self.eliminadas

    def leer(self, parte: str) -> bytes:
        return self._datos[parte]

    def xml(self, parte: str) -> etree._Element:
        return etree.fromstring(self._datos[parte], _PARSER)

    def escribir(self, parte: str, datos: bytes) -> None:
        if parte not in self._datos:
            raise ErrorPlantilla(f"No se agregan partes nuevas a la plantilla: {parte}")
        self._datos[parte] = datos
        self.modificadas.add(parte)

    def escribir_xml(self, parte: str, raiz: etree._Element) -> None:
        self.escribir(parte, serializar(raiz))

    def eliminar(self, parte: str) -> None:
        if parte in self._datos:
            self.eliminadas.add(parte)

    def guardar(self, destino: Path) -> Path:
        """Escribe el libro de forma atómica (archivo temporal + reemplazo)."""
        destino = Path(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporal = tempfile.mkstemp(
            prefix=".exportando_", suffix=destino.suffix, dir=destino.parent
        )
        os.close(descriptor)
        try:
            with zipfile.ZipFile(temporal, "w") as salida:
                for info in self._infos:
                    if info.filename in self.eliminadas:
                        continue
                    nueva = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                    nueva.compress_type = info.compress_type
                    nueva.external_attr = info.external_attr
                    salida.writestr(nueva, self._datos[info.filename])
            os.replace(temporal, destino)
        finally:
            if os.path.exists(temporal):
                os.remove(temporal)
        return destino

    # ------------------------------------------------------- relaciones

    @staticmethod
    def ruta_rels(parte: str) -> str:
        carpeta, nombre = posixpath.split(parte)
        return posixpath.join(carpeta, "_rels", f"{nombre}.rels")

    def relaciones(self, parte: str) -> list[tuple[str, str, str]]:
        """[(Id, Tipo, ruta absoluta de la parte destino)]."""
        rels = self.ruta_rels(parte)
        if not self.existe(rels):
            return []
        base = posixpath.dirname(parte)
        resultado = []
        for rel in self.xml(rels).findall("rel:Relationship", NS):
            destino = rel.get("Target")
            if rel.get("TargetMode") == "External":
                continue
            ruta = (
                destino.lstrip("/")
                if destino.startswith("/")
                else posixpath.normpath(posixpath.join(base, destino))
            )
            resultado.append((rel.get("Id"), rel.get("Type"), ruta))
        return resultado

    def relacion_de_tipo(self, parte: str, tipo: str) -> str | None:
        return next((ruta for _, t, ruta in self.relaciones(parte) if t == tipo), None)

    def hojas(self) -> list[tuple[str, str]]:
        """[(nombre exacto de la hoja, ruta de su parte)] en el orden del libro."""
        libro = self.xml("xl/workbook.xml")
        rutas = {rid: ruta for rid, _, ruta in self.relaciones("xl/workbook.xml")}
        return [
            (hoja.get("name"), rutas[hoja.get(f"{{{NS_R}}}id")])
            for hoja in libro.find("m:sheets", NS).findall("m:sheet", NS)
        ]

    def parte_de_hoja(self, nombre: str) -> str:
        for hoja, ruta in self.hojas():
            if hoja == nombre:
                return ruta
        raise ErrorPlantilla(f"La plantilla no tiene la hoja '{nombre}'")

    # ------------------------------------------------------------ cálculo

    def eliminar_calcchain(self) -> None:
        """Quita calcChain.xml y pide a Excel recalcular todo al abrir."""
        libro_rels = self.ruta_rels("xl/workbook.xml")
        cadena = self.relacion_de_tipo("xl/workbook.xml", TIPO_CALCCHAIN)
        if cadena:
            self.eliminar(cadena)
            rels = self.xml(libro_rels)
            for rel in rels.findall("rel:Relationship", NS):
                if rel.get("Type") == TIPO_CALCCHAIN:
                    rels.remove(rel)
            self.escribir_xml(libro_rels, rels)
            tipos = self.xml("[Content_Types].xml")
            for override in tipos.findall("ct:Override", NS):
                if override.get("PartName") == f"/{cadena}":
                    tipos.remove(override)
            self.escribir_xml("[Content_Types].xml", tipos)
        libro = self.xml("xl/workbook.xml")
        calc = libro.find("m:calcPr", NS)
        if calc is None:
            calc = etree.SubElement(libro, q("calcPr"))
        calc.set("fullCalcOnLoad", "1")
        self.escribir_xml("xl/workbook.xml", libro)


def serializar(raiz: etree._Element) -> bytes:
    return etree.tostring(raiz, xml_declaration=True, encoding="UTF-8", standalone=True)


# ---------------------------------------------------------------- celdas


def letra_columna(indice: int) -> str:
    """1 → A, 27 → AA."""
    letras = ""
    while indice:
        indice, resto = divmod(indice - 1, 26)
        letras = chr(65 + resto) + letras
    return letras


def indice_columna(letras: str) -> int:
    valor = 0
    for letra in letras:
        valor = valor * 26 + ord(letra) - 64
    return valor


def separar_referencia(referencia: str) -> tuple[str, int]:
    coincidencia = re.fullmatch(r"\$?([A-Z]{1,3})\$?(\d+)", referencia)
    if not coincidencia:
        raise ValueError(f"Referencia inválida: {referencia}")
    return coincidencia.group(1), int(coincidencia.group(2))


def celda(referencia: str, valor: object, estilo: str | None = None) -> etree._Element:
    """Crea <c> para un valor Python: número, fecha, texto (inline) o vacío."""
    elemento = etree.Element(q("c"), r=referencia)
    if estilo is not None:
        elemento.set("s", estilo)
    if valor is None:
        return elemento
    if isinstance(valor, bool):
        elemento.set("t", "b")
        etree.SubElement(elemento, q("v")).text = "1" if valor else "0"
    elif isinstance(valor, int | Decimal | float):
        texto = (
            format(Decimal(str(valor)).normalize(), "f")
            if not isinstance(valor, int)
            else str(valor)
        )
        etree.SubElement(elemento, q("v")).text = texto
    elif isinstance(valor, dt.date):
        etree.SubElement(elemento, q("v")).text = str(serial_excel(valor))
    else:
        texto = str(valor)
        elemento.set("t", "inlineStr")
        nodo = etree.SubElement(etree.SubElement(elemento, q("is")), q("t"))
        nodo.text = texto
        if texto != texto.strip() or "\n" in texto:
            nodo.set(XML_SPACE, "preserve")
    return elemento


def celda_formula(referencia: str, formula: str, estilo: str | None = None) -> etree._Element:
    elemento = etree.Element(q("c"), r=referencia)
    if estilo is not None:
        elemento.set("s", estilo)
    etree.SubElement(elemento, q("f")).text = formula
    return elemento


_REFERENCIA = re.compile(r"(?<![A-Za-z0-9_$.\[\]])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(\[])")


def desplazar_formula(formula: str, delta_filas: int) -> str:
    """Copia una fórmula a otra fila, como Excel: mueve solo las filas relativas.

    'IF(B2="",…,ARTICULOS_MX!$A$2:$B$5000,2,)' con delta 3 → 'IF(B5="",…,$A$2:$B$5000,…)'.
    Respeta textos entre comillas y referencias estructuradas de tabla.
    """
    if not delta_filas:
        return formula
    partes = formula.split('"')
    for i in range(0, len(partes), 2):  # fuera de comillas
        partes[i] = _REFERENCIA.sub(
            lambda c: (
                c.group(0)
                if c.group(3)
                else f"{c.group(1)}{c.group(2)}{int(c.group(4)) + delta_filas}"
            ),
            partes[i],
        )
    return '"'.join(partes)


class HojaXML:
    """Acceso a las filas de una hoja para reemplazarlas conservando estilos."""

    def __init__(self, raiz: etree._Element) -> None:
        self.raiz = raiz
        self.datos = raiz.find("m:sheetData", NS)
        if self.datos is None:
            raise ErrorPlantilla("La hoja no tiene sheetData")
        self.filas = {int(f.get("r")): f for f in self.datos.findall("m:row", NS)}

    def celdas(self, numero_fila: int) -> dict[str, etree._Element]:
        fila = self.filas.get(numero_fila)
        if fila is None:
            return {}
        return {separar_referencia(c.get("r"))[0]: c for c in fila.findall("m:c", NS)}

    def estilos(self, numero_fila: int) -> dict[str, str]:
        return {
            col: c.get("s") for col, c in self.celdas(numero_fila).items() if c.get("s") is not None
        }

    def formulas(self, numero_fila: int) -> dict[str, str]:
        resultado = {}
        for col, c in self.celdas(numero_fila).items():
            f = c.find("m:f", NS)
            if f is not None and f.text:
                resultado[col] = f.text
        return resultado

    def atributos_fila(self, numero_fila: int) -> dict[str, str]:
        fila = self.filas.get(numero_fila)
        if fila is None:
            return {}
        return {k: v for k, v in fila.attrib.items() if k not in ("r", "spans")}

    @staticmethod
    def nueva_fila(
        numero: int, celdas: list[etree._Element], atributos: dict[str, str]
    ) -> etree._Element:
        fila = etree.Element(q("row"), r=str(numero))
        for clave, valor in atributos.items():
            fila.set(clave, valor)
        for c in celdas:
            fila.append(c)
        return fila

    @staticmethod
    def mover_fila(fila: etree._Element, numero: int) -> etree._Element:
        """Copia una fila existente a otro número de fila (ajusta referencias y fórmulas)."""
        copia = deepcopy(fila)
        anterior = int(copia.get("r"))
        copia.set("r", str(numero))
        copia.attrib.pop("spans", None)
        for c in copia.findall("m:c", NS):
            columna, _ = separar_referencia(c.get("r"))
            c.set("r", f"{columna}{numero}")
            f = c.find("m:f", NS)
            if f is not None and f.text:
                f.text = desplazar_formula(f.text, numero - anterior)
            v = c.find("m:v", NS)
            if f is not None and v is not None:
                c.remove(v)
        return copia

    def reemplazar_filas(self, conservar: list[int], nuevas: list[etree._Element]) -> None:
        """Deja en sheetData solo las filas `conservar` (sin cambios) seguidas de `nuevas`."""
        for fila in list(self.datos):
            self.datos.remove(fila)
        for numero in sorted(conservar):
            if numero in self.filas:
                self.datos.append(self.filas[numero])
        for fila in nuevas:
            self.datos.append(fila)

    def ajustar_dimension(self, ultima_fila: int) -> None:
        dimension = self.raiz.find("m:dimension", NS)
        if dimension is None:
            return
        inicio, _, fin = dimension.get("ref").partition(":")
        columna_fin = separar_referencia(fin or inicio)[0]
        dimension.set("ref", f"{inicio if fin else 'A1'}:{columna_fin}{ultima_fila}")


def cambiar_ultima_fila(rango: str, ultima_fila: int) -> str:
    """'DIARIO!$A$1:$T$1293' → 'DIARIO!$A$1:$T$<ultima>'; 'A1:J104' → 'A1:J<ultima>'."""
    return re.sub(r"(\$?[A-Z]{1,3}\$?)(\d+)$", lambda c: f"{c.group(1)}{ultima_fila}", rango)
