// Logos y textos del vale impreso de ESTE inventario (Ronda 17): `config.vale_impreso`, en el estado
// (y por lo tanto en los respaldos). Solo cambian lo fijo de la hoja-formulario al imprimir; los vales,
// el DIARIO exportado y el Excel del usuario no cambian. Ver src/impresion/identidad.js.

import { auditar } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";

export class ErrorValeImpreso extends Error {}

/** Tamaño máximo de un logo guardado (caracteres del data: URL, ~300 KB de imagen). */
export const MAXIMO_LOGO = 400 * 1024;

const comparable = (texto) => texto.trim().toUpperCase().replace(/\s+/g, " ");

function valeImpreso(estado) {
  estado.config ??= {};
  estado.config.vale_impreso ??= {};
  estado.config.vale_impreso.textos ??= [];
  estado.config.vale_impreso.logos ??= {};
  return estado.config.vale_impreso;
}

/**
 * Reemplaza las reglas de texto { buscar, poner } (en orden). Se quitan las vacías y las repetidas
 * (gana la primera). @returns true si cambió algo
 */
export function guardarTextosVale(estado, textos, usuario = null) {
  const limpios = [];
  const vistos = new Set();
  for (const t of textos ?? []) {
    const buscar = String(t?.buscar ?? "").trim();
    if (!buscar || vistos.has(comparable(buscar))) continue;
    vistos.add(comparable(buscar));
    limpios.push({ buscar, poner: String(t?.poner ?? "").trim() });
  }
  const vale = valeImpreso(estado);
  const antes = vale.textos;
  if (JSON.stringify(antes) === JSON.stringify(limpios)) return false;
  vale.textos = limpios;
  auditar(estado, { usuario, entidad: "config", entidadId: "vale_impreso", accion: "EDITAR", antes: { textos: antes }, despues: { textos: limpios } });
  return true;
}

const describir = (logo) => (!logo ? "original" : logo.quitar ? "no se imprime" : `imagen ${logo.nombre || "nueva"}`);

/**
 * Cambia un logo del formato (por su huella): { src, nombre } = otra imagen (data:image/png|jpeg),
 * { quitar: true } = no se imprime, null = el original.
 */
export function fijarLogoVale(estado, huella, cambio, usuario = null) {
  if (!huella) throw new ErrorValeImpreso("Falta decir qué imagen del formato se cambia.");
  if (cambio?.src !== undefined) {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(cambio.src)) throw new ErrorValeImpreso("La imagen debe ser PNG o JPG.");
    if (cambio.src.length > MAXIMO_LOGO) throw new ErrorValeImpreso("La imagen es muy grande: usa una de menos de 300 KB.");
  }
  const logos = valeImpreso(estado).logos;
  const antes = describir(logos[huella]);
  if (!cambio) delete logos[huella];
  else logos[huella] = cambio.quitar ? { quitar: true } : { src: cambio.src, nombre: cambio.nombre ?? null, guardado_en: ahoraIso() };
  auditar(estado, { usuario, entidad: "config", entidadId: `vale_impreso.logo.${huella}`, accion: "EDITAR", antes, despues: describir(logos[huella]) });
}
