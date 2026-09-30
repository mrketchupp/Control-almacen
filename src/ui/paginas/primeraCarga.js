import { useMemo, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { ddmmaa, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { leerInventario } from "../../importadores/inventario.js";
import { leerVales } from "../../importadores/vales.js";
import { agregarAlmacenista, fijarUsuarioEnTurno } from "../../servicios/consultas.js";
import { ejecutarPrimeraCarga, fechaDesdeNombre, sugerirFolioCorte } from "../../servicios/primeraCarga.js";
import { generarRevision, leerRevision } from "../../servicios/revision.js";
import { Aviso, Boton, Dato, Detalles, ElegirArchivo, Tabla, Tarjeta, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

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
    ${deshabilitado ? html`<p class="nota">Completa el paso anterior.</p>` : children}
  </section>`;
}

export function ReporteCarga({ reporte }) {
  const hojas = reporte.hojas.map((h) => ({ ...h, id: h.hoja, ok: h.total_archivo.eq(h.total_calculado) }));
  return html`
    ${reporte.cuadra
      ? html`<${Aviso} tipo="exito" titulo="El inventario calculado coincide con tu archivo">Renglón por renglón, hoja por hoja.<//>`
      : html`<${Aviso} tipo="advertencia" titulo="Hay diferencias contra tu archivo">
          Es normal si tu Excel aún no descontaba los vales posteriores al conteo. Revisa la tabla de diferencias: cada
          renglón dice qué consumo tenía el archivo y cuál calcula la herramienta a partir de los vales.
        <//>`}
    <div class="datos">
      <${Dato} etiqueta="Renglones de inventario" valor=${num(reporte.existencias)} detalle=${`${reporte.variantes} variantes`} />
      <${Dato} etiqueta="Artículos" valor=${num(reporte.articulos)} detalle=${`${reporte.articulos_por_confirmar.length} por confirmar`} />
      <${Dato} etiqueta="Vales migrados" valor=${num(reporte.vales)} detalle=${`${reporte.lineas_migradas} de ${reporte.renglones_diario} renglones del DIARIO`} />
      <${Dato} etiqueta="Ubicados solos" valor=${num(reporte.lineas_ubicadas)} detalle="renglones posteriores al conteo" />
      <${Dato} etiqueta="Por ubicar" valor=${num(reporte.por_ubicar.length)} tono=${reporte.por_ubicar.length ? "alerta" : "ok"} detalle="se resuelven después en Pendientes" />
      <${Dato} etiqueta="Personas / áreas" valor=${`${reporte.personas} / ${reporte.plantillas_area}`} />
    </div>
    ${reporte.advertencias.length
      ? html`<${Aviso} tipo="advertencia" titulo="Advertencias de la lista de revisión"><ul>${reporte.advertencias.map((a) => html`<li>${a}</li>`)}</ul><//>`
      : null}
    <h3>Totales por hoja</h3>
    <${Tabla}
      filas=${hojas}
      columnas=${[
        { clave: "hoja", titulo: "Hoja" },
        { clave: "renglones", titulo: "Renglones", numero: true },
        { titulo: "Cantidad (archivo)", numero: true, render: (h) => n(h.cantidad_archivo) },
        { titulo: "Total (archivo)", numero: true, render: (h) => n(h.total_archivo) },
        { titulo: "Total (calculado)", numero: true, render: (h) => n(h.total_calculado) },
        { titulo: "", render: (h) => (h.ok ? html`<span class="ok">✓</span>` : html`<span class="alerta">≠</span>`) },
      ]}
    />
    ${reporte.diferencias.length
      ? html`<h3>Diferencias por renglón (${reporte.diferencias.length})</h3>
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
          />`
      : null}
    ${reporte.por_ubicar.length
      ? html`<h3>Renglones por ubicar (${reporte.por_ubicar.length})</h3>
          <p class="nota">Vales posteriores al conteo cuyo renglón de inventario no se pudo decidir solo. Se resuelven en <em>Pendientes</em>.</p>
          <${Tabla}
            filas=${reporte.por_ubicar.map((p, i) => ({ ...p, id: i }))}
            columnas=${[
              { clave: "folio", titulo: "Folio", numero: true },
              { clave: "renglon", titulo: "Renglón", numero: true },
              { clave: "codigo", titulo: "Código", numero: true },
              { clave: "descripcion", titulo: "Descripción" },
              { clave: "clave", titulo: "Clave" },
              { titulo: "Cantidad", numero: true, render: (p) => n(p.cantidad) },
              { clave: "candidatos", titulo: "Candidatos", numero: true },
            ]}
          />`
      : null}
    <${Detalles} resumen=${`Renglones omitidos del DIARIO (${reporte.omitidos.length})`}>
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
      const destino = await sesion.guardarArchivo("revision", `Revision historial ${ddmmaa(hoyIso())}.xlsx`, datos);
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
      });
      setEnsayo(resultado);
    });

  const cargar = () => {
    if (!confirmar("Se guardarán los datos en este equipo y tus archivos quedarán como plantillas de exportación. ¿Continuar?")) return;
    return sesion.tarea("Guardando la carga…", async () => {
      // Se vuelve a ejecutar para guardar exactamente lo que se ensayó con las opciones actuales.
      const nombre = usuario.trim().toUpperCase();
      const { estado } = ejecutarPrimeraCarga(inventario.libro, vales.libro, {
        folioCorte: Number(folioCorte),
        fechaConteo,
        usuario: nombre,
        respuestas: revision?.respuestas,
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
  return html`
    <p class="introduccion">
      Convierte tus Excel actuales en los datos de la herramienta. Tus archivos <strong>no se modifican</strong>: se leen
      aquí mismo, en tu equipo, y se guardan como plantillas para exportar.
    </p>
    <${Paso} numero="1" titulo="Tus archivos" listo=${inventario && vales}>
      <div class="rejilla-2">
        <div>
          <h3>Inventario físico (.xlsx)</h3>
          <${ElegirArchivo} etiqueta=${inventario ? "Cambiar archivo" : "Elegir inventario"} acepta=".xlsx" alElegir=${cargarInventario} tipo=${inventario ? "secundario" : "primario"} />
          ${inventario
            ? html`<p class="archivo">${inventario.nombre}</p>
                <ul class="lista-simple">
                  ${inventario.libro.hojas.map(
                    (h) => html`<li>${h.nombre.trim()}: ${h.renglones.length} renglones ${h.filas_vacias.length ? html`<span class="nota">(${h.filas_vacias.length} vacíos omitidos)</span>` : null}</li>`,
                  )}
                  <li>Catálogo ARTICULOS_MX: ${num(inventario.libro.catalogo.size)} códigos</li>
                </ul>`
            : null}
        </div>
        <div>
          <h3>Libro de vales (.xlsm)</h3>
          <${ElegirArchivo} etiqueta=${vales ? "Cambiar archivo" : "Elegir libro de vales"} acepta=".xlsm,.xlsx" alElegir=${cargarVales} tipo=${vales ? "secundario" : "primario"} />
          ${vales
            ? html`<p class="archivo">${vales.nombre}</p>
                <ul class="lista-simple">
                  <li>DIARIO: ${num(resumen.renglones)} renglones, folios ${resumen.folioMin}–${resumen.folioMax}</li>
                  <li>Fechas: ${fmtFecha(resumen.desde)} a ${fmtFecha(resumen.hasta)}</li>
                  <li>Formularios de área: ${resumen.formularios} · catálogo: ${num(resumen.catalogo)} códigos</li>
                </ul>`
            : null}
        </div>
      </div>
    <//>

    <${Paso} numero="2" titulo="Lista de revisión (opcional, recomendada)" listo=${Boolean(revision)} deshabilitado=${!(inventario && vales)}>
      <p>
        Genera un Excel con los renglones dudosos del DIARIO (#REF!, duplicados, códigos fuera de catálogo, nombres
        escritos distinto…). Contéstalo con tus PDF escaneados y súbelo aquí. Si no lo contestas, se aplican solo las
        limpiezas automáticas.
      </p>
      <div class="acciones-linea">
        <${Boton} onClick=${generarLista}>Generar lista de revisión<//>
        <${ElegirArchivo} etiqueta=${revision ? "Cambiar lista contestada" : "Subir lista contestada"} acepta=".xlsx" alElegir=${cargarRevision} />
        ${revision ? html`<${Boton} tipo="texto" onClick=${() => { setRevision(null); invalidar(); }}>Quitar<//>` : null}
      </div>
      ${revision
        ? html`<${Aviso} tipo="exito" titulo=${`Respuestas leídas de ${revision.nombre}`}>
            ${r.correcciones.size} renglones corregidos · ${r.eliminar.size} por eliminar · ${r.codigos.size} códigos ·
            ${r.alias.size} nombres unificados · ${r.normalizaciones.size} valores normalizados
            ${r.advertencias.length ? html`<ul>${r.advertencias.map((a) => html`<li>${a}</li>`)}</ul>` : null}
          <//>`
        : null}
    <//>

    <${Paso} numero="3" titulo="Conteo base" listo=${opcionesListas} deshabilitado=${!(inventario && vales)}>
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
          <small>Se toma del nombre del archivo de inventario.</small>
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
            Se descuentan del inventario los vales del <strong>${Number(folioCorte || 0) + 1}</strong> en adelante.
            ${folioManual ? html` <a href="#carga" onClick=${(e) => { e.preventDefault(); setFolioManual(false); sugerirCorte(fechaConteo); }}>Usar sugerido</a>` : " (sugerido: último folio con fecha anterior al conteo)"}
          </small>
        </label>
        <label>
          <span>¿Quién hace la carga?</span>
          <input type="text" value=${usuario} placeholder="Nombre como firma los vales" onInput=${(e) => { setUsuario(e.currentTarget.value); invalidar(); }} />
        </label>
      </div>
    <//>

    <${Paso} numero="4" titulo="Ensayo y reporte" listo=${Boolean(ensayo)} deshabilitado=${!opcionesListas}>
      <p>Hace la carga completa en memoria y muestra el reporte. <strong>No guarda nada.</strong></p>
      <div class="acciones-linea"><${Boton} tipo=${ensayo ? "secundario" : "primario"} onClick=${ensayar}>${ensayo ? "Repetir ensayo" : "Ensayar"}<//></div>
      ${ensayo ? html`<${ReporteCarga} reporte=${ensayo.reporte} />` : null}
    <//>

    <${Paso} numero="5" titulo="Cargar" deshabilitado=${!ensayo}>
      <p>
        Guarda todo en este equipo, registra tus archivos como plantillas y crea el primer respaldo
        ${sesion.carpetaLista ? html` en <code>${sesion.carpeta.name}</code>` : " (se descargará)"}.
      </p>
      <div class="acciones-linea"><${Boton} tipo="primario" onClick=${cargar}>Cargar definitivamente<//></div>
    <//>
  `;
}
