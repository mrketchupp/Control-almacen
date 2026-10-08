import { useEffect, useMemo, useState } from "preact/hooks";
import { TIPOS_AREA, etiquetasFirmasExtra, tipoDeArea } from "../../nucleo/areas.js";
import { areaVacia, borrarArea, descartarArea, guardarArea, guardarPersona, reponerArea, usosDeArea } from "../../servicios/catalogos.js";
import { aliasDe, marcarDistintas, personasRepetidas, unificarPersonas, usosPorNombre } from "../../servicios/personas.js";
import { Aviso, Boton, Buscador, CampoSugerido, Detalles, Lista, Pastilla, Tabla, Tarjeta, Ventana, confirmar, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

function EditorArea({ area, hojas, alTerminar }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState({ ...areaVacia(), ...area, tipo: tipoDeArea({ ...areaVacia(), ...area }) });
  const fijo = datos.tipo !== "TRANSFERENCIA";
  const [error, setError] = useState(null);
  const estado = sesion.estado;
  const unicos = (valores) => [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const sugerencias = {
    personas: unicos(estado.personas.filter((p) => p.activo !== false).map((p) => p.nombre)),
    puestos: unicos(estado.personas.map((p) => p.puesto)),
    deptos: unicos(estado.plantillas_area.flatMap((p) => [p.depto_destino, p.depto_origen])),
    lugares: unicos(estado.plantillas_area.flatMap((p) => [p.destino, p.origen])),
  };
  const poner = (clave) => (valor) => setDatos({ ...datos, [clave]: valor });
  const campo = (clave, etiqueta, opciones = {}) => html`<div class=${`campo ${opciones.ancho ? `campo-${opciones.ancho}` : ""}`}>
    <span>${etiqueta}</span>
    ${opciones.area
      ? html`<textarea rows="3" value=${datos[clave] ?? ""} onInput=${(e) => setDatos({ ...datos, [clave]: e.currentTarget.value })} aria-label=${etiqueta}></textarea>`
      : opciones.sugerencias
        ? html`<${CampoSugerido} valor=${datos[clave] ?? ""} alCambiar=${poner(clave)} sugerencias=${opciones.sugerencias} ariaLabel=${etiqueta} />`
        : html`<input value=${datos[clave] ?? ""} onInput=${(e) => setDatos({ ...datos, [clave]: e.currentTarget.value })} aria-label=${etiqueta} />`}
  </div>`;
  const extra = datos.firmas_extra;
  const etiquetas = etiquetasFirmasExtra(datos);
  const ponerExtra = (lado, parte) => (valor) =>
    setDatos({ ...datos, firmas_extra: { ...extra, [lado]: { ...extra[lado], [parte]: valor } } });
  const guardar = () =>
    sesion.tarea("Guardando área…", async () => {
      try {
        await sesion.almacen.modificar((e) => guardarArea(e, datos, sesion.usuario));
        sesion.avisar("exito", `Área ${datos.nombre.toUpperCase()} guardada.`);
        alTerminar();
      } catch (e) {
        setError(e.message);
      }
    });
  return html`<${Tarjeta} titulo=${datos.id ? `Editar área ${area.nombre}` : "Nueva área"} clase="tarjeta-correccion">
    <p class="nota">Estos datos se copian al vale al elegir el área.</p>
    <div class="editor-encabezado">
      ${campo("nombre", "Nombre del área")}
      <div class="campo">
        <span>Formato de impresión (hoja del libro de vales)</span>
        <${Lista}
          valor=${datos.hoja_excel ?? ""}
          alCambiar=${(valor) => setDatos({ ...datos, hoja_excel: valor || null })}
          ariaLabel="Formato de impresión"
          opciones=${[{ valor: "", etiqueta: "— Según el departamento —" }, ...hojas.map((h) => ({ valor: h, etiqueta: h.trim() }))]}
        />
      </div>
      <div class="campo">
        <span>Tipo de área</span>
        <${Lista}
          valor=${datos.tipo}
          alCambiar=${poner("tipo")}
          ariaLabel="Tipo de área"
          opciones=${Object.entries(TIPOS_AREA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
        />
      </div>
      ${datos.tipo === "INTERNO"
        ? html`<p class="nota campo-2">Interna: el vale sale de <strong>RIG 91 · ALMACEN</strong> y llega a <strong>RIG 91 · ${datos.depto_destino || "(depto. destino)"}</strong>.</p>`
        : html`${datos.tipo === "EXTERNO" ? null : html`${campo("origen", "Origen", { sugerencias: sugerencias.lugares })}${campo("depto_origen", "Depto. origen", { sugerencias: sugerencias.deptos })}`}
            ${campo("destino", "Destino", { sugerencias: sugerencias.lugares })}`}
      ${campo("depto_destino", "Depto. destino", { sugerencias: sugerencias.deptos })}
      ${campo("recibe_nombre", "Recibe (habitual)", { sugerencias: sugerencias.personas })}
      ${campo("recibe_puesto", "Puesto de quien recibe", { sugerencias: sugerencias.puestos })}
      ${campo("autoriza_nombre", "Autoriza (habitual)", { sugerencias: sugerencias.personas })}
      ${campo("autoriza_puesto", "Puesto de quien autoriza", { sugerencias: sugerencias.puestos })}
      <label class="campo campo-casilla">
        <input type="checkbox" checked=${datos.requiere_autoriza} onChange=${(e) => setDatos({ ...datos, requiere_autoriza: e.currentTarget.checked })} />
        <span>Exigir "Autorizó" en esta área</span>
      </label>
      ${campo("lote_defecto", "Lote por defecto")}
      <label class="campo campo-casilla">
        <input type="checkbox" checked=${datos.activo !== false} onChange=${(e) => setDatos({ ...datos, activo: e.currentTarget.checked })} />
        <span>Activa (aparece al hacer vales)</span>
      </label>
      ${extra
        ? ["izq", "der"].map(
            (lado) => html`<div class="campo">
                <span>${etiquetas[lado]} (nombre habitual)</span>
                <${CampoSugerido} valor=${extra[lado]?.nombre ?? ""} alCambiar=${ponerExtra(lado, "nombre")} sugerencias=${sugerencias.personas} ariaLabel=${etiquetas[lado]} />
              </div>
              <div class="campo">
                <span>Puesto (${etiquetas[lado].toLowerCase()})</span>
                <${CampoSugerido} valor=${extra[lado]?.puesto ?? ""} alCambiar=${ponerExtra(lado, "puesto")} sugerencias=${sugerencias.puestos} ariaLabel=${`Puesto ${etiquetas[lado]}`} />
              </div>`,
          )
        : null}
      ${campo("observaciones", fijo ? "Observaciones que se imprimen (la línea ETAPA DE PERFORACION se llena en cada vale)" : "Observaciones que se imprimen", { area: true, ancho: "todo" })}
    </div>
    ${error ? html`<${Aviso} tipo="error">${error}<//>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" onClick=${guardar}>Guardar área<//>
      <${Boton} onClick=${alTerminar}>Cancelar<//>
    </div>
  <//>`;
}

/** Une personas (la que queda + las demás como alias) con "Deshacer" en el aviso. */
function useUnificar() {
  const sesion = useSesion();
  return (conservar, otras) =>
    sesion.tarea("Unificando…", async () => {
      const e0 = sesion.estado;
      const copia = structuredClone({
        personas: e0.personas,
        alias: e0.alias ?? {},
        plantillas_area: e0.plantillas_area,
        usuario_en_turno: e0.config.usuario_en_turno ?? null,
        preferencias_vale: e0.config.preferencias_vale ?? null,
        personalizacion: e0.config.personalizacion ?? null,
      });
      const queda = await sesion.almacen.modificar((e) => unificarPersonas(e, conservar.id, otras.map((p) => p.id), sesion.usuario).nombre);
      sesion.avisar("exito", `Listo: ${otras.map((p) => p.nombre).join(", ")} ${otras.length === 1 ? "quedó" : "quedaron"} como ${queda}. Los vales no cambiaron.`, 15000, {
        etiqueta: "↶ Deshacer",
        alHacer: () =>
          sesion.almacen.modificar((e) => {
            Object.assign(e, { personas: copia.personas, alias: copia.alias, plantillas_area: copia.plantillas_area });
            for (const clave of ["usuario_en_turno", "preferencias_vale", "personalizacion"]) {
              if (copia[clave] === null) delete e.config[clave];
              else e.config[clave] = copia[clave];
            }
          }),
      });
    });
}

/** Un grupo de nombres que parecen la misma persona: cuál queda, cuáles se unen. */
function GrupoRepetido({ grupo, alUnificar, alDescartar }) {
  const [queda, setQueda] = useState(grupo[0].persona.id);
  const [incluidas, setIncluidas] = useState(() => new Set(grupo.map((x) => x.persona.id)));
  const otras = grupo.filter((x) => x.persona.id !== queda && incluidas.has(x.persona.id)).map((x) => x.persona);
  const conservar = grupo.find((x) => x.persona.id === queda).persona;
  return html`<li class="grupo-repetido">
    <ul class="grupo-nombres">
      ${grupo.map(
        ({ persona, usos }) => html`<li class=${`${persona.id === queda ? "queda" : ""} ${incluidas.has(persona.id) ? "" : "fuera"}`}>
          <label class="grupo-queda" title="Este nombre se queda en la lista">
            <input type="radio" name=${`queda-${grupo[0].persona.id}`} checked=${persona.id === queda} onChange=${() => setQueda(persona.id)} />
            <strong>${persona.nombre}</strong>
          </label>
          <span class="nota">${persona.puesto || "sin puesto"} · ${usos} ${usos === 1 ? "firma" : "firmas"}</span>
          ${persona.es_almacenista ? html`<${Pastilla} tono="info">almacenista<//>` : null}
          ${persona.id === queda
            ? html`<${Pastilla} tono="ok">se queda<//>`
            : html`<label class="grupo-incluir">
                <input
                  type="checkbox"
                  checked=${incluidas.has(persona.id)}
                  onChange=${(e) => {
                    const nuevo = new Set(incluidas);
                    if (e.currentTarget.checked) nuevo.add(persona.id);
                    else nuevo.delete(persona.id);
                    setIncluidas(nuevo);
                  }}
                />
                unir
              </label>`}
        </li>`,
      )}
    </ul>
    <div class="acciones-linea">
      <${Boton} tipo="primario" tamano="chico" disabled=${!otras.length} onClick=${() => alUnificar(conservar, otras)}>Unificar en «${conservar.nombre}»<//>
      <${Boton} tipo="texto" tamano="chico" onClick=${() => alDescartar(grupo.map((x) => x.persona.id))}>No son la misma persona<//>
    </div>
  </li>`;
}

/** Nombres que parecen la misma persona escrita de otra forma (sugerencias para limpiar la lista). */
function Repetidas() {
  const sesion = useSesion();
  const unificar = useUnificar();
  const grupos = useMemo(() => personasRepetidas(sesion.estado), [sesion.estado.personas, sesion.estado.config?.personas_distintas, sesion.estado.vales]);
  const [verTodos, setVerTodos] = useState(false);
  if (!grupos.length) return null;
  const descartar = (ids) => sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => marcarDistintas(e, ids)));
  const visibles = verTodos ? grupos : grupos.slice(0, 5);
  return html`<${Tarjeta} titulo=${`Nombres repetidos (${grupos.length})`} clase="tarjeta-repetidos">
    <p class="nota">
      Parecen la misma persona escrita de otra forma (orden de nombres y apellidos, acentos, iniciales o una letra distinta).
      Elige el nombre que se queda y unifica: los otros quedan como sus alias. <strong>Los vales ya hechos no cambian</strong>;
      solo se limpia la lista y las áreas que usaban esos nombres.
    </p>
    <ol class="grupos-repetidos">
      ${visibles.map((g) => html`<${GrupoRepetido} key=${g.map((x) => x.persona.id).join("-")} grupo=${g} alUnificar=${unificar} alDescartar=${descartar} />`)}
    </ol>
    ${grupos.length > visibles.length ? html`<${Boton} tipo="texto" onClick=${() => setVerTodos(true)}>Ver los ${grupos.length} grupos<//>` : null}
  <//>`;
}

