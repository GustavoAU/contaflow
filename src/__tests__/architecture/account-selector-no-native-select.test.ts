// src/__tests__/architecture/account-selector-no-native-select.test.ts
//
// SPEC-012 · CA-limpieza (Entrega B1, modo RED) — trinquete contra volver a un selector de lista de
// cuentas. El selector buscable (`AccountCombobox`) reemplaza al <select> nativo y al `Select` de Radix
// en TODOS los formularios que eligen una cuenta contable; este test impide que se vuelva a escribir
// `<option>{a.code} — {a.name}</option>` (o su `SelectItem`) y obliga a sacar de la lista cerrada de
// «pendientes» cada archivo que se migra.
//
// Qué detecta (texto, sin compilar): un elemento `<option …>…</option>` o `<SelectItem …>…</SelectItem>`
// cuyo contenido tiene `<identificador>.code` seguido de `—` (el patrón `{a.code} — {a.name}`). Es el
// detector «ligero» pedido: solo lee los .tsx que no son tests y se salta los que no mencionan `.code`
// (otro test de arquitectura, `idempotency-key-tenant-scope`, da timeouts de 5 s por recorrer todo `src`).
//
// Listas (cerradas: un archivo nuevo con el patrón NO se agrega aquí, se migra al combobox):
//  · PENDING_MIGRATION — siguen con <select>/Select (Entregas B2/B3 de SPEC-012 y la spec propia de
//    IncomeDistribution). El test falla si un archivo de esta lista YA NO contiene el patrón: al migrarlo
//    hay que quitarlo de aquí (así la lista solo se encoge).
//  · INTENTIONAL — casos que NO son «elegir una cuenta de movimiento»: «Cuenta padre» de AccountsTable
//    elige TÍTULOS a propósito (SPEC-008). El `Select` de «Tipo» de JournalEntryForm no es de cuentas y
//    no contiene `.code`, así que el detector ni lo ve (se comprueba abajo).
//
// Environment: node (default)

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const TIMEOUT = 30_000;

/** Siguen sin migrar: se quitan de aquí SOLO al migrarlos (el test lo exige). */
const PENDING_MIGRATION: ReadonlySet<string> = new Set([
  "src/modules/fixed-assets/components/FixedAssetForm.tsx",
  "src/modules/fixed-assets/components/DisposeAssetModal.tsx",
  "src/modules/fixed-assets/components/FixedAssetList.tsx",
  "src/modules/fiscal-close/components/FiscalConfigForm.tsx",
  "src/modules/settings/components/GLAccountsForm.tsx",
  "src/modules/payroll/components/PayrollWizard.tsx",
  "src/modules/inventory/components/InventoryItemForm.tsx",
  "src/modules/inventory/components/MovementForm.tsx",
  "src/modules/income-distribution/components/IncomeDistributionForm.tsx",
]);

/** Casos intencionales: listan TÍTULOS o no son cuentas del plan. */
const INTENTIONAL: ReadonlySet<string> = new Set([
  "src/components/accounting/AccountsTable.tsx", // «Cuenta padre (título)»: elige títulos a propósito
]);

// ─── Detector ────────────────────────────────────────────────────────────────────────────────────

/** `<option …>contenido</option>` o `<SelectItem …>contenido</SelectItem>` (el contenido puede abarcar líneas). */
const OPTION_ELEMENT = /<(option|SelectItem)\b[^>]*>([\s\S]*?)<\/\1>/g;

/**
 * `{a.code} —`, `{acc.code} —`, `{account.code} —`, `${parent.code} —`, `{row.account.code} —`,
 * `{acct?.code} —`, `{list[0].code} —`… (con `&mdash;` también): cualquier `<algo>.code` seguido de «—».
 */
const CODE_THEN_DASH = /[\w$\])]\??\.code\b[^<]{0,40}?(?:—|&mdash;)/;

/** Líneas (1-based) donde un <option>/<SelectItem> muestra una cuenta como «código — nombre». */
function accountOptionLines(content: string): number[] {
  if (!content.includes(".code")) return [];
  const lines: number[] = [];
  for (const match of content.matchAll(OPTION_ELEMENT)) {
    if (CODE_THEN_DASH.test(match[2])) {
      lines.push(content.slice(0, match.index).split("\n").length);
    }
  }
  return lines;
}

