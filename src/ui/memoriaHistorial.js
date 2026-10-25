// Sólo navegación local: nunca se agrega a los datos del inventario ni a sus respaldos.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

const memorias = new WeakMap();
const capturas = new Set();
const vistas = new Set(["salidas", "entradas"]);
const posicion = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
const clave = (sesion) => `control-almacen:historial:${sesion.almacen.inventario}`;

function memoria(sesion) {
  if (!memorias.has(sesion)) {
    let guardada;
    try { guardada = JSON.parse(sessionStorage.getItem(clave(sesion)) || "null"); } catch { /* Sin almacenamiento, se recuerda durante esta sesión de la aplicación. */ }
    const datos = { vista: vistas.has(guardada?.vista) ? guardada.vista : "salidas", salidas: {}, entradas: {} };
    for (const v of vistas) {
      const antes = guardada?.[v];
      datos[v] = { filtros: antes?.filtros && typeof antes.filtros === "object" ? antes.filtros : {},
        y: posicion(antes?.y), x: posicion(antes?.x), tablaX: posicion(antes?.tablaX), tablaY: posicion(antes?.tablaY),
        mostrar: antes?.mostrar === null ? null : Number.isSafeInteger(antes?.mostrar) && antes.mostrar >= 200 ? antes.mostrar : 200 };
    }
    memorias.set(sesion, datos);
  }
  return memorias.get(sesion);
}

function guardar(sesion) {
  try { sessionStorage.setItem(clave(sesion), JSON.stringify(memoria(sesion))); } catch { /* La caché de la sesión sigue disponible. */ }
}

export function vistaHistorial(sesion, hash = location.hash) {
  const explicita = /^#historial\/(salidas|entradas)(?:\/|$)/.exec(hash)?.[1];
  return explicita || memoria(sesion).vista;
}

export function recordarVistaHistorial(sesion, vista) {
  if (!vistas.has(vista)) return;
  memoria(sesion).vista = vista;
  guardar(sesion);
}

/** Marco llama esto antes de colocar el detalle al inicio de la página. */
export function capturarHistorialAntesDeNavegar() {
  for (const capturar of capturas) capturar();
}

/** Filtros y posición independientes por pestaña e inventario. */
export function useMemoriaHistorial(sesion, vista, iniciales) {
  const raiz = useRef(null);
  const recordada = memoria(sesion)[vista];
  const [filtros, setFiltros] = useState(() => Object.fromEntries(Object.keys(iniciales)
    .map((k) => [k, typeof recordada.filtros[k] === "string" ? recordada.filtros[k] : iniciales[k]])));
  const [mostrar, setMostrar] = useState(recordada.mostrar);
  const actualizar = (nuevos) => {
    if (Object.keys(iniciales).every((k) => nuevos[k] === filtros[k])) return;
    recordada.filtros = { ...nuevos };
    recordada.y = recordada.x = recordada.tablaX = recordada.tablaY = 0;
    recordada.mostrar = 200;
    setMostrar(200);
    if (raiz.current) for (const tabla of raiz.current.querySelectorAll(".tabla-contenedor")) { tabla.scrollLeft = 0; tabla.scrollTop = 0; }
    window.scrollTo(0, 0);
    guardar(sesion);
    setFiltros(nuevos);
  };
  const cambiarMostrar = (valor) => { recordada.mostrar = valor; setMostrar(valor); guardar(sesion); };
  useLayoutEffect(() => {
    let restaurando = true, primerFrame, segundoFrame;
    const elemento = raiz.current;
    const capturar = () => {
      if (restaurando) return;
      recordada.y = posicion(window.scrollY);
      recordada.x = posicion(window.scrollX);
      recordada.tablaX = posicion(elemento?.querySelector(".tabla-contenedor")?.scrollLeft);
      recordada.tablaY = posicion(elemento?.querySelector(".tabla-contenedor")?.scrollTop);
      guardar(sesion);
    };
    const alDesplazar = () => { if (/^#historial(?:\/|$)/.test(location.hash)) capturar(); };
    capturas.add(capturar);
    window.addEventListener("scroll", alDesplazar, { passive: true });
    elemento?.addEventListener("scroll", alDesplazar, { passive: true, capture: true });
    primerFrame = requestAnimationFrame(() => {
      segundoFrame = requestAnimationFrame(() => {
        window.scrollTo(recordada.x, recordada.y);
        const tabla = elemento?.querySelector(".tabla-contenedor");
        if (tabla) { tabla.scrollLeft = recordada.tablaX; tabla.scrollTop = recordada.tablaY; }
        restaurando = false;
      });
    });
    return () => {
      // Si se cambia de pestaña sin cambiar el hash, todavía estamos en el listado.
      if (/^#historial(?:\/|$)/.test(location.hash)) capturar();
      cancelAnimationFrame(primerFrame);
      cancelAnimationFrame(segundoFrame);
      capturas.delete(capturar);
      window.removeEventListener("scroll", alDesplazar);
      elemento?.removeEventListener("scroll", alDesplazar, true);
    };
  }, [sesion, vista]);
  return { filtros, setFiltros: actualizar, limpiar: () => actualizar({ ...iniciales }), raiz, mostrar, cambiarMostrar };
}
