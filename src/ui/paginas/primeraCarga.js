import { useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { ddmmaa, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { leerInventario } from "../../importadores/inventario.js";
import { leerVales } from "../../importadores/vales.js";
import { agregarAlmacenista, fijarUsuarioEnTurno } from "../../servicios/consultas.js";
import { ejecutarPrimeraCarga, fechaDesdeNombre, sugerirFolioCorte } from "../../servicios/primeraCarga.js";
import { generarRevision, leerRevision } from "../../servicios/revision.js";
import { Aviso, Boton, Dato, Detalles, ElegirArchivo, Tabla, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { seguirConArchivo } from "../inventario.js";

const n = (v) => num(aNumero(v));

function catalogoCombinado(inventario, vales) {
  const catalogo = new Map(inventario.catalogo);
  for (const [codigo, descripcion] of vales.catalogo) if (!catalogo.has(codigo)) catalogo.set(codigo, descripcion);
  return catalogo;
}

function resumenVales(libro) {
  const folios = libro.renglones.map((r) => r.folio).filter((f) => f !== null);
  const fechas = libro.renglones.map((r) => r.fecha).filter(Boolean).sort();
  return {
    renglones: libro.renglones.length,
    folioMin: folios.length ? Math.min(...folios) : null,
    folioMax: folios.length ? Math.max(...folios) : null,
    desde: fechas[0],
    hasta: fechas[fechas.length - 1],
    formularios: libro.plantillas.length,
    catalogo: libro.catalogo.size,
  };
}

function Paso({ numero, titulo, listo, deshabilitado, children }) {
  return html`<section class=${`tarjeta paso ${deshabilitado ? "paso-deshabilitado" : ""} ${listo ? "paso-listo" : ""}`}>
    <header class="tarjeta-cabeza">
      <h2><span class="paso-numero">${listo ? "✓" : numero}</span>${titulo}</h2>
    </header>
    ${deshabilitado ? html`<p class="nota">${numero === "2" ? "Elige los dos archivos para continuar." : "Completa los datos del conteo base."}</p>` : children}
  </section>`;
}

export function ReporteCarga({ reporte }) {
  const hojas = reporte.hojas.map((h) => ({ ...h, id: h.hoja, ok: h.total_archivo.eq(h.total_calculado) }));
  return html`
    ${reporte.cuadra
      ? html`<${Aviso} tipo="exito" titulo="El inventario coincide con tu archivo" />`
      : html`<${Aviso} tipo="advertencia" titulo="Hay diferencias contra tu archivo">
          Revisa el antes y el después de cada partida.
        <//>`}
    <div class="datos carga-resumen">
      <${Dato} etiqueta="Partidas de inventario" valor=${num(reporte.existencias)} detalle=${`${reporte.variantes} variantes`} />
      <${Dato} etiqueta="Artículos" valor=${num(reporte.articulos)} detalle=${`${reporte.articulos_por_confirmar.length} por confirmar`} />
      <${Dato} etiqueta="Vales migrados" valor=${num(reporte.vales)} detalle=${`${reporte.lineas_migradas} de ${reporte.renglones_diario} partidas del DIARIO`} />
      <${Dato} etiqueta="Ubicados solos" valor=${num(reporte.lineas_ubicadas)} detalle="partidas posteriores al conteo" />
      <${Dato} etiqueta="Por ubicar" valor=${num(reporte.por_ubicar.length)} tono=${reporte.por_ubicar.length ? "alerta" : "ok"} detalle="se resuelven después en Pendientes" />
      <${Dato} etiqueta="Personas / áreas" valor=${`${reporte.personas} / ${reporte.plantillas_area}`} />
    </div>
    ${reporte.advertencias.length
      ? html`<${Aviso} tipo="advertencia" titulo="Advertencias de la lista de revisión"><ul>${reporte.advertencias.map((a) => html`<li>${a}</li>`)}</ul><//>`
      : null}
    <${Detalles} resumen=${`Totales por hoja (${hojas.length})`}>
    <${Tabla}
      filas=${hojas}
      columnas=${[
        { clave: "hoja", titulo: "Hoja" },
        { clave: "renglones", titulo: "Partidas", numero: true },
        { titulo: "Cantidad (archivo)", numero: true, render: (h) => n(h.cantidad_archivo) },
        { titulo: "Total (archivo)", numero: true, render: (h) => n(h.total_archivo) },
        { titulo: "Total (calculado)", numero: true, render: (h) => n(h.total_calculado) },
        { titulo: "", render: (h) => (h.ok ? html`<span class="ok">✓</span>` : html`<span class="alerta">≠</span>`) },
      ]}
    />
    <//>
    ${reporte.diferencias.length
      ? html`<${Detalles} resumen=${`Diferencias por partida (${reporte.diferencias.length})`} abierto=${true}>
          <${Tabla}
            filas=${reporte.diferencias.map((d, i) => ({ ...d, id: i }))}
            columnas=${[
              { clave: "hoja", titulo: "Hoja" },
              { clave: "fila", titulo: "Fila", numero: true },
              { clave: "codigo", titulo: "Código", numero: true },
              { clave: "dimension", titulo: "Dimensión" },
              { titulo: "Consumo archivo → calculado", numero: true, render: (d) => `${n(d.archivo_consumo)} → ${n(d.calculado_consumo)}` },
              { titulo: "Ingreso archivo → calculado", numero: true, render: (d) => `${n(d.archivo_ingreso)} → ${n(d.calculado_ingreso)}` },
            ]}
          />
        <//>`
      : null}
    ${reporte.por_ubicar.length
      ? html`<${Detalles} resumen=${`Partidas por ubicar (${reporte.por_ubicar.length})`}>
          <p class="nota">Podrás asignarlas en Pendientes después de cargar.</p>
          <${Tabla}
            filas=${reporte.por_ubicar.map((p, i) => ({ ...p, id: i }))}
            columnas=${[
              { clave: "folio", titulo: "Folio", numero: true },
              { clave: "renglon", titulo: "Partida", numero: true },
              { clave: "codigo", titulo: "Código", numero: true },
              { clave: "descripcion", titulo: "Descripción" },
              { clave: "clave", titulo: "Clave" },
              { titulo: "Cantidad", numero: true, render: (p) => n(p.cantidad) },
              { clave: "candidatos", titulo: "Candidatos", numero: true },
            ]}
          />
        <//>`
      : null}
    <${Detalles} resumen=${`Partidas omitidas del DIARIO (${reporte.omitidos.length})`}>
      <${Tabla}
        filas=${reporte.omitidos.map(([fila, motivo]) => ({ id: fila, fila, motivo }))}
        columnas=${[
          { clave: "fila", titulo: "Fila", numero: true },
          { clave: "motivo", titulo: "Motivo" },
        ]}
      />
    <//>
    <${Detalles} resumen=${`Correcciones aplicadas (${reporte.correcciones.length})`}>
      <${Tabla}
        limite=${200}
        filas=${reporte.correcciones.map(([fila, campo, antes, despues], i) => ({
          id: i,
          fila,
          campo,
          antes: antes === null || antes === undefined ? "(vacío)" : String(antes),
          despues: despues === null || despues === undefined ? "(vacío)" : String(despues),
        }))}
        columnas=${[
          { clave: "fila", titulo: "Fila", numero: true },
          { clave: "campo", titulo: "Campo" },
          { clave: "antes", titulo: "Antes" },
          { clave: "despues", titulo: "Después" },
        ]}
      />
    <//>
    <${Detalles} resumen=${`Folios que no aparecen en el DIARIO (${reporte.folios_faltantes.length})`}>
      <p>${reporte.folios_faltantes.join(", ") || "Ninguno."}</p>
    <//>
    <${Detalles} resumen=${`Artículos por confirmar (${reporte.articulos_por_confirmar.length})`}>
      <${Tabla}
        filas=${reporte.articulos_por_confirmar.map(([codigo, descripcion]) => ({ id: codigo, codigo, descripcion }))}
        columnas=${[
          { clave: "codigo", titulo: "Código", numero: true },
          { clave: "descripcion", titulo: "Descripción" },
        ]}
      />
    <//>
  `;
}

export function PaginaPrimeraCarga() {
  const sesion = useSesion();
  const [inventario, setInventario] = useState(null);
  const [vales, setVales] = useState(null);
  const [revision, setRevision] = useState(null);
  const [fechaConteo, setFechaConteo] = useState("");
  const [folioCorte, setFolioCorte] = useState("");
  const [folioManual, setFolioManual] = useState(false);
  const [usuario, setUsuario] = useState("");
  const [ensayo, setEnsayo] = useState(null);

  const resumen = useMemo(() => (vales ? resumenVales(vales.libro) : null), [vales]);

  const invalidar = () => setEnsayo(null);

  const sugerirCorte = (fecha, libroVales = vales?.libro) => {
    if (!libroVales || !fecha) return;
    const sugerido = sugerirFolioCorte(libroVales.renglones, fecha);
    setFolioCorte(sugerido === null ? "0" : String(sugerido));
  };

  const cargarInventario = (archivo) =>
    seguirConArchivo(sesion, archivo.name) &&
    sesion.tarea(`Leyendo ${archivo.name}…`, async () => {
      invalidar();
      const datos = await leerArchivoSubido(archivo);
      const libro = leerInventario(datos, archivo.name);
      setInventario({ nombre: archivo.name, datos, libro });
      const fecha = fechaDesdeNombre(archivo.name) || fechaConteo || hoyIso();
      setFechaConteo(fecha);
      if (!folioManual) sugerirCorte(fecha);
    });

  const cargarVales = (archivo) =>
    seguirConArchivo(sesion, archivo.name) &&
    sesion.tarea(`Leyendo ${archivo.name}…`, async () => {
      invalidar();
      setRevision(null);
      const datos = await leerArchivoSubido(archivo);
      const libro = leerVales(datos, archivo.name);
      setVales({ nombre: archivo.name, datos, libro });
      if (!folioManual) sugerirCorte(fechaConteo || hoyIso(), libro);
      if (!fechaConteo) setFechaConteo(hoyIso());
    });

  const generarLista = () =>
    sesion.tarea("Generando lista de revisión…", async () => {
      const datos = generarRevision(vales.libro, inventario.libro, catalogoCombinado(inventario.libro, vales.libro));
      const destino = await sesion.guardarArchivo("revision", `Revision historial ${sesion.inventario.id} ${ddmmaa(hoyIso())}.xlsx`, datos);
      sesion.avisar("exito", `Lista de revisión guardada en ${destino}`);
    });

  const cargarRevision = (archivo) =>
    sesion.tarea("Leyendo tus respuestas…", async () => {
      invalidar();
      const respuestas = leerRevision(await leerArchivoSubido(archivo), vales.libro.renglones);
      setRevision({ nombre: archivo.name, respuestas });
    });

  const opcionesListas = inventario && vales && fechaConteo && folioCorte !== "" && usuario.trim();

  const ensayar = () =>
    sesion.tarea("Ensayando la carga…", async () => {
      const resultado = ejecutarPrimeraCarga(inventario.libro, vales.libro, {
        folioCorte: Number(folioCorte),
        fechaConteo,
        usuario: usuario.trim().toUpperCase(),
        respuestas: revision?.respuestas,
        idInventario: sesion.inventario.id,
      });
      setEnsayo(resultado);
    });

  const cargar = () => {
    if (!confirmar(`¿Guardar la carga de ${sesion.inventario.id} en este equipo y crear el primer respaldo?`)) return;
    return sesion.tarea("Guardando la carga…", async () => {
      // Se vuelve a ejecutar para guardar exactamente lo que se ensayó con las opciones actuales.
      const nombre = usuario.trim().toUpperCase();
      const { estado } = ejecutarPrimeraCarga(inventario.libro, vales.libro, {
        folioCorte: Number(folioCorte),
        fechaConteo,
        usuario: nombre,
        respuestas: revision?.respuestas,
        idInventario: sesion.inventario.id,
      });
      agregarAlmacenista(estado, nombre);
      fijarUsuarioEnTurno(estado, nombre);
      await sesion.almacen.cargarPrimeraVez(estado, [
        { tipo: "INVENTARIO", nombre: inventario.nombre, datos: inventario.datos },
        { tipo: "VALES", nombre: vales.nombre, datos: vales.datos },
      ]);
      const destino = await sesion.respaldar("primera-carga");
      await sesion.actualizarUso();
      sesion.avisar("exito", `Carga terminada. Primer respaldo: ${destino}`);
      location.hash = "#inicio";
    });
  };

  const r = revision?.respuestas;
  const partidasInventario = inventario?.libro.hojas.reduce((total, hoja) => total + hoja.renglones.length, 0) ?? 0;
  return html`
    <div class="primera-carga">
    <div class="carga-introduccion">
      <p>Carga los dos Excel de <strong>${sesion.inventario.id}</strong>, revisa el resultado y confirma.</p>
      <span class="nota">Los archivos originales se conservan.</span>
    </div>
    <ol class="carga-progreso" aria-label="Progreso de la carga">
      <li class=${inventario && vales ? "completo" : "actual"}>1. Archivos</li>
      <li class=${opcionesListas ? "completo" : inventario && vales ? "actual" : ""}>2. Conteo base</li>
      <li class=${ensayo ? "completo" : opcionesListas ? "actual" : ""}>3. Revisar y cargar</li>
    </ol>
    <${Paso} numero="1" titulo="Archivos de ${sesion.inventario.id}" listo=${inventario && vales}>
      <div class="carga-archivos">
        <div class=${`carga-archivo ${inventario ? "carga-archivo-listo" : ""}`}>
          <h3>Inventario físico (.xlsx)</h3>
          <p class="nota">El Excel de existencias por contenedor.</p>
          <${ElegirArchivo} etiqueta=${inventario ? "Cambiar inventario" : "Elegir inventario"} acepta=".xlsx" alElegir=${cargarInventario} tipo=${inventario ? "secundario" : "primario"} />
          ${inventario
            ? html`<p class="archivo">${inventario.nombre}</p>
                <p class="carga-archivo-estado">✓ ${num(partidasInventario)} partidas · ${inventario.libro.hojas.length} hojas</p>
                <${Detalles} resumen="Ver hojas y catálogo">
                  <ul class="lista-simple">
                    ${inventario.libro.hojas.map(
                      (h) => html`<li>${h.nombre.trim()}: ${h.renglones.length} partidas ${h.filas_vacias.length ? html`<span class="nota">(${h.filas_vacias.length} vacías omitidas)</span>` : null}</li>`,
                    )}
                    <li>Catálogo ARTICULOS_MX: ${num(inventario.libro.catalogo.size)} códigos</li>
                  </ul>
                <//>`
            : null}
        </div>
        <div class=${`carga-archivo ${vales ? "carga-archivo-listo" : ""}`}>
          <h3>Vales de salida (.xlsm o .xlsx)</h3>
          <p class="nota">El libro con la hoja DIARIO y los formatos de vales.</p>
          <${ElegirArchivo} etiqueta=${vales ? "Cambiar libro de vales" : "Elegir libro de vales"} acepta=".xlsm,.xlsx" alElegir=${cargarVales} tipo=${vales ? "secundario" : "primario"} />
          ${vales
            ? html`<p class="archivo">${vales.nombre}</p>
                <p class="carga-archivo-estado">✓ ${num(resumen.renglones)} partidas · folios ${resumen.folioMin ?? "—"}–${resumen.folioMax ?? "—"}</p>
                <${Detalles} resumen="Ver fechas y formatos">
                  <ul class="lista-simple">
                    <li>Fechas: ${fmtFecha(resumen.desde)} a ${fmtFecha(resumen.hasta)}</li>
                    <li>Formularios de área: ${resumen.formularios} · catálogo: ${num(resumen.catalogo)} códigos</li>
                  </ul>
                <//>`
            : null}
        </div>
      </div>
      ${inventario && vales ? html`<${Detalles} resumen=${revision ? `Correcciones del historial: ${revision.nombre}` : "Corregir historial antes de cargar (opcional)"}>
        <p class="nota">Descarga la lista de datos dudosos, corrígela en Excel y vuelve a subirla.</p>
        <div class="acciones-linea">
          <${Boton} onClick=${generarLista}>Generar lista de revisión<//>
          <${ElegirArchivo} etiqueta=${revision ? "Cambiar lista contestada" : "Subir lista contestada"} acepta=".xlsx" alElegir=${cargarRevision} />
          ${revision ? html`<${Boton} tipo="texto" onClick=${() => { setRevision(null); invalidar(); }}>Quitar<//>` : null}
        </div>
        ${revision ? html`<${Aviso} tipo="exito" titulo="Correcciones listas para revisar">
          ${r.correcciones.size} partidas corregidas · ${r.eliminar.size} por eliminar · ${r.codigos.size} códigos ·
          ${r.alias.size} nombres unificados · ${r.normalizaciones.size} valores normalizados
          ${r.advertencias.length ? html`<ul>${r.advertencias.map((a) => html`<li>${a}</li>`)}</ul>` : null}
        <//>` : null}
      <//>` : null}
    <//>

    <${Paso} numero="2" titulo="Conteo base" listo=${opcionesListas} deshabilitado=${!(inventario && vales)}>
      <div class="formulario">
        <label>
          <span>Fecha del conteo físico</span>
          <input
            type="date"
            value=${fechaConteo}
            onChange=${(e) => {
              setFechaConteo(e.currentTarget.value);
              invalidar();
              if (!folioManual) sugerirCorte(e.currentTarget.value);
            }}
          />
          <small>Fecha sugerida desde el archivo.</small>
        </label>
        <label>
          <span>Último folio ya reflejado en el conteo (folio de corte)</span>
          <input
            type="number"
            min="0"
            value=${folioCorte}
            onInput=${(e) => {
              setFolioCorte(e.currentTarget.value);
              setFolioManual(true);
              invalidar();
            }}
          />
          <small>
            Los vales posteriores al <strong>${folioCorte || "0"}</strong> se descontarán del inventario.
            ${folioManual ? html` <a href="#carga" onClick=${(e) => { e.preventDefault(); setFolioManual(false); sugerirCorte(fechaConteo); }}>Usar sugerido</a>` : " Puedes ajustar el folio sugerido."}
          </small>
        </label>
        <label>
          <span>¿Quién hace la carga?</span>
          <input type="text" value=${usuario} placeholder="Nombre como firma los vales" onInput=${(e) => { setUsuario(e.currentTarget.value); invalidar(); }} />
        </label>
      </div>
    <//>

    <${Paso} numero="3" titulo="Revisar y cargar" listo=${Boolean(ensayo)} deshabilitado=${!opcionesListas}>
      <p class="nota">Ensaya para revisar los datos antes de guardarlos.</p>
      <div class="acciones-linea"><${Boton} tipo=${ensayo ? "secundario" : "primario"} onClick=${ensayar}>${ensayo ? "Repetir ensayo" : "Ensayar"}<//></div>
      ${ensayo ? html`<div class="carga-revision"><${ReporteCarga} reporte=${ensayo.reporte} /></div>
        <div class="carga-confirmacion">
          <div><strong>¿Todo revisado?</strong><p class="nota">Al guardar se crea el primer respaldo${sesion.carpetaLista ? html` en <code>${sesion.carpeta.name}</code>` : " en Descargas"}.</p></div>
          <${Boton} tipo="primario" onClick=${cargar}>Cargar definitivamente<//>
        </div>` : null}
    <//>
    </div>
  `;
}
