// Ajustes que comparten DLTA y GSM. Ronda 18: la etapa de perforación es del pozo, no de un
// inventario. Ronda 19: también la personalización de cada almacenista (tema, avisos, animaciones), la
// captura de partidas y "Mi pantalla de vales" son de la persona, no del inventario. Ronda 20: el
// diseño de las etiquetas y la identidad (logos, texto) de cada inventario en ellas. Si se cambian en
// uno (en Ajustes, en el inicio o al emitir un vale con otra etapa), el otro los toma al abrirse, al
// hacer su primera carga o al restaurar un respaldo. Lo compartido vive en una base aparte
// ("control-almacen-comun", solo su almacén `ajustes`) con quién y cuándo lo cambió; cada estado conserva
// su copia (va en sus respaldos y prellena sus vales). Gana el último cambio, completo.
//
// Ronda 21: también dos colecciones del estado (no de `config`): la **lista de etiquetas por imprimir**
// (gana la del último cambio según su `cambiado_en`; la de antes de compartirse se junta) y la **bitácora
// de impresiones** (se juntan las dos: nunca se pierde una). No van en la auditoría: no son ajustes.

import { auditar } from "../nucleo/estado.js";
import { ahoraIso } from "../nucleo/fechas.js";
import { adoptarListaEtiquetas, juntarImpresiones, listaPublicable } from "../servicios/etiquetas.js";

/** Clave de `config` → valor si el estado no la tiene. */
export const VALORES_COMPARTIDOS = {
  etapa_perforacion: "",
  personalizacion: {}, // por almacenista: tema, avisos, animaciones
  captura_rapida: false,
  preferencias_vale: {}, // por almacenista: "Mi pantalla de vales"
  etiquetas: {}, // Ronda 20: diseño de la hoja y logos / texto de cada inventario (servicios/etiquetas.js)
};
export const BD_COMUN = "control-almacen-comun";
const CLAVE = "compartidos";

/**
 * Cómo se lee, se escribe y se junta cada cosa compartida:
 *   leer(estado)          el valor en este estado
 *   poner(estado, valor)
 *   adoptar(aqui, alla)   lo que queda al traer el compartido (`alla`)
 *   publicable(valor)     lo que se guarda en la base común (y con lo que se compara)
 *   bitacora              si se anota SINCRONIZAR en la auditoría
 */
const enConfig = (clave) => ({
  leer: (estado) => estado?.config?.[clave] ?? VALORES_COMPARTIDOS[clave],
  poner: (estado, valor) => {
    estado.config[clave] = valor;
  },
  adoptar: (aqui, alla) => alla,
  publicable: (valor) => valor,
  bitacora: true,
});

const EN_ESTADO = {
  etiquetas_por_imprimir: {
    leer: (estado) => estado?.etiquetas ?? { material: [], ax: [], cambiado_en: null },
    poner: (estado, valor) => {
      estado.etiquetas = valor;
    },
    adoptar: adoptarListaEtiquetas,
    publicable: listaPublicable,
    bitacora: false,
  },
  impresiones_etiquetas: {
    leer: (estado) => estado?.impresiones_etiquetas ?? [],
    poner: (estado, valor) => {
      estado.impresiones_etiquetas = valor;
    },
    adoptar: juntarImpresiones,
    publicable: (valor) => valor,
    bitacora: false,
  },
};

const ACCESO = { ...Object.fromEntries(Object.keys(VALORES_COMPARTIDOS).map((k) => [k, enConfig(k)])), ...EN_ESTADO };
export const COMPARTIDOS = Object.keys(ACCESO);

const valorDe = (estado, clave) => ACCESO[clave].leer(estado);
/** Lo que se compara con la base común (la lista sin su marca de «por juntar»). */
const publicableDe = (estado, clave) => ACCESO[clave].publicable(valorDe(estado, clave));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Para la bitácora: las imágenes (logos de las etiquetas) se anotan por su tamaño, no completas. */
export function sinImagenes(valor) {
  if (typeof valor === "string") return valor.startsWith("data:") ? `[imagen de ${Math.round((valor.length * 3) / 4 / 1024)} KB]` : valor;
  if (Array.isArray(valor)) return valor.map(sinImagenes);
  if (valor && typeof valor === "object") return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sinImagenes(v)]));
  return valor;
}

