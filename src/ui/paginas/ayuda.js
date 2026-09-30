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
      </dl>
    <//>
  `;
}
