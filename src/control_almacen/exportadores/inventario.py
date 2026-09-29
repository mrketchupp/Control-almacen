"""Exporta INVENTARIO DE REFACCIONAMIENTO…xlsx sobre la plantilla del usuario.

Por cada hoja de contenedor se reescriben los renglones de la tabla, la fila de
totales, el rango de la tabla, las áreas de impresión/filtro y las notas.
Ver docs/06-formatos-excel.md, sección A.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from lxml import etree
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from control_almacen.db import modelos as m
from control_almacen.dominio.existencias import calcular_saldos
from control_almacen.dominio.normalizar import codigo_ax, texto_o_numero
from control_almacen.exportadores.plantilla_ooxml import (
    NS,
    TIPO_COMENTARIOS,
    TIPO_TABLA,
    TIPO_VML,
    ErrorPlantilla,
    HojaXML,
    PaqueteOOXML,
    cambiar_ultima_fila,
    celda,
    celda_formula,
    desplazar_formula,
    separar_referencia,
    serializar,
)

HOJA_CATALOGO = "ARTICULOS_MX"
COLUMNAS = "ABCDEFGHIJ"
CERO = Decimal(0)


@dataclass
class ResultadoInventario:
    destino: Path
    renglones: int
    hojas: int
    partes_modificadas: list[str]
    advertencias: list[str] = field(default_factory=list)


def exportar_inventario(sesion: Session, plantilla: Path, destino: Path) -> ResultadoInventario:
    paquete = PaqueteOOXML(plantilla)
    hojas = paquete.hojas()
    indice_hoja = {nombre: i for i, (nombre, _) in enumerate(hojas)}
    partes = dict(hojas)
    saldos = calcular_saldos(sesion)
    libro = paquete.xml("xl/workbook.xml")
    advertencias: list[str] = []
    total_renglones = 0

    ubicaciones = sesion.scalars(select(m.Ubicacion).order_by(m.Ubicacion.orden)).all()
    for ubicacion in ubicaciones:
        if ubicacion.hoja_excel not in partes:
            raise ErrorPlantilla(f"La plantilla no tiene la hoja '{ubicacion.hoja_excel}'")
        existencias = sesion.scalars(
            select(m.Existencia)
            .options(joinedload(m.Existencia.variante))
            .where(m.Existencia.ubicacion_id == ubicacion.id)
            .order_by(m.Existencia.orden)
        ).all()
        ultima = _exportar_hoja(
            paquete, partes[ubicacion.hoja_excel], existencias, saldos, advertencias
        )
        _ajustar_nombres(libro, indice_hoja[ubicacion.hoja_excel], ultima)
        total_renglones += len(existencias)

    if HOJA_CATALOGO in partes:
        _actualizar_catalogo(paquete, partes[HOJA_CATALOGO], sesion)
    paquete.escribir_xml("xl/workbook.xml", libro)
    paquete.eliminar_calcchain()
    paquete.guardar(destino)
    return ResultadoInventario(
        destino=destino,
        renglones=total_renglones,
        hojas=len(ubicaciones),
        partes_modificadas=sorted(paquete.modificadas | {f"-{p}" for p in paquete.eliminadas}),
        advertencias=advertencias,
    )


# --------------------------------------------------------------------- hoja


def _exportar_hoja(
    paquete: PaqueteOOXML,
    parte: str,
    existencias: list[m.Existencia],
    saldos: dict,
    advertencias: list[str],
) -> int:
    hoja = HojaXML(paquete.xml(parte))
    parte_tabla = paquete.relacion_de_tipo(parte, TIPO_TABLA)
    if parte_tabla is None:
        raise ErrorPlantilla(f"La hoja {parte} no tiene tabla de Excel")
    tabla = paquete.xml(parte_tabla)
    inicio, _, fin = tabla.get("ref").partition(":")
    _, fila_encabezado = separar_referencia(inicio)
    _, fila_fin = separar_referencia(fin)
    con_totales = int(tabla.get("totalsRowCount", "0") or 0) > 0
    fila_totales = fila_fin if con_totales else None
    ultima_datos_plantilla = fila_fin - 1 if con_totales else fila_fin
    filas_datos = [
        n for n in range(fila_encabezado + 1, ultima_datos_plantilla + 1) if n in hoja.filas
    ]
    modelo = next(
        (n for n in filas_datos if codigo_ax(_valor_numerico(hoja, n, "B")) is not None),
        filas_datos[0] if filas_datos else None,
    )
    estilos_modelo = hoja.estilos(modelo) if modelo else {}
    atributos_modelo = hoja.atributos_fila(modelo) if modelo else {}
    formulas_modelo = hoja.formulas(modelo) if modelo else {}

    nuevas = []
    mapa_filas: dict[int, int] = {}
    for posicion, existencia in enumerate(existencias, start=1):
        numero = fila_encabezado + posicion
        origen = existencia.fila_origen
        if (
            origen in filas_datos
            and codigo_ax(_valor_numerico(hoja, origen, "B")) == existencia.variante.codigo
        ):
            estilos, atributos = hoja.estilos(origen), hoja.atributos_fila(origen)
            mapa_filas[origen] = numero
        else:
            estilos, atributos = estilos_modelo, atributos_modelo
        saldo = saldos.get(existencia.id)
        consumo = saldo.consumo if saldo else CERO
        ingreso = saldo.ingreso if saldo else CERO
        variante = existencia.variante
        valores = {
            "A": posicion,
            "B": variante.codigo,
            "D": texto_o_numero(existencia.dimension_mostrada),
            "E": texto_o_numero(existencia.np_mostrado),
            "F": existencia.cantidad_conteo,
            "G": existencia.um_mostrada or None,
            "H": consumo or None,
            "I": ingreso or None,
        }
        celdas = []
        for columna in COLUMNAS:
            referencia = f"{columna}{numero}"
            if columna in formulas_modelo:
                formula = desplazar_formula(formulas_modelo[columna], numero - modelo)
                celdas.append(celda_formula(referencia, formula, estilos.get(columna)))
            else:
                celdas.append(celda(referencia, valores.get(columna), estilos.get(columna)))
        nuevas.append(HojaXML.nueva_fila(numero, celdas, atributos))

    ultima_datos = fila_encabezado + len(existencias)
    ultima = ultima_datos
    if fila_totales is not None:
        ultima = ultima_datos + 1
        nuevas.append(HojaXML.mover_fila(hoja.filas[fila_totales], ultima))
    # Filas debajo de la tabla (formato, celdas sueltas): se recorren como lo haría Excel.
    delta = ultima - fila_fin
    for numero in sorted(n for n in hoja.filas if n > fila_fin):
        nuevas.append(HojaXML.mover_fila(hoja.filas[numero], numero + delta))
        mapa_filas[numero] = numero + delta
    conservar = [n for n in hoja.filas if n <= fila_encabezado]
    hoja.reemplazar_filas(conservar, nuevas)
    hoja.ajustar_dimension(max([ultima, *(n + delta for n in hoja.filas if n > fila_fin)]))
    paquete.escribir_xml(parte, hoja.raiz)

    tabla.set("ref", f"{inicio}:{separar_referencia(fin)[0]}{ultima}")
    filtro = tabla.find("m:autoFilter", NS)
    if filtro is not None:
        filtro.set(
            "ref", cambiar_ultima_fila(filtro.get("ref"), max(ultima_datos, fila_encabezado + 1))
        )
    paquete.escribir_xml(parte_tabla, tabla)

    if fila_totales is not None:
        mapa_filas[fila_totales] = ultima
    _mover_notas(paquete, parte, mapa_filas, advertencias)
    return ultima


def _valor_numerico(hoja: HojaXML, fila: int, columna: str):
    c = hoja.celdas(fila).get(columna)
    if c is None or c.get("t") in ("s", "inlineStr", "str"):
        return None
    v = c.find("m:v", NS)
    return v.text if v is not None else None


def _ajustar_nombres(libro: etree._Element, indice: int, ultima: int) -> None:
    """Área de impresión y filtro de la hoja al nuevo último renglón."""
    for nombre in libro.findall("m:definedNames/m:definedName", NS):
        if nombre.get("localSheetId") != str(indice):
            continue
        if nombre.get("name") == "_xlnm.Print_Area":
            nombre.text = cambiar_ultima_fila(nombre.text, ultima)
        elif nombre.get("name") == "_xlnm._FilterDatabase":
            nombre.text = cambiar_ultima_fila(nombre.text, max(ultima - 1, 2))


# -------------------------------------------------------------------- notas

_ROW_VML = re.compile(r"(<x:Row>)(\d+)(</x:Row>)")
_ANCLA_VML = re.compile(r"(<x:Anchor>)([^<]*)(</x:Anchor>)")
_FORMA_VML = re.compile(r"<v:shape\b.*?</v:shape>", re.DOTALL)


def _mover_notas(
    paquete: PaqueteOOXML, parte: str, mapa: dict[int, int], advertencias: list[str]
) -> None:
    """Las notas de celda siguen a su renglón (ref en comments y fila en el VML)."""
    parte_notas = paquete.relacion_de_tipo(parte, TIPO_COMENTARIOS)
    if parte_notas is None:
        return
    notas = paquete.xml(parte_notas)
    lista = notas.find("m:commentList", NS)
    eliminadas: set[int] = set()
    cambio = False
    for nota in list(lista):
        columna, fila = separar_referencia(nota.get("ref"))
        if fila not in mapa:
            if fila > 1:
                lista.remove(nota)
                eliminadas.add(fila)
                cambio = True
            continue
        if mapa[fila] != fila:
            nota.set("ref", f"{columna}{mapa[fila]}")
            cambio = True
    if eliminadas:
        advertencias.append(
            f"{parte}: se quitaron notas de filas que ya no existen {sorted(eliminadas)}"
        )
    if cambio:
        paquete.escribir(parte_notas, serializar(notas))
    parte_vml = paquete.relacion_de_tipo(parte, TIPO_VML)
    if parte_vml is None or not cambio:
        return
    texto = paquete.leer(parte_vml).decode("utf-8", errors="surrogateescape")

    def ajustar_forma(forma: re.Match) -> str:
        bloque = forma.group(0)
        fila_vml = _ROW_VML.search(bloque)
        if not fila_vml:
            return bloque
        anterior = int(fila_vml.group(2)) + 1
        if anterior not in mapa:
            return "" if anterior in eliminadas else bloque
        delta = mapa[anterior] - anterior
        if not delta:
            return bloque
        bloque = _ROW_VML.sub(
            lambda c: f"{c.group(1)}{int(c.group(2)) + delta}{c.group(3)}", bloque
        )

        def ancla(c: re.Match) -> str:
            numeros = [x.strip() for x in c.group(2).split(",")]
            if len(numeros) == 8:
                numeros[2] = str(int(numeros[2]) + delta)
                numeros[6] = str(int(numeros[6]) + delta)
            return f"{c.group(1)}{', '.join(numeros)}{c.group(3)}"

        return _ANCLA_VML.sub(ancla, bloque)

    nuevo = _FORMA_VML.sub(ajustar_forma, texto)
    paquete.escribir(parte_vml, nuevo.encode("utf-8", errors="surrogateescape"))


# ----------------------------------------------------------------- catálogo


def _actualizar_catalogo(paquete: PaqueteOOXML, parte: str, sesion: Session) -> None:
    """Reescribe ARTICULOS_MX solo si hay códigos que la plantilla no tiene."""
    hoja = HojaXML(paquete.xml(parte))
    en_plantilla = set()
    for numero in hoja.filas:
        valor = _valor_numerico(hoja, numero, "A")
        codigo = codigo_ax(valor.split(".")[0] if valor else None)
        if codigo is not None:
            en_plantilla.add(codigo)
    articulos = sesion.scalars(select(m.Articulo).order_by(m.Articulo.codigo)).all()
    if {a.codigo for a in articulos} <= en_plantilla:
        return
    primera_datos = min((n for n in hoja.filas if _valor_numerico(hoja, n, "A")), default=3)
    estilos = hoja.estilos(primera_datos)
    atributos = hoja.atributos_fila(primera_datos)
    nuevas = [
        HojaXML.nueva_fila(
            numero,
            [
                celda(f"A{numero}", articulo.codigo, estilos.get("A")),
                celda(f"B{numero}", articulo.descripcion, estilos.get("B")),
            ],
            atributos,
        )
        for numero, articulo in enumerate(articulos, start=primera_datos)
    ]
    hoja.reemplazar_filas([n for n in hoja.filas if n < primera_datos], nuevas)
    hoja.ajustar_dimension(primera_datos + len(articulos) - 1)
    paquete.escribir_xml(parte, hoja.raiz)
