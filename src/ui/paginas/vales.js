import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { PUESTOS_AUTORIZAN, tieneDatosFijos, tipoDeArea } from "../../nucleo/areas.js";
import { aNumero, dec } from "../../nucleo/decimal.js";
import { Indices, dimensionMostrada, npMostrado, umMostrada } from "../../nucleo/estado.js";
import { calcularSaldos } from "../../nucleo/existencias.js";
import { ahoraIso, fmtFecha } from "../../nucleo/fechas.js";
import { buscarPersonas, personasParaFirma } from "../../servicios/consultas.js";
import {
  ErrorVale,
  aplicarPlantilla,
  borrador as buscarBorrador,
  conArticulo,
  conDatosFijos,
  conEntregaEnTurno,
  conExistencia,
  descartarBorrador,
  disponibles,
  emitirBorrador,
  firmasExtraDe,
  lineaEnBlanco,
  lineaVacia,
  lineasCapturadas,
  nuevoBorrador,
  observacionesDelVale,
  opcionesDeClave,
  pideEtapa,
  requiereAutoriza,
  siguienteFolio,
  validarVale,
} from "../../servicios/vales.js";
import { Aviso, Boton, CampoSugerido, Combo, Lista, Pastilla, Tarjeta, confirmar, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

// ---------------------------------------------------------------- utilidades

const normal = (t) =>
  String(t ?? "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim();

const palabras = (t) => normal(t).split(/\s+/).filter(Boolean);

function lugarDe(ubicacion) {
  return `#${ubicacion.contenedor} ${ubicacion.clase === "INV" ? "Inv." : "Cons."}`;
}

/** Artículos del catálogo para buscar por código AX (o por descripción). */
function indiceArticulos(estado, indices) {
  const renglones = new Map();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const codigo = indices.variante(e.variante_id).codigo;
    renglones.set(codigo, (renglones.get(codigo) ?? 0) + 1);
  }
  return Object.values(estado.articulos)
    .filter((a) => a.activo !== false)
    .map((a) => ({ codigo: a.codigo, descripcion: a.descripcion, renglones: renglones.get(a.codigo) ?? 0, texto: normal(`${a.codigo} ${a.descripcion}`) }));
}

function buscarArticulos(items, consulta, limite = 10) {
  const q = consulta.trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const n = q.replace(/^0+/, "") || "0";
    return items
      .filter((i) => String(i.codigo).startsWith(n))
      .sort((a, b) => Number(String(b.codigo) === n) - Number(String(a.codigo) === n) || a.codigo - b.codigo)
      .slice(0, limite);
  }
  const ps = palabras(q);
  return items
    .filter((i) => ps.every((p) => i.texto.includes(p)))
    .sort((a, b) => b.renglones - a.renglones || a.codigo - b.codigo)
    .slice(0, limite);
}

/** Búsqueda rápida (opcional, en Ajustes): renglones del inventario y artículos sin existencia. */
function indiceRapido(estado, indices, saldos) {
  const items = [];
  const conExistencia = new Set();
  for (const e of estado.existencias) {
    if (e.activo === false) continue;
    const v = indices.variante(e.variante_id);
    const u = indices.ubicacion(e.ubicacion_id);
    const descripcion = indices.articulo(v.codigo)?.descripcion ?? "";
    const dimension = dimensionMostrada(e, v) || "";
    const np = npMostrado(e, v) || "";
    conExistencia.add(v.codigo);
    items.push({
      tipo: "existencia",
      id: e.id,
      codigo: v.codigo,
      descripcion,
      detalle: [dimension, np && `NP ${np}`].filter(Boolean).join(" · ") || "S/D",
      um: umMostrada(e, v) || "",
      lugar: lugarDe(u),
      total: aNumero(saldos.get(e.id).total),
      texto: normal(`${v.codigo} ${descripcion} ${dimension} ${np} ${u.hoja_excel}`),
    });
  }
  for (const a of Object.values(estado.articulos)) {
    if (conExistencia.has(a.codigo) || a.activo === false) continue;
    items.push({ tipo: "articulo", codigo: a.codigo, descripcion: a.descripcion, texto: normal(`${a.codigo} ${a.descripcion}`) });
  }
  return items;
}

function buscarRapido(items, consulta, limite = 12) {
  const ps = palabras(consulta);
  if (!ps.length) return [];
  const codigo = /^\d+$/.test(consulta.trim()) ? Number(consulta.trim()) : null;
  const puntaje = (i) =>
    (codigo !== null && i.codigo === codigo ? 0 : 1) * 10 + (i.tipo === "existencia" ? (i.total > 0 ? 0 : 1) : 2);
  return items
    .filter((i) => ps.every((p) => i.texto.includes(p)))
    .sort((a, b) => puntaje(a) - puntaje(b) || (b.total ?? 0) - (a.total ?? 0))
    .slice(0, limite);
}

