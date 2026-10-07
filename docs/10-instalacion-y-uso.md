# 10 — Cómo abrirla y usarla (versión web)

## Qué incluye

| Módulo | Qué puedes hacer |
|---|---|
| Inicio | Accesos grandes: **Crear un vale**, **Agregar material recibido**, **Crear reporte diario** y **Conteo físico**; *Subir al SharePoint* con botón **Ya lo subí**, último conteo, **etapa de perforación** (se cambia ahí mismo) y uso diario |
| **Reporte diario** | En el menú, después de *Conteo físico*. **Descarga** el **libro de vales** y el **inventario** como estaban **al cierre del día elegido**; muestra los vales y entradas de ese día y lo que falta subir al SharePoint hasta ese folio |
| Primera carga | Importar tu inventario y tu libro de vales actuales, con ensayo previo y reporte de verificación |
| Lista de revisión | Generar la lista de renglones dudosos del DIARIO, contestarla en Excel y aplicar tus respuestas |
| **Vales de entrada** | Registrar el material que llega de la base o de otro equipo, **a mano o desde la foto/PDF con Copilot**: contenedor sugerido, variante nueva, *hay → queda* por partida, quién solicita (LOTE), folio interno `E-0001` |
| **Conciliación AX** | Importar el reporte de inventario de AX (solo modelo INV), confirmar las parejas que se escriben distinto (corrige la dimensión / NP del inventario), ver diferencias por partida, artículo, contenedor y en pesos con los **vales en tránsito** que las explican, y descargar la **solicitud de ajuste** con colores por estado. Con el **archivo de vales de la base** sabe qué partidas ya están en AX (IN / TR) y cuáles siguen pendientes |
| **Conteo físico** | Conteo total o por contenedor: hoja de conteo para imprimir (renglones altos para escribir), captura (también desde la foto con Copilot), diferencias y material encontrado |
| **Vales de salida** | Hacer vales en pestañas (borradores): datos a la izquierda, partidas al centro como en el vale impreso, folio automático e impresión |
| Historial de vales | Consultar el DIARIO con **filtros combinables** (código, área, quién recibió, estado, fechas y texto); abrir cualquier folio para imprimirlo o **corregirlo** (el motivo se llena solo con los cambios) |
| Inventario | Consultar existencias por contenedor, con búsqueda y filtros |
| Pendientes | Indicar de qué renglón del inventario salió cada vale posterior al conteo |
| Exportar y enviar | Generar `VALES DE SALIDA DLTA.xlsm` e `INVENTARIO…xlsx` idénticos a los actuales, ver qué falta **subir al SharePoint** y traer vales hechos en el Excel |
| **Áreas y personas** | Editar las plantillas de cada área (interna, externa o transferencia) y las personas (almacenistas, puestos) |
| **Ajustes** | Modo de captura de partidas (paso a paso o con búsqueda rápida), **tu pantalla de vales** (orden de los datos y de qué lado van) y etapa de perforación actual |
| Respaldos | Respaldo automático en la carpeta elegida (OneDrive), manual, restauración y copias internas |

El menú de la izquierda tiene lo del día a día. **Exportar y enviar, Áreas y personas, Ajustes, Respaldos y Ayuda**
están en el botón **Ajustes y más** (abajo a la izquierda): se abre en primer plano con las secciones a la izquierda
y su contenido a la derecha; se cierra con **✕**, con `Esc` o con un clic fuera. En *Ajustes → Personalización* cada
almacenista elige **tema** (claro, oscuro o como Windows), dónde salen los **avisos** (arriba o abajo) y si quiere
**animaciones**.

## 1. Abrirla (no se instala nada)

La herramienta es **un solo archivo**: `ControlAlmacen.html` (~300 KB). Dos formas de abrirla:

