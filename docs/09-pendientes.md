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
| P-07 | ¿Cómo debe aparecer un **vale cancelado** en el DIARIO? | **Resuelto por el usuario:** no se cancelan folios; todos se usan y un error se corrige. (Los cancelados de versiones anteriores siguen saliendo como renglón en 0.) |
| P-08 | **Devolución de material:** ¿se corrige el vale original o se registra una entrada tipo "Devolución"? | Si la base aún no lo captura en AX: corregir el vale original. Si ya lo capturó: entrada tipo Devolución que referencia el folio. **F3 permite las dos.** El usuario aclaró que las entradas vienen de la base o de otro equipo; copiar partidas de un vale de salida queda como opción secundaria. |
| P-09 | ¿El vale impreso debe ser **idéntico** al actual o basta con los mismos campos, orden y logo? | **Resuelto:** el usuario los comparó impresos y "lucen 98 % similares"; funcionan. |
| P-10 | Tamaño de hoja e impresora | Carta, vertical, 1 vale por hoja |
| P-13 | Columnas **FAMILIA** y **TRANSFERENCIA/CONSUMO** del DIARIO: ¿quién las llena? ¿La herramienta debe llenarlas sola? | En los vales recientes del Excel ya van vacías, así que **F2 las deja vacías**. Si la base las pide, se llenan solas: FAMILIA desde el catálogo y TRANSF/CONS desde el área. |
| P-14 | **"Autorizó":** ¿quién autoriza y en qué casos? | Obligatorio solo en transferencias o en las áreas marcadas "Exigir Autorizó"; el autorizador habitual se guarda en el área. **Aplicado en F2.** |
| P-16 | Vale con más renglones que el formato | Dividir en folios consecutivos, con aviso. La capacidad se lee de cada hoja-formulario (21 en la mayoría; 20 y 19 en dos hojas). **Aplicado en F2.** |
| P-22 | **Transferencias:** ¿qué datos son fijos y cuáles cambian en cada vale? | **Resuelto:** así están correctos (se editan en el vale; Autorizó con nombre y puesto obligatorio). |
| P-23 | La línea de observaciones del formato dice `ETAPA DE PERFORACION: 12 1/4""` (dos comillas). ¿Es intencional? | **Resuelto:** era un error de dedo (una sola comilla); el usuario lo corrige en su formato / en Ajustes. |

## Entradas

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-05 | En el historial de entradas, ¿"No. folio" debe ser el folio de la base o uno propio? | B = folio de la base; columna extra U = folio interno `E-0001`. **Aplicado en F3.** |
| P-06 | ¿Alguien más necesita el historial de entradas (la base, auditoría)? | Exportable en `VALES DE ENTRADA DLTA.xlsx`; se envía solo si lo piden. **Aplicado en F3.** |

## Inventario y conciliación

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| P-03 | ¿La base informa **hasta qué folio** capturó en AX en cada corte? | Vales en tránsito = vales con fecha **posterior** a la fecha de corte. Se puede indicar un folio de corte manual. **Aplicado en F4** (campo "Base capturó hasta el folio"). |
| P-11 | ¿Cada cuándo se hace un **conteo físico** completo? ¿Hay conteos cíclicos por contenedor? | Soportar ambos: total y parcial por contenedor. **Aplicado en F3.** |
| P-15 | ¿Actualizar la hoja oculta `ARTICULOS_MX` del inventario exportado cuando se agregan códigos nuevos? | Sí (si no, la descripción sale `#N/A` para códigos nuevos). **Aplicado.** |
| P-17 | Columna **ITEM**: ¿renumerar consecutivo al exportar? | Sí, 1..n por hoja |
| P-18 | Solicitud de ajuste: ¿solo renglones con diferencia o todos? | Solo con diferencia, con opción de incluir todos. **Aplicado en F4.** |

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
| — | Firmas en la hoja NOV | En esa hoja el almacenista firma a la **derecha** ("ENTREGA / AUTORIZA") y quien recibe a la izquierda: la importación y la impresión lo detectan por el puesto |
| — | Número de renglones reales por vale | En el historial, el vale más largo tiene ~12 renglones: la división por capacidad será rara, pero existe |
