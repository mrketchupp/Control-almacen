import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { ddmmaa, fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { leerInventario } from "../../importadores/inventario.js";
import { leerVales } from "../../importadores/vales.js";
import { agregarAlmacenista, fijarUsuarioEnTurno } from "../../servicios/consultas.js";
import { conFormatoDeTransferencia, ejecutarPrimeraCarga, fechaDesdeNombre, propuestaDeAreas, sugerirFolioCorte } from "../../servicios/primeraCarga.js";
import { PLANTILLAS_VALE } from "../../servicios/plantillasVale.js";
import { generarRevision, leerRevision } from "../../servicios/revision.js";
import { Aviso, Boton, Dato, Detalles, ElegirArchivo, Tabla, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { Icono } from "../iconos.js";
import { seguirConArchivo } from "../inventario.js";
import { ElegirPlantilla } from "./areas.js";

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

/** Un paso de la primera carga (Ronda 35: se ve uno a la vez; su número va en la barra de arriba). */
function Paso({ numero, titulo, children }) {
  return html`<section class="tarjeta paso" aria-labelledby=${`t-carga-${numero}`}>
    <header class="tarjeta-cabeza">
      <h2 id=${`t-carga-${numero}`}>${titulo}</h2>
    </header>
    ${children}
  </section>`;
}

// ---------------------------------------------------------------- áreas del libro de vales (Ronda 35)

const TONO_PLANTILLA = { INTERNO: "ok", EXTERNO: "lugar", TRANSFERENCIA: "info" };

/** Una hoja como pastilla: se arrastra a otra plantilla o, con clic, se edita (nombre, plantilla, quitar). */
function PastillaHoja({ area, alEditar }) {
  const papel = area.tipo === "TRANSFERENCIA" ? (area.formato ? "formato" : "destino") : null;
  return html`<li>
    <button
      type="button"
      class=${`pastilla-hoja pastilla-hoja-${TONO_PLANTILLA[area.tipo]}`}
      draggable="true"
      data-hoja=${area.hoja}
      aria-label=${`${area.nombre}${papel ? ` (${papel})` : ""}: editar`}
      title="Arrástrala a otra plantilla o haz clic para editarla"
      onDragStart=${(e) => {
        e.dataTransfer.setData("text/plain", area.hoja);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick=${() => alEditar(area.hoja)}
    >
      <span>${area.nombre}</span>
      ${papel ? html`<small>${papel}</small>` : null}
      <${Icono} nombre="lapiz" tam=${13} />
    </button>
  </li>`;
}

/** Un frasco por plantilla: recibe las pastillas que se sueltan en él. */
function FrascoPlantilla({ plantilla, areas, alSoltar, alEditar }) {
  const [encima, setEncima] = useState(false);
  const conTexto = (e) => [...(e.dataTransfer?.types ?? [])].includes("text/plain");
  return html`<section
    class=${`frasco frasco-${TONO_PLANTILLA[plantilla.tipo]} ${encima ? "encima" : ""}`}
    aria-label=${plantilla.nombre}
    onDragOver=${(e) => {
      if (!conTexto(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!encima) setEncima(true);
    }}
    onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && setEncima(false)}
    onDrop=${(e) => {
      if (!conTexto(e)) return;
      e.preventDefault();
      setEncima(false);
      alSoltar(e.dataTransfer.getData("text/plain"), plantilla.tipo);
    }}
  >
    <header class="frasco-cabeza">
      <strong>${plantilla.nombre}</strong>
      <span class="frasco-cuenta">${areas.length}</span>
      <small>${plantilla.tipo === "TRANSFERENCIA" ? "El formato y los destinos (RIG, pozo o base)" : plantilla.detalle}</small>
    </header>
    ${areas.length
      ? html`<ul class="pastillas-hojas">${areas.map((a) => html`<${PastillaHoja} key=${a.hoja} area=${a} alEditar=${alEditar} />`)}</ul>`
      : html`<p class="frasco-vacio">Arrastra aquí las que van con ${plantilla.nombre.toLowerCase()}.</p>`}
  </section>`;
}

/** Editar una hoja: su nombre, su plantilla, si es el formato de las transferencias, o quitarla. */
function EditarHoja({ area, nombres, alGuardar, alQuitar, alCerrar }) {
  const [nombre, setNombre] = useState(area.nombre);
  const [tipo, setTipo] = useState(area.tipo);
  const [formato, setFormato] = useState(area.formato);
  const limpio = nombre.trim().replace(/\s+/g, " ").toUpperCase();
  const repetido = limpio && nombres.some((n) => n === limpio);
  const guardar = () => !repetido && limpio && alGuardar({ ...area, nombre: limpio, tipo, formato: tipo === "TRANSFERENCIA" && formato });
  return html`<${Ventana} titulo=${`Hoja «${area.hoja.trim()}»`} alCerrar=${alCerrar}>
    <label class="campo campo-grande">
      <span>Nombre${tipo === "TRANSFERENCIA" && !formato ? " del destino" : " del área"}</span>
      <input id="nombre-hoja" value=${nombre} onInput=${(e) => setNombre(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && guardar()} />
      ${repetido ? html`<small class="falta">Ya hay otra con ese nombre.</small>` : null}
    </label>
    <div class="campo">
      <span>Plantilla</span>
      <${ElegirPlantilla} valor=${tipo} alCambiar=${setTipo} />
    </div>
    ${tipo === "TRANSFERENCIA"
      ? html`<label class="campo campo-casilla">
          <input type="checkbox" checked=${formato} onChange=${(e) => setFormato(e.currentTarget.checked)} />
          <span>Es el formato de las transferencias (si no, es un destino de «¿A dónde se envía?»)</span>
        </label>`
      : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!limpio || repetido} onClick=${guardar}>Listo<//>
      <${Boton} onClick=${alCerrar}>Cancelar<//>
      <span class="espaciador"></span>
      <${Boton} tipo="peligro-texto" onClick=${() => alQuitar(area.hoja)}>Quitar esta hoja<//>
    </div>
  <//>`;
}

/**
 * Paso «Áreas» de la primera carga (Ronda 35, pedido del usuario): las hojas de vale del libro (todas menos DIARIO) como
 * pastillas en tres frascos — Consumo interno, NOV y Transferencia —. Se arrastran de uno a otro; con clic se editan
 * (nombre, plantilla, formato de transferencias) o se quitan. Todo se puede cambiar después en *Áreas y personas*.
 */
function AreasDelLibro({ archivo, areas, alCambiar }) {
  const [editando, setEditando] = useState(null);
  const cambiar = (lista) => alCambiar(conFormatoDeTransferencia(lista));
  const mover = (hoja, tipo) => cambiar(areas.map((a) => (a.hoja === hoja ? { ...a, tipo, formato: tipo === "TRANSFERENCIA" ? a.formato : false } : a)));
  const area = editando ? areas.find((a) => a.hoja === editando) : null;
  const visibles = areas.filter((a) => !a.quitada);
  const quitadas = areas.filter((a) => a.quitada);
  return html`<div class="areas-del-libro">
    <p class="nota">
      Encontramos ${visibles.length + quitadas.length} ${visibles.length + quitadas.length === 1 ? "hoja de vale" : "hojas de vale"} en <strong>${archivo}</strong>.
      Arrastra cada una a su plantilla o haz clic para editarla. Puedes cambiarlo después en <em>Ajustes y más › Áreas y personas</em>.
    </p>
    <div class="frascos">
      ${PLANTILLAS_VALE.map((p) => html`<${FrascoPlantilla} key=${p.tipo} plantilla=${p} areas=${visibles.filter((a) => a.tipo === p.tipo)} alSoltar=${mover} alEditar=${setEditando} />`)}
    </div>
    ${quitadas.length
      ? html`<p class="hojas-quitadas">
          <span>Quitadas (no saldrán al hacer vales):</span>
          ${quitadas.map((a) => html`<button type="button" class="pastilla-hoja pastilla-hoja-quitada" key=${a.hoja}
              aria-label=${`Regresar ${a.nombre}`} onClick=${() => cambiar(areas.map((x) => (x.hoja === a.hoja ? { ...x, quitada: false } : x)))}>
              <span>${a.nombre}</span> <span aria-hidden="true">↺</span>
            </button>`)}
        </p>`
      : null}
    ${area
      ? html`<${EditarHoja}
          area=${area}
          nombres=${visibles.filter((a) => a.hoja !== area.hoja).map((a) => a.nombre)}
          alCerrar=${() => setEditando(null)}
          alGuardar=${(nueva) => {
            // Una sola es el formato de las transferencias: al marcar otra, la anterior pasa a destino.
            cambiar(areas.map((a) => (a.hoja === nueva.hoja ? nueva : nueva.formato && a.tipo === "TRANSFERENCIA" ? { ...a, formato: false } : a)));
            setEditando(null);
          }}
          alQuitar=${(hoja) => {
            cambiar(areas.map((a) => (a.hoja === hoja ? { ...a, quitada: true, formato: false } : a)));
            setEditando(null);
          }}
        />`
      : null}
  </div>`;
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

/**
 * Primera carga en 4 pasos, uno a la vez (Ronda 35, pedido del usuario): 1 · los dos Excel (al tener los dos pasa sola al
 * siguiente), 2 · las áreas (las hojas del libro de vales en sus plantillas), 3 · el conteo base y 4 · revisar y cargar
 * (el ensayo se hace solo al llegar). Abajo, Regresar y Continuar en grande; Regresar del primero vuelve a la bienvenida.
 */
export function PaginaPrimeraCarga() {
  const sesion = useSesion();
  const [paso, setPaso] = useState(1);
  const [inventario, setInventario] = useState(null);
  const [vales, setVales] = useState(null);
  const [revision, setRevision] = useState(null);
  const [areas, setAreas] = useState(null); // cómo quedan las hojas del libro de vales (paso 2)
  const [fechaConteo, setFechaConteo] = useState("");
  const [folioCorte, setFolioCorte] = useState("");
  const [folioManual, setFolioManual] = useState(false);
  const [usuario, setUsuario] = useState(sesion.usuario ?? "");
  const [ensayo, setEnsayo] = useState(null);

  const resumen = useMemo(() => (vales ? resumenVales(vales.libro) : null), [vales]);

  const invalidar = () => setEnsayo(null);

  const sugerirCorte = (fecha, libroVales = vales?.libro) => {
    if (!libroVales || !fecha) return;
    const sugerido = sugerirFolioCorte(libroVales.renglones, fecha);
    setFolioCorte(sugerido === null ? "0" : String(sugerido));
  };

  // Con los dos archivos, pasa sola al conteo base (solo al completarlos: cambiar uno después no la mueve).
  const ambos = Boolean(inventario && vales);
  const antes = useRef(ambos);
  useEffect(() => {
    if (ambos && !antes.current && paso === 1) setPaso(2);
    antes.current = ambos;
  }, [ambos]);
  useEffect(() => window.scrollTo(0, 0), [paso]);

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
      setAreas(propuestaDeAreas(libro.plantillas));
      if (!folioManual) sugerirCorte(fechaConteo || hoyIso(), libro);
      if (!fechaConteo) setFechaConteo(hoyIso());
    });

  const generarLista = () =>
    sesion.tarea("Generando lista de revisión…", async () => {
      const datos = generarRevision(vales.libro, inventario.libro, catalogoCombinado(inventario.libro, vales.libro));
      const destino = await sesion.guardarArchivo("revision", `Revision historial ${sesion.inventario.id} ${ddmmaa(hoyIso())}.xlsx`, datos);
      sesion.avisar("exito", `Lista de revisión guardada en ${destino}`);
    });

  const opcionesListas = inventario && vales && fechaConteo && folioCorte !== "" && usuario.trim();

  const opcionesCarga = (respuestas) => ({
    folioCorte: Number(folioCorte),
    fechaConteo,
    usuario: usuario.trim().toUpperCase(),
    respuestas,
    idInventario: sesion.inventario.id,
    areas,
  });
  const ensayar = (respuestas = revision?.respuestas) =>
    sesion.tarea("Ensayando la carga…", async () => {
      setEnsayo(ejecutarPrimeraCarga(inventario.libro, vales.libro, opcionesCarga(respuestas)));
    });

  const cargarRevision = (archivo) =>
    sesion.tarea("Leyendo tus respuestas…", async () => {
      const respuestas = leerRevision(await leerArchivoSubido(archivo), vales.libro.renglones);
      setRevision({ nombre: archivo.name, respuestas });
      setEnsayo(ejecutarPrimeraCarga(inventario.libro, vales.libro, opcionesCarga(respuestas)));
    });

  const cargar = () => {
    if (!confirmar(`¿Guardar la carga de ${sesion.inventario.id} en este equipo y crear el primer respaldo?`)) return;
    return sesion.tarea("Guardando la carga…", async () => {
      // Se vuelve a ejecutar para guardar exactamente lo que se ensayó con las opciones actuales.
      const nombre = usuario.trim().toUpperCase();
      const { estado } = ejecutarPrimeraCarga(inventario.libro, vales.libro, opcionesCarga(revision?.respuestas));
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

  const continuar = () => {
    if (paso === 1 && ambos) setPaso(2);
    else if (paso === 2) setPaso(3);
    else if (paso === 3 && opcionesListas) {
      setPaso(4);
      ensayar();
    }
  };
  const regresar = () => {
    if (paso === 1) location.hash = "#inicio/cero";
    else setPaso(paso - 1);
  };
  // Enter en el conteo base continúa (como en el vale de salida).
  const enterContinua = (e) => {
    if (e.key === "Enter" && paso === 3 && opcionesListas && e.target?.tagName === "INPUT") {
      e.preventDefault();
      continuar();
    }
  };

  const r = revision?.respuestas;
  const partidasInventario = inventario?.libro.hojas.reduce((total, hoja) => total + hoja.renglones.length, 0) ?? 0;
  const archivosElegidos = ambos
    ? html`<p class="carga-archivos-elegidos">
        <span>✓ ${inventario.nombre}</span><span>✓ ${vales.nombre}</span>
        <button type="button" class="enlace-boton" onClick=${() => setPaso(1)}>Cambiar archivos</button>
      </p>`
    : null;
  let cuerpo;
  if (paso === 1) {
    cuerpo = html`<${Paso} numero="1" titulo=${`Los dos Excel de ${sesion.inventario.id}`}>
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
          <h3>Libro de vales (.xlsm o .xlsx)</h3>
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
    <//>`;
  } else if (paso === 2) {
    cuerpo = html`<${Paso} numero="2" titulo="Áreas del libro de vales">
      ${archivosElegidos}
      ${areas?.length
        ? html`<${AreasDelLibro} archivo=${vales.nombre} areas=${areas} alCambiar=${(lista) => {
            setAreas(lista);
            invalidar();
          }} />`
        : html`<p class="nota">El libro de vales no tiene hojas de vale (además de DIARIO): las áreas se agregan después en <em>Ajustes y más › Áreas y personas</em>.</p>`}
    <//>`;
  } else if (paso === 3) {
    cuerpo = html`<${Paso} numero="3" titulo="Conteo base">
      ${archivosElegidos}
      <div class="formulario" onKeyDown=${enterContinua}>
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
          <small>Sugerida desde el nombre del archivo.</small>
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
            Los vales posteriores al <strong>${folioCorte || "0"}</strong> se descuentan del inventario.
            ${folioManual ? html` <a href="#carga" onClick=${(e) => { e.preventDefault(); setFolioManual(false); sugerirCorte(fechaConteo); }}>Usar sugerido</a>` : null}
          </small>
        </label>
        <label>
          <span>¿Quién hace la carga?</span>
          <input type="text" value=${usuario} placeholder="Nombre como firma los vales" onInput=${(e) => { setUsuario(e.currentTarget.value); invalidar(); }} />
        </label>
      </div>
    <//>`;
  } else {
    cuerpo = html`<${Paso} numero="4" titulo="Revisar y cargar">
      ${archivosElegidos}
      ${ensayo
        ? html`<div class="carga-revision"><${ReporteCarga} reporte=${ensayo.reporte} /></div>
            <${Detalles} resumen=${revision ? `Correcciones del historial: ${revision.nombre}` : "Corregir datos dudosos del historial antes de cargar (opcional)"}>
              <p class="nota">Descarga la lista de datos dudosos, corrígela en Excel y vuelve a subirla.</p>
              <div class="acciones-linea">
                <${Boton} onClick=${generarLista}>Generar lista de revisión<//>
                <${ElegirArchivo} etiqueta=${revision ? "Cambiar lista contestada" : "Subir lista contestada"} acepta=".xlsx" alElegir=${cargarRevision} />
                ${revision ? html`<${Boton} tipo="texto" onClick=${() => { setRevision(null); ensayar(null); }}>Quitar<//>` : null}
              </div>
              ${revision ? html`<${Aviso} tipo="exito" titulo="Correcciones aplicadas al ensayo">
                ${r.correcciones.size} partidas corregidas · ${r.eliminar.size} por eliminar · ${r.codigos.size} códigos ·
                ${r.alias.size} nombres unificados · ${r.normalizaciones.size} valores normalizados
                ${r.advertencias.length ? html`<ul>${r.advertencias.map((a) => html`<li>${a}</li>`)}</ul>` : null}
              <//>` : null}
            <//>`
        : html`<p class="nota">Ensayando la carga…</p>`}
    <//>`;
  }
  const puedeContinuar = paso === 1 ? ambos : paso === 2 ? true : paso === 3 ? Boolean(opcionesListas) : false;
  return html`
    <div class="primera-carga">
      <ol class="carga-progreso" aria-label="Progreso de la carga">
        ${["Archivos", "Áreas", "Conteo base", "Revisar y cargar"].map((nombre, i) => html`<li key=${nombre} class=${i + 1 < paso ? "completo" : i + 1 === paso ? "actual" : ""}>${i + 1}. ${nombre}</li>`)}
      </ol>
      <div class="carga-paso" key=${paso}>${cuerpo}</div>
      <div class="carga-navegacion">
        <${Boton} tamano="grande" onClick=${regresar}>← Regresar<//>
        ${paso < 4
          ? html`<${Boton} tipo="primario" tamano="grande" disabled=${!puedeContinuar} onClick=${continuar}>Continuar →<//>`
          : html`<${Boton} tipo="primario" tamano="grande" disabled=${!ensayo} onClick=${cargar}>Cargar definitivamente<//>`}
      </div>
      ${paso === 4 && ensayo ? html`<p class="nota carga-nota-final">Al cargar se crea el primer respaldo${sesion.carpetaLista ? html` en <code>${sesion.carpeta.name}</code>` : " en Descargas"}.</p>` : null}
    </div>
  `;
}
