// Conteo de auditoría (Ronda 20): cargar el Kardex con el conteo oficial, ver todo lo que cambiaría,
// decidir lo dudoso y aplicarlo como base oficial del inventario (servicios/baseOficial.js).

import { useMemo, useState } from "preact/hooks";
import { leerArchivoSubido } from "../../almacen/archivos.js";
import { sha256 } from "../../almacen/almacen.js";
import { CERO, aNumero, dec, decTexto } from "../../nucleo/decimal.js";
import { fmtFecha, hoyIso } from "../../nucleo/fechas.js";
import { DUENO_FX } from "../../nucleo/inventarios.js";
import { ErrorReporteAx, leerReporteAx } from "../../importadores/ax.js";
import { ErrorBaseOficial, analizarKardex, aplicarBaseOficial, costoUnitario, planBaseOficial } from "../../servicios/baseOficial.js";
import { corteConHuella, dimensionAx, textoVariante } from "../../servicios/conciliacion.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { lugarCorto, ubicacionesOrdenadas } from "../../servicios/inventario.js";
import { COINCIDENCIA_MINIMA, clasificarHojas, textoCoincidencia } from "../../servicios/kardex.js";
import { Aviso, Boton, Detalles, ElegirArchivo, Lista, Pastilla, Segmentos, Tabla, Tarjeta, Ventana, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { seguirConArchivo } from "../inventario.js";
import { ListaErrores } from "./vales.js";

const pesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const textoAx = (l) => dimensionAx(l) || "SIN DIMENSIÓN";
const textoPartida = (p) => `${p.dimension || "SIN DIMENSIÓN"}${p.np ? ` · NP ${p.np}` : ""}`;
const cantidad = (d) => num(aNumero(d));
const sumar = (xs) => xs.reduce((a, x) => a.plus(x), CERO);

/** Tarjeta de la página Conteo físico: cargar el Kardex de la auditoría. */
export function CargarAuditoria() {
  const sesion = useSesion();
  const [previa, setPrevia] = useState(null);
  const abrir = (archivo) =>
    seguirConArchivo(sesion, archivo.name) &&
    sesion.tarea("Leyendo el Kardex…", async () => {
      try {
        const datos = await leerArchivoSubido(archivo);
        const reporte = leerReporteAx(datos, archivo.name);
        const tablas = reporte.tablas.filter((t) => t.conConteo);
        if (!tablas.length) {
          sesion.avisar("error", `${archivo.name} no trae la columna "Conteo": es un reporte de AX sin conteo. Para compararlo con el inventario usa Conciliación AX.`);
          return;
        }
        setPrevia({ nombre: archivo.name, fecha: reporte.fechaSugerida, hojas: clasificarHojas(sesion.estado, tablas), huella: await sha256(datos) });
      } catch (error) {
        if (error instanceof ErrorReporteAx) sesion.avisar("error", error.message);
        else sesion.avisar("error", `No se pudo leer ${archivo.name}: ${error.message}`);
      }
    });
  return html`<${Tarjeta} titulo="Conteo de auditoría (Kardex)">
    <p class="nota">
      ¿La auditoría te dio el Kardex con la columna <strong>Conteo</strong>? Cárgalo y su conteo pasa a ser la CANTIDAD de las partidas
      <strong>inventariables</strong> (lo consumible no se toca): la base oficial con la que se comparan los siguientes reportes de AX.
      ${sesion.inventario.id === "GSM" ? html` La hoja de <strong>FX</strong> marca sus partidas como de FX.` : null} Antes de aplicar ves todo y decides lo
      dudoso.
    </p>
    <div class="acciones-linea"><${ElegirArchivo} etiqueta="Cargar el Kardex con el conteo" acepta=".xlsx" alElegir=${abrir} /></div>
    ${previa ? html`<${VentanaAuditoria} previa=${previa} alCerrar=${() => setPrevia(null)} />` : null}
  <//>`;
}

function VentanaAuditoria({ previa, alCerrar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const inv = sesion.inventario.id;
  const esGsm = inv === "GSM";
  const [usos, setUsos] = useState(() => Object.fromEntries(previa.hojas.map((h) => [h.hoja, h.uso ?? ""])));
  const [seguras, setSeguras] = useState({});
  const [fecha, setFecha] = useState(previa.fecha ?? hoyIso());
  const [folio, setFolio] = useState("");
  const [decisiones, setDecisiones] = useState({});
  const [registrarCorte, setRegistrarCorte] = useState(!corteConHuella(estado, previa.huella));
  const [errores, setErrores] = useState([]);
  const hojas = previa.hojas.map((h) => ({ ...h, uso: usos[h.hoja] || null }));
  const usadas = hojas.filter((h) => h.uso);
  const dudosas = usadas.filter((h) => h.coincidencia.proporcion < COINCIDENCIA_MINIMA && !seguras[h.hoja]);
  const firma = JSON.stringify(usos);
  const analisis = useMemo(() => (usadas.length && fecha ? analizarKardex(estado, hojas, { fecha, folioSalida: folio }) : null), [estado, firma, fecha, folio]);
  const plan = useMemo(() => (analisis ? planBaseOficial(estado, analisis, decisiones) : null), [analisis, decisiones]);
  const decidir = (tipo, clave, valor) => setDecisiones((d) => ({ ...d, [tipo]: { ...(d[tipo] ?? {}), [clave]: valor } }));
  const ubicacionesInv = useMemo(() => ubicacionesOrdenadas(estado).filter((u) => u.clase === "INV"), [estado.ubicaciones]);

  const aplicar = () => {
    const r = plan.resumen;
    const texto = `¿Aplicar el conteo de auditoría del ${fmtFecha(fecha)} como base oficial de ${inv}? ${r.cambian} artículos cambian, ${r.nuevas} partidas nuevas y ${r.bajas} de baja. Antes se guarda una copia.`;
    if (!confirmar(texto)) return;
    return sesion.tarea("Aplicando la base oficial…", async () => {
      try {
        await sesion.almacen.instantanea("antes de la base oficial");
        if (sesion.carpetaLista) await sesion.respaldar("antes-de-base-oficial", { descargarSiNoHayCarpeta: false });
        const hecho = await sesion.almacen.modificar(
          (e) => aplicarBaseOficial(e, { hojas, fecha, folioSalida: folio, decisiones, archivo: previa.nombre, huella: previa.huella, registrarCorte }, sesion.usuario).resumen,
        );
        sesion.avisar("exito", `Base oficial aplicada: ${hecho.partidas} partidas contadas (${hecho.diferencias} con diferencia), ${hecho.nuevas} nuevas y ${hecho.bajas} de baja.`);
        alCerrar();
      } catch (error) {
        if (error instanceof ErrorBaseOficial) setErrores(error.errores.length ? error.errores : [{ mensaje: error.message }]);
        else throw error;
      }
    });
  };

  const opcionesUso = [{ valor: "", etiqueta: "No usar" }, { valor: "propio", etiqueta: `Es de ${inv}` }, ...(esGsm ? [{ valor: DUENO_FX, etiqueta: "Es de FX" }] : [])];
  const propia = usadas.find((h) => h.uso === "propio");
  return html`<${Ventana} titulo="Conteo de auditoría → base oficial" clase="ventana-concilia" alCerrar=${alCerrar}>
    <p><strong>${previa.nombre}</strong></p>
    <${Tabla}
      filas=${hojas}
      claveFila=${(h) => h.hoja}
      columnas=${[
        { titulo: "Hoja", render: (h) => html`<strong>${h.hoja}</strong>` },
        { titulo: "Partidas", numero: true, render: (h) => num(h.tabla.renglones.length) },
        { titulo: "Códigos en tu inventario", render: (h) => html`<span class=${h.coincidencia.proporcion < COINCIDENCIA_MINIMA ? "alerta" : ""}>${textoCoincidencia(h.coincidencia, inv)}</span>` },
        { titulo: "Se usa como", render: (h) => html`<${Lista} valor=${usos[h.hoja]} alCambiar=${(v) => setUsos({ ...usos, [h.hoja]: v })} ariaLabel=${`Uso de la hoja ${h.hoja}`} opciones=${opcionesUso} />` },
        { titulo: "", render: (h) => (h.uso ? null : html`<span class="nota">${h.motivo}</span>`) },
      ]}
    />
    ${dudosas.map(
      (h) => html`<${Aviso} tipo="advertencia" titulo=${`¿La hoja ${h.hoja} es de ${h.uso === DUENO_FX ? "FX" : inv}?`}>
        <p>${textoCoincidencia(h.coincidencia, inv)}: parece de otro inventario.</p>
        <label class="casilla"><input type="checkbox" onChange=${(e) => setSeguras({ ...seguras, [h.hoja]: e.currentTarget.checked })} /><span>Sí, úsala de todos modos</span></label>
      <//>`,
    )}
    <div class="campos-importar">
      <label class="campo">
        <span>Fecha del conteo</span>
        <input type="date" value=${fecha} max=${hoyIso()} onChange=${(e) => setFecha(e.currentTarget.value)} />
        <small class="ayuda">${previa.fecha ? "Tomada del nombre del archivo: confírmala." : "No viene en el nombre: escríbela."}</small>
      </label>
      <label class="campo">
        <span>Último vale de salida que ya estaba descontado al contar</span>
        <input inputmode="numeric" value=${folio} placeholder=${plan ? String(plan.corte.salida) : ""} onInput=${(e) => setFolio(e.currentTarget.value)} />
        <small class="ayuda">
          ${plan ? `Por omisión, el último del ${fmtFecha(fecha)} (${plan.corte.salida}); entradas hasta ${plan.corte.entrada ? folioEntrada(plan.corte.entrada) : "—"}. ` : ""}Los vales posteriores se
          descuentan del conteo.
        </small>
      </label>
    </div>
    ${!usadas.length ? html`<p class="vacio">Elige qué hoja es de ${inv}.</p>` : null}
    ${plan ? html`<${Previa} plan=${plan} esGsm=${esGsm} inv=${inv} decidir=${decidir} decisiones=${decisiones} ubicacionesInv=${ubicacionesInv} />` : null}
    ${plan && propia
      ? html`<label class="casilla">
          <input type="checkbox" checked=${registrarCorte} onChange=${(e) => setRegistrarCorte(e.currentTarget.checked)} />
          <span>
            Guardar también el <strong>Disponible</strong> de AX de la hoja ${propia.hoja} como corte de AX al ${fmtFecha(fecha)}, para justificar los faltantes en
            Conciliación AX${corteConHuella(estado, previa.huella) ? " (este archivo ya está importado como corte)" : ""}.
          </span>
        </label>`
      : null}
    <${ListaErrores} errores=${[...(plan?.errores ?? []), ...errores.filter((e) => !(plan?.errores ?? []).some((x) => x.mensaje === e.mensaje))]} />
    ${plan?.avisos.map((a) => html`<${Aviso} tipo="advertencia">${a}<//>`)}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!plan || plan.errores.length || dudosas.length || !plan.resumen.lineas} onClick=${aplicar}>Aplicar como base oficial<//>
      <${Boton} tipo="texto" onClick=${alCerrar}>Cancelar<//>
      <span class="nota">Nada cambia hasta aplicar.</span>
    </div>
  <//>`;
}

