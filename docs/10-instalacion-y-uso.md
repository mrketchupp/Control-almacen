# 10 — Cómo abrirla y usarla (versión web)

## Qué incluye

| Módulo | Qué puedes hacer |
|---|---|
| Inicio | Accesos grandes: **Crear un vale**, **Agregar material recibido**, **Crear reporte diario** y **Conteo físico**; *Subir al SharePoint* con botón **Ya lo subí**, último conteo, **etapa de perforación** (se cambia ahí mismo) y uso diario |
| **Reporte diario** | En el menú, después de *Conteo físico*. **Descarga** el **libro de vales** y el **inventario** como estaban **al cierre del día elegido**; muestra los vales y entradas de ese día y lo que falta subir al SharePoint hasta ese folio |
| Primera carga | Importar tu inventario y tu libro de vales actuales, con ensayo previo y reporte de verificación |
| Lista de revisión | Generar la lista de renglones dudosos del DIARIO, contestarla en Excel y aplicar tus respuestas |
| **Vales de entrada** | Registrar el material que llega de la base o de otro equipo, **a mano o desde la foto/PDF con Copilot**: contenedor sugerido, variante nueva, *hay → queda* por partida, quién solicita (LOTE), folio interno `E-0001` |
| **conciliación con Dynamics AX** | Importar el reporte de inventario de AX (solo modelo INV), confirmar las parejas que se escriben distinto (corrige la dimensión / NP del inventario), ver diferencias por partida, artículo, contenedor y en pesos con los **vales en tránsito** que las explican, y descargar la **solicitud de ajuste** con colores por estado. Con el **archivo de vales de la base** sabe qué partidas ya están en AX (IN / TR) y cuáles siguen pendientes |
| **Etiquetas** | Etiquetas de material o de código AX (lo que hacía el generador de etiquetas): de un **vale de entrada** (se sugiere al registrarla), del **inventario**, a mano o desde la lista `.json` del generador; plantillas como la precortada J-5163; logos del vale por inventario; las entradas quedan marcadas *Etiquetas impresas* |
| **Conteo físico** | Conteo total o por contenedor: hoja de conteo para imprimir (renglones altos para escribir), captura (también desde la foto con Copilot), diferencias y material encontrado |
| **Vales de salida** | Hacer vales en pestañas (borradores): datos a la izquierda, partidas al centro como en el vale impreso, folio automático e impresión |
| Historial de vales | Consultar el DIARIO con **filtros combinables** (código, área, quién recibió, estado, fechas y texto); abrir cualquier folio para imprimirlo o **corregirlo** (el motivo se llena solo con los cambios) |
| Inventario | Consultar existencias por contenedor, con búsqueda y filtros |
| Pendientes | Indicar de qué renglón del inventario salió cada vale posterior al conteo |
| Exportar y enviar | Generar `VALES DE SALIDA <inventario>.xlsm` e `INVENTARIO…xlsx` idénticos a los actuales, ver qué falta **subir al SharePoint** y traer vales hechos en el Excel |
| **Áreas y personas** | Las tres plantillas del vale (Consumo interno, NOV, Transferencia), las áreas y los destinos, y las personas (almacenistas, puestos) |
| **Ajustes** | **Personalización** (tema, avisos, animaciones), **NP en el lote**, **vale impreso** del inventario (textos y logos del formato), carpetas del reporte y etapa de perforación actual |
| **Inventarios independientes** | Selector en la cabecera: cada inventario con sus datos por separado (vales, folios, inventario, respaldos, conciliación) |
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

**Dos inventarios:** arriba, junto al nombre, eliges **Inventario A** (azul) o **Inventario B** (morado). Cada uno tiene sus datos por
separado; la primera vez Inventario B está vacío y se hace su *Primera carga* con los archivos de Inventario B. Al abrir, entra al último
que usaste. Si el libro de vales de Inventario B trae los textos o el logo de Inventario A, se corrigen en *Ajustes → Vale impreso de Inventario B*
(valen para todas las hojas). En Inventario B toda la interfaz va en morado. La **etapa de perforación**, la **personalización**
(tema, avisos, animaciones) y **NP en el lote** son las mismas en los dos: si cambias algo en uno, el otro lo toma al
abrirlo.

## 2. Carpeta de respaldos (una sola vez)

