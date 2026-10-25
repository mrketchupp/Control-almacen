import assert from "node:assert/strict";
import { test } from "node:test";
import { Almacen } from "../src/almacen/almacen.js";
import { BackendMemoria } from "../src/almacen/bd.js";
import { analizarFormulario } from "../src/impresion/formulario.js";
import { valoresDeVale } from "../src/impresion/vale.js";
import { calcularSaldos } from "../src/nucleo/existencias.js";
import { conFirmasPorPapel, corregirVale, datosParaCorregir, resumenCambios } from "../src/servicios/vales.js";
import { LibroLeido } from "../src/xlsx/leer.js";
import { bytesVales, cargaSintetica } from "./ayuda.js";

const clave = ({ r, c }) => `${r},${c}`;
const libro = new LibroLeido(bytesVales());

test("el puesto de quien entrega en un vale importado se agrega, modifica y borra sin reescribir sus partidas", () => {
  const { estado } = cargaSintetica(), vale = estado.vales[0], modelo = analizarFormulario(libro, "MECANICO ");
  assert.equal(vale.migrado, true);
  const lineas = vale.lineas, partidas = JSON.stringify(lineas), otros = JSON.stringify(estado.vales.slice(1));
  const personas = JSON.stringify(estado.personas), config = JSON.stringify(estado.config);
  const saldos = [...calcularSaldos(estado)].map(([id, s]) => [id, s.total.toFixed()]);
  for (const puesto of ["RESPONSABLE SINTETICO", "ENCARGADO SINTETICO", ""]) {
    const datos = datosParaCorregir(estado, vale.id); datos.entrego_puesto = puesto;
    assert.match(resumenCambios(estado, vale, datos).join("\n"), /Puesto de quien entrega/);
    corregirVale(estado, vale.id, datos, "Corregir puesto del historial", "PERSONA SINTETICA");
    assert.equal(vale.entrego_puesto, puesto || null);
    assert.ok(vale.campos_encabezado_corregidos.includes("entrego_puesto"));
    assert.equal(valoresDeVale(modelo, vale).get(clave(modelo.campos.entrega_puesto)), puesto || null);
    assert.strictEqual(vale.lineas, lineas);
    assert.equal(JSON.stringify(vale.lineas), partidas);
    assert.equal(vale.folio, 1);
  }
  assert.equal(JSON.stringify(estado.vales.slice(1)), otros);
  assert.equal(JSON.stringify(estado.personas), personas);
  assert.equal(JSON.stringify(estado.config), config);
  assert.deepEqual([...calcularSaldos(estado)].map(([id, s]) => [id, s.total.toFixed()]), saldos);
  assert.match(estado.auditoria.at(-1).antes.cambios.join("\n"), /Puesto de quien entrega/);
});

test("los puestos del vale importado con almacén a la derecha respetan su papel y su posición impresa", () => {
  const { estado } = cargaSintetica(), vale = estado.vales[0], modelo = analizarFormulario(libro, "NOV");
  Object.assign(vale, { depto_destino: "NOV ENERGY", entrego_nombre: "QUIMICO SINTETICO", entrego_puesto: "QUIMICO", recibio_nombre: "ALMACENISTA UNO", recibio_puesto: null });
  const partidas = JSON.stringify(vale.lineas);
  let datos = datosParaCorregir(estado, vale.id);
  assert.deepEqual([datos.entrego_nombre, datos.recibio_nombre], ["ALMACENISTA UNO", "QUIMICO SINTETICO"]);
  datos.entrego_puesto = "ENCARGADO SINTETICO"; datos.recibio_puesto = "TECNICO SINTETICO";
  corregirVale(estado, vale.id, datos, "Corregir puestos del historial");
  assert.deepEqual([vale.entrego_puesto, vale.recibio_puesto], ["TECNICO SINTETICO", "ENCARGADO SINTETICO"]);
  assert.deepEqual([conFirmasPorPapel(estado, vale).entrego_puesto, conFirmasPorPapel(estado, vale).recibio_puesto], ["ENCARGADO SINTETICO", "TECNICO SINTETICO"]);
  const impresion = valoresDeVale(modelo, vale);
  assert.deepEqual([impresion.get(clave(modelo.campos.entrega_puesto)), impresion.get(clave(modelo.campos.recibe_puesto))], ["ENCARGADO SINTETICO", "TECNICO SINTETICO"]);
  datos = datosParaCorregir(estado, vale.id); datos.entrego_puesto = "";
  corregirVale(estado, vale.id, datos, "Quitar puesto capturado por error");
  assert.ok(vale.campos_encabezado_corregidos.includes("recibio_puesto"));
  assert.equal(valoresDeVale(modelo, vale).get(clave(modelo.campos.entrega_puesto)), null);
  assert.equal(JSON.stringify(vale.lineas), partidas);
});

test("el puesto corregido del historial persiste al guardar, reabrir y restaurar el respaldo", async () => {
  const { estado } = cargaSintetica(), id = estado.vales[0].id;
  const almacen = new Almacen(new BackendMemoria()); await almacen.iniciar(); await almacen.cargarPrimeraVez(estado, []);
  await almacen.modificar((e) => {
    const datos = datosParaCorregir(e, id); datos.entrego_puesto = "RESPONSABLE SINTETICO";
    corregirVale(e, id, datos, "Completar puesto del historial");
  });
  const reabierto = new Almacen(almacen.backend); await reabierto.iniciar();
  assert.equal(datosParaCorregir(reabierto.estado, id).entrego_puesto, "RESPONSABLE SINTETICO");
  const respaldo = await reabierto.respaldo(), restaurado = new Almacen(new BackendMemoria()); await restaurado.iniciar(); await restaurado.restaurar(respaldo.datos);
  assert.equal(datosParaCorregir(restaurado.estado, id).entrego_puesto, "RESPONSABLE SINTETICO");
  assert.ok(restaurado.estado.vales.find((v) => v.id === id).campos_encabezado_corregidos.includes("entrego_puesto"));
});