/** Diferencia en $ de un grupo (lo que queda − lo que había, al costo de AX). */
function impacto(g) {
  const cu = costoUnitario(g.lineas[0]);
  if (!cu) return null;
  return sumar(g.partidas.filter((p) => !p.omitida).map((p) => p.cantidad)).minus(sumar(g.partidas.map((p) => p.actual))).times(cu);
}

function Previa({ plan, esGsm, inv, decidir, decisiones, ubicacionesInv }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const r = plan.resumen;
  const cambian = plan.grupos.filter((g) => g.cambia).map((g) => ({ ...g, impacto: impacto(g) }));
  cambian.sort((a, b) => (b.impacto ? b.impacto.abs() : CERO).cmp(a.impacto ? a.impacto.abs() : CERO));
  const cuadran = plan.grupos.filter((g) => !g.cambia);
  const marcarCeros = () => {
    for (const s of plan.sinKardex) if (s.actual.lte(0) && s.puede_baja) decidir("sinKardex", s.existencia.id, "baja");
  };
  // "7" o, si el artículo está en las dos hojas, "GSM: 4 · FX: 2".
  const conteoPorDueno = (g) => {
    const duenos = [...new Set(g.lineas.map((l) => l.dueno))].sort((a, b) => Number(Boolean(a)) - Number(Boolean(b)));
    const etiqueta = (d) => (duenos.length > 1 || d ? `${d ?? inv}: ` : "");
    return duenos.map((d) => `${etiqueta(d)}${cantidad(sumar(g.lineas.filter((l) => l.dueno === d).map((l) => dec(l.conteo) ?? CERO)))}`).join(" · ");
  };
  return html`
    <ul class="cifras-auditoria">
      <li><strong>${num(r.cuadran)}</strong> cuadran</li>
      <li><strong>${num(r.cambian)}</strong> cambian</li>
      <li><strong>${num(r.nuevas)}</strong> partidas nuevas</li>
      <li><strong>${num(r.bajas)}</strong> de baja</li>
      ${esGsm ? html`<li><strong>${num(r.fx)}</strong> de FX</li>` : null}
      <li><strong>${num(r.porConfirmar)}</strong> por confirmar</li>
      <li class="nota"><strong>${num(r.soloConsumible)}</strong> solo en consumible · <strong>${num(r.sinKardex)}</strong> inventariables sin Kardex</li>
    </ul>

    ${plan.porConfirmar.length
      ? html`<${Detalles}
          abierto
          resumen=${html`<strong>Se escriben distinto</strong> · ${plan.porConfirmar.length} por confirmar${r.porDecidir ? html` · <span class="alerta">${r.porDecidir} por elegir</span>` : null}`}
        >
          <p class="nota">
            AX la escribe distinto que tu inventario. Si es la misma, la partida toma la escritura de AX y el conteo; si no, se da de alta una nueva. Solo se propone
            una cuando es muy parecida y tiene los mismos números ("0-500 PSI" no es "0-300 PSI"); las demás las eliges tú.
          </p>
          ${r.porDecidir
            ? html`<div class="acciones-linea">
                <${Boton} tamano="chico" onClick=${() => plan.porConfirmar.filter((x) => x.decision === null).forEach((x) => decidir("parejas", x.linea.id, "nueva"))}>
                  Las ${r.porDecidir} por elegir: partida nueva
                <//>
              </div>`
            : null}
          <${Tabla}
            filas=${[...plan.porConfirmar].sort((a, b) => Number(a.decision !== null) - Number(b.decision !== null))}
            claveFila=${(x) => x.linea.id}
            columnas=${[
              { titulo: "Código", numero: true, render: (x) => x.linea.codigo },
              { titulo: "En AX", render: (x) => html`${textoAx(x.linea)} <span class="nota">${x.linea.nombre}</span>${x.linea.dueno ? html` <${Pastilla} tono="fx">FX<//>` : null}` },
              { titulo: "Conteo", numero: true, render: (x) => cantidad(x.linea.conteo) },
              {
                titulo: "En tu inventario",
                render: (x) => html`<${Lista}
                  clase=${x.decision === null ? "lista-pendiente" : ""}
                  placeholder="— Elige —"
                  valor=${x.decision ?? ""}
                  alCambiar=${(valor) => decidir("parejas", x.linea.id, valor === "nueva" ? "nueva" : Number(valor))}
                  ariaLabel="Partida del inventario"
                  opciones=${[
                    ...x.candidatos.map((c) => ({ valor: c.variante_id, etiqueta: textoVariante(estado.variantes.find((v) => v.id === c.variante_id)), detalle: `${lugaresDe(estado, c.variante_id)} · parecido ${Math.round(c.puntaje * 100)} %` })),
                    { valor: "nueva", etiqueta: x.inv ? "Ninguna: partida nueva" : "Ninguna: no aplicar (no es INV)" },
                  ]}
                />`,
              },
            ]}
          />
        <//>`
      : null}

    <${Detalles} abierto=${cambian.length > 0} resumen=${html`<strong>Cambian</strong> · ${cambian.length} artículos (los de más impacto en $ primero)`}>
      <${Tabla}
        filas=${cambian}
        claveFila=${(g) => g.clave}
        limite=${60}
        vacia="Ningún artículo cambia."
        columnas=${[
          { titulo: "Código", numero: true, render: (g) => g.lineas[0].codigo },
          { titulo: "Artículo", render: (g) => html`${g.partidas[0]?.descripcion || g.lineas[0].nombre}<br /><span class="nota">AX: ${textoAx(g.lineas[0])}</span>${g.revisar ? html` <${Pastilla} tono="alerta" titulo="Revisa el reparto entre las partidas">revisar<//>` : null}` },
          { titulo: "Conteo", render: (g) => conteoPorDueno(g) },
          { titulo: "Partidas", render: (g) => html`<${Reparto} grupo=${g} esGsm=${esGsm} decidir=${decidir} decisiones=${decisiones} />` },
          { titulo: "Impacto", numero: true, render: (g) => (g.impacto ? html`<span class=${g.impacto.lt(0) ? "alerta" : ""}>${pesos.format(aNumero(g.impacto))}</span>` : "") },
        ]}
      />
    <//>

    ${plan.nuevas.length
      ? html`<${Detalles} abierto resumen=${html`<strong>No estaban en tu inventario</strong> · ${plan.nuevas.length} partidas nuevas`}>
          <p class="nota">Se dan de alta en la hoja inventariable del contenedor que anotó el conteo.</p>
          <${Tabla}
            filas=${plan.nuevas}
            claveFila=${(p) => p.clave}
            columnas=${[
              { titulo: "Código", numero: true, render: (p) => p.codigo },
              { titulo: "Artículo", render: (p) => html`${p.descripcion}${p.dueno ? html` <${Pastilla} tono="fx">FX<//>` : null}` },
              { titulo: "Dimensión", render: (p) => p.dimension || "SIN DIMENSIÓN" },
              { titulo: "Cantidad", numero: true, render: (p) => html`${cantidad(p.cantidad)} ${p.um}` },
              {
                titulo: "Contenedor",
                render: (p) => html`<${Lista}
                  clase=${p.ubicacion_id || decisiones.omitir?.[p.clave] ? "" : "lista-pendiente"}
                  valor=${p.ubicacion_id ?? ""}
                  alCambiar=${(v) => decidir("ubicaciones", p.clave, Number(v))}
                  ariaLabel="Contenedor"
                  placeholder=${`El conteo dice "${p.linea.contenedor || "—"}": elige`}
                  opciones=${ubicacionesInv.map((u) => ({ valor: u.id, etiqueta: u.hoja_excel.trim() }))}
                />`,
              },
              {
                titulo: "",
                render: (p) => html`<label class="casilla"><input type="checkbox" checked=${Boolean(decisiones.omitir?.[p.clave])} onChange=${(e) => decidir("omitir", p.clave, e.currentTarget.checked)} /><span>No darla de alta</span></label>`,
              },
            ]}
          />
        <//>`
      : null}

    ${plan.sinKardex.length
      ? html`<${Detalles} resumen=${html`<strong>Inventariables que el Kardex no trae</strong> · ${plan.sinKardex.length} (se quedan como están)`}>
          <p class="nota">
            La auditoría no las contó. Si comprobaste que no existen, márcalas: quedan en 0 y dejan de salir en el Excel (no se borran: quedan en el
            historial del conteo).
          </p>
          <div class="acciones-linea"><${Boton} tamano="chico" onClick=${marcarCeros}>Marcar como "No existe" las que están en 0<//></div>
          <${Tabla}
            filas=${plan.sinKardex}
            claveFila=${(s) => s.clave}
            limite=${100}
            columnas=${[
              { titulo: "Cont.", render: (s) => s.lugar },
              { titulo: "Código", numero: true, render: (s) => s.codigo },
              { titulo: "Descripción", render: (s) => html`${s.descripcion}${s.dueno ? html` <${Pastilla} tono="fx">FX<//>` : null}` },
              { titulo: "Dimensión / NP", render: (s) => textoPartida(s) },
              { titulo: "Tiene", numero: true, render: (s) => html`${cantidad(s.actual)} ${s.um}` },
              {
                titulo: "",
                render: (s) =>
                  s.puede_baja
                    ? html`<${Segmentos} valor=${s.decision} alCambiar=${(v) => decidir("sinKardex", s.existencia.id, v)} opciones=${{ dejar: "Dejar", baja: "No existe" }} />`
                    : html`<span class="nota">Con vales posteriores</span>`,
              },
            ]}
          />
        <//>`
      : null}

    ${plan.soloConsumible.length
      ? html`<${Detalles} resumen=${html`<strong>Solo en consumible</strong> · ${plan.soloConsumible.length} (no se tocan)`}>
          <p class="nota">El Kardex las contó, pero en tu inventario están en una hoja de consumible. No se cambian; si deben ir en inventariable, muévelas desde Inventario.</p>
          <${Tabla}
            filas=${plan.soloConsumible}
            claveFila=${(s) => s.lineas[0].id}
            columnas=${[
              { titulo: "Código", numero: true, render: (s) => s.lineas[0].codigo },
              { titulo: "En AX", render: (s) => textoAx(s.lineas[0]) },
              { titulo: "Conteo", numero: true, render: (s) => cantidad(sumar(s.lineas.map((l) => dec(l.conteo) ?? CERO))) },
              { titulo: "En tu inventario", render: (s) => s.partidas.map((p) => `${p.lugar}: ${cantidad(p.actual)}`).join(" · ") },
            ]}
          />
        <//>`
      : null}

    <${Detalles} resumen=${html`<strong>Cuadran</strong> · ${cuadran.length} artículos sin cambios`}>
      <${Tabla}
        filas=${cuadran}
        claveFila=${(g) => g.clave}
        limite=${50}
        columnas=${[
          { titulo: "Código", numero: true, render: (g) => g.lineas[0].codigo },
          { titulo: "En AX", render: (g) => textoAx(g.lineas[0]) },
          { titulo: "Conteo", render: (g) => conteoPorDueno(g) },
          { titulo: "Partidas", render: (g) => g.partidas.map((p) => `${p.lugar}: ${cantidad(p.cantidad)}`).join(" · ") },
        ]}
      />
    <//>

    ${plan.ignoradas.length || plan.noEncontradas.length
      ? html`<p class="nota">
          No se aplican: ${plan.ignoradas.length ? `${plan.ignoradas.length} de otro modelo (no INV) que no están en tu inventario` : ""}${plan.ignoradas.length && plan.noEncontradas.length ? " y " : ""}${plan.noEncontradas.length
            ? `${plan.noEncontradas.length} que el conteo encontró en 0 y no tienes (${plan.noEncontradas.map((l) => l.codigo).join(", ")})`
            : ""}.
        </p>`
      : null}
  `;
}

/** Las partidas de un artículo con lo que tenían y lo que quedará (editable). */
function Reparto({ grupo, esGsm, decidir, decisiones }) {
  return html`<ul class="reparto">
    ${grupo.partidas.map((p) => {
      const valor = decisiones.cantidades?.[p.clave] ?? decTexto(p.cantidad);
      return html`<li key=${p.clave} class=${p.baja ? "reparto-baja" : ""}>
        <${Pastilla} tono="lugar">${p.lugar || "—"}<//>
        <span class="reparto-clave">${textoPartida(p)}</span>
        <span class="nota">${p.nueva ? "nueva" : `tenía ${cantidad(p.actual)}`} →</span>
        <input class="reparto-cantidad" inputmode="decimal" value=${valor} aria-label="Cantidad" onInput=${(e) => decidir("cantidades", p.clave, e.currentTarget.value)} />
        ${esGsm
          ? html`<label class="casilla"><input type="checkbox" checked=${p.dueno === DUENO_FX} onChange=${(e) => decidir("duenos", p.clave, e.currentTarget.checked ? DUENO_FX : null)} /><span>FX</span></label>`
          : null}
        ${p.nueva ? null : html`<label class="casilla" title=${p.puede_baja ? "" : "Tiene vales posteriores al conteo"}><input type="checkbox" disabled=${!p.puede_baja} checked=${p.baja} onChange=${(e) => decidir("bajas", p.clave, e.currentTarget.checked)} /><span>De baja</span></label>`}
        ${p.mover_a
          ? html`<label class="casilla"><input type="checkbox" checked=${p.mover} onChange=${(e) => decidir("mover", p.clave, e.currentTarget.checked)} /><span>Moverla a ${p.mover_lugar}</span></label>`
          : null}
      </li>`;
    })}
  </ul>`;
}

/** "#1 Inv. (7) · #2 Inv. (3)": dónde está una variante y cuánto tiene. */
function lugaresDe(estado, varianteId) {
  const ubicaciones = new Map(estado.ubicaciones.map((u) => [u.id, u]));
  return estado.existencias
    .filter((e) => e.activo !== false && e.variante_id === varianteId)
    .map((e) => lugarCorto(ubicaciones.get(e.ubicacion_id)))
    .join(" · ");
}
