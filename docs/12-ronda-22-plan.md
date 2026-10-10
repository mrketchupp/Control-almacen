# 12 — Ronda 22 (planeada, SIN implementar)

Comentarios del usuario y decisiones ya tomadas con él. Retomar desde aquí.

## A. Vales de entrada: fecha del vale y fecha de recibido

**Pedido:** hay dos fechas. *Fecha del vale* = cuando la base lo envió. *Fecha de recibido* = cuando se recibió (se
registra). La de **recibido** decide en qué día suma al inventario y cuenta en el **reporte diario**. Debe ser editable.

**Decisiones del usuario:**
- Entradas ya registradas: `fecha_recibido` = **la fecha que ya tienen** (no cambia ningún reporte ya subido).
- Libro exportado `VALES DE ENTRADA <inv>.xlsx`: **las dos** — FECHA sigue siendo la del vale y se agrega al final la
  columna **FECHA RECIBIDO**.

**Plan:**
1. Estado formato 13: `vale.fecha_recibido` (ENTRADA). Migración: entradas sin ella → `= fecha`; borradores de entrada
   → `= hoy`. `nuevoBorradorEntrada` la propone con hoy.
2. Un ayudante `fechaDelDia(vale)` = recibido en entradas, `fecha` en salidas. Usarlo en `calcularSaldos(…, { dia })`
   (`nucleo/existencias.js`), `estadoAlCierre` / `ultimoFolioAl` (`servicios/corte.js`: las entradas se filtran por
   fecha de recibido, no por corte de E-folio, porque al ser editable deja de ir en orden), la página *Reporte diario*,
   los contadores del *Inicio* y `filasEntradas` / `filtrarEntradas` (historial: columnas *Fecha del vale* y
   *Recibido*; los filtros desde/hasta por recibido).
3. **Conciliación AX sigue con la fecha del vale** (`transitoDesde`, `servicios/conciliacion.js`): la base mueve el
   material en AX al enviarlo; con la de recibido, lo que va en camino se contaría mal. Decírselo al usuario.
4. Captura (`ui/paginas/entradas.js`, `EditorEntrada`): «Fecha» → **Fecha del vale** (la llena Copilot) + **Recibido**
   (hoy). Validación: recibido obligatoria y no futura; **aviso** (no bloquea) si es anterior a la del vale.
5. Corrección: `datosParaCorregirEntrada`, `encabezadoEntrada`, `resumenCambiosEntrada` (ETIQUETAS: «Recibido») →
   cambiarla queda en la bitácora con motivo. Detalle de la entrada muestra las dos.
6. Exportador `exportadores/entradas.js`: columna FECHA RECIBIDO al final (es libro nuevo, `xlsx/nuevo.js`).
7. Pruebas: saldos del día con recibido ≠ vale, reporte al cierre, migración 12 → 13, exportador, corrección.

## B. Editor de diseños de etiquetas

**Pedido:** un editor para crear / «diseñar» etiquetas y guardar el diseño, **independiente de la plantilla de
dimensiones** (hoja, márgenes, tamaño). El editor usa el espacio que necesite para ser cómodo.

**Decisiones del usuario:**
- **Editor libre** sobre la etiqueta, a pantalla completa: arrastrar y cambiar tamaño de cada elemento, con cuadrícula y
  guías. Posiciones en **proporción** (%), así el diseño se adapta a cualquier tamaño de etiqueta.
- El diseño elegido vale para **todas** las etiquetas (DLTA y GSM); **Material** y **Código AX** pueden tener cada una
  su propio diseño (las listas son independientes).
- Elementos: logos (izq / der), título, texto de almacén, campos (código, nombre, dimensión, NP, descripción, área,
  inventario) **más texto libre** (y cambiar el título de cada campo), **código QR** y **código de barras**. (Líneas y
  recuadros no se pidieron; los campos pueden llevar la línea de abajo como opción.)

**Plan:**
1. Datos en `config.etiquetas` (ya compartido DLTA/GSM): `disenos: [{ id, nombre, elementos }]` y
   `diseno_por_tipo: { material, ax }`. Dos diseños **de fábrica** (Material y Código AX, como hoy) de solo lectura:
   *Duplicar para editar*. Al borrar uno en uso, esa lista vuelve al de fábrica. No cambia el formato del estado
   (es config compartida) — si se decide guardarlo aparte, subir formato.
2. Elemento: `{ id, tipo: logo_izq | logo_der | titulo | texto_almacen | campo | texto | qr | barras, x, y, w, h (% de
   la etiqueta), campo?, etiqueta? (p. ej. «CODIGO AX:»), texto?, letra (% del alto de la etiqueta), negrita,
   alinear, linea_abajo, varias_lineas, datos? (qr / barras: código o código + dimensión) }`.
3. Render único en `impresion/etiquetas.js`: `.etq` con `position: relative` y cada elemento absoluto en %; letra =
   `letra/100 × alto` mm. Los de fábrica se expresan como elementos (mismo aspecto que hoy). El campo *Letra (px)* de la
   plantilla deja de usarse (el tamaño va en el diseño); el *borde* sigue en la plantilla.
4. **QR** (`impresion/qr.js`, sin dependencias): modo byte UTF-8, corrección M, versiones 1–10, máscara por
   penalización, salida SVG. **Código de barras** (`impresion/barras.js`): Code 128 B/C automático con dígito de
   control, SVG. Pruebas contra matrices / patrones esperados generados **una vez** con las bibliotecas de Python
   `qrcode` (forzando la máscara) y `python-barcode`, guardados como fixture JSON (no se agregan a las dependencias).
5. Editor (`ui/paginas/editorEtiquetas.js`), en primer plano a pantalla completa: izquierda = diseños (nuevo, duplicar,
   renombrar, borrar; «Usar para Material / Código AX»); centro = la etiqueta grande con datos de muestra (o la primera
   de la lista) al tamaño de la plantilla actual, arrastrar / cambiar tamaño, cuadrícula, flechas para mover, Supr para
   quitar, deshacer; derecha = agregar elementos y propiedades del elegido (también x / y / ancho / alto en números).
   Guardar / cerrar con aviso si hay cambios sin guardar.
6. En la página *Etiquetas*: botón *Editor de diseños* y, en la tarjeta de cada lista, qué diseño usa.
7. Servicio: `guardarDisenoEtiqueta`, `borrarDisenoEtiqueta`, `usarDiseno(tipo, id)` con auditoría (sin imágenes).
8. Pruebas: render de cada elemento, adaptación a tamaños, QR / barras, guardar / borrar / usar; recorrido en Chromium
   del editor (arrastrar, guardar, imprimir con el diseño) y PDF de la hoja.
