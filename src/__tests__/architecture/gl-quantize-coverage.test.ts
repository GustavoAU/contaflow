// src/__tests__/architecture/gl-quantize-coverage.test.ts
//
// Guard arquitectonico (ADR-058, SPEC-004 paso 3): todo archivo de produccion que
// verifica un asiento con `assertBalancedGLEntries(` DEBE cuantizarlo antes con
// `quantizeGLEntries(`. Verificar sin cuantizar deja pasar un asiento que se guarda
// con Σ != 0 a 4 decimales (bug de produccion: Σ = -0.0001).
//
// TRINQUETE (ratchet): PENDING_ADOPTION es la lista de trabajo de los lotes de migracion
// (SPEC-004). Solo puede ENCOGERSE: al migrar un archivo hay que quitarlo de la lista
// (si no, el test falla pidiendolo), y un archivo nuevo que verifique sin cuantizar falla
// siempre. Al terminar el ultimo lote la lista queda vacia y el test es estricto.
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

/**
 * Archivos que aun NO cuantizan (inventario del 2026-10-03: 21). SPEC-004, lotes 1-3.
 * Quitar cada uno en el MISMO commit que lo migra. Meta: lista vacia.
 */
const PENDING_ADOPTION: string[] = [
  "src/modules/accounting/services/TransactionService.ts",
  "src/modules/cajachica/services/CajaCajaDepositService.ts",
  "src/modules/cajachica/services/CajaCajaReimbursementService.ts",
  "src/modules/cajachica/services/CajaCajaService.ts",
  "src/modules/exchange-rates/services/ExchangeDifferentialService.ts",
  "src/modules/fiscal-close/services/FiscalYearCloseService.ts",
  "src/modules/fixed-assets/services/FixedAssetDepreciationService.ts",
  "src/modules/fixed-assets/services/FixedAssetService.ts",
  "src/modules/income-distribution/services/IncomeDistributionService.ts",
  "src/modules/inflation/services/INPCService.ts",
  "src/modules/inventory/services/InventoryAccountingService.ts",
  "src/modules/payments/services/PaymentGLService.ts",
  "src/modules/retentions/actions/retention.actions.ts",
  "src/modules/retentions/services/RetentionService.ts",
];

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

  it("ningun archivo NUEVO verifica asientos sin cuantizar (los pendientes estan en PENDING_ADOPTION)", () => {
    const offenders = CALLERS.filter((f) => !callsFunction(f.code, "quantizeGLEntries")).map(
      (f) => f.rel
    );
    const unexpected = offenders.filter((f) => !PENDING_ADOPTION.includes(f));

    expect(
      unexpected,
      `Archivos que llaman assertBalancedGLEntries( sin quantizeGLEntries( y que NO estan en ` +
        `PENDING_ADOPTION (ADR-058). Cuantiza antes de verificar y persistir:\n` +
        unexpected.map((f) => `  - ${f}`).join("\n")
    ).toHaveLength(0);
  });

  it("PENDING_ADOPTION solo contiene archivos que de verdad siguen sin cuantizar (trinquete)", () => {
    const stillPending = new Set(
      CALLERS.filter((f) => !callsFunction(f.code, "quantizeGLEntries")).map((f) => f.rel)
    );
    const migrated = PENDING_ADOPTION.filter((f) => !stillPending.has(f));

    expect(
      migrated,
      `Estos archivos YA cuantizan (o dejaron de verificar): quitalos de PENDING_ADOPTION ` +
        `en el mismo commit que los migra:\n` +
        migrated.map((f) => `  - ${f}`).join("\n")
    ).toHaveLength(0);
  });

  it("avance de la migracion: archivos pendientes de cuantizar", () => {
    // Informativo en el log: cuando llegue a 0, borrar PENDING_ADOPTION y este test.
    expect(PENDING_ADOPTION.length).toBeLessThanOrEqual(21);
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
