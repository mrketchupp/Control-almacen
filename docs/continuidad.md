# Estado para continuar

Los cambios funcionales solicitados están terminados y verificados. No quedan implementaciones abiertas.

- Primera carga: tres pasos, archivos identificados y revisión de diferencias y correcciones antes de guardar.
- Navegación: menú contraíble con preferencia local, barra de iconos en ventanas medianas y barra inferior en móvil.
- Transferencias: observaciones protegidas con lápiz para editarlas; etapa de perforación independiente.
- Entradas: «Crear material nuevo» conserva la dimensión y permite otro NP o ninguno; evita la selección automática.
- Libro diario: nombre del inventario con espacios y extensión original, tanto al descargar como en «Guardar como».
- Conteo: altas, correcciones de dimensión / NP y bajas en borrador, con revisión antes de confirmar. Las bajas
  conservan los identificadores y vales. Corregir sólo la clave mantiene cantidades y corte.
- Historial: edición del puesto de quien entrega en vales antiguos e importados, con puestos vacíos explícitos y
  conservación de los materiales. La lista recuerda filtros, pestaña, filas desplegadas y scroll al volver del detalle,
  de forma independiente por inventario y tipo de vale.
- Impresión: las descripciones largas (por ejemplo, en vales migrados del Excel de GSM) se imprimen completas, en varias
  líneas, ampliando su fila como ya se hacía con las claves largas; lo que cabe en una línea no cambia la hoja.

El formato de datos es **17**. La migración agrega las correcciones a los conteos en captura. Los reportes históricos
restauran el estado activo anterior a una baja. Los inventarios existentes conservan sus identificadores internos.

Validación terminada: **413 pruebas automatizadas y 50 comprobaciones en Chromium**, sin errores ni peticiones
externas. Incluye primera carga → emitir → imprimir → exportar → respaldo; ventanas de 1440, 960, 900, 390 y 320 px;
entradas con NP distinto o vacío, transferencias, conteos, impresión por lotes y conciliación con Dynamics AX.
Incluye puestos de vales importados (agregar, modificar y borrar) y memoria del historial con más de 200 filas,
regreso desde detalle, Atrás, recarga, pestañas, desplazamiento interno de tabla y separación por inventario.

El programa listo para usar está en `versiones/ControlAlmacen.html`; su integridad se verifica con
`cd versiones && sha256sum -c SHA256.txt`. El código se compila mediante `npm run build`.

Para continuar, leer `CLAUDE.md`, revisar `git status` y retomar desde el último commit publicado. La presentación
del repositorio es general; los identificadores internos se mantienen por compatibilidad con los datos guardados.
No se incluyeron datos reales ni es necesario recapturar el inventario.
