// Controlador de la aplicación: une el almacén de datos, la carpeta de respaldos y
// los avisos para la interfaz. No dibuja nada.

import { hoyIso } from "../nucleo/fechas.js";
import { usuarioEnTurno } from "../servicios/consultas.js";
import {
  borrarDeCarpeta,
  descargar,
  elegirCarpeta,
  escribirEnCarpeta,
  listarCarpeta,
  permisoCarpeta,
  soportaCarpetas,
} from "../almacen/archivos.js";
import { infoDeNombre, respaldosABorrar } from "../almacen/respaldos.js";

export const CARPETA_RESPALDOS = "respaldos";

export class Sesion {
  constructor(almacen, backend) {
    this.almacen = almacen;
    this.backend = backend;
    this.carpeta = null;
    this.permiso = null;
    this.ultimoRespaldo = null;
    this.persistente = null;
    this.uso = null;
    this.avisos = [];
    this.ocupado = null;
    this.oyentes = new Set();
    this.version = 0;
    almacen.suscribir(() => this._cambio());
  }

  get estado() {
    return this.almacen.estado;
  }

  get usuario() {
    return usuarioEnTurno(this.estado);
  }

  get carpetaLista() {
    return Boolean(this.carpeta) && this.permiso === "granted";
  }

  suscribir(oyente) {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  _cambio() {
    this.version += 1;
    for (const oyente of this.oyentes) oyente(this.version);
  }

  avisar(tipo, texto, duracion = tipo === "error" ? 0 : 6000) {
    const aviso = { id: Date.now() + Math.random(), tipo, texto };
    this.avisos = [...this.avisos, aviso].slice(-3);
    this._cambio();
    if (duracion) setTimeout(() => this.quitarAviso(aviso.id), duracion);
  }

  quitarAviso(id) {
    this.avisos = this.avisos.filter((a) => a.id !== id);
    this._cambio();
  }

  /** Ejecuta una tarea mostrando "trabajando…" y convirtiendo errores en avisos. */
  async tarea(descripcion, funcion) {
    this.ocupado = descripcion;
    this._cambio();
    await new Promise((r) => setTimeout(r, 30)); // deja pintar el indicador
    try {
      return await funcion();
    } catch (error) {
      console.error(error);
      this.avisar("error", error?.message || String(error));
      return undefined;
    } finally {
      this.ocupado = null;
      this._cambio();
    }
  }

  async iniciar() {
    await this.almacen.iniciar();
    this.carpeta = await this.backend.leerAjuste("carpeta");
    this.permiso = this.carpeta ? await permisoCarpeta(this.carpeta) : null;
    this.ultimoRespaldo = await this.backend.leerAjuste("ultimo_respaldo");
    if (navigator.storage?.persisted) {
      this.persistente = await navigator.storage.persisted();
      if (!this.persistente && navigator.storage.persist) this.persistente = await navigator.storage.persist();
    }
    await this.actualizarUso();
    this._cambio();
    await this.respaldoAutomatico();
  }

  async actualizarUso() {
    if (navigator.storage?.estimate) {
      try {
        this.uso = await navigator.storage.estimate();
      } catch {
        this.uso = null;
      }
    }
  }

  // ------------------------------------------------------------ carpeta

  get soportaCarpetas() {
    return soportaCarpetas();
  }

  async elegirCarpeta() {
    const carpeta = await elegirCarpeta();
    this.carpeta = carpeta;
    this.permiso = await permisoCarpeta(carpeta, true);
    await this.backend.guardarAjuste("carpeta", carpeta);
    this._cambio();
    this.avisar("exito", `Carpeta elegida: ${carpeta.name}. Ahí se guardarán respaldos y exportaciones.`);
    await this.respaldoAutomatico();
  }

  /** El navegador pide confirmar el permiso de la carpeta una vez por sesión (requiere clic). */
  async activarCarpeta() {
    this.permiso = await permisoCarpeta(this.carpeta, true);
    this._cambio();
    if (this.permiso === "granted") await this.respaldoAutomatico();
  }

  async olvidarCarpeta() {
    this.carpeta = null;
    this.permiso = null;
    await this.backend.guardarAjuste("carpeta", null);
    this._cambio();
  }

  /** Guarda en la carpeta elegida o, si no hay, descarga. @returns texto del destino */
  async guardarArchivo(ruta, nombre, datos) {
    if (this.carpeta && this.permiso !== "granted") this.permiso = await permisoCarpeta(this.carpeta, true);
    if (this.carpetaLista) {
      try {
        return await escribirEnCarpeta(this.carpeta, ruta, nombre, datos);
      } catch (error) {
        console.error(error);
        this.avisar("advertencia", `No se pudo escribir en la carpeta (${error.message}). Se descargará.`);
      }
    }
    descargar(nombre, datos);
    return `Descargas/${nombre}`;
  }

  // ------------------------------------------------------------ respaldos

  async respaldar(motivo = "manual", { descargarSiNoHayCarpeta = true } = {}) {
    if (!this.estado) throw new Error("No hay datos que respaldar.");
    const respaldo = await this.almacen.respaldo(motivo);
    let destino;
    if (this.carpetaLista || descargarSiNoHayCarpeta) {
      destino = await this.guardarArchivo(CARPETA_RESPALDOS, respaldo.nombre, respaldo.datos);
    } else {
      return null;
    }
    if (this.carpetaLista) await this.aplicarRetencion();
    this.ultimoRespaldo = { fecha_hora: respaldo.fecha_hora, destino, nombre: respaldo.nombre };
    await this.backend.guardarAjuste("ultimo_respaldo", this.ultimoRespaldo);
    this._cambio();
    return destino;
  }

  async aplicarRetencion() {
    try {
      const nombres = (await listarCarpeta(this.carpeta, CARPETA_RESPALDOS)).map((a) => a.nombre);
      for (const nombre of respaldosABorrar(nombres)) await borrarDeCarpeta(this.carpeta, CARPETA_RESPALDOS, nombre);
    } catch (error) {
      console.warn("Retención de respaldos:", error);
    }
  }

  async listarRespaldos() {
    if (!this.carpetaLista) return [];
    const archivos = await listarCarpeta(this.carpeta, CARPETA_RESPALDOS);
    return archivos
      .map((a) => ({ ...a, info: infoDeNombre(a.nombre) }))
      .filter((a) => a.info)
      .sort((a, b) => (a.info.fecha_hora < b.info.fecha_hora ? 1 : -1));
  }

  get respaldoDeHoy() {
    return Boolean(this.ultimoRespaldo && this.ultimoRespaldo.fecha_hora.slice(0, 10) === hoyIso());
  }

  /** Un respaldo al día en la carpeta (si hay permiso) y una copia interna. */
  async respaldoAutomatico() {
    if (this.almacen.vacio) return;
    if (!this.respaldoDeHoy) {
      await this.almacen.instantanea("inicio del día");
      if (this.carpetaLista) {
        try {
          await this.respaldar("inicio", { descargarSiNoHayCarpeta: false });
        } catch (error) {
          this.avisar("advertencia", `No se pudo crear el respaldo automático: ${error.message}`);
        }
      }
    }
  }

  async restaurar(datos) {
    if (!this.almacen.vacio) await this.respaldar("antes-de-restaurar", { descargarSiNoHayCarpeta: false });
    const manifiesto = await this.almacen.restaurar(datos);
    await this.actualizarUso();
    return manifiesto;
  }

  // ------------------------------------------------------------ exportar

  async exportar(tipo) {
    const { nombre, datos, subcarpeta } = await this.almacen.exportar(tipo, this.usuario);
    const destino = await this.guardarArchivo(subcarpeta, nombre, datos);
    if (this.carpetaLista) await this.respaldar("exportacion", { descargarSiNoHayCarpeta: false });
    return destino;
  }
}
