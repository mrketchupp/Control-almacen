// Utilidades para las pruebas: Excel SINTÉTICOS generados por tests/fixtures/generar.py
// (nunca datos reales). Se generan una vez y se reutilizan mientras el generador no cambie.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leerInventario } from "../src/importadores/inventario.js";
import { leerVales } from "../src/importadores/vales.js";
import { ejecutarPrimeraCarga } from "../src/servicios/primeraCarga.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const generador = join(aqui, "fixtures", "generar.py");

function generar() {
  const huella = createHash("sha256").update(readFileSync(generador)).digest("hex").slice(0, 12);
  const carpeta = join(tmpdir(), `control-almacen-fixtures-${huella}`);
  const indice = join(carpeta, "indice.json");
  if (existsSync(indice)) return JSON.parse(readFileSync(indice, "utf8"));
  const temporal = `${carpeta}.${process.pid}`;
  mkdirSync(temporal, { recursive: true });
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const salida = execFileSync(python, [generador, temporal], { encoding: "utf8" });
  const datos = JSON.parse(salida.trim().split("\n").pop());
  const final = {
    inventario: join(carpeta, "INVENTARIO SINTETICO.xlsx"),
    vales: join(carpeta, "VALES SINTETICO.xlsm"),
    catalogo: datos.catalogo,
    folio_corte: datos.folio_corte,
  };
  writeFileSync(join(temporal, "indice.json"), JSON.stringify(final));
  try {
    renameSync(temporal, carpeta);
  } catch {
    rmSync(temporal, { recursive: true, force: true }); // otra prueba lo generó al mismo tiempo
  }
  return JSON.parse(readFileSync(indice, "utf8"));
}

export const fixtures = generar();
export const FOLIO_CORTE = fixtures.folio_corte;
export const CATALOGO = new Map(Object.entries(fixtures.catalogo).map(([k, v]) => [Number(k), v]));

export const bytesInventario = () => new Uint8Array(readFileSync(fixtures.inventario));
export const bytesVales = () => new Uint8Array(readFileSync(fixtures.vales));
export const libroInventario = () => leerInventario(bytesInventario(), "INVENTARIO SINTETICO.xlsx");
export const libroVales = () => leerVales(bytesVales(), "VALES SINTETICO.xlsm");

export function cargaSintetica(opciones = {}) {
  return ejecutarPrimeraCarga(libroInventario(), libroVales(), {
    folioCorte: FOLIO_CORTE,
    fechaConteo: "2026-09-03",
    usuario: "PRUEBA",
    ...opciones,
  });
}
