// src/modules/retentions/actions/retention-extra.actions.test.ts
// Tests for enterRetentionAction, getAccountsForEnteramientoAction, getRetentionReconciliationAction

import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: vi.fn((c: string, u: string) => `${c}:${u}`),
  limiters: { fiscal: {} },
  redis: null,
}));
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi
    .fn()
    .mockImplementation((_c: unknown, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)),
}));
vi.mock("@/lib/module-access", () => ({
  hasModuleAccess: vi.fn().mockResolvedValue(true),
  moduleAccessError: vi.fn().mockReturnValue("Módulo no habilitado"),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn(), findUnique: vi.fn() },
    account: { findMany: vi.fn() },
    retencion: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    fiscalYearClose: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/RetentionService", () => ({
  RetentionService: { calculate: vi.fn() },
  linkRetentionToInvoice: vi.fn(),
  getNextIvaVoucherNumber: vi.fn().mockResolvedValue("20260600000001"),
  getNextIslrVoucherNumber: vi.fn().mockResolvedValue("20260600000001"),
  enterRetention: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/retentions/services/RetentionVoucherPDFService", () => ({
  generateRetentionVoucherPDF: vi.fn(),
}));
vi.mock("@/modules/fiscal-close/services/FiscalYearCloseService", () => ({
  FiscalYearCloseService: { getOrCreateFiscalYear: vi.fn() },
}));
vi.mock("@sentry/nextjs", () => ({
  withScope: vi.fn(),
  captureMessage: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import { hasModuleAccess } from "@/lib/module-access";
import { enterRetention } from "../services/RetentionService";
import {
  COMPANY_ID as PAGE_COMPANY_ID,
  createSeededDb,
  expectKeysWithin,
  expectSelectKeys,
  expectedIds,
  seedAccounts,
} from "@/__tests__/helpers/account-page-data";
import {
  enterRetentionAction,
  getAccountsForEnteramientoAction,
  getRetentionReconciliationAction,
} from "./retention.actions";

const COMPANY_ID = "co-1";
const ACCOUNTING_MEMBER = { role: "ACCOUNTANT" };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTING_MEMBER as never);
  vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(ACCOUNTING_MEMBER as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(hasModuleAccess).mockResolvedValue(true);
});

// ─── enterRetentionAction ─────────────────────────────────────────────────────

describe("enterRetentionAction", () => {
  const VALID_INPUT = {
    retentionId: "ret-1",
    companyId: COMPANY_ID,
    liabilityAccountId: "acc-liability-1",
    bankAccountId: "acc-bank-1",
    enterDate: new Date(),
  };

  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await enterRetentionAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("no member → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await enterRetentionAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("módulo no habilitado → error", async () => {
    vi.mocked(hasModuleAccess).mockResolvedValue(false);
    const res = await enterRetentionAction(VALID_INPUT);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT + módulo habilitado → success", async () => {
    const res = await enterRetentionAction(VALID_INPUT);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.retentionId).toBe("ret-1");
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(enterRetention).mockRejectedValue(new Error("db error") as never);
    const res = await enterRetentionAction(VALID_INPUT);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("db error");
  });
});

// ─── getAccountsForEnteramientoAction ─────────────────────────────────────────

describe("getAccountsForEnteramientoAction", () => {
  const MOCK_ACCOUNTS = [
    { id: "acc-1", code: "1105", name: "Banco", type: "ASSET" },
    { id: "acc-2", code: "2110", name: "IVA Ret x Pagar", type: "LIABILITY" },
  ];

  beforeEach(() => {
    vi.mocked(prisma.account.findMany).mockResolvedValue(MOCK_ACCOUNTS as never);
  });

  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await getAccountsForEnteramientoAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("no member → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await getAccountsForEnteramientoAction(COMPANY_ID);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna cuentas", async () => {
    const res = await getAccountsForEnteramientoAction(COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveLength(2);
      expect(res.data[0].code).toBe("1105");
    }
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.account.findMany).mockRejectedValue(new Error("query error") as never);
    const res = await getAccountsForEnteramientoAction(COMPANY_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("query error");
  });
});

// ─── getRetentionReconciliationAction ─────────────────────────────────────────

describe("getRetentionReconciliationAction", () => {
  const MOCK_RET = {
    id: "ret-1",
    voucherNumber: "CR-001",
    status: "PENDING",
    invoiceNumber: "B001",
    providerRif: "J-1234",
    ivaRetention: new Decimal("120"),
    invoiceId: null,
  };
  const MOCK_INV = {
    id: "inv-1",
    invoiceNumber: "B001",
    date: new Date("2026-01-15"),
    counterpartName: "Prov S.A.",
    counterpartRif: "J-1234",
    ivaRetentionAmount: new Decimal("120"),
    ivaRetentionVoucher: null,
  };

  beforeEach(() => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([MOCK_RET] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([MOCK_INV] as never);
  });

  it("sin sesión → error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
  });

  it("no member → error", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
  });

  it("ACCOUNTANT → success, retorna filas de conciliación", async () => {
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
    if (res.success) expect(Array.isArray(res.data)).toBe(true);
  });

  it("retención sin factura → RETENTION_WITHOUT_INVOICE", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data[0]?.status).toBe("RETENTION_WITHOUT_INVOICE");
  });

  it("factura sin retención con retención registrada → INVOICE_WITHOUT_RETENTION", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data[0]?.status).toBe("INVOICE_WITHOUT_RETENTION");
  });

  it("service falla → error con mapPrismaError", async () => {
    vi.mocked(prisma.retencion.findMany).mockRejectedValue(new Error("query failed") as never);
    const res = await getRetentionReconciliationAction(COMPANY_ID, 2026, 1);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("query failed");
  });
});

