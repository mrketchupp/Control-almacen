# CLAUDE.md — Guía para sesiones de desarrollo

## Qué es este proyecto
Herramienta **web** para el almacén del EQUIPO que **guarda todo en el equipo del usuario**: inventario por contenedor, vales de salida y entrada con folio controlado, conciliación con Dynamics AX y exportación **idéntica** a los Excel actuales. Es un solo HTML autocontenido que corre en Edge, sin servidor ni instalación (la PC del almacén bloquea instaladores). Toda la planeación está en `docs/`. Léela antes de proponer cambios de diseño.

## Estado
- Fase 0 (planeación) y Fase 1 (núcleo, primera carga, exportación idéntica, interfaz) aceptadas; F1 se rehízo en web (la versión de escritorio en Python quedó en el historial, commit `93fd82a`).
- Fase 2 (vales de salida) **aceptada** (P-09 validado impreso, P-22 así está bien, P-23 lo corrige el usuario).
- Fase 3 (entradas, conteos, reacomodos) **entregada**; el usuario dio luz verde para F4 tras las rondas 5–8 — ver "Avance de la Fase 3" abajo.
- Fase 4 (conciliación con Dynamics AX) **entregada, en aceptación** — ver "Avance de la Fase 4". Rondas 9 a 15 de comentarios aplicadas (ver abajo).
- Ronda 17: **dos inventarios, Inventario A y Inventario B, por separado** — ver "Dos inventarios" abajo. Ronda 18: color de Inventario B en
  toda la interfaz, etapa de perforación compartida y vale impreso más fiel (bordes, rendijas, títulos de firma). Ronda 19:
  quitar áreas (borrar si nadie la usa, descartar si tiene vales) y personalización / captura / Mi pantalla compartidas.
- Ronda 20: **etiquetas de almacén** (el generador aparte, ahora dentro) — ver "Etiquetas" abajo y `docs/11-etiquetas.md`.
  Ronda 21: lista y bitácora de etiquetas **compartidas entre Inventario A y Inventario B**, leer el otro inventario sin cambiar y ventanas sin scroll.
- Ronda 22: **fecha de recibido** en los vales de entrada (manda en el inventario y el reporte diario) y **editor de
  diseños de etiqueta** a pantalla completa con QR y código de barras propios — ver "Ronda 22" abajo y
  `docs/12-ronda-22-plan.md`. Entregada, en aceptación.
- Ronda 23 (etapa 0 de la rutina de auditoría, con luz verde del usuario): **conteo de auditoría como base oficial**, FX
  dentro del Inventario B (solo la marca en el inventario y su libro de Excel aparte) y aviso de Kardex equivocado — ver
  "Base oficial y FX" abajo. Lo siguiente (marca FX en vales/entradas, alertas de repetidas y de "recibido sin registrar",
  conteo guiado por el Kardex, resumen de guardia, Kardex esperado) espera a que el usuario deje su inventario correcto.
- Ronda 24: **el Kardex reemplaza lo inventariable** (en lugar de emparejar uno a uno), el usuario **une las hojas con
  su inventario** (pantalla de parejas; sin revisar códigos), **listas de revisión** impresas (NP que se pierden y lo que
  sale), **NP editable** desde Inventario y **códigos de 3 dígitos = consumibles** en el Inventario B y FX — ver "Base
  oficial y FX" abajo. Entregada, en aceptación.