function listas(estado) {
  const unicos = (valores) => [...new Set(valores.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    personas: unicos(estado.personas.filter((p) => p.activo !== false).map((p) => p.nombre)),
    deptos: unicos([...estado.plantillas_area.flatMap((p) => [p.depto_destino, p.depto_origen]), ...estado.vales.slice(-400).flatMap((v) => [v.depto_destino, v.depto_origen])]),
    lugares: unicos([...estado.plantillas_area.flatMap((p) => [p.destino, p.origen]), ...estado.vales.slice(-400).flatMap((v) => [v.destino, v.origen])]),
    puestos: unicos(estado.personas.map((p) => p.puesto)),
  };
}

function Campo({ etiqueta, error, children, ayuda, clase = "" }) {
  return html`<label class=${`campo ${error ? "con-error" : ""} ${clase}`}>
    <span>${etiqueta}</span>
    ${children}
    ${ayuda ? html`<small class="ayuda">${ayuda}</small>` : null}
  </label>`;
}

// ---------------------------------------------------------------- quién recibe

/**
 * Busca a una persona por nombre o puesto. Se muestra su puesto; quien más ha firmado así para
 * esa área (y los puestos preferidos, p. ej. RIG MANAGER e ITP para autorizar) sale primero.
 * @param campo  firma del vale que se llena: recibio_nombre, autorizo_nombre, firma_extra_…
 */
function SelectorPersona({ id, nombre, alElegir, alEscribir, depto, campo = "recibio_nombre", puestos = [], placeholder = "Nombre o puesto…", ariaLabel = "Persona", error }) {
  const sesion = useSesion();
  const personas = useMemo(() => personasParaFirma(sesion.estado, campo), [sesion.estado.personas, sesion.estado.vales, campo]);
  const [consulta, setConsulta] = useState(null); // null = muestra el nombre elegido
  const texto = consulta ?? nombre ?? "";
  const opciones = useMemo(() => buscarPersonas(personas, consulta ?? "", { depto, puestos, limite: 40 }), [personas, consulta, depto, puestos.join()]);
  const escribir = (valor) => {
    setConsulta(valor);
    alEscribir?.(valor);
  };
  return html`<${Combo}
    id=${id}
    clase=${error ? "con-error" : ""}
    valor=${texto}
    alEscribir=${escribir}
    opciones=${opciones}
    clave=${(p) => p.id}
    render=${(p) => html`<span class="opcion-principal">${p.nombre}</span>
      ${p.puesto ? html`<${Pastilla} tono="info">${p.puesto}<//>` : html`<${Pastilla} titulo="Captúralo en Áreas y personas">sin puesto<//>`}`}
    alElegir=${(p) => {
      setConsulta(null);
      alElegir(p);
    }}
    alSalir=${() => setConsulta(null)}
    placeholder=${placeholder}
    ariaLabel=${ariaLabel}
  />`;
}

/** Fotos del vale en los espacios de su formato (NOV: 3). Se guardan reducidas en el equipo. */
function FotosVale({ fotos = [], espacios, alCambiar }) {
  const sesion = useSesion();
  const [urls, setUrls] = useState({});
  const claves = espacios.map((_, i) => fotos[i] ?? null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const nuevas = {};
      for (const clave of claves) if (clave) nuevas[clave] = await sesion.urlFoto(clave);
      if (vivo) setUrls(nuevas);
    })();
    return () => {
      vivo = false;
    };
  }, [claves.join("|")]);
  const poner = (i, clave) => {
    const nuevas = [...claves];
    nuevas[i] = clave;
    alCambiar(nuevas);
  };
  const elegir = (i) => (e) => {
    const archivo = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (archivo) sesion.tarea("Guardando foto…", async () => poner(i, await sesion.agregarFoto(archivo)));
  };
  const puestas = claves.filter(Boolean).length;
  // Mismo acomodo que en el formato: cada espacio con su ancho y proporción.
  const columnas = espacios.map((e) => `${Math.round(e.ancho)}fr`).join(" ");
  return html`<section class="vale-fotos" aria-label="Fotos del vale">
    <header class="partidas-cabeza">
      <h2>Fotos</h2>
      <span class="contador-partidas">${puestas} de ${espacios.length}</span>
      <span class="nota">Se imprimen en el mismo lugar y tamaño que en tu formato. Se guardan reducidas en este equipo.</span>
    </header>
    <div class="fotos-vale" style=${`grid-template-columns:${columnas}`}>
      ${espacios.map(
        (espacio, i) => html`<div class="foto-espacio" style=${`aspect-ratio:${Math.round(espacio.ancho)}/${Math.round(espacio.alto)}`}>
          ${claves[i]
            ? html`${urls[claves[i]] ? html`<img src=${urls[claves[i]]} alt=${`Foto ${i + 1}`} />` : html`<span class="nota">Foto ${i + 1}</span>`}
                <div class="foto-acciones">
                  <button type="button" class="boton-quitar" title="Quitar esta foto" aria-label=${`Quitar foto ${i + 1}`} onClick=${() => poner(i, null)}>✕</button>
                  <label class="boton boton-secundario boton-chico">Cambiar<input type="file" accept="image/*" hidden onChange=${elegir(i)} /></label>
                </div>`
            : html`<label class="foto-agregar" title="Agregar foto">＋ Foto ${i + 1}<input type="file" accept="image/*" hidden onChange=${elegir(i)} /></label>`}
        </div>`,
      )}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- partidas

function CeldaCodigo({ linea, articulos, alElegir, alNuevo, error }) {
  const [texto, setTexto] = useState(linea.codigo ? String(linea.codigo) : "");
  useEffect(() => setTexto(linea.codigo ? String(linea.codigo) : ""), [linea.codigo]);
  const buscando = texto.trim() !== (linea.codigo ? String(linea.codigo) : "");
  const opciones = useMemo(() => (buscando ? buscarArticulos(articulos, texto) : []), [texto, buscando, articulos]);
  const numero = /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : null;
  const existe = numero !== null && articulos.some((a) => a.codigo === numero);
  return html`<${Combo}
    id=${`cod-${linea.uid}`}
    clase=${`combo-codigo ${error ? "con-error" : ""}`}
    valor=${texto}
    alEscribir=${setTexto}
    opciones=${opciones}
    clave=${(o) => o.codigo}
    render=${(o) => html`<strong>${o.codigo}</strong> · ${o.descripcion}
      ${o.renglones
        ? html`<${Pastilla} tono="ok">${o.renglones === 1 ? "1 clave en inventario" : `${o.renglones} claves en inventario`}<//>`
        : html`<${Pastilla}>sin existencia<//>`}`}
    alElegir=${(o) => alElegir(o.codigo, true)}
    extra=${buscando && numero && !existe ? { etiqueta: `＋ Usar el código ${numero} (no está en el catálogo)`, alElegir: () => alNuevo(numero) } : null}
    alSalir=${() => {
      if (!buscando) return;
      if (existe) alElegir(numero, false);
      else setTexto(linea.codigo ? String(linea.codigo) : "");
    }}
    placeholder="Código"
    ariaLabel="Código AX"
  />`;
}

