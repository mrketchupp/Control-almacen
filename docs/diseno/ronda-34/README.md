# Diseño de la Ronda 34 — vale de salida (copia del lienzo)

Copia de las pantallas aprobadas del lienzo de Claude Design «Vale de salida — 3 direcciones», página «B + C»:
https://claude.ai/artifact/XJvGhPB5u5bN1FMzfHob14

Son maquetas (`.dc.html`): HTML con estilos en línea y datos de ejemplo en el bloque `<script>` del final. No se abren
solas en el navegador (dependen del editor de Claude Design); léelas como referencia de estructura, orden, tamaños y
textos. Colores y fuentes: usar los tokens de `src/estilos.css` (tabla en §6 de `docs/13-rediseno-vale-salida.md`).
**Si una maqueta contradice a `docs/13-rediseno-vale-salida.md`, manda el documento.** La vista previa del vale en
`V2Emitir` y `V2EmitirAmpliado` es ilustrativa: la real es el render de `src/impresion/vale.js`.

| Archivo | Pantalla | Sección del documento |
|---|---|---|
| `V2Quien.dc.html` | 1a · Para quién (consumo interno) | §3.1 |
| `V2Transferencia.dc.html` | 1b · Para quién (transferencia) | §3.2 |
| `V2Material.dc.html` | 2 · Material | §4.1–4.3 |
| `V2MaterialEditar.dc.html` | 2b · Editando una partida | §4.4 |
| `V2MaterialClaveNueva.dc.html` | 2d · Dimensión que no existe | §4.5 |
| `V2MaterialMitad.dc.html` | 2c · Media pantalla (768 px) | §8 |
| `V2Emitir.dc.html` | 3 · Revisar y emitir | §5 |
| `V2EmitirAmpliado.dc.html` | 3b · Vista previa ampliada | §5.3 |

Los nombres de persona de las maquetas se cambiaron por inventados (Mecánico Uno, Chofer Uno, Rig Manager Uno…)
al copiarlas al repositorio: aquí nunca van nombres del personal (regla 1 de `CLAUDE.md`). Las imágenes y estilos del
lienzo no cambiaron.
