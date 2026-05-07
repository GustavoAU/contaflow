// src/modules/inventory/__tests__/inventory-accounting.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockMemberAccountant } = vi.hoisted(() => ({
  mockMemberAccountant: { role: "ACCOUNTANT" as const },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-test" }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn().mockResolvedValue(mockMemberAccountant) },
    $transaction: vi.fn().mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never),
  },
}));
vi.mock("../services/InventoryAccountingService", () => ({
  postMovement: vi.fn().mockResolvedValue({
    movement: { id: "mov-001" },
    transaction: { id: "tx-001" },
    stockAfter: "15.00",
    avgCostAfter: "110.00",
  }),
  voidPostedMovement: vi.fn().mockResolvedValue({
    movement: { id: "mov-001" },
    voidTransaction: { id: "tx-void-001" },
  }),
  getInventoryValuation: vi.fn().mockResolvedValue({
    items: [],
    totalValue: "0",
  }),
  getPendingMovements: vi.fn().mockResolvedValue([]),
}));

import {
  postMovementAction,
  voidPostedMovementAction,
  getInventoryValuationAction,
  getPendingMovementsAction,
} from "../actions/inventory-accounting.actions";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import * as AccountingService from "../services/InventoryAccountingService";

const COMPANY_ID = "company-001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-test" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMemberAccountant as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
});

// ─── postMovementAction ───────────────────────────────────────────────────────

describe("postMovementAction", () => {
  it("ACCOUNTANT puede contabilizar movimiento DRAFT", async () => {
    const result = await postMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result).toEqual({
      success: true,
      data: { movementId: "mov-001", transactionId: "tx-001" },
    });
    expect(vi.mocked(AccountingService.postMovement)).toHaveBeenCalledOnce();
  });

  it("rechaza si no hay userId", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si rate limit excedido", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes",
    } as never);
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "Demasiadas solicitudes" });
  });

  it("rechaza si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({ success: false, error: "Empresa no encontrada o acceso denegado" });
  });

  it("HIGH-2: rechaza ADMINISTRATIVE — no puede contabilizar", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({
      success: false,
      error: "Módulo contable: se requiere rol Contador o superior",
    });
  });

  it("HIGH-2: rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result.success).toBe(false);
  });

  it("rechaza input inválido (movementId vacío)", async () => {
    const result = await postMovementAction({ movementId: "", companyId: COMPANY_ID });
    expect(result.success).toBe(false);
  });

  it("propaga error de servicio (ej. movimiento no en DRAFT)", async () => {
    vi.mocked(AccountingService.postMovement).mockRejectedValueOnce(
      new Error("Solo se pueden contabilizar movimientos en DRAFT. Estado actual: POSTED")
    );
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({
      success: false,
      error: "Solo se pueden contabilizar movimientos en DRAFT. Estado actual: POSTED",
    });
  });

  it("propaga error P2034 (conflicto Serializable) como mensaje descriptivo", async () => {
    vi.mocked(AccountingService.postMovement).mockRejectedValueOnce(
      new Error("Conflicto de concurrencia — reintente la operación")
    );
    const result = await postMovementAction({ movementId: "mov-001", companyId: COMPANY_ID });
    expect(result).toEqual({
      success: false,
      error: "Conflicto de concurrencia — reintente la operación",
    });
  });
});

// ─── voidPostedMovementAction ─────────────────────────────────────────────────

describe("voidPostedMovementAction", () => {
  it("ACCOUNTANT puede anular movimiento POSTED", async () => {
    const result = await voidPostedMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result).toEqual({ success: true, data: true });
  });

  it("HIGH-2: rechaza ADMINISTRATIVE", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await voidPostedMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Contador");
  });

  it("propaga error de servicio (stock negativo al anular ENTRADA)", async () => {
    vi.mocked(AccountingService.voidPostedMovement).mockRejectedValueOnce(
      new Error("No se puede anular: el stock resultante sería negativo")
    );
    const result = await voidPostedMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result).toEqual({
      success: false,
      error: "No se puede anular: el stock resultante sería negativo",
    });
  });
});

// ─── getInventoryValuationAction ──────────────────────────────────────────────

describe("getInventoryValuationAction", () => {
  it("ACCOUNTANT puede obtener valoración", async () => {
    const result = await getInventoryValuationAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("ADMINISTRATIVE puede obtener valoración (WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await getInventoryValuationAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getInventoryValuationAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});

// ─── getPendingMovementsAction ────────────────────────────────────────────────

describe("getPendingMovementsAction", () => {
  it("ACCOUNTANT ve los movimientos pendientes", async () => {
    const result = await getPendingMovementsAction(COMPANY_ID);
    expect(result).toEqual({ success: true, data: [] });
  });

  it("HIGH-2: ADMINISTRATIVE no puede ver los pendientes de contabilización", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await getPendingMovementsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});
