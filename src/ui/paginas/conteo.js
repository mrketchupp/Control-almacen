import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import {
  ErrorConteo,
  aplicarConteo,
  descartarConteo,
  guardarConteoEnCurso,
  historialConteos,
  iniciarConteo,
  nuevoSobrante,
  renglonesDelConteo,
  resumenConteo,
  validarConteo,
  valesDuranteConteo,
  variantesDeCodigo,
} from "../../servicios/conteos.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { lugarCorto, ubicacionesOrdenadas } from "../../servicios/inventario.js";
import { Aviso, Boton, Buscador, Detalles, Lista, Pastilla, Tabla, Tarjeta, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { aplicarConteoIA } from "../../servicios/capturaIA.js";
import { CapturaIA } from "./capturaIA.js";
import { CeldaCodigo, ListaErrores, indiceArticulos } from "./vales.js";

const signo = (d) => (d === null ? "" : d.gt(0) ? `+${num(aNumero(d))}` : num(aNumero(d)));

// ---------------------------------------------------------------- empezar

function NuevoConteo() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const ubicaciones = ubicacionesOrdenadas(estado);
  const renglones = useMemo(() => {
    const cuenta = new Map();
    for (const e of estado.existencias) if (e.activo !== false) cuenta.set(e.ubicacion_id, (cuenta.get(e.ubicacion_id) ?? 0) + 1);
    return cuenta;
  }, [estado.existencias]);
  const [todo, setTodo] = useState(true);
  const [elegidas, setElegidas] = useState([]);
  const [fecha, setFecha] = useState(hoyIso());
  const alcance = todo ? ubicaciones.map((u) => u.id) : elegidas;
  const alternar = (id) => setElegidas(elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]);
  const empezar = () =>
    sesion.tarea("Preparando conteo…", async () => {
      await sesion.almacen.modificar((e) => iniciarConteo(e, { ubicaciones: alcance, usuario: sesion.usuario, fecha }));
      sesion.avisar("exito", "Conteo iniciado: captura lo contado. Nada cambia en el inventario hasta aplicarlo.");
    });
  return html`<${Tarjeta} titulo="Nuevo conteo físico">
    <p class="nota">
      Cuenta todo el inventario o solo algunos contenedores. Al aplicarlo, en cada partida contada la CANTIDAD pasa a ser lo contado y
      CONSUMO / INGRESO vuelven a empezar; los que no cuentes conservan su conteo anterior.
    </p>
    <div class="opciones-radio">
      <label>
        <input type="radio" name="alcance" checked=${todo} onChange=${() => setTodo(true)} />
        <span><strong>Todo el inventario</strong> (${ubicaciones.length} contenedores)</span>
      </label>
      <label>
        <input type="radio" name="alcance" checked=${!todo} onChange=${() => setTodo(false)} />
        <span><strong>Solo algunos contenedores</strong> (conteo parcial)</span>
      </label>
    </div>
    ${!todo
      ? html`<div class="casillas-contenedores">
          ${ubicaciones.map(
            (u) => html`<label class="casilla">
              <input type="checkbox" checked=${elegidas.includes(u.id)} onChange=${() => alternar(u.id)} />
              <span>${u.hoja_excel.trim()} <small class="nota">${renglones.get(u.id) ?? 0} partidas</small></span>
            </label>`,
          )}
        </div>`
      : null}
    <div class="acciones-linea">
      <label class="filtro"><span>Fecha del conteo</span><input type="date" value=${fecha} onChange=${(e) => setFecha(e.currentTarget.value)} /></label>
      <span class="espaciador"></span>
      <${Boton} disabled=${!alcance.length} onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirHojaConteo(alcance, fecha))}>🖨 Imprimir hoja de conteo<//>
      <${Boton} tipo="primario" disabled=${!alcance.length} onClick=${empezar}>Empezar a capturar<//>
    </div>
    <p class="nota">
      La hoja de conteo sale sin cantidades para contar "a ciegas". Empieza la captura cuando empiecen a contar: los vales que se emitan
      después se tratarán como posteriores al conteo.
    </p>
  <//>`;
}

