# 07 — Migración y limpieza del historial

## Objetivo

Cargar en la herramienta, sin perder información, lo siguiente:
1. El catálogo.
2. El inventario físico, como **conteo inicial**.
3. El historial completo de vales (`DIARIO`).
4. Las plantillas por área.

Todo se limpia con reglas explícitas y confirmadas por el usuario. **Los archivos originales nunca se modifican.**

## Orden de carga

```mermaid
flowchart LR
    A[Paso 1 · Catálogo<br/>ARTICULOS_MX + catálogo de vales<br/>+ lista de la base] --> B[Paso 2 · Ubicaciones<br/>10 hojas]
    B --> C[Paso 3 · Inventario físico<br/>= conteo inicial]
    C --> D[Paso 4 · Personas y alias]
    D --> E[Paso 5 · Plantillas por área<br/>11 hojas-formulario]
    E --> F[Paso 6 · Historial DIARIO<br/>con limpieza]
    F --> G[Paso 7 · Verificación cruzada]
```

## Insumo del usuario: `Revision_historial_DLTA.xlsx`

Se entregó al usuario **fuera del repositorio** porque contiene nombres y datos reales. Tiene 7 hojas con 298 puntos a revisar. Las columnas amarillas son para responder.

| Hoja | Qué contiene | Cuántos | Cómo se resuelve |
|---|---|---|---|
| 1 Datos perdidos | Renglones con `#REF!` | 52 (10 de prioridad alta, 6 media, 36 baja) | El usuario captura el dato del PDF escaneado |
| 2 Renglones duplicados | Renglones idénticos (vales guardados dos veces) | 47 | Sí/No a eliminar la copia |
| 3 Folios a verificar | Folio 494 faltante, folios 30/297/384 con posible truncamiento o doble guardado, folios con 2 departamentos o fechas raras, destino vacío | 21 | Revisión contra PDF |
| 4 Códigos a confirmar | Códigos fuera del catálogo local (1672, 3358…) y descripciones que no corresponden al código | 24 | Confirmar con la base o corregir |
| 5 Nombres a unificar | 27 grupos de variantes de nombre | 64 | Confirmar el nombre correcto |
| 6 Valores a normalizar | UM, LOTE, departamentos y destinos escritos distinto | 20 | Confirmar el valor propuesto |
| 7 Inventario físico | Renglones repetidos en la misma hoja, el mismo NP con otro código, códigos fuera de catálogo | 70 | Verificación física o de catálogo |

El importador lee este archivo ya contestado y aplica las respuestas. Así las decisiones quedan documentadas y son repetibles.

## Reglas de limpieza del DIARIO

| # | Situación | Regla | ¿Automática? |
|---|---|---|---|
| L-01 | Renglón idéntico repetido en el mismo folio | Se conserva el primero y se elimina la copia | Solo si el usuario dijo **Sí** en la hoja 2 |
| L-02 | Celdas con `#REF!` | Se usa el dato capturado del PDF. En LOTE sin respuesta queda vacío. En encabezados sin respuesta se toma el de los otros renglones del mismo folio. | Semiautomática |
| L-03 | Renglón completamente `#REF!` (fila 1147) | Se elimina, salvo que el PDF del folio 475 muestre un renglón faltante | Según respuesta |
| L-04 | Fecha como texto (`" 11/04/2026"`) | Se convierte a fecha | Automática |
| L-05 | Nombres con variantes | Se reemplazan por el nombre canónico (tabla `persona_alias`) | Según hoja 5 |
| L-06 | UM, LOTE, departamentos, destinos | Mapeo de la hoja 6 | Según hoja 6 |
| L-07 | Descripción con error de dedo y código correcto | Se usa la descripción del catálogo | Automática |
| L-08 | Código fuera de catálogo | Se da de alta el artículo con la descripción del DIARIO, marcado "por confirmar con AX" | Automática + aviso |
| L-09 | Destino `0` | El valor que indique el usuario (propuesta: `RIG 91`) | Según hoja 3 |
| L-10 | Folio faltante (494) | Se captura desde el PDF o se registra como "folio no utilizado", con nota | Según hoja 3 |
| L-11 | Folio con 2 departamentos (358, 495) | Si el PDF muestra un solo vale, se unifica. Si son dos, el segundo recibe nota (el folio no se duplica). | Según hoja 3 |

Cada renglón migrado guarda `fila_diario_origen` para poder rastrear su origen.

## Historial vs. existencias

- Los vales **anteriores al conteo inicial** solo son historial: **no** afectan existencias, porque el conteo físico ya los refleja.
- Los vales **posteriores al conteo inicial** sí descuentan: se vuelven el CONSUMO/INGRESO de cada renglón.
- **Punto de corte:** pendiente P-12. El conteo del 28-sep-2026 ya muestra CONSUMO = 1 en cabos para marro, que corresponde al vale 551. Hay que confirmar desde qué folio empiezan a descontarse.
- Las columnas CONSUMO e INGRESO del archivo **no** se suman como ajuste: se reconstruyen desde los vales posteriores al corte, y el reporte de verificación señala donde no coincidan (por ejemplo, el vale 550 no aparece descontado en el archivo).
- Para vales migrados posteriores al corte, se asigna la ubicación de cada renglón. Si la variante está en una sola ubicación, se asigna automáticamente; si está en varias, el usuario elige en una pantalla de "renglones por ubicar".

## Verificación cruzada (paso 7)

Al terminar, la herramienta muestra un reporte que debe cuadrar al 100%:
- Número de folios y de renglones migrados, eliminados (con motivo) y corregidos.
- Por cada hoja de inventario: suma de CANTIDAD, CONSUMO, INGRESO y TOTAL, contra el archivo original.
- Exportación de prueba: el `DIARIO` exportado reimportado da los mismos datos, y el inventario exportado da los mismos totales por hoja que el original (salvo las limpiezas aprobadas).

## Re-ejecución

La migración se puede correr varias veces sobre una base vacía (modo "ensayo") hasta que el reporte cuadre. Solo entonces se hace la migración definitiva y se toma el primer respaldo.
