# 11 — Etiquetas de almacén (Ronda 20)

El **generador de etiquetas** (repositorio `generador-etiquetas-almacen`, PWA en GitHub Pages) se integró en la
herramienta: menú **Etiquetas**. Lo que el generador pedía capturar (código, nombre, dimensión, NP…) aquí ya existe en el
inventario, en los vales de entrada y en el reporte de AX, así que la forma de cargar datos se replanteó a partir de eso.
El generador **sigue vivo** para el teléfono (captura y foto del vale con Gemini); su lista exportada (`.json`) se importa
aquí.

## Decisiones del usuario (Ronda 20)

| Tema | Decisión |
|---|---|
| Generador aparte | Se queda (teléfono, Gemini). Control de Almacén **importa su lista `.json`**. No se cambia el generador. |
| Cuántas etiquetas | **Entrada = una por pieza** (como con la foto del vale); **inventario = una por partida** (la etiqueta del lugar). Unidades continuas (M, MTS, LTS, KG, GAL…) o cantidades con decimales → **1**. Siempre se ajusta antes de imprimir. |
| NOMBRE | El **nombre de AX** (del reporte más reciente importado en *Conciliación AX* que trae el código); si no viene, la **descripción del inventario**. |
| ÁREA | **Vacía** (se escribe a mano si hace falta). Las de la lista del generador conservan la suya. |
| CONDICIÓN | Se **renombra a INVENTARIO** con valores **DLTA / GSM**: se propone el inventario abierto y **se puede cambiar por etiqueta**. La condición de la lista del generador no se usa. |
| Logos | Se **proponen los del libro de vales** del inventario abierto (ya con lo corregido en *Ajustes → Vale impreso*); también se suben de un archivo. Cada inventario tiene los suyos (izquierdo y derecho) y su texto de almacén. |
| Constancia | La lista por imprimir **se conserva** (va en los respaldos) y la **entrada queda marcada** «etiquetas impresas» (fecha y quién): historial de entradas, detalle de la entrada y su bitácora. |
| DESCRIPCIÓN | Desde una entrada, `OC: <orden de compra>` si la partida trae O.C. (vacía si es `S/OC`); desde el inventario, vacía. |

## Flujos

1. **Al registrar una entrada** la tarjeta *✓ Entrada E-0005 registrada* sugiere **¿Le hacemos sus etiquetas?** con
   cuántas partidas y etiquetas propone. *Hacer etiquetas* abre sus partidas: se marcan las que van (las *sin existencia*,
   como diésel o gases, salen sin marcar), se ajusta cuántas, el tipo (Material / Código AX) y el inventario. *Agregar a la
   lista* o *🖨 Imprimir ahora* (vista previa solo con esas). El mismo botón está en el detalle de la entrada (*Etiquetas…*).
2. **Sección Etiquetas** (menú): dos listas, **Material** y **Código AX** (como las dos pestañas del generador). Se agrega:
   - **De un vale de entrada:** por su folio interno (`E-0005`, `E5` o `5`) o por el folio del vale de la base (también
     una parte de él). Sin escribir nada, salen las más recientes con su estado de etiquetas.
   - **Del inventario:** buscar (código, descripción, dimensión, NP), filtrar por contenedor o *solo con existencia*, y
     marcar partidas (o *todo lo visible*). Una etiqueta por partida.
   - **Desde Conciliación AX:** corregir la dimensión / NP en *Emparejar con AX* agrega automáticamente una etiqueta
     de Material por cada partida física modificada. Incluye *Corregir las seguras* y *Solo en el físico*. Se usan los
     datos después de la corrección; el aviso informa cuántas se agregaron. Deshacer retira solo las recién agregadas.
   - **A mano:** al escribir el código sugiere códigos (por número o por nombre) y llena el nombre (AX o inventario);
     la dimensión y el NP sugieren los del código.
   - **Lista del generador:** el `.json` exportado del teléfono (material y código AX a la vez).
   - **Entradas recientes sin etiquetas:** atajos a las últimas entradas que no tienen etiquetas impresas ni en la lista.
3. **Lista por imprimir:** cantidad editable, *Editar*, *Duplicar*, quitar (con *Deshacer*) y casilla para dejar alguna
   fuera de esta impresión. *Vista previa e imprimir* → hojas exactas → *Imprimir* → **¿Salieron bien?** *Sí, quitarlas de
   la lista* / *Sí, pero dejarlas* / *No, volver a intentar*. Solo al decir *sí* se anota en la bitácora y se marcan las
   entradas.
