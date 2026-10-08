// Ajustes que comparten DLTA y GSM (Ronda 18). La etapa de perforación es del pozo, no de un
// inventario: si se cambia en uno (en Ajustes, en el inicio o al emitir un vale con otra etapa), el
// otro la toma al abrirse, al hacer su primera carga o al restaurar un respaldo. Lo compartido vive en
// una base aparte ("control-almacen-comun", solo su almacén `ajustes`) con quién y cuándo lo cambió;
// cada estado conserva su copia (va en sus respaldos y prellena sus vales).

import { auditar } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";

export const COMPARTIDOS = ["etapa_perforacion"];
export const BD_COMUN = "control-almacen-comun";
const CLAVE = "compartidos";

const valorDe = (estado, clave) => estado?.config?.[clave] ?? "";

/**
 * Pasa al estado lo compartido que difiere: `config` y los borradores de vale que aún traían el valor
 * anterior (los que se cambiaron a mano se respetan). @returns las claves que cambiaron
 */
export function adoptarCompartidos(estado, compartidos, usuario = null) {
  const cambiadas = [];
  for (const clave of COMPARTIDOS) {
    const otro = compartidos?.[clave];
    if (!otro) continue;
    const antes = valorDe(estado, clave);
    if (antes === otro.valor) continue;
    estado.config[clave] = otro.valor;
    for (const borrador of estado.borradores ?? []) if ((borrador[clave] ?? "") === antes) borrador[clave] = otro.valor;
    auditar(estado, { usuario, entidad: "config", entidadId: clave, accion: "SINCRONIZAR", antes, despues: { valor: otro.valor, desde: otro.desde ?? null, en: otro.en ?? null } });
    cambiadas.push(clave);
  }
  return cambiadas;
}

/** Mantiene sincronizado lo compartido entre el inventario abierto (`almacen`) y la base común. */
export class Compartidos {
  constructor(almacen, backend) {
    this.almacen = almacen;
    this.backend = backend;
    this.guardados = undefined; // lo último leído o escrito en la base común
    this.pendiente = Promise.resolve();
    this.soltar = almacen.suscribir((estado, origen) => this._alCambiar(estado, origen));
  }

  /** Al abrir (y tras una primera carga o una restauración): toma lo compartido o, si aún no hay, lo publica. */
  sincronizar() {
    return this._enCola(async () => {
      if (this.almacen.vacio) return;
      const guardados = (await this.backend.leerAjuste(CLAVE)) ?? {};
      this.guardados = guardados;
      if (COMPARTIDOS.some((k) => guardados[k] && guardados[k].valor !== valorDe(this.almacen.estado, k))) {
        await this.almacen.modificar((e) => adoptarCompartidos(e, guardados));
      }
      const faltan = COMPARTIDOS.filter((k) => !guardados[k]);
      if (faltan.length) await this._publicar(faltan);
    });
  }

  /** Espera a que lo compartido quede guardado (antes de cambiar de inventario). */
  terminar() {
    return this.pendiente;
  }

  cerrar() {
    this.soltar?.();
  }

  _alCambiar(estado, origen) {
    if (!estado || this.almacen.vacio) return;
    if (origen === "carga" || origen === "restaurar") {
      this.sincronizar();
      return;
    }
    if (origen !== "cambio" || this.guardados === undefined) return;
    const claves = COMPARTIDOS.filter((k) => valorDe(estado, k) !== (this.guardados[k]?.valor ?? null));
    if (claves.length) this._enCola(() => this._publicar(claves));
  }

  async _publicar(claves) {
    const guardados = { ...((await this.backend.leerAjuste(CLAVE)) ?? {}) };
    for (const k of claves) guardados[k] = { valor: valorDe(this.almacen.estado, k), en: ahoraIso(), desde: this.almacen.inventario };
    await this.backend.guardarAjuste(CLAVE, guardados);
    this.guardados = guardados;
  }

  _enCola(tarea) {
    const resultado = this.pendiente.then(tarea);
    this.pendiente = resultado.catch((error) => console.warn("Ajustes compartidos:", error));
    return resultado;
  }
}
