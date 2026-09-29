"""Genera Excel SINTÉTICOS que imitan la estructura de los archivos reales.

No contienen ningún dato real: nombres, códigos y cantidades son inventados.
Reproducen lo que importa para las pruebas:
- nombres de hoja con espacio final, tablas con fila de totales, fórmulas por renglón,
  notas de celda y hoja de catálogo oculta (inventario);
- hoja DIARIO con errores típicos (#REF!, duplicados, fechas como texto), hojas-formulario,
  macros, botón con macro asignada, imagen, customXml y calcChain (vales).
"""

from __future__ import annotations

import datetime as dt
import re
import zipfile
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.worksheet.filters import AutoFilter
from openpyxl.worksheet.table import Table, TableColumn, TableStyleInfo

CATALOGO = {
    136: "SUMINISTRO DE DIESEL Y COMBUSTIBLE",
    701: "BALEROS",
    702: "FILTROS",
    703: "TORNILLOS",
    704: "EMPAQUE",
    705: "MANGUERA",
    706: "SELLOS",
    707: "VALVULA (INVENTARIABLE-REFACCIONES)",
    708: "GRASA",
    709: "CABLES",
    710: "LAMPARA DE USO GENERAL",
}
SOLO_EN_VALES = {721: "CODIGO SOLO EN CATALOGO DE VALES"}

ENCABEZADOS_INV = [
    "ITEM",
    "CODIGO AX",
    "DESCRIPCIÓN ",
    "DIMENSION",
    "NP",
    "CANTIDAD",
    "UM",
    "CONSUMO",
    "INGRESO",
    "TOTAL",
]

# (item, código, dimensión, np, cantidad, um, consumo, ingreso)
HOJAS_INV = {
    "CONTENEDOR #1 INVENTARIABLE": [
        (1, 701, "6309-2Z/C3", None, 7, "PZA", None, None),
        (2, 701, "6205-2Z", None, 6, "PZA ", None, None),
        (3, 707, 'MARIPOSA 4"', None, 4, "PZA", None, None),
        (None, 710, "S/D", "X00489", 0, "PZA", None, None),
        (5, 706, 555001, None, 2, "PZA", 1, None),
    ],
    "CONTENEDOR #1 CONSUMIBLE ": [
        (1, 702, "P551317", None, 25, "PZA", None, None),
        (2, 702, "P557500", None, 21, "PZA", None, None),
        (3, 704, '6"', "FLEXITALIC", 65, "PZA", None, None),
        (4, 704, '6"', "FLEXITALIC", 65, "PZA", None, None),
        (5, 708, "ISOFLEX", None, 39, "PZA", None, 2),
        None,  # renglón vacío dentro de la tabla
    ],
    "CONTENEDOR #2 INVENTARIABLE": [
        (1, 701, "6309-2Z/C3", None, 3, "PZA", None, None),
        (2, 799, "SIN DIMENSION", None, 1, "PZA", None, None),
    ],
    "CONTENEDOR #2 CONSUMIBLE": [
        (1, 705, '1/2"', None, 100, "MTS", None, None),
        (2, 705, "12", None, 5, "MTS", None, None),
    ],
}
NOTAS_INV = {("CONTENEDOR #1 INVENTARIABLE", "D4"): "Revisar dimensión en físico"}