4. **Hoja y logos** (ventana *Hoja, medidas y logos*; hasta la Ronda 21 se llamaba *Diseño y logos*): plantilla (las del
   generador, incluida la precortada **J-5163 / Avery 5163**), hoja Carta / A4, márgenes, tamaño, separaciones (mm, cm o
   `4in`) y borde. Muestra una etiqueta a tamaño real y la hoja completa. La hoja es **la misma en DLTA y GSM**; logos y
   texto, **por inventario**. Desde la Ronda 22 la letra ya no está aquí: va en el **diseño** (ver abajo).
5. **Diseño de cada lista** (Ronda 22): en la tarjeta *Por imprimir*, *Diseño: …* dice con cuál se imprime la lista y lo
   cambia ahí mismo; *Editor de diseños* abre el editor.

## Del generador a Control de Almacén

| Generador | Aquí | Nota |
|---|---|---|
| Foto del vale con **Gemini** | **De un vale de entrada** | Aquí no hay red (CSP `connect-src 'none'`). La foto ya se captura al registrar la entrada (Copilot) y de ahí salen las etiquetas. En el teléfono, el generador sigue leyendo fotos. |
| Inventario Excel (en memoria) | **Del inventario** | Con el inventario vivo (existencias del día), no con un archivo. |
| Listas de códigos AX (CSV / Excel) | Catálogo de artículos + reporte de AX | No se importan listas: el nombre sale del reporte de AX o del inventario. |
| Condición (NUEVO / USADO NUEVO / RESGUARDO) | **INVENTARIO** (DLTA / GSM) | Lleva el logo derecho de su inventario. |
| Logo derecho por partida (biblioteca, «uno por inventario») | Logos por inventario | La etiqueta toma los de su inventario; no se elige logo por partida. |
| Logos por URL | Solo archivo o los del vale | Sin red; van como `data:` (≤ 300 KB, reducidos a 800 px). |
| Exportar / importar `.json` | Importar `.json` | Formato `etiquetas-almacen` v1: `materials` (cantidad, codigoAx, nombre, dimension, noParte, descripcion, area) y `axItems` (cantidad, codigoAx, nombre). Cada campo se limpia. |
| Deshacer / rehacer (Ctrl+Z) | *Deshacer* en el aviso | Como el resto de la herramienta (agregar, quitar, vaciar, importar). |
| Diseño de plantilla, cuadrícula calculada | Igual (`impresion/etiquetas.js`) | `cuadricula` = `Layout.computeGrid`; mismas plantillas y mismas medidas. |
| Etiqueta Material / Código AX | Igual | Mismos campos y orden; *CONDICION* → *INVENTARIO*. Texto vacío = `N/A`, nombre largo con «…». |

## DLTA y GSM en una sola impresión (Ronda 21)

Comentarios del usuario: la ventana *Del inventario* obligaba a hacer scroll para ver *Cancelar* / *Agregar*, y aunque una
etiqueta podía decir DLTA o GSM, al cambiar de inventario la lista no se conservaba ni se podía traer material del otro.
Decisión: **las dos cosas**.

- **Una sola lista y una sola bitácora** para DLTA y GSM: se agrega en uno, se cambia arriba al otro y la lista sigue ahí;
  se imprime todo junto. La marca *Etiquetas impresas* llega a la entrada de **su** inventario (la de GSM se ve en el
  historial de GSM aunque se haya impreso desde DLTA).
- **Leer el otro sin cambiar:** en *Del inventario* y *De un vale de entrada*, **Datos de: DLTA | GSM**. El otro se lee
  de su base tal como quedó guardado (copia en memoria, migrada); **nunca se escribe en él**. Sus etiquetas llevan su
  inventario (y su logo). *Entradas recientes sin etiquetas* muestra las de los dos.
- **Ventanas sin scroll:** *Del inventario* y *De un vale de entrada* ocupan casi toda la pantalla; la tabla toma lo que
  queda y el pie (*Cancelar*, *Agregar…*, *Imprimir ahora*) siempre está a la vista (verificado en 1366 × 768).