- Antes de empezar cada fase nueva, confirma que el usuario dio luz verde. Siguiente: F5 piloto en paralelo (ver `docs/08-plan.md`).
- Formato del estado: `FORMATO_ESTADO = 18` (`src/nucleo/estado.js`, `migrarEstado`; el 18, base oficial: `existencia.dueno`, partidas de baja y el conteo `tipo: "AUDITORIA"`). El 3 agregó el tipo de área y la etapa de perforación; el 4, firmas extra, puesto de autoriza, fotos y quitó el folio mínimo (las áreas se completan leyendo otra vez la plantilla en `Almacen.iniciar`); el 5, `borradores_entrada`, `conteo_en_curso`, `reacomodos` y `alcance` de los conteos; el 6, `cortes_ax`, `equivalencias_ax` y `config.almacen_ax`; el 7, `seguimientos_base` (archivo de vales de la base); el 8, `corte.asignaciones` (vales asignados a faltantes); el 9,
`config.inventario` (ids de `src/nucleo/inventarios.js`; los estados anteriores usan el inventario predeterminado) y, opcional, `config.vale_impreso` (textos y logos al imprimir); el 10,
`etiquetas` (`{ material, ax }` por imprimir) e `impresiones_etiquetas` (bitácora); el 11, ids `INV-n`, `origen.inventario`,
`vales: [{ inventario, vale_id, emitido_en }]`, `origen.emitido_en`, `etiquetas.cambiado_en` y `juntar` (Ronda 21); el 12
completa `emitido_en` de las marcas propias que no lo traían (una marca con `emitido_en` sin definir se reconoce por id: `marcaDe`); el 13,
`vale.fecha_recibido` en las entradas (las registradas = su `fecha`; los borradores = hoy).
- El 14 reúne ambas ramas: conserva los marcadores de correcciones generales y agrega la fecha mínima de justificantes de cada corte AX. Los estados 10 de la rama de vales también reciben la lista de etiquetas y las migraciones posteriores.
- La rama de vales incorporó en su formato 10 `vale.campos_encabezado_corregidos` y el marcador opcional `firmas_por_posicion`: las correcciones generales conservan las partidas y sus `encabezado_original`; la exportación aplica el encabezado vigente sólo a los campos elegidos. Los puestos y observaciones vacíos marcados tampoco heredan texto al imprimir.
- Mejoras de captura y ventanas: primera carga en tres pasos con revisión desplegable; navegación lateral contraíble, rail automático hasta 1100px y barra inferior hasta 700px (`app.js`, `estilos.css`). Transferencias protegen observaciones con edición explícita y separan su etapa sin fijar origen/destino. Entradas guardan `material_nuevo` opcional en borrador; el NP vacío se compara exactamente y no hereda otro NP, también en `capturaIA.js`.
- Conteos (formato 17): `conteo_en_curso.correcciones` permite cambiar dimensión/NP o quitar una partida desde el borrador, con revisión y confirmación; migración de 16 agrega `[]` a un conteo en captura. Sólo clave conserva cantidad/conteo_id/saldo. Quitar guarda `activo_anterior` y cero, conserva id/vales; `estadoAlCierre` restaura actividad para reportes anteriores. Las correcciones se registran en `conteo.correcciones` y auditoría. Pruebas de servicio y Chromium en `conteos` / `conteoCorrecciones`.
- Nombre del libro de Inventario B: `Almacen.nombreExportacion` y `Almacen.exportar` usan `VALES DE SALIDA <inventario>` con la extensión original, incluidos Reporte diario y Guardar como. Inventario A conserva su nombre de plantilla.
- Historial: `servicios/correccionLotes.js` permite corregir datos generales de entradas y salidas en un solo `Almacen.modificar`, con revisión y motivo. Personas propaga puestos sólo tras confirmación (`guardarPersona` con `{ actualizarVales: true }`). La impresión mide las claves largas y las descripciones (`ajustarAlturasClaves` en `impresion/vale.js`; la descripción se parte en líneas aunque su celda del formato no tenga ajuste de texto y conserva su alineación), amplía sus filas y recupera espacio de filas vacías sin cambiar la plantilla guardada.
- Descripción de los códigos: `servicios/articulos.js` (`corregirDescripcion`, `bitacoraDeDescripcion`) cambia `articulos[codigo].descripcion` (mayúsculas, sin espacios sobrantes), lo deja en `auditoria` (`articulo` / `CORREGIR_DESCRIPCION`) y actualiza las partidas de borradores de salida, entrada y conteo que traían la anterior; los vales emitidos no se tocan. No cambia el formato del estado. UI: `ui/paginas/descripcion.js` (`EditorDescripcion`, `BotonDescripcion`: lápiz junto a la descripción en `EditorVale`, `EditorEntrada`, los encontrados del conteo y el inventario, que además lo tiene en el menú contextual); cada editor la copia a sus partidas con `conDescripcion` y `BotonDescripcion` llama a la versión más reciente al terminar. `resumenCambios` / `resumenCambiosEntrada` reconocen el cambio de descripción de una partida (con otro código no se repite). `exportadores/inventario.js` reescribe `ARTICULOS_MX` también cuando alguna descripción difiere de la de la plantilla. Pruebas `articulos.test.js` y Chromium `descripcionCodigo.navegador.mjs`.
- Corrección individual del historial: el editor permite cambiar `entrego_puesto` también en migrados; el resumen reconoce el cambio de puesto y la impresión respeta vacíos explícitos mediante los marcadores existentes. Los roles de firmas por posición se conservan. Cambiar sólo el encabezado conserva las partidas originales.
- Navegación del historial: memoria de filtros, pestaña, filas desplegadas y scroll por inventario y tipo de vale en `ui/memoriaHistorial.js`, fuera del estado de negocio. El marco captura la posición antes de navegar y la lista la restaura después de renderizar; quitar filtros vuelve al inicio. No cambia el formato de respaldos.
- Reporte diario Inventario B: `exportadores/vales.js` hace visibles las filas de DIARIO, limpia filtros y ordenaciones activos de la plantilla y actualiza los rangos de sus tablas relacionadas y autofiltros; conserva las vistas personalizadas, totales, macros y partes ajenas. Así los vales nuevos no quedan ocultos ni fuera de una tabla antigua. Pruebas sintéticas `reporteGsm.test.js` y descargas reales en Chromium `reporteGsm.navegador.mjs` (2964 → 2930 → 2964 según el día, con control Inventario A). No cambia el estado ni su formato.
- Fusión con etiquetas: `corregirInventarioParaAx` prepara una etiqueta de Material por partida física modificada al emparejar con AX (individual, seguras o solo en físico). `useCorreccion` retira esas etiquetas al deshacer y conserva el resto de la lista.
- AX con varios NP: `emparejar` agrupa todas las variantes exactas de una dimensión y unidad (`misma_dimension`), dando prioridad a las partidas con Color y conservando el físico una sola vez en duplicados de AX. `servicios/vinculosAx.js` permite elegir variantes por corte con revisión del resultado completo, auditoría y Deshacer protegido; `ui/paginas/fisicoAx.js` se abre en Justificar y la vista por partida del Reporte AX / Diferencias. Formato 15: `corte.vinculos_fisicos`; migración desde 14 agrega `[]`. Los vínculos reservan sus variantes antes del automático, siguen `unida_a` y, si pierden una referencia, quedan por confirmar. El vínculo simple conserva cantidades, claves, vales y etiquetas. Regresión unitaria y en Chromium: `tests/conciliacionGrupos.*`.
- Revisión AX: `servicios/correccionAx.js` simula sobre una copia el resultado y las etiquetas de una corrección individual o de corregir y vincular varias partidas. La selección ofrece corregir las claves y preparar etiquetas opcionalmente; conserva cantidades y vales, NP salvo Color repetido. `EditorClave` muestra destino AX del corte, físico, tránsito y etiquetas antes de confirmar y abre la selección múltiple del mismo destino. `servicios/deshacerCorreccion.js` revierte sólo lo tocado, incluyendo vínculos, y protege ediciones posteriores; `tests/correccionAx.test.js`.
- Unidades AX: `nucleo/unidades.js` reconoce abreviaturas equivalentes (`EA`, `UND`, `PCS`, `PZA.`…) sin cambiar cantidades. Las unidades diferentes exigen activar **Corregir la unidad del inventario a la de AX** e indicar una equivalencia positiva por variante (`origen` en físico = `destino` en AX; 1 = 1 si estaba mal anotada). `servicios/unidadesAx.js` convierte el conteo y conserva los vales originales: formato 16, `existencia.conversiones_um` y `factores_um_vales` con fracciones exactas por partida de vale. El cálculo de saldos y tránsito usa la unidad física vigente; las asignaciones guardan `cantidad_vale` en la unidad original y la solicitud exporta cantidad y UM vigentes. Revisión de cantidades y etiquetas por partida; Deshacer protege vales nuevos o editados después de la conversión. Dimensión, NP y UM corregidos persisten para emparejar automáticamente futuros cortes, sin copiar los vínculos del corte. Pruebas `unidadesAx`, `conversionUnidadesAx` y Chromium.
- Justificantes AX: `corte.fecha_minima_vales`, propuesta = 1 de noviembre del año anterior al reporte, editable por corte en *Justificar faltantes*. `nucleo/justificantes.js` aplica el mismo límite a sugerencias, asignación manual, tránsito y exportación. Las asignaciones antiguas fuera del periodo se conservan para revisión y no cuentan. Auditoría `CAMBIAR_FECHA_MINIMA_VALES`; no modifica los vales ni el inventario.
- Menús contextuales: `ui/menuContextual.js` provee `useMenuContextual`; `Tabla.menuFila` agrega acciones optativas por partida. Se usan en diseños, elementos / capas / lienzo, etiquetas pendientes, historial, encabezados de vales e inventario. Sólo acciones vigentes; campos de captura, texto seleccionado, Mayús + clic derecho y zonas sin acciones conservan el menú nativo. Teclado Mayús+F10 / tecla de menú, flechas, Inicio / Fin y Escape; portal fuera de ventanas y oculto al imprimir. `ui/portapapelesElementos.js` valida el JSON propio y mantiene una copia en memoria si el navegador bloquea su portapapeles. `lienzo.pegarElemento` normaliza, limita, asigna id libre y conserva Deshacer / Rehacer; Ctrl+C/X/V sólo para elementos, edición de texto nativa. No cambia el formato del estado. Regresión en `tests/menuContextual.navegador.mjs` (Chromium).
- Comandos: `npm ci` · `npm test` · `npm run build` (→ `dist/ControlAlmacen.html`). Las pruebas necesitan Python 3 con `openpyxl` (`tests/fixtures/requirements.txt`) para generar los Excel sintéticos.

