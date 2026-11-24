# 13 — Rediseño del vale de salida (Ronda 34)

> Especificación para implementar. El diseño aprobado está en el lienzo de Claude Design
> **«Vale de salida — 3 direcciones», página «B + C»**: https://claude.ai/artifact/XJvGhPB5u5bN1FMzfHob14
> Con la sesión iniciada con la cuenta de claude.ai (`/login`), Claude Code puede leerlo con ese enlace o adjuntarlo
> desde `/artifacts`. Copia en el repo: `docs/diseno/ronda-34/` (las maquetas `.dc.html` y un README con qué pantalla
> corresponde a cada sección).
> Las maquetas usan datos de ejemplo y la fuente Inter como sustituto; **en la app se usan los tokens y la fuente que ya
> existen** (`--fuente`, `--mono`, `--primario`…). Si algo de este documento contradice al lienzo, manda este documento.

## 0. Qué cambia y qué no

**Problema.** La pantalla actual de *Vales de salida* copia el Excel: un solo formulario con todo a la vez, las partidas
en el orden de las columnas del vale impreso y mucho texto explicativo. El almacenista no sabe por dónde empezar, el
buscador baja conforme crece la lista y elegir la clave correcta es lo que más errores da.

**Solución.** Un vale en **3 pasos**, uno por decisión:

1. **Para quién** — área (o destino, si es transferencia) y la persona.
2. **Material** — un buscador fijo a la izquierda y la lista de partidas a la derecha, con scroll propio.
3. **Revisar y emitir** — lo que falta, el resumen y la vista previa real del vale impreso.

**No cambia (no tocar sin preguntar):**

- `src/nucleo/*`, el modelo de datos, folios (`emitirBorrador`, candado de pestaña única), validación (`validarVale`),
  corrección (`corregirVale`), exportación a Excel y respaldos.
- **El formato impreso.** La impresión sigue saliendo de `src/impresion/vale.js` sobre la hoja-formulario del libro de
  vales. La vista previa del paso 3 **usa ese mismo render**; los dibujos del lienzo son solo ilustrativos.
- Las demás páginas (entradas, inventario, historial…). Su rediseño será otra ronda. De la navegación solo cambia el
  comportamiento del menú lateral (§7), no sus secciones.

**Se elimina (confirmado con el usuario por el diseño; ver §11 para lo que falta confirmar):**

- La disposición de partidas "como el vale impreso" (columnas O.C., cantidad, código, descripción, clave, presentación, lote).
- El flujo código → Enter → clave → Enter → cantidad como único camino (`CeldaCodigo` + `CeldaClave`) y la búsqueda
  rápida opcional (`BusquedaRapida` y su ajuste). Los reemplaza un solo buscador (§5.2).

## 1. Principios (deciden los casos que este documento no cubra)

1. Un paso, una decisión. Nada de hacer todo en la misma pantalla.
2. Lo ya elegido siempre se ve en un resumen, con un botón **Editar** para cambiarlo.
3. El buscador no se mueve: lo que crece (listas) tiene su propio scroll.
4. El nombre de la persona manda; el puesto va al lado, se sugiere solo y se corrige escribiendo.
5. Agregar es un gesto claro (+, doble clic o Enter). **La cantidad nunca se inventa**: empieza vacía.
6. Lo que distingue un material (dimensión, NP) va primero; las descripciones largas se recortan.
7. No capturar dos veces: si el dato ya existe (una entrada, el último vale, el último puesto), se trae.
8. La acción final (Emitir) está siempre a la vista, también en la vista previa ampliada.
9. **Todo lo que se puede tocar parece botón** (borde y fondo). Ningún texto es clicable ni va subrayado.
10. En ventana angosta se quitan columnas y campos, no se encogen: nunca texto ilegible ni encimado.

## 2. Estado y navegación entre pasos

- El borrador gana `paso: 1 | 2 | 3` (se guarda con el borrador y sobrevive a cerrar la pestaña, como hoy).
  Borrador nuevo → `paso: 1`. Borrador desde otro vale o entrada (`borradorDesdeVale`) → `paso: 1` con las partidas ya
  cargadas (el usuario confirma para quién y pasa directo al 2).
- **Las pestañas de borradores se quedan** (RF-10), en una franja arriba del indicador de pasos. Cada borrador recuerda
  su paso. Sin cambios en *Nuevo vale* ni en descartar con *Deshacer*.