ENCABEZADOS_DIARIO = [
    "FECHA",
    "No. folio",
    "Pase de Entrada",
    "Pase de Salida",
    "Origen: ",
    "Depto",
    "Destino",
    "Depto",
    "OC",
    "Cantidad",
    "Código",
    "Descripción",
    "CLAVE",
    "U.M.",
    "C.U",
    "Entrego/Recibio",
    "Entrego/Recibio",
    "Autorizo",
    "FAMILIA ",
    "TRANSFERENCIA/CONSUMO",
]
F = dt.datetime
_ALM, _MEC = "ALMACENISTA UNO", "MECANICO UNO"
# Cada renglón: 20 columnas A–T.
DIARIO = [
    [
        F(2026, 9, 1),
        1,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        "RIG 91",
        "MECANICO ",
        "S/OC",
        2,
        702,
        "FILTROS",
        "P551317",
        "PZA",
        0,
        _ALM,
        _MEC,
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 1),
        1,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        "RIG 91",
        "MECANICO ",
        "S/OC",
        3,
        702,
        "FILTROS",
        "P557500",
        "PZA",
        0,
        _ALM,
        _MEC,
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 2),
        2,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        "RIG 91",
        "OPERACIÓN",
        "S/OC",
        1,
        708,
        "GRASA",
        "ISOFLEX",
        "PZA",
        0,
        _ALM,
        "OPERADOR UNO",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 2),
        2,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        "RIG 91",
        "OPERACIÓN",
        "S/OC",
        1,
        708,
        "GRASA",
        "ISOFLEX",
        "PZA",
        0,
        _ALM,
        "OPERADOR UNO",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 2),
        3,
        "#REF!",
        "#REF!",
        "#REF!",
        "#REF!",
        "#REF!",
        "SOLDADOR",
        "S/OC",
        5,
        704,
        "EMPAQUE",
        '6"',
        "PZA",
        "#REF!",
        _ALM,
        "SOLDADOR UNO",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 2),
        3,
        0,
        "XXXXX",
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
        "SOLDADOR",
        "S/OC",
        2,
        703,
        "TORNILLOS",
        "1/2 X 2",
        "PZA",
        0,
        _ALM,
        "SOLDADOR UNO",
        0,
        None,
        None,
    ],
    ["#REF!"] * 18 + [None, None],
    [
        " 03/09/2026",
        4,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        "RIG 91",
        "MECANICO ",
        "S/OC",
        "15LTS",
        799,
        "ARTICULO NUEVO",
        "S/D",
        "LTS",
        0,
        _ALM,
        _MEC,
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 3),
        5,
        0,
        "XXXXX",
        "RIG 91",
        "ALMACEN",
        0,
        "OPERACIÓN",
        "S/OC",
        200,
        136,
        "SUMINISTRO DE DIESEL Y COMBUSTIBLE",
        "DIESEL",
        "LTS",
        "MONTACARGAS",
        _ALM,
        "OPERADOR UNO",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 4),
        6,
        0,
        "XXXXX",
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
        "TOP DRIVE ",
        "S/OC",
        1,
        701,
        "BALEROS",
        "6309-2Z/C3",
        "PZA",
        0,
        _ALM,
        "OPERADOR TD",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 4),
        6,
        0,
        "XXXXX",
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
        "TOP DRIVE ",
        "S/OC",
        1,
        706,
        "SELLOS",
        555001,
        "PZA",
        0,
        _ALM,
        "OPERADOR TD",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 5),
        7,
        0,
        "XXXXX",
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
        "MECANICO ",
        "S/OC",
        4,
        702,
        "FILTRO",
        "P551317",
        "PZA",
        0,
        _ALM,
        "MECANICO UNOO",
        0,
        None,
        None,
    ],
    [
        F(2026, 9, 5),
        7,
        0,
        "XXXXX",
        "RIG 91",
        "MANTENIMIENTO",
        "RIG 91",
        "MECANICO ",
        11536,
        1,
        704,
        "EMPAQUE",
        '6"',
        "PZA",
        "NUEVO",
        _ALM,
        "MECANICO UNOO",
        0,
        "INV",
        "CONSUMO",
    ],
    [
        F(2026, 9, 6),
        9,
        0,
        "XXXXX",
        "RIG 91 ",
        "ALMACEN",
        "RIG 48",
        "TRANSFERENCIA ",
        "S/CO",
        2,
        705,
        "MANGUERA",
        '1/2"',
        "MTS",
        0,
        _ALM,
        "RECEPTOR RIG 48",
        "AUTORIZADOR UNO",
        None,
        None,
    ],
]
FOLIO_CORTE = 5  # los vales con folio > 5 descuentan del conteo sintético