/**
 * Pasa al estado lo compartido que difiere: `config` y los borradores de vale que aún traían el valor
 * anterior (los que se cambiaron a mano se respetan). @returns las claves que cambiaron
 */
export function adoptarCompartidos(estado, compartidos, usuario = null) {
  const cambiadas = [];
  for (const clave of COMPARTIDOS) {
    const otro = compartidos?.[clave];
    if (!otro) continue;
    const acceso = ACCESO[clave];
    const antes = valorDe(estado, clave);
    const nuevo = acceso.adoptar(structuredClone(antes), structuredClone(otro.valor));
    if (igual(antes, nuevo)) continue;
    acceso.poner(estado, nuevo);
    // Solo la etapa va también en los borradores de vale.
    if (clave === "etapa_perforacion") for (const b of estado.borradores ?? []) if ((b[clave] ?? "") === antes) b[clave] = nuevo;
    if (acceso.bitacora) {
      auditar(estado, { usuario, entidad: "config", entidadId: clave, accion: "SINCRONIZAR", antes: sinImagenes(antes), despues: { valor: sinImagenes(otro.valor), desde: otro.desde ?? null, en: otro.en ?? null } });
    }
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

  /**
   * Al abrir (y tras una primera carga o una restauración): toma lo compartido o, si aún no hay, lo publica.
   * `juntar: false` (al restaurar): una lista del formato 10 que trae el respaldo NO se vuelve a juntar con
   * la compartida (sus etiquetas ya se imprimieron o se quitaron desde entonces); gana la compartida.
   */
  sincronizar({ juntar = true } = {}) {
    return this._enCola(async () => {
      if (this.almacen.vacio) return;
      const guardados = (await this.backend.leerAjuste(CLAVE)) ?? {};
      this.guardados = guardados;
      if (!juntar && this.almacen.estado?.etiquetas?.juntar && guardados.etiquetas_por_imprimir) {
        await this.almacen.modificar((e) => {
          delete e.etiquetas.juntar;
        });
      }
      // Si algo difiere se adopta; lo que aquí es más nuevo (la lista) o tiene de más (la bitácora) se publica
      // después, en _alCambiar.
      if (COMPARTIDOS.some((k) => guardados[k] && !igual(guardados[k].valor, publicableDe(this.almacen.estado, k)))) {
        await this.almacen.modificar((e) => adoptarCompartidos(e, guardados));
      }
      const faltan = COMPARTIDOS.filter((k) => !guardados[k]);
      if (faltan.length) await this._publicar(faltan);
      // La lista de antes de compartirse ya quedó junta con la compartida (o es la primera publicada):
      // desde ahora gana el último cambio, como cualquier otra.
      if (this.almacen.estado?.etiquetas?.juntar) {
        await this.almacen.modificar((e) => {
          delete e.etiquetas.juntar;
        });
      }
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
      this.sincronizar({ juntar: origen !== "restaurar" });
      return;
    }
    if (origen !== "cambio" || this.guardados === undefined) return;
    const claves = COMPARTIDOS.filter((k) => !igual(publicableDe(estado, k), this.guardados[k]?.valor));
    if (claves.length) this._enCola(() => this._publicar(claves));
  }

  async _publicar(claves) {
    const guardados = { ...((await this.backend.leerAjuste(CLAVE)) ?? {}) };
    for (const k of claves) guardados[k] = { valor: structuredClone(publicableDe(this.almacen.estado, k)), en: ahoraIso(), desde: this.almacen.inventario };
    await this.backend.guardarAjuste(CLAVE, guardados);
    this.guardados = guardados;
  }

  _enCola(tarea) {
    const resultado = this.pendiente.then(tarea);
    this.pendiente = resultado.catch((error) => console.warn("Ajustes compartidos:", error));
    return resultado;
  }
}
