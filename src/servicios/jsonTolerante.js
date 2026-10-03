// Lector de JSON tolerante para lo que se pega de un asistente de IA. El asistente a veces deja el
// bloque sin cerrar (se corta la respuesta), olvida comas, pone comas de más, comillas
// tipográficas o sencillas, claves sin comillas, True/None de Python, comentarios… En lugar de
// rendirse, este lector entiende lo que puede y anota qué arregló, para que el usuario no se
// quede atorado. No usa eval ni nada parecido: recorre el texto carácter por carácter.

export class ErrorJson extends Error {}

// Objetos que se cerraron porque el texto se acabó (la respuesta venía cortada).
const INCOMPLETOS = new WeakSet();
export const estaIncompleto = (objeto) => objeto !== null && typeof objeto === "object" && INCOMPLETOS.has(objeto);

// Comilla de apertura → comillas que la cierran.
const CIERRES = {
  '"': ['"'],
  "'": ["'"],
  "“": ["”", '"', "“"],
  "”": ["”", '"', "“"],
  "„": ["“", "”", '"'],
  "‘": ["’", "'"],
  "’": ["’", "'"],
};
const esComilla = (c) => c in CIERRES;
const LITERALES = { true: true, false: false, null: null, none: null, undefined: null, nan: null, verdadero: true, falso: false };
const NUMERO = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/;
const CLAVE_SUELTA = /^[A-Za-z_À-ɏ][\wÀ-ɏ]*\s*:/;
const TEXTO_SUELTO = /^"[^"\n]*"\s*[:,}\]]/;
const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "/": "/", "\\": "\\", '"': '"', "'": "'" };

class Lector {
  constructor(texto) {
    this.s = texto;
    this.i = 0;
    this.arreglos = new Set();
  }

  get fin() {
    return this.i >= this.s.length;
  }

  get c() {
    return this.s[this.i];
  }

  nota(texto) {
    this.arreglos.add(texto);
  }

  espacios() {
    while (!this.fin) {
      const c = this.c;
      if (/\s/.test(c) || c === "﻿" || c === "​") {
        this.i += 1;
      } else if (c === "/" && this.s[this.i + 1] === "/") {
        const n = this.s.indexOf("\n", this.i);
        this.i = n < 0 ? this.s.length : n + 1;
        this.nota("tenía comentarios");
      } else if (c === "/" && this.s[this.i + 1] === "*") {
        const n = this.s.indexOf("*/", this.i + 2);
        this.i = n < 0 ? this.s.length : n + 2;
        this.nota("tenía comentarios");
      } else if (c === "`") {
        // Restos de ``` dentro del bloque.
        while (this.c === "`") this.i += 1;
        while (!this.fin && /[a-z]/i.test(this.c)) this.i += 1;
      } else break;
    }
  }