// ---------------------------------------------------------------- renglones encontrados

function Sobrante({ s, n, ubicaciones, articulos, estado, alCambiar, alQuitar, errores }) {
  const variantes = useMemo(() => variantesDeCodigo(estado, s.codigo), [estado.variantes, s.codigo]);
  const conocido = Number.isInteger(s.codigo) && Boolean(estado.articulos[s.codigo]);
  const errorEn = (campo) => errores.find((e) => e.id === s.uid && e.campo === campo);
  const nueva = !Number.isInteger(s.variante_id);
  return html`<tr>
    <td class="numero">${n}</td>
    <td>
      <${Lista}
        valor=${s.ubicacion_id ?? ""}
        alCambiar=${(v) => alCambiar({ ubicacion_id: Number(v) })}
        ariaLabel="Contenedor"
        placeholder="— Contenedor —"
        clase=${errorEn("ubicacion") ? "con-error" : ""}
        opciones=${ubicaciones.map((u) => ({ valor: u.id, etiqueta: lugarCorto(u), detalle: u.hoja_excel.trim() }))}
      />
    </td>
    <td>
      <${CeldaCodigo}
        linea=${s}
        articulos=${articulos}
        error=${errorEn("codigo")}
        alElegir=${(codigo) => alCambiar({ codigo, descripcion: estado.articulos[codigo]?.descripcion ?? "", variante_id: null })}
        alNuevo=${(codigo) => alCambiar({ codigo, descripcion: "", variante_id: null })}
      />
    </td>
    <td>
      ${Number.isInteger(s.codigo) && !conocido
        ? html`<input value=${s.descripcion} placeholder="Descripción (código nuevo)" onInput=${(e) => alCambiar({ descripcion: e.currentTarget.value })} />`
        : html`<span class="descripcion">${s.descripcion || html`<span class="nota">—</span>`}</span>`}
    </td>
    <td>
      ${Number.isInteger(s.codigo)
        ? html`<div class="celda-clave">
            ${variantes.length
              ? html`<${Lista}
                  valor=${s.variante_id ?? ""}
                  alCambiar=${(v) => {
                    const variante = variantes.find((x) => x.id === Number(v));
                    alCambiar(variante ? { variante_id: variante.id, dimension: variante.dimension, np: variante.np, um: variante.um } : { variante_id: null, dimension: "", np: "" });
                  }}
                  ariaLabel="Variante"
                  opciones=${[
                    ...variantes.map((v) => ({ valor: v.id, etiqueta: [v.dimension, v.np ? `NP ${v.np}` : ""].filter(Boolean).join(" · ") || "S/D", detalle: v.lugares.join(", ") || "sin partida" })),
                    { valor: "", etiqueta: "＋ Otra dimensión (variante nueva)" },
                  ]}
                />`
              : null}
            ${nueva
              ? html`<div class="rejilla-campos">
                  <input value=${s.dimension} placeholder="Dimensión" aria-label="Dimensión" onInput=${(e) => alCambiar({ dimension: e.currentTarget.value })} />
                  <input value=${s.np} placeholder="NP" aria-label="NP" onInput=${(e) => alCambiar({ np: e.currentTarget.value })} />
                </div>`
              : null}
          </div>`
        : html`<span class="nota">Primero el código</span>`}
    </td>
    <td><input class=${`entrada-um ${errorEn("um") ? "con-error" : ""}`} value=${s.um} disabled=${!nueva} onInput=${(e) => alCambiar({ um: e.currentTarget.value })} aria-label="UM" /></td>
    <td><input class=${`entrada-cantidad ${errorEn("cantidad") ? "con-error" : ""}`} inputmode="decimal" value=${s.cantidad} onInput=${(e) => alCambiar({ cantidad: e.currentTarget.value.replace(",", ".") })} aria-label="Cantidad contada" /></td>
    <td><button type="button" class="boton-quitar" onClick=${alQuitar}><span aria-hidden="true">✕</span> Quitar</button></td>
  </tr>`;
}