FORMULARIOS = {
    # hoja: (depto origen, depto destino, receptor, puesto receptor, desplazamiento firmas)
    "SOLDADOR": ("MANTENIMIENTO", "SOLDADOR", "SOLDADOR UNO", "SOLDADOR", 0),
    "MECANICO ": ("MANTENIMIENTO", "MECANICO ", _MEC, "MECANICO", -2),
    "TRANSFERENCIAS": ("ALMACEN", "TRANSFERENCIA ", "RECEPTOR RIG 48", "SUP. RIG 48", 0),
}

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000100e221bc330000000049454e44ae426082"
)


# ------------------------------------------------------------------ inventario


def generar_inventario(ruta: Path) -> Path:
    wb = Workbook()
    wb.remove(wb.active)
    for numero, (hoja, renglones) in enumerate(HOJAS_INV.items(), start=1):
        ws = wb.create_sheet(hoja)
        tabla = f"Tabla{numero}"
        ws.append(ENCABEZADOS_INV)
        for fila, datos in enumerate(renglones, start=2):
            if datos is None:
                ws.cell(
                    fila,
                    10,
                    f"={tabla}[[#This Row],[INGRESO]]+{tabla}[[#This Row],[CANTIDAD]]-{tabla}[[#This Row],[CONSUMO]]",
                )
                continue
            item, codigo, dimension, np, cantidad, um, consumo, ingreso = datos
            ws.cell(fila, 1, item)
            ws.cell(fila, 2, codigo)
            ws.cell(
                fila,
                3,
                f'=IF(B{fila}="","",VLOOKUP({tabla}[[#This Row],[CODIGO AX]],ARTICULOS_MX!$A$2:$B$5000,2,))',
            )
            ws.cell(fila, 4, dimension)
            ws.cell(fila, 5, np)
            ws.cell(fila, 6, cantidad)
            ws.cell(fila, 7, um)
            ws.cell(fila, 8, consumo)
            ws.cell(fila, 9, ingreso)
            ws.cell(
                fila,
                10,
                f"={tabla}[[#This Row],[INGRESO]]+{tabla}[[#This Row],[CANTIDAD]]-{tabla}[[#This Row],[CONSUMO]]",
            )
        totales = len(renglones) + 2
        ws.cell(totales, 1, "Total")
        for col, letra in ((6, "CANTIDAD"), (8, "CONSUMO"), (9, "INGRESO"), (10, "TOTAL")):
            ws.cell(totales, col, f"=SUBTOTAL(109,{tabla}[{letra}])")
        t = Table(
            displayName=tabla,
            name=tabla,
            ref=f"A1:J{totales}",
            totalsRowCount=1,
            autoFilter=AutoFilter(ref=f"A1:J{totales - 1}"),
            tableStyleInfo=TableStyleInfo(name="TableStyleMedium2", showRowStripes=True),
        )
        t.tableColumns = [
            TableColumn(
                id=i,
                name=nombre,
                totalsRowLabel="Total" if i == 1 else None,
                totalsRowFunction="sum"
                if nombre in ("CANTIDAD", "CONSUMO", "INGRESO", "TOTAL")
                else None,
            )
            for i, nombre in enumerate(ENCABEZADOS_INV, start=1)
        ]
        ws.add_table(t)
        ws.print_area = f"A1:J{totales}"
        for (h, celda), texto in NOTAS_INV.items():
            if h == hoja:
                ws[celda].comment = Comment(f"AUTOR:\n{texto}", "AUTOR")
    cat = wb.create_sheet("ARTICULOS_MX")
    cat.append([None, None])
    cat.append(["CODIGO AX", "PRODUCTO"])
    for codigo, descripcion in CATALOGO.items():
        cat.append([codigo, descripcion])
    cat.sheet_state = "hidden"
    wb.save(ruta)
    _agregar_calcchain(ruta, [("C2", 1), ("J2", 1)])
    return ruta


# ---------------------------------------------------------------------- vales


