import { useEffect, useMemo, useState } from "preact/hooks";
import { ORIGEN_EQUIPO, etiquetasFirmasExtra, tipoDeArea } from "../../nucleo/areas.js";
import { areaVacia, borrarArea, descartarArea, guardarArea, guardarPersona, reponerArea } from "../../servicios/catalogos.js";
import { igualLugar, listaDestinos } from "../../servicios/pasosVale.js";
import { aliasDe, marcarDistintas, personasRepetidas, previaActualizacionPuesto, unificarPersonas, usosPorNombre } from "../../servicios/personas.js";
import {
  PLANTILLAS_VALE,
  agregarDestino,
  cambiarPlantillaDeArea,
  fijarDestinos,
  guardarPlantillaVale,
  nombrePlantilla,
  nuevaArea,
  plantillaVale,
  quitarDestino,
  usosDelArea,
} from "../../servicios/plantillasVale.js";
import { Aviso, Boton, Buscador, CampoSugerido, Detalles, Lista, Pastilla, Tabla, Tarjeta, Ventana, confirmar, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

// Ronda 35 (pedido del usuario): solo tres plantillas del vale (Consumo interno, NOV y Transferencia); cada área es un
// nombre con su plantilla y los destinos de una transferencia son los nombres de Transferencia.

/** Las tres plantillas como botones grandes de una sola elección. */
function ElegirPlantilla({ valor, alCambiar, bloqueada = false }) {
  return html`<div class="elegir-plantilla" role="radiogroup" aria-label="Plantilla">
    ${PLANTILLAS_VALE.map(
      (p) => html`<button type="button" role="radio" key=${p.tipo} aria-checked=${valor === p.tipo} disabled=${bloqueada && valor !== p.tipo}
        class=${`opcion-plantilla ${valor === p.tipo ? "elegida" : ""}`} onClick=${() => alCambiar(p.tipo)}>
        <strong>${p.nombre}</strong><small>${p.detalle}</small>
      </button>`,
    )}
  </div>`;
}

/** Agregar un nombre: área (Consumo interno o NOV) o destino (Transferencia). */
function NuevoNombre({ alTerminar }) {
  const sesion = useSesion();
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("INTERNO");
  const [depto, setDepto] = useState("");
  const [error, setError] = useState(null);
  const destino = tipo === "TRANSFERENCIA";
  const guardar = () =>
    sesion.tarea("Guardando…", async () => {
      try {
        const limpio = nombre.trim().toUpperCase();
        await sesion.almacen.modificar((e) => (destino ? agregarDestino(e, limpio, sesion.usuario) : nuevaArea(e, { nombre: limpio, tipo, depto_destino: depto }, sesion.usuario)));
        sesion.avisar("exito", destino ? `${limpio} ya sale en «¿A dónde se envía?».` : `Área ${limpio} lista: sale al hacer vales de ${nombrePlantilla(tipo).toLowerCase()}.`);
        alTerminar();
      } catch (e) {
        setError(e.message);
      }
    });
  return html`<${Tarjeta} titulo="Agregar área o destino" clase="tarjeta-correccion nuevo-nombre">
    <label class="campo campo-grande">
      <span>Nombre</span>
      <input id="nuevo-nombre" value=${nombre} placeholder=${destino ? "Ej. RIG 302" : "Ej. ELECTRICO"} onInput=${(e) => setNombre(e.currentTarget.value)}
        onKeyDown=${(e) => e.key === "Enter" && nombre.trim() && guardar()} />
    </label>
    <div class="campo">
      <span>Plantilla</span>
      <${ElegirPlantilla} valor=${tipo} alCambiar=${setTipo} />
    </div>
    ${destino
      ? html`<p class="nota">Será un destino más en «¿A dónde se envía?» (igual en DLTA y GSM).</p>`
      : html`<label class="campo">
          <span>Departamento que se imprime (si no es el mismo nombre)</span>
          <input value=${depto} placeholder=${nombre.trim().toUpperCase() || "El mismo nombre"} onInput=${(e) => setDepto(e.currentTarget.value)} />
        </label>`}
    ${error ? html`<${Aviso} tipo="error">${error}<//>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" disabled=${!nombre.trim()} onClick=${guardar}>${destino ? "Agregar destino" : "Agregar área"}<//>
      <${Boton} onClick=${alTerminar}>Cancelar<//>
    </div>
  <//>`;
}

/**
 * Editar un área: su nombre, su plantilla (solo si aún no tiene vales), el departamento que se imprime y, en *Más
 * opciones*, lo de siempre (quién recibe y autoriza si no hay vales, autoriza obligatorio, lote, activa, firmas de NOV).
 * El formato y las observaciones son de la plantilla.
 */
function EditorArea({ area, alTerminar }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [datos, setDatos] = useState({ ...areaVacia(), ...area, tipo: tipoDeArea({ ...areaVacia(), ...area }) });
  const [error, setError] = useState(null);
  const usos = usosDelArea(estado, area);
  const conVales = usos.vales + usos.borradores > 0;
  const unicos = (valores) => [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const sugerencias = {
    personas: unicos(estado.personas.filter((p) => p.activo !== false).map((p) => p.nombre)),
    puestos: unicos(estado.personas.map((p) => p.puesto)),
  };
  const poner = (clave) => (valor) => setDatos({ ...datos, [clave]: valor });
  const campo = (clave, etiqueta, opciones = {}) => html`<div class="campo">
    <span>${etiqueta}</span>
    ${opciones.sugerencias
      ? html`<${CampoSugerido} valor=${datos[clave] ?? ""} alCambiar=${poner(clave)} sugerencias=${opciones.sugerencias} ariaLabel=${etiqueta} />`
      : html`<input value=${datos[clave] ?? ""} onInput=${(e) => setDatos({ ...datos, [clave]: e.currentTarget.value })} aria-label=${etiqueta} />`}
  </div>`;
  const extra = datos.firmas_extra;
  const etiquetas = etiquetasFirmasExtra(datos);
  const ponerExtra = (lado, parte) => (valor) => setDatos({ ...datos, firmas_extra: { ...extra, [lado]: { ...extra[lado], [parte]: valor } } });
  const guardar = () =>
    sesion.tarea("Guardando área…", async () => {
      try {
        await sesion.almacen.modificar((e) => {
          const otraPlantilla = datos.tipo !== tipoDeArea(area);
          const guardada = guardarArea(e, { ...datos, tipo: tipoDeArea(area) }, sesion.usuario);
          if (otraPlantilla) cambiarPlantillaDeArea(e, guardada.id, datos.tipo, sesion.usuario);
        });
        sesion.avisar("exito", `Área ${datos.nombre.toUpperCase()} guardada.`);
        alTerminar();
      } catch (e) {
        setError(e.message);
      }
    });
  return html`<${Tarjeta} titulo=${`Editar ${area.nombre}`} clase="tarjeta-correccion editor-area">
    <div class="editor-encabezado">
      ${campo("nombre", "Nombre")}
      ${campo("depto_destino", "Departamento que se imprime")}
    </div>
    <div class="campo">
      <span>Plantilla${conVales ? " · ya tiene vales: para otra, agrega un área nueva" : ""}</span>
      <${ElegirPlantilla} valor=${datos.tipo} alCambiar=${(tipo) => tipo !== "TRANSFERENCIA" && setDatos({ ...datos, tipo })} bloqueada=${conVales} />
    </div>
    <${Detalles} resumen="Más opciones">
      <p class="nota">Quién recibe y quién autoriza se llenan con los del último vale del área; estos se usan si aún no tiene vales.</p>
      <div class="editor-encabezado">
        ${campo("recibe_nombre", "Recibe (si aún no hay vales)", { sugerencias: sugerencias.personas })}
        ${campo("recibe_puesto", "Puesto de quien recibe", { sugerencias: sugerencias.puestos })}
        ${campo("autoriza_nombre", "Autoriza (si aún no hay vales)", { sugerencias: sugerencias.personas })}
        ${campo("autoriza_puesto", "Puesto de quien autoriza", { sugerencias: sugerencias.puestos })}
        <label class="campo campo-casilla">
          <input type="checkbox" checked=${datos.requiere_autoriza} onChange=${(e) => setDatos({ ...datos, requiere_autoriza: e.currentTarget.checked })} />
          <span>Exigir «Autorizó» en esta área</span>
        </label>
        ${campo("lote_defecto", "Lote por defecto")}
        <label class="campo campo-casilla">
          <input type="checkbox" checked=${datos.activo !== false} onChange=${(e) => setDatos({ ...datos, activo: e.currentTarget.checked })} />
          <span>Activa (sale al hacer vales)</span>
        </label>
        ${extra
          ? ["izq", "der"].map(
              (lado) => html`<div class="campo">
                  <span>${etiquetas[lado]} (si aún no hay vales)</span>
                  <${CampoSugerido} valor=${extra[lado]?.nombre ?? ""} alCambiar=${ponerExtra(lado, "nombre")} sugerencias=${sugerencias.personas} ariaLabel=${etiquetas[lado]} />
                </div>
                <div class="campo">
                  <span>Puesto (${etiquetas[lado].toLowerCase()})</span>
                  <${CampoSugerido} valor=${extra[lado]?.puesto ?? ""} alCambiar=${ponerExtra(lado, "puesto")} sugerencias=${sugerencias.puestos} ariaLabel=${`Puesto ${etiquetas[lado]}`} />
                </div>`,
            )
          : null}
      </div>
    <//>
    ${error ? html`<${Aviso} tipo="error">${error}<//>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" onClick=${guardar}>Guardar área<//>
      <${Boton} onClick=${alTerminar}>Cancelar<//>
    </div>
  <//>`;
}

/** Editar una plantilla: el formato impreso y las observaciones, iguales en todas sus áreas. */
function EditorPlantilla({ tipo, hojas, alTerminar }) {
  const sesion = useSesion();
  const plantilla = plantillaVale(sesion.estado, tipo);
  const [hoja, setHoja] = useState(plantilla.hoja_excel ?? "");
  const [observaciones, setObservaciones] = useState(plantilla.observaciones ?? "");
  const [error, setError] = useState(null);
  const guardar = () =>
    sesion.tarea("Guardando plantilla…", async () => {
      try {
        const n = await sesion.almacen.modificar((e) => guardarPlantillaVale(e, tipo, { hoja_excel: hoja || null, observaciones }, sesion.usuario));
        sesion.avisar("exito", n ? `Plantilla ${plantilla.nombre} guardada en ${n} ${n === 1 ? "área" : "áreas"}.` : `Plantilla ${plantilla.nombre}: no había nada que cambiar.`);
        alTerminar();
      } catch (e) {
        setError(e.message);
      }
    });
  return html`<${Tarjeta} titulo=${`Plantilla ${plantilla.nombre}`} clase="tarjeta-correccion editor-plantilla">
    <p class="nota">
      ${plantilla.areas.length
        ? `La usan: ${plantilla.areas.map((a) => a.nombre).join(", ")}. Lo que cambies aquí queda igual en todas (y en cómo se reimprimen sus vales).`
        : "Aún no hay áreas con esta plantilla."}
    </p>
    ${plantilla.distintas.length ? html`<${Aviso} tipo="info">${plantilla.distintas.join(", ")} ${plantilla.distintas.length === 1 ? "tiene" : "tienen"} otro formato u otras observaciones: al guardar quedan como estas.<//>` : null}
    <div class="campo">
      <span>Formato impreso (hoja del libro de vales)</span>
      <${Lista}
        valor=${hoja}
        alCambiar=${(valor) => setHoja(valor || "")}
        ariaLabel="Formato impreso"
        opciones=${[{ valor: "", etiqueta: "— Según el departamento —" }, ...hojas.map((h) => ({ valor: h, etiqueta: h.trim() }))]}
      />
    </div>
    <label class="campo">
      <span>Observaciones que se imprimen${tipo === "TRANSFERENCIA" ? " (la línea «PARA USO EN» dice el destino de cada vale)" : ""}</span>
      <textarea rows="4" value=${observaciones} onInput=${(e) => setObservaciones(e.currentTarget.value)} aria-label="Observaciones de la plantilla"></textarea>
    </label>
    <p class="nota">La línea ETAPA DE PERFORACION se llena en cada vale.</p>
    ${error ? html`<${Aviso} tipo="error">${error}<//>` : null}
    <div class="acciones-linea">
      <${Boton} tipo="primario" onClick=${guardar}>Guardar plantilla<//>
      <${Boton} onClick=${alTerminar}>Cancelar<//>
    </div>
  <//>`;
}

/** Las tres plantillas, cada una con su formato, cuántas áreas la usan y sus observaciones. */
function PlantillasVale({ hojas, alEditar }) {
  const sesion = useSesion();
  return html`<${Tarjeta} titulo="Plantillas del vale">
    <p class="nota">Solo hay tres. Cada área usa una; el formato y las observaciones se cambian aquí para todas sus áreas.</p>
    <ul class="plantillas-vale">
      ${PLANTILLAS_VALE.map((base) => {
        const p = plantillaVale(sesion.estado, base.tipo);
        const destinos = base.tipo === "TRANSFERENCIA" ? listaDestinos(sesion.estado).filter((d) => !igualLugar(d, ORIGEN_EQUIPO)).length : 0;
        const cuantos = base.tipo === "TRANSFERENCIA" ? `${destinos} ${destinos === 1 ? "destino" : "destinos"}` : `${p.areas.length} ${p.areas.length === 1 ? "área" : "áreas"}`;
        return html`<li class="plantilla-vale" key=${base.tipo}>
          <div class="plantilla-cabeza">
            <strong>${base.nombre}</strong>
            <small>${cuantos} · formato ${(p.hoja_excel || "según el departamento").trim()}</small>
          </div>
          <p class="plantilla-observaciones">${p.observaciones || "Sin observaciones."}</p>
          <${Boton} tamano="chico" disabled=${!p.areas.length && base.tipo !== "TRANSFERENCIA"} onClick=${() => alEditar(base.tipo)}>Editar<//>
        </li>`;
      })}
    </ul>
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
        personalizacion: e0.config.personalizacion ?? null,
      });
      const queda = await sesion.almacen.modificar((e) => unificarPersonas(e, conservar.id, otras.map((p) => p.id), sesion.usuario).nombre);
      sesion.avisar("exito", `Listo: ${otras.map((p) => p.nombre).join(", ")} ${otras.length === 1 ? "quedó" : "quedaron"} como ${queda}. Los vales no cambiaron.`, 15000, {
        etiqueta: "↶ Deshacer",
        alHacer: () =>
          sesion.almacen.modificar((e) => {
            Object.assign(e, { personas: copia.personas, alias: copia.alias, plantillas_area: copia.plantillas_area });
            for (const clave of ["usuario_en_turno", "personalizacion"]) {
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
  const guardar = (datos, revisarPuesto) =>
    sesion.tarea("Guardando…", async () => {
      const previa = revisarPuesto ? previaActualizacionPuesto(sesion.estado, datos) : null;
      const actualizarVales = Boolean(previa?.total && confirmar(
        `El puesto de ${datos.nombre} quedará como ${previa.puesto ? `«${previa.puesto}»` : "sin puesto"}. ` +
        `¿Actualizarlo también en ${previa.total} ${previa.total === 1 ? "vale existente" : "vales existentes"} ` +
        `(${previa.salidas} de salida y ${previa.entradas} de entrada)?\n\n` +
        `Aceptar actualiza el historial. Cancelar guarda solamente la persona.`,
      ));
      const resultado = await sesion.almacen.modificar((e) => {
        const persona = guardarPersona(e, datos, sesion.usuario, { actualizarVales });
        return persona.nombre;
      });
      if (revisarPuesto) sesion.avisar("exito", actualizarVales
        ? `Persona ${resultado} guardada. Puesto actualizado en ${previa.total} ${previa.total === 1 ? "vale" : "vales"}.`
        : `Persona ${resultado} guardada.${previa?.total ? " El historial conserva los puestos anteriores." : ""}`);
    });
  const cambiar = (persona, cambios) => guardar({ ...persona, ...cambios }, Object.hasOwn(cambios, "puesto"));
  const agregar = () => {
    const nombre = (window.prompt("Nombre completo (como firma):") || "").trim();
    if (!nombre) return;
    const puesto = (window.prompt("Puesto:") || "").trim();
    return guardar({ nombre, puesto }, true);
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
      Al agregar o editar un puesto, puedes confirmar su actualización en los vales existentes.
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
          render: (p) => html`<input class="entrada-tabla" value=${p.puesto ?? ""} onChange=${(e) => cambiar(p, { puesto: e.currentTarget.value })} aria-label=${`Puesto: ${p.nombre}`} />`,
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
    // También cuentan los vales migrados del DIARIO (llevan el área por su departamento): esos se imprimen con ella.
    const usos = usosDelArea(sesion.estado, area);
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
  const estado = sesion.estado;
  const [editando, setEditando] = useState(null); // { area } | { plantilla } | { nuevo: true }
  const [hojas, setHojas] = useState([]);
  useEffect(() => {
    sesion.hojasFormato().then(setHojas).catch(() => setHojas([]));
  }, []);
  const todas = [...estado.plantillas_area].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  // Las áreas de Transferencia son la plantilla: en la lista van sus destinos.
  const activas = todas.filter((a) => a.activo !== false && tipoDeArea(a) !== "TRANSFERENCIA");
  const descartadas = todas.filter((a) => a.activo === false);
  const usos = new Map(todas.map((a) => [a.id, usosDelArea(estado, a)]));
  const { quitar, borrar, recuperar } = useQuitarArea((area) => editando?.area?.id === area.id && setEditando(null));
  const enUso = (a) => {
    const u = usos.get(a.id);
    return u.vales + u.borradores;
  };
  const quitarDestinoConDeshacer = (nombre) =>
    sesion.tarea("Quitando…", async () => {
      const antes = [...listaDestinos(estado)];
      await sesion.almacen.modificar((e) => quitarDestino(e, nombre, sesion.usuario));
      sesion.avisar("exito", `${nombre} ya no sale en «¿A dónde se envía?». Los vales que ya lo usan no cambian.`, 8000, {
        etiqueta: "↶ Deshacer",
        alHacer: () => sesion.almacen.modificar((e) => fijarDestinos(e, antes, sesion.usuario)),
      });
    });
  const filas = [
    ...activas.map((a) => ({ id: `a${a.id}`, nombre: a.nombre, tipo: tipoDeArea(a), area: a })),
    // El equipo propio nunca sale como destino (de él salen los vales): no se lista.
    ...listaDestinos(estado).filter((d) => !igualLugar(d, ORIGEN_EQUIPO)).map((d) => ({ id: `d${d}`, nombre: d, tipo: "TRANSFERENCIA", destino: d })),
  ];
  return html`
    ${editando?.plantilla ? html`<${EditorPlantilla} tipo=${editando.plantilla} hojas=${hojas} alTerminar=${() => setEditando(null)} />` : null}
    ${editando?.area ? html`<${EditorArea} key=${editando.area.id} area=${editando.area} alTerminar=${() => setEditando(null)} />` : null}
    ${editando?.nuevo ? html`<${NuevoNombre} alTerminar=${() => setEditando(null)} />` : null}
    <${PlantillasVale} hojas=${hojas} alEditar=${(tipo) => setEditando({ plantilla: tipo })} />
    <${Tarjeta} titulo="Áreas y destinos" acciones=${html`<${Boton} onClick=${() => setEditando({ nuevo: true })}>＋ Agregar<//>`}>
      <p class="nota">Cada nombre usa una plantilla. Los de Transferencia son los destinos de «¿A dónde se envía?» (los mismos en DLTA y GSM).</p>
      <${Tabla}
        filas=${filas}
        vacia="No hay áreas ni destinos: agrega uno."
        columnas=${[
          { clave: "nombre", titulo: "Nombre" },
          { titulo: "Plantilla", render: (f) => html`<${Pastilla} tono=${f.tipo === "TRANSFERENCIA" ? "info" : f.tipo === "EXTERNO" ? "lugar" : "ok"}>${nombrePlantilla(f.tipo)}<//>` },
          { titulo: "Departamento", render: (f) => (f.area ? f.area.depto_destino || "—" : "—") },
          { titulo: "Vales", numero: true, render: (f) => (f.area ? usos.get(f.area.id).vales || "—" : "—") },
          {
            titulo: "",
            render: (f) =>
              f.area
                ? html`<div class="acciones-fila">
                    <${Boton} tamano="chico" onClick=${() => setEditando({ area: f.area })}>Editar<//>
                    <${Boton} tamano="chico" tipo="texto" title=${enUso(f.area) ? `La usan ${usosEnTexto(usos.get(f.area.id))}: se descarta` : "Nadie la usa: se borra"} onClick=${() => quitar(f.area)}>Quitar…<//>
                  </div>`
                : html`<div class="acciones-fila">
                    <${Boton} tamano="chico" tipo="texto" onClick=${() => quitarDestinoConDeshacer(f.destino)}>Quitar<//>
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
                { titulo: "Plantilla", render: (a) => nombrePlantilla(tipoDeArea(a)) },
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