/** Unir a mano las personas marcadas en la tabla: se elige el nombre que queda. */
function VentanaUnir({ personas, alCerrar }) {
  const sesion = useSesion();
  const unificar = useUnificar();
  const usos = useMemo(() => usosPorNombre(sesion.estado), []);
  const [queda, setQueda] = useState(personas[0].id);
  const conservar = personas.find((p) => p.id === queda);
  return html`<${Ventana} titulo="Unificar personas" alCerrar=${alCerrar}>
    <p>¿Qué nombre se queda? Los demás quedan como sus alias. Los vales ya hechos no cambian.</p>
    <div class="opciones-radio">
      ${personas.map(
        (p) => html`<label>
          <input type="radio" name="unir-queda" checked=${p.id === queda} onChange=${() => setQueda(p.id)} />
          <span><strong>${p.nombre}</strong> <span class="nota">${p.puesto || "sin puesto"} · ${usos.get(p.nombre) ?? 0} firmas</span></span>
        </label>`,
      )}
    </div>
    <div class="acciones-linea">
      <${Boton}
        tipo="primario"
        onClick=${async () => {
          await unificar(
            conservar,
            personas.filter((p) => p.id !== queda),
          );
          alCerrar(true);
        }}
      >
        Unificar en «${conservar.nombre}»
      <//>
      <${Boton} tipo="texto" onClick=${() => alCerrar(false)}>Cancelar<//>
    </div>
  <//>`;
}

