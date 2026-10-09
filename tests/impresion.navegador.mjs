// Prueba opcional con Chromium real; no forma parte del glob de `npm test`.
// Con Playwright instalado: node --test tests/impresion.navegador.mjs
// Opcionales: PLAYWRIGHT_MODULE (módulo o file: URL), CHROMIUM_BIN (ejecutable),
// PYTHON (Python con openpyxl, como tests/ayuda.js). Para comprobar regresiones,
// VALE_IMPRESION_MODULE puede apuntar a una versión anterior del módulo imprimible.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { analizarFormulario } from "../src/impresion/formulario.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesVales } from "./ayuda.js";

const impresion = await import(process.env.VALE_IMPRESION_MODULE || "../src/impresion/vale.js");

function casoConTextoLargo() {
  const modelo = analizarFormulario(new LibroLeido(bytesVales()), "SOLDADOR");
  const descripcion = `${"MATERIAL PARA MANTENIMIENTO CON DESCRIPCIÓN EXTENSA <SIN CAMBIOS> ".repeat(20)}\nÚLTIMA LÍNEA`;
  const desbordado = "TEXTO SIN AJUSTE QUE OCUPA LAS CELDAS VACÍAS A SU DERECHA ".repeat(8);
  const entrego = "ALMACENISTA DE PRUEBA";
  const recibio = "USUARIO DE PRUEBA";

  // Variaciones permitidas del Excel: descripción combinada en tres filas,
  // una fila de 16 px y una etiqueta clara sobre su propia banda gris.
  const combinada = { r1: 21, r2: 23, c1: 6, c2: 8 };
  for (let r = 21; r <= 23; r++) {
    for (let c = 6; c <= 8; c++) modelo.combinadaEn.set(`${r},${c}`, combinada);
  }
  const observacion = { r1: 42, r2: 42, c1: 3, c2: 11 };
  for (let c = 3; c <= 11; c++) modelo.combinadaEn.set(`42,${c}`, observacion);
  modelo.filas = modelo.filas.map((fila) => ([21, 42].includes(fila.r) ? { ...fila, px: 16 } : fila));

  const estilos = modelo.estilos;
  const estiloDe = modelo.estiloDe.bind(modelo);
  const especiales = new Map([
    [1000, { original: estiloDe(21, 6), envolver: true }],
    [1001, { original: estiloDe(42, 3), banda: true }],
  ]);
  modelo.estiloDe = (r, c) => (r === 21 && c === 6 ? 1000 : r === 42 && c === 3 ? 1001 : estiloDe(r, c));
  modelo.estilos = {
    css(indice) {
      const especial = especiales.get(indice);
      const estilo = estilos.css(especial?.original ?? indice);
      if (!especial) return estilo;
      return {
        ...estilo,
        css: {
          ...estilo.css,
          ...(especial.envolver ? { "white-space": "pre-wrap" } : {}),
          ...(especial.banda ? { background: "#777777", color: "#FFFFFF" } : {}),
        },
        ajustar: especial.envolver || estilo.ajustar,
      };
    },
    bordesCss: (indice) => estilos.bordesCss(especiales.get(indice)?.original ?? indice),
    codigoFormato: (indice) => estilos.codigoFormato(especiales.get(indice)?.original ?? indice),
  };

  const vale = {
    tipo: "SALIDA", folio: 1234, fecha: "2026-10-09", observaciones: null,
    entrego_nombre: entrego, recibio_nombre: recibio,
    lineas: [{ cantidad: "3", codigo: 701, descripcion, clave: "PRUEBA", um: "PZA", oc: "OC-1" }],
  };
  const valores = impresion.valoresDeVale(modelo, vale);
  valores.set("30,6", desbordado);
  return {
    modelo, valores, descripcion, desbordado, entrego, recibio,
    html: `<!doctype html><meta charset="utf-8"><style>body{margin:0}${impresion.cssImpresion(modelo)}</style>${impresion.paginaHtml(modelo, valores)}`,
  };
}