## Avance de la Fase 3 (para retomar sin depender de la conversación)
Hecho (con pruebas unitarias y recorrido en Chromium con datos sintéticos, incluida la actualización desde la versión anterior):
- Núcleo: `src/servicios/entradas.js` (borradores, destino sugerido, variante nueva, vista previa, confirmar `E-0001`, corrección, devoluciones, historial), `conteos.js` (conteo en curso, aplicar total/parcial, sobrantes, vales durante el conteo, historial), `reacomodos.js`, `inventario.js` (renglón nuevo al final de su hoja, variantes parecidas, contenedores sugeridos). `cortesVigentes` en `nucleo/existencias.js` sustituye al "último conteo" como corte único.
- Exportación: `src/exportadores/entradas.js` (`VALES DE ENTRADA <inventario>.xlsx`, tipo `ENTRADAS` en `Almacen.exportar`); hoja de conteo `src/impresion/conteo.js`.
- Interfaz: `ui/paginas/entradas.js` (captura), `entrada.js` (detalle y corrección), `conteo.js`, `inventario.js` (Mover), `historial.js` (pestañas Salidas/Entradas), exportar, inicio, ayuda, navegación.
- Docs 04, 05, 06, 08, 09, 10 y README actualizados.

Pendiente:
- ☐ Aceptación del usuario: registrar una entrada real y revisar el inventario exportado; hacer un conteo con la hoja impresa.
- ☐ Recorrido con los archivos reales del usuario (solo en local, nunca subirlos) como en rondas anteriores.
- Ronda 5 de comentarios aplicada (ver `docs/08-plan.md`): Deshacer al descartar, clave/lote, entradas sin motivo, hoja de conteo, captura con Copilot, menú *Ajustes y más*, inicio bento.
- Ronda 6 aplicada: reporte diario = libros al cierre del día (`servicios/corte.js`; se quitó el PNG), entradas rediseñadas (modo manual/asistida, barra fija, tarjetas, Solicita = LOTE, JSON tolerante), *Ajustes y más* en primer plano, personalización (tema, avisos, animaciones).
- Ronda 7 aplicada: *Ajustes y más* más amplia (`.ventana.ventana-mas`, container query en la vista previa), bento de Etapa de perforación en el inicio (en lugar de Inventario), *Reporte diario* en el menú (sin fecha en el inicio) y descargas explícitas en el reporte.
- Ronda 8 aplicada: NP en entradas (`separarNp`, `conNpEscrito`, `conClaveYNp`), filtros de lo que requiere atención en la barra, Copilot con *Pegar* y transición suave, unificar personas repetidas (`servicios/personas.js`). Falta que el usuario la revise.
- Futuro (no es F3): leer el vale de la base desde Excel o foto (RF-35); resumen de guardia.

## Avance de la Fase 4
Hecho (pruebas `tests/conciliacion.test.js` con el reporte AX sintético de `generar.py` y recorrido en Chromium):
- `src/importadores/ax.js` (`leerReporteAx`: columnas por nombre, almacenes, fecha del nombre; `delAlmacen`).
- `src/servicios/conciliacion.js`: cortes (`registrarCorteAx`, `fijarFolioCorte`, `quitarCorteAx`), emparejamiento en
  tres niveles (`emparejar`, `confirmarPareja`, `olvidarPareja`; la pareja se calcula, solo se guardan equivalencias),
  tránsito (`transitoDesde`: por folio o fecha; partidas migradas anteriores al conteo cuentan) y `conciliar` (vistas,
  listas sin pareja, resumen, valuación).
- `src/exportadores/ajuste.js` (`SOLICITUD DE AJUSTE DDMMAA.xlsx`, tipo `AJUSTE` en `Almacen.exportar` con `corteAx`, `todos`).
- `ui/paginas/conciliacion.js` (menú *conciliación con Dynamics AX*).
- Ronda 9: solo modelo **INV** (`lineasInv`, `codigosNoInv`); confirmar una pareja **corrige el inventario**
  (`confirmarPareja` → `corregirDimensionNp` en `servicios/inventario.js`; `confirmarSeguras`); "no está en el físico"
  vive en `corte.sin_pareja`; las `equivalencias_ax` viejas se proponen como `recordada`. UI en bento (masonry) con
  ventanas por sección; editor compartido `ui/paginas/clave.js` (`EditorClave`, `useCorreccion` con Deshacer), también
  en *Inventario → Editar*. Solicitud de ajuste con columna *Estado* y `COLORES_ESTADO`.
