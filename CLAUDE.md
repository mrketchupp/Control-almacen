# CLAUDE.md — Guía para sesiones de desarrollo

## Qué es este proyecto
Herramienta **web** para el almacén del RIG 91 que **guarda todo en el equipo del usuario**: inventario por contenedor, vales de salida y entrada con folio controlado, conciliación contra AX y exportación **idéntica** a los Excel actuales. Es un solo HTML autocontenido que corre en Edge, sin servidor ni instalación (la PC del almacén bloquea instaladores). Toda la planeación está en `docs/`. Léela antes de proponer cambios de diseño.

## Estado
- Fase 0 (planeación) y Fase 1 (núcleo, primera carga, exportación idéntica, interfaz) aceptadas; F1 se rehízo en web (la versión de escritorio en Python quedó en el historial, commit `93fd82a`).
- Fase 2 (vales de salida) **aceptada** (P-09 validado impreso, P-22 así está bien, P-23 lo corrige el usuario).
- Fase 3 (entradas, conteos, reacomodos) **entregada, en aceptación** — ver "Avance de la Fase 3" abajo.
- Antes de empezar cada fase nueva, confirma que el usuario dio luz verde. Siguiente: F4 conciliación AX (ver `docs/08-plan.md`).
- Formato del estado: `FORMATO_ESTADO = 5` (`src/nucleo/estado.js`, `migrarEstado`). El 3 agregó el tipo de área y la etapa de perforación; el 4, firmas extra, puesto de autoriza, fotos y quitó el folio mínimo (las áreas se completan leyendo otra vez la plantilla en `Almacen.iniciar`); el 5, `borradores_entrada`, `conteo_en_curso`, `reacomodos` y `alcance` de los conteos.
- Comandos: `npm ci` · `npm test` · `npm run build` (→ `dist/ControlAlmacen.html`). Las pruebas necesitan Python 3 con `openpyxl` (`tests/fixtures/requirements.txt`) para generar los Excel sintéticos.

## Avance de la Fase 3 (para retomar sin depender de la conversación)
Hecho (con pruebas unitarias y recorrido en Chromium con datos sintéticos, incluida la actualización desde la versión anterior):
- Núcleo: `src/servicios/entradas.js` (borradores, destino sugerido, variante nueva, vista previa, confirmar `E-0001`, corrección, devoluciones, historial), `conteos.js` (conteo en curso, aplicar total/parcial, sobrantes, vales durante el conteo, historial), `reacomodos.js`, `inventario.js` (renglón nuevo al final de su hoja, variantes parecidas, contenedores sugeridos). `cortesVigentes` en `nucleo/existencias.js` sustituye al "último conteo" como corte único.
- Exportación: `src/exportadores/entradas.js` (`VALES DE ENTRADA DLTA.xlsx`, tipo `ENTRADAS` en `Almacen.exportar`); hoja de conteo `src/impresion/conteo.js`.
- Interfaz: `ui/paginas/entradas.js` (captura), `entrada.js` (detalle y corrección), `conteo.js`, `inventario.js` (Mover), `historial.js` (pestañas Salidas/Entradas), exportar, inicio, ayuda, navegación.
- Docs 04, 05, 06, 08, 09, 10 y README actualizados.

Pendiente:
- ☐ Aceptación del usuario: registrar una entrada real y revisar el inventario exportado; hacer un conteo con la hoja impresa.
- ☐ Recorrido con los archivos reales del usuario (solo en local, nunca subirlos) como en rondas anteriores.
- ☐ P-08: confirmar con el usuario si las devoluciones se registran como entrada o corrigiendo el vale original (la herramienta permite ambas).
- Futuro (no es F3): leer el vale de la base desde Excel o foto (RF-35); resumen de guardia.

## Reglas no negociables
1. **Nunca subir datos reales** (Excel, PDF, respaldos `.zip`, nombres de personal). Solo fixtures sintéticas generadas por `tests/fixtures/generar.py`. Revisa `.gitignore` antes de cada commit.
2. **Los datos no salen del equipo.** Nada de servidores, APIs, analítica, CDNs ni fuentes externas. La página lleva CSP `default-src 'none'; connect-src 'none'` y todo va dentro del HTML. No agregues dependencias que necesiten red o `eval`.
3. **Exportación sobre plantilla con edición XML mínima** (`docs/03`, `docs/06`): solo se reescriben los fragmentos necesarios; las partes no tocadas se copian con sus bytes comprimidos originales. Prohibido reescribir los libros del usuario con una biblioteca genérica (openpyxl, SheetJS…): borra logos, botones con macro, `customXml` y configuración de impresora. `src/xlsx/nuevo.js` solo genera archivos **nuevos** (revisión, entradas, solicitud de ajuste).
4. **Nombres de hoja exactos**, con espacios finales incluidos: `CONTENEDOR #1 CONSUMIBLE `, `CONTENEDOR #5 CONSUMIBLE `, `MECANICO `, `OPERACION DIA `; encabezado `DESCRIPCIÓN `.
5. **Folios:** únicos, consecutivos (último + 1) y asignados dentro de un cambio atómico (`Almacen.modificar`, con el candado de pestaña única). **Todos se usan:** nunca se reutilizan, borran, cancelan ni saltan; un error se corrige con motivo y bitácora (el motivo se prellena con `resumenCambios`).
6. **Existencias derivadas de movimientos:** CONSUMO e INGRESO se calculan con los vales posteriores al último conteo (corte por **folio**), no se guardan sueltos.
7. **Datos vivos en IndexedDB; respaldos en la carpeta del usuario** (OneDrive) como `.zip` (estado JSON + plantillas + manifiesto). Todo cambio de formato del estado requiere subir `FORMATO_ESTADO` y migrar respaldos anteriores.
8. **Pruebas con Excel sintéticos**; si un caso real revela un problema, reprodúcelo en `generar.py` con datos inventados.

