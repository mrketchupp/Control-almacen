# Reporte de pruebas externas (intento de romper la herramienta) · 26/11/2026

Dirigido al agente de desarrollo. Base revisada: rama actual en el commit `6ff7984` (Ronda 36), `FORMATO_ESTADO = 18`.
`npm test` (528 pruebas), `npm run build` y las pruebas de Chromium `tests/*.navegador.mjs` (95 de 95) pasan; nada
de lo de abajo lo detecta la suite. Todo se reprodujo con las
fixtures sintéticas de `tests/ayuda.js` (`cargaSintetica`) y con `dist/ControlAlmacen.html` en Chromium (Playwright),
sembrando IndexedDB igual que `tests/valePasos.navegador.mjs`.

Gravedad: **CRÍTICO** = deja la herramienta inutilizable o pierde trabajo · **ALTO** = datos o reportes
equivocados sin aviso · **MEDIO** = datos basura aceptados o archivo dañado en casos alcanzables · **BAJO** = robustez
o mensajes con archivos manipulados o raros.

---

## 1. CRÍTICO — Una cantidad con signo «+» lanza una excepción no controlada en todo el sistema

**Causa raíz:** `src/nucleo/decimal.js:15-22`, `dec()`. La expresión regular acepta un signo inicial
(`/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i`), pero big.js rechaza `+`: `new Big("+5")` lanza
`Error: [big.js] Invalid number`. `dec()` está documentada como «null si no es número» y todos los llamadores
confían en eso (`dec(x) ?? CERO`, `dec(x) === null`).

```
dec("+5")   → THROWS [big.js] Invalid number
dec("+.5")  → THROWS
dec("-3")   → Big(-3)      dec("1,5") → null      dec("0x10") → null
```

Los campos de cantidad de la interfaz pasan el texto tal cual (solo cambian la primera «,» por «.»):
`ui/paginas/material.js:329`, `ui/paginas/conteo.js:206` (`capturar`), `ui/paginas/inventario.js:128`
(mover), `ui/paginas/entradas.js:435`, `ui/paginas/vales.js:598`. El texto se guarda en el borrador **antes**
del render que truena, así que el valor malo queda persistido en IndexedDB.

### 1a. Conteo físico: la página queda en blanco para siempre (se pierde el acceso al conteo en curso)
Reproducido en Chromium con la interfaz:
1. *Conteo físico* → marcar contenedores → **Empezar a capturar**.
2. En la primera celda `input[id^="cnt-"]` teclear `+5`.
3. IndexedDB queda con `conteo_en_curso.capturas = {"1":"+5"}`; consola: `pageerror: [big.js] Invalid number`.
4. **F5** → `#conteo` muestra el área de contenido **vacía** (solo menú y cabecera). No hay botón *Descartar
   conteo* ni ninguna forma de llegar a la celda para corregirla. Tras visitar `#conteo`, las demás secciones
   también quedan vacías hasta recargar (el árbol de Preact queda roto).

Llamadas que truenan con ese valor: `servicios/conteos.js:108` (`renglonesDelConteo`), `:180` (`validarConteo`),
`resumenConteo`. La única salida es restaurar un respaldo, perdiendo lo capturado del conteo.

### 1b. Vale de salida: pantalla duplicada y estado inconsistente
1. Nuevo vale → MECANICO → nombre y puesto → *Continuar a material* → `#buscar-material` = `706` →
   Shift+Enter → en *Cantidad de la partida 1* teclear `+5`.
2. Dos `pageerror` por render. *Revisar y emitir* sigue habilitado.
3. Al pulsarlo, el DOM queda con **dos franjas de pestañas y dos barras de pasos** (paso 3 encima del paso 2;
   captura en la sesión de pruebas). La tarjeta de partidas dice «1 sin cantidad» mientras el campo muestra `+5`.
4. Tras F5 el paso 3 dice «⚠ Falta la cantidad» (falso: hay `+5`) y cada render vuelve a lanzar la excepción.