- Ronda 10: **Tamaño + Color = dimensión** (AX no trae NP): `dimensionAx`, `valoresAx` (el NP se conserva salvo que fuera el
  Color), sugerencias de AX solo para la dimensión; la solicitud de ajuste va primero en el bento (`filasSolicitud` cuenta
  sus partidas). Revisión general: masonry con `grid-row: auto / span N` (un `span` en el inicio, como `.bento-ancha`,
  encimaba las celdas), `.boton-quitar` compacto solo en tarjetas de entrada, tokens `--sobre-primario`/`--sobre-intenso`
  para texto sobre fondos de color en tema oscuro, foco visible en todos los botones, pestañas "Borrador N", y *Ayuda →
  Abrirla como aplicación* (acceso directo `msedge.exe --app="file:///…"`, `destinoAplicacion`).
- Ronda 11: **una variante solo es pareja de una partida de AX**. En *Por confirmar* los candidatos y *Otra…* solo traen
  variantes libres (ni exactas ni confirmadas con otra partida; `par.ocupadas` cuenta las ocultas); cada libre se sugiere a
  una sola partida (reparto por mayor puntaje). `confirmarPareja` rechaza una variante ya emparejada o una corrección que
  la juntaría con una emparejada (`previaCorreccion(...).otra`).
- Ronda 12: **archivo de vales de la base** (su copia del DIARIO con INV/NINV, TIPO DE MOV, CANTIDAD aplicada, TR, IN,
  COMENTARIOS): `importadores/base.js` (`leerArchivoBase`, columnas por nombre, fecha del nombre o de `docProps/core.xml`),
  `servicios/seguimiento.js` (`registrarSeguimiento`, `seguimientoVigente`, `clasificar`, `estadoAxDeVales` → estado AX
  por partida y avisos, `sinAplicar`), `transitoDesde` cuenta lo que no tiene IN/TR (marca `sin IN/TR`) y deja NO INV como
  pista (`no_inv`). UI `ui/paginas/base.js` (`ImportarBase`, `MosaicoBase`, `VentanaBase`, `PastillaAx`); historial
  (columna AX, filtro *Revisar*) y detalle del vale (columna *AX (base)*).
  **Partidas duplicadas** en un vale (`partidasDuplicadas`, `duplicadasEnVales` en `servicios/vales.js`): marca, filtro y
  *Quitar duplicadas…* (`Correccion` con `quitar`). Fixture `generar_base` / `SEGUIMIENTO_BASE`; pruebas `tests/seguimiento.test.js`.
- Ronda 13: **la fecha del archivo de la base no importa** (se guarda solo el último; `guardado` es informativo): sin
  folio IN/TR = puede justificar (`SIN_FOLIO_AX`: pendiente, parcial, sin_revisar, sin_registro y `posterior` = vale
  después del último folio del archivo); la duplicada que la base no tiene no cuenta. La fecha que importa es la del
  reporte de AX. Vista **Todos** = kardex completo: `conciliar(...).general` (emparejadas + por confirmar con estado
  `por_confirmar` + sin físico + solo en el físico), filtro *Por confirmar*, mosaico *Todo el reporte de AX*, casilla
  *Incluir lo que solo está en el físico*, *Confirmar…* abre `VentanaConfirmar` con `textoInicial`.
- Ronda 14: **justificar faltantes** (`servicios/justificacion.js`: `justificables`, `candidatos` con estado libre / otra /
  en_ax / sin_base / posterior_conteo / aqui, `sugerencias` + `mejorCombinacion` (exacta con menos vales o lo más cerca sin
  pasarse), `asignarVales`, `asignarSugeridas`, `quitarAsignaciones`); `corte.asignaciones` (formato 8) las usa
  `transitoDesde` (marca `asignado`, `porLinea`, `porLineaAx`, `partidas` por grupo, `varianteVigente`). Solicitud de ajuste:
  hoja `LEYENDA` primero, la de AX igual, `VALES POR APLICAR` (`valesPorAplicar`). Entradas en los folios = `folio_externo`
  (`folioDeVale`). UI: `ui/paginas/justificar.js` (`VentanaJustificar`), página con `.concilia-layout` (bento de acciones +
  `aside.concilia-resumen` con `Cifra`), `VentanaEmparejar` (pestañas distinto / solo en el físico / solo en AX).
  Renombres: Enviar a la base, Por resolver, Emparejar con AX, Reporte AX, Consumos de la base.
- Ronda 15: **AX sin dimensión** (Tamaño y Color vacíos o `S/D`): `emparejar` le da un `grupo` de variantes (método
  `todo_el_codigo` si es su única partida en AX; si no, `sin_dimension` = las variantes `sinDimension`), confirmado y sin
  corregir el inventario. `conciliar` arma las filas con `agruparPares` (componentes por variante compartida):
  `variante_ids`, `variantes`, físico sumado, `lugares[].detalle`; `textoFisico` / `textoVariante`. `sinDimension()` en
  `nucleo/normalizar.js`. Fixture: 711 (sin dimensión + MOD:A1) y 714 (todo el código).
- Ronda 16 (no es de F4): **inventario diario** — `calcularSaldos(estado, ids, { dia })` pasa los vales de días anteriores a
  la CANTIDAD (`saldo.conteo` = lo contado); lo usan `filasInventario(estado, { dia = hoy })` y `exportarInventario(…, { fecha })`.
- Ronda 17 (no es de F4): ver "Dos inventarios".
Pendiente: ☐ probar con el corte real del usuario (solo en local) y ajustar el puntaje/normalización si algo no empareja;
☐ que el usuario importe un archivo de la base con todos los vales hasta la fecha del reporte de AX.

## Dos inventarios (Ronda 17)
- `src/nucleo/inventarios.js`: `INVENTARIOS` define los ids, bases de IndexedDB, prefijos de respaldo, marcas de archivo y almacén propuesto de cada inventario. Sus valores canónicos se conservan en ese módulo. Helpers: `inventarioPorId`, `inventarioDe`, `inventarioDelNombre`, `deOtroInventario` y `otrosInventarios`.
- **Cada inventario es un estado aparte en su propia base de IndexedDB** (estado, plantillas, ajustes, copias internas):
  nunca se mezclan. `Almacen(backend, { inventario })`; `main.js` abre el último usado (`localStorage` solo para el
  arranque) y cambia en la misma pestaña (`Sesion.cambiarInventario` → nueva `Sesion`, `render` con otra `key`).
- Respaldos: `nombreRespaldo(…, inventario)`, `infoDeNombre(nombre, inventario)`, `respaldosABorrar(…, { inventario })`;
  `revisarInventario(estado, actual)` rechaza restaurar uno del otro; `cargarPrimeraVez` rechaza datos ajenos.
