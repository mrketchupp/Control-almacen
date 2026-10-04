import { Boton, Tarjeta, useSesion } from "../componentes.js";
import { EstadoAlmacenamiento } from "./inicio.js";
import { html } from "../html.js";
import { copiarTexto } from "./capturaIA.js";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EDGE_SIN_X86 = "C:\\Program Files\\Microsoft\\Edge\\Application";

/** Destino del acceso directo que abre la herramienta en su propia ventana (sin pestañas ni barra de direcciones). */
export function destinoAplicacion(href = location.href) {
  return `"${EDGE}" --app="${href.split("#")[0]}"`;
}

/** Cómo abrirla como aplicación: un acceso directo de Edge con --app. */
function ComoAplicacion() {
  const sesion = useSesion();
  const destino = destinoAplicacion();
  const copiar = async () => {
    if (await copiarTexto(destino)) sesion.avisar("exito", "Copiado: pégalo como ubicación del acceso directo.");
    else sesion.avisar("error", "No se pudo copiar: selecciónalo y cópialo a mano.");
  };
  return html`<${Tarjeta} titulo="Abrirla como aplicación (ventana sola)">
    <p>
      Edge puede abrir la herramienta en <strong>su propia ventana</strong>, sin pestañas ni barra de direcciones, con su ícono en la barra
      de tareas. No se instala nada: es un acceso directo. Los datos son los mismos (mismo Edge, misma cuenta de Windows).
    </p>
    <ol class="pasos">
      <li>En el escritorio: clic derecho → <em>Nuevo</em> → <em>Acceso directo</em>.</li>
      <li>En "ubicación del elemento" pega esto (ya trae la ruta de este archivo):
        <div class="destino-app">
          <code>${destino}</code>
          <${Boton} tamano="chico" onClick=${copiar}>Copiar<//>
        </div>
      </li>
      <li><em>Siguiente</em> → nombre: <strong>Control de Almacén</strong> → <em>Finalizar</em>. Si quieres, clic derecho en el acceso → <em>Anclar a la barra de tareas</em>.</li>
    </ol>
    <p class="nota">
      Si Edge no está en esa carpeta, busca <code>msedge.exe</code> en <code>${EDGE_SIN_X86}</code>. Si mueves o
      renombras el HTML, vuelve a copiar el destino desde aquí. Usa un solo acceso a la vez: la herramienta no se abre en dos ventanas.
    </p>
  <//>`;
}

