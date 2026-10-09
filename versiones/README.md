# Versión con impresión por lotes

Abre [ControlAlmacen.html](ControlAlmacen.html) en GitHub y pulsa **Download raw file** (icono de descarga).
Guárdalo como `ControlAlmacen.html` y ábrelo en Microsoft Edge. Es la aplicación completa y funciona sin conexión.
Al actualizar tu copia, conserva el nombre y la ubicación habituales del HTML y usa el mismo navegador.

En **Historial de vales → Vales de salida → Imprimir por lotes**, pega los folios de una columna de Excel
o sepáralos con espacios, comas o punto y coma. Se imprimen una sola vez y en el orden de la lista.
Corrige los folios inválidos o no encontrados antes de imprimir.

Esta entrega se generó con `npm run build` y se copió desde `dist/ControlAlmacen.html`.
Se validaron 204 pruebas y un lote de 88 vales con un PDF de 88 páginas.
El HTML contiene únicamente el programa, estilos y licencias; los datos del almacén permanecen en el navegador.

Para verificar la integridad del archivo:

```bash
cd versiones
sha256sum -c SHA256.txt
```
