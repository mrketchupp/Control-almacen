# 14 — Rediseño del vale de entrada y de la corrección (Ronda 39)

> Especificación para implementar. El diseño aprobado está en el lienzo de Claude Design
> **«Vale de salida — 3 direcciones», página «Entradas y corrección»**: https://claude.ai/artifact/XJvGhPB5u5bN1FMzfHob14
> (con `/login` de claude.ai, Claude Code lo lee con ese enlace o desde `/artifacts`). Copia en el repo:
> `docs/diseno/ronda-39/` (maquetas `.dc.html` y un README). Las maquetas usan datos de ejemplo y Inter como sustituto;
> **en la app se usan los tokens, componentes y estilos que ya existen** (los del vale de salida de las Rondas 34–35).
> Si una maqueta contradice a este documento, manda este documento. Las maquetas de la fila «Acomodo · versiones
> descartadas» **no se implementan**.

## 0. Qué cambia y qué no

**Cambia:**

1. **El marco de la app** (§1): la cabecera y el menú lateral nunca se desplazan; solo se desplaza el área de trabajo.
   Aplica a **todas** las páginas, también a las del vale de salida ya hechas.
2. **El vale de entrada** pasa de un formulario único a **4 pasos**: De dónde viene → Material → Acomodo → Revisar y
   registrar (§3–§7). Reutiliza los componentes del vale de salida (pasos, franja de borradores, tarjetas, `BotonEditar`,
   buscador de dos campos, resúmenes con «Editar»).
3. **La corrección** de vales de salida y de entradas deja el editor viejo (`EditorVale` + tabla tipo Excel) y usa las
   mismas secciones del flujo nuevo, abriendo directo en la revisión (§8).

**No cambia (no tocar sin preguntar):** núcleo, modelo de datos (salvo lo de §5.1), folios, `validarEntrada` /
`confirmarEntrada` / `corregirEntrada` / `corregirVale` (salvo lo que pida §5.1 y §8), la captura con Copilot
(`servicios/capturaIA.js`, `jsonTolerante.js`), exportación a Excel, impresión y respaldos.

**Se elimina:** «Material que regresa» como camino propio del vale de entrada (el botón *Copiar partidas de un vale de
salida*). Si algún día regresa material, se registra como una entrada normal. `datosDeDevolucion` puede quedarse en el
servicio, pero sin botón en la interfaz.

## 1. Regla del marco: nunca hay scroll de página

- La **cabecera** (logo, nombre, RIG, respaldos, en turno) y el **menú lateral** (DLTA | GSM, secciones, *Ajustes y más*
  abajo) están **siempre a la vista**. Nunca se desplazan ni se ocultan por scroll, en ninguna página ni en ningún
  ancho de ventana.
- El documento no hace scroll (`html, body` sin desplazamiento; el marco ocupa `100vh`). **Lo único que se desplaza es el
  área de trabajo** (`main`) y, dentro de ella, las secciones que ya tienen scroll propio (lista de partidas, resultados).
- Si el menú lateral no cabe en alto, se **compacta** (menos separación, o el menú de íconos), no se desplaza.
- Probarlo en las capturas: a 1440 × 900 y a 1440 × 700, la cabecera y *Ajustes y más* se ven completos en todas las
  páginas, con y sin contenido largo.

## 2. Principios nuevos (se suman a los de `docs/13` §1)

1. **Azul = estás editando; ámbar = necesita tu atención.** La partida que se edita lleva contorno azul y la etiqueta
   «Editando»; ámbar solo para pendientes y dudas (por revisar, sin dato, falta acomodar).
2. **Lo pendiente va arriba.** En toda lista que mezcle hecho y pendiente, primero lo pendiente; lo hecho abajo y
   plegable.
3. **Nada fijo en el código.** Contenedores, orígenes de «Viene de», destinos, áreas y personas salen de los datos de la
   herramienta (lo detectado en la primera carga y lo que se va registrando). Ninguna pantalla asume 5 contenedores ni
   una lista cerrada.
4. **Cada paso muestra solo lo que decide.** El paso 4 no repite el vale completo: muestra lo que hace falta para
   confirmar (dónde quedó cada partida) y deja lo demás en sus pasos.

## 3. Vale de entrada: estado y navegación

