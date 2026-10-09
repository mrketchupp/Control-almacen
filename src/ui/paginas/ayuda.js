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
      renombras el HTML, vuelve a copiar el destino desde aquí. Usa un solo acceso a la vez: la herramienta no se abre en dos ventanas
      (DLTA y GSM se cambian dentro de la misma; abre el último que usaste).
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
        <dt>¿Cómo manejo los inventarios DLTA y GSM?</dt>
        <dd>
          Arriba, junto al nombre de la herramienta, eliges el inventario: <strong>DLTA</strong> (azul) o <strong>GSM</strong> (morado); la franja
          de arriba y el logo toman su color para que siempre sepas en cuál estás. Cada uno va <strong>por separado</strong>: sus vales y
          folios, entradas, inventario, conteos, plantillas de Excel, respaldos (los de GSM se llaman <code>almacen_GSM_…</code>) y
          conciliación contra AX. Lo que haces en uno no cambia el otro. La primera vez GSM está vacío: haz su <em>Primera carga</em> con
          los archivos de GSM. Al abrir, la herramienta entra al último que usaste; si eliges un archivo cuyo nombre dice el otro
          inventario (por ejemplo «DLTA» estando en GSM), te pregunta antes de leerlo.
        </dd>
        <dt>El vale de GSM sale con el nombre, la dirección o el logo de DLTA</dt>
        <dd>
          El vale se imprime con los textos y logos del libro de vales que cargaste para ese inventario. Si el de GSM trae los de DLTA,
          en <a href="#ajustes">Ajustes</a> → <em>Vale impreso de GSM</em> aparece el encabezado de tu archivo tal como viene: escribe lo que
          debe decir (por ejemplo el nombre del almacén y la dirección) y guarda; cambia el logo por otra imagen o quítalo. Lo ves en la
          vista previa antes de imprimir. Tu Excel y los vales no cambian.
        </dd>
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
        <dt>¿Qué fecha cuenta en una entrada: la del vale o la de recibido?</dt>
        <dd>
          Un vale de entrada tiene dos: la <strong>fecha del vale</strong> (cuando la base lo envió; la trae el papel y la lee Copilot) y la
          de <strong>recibido</strong> (cuando llegó el material; por omisión, hoy). La de <strong>recibido</strong> decide en qué día suma al
          inventario, en qué reporte diario cuenta y cómo se filtra el historial de entradas. No puede ser futura ni posterior al día en
          que se registra la entrada; si es anterior a la del vale o a un conteo de esas partidas, la herramienta avisa (si el conteo ya
          contó ese material, la entrada lo sumaría dos veces). Se cambia con <em>Corregir</em> en la entrada (con motivo, queda en la
          bitácora). La conciliación con AX sigue usando la fecha del vale: AX mueve el material cuando la base lo envía. El libro
          exportado trae las dos (FECHA y, al final, FECHA RECIBIDO).
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
        <dt>¿Cómo hago las etiquetas del material?</dt>
        <dd>
          Al registrar una entrada, la herramienta pregunta <em>¿Le hacemos sus etiquetas?</em>: marca las partidas y ajusta cuántas
          (una por pieza). También en <a href="#etiquetas">Etiquetas</a>: de un vale de entrada (su folio E-0005 o el de la base), del
          inventario, a mano o con la lista <code>.json</code> que exportas del generador en el teléfono. En <em>Diseño y logos</em>
          eliges la hoja (por ejemplo la precortada J-5163) y los logos de cada inventario. Al imprimir deja la escala al 100 % y,
          al terminar, contesta <em>¿Salieron bien?</em> para que la entrada quede marcada.
        </dd>
        <dt>¿Qué es el reporte diario?</dt>
        <dd>
          Desde <a href="#inicio">Inicio</a> → <em>Crear reporte diario</em> eliges un día y descargas el libro de vales de salida y el
          inventario de refaccionamiento <strong>como estaban al cierre de ese día</strong>: el libro llega hasta el último folio de esa
          fecha y el inventario no trae los vales, entradas, conteos ni movimientos posteriores, aunque ya los hayas hecho (las entradas
          cuentan el día en que se <strong>recibieron</strong>, no el de su vale). Al subirlo,
          <em>Ya lo subí</em> marca solo los vales hasta ese folio; los posteriores siguen pendientes para el reporte de su día.
        </dd>
        <dt>¿Cómo concilio contra AX?</dt>
        <dd>
          En <a href="#conciliacion">Conciliación AX</a> importa el reporte de inventario de AX que manda la base (se comparan las
          partidas con modelo INV). Los bloques del centro son para actuar y la columna <em>Resumen</em> solo informa. En
          <em>Por resolver → Emparejar con AX</em>, al confirmar se corrige la dimensión / NP de tu inventario a como lo escribe AX (con
          <em>Deshacer</em>); la siguiente vez empareja solo. Las diferencias que explican los vales salen con sus folios; las demás, como
          sobrantes o faltantes con su valor. <em>Enviar a la base</em> descarga la solicitud de ajuste (cada fila coloreada según su
          estado, con su hoja de leyenda y los vales por aplicar). Las cantidades no cambian.
        </dd>
        <dt>AX no trae dimensión de un artículo</dt>
        <dd>
          Si una partida de AX no tiene Tamaño ni Color, se compara contra todas las variantes del código que tampoco tienen dimensión
          («S/D», «SIN DIMENSIÓN», «S/N»… con distintos NP), o contra el código completo si es su única partida en AX. En la conciliación
          sale como «Todo el código (N variantes)» o «Sin dimensión (N variantes)» con lo que hay en cada una. No se corrige el inventario.
        </dd>
        <dt>¿Qué hago con los faltantes de la conciliación?</dt>
        <dd>
          En <a href="#conciliacion">Conciliación AX</a> → <em>Por resolver</em> → <em>Justificar faltantes</em>: a cada faltante le asignas los
          vales que ya salieron y que AX aún no descuenta (sin IN / TR), aunque sean de antes del reporte de AX. La herramienta sugiere los
          que coinciden en código, dimensión y cantidad: los apruebas uno por uno o todos; también los eliges a mano. Lo asignado explica el
          faltante y sale en la hoja <em>VALES POR APLICAR</em> de la solicitud para que la base lo registre como consumo o transferencia.
        </dd>
        <dt>¿Qué significan (S) y (E) en los folios?</dt>
        <dd>
          <strong>(S)</strong> es un vale de salida (su folio del RIG 91) y <strong>(E)</strong> uno de entrada, con el folio del vale de la base
          (así lo reconoce la base). La hoja <em>LEYENDA</em> de la solicitud lo explica junto con los colores.
        </dd>
        <dt>¿Dónde veo todo el reporte de AX?</dt>
        <dd>
          En <a href="#conciliacion">Conciliación AX</a>, mosaico <em>Reporte AX</em>: cada partida del kardex con su resultado,
          también las <em>por confirmar</em> (con <em>Confirmar…</em>) y las que no están en el físico. Busca por código, descripción o
          dimensión y filtra sin cerrar la ventana.
        </dd>
        <dt>¿Cómo sé qué vales ya descontó la base en AX?</dt>
        <dd>
          Importa el archivo de vales que lleva la base (el que trae <em>INV/NINV</em>, <em>TR</em> e <em>IN</em>) en
          <a href="#conciliacion">Conciliación AX</a> → <em>Importar consumos de la base</em>. Con folio IN / TR la partida ya está en AX
          (la <em>CANTIDAD</em> de la base es lo aplicado; vacía = todo); lo que <strong>no tiene IN / TR</strong> cuenta como tránsito
          aunque el vale sea anterior al corte; NO INV y CONPROV no se descuentan en AX. La fecha del archivo de la base no importa (uno
          nuevo reemplaza al anterior); la que importa es la del reporte de AX. En el <a href="#historial">Historial</a> sale la columna
          <em>AX</em> y el filtro <em>Revisar</em> (sin IN / TR, ya en AX, avisos de la base).
        </dd>
        <dt>Un vale tiene partidas repetidas</dt>
        <dd>
          El formulario de Excel a veces guardaba el vale dos veces. En el <a href="#historial">Historial</a>, filtro <em>Revisar →
          Duplicadas en el vale</em>; abre cada vale y pulsa <em>Quitar duplicadas…</em>: se abre la corrección sin ellas y con el
          motivo escrito. El folio no cambia y queda en la bitácora.
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
