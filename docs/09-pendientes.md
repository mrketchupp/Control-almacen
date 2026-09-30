# 09 — Pendientes y decisiones por confirmar

Cada punto tiene una **propuesta por defecto**. Si el usuario no indica otra cosa, el desarrollo sigue esa propuesta.

## Bloquean alguna fase

| ID | Pregunta | Propuesta por defecto | Afecta |
|---|---|---|---|
| P-21 | ¿Dónde se abre la página: archivo `ControlAlmacen.html` en OneDrive (doble clic) o sitio publicado (GitHub Pages)? | **Archivo en OneDrive** para empezar: funciona sin internet y no depende de la visibilidad del repositorio. Los datos quedan ligados a la forma elegida (se migra con un respaldo). | Uso diario |
| P-02 | Lista de códigos **inventariables / consumibles** (la solicitó el usuario a la base). | Mientras llega, la clase se toma de la hoja donde está el artículo (INVENTARIABLE / CONSUMIBLE). | F1 |

## Vales

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-07 | ¿Cómo debe aparecer un **vale cancelado** en el DIARIO que se envía a la base? | Un renglón con cantidad 0 y la descripción `CANCELADO – <motivo>`, para que el folio no parezca perdido |
| P-08 | **Devolución de material:** ¿se corrige el vale original o se registra una entrada tipo "Devolución"? | Si la base aún no lo captura en AX: corregir el vale original. Si ya lo capturó: entrada tipo Devolución que referencia el folio. |
| P-09 | ¿El vale impreso debe ser **idéntico** al actual o basta con los mismos campos, orden y logo? | Mismos campos, orden, textos y logo. Se muestra un prototipo impreso antes de cerrar la Fase 2. |
| P-10 | Tamaño de hoja e impresora | Carta, vertical, 1 vale por hoja |
| P-13 | Columnas **FAMILIA** y **TRANSFERENCIA/CONSUMO** del DIARIO: ¿quién las llena? ¿La herramienta debe llenarlas sola? | Llenarlas automáticamente: FAMILIA desde el catálogo, TRANSF/CONS desde la plantilla del área. Solo si la base está de acuerdo. |
| P-14 | **"Autorizó":** ¿quién autoriza y en qué casos? | Obligatorio solo en transferencias; lista de autorizadores editable |
| P-16 | Vale con más de 21 renglones | Dividir en folios consecutivos, con aviso |

## Entradas

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-05 | En el historial de entradas, ¿"No. folio" debe ser el folio de la base o uno propio? | B = folio de la base; columna extra U = folio interno `E-0001` |
| P-06 | ¿Alguien más necesita el historial de entradas (la base, auditoría)? | Exportable en `VALES DE ENTRADA DLTA.xlsx`; se envía solo si lo piden |

## Inventario y conciliación

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-03 | ¿La base informa **hasta qué folio** capturó en AX en cada corte? | Vales en tránsito = vales con fecha **posterior** a la fecha de corte. Se puede indicar un folio de corte manual. |
| P-11 | ¿Cada cuándo se hace un **conteo físico** completo? ¿Hay conteos cíclicos por contenedor? | Soportar ambos: total y parcial por contenedor |
| P-15 | ¿Actualizar la hoja oculta `ARTICULOS_MX` del inventario exportado cuando se agregan códigos nuevos? | Sí (si no, la descripción sale `#N/A` para códigos nuevos) |
| P-17 | Columna **ITEM**: ¿renumerar consecutivo al exportar? | Sí, 1..n por hoja |
| P-18 | Solicitud de ajuste: ¿solo renglones con diferencia o todos? | Solo con diferencia, con opción de incluir todos |

## Ya resueltos (historial)

| ID | Pregunta | Respuesta |
|---|---|---|
| — | Equipo, internet, usuarios, dispositivo | PC Windows, internet estable, 2 almacenistas por turnos en la misma PC, solo PC |
| — | ¿Entradas? | Sí, con historial tipo DIARIO y asignación segura a contenedor |
| — | Formato de exportación | Idéntico al actual; en el futuro, solo DIARIO |
| — | Tecnología | Primero `.exe` instalable; tras el bloqueo (P-20), **web que guarda los datos en el equipo** + respaldo en OneDrive |
| P-20 | Seguridad de Windows bloquea el instalador ("Acción de riesgo bloqueada") | El usuario decidió **"full web, nada de programas en local", con la información guardada en local** → un HTML en Edge, datos en IndexedDB, respaldos en OneDrive |
| — | Limpieza del historial | Sí; los faltantes se completan con los PDF escaneados |
| P-01 | ¿Misma cuenta de Windows? | Sí, misma cuenta y mismo equipo; solo cambia el nombre de quien elabora → datos en el navegador de esa cuenta y selector de "almacenista en turno" |
| P-04 | ¿Vale de la base en Excel? | No, llega en papel (se puede fotografiar o escanear a 300 ppi) → se captura; OCR como mejora futura |
| P-12 | Folio de corte del conteo del 28-sep | Se descuentan del **550** en adelante (corte = 549) |
| P-19 | ¿`.exe` sin firma? | Bloqueado por Seguridad de Windows → se descartó (ver P-20) |
| — | ¿La herramienta trae datos? | No: llega vacía y los datos entran por la primera carga desde los Excel del usuario, en su equipo |