- Nombres: `nombreEntradas(inv)` = `VALES DE ENTRADA <inv>.xlsx`; `nombreSolicitud(fecha, inv)` =
  `SOLICITUD DE AJUSTE <inv> DDMMAA.xlsx`; *Revision historial <inv> DDMMAA.xlsx*.
- UI: `ui/inventario.js` (`SelectorInventario` en la cabecera, `seguirConArchivo` = confirmar si el nombre dice el otro);
  `<html data-inventario>` y tokens `--inventario`, `--inventario-suave`, `--sobre-inventario` (Inventario B morado).
- **Vale impreso por inventario** (*Ajustes*, `ui/paginas/valeImpreso.js`): se imprime con lo del libro de vales cargado;
  `config.vale_impreso` solo corrige. `impresion/identidad.js` (`reemplazarTextos`, `identidadDe`, `imagenesConIdentidad`,
  `encabezadoDelFormato`, `textosDelFormato`, `logosDelFormato`; huella de imagen `huellaImagen` en `formulario.js`) y
  `servicios/valeImpreso.js` (`guardarTextosVale`, `fijarLogoVale`). Los reemplazos aplican a lo fijo del formato y al
  encabezado/pie de página, **nunca** a lo capturado en el vale. Fixture: `ALMACÉN A` / `CALLE FICTICIA 123` (inventados).
  Valen para todas las hojas (la UI lo dice).
- **Ronda 18:** en Inventario B `:root[data-inventario="<id>"]` redefine también `--primario`, `--primario-hover`,
  `--primario-suave` y `--sobre-primario` (claro y oscuro): toda la interfaz en morado. **Etapa compartida:**
  `almacen/compartidos.js` (`Compartidos`, `adoptarCompartidos`, `BD_COMUN = "control-almacen-comun"`; Ronda 19:
  `VALORES_COMPARTIDOS` = etapa_perforacion, personalizacion, captura_rapida, preferencias_vale; gana el último cambio
  completo); `Almacen._avisar(origen)`
  con `cambio` / `carga` / `restaurar` / `borrar`; `Sesion` lo crea con `{ comun }` y `main.js` espera `compartidos.terminar()`
  antes de cambiar de inventario. **Impresión:** `enRejilla`, `grosorEscalado`, `capaFondos` (`impresion/vale.js`) y
  `centrarTitulosFirma` (`impresion/formulario.js`, celdas virtuales en `combinadaEn`, `modelo.centradas`, `estiloTextoDe`).
- **Ronda 19 — áreas:** `usosDeArea`, `descartarArea` (`activo: false`), `borrarArea` (solo sin vales ni borradores) y
  `reponerArea` (Deshacer) en `servicios/catalogos.js`; UI `useQuitarArea` en `ui/paginas/areas.js`. Un área en uso nunca se
  borra (sus vales la necesitan para imprimirse).

## Etiquetas (Ronda 20)
- Decisiones del usuario: el generador (`generador-etiquetas-almacen`) **se queda** para el teléfono y aquí se importa su
  `.json` (`leerListaGenerador`, formato `etiquetas-almacen`; no se cambia el generador). Entrada = **una por pieza**,
  inventario = **una por partida**, unidades continuas o decimales = 1 (`cantidadPropuesta`). NOMBRE = **AX** (`nombresAx`,
  reporte más reciente) o la descripción del inventario. ÁREA **vacía**. **CONDICIÓN → INVENTARIO** (Inventario A / Inventario B, el
  abierto, editable por etiqueta; lleva el logo de su inventario). DESCRIPCIÓN = `OC: …` en entradas. Logos propuestos
  **del libro de vales** del inventario abierto. Al imprimir, **¿Salieron bien?** → `registrarImpresion` (bitácora y
  marca de la entrada; opcionalmente quita de la lista).
- `src/servicios/etiquetas.js` (propuestas `etiquetaDeExistencia` / `etiquetasDeEntrada`, `buscarEntradas` por folio
  interno o de la base, lista `agregarEtiquetas`…`reponerEtiquetas`, `impresionesPorVale`, `entradasSinEtiquetas`,
  `configEtiquetas`, `fijarDiseno`, `fijarIdentidad`), `src/impresion/etiquetas.js` (`cuadricula` = la del generador,
  `PLANTILLAS` con J-5163, `documentoEtiquetas` escapado, `vista: true` sin `@page`; al imprimir, hojas en bloque, no
  flex), `ui/paginas/etiquetas.js` (`PaginaEtiquetas`, `EtiquetasDeEntrada`, `VistaPreviaEtiquetas`, `EstadoEtiquetas`).
- `config.etiquetas` (diseño + identidad por inventario) está en `VALORES_COMPARTIDOS`; la bitácora de sincronización
  anota las imágenes por tamaño (`sinImagenes`). Las etiquetas son copias: nunca cambian el inventario ni los vales.
- **Ronda 21 — Inventario A y Inventario B juntos:** `estado.etiquetas` y `estado.impresiones_etiquetas` también son compartidos
  (`EN_ESTADO` en `almacen/compartidos.js`: claves `etiquetas_por_imprimir` / `impresiones_etiquetas`, sin auditoría; cada
  clave con `leer` / `poner` / `adoptar` / `publicable`). Lista: gana `cambiado_en` más nuevo (`adoptarListaEtiquetas`,
  `tocar` en cada cambio, `marca()` nunca baja; `juntar` une una vez la del formato 10, nunca al restaurar:
  `sincronizar({ juntar: false })`); bitácora: `juntarImpresiones` (unión por id + fecha). Ids `nuevoId` =
  `<inv>-<n>-<momento>`; `origen.inventario` y `origen.emitido_en`. **Las marcas se buscan por `claveDeVale(vale)`
  (id + `emitido_en`)**: los ids de vale se repiten tras restaurar. `impresionesPorVale(estado, inv)` /
  `entradasEnLista(estado, inv)` devuelven mapas con esa llave; `registroParaLeer(abierto, copia)` suma lo que la copia
  del otro aún no compartió; `entradasSinEtiquetas(estado, { registro })`. **Leer el otro inventario:** `main.js` `leerOtroInventario` (no crea la base
  si no existe) → `Sesion.estadoDeInventario(id)` (copia migrada; nunca se escribe) → hook `useEstadoDe` y selector
  `DeInventario` en las ventanas. Ventanas `.ventana-etq` (alto casi completo, tabla flexible, pie sticky).