  valor() {
    this.espacios();
    if (this.fin) return null;
    const c = this.c;
    if (c === "{") return this.objeto();
    if (c === "[") return this.lista();
    if (esComilla(c)) return this.cadena();
    const numero = NUMERO.exec(this.s.slice(this.i, this.i + 40));
    if (numero) {
      const sigue = this.s[this.i + numero[0].length];
      if (sigue === undefined || /[\s,}\]]/.test(sigue)) {
        this.i += numero[0].length;
        return Number(numero[0]);
      }
    }
    return this.palabra();
  }

  /** Texto sin comillas hasta el siguiente separador (PZA, True, None…). */
  palabra() {
    const inicio = this.i;
    while (!this.fin && !/[,}\]\n]/.test(this.c)) this.i += 1;
    if (this.i === inicio) this.i += 1; // siempre avanza
    const t = this.s.slice(inicio, this.i).trim();
    const literal = t.toLowerCase();
    if (literal in LITERALES) {
      if (t !== literal || !["true", "false", "null"].includes(literal)) this.nota("tenía valores escritos de otra forma (True, None…)");
      return LITERALES[literal];
    }
    this.nota("tenía textos sin comillas");
    return t;
  }

  cadena() {
    const abre = this.c;
    const cierres = CIERRES[abre];
    if (abre !== '"') this.nota("tenía comillas tipográficas o sencillas");
    this.i += 1;
    let salida = "";
    while (!this.fin) {
      const c = this.c;
      if (c === "\\") {
        const e = this.s[this.i + 1];
        if (e === "u" && /^[0-9a-f]{4}$/i.test(this.s.slice(this.i + 2, this.i + 6))) {
          salida += String.fromCharCode(parseInt(this.s.slice(this.i + 2, this.i + 6), 16));
          this.i += 6;
        } else {
          salida += e === undefined ? "" : (ESCAPES[e] ?? e);
          this.i += 2;
        }
        continue;
      }
      if (cierres.includes(c)) {
        // ¿Cierra o es una comilla dentro del texto (6" sin escapar)? Cierra si lo que sigue es un separador.
        let j = this.i + 1;
        while (j < this.s.length && (this.s[j] === " " || this.s[j] === "\t")) j += 1;
        const sigue = this.s[j];
        // También cierra si sigue otra clave o texto sin la coma de en medio ("701" cantidad: 1).
        const resto = this.s.slice(j, j + 80);
        const faltaComa = j > this.i + 1 && (CLAVE_SUELTA.test(resto) || TEXTO_SUELTO.test(resto));
        if (sigue === undefined || /[,}\]:\r\n]/.test(sigue) || faltaComa) {
          if (faltaComa) this.nota("le faltaban comas");
          this.i += 1;
          return salida;
        }
        this.nota("tenía comillas sin escapar dentro de un texto");
        salida += c;
        this.i += 1;
        continue;
      }
      if (c === "\n") {
        // Un texto JSON no cruza renglones: se quedó sin cerrar.
        this.nota("tenía comillas sin cerrar");
        return salida.trimEnd();
      }
      salida += c;
      this.i += 1;
    }
    this.nota("venía cortada");
    return salida;
  }

  clave() {
    if (esComilla(this.c)) return this.cadena();
    const inicio = this.i;
    while (!this.fin && !/[:=,{}[\]\s]/.test(this.c)) this.i += 1;
    if (this.i === inicio) {
      this.i += 1;
      return null;
    }
    this.nota("tenía nombres sin comillas");
    return this.s.slice(inicio, this.i);
  }

  objeto() {
    this.i += 1;
    const objeto = {};
    for (;;) {
      this.espacios();
      if (this.fin) {
        this.nota("venía cortada");
        INCOMPLETOS.add(objeto);
        return objeto;
      }
      const c = this.c;
      if (c === "}") {
        this.i += 1;
        return objeto;
      }
      if (c === "]") {
        this.nota("tenía llaves y corchetes cruzados");
        this.i += 1;
        return objeto;
      }
      if (c === ",") {
        this.i += 1;
        continue;
      }
      const clave = this.clave();
      if (clave === null) continue;
      this.espacios();
      if (this.c === ":" || this.c === "=") this.i += 1;
      else this.nota("le faltaban dos puntos");
      this.espacios();
      if (this.fin) {
        objeto[clave] = "";
        this.nota("venía cortada");
        INCOMPLETOS.add(objeto);
        return objeto;
      }
      objeto[clave] = this.c === "," || this.c === "}" ? null : this.valor();
      this.separador("}");
    }
  }

  lista() {
    this.i += 1;
    const lista = [];
    for (;;) {
      this.espacios();
      if (this.fin) {
        this.nota("venía cortada");
        return lista;
      }
      const c = this.c;
      if (c === "]") {
        this.i += 1;
        return lista;
      }
      if (c === "}") {
        this.nota("tenía llaves y corchetes cruzados");
        this.i += 1;
        return lista;
      }
      if (c === ",") {
        this.i += 1;
        continue;
      }
      lista.push(this.valor());
      this.separador("]");
    }
  }

  separador(cierre) {
    this.espacios();
    if (this.fin) return;
    if (this.c === ",") {
      this.i += 1;
      this.espacios();
      if (this.c === cierre) this.nota("tenía comas de más");
    } else if (this.c !== cierre && this.c !== "}" && this.c !== "]") this.nota("le faltaban comas");
  }
}

const NOTAS_LEVES = new Set(["tenía comas de más", "tenía comentarios"]);

/**
 * Lee el primer valor JSON (objeto o lista) que haya en el texto, arreglando lo que se pueda.
 * @returns {{ valor, arreglos: [texto] }} arreglos = qué se corrigió (vacío si venía bien)
 */
export function leerJsonTolerante(texto) {
  const t = String(texto ?? "");
  const inicio = t.search(/[{[]/);
  if (inicio < 0) throw new ErrorJson("No hay un objeto JSON en el texto.");
  // Si el JSON viene bien, se lee tal cual (más rápido y sin sorpresas).
  try {
    const fin = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (fin > inicio) return { valor: JSON.parse(t.slice(inicio, fin + 1)), arreglos: [] };
  } catch {
    // sigue con el lector tolerante
  }
  const lector = new Lector(t);
  lector.i = inicio;
  const valor = lector.valor();
  return { valor, arreglos: [...lector.arreglos].filter((a) => !NOTAS_LEVES.has(a)) };
}
