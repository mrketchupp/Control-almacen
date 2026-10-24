# Control de Almacén

Herramienta local para gestionar inventario, movimientos y documentos de almacén.
Funciona desde un archivo HTML, sin instalación ni servidor.

- Inventario por ubicación y conteos físicos.
- Vales de entrada, salida y transferencia.
- Etiquetas con diseños personalizables.
- Importación y exportación de archivos Excel.
- Conciliación con Dynamics AX.

## Uso

[Descargar la aplicación](versiones/ControlAlmacen.html) y elegir **Download raw file** en GitHub.
Guarda el archivo como `ControlAlmacen.html` y ábrelo en Edge o Chrome.
Los datos se conservan en el navegador; los respaldos se guardan en la carpeta elegida.

[Guía de uso](docs/10-instalacion-y-uso.md)

## Desarrollo

```bash
npm ci
npm test
npm run build
```

La compilación genera `dist/ControlAlmacen.html`.
