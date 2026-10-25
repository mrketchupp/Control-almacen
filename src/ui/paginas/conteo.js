import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { aNumero } from "../../nucleo/decimal.js";
import { Indices } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { fmtFecha, fmtFechaHora, hoyIso } from "../../nucleo/fechas.js";
import {
  ErrorConteo,
  aplicarConteo,
  correccionesDelConteo,
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
import { Aviso, Boton, Buscador, Detalles, Lista, Pastilla, Tabla, Tarjeta, Ventana, confirmar, num, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";
import { aplicarConteoIA } from "../../servicios/capturaIA.js";
import { CapturaIA } from "./capturaIA.js";
import { BotonDescripcion } from "./descripcion.js";
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

function Sobrante({ s, n, ubicaciones, articulos, estado, alCambiar, alDescripcion, alQuitar, errores }) {
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
        : html`<div class="descripcion-codigo">
            <span class="descripcion">${s.descripcion || html`<span class="nota">—</span>`}</span>
            ${conocido ? html`<${BotonDescripcion} codigo=${s.codigo} alCambiar=${(descripcion) => alDescripcion(s.codigo, descripcion)} />` : null}
          </div>`}
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
  const [editando, setEditando] = useState(null);
  const [revisando, setRevisando] = useState(false);
  const pendiente = useRef(null);
  const porGuardar = useRef(null);
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const articulos = useMemo(() => indiceArticulos(estado, indices), [estado.articulos, estado.existencias]);
  const filas = useMemo(() => renglonesDelConteo(estado, datos, { indices, saldos }), [estado, datos, indices, saldos]);
  const resumen = useMemo(() => resumenConteo(estado, datos), [estado, datos]);
  const durante = useMemo(() => valesDuranteConteo(estado, datos), [estado.vales, datos]);
  const correcciones = useMemo(() => correccionesDelConteo(estado, datos), [estado, datos]);
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
  // Tras corregir la descripción de un código en el catálogo, sus partidas encontradas la toman también.
  const conDescripcion = (codigo, descripcion) => cambiar({ nuevos: datos.nuevos.map((s) => (s.codigo === codigo ? { ...s, descripcion } : s)) });
  const corregir = (fila, cambios) => {
    const correccion = { existencia_id: fila.id, dimension: fila.dimension, np: fila.np, ...fila.correccion, ...cambios };
    const tieneCambio = correccion.quitar || String(correccion.dimension ?? "").trim() !== String(fila.dimension ?? "").trim() || String(correccion.np ?? "").trim() !== String(fila.np ?? "").trim();
    cambiar({ correcciones: [...(datos.correcciones ?? []).filter((c) => c.existencia_id !== fila.id), ...(tieneCambio ? [correccion] : [])] });
  };
  const cancelarCorreccion = (id) => cambiar({ correcciones: (datos.correcciones ?? []).filter((c) => c.existencia_id !== id) });
  const editar = (fila) => setEditando({ fila, dimension: fila.dimension_nueva, np: fila.np_nuevo, motivo: fila.correccion?.motivo ?? "" });

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

  const revisar = () =>
    sesion.tarea("Revisando conteo…", async () => {
      if (pendiente.current) await guardar(datos);
      const faltan = validarConteo(sesion.estado, datos);
      setErrores(faltan);
      if (!faltan.length) setRevisando(true);
    });
  const aplicar = () =>
    sesion.tarea("Aplicando conteo…", async () => {
      if (pendiente.current) await guardar(datos);
      const faltan = validarConteo(sesion.estado, datos);
      setErrores(faltan);
      if (faltan.length) return;
      try {
        const conteo = await sesion.almacen.modificar((e) => aplicarConteo(e, { usuario: sesion.usuario, corteAlAplicar }));
        sesion.avisar("exito", `Conteo aplicado: ${conteo.lineas.length} partidas contadas${conteo.correcciones.length ? ` y ${conteo.correcciones.length} correcciones` : ""}.`);
      } catch (error) {
        if (error instanceof ErrorConteo) { setErrores(error.errores); setRevisando(false); }
        else throw error;
      }
    });
  const descartar = () => {
    if ((resumen.contados || resumen.sobrantes || correcciones.length) && !confirmar(`¿Descartar el conteo y sus correcciones? El inventario no cambia.`)) return;
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
        ${resumen.corregidas ? html`<${Pastilla} tono="info">${resumen.corregidas} claves por corregir<//>` : null}
        ${resumen.retiradas ? html`<${Pastilla} tono="alerta">${resumen.retiradas} partidas por quitar<//>` : null}
      </div>
    <//>

    <${CapturaIA}
      tipo="conteo"
      alCargar=${(respuesta) => {
        const { datos: nuevo, reporte } = aplicarConteoIA(sesion.estado, datos, respuesta, { indices });
        cambiar({ fecha: nuevo.fecha, capturas: nuevo.capturas, nuevos: nuevo.nuevos });
        return [
          `✓ ${reporte.capturados} partidas con lo contado${reporte.sobrantes ? ` y ${reporte.sobrantes} encontrados (abajo, en "Añadir partidas al conteo")` : ""}.`,
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
            <th>Corregir partida</th>
          </tr>
        </thead>
        <tbody>
          ${visibles.slice(0, 600).map(
            (f) => html`<tr key=${f.id} class=${f.quitar ? "conteo-por-quitar" : errorDe(f.id) ? "fila-error" : f.contado !== null && !aCiegas && !f.diferencia.eq(0) ? "fila-diferencia" : ""}>
              <td><span class="sin-corte" title=${f.hoja}>${f.lugar}</span></td>
              <td class="numero">${f.codigo}</td>
              <td>${f.descripcion}</td>
              <td>${f.dimension}${f.dimension_nueva !== f.dimension && !f.quitar ? html`<div class="conteo-clave-nueva">→ ${f.dimension_nueva || "Sin dimensión"}</div>` : null}</td>
              <td>${f.np}${f.np_nuevo !== f.np && !f.quitar ? html`<div class="conteo-clave-nueva">→ ${f.np_nuevo || "Sin NP"}</div>` : null}</td>
              <td>${f.um}</td>
              ${aCiegas ? null : html`<td class="numero">${num(aNumero(f.teorico))}</td>`}
              <td class="numero">
                <input
                  id=${`cnt-${f.id}`}
                  class=${`entrada-cantidad ${errorDe(f.id) ? "con-error" : ""}`}
                  inputmode="decimal"
                  value=${f.capturado}
                  disabled=${f.quitar || sesion.ocupado}
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
              <td><div class="acciones-linea">
                ${f.correccion ? html`<${Pastilla} tono=${f.quitar ? "alerta" : "info"}>${f.quitar ? "Se quitará" : "Clave pendiente"}<//>
                  <${Boton} tamano="chico" tipo="texto" onClick=${() => cancelarCorreccion(f.id)}>Deshacer corrección<//>` : null}
                ${!f.quitar ? html`<${Boton} tamano="chico" tipo="texto" onClick=${() => editar(f)}>Corregir dimensión / NP<//>
                  <${Boton} tamano="chico" tipo="peligro-texto" onClick=${() => corregir(f, { quitar: true })}>Quitar partida<//>` : null}
              </div></td>
            </tr>`,
          )}
        </tbody>
      </table>
      ${visibles.length > 600 ? html`<p class="nota">Se muestran 600 de ${visibles.length}: filtra por contenedor o busca para ver los demás.</p>` : null}
    </div>

    <${Tarjeta} titulo="Añadir partidas al conteo">
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
                    alDescripcion=${conDescripcion}
                    alQuitar=${() => cambiar({ nuevos: datos.nuevos.filter((x) => x.uid !== s.uid) })}
                  />`,
                )}
              </tbody>
            </table>
          </div>`
        : null}
      <${Boton} onClick=${() => cambiar({ nuevos: [...datos.nuevos, nuevoSobrante(ubicaciones.length === 1 ? ubicaciones[0].id : null)] })}>＋ Añadir partida<//>
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
      <${Boton} tipo="primario" tamano="grande" disabled=${!resumen.contados && !resumen.sobrantes && !correcciones.length} onClick=${revisar}>Revisar y aplicar conteo<//>
    </div>
    ${editando ? html`<${Ventana} titulo="Corregir partida del conteo" alCerrar=${() => setEditando(null)}>
      <p><strong>${editando.fila.codigo} ${editando.fila.descripcion}</strong> · ${editando.fila.lugar}</p>
      <div class="rejilla-campos">
        <label class="campo"><span>Dimensión</span><input aria-label="Dimensión corregida" value=${editando.dimension} onInput=${(e) => setEditando({ ...editando, dimension: e.currentTarget.value })} /></label>
        <label class="campo"><span>NP (opcional)</span><input aria-label="NP corregido" value=${editando.np} onInput=${(e) => setEditando({ ...editando, np: e.currentTarget.value })} /></label>
        <label class="campo"><span>Motivo (opcional)</span><input value=${editando.motivo} onInput=${(e) => setEditando({ ...editando, motivo: e.currentTarget.value })} placeholder="Ej. dimensión escrita incorrectamente" /></label>
      </div>
      <p class="nota">Se guardará con el conteo. La cantidad sólo cambia si capturas lo contado; los vales anteriores conservan sus datos.</p>
      <div class="acciones-linea"><${Boton} tipo="primario" onClick=${() => { corregir(editando.fila, { dimension: editando.dimension, np: editando.np, motivo: editando.motivo, quitar: false }); setEditando(null); }}>Guardar en el conteo<//>
        <${Boton} tipo="texto" onClick=${() => setEditando(null)}>Cancelar<//></div>
    <//>` : null}
    ${revisando ? html`<${Ventana} titulo="Revisar conteo físico" clase="ventana-concilia" alCerrar=${() => setRevisando(false)}>
      <p><strong>${resumen.contados}</strong> partidas contadas · <strong>${resumen.sobrantes}</strong> por añadir · <strong>${resumen.corregidas}</strong> claves por corregir · <strong>${resumen.retiradas}</strong> por quitar.</p>
      ${filas.some((f) => f.contado !== null) ? html`<${Tabla} filas=${filas.filter((f) => f.contado !== null)} columnas=${[
        { clave: "lugar", titulo: "Cont." }, { clave: "codigo", titulo: "Código" },
        { titulo: "Partida", render: (f) => `${f.dimension} ${f.np ? `· NP ${f.np}` : ""}` },
        { titulo: "Sistema", render: (f) => num(aNumero(f.teorico)), numero: true },
        { titulo: "Contado", render: (f) => `${num(aNumero(f.contado))} ${f.um}`, numero: true },
      ]} />` : null}
      ${correcciones.length ? html`<${Tabla} filas=${correcciones} claveFila=${(c) => c.existencia_id} columnas=${[
        { clave: "codigo", titulo: "Código" },
        { titulo: "Ahora", render: (c) => `${c.dimension_antes || "Sin dimensión"} · NP ${c.np_antes || "—"}` },
        { titulo: "Quedará", render: (c) => c.quitar ? "Fuera del inventario activo, con cantidad 0" : `${c.dimension || "Sin dimensión"} · NP ${c.np || "—"}` },
        { clave: "motivo", titulo: "Motivo" },
      ]} />` : null}
      ${resumen.sobrantes ? html`<${Tabla} filas=${datos.nuevos.filter((s) => Number.isInteger(s.codigo))} claveFila=${(s) => s.uid} columnas=${[
        { clave: "codigo", titulo: "Código por añadir" }, { clave: "dimension", titulo: "Dimensión" }, { clave: "np", titulo: "NP" },
        { titulo: "Contado", render: (s) => `${s.cantidad} ${s.um}` },
      ]} />` : null}
      <p class="nota">${resumen.faltan} partidas sin cantidad capturada conservarán su conteo anterior. Quitar conserva los vales y el historial de la partida.</p>
      <p class="nota">Corte de salidas: ${corteAlAplicar ? "último folio emitido al aplicar" : datos.corte.salida}. ${durante.length && !corteAlAplicar ? "Los vales emitidos durante el conteo se descontarán o sumarán después." : ""}</p>
      <div class="acciones-linea"><${Boton} tipo="primario" disabled=${sesion.ocupado} onClick=${aplicar}>Confirmar conteo<//><${Boton} tipo="texto" onClick=${() => setRevisando(false)}>Seguir capturando<//></div>
    <//>` : null}
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
          ${c.inicial ? null : html` · ${c.renglones} partidas${c.correcciones.length ? ` · ${c.correcciones.length} correcciones` : ""} · <span class=${c.diferencias.length ? "alerta" : "ok"}>${c.diferencias.length} con diferencia</span>`}
          <span class="nota"> · vigente en ${c.vigentes} partidas${c.usuario ? ` · ${c.usuario}` : ""}</span>`}
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
        ${c.correcciones.length ? html`<${Tabla} filas=${c.correcciones} claveFila=${(d) => d.existencia_id} columnas=${[
          { clave: "codigo", titulo: "Código corregido" },
          { titulo: "Antes", render: (d) => `${d.dimension_antes || "Sin dimensión"} · NP ${d.np_antes || "—"}` },
          { titulo: "Corrección", render: (d) => d.quitar ? "Partida retirada del inventario activo" : `${d.dimension || "Sin dimensión"} · NP ${d.np || "—"}` },
          { clave: "motivo", titulo: "Motivo" },
        ]} />` : null}
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

