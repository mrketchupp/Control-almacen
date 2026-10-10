import { useMemo, useState } from "preact/hooks";
import { fmtFecha } from "../../nucleo/fechas.js";
import {
  CAMPOS_CORRECCION_GENERAL,
  corregirDatosGeneralesLote,
  resolverLoteCorreccion,
  revisarCorreccionGeneral,
} from "../../servicios/correccionLotes.js";
import { folioEntrada } from "../../servicios/entradas.js";
import { Aviso, Boton, Tabla, Ventana, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

const etiquetaFolio = (folio, tipo) => (tipo === "ENTRADA" && !/^E-/i.test(String(folio)) ? folioEntrada(folio) : String(folio));
const erroresDe = (error) => error.errores?.length ? error.errores : [{ mensaje: error.message || String(error) }];

function ValorPrevio({ valor, clave }) {
  return valor === null || valor === undefined || valor === ""
    ? html`<span class="nota">Vacío</span>`
    : html`<span class="preformateado">${clave === "fecha" ? fmtFecha(valor) : valor}</span>`;
}

/** Corrige únicamente los campos generales seleccionados, después de revisar cada vale. */
export function CorreccionPorLotes({ tipo = "SALIDA", alCerrar }) {
  const sesion = useSesion();
  const entrada = tipo === "ENTRADA";
  const campos = CAMPOS_CORRECCION_GENERAL.filter((campo) => campo.tipos.includes(tipo));
  const [texto, setTexto] = useState("");
  const [seleccionados, setSeleccionados] = useState({});
  const [valores, setValores] = useState({});
  const [revision, setRevision] = useState(null);
  const [motivoPropio, setMotivoPropio] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const lote = useMemo(() => resolverLoteCorreccion(sesion.estado, texto, tipo), [sesion.estado, texto, tipo]);
  const cambios = useMemo(
    () => Object.fromEntries(campos.filter((campo) => seleccionados[campo.clave]).map((campo) => [campo.clave, valores[campo.clave] ?? ""])),
    [seleccionados, valores, tipo],
  );
  const loteListo = lote.vales.length > 0 && !lote.invalidos.length && !lote.faltantes.length && !lote.cancelados.length;
  const ocupado = guardando || Boolean(sesion.ocupado);
  const motivo = motivoPropio ?? revision?.resumen.join("\n") ?? "";
  const cerrar = () => { if (!ocupado) alCerrar(); };
  const ponerTexto = (nuevo) => {
    setTexto(nuevo);
    setErrores([]);
  };
  const elegirCampo = (clave, seleccionado) => {
    setSeleccionados({ ...seleccionados, [clave]: seleccionado });
    setErrores([]);
  };
  const ponerValor = (clave, valor) => {
    setValores({ ...valores, [clave]: valor });
    setErrores([]);
  };
  const revisar = () => {
    if (!loteListo || ocupado) return;
    try {
      if (!Object.keys(cambios).length) {
        setErrores([{ mensaje: "Selecciona al menos un campo para corregir." }]);
        return;
      }
      const previa = revisarCorreccionGeneral(sesion.estado, lote.vales, cambios);
      if (!previa.corregidos.length) {
        setErrores([{ mensaje: "Los valores elegidos ya coinciden en todos los vales. No hay cambios que guardar." }]);
        return;
      }
      setErrores([]);
      setRevision({ ...previa, estado: sesion.estado });
    } catch (error) {
      setErrores(erroresDe(error));
    }
  };
  const guardar = async () => {
    if (!revision || ocupado) return;
    if (!motivo.trim()) {
      setErrores([{ campo: "motivo", mensaje: "Escribe el motivo de la corrección." }]);
      return;
    }
    if (revision.estado !== sesion.estado) {
      setRevision(null);
      setErrores([{ mensaje: "El historial cambió. Vuelve a revisar la corrección antes de guardarla." }]);
      return;
    }
    setGuardando(true);
    try {
      await sesion.tarea("Guardando corrección del lote…", async () => {
        try {
          const resultado = await sesion.almacen.modificar((estado) => {
            if (revision.estado !== sesion.estado) throw new Error("El historial cambió. Vuelve a revisar la corrección antes de guardarla.");
            return corregirDatosGeneralesLote(estado, lote.vales.map((vale) => vale.id), cambios, motivo, sesion.usuario);
          });
          const cantidad = resultado.corregidos.length;
          sesion.avisar("exito", `${num(cantidad)} ${cantidad === 1 ? "vale corregido" : "vales corregidos"}. La corrección queda en la bitácora de cada vale.`);
          alCerrar();
        } catch (error) {
          if (revision.estado !== sesion.estado) setRevision(null);
          setErrores(erroresDe(error));
        }
      });
    } finally {
      setGuardando(false);
    }
  };
  const filasPrevia = revision?.vales.flatMap((vale) => vale.cambios.map((cambio) => ({
    ...cambio,
    id: `${vale.id}:${cambio.clave}`,
    folio: etiquetaFolio(vale.folio, vale.tipo),
  }))) ?? [];
  return html`<${Ventana} titulo=${`Corregir por lotes · vales de ${entrada ? "entrada" : "salida"}`} alCerrar=${cerrar} clase="ventana-correccion-lote">
    ${!revision ? html`
      <p>Pega los folios del inventario <strong>${sesion.estado.config.inventario}</strong>, uno por línea o separados por espacios, comas o punto y coma. La lista se busca en todo el historial, aunque tengas filtros activos.</p>
      ${entrada ? html`<p class="nota">Usa el folio interno, por ejemplo <strong>E-0001</strong> o <strong>1</strong>. El folio de la base no se usa para seleccionar entradas.</p>` : null}
      <label class="campo">
        <span>Folios a corregir</span>
        <textarea rows="5" value=${texto} onInput=${(e) => ponerTexto(e.currentTarget.value)} placeholder=${entrada ? "E-0001\nE-0002\nE-0005" : "12345\n12346\n12350"} spellcheck="false" disabled=${ocupado}></textarea>
      </label>
      ${lote.invalidos.length ? html`<${Aviso} tipo="error" titulo="Revisa estos folios"><p class="lote-folios">${lote.invalidos.join(", ")}</p>${entrada ? "Escribe folios internos como E-0001 o 1, sin encabezados ni rangos." : "Escribe solo números de folio, sin encabezados ni rangos."}<//>` : null}
      ${lote.faltantes.length ? html`<${Aviso} tipo="error" titulo="Folios no encontrados"><p class="lote-folios">${lote.faltantes.map((folio) => etiquetaFolio(folio, tipo)).join(", ")}</p>No están en los vales de ${entrada ? "entrada" : "salida"} de este inventario. Corrige la lista antes de continuar.<//>` : null}
      ${lote.cancelados.length ? html`<${Aviso} tipo="error" titulo="El lote contiene vales cancelados"><p class="lote-folios">${lote.cancelados.map((folio) => etiquetaFolio(folio, tipo)).join(", ")}</p>Quita estos folios de la lista para corregir el resto.<//>` : null}
      ${lote.repetidos.length ? html`<p class="nota lote-folios">Folios repetidos: ${lote.repetidos.map((folio) => etiquetaFolio(folio, tipo)).join(", ")}. Cada vale se corrige una sola vez.</p>` : null}
      <p class="conteo" aria-live="polite">${num(lote.vales.length)} ${lote.vales.length === 1 ? "vale encontrado" : "vales encontrados"}</p>
      ${lote.vales.length ? html`<p class="nota lote-folios">Folios encontrados: ${lote.vales.map((vale) => etiquetaFolio(vale.folio, tipo)).join(", ")}</p>` : null}
      <h3>Datos generales a corregir</h3>
      <p class="nota">Marca los campos que quieras cambiar y escribe el nuevo valor para todos los vales. Los campos sin marcar conservan el valor de cada vale. Puedes dejar vacío un campo opcional marcado para quitar su texto.</p>
      <div class="correccion-lote-campos">
        ${campos.map((campo) => html`<div class=${`correccion-lote-campo ${errores.some((error) => error.campo === campo.clave) ? "con-error" : ""}`} key=${campo.clave}>
          <label class="correccion-lote-seleccion">
            <input type="checkbox" checked=${Boolean(seleccionados[campo.clave])} onChange=${(e) => elegirCampo(campo.clave, e.currentTarget.checked)} disabled=${ocupado} />
            <span>${campo.etiqueta}${campo.obligatorio ? " (obligatorio)" : ""}</span>
          </label>
          ${campo.tipoInput === "textarea"
            ? html`<textarea rows="3" value=${valores[campo.clave] ?? ""} onInput=${(e) => ponerValor(campo.clave, e.currentTarget.value)} aria-label=${`Nuevo valor: ${campo.etiqueta}`} disabled=${!seleccionados[campo.clave] || ocupado}></textarea>`
            : html`<input type=${campo.tipoInput || "text"} value=${valores[campo.clave] ?? ""} onInput=${(e) => ponerValor(campo.clave, e.currentTarget.value)} aria-label=${`Nuevo valor: ${campo.etiqueta}`} disabled=${!seleccionados[campo.clave] || ocupado} />`}
        </div>`)}
      </div>
      <p class="nota">Esta corrección conserva los materiales y las partidas del vale.</p>
    ` : html`
      <h3>Revisa la corrección antes de guardar</h3>
      <p class="conteo">${num(revision.corregidos.length)} ${revision.corregidos.length === 1 ? "vale con cambios" : "vales con cambios"} · ${num(filasPrevia.length)} ${filasPrevia.length === 1 ? "dato a corregir" : "datos a corregir"}</p>
      <p class="lote-folios"><strong>Folios a corregir:</strong> ${revision.corregidos.map((vale) => etiquetaFolio(vale.folio, vale.tipo)).join(", ")}</p>
      ${revision.sinCambios.length ? html`<p class="nota lote-folios">${num(revision.sinCambios.length)} ${revision.sinCambios.length === 1 ? "vale ya coincide y se conserva" : "vales ya coinciden y se conservan"}: ${revision.sinCambios.map((vale) => etiquetaFolio(vale.folio, vale.tipo)).join(", ")}</p>` : null}
      ${Object.hasOwn(cambios, "fecha") ? html`<p class="nota">${entrada ? "Se cambia la fecha del vale; la fecha de recibido que determina su ingreso al inventario se conserva." : "La fecha cambia en el historial y en los movimientos de cada día."} Las cantidades permanecen iguales.</p>` : null}
      <${Tabla}
        filas=${filasPrevia}
        columnas=${[
          { clave: "folio", titulo: "Folio" },
          { titulo: "Dato", render: (cambio) => html`<span>${cambio.etiqueta}</span>${cambio.antes === cambio.despues ? html`<div class="nota">${cambio.descripcion}</div>` : null}` },
          { titulo: "Antes", render: (cambio) => html`<${ValorPrevio} valor=${cambio.antes} clave=${cambio.clave} />` },
          { titulo: "Después", render: (cambio) => html`<${ValorPrevio} valor=${cambio.despues} clave=${cambio.clave} />` },
        ]}
      />
      <div class="campo motivo">
        <span>Motivo de la corrección (queda en la bitácora de cada vale)
          ${motivoPropio !== null
            ? html` · <button type="button" class="enlace-boton" onClick=${() => { setMotivoPropio(null); setErrores([]); }} disabled=${ocupado}>↺ Volver a llenarlo con los cambios</button>`
            : html` · <small class="ayuda">se llena solo con los cambios; puedes agregar el porqué</small>`}
        </span>
        <textarea rows=${Math.min(7, Math.max(3, motivo.split("\n").length + 1))} value=${motivo} onInput=${(e) => { setMotivoPropio(e.currentTarget.value); setErrores([]); }} aria-label="Motivo de la corrección" disabled=${ocupado}></textarea>
      </div>
      <p class="nota">Se guardan juntos los datos revisados. Los materiales y las partidas se conservan.</p>
    `}
    ${errores.length ? html`<${Aviso} tipo="error" titulo="Revisa la corrección"><ul>${errores.map((error) => html`<li>${error.folio ? `${etiquetaFolio(error.folio, tipo)}: ` : ""}${error.mensaje}</li>`)}</ul><//>` : null}
    <div class="acciones-linea">
      ${revision
        ? html`<${Boton} tipo="primario" onClick=${guardar} disabled=${ocupado}>${guardando ? "Guardando…" : `Guardar corrección de ${num(revision.corregidos.length)} ${revision.corregidos.length === 1 ? "vale" : "vales"}`}<//>
          <${Boton} onClick=${() => { setRevision(null); setErrores([]); }} disabled=${ocupado}>Volver a editar<//>`
        : html`<${Boton} tipo="primario" onClick=${revisar} disabled=${!loteListo || ocupado}>Revisar corrección<//>`}
      <${Boton} onClick=${cerrar} disabled=${ocupado}>Cancelar<//>
    </div>
  <//>`;
}
