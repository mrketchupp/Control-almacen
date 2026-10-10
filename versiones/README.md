# Versión con agrupación de partidas físicas y vínculos manuales en AX

Abre [ControlAlmacen.html](ControlAlmacen.html) en GitHub y pulsa **Download raw file** (icono de descarga).
Guárdalo como `ControlAlmacen.html` y ábrelo en Microsoft Edge. Es la aplicación completa y funciona sin conexión.
Al actualizar tu copia, conserva el nombre y la ubicación habituales del HTML y usa el mismo navegador.

En **Conciliación AX**, una dimensión puede reunir varias partidas físicas con distintos NP: se suman las
coincidencias del mismo código, dimensión y unidad. **2 + 2 piezas de 150VA contra AX 4 → Cuadra**. Se respetan las
dimensiones con Color específico y se evita contar dos veces el físico si AX repite su misma partida.

En **Justificar faltantes**, **Reporte AX** y **Diferencias → Por partida de AX**, pulsa **Elegir del inventario…**
cuando la escritura no permita reconocerlas. Selecciona las dimensiones / NP correctas, revisa las partidas, el total
y el resultado con los vales en tránsito y pulsa **Confirmar vínculo**. Se guarda por corte con bitácora y **Deshacer**;
puedes volver al emparejamiento automático. Conserva cantidades, claves, vales y etiquetas. Se recalcula al variar el
saldo y también en la solicitud de ajuste; se mantiene el límite anual de los vales justificantes.

El **clic derecho** ofrece acciones según el diseño, elemento, etiqueta pendiente, vale o partida del inventario.
Puedes renombrar el diseño pulsado, duplicar y ordenar elementos, corregir o imprimir vales y editar o mover una partida.
Sólo aparecen las opciones disponibles para su estado; las revisiones y los avisos de Deshacer se conservan.
**Mayús+F10** abre las acciones por teclado y **Mayús + clic derecho** conserva el menú del navegador.

En los campos de texto se mantienen **copiar, cortar, pegar, deshacer y rehacer** del navegador y sus atajos.
En el editor, **Ctrl+C / Ctrl+X / Ctrl+V** copian, cortan y pegan elementos entre diseños; **Ctrl+Z / Ctrl+Y** recuperan
los cambios. También están en el menú cuando corresponden. Los diseños de fábrica permiten copiar y duplicar el
diseño para editarlo. Si el navegador bloquea el portapapeles, el menú conserva la copia de elementos durante esa sesión.

Esta versión reúne la rama de vales y la de etiquetas en la rama predeterminada del proyecto.
En **Etiquetas → Editor de diseños** puedes duplicar un diseño, mover y editar elementos, agregar QR y
código de barras, guardarlo y elegirlo para imprimir. Se conservan los diseños y las listas de ambas ramas.

En **Conciliación AX → Emparejar con AX**, corregir dimensión / NP agrega automáticamente una etiqueta
por cada partida física modificada a **Etiquetas → Material**. Incluye las correcciones individuales,
las seguras y lo que sólo está en el físico. **Deshacer** retira las etiquetas de esa corrección.

En **Justificar faltantes → Aceptar vales desde**, el inicio propuesto es el **1 de noviembre del año
anterior al reporte AX**. Cambia la fecha y pulsa **Guardar límite** para una prórroga o retraso; se guarda
por corte. Los vales anteriores quedan fuera de las sugerencias, la asignación manual y la solicitud.
Las asignaciones ya guardadas fuera del periodo se conservan con un aviso y dejan de justificar diferencias.

En **Historial de vales → Vales de salida → Imprimir por lotes**, pega los folios de una columna de Excel
o sepáralos con espacios, comas o punto y coma. Se imprimen una sola vez y en el orden de la lista.
Corrige los folios inválidos o no encontrados antes de imprimir.

Las claves de almacén largas se imprimen completas en varias líneas, centradas y con una fila más alta.
Se aprovecha el espacio de partidas vacías y, si el formato está lleno, se ajusta la escala
para conservar una página por vale. Las observaciones, las firmas y las bandas mantienen su posición.
Los textos de celdas combinadas también se conservan si su origen está en una fila o columna oculta.
La banda de «OBSERVACIÓN» y los rellenos de su bloque se dibujan desde sus propias celdas,
para evitar una segunda franja de color dentro de las partidas cuando cambia una altura.

En **Historial de vales → Vales de salida / Vales de entrada → Corregir por lotes**, pega los folios,
marca los datos generales que deseas cambiar y revisa el antes y el después antes de guardar.
En entradas se usa el folio interno (`E-0001` o `1`). Las partidas y los materiales se conservan.

En **Áreas y personas → Personas**, agregar o editar un puesto permite confirmar su actualización
en todos los vales existentes de esa persona, incluidos sus alias ya unificados.
Aceptar actualiza el historial y registra la corrección; cancelar guarda solamente la persona.

Esta entrega se generó con `npm run build` y se copió desde `dist/ControlAlmacen.html`.
Se validaron 355 pruebas automatizadas y 4 de agrupación y vínculos AX en Chromium. Se conservan las validaciones de
7 pruebas de impresión y 10 de menús contextuales. Se recorrieron en el navegador
la carga inicial, emisión, impresión, exportación y respaldo, además de las etiquetas de AX, Deshacer,
el límite de justificantes, su persistencia y el editor de diseños con impresión de QR y barras.
La impresión por lotes conserva la validación anterior de 88 vales y un PDF de 88 páginas.
El HTML contiene únicamente el programa, estilos y licencias; los datos del almacén permanecen en el navegador.

Para verificar la integridad del archivo:

```bash
cd versiones
sha256sum -c SHA256.txt
```
