import assert from "node:assert/strict";
import { test } from "node:test";
import { elementoNuevo } from "../src/impresion/modelos.js";
import { elementoDelTexto, textoElemento } from "../src/ui/portapapelesElementos.js";

test("el portapapeles conserva texto Unicode, QR, barras y sus propiedades entre diseños", () => {
  for (const tipo of ["texto", "qr", "barras", "campo", "logo_izq"]) {
    const el = elementoNuevo(tipo, { id: "elemento-1", campo: "dimension" });
    if (tipo === "texto") el.texto = "ETIQUETA SINTÉTICA Y SEGUNDA PARTE";
    assert.deepEqual(elementoDelTexto(textoElemento(el)), el);
  }
});
test("pegar rechaza texto común, formatos ajenos, datos incompletos y excesivos", () => {
  for (const texto of ["texto del almacén", "null", "{}", '{"formato":"otro","version":1}', '{"formato":"control-almacen.elemento","version":1,"elemento":{"tipo":"script"}}', "x".repeat(32769)]) {
    assert.equal(elementoDelTexto(texto), null);
  }
});
