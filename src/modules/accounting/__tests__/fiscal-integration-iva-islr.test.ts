// src/modules/accounting/__tests__/fiscal-integration-iva-islr.test.ts
//
// Auditoría Fiscal — Venta con Retención IVA 75% + ISLR 3%
// Marco legal: LIVA Art.11 + Art.27, SNAT/2005/0056, LISLR Art.87, Decreto 1808
// VEN-NIF PYME §29 (precisión centesimal)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (antes de todos los imports de módulos bajo prueba) ────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    fiscalYearClose: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    journalEntry: {
      groupBy: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation((_id: unknown, fn: () => unknown) => fn()),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: vi.fn().mockImplementation((_opts: unknown, fn: () => unknown) => fn()),
}));

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { TransactionService } from "../services/TransactionService";
import { BalanceSheetService } from "../services/BalanceSheetService";
import { IncomeStatementService } from "../services/IncomeStatementService";

// ─── Constantes fiscales venezolanas vigentes ─────────────────────────────────
const IVA_GENERAL         = new Decimal("0.16");  // LIVA Art. 27 — 16%
const IVA_RETENCION_PCT   = new Decimal("0.75");  // SNAT/2005/0056 — 75%
const ISLR_HONORARIOS_PCT = new Decimal("0.03");  // Decreto 1808 — 3% serv. prof.
const COMPANYID           = "cmp_test_audit_iva";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function bs(v: Decimal): string {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
function dec(s: string | number): Decimal { return new Decimal(s); }
function makeEntryAmt(v: string) { return { amount: { toString: () => v } }; }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const PERIOD_OPEN = {
  id: "per_mayo_2026",
  companyId: COMPANYID,
  year: 2026,
  month: 5,
  status: "OPEN",
  openedAt: new Date("2026-05-01"),
  closedAt: null,
  openedBy: "usr_owner",
  closedBy: null,
};

const ACCOUNTS = {
  CLIENTES:            { id: "acc_1305", code: "1305", name: "Clientes",               type: "ASSET",     isCurrent: true  },
  IVA_RET_COBRAR:      { id: "acc_1120", code: "1120", name: "IVA Retención/Cobrar",   type: "ASSET",     isCurrent: true  },
  ISLR_RET_COBRAR:     { id: "acc_1130", code: "1130", name: "ISLR Retención/Cobrar",  type: "ASSET",     isCurrent: true  },
  INGRESOS_VENTAS:     { id: "acc_4110", code: "4110", name: "Ventas de Mercancías",   type: "REVENUE",   isCurrent: false },
  IVA_DEBITO_FISCAL:   { id: "acc_2195", code: "2195", name: "IVA Débito Fiscal",      type: "LIABILITY", isCurrent: true  },
};

const BASE_VENTA_INPUT = {
  companyId: COMPANYID,
  userId: "usr_test_auditor",
  description: "Venta con retención IVA 75% + ISLR 3% — Test Auditoría",
  date: new Date("2026-05-20"),
  type: "DIARIO" as const,
  entries: [
    { accountId: ACCOUNTS.CLIENTES.id,          debit: "101000.00", credit: ""          },
    { accountId: ACCOUNTS.IVA_RET_COBRAR.id,    debit:  "12000.00", credit: ""          },
    { accountId: ACCOUNTS.ISLR_RET_COBRAR.id,   debit:   "3000.00", credit: ""          },
    { accountId: ACCOUNTS.INGRESOS_VENTAS.id,   debit: "",          credit: "100000.00" },
    { accountId: ACCOUNTS.IVA_DEBITO_FISCAL.id, debit: "",          credit:  "16000.00" },
  ],
};

function setupHappyPath(txNumberOverride = "2026-05-000001") {
  vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.account.findMany).mockResolvedValue(
    Object.values(ACCOUNTS).map((a) => ({ id: a.id })) as never,
  );
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(PERIOD_OPEN as never);

  const createdTx = {
    id: "tx_audit_001",
    number: txNumberOverride,
    companyId: COMPANYID,
    entries: Object.values(BASE_VENTA_INPUT.entries).map((e, i) => ({ id: `jel_${i}` })),
  };

  vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
    fn({
      ...prisma,
      transaction: {
        ...prisma.transaction,
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdTx),
      },
      auditLog: { create: vi.fn() },
    } as never),
  );

  return createdTx;
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 1 — Aritmética fiscal centesimal (sin acceso a BD)
// ══════════════════════════════════════════════════════════════════════════════

