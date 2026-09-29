"""Entorno de Alembic. Se invoca desde control_almacen.db.sesion.migrar()."""

from alembic import context

from control_almacen.db.modelos import Base

config = context.config
metadatos = Base.metadata


def ejecutar_con_conexion(conexion) -> None:
    context.configure(connection=conexion, target_metadata=metadatos, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


conexion = config.attributes.get("connection")
if conexion is None:
    raise RuntimeError(
        "Alembic se ejecuta solo con config.attributes['connection'] (ver db/sesion.py)."
    )
ejecutar_con_conexion(conexion)
