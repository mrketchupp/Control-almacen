# 09 — Pendientes y decisiones por confirmar

Cada punto tiene una **propuesta por defecto**. Si el usuario no indica otra cosa, el desarrollo sigue esa propuesta.

## Bloquean alguna fase

| ID | Pregunta | Propuesta por defecto | Afecta |
|---|---|---|---|
| P-01 | ¿Los dos almacenistas usan **la misma cuenta de Windows** en la PC compartida, o cada uno tiene la suya? | Base de datos en `C:\ProgramData` (sirve para ambos casos). Si hay dos cuentas, cada OneDrive recibe respaldos y al restaurar se elige el más reciente. | F1 |
| P-02 | Lista de códigos **inventariables / consumibles** (la solicitó el usuario a la base). | Mientras llega, la clase se toma de la hoja donde está el artículo (INVENTARIABLE / CONSUMIBLE). | F1 |
| P-12 | ¿Desde qué **folio** los vales descuentan del inventario físico actual? El archivo del 28-sep ya descuenta el vale 551 (cabos para marro), pero no el 550 (manguera 1/4"). ¿El 546 (27-sep, 3 cabos) ya estaba reflejado en CANTIDAD? | Descuentan los folios **≥ 550** (primero del 28-sep, fecha del conteo). El reporte de verificación mostrará el caso del 550 para confirmarlo. | F1 |
| P-19 | ¿La política de TI permite instalar un `.exe` **sin firma digital**? ¿Hay antivirus o AppLocker que bloqueen programas nuevos? | Instalador sin firma; se entrega su hash SHA-256 para que TI lo verifique. | F1 |

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
| P-04 | ¿El vale de la base llega **en Excel** (archivo) o solo en papel/PDF? | Si llega en Excel, se importa directamente (RF-35) |
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
| — | Tecnología | `.exe` instalable + respaldo en OneDrive |
| — | Limpieza del historial | Sí; los faltantes se completan con los PDF escaneados |