- El borrador de entrada gana `paso: 1 | 2 | 3 | 4` (se guarda con él, como en salida). Las pestañas de borradores se
  quedan como hoy («De BASE PRUEBA», «＋ Nueva entrada»).
- Indicador de 4 pasos igual al de salida (no clicable). Avanzar con el botón principal o `Enter`; regresar con «←» o
  con los «Editar» de cada resumen. Regresar nunca borra nada.
- Para pasar del 1 al 2 hace falta lo que hoy exige `validarEntrada` para el encabezado (folio del vale, viene de,
  fechas). Del 2 al 3: al menos una partida con código y cantidad. Del 3 al 4: ninguna partida sin acomodar.
- O.C. y solicitante (LOTE) **son opcionales** en todos los pasos: nunca bloquean (sin O.C. se registra `S/OC`, como hoy).

## 4. Paso 1 · De dónde viene (lienzo «E1»)

- Arriba, una franja: «¿Tienes foto o PDF del vale? Copilot llena este paso y las partidas» con el botón
  **Llenar con Copilot** (§4.1). Se puede usar sin llenar nada antes.
- Dos mitades:
  - **El vale de la base:** *Viene de* (botones con los orígenes más usados, de los datos, + campo «Otro origen…»),
    *Folio del vale* y *Fecha del vale* (la que usa la conciliación con AX; se dice debajo).
  - **Cuándo llega y quién lo trae:** *Recibido* (hoy por defecto; mismas reglas de hoy), *Recibe* (el almacenista en
    turno, solo lectura) y *Entregó*: nombre y puesto lado a lado (el puesto se llena con el último de esa persona, como
    en salida).
- Abajo a la derecha: **Continuar a material →** (`Enter`).

### 4.1 Llenar con Copilot (lienzo «E1b»)

- Ventana (`role="dialog"`) sobre el paso actual con los **tres pasos de hoy**: copiar las instrucciones · en Copilot,
  adjuntar la foto o el PDF y pegar las instrucciones · pegar la respuesta (botón **Pegar** o `Ctrl+V` en la ventana).
  Cada paso hecho se marca con ✓ verde.
- **Dibujos de Copilot:** no usar los del lienzo. El usuario dará capturas de cómo se ve Copilot; los dibujos se harán
  con ellas y con el estilo de `ui/ilustraciones.js`. Hasta entonces, la ventana va sin dibujos.
- Al pegar, en verde, lo leído: los datos del vale (viene de, folio, fecha, entregó) y «N partidas · X por revisar ·
  Y variante nueva»; si `jsonTolerante` corrigió algo, una línea que lo diga. Botones **Cancelar** y **Ver las partidas
  →**, que lleva al paso 2 con el paso 1 lleno (y marcado como completo si ya cumple lo de §3).
- Se puede abrir también desde el paso 2 («Pegar otra respuesta»), igual que hoy.

## 5. Paso 2 · Material (lienzo «E2» y «E2b»)

Dos columnas, como en salida pero con las proporciones al revés, porque cada partida de entrada lleva más datos:
**izquierda ~40 %** (resumen de *De dónde viene* con «Editar», y *Agregar partidas*), **derecha ~60 %** (lista).

- **Agregar partidas:** el estado de Copilot (si se usó: «Copilot leyó N partidas · solo las marcadas en ámbar
  necesitan tu atención», con *Pegar otra respuesta* y *Ver instrucciones*) y el buscador de dos campos del vale de
  salida (*Código o descripción* + *Dimensión o NP*), con sus resultados debajo y las mismas reglas (+, doble clic,
  Enter; «Usar «…» en <código>» para una dimensión que no existe = variante nueva).
- **La lista** tiene **fondo gris** (`#e9edf2` o el token gris más cercano) y cada partida es una **tarjeta blanca con
  sombra**, para que se vea dónde termina una y empieza otra. Scroll propio; arriba, fija, la cabeza con
  «Partidas · N» y los filtros; abajo, fijos, **← De dónde viene** y **Continuar a acomodo →**.
