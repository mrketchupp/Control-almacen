"""Primera carga: convierte los Excel actuales en la base de datos de la herramienta.

La herramienta se instala vacía ("cascarón"); los datos reales solo entran por aquí,
desde los archivos del usuario, en su propio equipo. Ver docs/07-migracion.md.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import shutil
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from control_almacen.config import ALMACEN_AX_DEFECTO
from control_almacen.db import modelos as m
from control_almacen.db.sesion import BaseDatos
from control_almacen.dominio.catalogo import (
    claves_de_busqueda,
    obtener_o_crear_articulo,
    obtener_o_crear_variante,
)
from control_almacen.dominio.existencias import calcular_saldos
from control_almacen.importadores.inventario_fisico import LibroInventario, leer_inventario
from control_almacen.importadores.vales import LibroVales, leer_vales
from control_almacen.servicios.limpieza import RespuestasRevision, limpiar_diario

MINIMO_ENTREGAS_ALMACENISTA = 20


class BaseNoVacia(RuntimeError):
    """La primera carga solo se hace sobre una base de datos vacía."""


@dataclass
class OpcionesPrimeraCarga:
    ruta_inventario: Path
    ruta_vales: Path
    folio_corte: int  # último folio de salida ya reflejado en el conteo físico
    fecha_conteo: dt.date
    usuario: str | None = None
    respuestas: RespuestasRevision | None = None
    carpeta_plantillas: Path | None = None  # dónde copiar los archivos como plantillas


@dataclass
class DiferenciaRenglon:
    hoja: str
    fila: int
    codigo: int
    dimension: str | None
    archivo_consumo: Decimal
    calculado_consumo: Decimal
    archivo_ingreso: Decimal
    calculado_ingreso: Decimal


@dataclass
class ResumenHoja:
    hoja: str
    renglones: int
    cantidad_archivo: Decimal
    total_archivo: Decimal
    total_calculado: Decimal
    filas_vacias_omitidas: list[int]


@dataclass
class LineaPorUbicar:
    folio: int
    renglon: int
    codigo: int | None
    descripcion: str | None
    clave: str | None
    cantidad: Decimal | None
    candidatos: int


@dataclass
class ReporteCarga:
    articulos: int = 0
    articulos_por_confirmar: list[tuple[int, str]] = field(default_factory=list)
    variantes: int = 0
    existencias: int = 0
    hojas: list[ResumenHoja] = field(default_factory=list)
    diferencias: list[DiferenciaRenglon] = field(default_factory=list)
    vales: int = 0
    renglones_diario: int = 0
    lineas_migradas: int = 0
    omitidos: list[tuple[int, str]] = field(default_factory=list)
    correcciones: list[tuple[int, str, object, object]] = field(default_factory=list)
    folios_faltantes: list[int] = field(default_factory=list)
    por_ubicar: list[LineaPorUbicar] = field(default_factory=list)
    lineas_ubicadas: int = 0
    personas: int = 0
    plantillas_area: int = 0
    advertencias: list[str] = field(default_factory=list)

    @property
    def cuadra(self) -> bool:
        """El inventario calculado coincide con el archivo, renglón por renglón."""
        return not self.diferencias and all(
            h.total_archivo == h.total_calculado for h in self.hojas
        )


def base_vacia(sesion: Session) -> bool:
    return not (
        sesion.scalar(select(func.count(m.Existencia.id)))
        or sesion.scalar(select(func.count(m.Vale.id)))
    )


def ejecutar_primera_carga(bd: BaseDatos, opciones: OpcionesPrimeraCarga) -> ReporteCarga:
    """Carga todo en una sola transacción: si algo falla, la base queda vacía."""
    inventario = leer_inventario(opciones.ruta_inventario)
    vales = leer_vales(opciones.ruta_vales)
    reporte = ReporteCarga()
    with bd.sesion() as sesion:
        if not base_vacia(sesion):
            raise BaseNoVacia(
                "La base ya tiene datos. La primera carga solo se hace sobre una base vacía."
            )
        _cargar_catalogo(sesion, inventario, vales, reporte)
        conteo = m.Conteo(
            fecha=opciones.fecha_conteo,
            descripcion=f"Conteo inicial (importado de {opciones.ruta_inventario.name})",
            usuario=opciones.usuario,
            ultimo_folio_salida=opciones.folio_corte,
            ultimo_folio_entrada=0,
        )
        sesion.add(conteo)
        sesion.flush()
        _cargar_inventario(sesion, inventario, conteo, reporte)
        respuestas = opciones.respuestas or RespuestasRevision()
        reporte.advertencias.extend(respuestas.advertencias)
        _cargar_plantillas(sesion, vales, respuestas, reporte)
        _cargar_diario(sesion, vales, respuestas, opciones, reporte)
        _verificar(sesion, inventario, reporte)
        if opciones.carpeta_plantillas:
            _registrar_plantilla(
                sesion, "INVENTARIO", opciones.ruta_inventario, opciones.carpeta_plantillas
            )
            _registrar_plantilla(sesion, "VALES", opciones.ruta_vales, opciones.carpeta_plantillas)
        sesion.merge(m.Config(clave="almacen_ax", valor=ALMACEN_AX_DEFECTO))
        sesion.add(
            m.Auditoria(
                usuario=opciones.usuario,
                entidad="sistema",
                accion="PRIMERA_CARGA",
                despues=json.dumps(
                    {
                        "inventario": opciones.ruta_inventario.name,
                        "vales": opciones.ruta_vales.name,
                        "folio_corte": opciones.folio_corte,
                        "fecha_conteo": opciones.fecha_conteo.isoformat(),
                        "existencias": reporte.existencias,
                        "vales_migrados": reporte.vales,
                    },
                    ensure_ascii=False,
                ),
            )
        )
    return reporte


# ------------------------------------------------------------------ catálogo


def _cargar_catalogo(
    sesion: Session, inventario: LibroInventario, vales: LibroVales, reporte: ReporteCarga
) -> None:
    """ARTICULOS_MX manda (alimenta el BUSCARV del inventario); el catálogo de vales completa."""
    for origen, catalogo in (
        ("ARTICULOS_MX", inventario.catalogo),
        ("CATALOGO_VALES", vales.catalogo),
    ):
        for codigo, descripcion in catalogo.items():
            if sesion.get(m.Articulo, codigo) is None:
                sesion.add(m.Articulo(codigo=codigo, descripcion=descripcion, origen=origen))
        sesion.flush()


# ---------------------------------------------------------------- inventario


def _cargar_inventario(
    sesion: Session, inventario: LibroInventario, conteo: m.Conteo, reporte: ReporteCarga
) -> None:
    for hoja in inventario.hojas:
        ubicacion = m.Ubicacion(
            contenedor=hoja.contenedor,
            clase=hoja.clase,
            hoja_excel=hoja.nombre,
            tabla_excel=hoja.tabla,
            orden=hoja.orden,
        )
        sesion.add(ubicacion)
        sesion.flush()
        for orden, renglon in enumerate(hoja.renglones, start=1):
            articulo = obtener_o_crear_articulo(
                sesion, renglon.codigo, renglon.descripcion, "INVENTARIO"
            )
            variante = obtener_o_crear_variante(
                sesion, articulo.codigo, renglon.dimension, renglon.np, renglon.um
            )
            sesion.add(
                m.Existencia(
                    variante_id=variante.id,
                    ubicacion_id=ubicacion.id,
                    orden=orden,
                    item=renglon.item,
                    cantidad_conteo=renglon.cantidad,
                    conteo_id=conteo.id,
                    nota=renglon.nota,
                    fila_origen=renglon.fila,
                )
            )
        sesion.flush()
        reporte.existencias += len(hoja.renglones)


# --------------------------------------------------------- personas y áreas


def _persona(
    sesion: Session, nombre: str | None, cache: dict[str, m.Persona], **datos
) -> m.Persona | None:
    if not nombre:
        return None
    persona = cache.get(nombre)
    if persona is None:
        persona = m.Persona(nombre=nombre, **datos)
        sesion.add(persona)
        sesion.flush()
        cache[nombre] = persona
    else:
        for clave, valor in datos.items():
            if valor and not getattr(persona, clave):
                setattr(persona, clave, valor)
    return persona


def _cargar_plantillas(
    sesion: Session, vales: LibroVales, respuestas: RespuestasRevision, reporte: ReporteCarga
) -> None:
    cache: dict[str, m.Persona] = {}
    alias = respuestas.alias
    for orden, p in enumerate(vales.plantillas, start=1):
        entrega = alias.get(p.entrega_nombre, p.entrega_nombre) if p.entrega_nombre else None
        recibe = alias.get(p.recibe_nombre, p.recibe_nombre) if p.recibe_nombre else None
        autoriza = alias.get(p.autoriza_nombre, p.autoriza_nombre) if p.autoriza_nombre else None
        _persona(sesion, entrega, cache, puesto=p.entrega_puesto)
        _persona(sesion, recibe, cache, puesto=p.recibe_puesto)
        _persona(sesion, autoriza, cache)
        es_transferencia = "TRANSFER" in (p.hoja + (p.depto_destino or "")).upper()
        sesion.add(
            m.PlantillaArea(
                nombre=p.hoja.strip(),
                hoja_excel=p.hoja,
                origen=p.origen,
                depto_origen=p.depto_origen,
                destino=p.destino,
                depto_destino=p.depto_destino,
                entrega_nombre=entrega,
                entrega_puesto=p.entrega_puesto,
                recibe_nombre=recibe,
                recibe_puesto=p.recibe_puesto,
                autoriza_nombre=autoriza,
                requiere_autoriza=bool(autoriza) or es_transferencia,
                naturaleza="TRANSFERENCIA" if es_transferencia else "CONSUMO",
                observaciones=p.observaciones,
                orden=orden,
            )
        )
    reporte.plantillas_area = len(vales.plantillas)
    sesion.flush()
    sesion.info["cache_personas"] = cache


# ------------------------------------------------------------------- DIARIO


def _cargar_diario(
    sesion: Session,
    vales: LibroVales,
    respuestas: RespuestasRevision,
    opciones: OpcionesPrimeraCarga,
    reporte: ReporteCarga,
) -> None:
    catalogo = {a.codigo: a.descripcion for a in sesion.scalars(select(m.Articulo))}
    resultado = limpiar_diario(vales.renglones, catalogo, respuestas)
    reporte.renglones_diario = len(vales.renglones)
    reporte.omitidos = resultado.omitidos
    reporte.correcciones = resultado.correcciones
    reporte.folios_faltantes = resultado.folios_faltantes

    for codigo, descripcion in resultado.codigos_nuevos.items():
        obtener_o_crear_articulo(sesion, codigo, descripcion, "DIARIO")
    for codigo, (_, descripcion) in respuestas.codigos.items():
        articulo = sesion.get(m.Articulo, codigo)
        if articulo is not None and descripcion:
            articulo.descripcion = descripcion
            articulo.por_confirmar = False

    cache: dict[str, m.Persona] = sesion.info.get("cache_personas", {})
    entregas = Counter(v.entrego for v in resultado.vales if v.entrego)
    indice = _indice_existencias(sesion)
    for vale_migrado in resultado.vales:
        for nombre in (vale_migrado.entrego, vale_migrado.recibio, vale_migrado.autorizo):
            _persona(sesion, nombre, cache)
        vale = m.Vale(
            tipo="SALIDA",
            folio=vale_migrado.folio,
            estado="EMITIDO",
            fecha=vale_migrado.fecha,
            origen=vale_migrado.origen,
            depto_origen=vale_migrado.depto_origen,
            destino=vale_migrado.destino,
            depto_destino=vale_migrado.depto_destino,
            entrego_nombre=vale_migrado.entrego,
            recibio_nombre=vale_migrado.recibio,
            autorizo_nombre=vale_migrado.autorizo,
            naturaleza="TRANSFERENCIA"
            if "TRANSFER" in (vale_migrado.depto_destino or "").upper()
            else "CONSUMO",
            creado_por=opciones.usuario,
            migrado=True,
        )
        afecta_existencias = vale_migrado.folio > opciones.folio_corte
        for renglon, linea in enumerate(vale_migrado.lineas, start=1):
            vale_linea = m.ValeLinea(
                renglon=renglon,
                oc=linea.oc,
                cantidad=linea.cantidad,
                codigo=linea.codigo,
                descripcion=linea.descripcion,
                clave=linea.clave,
                um=linea.um,
                lote=linea.lote,
                familia=linea.familia,
                transferencia_consumo=linea.transferencia_consumo,
                encabezado_original=json.dumps(linea.encabezado_original, ensure_ascii=False)
                if linea.encabezado_original
                else None,
                fila_diario_origen=linea.fila,
                notas="\n".join(linea.notas) or None,
            )
            if afecta_existencias:
                candidatos = _candidatos(indice, linea.codigo, linea.clave)
                if len(candidatos) == 1:
                    existencia = candidatos[0]
                    vale_linea.existencia_id = existencia.id
                    vale_linea.variante_id = existencia.variante_id
                    reporte.lineas_ubicadas += 1
                elif linea.codigo is not None and not indice.get(linea.codigo):
                    vale_linea.no_inventariado = True
                else:
                    reporte.por_ubicar.append(
                        LineaPorUbicar(
                            folio=vale_migrado.folio,
                            renglon=renglon,
                            codigo=linea.codigo,
                            descripcion=linea.descripcion,
                            clave=linea.clave,
                            cantidad=linea.cantidad,
                            candidatos=len(candidatos),
                        )
                    )
            vale.lineas.append(vale_linea)
            reporte.lineas_migradas += 1
        sesion.add(vale)
    for nombre, veces in entregas.items():
        if veces >= MINIMO_ENTREGAS_ALMACENISTA and nombre in cache:
            cache[nombre].es_almacenista = True
    for variante, correcto in respuestas.alias.items():
        if (
            variante != correcto
            and correcto in cache
            and sesion.get(m.PersonaAlias, variante) is None
        ):
            sesion.add(m.PersonaAlias(alias=variante, persona_id=cache[correcto].id))
    reporte.vales = len(resultado.vales)
    sesion.flush()
    reporte.personas = sesion.scalar(select(func.count(m.Persona.id))) or 0


def _indice_existencias(sesion: Session) -> dict[int, list[m.Existencia]]:
    indice: dict[int, list[m.Existencia]] = {}
    for existencia in sesion.scalars(select(m.Existencia).join(m.Variante)):
        indice.setdefault(existencia.variante.codigo, []).append(existencia)
    return indice


def _candidatos(
    indice: dict[int, list[m.Existencia]], codigo: int | None, clave: str | None
) -> list[m.Existencia]:
    """Renglones de inventario a los que puede corresponder una línea de vale."""
    if codigo is None:
        return []
    existencias = indice.get(codigo, [])
    claves = claves_de_busqueda(clave)
    if not claves:
        return existencias if len(existencias) == 1 else []
    exactos = []
    for e in existencias:
        propias = {e.variante.dimension_clave, e.variante.np_clave}
        propias |= claves_de_busqueda(" ".join(filter(None, [e.variante.dimension, e.variante.np])))
        if claves & (propias - {""}):
            exactos.append(e)
    return exactos


# ---------------------------------------------------------------- verificación


def _verificar(sesion: Session, inventario: LibroInventario, reporte: ReporteCarga) -> None:
    saldos = calcular_saldos(sesion)
    existencias = {
        (e.ubicacion.hoja_excel, e.fila_origen): e
        for e in sesion.scalars(select(m.Existencia).join(m.Ubicacion))
    }
    cero = Decimal(0)
    for hoja in inventario.hojas:
        total_calculado = cero
        for renglon in hoja.renglones:
            existencia = existencias[(hoja.nombre, renglon.fila)]
            saldo = saldos[existencia.id]
            total_calculado += saldo.total
            archivo_consumo, archivo_ingreso = renglon.consumo or cero, renglon.ingreso or cero
            if (archivo_consumo, archivo_ingreso) != (saldo.consumo, saldo.ingreso):
                reporte.diferencias.append(
                    DiferenciaRenglon(
                        hoja=hoja.nombre,
                        fila=renglon.fila,
                        codigo=renglon.codigo,
                        dimension=renglon.dimension,
                        archivo_consumo=archivo_consumo,
                        calculado_consumo=saldo.consumo,
                        archivo_ingreso=archivo_ingreso,
                        calculado_ingreso=saldo.ingreso,
                    )
                )
        reporte.hojas.append(
            ResumenHoja(
                hoja=hoja.nombre,
                renglones=len(hoja.renglones),
                cantidad_archivo=hoja.suma_cantidad,
                total_archivo=hoja.suma_total,
                total_calculado=total_calculado,
                filas_vacias_omitidas=hoja.filas_vacias,
            )
        )
    reporte.articulos = sesion.scalar(select(func.count(m.Articulo.codigo))) or 0
    reporte.variantes = sesion.scalar(select(func.count(m.Variante.id))) or 0
    reporte.articulos_por_confirmar = [
        (a.codigo, a.descripcion)
        for a in sesion.scalars(select(m.Articulo).where(m.Articulo.por_confirmar))
    ]


# ------------------------------------------------------------------ plantillas


def sha256(ruta: Path) -> str:
    return hashlib.sha256(Path(ruta).read_bytes()).hexdigest()


def _registrar_plantilla(sesion: Session, tipo: str, ruta: Path, carpeta: Path) -> m.PlantillaExcel:
    carpeta.mkdir(parents=True, exist_ok=True)
    huella = sha256(ruta)
    destino = carpeta / f"{tipo.lower()}_{huella[:12]}{ruta.suffix.lower()}"
    shutil.copy2(ruta, destino)
    for anterior in sesion.scalars(select(m.PlantillaExcel).where(m.PlantillaExcel.tipo == tipo)):
        anterior.activa = False
    plantilla = m.PlantillaExcel(
        tipo=tipo, nombre_original=ruta.name, archivo=destino.name, sha256=huella, activa=True
    )
    sesion.add(plantilla)
    return plantilla


def fecha_desde_nombre(nombre: str) -> dt.date | None:
    """'…ALMACEN_280926.xlsx' → 2026-09-28; 'DELTA RIG 91 27-09-26' → 2026-09-27.

    Si hay varias coincidencias se toma la última fecha válida.
    """
    patron = re.compile(r"(?<!\d)(?=(\d{2})[-_ ]?(\d{2})[-_ ]?(\d{2})(?!\d))")
    encontrada = None
    for coincidencia in patron.finditer(nombre):
        dia, mes, anio = (int(x) for x in coincidencia.groups())
        try:
            encontrada = dt.date(2000 + anio, mes, dia)
        except ValueError:
            continue
    return encontrada
