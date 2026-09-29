# 02 — Requerimientos

## Contexto de uso (confirmado por el usuario)

| Tema | Respuesta |
|---|---|
| Equipo | PC de escritorio con Windows. Se puede pedir autorización para instalar programas (`.exe`). |
| Internet | Estable |
| Usuarios | 2 almacenistas que se turnan la guardia cada ~14 días y **comparten la misma PC** |
| Dispositivo | Solo PC (no celular ni tablet) |
| Respaldo | Todos los equipos tienen OneDrive. Los datos deben respaldarse ahí y poder restaurarse si se reinstala el equipo. |

## Decisiones tomadas con el usuario

| ID | Decisión |
|---|---|
| D-01 | La base operativa registra en AX los vales que el almacenista le envía por correo a diario (archivo de vales). Cada ~2 semanas manda el inventario AX actualizado. |
| D-02 | El material nuevo llega de la base con un **vale de material** (mismo formato de Excel). La base usa los códigos y dimensiones de AX, y el almacén consume con esos mismos códigos y dimensiones. |
| D-03 | La herramienta **sí registra entradas**, con su propio historial tipo DIARIO. |
| D-04 | El reporte AX llega con todas las ubicaciones; la herramienta filtra el almacén del RIG (`RIG91-IX25`, configurable). |
| D-05 | Diésel, oxígeno, acetileno y similares **solo se registran en vales**; no llevan existencia. |
| D-06 | Las transferencias a otros RIGs se descuentan como consumo. (Futuro: transferir entre ubicaciones.) |
| D-07 | NOV es una **salida** de diésel. |
| D-08 | El folio es **único y consecutivo**. Los repetidos o saltados son error humano. Se requiere control real de folios. |
| D-09 | Entradas y salidas usan el mismo formato de vale; se distinguen con `XXXXX` en "Entradas" (K10) o en "Salida" (K11). |
| D-10 | El vale **impreso y firmado** es el documento oficial; después se escanea y se sube a SharePoint. |
| D-11 | Los Excel exportados deben ser **idénticos** a los actuales. Si en el futuro se adopta la herramienta al 100%, bastará con exportar `DIARIO`. |
| D-12 | En el inventario exportado, `CANTIDAD` se respeta y la fórmula actual se mantiene: `TOTAL = CANTIDAD + INGRESO − CONSUMO`. |
| D-13 | Dentro de la herramienta no habrá 11 hojas: un solo formulario **dinámico**, con **varios vales abiertos a la vez**. |
| D-14 | La conciliación tendrá varias vistas: por artículo, por contenedor y valuada en $. La presentación queda a criterio del desarrollo. |
| D-15 | El formato de solicitud de ajuste es **igual al reporte AX** más dos columnas: **Existencia física** y **Folios que justifican la diferencia**. |
| D-16 | El historial se limpia al migrarlo. Lo que no se pueda deducir se completa con los PDF escaneados de cada vale. |
| D-17 | Tecnología: aplicación instalable (`.exe`) con respaldo automático en OneDrive. |

---

## Requerimientos funcionales

Prioridad: **M** = indispensable para salir a producción; **D** = deseable; **F** = futuro.

### Catálogo y existencias
| ID | Requerimiento | Prio |
|---|---|---|
| RF-01 | Catálogo único de artículos (código AX + descripción + clase inventariable/consumible). Se importa de `ARTICULOS_MX` y del catálogo de vales, y se actualiza con la lista que enviará la base. | M |
| RF-02 | Catálogo de **variantes**: código + dimensión + NP + UM. La variante es la unidad que se cuenta y se mueve. | M |
| RF-03 | Existencias por **ubicación** (las 10 hojas actuales = contenedor + clase). Una variante puede estar en varias ubicaciones. | M |
| RF-04 | Buscador rápido por código, descripción, dimensión o NP, que muestre existencia por contenedor. | M |
| RF-05 | Catálogos auxiliares editables: personas (nombre, puesto, área), departamentos, destinos (RIGs y pozos) y **plantillas por área** (sustituyen las 11 hojas: origen, destino, deptos, receptor habitual y observaciones por defecto). | M |

### Vales de salida
| ID | Requerimiento | Prio |
|---|---|---|
| RF-10 | Formulario dinámico con varios vales en borrador abiertos a la vez (pestañas). | M |
| RF-11 | Al elegir el área, se prellenan los datos de su plantilla. | M |
| RF-12 | Cada renglón se captura buscando la variante (código, descripción, dimensión o NP) y el contenedor de donde sale. Si solo hay uno, se asigna solo. | M |
| RF-13 | Se permiten renglones **no inventariados** (diésel, gases, servicios): solo quedan en el historial y no descuentan existencia. | M |
| RF-14 | Validaciones: cantidad > 0, existencia suficiente (con aviso y opción de continuar con justificación), UM obligatoria y O.C. opcional (en blanco se exporta como `S/OC`). | M |
| RF-15 | **Folio automático** al emitir: el siguiente consecutivo, sin posibilidad de duplicar. Los borradores no consumen folio. | M |
| RF-16 | Máximo 21 renglones por vale (límite del formato impreso). Si hay más, se ofrece dividir en varios folios. | M |
| RF-17 | Impresión del vale con el mismo formato y campos que hoy (logo, encabezado, 21 renglones, observaciones, firmas). También se puede guardar en PDF. | M |
| RF-18 | Al emitir, el vale queda en el historial DIARIO y descuenta existencia (CONSUMO de la ubicación). | M |
| RF-19 | **Corrección** de un vale emitido: se edita con motivo obligatorio y queda en la bitácora (quién, cuándo, antes → después). El folio no cambia. | M |
| RF-20 | **Cancelación** de un vale: el folio queda marcado como cancelado, no se reutiliza y la existencia se revierte. | M |
| RF-21 | Aviso de "vales modificados después del último envío a la base", para informarles qué cambió. | D |
| RF-22 | Campo opcional para la ruta o enlace del PDF escaneado en SharePoint. | D |