function Personas() {
  const sesion = useSesion();
  const [texto, setTexto] = useState("");
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [uniendo, setUniendo] = useState(false);
  const personas = [...sesion.estado.personas].sort((a, b) => Number(b.es_almacenista) - Number(a.es_almacenista) || a.nombre.localeCompare(b.nombre, "es"));
  const conAlias = personas.map((p) => ({ ...p, alias: aliasDe(sesion.estado, p.id).join(" · ") }));
  const visibles = useFiltroTexto(conAlias, texto, ["nombre", "puesto", "alias"]);
  const cambiar = (persona, cambios) =>
    sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => guardarPersona(e, { ...persona, ...cambios }, sesion.usuario)));
  const agregar = () => {
    const nombre = (window.prompt("Nombre completo (como firma):") || "").trim();
    if (!nombre) return;
    const puesto = (window.prompt("Puesto:") || "").trim();
    return sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => guardarPersona(e, { nombre, puesto }, sesion.usuario)));
  };
  const marcar = (id, si) => {
    const nuevo = new Set(marcadas);
    if (si) nuevo.add(id);
    else nuevo.delete(id);
    setMarcadas(nuevo);
  };
  const seleccion = personas.filter((p) => marcadas.has(p.id));
  return html`<${Tarjeta} titulo="Personas" acciones=${html`<${Boton} onClick=${agregar}>＋ Agregar persona<//>`}>
    <p class="nota">
      Los almacenistas aparecen en "En turno". Las personas inactivas no se sugieren en los vales. Para juntar a una persona
      escrita de varias formas, márcalas en <em>Unir</em> y pulsa <em>Unificar</em>.
    </p>
    <div class="filtros">
      <${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Buscar persona, puesto u otro nombre…" />
      ${seleccion.length
        ? html`<span class="seleccion-unir">
            ${seleccion.length} marcadas
            <${Boton} tipo="primario" tamano="chico" disabled=${seleccion.length < 2} onClick=${() => setUniendo(true)}>Unificar…<//>
            <${Boton} tipo="texto" tamano="chico" onClick=${() => setMarcadas(new Set())}>Quitar marcas<//>
          </span>`
        : null}
    </div>
    <${Tabla}
      limite=${50}
      filas=${visibles}
      columnas=${[
        {
          titulo: "Unir",
          render: (p) => html`<input type="checkbox" checked=${marcadas.has(p.id)} onChange=${(e) => marcar(p.id, e.currentTarget.checked)} aria-label=${`Marcar para unir: ${p.nombre}`} />`,
        },
        {
          titulo: "Nombre",
          render: (p) => html`<span>${p.nombre}</span>${p.alias ? html`<small class="alias-persona" title="Otros nombres con los que aparece en vales anteriores">también: ${p.alias}</small>` : null}`,
        },
        {
          titulo: "Puesto",
          render: (p) => html`<input class="entrada-tabla" value=${p.puesto ?? ""} onChange=${(e) => cambiar(p, { puesto: e.currentTarget.value })} />`,
        },
        {
          titulo: "Almacenista",
          render: (p) => html`<input type="checkbox" checked=${p.es_almacenista} onChange=${(e) => cambiar(p, { es_almacenista: e.currentTarget.checked })} aria-label=${`Almacenista: ${p.nombre}`} />`,
        },
        {
          titulo: "Activa",
          render: (p) => html`<input type="checkbox" checked=${p.activo !== false} onChange=${(e) => cambiar(p, { activo: e.currentTarget.checked })} aria-label=${`Activa: ${p.nombre}`} />`,
        },
      ]}
    />
    ${uniendo
      ? html`<${VentanaUnir}
          personas=${seleccion}
          alCerrar=${(hecho) => {
            setUniendo(false);
            if (hecho) setMarcadas(new Set());
          }}
        />`
      : null}
  <//>`;
}

