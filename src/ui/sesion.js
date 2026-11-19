// Controlador de la aplicación: une el almacén de datos, la carpeta de respaldos y
// los avisos para la interfaz. No dibuja nada.

import { hoyIso } from "../nucleo/fechas.js";
import { usuarioEnTurno } from "../servicios/consultas.js";
import {
  SinElegir,
  borrarDeCarpeta,
  causaDeError,
  conLimite,
  delExplorador,
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
import { Compartidos } from "../almacen/compartidos.js";
import { anotar, describirHandle } from "../almacen/registro.js";
import { CLAVE_DESTINOS, destinoDe, normalizarDestinos, normalizarRuta, proponerRutas, rutaDeCarpetas, RUTAS } from "../almacen/destinos.js";
import { infoDeNombre, leerRespaldo, respaldosABorrar, revisarInventario } from "../almacen/respaldos.js";
import { estaVacio, migrarEstado } from "../nucleo/estado.js";
import { deOtroInventario, inventarioDe, inventarioPorId } from "../nucleo/inventarios.js";
import { analizarFormulario, hojasFormulario } from "../impresion/formulario.js";
import { documentoHojaConteo } from "../impresion/conteo.js";
import { documentoImpresion } from "../impresion/vale.js";
import { identidadDe } from "../impresion/identidad.js";
import { MAXIMO_LOGO } from "../servicios/valeImpreso.js";
import { CAPACIDAD_DEFECTO, plantillaArea } from "../servicios/vales.js";
import { LibroLeido } from "../xlsx/leer.js";

export const CARPETA_RESPALDOS = "respaldos";

const TIPOS_LIBRO = { ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/**
 * Al exportar se respalda en la carpeta (OneDrive) solo si el último respaldo tiene más de estas horas:
 * cada respaldo sube varios MB a OneDrive y, mientras sube, Edge puede no lograr guardar el siguiente Excel.
 */
export const HORAS_ENTRE_RESPALDOS_AL_EXPORTAR = 4;

export class Sesion {
  /**
   * @param cambiarInventario  (id, { pagina }) => abre el otro inventario (DLTA / GSM) en esta misma pestaña
   * @param comun              base de lo que comparten los inventarios (la etapa de perforación)
   * @param leerOtroInventario (id) => el estado guardado del otro inventario, o null (solo se lee)
   */
  constructor(almacen, backend, { cambiarInventario = null, comun = null, leerOtroInventario = null } = {}) {
    this.almacen = almacen;
    this.backend = backend;
    this.cambiarInventario = cambiarInventario;
    this.leerOtroInventario = leerOtroInventario;
    this.compartidos = comun ? new Compartidos(almacen, comun) : null;
    this.comun = comun;
    this.carpeta = null;
    this.destinos = normalizarDestinos(null);
    this.permiso = null;
    this.ultimoRespaldo = null;
    this.persistente = null;
    this.uso = null;
    this.avisos = [];
    this.dialogo = null;
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

  /** El inventario abierto ({ id: "DLTA" | "GSM", … }). */
  get inventario() {
    return inventarioPorId(this.almacen.inventario);
  }

  /**
   * Los datos de un inventario para LEERLOS (Ronda 21, etiquetas): el abierto o una copia del otro tal
   * como quedó guardado en su base. A la copia nunca se le escribe nada (ni a su base).
   * @returns el estado, o null si ese inventario aún no tiene datos
   */
  async estadoDeInventario(id) {
    const inventario = inventarioPorId(id).id;
    if (inventario === this.inventario.id) return this.estado;
    if (!this.leerOtroInventario) return null;
    const guardado = await this.leerOtroInventario(inventario);
    if (!guardado || estaVacio(guardado)) return null;
    const copia = migrarEstado(structuredClone(guardado));
    if (inventarioDe(copia).id !== inventario) throw new Error(`La base de ${inventario} trae datos de ${inventarioDe(copia).id}.`);
    return copia;
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

  /**
   * Aviso flotante. `accion` = { etiqueta, alHacer, ocupado? } agrega un botón (p. ej. "Deshacer"); con
   * `ocupado`, la acción muestra su propio indicador (ver exportarConDialogo). Con `duracion`
   * se quita solo; mientras el mouse o el teclado están en el aviso, el tiempo se detiene (pausarAviso).
   */
  avisar(tipo, texto, duracion = tipo === "error" ? 0 : 6000, accion = null) {
    const aviso = { id: Date.now() + Math.random(), tipo, texto, accion, duracion };
    const fuera = this.avisos.slice(0, Math.max(0, this.avisos.length - 2));
    for (const a of fuera) this._olvidarTiempo(a.id);
    this.avisos = [...this.avisos.slice(fuera.length), aviso];
    this._cambio();
    if (duracion) this._programarAviso(aviso.id, duracion);
  }

  _programarAviso(id, ms) {
    this._tiempos ??= new Map();
    this._olvidarTiempo(id);
    this._tiempos.set(id, { fin: Date.now() + ms, temporizador: setTimeout(() => this.quitarAviso(id), ms) });
  }

  _olvidarTiempo(id) {
    const t = this._tiempos?.get(id);
    if (t) clearTimeout(t.temporizador);
    this._tiempos?.delete(id);
  }

  /** Detiene el tiempo de un aviso mientras se lee (mouse encima o foco dentro). */
  pausarAviso(id) {
    const t = this._tiempos?.get(id);
    if (!t || t.resta !== undefined) return;
    clearTimeout(t.temporizador);
    t.resta = Math.max(0, t.fin - Date.now());
  }

  reanudarAviso(id) {
    const t = this._tiempos?.get(id);
    if (t?.resta === undefined) return;
    this._programarAviso(id, t.resta);
  }

  /** Ventana centrada con dibujos (p. ej. no se pudo guardar donde se eligió). Una a la vez. */
  mostrarDialogo(dialogo) {
    this.dialogo = dialogo;
    this._cambio();
  }

  cerrarDialogo() {
    this.dialogo = null;
    this._cambio();
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
    this._olvidarTiempo(id);
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
    // La etapa de perforación es la misma en DLTA y GSM: toma la última que se cambió en cualquiera.
    await this.compartidos?.sincronizar().catch((error) => console.warn("Ajustes compartidos:", error));
    this.carpeta = await this.backend.leerAjuste("carpeta");
    this.permiso = this.carpeta ? await permisoCarpeta(this.carpeta) : null;
    this.destinos = normalizarDestinos(await this._bdDestinos.leerAjuste(CLAVE_DESTINOS).catch(() => null));
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

  /**
   * Guarda en la carpeta elegida o, si no hay, descarga. Con `pedirPermiso: false` no pide el permiso
   * de la carpeta (sin un clic reciente el navegador lo negaría y quedaría negado en la sesión).
   * @returns texto del destino
   */
  async guardarArchivo(ruta, nombre, datos, { pedirPermiso = true } = {}) {
    if (pedirPermiso && this.carpeta && this.permiso !== "granted") this.permiso = await permisoCarpeta(this.carpeta, true);
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

  // ------------------------------------------------------------ carpetas del reporte diario (Ronda 30)

  /** Los destinos son de este equipo y los mismos en DLTA y GSM: viven en la base común (si no hay, en la propia). */
  get _bdDestinos() {
    return this.comun ?? this.backend;
  }

  /**
   * Dónde se guarda una exportación del reporte diario sin preguntar, o null («Guardar como»):
   * { clase: "carpeta", raiz, ruta, id } (inventario) | { clase: "archivo", archivo, id } (libro de vales).
   */
  destinoReporte(tipo) {
    return destinoDe(this.destinos, tipo, this.inventario.id);
  }

  async _guardarDestinos(destinos) {
    this.destinos = normalizarDestinos(destinos);
    this._cambio(); // se ve de inmediato aunque guardarlo en el navegador tarde
    try {
      await conLimite(this._bdDestinos.guardarAjuste(CLAVE_DESTINOS, this.destinos), 10000, null, "el navegador no respondió");
    } catch (error) {
      anotar("carpetas", "no se pudieron guardar en el navegador", error);
      throw new Error(`Las carpetas quedaron fijadas solo hasta cerrar la herramienta: el navegador no las guardó (${error?.name ?? ""} ${error?.message ?? error}).`, { cause: error });
    }
  }

  /**
   * Elige la carpeta base de los inventarios (p. ej. INVENTARIO DIARIO) con el explorador y la fija
   * (`fijarCarpetaReporte`). Edge no deja elegir el Escritorio ni OneDrive completos: se elige una carpeta dentro.
   * @throws SinElegir si el explorador se cerró sin entregar nada; ErrorEscritura 'colgado' si Edge no respondió
   *   (si responde después, `alLlegarTarde(carpeta)`)
   */
  async elegirCarpetaReporte({ alLlegarTarde = null } = {}) {
    const raiz = await delExplorador(
      "la carpeta",
      () => window.showDirectoryPicker({ id: "control-almacen-reporte", mode: "readwrite", startIn: this.destinos.raiz ?? "desktop" }),
      { alLlegarTarde },
    );
    return this.fijarCarpetaReporte(raiz);
  }

  /**
   * Fija la carpeta base (del explorador o arrastrada desde Windows) y propone las rutas buscándolas dentro. La base
   * queda guardada antes de buscar: si la búsqueda falla o tarda, se dice y las rutas se escriben a mano.
   * @returns { raiz, propuestas: { [id]: ruta | null }, error: búsqueda que falló o null }
   */
  async fijarCarpetaReporte(raiz) {
    if (raiz?.kind !== "directory") throw new Error(`«${raiz?.name ?? "Eso"}» no es una carpeta: arrastra la carpeta que tiene adentro las de cada inventario.`);
    // Con otra base, las rutas que se encuentren reemplazan a las anteriores; con la misma, solo llenan las vacías.
    const misma = await this._mismaBase(raiz);
    await this._guardarDestinos({ ...this.destinos, raiz });
    let propuestas = {};
    let error = null;
    try {
      propuestas = await conLimite(proponerRutas(raiz), 20000, null, `Edge tardó demasiado en leer «${raiz.name}» (¿OneDrive está sincronizando?)`);
    } catch (e) {
      console.warn("Proponer rutas:", e);
      error = e;
    }
    const rutas = { ...this.destinos.rutas };
    for (const id of RUTAS) if (propuestas[id] && (!rutas[id] || !misma)) rutas[id] = propuestas[id];
    await this._guardarDestinos({ ...this.destinos, rutas });
    anotar("carpetas", `base ${describirHandle(raiz)}; encontradas: ${RUTAS.map((id) => `${id}=${propuestas[id] ?? "—"}`).join(", ")}`, error);
    return { raiz, propuestas, error };
  }

  /** ¿La carpeta elegida es la misma base que ya había? (entonces se conservan las rutas escritas) */
  async _mismaBase(raiz) {
    try {
      return Boolean(this.destinos.raiz && (await this.destinos.raiz.isSameEntry(raiz)));
    } catch {
      return false;
    }
  }

  /** Vuelve a buscar las rutas en la carpeta base (botón «Buscar otra vez»). @returns las propuestas */
  async buscarRutasReporte() {
    const raiz = this.destinos.raiz;
    if (!raiz) throw new Error("Primero elige la carpeta base de los inventarios.");
    const propuestas = await conLimite(proponerRutas(raiz), 20000, null, `Edge tardó demasiado en leer «${raiz.name}» (¿OneDrive está sincronizando?)`);
    const rutas = { ...this.destinos.rutas };
    for (const id of RUTAS) if (propuestas[id]) rutas[id] = propuestas[id];
    await this._guardarDestinos({ ...this.destinos, rutas });
    return propuestas;
  }

  /** Cambia la ruta de un inventario (DLTA, GSM o FX); vacía = sin carpeta («Guardar como»). */
  async fijarRutaReporte(id, ruta) {
    await this._guardarDestinos({ ...this.destinos, rutas: { ...this.destinos.rutas, [id]: normalizarRuta(ruta) || null } });
  }

  /**
   * La ruta de un inventario eligiendo su carpeta en el explorador (dentro de la base): el año y el mes
   * elegidos se vuelven {año} y {mes}. @returns la ruta @throws SinElegir / ErrorEscritura como elegirCarpetaReporte
   */
  async explorarRutaReporte(id, { alLlegarTarde = null } = {}) {
    const raiz = this.destinos.raiz;
    if (!raiz) throw new Error("Primero elige la carpeta base de los inventarios.");
    const elegida = await delExplorador("la carpeta", () => window.showDirectoryPicker({ id: "control-almacen-reporte-ruta", mode: "read", startIn: raiz }), { alLlegarTarde });
    return this.fijarRutaDesdeCarpeta(id, elegida);
  }

  /** La ruta de un inventario desde una carpeta de dentro de la base (elegida o arrastrada). @returns la ruta */
  async fijarRutaDesdeCarpeta(id, carpeta) {
    const raiz = this.destinos.raiz;
    if (!raiz) throw new Error("Primero elige la carpeta base de los inventarios.");
    if (carpeta?.kind !== "directory") throw new Error(`«${carpeta?.name ?? "Eso"}» no es una carpeta.`);
    const partes = await raiz.resolve(carpeta);
    if (!partes) {
      anotar("carpetas", `${describirHandle(carpeta)} no está dentro de ${describirHandle(raiz)}`);
      throw new Error(`«${carpeta.name}» no está dentro de «${raiz.name}». Elige una carpeta dentro de la base (o cambia la base).`);
    }
    const ruta = rutaDeCarpetas(partes);
    await this.fijarRutaReporte(id, ruta);
    anotar("carpetas", `ruta de ${id} desde ${describirHandle(carpeta)}: ${ruta}`);
    return ruta;
  }

  /**
   * Fija el libro de vales de un inventario eligiendo con el explorador el archivo que ya existe (normalmente en el
   * Escritorio): cada «Descargar» del reporte lo reemplaza. @returns el archivo, o null si no se quiso usar
   * @throws SinElegir / ErrorEscritura como elegirCarpetaReporte
   */
  async elegirLibroVales(id, { alLlegarTarde = null } = {}) {
    const extensiones = this._extensionLibro(id) ? [this._extensionLibro(id)] : [".xlsm", ".xlsx"];
    const elegidos = await delExplorador(
      "el archivo",
      () => window.showOpenFilePicker({
        id: "control-almacen-vales",
        startIn: this.destinos.vales[id] ?? "desktop",
        multiple: false,
        excludeAcceptAllOption: true,
        types: [{ description: "Libro de Excel", accept: Object.fromEntries(extensiones.map((e) => [TIPOS_LIBRO[e], [e]])) }],
      }),
      { alLlegarTarde: alLlegarTarde && ((lista) => lista?.[0] && alLlegarTarde(lista[0])) },
    );
    if (!elegidos?.[0]) throw new SinElegir("el archivo");
    return this.fijarLibroVales(id, elegidos[0]);
  }

  /** La extensión del libro de vales de ese inventario (solo se sabe la del abierto). */
  _extensionLibro(id) {
    const propio = id === this.inventario.id ? this.almacen.nombreExportacion("VALES") : null;
    return propio ? propio.slice(propio.lastIndexOf(".")).toLowerCase() : null;
  }

  /** Fija el libro de vales (elegido o arrastrado desde Windows). @returns el archivo, o null si no se quiso usar */
  async fijarLibroVales(id, archivo) {
    if (archivo?.kind !== "file") throw new Error(`«${archivo?.name ?? "Eso"}» no es un archivo: arrastra el libro de vales de ${id}.`);
    const extension = this._extensionLibro(id);
    const suya = archivo.name.slice(archivo.name.lastIndexOf(".")).toLowerCase();
    if (![".xlsm", ".xlsx"].includes(suya)) throw new Error(`«${archivo.name}» no es un libro de Excel: arrastra el libro de vales de ${id}.`);
    if (extension && suya !== extension) throw new Error(`«${archivo.name}» es ${suya} y el libro de vales de ${id} sale como ${extension}: elige el ${extension}.`);
    const otro = deOtroInventario(archivo.name, id);
    if (otro && !window.confirm(`«${archivo.name}» dice ${otro}. ¿Es el libro de vales de ${id}?`)) return null;
    await this._guardarDestinos({ ...this.destinos, vales: { ...this.destinos.vales, [id]: archivo } });
    anotar("carpetas", `libro de vales de ${id}: ${describirHandle(archivo)}`);
    return archivo;
  }

  /** Quita un destino: `{ ruta: id }` o `{ vales: id }` (vuelve a abrir «Guardar como»); `{ raiz: true }`, la base. */
  async quitarDestinoReporte({ ruta = null, vales = null, raiz = false } = {}) {
    const destinos = { ...this.destinos, rutas: { ...this.destinos.rutas }, vales: { ...this.destinos.vales } };
    if (ruta) destinos.rutas[ruta] = null;
    if (vales) destinos.vales[vales] = null;
    if (raiz) destinos.raiz = null;
    await this._guardarDestinos(destinos);
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
      for (const nombre of respaldosABorrar(nombres, { inventario: this.almacen.inventario })) await borrarDeCarpeta(this.carpeta, CARPETA_RESPALDOS, nombre);
    } catch (error) {
      console.warn("Retención de respaldos:", error);
    }
  }

  async listarRespaldos() {
    if (!this.carpetaLista) return [];
    const archivos = await listarCarpeta(this.carpeta, CARPETA_RESPALDOS);
    return archivos
      .map((a) => ({ ...a, info: infoDeNombre(a.nombre, this.almacen.inventario) }))
      .filter((a) => a.info)
      .sort((a, b) => (a.info.fecha_hora < b.info.fecha_hora ? 1 : -1));
  }

  /** ¿Hay un respaldo de hace menos de `horas`? (para no subir otro a OneDrive en cada exportación) */
  respaldoReciente(horas = HORAS_ENTRE_RESPALDOS_AL_EXPORTAR, ahora = Date.now()) {
    const fecha = Date.parse(this.ultimoRespaldo?.fecha_hora ?? "");
    return Number.isFinite(fecha) && ahora - fecha < horas * 3600 * 1000;
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
    // Antes de respaldar lo actual: que sea un respaldo válido y de este inventario.
    revisarInventario(leerRespaldo(datos).estado, this.almacen.inventario);
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

  /** Modelos de todas las hojas-formulario (para elegir logos y textos del vale impreso). */
  async modelosFormato() {
    const modelos = [];
    for (const hoja of await this.hojasFormato()) modelos.push(await this.formulario(hoja));
    return modelos;
  }

  /**
   * Un vale para la vista previa: el último de salida emitido (o uno en blanco), en su hoja o en
   * la `hoja` que se pida.
   */
  async muestraVale(hoja = null) {
    const salidas = this.estado.vales.filter((v) => v.tipo !== "ENTRADA" && v.folio !== null && v.folio !== undefined);
    const ultimo = salidas.reduce((a, v) => (!a || v.folio > a.folio ? v : a), null);
    const vale = ultimo ?? { tipo: "SALIDA", folio: null, fecha: hoyIso(), lineas: [], observaciones: null };
    const nombre = hoja ?? (await this.hojaParaVale(vale));
    return { vale, hoja: nombre, modelo: await this.formulario(nombre) };
  }

  /** HTML y CSS de un vale de muestra con `identidad` (logos y textos aún sin guardar). */
  async documentoMuestra(identidad, hoja = null) {
    const { vale, hoja: nombre, modelo } = await this.muestraVale(hoja);
    return { vale, hoja: nombre, ...await this._documentoImpresion([{ modelo, vale: this._paraImprimir(vale) }], identidad) };
  }

  /**
   * Lee un logo para el vale impreso: lado mayor de 800 px, PNG (con transparencia) o, si queda
   * muy pesado, JPG sobre blanco. @returns { src, nombre }
   */
  async leerLogo(archivo) {
    let imagen;
    try {
      imagen = await createImageBitmap(archivo);
    } catch {
      throw new Error(`No se pudo leer ${archivo.name}. Usa una imagen PNG o JPG.`);
    }
    const escala = Math.min(1, 800 / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(imagen.width * escala));
    lienzo.height = Math.max(1, Math.round(imagen.height * escala));
    const ctx = lienzo.getContext("2d");
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    let src = lienzo.toDataURL("image/png");
    if (src.length > MAXIMO_LOGO) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      src = lienzo.toDataURL("image/jpeg", 0.85);
    }
    imagen.close?.();
    if (src.length > MAXIMO_LOGO) throw new Error("La imagen es muy grande aun reducida: usa una más sencilla (menos de 300 KB).");
    return { src, nombre: archivo.name };
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
    const puesto = (campoNombre, campoPuesto) => Object.hasOwn(vale, campoPuesto)
      ? vale[campoPuesto]
      : this.estado.personas.find((p) => p.nombre === vale[campoNombre])?.puesto ?? null;
    return {
      ...vale,
      entrego_puesto: puesto("entrego_nombre", "entrego_puesto"),
      recibio_puesto: puesto("recibio_nombre", "recibio_puesto"),
      autorizo_puesto: puesto("autorizo_nombre", "autorizo_puesto"),
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
    return this._documentoImpresion(paginas, identidadDe(this.estado));
  }

  /** Mide el texto con la fuente disponible en este equipo antes de fijar las alturas de impresión. */
  async _documentoImpresion(paginas, identidad) {
    await document.fonts.ready;
    const medidor = document.createElement("div");
    medidor.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;margin:0;padding:0;border:0;box-sizing:content-box;line-height:1.1;white-space:pre-wrap;overflow-wrap:anywhere";
    medidor.style.setProperty("display", "block", "important");
    document.body.appendChild(medidor);
    const fuentes = ["font-family", "font-size", "font-weight", "font-style", "font-variant", "letter-spacing", "word-spacing"];
    try {
      return documentoImpresion(paginas, identidad, (texto, css, ancho) => {
        for (const propiedad of fuentes) medidor.style.setProperty(propiedad, css[propiedad] ?? "initial");
        medidor.style.width = `${ancho}px`;
        medidor.textContent = texto;
        return medidor.getBoundingClientRect().height;
      });
    } finally {
      medidor.remove();
    }
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
  async elegirDestinoExportacion(tipo, opciones = {}) {
    if (!soportaGuardarComo()) return undefined;
    const nombre = this.almacen.nombreExportacion(tipo, opciones.corte ?? hoyIso(), opciones);
    if (!nombre) return undefined;
    const startIn = !this.exportoConDialogo && this.carpetaLista ? this.carpeta : "documents";
    return elegirDondeGuardar(nombre, { startIn });
  }

  /**
   * Exporta al archivo elegido con "Guardar como" o, sin él, a la carpeta / Descargas.
   * opciones: { corte } (AAAA-MM-DD: como estaba al cierre de ese día, reporte diario) o
   * { corteAx, todos } (solicitud de ajuste de un corte de AX).
   * `fallo`: por qué no se pudo usar el archivo elegido en «Guardar como» (se supo al elegirlo; un
   * ErrorEscritura o un texto). Si el archivo elegido no se puede escribir, el Excel no se pierde: se
   * descarga en Descargas (en el equipo, sin OneDrive de por medio); quien llama lo avisa (con dibujos,
   * `exportarConDialogo`). `descargar`: directo a Descargas (botón «Guardar en Descargas»).
   * `enCarpeta` (Ronda 30, reporte diario): { abrir(nombre) → { archivo, ruta, existia, nuevas, quitar } } abre (y
   * crea) el archivo en su carpeta fijada cuando el Excel ya está listo; si no se puede, va a Descargas.
   * @returns {{ nombre, destino, elegido: boolean, motivo: string | null, causa: string | null }}
   *   elegido = quedó donde lo eligió; motivo = por qué no, en palabras; causa = código (causaDeError);
   *   con `enCarpeta`, además enSuCarpeta y nuevas (las carpetas de año o mes que se crearon)
   */
  async exportar(tipo, archivo = undefined, opciones = {}, { fallo = null, descargar: aDescargas = false, enCarpeta = null } = {}) {
    const hoy = hoyIso();
    const salida = { nombre: null, destino: null, elegido: false, motivo: fallo?.message ?? fallo, causa: fallo ? causaDeError(fallo) : null };
    const guardar = async (nombre, datos) => {
      if (enCarpeta) {
        // Ronda 30: directo a su carpeta (reporte diario). El archivo se crea hasta tener el Excel listo; si no
        // se pudo escribir y no existía, se quita (que no quede uno vacío) y el Excel va a Descargas.
        let abierto = null;
        try {
          abierto = await enCarpeta.abrir(nombre);
          await escribirEnArchivo(abierto.archivo, datos);
          salida.destino = abierto.ruta;
          salida.elegido = true;
          salida.enSuCarpeta = true;
          salida.nuevas = abierto.nuevas ?? [];
          return salida.destino;
        } catch (error) {
          console.warn(error);
          anotar("guardar", `«${nombre}» no quedó en su carpeta${abierto ? "" : " (no se pudo abrir o crear)"}; va a Descargas`, error);
          salida.motivo = error.message;
          salida.causa = causaDeError(error);
          if (abierto && !abierto.existia) await abierto.quitar?.().catch(() => {});
        }
      }
      if (archivo) {
        try {
          salida.destino = await escribirEnArchivo(archivo, datos);
          salida.elegido = true;
          return salida.destino;
        } catch (error) {
          console.warn(error);
          salida.motivo = error.message;
          salida.causa = causaDeError(error);
        }
      }
      if (aDescargas || salida.motivo) {
        // «Guardar como» falló (o se pidió así): a Descargas, que está en el equipo y no depende de OneDrive.
        descargar(nombre, datos);
        salida.destino = `Descargas/${nombre}`;
        return salida.destino;
      }
      // Sin «Guardar como» (otro navegador): a la carpeta de la herramienta o a Descargas, como siempre.
      salida.destino = await this.guardarArchivo(`exportaciones/${hoy}`, nombre, datos);
      return salida.destino;
    };
    ({ nombre: salida.nombre } = await this.almacen.exportar(tipo, this.usuario, hoy, { ...opciones, guardar }));
    if (salida.elegido && archivo && !this.exportoConDialogo) {
      this.exportoConDialogo = true;
      await this.backend.guardarAjuste("exporto_con_dialogo", true);
    }
    if (this.carpetaLista && !this.respaldoReciente()) {
      // El Excel ya quedó guardado: si el respaldo falla, se avisa sin ocultar que la exportación sí salió.
      try {
        await this.respaldar("exportacion", { descargarSiNoHayCarpeta: false });
      } catch (error) {
        console.warn(error);
        this.avisar("advertencia", `El Excel se guardó, pero no se pudo crear el respaldo: ${error.message}`);
      }
    }
    return salida;
  }
}
