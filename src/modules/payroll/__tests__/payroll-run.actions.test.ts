// src/modules/payroll/__tests__/payroll-run.actions.test.ts
// Fase NOM-C: Tests de server actions — auth, roles, rate limit, IDOR, Zod, P2002

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockUserId = vi.hoisted(() => vi.fn().mockReturnValue({ userId: "user-1" }));
const mockRateLimit = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockUserId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockRateLimit,
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, export: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    rolePermission: { findFirst: vi.fn() },
    payrollRun: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("../services/PayrollRunService", () => ({
  PayrollRunService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("../services/PayrollBankTxtService", () => ({
  PayrollBankTxtService: { generate: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { PayrollRunService } from "../services/PayrollRunService";
import { PayrollBankTxtService } from "../services/PayrollBankTxtService";
import {
  getPayrollRunsAction,
  getPayrollRunDetailAction,
  createPayrollRunAction,
  approvePayrollRunAction,
  cancelPayrollRunAction,
  exportPayrollBankTxtAction,
} from "../actions/payroll-run.actions";
import { Prisma } from "@prisma/client";

const COMPANY_ID = "company-1";
const RUN_ID = "run-1";

const ADMIN_MEMBER = { role: "OWNER" };
const ACCOUNTANT_MEMBER = { role: "ACCOUNTANT" };
const VIEWER_MEMBER = { role: "VIEWER" };

const BASE_RUN = {
  id: RUN_ID,
  companyId: COMPANY_ID,
  periodStart: "2026-04-01",
  periodEnd: "2026-04-15",
  status: "DRAFT" as const,
  totalEarnings: "30000",
  totalDeductions: "2100",
  totalNet: "27900",
  employeeCount: 1,
  transactionId: null,
  createdByUserId: "user-1",
  approvedByUserId: null,
  approvedAt: null,
  cancelledAt: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId.mockReturnValue({ userId: "user-1" });
  mockRateLimit.mockResolvedValue({ allowed: true });
});

// ─── getPayrollRunsAction ─────────────────────────────────────────────────────

describe("getPayrollRunsAction", () => {
  it("returns runs for ACCOUNTANT", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(PayrollRunService.list).mockResolvedValue([BASE_RUN] as never);
    const result = await getPayrollRunsAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });

  it("denies VIEWER (NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
    const result = await getPayrollRunsAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("returns error when not authenticated", async () => {
    mockUserId.mockReturnValue({ userId: null });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);
    const result = await getPayrollRunsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});

// ─── getPayrollRunDetailAction — IDOR guard ────────────────────────────────────

describe("getPayrollRunDetailAction", () => {
  it("returns run detail for ACCOUNTANT", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(PayrollRunService.getById).mockResolvedValue({ ...BASE_RUN, lines: [] } as never);
    const result = await getPayrollRunDetailAction(COMPANY_ID, RUN_ID);
    expect(result.success).toBe(true);
  });

  it("returns error when run not found (IDOR — NOM-C-01)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(PayrollRunService.getById).mockResolvedValue(null as never);
    const result = await getPayrollRunDetailAction(COMPANY_ID, RUN_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no encontrado");
  });
});

// ─── createPayrollRunAction ───────────────────────────────────────────────────

describe("createPayrollRunAction", () => {
  const VALID_INPUT = {
    periodStart: "2026-04-01",
    periodEnd: "2026-04-15",
    idempotencyKey: "key-1",
  };

  it("creates run for ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.create).mockResolvedValue(BASE_RUN as never);
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockRateLimit).toHaveBeenCalled();
  });

  it("denies ACCOUNTANT (NOM-C-09 — ADMIN_ONLY)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it("denies VIEWER (NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
    // VIEWER sin grant explícito → hasModuleAccess retorna false (ADR-025)
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null as never);
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it("returns 429 when rate limited (NOM-C-08)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    mockRateLimit.mockResolvedValue({ allowed: false });
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("rejects invalid periodStart (Zod)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const result = await createPayrollRunAction(COMPANY_ID, { ...VALID_INPUT, periodStart: "not-a-date" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Fecha");
  });

  it("rejects periodEnd before periodStart (Zod)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const result = await createPayrollRunAction(COMPANY_ID, {
      ...VALID_INPUT,
      periodStart: "2026-04-15",
      periodEnd: "2026-04-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("posterior");
  });

  // Antes este test asertaba `toContain("Ya existe un proceso")`, un substring que
  // comparten DOS de las tres ramas de P2002 (la del período y la de "sin target").
  // Pasaba en verde con el bug original —cualquier P2002 salía como choque de
  // período— y seguiría pasando si se intercambiaran esas dos ramas: no podía
  // fallar. Ahora afirma el mensaje EXACTO de la rama que corresponde.
  it("maps P2002 SIN meta.target al mensaje genérico de nómina, no al del período (NOM-C-02)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: {},
      })
    );
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(
        "Ya existe un proceso de nómina con esos datos. Revisa los borradores existentes antes de reintentar."
      );
    }
  });
});

