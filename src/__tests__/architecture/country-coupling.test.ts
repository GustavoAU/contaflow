// src/__tests__/architecture/country-coupling.test.ts
// ADR-042 D-11 — Ratchet de acoplamiento por país.
//
// PROBLEMA QUE RESUELVE
//   La auditoría multi-país encontró que el esqueleto Q3-5 existía pero nadie lo
//   usaba: los módulos importaban los alias `VEN_*` o duplicaban las alícuotas
//   como literales. Sin un guard, cada feature nueva vuelve a acoplar el core a
//   Venezuela más rápido de lo que las fases MP-4..MP-11 lo desacoplan.
//
// CÓMO FUNCIONA (ratchet / trinquete)
//   1. Prohíbe las referencias VEN-only y los literales de alícuota en código
//      de producción.
//   2. Los archivos que HOY las tienen viven en una whitelist con dos secciones:
//        PERMANENT — legítimos para siempre (el perfil VEN, sus re-exports y los
//                    módulos 100% venezolanos, que se apagan enteros por
//                    capability en vez de parametrizarse).
//        TEMPORAL  — deuda conocida, cada entrada anotada con la fase que la
//                    elimina.
//   3. ANTI-STALE: el test también falla si una entrada TEMPORAL ya NO tiene
//      violaciones. Eso obliga a que cada fase encoja la lista al mergear —
//      es lo que convierte la whitelist en un trinquete y no en un basurero.
//
//   Meta: MP-13 deja TEMPORAL vacía.
//
// La regla del RIF tiene su propio guard más específico en
// `rif-regex-single-source.test.ts` (una sola ubicación autorizada para definir
// la regex). Este test cubre el uso; aquel cubre la definición.
//
// Environment: node (default)

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());

// ── Reglas ────────────────────────────────────────────────────────────────────

type Rule = { id: string; pattern: RegExp; hint: string };

