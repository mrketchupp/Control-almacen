# 10 — Cómo abrirla y usarla (versión web)

## Qué incluye

| Módulo | Qué puedes hacer |
|---|---|
| Primera carga | Importar tu inventario y tu libro de vales actuales, con ensayo previo y reporte de verificación |
| Lista de revisión | Generar la lista de renglones dudosos del DIARIO, contestarla en Excel y aplicar tus respuestas |
| Inventario | Consultar existencias por contenedor, con búsqueda y filtros |
| Historial de vales | Consultar el DIARIO migrado |
| Pendientes | Indicar de qué renglón del inventario salió cada vale posterior al conteo |
| Exportar | Generar `VALES DE SALIDA DLTA.xlsm` e `INVENTARIO…xlsx` idénticos a los actuales |
| Respaldos | Respaldo automático en la carpeta elegida (OneDrive), manual, restauración y copias internas |

> La emisión de vales nuevos, las entradas y la conciliación con AX llegan en las fases 2, 3 y 4 (ver [08-plan.md](08-plan.md)).
> Mientras tanto se sigue usando el Excel para emitir vales, y la herramienta sirve para consultar y verificar.

## 1. Abrirla (no se instala nada)

La herramienta es **un solo archivo**: `ControlAlmacen.html` (~190 KB). Dos formas de abrirla:

| Forma | Cómo | Nota |
|---|---|---|
| **A. Archivo en el equipo** (recomendada para probar) | Guarda `ControlAlmacen.html` en `OneDrive\ControlAlmacen\` y ábrelo con **doble clic** en Microsoft Edge. Crea un acceso directo o fíjalo en favoritos. | Funciona sin internet. |
| **B. Página publicada** | Abrir la dirección del sitio estático (por ejemplo GitHub Pages) en Edge. | Siempre la versión más nueva. Aunque la página venga de internet, **los datos se quedan en tu equipo**: la página no puede enviar nada (sin conexiones de red). |

Dónde conseguir el archivo: en GitHub, pestaña **Actions** → la ejecución más reciente de *"Pruebas y compilación web"*
con palomita verde → artefacto **`ControlAlmacen-html`**. También se entrega directamente por el chat del proyecto.

**Importante:** los datos quedan ligados a la forma en que la abres. Si empiezas con el archivo (A) y luego usas la
página publicada (B), esta aparecerá vacía: restaura tu último respaldo y listo. Usa siempre la misma forma.

**Diagnóstico opcional:** `herramientas/diagnostico-navegador.html` comprueba, sin conectarse a internet, que Edge puede
leer tus Excel, guardar datos entre sesiones y escribir en OneDrive.

## 2. Carpeta de respaldos (una sola vez)

1. En **Inicio** o **Respaldos**, pulsa **Elegir carpeta** y selecciona (o crea) `OneDrive\ControlAlmacen`.
2. Edge pregunta si permites que la página vea y edite esa carpeta: **Permitir**.
3. Ahí se crean `respaldos\`, `exportaciones\AAAA-MM-DD\` y `revision\`.

En cada sesión nueva Edge vuelve a pedir el permiso: aparece un aviso amarillo arriba con el botón **Permitir** (un clic).

| Qué | Dónde queda |
|---|---|
| Datos de trabajo | Almacenamiento local de Edge (IndexedDB) de este equipo y esta cuenta de Windows |
| Respaldos | `OneDrive\ControlAlmacen\respaldos\` |
| Excel exportados | `OneDrive\ControlAlmacen\exportaciones\AAAA-MM-DD\` |

## 3. Primera carga (la herramienta llega vacía)

La herramienta llega como un **cascarón vacío**: no trae ningún dato. Tus datos entran solo desde tus propios archivos, en tu equipo.

1. **Tus archivos:** elige el inventario (`.xlsx`) y el libro de vales (`.xlsm`). Se leen en el navegador; los originales no se tocan.
2. **Lista de revisión (opcional pero recomendada):**
   1. Pulsa **Generar lista de revisión**. Se guarda en `OneDrive\ControlAlmacen\revision\` (o en Descargas).
   2. Contéstala en Excel con tus PDF escaneados:
      - Las celdas **naranjas** son datos perdidos (`#REF!`).
      - Las **amarillas** son las que puedes editar.
      - Cada renglón ya trae el valor actual o una sugerencia.
   3. Súbela con **Subir lista contestada**.
   Si no la contestas, se aplican solo las limpiezas automáticas.
3. **Conteo base:**
   - **Fecha del conteo:** se toma del nombre del archivo de inventario.
   - **Folio de corte:** se sugiere el último folio anterior a esa fecha. Los vales con folio mayor se descuentan del inventario. Para tu archivo del 28-sep el corte es **549**, así que se descuentan del 550 en adelante.
   - **Quién hace la carga:** tu nombre como firmas los vales.
4. **Ensayo:** hace la carga en memoria y muestra el reporte: totales por hoja (archivo contra calculado), diferencias por renglón (por ejemplo, el vale 550 que tu Excel aún no descontaba), renglones por ubicar, omitidos y correcciones. **No guarda nada.**
5. **Cargar definitivamente:** guarda todo en el equipo, registra tus archivos como **plantillas** y crea el primer respaldo.

## 4. Uso diario

1. **Elige quién está en turno** arriba a la derecha. Queda registrado en cada acción.
2. **Pendientes:** si la insignia naranja muestra un número, abre *Pendientes*. En cada renglón elige de qué contenedor salió; la opción más parecida aparece primero (★ = la clave coincide). Si no es un artículo del inventario, elige *No inventariado*.
3. **Exportar a Excel:** genera los archivos en `OneDrive\ControlAlmacen\exportaciones\AAAA-MM-DD\`. El de vales es el que envías por correo a la base.

## 5. Respaldos, cambio de equipo y "empezar de cero"

- Automáticos: uno al primer uso del día (si la carpeta tiene permiso), después de la primera carga y después de cada exportación. Se conservan los últimos 30 días y 12 meses.
- **Respaldar ahora** crea uno en cualquier momento (o lo descarga si no hay carpeta).
- **Cambiar de equipo o de navegador:** abre la herramienta allá, ve a **Respaldos → Restaurar desde un archivo…** y elige el `.zip` más reciente de OneDrive.
- Antes de restaurar se guarda el estado actual (respaldo en la carpeta y copia interna), así que siempre puedes volver atrás.
- **Zona de cuidado → Borrar todos los datos de este navegador:** deja la herramienta vacía (por ejemplo, después de una prueba). Antes crea un respaldo.

> ⚠️ Si alguien borra en Edge "Cookies y otros datos de sitios", se borran los datos de trabajo. Se recuperan restaurando el último respaldo.

## 6. Para desarrollo

Requisitos: Node 22 y Python 3 con `openpyxl` (solo para generar los Excel sintéticos de las pruebas).

```bash
npm ci                                 # dependencias (esbuild, preact, htm, fflate, big.js)
pip install -r tests/fixtures/requirements.txt
npm test                               # pruebas (Excel sintéticos, sin datos reales)
npm run build                          # → dist/ControlAlmacen.html (un solo archivo)
```

Para verla mientras se desarrolla basta con `npm run build` y abrir `dist/ControlAlmacen.html` en el navegador.