// ─── approvePayrollRunAction ──────────────────────────────────────────────────

describe("approvePayrollRunAction", () => {
  it("approves run for ADMIN with rate limit (NOM-C-08, NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.approve).mockResolvedValue({ ...BASE_RUN, status: "APPROVED" } as never);
    const result = await approvePayrollRunAction(COMPANY_ID, { runId: RUN_ID });
    expect(result.success).toBe(true);
    expect(mockRateLimit).toHaveBeenCalled();
  });

  it("denies ACCOUNTANT (NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const result = await approvePayrollRunAction(COMPANY_ID, { runId: RUN_ID });
    expect(result.success).toBe(false);
  });

  it("returns 429 when rate limited (NOM-C-08)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    mockRateLimit.mockResolvedValue({ allowed: false });
    const result = await approvePayrollRunAction(COMPANY_ID, { runId: RUN_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("propagates service error message", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.approve).mockRejectedValue(new Error("ya fue aprobado"));
    const result = await approvePayrollRunAction(COMPANY_ID, { runId: RUN_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya fue aprobado");
  });
});

// ─── cancelPayrollRunAction ───────────────────────────────────────────────────

describe("cancelPayrollRunAction", () => {
  const VALID_CANCEL = { runId: RUN_ID, reason: "Error en los datos ingresados" };

  it("cancels DRAFT run for ADMIN (NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.cancel).mockResolvedValue({ ...BASE_RUN, status: "CANCELLED" } as never);
    const result = await cancelPayrollRunAction(COMPANY_ID, VALID_CANCEL);
    expect(result.success).toBe(true);
  });

  it("denies ACCOUNTANT (NOM-C-09)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    const result = await cancelPayrollRunAction(COMPANY_ID, VALID_CANCEL);
    expect(result.success).toBe(false);
  });

  it("returns 429 when rate limited (NOM-C-08)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    mockRateLimit.mockResolvedValue({ allowed: false });
    const result = await cancelPayrollRunAction(COMPANY_ID, VALID_CANCEL);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("requires reason in Zod (Zod validation)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    const result = await cancelPayrollRunAction(COMPANY_ID, { runId: RUN_ID, reason: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Motivo");
  });

  it("propagates APPROVED cancel error (NOM-C-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.cancel).mockRejectedValue(
      new Error("No se puede cancelar un proceso aprobado")
    );
    const result = await cancelPayrollRunAction(COMPANY_ID, VALID_CANCEL);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("aprobado");
  });
});

// ─── exportPayrollBankTxtAction ───────────────────────────────────────────────

describe("exportPayrollBankTxtAction", () => {
  beforeEach(() => vi.clearAllMocks());

  const BANK_FILE = {
    rows: [],
    totalEmployees: 2,
    totalAmount: "2300.00",
    warningCount: 0,
    txt: "# NOMINA\nCEDULA|NOMBRE|BANCO|CUENTA|MONTO\nV-12345678|JUAN PEREZ|BANESCO|01340|1500.00",
  };

  it("retorna el archivo TXT para ACCOUNTING", async () => {
    mockUserId.mockReturnValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(PayrollBankTxtService.generate).mockResolvedValue(BANK_FILE);

    const result = await exportPayrollBankTxtAction(COMPANY_ID, RUN_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.txt).toContain("NOMINA");
      expect(result.data.totalEmployees).toBe(2);
    }
  });

  it("retorna error si no autenticado", async () => {
    mockUserId.mockReturnValue({ userId: null });

    const result = await exportPayrollBankTxtAction(COMPANY_ID, RUN_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si VIEWER (sin rol ACCOUNTING)", async () => {
    mockUserId.mockReturnValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);

    const result = await exportPayrollBankTxtAction(COMPANY_ID, RUN_ID);

    expect(result.success).toBe(false);
    expect(PayrollBankTxtService.generate).not.toHaveBeenCalled();
  });

  it("propaga error del servicio", async () => {
    mockUserId.mockReturnValue({ userId: "user-1" });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollBankTxtService.generate).mockRejectedValue(
      new Error("Proceso de nómina no encontrado"),
    );

    const result = await exportPayrollBankTxtAction(COMPANY_ID, RUN_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no encontrado");
  });
});