| Forma | Cómo | Nota |
|---|---|---|
| **A. Archivo en el equipo** (recomendada para probar) | Guarda `ControlAlmacen.html` en `OneDrive\ControlAlmacen\` y ábrelo con **doble clic** en Microsoft Edge. Crea un acceso directo o fíjalo en favoritos. | Funciona sin internet. |
| **B. Página publicada** | Abrir la dirección del sitio estático (por ejemplo GitHub Pages) en Edge. | Siempre la versión más nueva. Aunque la página venga de internet, **los datos se quedan en tu equipo**: la página no puede enviar nada (sin conexiones de red). |

Dónde conseguir el archivo: en GitHub, pestaña **Actions** → la ejecución más reciente de *"Pruebas y compilación web"*
con palomita verde → artefacto **`ControlAlmacen-html`**. También se entrega directamente por el chat del proyecto.

**Importante:** los datos quedan ligados a la forma en que la abres. Si empiezas con el archivo (A) y luego usas la
página publicada (B), esta aparecerá vacía: restaura tu último respaldo y listo. Usa siempre la misma forma.

**Como aplicación (ventana sola, sin pestañas ni barra de direcciones):** Edge la abre así con un acceso directo; no se
instala nada. En la herramienta, *Ajustes y más → Ayuda → Abrirla como aplicación* trae el destino listo para copiar
con la ruta de tu archivo. A mano: escritorio → clic derecho → *Nuevo → Acceso directo* → ubicación:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="file:///C:/Users/<usuario>/OneDrive/ControlAlmacen/ControlAlmacen.html"
```

