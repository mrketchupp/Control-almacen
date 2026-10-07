// Ajustes → Vale impreso: el vale se imprime con los textos y logos del libro de vales cargado para
// este inventario. Aquí se corrige o actualiza lo que deba decir otra cosa (p. ej. el nombre del
// almacén y la dirección de DLTA en el vale de GSM). Solo cambia lo impreso; el Excel del usuario y los
// datos de los vales no cambian.

import { useEffect, useMemo, useState } from "preact/hooks";
import { coincidencias, encabezadoDelFormato, identidadDe, logosDelFormato, reemplazarTextos, textosDelFormato } from "../../impresion/identidad.js";
import { inventarioDelNombre, otrosInventarios } from "../../nucleo/inventarios.js";
import { ErrorValeImpreso, fijarLogoVale, guardarTextosVale } from "../../servicios/valeImpreso.js";
import { Aviso, Boton, Buscador, Detalles, ElegirArchivo, Lista, Pastilla, Tarjeta, confirmar, useFiltroTexto, useSesion } from "../componentes.js";
import { html } from "../html.js";

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparable = (texto) => String(texto ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/**
 * Un texto del encabezado como viene en el archivo y lo que se imprime (editable). Cambiarlo crea la
 * regla «este texto → lo escrito»; dejarlo igual al archivo la quita.
 */
function TextoArchivo({ texto, valor, cambiado, inventario, alCambiar }) {
  const ajeno = texto.marca && texto.marca !== inventario && !cambiado;
  return html`<li class=${`texto-archivo ${cambiado ? "texto-cambiado" : ""}`}>
    <div class="texto-archivo-original">
      <small>${texto.zona === "pie" ? "Pie de página" : "Encabezado"} · en tu archivo:</small>
      <span class="texto-original">${texto.texto}</span>
      ${ajeno ? html`<${Pastilla} tono="alerta" titulo=${`Este texto dice ${texto.marca}`}>dice ${texto.marca}<//>` : null}
    </div>
    <div class="texto-archivo-impreso">
      <input value=${valor} onInput=${(e) => alCambiar(e.currentTarget.value)} placeholder="(vacío = no se imprime)" aria-label=${`Se imprime en lugar de «${texto.texto}»`} />
      ${cambiado
        ? html`<button type="button" class="boton-quitar-regla" title="Dejarlo como en el archivo" aria-label=${`Dejar «${texto.texto}» como en el archivo`} onClick=${() => alCambiar(texto.texto)}>↺</button>`
        : null}
    </div>
  </li>`;
}

/** Una regla: lo que dice el formato → lo que debe decir. */
function Regla({ regla, veces, alCambiar, alQuitar, indice }) {
  return html`<li class="regla-texto">
    <label class="regla-campo">
      <span>Dice</span>
      <input value=${regla.buscar} onInput=${(e) => alCambiar({ ...regla, buscar: e.currentTarget.value })} aria-label=${`Texto ${indice + 1}: lo que dice el formato`} />
    </label>
    <span class="regla-flecha" aria-hidden="true">→</span>
    <label class="regla-campo">
      <span>Debe decir</span>
      <input value=${regla.poner} onInput=${(e) => alCambiar({ ...regla, poner: e.currentTarget.value })} placeholder="(vacío = no se imprime)" aria-label=${`Texto ${indice + 1}: lo que debe decir`} />
    </label>
    <span class=${`regla-veces ${regla.buscar.trim() && !veces ? "regla-sin" : ""}`} title="En cuántos textos del formato aparece">
      ${!regla.buscar.trim() ? "" : veces ? `${veces} ${veces === 1 ? "texto" : "textos"}` : "No aparece"}
    </span>
    <button type="button" class="boton-quitar-regla" aria-label=${`Quitar el texto ${indice + 1}`} title="Quitar" onClick=${alQuitar}>×</button>
  </li>`;
}

/** Textos del formato para elegir cuál cambiar (los que nombran otro inventario van primero). */
function ElegirTexto({ textos, enUso, alElegir }) {
  const [buscar, setBuscar] = useState("");
  const visibles = useFiltroTexto(textos, buscar, ["texto"]);
  return html`<${Detalles} resumen=${`Todos los textos del formato (${textos.length})`}>
    <${Buscador} valor=${buscar} alCambiar=${setBuscar} placeholder="Buscar un texto del formato…" />
    <ul class="textos-formato">
      ${visibles.slice(0, 200).map(
        (t) => html`<li key=${t.texto}>
          <span class="texto-formato">${t.texto}</span>
          <small>${t.hojas} ${t.hojas === 1 ? "hoja" : "hojas"}</small>
          <${Boton} tamano="chico" disabled=${enUso.has(comparable(t.texto))} onClick=${() => alElegir(t.texto)}>Cambiar<//>
        </li>`,
      )}
    </ul>
  <//>`;
}

/** Un logo del formato: el original, lo que se imprime y sus acciones. */
function Logo({ logo, cambio, alCambiar }) {
  const sesion = useSesion();
  const elegir = (archivo) => sesion.tarea("Guardando la imagen…", async () => alCambiar(await sesion.leerLogo(archivo)));
  const cambiar = (cambio) => sesion.tarea("Guardando…", () => alCambiar(cambio));
  const imprime = cambio?.quitar ? null : cambio?.src ?? logo.src;
  return html`<li class="logo-formato">
    <div class="logo-par">
      <figure>
        <div class="logo-marco"><img src=${logo.src} alt="Logo original del formato" /></div>
        <figcaption>Original · ${logo.hojas} ${logo.hojas === 1 ? "hoja" : "hojas"}</figcaption>
      </figure>
      <span class="regla-flecha" aria-hidden="true">→</span>
      <figure>
        <div class=${`logo-marco ${imprime ? "" : "logo-vacio"}`}>${imprime ? html`<img src=${imprime} alt="Logo que se imprime" />` : "No se imprime"}</div>
        <figcaption>${cambio ? (cambio.quitar ? "Quitado" : `Nuevo: ${cambio.nombre || "imagen"}`) : "Se imprime igual"}</figcaption>
      </figure>
    </div>
    <div class="acciones-linea">
      <${ElegirArchivo} etiqueta="Cambiar imagen…" acepta="image/png,image/jpeg" alElegir=${elegir} />
      ${cambio?.quitar ? null : html`<${Boton} tamano="chico" onClick=${() => cambiar({ quitar: true })}>No imprimirlo<//>`}
      ${cambio ? html`<${Boton} tamano="chico" tipo="texto" onClick=${() => cambiar(null)}>Usar el original<//>` : null}
    </div>
  </li>`;
}

export function ValeImpreso() {
  const sesion = useSesion();
  const inventario = sesion.inventario.id;
  const guardada = identidadDe(sesion.estado);
  const logosGuardados = sesion.estado.config?.vale_impreso?.logos; // misma referencia mientras no cambie
  const [textos, setTextos] = useState(guardada.textos);
  const [formato, setFormato] = useState(null); // { textos, logos } del libro de vales
  const [previa, setPrevia] = useState(null);
  const [hoja, setHoja] = useState(null); // hoja de la vista previa (null = la del último vale)
  const [error, setError] = useState(null);
  useEffect(() => setTextos(guardada.textos), [JSON.stringify(guardada.textos)]);
  useEffect(() => {
    let vigente = true;
    sesion
      .modelosFormato()
      .then(
        (modelos) =>
          vigente &&
          setFormato({ hojas: modelos.map((m) => m.hoja), encabezado: encabezadoDelFormato(modelos), textos: textosDelFormato(modelos), logos: logosDelFormato(modelos) }),
      )
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, []);
  // Vista previa con lo que se está escribiendo (aún sin guardar) y los logos guardados.
  const identidad = useMemo(() => ({ textos, logos: logosGuardados ?? {} }), [textos, logosGuardados]);
  useEffect(() => {
    let vigente = true;
    sesion
      .documentoMuestra(identidad, hoja)
      .then((d) => vigente && setPrevia(d))
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [identidad, hoja]);

  const cambiado = !igual(textos.filter((t) => t.buscar.trim()), guardada.textos);
  const veces = formato ? coincidencias(formato.textos, textos) : [];
  const enUso = new Set(textos.map((t) => comparable(t.buscar)));
  const otros = otrosInventarios(inventario);
  const plantilla = [...(sesion.estado.plantillas_excel ?? [])].reverse().find((p) => p.tipo === "VALES" && p.activa);
  // Encabezado del archivo: cada texto con su regla exacta (si la tiene) y lo que se imprime.
  const encabezado = (formato?.encabezado ?? []).map((t) => {
    const exacta = textos.find((r) => comparable(r.buscar) === comparable(t.texto));
    const impreso = reemplazarTextos(t.texto, textos);
    return { texto: t, valor: exacta ? exacta.poner : impreso, cambiado: impreso !== t.texto };
  });
  const delEncabezado = new Set(encabezado.map((e) => comparable(e.texto.texto)));
  const avanzadas = textos.map((regla, i) => ({ regla, i })).filter(({ regla }) => !delEncabezado.has(comparable(regla.buscar)));
  const fijarEncabezado = (original, valor) => {
    const clave = comparable(original);
    const existe = textos.some((r) => comparable(r.buscar) === clave);
    if (valor === original) setTextos(textos.filter((r) => comparable(r.buscar) !== clave));
    else if (existe) setTextos(textos.map((r) => (comparable(r.buscar) === clave ? { buscar: original, poner: valor } : r)));
    else setTextos([{ buscar: original, poner: valor }, ...textos]);
  };
  // Lo que nombra a otro inventario y ninguna regla cambia todavía (fuera del encabezado).
  const sugeridos = formato
    ? formato.textos.filter(
        (t) => t.marca && t.marca !== inventario && !delEncabezado.has(comparable(t.texto)) && inventarioDelNombre(reemplazarTextos(t.texto, textos)) === t.marca,
      )
    : [];
  const pendientes = encabezado.filter((e) => e.texto.marca && e.texto.marca !== inventario && !e.cambiado).length + sugeridos.length;
  const agregar = (texto = "") => setTextos([...textos, { buscar: texto, poner: texto }]);
  const guardar = () =>
    sesion.tarea("Guardando…", async () => {
      const cambio = await sesion.almacen.modificar((e) => guardarTextosVale(e, textos, sesion.usuario));
      sesion.avisar("exito", cambio ? `Textos del vale de ${inventario} guardados: así se imprimen desde ahora.` : "Sin cambios.");
    });
  const cambiarLogo = async (huella, cambio) => {
    try {
      await sesion.almacen.modificar((e) => fijarLogoVale(e, huella, cambio, sesion.usuario));
    } catch (e) {
      if (e instanceof ErrorValeImpreso) sesion.avisar("error", e.message);
      else throw e;
    }
  };

  return html`<${Tarjeta} titulo=${`Vale impreso de ${inventario}: logos y textos`}>
    <p class="nota">
      El vale se imprime con los textos y logos del libro de vales que cargaste para <strong>${inventario}</strong>
      ${plantilla ? html` (<code>${plantilla.nombre_original}</code>)` : null}. Si tu archivo ya trae lo de ${inventario}, no tienes que cambiar
      nada; aquí corriges o actualizas lo que deba decir otra cosa, sin tocar tu Excel ni los datos de los vales. ${otros.join(" y ")} tiene
      los suyos.
    </p>
    ${error ? html`<${Aviso} tipo="error" titulo="No se pudo leer el formato del vale">${error}<//>` : null}
    ${pendientes
      ? html`<${Aviso} tipo="advertencia" titulo=${`El formato dice ${otros.join(" / ")} en ${pendientes} ${pendientes === 1 ? "texto" : "textos"}`}>
          Si en ${inventario} debe decir otra cosa, escríbela abajo (están marcados).
        <//>`
      : null}
    <div class="vale-impreso">
      <div class="vale-impreso-editor">
        <h3>Textos del encabezado</h3>
        ${!formato
          ? html`<p class="nota">Leyendo el formato…</p>`
          : encabezado.length
            ? html`<ul class="textos-archivo">
                ${encabezado.map(
                  (e) => html`<${TextoArchivo}
                    key=${e.texto.texto}
                    texto=${e.texto}
                    valor=${e.valor}
                    cambiado=${e.cambiado}
                    inventario=${inventario}
                    alCambiar=${(valor) => fijarEncabezado(e.texto.texto, valor)}
                  />`,
                )}
              </ul>`
            : html`<p class="nota">El formato no tiene textos fijos en el encabezado.</p>`}

        <${Detalles} resumen=${`Reemplazar en todo el formato${avanzadas.length ? ` (${avanzadas.length})` : ""}`} abierto=${avanzadas.length > 0 || sugeridos.length > 0}>
          <p class="nota">
            Para lo que no está en el encabezado o para cambiar una parte de varios textos a la vez: se reemplaza donde aparezca (sin importar
            mayúsculas ni espacios de más), en todas las hojas y en el pie de página. Por ejemplo, <code>DLTA</code> → <code>GSM</code>.
          </p>
          ${sugeridos.length
            ? html`<div class="sugeridos-texto">
                <span>Dicen ${[...new Set(sugeridos.map((t) => t.marca))].join(" / ")}:</span>
                ${sugeridos.slice(0, 8).map((t) => html`<button type="button" class="chip-texto" title="Cambiar este texto" onClick=${() => agregar(t.texto)}>${t.texto}</button>`)}
              </div>`
            : null}
          ${avanzadas.length
            ? html`<ol class="reglas-texto">
                ${avanzadas.map(
                  ({ regla, i }, k) => html`<${Regla}
                    key=${i}
                    indice=${k}
                    regla=${regla}
                    veces=${veces[i]}
                    alCambiar=${(nueva) => setTextos(textos.map((t, x) => (x === i ? nueva : t)))}
                    alQuitar=${() => setTextos(textos.filter((_, x) => x !== i))}
                  />`,
                )}
              </ol>`
            : null}
          <div class="acciones-linea"><${Boton} tamano="chico" onClick=${() => agregar()}>＋ Agregar reemplazo<//></div>
          ${formato ? html`<${ElegirTexto} textos=${formato.textos} enUso=${enUso} alElegir=${agregar} />` : null}
        <//>

        <div class="acciones-linea barra-guardar-textos">
          <${Boton} tipo="primario" tamano="chico" disabled=${!cambiado} onClick=${guardar}>Guardar textos<//>
          ${cambiado
            ? html`<${Boton} tamano="chico" tipo="texto" onClick=${() => confirmar("¿Descartar los cambios sin guardar?") && setTextos(guardada.textos)}>Descartar<//>`
            : html`<span class="nota">${guardada.textos.length ? "Guardado." : "Sin cambios: se imprime como en tu archivo."}</span>`}
        </div>

        <h3>Logos</h3>
        <p class="nota">Se imprime el logo de tu archivo; cámbialo solo si debe ser otro o si se actualizó.</p>
        ${!formato
          ? html`<p class="nota">Leyendo el formato…</p>`
          : formato.logos.length
            ? html`<ul class="logos-formato">
                ${formato.logos.map((logo) => html`<${Logo} key=${logo.huella} logo=${logo} cambio=${guardada.logos[logo.huella] ?? null} alCambiar=${(c) => cambiarLogo(logo.huella, c)} />`)}
              </ul>`
            : html`<p class="nota">El formato del vale no tiene logos.</p>`}
      </div>
      <figure class="vale-impreso-previa">
        <figcaption>
          <span>Vista previa${previa?.vale?.folio ? ` con el vale ${previa.vale.folio}` : ""}${cambiado ? " · sin guardar" : ""}</span>
          ${formato?.hojas.length > 1
            ? html`<${Lista}
                clase="lista-hoja-previa"
                valor=${previa?.hoja ?? ""}
                alCambiar=${setHoja}
                ariaLabel="Hoja del formato para la vista previa"
                opciones=${formato.hojas.map((h) => ({ valor: h, etiqueta: `Hoja ${h.trim()}` }))}
              />`
            : null}
        </figcaption>
        <div class="previa-hoja">
          ${previa ? html`<style>${previa.css}</style><div class="previa-escala" dangerouslySetInnerHTML=${{ __html: previa.html }}></div>` : html`<p class="nota">Preparando…</p>`}
        </div>
      </figure>
    </div>
  <//>`;
}
