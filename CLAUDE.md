# CLAUDE.md — Guía para sesiones de desarrollo

## Qué es este proyecto
Herramienta de escritorio (Windows) para el almacén del RIG 91: inventario por contenedor, vales de salida y entrada con folio controlado, conciliación contra AX y exportación **idéntica** a los Excel actuales. Toda la planeación está en `docs/`. Léela antes de proponer cambios de diseño.

## Estado
- Fase 0 (planeación) y Fase 1 (núcleo, primera carga, exportación idéntica, interfaz, empaquetado) entregadas.
- Antes de empezar cada fase nueva, confirma que el usuario dio luz verde. Siguiente: F2 (ver `docs/08-plan.md`).
- Comandos: `pytest` · `ruff check . && ruff format --check .` · `python -m control_almacen --navegador`
  · empaquetado: `pyinstaller packaging/control_almacen.spec --noconfirm` (el instalador lo arma GitHub Actions).

## Reglas no negociables
1. **Nunca subir datos reales** (Excel, PDF, `.db`, respaldos). Solo fixtures anonimizadas en `tests/fixtures/`. Revisa `.gitignore` antes de cada commit.
2. **Exportación sobre plantilla con edición XML mínima** (`docs/03`, `docs/06`). Está prohibido guardar los libros del usuario con `openpyxl.save()`: borra logos, botones con macro, `customXml` y configuración de impresora. openpyxl solo se usa para **leer** y para generar archivos **nuevos** (entradas, solicitud de ajuste).
3. **Nombres de hoja exactos**, con espacios finales incluidos: `CONTENEDOR #1 CONSUMIBLE `, `CONTENEDOR #5 CONSUMIBLE `, `MECANICO `, `OPERACION DIA `; encabezado `DESCRIPCIÓN `.
4. **Folios:** únicos, consecutivos y asignados en transacción (`BEGIN IMMEDIATE` + `UNIQUE`). Nunca se reutilizan ni se borran; solo se cancelan o se corrigen con motivo y bitácora.
5. **Existencias derivadas de movimientos:** CONSUMO e INGRESO se calculan con los vales posteriores al último conteo (corte por **folio**), no se guardan sueltos.
6. **La base de datos viva no va en OneDrive.** Va en `%LOCALAPPDATA%\ControlAlmacen\` (ambos almacenistas usan la misma cuenta de Windows); a OneDrive solo van respaldos consistentes (API de backup de SQLite).
7. **Pruebas con Excel sintéticos** generados por `tests/fixtures/generar.py`; si un caso real revela un problema, reprodúcelo ahí con datos inventados.

## Convenciones
- **Idioma:** interfaz, documentación, mensajes de commit y comentarios en español. Nombres del dominio en español (`Vale`, `Existencia`, `Folio`); términos técnicos genéricos pueden ir en inglés.
- Python 3.12, con tipado en funciones públicas. Formato y lint con `ruff`. Pruebas con `pytest`.
- Capas: `dominio/` no importa nada de `ui/`, `importadores/` ni `exportadores/`.
- Fechas en ISO dentro de la base; hacia Excel, número de serie con el estilo de la plantilla.
- Cantidades como `Decimal`, nunca `float`.

## Verificación antes de cada commit
- `ruff check . && ruff format --check . && pytest`
- En cambios a exportadores: prueba de "partes intactas". Todas las partes del ZIP que no se debían tocar deben ser idénticas byte a byte a la plantilla de `tests/fixtures/`.
- En cambios a importadores: el total por hoja y el número de renglones deben coincidir con la fixture.

## Hechos del dominio que es fácil olvidar
- AX corta `Tamaño` a 10 caracteres; el código AX viene como texto con ceros (`000000670`).
- En el formulario actual, un renglón sin O.C. no se guardaba (por eso siempre `S/OC`) y solo se guardaban 16–18 de los 21 renglones. **No replicar esos errores.**
- La columna `C.U` de DIARIO en realidad es el campo **LOTE** del vale.
- Diésel (código 136), oxígeno, acetileno y otros insumos van en vales pero **no** llevan existencia.
- Entrada vs. salida: `XXXXX` en "Pase de Entrada" (C) o en "Pase de Salida" (D) del DIARIO.
