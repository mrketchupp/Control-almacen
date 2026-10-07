// Dónde viven los datos: IndexedDB del navegador, en ESTE equipo. Nada sale a internet.
// Una base por inventario: "control-almacen" (DLTA, la de siempre) y "control-almacen-gsm" (GSM).
//
// Almacenes:
//   estado        'actual' → el estado completo (un solo objeto)
//   archivos      clave → { clave, nombre, tipo, datos: Uint8Array, sha256, guardado_en }
//   ajustes       clave → valor (carpeta elegida, último respaldo, …)
//   instantaneas  autoincremental → { fecha_hora, motivo, estado } (copias internas)

const NOMBRE_BD = "control-almacen";
const VERSION_BD = 1;
const MAX_INSTANTANEAS = 10;

function promesa(peticion) {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

function terminada(tx) {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error || new Error("Transacción cancelada"));
  });
}

export class BackendIndexedDB {
  constructor(nombre = NOMBRE_BD) {
    this.nombre = nombre;
    this.bd = null;
  }

  async abrir() {
    if (this.bd) return this.bd;
    const peticion = indexedDB.open(this.nombre, VERSION_BD);
    peticion.onupgradeneeded = () => {
      const bd = peticion.result;
      if (!bd.objectStoreNames.contains("estado")) bd.createObjectStore("estado");
      if (!bd.objectStoreNames.contains("archivos")) bd.createObjectStore("archivos");
      if (!bd.objectStoreNames.contains("ajustes")) bd.createObjectStore("ajustes");
      if (!bd.objectStoreNames.contains("instantaneas")) bd.createObjectStore("instantaneas", { autoIncrement: true });
    };
    this.bd = await promesa(peticion);
    this.bd.onversionchange = () => this.bd.close();
    return this.bd;
  }

  /** Suelta la conexión (al cambiar de inventario). */
  cerrar() {
    this.bd?.close();
    this.bd = null;
  }

  async _leer(almacen, clave) {
    const bd = await this.abrir();
    return promesa(bd.transaction(almacen).objectStore(almacen).get(clave));
  }

  async _escribir(almacen, clave, valor) {
    const bd = await this.abrir();
    const tx = bd.transaction(almacen, "readwrite");
    tx.objectStore(almacen).put(valor, clave);
    await terminada(tx);
  }

  leerEstado() {
    return this._leer("estado", "actual").then((e) => e ?? null);
  }

  guardarEstado(estado) {
    return this._escribir("estado", "actual", estado);
  }

  /** Estado y archivos en UNA transacción: o se guarda todo o nada. */
  async guardarTodo(estado, archivos = []) {
    const bd = await this.abrir();
    const tx = bd.transaction(["estado", "archivos"], "readwrite");
    for (const archivo of archivos) tx.objectStore("archivos").put(archivo, archivo.clave);
    tx.objectStore("estado").put(estado, "actual");
    await terminada(tx);
  }

  leerArchivo(clave) {
    return this._leer("archivos", clave).then((a) => a ?? null);
  }

  guardarArchivo(archivo) {
    return this._escribir("archivos", archivo.clave, archivo);
  }

  async listarArchivos() {
    const bd = await this.abrir();
    return promesa(bd.transaction("archivos").objectStore("archivos").getAllKeys());
  }

  async borrarArchivos(claves) {
    const bd = await this.abrir();
    const tx = bd.transaction("archivos", "readwrite");
    for (const clave of claves) tx.objectStore("archivos").delete(clave);
    await terminada(tx);
  }

  leerAjuste(clave) {
    return this._leer("ajustes", clave).then((v) => v ?? null);
  }

  guardarAjuste(clave, valor) {
    return this._escribir("ajustes", clave, valor);
  }

  async guardarInstantanea(estado, motivo, fechaHora) {
    const bd = await this.abrir();
    const tx = bd.transaction("instantaneas", "readwrite");
    const almacen = tx.objectStore("instantaneas");
    almacen.add({ fecha_hora: fechaHora, motivo, estado });
    const claves = await promesa(almacen.getAllKeys());
    for (const clave of claves.slice(0, Math.max(0, claves.length + 1 - MAX_INSTANTANEAS))) almacen.delete(clave);
    await terminada(tx);
  }

  /** [{ clave, fecha_hora, motivo }] de la más reciente a la más antigua (sin el estado). */
  async listarInstantaneas() {
    const bd = await this.abrir();
    const almacen = bd.transaction("instantaneas").objectStore("instantaneas");
    const [claves, valores] = await Promise.all([promesa(almacen.getAllKeys()), promesa(almacen.getAll())]);
    return claves.map((clave, i) => ({ clave, fecha_hora: valores[i].fecha_hora, motivo: valores[i].motivo })).reverse();
  }

  leerInstantanea(clave) {
    return this._leer("instantaneas", clave);
  }

  /** Borra TODOS los datos de este navegador (estado, plantillas, copias internas). */
  async borrarTodo() {
    const bd = await this.abrir();
    const tx = bd.transaction(["estado", "archivos", "instantaneas"], "readwrite");
    for (const almacen of ["estado", "archivos", "instantaneas"]) tx.objectStore(almacen).clear();
    await terminada(tx);
  }
}

/** Mismo contrato que BackendIndexedDB, en memoria (pruebas). */
export class BackendMemoria {
  constructor() {
    this.estado = null;
    this.archivos = new Map();
    this.ajustes = new Map();
    this.instantaneas = [];
  }

  cerrar() {}

  async leerEstado() {
    return this.estado ? structuredClone(this.estado) : null;
  }

  async guardarEstado(estado) {
    this.estado = structuredClone(estado);
  }

  async guardarTodo(estado, archivos = []) {
    for (const a of archivos) this.archivos.set(a.clave, a);
    this.estado = structuredClone(estado);
  }

  async leerArchivo(clave) {
    return this.archivos.get(clave) ?? null;
  }

  async guardarArchivo(archivo) {
    this.archivos.set(archivo.clave, archivo);
  }

  async listarArchivos() {
    return [...this.archivos.keys()];
  }

  async borrarArchivos(claves) {
    for (const clave of claves) this.archivos.delete(clave);
  }

  async leerAjuste(clave) {
    return this.ajustes.get(clave) ?? null;
  }

  async guardarAjuste(clave, valor) {
    this.ajustes.set(clave, valor);
  }

  async guardarInstantanea(estado, motivo, fechaHora) {
    this.instantaneas.push({ clave: this.instantaneas.length + 1, fecha_hora: fechaHora, motivo, estado: structuredClone(estado) });
    this.instantaneas = this.instantaneas.slice(-MAX_INSTANTANEAS);
  }

  async listarInstantaneas() {
    return this.instantaneas.map(({ clave, fecha_hora, motivo }) => ({ clave, fecha_hora, motivo })).reverse();
  }

  async leerInstantanea(clave) {
    return this.instantaneas.find((i) => i.clave === clave) ?? null;
  }

  async borrarTodo() {
    this.estado = null;
    this.archivos.clear();
    this.instantaneas = [];
  }
}