→ nombre *Control de Almacén* → *Finalizar* (y, si quieres, *Anclar a la barra de tareas*). Usa el mismo Edge y la
misma cuenta de Windows, así los datos son los mismos que al abrirla con doble clic. La opción *Instalar este sitio como
aplicación* de Edge no aparece con archivos locales; por eso se usa el acceso directo.

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
| Excel exportados | La carpeta que elijas al exportar (sin esa ventana, `OneDrive\ControlAlmacen\exportaciones\AAAA-MM-DD\`) |

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

1. **Elige quién está en turno** arriba a la derecha. Queda registrado en cada acción y se pone como "Entregó" en los vales.
2. **Hacer un vale** (*Vales de salida* o el botón grande de *Inicio*):
   1. A la izquierda elige el **área que recibe**. En transferencias, justo debajo capturas origen y destino. En las demás, lo que se llena solo (quién entrega, de dónde sale, a dónde llega y las observaciones) queda al final del panel, en *Se llenan solos*.
   2. **Recibió:** escribe el nombre o el puesto ("mecánico") y elige de la lista; su puesto se llena solo.
   3. **Etapa de perforación:** es lo único que cambia en las observaciones; ya viene con la última que usaste.
   4. Al centro, en **Partidas**: escribe el **código AX** y `Enter`; en **Clave almacén** aparecen solo las claves de ese código con su contenedor, su NP y existencia (pastillas grises); elige con las flechas y `Enter`; escribe la **cantidad** y `Enter` para pasar a la siguiente partida. La **clave** es la dimensión tal como está en el inventario (`S/D`, `SIN DIMENSION`…; si no tiene, `SIN DIMENSIÓN`) y el **NP** va en la columna **LOTE**. *Otra clave* sirve para algo que no sale del inventario; el diésel y lo que no lleva existencia quedan como *No inventariado*.
   5. Si pides más de lo que hay, la herramienta pide una **justificación** para continuar. **✕ Quitar** borra una partida.
   6. **Vista previa** muestra el vale sobre tu formato con `BORRADOR` en el folio. **Emitir vale · folio N** asigna el folio y descuenta la existencia.
   7. **Imprimir** abre el diálogo de impresión de Edge: elige la impresora o *Guardar como PDF*. Tamaño carta, vertical.
   - Puedes tener **varios vales abiertos** (pestañas con el número de partidas); se guardan solos y no gastan folio hasta que los emites. *Descartar borrador* los elimina sin dejar hueco en los folios; si fue por error, pulsa **↶ Deshacer** en el aviso.
   - Si el vale tiene más partidas que el formato (21, 20 o 19 según la hoja), se ofrece dividirlo en folios consecutivos.
   - ¿Prefieres buscar por cualquier dato y que se llene la partida completa? Actívalo en *Ajustes → Captura de partidas*.
   - ¿Quieres otro acomodo? En *Ajustes → Mi pantalla de vales* arrastra los bloques (nombres, fecha, etapa…) por sus
     puntitos ⠿ o muévelos con ↑ ↓, y con **⇄ Cambiar de lado** pon las partidas a la izquierda y los datos a la
     derecha. Se guarda al momento para el almacenista en turno: cada quien ve su propio acomodo. *Restablecer como venía*
     regresa al de fábrica.
3. **Corregir:** *Historial* → clic en el folio → **Corregir**. Cambia lo necesario (partidas, personas, fotos…); el **motivo se llena solo** con lo que cambió y puedes agregar el porqué. Todo queda en la **bitácora** del vale. Los folios **no se cancelan**: todos se usan.
   - **NOV:** llena las 4 firmas (químico y personal de NOV a la izquierda; tú y patrimonial a la derecha) y agrega hasta 3 fotos con **＋ Foto** en la sección *Fotos*, debajo de las partidas (se acomodan como en tu formato y se imprimen ahí). El siguiente vale NOV ya trae las mismas personas y la partida de diésel.
   - **Transferencias:** Autorizó lleva nombre y puesto; primero se sugieren RIG MANAGER e ITP.
4. **Pendientes:** si la insignia naranja muestra un número, abre *Pendientes*. En cada renglón elige de qué contenedor salió; la opción más parecida aparece primero (★ = la clave coincide). Si no es un artículo del inventario, elige *No inventariado*.
5. **Reporte diario y SharePoint:** en *Reporte diario* (menú de la izquierda o *Inicio → Crear reporte diario*) elige el día y descarga los dos archivos **como estaban al cierre de ese día**: el **libro de vales de salida** (hasta el último folio de ese día) y el **inventario de refaccionamiento** (con esa fecha en el nombre; sin los vales, entradas, conteos ni movimientos posteriores). Pulsa **Descargar** en cada uno: se abre el explorador para elegir carpeta y nombre, y después la tarjeta muestra *✓ Descargado*. Si no se puede escribir ahí (p. ej. el archivo está abierto en Excel u OneDrive lo está sincronizando), se reintenta y, si sigue sin poder, el Excel se descarga a *Descargas* y el aviso dice por qué. El encabezado de página del inventario lleva la fecha de ese día. Con ▶ avanzas al siguiente día con vales y, después del último, a hoy. Súbelos al SharePoint y pulsa **✓ Ya lo subí**: marca solo los vales hasta ese folio. *Subir al SharePoint* (en Inicio y en *Exportar y enviar*) te dice qué vales son nuevos o corregidos desde la última vez.
6. **Si se hicieron vales en el Excel** (por ejemplo, mientras se probaba la herramienta): *Exportar y enviar → Traer vales hechos en el Excel* agrega los folios posteriores al último que conoce la herramienta. Así no quedan huecos: la herramienta no permite saltar folios.

**Inventario del día.** Igual que el Excel: *Cantidad* es lo que había al empezar el día, *Consumo* e *Ingreso* solo los
vales de hoy y *Total* lo que hay. Al día siguiente lo de hoy pasa a la cantidad y consumo / ingreso quedan limpios. El
inventario exportado y el del reporte diario usan la fecha del archivo.

### Entradas, conteos y movimientos
- **Entrada de material** (*Vales de entrada → Nueva entrada*): elige **Captura manual** o **Desde foto o PDF**.
  Arriba quedan siempre a la vista el folio, los pendientes y los botones **Registrar entrada** y **Descartar**.
  Escribe el folio del vale, de dónde viene y quién lo entrega; el departamento siempre es ALMACEN. Por partida:
  código → `Enter` → clave (★ = el contenedor donde hay más) → **NP** → cantidad. Si la clave trae el NP (`… NP: 123`),
  se pasa solo a su campo. Arriba, los botones *⚠ pendientes*, *por revisar* y *con clave nueva* muestran solo esas
  partidas. Abajo de cada partida: **Entra a** (cambia
  el contenedor; muestra *hay → queda*), **Solicita** (quien pidió el material; va en LOTE) y la O.C. Si escribes una
  clave que no existe, se da de alta como **variante nueva** con esa dimensión (te avisa si se parece a una que ya
  existe). *Sin existencia* (en *Entra a*) es para diésel y gases.
- **Capturar desde la foto con Copilot:** en *Desde foto o PDF* (o con el botón **Copilot** de la barra; en el conteo,
  *✨ Capturar desde la foto o PDF*): **Copiar instrucciones**, pégalas en Copilot (Microsoft 365, cuenta de trabajo)
  con la foto o el PDF, copia su respuesta y pulsa **Pegar** en el paso 3 (o `Ctrl+V` en el cuadro): se carga sola. Si viene cortada o con errores de
  formato, se arregla sola y te dice qué corrigió. Lo dudoso queda en amarillo (*revisar* → *✓ ya la revisé*). La
  herramienta no se conecta a nada: solo lee el texto que pegas.
- **Material que regresa:** *↩ Copiar partidas de un vale de salida* (debajo de las partidas) → folio → *Copiar
  partidas*; cada partida vuelve al renglón del que salió y ajustas las cantidades.
- **Conteo físico:** elige todo o algunos contenedores, imprime la hoja de conteo (sin cantidades), *Empezar a
  capturar*, anota lo contado y lo encontrado, y **Aplicar conteo**. Lo que no captures conserva su conteo anterior.
- **Mover material de contenedor:** *Inventario* → botón *Mover* de la partida → cantidad y destino. El total no cambia.
- **Corregir dimensión o NP:** *Inventario* → botón *Editar* de la partida. Sugiere la dimensión como la escribe AX (Tamaño +
  Color: juntos son la dimensión; AX no trae NP) y cómo está en otras partidas; puedes aplicarlo solo a esa partida o a todas las de su variante. Las
  cantidades no cambian y el aviso trae *Deshacer*.
- **Atajo:** en vales de salida y de entrada, **Alt + N** agrega una partida (debajo de la que estás escribiendo).
- **Historial de entradas:** *Historial de vales → Vales de entrada*. Se exporta en *Exportar y enviar → Vales de entrada*.

### Conciliación contra AX
Es como conciliar el banco: AX es el estado de cuenta, el inventario tu chequera y los vales posteriores al corte, los
cheques en tránsito.
1. *Conciliación AX* → **Importar reporte de AX** → elige el `DELTA RIG 91 <fecha>.xlsx` (completo o filtrado). Revisa el
   almacén y la fecha del corte (sale del nombre). Si sabes hasta qué folio capturó la base, escríbelo. **Importar corte**.
   Solo se comparan las partidas con *Modelo de Inventario* **INV**.
2. La pantalla tiene dos zonas: al centro, los bloques **para actuar** (*Enviar a la base*, *Por resolver*, *Diferencias
   contra AX*, *Reporte AX* y *Consumos de la base*); a la derecha, el **Resumen**, que solo informa (emparejadas,
   cuadran, explicadas, faltantes, sobrantes, solo en AX, solo en el físico, valuada…) y al pulsar una cifra abre su
   detalle. Cada bloque se abre en una ventana con buscador.
3. **Por resolver → Emparejar con AX:** las partidas que AX escribe distinto (errores de dedo, dimensiones cortadas…),
   con pestañas para lo que solo está en el físico y lo que solo está en AX. Si AX no trae dimensión (Tamaño y Color
   vacíos), la partida se compara sola contra **todas** las variantes sin dimensión del código (S/D, SIN DIMENSIÓN,
   S/N…), o contra el código completo si es su única partida en AX: no hay nada que confirmar. *Corregir a como
   está en AX* **cambia la dimensión / NP de tu inventario** a como lo escribe AX (todas sus partidas; las cantidades no
   cambian); *Ajustar…* para escribirla tú (si AX cortó el Tamaño a 10 caracteres, escríbela completa), *Otra…* para
   elegir otra variante o *No está en el físico* (solo para ese corte). Solo se ofrecen las partidas del inventario
   que aún no son pareja de otra partida de AX: una misma no puede asignarse a dos. La próxima vez empareja sola. El aviso trae
   *Deshacer*; con *Corregir las seguras* van todas las de puntaje alto de una vez.
4. **Diferencias:** cada partida dice si *Cuadra*, si la diferencia la explican los vales en tránsito (con sus folios) o
   si *Sobran* / *Faltan* sin explicar. En la ventana cambias de vista (por artículo, por contenedor para ir a revisar,
   valuada en pesos) y de filtro sin cerrarla. **Reporte AX** abre el kardex completo (también lo *por confirmar*, con
   *Confirmar…*, y lo que no está en el físico) para buscar cualquier código o descripción.
5. **Por resolver → Justificar faltantes:** a cada faltante le asignas los vales que ya salieron y que AX aún no
   descuenta (sin IN / TR), aunque sean de antes del reporte de AX. Se **sugieren** los que coinciden en código,
   dimensión y cantidad (la combinación que cubre el faltante exacto, o lo más cerca sin pasarse): los apruebas uno por
   uno o con *Asignar las N sugerencias*. *Elegir vales…* muestra todos los del código con su estado (sin IN / TR,
   justifica otra, ya en AX, por ubicar) para asignarlos a mano; cada asignación tiene *Deshacer* y *Quitar*. Lo
   asignado cuenta para ese faltante (folio `466 (S, asignado)`) y sale en la hoja *VALES POR APLICAR*.
6. **Enviar a la base → Descargar solicitud:** un Excel con tres hojas: **LEYENDA** (qué significa cada color, (S) =
   salida, (E) = entrada con el folio del vale de la base, y las marcas de los folios), la hoja del **reporte de AX**
   igual que siempre más *Existencia física*, *Folios que justifican* y *Estado* (fila coloreada: verde cuadra, azul
   explicada, amarillo sobrante, rojo faltante, gris por confirmar) y **VALES POR APLICAR** (las partidas que justifican
   diferencias y que la base aún no aplica, para que las registre como consumo o transferencia).
Las cantidades del inventario no cambian: si algo está mal en el físico, se corrige con un conteo o una corrección de vale.

**Consumos de la base (qué ya está en AX).** Siguiendo con el banco: el archivo de vales que lleva la base es como la
lista de cheques que el banco ya cobró. *Importar consumos de la base* → elige el `VALES DE SALIDA DELTA RIG91.xlsm` que
te manda la base (no pide fecha: solo importa qué partidas tienen folio de AX; uno nuevo reemplaza al anterior). Desde ahí:
- Las partidas con folio **IN / TR** ya están en AX (la *CANTIDAD* de la base es lo aplicado; vacía = todo).
- Las que **no tienen IN / TR** (INV sin folio, sin revisar, que la base no tiene o posteriores a su archivo) cuentan como
  tránsito en la conciliación aunque el vale sea anterior al corte (folio `6 (S, sin IN/TR)`); si la base aplicó solo
  una parte, cuenta lo que falta.
- **NO INV, CONPROV, SIN EXISTENCIA** no se descuentan en AX: no justifican diferencias.
- La fecha que importa es la del **reporte de AX**: lo posterior siempre está en tránsito. Pide el archivo de la base con
  todos los vales hasta esa fecha; si le faltan vales que ya aplicó, cuentan como sin IN / TR.
- El bloque *Consumos de la base* muestra cuántas partidas no tienen IN / TR y abre los **avisos de diferencias** (la base
  anotó otra clave u otra cantidad, una partida que el vale no tiene o le falta una del vale).
- En el **Historial** aparece la columna *AX* y el filtro **Revisar** (sin IN / TR, ya en AX, no se descuentan, con
  aviso, **duplicadas en el vale**). En el detalle de un vale, la columna *AX (base)*.
- **Partidas duplicadas:** si el formulario de Excel guardó un vale dos veces, sus partidas repetidas se marcan
  *duplicada de la N*; *Quitar duplicadas…* abre la corrección sin ellas y con el motivo escrito.

### Áreas y personas
- **Áreas:** cada una equivale a una hoja-formulario del libro de vales. *Editar* cambia el **tipo** (interna, externa o transferencia), los datos que se copian al vale y el **formato de impresión** (qué hoja se usa para imprimir).
- **Personas:** marca quién es almacenista (aparece en "En turno"), corrige puestos y desactiva a quien ya no está (deja de sugerirse, pero su historial queda).
- **Nombres repetidos:** si una persona aparece escrita de varias formas (p. ej. `FULANO MENGANO ZUTANO`, `MENGANO ZUTANO FULANO`, `F. MENGANA ZUTANO`), la tarjeta *Nombres repetidos* lo propone: elige el nombre que se queda y pulsa **Unificar** (los otros quedan como "también:" de esa persona). También puedes marcar personas en la columna *Unir* y pulsar **Unificar…**. **Los vales ya hechos no cambian**; el aviso trae *Deshacer*. Si no son la misma, *No son la misma persona* y ya no se vuelve a sugerir.

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
