// Red de seguridad (Ronda 37, reporte de pruebas externas): si una sección truena al dibujarse, solo ella
// muestra el aviso y el resto de la herramienta sigue. Antes Preact dejaba en blanco esa sección y, al
// cambiar de sección, también las demás hasta recargar.

import { Component } from "preact";
import { anotar } from "../almacen/registro.js";
import { Diagnostico, textoDiagnostico } from "./arranque.js";
import { Boton } from "./componentes.js";
import { html } from "./html.js";
import { Icono } from "./iconos.js";

export class SeccionSegura extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    anotar("error", `La sección «${this.props.nombre}» falló al dibujarse`, error);
  }

  render({ children, nombre, inventario }, { error }) {
    if (!error) return children;
    const texto = () =>
      textoDiagnostico({
        inventario,
        version: globalThis.document?.documentElement.dataset.version,
        situacion: `Falló la sección «${nombre}»: ${error?.message ?? error}`,
      });
    return html`<div class="seccion-fallo" role="alert">
      <p class="seccion-fallo-titulo"><${Icono} nombre="error" tam=${20} /> <strong>Esta sección falló.</strong></p>
      <div class="arranque-acciones">
        <${Boton} tipo="primario" onClick=${() => location.reload()}>Recargar<//>
        <${Boton} onClick=${() => this.setState({ error: null })}>Reintentar<//>
      </div>
      <${Diagnostico} texto=${texto} />
    </div>`;
  }
}
