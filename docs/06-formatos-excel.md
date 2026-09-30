# 06 — Formatos de Excel (importación y exportación)

> Regla general de exportación: **plantilla + edición XML mínima**. Ver la justificación en [03-arquitectura.md](03-arquitectura.md#decisión-clave-exportar-sobre-plantilla-sin-reescribir-el-libro).
> La plantilla es el último archivo real que el usuario registró en la herramienta (en la primera carga; se guarda en el navegador y viaja en los respaldos).

## Técnicas comunes del exportador (`src/xlsx/plantilla.js`)

| Técnica | Detalle |
|---|---|
| Copia fiel | Toda parte del ZIP que no se modifica se copia byte por byte **con sus bytes comprimidos originales**, en el mismo orden, con la misma fecha y atributos |
| Edición por texto | En las partes que cambian solo se reemplazan los fragmentos necesarios (`<sheetData>`, `ref`, nombres definidos…); el resto del XML queda igual. Las fórmulas compartidas se reconstruyen desde su maestra al mover filas. |
| Texto nuevo | Se escribe como *inline string* (`t="inlineStr"`) para **no tocar** `sharedStrings.xml`. Excel lo acepta y lo convierte al guardar. |
| Estilos | Cada celda nueva usa el atributo `s` (estilo) que tiene esa columna en la plantilla: primera fila de datos de la tabla o última fila de DIARIO |
| Números y fechas | Números como `<v>`; fechas como número de serie de Excel (`46294` = 29/09/2026) con el estilo de fecha de la plantilla |
| Fórmulas | Se escriben sin valor en caché. Si el archivo tiene `calcChain.xml`, se elimina (parte, relación y *content type*) y se pone `<calcPr fullCalcOnLoad="1"/>`. |
| Validación | Pruebas automáticas: partes no tocadas idénticas a la plantilla, relectura que coincide con los datos exportados y apertura en LibreOffice. En desarrollo se comparó además contra openpyxl celda por celda con los archivos reales. |
| Prueba de aceptación | Abrir en Excel sin mensaje de reparación y con macros funcionando (manual, en cada versión) |

---

## A. Inventario de refaccionamiento (`.xlsx`)

### Importación
- **Hojas de contenedor:** las que tienen una tabla con encabezados `ITEM … TOTAL`. Los encabezados se comparan sin espacios finales (`DESCRIPCIÓN␠`). El número de contenedor y la clase se deducen del nombre de la hoja, **guardando el nombre exacto** con sus espacios.
- **Renglones:** con CODIGO AX numérico. Los vacíos dentro de la tabla se ignoran. La fila `Total` se ignora.
- **Por renglón:** existencia = (variante[código, DIMENSION, NP, UM], ubicación, CANTIDAD, orden, ITEM, nota).
- **CONSUMO e INGRESO del archivo no se importan como números sueltos.** Se recalculan a partir de los vales posteriores al folio de corte (P-12). El reporte de verificación compara lo recalculado contra lo que decía el archivo y lista las diferencias para confirmar. Así se evita contar dos veces un vale que ya se había anotado a mano, como el 551.
- **`ARTICULOS_MX`:** filas desde la 3, A = código y B = producto.

### Exportación
Partes modificadas: `xl/worksheets/sheet{1..10}.xml`, `xl/tables/table{1..10}.xml`, `xl/workbook.xml` (definedNames y calcPr), `xl/worksheets/sheet11.xml` (catálogo, solo si cambió), comentarios y VML (solo si se movieron las notas), y la eliminación de `calcChain`.

**Hoja de contenedor** (una por ubicación, en el mismo orden de la plantilla):

| Col | Valor exportado |
|---|---|
| A ITEM | Consecutivo 1..n (P-17) |
| B CODIGO AX | Número |
| C DESCRIPCIÓN | La misma fórmula de la plantilla: `IF(B{r}="","",VLOOKUP(Tabla…[[#This Row],[CODIGO AX]],ARTICULOS_MX!$A$2:$B$5000,2,))` |
| D DIMENSION | `variante.dimension` |
| E NP | `variante.np` (vacío si no hay) |
| F CANTIDAD | `existencia.cantidad_conteo` |
| G UM | `variante.um` |
| H CONSUMO | Suma de salidas desde el conteo (vacío si es 0, como hoy) |
| I INGRESO | Suma de entradas desde el conteo (vacío si es 0) |
| J TOTAL | Fórmula de la plantilla: `Tabla…[[#This Row],[INGRESO]]+Tabla…[[#This Row],[CANTIDAD]]-Tabla…[[#This Row],[CONSUMO]]` |

Reglas de la hoja:
- **Orden estable:** los renglones siguen `existencia.orden`. Las existencias nuevas van al final. Las que quedan en 0 **permanecen** con 0.
- **Fila de totales:** va después del último renglón, con `SUBTOTAL(109,Tabla…[CANTIDAD|CONSUMO|INGRESO|TOTAL])` y el estilo de la fila de totales de la plantilla.
- **Tabla:** `ref="A1:J{n+2}"` y `autoFilter ref="A1:J{n+1}"`.
- **Nombres definidos:** `_xlnm.Print_Area` y `_xlnm._FilterDatabase` de esa hoja se ajustan al nuevo número de filas.
- **Notas de celda:** se mueven a la fila actual de su existencia (`ref` en `commentsN.xml` y `x:Row` en `vmlDrawingN.vml`).
- **Contenido fuera de la tabla:** se reporta y se descarta. En la muestra solo hay una celda suelta ("Ñ").

**Nombre de archivo:** `INVENTARIO DE REFACCIONAMIENTO DLTA DE ALMACEN DDMMAA.xlsx`.

---

## B. Vales de salida (`.xlsm`)

### Importación del historial (`DIARIO`)
- Encabezado en la fila 1 y datos desde la fila 2. Columnas por posición A–T; los encabezados se validan.
- Los renglones se agrupan por **No. folio** para formar vales (encabezado = primer renglón del grupo).
- Se aplican las reglas de limpieza de [07-migracion.md](07-migracion.md).
- **Catálogo adicional:** columnas AG:AH (desde la fila 6) de cualquier hoja-formulario.
- **Plantillas por área:** de cada hoja-formulario se leen E17, I17, E18, I18, C44:C46, D52/D53, I52/I53 y G58 para crear `plantilla_area`. En `MECANICO ` y `OPERACION DIA ` el bloque de firmas está desplazado; se localiza por las etiquetas `ENTREGO/RECIBIO` y `Nombre:`.

### Exportación
**Solo se modifica `xl/worksheets/sheet1.xml` (DIARIO).** Todo lo demás se copia intacto: macros (`vbaProject.bin`), dibujos, botones, logos, formularios, `customXml` y configuración de impresora.

En `sheet1.xml` se reemplazan:
- `<sheetData>`: fila 1 (encabezados de la plantilla, sin cambios) y una fila por renglón de vale.
- `<dimension ref="A1:V{última}">`.
- El `<autoFilter>` principal de la hoja, a `A1:T{última}`. Los de *vistas personalizadas* no se tocan.
- `topLeftCell` del panel congelado, cerca del final, para que al abrir se vean los últimos renglones como hoy.

**Mapeo de columnas** (emula exactamente lo que hacía la macro `PasarDatos`):

| Col | Encabezado | Valor |
|---|---|---|
| A | FECHA | Fecha del vale (número de serie + estilo de fecha) |
| B | No. folio | Folio |
| C | Pase de Entrada | `0` en salidas (la macro copiaba K10 vacío como 0) |
| D | Pase de Salida | `XXXXX` |
| E | Origen: | origen |
| F | Depto | depto_origen |
| G | Destino | destino |
| H | Depto | depto_destino |
| I | OC | O.C.; `S/OC` si está vacía |
| J | Cantidad | Número |
| K | Código | Número |
| L | Descripción | Descripción |
| M | CLAVE | clave (dimensión / NP) |
| N | U.M. | UM |
| O | C.U | LOTE; `0` si está vacío (convención de la macro) |
| P | Entrego/Recibio | Nombre de quien entregó |
| Q | Entrego/Recibio | Nombre de quien recibió |
| R | Autorizo | Nombre de quien autorizó; `0` si no aplica |
| S | FAMILIA | Pendiente P-13 (por defecto vacío) |
| T | TRANSFERENCIA/CONSUMO | Pendiente P-13 (por defecto vacío) |

- **Orden de los renglones:** por folio y luego por número de renglón.
- **Vales cancelados:** pendiente P-07. Por defecto, un renglón con cantidad 0 y la descripción `CANCELADO – <motivo>`, para que el folio no parezca perdido.
- **Borradores:** no se exportan.
- **Nombre de archivo:** `VALES DE SALIDA DLTA.xlsm` (el mismo nombre de hoy).

---

## C. Vales de entrada (`.xlsx`, archivo nuevo)

Es un archivo nuevo, así que no tiene la restricción de ser idéntico. Se genera desde cero con `src/xlsx/nuevo.js` (Arial y el mismo estilo visual que DIARIO).

- Hoja `DIARIO`, con las mismas columnas A–T del DIARIO de salidas, más una columna **U = Folio interno** (`E-0001`).
- **B = folio de la base** (P-05).
- **C = `XXXXX`, D = `0`**: marca de entrada, igual que en el formato en papel.
- **Nombre de archivo:** `VALES DE ENTRADA DLTA.xlsx`.

---

## D. Reporte AX (importación)

- Se busca la fila de encabezados que contenga `Código de Artículo` (normalmente la fila 1). Las columnas se leen por nombre.
- Se filtra `Almacén = RIG91-IX25` (configurable). Si el archivo ya viene filtrado, no pasa nada.
- `Código` → entero. `Tamaño`, `Color`, `Unidad de Medida` → texto sin espacios sobrantes.
- La fecha de corte se toma del nombre del archivo (`DDMMAA` o `DD-MM-AA`) y el usuario la confirma.

## E. Solicitud de ajuste (exportación, archivo nuevo)

- Hoja con el mismo nombre y las **mismas 10 columnas** del reporte AX (A–J, mismos encabezados y formatos), más:
  - **K = Existencia física:** `TOTAL` sumado de todas las ubicaciones de la variante.
  - **L = Folios que justifican:** folios de vales en tránsito relacionados, separados por coma. Por ejemplo `545, 551 (S) · E-0003 (E)`.
- Renglones: solo los que tienen diferencia (físico ≠ Disponible). Opción de incluir todos.
- Los artículos físicos sin renglón en AX van al final: columnas AX llenas con código, nombre, UM, almacén y dimensión; `Disponible = 0`; valores en blanco.
- **Nombre de archivo:** `SOLICITUD DE AJUSTE RIG 91 DDMMAA.xlsx`.

## F. Vale de la base en Excel (importación opcional, RF-35)

Mismo formulario de 21 renglones:
- Encabezado: K8 (folio), J6 (fecha), E17/I17, E18/I18.
- Renglones: 21–41, columnas C (O.C.), D (cantidad), E (código), I (clave) y J (UM).
- Si trae varias hojas con datos, se ofrece elegir cuál importar.
