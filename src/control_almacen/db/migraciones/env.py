"""Entorno de Alembic. Se invoca desde control_almacen.db.sesion.migrar()."""

from alembic import context
from sqlalchemy import create_engine

from control_almacen.db.modelos import Base

config = context.config
metadatos = Base.metadata


def ejecutar_con_conexion(conexion) -> None:
    context.configure(connection=conexion, target_metadata=metadatos, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


conexion = config.attributes.get("connection")
if conexion is not None:
    ejecutar_con_conexion(conexion)
else:
    motor = create_engine(config.get_main_option("sqlalchemy.url"))
    with motor.begin() as nueva_conexion:
        ejecutar_con_conexion(nueva_conexion)