### Vales de entrada
| ID | Requerimiento | Prio |
|---|---|---|
| RF-30 | Registro de vale de entrada: folio de la base (referencia), fecha, O.C., renglones (variante, cantidad, UM) y **ubicación destino por renglón**. | M |
| RF-31 | **Ubicación sugerida:** si la variante ya existe en un contenedor, se propone ese. Si es nueva, se pide elegir contenedor, y la clase (inventariable/consumible) sale del catálogo. | M |
| RF-32 | **Vista previa antes de confirmar:** por cada renglón, cuánto había, cuánto entra y cuánto queda, y en qué hoja/contenedor quedará. No se puede confirmar con renglones sin variante o sin ubicación. | M |
| RF-33 | Si la variante no existe, se da de alta desde la misma pantalla (código del catálogo + dimensión + NP + UM), con aviso si se parece a una existente para evitar duplicados. | M |
| RF-34 | Historial de entradas tipo DIARIO, con filtros por fecha, folio de la base, código y O.C. | M |
| RF-35 | El vale de la base llega en papel (P-04): se captura. Futuro: leerlo de la foto o escaneo (300 ppi) con OCR. | F |
| RF-36 | Folio interno consecutivo para entradas (`E-0001`), independiente del folio de la base. | M |

### Conteo físico
| ID | Requerimiento | Prio |
|---|---|---|
| RF-40 | Registrar un conteo físico (total o por contenedor): la cantidad contada pasa a `CANTIDAD` y CONSUMO/INGRESO se reinician desde esa fecha. El conteo anterior se conserva en el historial. | M |
| RF-41 | Hoja de conteo imprimible por contenedor (sin cantidades, para contar a ciegas). | D |
| RF-42 | Movimiento a otra ubicación (reacomodo entre contenedores) sin afectar el total. | D |

### Conciliación contra AX
| ID | Requerimiento | Prio |
|---|---|---|
| RF-50 | Importar el reporte AX (completo o filtrado) y guardar cada corte con su fecha. | M |
| RF-51 | Emparejar renglones AX con variantes: exacto tras normalizar, luego aproximado con puntaje. El usuario confirma o corrige y la **equivalencia se recuerda** para los siguientes cortes. | M |
| RF-52 | Vistas: por artículo, por contenedor y valuada en $ (costo unitario = valor financiero / disponible). Filtros: solo diferencias, sobrantes o faltantes. | M |
| RF-53 | Vales en tránsito: vales posteriores a la fecha de corte (o a un folio de corte indicado) que explican la diferencia. | M |
| RF-54 | Exportar la **solicitud de ajuste**: columnas del reporte AX + `Existencia física` + `Folios que justifican`. | M |
| RF-55 | Artículos físicos sin renglón en AX y renglones de AX sin artículo físico, en listas separadas. | M |

### Exportación a Excel
| ID | Requerimiento | Prio |
|---|---|---|
| RF-60 | Exportar `INVENTARIO DE REFACCIONAMIENTO…xlsx` idéntico: mismas hojas, tablas, fórmulas, notas y formato. Solo cambian los datos. | M |
| RF-61 | Exportar `VALES DE SALIDA DLTA.xlsm` idéntico: macros, botones, logos y formularios intactos. Solo cambia `DIARIO`. | M |
| RF-62 | Exportar el historial de entradas en un libro aparte con las mismas columnas de DIARIO. | M |
| RF-63 | Nombre de archivo con fecha, siguiendo la convención actual (`…_DDMMAA`). | M |
| RF-64 | Exportar solo `DIARIO` (modo futuro, cuando la herramienta se adopte al 100%). | F |

### Seguridad de datos y operación
| ID | Requerimiento | Prio |
|---|---|---|
| RF-70 | Respaldo automático en OneDrive: al cerrar, una vez al día y antes de cada importación o migración. Con retención configurable. | M |
| RF-71 | Restaurar desde un respaldo, para reinstalación o desastre. | M |
| RF-72 | Selección del **usuario en turno** al abrir. Queda registrado en cada movimiento y es el "Entregó" por defecto. | M |
| RF-73 | Bitácora de auditoría de cada alta, cambio, cancelación, importación y exportación. | M |
| RF-74 | Tablero de inicio: último folio emitido, vales del día, alertas (existencias en 0, vales sin enviar, último respaldo). | D |

## Requerimientos no funcionales

| ID | Requerimiento |
|---|---|
| RNF-01 | Windows 10/11, funciona sin internet. Instalación con un instalador `.exe`. |
| RNF-02 | Software libre, sin licencias de pago ni servicios en la nube de terceros. Los datos solo salen del equipo hacia el OneDrive del propio usuario. |
| RNF-03 | Interfaz en español, pensada para teclado (Tab/Enter) y búsqueda rápida. |
| RNF-04 | Emitir un vale de 10 renglones debe tomar menos de 2 minutos para un usuario entrenado. |
| RNF-05 | Ninguna operación destruye datos sin confirmación. Todo lo emitido es rastreable. |
| RNF-06 | Los archivos exportados deben abrir en Excel **sin mensaje de reparación** y las macros deben seguir funcionando. |
| RNF-07 | Pruebas automáticas para importadores, exportadores y reglas de existencias, con datos anonimizados. |
