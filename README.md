# Control de Almacén — RIG 91

Herramienta **web** para el almacén de refaccionamiento del RIG 91 que **guarda todo en el equipo del usuario**.
Es un solo archivo HTML que se abre en Microsoft Edge: no se instala, no usa servidor y no puede enviar datos a
internet. Tiene cuatro objetivos:

1. **Administrar el inventario físico** por contenedor (5 contenedores, divididos en inventariable y consumible).
2. **Emitir vales de salida** (consumos y transferencias) y **registrar vales de entrada** (material recibido de la base operativa), con folio controlado.
3. **Comparar** el inventario físico contra el inventario auditable de AX (Dynamics AX) y generar el formato de solicitud de ajuste.
4. **Exportar** versiones actualizadas de los archivos de Excel que ya se usan, **idénticas en estructura**:
   - `INVENTARIO DE REFACCIONAMIENTO DLTA DE ALMACEN.xlsx`
   - `VALES DE SALIDA DLTA.xlsm` (con sus macros, botones y formato intactos)

## Estado

**Fase 4 — Conciliación contra AX (entregada, en aceptación).** Importar el reporte de inventario de AX, emparejar sus
renglones con el inventario (con memoria de equivalencias), ver las diferencias por renglón, artículo, contenedor y en
pesos con los vales en tránsito que las explican (incluido lo que el archivo de vales de la base marca como pendiente en
AX), y exportar la solicitud de ajuste. Fases 1 (primera carga y exportación
idéntica) y 2 (vales de salida) aceptadas; fase 3 (entradas, conteos y movimientos) entregada. Ronda 20: las
**etiquetas de almacén** (antes el generador aparte) se hacen aquí, desde los vales de entrada y el inventario.
Cómo abrirla y usarla: [docs/10-instalacion-y-uso.md](docs/10-instalacion-y-uso.md). El archivo
`ControlAlmacen.html` se genera automáticamente en GitHub Actions (pestaña *Actions* → artefacto `ControlAlmacen-html`).
También hay una [versión lista para descargar](versiones/ControlAlmacen.html), con etiquetas y editor de diseños integrados, impresión y corrección por lotes y actualización confirmada de puestos. Corregir el inventario desde AX prepara sus etiquetas; los justificantes tienen una fecha mínima editable por corte (propuesta: 1 de noviembre del año anterior al reporte).
En GitHub, abre ese archivo y usa **Download raw file** (icono de descarga).
El clic derecho ofrece acciones según el diseño, elemento, etiqueta, vale o partida del inventario. El editor permite
copiar, cortar y pegar elementos entre diseños con Deshacer / Rehacer; los campos de texto conservan su edición habitual.
La conciliación AX suma las partidas de la misma dimensión con distintos NP y permite vincular manualmente el físico
que corresponda desde **Elegir del inventario**, con revisión y Deshacer.

```bash
npm ci && npm test && npm run build   # → dist/ControlAlmacen.html
```

| Documento | Contenido |
|---|---|
| [01 — Contexto y archivos fuente](docs/01-contexto.md) | Qué es cada archivo actual, su estructura y los problemas detectados |
| [02 — Requerimientos](docs/02-requerimientos.md) | Qué debe hacer la herramienta y las decisiones tomadas con el usuario |
| [03 — Arquitectura](docs/03-arquitectura.md) | Tecnología web, almacenamiento local, respaldos en OneDrive y estructura del proyecto |
| [04 — Modelo de datos](docs/04-modelo-de-datos.md) | Entidades, llaves y reglas de normalización |
| [05 — Flujos de trabajo](docs/05-flujos.md) | Vale de salida, vale de entrada, correcciones, conteo, conciliación y respaldo |
| [06 — Formatos de Excel](docs/06-formatos-excel.md) | Especificación exacta de importación y exportación (celdas, columnas, tablas) |
| [07 — Migración y limpieza](docs/07-migracion.md) | Cómo se carga el historial y qué reglas de limpieza se aplican |
| [08 — Plan de trabajo](docs/08-plan.md) | Fases, entregables y criterios de aceptación |
| [09 — Pendientes](docs/09-pendientes.md) | Preguntas abiertas y decisiones por confirmar |
| [10 — Cómo abrirla y usarla](docs/10-instalacion-y-uso.md) | Abrir, carpeta de respaldos, primera carga, uso diario y respaldos |
| [11 — Etiquetas](docs/11-etiquetas.md) | El generador de etiquetas dentro de la herramienta: decisiones, flujos, datos e impresión |

## Principios del proyecto

- **Privacidad:** los datos reales (Excel, respaldos, nombres) nunca se suben a este repositorio ni a ningún servidor. La página tiene prohibido conectarse a la red; los datos viven en el navegador del equipo y los respaldos en la carpeta de OneDrive del usuario.
- **Sin romper lo que ya funciona:** los archivos exportados deben poder enviarse a la base operativa como hoy, sin que nadie note diferencias de formato.
- **Todo movimiento deja rastro:** ningún vale se borra y ningún folio se reutiliza. Las correcciones quedan en una bitácora.
- **Funciona sin conexión y sin instalar:** basta Edge. OneDrive se usa solo como destino de los respaldos.