1. En **Inicio** o **Respaldos**, pulsa **Elegir carpeta** y selecciona (o crea) `OneDrive\ControlAlmacen`.
2. Edge pregunta si permites que la página vea y edite esa carpeta: **Permitir**.
3. Ahí se crean `respaldos\`, `exportaciones\AAAA-MM-DD\` y `revision\`.

En cada sesión nueva Edge vuelve a pedir el permiso: aparece un aviso amarillo arriba con el botón **Permitir** (un clic).

Cada inventario elige su carpeta. Puede ser la misma (los respaldos de Inventario B se llaman `almacen_<inventario>_…` y no se mezclan),
pero para tenerlo ordenado conviene una para cada uno, por ejemplo `OneDrive\ControlAlmacen\Inventario B`.

| Qué | Dónde queda |
|---|---|
| Datos de trabajo | Almacenamiento local de Edge (IndexedDB) de este equipo y esta cuenta de Windows |
| Respaldos | `OneDrive\ControlAlmacen\respaldos\` |
| Excel exportados | La carpeta que elijas al exportar (sin esa ventana, `OneDrive\ControlAlmacen\exportaciones\AAAA-MM-DD\`) |
| Reporte diario con carpetas fijadas | El inventario en `<carpeta base>\<ruta del inventario>\<año>\<mes>\`; el libro de vales, en el archivo que fijaste (ver §2.1) |

### 2.1 Carpetas del reporte diario (opcional, una sola vez)

Para no elegir carpeta y nombre en cada *Descargar* del **Reporte diario**: *Reporte diario → Carpetas…* (o *Ajustes → Carpetas
del reporte diario*). Es lo mismo en los dos inventarios y se queda en este equipo (no va en los respaldos).

1. **Carpeta base de los inventarios:** **Elegir carpeta…** y selecciona la que tiene adentro las carpetas de cada inventario
   (por ejemplo `Escritorio\<equipo>\INVENTARIO DIARIO`). Edge **no deja elegir el Escritorio ni todo OneDrive**: elige una
   carpeta dentro. La herramienta busca adentro las de cada inventario y de FX y propone su ruta, por ejemplo
   `<inventario>/01. INVENTARIOS/{año}/{mes}` o `FX/{año}/{mes}`. Revísalas: debajo de cada una dice cómo queda para el día del
   reporte y si cada carpeta existe (✓) o se creará. Se pueden escribir (con `/` o `\`) o elegir con **Explorar…**.
   Variables: `{año}` (2026), `{mes}` (11. NOVIEMBRE), `{mm}` (11) y `{nombre_mes}` (NOVIEMBRE). Las carpetas se reconocen
   aunque estén escritas un poco distinto (`05.MAYO` = `05. MAYO`). Vacía = esa sigue abriendo «Guardar como».
2. **Libros de vales de salida:** **Elegir archivo…** y selecciona el libro de vales de cada inventario que ya tienes
   (normalmente en el Escritorio). *Descargar* lo **reemplaza**.
3. **Si al elegir no pasa nada** (Edge a veces no entrega lo elegido en carpetas de OneDrive): la ventana lo dice arriba.
   **Arrastra** la carpeta base desde el Explorador de Windows al recuadro punteado; la carpeta de cada inventario, a su
   fila; y el libro de vales, a la suya. Hace lo mismo que elegirlo.
4. **Registro de lo que pasó** (abajo en la ventana): anota qué pidió la herramienta y qué respondió Edge al elegir,
   arrastrar, pedir permiso y guardar. Si algo falla, **Copiar registro** (o **Descargar .txt**) y pégalo en la
   conversación de soporte. Se queda solo en este equipo y no lleva rutas completas ni datos del inventario.

Al pulsar *Descargar* (nunca solo): la primera vez de cada sesión Edge pregunta si la página puede editar esa carpeta o ese
archivo (**Editar archivos** / **Permitir**). El inventario va a la carpeta del **año y mes del día del reporte** (también si es un
día anterior); si la carpeta del mes o del año aún no existe se crea, pero una carpeta fija que no exista (mal escrita, movida)
no se inventa: el aviso dice cuál falta y cuáles hay parecidas, con **Guardar como…**. Si el archivo del día ya está ahí,
pregunta antes de reemplazarlo. Si el libro de vales del día deja fuera vales posteriores, también pregunta. Debajo de cada
tarjeta, **Guardar como…** guarda esa vez en otro lugar. Si Excel lo tiene abierto, pasa lo mismo que con «Guardar como»: queda
en *Descargas* y **Ya lo cerré: guardar otra vez** lo vuelve a intentar en su lugar.

## 3. Primera carga (la herramienta llega vacía)

Al abrirla vacía, *Inicio* ofrece dos caminos: **Empezar desde cero** o **Seguir desde un respaldo**. Los dos piden
primero la **carpeta de trabajo** (*Elegir carpeta* o arrastrarla desde el Explorador): ahí quedan los respaldos y los
Excel exportados. Desde un respaldo, se restaura el más reciente de esa carpeta o un `.zip` de cualquier lugar. Desde
cero, **Continuar** lleva a la primera carga, que va **un paso a la vez** (*1. Archivos*, *2. Conteo base*, *3. Revisar
y cargar*) con **← Regresar** y **Continuar →** abajo. Mientras está vacía, el menú solo lleva a *Inicio*.

1. **Tus archivos:** elige el inventario (`.xlsx`) y el libro de vales (`.xlsm`). Al tener los dos pasa sola al conteo base.
2. **Lista de revisión (opcional, en el paso 3):**
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
4. **Ensayo** (se hace solo al llegar a *Revisar y cargar*): hace la carga en memoria y muestra el reporte: totales por hoja (archivo contra calculado), diferencias por renglón (por ejemplo, el vale 550 que tu Excel aún no descontaba), renglones por ubicar, omitidos y correcciones. **No guarda nada.**
5. **Cargar definitivamente:** guarda todo en el equipo, registra tus archivos como **plantillas** y crea el primer respaldo.

## 4. Uso diario

1. **Elige quién está en turno** arriba a la derecha. Queda registrado en cada acción y se pone como "Entregó" en los vales.
   Puedes **Contraer menú** (solo íconos) y volver a **Expandir menú** con el botón de arriba del menú o con
   **Ctrl + B**; se recuerda en este navegador. En ventanas de menos de 1280 px el menú va siempre de íconos y, al
   expandirlo, se abre encima del contenido (Esc o un clic fuera lo cierran). Ya no hay barra abajo: el menú de íconos
   se queda en cualquier ancho. Lo pendiente se ve como un punto ámbar sobre el ícono. Nunca se abre ni se cierra solo.
2. **Hacer un vale** (*Vales de salida* o el botón grande de *Inicio*). Va en **3 pasos**; arriba se ve en cuál vas
   (*Para quién · Material · Revisar y emitir*) y con **Enter** continúas:
   1. **Para quién:** *Consumo interno* o *Transferencia*. Elige el **área** (también con las teclas 1…0) o el
      **destino**, y **quién recibe**: ya viene quien recibió en el último vale de esa área (si cambias a otra persona, el
      siguiente vale ya la sugiere); escribe el nombre o el puesto, o elígelo de «Suelen recibir en…»; su puesto se llena
      solo. En transferencias van también quién transporta y quién autoriza, y las observaciones dicen «PARA USO EN» el
      destino elegido; en NOV, sus firmas extra. Lo automático (entrega, sale de, llega a, observaciones con la **etapa de
      perforación**) se llena solo.
   2. **Material:** escribe el **código o la descripción** (505, «filtro») y, si quieres, la **dimensión o el NP** en el
      segundo campo; los resultados salen en una tarjeta por código con su contenedor y su existencia. **＋**, doble clic o
      **Enter** agregan (Shift+Enter va directo a la cantidad) y **Tab** pasa de una cantidad a la siguiente; abajo se ven
      las teclas. Si la dimensión que escribiste no está en ese código, al final de su tarjeta sale **Usar «…» en <código>**
      tal como la escribiste: la partida va igual pero **no descuenta** (igual con un código que no está en el catálogo).
      A la derecha está la lista del vale; con **Editar** cambias la clave, el lote, la O.C. o la UM de una partida.
      *Traer partidas* copia las de una entrada de hoy o de otro vale.
   3. **Revisar y emitir:** el resumen de *Para quién* y del material (Cantidad · Código y descripción · Dimensión, con
      *Lote:* y *O.C.:* a su lado). Lo que falta se marca **en ámbar en su fila**, con su botón (*Ir a la partida*,
      *Corregir*) o, si sacas más de lo que hay, el campo para la justificación ahí mismo. Al lado, la **vista previa**
      real del vale con `BORRADOR` en el folio (ampliable con zoom). **Emitir vale · folio N** se habilita cuando no falta
      nada: asigna el folio y descuenta la existencia.
   4. **Imprimir** abre el diálogo de impresión de Edge: elige la impresora o *Guardar como PDF*. Tamaño carta, vertical.
   - Puedes tener **varios vales abiertos** (pestañas con el número de partidas); se guardan solos y no gastan folio hasta que los emites. *Descartar borrador* los elimina sin dejar hueco en los folios; si fue por error, pulsa **↶ Deshacer** en el aviso.
   - Si el vale tiene más partidas que el formato (21 en todas las áreas; 4 en NOV, por las fotos), se ofrece dividirlo en folios consecutivos.
   - El vale impreso tiene **el mismo formato en todas las áreas**: fecha y folio con línea sencilla, partidas en Arial 9 centradas y con todas sus líneas, 21 partidas, *PRESENTACIÓN* completa y el título *OBSERVACIÓN*. Tu libro de vales no cambia. NOV y TRANSFERENCIAS conservan su propio formato.
3. **Corregir:** *Historial* → clic en el folio → **Corregir**. Cambia lo necesario (partidas, personas, fotos…); el **motivo se llena solo** con lo que cambió y puedes agregar el porqué. Todo queda en la **bitácora** del vale. Los folios **no se cancelan**: todos se usan.
   - En vales antiguos o importados también puedes completar o modificar **Puesto de quien entrega**, además de los
     demás puestos. Se respeta el papel de cada persona en los formatos con firmas invertidas. Un cambio de puesto
     conserva los materiales y queda registrado; si lo dejas vacío, la impresión respeta ese vacío.
   - Al volver del detalle, el historial conserva sus filtros, pestaña, cantidad de filas desplegadas y posición de
     lectura. Salidas y entradas recuerdan su propia vista, separada para cada inventario. **Quitar filtros** limpia
     la búsqueda y regresa al inicio de la lista.
   - **Imprimir varios vales:** *Historial de vales → Vales de salida → Imprimir por lotes*. Pega tu lista de folios
     (por ejemplo, una columna de Excel o 88 folios separados por saltos de línea, espacios, comas o punto y coma).
     Revisa el conteo y pulsa **Imprimir**: se abre un solo diálogo de impresión o PDF, con una hoja por vale en el
     orden pegado. Los repetidos se imprimen una sola vez. Si hay folios inválidos o que no existen en el inventario
     abierto, corrige la lista antes de imprimir. Los filtros del historial no limitan la búsqueda del lote.
   - **NOV:** llena las 4 firmas (químico y personal de NOV a la izquierda; tú y patrimonial a la derecha) y agrega hasta 3 fotos con **＋ Foto** en la sección *Fotos*, debajo de las partidas (se acomodan como en tu formato y se imprimen ahí). El siguiente vale NOV ya trae las mismas personas y la partida de diésel.
   - **Transferencias:** Autorizó lleva nombre y puesto; primero se sugieren RESPONSABLE e ITP.
   - **Corregir datos generales por lotes:** en *Historial de vales*, elige **Vales de salida** o **Vales de entrada** y pulsa **Corregir por lotes**. Pega los folios (entradas: folio interno como `E-0001` o `1`), marca sólo los campos a cambiar y escribe el nuevo valor común. Pulsa **Revisar corrección**, comprueba el antes y el después y guarda con un motivo. Los materiales y las partidas se conservan. Un campo opcional marcado y vacío queda vacío también al imprimir.
   - Las **claves de almacén largas** se imprimen completas en varias líneas y centradas. Las **descripciones largas** también se imprimen completas, en varias líneas y con la alineación del formato de cada hoja (también en los vales migrados del Excel). Se amplía la fila usando el espacio de partidas vacías; si el formato está lleno, se ajusta la escala para conservar una hoja por vale. Lo que cabe en una línea no cambia la fila.
4. **Pendientes:** si la insignia naranja muestra un número, abre *Pendientes*. En cada renglón elige de qué contenedor salió; la opción más parecida aparece primero (★ = la clave coincide). Si no es un artículo del inventario, elige *No inventariado*.
5. **Reporte diario y SharePoint:** en *Reporte diario* (menú de la izquierda o *Inicio → Crear reporte diario*) elige el día y descarga los dos archivos **como estaban al cierre de ese día**: el **libro de vales de salida** (hasta el último folio de ese día) y el **inventario de refaccionamiento** (con esa fecha en el nombre; sin los vales, entradas, conteos ni movimientos posteriores; las entradas cuentan el día en que se **recibieron**). Pulsa **Descargar** en cada uno: con sus carpetas fijadas (§2.1) cada uno va directo a la suya (la tarjeta dice cuál); si no, se abre el explorador para elegir carpeta y nombre. Después la tarjeta muestra *✓ Guardado*. **Si vas a reemplazar un archivo, ciérralo antes en Excel**: Windows no deja reemplazar un archivo abierto (tampoco mientras OneDrive lo sincroniza). Si no se puede, el Excel no se pierde: se descarga en *Descargas*, la tarjeta se pone en ámbar con *No quedó donde elegiste* y se abre al centro una ventana con dibujos: la barra de tareas con Excel abierto (ciérralo) y el explorador con la carpeta donde quedó; **Cerrar aviso** la cierra y **Ya lo cerré: guardar otra vez** vuelve a abrir «Guardar como». Si OneDrive está subiendo archivos, Edge a veces no logra guardar ahí: la ventana muestra la nube de OneDrive y conviene esperar a que termine. Si «Guardar como» se cierra sin guardar, sale el aviso *No se guardó…* con **Guardar en Descargas**. Al exportar, la herramienta hace un respaldo en su carpeta como mucho cada 4 horas (cada respaldo sube varios MB a OneDrive). El encabezado de página del inventario lleva la fecha de ese día. Con ◀ ▶ vas un día atrás o adelante (hasta hoy), aunque ese día no tenga vales. Súbelos al SharePoint y pulsa **✓ Ya lo subí**: marca solo los vales hasta ese folio. *Subir al SharePoint* (en Inicio y en *Exportar y enviar*) te dice qué vales son nuevos o corregidos desde la última vez.
   En Inventario B y Inventario A, el libro de salida se genera con las filas visibles y la tabla y los filtros extendidos hasta el
   último folio del corte. Los filtros antiguos de la plantilla no ocultan los vales nuevos. Si actualizas la aplicación,
   vuelve a descargar el libro para obtener esta corrección; el Excel descargado anteriormente conserva su vista anterior.
6. **Si se hicieron vales en el Excel** (por ejemplo, mientras se probaba la herramienta): *Exportar y enviar → Traer vales hechos en el Excel* agrega los folios posteriores al último que conoce la herramienta. Así no quedan huecos: la herramienta no permite saltar folios.

**Inventario del día.** Igual que el Excel: *Cantidad* es lo que había al empezar el día, *Consumo* e *Ingreso* solo los
vales de hoy y *Total* lo que hay. Al día siguiente lo de hoy pasa a la cantidad y consumo / ingreso quedan limpios. El
inventario exportado y el del reporte diario usan la fecha del archivo.

### Entradas, conteos y movimientos
- **Entrada de material** (*Vales de entrada → Nueva entrada*): elige **Captura manual** o **Desde foto o PDF**.
  Arriba quedan siempre a la vista el folio, los pendientes y los botones **Registrar entrada** y **Descartar**.
  Escribe el folio del vale, de dónde viene, la **fecha del vale** (la del papel) y quién lo entrega; el departamento
  siempre es ALMACEN. **Recibido** es el día en que llegó el material (por omisión, hoy): ese día suma al inventario y
  cuenta en el reporte diario. No puede ser futura; si es anterior a la del vale o hubo un conteo después en esas
  partidas, te avisa (sin bloquear). Se cambia después con *Corregir* (queda en la bitácora). Por partida:
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
- **Crear otra partida en una entrada:** pulsa **Crear material nuevo**, conserva o escribe la dimensión y captura
  el NP que corresponde, o déjalo vacío. La sugerencia existente no se vuelve a seleccionar al salir del campo.
  **Elegir existente** regresa al selector. Dimensión igual con otro NP o sin NP se mantiene separada; si todos los
  datos coinciden se reutiliza esa variante, evitando duplicarla.
- **Conteo físico:** elige todo o algunos contenedores, imprime la hoja de conteo (sin cantidades), *Empezar a
  capturar*, anota lo contado y usa **Añadir partida**, **Corregir dimensión / NP** o **Quitar partida** cuando haga
  falta. Las correcciones permanecen en el borrador y puedes **Deshacer corrección** antes de aplicar. Pulsa
  **Revisar y aplicar conteo**, revisa los cambios y **Confirmar conteo**. Quitar conserva los vales históricos;
  corregir sólo la clave mantiene cantidades y corte. Lo que no captures conserva su conteo anterior.
- **Mover material de contenedor:** *Inventario* → botón *Mover* de la partida → cantidad y destino. El total no cambia.
- **Corregir dimensión o NP:** *Inventario* → botón *Editar* de la partida. Sugiere la dimensión como la escribe AX (Tamaño +
  Color: juntos son la dimensión; AX no trae NP) y cómo está en otras partidas; puedes aplicarlo solo a esa partida o a todas las de su variante. Las
  cantidades no cambian y el aviso trae *Deshacer*.
- **Corregir la descripción de un código:** el **lápiz ✎** junto a la descripción (en *Inventario*, en las partidas de los vales de
  salida y de entrada —también al corregir un vale del historial— y en lo encontrado durante un conteo) abre una ventana con la
  descripción del catálogo; en el inventario también está en el menú del clic derecho. Escribe la nueva (se guarda en mayúsculas;
  `Enter` guarda y `Esc` cancela) y, si quieres, el motivo. Es la descripción **del código**: la toman el inventario, los vales y
  entradas nuevos, las etiquetas nuevas y el Excel del inventario (hoja oculta `ARTICULOS_MX`). Las partidas de los borradores
  abiertos que seguían la anterior pasan a la nueva. **Los vales ya emitidos no cambian**: al corregir uno del historial, sus partidas
  de ese código toman la nueva descripción y queda en el motivo y la bitácora (*descripción A → B*) cuando guardas la corrección.
  Cada cambio queda en la bitácora con quién, cuándo y el texto anterior (la ventana lista los últimos).
- **Atajo:** en vales de salida y de entrada, **Alt + N** agrega una partida (debajo de la que estás escribiendo).
- **Historial de entradas:** *Historial de vales → Vales de entrada*, con las columnas *Fecha del vale* y *Recibido*; los
  filtros *Recibido desde / hasta* van por la de recibido. Se exporta en *Exportar y enviar → Vales de entrada* (FECHA = la
  del vale; al final, FECHA RECIBIDO).

### Etiquetas
- **Al registrar una entrada** aparece *¿Le hacemos sus etiquetas?* → **Hacer etiquetas**: marca las partidas, ajusta
  cuántas (una por pieza; una sola si es metro, litro, kilo o con decimales) y *🖨 Imprimir ahora* o *Agregar a la lista*.
- **Menú Etiquetas:** elige *Material* o *Código AX* y agrega **de un vale de entrada** (escribe `E-0005` o el folio de la
  base), **del inventario** (busca y marca), **a mano** o la **lista del generador** (el `.json` que exportas en el
  teléfono). Revisa la lista (cantidad, *Editar*, *Duplicar*, ×) y **Vista previa e imprimir**. En el cuadro de impresión:
  escala 100 % y sin *Encabezados y pies de página*. Al terminar contesta **¿Salieron bien?**: así la entrada queda marcada.
- **Hoja y logos** (en la lista): plantilla (estándar 2 × 6, precortada J-5163…), medidas en mm / cm / `4in` y
  borde (quítalo en hojas precortadas). Logos: *Del vale…* toma los del libro de vales del inventario abierto; *Subir…*
  de un archivo. Cada etiqueta lleva los logos de su **inventario** (Inventario A o Inventario B, se cambia por etiqueta).
- **Editor de diseños** (en la lista; Ronda 22): qué lleva cada etiqueta y dónde, a pantalla completa. Duplica uno de
  fábrica, arrastra y cambia el tamaño de cada elemento (cuadrícula, imán y guías), agrega texto libre con `{codigo}`…,
  código QR o código de barras, guarda (Ctrl+S) y elige *Usar para Material* / *Usar para Código AX* (para Inventario A y Inventario B).
  En la tarjeta, *Diseño: …* cambia el de la lista sin abrir el editor.
- *Historial de vales → Vales de entrada* tiene la columna y el filtro **Etiquetas** (sin imprimir / impresas).
- **Inventario A y Inventario B juntos:** la lista por imprimir es la misma en los dos. En *Del inventario* y *De un vale de entrada*,
  **Datos de: Inventario A | Inventario B** trae material o entradas del otro sin cambiar de inventario (solo se leen). La marca *Etiquetas
  impresas* aparece en la entrada de su inventario.

### Clic derecho y portapapeles

El clic derecho ofrece las acciones disponibles para el elemento pulsado. Los botones habituales siguen disponibles.

| Dónde | Opciones |
|---|---|
| Diseño guardado, en el editor | Abrir, duplicar, renombrar, usar para Material / Código AX y borrar con Deshacer |
| Elemento de etiqueta o su capa | Propiedades, copiar, cortar, pegar, duplicar, orden, quitar, Deshacer y Rehacer |
| Espacio del lienzo | Pegar, agregar texto / QR / barras, Deshacer, Rehacer y guardar |
| Etiqueta por imprimir | Editar, duplicar, incluir / excluir de esta impresión y quitar con Deshacer |
| Vale del historial | Abrir; corregir e imprimir salidas emitidas; corregir y hacer etiquetas de entradas registradas |
| Encabezado de un vale | Sus acciones disponibles y volver al historial |
| Partida del inventario | Editar dimensión / NP, editar la descripción del código y mover a otro contenedor |

Las opciones cambian con el estado: los diseños de fábrica permiten copiar elementos y duplicar el diseño para
editarlo; los vales cancelados del historial sólo permiten abrirlos. Deshacer / Rehacer aparecen cuando hay cambios
que recuperar. Las correcciones mantienen su revisión y las acciones de quitar conservan su aviso de Deshacer.

En los **campos de texto** y al seleccionar texto se conserva el menú del navegador: copiar, cortar, pegar, deshacer
y rehacer, junto con sus atajos habituales. En una zona sin acciones también aparece el menú normal.
**Mayús + clic derecho** permite abrirlo incluso donde hay acciones de la aplicación.

En el editor, **Ctrl+C / Ctrl+X / Ctrl+V** copian, cortan y pegan elementos cuando el foco está en la etiqueta o en su
lista de capas. Puedes copiarlos entre diseños; al pegar se conserva su contenido y se coloca una copia dentro de la
etiqueta. **Ctrl+Z / Ctrl+Y / Ctrl+Mayús+Z** deshacen y rehacen cambios del diseño cuando no estás escribiendo en un campo.
Si el navegador bloquea el acceso al portapapeles, las acciones del menú conservan la copia de elementos durante esa
sesión de la aplicación.

Con el foco en un elemento, **Mayús+F10** o la tecla de menú abre sus acciones. Las flechas, Inicio y Fin recorren las
opciones, Intro las ejecuta y Escape cierra el menú y devuelve el foco al elemento.

### Conciliación con Dynamics AX
Es como conciliar el banco: AX es el estado de cuenta, el inventario tu chequera y los vales posteriores al corte, los
cheques en tránsito.
1. *conciliación con Dynamics AX* → **Importar reporte de AX** → elige el `REPORTE DE EXISTENCIAS <fecha>.xlsx` (completo o filtrado). Revisa el
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
   Cada partida física que cambie también agrega **una etiqueta con los datos corregidos** a *Etiquetas → Material*,
   para reemplazar la del material físico. Aplica a las correcciones individuales, a las seguras y a *Solo en el físico*.
   *Deshacer* retira esas etiquetas nuevas y conserva las que ya estaban en la lista.
4. **Diferencias:** cada partida dice si *Cuadra*, si la diferencia la explican los vales en tránsito (con sus folios) o
   si *Sobran* / *Faltan* sin explicar. En la ventana cambias de vista (por artículo, por contenedor para ir a revisar,
   valuada en pesos) y de filtro sin cerrarla. **Reporte AX** abre el kardex completo (también lo *por confirmar*, con
   *Confirmar…*, y lo que no está en el físico) para buscar cualquier código o descripción.
   Si AX tiene una dimensión y el físico la tiene dividida entre distintos NP, se suman las coincidencias del mismo
   código, dimensión y unidad: **2 + 2 piezas de 150VA contra AX 4 → Cuadra**. Se respetan las partidas de AX que sí
   distinguen Color y ninguna cantidad física se cuenta dos veces.
   En **Elegir del inventario…**, disponible en *Reporte AX*, *Diferencias* y *Justificar faltantes*, selecciona las
   dimensiones / NP que realmente corresponden cuando las escrituras no coinciden. Cada opción muestra sus partidas,
   contenedores y total; las que ya corresponden a otra dimensión de AX o tienen otra unidad quedan inhabilitadas.
   La cabecera muestra **Unidad en AX** y el bloqueo indica ambos valores: **AX … · físico …**. Abreviaturas como
   `EA`, `UND`, `UNIDAD`, `PCS` o `PZA.` se reconocen como piezas, sin cambiar cantidades ni textos originales. Si AX usa
   caja, juego u otra medida, activa **Corregir la unidad del inventario a la de AX** para poder seleccionarla e indica
   la equivalencia: por ejemplo, **1 CJA equivale a 12 PZA**. Si sólo estaba mal anotada la unidad y las cantidades
   están bien, indica **1 = 1**. Cada opción seleccionada tiene su equivalencia; no se adivina el contenido de una caja.
   Pulsa **Revisar vínculo** para ver el total y el resultado con los vales en tránsito, luego **Confirmar vínculo**.
   Se guarda sólo para ese corte y ofrece **Deshacer**. Al volver a abrir puedes **Usar emparejamiento automático**.
   Por defecto conserva dimensiones, NP y etiquetas. Marca **También corregir las claves del inventario a como están
   en AX y preparar etiquetas** si también debes actualizar las etiquetas físicas. La revisión muestra cómo quedará
   cada clave, el total físico después (incluidas posibles uniones), el resultado con tránsito y las etiquetas que
   se agregarán a **Etiquetas → Material**. Pulsa **Confirmar corrección, vínculo y etiquetas**. Conserva cantidades,
   vales y NP, salvo si el NP repite el Color de AX. **Deshacer** revierte esa operación completa.
   Cuando corriges unidades, la revisión muestra también cantidad y UM antes → después, y se convierten las
   existencias y movimientos al calcular. Los vales anteriores mantienen su captura original; los nuevos usan la UM
   corregida. **Deshacer** se protege si después registras o editas un vale de una partida convertida.
   Las correcciones quedan guardadas en inventario, también en el respaldo. Al importar futuros reportes con las
   mismas dimensiones y unidades de AX, esas partidas se reconocen automáticamente sin repetir el vínculo manual.
   En **Emparejar con AX → Solo en el físico → Corregir dimensión / NP**, elegir una sugerencia **AX del corte…**
   muestra el destino, sus cantidades y el efecto previsto. Pulsa **Revisar corrección → Confirmar corrección y
   etiquetas**. **Elegir varias partidas para este AX…** conecta con la selección de varias partidas del mismo código.
5. **Por resolver → Justificar faltantes:** a cada faltante le asignas los vales que ya salieron y que AX aún no
   descuenta (sin IN / TR), aunque sean de antes del reporte de AX, dentro del periodo admitido.
   En **Aceptar vales desde** se propone el **1 de noviembre del año anterior al reporte AX**: para un reporte de 2026,
   el inicio es `01/11/2025` y los vales de octubre de 2025 o anteriores quedan excluidos. Cambia la fecha y pulsa
   **Guardar límite** si el corte anual se retrasa o tiene prórroga; se guarda para ese corte de AX. Los vales anteriores
   no se sugieren, no se aceptan manualmente y no justifican diferencias ni salen en la solicitud. Si una asignación
   guardada queda fuera, se conserva con el aviso *Fuera del periodo: no justifica*. No cambia el contenido de los vales.
   Se **sugieren** los que coinciden en código,
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
lista de cheques que el banco ya cobró. *Importar consumos de la base* → elige el `VALES DE SALIDA <inventario>.xlsm` que
te manda la base (no pide fecha: solo importa qué partidas tienen folio de AX; uno nuevo reemplaza al anterior). Desde ahí:
- Las partidas con folio **IN / TR** ya están en AX (la *CANTIDAD* de la base es lo aplicado; vacía = todo).
- Las que **no tienen IN / TR** (INV sin folio, sin revisar, que la base no tiene o posteriores a su archivo) cuentan como
  tránsito en la conciliación aunque el vale sea anterior al corte, si alcanza la fecha de *Aceptar vales desde*
  (folio `6 (S, sin IN/TR)`); si la base aplicó solo
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
- **Plantillas del vale (Ronda 35):** solo hay tres, **Consumo interno**, **NOV** y **Transferencia**. En cada una
  cambias el **formato impreso** (qué hoja del libro de vales se usa) y las **observaciones**: quedan iguales en todas sus
  áreas (y en cómo se reimprimen sus vales).
- **Áreas y destinos:** una sola lista; cada nombre lleva su plantilla. **＋ Agregar** pide el nombre y la plantilla: con
  Consumo interno o NOV es un área nueva (sale en la cuadrícula *Área* del vale); con Transferencia es un **destino** más
  de «¿A dónde se envía?» (el mismo en DLTA y GSM). *Editar* un área cambia su nombre, el departamento que se imprime y su
  plantilla (solo si aún no tiene vales); lo demás va en *Más opciones*. *Quitar…* borra un área que ningún vale usa (con
  *Deshacer*); si ya tiene vales (también los que vinieron del Excel), la **descarta** (deja de salir al hacer vales, sus
  vales se imprimen igual) y se recupera en *Áreas descartadas*. Quitar un destino no cambia los vales que ya lo usan.
- **Personas:** marca quién es almacenista (aparece en "En turno"), corrige puestos y desactiva a quien ya no está (deja de sugerirse). Al agregar una persona con puesto o editarlo, se muestra cuántos vales existentes cambiarían. **Aceptar** actualiza ese puesto en las firmas de los vales de entrada y salida, incluidos los nombres ya unificados como alias, y registra la corrección en la bitácora. **Cancelar** guarda solamente el catálogo de personas.
- **Nombres repetidos:** si una persona aparece escrita de varias formas (p. ej. `FULANO MENGANO ZUTANO`, `MENGANO ZUTANO FULANO`, `F. MENGANA ZUTANO`), la tarjeta *Nombres repetidos* lo propone: elige el nombre que se queda y pulsa **Unificar** (los otros quedan como "también:" de esa persona). También puedes marcar personas en la columna *Unir* y pulsar **Unificar…**. **Los vales ya hechos no cambian**; el aviso trae *Deshacer*. Si no son la misma, *No son la misma persona* y ya no se vuelve a sugerir.

## 5. Respaldos, cambio de equipo y "empezar de cero"

- Automáticos: uno al primer uso del día (si la carpeta tiene permiso), después de la primera carga y después de cada exportación. Se conservan los últimos 30 días y 12 meses.
- **Respaldar ahora** crea uno en cualquier momento (o lo descarga si no hay carpeta).
- **Cambiar de equipo o de navegador:** abre la herramienta allá, ve a **Respaldos → Restaurar desde un archivo…** y elige el `.zip` más reciente de OneDrive.
- Antes de restaurar se guarda el estado actual (respaldo en la carpeta y copia interna), así que siempre puedes volver atrás.
- **Zona de cuidado → Borrar los datos de <inventario>:** deja vacío el inventario abierto (por ejemplo, después de una prueba); el otro no cambia. Antes crea un respaldo.
- Un respaldo se restaura estando en su inventario: uno de Inventario A no entra en Inventario B (la herramienta dice a cuál cambiarse).

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