- **Indicador de pasos**: 3 segmentos con su nombre ("1 · Para quién", "2 · Material", "3 · Revisar y emitir").
  Completo = verde con ✓, actual = `--primario`, pendiente = gris. **No es clicable** (principio 9): para regresar están
  los botones **← Para quién** y **Editar** de cada resumen.
- **Avanzar**: botón principal abajo a la derecha de cada paso y `Enter` cuando el foco no está en un campo de texto
  con sugerencias abiertas.
  - Paso 1 → 2 exige: área (o destino), nombre de quien recibe y, si `requiereAutoriza`, quién autoriza. Si falta algo,
    el botón queda deshabilitado y el campo que falta se marca con un texto corto debajo ("Falta el nombre").
  - Paso 2 → 3 exige al menos 1 partida. Las partidas **sin cantidad no bloquean el paso**, pero sí bloquean *Emitir*.
- **Regresar** nunca borra nada. Cambiar el área en el paso 1 con partidas ya capturadas **no** las toca; solo se
  vuelven a aplicar la plantilla, las observaciones y las firmas de esa área (`aplicarPlantilla`).

## 3. Paso 1 · Para quién (lienzo: «1a» y «1b»)

Arriba: un interruptor de 2 opciones, **Consumo interno** | **Transferencia** (Ronda 35; antes «Enviar a otro RIG o pozo»), y a la derecha el botón de
**Fecha** (hoy por defecto; se puede cambiar para capturar un vale de otro día). Debajo, **dos mitades iguales**.

### 3.1 Consumo interno

- **Mitad izquierda · Área.** Cuadrícula de **2 columnas** con un botón por plantilla de área (las de `listas(estado)`,
  menos `TRANSFERENCIAS`), alto 48 px. Seleccionado: borde de 2 px `--primario` y fondo `--primario-suave`. Atajos: las
  10 primeras áreas responden a las teclas 1…9, 0 (se muestra la tecla, en gris, a la derecha de cada botón). Al iniciar
  un borrador nuevo se preselecciona la última área usada.
- **Mitad derecha · ¿Quién lo lleva?**
  - **Nombre** y **Puesto**, lado a lado y del mismo tamaño (alto 48 px). El puesto **no** es secundario.
  - Al elegir un nombre, el puesto se llena con el último que tuvo esa persona. Si está mal o vacío, se sobrescribe
    escribiendo (con la misma lógica de hoy para actualizar el puesto: `previaActualizacionPuesto`).
  - Debajo, la lista **"Suelen recibir en ‹área›"**: hasta 6 personas, primero quienes más han firmado para esa área
    (`personasParaFirma` / `buscarPersonas` con `depto`). Cada fila muestra **el nombre en negritas** a la izquierda y
    el puesto en gris a la derecha. Un clic elige; ↑ ↓ y Enter también.
  - Escribir en *Nombre* filtra esa lista (por nombre o puesto, como hoy).
- Pie del paso: el texto "Observaciones de ‹área› y etapa ‹x› se llenan solas" y, si el área pide etapa (`pideEtapa`),
  un botón **Cambiar etapa** que abre el selector actual de etapa.

### 3.2 Transferencia

- **Mitad izquierda · ¿A dónde se envía?** Cuadrícula de 2 columnas con los destinos más usados (las sugerencias de
  `listas(estado).lugares`: RIGs y pozos de plantillas y vales recientes) y un campo **Otro destino** con búsqueda. Se
  guarda en `destino` (y `depto_destino` como hoy).
- **Mitad derecha**, dos tarjetas con el mismo patrón nombre + puesto:
  - **¿Quién lo transporta?** → se guarda en los campos de *Recibió* del vale (`recibio_nombre`, `recibio_puesto`).
  - **¿Quién autoriza?** → *Autorizó*. Sugerencias: primero RESPONSABLE e ITP / Rig Manager (regla actual).
- Se usa la plantilla `TRANSFERENCIAS` (naturaleza `TRANSFERENCIA`; `requiereAutoriza` = verdadero).

### 3.3 Áreas con firmas extra (NOV y las que tengan segunda fila)

Si `firmasExtraDe(estado, datos)` devuelve etiquetas, la mitad derecha muestra **una tarjeta por firma** con el mismo
patrón nombre + puesto y las etiquetas del área (por ejemplo, para NOV: químico, personal de NOV, patrimonial). Se
llenan con las del último vale de esa área (`ultimoValeDeArea`), como hoy. Si no caben, la mitad derecha hace scroll
propio; el botón **Continuar** queda fijo abajo. Las **fotos de NOV** van en el paso 3 (§6.2).