const TIPO = { INTERNO: "Interna", EXTERNO: "Externa", TRANSFERENCIA: "Transferencia" };
const usosEnTexto = (u) => [u.vales ? `${u.vales} ${u.vales === 1 ? "vale" : "vales"}` : "", u.borradores ? `${u.borradores} ${u.borradores === 1 ? "borrador" : "borradores"}` : ""].filter(Boolean).join(" y ");

/**
 * Quitar, descartar, recuperar y borrar áreas. Un área que ningún vale ni borrador usa se borra; la que
 * se usa se descarta (deja de salir al hacer vales y se puede recuperar) para no perder cómo se imprimen.
 */
function useQuitarArea(alQuitar) {
  const sesion = useSesion();
  const deshacer = (alHacer) => ({ etiqueta: "↶ Deshacer", alHacer });
  const borrar = (area) => {
    if (!confirmar(`¿Borrar el área ${area.nombre}? Ningún vale ni borrador la usa.`)) return;
    return sesion.tarea("Borrando…", async () => {
      const borrada = await sesion.almacen.modificar((e) => borrarArea(e, area.id, sesion.usuario));
      alQuitar(area);
      sesion.avisar("exito", `Área ${area.nombre} borrada.`, 8000, deshacer(() => sesion.almacen.modificar((e) => reponerArea(e, borrada, sesion.usuario))));
    });
  };
  const descartar = (area, usos) => {
    if (!confirmar(`${area.nombre} la usan ${usosEnTexto(usos)}. Para no perder cómo se imprimen, no se borra: se descarta (deja de salir al hacer vales y la recuperas cuando quieras). ¿Descartarla?`)) return;
    return sesion.tarea("Descartando…", async () => {
      await sesion.almacen.modificar((e) => descartarArea(e, area.id, true, sesion.usuario));
      alQuitar(area);
      sesion.avisar("exito", `Área ${area.nombre} descartada.`, 8000, deshacer(() => sesion.almacen.modificar((e) => descartarArea(e, area.id, false, sesion.usuario))));
    });
  };
  const quitar = (area) => {
    const usos = usosDeArea(sesion.estado, area.id);
    return usos.vales || usos.borradores ? descartar(area, usos) : borrar(area);
  };
  const recuperar = (area) =>
    sesion.tarea("Recuperando…", async () => {
      await sesion.almacen.modificar((e) => descartarArea(e, area.id, false, sesion.usuario));
      sesion.avisar("exito", `Área ${area.nombre} recuperada: vuelve a salir al hacer vales.`);
    });
  return { quitar, borrar, recuperar };
}