test("el vale conserva las medidas y los textos del Excel al imprimir en Chromium", async (t) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const carpeta = await mkdtemp(join(tmpdir(), "control-almacen-impresion-browser-"));
  const cache = join(carpeta, "cache");
  const config = join(carpeta, "config");
  await Promise.all([mkdir(cache), mkdir(config)]);
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
    env: { ...process.env, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config },
    args: ["--disable-dev-shm-usage", "--disable-crash-reporter", "--disable-breakpad"],
    timeout: 15000,
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ media: "print" });
  const caso = casoConTextoLargo();
  const cargar = async () => {
    await page.setContent(caso.html);
    await page.evaluate(() => document.fonts.ready);
  };

  await t.test("texto ajustado, rowspan y filas cortas conservan la rejilla completa", async () => {
    await cargar();
    const modeloAjustado = impresion.ajustarAlturasClaves(caso.modelo, caso.valores);
    const escala = await page.locator(".vale-lienzo").evaluate((el) => Number(el.style.zoom));
    const altos = impresion.enRejilla(modeloAjustado.filas.map((fila) => fila.px), escala).map((alto) => alto * escala);
    const anchos = impresion.enRejilla(caso.modelo.columnas.map((col) => col.px), escala).map((ancho) => ancho * escala);
    const medidas = await page.evaluate(() => {
      const tabla = document.querySelector(".vale-tabla");
      const origen = tabla.getBoundingClientRect();
      return {
        filas: [...tabla.rows].map((fila) => {
          const rect = fila.getBoundingClientRect();
          return { alto: rect.height, y: rect.top - origen.top };
        }),
        columnas: [...tabla.querySelectorAll("col")].map((col) => col.getBoundingClientRect().width),
        ancho: origen.width, alto: origen.height,
      };
    });
    assert.equal(medidas.filas.length, altos.length);
    assert.equal(medidas.columnas.length, anchos.length);
    let y = 0;
    medidas.filas.forEach((fila, i) => {
      assert.ok(Math.abs(fila.alto - altos[i]) < 1, `Fila ${caso.modelo.filas[i].r}: alto ${fila.alto}, previsto ${altos[i]}`);
      assert.ok(Math.abs(fila.y - y) < 1, `Fila ${caso.modelo.filas[i].r}: posición ${fila.y}, prevista ${y}`);
      y += altos[i];
    });
    medidas.columnas.forEach((ancho, i) => assert.ok(Math.abs(ancho - anchos[i]) < 1, `Columna ${caso.modelo.columnas[i].c}: ancho ${ancho}, previsto ${anchos[i]}`));
    assert.ok(Math.abs(medidas.alto - y) < 1, "La tabla no debe crecer más que las filas del Excel");
    assert.ok(Math.abs(medidas.ancho - anchos.reduce((a, b) => a + b, 0)) < 1, "La tabla conserva el ancho del Excel");

    const posiciones = await page.evaluate((textos) => {
      const lienzo = document.querySelector(".vale-lienzo").getBoundingClientRect();
      return textos.map((texto) => {
        const celda = [...document.querySelectorAll("td")].find((td) => td.textContent === texto);
        if (!celda) return { texto, existe: false };
        const rect = celda.getBoundingClientRect();
        return { texto, existe: true, dentro: rect.left >= lienzo.left - 1 && rect.right <= lienzo.right + 1 && rect.top >= lienzo.top - 1 && rect.bottom <= lienzo.bottom + 1 };
      });
    }, [caso.descripcion, "OBSERVACION", caso.entrego, caso.recibio]);
    for (const posicion of posiciones) {
      assert.ok(posicion.existe, `Se conserva el texto: ${posicion.texto.slice(0, 50)}`);
      assert.ok(posicion.dentro, `El texto queda dentro del lienzo: ${posicion.texto.slice(0, 50)}`);
    }
  });

  await t.test("el texto sin ajuste se ve sobre la celda vecina vacía", async () => {
    await cargar();
    const clip = await page.evaluate((texto) => {
      const celda = [...document.querySelectorAll("td")].find((td) => td.textContent === texto);
      const rect = celda.getBoundingClientRect();
      const lienzo = document.querySelector(".vale-lienzo").getBoundingClientRect();
      return { x: Math.ceil(rect.right + 3), y: Math.ceil(rect.top + 1), width: Math.min(60, Math.floor(lienzo.right - rect.right - 6)), height: Math.floor(rect.height - 3) };
    }, caso.desbordado);
    assert.ok(clip.width > 0 && clip.height > 0, "Debe existir una región vacía a la derecha de la descripción");
    const conTexto = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate((texto) => {
      [...document.querySelectorAll("td")].find((td) => td.textContent === texto).textContent = "";
    }, caso.desbordado);
    const sinTexto = await page.screenshot({ clip, animations: "disabled" });
    assert.notDeepEqual(conTexto, sinTexto, "La región vecina debe contener tinta del texto sin ajuste");
  });

  await t.test("la etiqueta clara sobre la banda gris continúa visible", async () => {
    await cargar();
    const clip = await page.evaluate(() => {
      const celda = [...document.querySelectorAll("td")].find((td) => td.textContent === "OBSERVACION");
      const rect = celda.getBoundingClientRect();
      return { x: Math.ceil(rect.left + 1), y: Math.ceil(rect.top), width: Math.min(120, Math.floor(rect.width - 2)), height: Math.floor(rect.height) };
    });
    const conEtiqueta = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate(() => {
      [...document.querySelectorAll("td")].find((td) => td.textContent === "OBSERVACION").textContent = "";
    });
    const sinEtiqueta = await page.screenshot({ clip, animations: "disabled" });
    assert.notDeepEqual(conEtiqueta, sinEtiqueta, "OBSERVACION debe verse, no solo estar presente en el HTML");
  });

  await t.test("las bandas de observaciones siguen a sus celdas aunque cambie una altura en el lote", async () => {
    const casoLote = casoConTextoLargo();
    const estiloDe = casoLote.modelo.estiloDe.bind(casoLote.modelo);
    casoLote.modelo.estiloDe = (r, c) => (r === 49 ? 1002 : estiloDe(r, c));
    const inferior = { r1: 49, r2: 49, c1: 3, c2: 11 };
    for (let c = 3; c <= 11; c++) casoLote.modelo.combinadaEn.set(`49,${c}`, inferior);
    const cssOriginal = casoLote.modelo.estilos.css.bind(casoLote.modelo.estilos);
    casoLote.modelo.estilos.css = (indice) => {
      const estilo = cssOriginal(indice === 1002 ? 1001 : indice);
      return indice === 1001 || indice === 1002 ? { ...estilo, css: { ...estilo.css, background: "#7030A0", "text-align": "center", "vertical-align": "middle" } } : estilo;
    };
    const cssAplicacion = await readFile(new URL("../src/estilos.css", import.meta.url), "utf8");
    const pagina = impresion.paginaHtml(casoLote.modelo, casoLote.valores);
    await page.setViewportSize({ width: 1100, height: 5000 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${cssAplicacion}${impresion.cssImpresion(casoLote.modelo)}</style><body class="imprimiendo"><div id="area-impresion">${pagina.repeat(4)}</div></body>`);
    await page.evaluate(() => document.fonts.ready);
    const regiones = await page.evaluate((crecimientos) => [...document.querySelectorAll(".vale-pagina")].map((seccion, indice) => {
      const tabla = seccion.querySelector(".vale-tabla");
      const celda = [...tabla.querySelectorAll("td")].find((td) => td.textContent === "OBSERVACION");
      const celdas = [celda, tabla.rows[44].cells[0]]; // La banda inferior está en la fila 49.
      const iniciales = celdas.map((celda) => celda.getBoundingClientRect());
      const escala = Number(seccion.querySelector(".vale-lienzo").style.zoom);
      const partida = tabla.rows[16]; // La fila 21 del formulario, cuya área empieza en la 5.
      partida.style.height = `${Number.parseFloat(partida.style.height) + crecimientos[indice] / escala}px`;
      const primera = partida.cells[0].getBoundingClientRect();
      return celdas.map((celda, banda) => {
        const inicial = iniciales[banda];
        const actual = celda.getBoundingClientRect();
        return {
          x: Math.ceil(primera.left + 3), y: Math.ceil(inicial.top),
          width: Math.floor(primera.width - 6), height: Math.max(1, Math.floor(actual.top - inicial.top - 1)),
          tituloY: actual.top, crecimiento: actual.top - inicial.top,
        };
      });
    }), [26, 21, 12, 2]);
    assert.equal(await page.locator("td").filter({ hasText: /^OBSERVACION$/ }).count(), 4);
    assert.equal(await page.locator("td").filter({ hasText: casoLote.entrego }).count(), 4);
    assert.equal(await page.locator("td").filter({ hasText: casoLote.recibio }).count(), 4);
    for (const [indice, bandas] of regiones.entries()) {
      for (const [banda, region] of bandas.entries()) {
        assert.ok(region.crecimiento > 1, "La prueba reproduce una variación de altura visible");
        const clip = { x: region.x, y: region.y, width: region.width, height: region.height };
        const antes = await page.screenshot({ clip, animations: "disabled" });
        await page.locator(".vale-pagina").nth(indice).evaluate((seccion, limite) => {
          for (const fondo of seccion.querySelectorAll(".vale-fondo")) {
            if (getComputedStyle(fondo).backgroundColor === "rgb(112, 48, 160)" && fondo.getBoundingClientRect().top < limite - 1) fondo.remove();
          }
        }, region.tituloY);
        const sinCopiaAbsoluta = await page.screenshot({ clip, animations: "disabled" });
        assert.deepEqual(antes, sinCopiaAbsoluta, `Página ${indice + 1}, banda ${banda + 1}: ninguna copia morada invade las filas antes de la celda`);
      }
    }
    await page.setViewportSize({ width: 1100, height: 1200 });
  });

  await t.test("una combinación con origen oculto conserva su título sin tapar al vecino visible", async () => {
    const modelo = analizarFormulario(new LibroLeido(bytesVales()), "SOLDADOR");
    const rango = { r1: 21, r2: 22, c1: 6, c2: 8 };
    for (let r = 21; r <= 22; r++) {
      for (let c = 6; c <= 8; c++) modelo.combinadaEn.set(`${r},${c}`, rango);
    }
    modelo.filas = modelo.filas.filter((fila) => fila.r !== 21);
    const titulo = "TÍTULO LARGO DEL FORMATO ".repeat(10);
    const valorOriginal = modelo.valor;
    modelo.valor = (r, c) => {
      if (r === 21 && c === 6) return titulo;
      if (r === 21 && c === 9) return null;
      if (r === 22 && c === 9) return "VECINO VISIBLE";
      return valorOriginal(r, c);
    };
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0}${impresion.cssImpresion(modelo)}</style>${impresion.paginaHtml(modelo)}`);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("td").filter({ hasText: titulo }).count(), 1, "El título del origen oculto se imprime una sola vez");
    const clip = await page.evaluate(() => {
      const celda = [...document.querySelectorAll("td")].find((td) => td.textContent === "VECINO VISIBLE");
      const rect = celda.getBoundingClientRect();
      return { x: Math.ceil(rect.left + 2), y: Math.ceil(rect.top + 1), width: Math.floor(rect.width - 4), height: Math.floor(rect.height - 2) };
    });
    const conTitulo = await page.screenshot({ clip, animations: "disabled" });
    await page.evaluate((texto) => {
      [...document.querySelectorAll("td")].find((td) => td.textContent === texto).textContent = "";
    }, titulo);
    const sinTitulo = await page.screenshot({ clip, animations: "disabled" });
    assert.deepEqual(conTitulo, sinTitulo, "El título no invade la celda vecina que tiene texto en la fila visible");
  });

  await t.test("claves largas completas y centradas, con partidas llenas y fotos, mantienen una hoja por vale", async () => {
    const { build } = await import("esbuild");
    const compilado = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("..", import.meta.url)),
        contents: `import { Sesion } from "./src/ui/sesion.js";
          import { LibroLeido } from "./src/xlsx/leer.js";
          import { analizarFormulario } from "./src/impresion/formulario.js";
          globalThis.documentoClaves = async (bytes, claves) => {
            const libro = new LibroLeido(new Uint8Array(bytes));
            const paginas = ["SOLDADOR", "MECANICO ", "TRANSFERENCIAS", "NOV"].map((hoja, i) => {
              const modelo = analizarFormulario(libro, hoja);
              const cantidad = i ? modelo.capacidad : 2;
              const vale = { folio: 1200 + i, tipo: "SALIDA", fecha: "2026-10-09", observaciones: null,
                entrego_nombre: "ALMACENISTA DE PRUEBA", recibio_nombre: "USUARIO DE PRUEBA",
                lineas: Array.from({ length: cantidad }, (_, n) => ({ cantidad: "1", codigo: 701, oc: "S/OC",
                  descripcion: "REPUESTO SINTÉTICO", clave: claves[n % claves.length], um: "PZA" })) };
              const fotos = hoja === "NOV" ? modelo.fotos.map(() => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>')) : [];
              return { modelo, vale, fotos };
            });
            const antes = paginas.map(({ modelo }) => JSON.stringify({ filas: modelo.filas, fotos: modelo.fotos }));
            const documento = await Sesion.prototype._documentoImpresion.call({}, paginas, null);
            const sinCambios = paginas.every(({ modelo }, i) => JSON.stringify({ filas: modelo.filas, fotos: modelo.fotos }) === antes[i]);
            const medidorEliminado = ![...document.querySelectorAll("div")].some(el => el.style.left === "-10000px");
            return { documento, sinCambios, medidorEliminado, clavesPorPagina: paginas.map(p => p.vale.lineas.map(l => l.clave)) };
          };`,
      },
      bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
    });
    await page.setContent("<!doctype html><meta charset='utf-8'>");
    await page.addScriptTag({ content: compilado.outputFiles[0].text });
    const claves = ["Manija Sintetica Centro DP Slip ZZ 12345", 'Valvula de Prueba 5 1/4 10K Ajuste Estandar 6 5/8 FH Conexiones 8" OD X 3 1/16 ID 19.56" Longitud'];
    const resultado = await page.evaluate(([bytes, claves]) => globalThis.documentoClaves(bytes, claves), [Array.from(bytesVales()), claves]);
    assert.ok(resultado.sinCambios, "El Excel y sus anclas conservan el modelo original");
    assert.ok(resultado.medidorEliminado, "El medidor temporal se elimina después de generar el documento");
    await page.setViewportSize({ width: 1100, height: 5000 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0}${resultado.documento.css}</style>${resultado.documento.html}`);
    await page.evaluate(() => document.fonts.ready);
    const paginas = await page.evaluate((claves) => [...document.querySelectorAll(".vale-pagina")].map((pagina) => {
      const lienzo = pagina.querySelector(".vale-lienzo");
      const tabla = pagina.querySelector(".vale-tabla");
      const marco = lienzo.getBoundingClientRect();
      const hoja = pagina.getBoundingClientRect();
      const rectTabla = tabla.getBoundingClientRect();
      const escala = Number(lienzo.style.zoom);
      return {
        escala, dentro: marco.bottom <= hoja.bottom + 1 && rectTabla.bottom <= marco.bottom + 1,
        filasAlineadas: [...tabla.rows].every(tr => Math.abs(tr.getBoundingClientRect().height - Number.parseFloat(tr.style.height) * escala) < 1),
        observaciones: [...tabla.querySelectorAll("td")].filter(td => td.textContent === "OBSERVACION").length,
        firmas: [...tabla.querySelectorAll("td")].filter(td => ["ALMACENISTA DE PRUEBA", "USUARIO DE PRUEBA"].includes(td.textContent)).length,
        fotos: [...lienzo.querySelectorAll(".vale-foto")].map(foto => {
          const rect = foto.getBoundingClientRect();
          const finPartidas = Math.max(...[...tabla.querySelectorAll("td")].filter(td => claves.includes(td.textContent)).map(td => td.getBoundingClientRect().bottom));
          return rect.top >= finPartidas - 1 && rect.bottom <= marco.bottom + 1;
        }),
        claves: [...tabla.querySelectorAll("td")].filter(td => claves.includes(td.textContent)).map(td => {
          const celda = td.getBoundingClientRect();
          const texto = td.querySelector(".vale-texto>div").getBoundingClientRect();
          const rango = document.createRange();
          rango.selectNodeContents(td.querySelector(".vale-texto>div"));
          return { texto: td.textContent, alto: celda.height, ajuste: getComputedStyle(td).textAlign,
            centrado: Math.abs((texto.top + texto.bottom) / 2 - (celda.top + celda.bottom) / 2) < 1,
            completo: [...rango.getClientRects()].every(rect => rect.top >= celda.top - 0.5 && rect.bottom <= celda.bottom + 0.5 && rect.left >= celda.left - 0.5 && rect.right <= celda.right + 0.5) };
        }),
      };
    }), claves);
    assert.equal(paginas.length, 4);
    for (const [i, pagina] of paginas.entries()) {
      assert.deepEqual(pagina.claves.map(celda => celda.texto), resultado.clavesPorPagina[i], `Página ${i + 1}: todas las claves conservan su texto y orden`);
      assert.ok(pagina.dentro && pagina.filasAlineadas, `Página ${i + 1}: tabla y capas conservan la geometría dentro de la hoja`);
      assert.equal(pagina.observaciones, 1);
      assert.equal(pagina.firmas, 2);
      for (const celda of pagina.claves) {
        assert.ok(celda.completo, `Página ${i + 1}: clave sin recorte ${celda.texto}`);
        assert.ok(celda.centrado && celda.ajuste === "center", `Página ${i + 1}: clave centrada en ambos ejes`);
        assert.ok(celda.alto > 20 * pagina.escala, "La fila es más alta que la original");
      }
      assert.ok(pagina.fotos.every(Boolean), "Las fotos siguen dentro de la hoja y debajo de las partidas");
    }
    assert.equal(paginas[3].fotos.length, 3);
    assert.ok(paginas[1].escala < paginas[0].escala, "La hoja llena reduce su escala para conservar todas las partidas");
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 4, "El PDF contiene exactamente una página por vale");
    await page.setViewportSize({ width: 1100, height: 1200 });
  });
});