def generar_vales(ruta: Path) -> Path:
    wb = Workbook()
    diario = wb.active
    diario.title = "DIARIO"
    diario.append(ENCABEZADOS_DIARIO)
    for renglon in DIARIO:
        diario.append(renglon)
    for fila in range(2, len(DIARIO) + 2):
        diario.cell(fila, 1).number_format = "dd/mm/yyyy"
    diario.freeze_panes = "A2"
    diario.auto_filter.ref = f"A1:T{len(DIARIO) + 1}"

    for hoja, (d_origen, d_destino, receptor, puesto, dz) in FORMULARIOS.items():
        ws = wb.create_sheet(hoja)
        ws["I6"], ws["J6"] = "Fecha:", "=TODAY()"
        ws["J8"], ws["K8"] = "No. folio", 9
        ws["J10"], ws["J11"], ws["K11"] = "Entradas", "Salida Planta", "XXXXX"
        ws["C17"], ws["E17"], ws["H17"], ws["I17"] = (
            "Origen: ",
            "RIG 91",
            "Departamento:  ",
            d_origen,
        )
        ws["C18"], ws["E18"], ws["H18"], ws["I18"] = (
            "Destino: ",
            "RIG 91",
            "Departamento: ",
            d_destino,
        )
        for col, texto in zip(
            "CDEFIJK",
            [
                "O.C.",
                "CANTIDAD",
                "CODIGO",
                "DESCRIPCION DEL MATERIAL",
                "CLAVE ALMACEN",
                "PRESENTACION",
                "LOTE",
            ],
            strict=True,
        ):
            ws[f"{col}20"] = texto
        for fila in range(21, 42):
            ws[f"F{fila}"] = f'=IF(E{fila}="","",VLOOKUP(E{fila},$AG$6:$AH$10030,2,0))'
        ws[f"C{42 + dz}"] = "OBSERVACION"
        ws[f"C{44 + dz}"] = (
            "ESTE MATERIAL CUMPLE CON LAS ESPECIFICACIONES REQUERIDAS POR EL USUARIO"
        )
        ws[f"C{45 + dz}"] = "MATERIAL SUMINISTRADO PARA USO EN MANTENIMIENTO DEL RIG 91"
        ws[f"D{50 + dz}"], ws[f"J{50 + dz}"] = "ENTREGO/RECIBIO", "RECIBIO/ENTREGO"
        ws[f"C{52 + dz}"], ws[f"D{52 + dz}"], ws[f"I{52 + dz}"] = "Nombre:", _ALM, receptor
        ws[f"C{53 + dz}"], ws[f"D{53 + dz}"], ws[f"I{53 + dz}"] = "Puesto:", "ALMACENISTA", puesto
        if hoja == "TRANSFERENCIAS":
            ws["G56"], ws["G58"] = "AUTORIZA", "AUTORIZADOR UNO"
        ws["AG5"], ws["AH5"] = "CODIGO AX", "PRODUCTO"
        for fila, (codigo, descripcion) in enumerate(
            {**CATALOGO, **SOLO_EN_VALES}.items(), start=6
        ):
            ws.cell(fila, 33, codigo)
            ws.cell(fila, 34, descripcion)
        ws.print_area = "C5:K62"
    wb.save(ruta)
    _convertir_en_xlsm(ruta)
    return ruta


# --------------------------------------------------------- post-proceso de ZIP


def _reescribir_zip(ruta: Path, cambios: dict[str, bytes | None]) -> None:
    with zipfile.ZipFile(ruta) as origen:
        partes = [(info, origen.read(info.filename)) for info in origen.infolist()]
    nombres = {info.filename for info, _ in partes}
    with zipfile.ZipFile(ruta, "w", zipfile.ZIP_DEFLATED) as destino:
        for info, datos in partes:
            if info.filename in cambios:
                nuevo = cambios[info.filename]
                if nuevo is not None:
                    destino.writestr(info, nuevo)
            else:
                destino.writestr(info, datos)
        for nombre, datos in cambios.items():
            if nombre not in nombres and datos is not None:
                destino.writestr(nombre, datos)


def _leer(ruta: Path, parte: str) -> str:
    with zipfile.ZipFile(ruta) as z:
        return z.read(parte).decode("utf-8")