Cómo se sincroniza: la lista y la bitácora entran en lo compartido (`almacen/compartidos.js`, claves
`etiquetas_por_imprimir` e `impresiones_etiquetas`) igual que los ajustes, pero sin auditoría. La lista: gana la del último
cambio según `cambiado_en` (con milisegundos), así un cambio que no alcanzó a llegar a la base común no se pierde; la
bitácora: se juntan las dos por id (nunca se pierde una impresión). Una lista del formato 10 que ya traía etiquetas se
une la primera vez con la del otro (`juntar`).

### Revisión adversarial de la Ronda 21 (corregido)

Una revisión con revisores independientes (sincronización, datos, lectura del otro inventario e interfaz) encontró
y se corrigió:

- **Restaurar un respaldo regresa las secuencias:** una entrada nueva podía reusar el id de otra y heredar su marca
  «etiquetas impresas» o «en la lista». Ahora cada marca guarda también **cuándo se registró la entrada**
  (`emitido_en`) y se busca por `claveDeVale(vale)` = id + huella (`marcaDe`). Las marcas viejas se completan al migrar
  (formatos 11 y 12: cada inventario completa las de sus propias entradas; mientras el otro no se abre, una marca sin
  huella se reconoce solo por el id, y al juntar dos copias de la misma impresión se queda la que trae la huella).
- **Restaurar un respaldo del formato 10 no vuelve a juntar** su lista vieja (sus etiquetas ya se imprimieron o se
  quitaron): al restaurar gana la lista compartida.
- **Ids sin choques:** `DLTA-12-mg3k9x2a` (llevan el momento de creación); la bitácora se junta por id + fecha, así dos
  impresiones distintas con el mismo id viejo se conservan las dos.
- **Reloj del equipo:** `cambiado_en` nunca va hacia atrás (si el reloj se adelantó y se corrigió, el siguiente cambio
  sigue ganando).
- **El otro inventario aún no abierto tras actualizar:** lo que su copia trae impreso o en su lista cuenta al marcar sus
  entradas (`registroParaLeer`).
- **Interfaz:** las ventanas ya no rebasan la pantalla en anchos angostos (`.ventana { min-width: 0 }`); *Del
  inventario* conserva las marcas de cada inventario al cambiar *Datos de* y agrega las de los dos; el aviso de
  «impresas» muestra los folios (también los de GSM); volver a pulsar el inventario activo no borra lo elegido; títulos
  con «código AX»; etiqueta *Inventario en la etiqueta* sin encimarse; anillo de foco completo en la lista de entradas.

## Datos (formatos 10 a 12)

- `estado.etiquetas = { material: [...], ax: [...], cambiado_en }`: lo que está por imprimir (de DLTA y GSM). Cada
  etiqueta: `id` (`DLTA-12`), `cantidad` (1–999), `codigo`, `nombre`, `dimension`, `np`, `descripcion`, `area` (las de
  código AX solo código y nombre), `inventario` (`DLTA` | `GSM`), `origen` (`{ tipo: "ENTRADA", inventario, vale_id, emitido_en,
  folio, folio_externo, linea_id }`, `{ tipo: "INVENTARIO", inventario, existencia_id, hoja }`, `{ tipo: "MANUAL" }` o
  `{ tipo: "ARCHIVO", archivo }`) y `agregada_en`. Es una **copia**: si después cambia el inventario, la etiqueta no cambia.
- `estado.impresiones_etiquetas = [{ id, fecha_hora, usuario, tipo, partidas, etiquetas, vales: [{ inventario, vale_id }] }]`:
  bitácora (cada marca con `emitido_en` de la entrada). Una entrada «tiene etiquetas» si aparece en `vales` de alguna
  impresión con su id y su `emitido_en`. **Los vales no se tocan.**
- `config.etiquetas = { diseno: { hoja, margen_sup, margen_lat, ancho, alto, sep_x, sep_y, fuente, borde },
  identidad: { DLTA: { logo_izq, logo_der, texto }, GSM: {…} } }`: **compartido** entre DLTA y GSM
  (`VALORES_COMPARTIDOS.etiquetas`), así una etiqueta de GSM lleva el logo de GSM aunque se imprima desde DLTA. En la
  bitácora de sincronización las imágenes se anotan por su tamaño (`sinImagenes`), no completas.
