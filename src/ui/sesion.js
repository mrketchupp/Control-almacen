// Controlador de la aplicación: une el almacén de datos, la carpeta de respaldos y
// los avisos para la interfaz. No dibuja nada.

import { hoyIso } from "../nucleo/fechas.js";
import { usuarioEnTurno } from "../servicios/consultas.js";
import {
  borrarDeCarpeta,
  descargar,
  elegirCarpeta,
  elegirDondeGuardar,
  escribirEnArchivo,
  escribirEnCarpeta,
  listarCarpeta,
  permisoCarpeta,
  soportaCarpetas,
  soportaGuardarComo,
} from "../almacen/archivos.js";
import { infoDeNombre, respaldosABorrar } from "../almacen/respaldos.js";
import { analizarFormulario, hojasFormulario } from "../impresion/formulario.js";
import { documentoHojaConteo } from "../impresion/conteo.js";
import { documentoImpresion } from "../impresion/vale.js";
import { crearZip } from "../xlsx/zip.js";
import { bytesADataUrl, hojaAPng } from "./imagen.js";
import { CAPACIDAD_DEFECTO, plantillaArea } from "../servicios/vales.js";
import { LibroLeido } from "../xlsx/leer.js";

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

  /** Aviso flotante. `accion` = { etiqueta, alHacer } agrega un botón (p. ej. "Deshacer"). */
  avisar(tipo, texto, duracion = tipo === "error" ? 0 : 6000, accion = null) {
    const aviso = { id: Date.now() + Math.random(), tipo, texto, accion };
    this.avisos = [...this.avisos, aviso].slice(-3);
    this._cambio();
    if (duracion) setTimeout(() => this.quitarAviso(aviso.id), duracion);
  }

  /**
   * Devuelve un borrador descartado a su lista (botón "Deshacer") y pide a su página que lo abra.
   * @param coleccion 'borradores' | 'borradores_entrada'
   */
  async restaurarBorrador(coleccion, copia, indice, pagina) {
    await this.almacen.modificar((e) => {
      if (e[coleccion].some((b) => b.id === copia.id)) return;
      e[coleccion].splice(Math.max(0, Math.min(indice, e[coleccion].length)), 0, copia);
    });
    this.pestanaPorAbrir = { coleccion, id: copia.id };
    if (location.hash.replace(/^#\/?/, "").split("/")[0] !== pagina) location.hash = `#${pagina}`;
    window.dispatchEvent(new CustomEvent("borrador-restaurado", { detail: { coleccion } }));
  }

  /** La pestaña que una página debe abrir (tras "Deshacer"); se entrega una sola vez. */
  tomarPestana(coleccion) {
    if (this.pestanaPorAbrir?.coleccion !== coleccion) return null;
    const id = this.pestanaPorAbrir.id;
    this.pestanaPorAbrir = null;
    return id;
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
    this.exportoConDialogo = Boolean(await this.backend.leerAjuste("exporto_con_dialogo"));
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

  // ------------------------------------------------------------ formato impreso

  /** Libro de vales del usuario (plantilla), leído una vez por sesión. */
  async libroFormato() {
    const { registro, datos } = await this.almacen.plantillaActiva("VALES");
    if (this._formato?.sha !== registro.sha256) {
      this._formato = { sha: registro.sha256, libro: new LibroLeido(datos), modelos: new Map(), hojas: null };
    }
    return this._formato;
  }

  async hojasFormato() {
    const formato = await this.libroFormato();
    formato.hojas ??= hojasFormulario(formato.libro);
    return formato.hojas;
  }

  async formulario(hoja) {
    const formato = await this.libroFormato();
    if (!formato.modelos.has(hoja)) formato.modelos.set(hoja, analizarFormulario(formato.libro, hoja));
    return formato.modelos.get(hoja);
  }

  /** Hoja con la que se imprime un vale: la de su área, o la que corresponde a su departamento. */
  async hojaParaVale(vale) {
    const hojas = await this.hojasFormato();
    if (!hojas.length) throw new Error("El libro de vales no tiene hojas-formulario para imprimir.");
    const estado = this.estado;
    const area = plantillaArea(estado, vale.plantilla_area_id);
    if (area?.hoja_excel && hojas.includes(area.hoja_excel)) return area.hoja_excel;
    const depto = (vale.depto_destino || "").trim().toUpperCase();
    const porDepto = estado.plantillas_area.find((p) => (p.depto_destino || "").trim().toUpperCase() === depto && hojas.includes(p.hoja_excel));
    if (porDepto) return porDepto.hoja_excel;
    return hojas.find((h) => h.trim().toUpperCase() === depto) ?? hojas[0];
  }

  /** Renglones que caben en el formato impreso del vale (P-16). */
  async capacidadPara(vale) {
    try {
      return (await this.formulario(await this.hojaParaVale(vale))).capacidad || CAPACIDAD_DEFECTO;
    } catch {
      return CAPACIDAD_DEFECTO;
    }
  }

  /** Espacios para fotos del formato con que se imprime el vale (NOV: 3). [{ancho, alto}] */
  async espaciosFotos(vale) {
    try {
      return (await this.formulario(await this.hojaParaVale(vale))).fotos ?? [];
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------ fotos

  /**
   * Reduce la foto (lado mayor 1280 px, JPEG) para que los respaldos no crezcan de más, y la
   * guarda en el equipo. @returns la clave de la foto
   */
  async agregarFoto(archivo) {
    let datos;
    try {
      const imagen = await createImageBitmap(archivo);
      const escala = Math.min(1, 1280 / Math.max(imagen.width, imagen.height));
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.round(imagen.width * escala);
      lienzo.height = Math.round(imagen.height * escala);
      lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      imagen.close?.();
      const blob = await new Promise((listo) => lienzo.toBlob(listo, "image/jpeg", 0.78));
      datos = new Uint8Array(await blob.arrayBuffer());
    } catch {
      throw new Error(`No se pudo leer la foto ${archivo.name}. Usa una imagen JPG o PNG.`);
    }
    return this.almacen.guardarFoto(datos, { nombre: archivo.name, tipo: "image/jpeg" });
  }

  /** URL para mostrar una foto guardada (se reutiliza mientras la página esté abierta). */
  async urlFoto(clave) {
    this._urlsFotos ??= new Map();
    if (!this._urlsFotos.has(clave)) {
      const foto = await this.almacen.leerFoto(clave);
      if (!foto) return null;
      this._urlsFotos.set(clave, URL.createObjectURL(new Blob([foto.datos], { type: foto.mime || "image/jpeg" })));
    }
    return this._urlsFotos.get(clave);
  }

  /** Completa los puestos con el catálogo de personas cuando el vale no los trae. */
  _paraImprimir(vale) {
    const puesto = (nombre) => this.estado.personas.find((p) => p.nombre === nombre)?.puesto ?? null;
    return {
      ...vale,
      entrego_puesto: vale.entrego_puesto || puesto(vale.entrego_nombre),
      recibio_puesto: vale.recibio_puesto || puesto(vale.recibio_nombre),
      autorizo_puesto: vale.autorizo_puesto || puesto(vale.autorizo_nombre),
    };
  }

  /** HTML y CSS de los vales, una hoja carta por vale. */
  async documentoVales(vales) {
    const paginas = [];
    for (const vale of vales) {
      const fotos = [];
      for (const clave of vale.fotos ?? []) fotos.push(clave ? await this.urlFoto(clave) : null);
      paginas.push({ modelo: await this.formulario(await this.hojaParaVale(vale)), vale: this._paraImprimir(vale), fotos });
    }
    return documentoImpresion(paginas);
  }

  /**
   * Cada vale como imagen PNG, tal como se imprime (para el reporte del día).
   * @returns [[nombre, bytes]]
   */
  async imagenesVales(vales, { escala = 2 } = {}) {
    const archivos = [];
    const sinAcentos = (t) => String(t ?? "").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9 _.-]/g, "").trim();
    for (const vale of vales) {
      const modelo = await this.formulario(await this.hojaParaVale(vale));
      const fotos = [];
      for (const clave of vale.fotos ?? []) {
        const foto = clave ? await this.almacen.leerFoto(clave) : null;
        fotos.push(foto ? await bytesADataUrl(foto.datos, foto.mime || "image/jpeg") : null);
      }
      const documento = documentoImpresion([{ modelo, vale: this._paraImprimir(vale), fotos }]);
      const area = sinAcentos(vale.depto_destino || vale.destino || "");
      archivos.push([`Vale ${vale.folio}${area ? ` - ${area}` : ""}.png`, await hojaAPng(documento, modelo.pagina, escala)]);
    }
    return archivos;
  }

  /**
   * "Guardar como" para un archivo nuevo (llamar directo desde el clic).
   * @returns el archivo elegido; null si se canceló; undefined si el navegador no tiene la ventana
   */
  async elegirDestino(nombre, id = "control-almacen-imagenes") {
    if (!soportaGuardarComo()) return undefined;
    return elegirDondeGuardar(nombre, { startIn: this.carpetaLista ? this.carpeta : "documents", id });
  }

  /** Imágenes de los vales en un .zip, al archivo elegido (o a la carpeta / Descargas). @returns destino */
  async guardarImagenesVales(vales, nombreZip, archivo = undefined) {
    const datos = crearZip(await this.imagenesVales(vales), { comprimir: false });
    if (archivo) return escribirEnArchivo(archivo, datos);
    return this.guardarArchivo(`exportaciones/${hoyIso()}`, nombreZip, datos);
  }

  /** Abre el cuadro de impresión del navegador (desde ahí también se guarda en PDF). */
  async imprimirVales(vales) {
    await this.imprimirDocumento(await this.documentoVales(vales));
  }

  /** Hoja de conteo por contenedor, sin cantidades (RF-41). */
  async imprimirHojaConteo(ubicaciones, fecha = null) {
    await this.imprimirDocumento(documentoHojaConteo(this.estado, { ubicaciones, fecha }));
  }

  /** Imprime un documento { css, html } sin mostrar el resto de la página. */
  async imprimirDocumento(documento) {
    let area = document.getElementById("area-impresion");
    if (!area) {
      area = document.createElement("div");
      area.id = "area-impresion";
      document.body.appendChild(area);
    }
    area.innerHTML = `<style>${documento.css}</style>${documento.html}`;
    await Promise.all([...area.querySelectorAll("img")].map((img) => img.decode?.().catch(() => {})));
    document.body.classList.add("imprimiendo");
    const terminar = () => {
      document.body.classList.remove("imprimiendo");
      area.innerHTML = "";
      window.removeEventListener("afterprint", terminar);
    };
    window.addEventListener("afterprint", terminar);
    window.print();
  }

  // ------------------------------------------------------------ exportar

  /**
   * Abre "Guardar como" para elegir dónde queda el Excel exportado. Debe llamarse directo
   * desde el clic (el navegador lo exige). La primera vez empieza en la carpeta de la
   * herramienta; después, en la última carpeta usada.
   * @returns el archivo elegido; null si se canceló; undefined si el navegador no lo permite
   */
  async elegirDestinoExportacion(tipo) {
    if (!soportaGuardarComo()) return undefined;
    const nombre = this.almacen.nombreExportacion(tipo);
    if (!nombre) return undefined;
    const startIn = !this.exportoConDialogo && this.carpetaLista ? this.carpeta : "documents";
    return elegirDondeGuardar(nombre, { startIn });
  }

  /** Exporta al archivo elegido con "Guardar como" o, sin él, a la carpeta / Descargas. */
  async exportar(tipo, archivo = undefined) {
    let destino;
    if (archivo) {
      ({ destino } = await this.almacen.exportar(tipo, this.usuario, hoyIso(), { guardar: (_, datos) => escribirEnArchivo(archivo, datos) }));
      if (!this.exportoConDialogo) {
        this.exportoConDialogo = true;
        await this.backend.guardarAjuste("exporto_con_dialogo", true);
      }
    } else {
      const { nombre, datos, subcarpeta } = await this.almacen.exportar(tipo, this.usuario);
      destino = await this.guardarArchivo(subcarpeta, nombre, datos);
    }
    if (this.carpetaLista) await this.respaldar("exportacion", { descargarSiNoHayCarpeta: false });
    return destino;
  }
}