### 1c. Mismo fallo en servicios (Node, sin interfaz)
`reacomodar(…, { cantidad: "+1" })`, `validarEntrada` y `vistaPreviaEntrada` con una partida `cantidad: "+2"`,
`validarVale` con `"+5"`: todas lanzan `Error: [big.js] Invalid number` (no `ErrorReacomodo` / `ErrorVale`).
La captura con Copilot también lo deja pasar: `interpretarRespuesta('{"lineas":[{"codigo":"706","cantidad":"+3"}]}')`
devuelve `cantidad: "+3"` sin aviso, y esa partida truena la página de entradas.

---

## 2. ALTO — Los respaldos y los Excel se leen sin verificar el CRC: plantillas corruptas se restauran sin aviso

`src/xlsx/zip.js:75` lee el CRC-32 de cada entrada del directorio central, pero `descomprimir()` (`:105`) y
`descomprimirZip()` (`:112`) nunca lo comparan con los datos. `leerRespaldo()` (`almacen/respaldos.js`) tampoco
compara la plantilla con `plantillas_excel[].sha256`, y `Almacen.restaurar()` (`almacen/almacen.js`) guarda las
plantillas tal cual.

Prueba (Node): respaldo sintético con dos plantillas registradas; 400 veces se invirtió **un bit** al azar dentro
de los datos comprimidos de una plantilla y se llamó `leerRespaldo`:

```
{ total: 400, detectados_con_error: 10, corruptos_aceptados_sin_aviso: 389 }
```

Como las plantillas ya son ZIP, el deflate las guarda casi sin comprimir y la corrupción pasa. El daño aparece
después, al exportar sobre una plantilla rota (y la plantilla es la base de **todas** las exportaciones «idénticas»).
Es el escenario de una sincronización parcial de OneDrive, que el proyecto ya documentó como real (Rondas 26, 29, 36).
El estado JSON solo se salva por accidente: un bit cambiado suele romper el JSON. Los libros que se importan
(inventario, vales, AX, base, Kardex) pasan por el mismo `leerZip`, sin CRC.

---

## 3. ALTO — El cierre del día corta salidas por folio y el inventario del día corta por fecha: reportes que no cuadran

`servicios/corte.js:20-29` (`ultimoFolioAl`) toma el folio más alto entre las salidas con fecha ≤ día y
`estadoAlCierre` (`:59`) incluye **todas** las salidas con folio ≤ ese, sin importar su fecha.
`nucleo/existencias.js:81-87` (`calcularSaldos(…, { dia })`) manda a CONSUMO del día cualquier vale con fecha
≥ día, **incluidas las fechas futuras**.

Reproducción (Node, `cargaSintetica`, código 702, MECANICO, con justificación):
```
folio 10 fecha 2026-11-26 cantidad 2   (hoy)
folio 11 fecha 2026-11-25 cantidad 3   (vale de ayer capturado hoy)

cierre 2026-11-25: salidas incluidas: 10(2026-11-26), 11(2026-11-25) · inventario del día: cantidad=21 consumo=5 total=16
cierre 2026-11-26: salidas incluidas: 10, 11                         · inventario del día: cantidad=18 consumo=2 total=16
```
* El inventario **al cierre del 25** ya descuenta el vale del 26 (consumo 5, total 16), mientras
  `reporteDelDia(estado, "2026-11-25")` lista solo el folio 11. El libro VALES del 25 también lleva el folio 10,
  fechado el 26.
* Vale con fecha futura (folio 12, `2026-12-31`, cantidad 1): en *Inventario* de hoy (`dia = hoy`) cuenta como
  CONSUMO de hoy (consumo = 3), pero `estadoAlCierre(estado, hoy)` lo excluye. *Inventario* y *Reporte diario* de
  hoy muestran TOTAL distintos para la misma partida (15 contra 16). Esto contradice la regla 6 de CLAUDE.md
  («el TOTAL es el mismo»).

Cómo se llega desde la interfaz, sin datos manipulados:
* `nuevoBorrador` (`servicios/vales.js:346`) fija `fecha = hoyIso()` **al crear** el borrador, y emitir no la
  actualiza. Un borrador que queda abierto de un día para otro se emite con la fecha del día anterior y un folio
  mayor que los vales de hoy: es el caso de arriba. Solo cambia el texto del botón («Fecha: 25 nov» en lugar de
  «hoy»).