const RULES: Rule[] = [
  {
    id: "ven-alias",
    // Alias VEN-only de tax-config: el código país-neutral debe resolver la
    // config en runtime desde el país de la empresa.
    pattern: /\b(VEN_RIF_REGEX|VEN_TAX_RATES|VEN_CONTROL_NUMBER_REGEX|VEN_FISCAL_CONFIG|validateVenezuelanRif)\b/,
    hint: 'usa getFiscalConfig(ctx.country) de "@/lib/countries" en vez del alias VEN',
  },
  {
    id: "rate-literal",
    // Alícuotas venezolanas escritas a mano. Solo fracciones decimales entre
    // comillas: los porcentajes enteros ("16") son demasiado genéricos para
    // distinguirlos de cualquier otro número.
    pattern: /["'](?:0\.16|0\.08|0\.31|0\.15|0\.03)["']/,
    hint: "toma la alícuota de cfg.taxRates / cfg.taxLineRates, no la escribas a mano",
  },
];

// ── Whitelist ─────────────────────────────────────────────────────────────────

/**
 * PERMANENT — prefijos de ruta legítimos de forma indefinida.
 *
 * Dos categorías:
 *  a) el perfil fiscal de Venezuela y sus re-exports: son los DUEÑOS de estos
 *     valores, tienen que escribirlos en algún lado;
 *  b) módulos 100 % venezolanos: retenciones, IGTF, declaración IVA, INPC,
 *     despacho, validación de RIF contra el padrón y nómina. Para estos NO se
 *     parametriza nada — el país que no tenga la figura simplemente no ve el
 *     módulo (capability flags, ADR-042 D-5).
 *
 * No se les aplica el chequeo anti-stale: un módulo VEN-only puede dejar de
 * tener literales sin dejar de ser VEN-only.
 */
const PERMANENT: string[] = [
  // (a) perfil VEN + re-exports
  "src/lib/countries/",
  "src/lib/tax-config.ts",
  "src/lib/fiscal-provider.ts",
  "src/lib/fiscal-validators.ts",
  // (b) módulos 100 % venezolanos
  "src/modules/retentions/",
  "src/components/retentions/",
  "src/modules/igtf/",
  "src/components/igtf/",
  "src/modules/iva-declaration/",
  "src/modules/inflation/",
  "src/modules/despacho/",
  "src/modules/rif-validation/",
  "src/modules/payroll/",
  "src/lib/islr-suggestions.ts",
  "src/lib/fiscal-calendar.ts",
];

/**
 * TEMPORAL — deuda conocida. Cada entrada dice qué fase la elimina.
 * Al completar una fase: borrar sus entradas. Si sobra alguna, el test avisa.
 */
const TEMPORAL: Record<string, string> = {
  // MP-4 — al activar Company.country, el alta de empresa resuelve la config
  // del país elegido en vez de asumir Venezuela.
  "src/modules/company/actions/company.actions.ts": "MP-4",
  "src/components/company/NewCompanyForm.tsx": "MP-4",

  // MP-5a/5b — schema factories: la regex sale de la config, no del alias.
  "src/modules/invoices/schemas/invoice.schema.ts": "MP-5a",
  "src/modules/vendors/schemas/vendor.schemas.ts": "MP-5b",
  "src/modules/cajachica/schemas/cajachica.schema.ts": "MP-5b",

  // MP-6 — servicios y actions reciben las alícuotas por parámetro.
  "src/modules/invoices/services/InvoiceLineService.ts": "MP-6",
  "src/modules/invoices/actions/invoice-batch.actions.ts": "MP-6",
  "src/modules/expenses/actions/expense.actions.ts": "MP-6",
  "src/modules/orders/services/OrderService.ts": "MP-6",
  "src/modules/ocr/services/GeminiOCRService.ts": "MP-6",
  "src/modules/payments/services/PaymentService.ts": "MP-6",
  "src/modules/payments/services/PaymentBatchService.ts": "MP-6",
  "src/modules/bank-reconciliation/services/BankReconciliationService.ts": "MP-6",
  "src/modules/fixed-assets/services/FixedAssetDepreciationService.ts": "MP-6",
  "src/modules/fixed-assets/services/disposal-preview.ts": "MP-6",

  // MP-7 — componentes cliente leen la config del FiscalUIProvider.
  "src/components/invoices/RifInput.tsx": "MP-7",
  "src/modules/orders/components/OrderList.tsx": "MP-7",
  "src/modules/payments/components/PaymentForm.tsx": "MP-7",
  "src/modules/payments/components/PaymentBatchForm.tsx": "MP-7",
  "src/modules/receivables/components/RecordPaymentDialog.tsx": "MP-7",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Ruta relativa con separadores POSIX (el repo se trabaja en Windows) */
function rel(abs: string): string {
  return abs.replace(ROOT + path.sep, "").replace(/\\/g, "/");
}

/** Descarta comentarios: documentar una alícuota no es acoplarse a ella */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

type Violation = { file: string; line: number; rule: string; text: string; hint: string };

/** Detector puro — separado del walk del FS para poder testearlo con fixtures */
function findInContent(relPath: string, content: string): Violation[] {
  const found: Violation[] = [];
  content.split("\n").forEach((line, i) => {
    if (isComment(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        found.push({
          file: relPath,
          line: i + 1,
          rule: rule.id,
          text: line.trim().slice(0, 120),
          hint: rule.hint,
        });
      }
    }
  });
  return found;
}

function scan(): { violations: Violation[]; filesWithViolations: Set<string> } {
  const files = collectSourceFiles(path.join(ROOT, "src")).filter(
    (f) => !f.startsWith(path.join(ROOT, "src", "__tests__")),
  );

  const violations: Violation[] = [];
  const filesWithViolations = new Set<string>();

  for (const file of files) {
    const relPath = rel(file);
    const found = findInContent(relPath, fs.readFileSync(file, "utf-8"));
    for (const v of found) {
      violations.push(v);
      filesWithViolations.add(relPath);
    }
  }

  return { violations, filesWithViolations };
}

const isPermanent = (relPath: string) => PERMANENT.some((p) => relPath.startsWith(p));
const isTemporal = (relPath: string) => Object.hasOwn(TEMPORAL, relPath);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Arquitectura: acoplamiento por país (ADR-042 D-11)", () => {
  const { violations, filesWithViolations } = scan();

  it("ningún archivo fuera de la whitelist se acopla a Venezuela", () => {
    const offenders = violations.filter(
      (v) => !isPermanent(v.file) && !isTemporal(v.file),
    );

    const detail = offenders
      .map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}\n      → ${v.hint}`)
      .join("\n");

    expect(
      offenders,
      "Acoplamiento nuevo a Venezuela en código país-neutral.\n" +
        "Resuelve la config con getFiscalConfig(ctx.country), o si el módulo es\n" +
        "100% venezolano agrégalo a PERMANENT en este archivo.\n" +
        detail,
    ).toHaveLength(0);
  });

  it("la whitelist TEMPORAL no tiene entradas obsoletas (ratchet)", () => {
    const stale = Object.keys(TEMPORAL).filter((f) => !filesWithViolations.has(f));

    expect(
      stale,
      "Estas entradas de TEMPORAL ya no tienen acoplamiento: bórralas de la\n" +
        "whitelist para que el trinquete no retroceda.\n" +
        stale.map((f) => `  ${f}  (${TEMPORAL[f]})`).join("\n"),
    ).toHaveLength(0);
  });

  it("PERMANENT y TEMPORAL no se solapan", () => {
    const overlap = Object.keys(TEMPORAL).filter(isPermanent);
    expect(
      overlap,
      `Rutas en TEMPORAL cubiertas también por PERMANENT (la deuda nunca se cerraría):\n${overlap.join("\n")}`,
    ).toHaveLength(0);
  });

  it("las entradas de TEMPORAL apuntan a archivos existentes", () => {
    const missing = Object.keys(TEMPORAL).filter(
      (f) => !fs.existsSync(path.join(ROOT, f.replace(/\//g, path.sep))),
    );
    expect(
      missing,
      `Entradas de TEMPORAL que ya no existen (renombradas o borradas):\n${missing.join("\n")}`,
    ).toHaveLength(0);
  });

  it("cada entrada de TEMPORAL declara la fase que la elimina", () => {
    const bad = Object.entries(TEMPORAL).filter(([, phase]) => !/^MP-\d+[ab]?$/.test(phase));
    expect(
      bad,
      `Entradas sin fase válida (formato MP-N):\n${bad.map(([f, p]) => `  ${f} → "${p}"`).join("\n")}`,
    ).toHaveLength(0);
  });

  it("reporta el tamaño de la deuda pendiente", () => {
    const pending = Object.keys(TEMPORAL).length;
    // Snapshot informativo: si sube, alguien añadió acoplamiento nuevo y lo
    // whitelisteó en vez de resolverlo. Bajar este número es el objetivo.
    expect(pending).toBeLessThanOrEqual(20);
  });
});

// ── El detector realmente detecta ────────────────────────────────────────────
// Un guard que solo se ha visto pasar puede estar pasando en vacío. Estos tests
// ejercitan el detector contra fixtures sintéticas para probar lo contrario.

describe("country-coupling: el detector funciona", () => {
  const check = (code: string) => findInContent("src/fake.ts", code);

  it("detecta cada alias VEN prohibido", () => {
    for (const alias of [
      "VEN_RIF_REGEX",
      "VEN_TAX_RATES",
      "VEN_CONTROL_NUMBER_REGEX",
      "VEN_FISCAL_CONFIG",
      "validateVenezuelanRif",
    ]) {
      const hits = check(`import { ${alias} } from "@/lib/tax-config";`);
      expect(hits.map((h) => h.rule), alias).toContain("ven-alias");
    }
  });

  it("detecta cada alícuota venezolana escrita a mano", () => {
    for (const rate of ["0.16", "0.08", "0.31", "0.15", "0.03"]) {
      const dquote = check(`const iva = base.mul("${rate}");`);
      const squote = check(`const iva = base.mul('${rate}');`);
      expect(dquote.map((h) => h.rule), rate).toContain("rate-literal");
      expect(squote.map((h) => h.rule), rate).toContain("rate-literal");
    }
  });

  it("reporta el número de línea correcto", () => {
    const hits = check(['const a = 1;', 'const b = 2;', 'const c = VEN_TAX_RATES;'].join("\n"));
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("ignora comentarios de línea, de bloque y JSDoc", () => {
    expect(check('// usa VEN_TAX_RATES aquí')).toHaveLength(0);
    expect(check('/** IVA general (VEN: "0.16") */')).toHaveLength(0);
    expect(check(' * evita "0.16" hardcodeado')).toHaveLength(0);
    expect(check('/* VEN_RIF_REGEX */')).toHaveLength(0);
  });

  it("no marca código país-neutral correcto", () => {
    expect(check('const cfg = getFiscalConfig(ctx.country);')).toHaveLength(0);
    expect(check('const iva = base.mul(cfg.taxRates.ivaGeneral);')).toHaveLength(0);
    expect(check('const pct = cfg.taxLineRates.IVA_GENERAL.percent;')).toHaveLength(0);
  });

  it("no confunde alícuotas con otros decimales ni con subcadenas", () => {
    // Números que no son las alícuotas venezolanas
    expect(check('const x = "0.165";')).toHaveLength(0);
    expect(check('const y = "10.16";')).toHaveLength(0);
    expect(check('const z = "0.5";')).toHaveLength(0);
    // Identificadores que contienen el alias como subcadena
    expect(check('const MY_VEN_TAX_RATES_COPY = 1;')).toHaveLength(0);
  });
});