describe("BLOQUE 1 — Aritmética fiscal centesimal (LIVA + Decreto 1808)", () => {
  it("C-01: IVA causado = base × 16% exacto sin error IEEE 754", () => {
    const base = dec("100000.00");
    const iva  = base.times(IVA_GENERAL);
    expect(bs(iva)).toBe("16000.00");
  });

  it("C-02: Retención IVA = IVA causado × 75%", () => {
    const iva    = dec("16000.00");
    const retIva = iva.times(IVA_RETENCION_PCT);
    expect(bs(retIva)).toBe("12000.00");
    expect(bs(iva.minus(retIva))).toBe("4000.00"); // 25% no retenido
  });

  it("C-03: Retención ISLR honorarios = base × 3%", () => {
    const retIslr = dec("100000.00").times(ISLR_HONORARIOS_PCT);
    expect(bs(retIslr)).toBe("3000.00");
  });

  it("C-04: Partida doble cuadra exactamente — Σdébitos = Σcréditos = 116.000,00", () => {
    const base       = dec("100000.00");
    const iva        = base.times(IVA_GENERAL).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const retIva     = iva.times(IVA_RETENCION_PCT).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const retIslr    = base.times(ISLR_HONORARIOS_PCT).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const netoCobrar = base.plus(iva).minus(retIva).minus(retIslr);

    const sumaDebitos  = netoCobrar.plus(retIva).plus(retIslr);
    const sumaCreditos = base.plus(iva);

    expect(sumaDebitos.toFixed(2)).toBe(sumaCreditos.toFixed(2));
    expect(sumaDebitos.toFixed(2)).toBe("116000.00");
  });

  it("C-05: Neto a cobrar del cliente = 101.000,00", () => {
    const base       = dec("100000.00");
    const iva        = base.times(IVA_GENERAL).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const retIva     = iva.times(IVA_RETENCION_PCT).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const retIslr    = base.times(ISLR_HONORARIOS_PCT).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(bs(base.plus(iva).minus(retIva).minus(retIslr))).toBe("101000.00");
  });

  it("C-06: Base con centavos — Decimal.js correcto, float nativo falla (IEEE 754)", () => {
    // 123456.78 * 0.16 con float = 19753.1248... (no 19753.08)
    const base = dec("123456.78");
    const iva  = base.times(IVA_GENERAL).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    expect(bs(iva)).toBe("19753.08");

    const floatResult = 123456.78 * 0.16;
    expect(parseFloat(floatResult.toFixed(2))).toBe(19753.08); // coincide por azar en este caso
    // El riesgo real aparece con divisiones y acumulaciones
    const floatChain = ((123456.78 * 0.16) * 0.75 * 12) / 12; // debería ser 19753.08
    expect(new Decimal(floatChain.toString()).toDecimalPlaces(4).toFixed(4)).not.toBe("19753.0800");
  });

  it("C-07: Retención 75% sobre IVA de base con decimales redondea HALF_UP", () => {
    // Base 1.00 → IVA 0.16 → Ret 75% = 0.12 (exacto)
    expect(bs(dec("0.16").times(IVA_RETENCION_PCT))).toBe("0.12");
    // Base 0.01 → IVA 0.002 → Ret 75% = 0.001 → redondeado = 0.00
    expect(bs(dec("0.002").times(IVA_RETENCION_PCT))).toBe("0.00");
    // Base 0.10 → IVA 0.016 → Ret 75% = 0.012 → redondeado HALF_UP = 0.01
    expect(bs(dec("0.016").times(IVA_RETENCION_PCT))).toBe("0.01");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 2 — TransactionService: creación y bloqueos de período
// ══════════════════════════════════════════════════════════════════════════════

describe("BLOQUE 2 — TransactionService: asiento fiscal y bloqueos", () => {
  beforeEach(() => vi.clearAllMocks());

  it("C-08: Happy path — asiento de 5 líneas creado con número correlativo correcto", async () => {
    const tx = setupHappyPath();
    const result = await TransactionService.createBalancedTransaction(BASE_VENTA_INPUT);
    expect(result.id).toBe(tx.id);
    expect(result.number).toMatch(/^2026-05-/);
  });

  it("C-09: Sin período abierto — rechaza con mensaje de negocio", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue(
      Object.values(ACCOUNTS).map((a) => ({ id: a.id })) as never,
    );
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);

    await expect(
      TransactionService.createBalancedTransaction(BASE_VENTA_INPUT),
    ).rejects.toThrow("No hay período contable abierto");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-10: Año fiscal cerrado — rechaza antes de consultar período", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue(
      Object.values(ACCOUNTS).map((a) => ({ id: a.id })) as never,
    );

    await expect(
      TransactionService.createBalancedTransaction(BASE_VENTA_INPUT),
    ).rejects.toThrow("ejercicio económico 2026 está cerrado");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-11: Cuenta de otra empresa — rechaza por guard de companyId", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(PERIOD_OPEN as never);
    // Solo devuelve 4 de las 5 cuentas — la quinta es cross-tenant
    vi.mocked(prisma.account.findMany).mockResolvedValue(
      Object.values(ACCOUNTS).slice(0, 4).map((a) => ({ id: a.id })) as never,
    );

    await expect(
      TransactionService.createBalancedTransaction(BASE_VENTA_INPUT),
    ).rejects.toThrow("no pertenecen a esta empresa");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-12: Zod bloquea asiento desbalanceado — BD no es tocada", async () => {
    const unbalancedInput = {
      companyId: COMPANYID,
      userId: "usr_test_auditor",
      description: "Asiento desbalanceado deliberado",
      date: new Date("2026-05-20"),
      type: "DIARIO" as const,
      entries: [
        { accountId: ACCOUNTS.CLIENTES.id,        debit: "101000.00", credit: ""         },
        { accountId: ACCOUNTS.INGRESOS_VENTAS.id,  debit: "",          credit: "99999.00" },
        // Débitos 101.000 ≠ Créditos 99.999 → descuadrado
      ],
    };

    await expect(
      TransactionService.createBalancedTransaction(unbalancedInput),
    ).rejects.toThrow(/desbalanceado/i);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-13: Número correlativo incrementa desde el último del mes", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(
      { number: "2026-05-000042" } as never,
    );
    const number = await TransactionService.generateTransactionNumber(
      COMPANYID,
      new Date("2026-05-20"),
      prisma as never,
    );
    expect(number).toBe("2026-05-000043");
  });

  it("C-14: Número correlativo reinicia en 000001 al cambiar de mes", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);
    const number = await TransactionService.generateTransactionNumber(
      COMPANYID,
      new Date("2026-06-01"),
      prisma as never,
    );
    expect(number).toBe("2026-06-000001");
  });

  it("C-15: Anulación en período CERRADO rechazada (Art. 36 Cód. Comercio)", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "tx_original",
      number: "2026-04-000001",
      companyId: COMPANYID,
      periodId: "per_abril_cerrado",
      status: "POSTED",
      description: "Venta abril",
      reference: null,
      type: "DIARIO",
      entries: [
        { accountId: ACCOUNTS.CLIENTES.id, amount: new Decimal("101000.00"), description: null },
        { accountId: ACCOUNTS.INGRESOS_VENTAS.id, amount: new Decimal("-100000.00"), description: null },
      ],
    } as never);

    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({
      status: "CLOSED",
      year: 2026,
      month: 4,
    } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx_original", userId: "usr_admin", reason: "Prueba de anulación período cerrado" },
        COMPANYID, "1.2.3.4", "vitest-agent",
      ),
    ).rejects.toThrow(/período cerrado/i);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-16: Anulación en año fiscal cerrado rechazada", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: "tx_original",
      companyId: COMPANYID,
      periodId: "per_open",
      status: "POSTED",
      description: "Asiento cualquiera",
      reference: null,
      type: "DIARIO",
      entries: [],
    } as never);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({
      status: "OPEN",
      year: 2026,
      month: 5,
    } as never);
    // El año actual está cerrado
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx_original", userId: "usr_admin", reason: "Anulación en año cerrado test" },
        COMPANYID, "1.2.3.4", "vitest-agent",
      ),
    ).rejects.toThrow(/año fiscal.*cerrado/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 3 — BalanceSheetService: impacto en Balance General
// ══════════════════════════════════════════════════════════════════════════════

describe("BLOQUE 3 — BalanceSheetService: cuadre A = P + Pat", () => {
  beforeEach(() => vi.clearAllMocks());

  // Simula el estado del Balance General DESPUÉS de registrar la venta con retenciones.
  // N5: account.findMany devuelve solo metadata; groupBy devuelve sumas agregadas por BD.
  function setupBalanceWithRetenciones() {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        ACCOUNTS.CLIENTES,
        ACCOUNTS.IVA_RET_COBRAR,
        ACCOUNTS.ISLR_RET_COBRAR,
        ACCOUNTS.IVA_DEBITO_FISCAL,
      ] as never)
      .mockResolvedValueOnce([
        ACCOUNTS.INGRESOS_VENTAS,
      ] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([
        { accountId: ACCOUNTS.CLIENTES.id,          _sum: { amount: "101000.00"  } },
        { accountId: ACCOUNTS.IVA_RET_COBRAR.id,    _sum: { amount: "12000.00"   } },
        { accountId: ACCOUNTS.ISLR_RET_COBRAR.id,   _sum: { amount: "3000.00"    } },
        { accountId: ACCOUNTS.IVA_DEBITO_FISCAL.id, _sum: { amount: "-16000.00"  } },
      ] as never)
      .mockResolvedValueOnce([
        { accountId: ACCOUNTS.INGRESOS_VENTAS.id, _sum: { amount: "-100000.00" } },
      ] as never);
  }

  it("C-17: Activos corrientes reflejan los tres componentes de la venta con retenciones", async () => {
    setupBalanceWithRetenciones();
    const balance = await BalanceSheetService.compute(COMPANYID, new Date("2026-05-31"));

    expect(balance.totalCurrentAssets).toBe("116000.00"); // 101+12+3

    const cli  = balance.currentAssets.find((r) => r.code === "1305");
    const ivaR = balance.currentAssets.find((r) => r.code === "1120");
    const islR = balance.currentAssets.find((r) => r.code === "1130");

    expect(cli?.balance).toBe("101000.00");  // neto a cobrar del cliente
    expect(ivaR?.balance).toBe("12000.00");  // IVA retenido 75%
    expect(islR?.balance).toBe("3000.00");   // ISLR retenido 3%
  });

  it("C-18: IVA Débito Fiscal presentado POSITIVO en Pasivos (negación del crédito)", async () => {
    setupBalanceWithRetenciones();
    const balance = await BalanceSheetService.compute(COMPANYID, new Date("2026-05-31"));

    const ivaD = balance.currentLiabilities.find((r) => r.code === "2195");
    expect(ivaD?.balance).toBe("16000.00");          // negado → positivo
    expect(balance.totalCurrentLiabilities).toBe("16000.00");
  });

  it("C-19: Resultado del Ejercicio en Patrimonio = base imponible (Ingresos - Gastos 0)", async () => {
    setupBalanceWithRetenciones();
    const balance = await BalanceSheetService.compute(COMPANYID, new Date("2026-05-31"));

    const resultado = balance.equity.find((r) => r.id === "net-income");
    expect(resultado?.balance).toBe("100000.00");
    expect(balance.totalEquity).toBe("100000.00");
  });

  it("C-20: isBalanced=true — A (116.000) = P (16.000) + Pat (100.000)", async () => {
    setupBalanceWithRetenciones();
    const balance = await BalanceSheetService.compute(COMPANYID, new Date("2026-05-31"));

    expect(balance.totalAssets).toBe("116000.00");
    expect(balance.totalLiabilitiesAndEquity).toBe("116000.00");
    expect(balance.isBalanced).toBe(true);
  });

  it("C-21: isBalanced=false cuando Pasivos están incompletos (detecta descuadre)", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([ACCOUNTS.CLIENTES] as never)
      .mockResolvedValueOnce([ACCOUNTS.INGRESOS_VENTAS] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([{ accountId: ACCOUNTS.CLIENTES.id, _sum: { amount: "101000.00" } }] as never)
      .mockResolvedValueOnce([{ accountId: ACCOUNTS.INGRESOS_VENTAS.id, _sum: { amount: "-100000.00" } }] as never);

    const balance = await BalanceSheetService.compute(COMPANYID);
    // Activos=101.000, Pasivos=0, Patrimonio(netIncome)=100.000 → diff=1.000 > BALANCE_TOLERANCE
    expect(balance.isBalanced).toBe(false);
  });

  it("C-22 [FIX MEDIO-1]: solo CONTRA_ASSET sin ASSET par → warnings explica el problema", async () => {
    // Reproduce el escenario de la screenshot: "(196.441,67)"
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([
        { id: "acc_1510", code: "1510", name: "Dep. Acum. Equipos", type: "CONTRA_ASSET", isCurrent: false },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([{ accountId: "acc_1510", _sum: { amount: "-196441.67" } }] as never)
      .mockResolvedValueOnce([] as never);

    const balance = await BalanceSheetService.compute(COMPANYID);

    // El total sigue siendo negativo (no podemos inventar los datos de costo),
    // pero ahora el servicio reporta la advertencia para que la UI la muestre.
    expect(new Decimal(balance.totalNonCurrentAssets).isNegative()).toBe(true);
    expect(balance.isBalanced).toBe(false);
    expect(balance.warnings.length).toBeGreaterThan(0);
    expect(balance.warnings.some((w) => /activo.*corriente.*negativo/i.test(w))).toBe(true);
    expect(balance.warnings.some((w) => /CONTRA_ASSET/i.test(w))).toBe(true);
  });

  it("C-23: Balance sin dateTo agrega TODOS los movimientos históricos (comportamiento esperado)", async () => {
    vi.mocked(prisma.account.findMany)
      .mockResolvedValueOnce([ACCOUNTS.CLIENTES] as never)
      .mockResolvedValueOnce([] as never);
    // groupBy ya agrega en BD — devolvemos la suma total directamente
    vi.mocked(prisma.journalEntry.groupBy)
      .mockResolvedValueOnce([{ accountId: ACCOUNTS.CLIENTES.id, _sum: { amount: "101000.00" } }] as never)
      .mockResolvedValueOnce([] as never);

    const balance = await BalanceSheetService.compute(COMPANYID /* sin dateTo */);
    expect(balance.totalCurrentAssets).toBe("101000.00"); // suma acumulada histórica
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 4 — IncomeStatementService: Estado de Resultados
// ══════════════════════════════════════════════════════════════════════════════

describe("BLOQUE 4 — IncomeStatementService: período y signo de cuentas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("C-24: Ingresos con saldo crédito (negativo en BD) se presentan POSITIVOS", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      ACCOUNTS.INGRESOS_VENTAS,
    ] as never);
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: ACCOUNTS.INGRESOS_VENTAS.id, _sum: { amount: "-100000.00" } },
    ] as never);

    const er = await IncomeStatementService.compute(
      COMPANYID, new Date("2026-05-01"), new Date("2026-05-31"),
    );
    expect(er.totalRevenues).toBe("100000.00");
    expect(er.revenues[0].balance).toBe("100000.00");
    expect(er.netIncome).toBe("100000.00");
  });

  it("C-25: Utilidad neta = Ingresos - Gastos (resultado positivo)", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      ACCOUNTS.INGRESOS_VENTAS,
      { id: "acc_6110", code: "6110", name: "Gastos Adm", type: "EXPENSE", isCurrent: false },
    ] as never);
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: ACCOUNTS.INGRESOS_VENTAS.id, _sum: { amount: "-100000.00" } },
      { accountId: "acc_6110",                  _sum: { amount: "20000.00"   } },
    ] as never);

    const er = await IncomeStatementService.compute(COMPANYID);
    expect(er.totalRevenues).toBe("100000.00");
    expect(er.totalExpenses).toBe("20000.00");
    expect(er.netIncome).toBe("80000.00");
  });

  it("C-26: Pérdida neta cuando Gastos > Ingresos (resultado negativo)", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      ACCOUNTS.INGRESOS_VENTAS,
      { id: "acc_6110", code: "6110", name: "Gastos Adm", type: "EXPENSE", isCurrent: false },
    ] as never);
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: ACCOUNTS.INGRESOS_VENTAS.id, _sum: { amount: "-10000.00" } },
      { accountId: "acc_6110",                  _sum: { amount: "50000.00"  } },
    ] as never);

    const er = await IncomeStatementService.compute(COMPANYID);
    expect(er.netIncome).toBe("-40000.00"); // pérdida del período
  });

  it("C-27: Cuentas sin movimientos en el período NO aparecen en el reporte", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      ACCOUNTS.INGRESOS_VENTAS,
      { id: "acc_6110", code: "6110", name: "Gastos Adm", type: "EXPENSE", isCurrent: false },
    ] as never);
    // INGRESOS_VENTAS no aparece en groupBy → balance = 0 → excluida del reporte
    vi.mocked(prisma.journalEntry.groupBy).mockResolvedValueOnce([
      { accountId: "acc_6110", _sum: { amount: "20000.00" } },
    ] as never);

    const er = await IncomeStatementService.compute(COMPANYID);
    expect(er.revenues).toHaveLength(0);
    expect(er.expenses).toHaveLength(1);
    expect(er.netIncome).toBe("-20000.00"); // solo gastos, sin ingresos = pérdida
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BLOQUE 5 — Regresiones de hallazgos de auditoría
// ══════════════════════════════════════════════════════════════════════════════