* El selector de fecha del paso 1 (`ui/paginas/paraQuien.js:192`, `BotonFecha`) no tiene `max`, y `validarVale`
  (`servicios/vales.js:475`) solo valida la forma `AAAA-MM-DD`: se emiten vales con fecha futura sin aviso.

---

## 4. ALTO — Un borrador de salida se emite contra una partida que un conteo ya quitó: el consumo desaparece del inventario

`aplicarConteo` (`servicios/conteos.js:215-263`) con una corrección `quitar` revisa los **vales** emitidos durante
el conteo, pero no los **borradores** de salida. `validarVale` (`servicios/vales.js:504`) solo comprueba que la
partida exista (`indices.existencia(id)`), no `activo !== false`. Entradas sí lo bloquea (`servicios/entradas.js:396`).

Reproducción (Node):
```
borrador de salida con 2 de la partida 6 (código 702) → conteo de su contenedor con { existencia_id: 6, quitar: true } → aplicar
partida 6: activo=false, cantidad_conteo=0
validarVale → «Partida 1: la existencia es 0 y pides 2; escribe una justificación.»   (no dice que la partida ya no existe)
con justificación → emitido folio 10 sobre existencia_id 6 (inactiva)
filasInventario: la partida 6 no aparece → el consumo de 2 no se ve en ningún lado del inventario
```

---

## 5. MEDIO — Cantidades basura aceptadas como válidas

`dec()` acepta notación científica y guiones bajos, y nada pone un tope:
```
"1_000" → 1000     "_5_" → 5     "1__0" → 10
"1e40"  → 10000000000000000000000000000000000000000   (emitido; existencia queda en -1e40)
"1e-30" → 0.000000000000000000000000000001            (pasa «mayor que 0»)
"1e999999"  → texto de 1 000 000 de caracteres (60 ms);  "1e9999999" → 10 000 000 de caracteres
```
En el paso 2, `1e5` deja *Revisar y emitir* habilitado. Ese texto se guarda en el estado, viaja en cada
`structuredClone` de `Almacen.modificar` y en cada respaldo, y llega al Excel como número de 41 o más dígitos.
`"1,000.5"` (separador de miles) se convierte en `"1.000.5"`, que queda como «sin cantidad» sin decir por qué.

---

## 6. MEDIO — Celdas de texto de más de 32 767 caracteres en los libros exportados

Excel no admite más de 32 767 caracteres por celda y repara el libro al abrirlo. `xlsx/plantilla.js:167` escribe
`inlineStr` sin límite. Prueba: vale emitido con `observaciones`, `recibio_nombre` y `lote` de 40 000 caracteres
→ `exportarVales` → `xl/worksheets/sheet1.xml` con dos celdas de 40 000 caracteres (validador propio con expat).
Se llega desde la interfaz pegando texto: en `src/ui` solo el editor de etiquetas usa `maxlength`
(`editorEtiquetas.js:194`, `:443`).
Los caracteres de control sí se escapan bien (`_x0001_`…) y el XML sale bien formado.

---

## 7. MEDIO — Fechas de salida sin validar el calendario

`validarVale` (`servicios/vales.js:475`) acepta cualquier `\d{4}-\d{2}-\d{2}`. Con datos que no vienen del selector
de fecha (estado restaurado, copia interna, migración):
```
fecha "2026-02-30" → emitido; DIARIO exporta 02/03/2026
fecha "2026-13-45" → emitido; DIARIO exporta 14/02/2027      (serialExcel normaliza con Date.UTC)
fecha "0000-00-00" → emitido; DIARIO exporta el serial -30 (Excel muestra ####; Date.UTC(0,…) = 1900)
```
`reporteDelDia` nunca llega al día «2026-02-30» con ◀ ▶ (`sumarDias`), así que ese vale no sale en ningún reporte
diario. `validarConteo` (`conteos.js:175`) y `esFecha` de entradas (`entradas.js:475`) tienen la misma validación
de solo forma.

---

## 8. BAJO — `leerRespaldo` / `validarEstado` con respaldos dañados o manipulados

Todos con `crearZip` sobre un estado sintético:

| Entrada | Resultado |
|---|---|
| `manifiesto.json` con `{malo` | `SyntaxError` crudo (no `ErrorRespaldo`), `respaldos.js:92` |
| `estado.vales` con un `null` | `TypeError: Cannot read properties of null (reading 'folio')`, `respaldos.js:132` |
| `estado.vales[0].lineas = null` | se acepta y se migra; después `calcularSaldos` → `TypeError: vale.lineas is not iterable` |
| `folio` como texto (folio 9 = `"9"`) | se acepta; `siguienteFolio` (`vales.js:37-41`) devuelve `"91"` (concatena texto) |
| `secuencias = {}` | se acepta; los ids nuevos vuelven a empezar en 1 y chocan con los existentes |
| sin `formato` | «El respaldo es de una versión más nueva de la herramienta» (mensaje falso) |
| `config.inventario = "ZZZ"` | se restaura en DLTA como si fuera suyo (`inventarioPorId` cae al predeterminado) |
| entrada `plantillas/../fotos/x.jpg` | se acepta como plantilla con clave `../fotos/x.jpg` |
| tamaño descomprimido declarado `0xFFFFFFF0` | `inflateSync(…, { out: new Uint8Array(tamano) })` reserva ~4 GB (`zip.js:105-108`); en Edge, falla de memoria o pestaña caída |

---

## 9. BAJO — `nombreConFecha` reemplaza el primer bloque de 6 dígitos, no la fecha

`almacen/almacen.js:41-48`, regex `/\d{6}(?!\d)/` (primera coincidencia):
```
"INVENTARIO RIG 910001 280926.xlsx"    + 2026-12-05 → "INVENTARIO RIG 051226 280926.xlsx"   (la fecha vieja se queda)
"INVENTARIO 123456 RIG 91 280926.xlsx" + 2026-12-05 → "INVENTARIO 051226 RIG 91 280926.xlsx"
"INVENTARIO_20260926.xlsx"             + 2026-12-05 → "INVENTARIO_20051226.xlsx"              (se lee 26/12/2005)
```
`nombreFx` hereda el mismo nombre equivocado.

---

## 10. BAJO — El lector de Excel no reconoce hojas con prefijo de espacio de nombres

`xlsx/leer.js:31` (`<sheet\b`), `:169` (`indexOf("<sheetData")`), `:175` (`<row\b`) y los de `<c\b` / `<v>` / `<si>`
suponen el espacio de nombres predeterminado. Un `.xlsx` válido con
`xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` y `<x:sheetData>`, `<x:row>`, `<x:c>`
(así escriben el Open XML SDK y varios generadores de reportes): openpyxl lo lee bien, y `leerReporteAx` responde
«No encontré la columna "Código de Artículo". ¿Es el reporte de inventario de AX?». Archivo de prueba: tabla de 1
partida (`000000706`, SELLOS, INV, PZA, 555001, 3).

---

## 11. BAJO — Otros

* `leerJsonTolerante` (`servicios/jsonTolerante.js:250`): `"[".repeat(100000)` o `'{"a":'.repeat(100000)` →
  `RangeError: Maximum call stack size exceeded` crudo.
* `codigo128` translitera (`"ÑANDÚ 1/2\""` → barras de `NANDU 1/2"`, `"ABC\u0000"` → `ABC`, con `cambiado: true`):
  el código de barras impreso no coincide con el texto de la etiqueta. `"😀"` → null (sin barras).

---

## Lo que se atacó y resistió (para no repetirlo)

* Candado de pestaña única: con «Abrir aquí» en otra pestaña, la primera pasa a «Se abrió en otra ventana… Usar
  esta ventana» y no puede emitir; ráfagas de robos alternos no dejaron errores ni folios repetidos.
* XML exportado con caracteres de control, `￾`, surrogates sueltos, `]]>`, `<&>"'` y `_x0041_`: bien formado
  (expat) y openpyxl lo abre.
* HTML impreso (vale, conteo, revisión, etiquetas) escapado; la CSP usa hash para el script. Modelos de etiqueta
  ajenos pasan por `normalizarElemento`.
* QR: mensajes de más de 213 bytes se rechazan con mensaje claro; con emojis y acentos genera matriz válida.
* `__proto__` / `constructor.prototype` en el JSON de Copilot: no contamina prototipos.
* Corrupción del `estado.json` dentro del respaldo: se detecta (por accidente, porque el JSON queda inválido).