function CeldaClave({ linea, opciones, alElegir, alOtra, alEscribir, error, hay, pedido }) {
  const elegida = opciones.find((o) => o.id === linea.existencia_id) ?? null;
  const filtradas = useMemo(() => {
    const q = normal(linea.clave);
    if (!q || (elegida && normal(elegida.clave) === q)) return opciones;
    const ps = palabras(q);
    return opciones.filter((o) => ps.every((p) => normal(`${o.clave} ${o.lugar} ${o.hoja}`).includes(p)));
  }, [opciones, linea.clave, elegida]);

  if (!Number.isInteger(linea.codigo)) {
    return html`<input class="entrada-clave" disabled placeholder="Primero el código" aria-label="Clave almacén" />`;
  }
  const pastillas = elegida
    ? html`<${Pastilla} tono="lugar" titulo=${elegida.hoja}>${elegida.lugar}<//>
        <${Pastilla} tono=${hay !== null && pedido !== null && pedido.gt(hay) ? "alerta" : hay !== null && hay.lte(0) ? "alerta" : "ok"} titulo="Existencia en ese contenedor antes de este vale">
          hay ${num(aNumero(hay ?? elegida.total))} ${elegida.um}
        <//>`
    : linea.no_inventariado
      ? html`<${Pastilla} titulo="Diésel, gases, servicios o material sin existencia: queda en el historial pero no descuenta">No inventariado · no descuenta<//>`
      : html`<${Pastilla} tono="error">Elige una clave de la lista<//>`;

  if (!opciones.length) {
    return html`<div class="celda-clave">
      <input
        id=${`clv-${linea.uid}`}
        class=${`entrada-clave ${error ? "con-error" : ""}`}
        value=${linea.clave}
        placeholder="S/D"
        onInput=${(e) => alEscribir(e.currentTarget.value)}
        onKeyDown=${(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById(`cant-${linea.uid}`)?.focus();
          }
        }}
        aria-label="Clave almacén"
      />
      <div class="pastillas">${pastillas}</div>
    </div>`;
  }
  return html`<div class="celda-clave">
    <${Combo}
      id=${`clv-${linea.uid}`}
      clase=${error ? "con-error" : ""}
      valor=${linea.clave}
      alEscribir=${alEscribir}
      opciones=${filtradas}
      clave=${(o) => o.id}
      render=${(o) => html`<span class="opcion-principal">${o.clave}</span>
        <${Pastilla} tono="lugar" titulo=${o.hoja}>${o.lugar}<//>
        <${Pastilla} tono=${o.total > 0 ? "ok" : "alerta"}>hay ${num(o.total)} ${o.um}<//>`}
      alElegir=${(o) => alElegir(o, true)}
      extra=${{ etiqueta: "Otra clave: no sale del inventario (no descuenta)", alElegir: alOtra }}
      alSalir=${() => {
        const exactas = opciones.filter((o) => normal(o.clave) === normal(linea.clave));
        if (exactas.length === 1 && linea.existencia_id !== exactas[0].id) alElegir(exactas[0], false);
      }}
      placeholder="Clave / dimensión"
      ariaLabel="Clave almacén"
    />
    <div class="pastillas">${pastillas}</div>
  </div>`;
}

/**
 * Editor de un vale (borrador nuevo o corrección de uno emitido).
 * @param datos     vale en edición
 * @param alCambiar recibe los datos actualizados
 * @param entrego   {nombre, puesto} fijo (corrección); si no, el almacenista en turno
 */
export function EditorVale({ datos, alCambiar, errores = [], excluirValeId = null, entrego = null, capacidad = null, pie = null }) {
  const sesion = useSesion();
  const estado = sesion.estado;
  const indices = useMemo(() => new Indices(estado), [estado]);
  const saldos = useMemo(() => calcularSaldos(estado), [estado.existencias, estado.vales, estado.conteos]);
  const articulos = useMemo(() => indiceArticulos(estado, indices), [estado.articulos, estado.existencias]);
  const rapido = useMemo(() => (estado.config?.captura_rapida ? indiceRapido(estado, indices, saldos) : []), [estado.config?.captura_rapida, saldos]);
  const opcionesListas = useMemo(() => listas(estado), [estado.personas, estado.plantillas_area]);
  const area = estado.plantillas_area.find((p) => p.id === datos.plantilla_area_id) ?? null;
  const fijo = tieneDatosFijos(area);
  const tipo = area ? tipoDeArea(area) : null;
  const extras = firmasExtraDe(estado, datos);
  const [espacios, setEspacios] = useState([]);
  useEffect(() => {
    let vivo = true;
    sesion
      .espaciosFotos(datos)
      .then((e) => vivo && setEspacios(e))
      .catch(() => vivo && setEspacios([]));
    return () => {
      vivo = false;
    };
  }, [datos.plantilla_area_id, datos.depto_destino]);
  const errorEn = (campo, renglon = null) => errores.find((e) => e.campo === campo && e.renglon === renglon);
  const cambiar = (cambios) => alCambiar({ ...datos, ...cambios });

  // Foco: al elegir el código pasa a la clave; al elegir la clave, a la cantidad.
  const enfocar = useRef(null);
  useLayoutEffect(() => {
    if (!enfocar.current) return;
    const entrada = document.getElementById(enfocar.current);
    if (entrada) {
      entrada.focus();
      entrada.select?.();
      enfocar.current = null;
    }
  });

  const cambiarLinea = (uid, cambio, siguiente = null) => {
    if (siguiente) enfocar.current = siguiente;
    cambiar({ lineas: datos.lineas.map((l) => (l.uid === uid ? (typeof cambio === "function" ? cambio(l) : { ...l, ...cambio }) : l)) });
  };
  const agregarLinea = (tras = null) => {
    const nueva = lineaVacia(area?.lote_defecto ?? "");
    enfocar.current = `cod-${nueva.uid}`;
    const lineas = [...datos.lineas];
    const i = tras ? lineas.findIndex((l) => l.uid === tras) : -1;
    lineas.splice(i >= 0 ? i + 1 : lineas.length, 0, nueva);
    cambiar({ lineas });
  };
  const siguienteFila = (uid) => {
    const i = datos.lineas.findIndex((l) => l.uid === uid);
    const siguiente = datos.lineas[i + 1];
    if (siguiente) {
      document.getElementById(`cod-${siguiente.uid}`)?.focus();
    } else agregarLinea(uid);
  };
  const quitar = (uid) => cambiar({ lineas: datos.lineas.filter((l) => l.uid !== uid) });

  // Existencia disponible (antes de este vale) y lo que pide este vale por renglón del inventario.
  const ids = [...new Set(datos.lineas.map((l) => l.existencia_id).filter((x) => x !== null && x !== undefined))];
  const hay = useMemo(() => disponibles(estado, ids, excluirValeId), [estado, ids.join(","), excluirValeId]);
  const pedidos = new Map();
  for (const l of datos.lineas) {
    if (l.existencia_id === null || l.existencia_id === undefined) continue;
    pedidos.set(l.existencia_id, (pedidos.get(l.existencia_id) ?? dec(0)).plus(dec(l.cantidad) ?? 0));
  }
  const opcionesPorCodigo = useMemo(() => new Map(), [estado]);
  const opcionesDe = (codigo) => {
    if (!opcionesPorCodigo.has(codigo)) opcionesPorCodigo.set(codigo, opcionesDeClave(estado, codigo, { indices, saldos }));
    return opcionesPorCodigo.get(codigo);
  };

  const agregarRapido = (item) => {
    const vacia = datos.lineas.find(lineaEnBlanco);
    const base = vacia ?? lineaVacia(area?.lote_defecto ?? "");
    const linea = item.tipo === "existencia" ? conExistencia(estado, base, item.id, indices) : conArticulo(estado, base, item.codigo, { indices });
    enfocar.current = `cant-${linea.uid}`;
    cambiar({ lineas: vacia ? datos.lineas.map((l) => (l.uid === vacia.uid ? linea : l)) : [...datos.lineas, linea] });
  };

  const autoriza = requiereAutoriza(estado, datos);
  const areas = estado.plantillas_area.filter((p) => p.activo !== false || p.id === datos.plantilla_area_id);
  const enTurno = sesion.usuario ? conEntregaEnTurno(estado, datos, sesion.usuario) : null;
  const quienEntrega = entrego ?? (enTurno ? { nombre: enTurno.entrego_nombre, puesto: enTurno.entrego_puesto } : null);
  const observaciones = observacionesDelVale(estado, datos) ?? "";
  const capturadas = lineasCapturadas(datos.lineas);
  let numero = 0;

  return html`
    <div class="editor-vale">
      <aside class="vale-datos" aria-label="Datos del vale">
        <${Campo} etiqueta="Área que recibe" error=${errorEn("depto_destino")}>
          <${Lista}
            id="area-vale"
            valor=${datos.plantilla_area_id ?? ""}
            alCambiar=${(valor) => {
              const copia = structuredClone(datos);
              aplicarPlantilla(estado, copia, valor ? Number(valor) : null);
              alCambiar(copia);
            }}
            ariaLabel="Área que recibe"
            placeholder="— Elige el área —"
            opciones=${areas.map((a) => ({
              valor: a.id,
              etiqueta: a.nombre,
              detalle: tipoDeArea(a) === "TRANSFERENCIA" ? "transferencia" : tipoDeArea(a) === "EXTERNO" ? "externa" : null,
            }))}
          />
        <//>
        <${Campo} etiqueta="Fecha" error=${errorEn("fecha")}>
          <input type="date" value=${datos.fecha} onChange=${(e) => cambiar({ fecha: e.currentTarget.value })} />
        <//>
        ${!fijo && (area || datos.origen || datos.destino)
          ? html`<div class="rejilla-campos">
              <${Campo} etiqueta="Origen"><${CampoSugerido} valor=${datos.origen} alCambiar=${(valor) => cambiar({ origen: valor })} sugerencias=${opcionesListas.lugares} ariaLabel="Origen" /><//>
              <${Campo} etiqueta="Depto. origen"><${CampoSugerido} valor=${datos.depto_origen} alCambiar=${(valor) => cambiar({ depto_origen: valor })} sugerencias=${opcionesListas.deptos} ariaLabel="Depto. origen" /><//>
              <${Campo} etiqueta="Destino"><${CampoSugerido} valor=${datos.destino} alCambiar=${(valor) => cambiar({ destino: valor })} sugerencias=${opcionesListas.lugares} ariaLabel="Destino" /><//>
              <${Campo} etiqueta="Depto. destino" error=${errorEn("depto_destino")}>
                <${CampoSugerido} valor=${datos.depto_destino} alCambiar=${(valor) => cambiar({ depto_destino: valor })} sugerencias=${opcionesListas.deptos} ariaLabel="Depto. destino" />
              <//>
            </div>`
          : null}
        <${Campo} etiqueta="Recibió" error=${errorEn("recibio_nombre")} ayuda=${extras ? "Firma a la izquierda, arriba." : "Busca por nombre o por puesto (p. ej. mecánico)."}>
          <${SelectorPersona}
            id="recibio"
            ariaLabel="Recibió"
            nombre=${datos.recibio_nombre}
            depto=${datos.depto_destino}
            error=${errorEn("recibio_nombre")}
            alEscribir=${(valor) => cambiar({ recibio_nombre: valor })}
            alElegir=${(p) => cambiar({ recibio_nombre: p.nombre, recibio_puesto: p.puesto ?? datos.recibio_puesto ?? "" })}
          />
        <//>
        <${Campo} etiqueta="Puesto de quien recibe">
          <${CampoSugerido} valor=${datos.recibio_puesto} alCambiar=${(valor) => cambiar({ recibio_puesto: valor })} sugerencias=${opcionesListas.puestos} ariaLabel="Puesto de quien recibe" />
        <//>
        ${extras
          ? html`<${Campo} etiqueta=${extras.izq} ayuda="Firma a la izquierda, abajo.">
                <${SelectorPersona}
                  id="firma-izq"
                  ariaLabel=${extras.izq}
                  campo="firma_extra_izq_nombre"
                  nombre=${datos.firma_extra_izq_nombre}
                  depto=${datos.depto_destino}
                  alEscribir=${(valor) => cambiar({ firma_extra_izq_nombre: valor })}
                  alElegir=${(p) => cambiar({ firma_extra_izq_nombre: p.nombre, firma_extra_izq_puesto: p.puesto ?? datos.firma_extra_izq_puesto ?? "" })}
                />
              <//>
              <${Campo} etiqueta=${`Puesto (${extras.izq.toLowerCase()})`}>
                <${CampoSugerido} valor=${datos.firma_extra_izq_puesto} alCambiar=${(valor) => cambiar({ firma_extra_izq_puesto: valor })} sugerencias=${opcionesListas.puestos} ariaLabel=${`Puesto ${extras.izq}`} />
              <//>`
          : null}
        ${extras
          ? html`<${Campo} etiqueta=${extras.der} ayuda="Firma a la derecha, abajo.">
                <${SelectorPersona}
                  id="firma-der"
                  ariaLabel=${extras.der}
                  campo="firma_extra_der_nombre"
                  nombre=${datos.firma_extra_der_nombre}
                  depto=${datos.depto_destino}
                  alEscribir=${(valor) => cambiar({ firma_extra_der_nombre: valor })}
                  alElegir=${(p) => cambiar({ firma_extra_der_nombre: p.nombre, firma_extra_der_puesto: p.puesto ?? datos.firma_extra_der_puesto ?? "" })}
                />
              <//>
              <${Campo} etiqueta=${`Puesto (${extras.der.toLowerCase()})`}>
                <${CampoSugerido} valor=${datos.firma_extra_der_puesto} alCambiar=${(valor) => cambiar({ firma_extra_der_puesto: valor })} sugerencias=${opcionesListas.puestos} ariaLabel=${`Puesto ${extras.der}`} />
              <//>`
          : null}
        ${autoriza
          ? html`<${Campo} etiqueta="Autorizó (obligatorio)" error=${errorEn("autorizo_nombre")} ayuda="Primero se sugieren RIG MANAGER e ITP.">
                <${SelectorPersona}
                  id="autorizo"
                  ariaLabel="Autorizó"
                  campo="autorizo_nombre"
                  puestos=${PUESTOS_AUTORIZAN}
                  nombre=${datos.autorizo_nombre}
                  depto=${datos.depto_destino}
                  error=${errorEn("autorizo_nombre")}
                  alEscribir=${(valor) => cambiar({ autorizo_nombre: valor })}
                  alElegir=${(p) => cambiar({ autorizo_nombre: p.nombre, autorizo_puesto: p.puesto ?? datos.autorizo_puesto ?? "" })}
                />
              <//>
              <${Campo} etiqueta="Puesto de quien autoriza">
                <${CampoSugerido} valor=${datos.autorizo_puesto ?? ""} alCambiar=${(valor) => cambiar({ autorizo_puesto: valor })} sugerencias=${[...new Set([...PUESTOS_AUTORIZAN, ...opcionesListas.puestos])]} ariaLabel="Puesto de quien autoriza" />
              <//>`
          : null}
        ${pideEtapa(estado, datos)
          ? html`<${Campo} etiqueta="Etapa de perforación" error=${errorEn("etapa_perforacion")} ayuda="Es lo único que cambia en las observaciones; se recuerda para los siguientes vales.">
              <input value=${datos.etapa_perforacion ?? ""} placeholder='Ej. 12 1/4"' onInput=${(e) => cambiar({ etapa_perforacion: e.currentTarget.value })} />
            <//>`
          : null}
        ${!(area && fijo)
          ? html`<${Campo} etiqueta="Observaciones">
              <textarea rows="4" value=${datos.observaciones} onInput=${(e) => cambiar({ observaciones: e.currentTarget.value })}></textarea>
            <//>`
          : null}
        <div class="datos-automaticos">
          <span class="subtitulo-panel">Se llenan solos</span>
          <dl class=${`datos-fijos ${!quienEntrega ? "datos-fijos-error" : ""}`}>
            <dt>Entrega</dt>
            <dd>
              ${quienEntrega
                ? html`${quienEntrega.nombre}
                    <small>${[quienEntrega.puesto, entrego ? null : "en turno", extras ? "firma a la derecha, arriba" : null].filter(Boolean).join(" · ")}</small>`
                : html`<span class="alerta">Elige quién está en turno (arriba a la derecha)</span>`}
            </dd>
            ${area && fijo
              ? html`<dt>Sale de</dt><dd>${area.origen || "—"} · ${area.depto_origen || "—"}</dd>
                  <dt>Llega a</dt><dd>${area.destino || "—"} · ${area.depto_destino || "—"}</dd>`
              : null}
          </dl>
          ${area && fijo
            ? html`<div class="campo">
                <span>Observaciones (así salen en el vale)</span>
                <p class="observaciones-fijas">${observaciones || "—"}</p>
              </div>`
            : null}
        </div>
        ${tipo === "TRANSFERENCIA" ? html`<p class="nota">Transferencia: origen, destino y observaciones se pueden editar en cada vale.</p>` : null}
      </aside>

      <div class="vale-principal">
      <section class="vale-partidas" aria-label="Partidas del vale">
        <header class="partidas-cabeza">
          <h2>Partidas</h2>
          <span class=${`contador-partidas ${capacidad && capturadas.length > capacidad ? "excedido" : ""}`}>
            ${capturadas.length}${capacidad ? ` de ${capacidad}` : ""}
          </span>
          <span class="nota">Como aparecerán en el vale. Lo de color gris es información del inventario.</span>
        </header>

        ${estado.config?.captura_rapida ? html`<${BusquedaRapida} items=${rapido} alElegir=${agregarRapido} />` : null}

        <div class="tabla-contenedor tabla-partidas">
          <table class="tabla">
            <colgroup>
              <col class="c-num" /><col class="c-oc" /><col class="c-cant" /><col class="c-cod" /><col />
              <col class="c-clave" /><col class="c-um" /><col class="c-lote" /><col class="c-quitar" />
            </colgroup>
            <thead class="cabecera-vale">
              <tr>
                <th class="numero">#</th>
                <th>O.C.</th>
                <th class="numero">Cantidad</th>
                <th>Código</th>
                <th class="col-descripcion">Descripción del material</th>
                <th>Clave almacén</th>
                <th title="Presentación (unidad de medida)"><span class="si-hay-espacio">Presentación</span><span class="si-no-hay-espacio">U.M.</span></th>
                <th>Lote</th>
                <th><span class="solo-lector">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              ${datos.lineas.map((l) => {
                const blanco = lineaEnBlanco(l);
                if (!blanco) numero += 1;
                const n = blanco ? null : numero;
                const opciones = Number.isInteger(l.codigo) ? opcionesDe(l.codigo) : [];
                const conExist = l.existencia_id !== null && l.existencia_id !== undefined;
                const disponible = conExist ? (hay.get(l.existencia_id) ?? null) : null;
                const pedido = conExist ? (pedidos.get(l.existencia_id) ?? null) : null;
                const excede = conExist && disponible !== null && pedido?.gt(disponible);
                const conocido = Number.isInteger(l.codigo) && Boolean(estado.articulos[l.codigo]);
                return html`<tr key=${l.uid} class=${n && errores.some((e) => e.renglon === n) ? "fila-error" : ""}>
                    <td class="numero">${n ?? ""}</td>
                    <td><input class="entrada-oc" placeholder="S/OC" value=${l.oc} onInput=${(e) => cambiarLinea(l.uid, { oc: e.currentTarget.value })} aria-label="O.C." /></td>
                    <td>
                      <input
                        id=${`cant-${l.uid}`}
                        class=${`entrada-cantidad ${n && errorEn("cantidad", n) ? "con-error" : ""}`}
                        inputmode="decimal"
                        value=${l.cantidad}
                        onInput=${(e) => cambiarLinea(l.uid, { cantidad: e.currentTarget.value.replace(",", ".") })}
                        onKeyDown=${(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            siguienteFila(l.uid);
                          }
                        }}
                        aria-label="Cantidad"
                      />
                    </td>
                    <td>
                      <${CeldaCodigo}
                        linea=${l}
                        articulos=${articulos}
                        error=${n && errorEn("codigo", n)}
                        alElegir=${(codigo, mover) => {
                          if (codigo === l.codigo) {
                            if (mover) enfocar.current = conocido && opciones.length === 1 ? `cant-${l.uid}` : `clv-${l.uid}`;
                            return;
                          }
                          const nueva = conArticulo(estado, l, codigo, { indices });
                          const destino = nueva.existencia_id !== null ? `cant-${l.uid}` : `clv-${l.uid}`;
                          cambiarLinea(l.uid, nueva, mover ? destino : null);
                        }}
                        alNuevo=${(codigo) => cambiarLinea(l.uid, { ...conArticulo(estado, l, codigo, { indices }), descripcion: "" }, `desc-${l.uid}`)}
                      />
                    </td>
                    <td class="col-descripcion">
                      ${Number.isInteger(l.codigo) && !conocido
                        ? html`<input
                            id=${`desc-${l.uid}`}
                            class=${n && errorEn("descripcion", n) ? "con-error" : ""}
                            value=${l.descripcion}
                            placeholder="Descripción (código nuevo, queda por confirmar)"
                            onInput=${(e) => cambiarLinea(l.uid, { descripcion: e.currentTarget.value })}
                          />`
                        : html`<span class="descripcion">${l.descripcion || html`<span class="nota">—</span>`}</span>`}
                    </td>
                    <td>
                      <${CeldaClave}
                        linea=${l}
                        opciones=${opciones}
                        hay=${disponible}
                        pedido=${pedido}
                        error=${n && (errorEn("existencia_id", n) || errorEn("clave", n))}
                        alElegir=${(o, mover) => cambiarLinea(l.uid, (actual) => conExistencia(estado, actual, o.id, indices), mover ? `cant-${l.uid}` : null)}
                        alOtra=${() => cambiarLinea(l.uid, { existencia_id: null, variante_id: null, no_inventariado: true }, `cant-${l.uid}`)}
                        alEscribir=${(valor) =>
                          cambiarLinea(l.uid, (actual) => {
                            const elegida = opciones.find((o) => o.id === actual.existencia_id);
                            const sigue = elegida && normal(elegida.clave) === normal(valor);
                            return {
                              ...actual,
                              clave: valor,
                              existencia_id: sigue ? actual.existencia_id : null,
                              variante_id: sigue ? actual.variante_id : null,
                              no_inventariado: opciones.length === 0 ? true : sigue ? false : actual.no_inventariado && !elegida,
                            };
                          })}
                      />
                    </td>
                    <td><input class=${`entrada-um ${n && errorEn("um", n) ? "con-error" : ""}`} value=${l.um} onInput=${(e) => cambiarLinea(l.uid, { um: e.currentTarget.value })} aria-label="Presentación (UM)" /></td>
                    <td><input class="entrada-lote" value=${l.lote} onInput=${(e) => cambiarLinea(l.uid, { lote: e.currentTarget.value })} aria-label="Lote" /></td>
                    <td>
                      <button type="button" class="boton-quitar" title="Quitar esta partida del vale" onClick=${() => quitar(l.uid)}>
                        <span aria-hidden="true">✕</span> Quitar
                      </button>
                    </td>
                  </tr>
                  ${excede
                    ? html`<tr class="fila-aviso" key=${`${l.uid}-aviso`}>
                        <td></td>
                        <td colspan="8">
                          <span class="alerta">En ese contenedor hay ${num(aNumero(disponible))} y el vale pide ${num(aNumero(pedido))}.</span>
                          Justificación para continuar:
                          <input
                            class=${`entrada-justificacion ${n && errorEn("justificacion", n) ? "con-error" : ""}`}
                            value=${l.justificacion}
                            onInput=${(e) => cambiarLinea(l.uid, { justificacion: e.currentTarget.value })}
                            placeholder="Ej. material recibido sin vale de entrada"
                          />
                        </td>
                      </tr>`
                    : null}`;
              })}
            </tbody>
          </table>
        </div>
        <div class="acciones-linea">
          <${Boton} onClick=${() => agregarLinea()}>＋ Agregar partida<//>
          <span class="nota">Código → Enter → clave → Enter → cantidad → Enter pasa a la siguiente partida.</span>
        </div>
      </section>
      ${espacios.length ? html`<${FotosVale} fotos=${datos.fotos ?? []} espacios=${espacios} alCambiar=${(fotos) => cambiar({ fotos })} />` : null}
      ${pie ? html`<div class="vale-pie">${pie}</div>` : null}
      </div>
    </div>
  `;
}

function BusquedaRapida({ items, alElegir }) {
  const [consulta, setConsulta] = useState("");
  const resultados = useMemo(() => buscarRapido(items, consulta), [items, consulta]);
  return html`<div class="busqueda-rapida">
    <${Combo}
      id="buscar-articulo"
      valor=${consulta}
      alEscribir=${setConsulta}
      opciones=${resultados}
      clave=${(r) => `${r.tipo}${r.id ?? r.codigo}`}
      render=${(r) => html`<strong>${r.codigo}</strong> · ${r.descripcion}
        ${r.tipo === "existencia"
          ? html`<span class="res-detalle">${r.detalle}</span>
              <${Pastilla} tono="lugar">${r.lugar}<//>
              <${Pastilla} tono=${r.total > 0 ? "ok" : "alerta"}>hay ${num(r.total)} ${r.um}<//>`
          : html`<${Pastilla}>no inventariado<//>`}`}
      alElegir=${(r) => {
        alElegir(r);
        setConsulta("");
      }}
      placeholder="Búsqueda rápida: código, descripción, dimensión o NP (Enter agrega la partida completa)"
      ariaLabel="Búsqueda rápida de artículos"
    />
  </div>`;
}

