// Conteo de auditoría (Ronda 24): cargar el Kardex (uno o varios archivos), relacionar cada hoja con su
// inventario como en el juego de unir parejas (la herramienta no adivina), ver el resumen del reemplazo y
// aplicarlo (servicios/baseOficial.js). Las listas de revisión (NP que se pierden y lo que sale del
// inventario) se imprimen antes o después de aplicar.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { sha256 } from "../../almacen/almacen.js";
import { CERO, aNumero } from "../../nucleo/decimal.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { DUENO_FX, INVENTARIOS } from "../../nucleo/inventarios.js";
import { ErrorReporteAx, leerReporteAx } from "../../importadores/ax.js";
import { documentoRevision } from "../../impresion/revision.js";
import { ErrorBaseOficial, analizarKardex, aplicarBaseOficial, listasDeRevision, planBaseOficial } from "../../servicios/baseOficial.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { ubicacionesOrdenadas } from "../../servicios/inventario.js";
import { Aviso, Boton, Detalles, ElegirArchivo, Lista, Pastilla, Tabla, Tarjeta, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { ListaErrores } from "./vales.js";

const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const cantidad = (d) => num(aNumero(d));

/** A qué se puede relacionar una hoja: cada inventario y FX (que vive dentro de GSM). */
const DESTINOS = [...INVENTARIOS.map((i) => ({ id: i.id, etiqueta: i.id, detalle: `Inventario ${i.id}` })), { id: DUENO_FX, etiqueta: DUENO_FX, detalle: "Dentro de GSM (comparte sus vales)" }];
/** Lo que se aplica en cada inventario abierto: en GSM, su hoja y la de FX. */
const destinosDe = (inventario) => (inventario === "GSM" ? ["GSM", DUENO_FX] : [inventario]);

// El Kardex cargado sigue aquí al cambiar de inventario en la misma pestaña (para aplicar el otro sin volver
// a cargarlo ni a relacionarlo). No se guarda en ningún lado: al recargar la página se pierde.
let pendiente = null;
const faltaEn = (inventario) =>
  Boolean(pendiente) && !pendiente.aplicados.includes(inventario) && destinosDe(inventario).some((d) => pendiente.relaciones[d]);

async function leerKardex(sesion, archivos) {
  const leidos = [];
  for (const archivo of archivos) {
    try {
      const datos = await leerArchivoSubido(archivo);
      const reporte = leerReporteAx(datos, archivo.name);
      const tablas = reporte.tablas.filter((t) => t.conConteo);
      if (!tablas.length) {
        sesion.avisar("error", `${archivo.name} no trae la columna "Conteo": es un reporte de AX sin conteo. Para compararlo con el inventario usa la conciliación.`);
        continue;
      }
      leidos.push({ nombre: archivo.name, huella: await sha256(datos), fecha: reporte.fechaSugerida, tablas });
    } catch (error) {
      if (error instanceof ErrorReporteAx) sesion.avisar("error", `${archivo.name}: ${error.message}`);
      else sesion.avisar("error", `No se pudo leer ${archivo.name}: ${error.message}`);
    }
  }
  return leidos;
}

/** Tarjeta de la página Conteo físico: cargar el Kardex de la auditoría. */
export function CargarAuditoria() {
  const sesion = useSesion();
  const inv = sesion.inventario.id;
  const [abierta, setAbierta] = useState(() => faltaEn(inv));
  const cargar = (archivos) =>
    sesion.tarea("Leyendo el Kardex…", async () => {
      const leidos = await leerKardex(sesion, archivos);
      if (!leidos.length) return;
      pendiente = { archivos: leidos, relaciones: {}, fecha: leidos.find((a) => a.fecha)?.fecha ?? hoyIso(), aplicados: [] };
      setAbierta(true);
    });
  return html`<${Tarjeta} titulo="Conteo de auditoría (Kardex)">
    <p class="nota">
      ¿La auditoría te dio el Kardex con la columna <strong>Conteo</strong>? Cárgalo (un archivo con varias hojas o un archivo por
      inventario), une cada hoja con su inventario y su conteo <strong>reemplaza</strong> lo inventariable: lo idéntico se queda con su NP y
      lo demás sale del Kardex. Lo consumible no se toca. Lo que se pierde (NP) o sale del inventario queda en listas para revisar.
    </p>
    <div class="acciones-linea">
      <${ElegirArchivo} etiqueta="Cargar el Kardex con el conteo" acepta=".xlsx" varios=${true} alElegir=${cargar} />
      ${faltaEn(inv) && !abierta ? html`<${Boton} tipo="primario" onClick=${() => setAbierta(true)}>Continuar con el Kardex cargado (${inv})<//>` : null}
    </div>
    ${abierta && pendiente ? html`<${VentanaAuditoria} alCerrar=${() => setAbierta(false)} />` : null}
  <//>`;
}

function VentanaAuditoria({ alCerrar }) {
  const sesion = useSesion();
  const inv = sesion.inventario.id;
  const [datos, setDatos] = useState(pendiente);
  useEffect(() => {
    pendiente = datos;
  }, [datos]);
  const agregar = (archivos) =>
    sesion.tarea("Leyendo…", async () => {
      const leidos = await leerKardex(sesion, archivos);
      if (leidos.length) setDatos((d) => ({ ...d, archivos: [...d.archivos, ...leidos], fecha: d.fecha ?? leidos.find((a) => a.fecha)?.fecha }));
    });
  const varios = datos.archivos.length > 1;
  const hojas = datos.archivos.flatMap((a, i) =>
    a.tablas.map((t) => ({ id: `${i}:${t.hoja}`, etiqueta: t.hoja, nombre: varios ? `${t.hoja} · ${a.nombre}` : t.hoja, detalle: `${varios ? `${a.nombre} · ` : ""}${t.renglones.length} partidas`, tabla: t, archivo: a })),
  );
  const relacionadas = destinosDe(inv)
    .map((d) => ({ destino: d, hoja: hojas.find((h) => h.id === datos.relaciones[d]) }))
    .filter((x) => x.hoja);
  const otro = INVENTARIOS.map((i) => i.id).find((id) => id !== inv && faltaEn(id) && destinosDe(id).some((d) => datos.relaciones[d]));
  const aplicado = datos.aplicados.includes(inv);
  const irAlOtro = () =>
    sesion.tarea(`Abriendo ${otro}…`, async () => {
      pendiente = datos;
      await sesion.cambiarInventario?.(otro, { pagina: "#conteo" });
    });

  return html`<${Ventana} titulo="Conteo de auditoría → reemplazar lo inventariable" clase="ventana-concilia" alCerrar=${alCerrar}>
    <section class="auditoria-paso">
      <h3>1. Une cada hoja con su inventario</h3>
      <p class="nota">Toca un inventario y luego su hoja (o al revés). Vuelve a tocar la pareja para separarla. Lo que no unas no se usa.</p>
      <${Relacionar}
        izquierda=${DESTINOS.map((d) => ({ ...d, abierto: destinosDe(inv).includes(d.id) }))}
        derecha=${hojas}
        relaciones=${datos.relaciones}
        alCambiar=${(relaciones) => setDatos((d) => ({ ...d, relaciones }))}
      />
      <div class="acciones-linea">
        <${ElegirArchivo} etiqueta="Agregar otro archivo" acepta=".xlsx" varios=${true} alElegir=${agregar} />
        <span class="nota">${datos.archivos.map((a) => a.nombre).join(" · ")}</span>
      </div>
    </section>

    <section class="auditoria-paso">
      <h3>2. Aplicar en ${inv}${inv === "GSM" ? " (y FX)" : ""}</h3>
      ${aplicado
        ? html`<${Aviso} tipo="exito" titulo=${`Listo: ${inv} quedó como el Kardex.`}>
            <p>Las listas para revisar están en <strong>Conteo físico → Listas de revisión de la auditoría</strong>.</p>
          <//>`
        : relacionadas.length
          ? html`<${PreviaReemplazo} key=${relacionadas.map((r) => `${r.destino}=${r.hoja.id}`).join("|")} relacionadas=${relacionadas} datos=${datos} setDatos=${setDatos} />`
          : html`<p class="vacio">Une la hoja de ${inv}${inv === "GSM" ? " (y la de FX)" : ""} para ver qué cambia.</p>`}
      ${otro
        ? html`<div class="acciones-linea">
            <${Boton} tipo=${aplicado ? "primario" : "secundario"} onClick=${irAlOtro}>Ir a ${otro} para aplicar ${destinosDe(otro).filter((d) => datos.relaciones[d]).join(" y ")}<//>
            <span class="nota">El Kardex y las parejas se quedan cargados.</span>
          </div>`
        : null}
    </section>
  <//>`;
}

