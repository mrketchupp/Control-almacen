# Versión con impresión y corrección por lotes

Abre [ControlAlmacen.html](ControlAlmacen.html) en GitHub y pulsa **Download raw file** (icono de descarga).
Guárdalo como `ControlAlmacen.html` y ábrelo en Microsoft Edge. Es la aplicación completa y funciona sin conexión.
Al actualizar tu copia, conserva el nombre y la ubicación habituales del HTML y usa el mismo navegador.

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
Se validaron 250 pruebas, la impresión y los nuevos flujos en Chromium,
y un lote sintético de 88 vales con las dos claves largas de ejemplo y un PDF de 88 páginas.
El HTML contiene únicamente el programa, estilos y licencias; los datos del almacén permanecen en el navegador.

Para verificar la integridad del archivo:

```bash
cd versiones
sha256sum -c SHA256.txt
```
