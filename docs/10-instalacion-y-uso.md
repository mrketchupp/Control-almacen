# 10 — Instalación y uso (Fase 1)

## Qué incluye la Fase 1

| Módulo | Qué puedes hacer |
|---|---|
| Primera carga | Importar tu inventario y tu libro de vales actuales, con ensayo previo y reporte de verificación |
| Lista de revisión | Generar la lista de renglones dudosos del DIARIO, contestarla en Excel y aplicar tus respuestas |
| Inventario | Consultar existencias por contenedor, con búsqueda y filtros |
| Historial de vales | Consultar el DIARIO migrado |
| Pendientes | Indicar de qué renglón del inventario salió cada vale posterior al conteo |
| Exportar | Generar `VALES DE SALIDA DLTA.xlsm` e `INVENTARIO…xlsx` idénticos a los actuales |
| Respaldos | Respaldo automático en OneDrive, manual y restauración |

> La emisión de vales nuevos, las entradas y la conciliación con AX llegan en las fases 2, 3 y 4 (ver [08-plan.md](08-plan.md)).
> Mientras tanto se sigue usando el Excel para emitir vales, y la herramienta sirve para consultar y verificar.

## 1. Descargar el instalador

1. En GitHub, abre la pestaña **Actions** del repositorio y elige la ejecución más reciente de *"Pruebas y compilación para Windows"* con palomita verde.
2. En **Artifacts**, descarga `ControlAlmacen-<versión>-instalador`: es un `.zip` con el instalador y `SHA256.txt`.
3. **Para TI:** `SHA256.txt` contiene la huella del instalador. Pueden verificarla con PowerShell:
   ```powershell
   Get-FileHash .\ControlAlmacen-0.1.0-instalador.exe -Algorithm SHA256
   ```

## 2. Instalar

- Ejecuta `ControlAlmacen-<versión>-instalador.exe`. Se instala **solo para tu usuario** y no pide permisos de administrador.
- Windows SmartScreen puede advertir que el programa "no es reconocido", porque no tiene firma digital. En ese caso: **Más información → Ejecutar de todas formas**, o que TI lo autorice.
- Requisito: **Microsoft Edge WebView2**, que ya viene en Windows 10 y 11 actualizados. Si faltara, se descarga gratis de Microsoft.

| Qué | Dónde queda |
|---|---|
| Programa | `%LOCALAPPDATA%\Programs\ControlAlmacen` |
| Datos (base de datos, plantillas, registros) | `%LOCALAPPDATA%\ControlAlmacen` |
| Respaldos y exportaciones | `OneDrive\ControlAlmacen\` |

Al **desinstalar** no se borran los datos ni los respaldos.

## 3. Primera carga (la herramienta llega vacía)

La herramienta se instala como un **cascarón vacío**: no trae ningún dato. Tus datos entran solo desde tus propios archivos, en tu equipo.

1. **Tus archivos:** sube el inventario (`.xlsx`) y el libro de vales (`.xlsm`). Se copian a la carpeta de datos; los originales no se tocan.
2. **Lista de revisión (opcional pero recomendada):**
   1. Pulsa **Generar lista de revisión**. Se crea en `OneDrive\ControlAlmacen\exportaciones\revision`.
   2. Contéstala en Excel con tus PDF escaneados:
      - Las celdas **naranjas** son datos perdidos (`#REF!`).
      - Las **amarillas** son las que puedes editar.
      - Cada renglón ya trae el valor actual o una sugerencia.
   3. Súbela en el mismo paso.
   Si no la contestas, se aplican solo las limpiezas automáticas.
3. **Conteo base:**
   - **Fecha del conteo:** se toma del nombre del archivo de inventario.
   - **Folio de corte:** se sugiere el último folio anterior a esa fecha. Los vales con folio mayor se descuentan del inventario. Para tu archivo del 28-sep el corte es **549**, así que se descuentan del 550 en adelante.
4. **Ensayo:** hace una carga de prueba y muestra el reporte. Muestra los totales por hoja (archivo contra calculado) y las diferencias por renglón; por ejemplo, el vale 550 que tu Excel aún no descontaba. También lista los renglones por ubicar, los omitidos y las correcciones.
5. **Cargar:** guarda todo, registra tus archivos como **plantillas** y crea el primer respaldo.

## 4. Uso diario (Fase 1)

1. **Elige quién está en turno** arriba a la derecha. Queda registrado en cada acción.
2. **Pendientes:** si la insignia naranja muestra un número, abre *Pendientes*. En cada renglón elige de qué contenedor salió; la opción más parecida aparece primero. Si no es un artículo del inventario, elige "No inventariado".
3. **Exportar a Excel:** genera los archivos en `OneDrive\ControlAlmacen\exportaciones\AAAA-MM-DD\`. El de vales es el que envías por correo a la base.

## 5. Respaldos y reinstalación

- Se crea un respaldo automático al abrir (uno por día) y otro al cerrar. Se conservan los últimos 30 días y 12 meses.
- **Reinstalar el equipo:**
  1. Instala la herramienta.
  2. Ve a **Respaldos**.
  3. Pulsa **Restaurar** en el más reciente. Si el archivo está en otra carpeta, súbelo con *Traer un respaldo*.
- Antes de restaurar se respalda el estado actual, así que siempre puedes volver atrás.

## 6. Para desarrollo

```bash
uv venv -p 3.12 .venv && . .venv/bin/activate
uv pip install -e ".[dev]"
pytest                                   # pruebas (Excel sintéticos, sin datos reales)
python -m control_almacen --navegador    # abre en el navegador (http://127.0.0.1:8765)
```

Las variables `CONTROL_ALMACEN_DATOS`, `CONTROL_ALMACEN_RESPALDOS` y `CONTROL_ALMACEN_EXPORTACIONES` redirigen las carpetas, por ejemplo para pruebas.