- Código: `servicios/etiquetas.js` (propuestas, lista, bitácora, lista del generador, `adoptarListaEtiquetas`,
  `juntarImpresiones`), `ui/sesion.js` (`estadoDeInventario`: el otro, solo para leer) y `main.js` (`leerOtroInventario`), `impresion/etiquetas.js` (hojas y
  cuadrícula, HTML/CSS escapado; `vista: true` para la pantalla), `ui/paginas/etiquetas.js` (página, ventanas, vista
  previa; `EtiquetasDeEntrada` y `EstadoEtiquetas` se usan en *Vales de entrada*, el detalle y el historial).

## Diseños de etiqueta (Ronda 22, núcleo)

En el código se llaman **modelos** (`impresion/modelos.js`) para no confundirlos con el «diseño» de la hoja
(`diseno`: papel, márgenes, tamaño, separaciones y borde); el usuario los ve como **diseños**.

- `config.etiquetas.modelos = [{ id, nombre, elementos, creado_en, cambiado_en }]` y
  `config.etiquetas.modelo_por_tipo = { material: id, ax: id }`: van dentro de `config.etiquetas`, así que se comparten
  entre DLTA y GSM sin nada aparte (gana el último cambio completo de `config.etiquetas`, como el diseño y los logos).
  **No cambia `FORMATO_ESTADO`.** En la bitácora de sincronización cada diseño se anota por su nombre y su número de
  elementos.
- Dos de fábrica, **constantes de solo lectura** que no se guardan: `fabrica-material` y `fabrica-ax` (lo que se imprimía
  en las Rondas 20–21). Sin elegir, o con un id que ya no existe, cada lista usa el suyo.
- Elemento: `{ id, tipo, x, y, w, h }` en **% de la etiqueta** (x + w ≤ 100, y + h ≤ 100, w y h ≥ 1) y, según el tipo
  (`PROPIEDADES`): `campo`, `etiqueta` (título del campo; vacío = solo el valor), `vacio` (lo que sale si el campo viene
  vacío; «N/A» por omisión), `texto` (título y texto libre; el libre admite `{codigo} {nombre} {dimension} {np}
  {descripcion} {area} {inventario}`), `letra` (% del **alto** de la etiqueta; 6.78 ≈ 10 px en 39 mm), `negrita`,
  `alinear`, `vertical`, `linea_abajo`, `varias_lineas` (si no, un renglón con «…»), `espaciado` (em), `datos` (QR y
  barras; `{codigo}` por omisión) y `texto_visible` (barras). Tipos: `logo_izq`, `logo_der`, `titulo`, `texto_almacen`,
  `campo`, `texto`, `qr` (`impresion/qr.js`), `barras` (Code 128, `impresion/barras.js`).
- **Entrada no confiable** (llega del otro inventario y de los respaldos): `normalizarModelo` / `normalizarElemento`
  dejan solo números finitos y acotados, valores conocidos, textos sin controles y recortados, 40 elementos como máximo e
  ids únicos; el render vuelve a normalizar y escapa todo texto.
- Render único (`impresion/etiquetas.js`): `.etq` con `position: relative` y cada elemento absoluto en %; la letra en mm =
  `letra / 100 × alto`. En el documento la caja de cada elemento va una vez en el CSS (`.etq-n<n>`); en el editor,
  `htmlElemento` la pone en `style` con el mismo HTML. El borde de la plantilla se dibuja encima (`::after`), así las
  posiciones son de la etiqueta completa con o sin borde. La *Letra (px)* de la plantilla (`diseno.fuente`) ya no se usa
  (se conserva en los datos).
- Servicio (`servicios/etiquetas.js`): `modelosEtiqueta`, `modeloDe`, `guardarModeloEtiqueta` (nombre obligatorio y único
  sin distinguir mayúsculas; los de fábrica no se cambian), `borrarModeloEtiqueta` (la lista que lo usaba vuelve al de
  fábrica) / `reponerModeloEtiqueta` (Deshacer), `usarModelo` y `nombreParaCopia`, con bitácora (nombre y número de
  elementos).