## Ronda 22
- **Fecha de recibido (A):** `vale.fecha_recibido` en entradas (formato 13); `fecha` sigue siendo la **del vale** (la llena
  Copilot). `fechaDelDia(vale)` (`nucleo/fechas.js`) = recibido en entradas, `fecha` en salidas: la usan `calcularSaldos({ dia })`,
  `estadoAlCierre` / `entradasAlCierre` (las entradas se filtran por recibido, ya no por E-folio: `entrada` = folio más alto
  incluido y `fuera` = los menores recibidos después), `reporteDelDia`, `resumen.entradas_hoy`, `filasEntradas` /
  `filtrarEntradas` (columnas *Fecha del vale* y *Recibido*; filtros por recibido). **La conciliación con Dynamics AX, el tránsito, la
  justificación y la base siguen con la fecha del vale** (P-25 en docs/09). Validación en `servicios/entradas.js`: recibido
  obligatoria, no futura y no posterior al día del registro (bloquean); avisos: anterior al vale y conteo físico posterior
  que pudo contarla. Se corrige con motivo (ETIQUETAS «Recibido»). El libro VALES DE ENTRADA lleva FECHA RECIBIDO al final (V).
- **Diseños de etiqueta (B):** en el código se llaman **modelos** (`diseno` sigue siendo la hoja y las medidas). Datos en
  `config.etiquetas` (compartida Inventario A/Inventario B): `modelos: [{ id, nombre, elementos, … }]` y `modelo_por_tipo: { material, ax }`;
  sin elegir = el de fábrica (`fabrica-material`, `fabrica-ax`, constantes en `impresion/modelos.js`, nunca en el estado).
  Elementos en % de la etiqueta (`normalizarElemento` / `normalizarModelo` estrictos: el modelo llega del otro inventario y
  de respaldos, es entrada no confiable); letra = % del alto. Render único en `impresion/etiquetas.js` (`documentoEtiquetas`
  con `modelo`, `htmlElemento`, `cssEtiqueta`, `muestraEtiqueta`, `llenarPlantilla` con `{campo}`, `avisosElemento`; borde con
  `.etq::after`; `diseno.fuente` ya no cambia el tamaño). QR propio `impresion/qr.js` (modo byte, M, v1–10) y Code 128 propio
  `impresion/barras.js` (B/C), probados contra referencias de `qrcode` / `python-barcode` generadas una vez
  (`tests/fixtures/qr_referencia.py`, `barras_referencia.py`; esas bibliotecas NO son dependencias). Servicio:
  `modelosEtiqueta`, `modeloDe`, `guardarModeloEtiqueta`, `borrarModeloEtiqueta` / `reponerModeloEtiqueta`, `usarModelo`,
  `nombreParaCopia`. Editor `ui/paginas/editorEtiquetas.js` (`EditorDisenos`, pantalla completa) con la lógica sin DOM en
  `impresion/lienzo.js` (zoom, imán, guías, deshacer). En la página: *Hoja y logos* (medidas) y *Editor de diseños*.

## Base oficial y FX (Rondas 23 y 24)
- **Kardex de auditoría** = reporte de AX (un libro con una hoja por inventario o un archivo por inventario) con columnas
  `Conteo` / `Conteo Fisico` y `Contenedor`. `leerReporteAx` lee **todas** las hojas (`tablas`; la primera sigue arriba)
  y, si vienen, `sitio`, `cantidad_financiera`, `conteo`, `contenedor`.
- **Ronda 24 — qué hoja es de qué inventario lo decide el usuario**: `ui/paginas/auditoria.js` (`Relacionar`, como el
  juego de unir parejas: DLTA / GSM / FX contra las hojas; colores `--rel-DLTA`, `--rel-GSM`, `--rel-FX`). El Kardex
  cargado y las parejas viven en `pendiente` (módulo, solo en memoria) para aplicar el otro inventario sin volver a
  cargarlo: *Ir a …* = `sesion.cambiarInventario(id, { pagina: "#conteo" })`. `servicios/kardex.js` ya no revisa
  códigos: `marcaDeHoja` (por el nombre) y `hojaParaConciliar` (solo propone; sin aviso ni casilla).
- `servicios/baseOficial.js` (**reemplazo**): `analizarKardex(estado, hojas, { fecha, folioSalida })` empareja **cada hoja
  por su lado** (`hojas = [{ hoja, uso: "propio" | "FX", tabla }]`; las líneas de 3 dígitos en el Inventario B / FX van
  a `porRegla`). `planBaseOficial(estado, analisis, { ubicaciones })`: solo una pareja confirmada de **una** variante
  conserva su partida (`varianteIdentica`: cuentan las variantes con partidas inventariables vivas y, si las hay, las del
  mismo dueño; si AX junta varias, la que se escribe exactamente como AX, salvo sin dimensión); una con una, primero el
  mismo dueño, luego el contenedor del conteo y la cantidad más cercana. Lo demás = `nuevas` con la escritura de AX
  (`dimensionAx`, `umPara`) en la hoja INV del contenedor anotado (`ubicaciones[clave]` si no existe; si no, donde
  estaba el código); varias variantes que AX junta → una partida (`junta`). Lo inventariable que no quedó → baja
  (`sustituidas` si el código viene en el Kardex, `retiradas` si no), solo de los dueños de las hojas unidas; las que
  tienen vales posteriores pasan sus partidas a la que las reemplaza (`religar`) o, sin reemplazo, quedan en
  `sinRetirar`. `listaNp` / `listaRetiradas` → `conteo.revision` (texto para imprimir: `impresion/revision.js`,
  `documentoRevision`; `listasDeRevision`, `npAnteriores`). `porCodigo` = cambios por artículo con impacto en $.
  **Lo consumible no se toca.** `aplicarBaseOficial` registra el conteo AUDITORIA (`nuevos`, `bajas`, `religadas`,
  `revision`) y **siempre** el Disponible de la hoja propia como reporte de AX con la fecha del conteo (sin casilla:
  el mismo archivo sirve en las dos partes; si ya estaba importado, `corteConHuella`, no se repite). Aplicar dos veces el mismo Kardex no cambia nada (probado con los archivos
  reales en local; los casos que lo rompían están inventados en la fixture: dos escrituras de AX, Color `S/N`, FX sin
  dimensión). `esExacto` (conciliación) acepta la dimensión escrita como Tamaño + Color aunque el Color sea `S/N`.