// ─── createPayrollRunAction — las TRES ramas de P2002 (auditoría LOW) ─────────
//
// `PayrollRun` tiene DOS @@unique compuestos:
//   @@unique([companyId, idempotencyKey])
//   @@unique([companyId, periodStart, periodEnd])
// La action mapeaba CUALQUIER P2002 al mensaje del período, así que un
// doble-submit (choque de idempotencyKey) mandaba al usuario a "revisar los
// borradores existentes" de un período donde no hay ninguno: el mensaje MENTÍA.
//
// Un test por rama, con el texto EXACTO. Nada de substrings: dos de los tres
// mensajes comparten el prefijo "Ya existe un proceso de nómina", y asertar por
// substring hace imposible detectar que las ramas se intercambien.
describe("createPayrollRunAction — P2002 acotado por meta.target", () => {
  const VALID_INPUT = {
    periodStart: "2026-04-01",
    periodEnd: "2026-04-15",
    idempotencyKey: "key-1",
  };

  const MSG_PERIODO =
    "Ya existe un proceso de nómina vigente para este período y esta moneda. Revisa los borradores existentes.";
  const MSG_DOBLE_SUBMIT =
    "Esta solicitud ya se envió. Revisa si el proceso de nómina se creó antes de reintentar.";
  const MSG_SIN_TARGET =
    "Ya existe un proceso de nómina con esos datos. Revisa los borradores existentes antes de reintentar.";

  async function createFailingWith(err: unknown): Promise<string> {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(PayrollRunService.create).mockRejectedValue(err);
    const result = await createPayrollRunAction(COMPANY_ID, VALID_INPUT);
    expect(result.success).toBe(false);
    return result.success ? "" : result.error;
  }

  const p2002 = (target?: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: target === undefined ? {} : { target },
    });

  it("rama 1 — target del período → mensaje del período", async () => {
    const error = await createFailingWith(p2002(["companyId", "periodStart", "periodEnd"]));
    expect(error).toBe(MSG_PERIODO);
  });

  it("rama 1-bis — target con el NOMBRE DEL ÍNDICE parcial → mensaje del período", async () => {
    // El `@@unique` del período se reemplazó por un índice PARCIAL (migración
    // 20260830). Para un índice que Prisma no declara, `meta.target` trae su
    // NOMBRE, no las columnas — y `p2002TargetIncludes` compara EXACTO, así que
    // buscar "periodStart" dejaba la rama muerta y el usuario caía en el mensaje
    // genérico. Precedente de CLAUDE.md: la columna es la del CONSTRAINT.
    const error = await createFailingWith(
      p2002("PayrollRun_companyId_period_segment_active_key"),
    );
    expect(error).toBe(MSG_PERIODO);
  });

  it("rama 2 — target de idempotencyKey → mensaje de doble submit, NO el del período", async () => {
    const error = await createFailingWith(p2002(["companyId", "idempotencyKey"]));
    expect(error).toBe(MSG_DOBLE_SUBMIT);
    // El bug exacto que se corrigió: mandar al usuario a buscar un borrador de período.
    expect(error).not.toContain("este período");
  });

  it("rama 3 — P2002 sin target → mensaje cierto en AMBOS casos, sin adivinar", async () => {
    const error = await createFailingWith(p2002());
    expect(error).toBe(MSG_SIN_TARGET);
    // No puede afirmar "para este período": no sabe cuál de los dos uniques chocó.
    expect(error).not.toContain("para este período");
    expect(error).not.toBe(MSG_PERIODO);
  });

  it("las tres ramas devuelven mensajes DISTINTOS (si se colapsan, esto revienta)", async () => {
    const mensajes = [
      await createFailingWith(p2002(["companyId", "periodStart", "periodEnd"])),
      await createFailingWith(p2002(["companyId", "idempotencyKey"])),
      await createFailingWith(p2002()),
    ];
    expect(new Set(mensajes).size).toBe(3);
  });

  it("un P2002 de un target ajeno (transactionId) cae en la rama genérica, no en la del período", async () => {
    const error = await createFailingWith(p2002(["transactionId"]));
    expect(error).toBe(MSG_SIN_TARGET);
  });

  it("un error que NO es P2002 no se disfraza de duplicado", async () => {
    const error = await createFailingWith(new Error("No hay empleados activos en el período"));
    expect(error).toBe("No hay empleados activos en el período");
    expect(error).not.toContain("Ya existe");
  });
});
