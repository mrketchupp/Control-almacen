// El "almacén" de datos de la aplicación: estado en memoria + guardado local.
//
// Cada cambio se hace sobre una copia; solo si se guardó bien en el navegador
// se vuelve el estado vigente (como una transacción). Los cambios se atienden
// de uno en uno, en orden.

import { ddmmaa, ahoraIso, hoyIso } from "../nucleo/fechas.js";
import { estaVacio, migrarEstado } from "../nucleo/estado.js";
import { exportarInventario } from "../exportadores/inventario.js";
import { exportarVales } from "../exportadores/vales.js";
import { crearRespaldo, leerRespaldo } from "./respaldos.js";

export class SinPlantilla extends Error {}
export class BaseNoVacia extends Error {}

export async function sha256(datos) {
  const resumen = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extension(nombre) {
  const i = nombre.lastIndexOf(".");
  return i < 0 ? "" : nombre.slice(i).toLowerCase();
}

/** Reemplaza la fecha DDMMAA del nombre original (o la agrega al final). */
export function nombreConFecha(nombreOriginal, iso) {
  const i = nombreOriginal.lastIndexOf(".");
  const base = i < 0 ? nombreOriginal : nombreOriginal.slice(0, i);
  const sufijo = i < 0 ? "" : nombreOriginal.slice(i);
  const texto = ddmmaa(iso);
  if (/\d{6}(?!\d)/.test(base)) return base.replace(/\d{6}(?!\d)/, texto) + sufijo;
  return `${base} ${texto}${sufijo}`;
}

export class Almacen {
  constructor(backend, { version = "" } = {}) {
    this.backend = backend;
    this.version = version;
    this.estado = null;
    this.oyentes = new Set();
    this.cola = Promise.resolve();
  }

  async iniciar() {
    const guardado = await this.backend.leerEstado();
    const formato = guardado?.formato;
    this.estado = migrarEstado(guardado);
    if (guardado && formato !== this.estado.formato) await this.backend.guardarEstado(this.estado);
    return this.estado;
  }

  get vacio() {
    return estaVacio(this.estado);
  }

  suscribir(oyente) {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  _avisar() {
    for (const oyente of this.oyentes) oyente(this.estado);
  }

  _enCola(tarea) {
    const resultado = this.cola.then(tarea);
    this.cola = resultado.catch(() => {});
    return resultado;
  }

  /** Aplica `cambio(borrador)` y lo guarda. Si algo falla, el estado vigente no cambia. */
  modificar(cambio) {
    return this._enCola(async () => {
      if (!this.estado) throw new Error("Aún no hay datos: haz la primera carga.");
      const borrador = structuredClone(this.estado);
      const resultado = await cambio(borrador);
      await this.backend.guardarEstado(borrador);
      this.estado = borrador;
      this._avisar();
      return resultado;
    });
  }

  // ------------------------------------------------------------ plantillas

  /** Registra los archivos del usuario como plantillas y guarda el estado nuevo (primera carga). */
  cargarPrimeraVez(estado, plantillas) {
    return this._enCola(async () => {
      if (!estaVacio(this.estado)) {
        throw new BaseNoVacia("Ya hay datos cargados. La primera carga solo se hace con la herramienta vacía.");
      }
      const archivos = await this._registrarPlantillas(estado, plantillas);
      await this.backend.guardarTodo(estado, archivos);
      this.estado = estado;
      this._avisar();
    });
  }

  async _registrarPlantillas(estado, plantillas) {
    const archivos = [];
    const ahora = ahoraIso();
    for (const { tipo, nombre, datos } of plantillas) {
      const huella = await sha256(datos);
      const archivo = `${tipo.toLowerCase()}_${huella.slice(0, 12)}${extension(nombre)}`;
      for (const anterior of estado.plantillas_excel) if (anterior.tipo === tipo) anterior.activa = false;
      estado.plantillas_excel.push({
        id: estado.plantillas_excel.length + 1,
        tipo,
        nombre_original: nombre,
        archivo,
        sha256: huella,
        activa: true,
        registrada_en: ahora,
      });
      archivos.push({ clave: archivo, nombre, tipo, datos, sha256: huella, guardado_en: ahora });
    }
    return archivos;
  }

  async plantillaActiva(tipo) {
    const registro = [...(this.estado?.plantillas_excel ?? [])].reverse().find((p) => p.tipo === tipo && p.activa);
    const archivo = registro ? await this.backend.leerArchivo(registro.archivo) : null;
    if (!registro || !archivo) throw new SinPlantilla(`No hay plantilla registrada para ${tipo.toLowerCase()}.`);
    return { registro, datos: archivo.datos };
  }

  async plantillasDelEstado(estado = this.estado) {
    const salida = [];
    for (const registro of estado?.plantillas_excel ?? []) {
      const archivo = await this.backend.leerArchivo(registro.archivo);
      if (archivo) salida.push({ archivo: registro.archivo, datos: archivo.datos });
    }
    return salida;
  }

  // ------------------------------------------------------------ exportar

  /**
   * Genera el Excel actualizado sobre la plantilla del usuario.
   * @param tipo 'VALES' | 'INVENTARIO'
   * @returns {{ nombre, datos, subcarpeta, resultado }}
   */
  /** Nombre con el que se exporta (el del archivo original; el inventario lleva la fecha). */
  nombreExportacion(tipo, hoy = hoyIso()) {
    const registro = [...(this.estado?.plantillas_excel ?? [])].reverse().find((p) => p.tipo === tipo && p.activa);
    if (!registro) return null;
    return tipo === "VALES" ? registro.nombre_original : nombreConFecha(registro.nombre_original, hoy);
  }

  /**
   * Genera el Excel sobre la plantilla. Con `guardar(nombre, datos)` lo escribe antes de registrar
   * la exportación (si falla la escritura, no queda registrada).
   */
  async exportar(tipo, usuario, hoy = hoyIso(), { guardar = null } = {}) {
    const { registro, datos: plantilla } = await this.plantillaActiva(tipo);
    const resultado = tipo === "VALES" ? exportarVales(this.estado, plantilla) : exportarInventario(this.estado, plantilla);
    const nombre = tipo === "VALES" ? registro.nombre_original : nombreConFecha(registro.nombre_original, hoy);
    const huella = await sha256(resultado.datos);
    const destino = guardar ? await guardar(nombre, resultado.datos) : null;
    await this.modificar((estado) => {
      estado.exportaciones.push({
        id: estado.exportaciones.length + 1,
        tipo,
        archivo: destino ?? `exportaciones/${hoy}/${nombre}`,
        sha256: huella,
        usuario,
        fecha_hora: ahoraIso(),
        ultimo_folio: resultado.ultimoFolio ?? null,
      });
    });
    return { nombre, datos: resultado.datos, subcarpeta: `exportaciones/${hoy}`, resultado, destino };
  }

  // ------------------------------------------------------------ respaldos

  async respaldo(motivo = "manual") {
    const plantillas = await this.plantillasDelEstado();
    return crearRespaldo(this.estado, plantillas, { motivo, version: this.version });
  }

  /** Reemplaza TODO por el contenido de un respaldo (el llamador respalda antes el estado actual). */
  restaurar(datos) {
    const { estado: leido, plantillas, manifiesto } = leerRespaldo(datos);
    const estado = migrarEstado(leido);
    return this._enCola(async () => {
      const ahora = ahoraIso();
      const archivos = plantillas.map((p) => {
        const registro = estado.plantillas_excel.find((r) => r.archivo === p.archivo);
        return {
          clave: p.archivo,
          nombre: registro?.nombre_original ?? p.archivo,
          tipo: registro?.tipo ?? null,
          datos: p.datos,
          sha256: registro?.sha256 ?? null,
          guardado_en: ahora,
        };
      });
      if (this.estado) await this.backend.guardarInstantanea(this.estado, "antes de restaurar", ahora);
      await this.backend.guardarTodo(estado, archivos);
      this.estado = estado;
      this._avisar();
      return manifiesto;
    });
  }

  async instantanea(motivo) {
    if (this.estado) await this.backend.guardarInstantanea(this.estado, motivo, ahoraIso());
  }

  restaurarInstantanea(clave) {
    return this._enCola(async () => {
      const copia = await this.backend.leerInstantanea(clave);
      if (!copia) throw new Error("No se encontró la copia interna.");
      if (this.estado) await this.backend.guardarInstantanea(this.estado, "antes de restaurar", ahoraIso());
      const estado = migrarEstado(copia.estado);
      await this.backend.guardarEstado(estado);
      this.estado = estado;
      this._avisar();
    });
  }

  borrarTodo() {
    return this._enCola(async () => {
      await this.backend.borrarTodo();
      this.estado = null;
      this._avisar();
    });
  }
}
