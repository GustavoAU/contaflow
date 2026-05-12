import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    cajaCaja: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    cajaCajaDeposit: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    cajaCajaMovement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    cajaCajaReimbursement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    accountingPeriod: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { CreateCajaCajaSchema } from "../schemas/cajachica.schema";
import { CreateMovementSchema } from "../schemas/cajachica.schema";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

function makeCaja(overrides = {}) {
  return {
    id: "caja-1",
    companyId: COMPANY_ID,
    name: "Caja Operativa",
    accountId: "acc-caja",
    currency: "VES",
    maxBalance: new Decimal("1000000"),
    status: "ACTIVE",
    createdAt: new Date(),
    createdBy: USER_ID,
    closedAt: null,
    closedBy: null,
    account: { id: "acc-caja", code: "1010", name: "Caja VES" },
    deposits: [],
    movements: [],
    ...overrides,
  };
}

// ─── Schema validation ────────────────────────────────────────────────────────

describe("CreateCajaCajaSchema", () => {
  it("acepta datos válidos", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja Principal",
      accountId: "acc-1",
      currency: "VES",
      maxBalance: "500000",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza maxBalance negativo", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      maxBalance: "-1",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza maxBalance que excede el límite (ADR-006 D-2)", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      maxBalance: "10000000001",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateMovementSchema", () => {
  const valid = {
    companyId: COMPANY_ID,
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    concept: "Café para reunión",
    expenseAccountId: "acc-expense",
    amount: "150000",
    currency: "VES",
  };

  it("acepta movimiento válido sin soporte (< 500K)", () => {
    expect(CreateMovementSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza movimiento VES > 500K sin soporte", () => {
    const result = CreateMovementSchema.safeParse({
      ...valid,
      amount: "600000",
      supportingDocumentId: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("acepta movimiento VES > 500K con soporte", () => {
    const result = CreateMovementSchema.safeParse({
      ...valid,
      amount: "600000",
      supportingDocumentId: "doc-123",
    });
    expect(result.success).toBe(true);
  });

  it("acepta movimiento USD > 500K sin soporte (solo aplica a VES)", () => {
    const result = CreateMovementSchema.safeParse({
      ...valid,
      amount: "600000",
      currency: "USD",
    });
    expect(result.success).toBe(true);
  });
});

// ─── CajaCajaService.createCajaCaja ──────────────────────────────────────────

describe("createCajaCaja", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea caja y audit log en transacción", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    const caja = makeCaja();

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          cajaCaja: { create: vi.fn().mockResolvedValue(caja) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        })) as never
    );

    const result = await createCajaCaja(
      { companyId: COMPANY_ID, name: "Caja Operativa", accountId: "acc-caja", currency: "VES", maxBalance: "1000000" },
      USER_ID
    );

    expect(result.id).toBe("caja-1");
    expect(result.availableBalance).toBe("0.00");
    expect(result.percentUsed).toBe(0);
  });
});

// ─── Balance computation ──────────────────────────────────────────────────────

describe("balance computation (indirect via getCajaCajaById)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computa saldo disponible correctamente", async () => {
    const { getCajaCajaById } = await import("../services/CajaCajaService");

    const cajaWithBalance = makeCaja({
      deposits: [{ amount: new Decimal("1000000") }],
      movements: [
        { amount: new Decimal("200000"), status: "APPROVED" },
        { amount: new Decimal("50000"), status: "PENDING" },
      ],
    });

    vi.mocked(prisma.cajaCaja.findFirst).mockResolvedValue(cajaWithBalance as never);

    const result = await getCajaCajaById("caja-1", COMPANY_ID);
    expect(result?.availableBalance).toBe("750000.00");
    expect(result?.totalApprovedMovements).toBe("200000.00");
    expect(result?.totalPendingMovements).toBe("50000.00");
  });
});

// ─── closeCajaCaja ────────────────────────────────────────────────────────────

describe("closeCajaCaja", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza cierre con movimientos pendientes", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          cajaCaja: {
            findFirst: vi.fn().mockResolvedValue(
              makeCaja({ movements: [{ status: "PENDING" }] })
            ),
            update: vi.fn(),
          },
          auditLog: { create: vi.fn() },
        })) as never
    );

    await expect(
      closeCajaCaja({ cajaCajaId: "caja-1", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("No se puede cerrar con movimientos pendientes");
  });

  it("cierra caja sin movimientos pendientes", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const updateMock = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          cajaCaja: {
            findFirst: vi.fn().mockResolvedValue(makeCaja({ movements: [] })),
            update: updateMock,
          },
          auditLog: { create: vi.fn() },
        })) as never
    );

    await closeCajaCaja({ cajaCajaId: "caja-1", companyId: COMPANY_ID }, USER_ID);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "caja-1" }, data: expect.objectContaining({ status: "CLOSED" }) })
    );
  });
});
