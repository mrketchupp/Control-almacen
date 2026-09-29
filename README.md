# Control de Almacén — RIG 91

Herramienta de escritorio (Windows) para el almacén de refaccionamiento del RIG 91. Tiene cuatro objetivos:

1. **Administrar el inventario físico** por contenedor (5 contenedores, divididos en inventariable y consumible).
2. **Emitir vales de salida** (consumos y transferencias) y **registrar vales de entrada** (material recibido de la base operativa), con folio controlado.
3. **Comparar** el inventario físico contra el inventario auditable de AX (Dynamics AX) y generar el formato de solicitud de ajuste.
4. **Exportar** versiones actualizadas de los archivos de Excel que ya se usan, **idénticas en estructura**:
   - `INVENTARIO DE REFACCIONAMIENTO DLTA DE ALMACEN.xlsx`
   - `VALES DE SALIDA DLTA.xlsm` (con sus macros, botones y formato intactos)

## Estado

**Fase 0 — Análisis y planeación (terminada).** Aún no hay código. La planeación completa está en [`docs/`](docs/).

| Documento | Contenido |
|---|---|
| [01 — Contexto y archivos fuente](docs/01-contexto.md) | Qué es cada archivo actual, su estructura y los problemas detectados |
| [02 — Requerimientos](docs/02-requerimientos.md) | Qué debe hacer la herramienta y las decisiones tomadas con el usuario |
| [03 — Arquitectura](docs/03-arquitectura.md) | Tecnología, almacenamiento, respaldos en OneDrive, empaquetado y estructura del proyecto |
| [04 — Modelo de datos](docs/04-modelo-de-datos.md) | Tablas, llaves y reglas de normalización |
| [05 — Flujos de trabajo](docs/05-flujos.md) | Vale de salida, vale de entrada, correcciones, conteo, conciliación y respaldo |
| [06 — Formatos de Excel](docs/06-formatos-excel.md) | Especificación exacta de importación y exportación (celdas, columnas, tablas) |
| [07 — Migración y limpieza](docs/07-migracion.md) | Cómo se carga el historial y qué reglas de limpieza se aplican |
| [08 — Plan de trabajo](docs/08-plan.md) | Fases, entregables y criterios de aceptación |
| [09 — Pendientes](docs/09-pendientes.md) | Preguntas abiertas y decisiones por confirmar |

## Principios del proyecto

- **Privacidad:** los datos reales (Excel, base de datos, respaldos) nunca se suben a este repositorio. Solo se versionan el código, la documentación y datos de prueba anonimizados.
- **Sin romper lo que ya funciona:** los archivos exportados deben poder enviarse a la base operativa como hoy, sin que nadie note diferencias de formato.
- **Todo movimiento deja rastro:** ningún vale se borra y ningún folio se reutiliza. Las correcciones quedan en una bitácora.
- **Funciona sin conexión:** la herramienta no depende de internet. OneDrive se usa solo como destino de los respaldos.
