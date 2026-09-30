// Compila la herramienta en UN solo archivo HTML autocontenido (sin red, sin instalar nada):
//   dist/ControlAlmacen.html  → para abrir con doble clic en Edge
//   dist/index.html           → la misma página, para publicarla en un sitio estático
//
// Uso: npm run build

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const paquete = JSON.parse(await readFile(join(raiz, "package.json"), "utf8"));
const fecha = new Date().toISOString().slice(0, 10);
const version = `${paquete.version} (${fecha})`;

const resultado = await build({
  entryPoints: [join(raiz, "src/main.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: ["chrome110", "edge110", "firefox115", "safari16"],
  charset: "utf8",
  legalComments: "none",
  write: false,
  define: { __VERSION__: JSON.stringify(version) },
});

// Un <script> en línea no puede contener "</script" ni "<!--".
const js = resultado.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const hash = `sha256-${createHash("sha256").update(js, "utf8").digest("base64")}`;
const css = await readFile(join(raiz, "src/estilos.css"), "utf8");

const licencias = [];
for (const [nombre, archivo] of [
  ["preact", "LICENSE"],
  ["htm", "LICENSE"],
  ["fflate", "LICENSE"],
  ["big.js", "LICENCE.md"],
]) {
  const datos = JSON.parse(await readFile(join(raiz, "node_modules", nombre, "package.json"), "utf8"));
  const texto = await readFile(join(raiz, "node_modules", nombre, archivo), "utf8");
  licencias.push(`== ${nombre} ${datos.version} (${datos.license}) ==\n${texto.replace(/--/g, "- -").trim()}`);
}

const plantilla = await readFile(join(raiz, "src/index.html"), "utf8");
const html =
  plantilla
    .replace("%HASH_SCRIPT%", hash)
    .replace("%VERSION%", version)
    .replace("%CSS%", () => css)
    .replace("%JS%", () => js) +
  `<!--\nControl de Almacén ${version}\nComponentes de terceros incluidos en este archivo:\n\n${licencias.join("\n\n")}\n-->\n`;

await mkdir(join(raiz, "dist"), { recursive: true });
await writeFile(join(raiz, "dist/ControlAlmacen.html"), html);
await writeFile(join(raiz, "dist/index.html"), html);
console.log(`dist/ControlAlmacen.html · ${(html.length / 1024).toFixed(0)} KB · versión ${version}`);