def _agregar_calcchain(ruta: Path, celdas: list[tuple[str, int]]) -> None:
    tipos = _leer(ruta, "[Content_Types].xml").replace(
        "</Types>",
        '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
    )
    rels = _leer(ruta, "xl/_rels/workbook.xml.rels").replace(
        "</Relationships>",
        '<Relationship Id="rIdCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    )
    cadena = "".join(f'<c r="{r}" i="{i}"/>' for r, i in celdas)
    calc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{cadena}</calcChain>'
    _reescribir_zip(
        ruta,
        {
            "[Content_Types].xml": tipos.encode(),
            "xl/_rels/workbook.xml.rels": rels.encode(),
            "xl/calcChain.xml": calc.encode(),
        },
    )


def _convertir_en_xlsm(ruta: Path) -> None:
    """Agrega macros, un botón con macro, una imagen y customXml (como el archivo real)."""
    tipos = _leer(ruta, "[Content_Types].xml")
    tipos = tipos.replace(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    ).replace(
        "</Types>",
        '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>'
        "</Types>",
    )
    rels = _leer(ruta, "xl/_rels/workbook.xml.rels").replace(
        "</Relationships>",
        '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>'
        '<Relationship Id="rIdCx1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>'
        "</Relationships>",
    )
    hoja2 = _leer(ruta, "xl/worksheets/sheet2.xml")
    hoja2 = re.sub(r"(<pageMargins[^>]*/>)", r'\1<drawing r:id="rIdDib1"/>', hoja2, count=1)
    if 'xmlns:r="' not in hoja2:
        hoja2 = hoja2.replace(
            "<worksheet ",
            '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
            1,
        )
    try:
        rels_hoja2 = _leer(ruta, "xl/worksheets/_rels/sheet2.xml.rels")
    except KeyError:
        rels_hoja2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    rels_hoja2 = rels_hoja2.replace(
        "</Relationships>",
        '<Relationship Id="rIdDib1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    )
    dibujo = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<xdr:twoCellAnchor><xdr:from><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>9</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>"
        "<xdr:to><xdr:col>13</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>11</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>"
        '<xdr:sp macro="[0]!PasarDatos" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Boton GRABAR"/><xdr:cNvSpPr/></xdr:nvSpPr>'
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
        "<xdr:txBody><a:bodyPr/><a:p><a:r><a:t>GRABAR </a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>"
        "<xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>"
        '<xdr:ext cx="952500" cy="317500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>'
        '<xdr:blipFill><a:blip r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>'
        "</xdr:wsDr>"
    )
    rels_dibujo = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>'
        "</Relationships>"
    )
    custom = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"/>'
    props = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        '<ds:datastoreItem ds:itemID="{00000000-0000-0000-0000-000000000001}" '
        'xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>'
    )
    rels_custom = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/>'
        "</Relationships>"
    )
    _reescribir_zip(
        ruta,
        {
            "[Content_Types].xml": tipos.encode(),
            "xl/_rels/workbook.xml.rels": rels.encode(),
            "xl/worksheets/sheet2.xml": hoja2.encode(),
            "xl/worksheets/_rels/sheet2.xml.rels": rels_hoja2.encode(),
            "xl/drawings/drawing1.xml": dibujo.encode(),
            "xl/drawings/_rels/drawing1.xml.rels": rels_dibujo.encode(),
            "xl/media/image1.png": PNG_1PX,
            "xl/vbaProject.bin": b"VBA-FICTICIO-SOLO-PARA-PRUEBAS" * 64,
            "customXml/item1.xml": custom.encode(),
            "customXml/itemProps1.xml": props.encode(),
            "customXml/_rels/item1.xml.rels": rels_custom.encode(),
        },
    )
    _agregar_calcchain(ruta, [("F21", 2)])


def generar_todo(carpeta: Path) -> dict[str, Path]:
    carpeta.mkdir(parents=True, exist_ok=True)
    return {
        "inventario": generar_inventario(carpeta / "INVENTARIO SINTETICO.xlsx"),
        "vales": generar_vales(carpeta / "VALES SINTETICO.xlsm"),
    }


if __name__ == "__main__":
    import sys

    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    for nombre, ruta in generar_todo(destino).items():
        print(nombre, ruta)