## 4. Paso 2 · Material (lienzo: «2», «2b», «2d»)

Dos columnas: **buscador + resultados** (izquierda, ~60 %) y **vale en curso** (derecha, ~40 %, mínimo 380 px).

### 4.1 Buscador (siempre arriba, nunca se desplaza)

- (Ronda 35: se quitó; ver §14.) A la izquierda, un selector **Buscar en**: *Todo* (por defecto) · *Solo código* · *Solo descripción* ·
  *Dimensión o NP*. A la derecha, el campo grande (alto 60 px, letra ≥ 18 px). Etiqueta del campo:
  "Siguiente material · código, descripción, dimensión o NP".
- *Todo* busca en código, descripción, dimensión y NP a la vez (reusar `indiceRapido` / `buscarRapido` de
  `ui/paginas/vales.js`, movidos a un servicio puro para poder probarlos). Un número exacto de código pone ese código
  primero.
- El foco vuelve al buscador después de cada agregar con Enter, y al volver de otra ventana o pestaña.

### 4.2 Resultados

- **Agrupados por código**: un encabezado por código ("711 · FOCO LED · 3 claves") y debajo una fila por clave
  (variante + contenedor, como `opcionesDeClave`).
- Columnas de cada fila: **Dimensión** (mono, grande) · **NP** (mono, grande; "—" si no tiene) · **Contenedor**
  (+ pastilla FX si aplica) · **Hay** (existencia) · botón **+** (40 × 40 px, `--primario`).
- Debajo del contenedor, en verde, "La última de ‹área›" en la clave que esa área se llevó la última vez (del historial
  de vales; si no hay, nada).
- Interacción:
  - Un **clic** en la fila solo la resalta (no agrega: evita agregar por accidente).
  - **+**, **doble clic** o **Enter** sobre la resaltada → agrega con cantidad vacía; el foco se queda en el buscador
    (modo ráfaga).
  - **Shift + Enter** → agrega y lleva el foco a la cantidad de esa partida en la lista.
  - ↑ ↓ mueven el resaltado; **Esc** limpia la búsqueda.
- Una clave con existencia 0 se puede agregar (queda con aviso de existencia en el paso 3).
- Sin resultados de código ni de texto → ver §4.5 (clave nueva) y §4.6 (código nuevo).

### 4.3 Vale en curso (columna derecha)

Panel de alto fijo (el alto de la ventana menos la cabecera) dividido en tres zonas:

1. **Resumen de Para quién** (3 × 2): Área · Recibe · Puesto / Fecha · Entrega · Folio ("10 al emitir"). Botón
   **✎ Editar** → paso 1.
2. **Partidas · N** con su contador de pendientes: "2 sin cantidad", "1 no descuenta" (pastilla ámbar). **La lista
   tiene scroll propio**; las partidas nuevas se agregan al final y la lista se desplaza para mostrarlas.
3. Pie fijo: "Tab salta entre cantidades · cabe en 1 hoja (21)", y dos botones: **← Para quién** (secundario) y
   **Revisar y emitir →** (principal).

**Cada partida** (en este orden, de arriba abajo):

| Línea | Contenido | Reglas |
|---|---|---|
| 1 | **Dimensión · NP ‹np›** en `--mono`, 15 px, semibold | Una línea; se recorta con "…". |
| 2 | Código · descripción, 12 px, gris | Una línea; se recorta con "…". La descripción completa va en `title` (al pasar el cursor) y en el lector de pantalla. |
| 3 | Contenedor · "hay N" + pastillas: **No descuenta**, **No inventariado**, **FX** | |
| 4 | **Lote** + campo de texto (alto 30 px, "opcional") | **Siempre visible**, vacío o lleno. |

A la derecha de la partida: **cantidad** (campo de 62 px, alineado a la derecha, UM debajo en 11 px), **✎ Editar
partida** y **× Quitar** (con *Deshacer* en el aviso, como descartar borrador).

- Cantidad vacía = borde de 2 px `--alerta` y fondo `--alerta-suave`. Tab / Shift+Tab recorren solo las cantidades.
- Cantidad mayor que la existencia de esa clave: el texto "Solo hay N · al emitir pedirá justificación" en ámbar,
  debajo de la línea 3.
