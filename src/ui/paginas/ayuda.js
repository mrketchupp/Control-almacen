import { Tarjeta } from "../componentes.js";
import { html } from "../html.js";

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
          contenedor y se agrega un renglón al final de esa hoja. Antes de registrar ves cuánto había, cuánto entra y cuánto queda.
        </dd>
        <dt>¿Qué hace un conteo parcial?</dt>
        <dd>
          Solo cambia los renglones que capturas: su CANTIDAD pasa a ser lo contado y CONSUMO / INGRESO vuelven a empezar. Los demás
          renglones siguen con su conteo anterior. Nada cambia hasta que pulsas <em>Aplicar conteo</em>.
        </dd>
        <dt>¿Cómo paso material de un contenedor a otro?</dt>
        <dd>En <a href="#inventario">Inventario</a>, botón <em>Mover</em> del renglón. El total no cambia y queda en el historial de movimientos.</dd>
      </dl>
    <//>
  `;
}