export function PaginaAyuda() {
  return html`
    <${Tarjeta} titulo="Cómo funciona">
      <p>
        Es una página web que corre completa dentro de tu navegador. Piensa en ella como una <strong>calculadora</strong>:
        la abres, trabaja con lo que le das y nada sale de tu equipo. No hay servidor, cuentas ni internet de por medio.
      </p>
      <ul class="lista-simple">
        <li><strong>Datos de trabajo:</strong> en el almacenamiento de Edge de este equipo y de esta cuenta de Windows.</li>
        <li><strong>Respaldos:</strong> archivos .zip en la carpeta que elijas (recomendado: OneDrive).</li>
        <li><strong>Exportaciones:</strong> tus Excel de siempre, actualizados, en la misma carpeta.</li>
      </ul>
    <//>
    <${Tarjeta} titulo="Preguntas frecuentes">
      <dl class="faq">
        <dt>¿Qué pasa si borro el historial de navegación?</dt>
        <dd>Si incluyes "cookies y datos de sitios", se borran los datos de la herramienta. Restaura el último respaldo en <a href="#respaldos">Respaldos</a>.</dd>
        <dt>¿Los dos almacenistas ven lo mismo?</dt>
        <dd>Sí, si usan la misma PC, la misma cuenta de Windows y el mismo navegador. Solo cambia quién está en turno.</dd>
        <dt>¿Puedo abrirla en dos pestañas?</dt>
        <dd>No: la herramienta se bloquea en la segunda pestaña para que no se pisen los cambios.</dd>
        <dt>¿Y si cambio de equipo o de navegador?</dt>
        <dd>Abre la herramienta en el nuevo y restaura el respaldo más reciente de OneDrive.</dd>
        <dt>¿Se modifican mis Excel originales?</dt>
        <dd>No. Se leen y se guardan copias como plantillas; las exportaciones son archivos nuevos.</dd>
        <dt>¿A qué contenedor entra el material de un vale de entrada?</dt>
        <dd>
          Si ya está en un contenedor, se sugiere ese (si está en varios, el que tiene más, con ★). Si es una dimensión nueva, eliges el
          contenedor y se agrega una partida al final de esa hoja. Antes de registrar ves cuánto había, cuánto entra y cuánto queda.
        </dd>
        <dt>¿Qué hace un conteo parcial?</dt>
        <dd>
          Solo cambia las partidas que capturas: su CANTIDAD pasa a ser lo contado y CONSUMO / INGRESO vuelven a empezar. Las demás
          partidas siguen con su conteo anterior. Nada cambia hasta que pulsas <em>Aplicar conteo</em>.
        </dd>
        <dt>¿Cómo capturo un vale de entrada o un conteo desde la foto?</dt>
        <dd>
          En <em>Vales de entrada</em> o en el conteo en captura, abre <em>✨ Capturar desde la foto o PDF</em>: copia las
          instrucciones, pégalas en Copilot (cuenta de trabajo) junto con la foto o el PDF, y pega aquí el bloque de código que te
          devuelva. Se llena el borrador y se marca lo dudoso para revisarlo. La herramienta no se conecta a nada: la foto la subes tú.
        </dd>
        <dt>¿Qué es el reporte diario?</dt>
        <dd>
          Desde <a href="#inicio">Inicio</a> → <em>Crear reporte diario</em> eliges un día y descargas el libro de vales de salida y el
          inventario de refaccionamiento <strong>como estaban al cierre de ese día</strong>: el libro llega hasta el último folio de esa
          fecha y el inventario no trae los vales, entradas, conteos ni movimientos posteriores, aunque ya los hayas hecho. Al subirlo,
          <em>Ya lo subí</em> marca solo los vales hasta ese folio; los posteriores siguen pendientes para el reporte de su día.
        </dd>
        <dt>¿Cómo concilio contra AX?</dt>
        <dd>
          En <a href="#conciliacion">Conciliación AX</a> importa el reporte de inventario de AX que manda la base (se comparan las
          partidas con modelo INV). Cada mosaico abre su sección en una ventana. En <em>Por confirmar</em>, al confirmar se corrige la
          dimensión / NP de tu inventario a como lo escribe AX (con <em>Deshacer</em>); la siguiente vez empareja solo. Las diferencias
          que explican los vales posteriores al corte salen con sus folios; las demás, como sobrantes o faltantes con su valor.
          Descarga la solicitud de ajuste (cada fila coloreada según su estado). Las cantidades no cambian.
        </dd>
        <dt>Descarté un borrador por error</dt>
        <dd>En el aviso que aparece abajo a la derecha pulsa <em>↶ Deshacer</em> (dura unos segundos) y vuelve tal como estaba.</dd>
        <dt>¿Cómo paso material de un contenedor a otro?</dt>
        <dd>En <a href="#inventario">Inventario</a>, botón <em>Mover</em> de la partida. El total no cambia y queda en el historial de movimientos.</dd>
        <dt>¿Cómo corrijo la dimensión o el NP de una partida?</dt>
        <dd>
          En <a href="#inventario">Inventario</a>, botón <em>Editar</em>: sugiere cómo lo escribe AX y cómo está en otras partidas. Puedes
          aplicarlo a esa partida o a todas las de su variante; las cantidades y los vales anteriores no cambian.
        </dd>
        <dt>¿Hay atajos de teclado?</dt>
        <dd><strong>Alt + N</strong> agrega una partida en los vales de salida y de entrada, debajo de la que estás escribiendo.</dd>
      </dl>
    <//>
    <${ComoAplicacion} />
    <${EstadoAlmacenamiento} />
  `;
}