- Más de la capacidad del formato (`CAPACIDAD_DEFECTO`, 21 o la del área): el pie dice "se dividirá en 2 folios" en
  ámbar (la división ya existe en `emitirBorrador({ dividir })`).

### 4.4 Editar una partida (lienzo «2b»)

- ✎ en una partida → la fila se marca en ámbar ("editando") y arriba del buscador aparece una franja ámbar:
  "**Editando la partida 3** · EMPAQUE 6" · NP FLEXITALIC — elige otra clave. La cantidad y el lote se conservan."
  con el botón **Cancelar edición · Esc**.
- El buscador se pone en *Solo código* con ese código y muestra sus claves. La actual dice **Actual**; las demás tienen
  **Usar esta** (o doble clic / Enter). Al elegir: se reemplaza la clave (`conExistencia`), se conservan cantidad, O.C. y
  lote, sale el modo edición y el foco vuelve al buscador.
- Se puede cambiar también de código: borrar el filtro y buscar otro material reemplaza la partida completa (conserva
  cantidad y lote).

### 4.5 Dimensión que no existe en el inventario (lienzo «2d»)

- Si hay código pero ninguna clave coincide con lo escrito, debajo de los resultados reales aparece **una sola fila**,
  con borde punteado (estilo distinto a los resultados a propósito): "**Usar «6309-2Z/C»** — No está en el inventario:
  queda en el vale y el historial, pero no descuenta existencia." + pastilla **No descuenta**. Se elige con clic,
  doble clic o ↓ hasta ella + Enter.
- La partida queda **exactamente como hoy con "Otra clave"**: `existencia_id: null`, `no_inventariado: true`, la clave
  escrita a mano. No descuenta. **No hay avisos de parecido, ni listas, ni revisión posterior.**
- En la lista de partidas lleva la pastilla **No descuenta** (el diésel y los gases, **No inventariado**, como hoy).

### 4.6 Código que no está en el catálogo

Igual que §4.5, con la fila: "+ Agregar código 1399 con descripción · queda por confirmar". Al elegirla se pide la
descripción en la misma partida (campo en la línea 2) y se da de alta al emitir como hoy (`asegurarArticulos` en `servicios/vales.js`, "por confirmar").

### 4.7 Traer partidas de otra entrada o vale

