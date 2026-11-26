// Tiempo límite para lo que puede no responder nunca: OneDrive o una carpeta de Windows que se queda pensando, el
// almacenamiento del navegador después de un apagón. Ronda 36 (fallo reportado: tras un corte de luz la herramienta se
// quedaba en «Cargando…»): nada del arranque espera para siempre. Corre también en Node (pruebas).

export class ErrorTiempo extends Error {
  constructor(mensaje, { ms = null } = {}) {
    super(mensaje);
    this.name = "ErrorTiempo";
    this.ms = ms;
  }
}

/**
 * La promesa, o ErrorTiempo si no termina en `ms`. Lo que quedó corriendo sigue por su lado (no se puede cancelar),
 * pero quien espera ya no se queda detenido.
 */
export function conTiempo(promesa, ms, mensaje = "No respondió a tiempo") {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new ErrorTiempo(mensaje, { ms })), ms);
  });
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(temporizador));
}

/** Como `conTiempo`, pero si no termina (o falla) devuelve `siNo` en lugar de un error. */
export async function oSiNo(promesa, ms, siNo) {
  try {
    return await conTiempo(promesa, ms);
  } catch {
    return siNo;
  }
}

export const esTiempo = (error) => error instanceof ErrorTiempo || error?.name === "ErrorTiempo";