- Diferencias que quedan con la etiqueta de antes (plantilla estándar): si el inventario **no tiene texto de almacén**,
  el título queda donde está (antes se centraba en el encabezado; ~1.3 mm más arriba); en *Código AX* con un nombre de
  **dos renglones** el código queda ~1.9 mm más abajo que antes (centrado para un nombre de un renglón, el caso común).
  En las otras plantillas todo crece o se encoge en proporción (antes el encabezado medía siempre 17 × 8.5 mm y la letra
  la decía la plantilla).

## Diseños (Ronda 22): el editor

Pedido: «un editor de etiquetas, para crear o “diseñarlas” y guardar ese diseño, muy independiente de la plantilla de las
dimensiones ya existentes; que use el espacio requerido para que sea cómodo». `ui/paginas/editorEtiquetas.js`
(`EditorDisenos`), en primer plano **a pantalla completa** (portal sobre `body` como `Ventana`, con el foco y Escape
propios). Tres zonas:

- **Izquierda — diseños:** los de fábrica con candado (**solo lectura**), los guardados, *+ Nuevo* (en blanco o a partir del
  abierto), *Duplicar*, *Renombrar*, *Borrar* (con *Deshacer* en el aviso) y *Usar para Material* / *Usar para Código AX*
  con pastillas de qué lista usa cada uno (vale para DLTA y GSM). La copia de «Material (de fábrica)» se llama «Material
  (copia)».
- **Centro — la etiqueta grande** al tamaño de la plantilla actual (mm reales escalados para llenar el espacio; *Ajustar*,
  −/+ y *Tamaño real*), siempre en blanco aunque el tema sea oscuro. Datos: la primera etiqueta de la lista del tipo o la
  muestra del núcleo (`muestraEtiqueta`); *Ver como* Material / Código AX y DLTA / GSM (logos y texto de almacén de cada
  uno). Cada elemento es **el mismo HTML que se imprime** (`htmlElemento`, en una envoltura `display: contents`) y encima va
  una capa con su marco, las 8 asas, la cuadrícula (1, 2 o 5 %) y las guías. Lo que con esos datos no se dibuja (logo sin
  imagen, texto de almacén vacío, QR sin datos) lleva un marco propio que dice por qué.
- **Derecha — agregar y propiedades:** *Título, Texto de almacén, Logo izq., Logo der., Campo…, Texto libre, Código QR,
  Código de barras*; del elegido: x / y / ancho / alto en % (con su medida en mm), letra (% del alto, con mm y px en esta
  plantilla), negritas, alinear, vertical, línea abajo, varias líneas, espacio entre letras, campo y su título, texto si
  viene vacío, texto libre con los `{campos}` (botones que los insertan), datos del QR / barras (*Código*, *Código +
  dimensión* o *Libre*, y lo que lleva con estos datos), texto visible de las barras, *Al frente* / *Atrás*, *Duplicar*,
  *Quitar*; abajo, la lista de elementos (el de arriba se dibuja encima).
- **Ratón:** arrastrar mueve (pointer events con `setPointerCapture`), las asas cambian el tamaño; el borde contrario se
  queda fijo y nada sale de la etiqueta. Imán: primero las **guías** (orillas y centros de los demás elementos y de la
  etiqueta, a 6 px), si no la **cuadrícula** (si *Imán* está activo); con **Alt**, libre. Clic en vacío deja de elegir.
- **Teclado** (no actúa mientras se escribe en un campo; Supr, flechas y Ctrl+D solo con el foco en la etiqueta): flechas
  0.5 % (Shift 5 %), Supr / Retroceso quita, Ctrl+D duplica, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, Ctrl+S guarda, Escape deja de
  elegir (sin nada elegido, cierra). Tab recorre los elementos de la etiqueta.
- **De fábrica:** cualquier intento de cambiarlos (arrastrar, flechas, un campo, agregar) no cambia nada y la franja de
  arriba ofrece **Duplicar para editar**; nunca se edita en silencio.
- **Guardar** (botón y Ctrl+S) con `guardarModeloEtiqueta`; *Cambios sin guardar* en la cabecera. Al cerrar, abrir otro
  diseño, duplicar o *Usar para…* con cambios: **Guardar / Descartar los cambios / Seguir editando**. Recargar con cambios
  pide confirmación al navegador. Los errores del servicio (nombre repetido, 50 diseños…) salen en un aviso arriba. Si el
  diseño abierto cambia por fuera (sincronización con el otro inventario, *Deshacer*) y no había cambios, se toma el nuevo;
  si se borró, se abre el de la lista (y si había cambios, al guardar se crea de nuevo).
