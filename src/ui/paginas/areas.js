import { useEffect, useState } from "preact/hooks";
import { TIPOS_AREA, tipoDeArea } from "../../nucleo/areas.js";
import { areaVacia, guardarArea, guardarPersona } from "../../servicios/catalogos.js";
import { Aviso, Boton, Buscador, Tabla, Tarjeta, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

function EditorArea({ area, hojas, alTerminar }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState({ ...areaVacia(), ...area, tipo: tipoDeArea({ ...areaVacia(), ...area }) });
  const interna = datos.tipo === "INTERNO";
  const [error, setError] = useState(null);
  const campo = (clave, etiqueta, opciones = {}) => html`<label class=${`campo ${opciones.ancho ? `campo-${opciones.ancho}` : ""}`}>
    <span>${etiqueta}</span>
    ${opciones.area
      ? html`<textarea rows="3" value=${datos[clave] ?? ""} onInput=${(e) => setDatos({ ...datos, [clave]: e.currentTarget.value })}></textarea>`
      : html`<input list=${opciones.lista ?? null} value=${datos[clave] ?? ""} onInput=${(e) => setDatos({ ...datos, [clave]: e.currentTarget.value })} />`}
  </label>`;
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
    <p class="nota">Estos datos se copian al vale al elegir el área; en cada vale se pueden cambiar.</p>
    <div class="editor-encabezado">
      ${campo("nombre", "Nombre del área")}
      <label class="campo">
        <span>Formato de impresión (hoja del libro de vales)</span>
        <select value=${datos.hoja_excel ?? ""} onChange=${(e) => setDatos({ ...datos, hoja_excel: e.currentTarget.value || null })}>
          <option value="">— Según el departamento —</option>
          ${hojas.map((h) => html`<option value=${h}>${h.trim()}</option>`)}
        </select>
      </label>
      <label class="campo">
        <span>Tipo de área</span>
        <select value=${datos.tipo} onChange=${(e) => setDatos({ ...datos, tipo: e.currentTarget.value })}>
          ${Object.entries(TIPOS_AREA).map(([clave, texto]) => html`<option value=${clave}>${texto}</option>`)}
        </select>
      </label>
      ${interna
        ? html`<p class="nota campo-2">Interna: el vale sale de <strong>RIG 91 · ALMACEN</strong> y llega a <strong>RIG 91 · ${datos.depto_destino || "(depto. destino)"}</strong>.</p>`
        : html`${campo("origen", "Origen", { lista: "lista-lugares-a" })}
            ${campo("depto_origen", "Depto. origen", { lista: "lista-deptos-a" })}
            ${campo("destino", "Destino", { lista: "lista-lugares-a" })}`}
      ${campo("depto_destino", "Depto. destino", { lista: "lista-deptos-a" })}
      ${campo("recibe_nombre", "Recibe (habitual)", { lista: "lista-personas-a" })}
      ${campo("recibe_puesto", "Puesto de quien recibe")}
      ${campo("autoriza_nombre", "Autoriza (habitual)", { lista: "lista-personas-a" })}
      <label class="campo campo-casilla">
        <input type="checkbox" checked=${datos.requiere_autoriza} onChange=${(e) => setDatos({ ...datos, requiere_autoriza: e.currentTarget.checked })} />
        <span>Exigir "Autorizó" en esta área</span>
      </label>
      ${campo("lote_defecto", "Lote por defecto")}
      <label class="campo campo-casilla">
        <input type="checkbox" checked=${datos.activo !== false} onChange=${(e) => setDatos({ ...datos, activo: e.currentTarget.checked })} />
        <span>Activa (aparece al hacer vales)</span>
      </label>
      ${campo("observaciones", interna ? "Observaciones que se imprimen (la línea ETAPA DE PERFORACION se llena en cada vale)" : "Observaciones que se imprimen", { area: true, ancho: "todo" })}
    </div>
    <datalist id="lista-personas-a">${sesion.estado.personas.map((p) => html`<option value=${p.nombre} />`)}</datalist>
    <datalist id="lista-deptos-a">${[...new Set(sesion.estado.plantillas_area.flatMap((p) => [p.depto_destino, p.depto_origen]).filter(Boolean))].map((d) => html`<option value=${d} />`)}</datalist>
    <datalist id="lista-lugares-a">${[...new Set(sesion.estado.plantillas_area.flatMap((p) => [p.destino, p.origen]).filter(Boolean))].map((d) => html`<option value=${d} />`)}</datalist>
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