describe("BLOQUE 5 — Regresiones: hallazgos críticos de auditoría", () => {
  beforeEach(() => vi.clearAllMocks());

  it("C-28 [FIX CRÍTICO-1]: fecha fuera del período abierto es rechazada (Art. 36 Cód. Comercio)", async () => {
    // PERÍODO ABIERTO: Mayo 2026
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.account.findMany).mockResolvedValue(
      Object.values(ACCOUNTS).map((a) => ({ id: a.id })) as never,
    );
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(PERIOD_OPEN as never);

    // ASIENTO CON FECHA EN ENERO 2026 mientras el período abierto es MAYO 2026
    const backdatedInput = {
      ...BASE_VENTA_INPUT,
      date: new Date("2026-01-15"),
    };

    await expect(
      TransactionService.createBalancedTransaction(backdatedInput),
    ).rejects.toThrow("no corresponde al período abierto");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("C-29: Correlativo único por empresa — dos empresas pueden tener el mismo número", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);

    const n1 = await TransactionService.generateTransactionNumber(
      "empresa_a", new Date("2026-05-01"), prisma as never,
    );
    const n2 = await TransactionService.generateTransactionNumber(
      "empresa_b", new Date("2026-05-01"), prisma as never,
    );
    // Ambas empresas arrancan desde 000001 — correcto para el aislamiento multi-tenant
    expect(n1).toBe("2026-05-000001");
    expect(n2).toBe("2026-05-000001");
  });

  it("C-30: Partida doble rechazada por Zod — no llega al $transaction (verificación de capas)", async () => {
    // Con solo 1 línea — Zod exige mínimo 2
    const singleLineInput = {
      companyId: COMPANYID,
      userId: "usr_test",
      description: "Solo una línea",
      date: new Date("2026-05-20"),
      type: "DIARIO" as const,
      entries: [{ accountId: "acc_1305", debit: "1000", credit: "" }],
    };

    await expect(
      TransactionService.createBalancedTransaction(singleLineInput),
    ).rejects.toThrow();

    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