- **Filtros:** Todas · Por revisar · Sin O.C. · Sin solicitante (con su número; los tres últimos en ámbar si > 0).
- **Cada partida:**
  - Línea 1: número · cantidad (campo) con U.M. debajo · **dimensión · NP** (mono) y debajo código · descripción
    (recortada, completa en `title`) · pastillas (*Variante nueva*, *Sin existencia · no suma*) · **tipo** · ✎ Editar ·
    × Quitar.
  - Línea 2: **Solicita** (va en LOTE) y **O.C.**; si están vacíos, el campo se marca en ámbar (no bloquea).
  - **Por revisar** (lo que Copilot no tenía claro): franja ámbar arriba de la tarjeta con lo que leyó («Copilot leyó
    «6 FLEXITALC» y no está seguro de la dimensión») y el botón **Está bien**. Editar la partida también la da por
    revisada (como hoy).
  - **Ya no hay «Entra a»** en este paso: el contenedor se decide en el paso 3.

### 5.1 Tipo: Consumible | Inventariable

- Interruptor de dos opciones en cada partida (mismo estilo que DLTA | GSM): **Consumible | Inventariable**.
- Valor inicial, en este orden:
  1. Si la partida es de una variante con existencia, el tipo de su hoja (`ubicacion.clase`), con la nota «según su
     existencia».
  2. Si aplica la regla de `soloConsumible` (GSM y FX, códigos de 3 dígitos), **Consumible** y el interruptor bloqueado
     con la nota «consumible por regla».
  3. Si no, el **tipo por defecto de Ajustes** (§10), que de fábrica es **Consumible**.
- Se guarda en la partida (`clase: "INV" | "CONS"`). Junto con el contenedor del paso 3 decide la ubicación:
  `ubicacion = (contenedor, clase)`. Cambiar el tipo de una partida que ya estaba acomodada la regresa a «Faltan por
  acomodar» si su contenedor no tiene hoja de ese tipo.

### 5.2 Editar una partida (lienzo «E2b»)

- ✎ en una tarjeta → la tarjeta lleva **contorno azul grueso** y la etiqueta **«Editando»** encima (`aria-current`).
- El panel *Agregar partidas* se cambia por **«Editando la partida N»** (cabeza azul, botón **Cancelar · Esc**):
  campos Código, Dimensión, NP y U.M., y debajo las claves con existencia de ese código (la actual con «Actual», las
  demás con **Usar esta**) y, si aplica, la variante nueva como opción aparte. **Listo** guarda y regresa al modo de
  agregar.
- Cantidad, tipo, solicita y O.C. no pasan por este panel: se editan directo en la tarjeta.

## 6. Paso 3 · Acomodo (lienzo «E3» y «E3 · contenedor #2 elegido»)

Se eligió la versión **C · contenedor por contenedor**. Las versiones A, B y D del lienzo **no se implementan**.

- **Al llegar:** las partidas que tienen existencia en **un solo** contenedor de su tipo **ya están acomodadas** ahí
  (★), igual que hoy propone `contenedorSugerido` / `opcionesEntraA`. Las de código sin existencia que hoy se registran
  como *Sin existencia* (diésel, gases) van solas a esa zona. Lo demás queda en «Faltan por acomodar».