function PreviaReemplazo({ relacionadas, datos, setDatos }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const inv = sesion.inventario.id;
  const [folio, setFolio] = useState("");
  const [ubicaciones, setUbicaciones] = useState({});
  const [errores, setErrores] = useState([]);
  const propia = relacionadas.find((r) => r.destino !== DUENO_FX);
  const fecha = datos.fecha ?? hoyIso();
  const hojas = useMemo(() => relacionadas.map((r) => ({ hoja: r.hoja.nombre, uso: r.destino === DUENO_FX ? DUENO_FX : "propio", tabla: r.hoja.tabla })), [relacionadas]);
  const analisis = useMemo(() => analizarKardex(estado, hojas, { fecha, folioSalida: folio }), [estado, hojas, fecha, folio]);
  const plan = useMemo(() => planBaseOficial(estado, analisis, { ubicaciones }), [analisis, ubicaciones]);
  const ubicacionesInv = useMemo(() => ubicacionesOrdenadas(estado).filter((u) => u.clase === "INV"), [estado.ubicaciones]);
  const r = plan.resumen;
  const cambian = plan.porCodigo.filter((f) => f.cambia).sort((a, b) => (b.impacto ? b.impacto.abs() : CERO).cmp(a.impacto ? a.impacto.abs() : CERO));
  const imprimir = (tipo, filas) => sesion.tarea("Preparando impresión…", () => sesion.imprimirDocumento(documentoRevision(tipo, filas, { fecha, inventario: inv })));
  const archivos = [...new Set(relacionadas.map((x) => x.hoja.archivo.nombre))].join(" · ");

  const aplicar = () => {
    const texto = `¿Reemplazar lo inventariable de ${inv} con el conteo de auditoría del ${fmtFecha(fecha)}? Se conservan ${r.conservadas} partidas, se dan de alta ${r.nuevas} y salen ${r.sustituidas + r.retiradas} (quedan en las listas de revisión). Antes se guarda una copia.`;
    if (!confirmar(texto)) return;
    return sesion.tarea("Aplicando el conteo de auditoría…", async () => {
      try {
        await sesion.almacen.instantanea("antes del conteo de auditoría");
        if (sesion.carpetaLista) await sesion.respaldar("antes-de-base-oficial", { descargarSiNoHayCarpeta: false });
        const archivo = archivos || null;
        const huella = propia?.hoja.archivo.huella ?? relacionadas[0].hoja.archivo.huella;
        const { resumen: hecho, corteAx } = await sesion.almacen.modificar((e) => aplicarBaseOficial(e, { hojas, fecha, folioSalida: folio, decisiones: { ubicaciones }, archivo, huella }, sesion.usuario));
        sesion.avisar(
          "exito",
          `${inv} quedó como el Kardex: ${hecho.conservadas} partidas conservadas, ${hecho.nuevas} nuevas y ${hecho.sustituidas + hecho.retiradas} de baja.${corteAx ? ` El Kardex también quedó en Conciliación AX (reporte del ${fmtFecha(fecha)}).` : ""}`,
        );
        setDatos((d) => ({ ...d, aplicados: [...d.aplicados, inv] }));
      } catch (error) {
        if (error instanceof ErrorBaseOficial) setErrores(error.errores.length ? error.errores : [{ mensaje: error.message }]);
        else throw error;
      }
    });
  };

  const porElegir = plan.nuevas.filter((n) => !n.ubicacion_id || ubicaciones[n.clave] !== undefined);
  return html`
    <div class="campos-importar">
      <label class="campo">
        <span>Fecha del conteo</span>
        <input type="date" value=${fecha} max=${hoyIso()} onChange=${(e) => setDatos((d) => ({ ...d, fecha: e.currentTarget.value }))} />
      </label>
      <label class="campo">
        <span>Último vale de salida que ya estaba descontado al contar</span>
        <input inputmode="numeric" value=${folio} placeholder=${String(plan.corte.salida)} onInput=${(e) => setFolio(e.currentTarget.value)} />
        <small class="ayuda">
          Por omisión, el último del ${fmtFecha(fecha)} (${plan.corte.salida}); entradas hasta ${plan.corte.entrada ? folioEntrada(plan.corte.entrada) : "—"}. Los vales
          posteriores se descuentan del conteo.
        </small>
      </label>
    </div>

    <ul class="cifras-auditoria">
      <li><strong>${num(r.conservadas)}</strong> se conservan${r.conservadasCambian ? html` <span class="nota">(${num(r.conservadasCambian)} cambian de cantidad o de dueño)</span>` : null}</li>
      <li><strong>${num(r.nuevas)}</strong> nuevas desde el Kardex</li>
      <li><strong>${num(r.sustituidas)}</strong> sustituidas</li>
      <li><strong>${num(r.retiradas)}</strong> salen (no vienen en el Kardex)</li>
      <li><strong>${num(r.npPerdidos)}</strong> NP se pierden</li>
      ${inv === "GSM" ? html`<li><strong>${num(r.fx)}</strong> de FX</li>` : null}
      <li class="nota">No se tocan: ${num(r.soloConsumible)} en consumible${inv === "GSM" ? ` · ${num(r.porRegla)} de 3 dígitos` : ""}</li>
    </ul>
    ${plan.avisos.map((a) => html`<${Aviso} tipo="advertencia">${a}<//>`)}

    ${porElegir.length
      ? html`<${Detalles} abierto resumen=${html`<strong>Contenedor por elegir</strong> · ${porElegir.length}`}>
          <p class="nota">El conteo anotó un contenedor que no existe: elige la hoja inventariable donde va.</p>
          <${Tabla}
            filas=${porElegir}
            claveFila=${(n) => n.clave}
            columnas=${[
              { titulo: "Código", numero: true, render: (n) => n.codigo },
              { titulo: "Artículo", render: (n) => `${n.descripcion} · ${n.dimension || "SIN DIMENSIÓN"}` },
              { titulo: "Cantidad", numero: true, render: (n) => `${cantidad(n.cantidad)} ${n.um}` },
              {
                titulo: "Contenedor",
                render: (n) => html`<${Lista}
                  clase=${n.ubicacion_id ? "" : "lista-pendiente"}
                  valor=${n.ubicacion_id ?? ""}
                  alCambiar=${(valor) => setUbicaciones((u) => ({ ...u, [n.clave]: Number(valor) }))}
                  ariaLabel="Contenedor"
                  placeholder=${`El conteo dice "${n.contenedor_anotado || "—"}": elige`}
                  opciones=${ubicacionesInv.map((u) => ({ valor: u.id, etiqueta: u.hoja_excel.trim() }))}
                />`,
              },
            ]}
          />
        <//>`
      : null}

    <${Detalles} resumen=${html`<strong>Cambios por artículo</strong> · ${cambian.length} (los de más impacto en $ primero)`}>
      <${Tabla}
        filas=${cambian}
        claveFila=${(f) => f.codigo}
        limite=${80}
        vacia="Ningún artículo cambia."
        columnas=${[
          { titulo: "Código", numero: true, render: (f) => f.codigo },
          { titulo: "Descripción", render: (f) => f.descripcion },
          { titulo: "Antes", numero: true, render: (f) => cantidad(f.antes) },
          { titulo: "Después", numero: true, render: (f) => cantidad(f.despues) },
          { titulo: "Impacto", numero: true, render: (f) => (f.impacto ? html`<span class=${f.impacto.lt(0) ? "alerta" : ""}>${pesos.format(aNumero(f.impacto))}</span>` : "") },
          {
            titulo: "Partidas",
            render: (f) => html`<ul class="reparto">
              ${f.detalle.map(
                (d) => html`<li class=${d.accion === "baja" ? "reparto-baja" : ""}>
                  <${Pastilla} tono="lugar">${d.lugar || "?"}<//>
                  <span class="reparto-clave">${d.texto}</span>
                  <span class="nota">
                    ${d.accion === "conserva" ? `${cantidad(d.antes)} → ${cantidad(d.despues)}` : d.accion === "nueva" ? `nueva: ${cantidad(d.despues)}${d.junta ? ` (junta ${d.junta})` : ""}` : `sale (${cantidad(d.antes)})`}
                  </span>
                  ${d.dueno === DUENO_FX ? html`<${Pastilla} tono="fx">FX<//>` : null}
                </li>`,
              )}
            </ul>`,
          },
        ]}
      />
    <//>

    <${ListaRevision} tipo="np" titulo="NP que se pierden" filas=${plan.listaNp} alImprimir=${() => imprimir("np", plan.listaNp)} />
    <${ListaRevision} tipo="retiradas" titulo="Salen del inventario (no vienen en el Kardex)" filas=${plan.listaRetiradas} alImprimir=${() => imprimir("retiradas", plan.listaRetiradas)} />

    ${plan.soloConsumible.length || plan.porRegla.length
      ? html`<p class="nota">
          No se tocan: ${plan.soloConsumible.length ? `${plan.soloConsumible.length} que en tu inventario están en consumible (${plan.soloConsumible.map((s) => s.linea.codigo).join(", ")})` : ""}${plan.soloConsumible.length && plan.porRegla.length ? "; " : ""}${plan.porRegla.length
            ? `${plan.porRegla.length} de 3 dígitos (en ${inv} son consumibles)`
            : ""}.
        </p>`
      : null}
    <${ListaErrores} errores=${[...plan.errores, ...errores.filter((e) => !plan.errores.some((x) => x.mensaje === e.mensaje))]} />
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${plan.errores.length > 0 || !r.lineas} onClick=${aplicar}>Reemplazar lo inventariable de ${inv}<//>
      <span class="nota">Nada cambia hasta aplicar; antes se guarda una copia. El Kardex queda también en Conciliación AX.</span>
    </div>
  `;
}

/** Una lista de revisión (NP que se pierden / lo que sale) con su botón de imprimir. */
function ListaRevision({ tipo, titulo, filas, alImprimir, abierta = false }) {
  if (!filas.length) return null;
  return html`<${Detalles} abierto=${abierta} resumen=${html`<strong>${titulo}</strong> · ${filas.length}`}>
    <div class="acciones-linea"><${Boton} tamano="chico" onClick=${alImprimir}>🖨 Imprimir la lista<//></div>
    <${Tabla}
      filas=${filas}
      claveFila=${(f) => f.existencia_id}
      limite=${100}
      columnas=${[
        { titulo: "Cont.", render: (f) => f.lugar },
        { titulo: "Código", numero: true, render: (f) => f.codigo },
        { titulo: "Descripción", render: (f) => html`${f.descripcion}${f.dueno === DUENO_FX ? html` <${Pastilla} tono="fx">FX<//>` : null}` },
        { titulo: "Dimensión", render: (f) => f.dimension || "SIN DIMENSIÓN" },
        { titulo: "NP", render: (f) => f.np },
        { titulo: "Tenía", numero: true, render: (f) => `${f.cantidad} ${f.um}` },
        ...(tipo === "np" ? [{ titulo: "Ahora está en", render: (f) => f.reemplazo || "—" }] : []),
      ]}
    />
  <//>`;
}

/** Las listas guardadas de los conteos de auditoría ya aplicados, para imprimirlas cuando se necesiten. */
export function ListasDeRevision() {
  const sesion = useSesion();
  const listas = useMemo(() => listasDeRevision(sesion.estado), [sesion.estado]);
  if (!listas.length) return null;
  const imprimir = (tipo, l) => sesion.tarea("Preparando impresión…", () => sesion.imprimirDocumento(documentoRevision(tipo, tipo === "np" ? l.np : l.retiradas, { fecha: l.fecha, inventario: sesion.inventario.id })));
  return html`<${Tarjeta} titulo="Listas de revisión de la auditoría">
    <p class="nota">Lo que quedó al reemplazar lo inventariable con el Kardex: para anotar a mano los NP que hagan falta (Inventario → NP) y revisar en físico lo que salió.</p>
    ${listas.map(
      (l) => html`<div key=${l.conteo_id} class="lista-revision">
        <p><strong>Conteo del ${fmtFecha(l.fecha)}</strong>${l.archivo ? html` <span class="nota">· ${l.archivo}</span>` : null}</p>
        <${ListaRevision} tipo="np" titulo="NP que se perdieron" filas=${l.np} alImprimir=${() => imprimir("np", l)} />
        <${ListaRevision} tipo="retiradas" titulo="Salieron del inventario" filas=${l.retiradas} alImprimir=${() => imprimir("retiradas", l)} />
        ${!l.np.length && !l.retiradas.length ? html`<p class="nota">No se perdió ningún NP ni salió ninguna partida.</p>` : null}
      </div>`,
    )}
  <//>`;
}

/**
 * Unir parejas: cada elemento de la izquierda (inventarios) con uno de la derecha (hojas), con una línea del
 * color de su inventario. Uno con uno: unir con otro deshace la pareja anterior.
 * @param relaciones { [idIzquierda]: idDerecha }
 */
export function Relacionar({ izquierda, derecha, relaciones, alCambiar }) {
  const [activo, setActivo] = useState(null); // { lado, id }
  const caja = useRef(null);
  const [lineas, setLineas] = useState([]);
  const unir = (izq, der) => {
    const nuevas = Object.fromEntries(Object.entries(relaciones).filter(([i, d]) => i !== izq && d !== der));
    if (relaciones[izq] !== der) nuevas[izq] = der;
    alCambiar(nuevas);
    setActivo(null);
  };
  const tocar = (lado, id) => {
    if (activo && activo.lado !== lado) return lado === "izq" ? unir(id, activo.id) : unir(activo.id, id);
    setActivo(activo && activo.lado === lado && activo.id === id ? null : { lado, id });
  };
  const medir = () => {
    const c = caja.current;
    if (!c) return;
    const base = c.getBoundingClientRect();
    const de = (lado, id) => c.querySelector(`[data-lado="${lado}"][data-id="${CSS.escape(String(id))}"]`)?.getBoundingClientRect();
    setLineas(
      Object.entries(relaciones)
        .map(([i, d]) => {
          const a = de("izq", i);
          const b = de("der", d);
          if (!a || !b) return null;
          return { id: i, x1: a.right - base.left, y1: a.top + a.height / 2 - base.top, x2: b.left - base.left, y2: b.top + b.height / 2 - base.top };
        })
        .filter(Boolean),
    );
  };
  useLayoutEffect(medir, [relaciones, izquierda, derecha]);
  useEffect(() => {
    const observador = new ResizeObserver(medir);
    if (caja.current) observador.observe(caja.current);
    return () => observador.disconnect();
  }, [relaciones]);
  const parejaDe = (id) => Object.entries(relaciones).find(([, d]) => d === id)?.[0] ?? null;
  return html`<div class="relacionar" ref=${caja}>
    <svg class="relacionar-lineas" aria-hidden="true">
      ${lineas.map((l) => html`<path key=${l.id} class=${`rel-${l.id}`} d=${`M${l.x1},${l.y1} C${(l.x1 + l.x2) / 2},${l.y1} ${(l.x1 + l.x2) / 2},${l.y2} ${l.x2},${l.y2}`} />`)}
    </svg>
    <ul class="relacionar-columna">
      ${izquierda.map(
        (x) => html`<li key=${x.id}>
          <button
            type="button"
            data-lado="izq"
            data-id=${x.id}
            class=${`relacionar-item rel-${x.id} ${relaciones[x.id] ? "unido" : ""} ${activo?.lado === "izq" && activo.id === x.id ? "activo" : ""}`}
            aria-pressed=${activo?.lado === "izq" && activo.id === x.id}
            onClick=${() => tocar("izq", x.id)}
          >
            <span class="relacionar-titulo"><strong>${x.etiqueta}</strong>${x.abierto ? html`<span class="pastilla pastilla-info">abierto</span>` : null}</span>
            <small>${x.detalle}</small>
          </button>
        </li>`,
      )}
    </ul>
    <span></span>
    <ul class="relacionar-columna">
      ${derecha.map((x) => {
        const pareja = parejaDe(x.id);
        return html`<li key=${x.id}>
          <button
            type="button"
            data-lado="der"
            data-id=${x.id}
            class=${`relacionar-item ${pareja ? `unido rel-${pareja}` : ""} ${activo?.lado === "der" && activo.id === x.id ? "activo" : ""}`}
            aria-pressed=${activo?.lado === "der" && activo.id === x.id}
            onClick=${() => tocar("der", x.id)}
          >
            <span class="relacionar-titulo"><strong>${x.etiqueta}</strong>${pareja ? html`<span class="relacionar-pareja">→ ${pareja}</span>` : null}</span>
            <small>${x.detalle}</small>
          </button>
        </li>`;
      })}
    </ul>
  </div>`;
}

