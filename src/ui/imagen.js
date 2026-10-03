// Convierte una hoja ya armada para imprimir (HTML + CSS) en una imagen PNG, sin bibliotecas ni
// red: el HTML se dibuja dentro de un SVG (foreignObject) y el SVG se pinta en un lienzo. Todas las
// imágenes deben ser data: (el SVG no puede cargar nada de fuera).

const CARTA = { ancho: 8.5, alto: 11 };

/** Quita las reglas @page (no aplican dentro de una imagen). */
const sinPagina = (css) => css.replace(/@page\s*\{[^}]*\}/g, "");

/**
 * @param documento { css, html } de UNA hoja
 * @param pagina    { margenes: {sup, inf, izq, der} en pulgadas, horizontal }
 * @param escala    píxeles por punto CSS (2 = el doble de nitidez)
 * @returns Uint8Array con el PNG
 */
export async function hojaAPng(documento, pagina, escala = 2) {
  const m = pagina?.margenes ?? { sup: 0.4, inf: 0.4, izq: 0.4, der: 0.4 };
  const anchoIn = (pagina?.horizontal ? CARTA.alto : CARTA.ancho) - m.izq - m.der;
  const altoIn = (pagina?.horizontal ? CARTA.ancho : CARTA.alto) - m.sup - m.inf;
  const ancho = Math.round(anchoIn * 96);
  const alto = Math.round(altoIn * 96);
  const hoja = document.createElement("div");
  hoja.style.cssText = `width:${ancho}px;height:${alto}px;overflow:hidden;background:#fff;color:#000`;
  hoja.innerHTML = `<style>${sinPagina(documento.css)}</style>${documento.html}`;
  const xhtml = new XMLSerializer().serializeToString(hoja);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">` +
    `<foreignObject x="0" y="0" width="${ancho}" height="${alto}">${xhtml}</foreignObject></svg>`;
  const imagen = new Image();
  imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await imagen.decode();
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.scale(escala, escala);
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  const blob = await new Promise((listo, falla) => {
    try {
      lienzo.toBlob((b) => (b ? listo(b) : falla(new Error("El navegador no pudo crear la imagen."))), "image/png");
    } catch (error) {
      falla(error);
    }
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Bytes → data: URL (para meter fotos guardadas dentro de la imagen). */
export function bytesADataUrl(datos, mime = "image/jpeg") {
  return new Promise((listo, falla) => {
    const lector = new FileReader();
    lector.onload = () => listo(lector.result);
    lector.onerror = () => falla(lector.error);
    lector.readAsDataURL(new Blob([datos], { type: mime }));
  });
}
