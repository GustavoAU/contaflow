// src/__tests__/architecture/idempotency-key-tenant-scope.test.ts
//
// Guard arquitectónico: NINGÚN lookup filtrado por `idempotencyKey` puede
// omitir `companyId`.
//
// Por qué existe este archivo
// ───────────────────────────
// `idempotencyKey` es `@unique` GLOBAL en 10 modelos (Expense, InventoryMovement,
// InvoicePayment, Invoice, Retention, PaymentBatch, ...). En varios de esos
// modelos el valor lo suministra el CLIENTE (`z.string().uuid()` en el schema).
// Un `findUnique({ where: { idempotencyKey } })` sin `companyId` devuelve
// entonces la fila de OTRA empresa: la empresa B recibe el registro de A y su
// propio registro no se crea nunca. Fuga cross-tenant + corrupción silenciosa.
//
// El guard existente `company-isolation.test.ts` NO cubre esto: excluye
// `findUnique` del detector a propósito ("PK lookups acceptable by design — PK
// is globally unique"). La premisa falla justamente aquí, porque el `@unique`
// no es la PK y la clave no la genera el servidor. Este test cierra ese hueco.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");

// Ventana de líneas alrededor del filtro donde se acepta ver `companyId`
// (cubre `where` multilínea y bloques `AND: [...]`).
const WINDOW_BEFORE = 3;
const WINDOW_AFTER = 6;

// Nº mínimo de sitios que el detector DEBE encontrar. Si alguien rompe la
// heurística (o borra los lookups), este número cae y el test falla: impide que
// el guard se degrade en silencio a un test que no puede fallar.
const MIN_EXPECTED_SITES = 9;

type Site = { file: string; line: number; text: string; scoped: boolean };

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

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Detecta usos de `idempotencyKey` como FILTRO (dentro de un `where`), no como
 * dato de escritura (`data: { idempotencyKey: ... }`, que es legítimo).
 */
function findFilterSites(content: string, relPath: string): Site[] {
  const lines = content.split("\n");
  const sites: Site[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("idempotencyKey")) continue;
    if (isComment(line)) continue;

    // Contexto de filtro: `where` en la misma línea, o un `where: {` abierto en
    // alguna de las líneas inmediatamente anteriores.
    const sameLineWhere = /where\s*:/.test(line);
    const openWhereAbove = lines
      .slice(Math.max(0, i - WINDOW_BEFORE), i)
      .some((l) => /where\s*:\s*\{\s*$/.test(l));
    if (!sameLineWhere && !openWhereAbove) continue;

    const window = lines
      .slice(Math.max(0, i - WINDOW_BEFORE), Math.min(lines.length, i + WINDOW_AFTER))
      .filter((l) => !isComment(l))
      .join("\n");

    sites.push({
      file: relPath,
      line: i + 1,
      text: line.trim().slice(0, 140),
      scoped: window.includes("companyId"),
    });
  }

  return sites;
}

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const abs of walk(SRC)) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    sites.push(...findFilterSites(fs.readFileSync(abs, "utf-8"), rel));
  }
  return sites;
}

describe("Architecture: lookups por idempotencyKey acotados a companyId", () => {
  const sites = collectSites();

  it("el detector encuentra los sitios reales (no es un test que no puede fallar)", () => {
    expect(
      sites.length,
      `El detector solo encontró ${sites.length} filtros por idempotencyKey. ` +
        `Si el patrón cambió de forma, ajusta la heurística — no bajes el mínimo.`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_SITES);
  });

  it("ningún filtro por idempotencyKey omite companyId (IDOR cross-tenant)", () => {
    const violations = sites
      .filter((s) => !s.scoped)
      .map(
        (s) =>
          `[${s.file}:${s.line}] filtro por idempotencyKey SIN companyId — IDOR cross-tenant\n` +
          `  ${s.text}`,
      );

    expect(
      violations,
      `\`idempotencyKey\` es @unique GLOBAL y en varios modelos lo suministra el cliente.\n` +
        `Un lookup sin companyId devuelve la fila de otra empresa.\n\n${violations.join("\n\n")}`,
    ).toHaveLength(0);
  });

  it("los 3 sitios del IDOR corregido siguen acotados", () => {
    // Sentinelas explícitos: si alguien revierte uno de estos, falla con nombre
    // y apellido en vez de perderse en un conteo agregado.
    const REGRESSION_SITES = [
      "src/modules/expenses/services/ExpenseService.ts",
      "src/modules/inventory/services/InventoryOperationsService.ts",
      "src/modules/payments/services/PaymentBatchService.ts",
    ];

    for (const file of REGRESSION_SITES) {
      const own = sites.filter((s) => s.file === file);
      expect(own.length, `${file}: no se encontró el lookup por idempotencyKey`).toBeGreaterThan(0);
      for (const s of own) {
        expect(s.scoped, `${file}:${s.line} volvió a filtrar sin companyId`).toBe(true);
      }
    }
  });

  it("ningún findUnique busca por idempotencyKey sin companyId", () => {
    // `findUnique` sobre el `@unique` GLOBAL no se puede acotar por companyId
    // (Prisma solo admite campos únicos en su where) → hay que usar `findFirst`.
    // Queda permitido el selector compuesto de un `@@unique([companyId,
    // idempotencyKey])`, porque ahí el companyId SÍ forma parte de la clave:
    //   findUnique({ where: { companyId_idempotencyKey: { companyId, ... } } })
    const offenders: string[] = [];
    for (const abs of walk(SRC)) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
      const lines = fs.readFileSync(abs, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isComment(line)) continue;
        if (!/\.findUnique\s*\(/.test(line)) continue;
        const window = lines
          .slice(i, Math.min(lines.length, i + WINDOW_AFTER))
          .filter((l) => !isComment(l))
          .join("\n");
        if (window.includes("idempotencyKey") && !window.includes("companyId")) {
          offenders.push(`[${rel}:${i + 1}] ${line.trim().slice(0, 140)}`);
        }
      }
    }

    expect(
      offenders,
      `findUnique por idempotencyKey sin companyId → usar findFirst acotado (o el selector compuesto companyId_idempotencyKey):\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});
