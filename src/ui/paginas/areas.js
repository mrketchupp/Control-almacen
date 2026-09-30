import { useEffect, useState } from "preact/hooks";
import { TIPOS_AREA, etiquetasFirmasExtra, tipoDeArea } from "../../nucleo/areas.js";
import { areaVacia, guardarArea, guardarPersona } from "../../servicios/catalogos.js";
import { Aviso, Boton, Buscador, CampoSugerido, Lista, Tabla, Tarjeta, useFiltroTexto, useSesion } from "../componentes.js";
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

function Personas() {
  const sesion = useSesion();
  const [texto, setTexto] = useState("");
  const personas = [...sesion.estado.personas].sort((a, b) => Number(b.es_almacenista) - Number(a.es_almacenista) || a.nombre.localeCompare(b.nombre, "es"));
  const visibles = useFiltroTexto(personas, texto, ["nombre", "puesto"]);
  const cambiar = (persona, cambios) =>
    sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => guardarPersona(e, { ...persona, ...cambios }, sesion.usuario)));
  const agregar = () => {
    const nombre = (window.prompt("Nombre completo (como firma):") || "").trim();
    if (!nombre) return;
    const puesto = (window.prompt("Puesto:") || "").trim();
    return sesion.tarea("Guardando…", () => sesion.almacen.modificar((e) => guardarPersona(e, { nombre, puesto }, sesion.usuario)));
  };
  return html`<${Tarjeta} titulo="Personas" acciones=${html`<${Boton} onClick=${agregar}>＋ Agregar persona<//>`}>
    <p class="nota">Los almacenistas aparecen en "En turno". Las personas inactivas no se sugieren en los vales.</p>
    <div class="filtros"><${Buscador} valor=${texto} alCambiar=${setTexto} placeholder="Buscar persona o puesto…" /></div>
    <${Tabla}
      limite=${50}
      filas=${visibles}
      columnas=${[
        { clave: "nombre", titulo: "Nombre" },
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
  <//>`;
}

export function PaginaAreas() {
  const sesion = useSesion();
  const [editando, setEditando] = useState(null);
  const [hojas, setHojas] = useState([]);
  useEffect(() => {
    sesion.hojasFormato().then(setHojas).catch(() => setHojas([]));
  }, []);
  const areas = [...sesion.estado.plantillas_area].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  return html`
    ${editando ? html`<${EditorArea} area=${editando} hojas=${hojas} alTerminar=${() => setEditando(null)} />` : null}
    <${Tarjeta} titulo="Áreas (plantillas del vale)" acciones=${html`<${Boton} onClick=${() => setEditando(areaVacia())}>＋ Nueva área<//>`}>
      <p class="nota">Sustituyen a las hojas del libro de vales: al elegir el área, el vale se llena con estos datos.</p>
      <${Tabla}
        filas=${areas.map((a) => ({ ...a, _clase: a.activo === false ? "fila-inactiva" : "" }))}
        columnas=${[
          { clave: "nombre", titulo: "Área" },
          { titulo: "Destino", render: (a) => a.depto_destino || "—" },
          { titulo: "Recibe", render: (a) => a.recibe_nombre || "—" },
          { titulo: "Tipo", render: (a) => ({ INTERNO: "Interna", EXTERNO: "Externa", TRANSFERENCIA: "Transferencia" })[tipoDeArea(a)] },
          { titulo: "Formato", render: (a) => (a.hoja_excel || "según depto.").trim() },
          { titulo: "", render: (a) => html`<${Boton} tamano="chico" onClick=${() => setEditando(a)}>Editar<//>` },
        ]}
      />
    <//>
    <${Personas} />
  `;
}