- **3 dígitos**: `soloConsumible(inventario, codigo)` (`nucleo/inventarios.js`) — en GSM / FX los códigos < 1000 son
  consumibles: no se aplican del Kardex, no se dan de baja y no se dan de alta en hojas INV (entradas, conteos;
  `ubicacionesSugeridas` las manda al final). En DLTA no aplica.
- **NP rápido** en *Inventario*: lápiz en la columna NP (`EditarNp`, `corregirDimensionNp` con la misma dimensión,
  sugiere `npAnteriores` y los NP del código); tarjeta *Listas de revisión de la auditoría* en *Conteo físico*
  (imprimir y **Limpiar la lista** con Deshacer: `limpiarListaRevision` / `reponerListaRevision`, auditoría
  `LIMPIAR_LISTA_REVISION`; un conteo con las dos listas vacías ya no se muestra).
- FX: `DUENO_FX`, `duenoDe`, `diceFx` en `nucleo/inventarios.js`. `exportarInventario(…, { dueno })`, tipo `INVENTARIO_FX`
  en `Almacen.exportar` con `nombreFx`; `hayPartidasFx`; `fisicoPorVariante({ dueno })` y `transitoDesde` por
  `corte.dueno`. `filasInventario` ya no lista partidas inactivas y trae `dueno`. Pastilla `.pastilla-fx` (tokens
  `--fx`, `--fx-suave`) y filtro *Material* en *Inventario*. `estadoAlCierre` deshace también dueño, bajas y nuevas
  (y las `movidas` de los conteos de la Ronda 23).
- Fixture: `generar_kardex` (`KARDEX AUDITORIA SINTETICO 261026.xlsx`, hojas FX, GSM y PRINCIPAL sin nombre de
  inventario) e `inventario_gsm` (códigos de 4 dígitos); pruebas `tests/baseOficial.test.js` y Chromium
  `tests/baseOficial.navegador.mjs` (unir, imprimir listas, aplicar DLTA y luego GSM en la misma pestaña, NP rápido).

## Reglas no negociables
1. **Nunca subir datos reales** (Excel, PDF, respaldos `.zip`, nombres de personal). Solo fixtures sintéticas generadas por `tests/fixtures/generar.py`. Revisa `.gitignore` antes de cada commit.
2. **Los datos no salen del equipo.** Nada de servidores, APIs, analítica, CDNs ni fuentes externas. La página lleva CSP `default-src 'none'; connect-src 'none'` y todo va dentro del HTML. No agregues dependencias que necesiten red o `eval`.
3. **Exportación sobre plantilla con edición XML mínima** (`docs/03`, `docs/06`): solo se reescriben los fragmentos necesarios; las partes no tocadas se copian con sus bytes comprimidos originales. Prohibido reescribir los libros del usuario con una biblioteca genérica (openpyxl, SheetJS…): borra logos, botones con macro, `customXml` y configuración de impresora. `src/xlsx/nuevo.js` solo genera archivos **nuevos** (revisión, entradas, solicitud de ajuste).
4. **Nombres de hoja exactos**, con espacios finales incluidos: `CONTENEDOR #1 CONSUMIBLE `, `CONTENEDOR #5 CONSUMIBLE `, `MECANICO `, `OPERACION DIA `; encabezado `DESCRIPCIÓN `.
5. **Folios:** únicos, consecutivos (último + 1) y asignados dentro de un cambio atómico (`Almacen.modificar`, con el candado de pestaña única). **Todos se usan:** nunca se reutilizan, borran, cancelan ni saltan; un error se corrige con motivo y bitácora (el motivo se prellena con `resumenCambios`).
6. **Existencias derivadas de movimientos:** CONSUMO e INGRESO se calculan con los vales posteriores al último conteo (corte por **folio**), no se guardan sueltos. Se muestran y exportan **por día** como el Excel del almacén (Ronda 16): CANTIDAD = lo que había al empezar el día, CONSUMO / INGRESO = solo los vales de ese día (`calcularSaldos(…, { dia })`); el TOTAL es el mismo.
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
- **Al terminar cada cambio, adjunta `dist/ControlAlmacen.html` en la conversación** (pedido del usuario): recién
  compilado, del mismo commit que se subió.
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
- Vales **internos** (tipo de área `INTERNO`): salen de `EQUIPO · ALMACEN` y llegan a `EQUIPO · <área>`; entregó = almacenista en turno; en observaciones solo cambia `ETAPA DE PERFORACION` (`src/nucleo/areas.js`). NOV es `EXTERNO` y TRANSFERENCIAS `TRANSFERENCIA` (P-22 pendiente).
- En el formulario, las partidas siguen el orden del vale impreso; lo que viene del inventario (contenedor, existencia) va en pastillas, no como columna.
- La hoja-formulario NOV pone al almacenista a la **derecha**; las capacidades de renglones varían por hoja (21/20/19): se leen del formato, no se suponen.
- Los vales nuevos dejan FAMILIA y TRANSFERENCIA/CONSUMO vacías (así vienen los recientes del Excel, P-13). Los cancelados de versiones anteriores se exportan como renglón en 0 con `CANCELADO – motivo`.
- NOV: la macro guardaba las firmas **por posición** (P = izquierda = químico, Q = derecha = almacenista). Los migrados quedan así (`firmasPorPosicion`/`conFirmasPorPapel` para mostrarlos); los nuevos se guardan por papel y el exportador los invierte con `almacenista_derecha`.
- Las fotos del formato NOV (imágenes sobre la zona de partidas) son espacios para las fotos del vale, no se imprimen; las partidas caben arriba (4).
- UI: no usar `<select>` ni `<datalist>`; usar `Lista`, `Combo` y `CampoSugerido` (`src/ui/componentes.js`).
- Partidas de salida: CLAVE = dimensión del renglón tal cual (vacía → `SIN DIMENSIÓN`) y NP → LOTE (`claveDeRenglon`, `conLoteDeNp`). `claveParaVale` (dimensión + `NP:`) solo queda para lo anterior. **En entradas, LOTE = quien solicita** (así lo anota la base); la clave escrita que no existe es la dimensión de la variante nueva (`conClaveEscrita`), sin capturarla aparte.
- Personas repetidas: se unifican con `unificarPersonas` (la que queda + `estado.alias` para los otros nombres). **Nunca se reescriben los nombres de los vales**; solo la lista, las plantillas de área y lo guardado por almacenista. Las ventanas (`Ventana`) se dibujan en un portal sobre `body` (dentro de *Ajustes y más* hay `container-type`, que encerraría un `position: fixed`).
- Menú: las páginas con `grupo: "mas"` se abren en la vista *Ajustes y más* (`Ventana` en primer plano sobre la página de fondo; el hash es el de la sección y al cerrar vuelve al fondo); `soloConAviso` (Pendientes) solo aparece con insignia. Íconos propios en `src/ui/iconos.js` (SVG en línea, sin fuentes externas). Ventanas modales: `Ventana` en `ui/componentes.js`.
- Captura con Copilot (`servicios/capturaIA.js`): la herramienta NO se conecta; solo da instrucciones para copiar y lee el JSON pegado con `jsonTolerante.js` (repara lo cortado o mal formado, sin `eval`) y nombres parecidos.
- Reporte diario: `estadoAlCierre(estado, fecha)` (copia del estado al cierre del día) → `Almacen.exportar(tipo, …, { corte })`. *Ya lo subí* del reporte usa `registrarEnvio(…, { hastaFolio })`.
- Personalización por almacenista (`config.personalizacion`, `servicios/preferencias.js`) → `ui/tema.js` pone `data-tema`, `data-avisos` y `data-animaciones` en `<html>` (y lo recuerda en `localStorage` solo para el arranque). Colores siempre con variables CSS; el oscuro va en `:root[data-tema="oscuro"]` y en `prefers-color-scheme` si no eligió claro.
- **FX** es material que AX lleva en su propio almacén y Kardex pero se descuenta en los **vales del Inventario B** (LOTE
  "FX") y comparte sus folios: por eso vive dentro de ese estado como dueño de partidas, nunca como base aparte (un vale
  puede llevar partidas de los dos). El libro de inventario de FX sale aparte; la conciliación de FX aún no.