// ---------------------------------------------------------------- captura

function Captura() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const guardado = estado.conteo_en_curso;
  const [datos, setDatos] = useState(() => structuredClone(guardado));
  const [errores, setErrores] = useState([]);
  const [texto, setTexto] = useState("");
  const [hoja, setHoja] = useState("");
  const [vista, setVista] = useState("todos");
  const [aCiegas, setACiegas] = useState(false);
  const [corteAlAplicar, setCorteAlAplicar] = useState(false);
  const pendiente = useRef(null);
  const porGuardar = useRef(null);
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const articulos = useMemo(() => indiceArticulos(estado, indices), [estado.articulos, estado.existencias]);
  const filas = useMemo(() => renglonesDelConteo(estado, datos, { indices, saldos }), [estado, datos, indices, saldos]);
  const resumen = useMemo(() => resumenConteo(estado, datos), [estado, datos]);
  const durante = useMemo(() => valesDuranteConteo(estado, datos), [estado.vales, datos]);
  const ubicaciones = datos.ubicaciones.map((id) => indices.ubicacion(id)).filter(Boolean);

  const guardar = async (valor) => {
    clearTimeout(pendiente.current);
    pendiente.current = null;
    porGuardar.current = null;
    await sesion.almacen.modificar((e) => guardarConteoEnCurso(e, valor));
  };
  const cambiar = (cambios) => {
    const valor = { ...datos, ...cambios };
    setDatos(valor);
    if (errores.length) setErrores(validarConteo(estado, valor));
    clearTimeout(pendiente.current);
    porGuardar.current = valor;
    pendiente.current = setTimeout(() => guardar(valor).catch((e) => sesion.avisar("error", e.message)), 600);
  };
  useEffect(
    () => () => {
      if (pendiente.current && porGuardar.current) guardar(porGuardar.current).catch((e) => sesion.avisar("error", e.message));
    },
    [],
  );
  const capturar = (id, valor) => cambiar({ capturas: { ...datos.capturas, [id]: valor.replace(",", ".") } });
  const cambiarSobrante = (uid, cambio) => cambiar({ nuevos: datos.nuevos.map((s) => (s.uid === uid ? { ...s, ...cambio } : s)) });

  const porTexto = useFiltroTexto(filas, texto, ["codigo", "descripcion", "dimension", "np", "hoja"]);
  const visibles = porTexto.filter((f) => {
    if (hoja && f.ubicacion_id !== Number(hoja)) return false;
    if (vista === "faltan") return f.contado === null;
    if (vista === "diferencia") return f.contado !== null && !f.diferencia.eq(0);
    return true;
  });
  const siguiente = (id) => {
    const i = visibles.findIndex((f) => f.id === id);
    const otra = visibles[i + 1];
    if (otra) document.getElementById(`cnt-${otra.id}`)?.focus();
  };

  const aplicar = () =>
    sesion.tarea("Aplicando conteo…", async () => {
      if (pendiente.current) await guardar(datos);
      const faltan = validarConteo(sesion.estado, datos);
      setErrores(faltan);
      if (faltan.length) return;
      const r = resumenConteo(sesion.estado, datos);
      const aviso = r.faltan ? `\n${r.faltan} partidas sin capturar conservan su conteo anterior.` : "";
      if (!confirmar(`¿Aplicar el conteo? ${r.contados} partidas toman lo contado (${r.con_diferencia} con diferencia)${r.sobrantes ? ` y se agregan ${r.sobrantes} encontrados` : ""}.${aviso}`)) return;
      try {
        const conteo = await sesion.almacen.modificar((e) => aplicarConteo(e, { usuario: sesion.usuario, corteAlAplicar }));
        sesion.avisar("exito", `Conteo aplicado: ${conteo.lineas.length} partidas actualizadas.`);
      } catch (error) {
        if (error instanceof ErrorConteo) setErrores(error.errores);
        else throw error;
      }
    });
  const descartar = () => {
    if (resumen.contados && !confirmar(`¿Descartar el conteo? Se pierde lo capturado (${resumen.contados} partidas). El inventario no cambia.`)) return;
    return sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      await sesion.almacen.modificar((e) => descartarConteo(e, sesion.usuario));
    });
  };
  const errorDe = (id) => errores.find((e) => e.id === id);

  return html`
    <${Tarjeta}
      titulo=${datos.total ? "Conteo total en captura" : "Conteo parcial en captura"}
      acciones=${html`<${Boton} onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirHojaConteo(datos.ubicaciones, datos.fecha))}>🖨 Hoja de conteo<//>
        <${Boton} tipo="peligro-texto" onClick=${descartar}>Descartar conteo<//>`}
    >
      <div class="acciones-linea">
        <label class="filtro"><span>Fecha del conteo</span><input type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} /></label>
        <span class="nota">
          ${`Iniciado ${fmtFechaHora(datos.iniciado_en)}${datos.iniciado_por ? ` por ${datos.iniciado_por}` : ""}. Lo contado ya refleja los vales de salida hasta el folio ${datos.corte.salida} y las entradas hasta ${datos.corte.entrada ? folioEntrada(datos.corte.entrada) : "—"}.`}
        </span>
      </div>
      <div class="pastillas pastillas-resumen">
        ${!datos.total ? ubicaciones.map((u) => html`<${Pastilla} tono="lugar" titulo=${u.hoja_excel.trim()}>${lugarCorto(u)}<//>`) : null}
        <${Pastilla} tono="info">${resumen.contados} de ${resumen.renglones} contados<//>
        <${Pastilla} tono=${resumen.con_diferencia ? "alerta" : "ok"}>${resumen.con_diferencia} con diferencia<//>
        ${resumen.sobrantes ? html`<${Pastilla} tono="info">${resumen.sobrantes} encontrados<//>` : null}
      </div>
    <//>

    <${CapturaIA}
      tipo="conteo"
      alCargar=${(respuesta) => {
        const { datos: nuevo, reporte } = aplicarConteoIA(sesion.estado, datos, respuesta, { indices });
        cambiar({ fecha: nuevo.fecha, capturas: nuevo.capturas, nuevos: nuevo.nuevos });
        return [
          `✓ ${reporte.capturados} partidas con lo contado${reporte.sobrantes ? ` y ${reporte.sobrantes} encontrados (abajo, en "Encontrado y no está en la lista")` : ""}.`,
          ...reporte.dudosos.map((d) => `⚠ Dudoso según el asistente: ${d}`),
          ...reporte.fueraDeAlcance.map((d) => `⚠ ${d}`),
          ...reporte.noReconocidos.map((d) => `⚠ ${d}`),
        ];
      }}
    />

    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Código, descripción, dimensión, NP…" />
      ${ubicaciones.length > 1
        ? html`<${Lista}
            clase="lista-filtro"
            valor=${hoja}
            alCambiar=${setHoja}
            ariaLabel="Contenedor"
            opciones=${[{ valor: "", etiqueta: "Todos los contenedores del conteo" }, ...ubicaciones.map((u) => ({ valor: String(u.id), etiqueta: u.hoja_excel.trim() }))]}
          />`
        : null}
      <${Lista}
        clase="lista-filtro"
        valor=${vista}
        alCambiar=${setVista}
        ariaLabel="Vista"
        opciones=${[
          { valor: "todos", etiqueta: "Todas las partidas" },
          { valor: "faltan", etiqueta: "Sin capturar" },
          { valor: "diferencia", etiqueta: "Con diferencia" },
        ]}
      />
      <label class="casilla"><input type="checkbox" checked=${aCiegas} onChange=${(e) => setACiegas(e.currentTarget.checked)} /> <span>Ocultar lo que dice el sistema</span></label>
      <span class="conteo">${num(visibles.length)} de ${num(filas.length)}</span>
    </div>

    <div class="tabla-contenedor tabla-conteo">
      <table class="tabla">
        <thead>
          <tr>
            <th>Cont.</th>
            <th class="numero">Código</th>
            <th>Descripción</th>
            <th>Dimensión</th>
            <th>NP</th>
            <th>UM</th>
            ${aCiegas ? null : html`<th class="numero">Sistema</th>`}
            <th class="numero">Contado</th>
            ${aCiegas ? null : html`<th class="numero">Diferencia</th>`}
          </tr>
        </thead>
        <tbody>
          ${visibles.slice(0, 600).map(
            (f) => html`<tr key=${f.id} class=${errorDe(f.id) ? "fila-error" : f.contado !== null && !aCiegas && !f.diferencia.eq(0) ? "fila-diferencia" : ""}>
              <td><span class="sin-corte" title=${f.hoja}>${f.lugar}</span></td>
              <td class="numero">${f.codigo}</td>
              <td>${f.descripcion}</td>
              <td>${f.dimension}</td>
              <td>${f.np}</td>
              <td>${f.um}</td>
              ${aCiegas ? null : html`<td class="numero">${num(aNumero(f.teorico))}</td>`}
              <td class="numero">
                <input
                  id=${`cnt-${f.id}`}
                  class=${`entrada-cantidad ${errorDe(f.id) ? "con-error" : ""}`}
                  inputmode="decimal"
                  value=${f.capturado}
                  placeholder="—"
                  onInput=${(e) => capturar(f.id, e.currentTarget.value)}
                  onKeyDown=${(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      siguiente(f.id);
                    }
                  }}
                  aria-label=${`Contado de ${f.codigo} ${f.dimension}`}
                />
              </td>
              ${aCiegas ? null : html`<td class="numero"><strong class=${f.diferencia && !f.diferencia.eq(0) ? "alerta" : ""}>${signo(f.diferencia)}</strong></td>`}
            </tr>`,
          )}
        </tbody>
      </table>
      ${visibles.length > 600 ? html`<p class="nota">Se muestran 600 de ${visibles.length}: filtra por contenedor o busca para ver los demás.</p>` : null}
    </div>

    <${Tarjeta} titulo="Encontrado y no está en la lista">
      <p class="nota">Material que apareció en el contenedor y no tiene partida. Se agrega al final de la hoja de ese contenedor con lo contado.</p>
      ${datos.nuevos.length
        ? html`<div class="tabla-contenedor tabla-partidas">
            <table class="tabla">
              <thead class="cabecera-vale">
                <tr><th class="numero">#</th><th>Contenedor</th><th>Código</th><th>Descripción</th><th>Dimensión / variante</th><th>U.M.</th><th class="numero">Contado</th><th></th></tr>
              </thead>
              <tbody>
                ${datos.nuevos.map(
                  (s, i) => html`<${Sobrante}
                    key=${s.uid}
                    s=${s}
                    n=${i + 1}
                    ubicaciones=${ubicaciones}
                    articulos=${articulos}
                    estado=${estado}
                    errores=${errores}
                    alCambiar=${(cambio) => cambiarSobrante(s.uid, cambio)}
                    alQuitar=${() => cambiar({ nuevos: datos.nuevos.filter((x) => x.uid !== s.uid) })}
                  />`,
                )}
              </tbody>
            </table>
          </div>`
        : null}
      <${Boton} onClick=${() => cambiar({ nuevos: [...datos.nuevos, nuevoSobrante(ubicaciones.length === 1 ? ubicaciones[0].id : null)] })}>＋ Agregar partida encontrada<//>
    <//>

    ${durante.length
      ? html`<${Aviso} tipo="advertencia" titulo="Se emitieron vales mientras se contaba">
          <p>
            ${durante.map((d) => `${d.tipo === "ENTRADA" ? folioEntrada(d.folio) : `Folio ${d.folio}`} (${d.renglones} ${d.renglones === 1 ? "partida contada" : "partidas contadas"})`).join(" · ")}.
            ¿El material ya había salido o entrado cuando se contó?
          </p>
          <div class="opciones-radio">
            <label><input type="radio" name="corte" checked=${!corteAlAplicar} onChange=${() => setCorteAlAplicar(false)} /> <span><strong>No:</strong> se contó antes; esos vales se descuentan / suman a lo contado.</span></label>
            <label><input type="radio" name="corte" checked=${corteAlAplicar} onChange=${() => setCorteAlAplicar(true)} /> <span><strong>Sí:</strong> lo contado ya los refleja; no se vuelven a contar.</span></label>
          </div>
        <//>`
      : null}

    <${ListaErrores} errores=${errores} />
    <div class="acciones-linea pie-editor">
      <span class="nota">${resumen.faltan ? `${resumen.faltan} partidas sin capturar conservarán su conteo anterior.` : "Todas las partidas están capturadas."}</span>
      <span class="espaciador"></span>
      <${Boton} tipo="primario" tamano="grande" disabled=${!resumen.contados && !resumen.sobrantes} onClick=${aplicar}>Aplicar conteo<//>
    </div>
  `;
}

// ---------------------------------------------------------------- historial

function HistorialConteos() {
  const sesion = useSesion();
  const conteos = useMemo(() => historialConteos(sesion.estado), [sesion.estado.conteos, sesion.estado.existencias]);
  if (!conteos.length) return null;
  return html`<${Tarjeta} titulo="Conteos anteriores">
    ${conteos.map(
      (c) => html`<${Detalles}
        key=${c.id}
        resumen=${html`<strong>${fmtFecha(c.fecha)}</strong> · ${c.descripcion}
          ${c.inicial ? null : html` · ${c.renglones} partidas · <span class=${c.diferencias.length ? "alerta" : "ok"}>${c.diferencias.length} con diferencia</span>`}
          <span class="nota"> · vigente en ${c.vigentes} renglones${c.usuario ? ` · ${c.usuario}` : ""}</span>`}
      >
        <p class="nota">
          Corte: vales de salida hasta el folio ${c.corte_salida} y entradas hasta ${c.corte_entrada ? folioEntrada(c.corte_entrada) : "—"} ya estaban reflejados en lo contado.
        </p>
        ${c.inicial
          ? html`<p class="nota">Es el conteo de la primera carga (el inventario importado de tu Excel).</p>`
          : html`<${Tabla}
              filas=${c.diferencias}
              claveFila=${(d) => d.existencia_id}
              vacia="Todo coincidió con el sistema."
              columnas=${[
                { clave: "lugar", titulo: "Cont." },
                { clave: "codigo", titulo: "Código", numero: true },
                { clave: "descripcion", titulo: "Descripción" },
                { titulo: "Clave", render: (d) => html`${d.clave}${d.nuevo ? html` <${Pastilla} tono="info">encontrado<//>` : null}` },
                { titulo: "Sistema", numero: true, render: (d) => num(aNumero(d.teorico)) },
                { titulo: "Contado", numero: true, render: (d) => num(aNumero(d.contado)) },
                { titulo: "Diferencia", numero: true, render: (d) => html`<strong class="alerta">${signo(d.diferencia)}</strong> ${d.um}` },
              ]}
            />`}
      <//>`,
    )}
  <//>`;
}

export function PaginaConteo() {
  const sesion = useSesion();
  const enCurso = sesion.estado.conteo_en_curso;
  return html`
    ${enCurso ? html`<${Captura} key=${enCurso.id} />` : html`<${NuevoConteo} />`}
    <${HistorialConteos} />
  `;
}

