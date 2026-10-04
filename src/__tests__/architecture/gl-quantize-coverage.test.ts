// src/__tests__/architecture/gl-quantize-coverage.test.ts
//
// Guard arquitectonico (ADR-058, SPEC-004 paso 3): todo archivo de produccion que
// verifica un asiento con `assertBalancedGLEntries(` DEBE cuantizarlo antes con
// `quantizeGLEntries(`. Verificar sin cuantizar deja pasar un asiento que se guarda
// con Σ != 0 a 4 decimales (bug de produccion: Σ = -0.0001).
//
// Regla ESTRICTA desde 2026-10-03 (SPEC-004 completa: los 21 servicios migrados): ningun
// archivo de produccion puede verificar un asiento sin cuantizarlo. Un servicio nuevo que
// llame assertBalancedGLEntries( debe llamar tambien quantizeGLEntries( (modo "exact" si el
// asiento deriva de saldos ya guardados: anulaciones, cierres, liquidaciones).
//
// Nota: no se importa el enmascarador de idempotency-key-tenant-scope.test.ts porque
// importar un archivo de test re-registraria todas sus suites aqui. Este enmascarador
// es minimo (comentarios y strings) y suficiente: solo busca llamadas `nombre(`.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");
const GL_ASSERTIONS_FILE = "src/lib/gl-assertions.ts";

// Ratchet: nº minimo de archivos que llaman assertBalancedGLEntries (medir antes de bajarlo).
const MIN_EXPECTED_CALLERS = 15;

/** Sustituye por espacios comentarios y strings ('…', "…", `…`), conservando offsets. */
function maskCommentsAndStrings(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < Math.min(to, src.length); k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      blank(start, i);
    } else if (c === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i = Math.min(i + 2, src.length);
      blank(start, i);
    } else if (c === "'" || c === '"') {
      // Corta en salto de linea: un apostrofo suelto no puede comerse el archivo.
      const start = i;
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      blank(start + 1, i);
      i++;
    } else if (c === "`") {
      const start = i;
      i++;
      while (i < src.length && src[i] !== "`") i += src[i] === "\\" ? 2 : 1;
      blank(start + 1, i);
      i++;
    } else {
      i++;
    }
  }
  return out.join("");
}

const callsFunction = (code: string, fn: string): boolean =>
  new RegExp(`(?<![\\w$.])${fn}\\s*(?:<[^()]*>)?\\s*\\(`).test(code);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(abs, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const FILES = walk(SRC).map((abs) => ({
  rel: path.relative(ROOT, abs).replace(/\\/g, "/"),
  code: maskCommentsAndStrings(fs.readFileSync(abs, "utf-8")),
}));

const CALLERS = FILES.filter(
  (f) => f.rel !== GL_ASSERTIONS_FILE && callsFunction(f.code, "assertBalancedGLEntries")
);

describe("Architecture: todo asiento verificado se cuantiza (ADR-058)", () => {
  it("el detector encuentra los archivos que llaman assertBalancedGLEntries (no pasa por vacio)", () => {
    expect(
      CALLERS.length,
      `Solo se encontraron ${CALLERS.length} archivos que llaman assertBalancedGLEntries(. ` +
        `Si la forma de la llamada cambio, ajusta el detector — no bajes el minimo.`
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_CALLERS);
  });

  it("todo archivo que llama assertBalancedGLEntries( tambien llama quantizeGLEntries( (ADR-058)", () => {
    const offenders = CALLERS.filter((f) => !callsFunction(f.code, "quantizeGLEntries")).map(
      (f) => f.rel
    );

    expect(
      offenders,
      `${offenders.length} de ${CALLERS.length} archivos verifican asientos con ` +
        `assertBalancedGLEntries( sin cuantizar con quantizeGLEntries( (ADR-058). Cuantiza antes de ` +
        `verificar y persistir (modo exact si deriva de saldos guardados):\n` +
        offenders.map((f) => `  - ${f}`).join("\n")
    ).toHaveLength(0);
  });

  it("los helpers del detector distinguen llamadas reales de menciones", () => {
    const m = (s: string) => callsFunction(maskCommentsAndStrings(s), "quantizeGLEntries");
    expect(m("const r = quantizeGLEntries(entries);")).toBe(true);
    expect(m("const r = quantizeGLEntries<Line>(entries);")).toBe(true);
    expect(m("// quantizeGLEntries(entries)")).toBe(false);
    expect(m('const s = "quantizeGLEntries(x)";')).toBe(false);
    expect(m("/* quantizeGLEntries( */ const x = 1;")).toBe(false);
    expect(m("import { quantizeGLEntries } from '@/lib/gl-assertions';")).toBe(false);
    expect(m("const r = notquantizeGLEntries(entries);")).toBe(false);
  });
});
