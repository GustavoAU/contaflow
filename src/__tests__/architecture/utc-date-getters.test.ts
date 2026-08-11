// src/__tests__/architecture/utc-date-getters.test.ts
//
// Guard del anti-patrón "construir en UTC y leer en local".
//
// Las fechas de NEGOCIO se persisten a medianoche UTC. Construir una fecha con
// `Date.UTC(...)` y leerla con un getter LOCAL devuelve el día anterior en zonas
// horarias negativas — Venezuela es UTC−4 — y el error es invisible en producción
// porque Vercel corre en UTC. Se detectó dos veces en retention.actions.ts:
//
//   new Date(Date.UTC(year, month, 0)).getDate()   // 30 en vez de 31
//
// Ese `lastDay` recortaba el período contable y hacía rechazar retenciones de
// facturas del último día del mes. Correcto: `.getUTCDate()`.
//
// Este test NO cubre la clase completa (leer con getters locales una fecha que
// viene de la BD); esa parte se corrigió con un barrido manual y no es detectable
// por texto. Ver la memoria "fechas-getters-locales-barrido-pendiente" para el
// criterio de clasificación.
//
// Environment: node (default)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";

const SRC = join(process.cwd(), "src");

/** Construcción con Date.UTC seguida de un getter LOCAL en la misma expresión. */
const ANTI_PATTERN = /new Date\(\s*Date\.UTC\([^;]*?\)\s*\)\s*\.get(?:Date|Month|FullYear|Hours)\(\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segunda mitad de la regla, en dirección contraria: derivar el DÍA de HOY
// pasando por UTC. `new Date().toISOString().slice(0, 10)` no es "hoy" sino "hoy
// en UTC", y en Venezuela (UTC−4) devuelve MAÑANA a partir de las 20:00. La noche
// del 31 devuelve el mes siguiente — otro período contable. Ver `src/lib/today.ts`.
//
// Se buscan las dos formas del idiom: `new Date().toISOString()` y la variante con
// variable intermedia (`const now = new Date(); … now.toISOString()`). NO se puede
// prohibir `x.toISOString().slice(0,10)` en general: sobre una fecha traída de la
// BD —guardada a medianoche UTC— es justamente lo correcto, y hay ~60 usos así.
const TODAY_VIA_UTC =
  /(?:new Date\(\)|\b(?:now|today|hoy)\b)\.toISOString\(\)\.(?:slice\(0,\s*(?:10|7)\)|split\("T"\)\[0\])/g;

/**
 * Archivos de SERVIDOR que aún resuelven "hoy" en UTC porque no tienen a mano el
 * país de la empresa; se arreglan en MP-4 (ADR-042), cuando el guard exponga
 * `ctx.country` y se pueda llamar a `todayInTimeZone(cfg.timezone)`.
 *
 * Impacto medido de lo que queda: los cinco reports solo redirigen a `?to=<hoy>`
 * (la cifra no cambia, la URL sí); `issueDate` es la fecha impresa en la
 * constancia; el `date` de exchange-rate se valida pero no se usa aguas abajo.
 *
 * Al cerrar MP-4 hay que VACIAR esta lista, no ampliarla.
 */
const PENDING_MP4 = new Set([
  "src/app/(dashboard)/company/[companyId]/reports/balance-sheet/page.tsx",
  "src/app/(dashboard)/company/[companyId]/reports/trial-balance/page.tsx",
  "src/app/(dashboard)/company/[companyId]/reports/ledger/page.tsx",
  "src/app/(dashboard)/company/[companyId]/reports/journal/page.tsx",
  "src/app/(dashboard)/company/[companyId]/reports/income-statement/page.tsx",
  "src/modules/exchange-rates/actions/exchange-rate.actions.ts",
  "src/modules/payroll/actions/payroll-reports.actions.ts",
]);

/**
 * Usos donde el día UTC es CORRECTO: claves de métrica y sellos de nombre de
 * archivo. No son fechas de negocio — ahí UTC es incluso preferible, porque no
 * depende de dónde corra el proceso.
 */
const UTC_IS_CORRECT = new Set([
  "src/lib/today.ts", // el propio fallback documentado
  "src/modules/retentions/actions/retention.actions.ts", // clave p2034:<company>:<día>
  "src/modules/invoices/services/InvoiceCreditDebitNoteService.ts", // ídem
  "src/modules/audit/actions/audit.actions.ts", // sello del nombre de archivo
  "src/modules/cajachica/actions/cajachica.actions.ts", // ídem
  "src/modules/accounting/actions/exportFinancialStatementPDF.actions.ts", // ídem
  "src/modules/receivables/services/AgingReportPDFService.ts", // ídem
  "src/modules/payroll/services/PayrollBankTxtService.ts", // ídem
]);

describe("Arquitectura: fechas UTC", () => {
  it("nadie deriva el día de HOY pasando por UTC", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(process.cwd(), file).split("\\").join("/");
      if (PENDING_MP4.has(rel) || UTC_IS_CORRECT.has(rel)) continue;

      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(TODAY_VIA_UTC)) {
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line} → ${match[0]}`);
      }
    }
    expect(
      offenders,
      "`new Date().toISOString()` da el día SIGUIENTE en husos negativos a partir " +
        "de las 20:00. En cliente usa todayLocalISO(); en servidor, " +
        "todayInTimeZone(getFiscalConfig(country).timezone). Ver src/lib/today.ts.\n" +
        offenders.join("\n"),
    ).toHaveLength(0);
  });

  // Anti-stale: si una entrada de las listas deja de tener el patrón, sobra. Sin
  // esto las listas crecen y nadie las poda — es el mismo trinquete de MP-3.
  it("las listas de excepción no tienen entradas obsoletas", () => {
    const stale: string[] = [];
    for (const rel of [...PENDING_MP4, ...UTC_IS_CORRECT]) {
      const full = join(process.cwd(), rel);
      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        stale.push(`${rel} (no existe)`);
        continue;
      }
      TODAY_VIA_UTC.lastIndex = 0;
      if (!TODAY_VIA_UTC.test(content)) stale.push(`${rel} (ya no usa el patrón)`);
    }
    expect(
      stale,
      "Entradas obsoletas en PENDING_MP4 / UTC_IS_CORRECT — bórralas:\n" + stale.join("\n"),
    ).toHaveLength(0);
  });

  it("nadie construye con Date.UTC y lee con un getter local", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(ANTI_PATTERN)) {
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(process.cwd(), file)}:${line} → ${match[0].slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      "Construir con Date.UTC y leer en local devuelve el día ANTERIOR en zonas " +
        "negativas (Venezuela, UTC−4). Usa getUTCDate/getUTCMonth/getUTCFullYear.\n" +
        offenders.join("\n"),
    ).toHaveLength(0);
  });
});