// ─── Recorrido ───────────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type Scan = { files: number; hits: Map<string, number[]> };
let cached: Scan | null = null;

/** Un solo recorrido por ejecución (el árbol de `src` no cambia mientras corre el test). */
function scan(): Scan {
  if (cached) return cached;
  const hits = new Map<string, number[]>();
  const files = walk(SRC);
  for (const file of files) {
    const rel = relative(process.cwd(), file).split("\\").join("/");
    const lines = accountOptionLines(readFileSync(file, "utf8"));
    if (lines.length > 0) hits.set(rel, lines);
  }
  cached = { files: files.length, hits };
  return cached;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("Arquitectura: ningún selector de cuenta es un <select>/Select de lista (SPEC-012 CA-limpieza)", () => {
  it(
    "ningún archivo fuera de la lista de pendientes renderiza una cuenta como <option>/SelectItem «código — nombre»",
    () => {
      const offenders: string[] = [];
      for (const [file, lines] of scan().hits) {
        if (PENDING_MIGRATION.has(file) || INTENTIONAL.has(file)) continue;
        offenders.push(`${file}:${lines.join(",")}`);
      }
      expect(
        offenders,
        "Estos archivos eligen una cuenta con <option>/SelectItem `{a.code} — {a.name}`. Usa " +
          "`AccountCombobox` (src/components/accounting/AccountCombobox.tsx): busca por código o " +
          "nombre y muestra los títulos como encabezados no elegibles.\n" +
          offenders.join("\n")
      ).toEqual([]);
    },
    TIMEOUT
  );

  // Trinquete: la lista de pendientes solo puede encogerse.
  it(
    "la lista de pendientes no tiene entradas obsoletas: cada archivo existe y TODAVÍA tiene el patrón",
    () => {
      const stale: string[] = [];
      for (const rel of PENDING_MIGRATION) {
        let content: string;
        try {
          content = readFileSync(join(process.cwd(), rel), "utf8");
        } catch {
          stale.push(`${rel} (no existe)`);
          continue;
        }
        if (accountOptionLines(content).length === 0) stale.push(`${rel} (ya no usa el patrón)`);
      }
      expect(
        stale,
        "Ya migraste estos archivos al combobox: quítalos de PENDING_MIGRATION para que el " +
          "trinquete los proteja.\n" +
          stale.join("\n")
      ).toEqual([]);
    },
    TIMEOUT
  );

  it(
    "los casos intencionales siguen existiendo y siguen siendo lo que dicen (AccountsTable lista títulos como «Cuenta padre»)",
    () => {
      const stale: string[] = [];
      for (const rel of INTENTIONAL) {
        let content: string;
        try {
          content = readFileSync(join(process.cwd(), rel), "utf8");
        } catch {
          stale.push(`${rel} (no existe)`);
          continue;
        }
        if (accountOptionLines(content).length === 0) stale.push(`${rel} (ya no usa el patrón)`);
      }
      expect(stale, stale.join("\n")).toEqual([]);
    },
    TIMEOUT
  );

  it(
    "ningún archivo está a la vez en las dos listas",
    () => {
      const both = [...PENDING_MIGRATION].filter((f) => INTENTIONAL.has(f));
      expect(both).toEqual([]);
    },
    TIMEOUT
  );

  it(
    "el recorrido ve el árbol de src (no pasa «en vacío») y el selector de «Tipo» de JournalEntryForm no se marca",
    () => {
      const { files, hits } = scan();
      expect(files).toBeGreaterThan(100);
      expect(hits.size).toBeGreaterThanOrEqual(PENDING_MIGRATION.size);
      expect(hits.has("src/components/accounting/JournalEntryForm.tsx")).toBe(false);
    },
    TIMEOUT
  );

  it(
    "los archivos de la Entrega B1 ya no renderizan una cuenta como <option>/SelectItem",
    () => {
      const b1 = [
        "src/components/retentions/RetentionList.tsx",
        "src/modules/bank-reconciliation/components/BankAccountList.tsx",
        "src/modules/budgets/components/BudgetDetail.tsx",
        "src/modules/inflation/components/InflationAdjustmentPanel.tsx",
        "src/app/(dashboard)/company/[companyId]/cajachica/CajaCajaPageClient.tsx",
        "src/modules/cajachica/components/CajaCajaDepositForm.tsx",
        "src/modules/cajachica/components/CajaCajaMovementForm.tsx",
        "src/modules/cajachica/components/CajaCajaList.tsx",
      ];
      const still = b1.filter((rel) => scan().hits.has(rel));
      expect(still, `siguen con <option>/SelectItem de cuentas:\n${still.join("\n")}`).toEqual([]);
    },
    TIMEOUT
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// El propio detector: si alguien lo debilita (p. ej. un regex que ya no ve el SelectItem de Radix o el
// contenido en varias líneas), el test de arriba pasaría «en vacío». Estos casos lo impiden.
describe("Arquitectura: el detector de <option>/SelectItem de cuentas", () => {
  const detects = (src: string) => accountOptionLines(src).length > 0;

  it("ve el <option> nativo con {a.code} — {a.name}", () => {
    expect(detects("<option key={a.id} value={a.id}>{a.code} — {a.name}</option>")).toBe(true);
  });

  it("ve las variantes de nombre de variable: acc y account", () => {
    expect(detects("<option>{acc.code} — {acc.name}</option>")).toBe(true);
    expect(detects("<option>{account.code} — {account.name}</option>")).toBe(true);
  });

  it("ve el SelectItem de Radix con plantilla: {`${parent.code} — ${parent.name}`}", () => {
    expect(detects("<SelectItem value={a.id}>{`${a.code} — ${a.name}`}</SelectItem>")).toBe(true);
  });

  it("ve el contenido en varias líneas y con CRLF (como MovementForm)", () => {
    const src =
      "<option key={a.id} value={a.id}>\r\n  {a.code} — {a.name} (\r\n    {a.type === 'LIABILITY' ? 'Pasivo' : 'Activo'}\r\n  )\r\n</option>";
    expect(detects(src)).toBe(true);
  });

  it("ve el acceso con ?. y con índice, y la ruta larga: {acct?.code}, {list[0].code}, {row.account.code}", () => {
    expect(detects("<option>{acct?.code} — {acct?.name}</option>")).toBe(true);
    expect(detects("<option>{list[0].code} — {list[0].name}</option>")).toBe(true);
    expect(detects("<SelectItem>{row.account.code} — {row.account.name}</SelectItem>")).toBe(true);
  });

  it("ve la entidad &mdash;", () => {
    expect(detects("<option>{a.code} &mdash; {a.name}</option>")).toBe(true);
  });

  it("devuelve la línea (1-based) del elemento", () => {
    const src = "const x = 1;\n\n<option>{a.code} — {a.name}</option>\n";
    expect(accountOptionLines(src)).toEqual([3]);
  });

  it("encuentra TODOS los elementos de un archivo (no solo el primero)", () => {
    const one = "<option>{a.code} — {a.name}</option>";
    expect(accountOptionLines(`${one}\n${one}\n${one}`)).toEqual([1, 2, 3]);
  });

  it("no marca un SelectItem que no muestra cuentas (el «Tipo» de JournalEntryForm)", () => {
    expect(detects('<SelectItem value="DIARIO">Diario</SelectItem>')).toBe(false);
    expect(detects('<option value="VES">VES — Bolívar</option>')).toBe(false);
  });

  it("no marca «código — nombre» fuera de un <option>/<SelectItem> (celdas, etiquetas, confirmaciones)", () => {
    expect(detects("<td>{a.code} — {a.name}</td>")).toBe(false);
    expect(detects("<span>{account.code} — {account.name}</span>")).toBe(false);
    expect(detects("confirm(`¿Eliminar la cuenta ${account.code} — ${account.name}?`)")).toBe(
      false
    );
  });

  it("no marca un <option> con el código solo (sin « — »)", () => {
    expect(detects("<option>{a.code}</option>")).toBe(false);
  });

  it("no se pasa de largo: un <option> sin código seguido de otro con código no se funde en uno", () => {
    const src = '<option value="a">Uno</option>\n<option>{a.code} — {a.name}</option>';
    expect(accountOptionLines(src)).toEqual([2]);
  });
});