export function ListaErrores({ errores }) {
  if (!errores.length) return null;
  return html`<${Aviso} tipo="error" titulo="Falta completar">
    <ul>${errores.map((e) => html`<li>${e.mensaje}</li>`)}</ul>
  <//>`;
}

// ---------------------------------------------------------------- vista previa

export function VistaPrevia({ vales, alCerrar }) {
  const sesion = useSesion();
  const [documento, setDocumento] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    sesion
      .documentoVales(vales)
      .then(setDocumento)
      .catch((e) => setError(e.message));
  }, []);
  return html`<div class="vista-previa" role="dialog" aria-modal="true" aria-label="Vista previa del vale">
    <div class="vista-barra">
      <strong>Vista previa (${vales.length === 1 ? "1 hoja" : `${vales.length} hojas`}, tamaño carta)</strong>
      <div class="acciones-linea">
        <${Boton} tipo="primario" onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirVales(vales))}>🖨 Imprimir / Guardar PDF<//>
        <${Boton} onClick=${alCerrar}>Cerrar<//>
      </div>
    </div>
    <div class="vista-hojas">
      ${error ? html`<${Aviso} tipo="error" titulo="No se pudo preparar la impresión">${error}<//>` : null}
      ${documento
        ? html`<style>${documento.css}</style><div dangerouslySetInnerHTML=${{ __html: documento.html }}></div>`
        : !error
          ? html`<p class="nota">Preparando…</p>`
          : null}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- página

