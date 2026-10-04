// El "almacén" de datos de la aplicación: estado en memoria + guardado local.
//
// Cada cambio se hace sobre una copia; solo si se guardó bien en el navegador
// se vuelve el estado vigente (como una transacción). Los cambios se atienden
// de uno en uno, en orden.

import { ddmmaa, ahoraIso, hoyIso } from "../nucleo/fechas.js";
import { estaVacio, migrarEstado } from "../nucleo/estado.js";
import { exportarSolicitudAjuste, nombreSolicitud } from "../exportadores/ajuste.js";
import { NOMBRE_ENTRADAS, exportarEntradas } from "../exportadores/entradas.js";
import { corteAx } from "../servicios/conciliacion.js";
import { estadoAlCierre } from "../servicios/corte.js";
import { exportarInventario } from "../exportadores/inventario.js";
import { exportarVales } from "../exportadores/vales.js";
import { Indices } from "../nucleo/estado.js";
import { leerVales } from "../importadores/vales.js";
import { completarAreaDesdeFormulario } from "../servicios/primeraCarga.js";
import { CARPETA_FOTOS, crearRespaldo, leerRespaldo } from "./respaldos.js";

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
    if (this.estado?.config?.completar_areas) await this._completarAreas(this.estado);
    if (guardado && formato !== this.estado.formato) await this.backend.guardarEstado(this.estado);
    if (this.estado) await this.limpiarFotos().catch(() => {});
    return this.estado;
  }

  /**
   * Formato 4: lee otra vez las hojas-formulario de la plantilla de vales para completar las
   * áreas (puesto de quien autoriza, firmas de NOV). Sin plantilla, lo deja como está.
   */
  async _completarAreas(estado) {
    delete estado.config.completar_areas;
    const registro = [...estado.plantillas_excel].reverse().find((p) => p.tipo === "VALES" && p.activa);
    const archivo = registro ? await this.backend.leerArchivo(registro.archivo) : null;
    if (!archivo) return;
    try {
      const libro = leerVales(archivo.datos, registro.nombre_original);
      const indices = new Indices(estado);
      for (const area of estado.plantillas_area) {
        const hoja = libro.plantillas.find((p) => p.hoja === area.hoja_excel || p.hoja.trim() === area.nombre);
        if (hoja) completarAreaDesdeFormulario(area, hoja, indices);
      }
      // Vales hechos con versiones anteriores en áreas con el almacenista a la derecha (NOV):
      // se exportan por posición, como los nuevos.
      for (const vale of estado.vales) {
        if (vale.migrado || vale.almacenista_derecha !== undefined) continue;
        vale.almacenista_derecha = Boolean(estado.plantillas_area.find((a) => a.id === vale.plantilla_area_id)?.almacenista_derecha);
      }
    } catch (error) {
      console.error("No se pudieron completar las áreas desde la plantilla:", error);
    }
  }

  // ------------------------------------------------------------ fotos de los vales

  /** Guarda una foto (ya reducida) y devuelve su clave. La misma foto no se guarda dos veces. */
  async guardarFoto(datos, { nombre = "foto.jpg", tipo = "image/jpeg" } = {}) {
    const huella = await sha256(datos);
    const clave = `${CARPETA_FOTOS}${huella.slice(0, 24)}${tipo === "image/png" ? ".png" : ".jpg"}`;
    if (!(await this.backend.leerArchivo(clave))) {
      await this.backend.guardarArchivo({ clave, nombre, tipo: "FOTO", mime: tipo, datos, sha256: huella, guardado_en: ahoraIso() });
    }
    return clave;
  }

  leerFoto(clave) {
    return this.backend.leerArchivo(clave);
  }

  fotosEnUso(estado = this.estado) {
    const claves = new Set();
    for (const x of [...(estado?.vales ?? []), ...(estado?.borradores ?? [])]) for (const f of x.fotos ?? []) if (f) claves.add(f);
    return claves;
  }

  /** Borra las fotos que ya no usa ningún vale ni borrador. */
  async limpiarFotos() {
    const enUso = this.fotosEnUso();
    const sobran = (await this.backend.listarArchivos()).filter((c) => String(c).startsWith(CARPETA_FOTOS) && !enUso.has(c));
    if (sobran.length) await this.backend.borrarArchivos(sobran);
    return sobran.length;
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

  /** Nombre con el que se exporta (el del archivo original; el inventario lleva la fecha). */
  nombreExportacion(tipo, hoy = hoyIso(), { corteAx: corteAxId = null } = {}) {
    if (tipo === "ENTRADAS") return NOMBRE_ENTRADAS;
    if (tipo === "AJUSTE") {
      const c = corteAx(this.estado, corteAxId);
      return c ? nombreSolicitud(c.fecha) : null;
    }
    const registro = [...(this.estado?.plantillas_excel ?? [])].reverse().find((p) => p.tipo === tipo && p.activa);
    if (!registro) return null;
    return tipo === "VALES" ? registro.nombre_original : nombreConFecha(registro.nombre_original, hoy);
  }

  /**
   * Genera el Excel: 'VALES' e 'INVENTARIO' sobre la plantilla del usuario; 'ENTRADAS' y 'AJUSTE'
   * (solicitud de ajuste de un corte de AX: `corteAx`, `todos`) son libros nuevos. Con
   * `guardar(nombre, datos)` lo escribe antes de registrar la exportación (si falla la escritura,
   * no queda registrada).
   * @returns {{ nombre, datos, subcarpeta, resultado, destino }}
   */
  async exportar(tipo, usuario, hoy = hoyIso(), { guardar = null, corte = null, corteAx: corteAxId = null, todos = false } = {}) {
    let resultado;
    let nombre;
    // Con `corte` (AAAA-MM-DD) se exporta como estaba al cierre de ese día (reporte diario).
    const cierre = corte ? estadoAlCierre(this.estado, corte) : null;
    const estado = cierre ? cierre.estado : this.estado;
    if (tipo === "ENTRADAS") {
      resultado = exportarEntradas(estado);
      nombre = NOMBRE_ENTRADAS;
    } else if (tipo === "AJUSTE") {
      const c = corteAx(estado, corteAxId);
      if (!c) throw new Error("El corte de AX ya no existe.");
      resultado = exportarSolicitudAjuste(estado, c, { todos });
      nombre = resultado.nombre;
    } else {
      const { registro, datos: plantilla } = await this.plantillaActiva(tipo);
      resultado = tipo === "VALES" ? exportarVales(estado, plantilla) : exportarInventario(estado, plantilla, { fecha: corte ?? hoy });
      nombre = tipo === "VALES" ? registro.nombre_original : nombreConFecha(registro.nombre_original, corte ?? hoy);
    }
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
        corte: corte ?? null,
        corte_ax: corteAxId ?? null,
      });
    });
    return { nombre, datos: resultado.datos, subcarpeta: `exportaciones/${hoy}`, resultado, destino };
  }

  // ------------------------------------------------------------ respaldos

  async respaldo(motivo = "manual") {
    const plantillas = await this.plantillasDelEstado();
    const fotos = [];
    for (const clave of this.fotosEnUso()) {
      const foto = await this.backend.leerArchivo(clave);
      if (foto) fotos.push({ clave, datos: foto.datos });
    }
    return crearRespaldo(this.estado, plantillas, { motivo, version: this.version, fotos });
  }

  /** Reemplaza TODO por el contenido de un respaldo (el llamador respalda antes el estado actual). */
  restaurar(datos) {
    const { estado: leido, plantillas, fotos, manifiesto } = leerRespaldo(datos);
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
      for (const f of fotos) {
        archivos.push({ clave: f.clave, nombre: f.clave.slice(CARPETA_FOTOS.length), tipo: "FOTO", mime: f.clave.endsWith(".png") ? "image/png" : "image/jpeg", datos: f.datos, sha256: null, guardado_en: ahora });
      }
      if (this.estado) await this.backend.guardarInstantanea(this.estado, "antes de restaurar", ahora);
      await this.backend.guardarTodo(estado, archivos);
      if (estado.config?.completar_areas) {
        await this._completarAreas(estado);
        await this.backend.guardarEstado(estado);
      }
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
      if (estado.config?.completar_areas) await this._completarAreas(estado);
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