- Los dos inventarios comparten el almacén de AX; en el Kardex los distingue el **Sitio**. Sus códigos casi no se repiten.
- conciliación con Dynamics AX: llave de AX = código + Tamaño + Color; **Tamaño + Color = la dimensión** (AX no trae NP; `dimensionAx`, `valoresAx`) y AX corta el Tamaño a 10 caracteres. Solo se concilia `Modelo de Inventario = INV`. Diferencia sin explicar = físico − AX + salidas en tránsito − entradas en tránsito. Las **cantidades** no cambian; confirmar una pareja sí corrige la dimensión / NP de la variante (a como está en AX).
- Archivo de vales de la base: con folio **IN / TR** la partida ya está en AX (CANTIDAD de la base = lo aplicado; vacía =
  todo; texto como `REGRESAR` = todo con aviso); **sin folio IN / TR** (INV sin folio, sin revisar, que la base no tiene o
  posterior a su archivo) → tránsito aunque el vale sea anterior al corte; **NO INV / CONPROV / SIN EXISTENCIA** = no se
  descuenta en AX (no justifica diferencias). **La fecha del archivo de la base no importa** (decisión del usuario, Ronda
  13); la del reporte de AX sí: lo posterior siempre está en tránsito. Se empareja por folio + código (luego clave y
  cantidad). El archivo se lee, nunca se escribe.
- Dimensión vacía, "S/D", "SIN DIMENSIÓN" / "SIN DIMENCION", "S/N" (o que empieza así: "S/D NP: …") = **sin dimensión**
  (`sinDimension`). Una partida de AX sin Tamaño ni Color representa a todas las variantes sin dimensión del código (o al
  código completo si es su única partida en AX).
- Faltantes: se justifican con vales que el físico ya descontó y AX no. Asignar no cambia cantidades ni vales; una
  partida se asigna una sola vez por corte. Una partida sin ligar y posterior al conteo de la variante NO se puede asignar
  (el físico aún no la descuenta: hay que ubicarla). En los folios, (S) = salida, (E) = entrada con el folio de la base.
- Partidas duplicadas: mismo código + clave + cantidad dentro de un vale (el formulario de Excel guardaba el vale dos
  veces). Se quitan con una corrección (motivo escrito), nunca se borran a escondidas.
- Corregir dimensión / NP (`corregirDimensionNp`): de una partida (`existenciaId`, pasa a otra variante) o de toda la variante (`varianteId`, cambia de nombre o se junta con la igual: `activo: false`, `unida_a`). **Nunca se reescriben los vales**: la escritura anterior queda en `variante.claves_anteriores` y `clavesPropias` (`nucleo/catalogo.js`) la sigue reconociendo.
- Textos de la interfaz: **"partida"/"partidas"**, nunca "renglón" (en el código los nombres internos siguen igual). Bentos con `Bento` (`ui/componentes.js`, acomodo masonry con `useMasonry`). Atajos con `useAtajo` (Alt + N = nueva partida) y `Teclas`.
- Inventario exportado: la fecha del encabezado de página (`oddHeader`) se cambia por la del inventario (`fechaEnTexto`, respeta la forma escrita). Escribir con "Guardar como" reintenta, verifica el tamaño y, si falla, descarga (`escribirEnArchivo`, `explicarErrorEscritura`).
- Entradas: folio interno propio (`E-0001`, consecutivo aparte de salidas); B del libro de entradas = folio de la base. Un renglón de entrada va a un renglón existente, a uno nuevo (variante existente en otro contenedor o variante nueva) o *sin existencia*.
- Conteos: cada renglón descuenta desde **su** conteo (`existencia.conteo_id`); un conteo parcial solo toca lo capturado. El reacomodo deja ambos renglones "recién contados" (conteo `tipo: REACOMODO`, que no se lista como conteo físico).
- El panel de datos del vale se arma por bloques (`bloques` en `EditorVale`) en el orden de `config.preferencias_vale[almacenista]` (`src/servicios/preferencias.js`). Un bloque nuevo se agrega en `BLOQUES_VALE` y en `bloques`; `normalizarOrden` lo inserta en su lugar para quien ya tenía preferencias.
