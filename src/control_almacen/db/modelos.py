"""Tablas de la base de datos. Ver docs/04-modelo-de-datos.md."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class DecimalTexto(TypeDecorator):
    """Decimal exacto guardado como texto (SQLite no tiene tipo decimal)."""

    impl = String(40)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return format(Decimal(value).normalize(), "f")

    def process_result_value(self, value, dialect):
        return None if value is None else Decimal(value)


def ahora() -> dt.datetime:
    return dt.datetime.now().replace(microsecond=0)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------- catálogos


class Articulo(Base):
    __tablename__ = "articulo"

    codigo: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    descripcion: Mapped[str] = mapped_column(String(200))
    clase: Mapped[str | None] = mapped_column(String(4))  # INV / CONS
    modelo_ax: Mapped[str | None] = mapped_column(String(20))
    origen: Mapped[str | None] = mapped_column(String(30))
    por_confirmar: Mapped[bool] = mapped_column(Boolean, default=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    variantes: Mapped[list[Variante]] = relationship(back_populates="articulo")

    __table_args__ = (CheckConstraint("clase IN ('INV', 'CONS') OR clase IS NULL"),)


class Variante(Base):
    __tablename__ = "variante"

    id: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[int] = mapped_column(ForeignKey("articulo.codigo"))
    dimension: Mapped[str | None] = mapped_column(String(200))
    np: Mapped[str | None] = mapped_column(String(200))
    um: Mapped[str] = mapped_column(String(20), default="")
    dimension_clave: Mapped[str] = mapped_column(String(200), default="")
    np_clave: Mapped[str] = mapped_column(String(200), default="")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    articulo: Mapped[Articulo] = relationship(back_populates="variantes")

    __table_args__ = (UniqueConstraint("codigo", "dimension_clave", "np_clave", "um"),)


class Ubicacion(Base):
    __tablename__ = "ubicacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    contenedor: Mapped[int] = mapped_column(Integer)
    clase: Mapped[str] = mapped_column(String(4))
    hoja_excel: Mapped[str] = mapped_column(String(31), unique=True)  # nombre EXACTO
    tabla_excel: Mapped[str | None] = mapped_column(String(100))
    orden: Mapped[int] = mapped_column(Integer)

    @property
    def nombre(self) -> str:
        return self.hoja_excel.strip()


class Conteo(Base):
    """Conteo físico: fija CANTIDAD y el folio desde el que se descuenta."""

    __tablename__ = "conteo"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[dt.date] = mapped_column(Date)
    descripcion: Mapped[str | None] = mapped_column(String(200))
    usuario: Mapped[str | None] = mapped_column(String(100))
    ultimo_folio_salida: Mapped[int] = mapped_column(Integer, default=0)
    ultimo_folio_entrada: Mapped[int] = mapped_column(Integer, default=0)
    creado_en: Mapped[dt.datetime] = mapped_column(DateTime, default=ahora)


class Existencia(Base):
    """Un renglón del Excel de inventario: una variante en una ubicación."""

    __tablename__ = "existencia"

    id: Mapped[int] = mapped_column(primary_key=True)
    variante_id: Mapped[int] = mapped_column(ForeignKey("variante.id"))
    ubicacion_id: Mapped[int] = mapped_column(ForeignKey("ubicacion.id"))
    orden: Mapped[int] = mapped_column(Integer)
    item: Mapped[str | None] = mapped_column(String(20))
    cantidad_conteo: Mapped[Decimal] = mapped_column(DecimalTexto, default=Decimal(0))
    conteo_id: Mapped[int | None] = mapped_column(ForeignKey("conteo.id"))
    nota: Mapped[str | None] = mapped_column(Text)
    fila_origen: Mapped[int | None] = mapped_column(Integer)
    # Escritura exacta en la hoja (puede diferir de la variante: "0-5,000PSI" vs "0-5000PSI").
    dimension_hoja: Mapped[str | None] = mapped_column(String(200))
    np_hoja: Mapped[str | None] = mapped_column(String(200))
    um_hoja: Mapped[str | None] = mapped_column(String(20))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)

    variante: Mapped[Variante] = relationship()

    @property
    def dimension_mostrada(self) -> str | None:
        return self.dimension_hoja if self.dimension_hoja is not None else self.variante.dimension

    @property
    def np_mostrado(self) -> str | None:
        return self.np_hoja if self.np_hoja is not None else self.variante.np

    @property
    def um_mostrada(self) -> str | None:
        return self.um_hoja if self.um_hoja is not None else self.variante.um

    ubicacion: Mapped[Ubicacion] = relationship()
    conteo: Mapped[Conteo | None] = relationship()

    __table_args__ = (Index("ix_existencia_ubicacion_orden", "ubicacion_id", "orden"),)


class ConteoLinea(Base):
    __tablename__ = "conteo_linea"

    id: Mapped[int] = mapped_column(primary_key=True)
    conteo_id: Mapped[int] = mapped_column(ForeignKey("conteo.id"))
    existencia_id: Mapped[int] = mapped_column(ForeignKey("existencia.id"))
    cantidad_contada: Mapped[Decimal] = mapped_column(DecimalTexto)
    cantidad_teorica_previa: Mapped[Decimal | None] = mapped_column(DecimalTexto)


class Persona(Base):
    __tablename__ = "persona"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True)
    puesto: Mapped[str | None] = mapped_column(String(120))
    area: Mapped[str | None] = mapped_column(String(120))
    es_almacenista: Mapped[bool] = mapped_column(Boolean, default=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class PersonaAlias(Base):
    """Forma alternativa de escribir un nombre → persona canónica."""

    __tablename__ = "persona_alias"

    alias: Mapped[str] = mapped_column(String(120), primary_key=True)
    persona_id: Mapped[int] = mapped_column(ForeignKey("persona.id"))

    persona: Mapped[Persona] = relationship()


class PlantillaArea(Base):
    """Sustituye a las 11 hojas-formulario del archivo de vales."""

    __tablename__ = "plantilla_area"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(60), unique=True)
    hoja_excel: Mapped[str | None] = mapped_column(String(31))
    origen: Mapped[str | None] = mapped_column(String(120))
    depto_origen: Mapped[str | None] = mapped_column(String(120))
    destino: Mapped[str | None] = mapped_column(String(120))
    depto_destino: Mapped[str | None] = mapped_column(String(120))
    entrega_nombre: Mapped[str | None] = mapped_column(String(120))
    entrega_puesto: Mapped[str | None] = mapped_column(String(120))
    recibe_nombre: Mapped[str | None] = mapped_column(String(120))
    recibe_puesto: Mapped[str | None] = mapped_column(String(120))
    autoriza_nombre: Mapped[str | None] = mapped_column(String(120))
    requiere_autoriza: Mapped[bool] = mapped_column(Boolean, default=False)
    naturaleza: Mapped[str] = mapped_column(String(20), default="CONSUMO")
    observaciones: Mapped[str | None] = mapped_column(Text)
    lote_defecto: Mapped[str | None] = mapped_column(String(60))
    orden: Mapped[int] = mapped_column(Integer, default=0)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


# -------------------------------------------------------------- movimientos


class Vale(Base):
    __tablename__ = "vale"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(10))  # SALIDA / ENTRADA
    folio: Mapped[int | None] = mapped_column(Integer)
    folio_externo: Mapped[str | None] = mapped_column(String(40))
    estado: Mapped[str] = mapped_column(String(12), default="BORRADOR")
    fecha: Mapped[dt.date | None] = mapped_column(Date)
    origen: Mapped[str | None] = mapped_column(String(120))
    depto_origen: Mapped[str | None] = mapped_column(String(120))
    destino: Mapped[str | None] = mapped_column(String(120))
    depto_destino: Mapped[str | None] = mapped_column(String(120))
    entrego_nombre: Mapped[str | None] = mapped_column(String(120))
    entrego_puesto: Mapped[str | None] = mapped_column(String(120))
    recibio_nombre: Mapped[str | None] = mapped_column(String(120))
    recibio_puesto: Mapped[str | None] = mapped_column(String(120))
    autorizo_nombre: Mapped[str | None] = mapped_column(String(120))
    observaciones: Mapped[str | None] = mapped_column(Text)
    plantilla_area_id: Mapped[int | None] = mapped_column(ForeignKey("plantilla_area.id"))
    naturaleza: Mapped[str | None] = mapped_column(String(20))
    creado_por: Mapped[str | None] = mapped_column(String(120))
    creado_en: Mapped[dt.datetime] = mapped_column(DateTime, default=ahora)
    emitido_en: Mapped[dt.datetime | None] = mapped_column(DateTime)
    cancelado_en: Mapped[dt.datetime | None] = mapped_column(DateTime)
    motivo_cancelacion: Mapped[str | None] = mapped_column(Text)
    ruta_escaneo: Mapped[str | None] = mapped_column(Text)
    migrado: Mapped[bool] = mapped_column(Boolean, default=False)
    notas: Mapped[str | None] = mapped_column(Text)

    lineas: Mapped[list[ValeLinea]] = relationship(
        back_populates="vale", order_by="ValeLinea.renglon", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("tipo", "folio"),
        CheckConstraint("tipo IN ('SALIDA', 'ENTRADA')"),
        CheckConstraint("estado IN ('BORRADOR', 'EMITIDO', 'CANCELADO')"),
    )


class ValeLinea(Base):
    __tablename__ = "vale_linea"

    id: Mapped[int] = mapped_column(primary_key=True)
    vale_id: Mapped[int] = mapped_column(ForeignKey("vale.id"))
    renglon: Mapped[int] = mapped_column(Integer)
    oc: Mapped[str | None] = mapped_column(String(40))
    cantidad: Mapped[Decimal | None] = mapped_column(DecimalTexto)
    codigo: Mapped[int | None] = mapped_column(Integer)
    descripcion: Mapped[str | None] = mapped_column(String(200))
    clave: Mapped[str | None] = mapped_column(String(200))
    um: Mapped[str | None] = mapped_column(String(20))
    lote: Mapped[str | None] = mapped_column(String(120))
    variante_id: Mapped[int | None] = mapped_column(ForeignKey("variante.id"))
    existencia_id: Mapped[int | None] = mapped_column(ForeignKey("existencia.id"))
    no_inventariado: Mapped[bool] = mapped_column(Boolean, default=False)
    familia: Mapped[str | None] = mapped_column(String(20))
    transferencia_consumo: Mapped[str | None] = mapped_column(String(20))
    # Migración: encabezado del DIARIO cuando difiere del encabezado del vale (JSON).
    encabezado_original: Mapped[str | None] = mapped_column(Text)
    fila_diario_origen: Mapped[int | None] = mapped_column(Integer)
    notas: Mapped[str | None] = mapped_column(Text)

    vale: Mapped[Vale] = relationship(back_populates="lineas")
    existencia: Mapped[Existencia | None] = relationship()

    __table_args__ = (Index("ix_vale_linea_existencia", "existencia_id"),)


# ---------------------------------------------------------------- operación


class Auditoria(Base):
    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    fecha_hora: Mapped[dt.datetime] = mapped_column(DateTime, default=ahora)
    usuario: Mapped[str | None] = mapped_column(String(120))
    entidad: Mapped[str] = mapped_column(String(40))
    entidad_id: Mapped[str | None] = mapped_column(String(40))
    accion: Mapped[str] = mapped_column(String(40))
    antes: Mapped[str | None] = mapped_column(Text)
    despues: Mapped[str | None] = mapped_column(Text)
    motivo: Mapped[str | None] = mapped_column(Text)


class PlantillaExcel(Base):
    """Último archivo real del usuario, usado como molde para exportar."""

    __tablename__ = "plantilla_excel"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(20))  # INVENTARIO / VALES
    nombre_original: Mapped[str] = mapped_column(String(255))
    archivo: Mapped[str] = mapped_column(String(255))  # dentro de la carpeta de plantillas
    sha256: Mapped[str] = mapped_column(String(64))
    registrado_en: Mapped[dt.datetime] = mapped_column(DateTime, default=ahora)
    activa: Mapped[bool] = mapped_column(Boolean, default=True)


class Exportacion(Base):
    __tablename__ = "exportacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(20))
    archivo: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    fecha_hora: Mapped[dt.datetime] = mapped_column(DateTime, default=ahora)
    usuario: Mapped[str | None] = mapped_column(String(120))
    ultimo_folio: Mapped[int | None] = mapped_column(Integer)
    enviado: Mapped[bool] = mapped_column(Boolean, default=False)


class Config(Base):
    __tablename__ = "config"

    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[str | None] = mapped_column(Text)
