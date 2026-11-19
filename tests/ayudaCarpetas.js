// Carpetas y archivos en memoria con la forma de la API de acceso a archivos del navegador
// (FileSystemDirectoryHandle / FileSystemFileHandle), para probar sin navegador. Como en Windows, los nombres
// no distinguen mayúsculas: getDirectoryHandle("almacen dlta") encuentra "ALMACEN DLTA".

const domError = (name, message = "") => Object.assign(new Error(message), { name });

export class ArchivoFalso {
  constructor(nombre, datos = new Uint8Array()) {
    this.kind = "file";
    this.name = nombre;
    this.datos = datos;
    this.permiso = "granted";
    this.pedidos = [];
    this.bloqueado = false; // como abierto en Excel: no deja reemplazarlo
    this.escrituras = 0;
  }

  async queryPermission() {
    return this.permiso;
  }

  async requestPermission() {
    this.pedidos.push("permiso");
    if (this.permiso === "prompt") this.permiso = this.alPedir ?? "granted";
    return this.permiso;
  }

  async createWritable() {
    let nuevos = null;
    return {
      write: async (d) => {
        nuevos = d;
      },
      close: async () => {
        if (this.bloqueado) throw domError("NoModificationAllowedError");
        this.datos = new Uint8Array(nuevos);
        this.escrituras += 1;
      },
      abort: async () => {},
    };
  }

  async getFile() {
    return { size: this.datos.length, lastModified: 0, arrayBuffer: async () => this.datos.buffer };
  }

  async isSameEntry(otro) {
    return otro === this;
  }
}

export class CarpetaFalsa {
  constructor(nombre) {
    this.kind = "directory";
    this.name = nombre;
    this.hijos = new Map();
    this.permiso = "granted";
    this.pedidos = [];
  }

  _clave(nombre) {
    return [...this.hijos.keys()].find((n) => n.toLowerCase() === String(nombre).toLowerCase());
  }

  /** El hijo con ese nombre (sin distinguir mayúsculas), o undefined. */
  hijo(nombre) {
    const clave = this._clave(nombre);
    return clave === undefined ? undefined : this.hijos.get(clave);
  }

  /** Lo de adentro por ruta: carpeta.en("ALMACEN DLTA", "2026"). */
  en(...partes) {
    return partes.reduce((c, p) => c?.hijo?.(p), this);
  }

  async queryPermission() {
    return this.permiso;
  }

  async requestPermission() {
    this.pedidos.push("permiso");
    if (this.permiso === "prompt") this.permiso = this.alPedir ?? "granted";
    return this.permiso;
  }

  async getDirectoryHandle(nombre, { create = false } = {}) {
    if (/[\\/]/.test(nombre) || nombre === ".." || nombre === ".") throw domError("TypeError", "Name is not allowed.");
    const hallado = this.hijo(nombre);
    if (hallado) {
      if (hallado.kind !== "directory") throw domError("TypeMismatchError");
      return hallado;
    }
    if (!create) throw domError("NotFoundError");
    if (this.sinPermisoDeCrear) throw domError("NotAllowedError");
    const nueva = new CarpetaFalsa(nombre);
    nueva.permiso = this.permiso;
    this.hijos.set(nombre, nueva);
    return nueva;
  }

  async getFileHandle(nombre, { create = false } = {}) {
    const hallado = this.hijo(nombre);
    if (hallado) {
      if (hallado.kind !== "file") throw domError("TypeMismatchError");
      return hallado;
    }
    if (!create) throw domError("NotFoundError");
    const nuevo = new ArchivoFalso(nombre);
    this.hijos.set(nombre, nuevo);
    return nuevo;
  }

  async removeEntry(nombre) {
    const clave = this._clave(nombre);
    if (clave === undefined) throw domError("NotFoundError");
    this.hijos.delete(clave);
  }

  async *entries() {
    yield* [...this.hijos.entries()];
  }

  async isSameEntry(otro) {
    return otro === this;
  }

  /** Las carpetas desde esta hasta `otro` (como FileSystemDirectoryHandle.resolve), o null si no está dentro. */
  async resolve(otro) {
    if (otro === this) return [];
    for (const [nombre, hijo] of this.hijos) {
      if (hijo === otro) return [nombre];
      if (hijo.kind === "directory") {
        const abajo = await hijo.resolve(otro);
        if (abajo) return [nombre, ...abajo];
      }
    }
    return null;
  }
}

/**
 * Árbol de carpetas desde un objeto: { "ALMACEN DLTA": { "2026": { "11. NOVIEMBRE": {} } }, "a.xlsx": "" }
 * (objeto = carpeta, texto = archivo con ese contenido).
 */
export function arbol(nombre, contenido = {}) {
  const carpeta = new CarpetaFalsa(nombre);
  for (const [hijo, valor] of Object.entries(contenido)) {
    carpeta.hijos.set(hijo, typeof valor === "string" ? new ArchivoFalso(hijo, new TextEncoder().encode(valor)) : arbol(hijo, valor));
  }
  return carpeta;
}

/** Carpetas de meses: meses(10, 11) → { "10. OCTUBRE": {}, "11. NOVIEMBRE": {} } */
const NOMBRES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
export function meses(desde, hasta, forma = (n, nombre) => `${String(n).padStart(2, "0")}. ${nombre}`) {
  const salida = {};
  for (let n = desde; n <= hasta; n++) salida[forma(n, NOMBRES[n - 1])] = {};
  return salida;
}