function EmitidoOk({ vales, alNuevo }) {
  const sesion = useSesion();
  const folios = vales.map((v) => v.folio).join(", ");
  return html`<${Tarjeta} titulo=${vales.length === 1 ? `✓ Vale ${folios} emitido` : `✓ Vales ${folios} emitidos`} clase="tarjeta-exito">
    <p>
      Quedó en el historial y ya descontó existencia. Imprímelo para las firmas; el vale firmado es el documento oficial.
    </p>
    <div class="acciones-linea">
      <${Boton} tipo="primario" tamano="grande" onClick=${() => sesion.tarea("Preparando impresión…", () => sesion.imprimirVales(vales))}>🖨 Imprimir ${vales.length === 1 ? "vale" : "vales"}<//>
      ${vales.map((v) => html`<a class="boton boton-secundario" href=${`#vale/${v.id}`}>Ver vale ${v.folio}</a>`)}
      <${Boton} onClick=${alNuevo}>＋ Nuevo vale<//>
    </div>
  <//>`;
}

/** Datos del vale tal como se emitirán (para validar y para la vista previa). */
function paraEmitir(estado, datos, usuario) {
  const listo = conDatosFijos(estado, conEntregaEnTurno(estado, datos, usuario));
  return { ...listo, observaciones: observacionesDelVale(estado, listo), lineas: lineasCapturadas(listo.lineas) };
}