- Debajo de los resultados: "¿Es material que acabas de recibir?" con un botón por entrada de hoy ("E-0005 · hoy ·
  14 partidas", máximo 2) y **Otra entrada o vale…** (abre la ventana actual "Vale nuevo desde otro vale").
- **Dentro del paso 2, las partidas se agregan al borrador actual** (no se abre otro borrador): función nueva
  `agregarPartidasDesdeVale(estado, borradorId, valeId)` que reutiliza `partidasParaSalida`. Las cantidades vienen de la
  entrada y se pueden ajustar en la lista.
- Desde el detalle de una entrada o el historial, *Vale de salida* sigue creando un borrador nuevo (§2).

## 5. Paso 3 · Revisar y emitir (lienzo «3» y «3b»)

Dos columnas: revisión (izquierda) y vista previa (derecha).

### 5.1 Revisión

1. **Lo que falta antes de emitir** (Ronda 35: ya no va en una tarjeta aparte; ver §14) (solo si hay algo), en una tarjeta ámbar al inicio, una fila por problema:
   - Partida sin cantidad → botón **Ir a la partida** (paso 2, foco en esa cantidad).
   - Cantidad mayor que la existencia → el campo de **justificación** ahí mismo (se guarda en la partida, como hoy).
   - Cualquier error de `validarVale` → su mensaje y un botón **Corregir** que lleva al paso y campo que lo causa.
2. **Para quién** — Área · Recibe (+ puesto) · Entrega · Fecha, con **✎ Editar**.
3. **Material · N partidas** — una fila por partida: cantidad + UM · dimensión · NP · código · descripción (recortada,
   completa en `title`) · lote ("sin lote" si está vacío). Con **✎ Editar** → paso 2.

### 5.2 Fotos (solo áreas que llevan fotos, como NOV)

Tarjeta **Fotos (3)** entre *Material* y la vista previa, con el componente actual `FotosVale`. Si el área exige fotos y
faltan, cuenta como "lo que falta" (§5.1).

### 5.3 Vista previa

- Título "Así saldrá impreso" y botón **⤢ Ampliar**. La miniatura (tamaño carta, ancho de la columna) es **el mismo
  HTML de impresión** (`documentoImpresion` / `paginaHtml`) escalado, con `BORRADOR` en el folio como hoy. Un clic en la
  miniatura también amplía.
- Debajo, el botón **Emitir vale · folio N** (alto 56 px). Deshabilitado mientras haya algo en *Lo que falta*, con el
  texto "Se habilita al resolver lo pendiente".
- **Vista ampliada** (ventana a pantalla completa, `role="dialog"`):
  - Barra superior oscura: título, resumen ("Mecánico · Mecánico Uno · 6 partidas · folio 10 al emitir"), zoom
    − / % / + (50–200 %, pasos de 25 %), **Ajustar al ancho** y **×** (Esc).
  - En medio, el vale real con scroll propio.
  - **Barra inferior fija, siempre visible**: estado ("✓ Todo listo" o lo que falta) · **← Seguir revisando** ·
    **Emitir vale · folio N**.
- **Emitir** = `emitirBorrador` (sin cambios). Después, la pantalla actual de vale emitido (`EmitidoOk`: imprimir,
  nuevo vale, copiar).

## 6. Componentes y estilo

Usar los tokens de `src/estilos.css`. Lo que aparece en el lienzo con colores fijos se traduce así:

| En el lienzo | Token |
|---|---|
| Azul principal `#1f4e8c` / fondo `#e6eef8` | `--primario` / `--primario-suave` |
| Texto `#1c2733` / gris `#5b6b7c` | `--texto` / `--texto-suave` |
| Bordes `#dde3ea` | `--borde` |
| Verde (paso hecho, "la última de…") | `--ok` / `--ok-suave` |
| Ámbar (sin cantidad, no descuenta, editando) | `--alerta` / `--alerta-suave` |
| Inter / JetBrains Mono | `--fuente` / `--mono` |

Componentes nuevos o cambiados (en `src/ui/`):

| Componente | Notas |
|---|---|
| `PasosVale` | Indicador de 3 pasos, no clicable. |
| `PasoParaQuien` | §3. Reutiliza `SelectorPersona` (lista visible, no desplegable) y el selector de etapa actual. |
| `PasoMaterial` | §4: `BuscadorMaterial`, `ResultadosMaterial`, `ListaPartidas`, `PartidaVale`. |
| `PasoEmitir` | §5: `PendientesVale`, `ResumenVale`, `VistaPreviaVale` (miniatura + ampliada). |
| `BotonEditar` | Botón secundario pequeño: alto 36 px, borde azul claro, fondo `--primario-suave`, icono `lapiz` + "Editar". Una sola palabra para la misma acción en todos lados. |
| Botón "agregar opcional" | Borde punteado (por ejemplo "+ Otra entrada…"). Sólido = acción; punteado = agregar algo opcional. |

Botones: principal 48–56 px de alto, secundario 36–50 px; mínimo 44 × 44 px tocable (los iconos de quitar y editar de
la lista pueden ser de 30 px de icono, pero con 44 px de área tocable).

## 7. Menú lateral (marco de la app, `ui/app.js`)

Ya existe `CLAVE_MENU` (compacto, guardado en `localStorage`) y `useMenuEstrecho` (≤ 1100 px). Ajustes:

- **Menú completo** (236 px): icono + nombre de cada sección (los iconos de `PAGINAS` en `iconos.js`), pastillas de
  pendientes como hoy y un botón **Contraer menú** (icono de panel, 36 × 36 px) junto al nombre de la app.
- **Menú de iconos** (64 px): botón **Expandir menú** arriba; un botón de 44 × 44 px por sección con `aria-label` y
  `title` con su nombre; los pendientes se muestran como un **punto ámbar** sobre el icono (con el pendiente en el
  `aria-label`: "Recibir material, 2 por ubicar").
- **Atajo `Ctrl + B`** alterna entre los dos.
- **Automático por ancho:** ≥ 1280 px usa lo que eligió el usuario (por defecto, completo); < 1280 px pasa a iconos.
  **Ya no se convierte en menú hamburguesa**: el menú de iconos se queda en todas las anchuras, para que siempre se pueda
  llegar a cualquier sección. Expandirlo en ventana angosta lo abre **encima** del contenido (con fondo oscurecido; se
  cierra con Esc o clic fuera).
- **Nunca se abre ni se cierra solo al pasar el cursor.** Si el usuario lo contrae a mano, se queda contraído aunque la
  ventana crezca. (Zoho y HubSpot reciben quejas justo por ocultar y mostrar el menú solos.)

## 8. Anchos de ventana

Medidas en px CSS. Ojo: en Windows con escala al 125 %, un monitor de 1920 px son 1536 px CSS y **media pantalla son
~768 px**. Es el caso que más importa después de pantalla completa.

| Ancho | Menú | Paso 1 | Paso 2 | Paso 3 |
|---|---|---|---|---|
| ≥ 1280 | Elección del usuario | 2 mitades | Buscador ~60 % + lista ~40 % (mín. 380) | 2 columnas |
| 900–1279 | Iconos | 2 mitades | Igual, columnas más estrechas | 2 columnas |
| 700–899 (lienzo «2c», 768) | Iconos | Mitades apiladas: área arriba (2 columnas), persona abajo | Siguen lado a lado (~55/45). Resultados en 2 líneas (dimensión · NP / contenedor · hay) y solo el botón +. Resumen del paso 1 en una línea con ✎ de solo icono. Pasos como "Paso 2 de 3" + 3 barras. | 1 columna: revisión y debajo la miniatura; *Emitir* fijo abajo |
| < 700 | Iconos | Apilado | Una columna: buscador y resultados; **barra fija abajo** "6 partidas · 2 sin cantidad ▴" que abre la lista como panel encima (Esc o ▾ lo cierra) | 1 columna |

Reglas que valen siempre:

- **Nada se encima ni se corta sin "…".** Si algo no cabe, se quita (columna, texto de ayuda) antes de encogerlo.
  Letra mínima 12 px (11 px solo para la UM y las pastillas).
- Usar container queries (`@container`) en las columnas del paso 2 en vez de solo `@media`, porque su ancho depende
  también del menú.
- Las alturas fijas (panel de la lista, vista ampliada) se calculan con la altura de la ventana; ningún scroll de la
  página completa en el paso 2: solo el de la lista y el de los resultados.

## 9. Teclado y accesibilidad

| Dónde | Tecla | Acción |
|---|---|---|
| Paso 1 | 1…9, 0 | Elige área (si el foco no está en un campo) |
| Paso 1 | ↑ ↓ Enter | Recorre y elige en "Suelen recibir" |
| Cualquier paso | Enter | Continuar (si no hay sugerencias abiertas) |
| Paso 2 · buscador | ↑ ↓ | Mueve el resaltado en resultados |
| Paso 2 · buscador | Enter / Shift+Enter | Agrega / agrega y va a su cantidad |
| Paso 2 · buscador | Esc | Limpia la búsqueda; en modo edición, cancela la edición |
| Paso 2 · lista | Tab / Shift+Tab | Siguiente / anterior cantidad |
| Paso 2 · cantidad | Enter | Vuelve al buscador |
| Vista ampliada | Esc · Ctrl + / Ctrl − | Cerrar · zoom |
| Global | Ctrl + B | Contraer / expandir menú |

- Elementos reales: `<button>`, `<a href>`, `<input>` con `<label>`. Áreas y tipo de vale como `radiogroup`.
  Resultados como `listbox` con `aria-activedescendant` desde el buscador.
- Al agregar una partida, `aria-live="polite"`: "Agregado FOCO LED S/D. 6 partidas, 2 sin cantidad".
- Contraste ≥ 4.5:1 en texto, también en claro y oscuro (`prefers-color-scheme`).
- `prefers-reduced-motion`: sin animación al agregar ni al abrir la vista ampliada (en general: 150 ms, `--dur-corta`).

## 10. Casos límite

- **0 partidas:** la lista muestra "Busca un material a la izquierda para agregarlo" y *Revisar y emitir* está
  deshabilitado.
- **Muchas partidas (> 21):** aviso de división en el pie y en el paso 3; la lista sigue con scroll.
- **Descripciones muy largas:** "VALVULA (INVENTARIABLE-REFACCIONES)" y "SUMINISTRO DE DIESEL Y COMBUSTIBLE" deben
  verse bien a 768 px (recortadas, nunca en 2 líneas que empujen la fila).
- **Misma clave dos veces:** se permite (como hoy), con la marca de duplicada (`partidasDuplicadas`).
- **Persona nueva:** escribir un nombre que no existe y continuar crea a la persona como hoy, con el puesto escrito.
- **Cambiar de inventario (A/B) con un borrador abierto:** el comportamiento de hoy, sin cambios.
- **Cambio de almacenista en turno:** *Entrega* se actualiza en el resumen (`conEntregaEnTurno`).

## 11. Decisiones del usuario

1. **Quitar "Mi pantalla de vales" — confirmado.** Se borran el bloque de Ajustes y `BLOQUES_VALE`,
   `ORDEN_DEFECTO`, `LADOS`, `preferenciasVale`, `guardarPreferenciasVale`, `restablecerPreferenciasVale` y
   `moverBloque` de `servicios/preferencias.js`, con sus pruebas. La preferencia guardada se elimina en la carga
   (migración que borra la clave; sin error si no existe). La personalización (tema, avisos, animaciones) se queda.
2. **Quitar el ajuste "Captura de partidas" — confirmado.** Se borra la opción de Ajustes y `BusquedaRapida`; su
   índice (`indiceRapido` / `buscarRapido`) pasa a ser el del buscador único (§4.1).
3. **Fotos de NOV obligatorias — confirmado.** En el paso 3, faltar una foto es un pendiente que bloquea *Emitir*
   (§5.1), como hoy.
4. **Dimensión que no existe — confirmado:** no descuenta y ya; sin revisión ni listas (§4.5). Nada que cambiar
   en *Pendientes* ni en el reporte diario.

## 12. Pruebas

- Las existentes siguen pasando (`npm test`), en especial las de impresión: **el HTML impreso de un vale no cambia**.
- Unitarias nuevas (funciones puras, sin navegador): agrupación de resultados por código; orden con *Buscar en*;
  contadores "sin cantidad / no descuentan"; `agregarPartidasDesdeVale`; validación
  por paso (qué falta en el 1 y en el 3).
- Navegador (`tests/*.navegador.mjs`, mismo arnés que `copiarVale.navegador.mjs`): vale completo solo con teclado;
  agregar en ráfaga y llenar cantidades con Tab; editar una partida; clave nueva; transferencia con autoriza; NOV;
  emitir desde la vista ampliada; **capturas a 1440, 1024, 768 y 640 px** de los 3 pasos sin elementos encimados (verificar
  que ningún texto se salga de su caja).

## 13. Plan de entrega

Una rama, commits por etapa; al final de cada una, pruebas verdes y capturas para el usuario:

1. Estado `paso`, `PasosVale` y la página repartida en 3 pasos (reutilizando el editor actual por dentro).
2. Paso 1 completo (interno, transferencia, firmas extra).
3. Paso 2: buscador, resultados y lista con scroll propio.
4. Paso 2: editar partida, clave nueva, código nuevo, traer partidas.
5. Paso 3: pendientes, resumen, vista previa real y vista ampliada.
6. Menú lateral (§7) y anchos (§8).
7. Limpieza de §11 (1 y 2 ya confirmados) y actualizar `CLAUDE.md` / `docs/05-flujos.md` (Ronda 34).

## 14. Cambios de la Ronda 35 (correcciones del usuario)

- **Paso 1.** El interruptor dice *Consumo interno* | *Transferencia* (RIG y pozo son lo mismo). Quién recibe, quién
  autoriza y las firmas extra salen del vale emitido más reciente del área (`firmasDelUltimoVale` en `aplicarPlantilla`):
  si en el último se cambió la persona, el siguiente ya la sugiere; sin vales, las de la plantilla. En transferencias, la
  línea «… PARA USO EN …» de las observaciones dice el destino elegido (`conDestino`, `conUsoEn`).
- **Paso 2.** Sin *Buscar en*: dos campos, **Código o descripción** (número = códigos que empiezan así; texto = palabras de
  la descripción) y **Dimensión o NP** (junta o separada, con cualquier comilla). Si la dimensión no está en un código,
  ese código ofrece al final de su tarjeta «Usar «…» en <código>» tal como se escribió. Cada código es una tarjeta (cabeza
  en color, código como insignia) y los atajos se dibujan como teclas (`Tecla`, `AyudaAtajos`).
- **Paso 3.** Sin la tarjeta de pendientes: cada pendiente trae `donde` y `corto` (`pendientesParaEmitir`) y se marca en
  ámbar en su lugar — la fila de *Para quién* con «Corregir», la partida con «Ir a la partida» / «Corregir» o su campo de
  justificación, las fotos en su sección —. La tabla del material: Cantidad · Código y descripción · Dimensión con
  «NP:», «Lote:» y «O.C.:» a su lado.