// <<B1-BLOCK-START>>
// ─── getAccountsForEnteramientoAction — títulos y cuentas (SPEC-012 B1, CA-19) ────────────────────
// La acción alimenta los dos selectores de «Enterar retención» (RetentionList). Deja de filtrar
// `isPostable: true` (los títulos llegan como encabezados no elegibles), AÑADE `deletedAt: null` (hoy
// faltaba), CONSERVA `companyId` y `type in [ASSET, LIABILITY]`, y entrega SOLO
// `{id, code, name, type, isPostable}`. Se evalúa contra una BD en memoria con varias empresas, cuentas
// eliminadas y columnas de más (un `mockResolvedValue` respondería lo mismo a cualquier `where`).

describe("getAccountsForEnteramientoAction — títulos y cuentas (SPEC-012 B1, CA-19)", () => {
  const seed = seedAccounts();
  type FindManyArgs = { where: Record<string, unknown>; select?: Record<string, unknown> };

  function useSeededDb() {
    vi.mocked(prisma.account.findMany).mockClear(); // el archivo no limpia los mocks entre tests
    vi.mocked(prisma.account.findMany).mockImplementation(createSeededDb(seed).findMany as never);
  }

  const lastArgs = () =>
    vi.mocked(prisma.account.findMany).mock.calls.at(-1)?.[0] as unknown as FindManyArgs;

  it("el where es EXACTAMENTE { companyId, type: { in: [ASSET, LIABILITY] }, deletedAt: null } y NO filtra isPostable", async () => {
    useSeededDb();
    await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expect(vi.mocked(prisma.account.findMany)).toHaveBeenCalledTimes(1);
    const { where } = lastArgs();
    expect(where).toEqual({
      companyId: PAGE_COMPANY_ID,
      type: { in: ["ASSET", "LIABILITY"] },
      deletedAt: null,
    });
    expect(Object.keys(where)).not.toContain("isPostable");
  });

  it("añade deletedAt: null (antes faltaba): una cuenta eliminada no llega al selector", async () => {
    useSeededDb();
    const res = await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      const deletedIds = seed.filter((r) => r.deletedAt !== null).map((r) => r.id);
      for (const id of deletedIds) expect(res.data.map((a) => a.id)).not.toContain(id);
    }
  });

  it("el select pide isPostable (sin él el combobox trataría todo como título) y nada de más", async () => {
    useSeededDb();
    await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expectSelectKeys(lastArgs().select, ["id", "code", "name", "type", "isPostable"]);
  });

  it("devuelve los títulos Y las cuentas de movimiento de Activo y Pasivo de ESA empresa, y nada más", async () => {
    useSeededDb();
    const res = await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.map((a) => a.id).sort()).toEqual(
      expectedIds(seed, { types: ["ASSET", "LIABILITY"] }).sort()
    );
    // `isPostable` aún no está en el tipo `AccountOption` de la acción (lo añade el ui-agent): se lee por contrato.
    const accounts = res.data as unknown as { type: string; isPostable: boolean }[];
    expect(accounts.some((a) => a.isPostable === false)).toBe(true);
    expect(accounts.some((a) => a.isPostable === true)).toBe(true);
    expect(accounts.every((a) => a.type === "ASSET" || a.type === "LIABILITY")).toBe(true);
  });

  it("cada cuenta lleva SOLO {id, code, name, type, isPostable}: sin descripción ni columnas de más", async () => {
    useSeededDb();
    const res = await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expectKeysWithin(res.data as unknown as Record<string, unknown>[], [
      "id",
      "code",
      "name",
      "type",
      "isPostable",
    ]);
    for (const account of res.data) {
      expect(Object.keys(account).sort()).toEqual(["code", "id", "isPostable", "name", "type"]);
    }
  });

  it("isPostable viaja con su valor real", async () => {
    useSeededDb();
    const res = await getAccountsForEnteramientoAction(PAGE_COMPANY_ID);
    expect(res.success).toBe(true);
    if (!res.success) return;
    for (const original of seed.filter(
      (r) =>
        r.companyId === PAGE_COMPANY_ID &&
        r.deletedAt === null &&
        (r.type === "ASSET" || r.type === "LIABILITY")
    )) {
      expect(res.data).toContainEqual(
        expect.objectContaining({ id: original.id, isPostable: original.isPostable })
      );
    }
  });
});