export function PaginaValesSalida() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const [activo, setActivo] = useState(estado.borradores[0]?.id ?? null);
  const [datos, setDatos] = useState(null);
  const [errores, setErrores] = useState([]);
  const [emitidos, setEmitidos] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [capacidad, setCapacidad] = useState(null);
  const pendiente = useRef(null);

  // Carga el borrador activo en el editor (solo al cambiar de pestaña).
  useEffect(() => {
    const b = buscarBorrador(estado, activo);
    setDatos(b ? structuredClone(b) : null);
    setErrores([]);
  }, [activo]);
  // Capacidad del formato impreso del área elegida.
  useEffect(() => {
    if (!datos) return;
    sesion
      .capacidadPara(datos)
      .then(setCapacidad)
      .catch(() => setCapacidad(null));
  }, [datos?.id, datos?.plantilla_area_id]);

  const guardar = async (valor) => {
    clearTimeout(pendiente.current);
    pendiente.current = null;
    await sesion.almacen.modificar((e) => {
      const b = buscarBorrador(e, valor.id);
      if (b) Object.assign(b, structuredClone(valor), { actualizado_en: ahoraIso() });
    });
  };
  const cambiar = (valor) => {
    setDatos(valor);
    if (errores.length) setErrores(validarVale(estado, paraEmitir(estado, valor, sesion.usuario)).errores);
    clearTimeout(pendiente.current);
    pendiente.current = setTimeout(() => guardar(valor).catch((e) => sesion.avisar("error", e.message)), 600);
  };
  useEffect(() => () => clearTimeout(pendiente.current), []);

  const nuevo = () =>
    sesion.tarea("Creando vale…", async () => {
      if (datos && pendiente.current) await guardar(datos);
      const creado = await sesion.almacen.modificar((e) => {
        const b = nuevoBorrador(e, { usuario: sesion.usuario });
        b.lineas.push(lineaVacia());
        return b.id;
      });
      setEmitidos(null);
      setActivo(creado);
    });
  const cambiarPestana = async (id) => {
    if (datos && pendiente.current) await guardar(datos);
    setEmitidos(null);
    setActivo(id);
  };
  const descartar = () => {
    if (lineasCapturadas(datos.lineas).length && !confirmar("¿Descartar este vale en borrador? No gasta folio.")) return;
    return sesion.tarea("Descartando…", async () => {
      clearTimeout(pendiente.current);
      pendiente.current = null;
      await sesion.almacen.modificar((e) => descartarBorrador(e, datos.id));
      setActivo(sesion.estado.borradores[0]?.id ?? null);
    });
  };
  const emitir = () =>
    sesion.tarea("Emitiendo…", async () => {
      const listo = paraEmitir(sesion.estado, datos, sesion.usuario);
      const { errores: faltan } = validarVale(sesion.estado, listo);
      setErrores(faltan);
      if (faltan.length) return;
      const capacidadFormato = await sesion.capacidadPara(datos);
      let dividir = false;
      if (listo.lineas.length > capacidadFormato) {
        const hojas = Math.ceil(listo.lineas.length / capacidadFormato);
        if (!confirmar(`El formato impreso de esta área admite ${capacidadFormato} partidas y el vale tiene ${listo.lineas.length}. ¿Dividirlo en ${hojas} vales con folios consecutivos?`)) return;
        dividir = true;
      }
      const folio = siguienteFolio(sesion.estado);
      if (!confirmar(`¿Emitir el vale con el folio ${folio}${dividir ? " y siguientes" : ""}? El folio queda usado: después solo se puede corregir (con motivo).`)) return;
      clearTimeout(pendiente.current);
      pendiente.current = null;
      try {
        const vales = await sesion.almacen.modificar((e) => {
          const b = buscarBorrador(e, datos.id);
          Object.assign(b, structuredClone(datos));
          return emitirBorrador(e, datos.id, { usuario: sesion.usuario, capacidad: capacidadFormato, dividir });
        });
        setEmitidos(vales);
        setActivo(sesion.estado.borradores[0]?.id ?? null);
        sesion.avisar("exito", `Vale ${vales.map((v) => v.folio).join(", ")} emitido.`);
      } catch (error) {
        if (error instanceof ErrorVale) {
          setErrores(error.errores.length ? error.errores : [{ renglon: null, campo: "vale", mensaje: error.message }]);
          return;
        }
        throw error;
      }
    });

  const borradores = estado.borradores;
  const nombreDe = (b) => estado.plantillas_area.find((p) => p.id === b.plantilla_area_id)?.nombre ?? "Sin área";
  const folio = siguienteFolio(estado);
  return html`
    ${borradores.length
      ? html`<div class="pestanas" role="tablist" aria-label="Vales en borrador">
          ${borradores.map((b) => {
            const actual = b.id === datos?.id ? datos : b;
            const n = lineasCapturadas(actual.lineas).length;
            const activa = b.id === activo && !emitidos;
            return html`<button type="button" role="tab" aria-selected=${activa} class=${`pestana ${activa ? "activa" : ""}`} onClick=${() => cambiarPestana(b.id)}>
              ${nombreDe(actual)}
              <span class="pastilla-conteo" title=${`${n} ${n === 1 ? "partida" : "partidas"}`}>${n}</span>
            </button>`;
          })}
          <button type="button" class="pestana nueva" onClick=${nuevo}>＋ Nuevo vale</button>
        </div>`
      : null}

    ${emitidos ? html`<${EmitidoOk} vales=${emitidos} alNuevo=${nuevo} />` : null}

    ${!emitidos && datos
      ? html`<div class="barra-borrador">
            <span>Borrador · se emitirá con el folio <strong class="folio-grande">${folio}</strong></span>
            <span class="nota">Se guarda solo · creado ${fmtFecha(datos.creado_en)}</span>
          </div>
          <${EditorVale}
            datos=${datos}
            alCambiar=${cambiar}
            errores=${errores}
            capacidad=${capacidad}
            pie=${html`<${ListaErrores} errores=${errores} />
              <div class="acciones-linea pie-editor">
                <${Boton} tipo="peligro-texto" onClick=${descartar}>Descartar borrador<//>
                <span class="espaciador"></span>
                <${Boton} disabled=${!lineasCapturadas(datos.lineas).length} onClick=${() => setPrevia([{ ...paraEmitir(estado, datos, sesion.usuario), folio: null, tipo: "SALIDA" }])}>Vista previa<//>
                <${Boton} tipo="primario" tamano="grande" disabled=${!lineasCapturadas(datos.lineas).length} onClick=${emitir}>Emitir vale · folio ${folio}<//>
              </div>`}
          />`
      : null}

    ${!emitidos && !datos && !borradores.length
      ? html`<${Tarjeta} clase="tarjeta-inicio-vales">
          <p>
            Cada vale se guarda solo como <strong>borrador</strong> mientras lo llenas y no gasta folio hasta que lo emites.
            Puedes tener varios abiertos a la vez.
          </p>
          <${Boton} tipo="primario" tamano="grande" onClick=${nuevo}>＋ Nuevo vale · folio ${folio}<//>
        <//>`
      : null}

    ${previa ? html`<${VistaPrevia} vales=${previa} alCerrar=${() => setPrevia(null)} />` : null}
  `;
}