- **Izquierda (~60 %), fondo gris:**
  - Sin contenedor elegido: «Faltan por acomodar · N», un aviso azul «Elige un contenedor a la derecha y marca aquí lo que
    guardas en él», y las partidas pendientes (casillas deshabilitadas).
  - Con un contenedor elegido: «¿Qué guardas en el contenedor #X?» y dos grupos, **en este orden**:
    1. **Faltan por acomodar · N** — casillas sin marcar; marcar = se acomoda en #X al momento.
    2. **Ya en el #X · N** — marcadas (incluye las ★). Desmarcar una la regresa a «Faltan». Este grupo se **pliega solo
       cuando tiene más de 5** («▸ Ya en el #X · 12»), para que lo pendiente nunca quede abajo.
  - Al elegir otro contenedor, lo marcado se queda donde se marcó y deja de aparecer en «Faltan».
- **Derecha (~40 %):**
  - **Contenedores:** un botón grande por contenedor, con «N de esta entrada». Son **los contenedores del inventario
    actual** (valores distintos de `ubicacion.contenedor`, en el orden de `ubicacion.orden`); pueden ser más o menos
    de 5. En cuadrícula de 2 columnas con scroll propio si no caben.
  - Si un contenedor no tiene hoja del tipo de alguna partida pendiente, al marcarla ahí se avisa («El #3 no tiene hoja
    de consumibles») y no se acomoda.
  - **Avance:** «X de Y acomodadas», barra verde y, si faltan, «Faltan N: …» en ámbar; al terminar, «✓ Todo acomodado».
  - **Sin existencia · no se acomoda:** las partidas así, como **pastilla oscura pequeña** («500 LTS · S/D · DIESEL»).
- Acomodar por lote: varias casillas a la vez en el mismo contenedor. Teclado: §12.
- Pie: **← Material** y **Revisar y registrar →** (deshabilitado mientras falte alguna).

## 7. Paso 4 · Revisar y registrar (lienzo «E4»)

- **Izquierda (~60 %), fondo gris: «Dónde quedó cada partida»**, con ✎ Editar acomodo (→ paso 3).
  - Filtros por contenedor, de los datos: Todos · #1 · N · #2 · N … · Sin existencia · N (solo los que tienen partidas).
  - Las partidas **agrupadas por contenedor** (cabeza con el contenedor y su número de partidas). Cada fila: **punto de
    tipo** (círculo relleno azul = inventariable, contorno azul = consumible; sin texto, con `aria-label` y `title`) ·
    cantidad + U.M. · dimensión · NP · código · descripción recortada · *hay → queda* (o «nueva → N» para renglón nuevo;
    «no suma» en sin existencia), de `vistaPreviaEntrada`.
  - **No** se repiten solicitante ni O.C. aquí.
- **Derecha (~40 %):**
  - *De dónde viene* (resumen con ✎ Editar → paso 1).
  - *Antes de registrar*: ✓ partidas con cantidad, ✓ todas acomodadas, ✓ lo de Copilot revisado; y en azul, solo
    informativo: «N sin O.C. · se registran como S/OC», «O.C. y solicitante son opcionales». Lo que bloquee (los errores
    de `validarEntrada`) aparece aquí en ámbar con un botón que lleva al paso y campo que lo causa.
  - **Registrar entrada · E-000N** (`confirmarEntrada`), con el texto «Suma al inventario del <recibido>. Se puede
    corregir después con motivo.» y **← Acomodo**.

## 8. Corrección de vales de salida y de entradas (lienzo «C1»)

- *Corregir* abre la corrección **directo en la vista de revisión**, no en el paso 1.
- Arriba, una franja azul: «Corrigiendo el vale N» (o «la entrada E-000N») · «Nada cambia hasta «Guardar». El folio no
  cambia y la corrección queda en la bitácora.» Sin botones en la franja.
- **Izquierda:** las secciones del flujo con su ✎ Editar:
  - Salida: *Para quién* y *Material* (como el paso 3 de salida).
  - Entrada: *De dónde viene*, *Material* y *Dónde quedó cada partida* (como el paso 4 de entrada).
  - «Editar» abre ese paso en **modo corrección** (mismos componentes; la franja azul sigue arriba; el botón del pie
    dice **Listo** y regresa a la revisión).
  - Lo que cambió se marca en ámbar en su sección (por ejemplo la cantidad nueva con la anterior tachada debajo).
- **Derecha, tarjeta «Cambios · N»** (borde azul): la lista de cambios (`resumenCambios` / `resumenCambiosEntrada`) con
  su efecto en existencias («Regresa 1 PZA a #1 Cons.»), el **Motivo** que se llena solo con los cambios (como hoy; si
  se edita, se respeta el texto) y **dos botones: Guardar** (principal) **y Cancelar**. Nada más (sin vista previa de
  impresión en esta tarjeta).
- **Vales anteriores al conteo / migrados del Excel** (`esHistorial`): las partidas sin ligar al inventario se muestran
  en **gris** («sin ligar al inventario · anterior al conteo»), **no** con «Elige una clave de la lista» en rojo. La
  validación es la de `historial: true`; una nota azul dice que la corrección solo cambia el historial y el DIARIO.
- Un vale migrado sin área reconocida muestra el destino y departamento guardados en *Para quién*; elegir un área en la
  corrección es opcional.

## 9. Anchos de ventana

Mismas reglas que `docs/13` §8 y la regla del marco (§1). En particular:

| Ancho | Entrada · paso 2 | Paso 3 | Paso 4 |
|---|---|---|---|
| ≥ 1280 | 40 / 60 | 60 / 40 | 60 / 40 |
| 900–1279 | igual, columnas más angostas | contenedores en 1 columna | igual |
| 700–899 | la lista arriba y *Agregar partidas* como panel plegable encima | izquierda arriba; contenedores como fila con scroll horizontal | una columna; *Registrar* fijo abajo |
| < 700 | una columna | una columna | una columna |

## 10. Ajustes

- **Tipo por defecto de las partidas nuevas** (entradas): *Consumible* (de fábrica) o *Inventariable*. En *Ajustes*,
  junto a lo de captura. Solo afecta partidas sin existencia previa ni regla (§5.1).

## 11. Casos límite

- **Muchas partidas en un contenedor** (> 5 de esta entrada): el grupo «Ya en el #X» se pliega; lo pendiente sigue arriba.
- **Inventario con más o menos de 5 contenedores**, o con contenedores que solo tienen una de las dos hojas: §6.
- **Partida que se edita en el paso 2 después de acomodarla:** si cambia de variante o de tipo, vuelve a «Faltan por
  acomodar» salvo que la nueva tenga existencia en un solo contenedor (entonces se acomoda sola con ★).
- **Copilot sin datos del vale** (solo partidas): el paso 1 queda con lo que falte marcado; no se avanza al 2 hasta
  llenarlo (los campos que faltan se señalan al pulsar *Continuar*).
- **Folio de la base ya registrado:** el aviso de hoy, en el paso 1 junto al folio.
- **Corrección sin cambios:** *Guardar* deshabilitado, con «No has cambiado nada».

## 12. Teclado y accesibilidad

| Dónde | Tecla | Acción |
|---|---|---|
| Cualquier paso | Enter | Continuar (si no hay sugerencias abiertas ni un campo de varias líneas) |
| Paso 2 | Alt+N / buscador | Igual que en salida |
| Paso 2 · edición | Esc | Cancelar la edición |
| Paso 3 | 1…9 | Elegir el contenedor en esa posición |
| Paso 3 | ↑ ↓ Espacio | Recorrer y marcar/desmarcar partidas |
| Ventana de Copilot | Ctrl+V · Esc | Pegar la respuesta · cerrar |

- Contenedores como `tablist` / `tab`; partidas del paso 3 como `checkbox`; tipo como `radiogroup`; el punto de tipo con
  `role="img"` y `aria-label`.
- Al acomodar: `aria-live` «2 partidas acomodadas en el #2. Faltan 1.».

## 13. Pruebas

- `npm test` en verde; impresión y exportación sin cambios.
- Unitarias nuevas: tipo inicial de una partida (§5.1, incluida la regla `soloConsumible`); acomodo automático (★)
  con 0, 1 y 2 contenedores con existencia; ubicación final = (contenedor, clase); contenedores tomados de los datos
  (pruebas con 3 y con 7 contenedores); filtros del paso 2 y del 4; resumen de cambios de la corrección.
- Navegador (arnés de `valePasos.navegador.mjs`, con `CAPTURAS`): entrada completa a mano; entrada con Copilot (pegando
  una respuesta de prueba); acomodo por lote; editar una partida; corregir un vale de salida y una entrada; corregir un
  vale migrado (sin rojo). **Comprobar en cada captura que la cabecera y el menú se ven completos** (§1). Anchos 1440,
  1024, 768 y 640.

## 14. Plan de entrega (Ronda 39)

1. Marco sin scroll de página (§1) en toda la app.
2. Entrada: estado `paso`, indicador de 4 pasos y paso 1 (con la ventana de Copilot actual, sin dibujos).
3. Paso 2: lista nueva, filtros, tipo (§5.1) y edición de partida.
4. Paso 3: acomodo por contenedor.
5. Paso 4: revisar y registrar.
6. Corrección de salida y de entrada (§8).
7. Ajuste del tipo por defecto (§10), limpieza (§0) y documentación (`CLAUDE.md`, `docs/05-flujos.md`, `docs/10`).

Al terminar cada etapa: pruebas en verde, capturas en `capturas/ronda-39/etapa-N/` y detenerse para revisión.

## 15. Pantallas del lienzo (página «Entradas y corrección»)

| Maqueta | Sección |
|---|---|
| `E1Origen` | §4 |
| `E1CopilotListo` | §4.1 (los dibujos se descartaron) |
| `E2Material` | §5, §5.1 |
| `E2Editar` | §5.2 |
| `E3AcomodoC0` · `E3AcomodoC` | §6 |
| `E4Registrar` | §7 |
| `C1Corregir` | §8 |
| `E3Acomodo` (A), `E3AcomodoB`, `E3AcomodoD` | **descartadas** |