- **Avisos en el lienzo** (marco ámbar y **!**; *⚠ N avisos* en la cabecera salta al siguiente): texto que **no cabe** (se
  mide en el DOM: se corta o se sale de su caja), QR que no cabe por largo o con cuadritos de menos de 0.3 mm, barras con
  caracteres quitados o de menos de 0.19 mm (los de `avisosElemento`), y para leerse con cualquier lector (`avisosLectura`):
  QR de menos de **12 mm** de lado, barras más delgadas que **0.25 mm** o de menos de **5 mm** de alto; campos que la
  etiqueta de código AX no trae.
- **Responsivo:** 236 / flexible / 330 px a 1366, más anchos desde 1600; en menos de 900 px una zona a la vez con pestañas
  *Diseños / Etiqueta / Propiedades* (sin scroll horizontal). Tokens de color del tema y de GSM; la selección, la
  cuadrícula y las guías tienen colores fijos (van sobre la etiqueta blanca): azul en DLTA, morado en GSM.
- Preferencias del editor (cuadrícula, imán y paso) en `localStorage` (solo comodidad de quien lo usa).
- **Lógica sin DOM** en `impresion/lienzo.js` (pruebas `tests/lienzo.test.js`): `pxAPorciento`, `porcientoAMm`,
  `letraEnMedidas`, `zoomParaAjustar`, `imantar`, `moverCaja`, `fijarCaja`, `redimensionar` (8 asas), `lineasGuia`,
  `moverArrastrando` / `redimensionarArrastrando` (guías + imán), `moverConTecla`, `historial` / `empujar` (cambios seguidos
  con la misma clave = un paso) / `deshacer` / `rehacer`, `agregarElemento`, `duplicarElemento`, `quitarElemento`,
  `alFrente` / `alFondo`, `cambiarElemento` (el título del campo sigue al campo si era el de fábrica), `nombreLibre`,
  `datosPredefinidos` y `avisosLectura`.

## Impresión

Igual que el generador: cada hoja mide exactamente el papel (`@page { size: …mm; margin: 0 }`) con los márgenes como
relleno, y la rejilla tiene las columnas y filas que caben físicamente. Al imprimir: escala **100 %** y sin
*Encabezados y pies de página*. Verificado en Chromium (PDF): con 24 etiquetas cada plantilla da exactamente las hojas
calculadas (2 × 6 → 2, J-5163 → 3, 3 × 8 → 1, 1 × 4 → 6, A4 2 × 6 → 2), sin hojas en blanco. Las hojas van en bloque al
imprimir (no en *flex*: los saltos de página dentro de un flex no siempre se respetan).

## Apuntes

- El nombre de AX solo existe si se importó un reporte en *Conciliación AX*; mientras tanto, sale la descripción del
  inventario (la misma de los vales).
- Un logo del vale que el navegador no pueda redibujar (p. ej. un PNG raro) se usa tal cual si es PNG/JPG de menos de
  300 KB; si no, hay que subirlo de un archivo.
- Los logos del vale de **otro** inventario no se pueden leer desde el abierto (cada uno tiene su libro de vales en su
  propia base): se ofrecen al abrir ese inventario, o se suben de un archivo.
- Una entrada vieja (registrada antes de esta ronda) aparece como «sin etiquetas»; la sugerencia solo muestra las 5 más
  recientes, y el historial tiene el filtro *Etiquetas: Sin imprimir / Impresas*.

## Por confirmar con el usuario

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-25 | ¿Se imprimen etiquetas también al **devolver** material (entrada copiada de un vale de salida)? | Sí, igual que cualquier entrada (ya funciona). |
| P-26 | ¿Hace falta mandar la lista **de aquí al teléfono** (exportar el `.json` para el generador)? | No por ahora: el flujo es teléfono → PC. |
| P-27 | Con muchas piezas (p. ej. 200 tornillos) ¿una por pieza o un tope? | Una por pieza hasta 999 por partida y 2000 por impresión; se baja a mano. Si molesta, poner un tope sugerido (p. ej. 20). |
| P-28 | ¿El texto de almacén es el mismo en DLTA y GSM («BRONCO RIG-91»)? | Se guarda por inventario; si es el mismo, se escribe en los dos. |
