import { useMemo } from "preact/hooks";
import { fmtFecha, fmtFechaHora } from "../../nucleo/fechas.js";
import { resumen } from "../../servicios/consultas.js";
import { Aviso, Boton, Dato, Tarjeta, num, useSesion } from "../componentes.js";
import { html } from "../html.js";

function Bienvenida() {
  const sesion = useSesion();
  return html`
    <${Tarjeta} titulo="Bienvenido">
      <p>
        La herramienta está <strong>vacía</strong>: no trae datos de nadie. Tus datos entran desde tus propios Excel y se
        quedan <strong>solo en este equipo</strong> (en el almacenamiento de Edge). Nada se envía a internet.
      </p>
      <ol class="pasos">
        <li>
          <strong>Elige una carpeta para respaldos</strong> (recomendado: <code>OneDrive\\ControlAlmacen</code>). Ahí
          se guardan respaldos diarios y los Excel exportados.
          <div class="acciones-linea">
            ${sesion.soportaCarpetas
              ? html`<${Boton} tipo=${sesion.carpeta ? "secundario" : "primario"} onClick=${() =>
                  sesion.tarea("Eligiendo carpeta…", () => sesion.elegirCarpeta())}>
                  ${sesion.carpeta ? `Carpeta: ${sesion.carpeta.name} (cambiar)` : "Elegir carpeta"}
                <//>`
              : html`<em>Este navegador no permite elegir carpeta; los archivos irán a Descargas.</em>`}
          </div>
        </li>
        <li>
          <strong>Primera carga:</strong> sube tu inventario (.xlsx) y tu libro de vales (.xlsm). Primero se hace un
          ensayo con reporte; nada se guarda hasta que lo confirmes.
          <div class="acciones-linea"><a class="boton boton-primario" href="#carga">Empezar primera carga</a></div>
        </li>
        <li>
          <strong>¿Ya tenías datos en otro equipo o navegador?</strong> Restaura un respaldo.
          <div class="acciones-linea"><a class="boton boton-secundario" href="#respaldos">Ir a respaldos</a></div>
        </li>
      </ol>
    <//>
    <${EstadoAlmacenamiento} />
  `;
}

export function EstadoAlmacenamiento() {
  const sesion = useSesion();
  const uso = sesion.uso;
  return html`<${Tarjeta} titulo="Dónde quedan tus datos">
    <ul class="lista-simple">
      <li>
        <strong>Datos de trabajo:</strong> almacenamiento local de este navegador, en este equipo.
        ${sesion.persistente === true
          ? html` <span class="ok">Protegidos contra limpieza automática.</span>`
          : sesion.persistente === false
            ? html` <span class="alerta">El navegador no confirmó la protección contra limpieza automática: mantén los respaldos al día.</span>`
            : null}
      </li>
      <li>
        <strong>Respaldos y exportaciones:</strong>
        ${sesion.carpeta
          ? html` carpeta <code>${sesion.carpeta.name}</code>
              ${sesion.permiso === "granted" ? html`<span class="ok"> (lista)</span>` : html`<span class="alerta"> (falta permiso)</span>`}`
          : html` carpeta Descargas (no has elegido carpeta).`}
      </li>
      ${uso?.usage
        ? html`<li><strong>Espacio usado:</strong> ${uso.usage < 1048576 ? `${Math.ceil(uso.usage / 1024)} KB` : `${(uso.usage / 1048576).toFixed(1)} MB`}</li>`
        : null}
      <li class="nota">
        Importante: si borras "datos de navegación / cookies y datos de sitios" en Edge, se borran también estos datos.
        Por eso existen los respaldos.
      </li>
    </ul>
  <//>`;
}

export function PaginaInicio() {
  const sesion = useSesion();
  const estado = sesion.estado;
  const datos = useMemo(() => (estado && !sesion.almacen.vacio ? resumen(estado) : null), [estado]);
  if (!datos) return html`<${Bienvenida} />`;
  return html`
    ${!sesion.usuario
      ? html`<${Aviso} tipo="advertencia" titulo="¿Quién está en turno?">Elige tu nombre arriba a la derecha; queda registrado en cada acción.<//>`
      : null}
    ${!sesion.respaldoDeHoy
      ? html`<${Aviso} tipo="advertencia" titulo="Sin respaldo de hoy">
          ${sesion.carpetaLista
            ? "Se creará uno automáticamente."
            : html`Crea uno en <a href="#respaldos">Respaldos</a> (o elige una carpeta para que sea automático).`}
        <//>`
      : null}
    ${datos.por_ubicar
      ? html`<${Aviso} tipo="info" titulo=${`${datos.por_ubicar} renglón(es) por ubicar`}>
          Hay vales posteriores al conteo que falta ligar a un renglón del inventario.${" "}
          <a href="#pendientes">Resolver pendientes</a>
        <//>`
      : null}
    <div class="datos">
      <${Dato} etiqueta="Renglones de inventario" valor=${num(datos.existencias)} detalle=${`${datos.ubicaciones} hojas / contenedores`} />
      <${Dato} etiqueta="Artículos en catálogo" valor=${num(datos.articulos)} detalle=${datos.por_confirmar ? `${datos.por_confirmar} por confirmar` : "todos confirmados"} />
      <${Dato} etiqueta="Vales de salida" valor=${num(datos.vales)} detalle=${datos.ultimo_folio ? `último folio ${datos.ultimo_folio} · ${fmtFecha(datos.fecha_ultimo_vale)}` : ""} />
      <${Dato} etiqueta="Conteo base" valor=${fmtFecha(datos.conteo_fecha)} detalle=${`descuenta desde el folio ${(datos.conteo_folio ?? 0) + 1}`} />
      <${Dato} etiqueta="Por ubicar" valor=${num(datos.por_ubicar)} tono=${datos.por_ubicar ? "alerta" : "ok"} />
    </div>
    <${Tarjeta} titulo="Uso diario">
      <ol class="pasos">
        <li>Elige quién está en turno (arriba a la derecha).</li>
        <li>Resuelve los <a href="#pendientes">pendientes</a> si la insignia muestra un número.</li>
        <li><a href="#exportar">Exporta</a> los Excel: el de vales es el que envías a la base.</li>
      </ol>
      <p class="nota">
        La emisión de vales nuevos, las entradas y la conciliación con AX llegan en las siguientes fases. Mientras tanto
        se siguen haciendo los vales en el Excel y aquí se consulta y verifica.
      </p>
      ${Object.keys(datos.ultima_exportacion).length
        ? html`<p>Últimas exportaciones: ${Object.entries(datos.ultima_exportacion)
            .map(([t, f]) => `${t.toLowerCase()} ${fmtFechaHora(f)}`)
            .join(" · ")}</p>`
        : null}
    <//>
    <${EstadoAlmacenamiento} />
  `;
}