## Convenciones
- **Idioma:** interfaz, documentación, mensajes de commit y comentarios en español. Nombres del dominio en español (`Vale`, `Existencia`, `Folio`); términos técnicos genéricos pueden ir en inglés.
- JavaScript moderno (módulos ES), sin TypeScript ni JSX (Preact + `htm`). Dependencias mínimas y sin red.
- Capas: `nucleo/` no importa de `ui/`, `almacen/`, `importadores/` ni `exportadores/`. Todo lo que no es `ui/` ni `almacen/archivos.js`/`bd.js` debe correr en Node sin navegador.
- Fechas como texto ISO (`AAAA-MM-DD`) en el estado; hacia Excel, número de serie con el estilo de la plantilla.
- Cantidades como texto decimal en el estado y `Big` (big.js) en cálculos; nunca `float`.

## Verificación antes de cada commit
- `npm test && npm run build`
- En cambios a exportadores: prueba de "partes intactas" (las partes que no se debían tocar deben ser idénticas byte a byte a la plantilla).
- En cambios a importadores: el total por hoja y el número de renglones deben coincidir con la fixture.
- En cambios de interfaz: abrir `dist/ControlAlmacen.html` en Chromium (Playwright) y recorrer primera carga → nuevo vale → emitir → imprimir → exportar → respaldo sin errores en consola ni peticiones de red. En headless, sustituye `window.print` para que dispare `afterprint`.
- En cambios de impresión (`src/impresion/`): comparar contra el PDF de LibreOffice de la misma hoja (solo en local, nunca subir las imágenes).

## Hechos del dominio que es fácil olvidar
- AX corta `Tamaño` a 10 caracteres; el código AX viene como texto con ceros (`000000670`).
- En el formulario actual, un renglón sin O.C. no se guardaba (por eso siempre `S/OC`) y solo se guardaban 16–18 de los 21 renglones. **No replicar esos errores.**
- La columna `C.U` de DIARIO en realidad es el campo **LOTE** del vale.
- Diésel (código 136), oxígeno, acetileno y otros insumos van en vales pero **no** llevan existencia.
- Entrada vs. salida: `XXXXX` en "Pase de Entrada" (C) o en "Pase de Salida" (D) del DIARIO.
- Vales **internos** (tipo de área `INTERNO`): salen de `RIG 91 · ALMACEN` y llegan a `RIG 91 · <área>`; entregó = almacenista en turno; en observaciones solo cambia `ETAPA DE PERFORACION` (`src/nucleo/areas.js`). NOV es `EXTERNO` y TRANSFERENCIAS `TRANSFERENCIA` (P-22 pendiente).
- En el formulario, las partidas siguen el orden del vale impreso; lo que viene del inventario (contenedor, existencia) va en pastillas, no como columna.
- La hoja-formulario NOV pone al almacenista a la **derecha**; las capacidades de renglones varían por hoja (21/20/19): se leen del formato, no se suponen.
- Los vales nuevos dejan FAMILIA y TRANSFERENCIA/CONSUMO vacías (así vienen los recientes del Excel, P-13). Los cancelados de versiones anteriores se exportan como renglón en 0 con `CANCELADO – motivo`.
- NOV: la macro guardaba las firmas **por posición** (P = izquierda = químico, Q = derecha = almacenista). Los migrados quedan así (`firmasPorPosicion`/`conFirmasPorPapel` para mostrarlos); los nuevos se guardan por papel y el exportador los invierte con `almacenista_derecha`.
- Las fotos del formato NOV (imágenes sobre la zona de partidas) son espacios para las fotos del vale, no se imprimen; las partidas caben arriba (4).
- UI: no usar `<select>` ni `<datalist>`; usar `Lista`, `Combo` y `CampoSugerido` (`src/ui/componentes.js`).
- Entradas: folio interno propio (`E-0001`, consecutivo aparte de salidas); B del libro de entradas = folio de la base. Un renglón de entrada va a un renglón existente, a uno nuevo (variante existente en otro contenedor o variante nueva) o *sin existencia*.
- Conteos: cada renglón descuenta desde **su** conteo (`existencia.conteo_id`); un conteo parcial solo toca lo capturado. El reacomodo deja ambos renglones "recién contados" (conteo `tipo: REACOMODO`, que no se lista como conteo físico).
- El panel de datos del vale se arma por bloques (`bloques` en `EditorVale`) en el orden de `config.preferencias_vale[almacenista]` (`src/servicios/preferencias.js`). Un bloque nuevo se agrega en `BLOQUES_VALE` y en `bloques`; `normalizarOrden` lo inserta en su lugar para quien ya tenía preferencias.