export function PaginaAreas() {
  const sesion = useSesion();
  const [editando, setEditando] = useState(null);
  const [hojas, setHojas] = useState([]);
  useEffect(() => {
    sesion.hojasFormato().then(setHojas).catch(() => setHojas([]));
  }, []);
  const todas = [...sesion.estado.plantillas_area].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const activas = todas.filter((a) => a.activo !== false);
  const descartadas = todas.filter((a) => a.activo === false);
  const usos = new Map(todas.map((a) => [a.id, usosDeArea(sesion.estado, a.id)]));
  const { quitar, borrar, recuperar } = useQuitarArea((area) => editando?.id === area.id && setEditando(null));
  const enUso = (a) => {
    const u = usos.get(a.id);
    return u.vales + u.borradores;
  };
  return html`
    ${editando ? html`<${EditorArea} area=${editando} hojas=${hojas} alTerminar=${() => setEditando(null)} />` : null}
    <${Tarjeta} titulo="Áreas (plantillas del vale)" acciones=${html`<${Boton} onClick=${() => setEditando(areaVacia())}>＋ Nueva área<//>`}>
      <p class="nota">
        Sustituyen a las hojas del libro de vales: al elegir el área, el vale se llena con estos datos. <em>Quitar…</em> borra un área que
        ningún vale usa; si ya tiene vales, la descarta (deja de salir al hacer vales y se puede recuperar).
      </p>
      <${Tabla}
        filas=${activas}
        vacia="No hay áreas activas: agrega una o recupera una descartada."
        columnas=${[
          { clave: "nombre", titulo: "Área" },
          { titulo: "Destino", render: (a) => a.depto_destino || "—" },
          { titulo: "Recibe", render: (a) => a.recibe_nombre || "—" },
          { titulo: "Tipo", render: (a) => TIPO[tipoDeArea(a)] },
          { titulo: "Formato", render: (a) => (a.hoja_excel || "según depto.").trim() },
          { titulo: "Vales", numero: true, render: (a) => usos.get(a.id).vales || "—" },
          {
            titulo: "",
            render: (a) => html`<div class="acciones-fila">
              <${Boton} tamano="chico" onClick=${() => setEditando(a)}>Editar<//>
              <${Boton} tamano="chico" tipo="texto" title=${enUso(a) ? `La usan ${usosEnTexto(usos.get(a.id))}: se descarta` : "Nadie la usa: se borra"} onClick=${() => quitar(a)}>Quitar…<//>
            </div>`,
          },
        ]}
      />
      ${descartadas.length
        ? html`<${Detalles} resumen=${`Áreas descartadas (${descartadas.length})`}>
            <p class="nota">No salen al hacer vales; los vales que ya las usan se siguen imprimiendo igual.</p>
            <${Tabla}
              filas=${descartadas}
              columnas=${[
                { clave: "nombre", titulo: "Área" },
                { titulo: "Tipo", render: (a) => TIPO[tipoDeArea(a)] },
                { titulo: "Usada en", render: (a) => usosEnTexto(usos.get(a.id)) || "ningún vale" },
                {
                  titulo: "",
                  render: (a) => html`<div class="acciones-fila">
                    <${Boton} tamano="chico" onClick=${() => recuperar(a)}>Recuperar<//>
                    ${enUso(a) ? null : html`<${Boton} tamano="chico" tipo="texto" onClick=${() => borrar(a)}>Borrar…<//>`}
                  </div>`,
                },
              ]}
            />
          <//>`
        : null}
    <//>
    <${Repetidas} />
    <${Personas} />
  `;
}
