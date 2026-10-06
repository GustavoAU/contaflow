// src/__tests__/architecture/gl-entry-creators-quantize.test.ts
//
// Guard arquitectónico (SPEC-001 / ADR-058 / ADR-060): todo archivo de producción que CREA líneas de
// asiento (`entries: { create: … }` anidado en una Transaction, o `journalEntry.create` /
// `createMany`) debe pasar esas líneas por `quantizeGLEntries(`.
//
// Por qué existe: `gl-quantize-coverage.test.ts` solo mira a quien YA llama
// `assertBalancedGLEntries(`; no ve a quien debió llamarlo y no lo hace. La causación de facturas
// (`InvoiceGLPostingService`) era justo ese caso: creaba asientos sin cuantizar ni verificar el
// cuadre, y con el trigger de cuadre de la BD (T = 0) un total con más de 2 decimales habría hecho
// fallar el COMMIT en producción. Este test cierra la clase de bug: un generador de asientos nuevo
// que olvide cuantizar rompe el build, no la producción.
//
// Los asientos derivados de lo ya guardado usan `quantizeGLEntries(…, { mode: "exact" })`, que
// también cuenta: lo que se prohíbe es no pasar por la función central.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const SRC = path.join(path.resolve(process.cwd()), "src");

/** Archivos que NO crean asientos aunque contengan el patrón (gates que leen `entries`, la propia lib). */
const NOT_CREATORS = new Set([
  "src/lib/gl-assertions.ts",
  "src/lib/prisma-tercero-required-gate.ts",
  "src/lib/prisma-postable-account-gate.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => path.relative(path.resolve(process.cwd()), f).split(path.sep).join("/");

// `entries: { create:` (nested write) o `journalEntry.create(` / `.createMany(`.
const CREATES_ENTRIES = /entries:\s*\{\s*create\s*:|journalEntry\.(create|createMany)\s*\(/;

describe("Architecture: todo creador de líneas de asiento cuantiza (SPEC-001 / ADR-060)", () => {
  const creators = walk(SRC)
    .map((f) => ({ file: rel(f), text: fs.readFileSync(f, "utf8") }))
    .filter(({ file, text }) => !NOT_CREATORS.has(file) && CREATES_ENTRIES.test(text));

  it("el recorrido encuentra a los generadores conocidos (ratchet: no se queda mirando vacío)", () => {
    // Medido 2026-10-05: 22 archivos. Si baja mucho, el patrón dejó de coincidir y el test mentiría.
    expect(creators.length).toBeGreaterThanOrEqual(18);
    expect(creators.map((c) => c.file)).toContain(
      "src/modules/invoices/services/InvoiceGLPostingService.ts"
    );
  });

  it("ningún archivo que cree líneas de asiento deja de llamar quantizeGLEntries(", () => {
    const sinCuantizar = creators
      .filter(({ text }) => !/quantizeGLEntries\s*\(/.test(text))
      .map((c) => c.file);
    expect(sinCuantizar).toEqual([]);
  });
});
