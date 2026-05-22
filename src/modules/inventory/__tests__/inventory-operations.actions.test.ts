// src/modules/inventory/__tests__/inventory-operations.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockMember, mockItem, mockMovement } = vi.hoisted(() => ({
  mockMember: { role: "ADMINISTRATIVE" as const },
  mockItem: {
    id: "item-001",
    companyId: "company-001",
    sku: "PROD-001",
    name: "Producto Test",
    unit: "unidad",
    averageCost: "100.00",
    stockQuantity: "10.00",
    deletedAt: null,
  },
  mockMovement: {
    id: "mov-001",
    companyId: "company-001",
    itemId: "item-001",
    type: "ENTRADA",
    status: "DRAFT",
    quantity: "5.00",
    unitCost: "100.00",
    totalCost: "500.00",
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    date: new Date(),
    createdBy: "user-test",
    createdAt: new Date(),
  },
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
    companyMember: { findFirst: vi.fn().mockResolvedValue(mockMember) },
    $transaction: vi.fn().mockImplementation(((fn: (tx: unknown) => unknown) => fn({})) as never),
  },
}));
vi.mock("../services/InventoryOperationsService", () => ({
  createInventoryItem: vi.fn().mockResolvedValue({ id: "item-001" }),
  updateInventoryItem: vi.fn().mockResolvedValue({ id: "item-001" }),
  softDeleteInventoryItem: vi.fn().mockResolvedValue({ id: "item-001" }),
  createDraftMovement: vi.fn().mockResolvedValue({ id: "mov-001" }),
  voidDraftMovement: vi.fn().mockResolvedValue({ id: "mov-001" }),
  getInventoryItems: vi.fn().mockResolvedValue([]),
  getDraftMovements: vi.fn().mockResolvedValue([]),
  getItemMovements: vi.fn().mockResolvedValue([]),
}));

import {
  createInventoryItemAction,
  updateInventoryItemAction,
  softDeleteInventoryItemAction,
  createMovementAction,
  voidDraftMovementAction,
  getInventoryItemsAction,
  getItemMovementsAction,
} from "../actions/inventory-operations.actions";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";
import * as OpsService from "../services/InventoryOperationsService";

const COMPANY_ID = "company-001";

const BASE_ITEM_INPUT = {
  companyId: COMPANY_ID,
  sku: "PROD-001",
  name: "Producto Test",
  itemType: "GOODS" as const,
  accountId: "acc-inv-001",       // R-01: cuentas obligatorias para GOODS
  cogsAccountId: "acc-cogs-001",
};

const BASE_MOVEMENT_INPUT = {
  companyId: COMPANY_ID,
  itemId: "item-001",
  type: "ENTRADA" as const,
  quantity: 5,
  unitCost: "100",
  reference: "FAC-2026-001",  // R-03: referencia obligatoria (min 3 chars)
  date: new Date().toISOString(),
  idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: "user-test" } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMember as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
});

// ─── createInventoryItemAction ─────────────────────────────────────────────────

describe("createInventoryItemAction", () => {
  it("retorna success con id cuando input es válido", async () => {
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    expect(result).toEqual({ success: true, data: "item-001" });
    expect(vi.mocked(OpsService.createInventoryItem)).toHaveBeenCalledOnce();
  });

  it("rechaza si no hay userId (no autenticado)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si rate limit excedido", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes",
    } as never);
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    expect(result).toEqual({ success: false, error: "Demasiadas solicitudes" });
  });

  it("rechaza si el miembro no existe en la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    expect(result).toEqual({ success: false, error: "Empresa no encontrada o acceso denegado" });
  });

  it("HIGH-1: rechaza si el rol es VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    expect(result).toEqual({
      success: false,
      error: "Se requiere rol Administrativo o superior",
    });
  });

  it("rechaza si el input no supera Zod (sku vacío)", async () => {
    const result = await createInventoryItemAction({ ...BASE_ITEM_INPUT, sku: "" });
    expect(result.success).toBe(false);
  });

  it("ACCOUNTANT puede crear ítems (en OPERATIONS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await createInventoryItemAction(BASE_ITEM_INPUT);
    // ACCOUNTANT no está en ROLES.OPERATIONS → rechaza
    expect(result).toEqual({
      success: false,
      error: "Se requiere rol Administrativo o superior",
    });
  });
});

// ─── updateInventoryItemAction ────────────────────────────────────────────────

describe("updateInventoryItemAction", () => {
  it("retorna success cuando input válido y ADMINISTRATIVE", async () => {
    const result = await updateInventoryItemAction({
      itemId: "item-001",
      companyId: COMPANY_ID,
      name: "Nuevo Nombre",
    });
    expect(result).toEqual({ success: true, data: "item-001" });
  });

  it("HIGH-1: rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await updateInventoryItemAction({
      itemId: "item-001",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
  });
});

// ─── softDeleteInventoryItemAction ────────────────────────────────────────────

describe("softDeleteInventoryItemAction", () => {
  it("rechaza ADMINISTRATIVE — solo ADMIN_ONLY", async () => {
    // ADMINISTRATIVE no está en ADMIN_ONLY
    const result = await softDeleteInventoryItemAction(COMPANY_ID, "item-001");
    expect(result).toEqual({
      success: false,
      error: "Se requiere rol Administrador o superior",
    });
  });

  it("ADMIN puede eliminar", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
    const result = await softDeleteInventoryItemAction(COMPANY_ID, "item-001");
    expect(result).toEqual({ success: true, data: true });
  });
});

// ─── createMovementAction ─────────────────────────────────────────────────────

describe("createMovementAction", () => {
  it("retorna success con id de movimiento creado", async () => {
    const result = await createMovementAction(BASE_MOVEMENT_INPUT);
    expect(result).toEqual({ success: true, data: "mov-001" });
  });

  it("HIGH-1: rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await createMovementAction(BASE_MOVEMENT_INPUT);
    expect(result.success).toBe(false);
  });

  it("rechaza si no hay userId", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await createMovementAction(BASE_MOVEMENT_INPUT);
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si quantity <= 0 (Zod)", async () => {
    const result = await createMovementAction({ ...BASE_MOVEMENT_INPUT, quantity: -1 });
    expect(result.success).toBe(false);
  });

  it("rechaza si quantity > 1_000_000 (ceiling)", async () => {
    const result = await createMovementAction({ ...BASE_MOVEMENT_INPUT, quantity: 2_000_000 });
    expect(result.success).toBe(false);
  });

  it("rechaza si type no es válido (LOW-2)", async () => {
    const result = await createMovementAction({ ...BASE_MOVEMENT_INPUT, type: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("propagates service error como { success: false }", async () => {
    vi.mocked(OpsService.createDraftMovement).mockRejectedValueOnce(
      new Error("Stock insuficiente: disponible 3, solicitado 5")
    );
    const result = await createMovementAction({ ...BASE_MOVEMENT_INPUT, type: "SALIDA" });
    expect(result).toEqual({
      success: false,
      error: "Stock insuficiente: disponible 3, solicitado 5",
    });
  });
});

// ─── voidDraftMovementAction ──────────────────────────────────────────────────

describe("voidDraftMovementAction", () => {
  it("retorna success cuando ADMINISTRATIVE anula DRAFT", async () => {
    const result = await voidDraftMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result).toEqual({ success: true, data: true });
  });

  it("rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await voidDraftMovementAction({
      movementId: "mov-001",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
  });
});

// ─── getInventoryItemsAction ──────────────────────────────────────────────────

describe("getInventoryItemsAction", () => {
  it("ADMINISTRATIVE puede listar ítems (WRITERS)", async () => {
    const result = await getInventoryItemsAction(COMPANY_ID);
    expect(result).toEqual({ success: true, data: [] });
  });

  it("rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getInventoryItemsAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });
});

// ─── getItemMovementsAction ───────────────────────────────────────────────────

describe("getItemMovementsAction", () => {
  it("ADMINISTRATIVE puede ver historial (WRITERS)", async () => {
    const result = await getItemMovementsAction(COMPANY_ID, "item-001");
    expect(result).toEqual({ success: true, data: [] });
    expect(vi.mocked(OpsService.getItemMovements)).toHaveBeenCalledWith(COMPANY_ID, "item-001");
  });

  it("ACCOUNTANT puede ver historial (WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await getItemMovementsAction(COMPANY_ID, "item-001");
    expect(result.success).toBe(true);
  });

  it("rechaza si no hay userId", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await getItemMovementsAction(COMPANY_ID, "item-001");
    expect(result).toEqual({ success: false, error: "No autorizado" });
  });

  it("rechaza si no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await getItemMovementsAction(COMPANY_ID, "item-001");
    expect(result).toEqual({ success: false, error: "Empresa no encontrada o acceso denegado" });
  });

  it("rechaza VIEWER (no está en WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getItemMovementsAction(COMPANY_ID, "item-001");
    expect(result.success).toBe(false);
  });

  it("propaga error del servicio", async () => {
    vi.mocked(OpsService.getItemMovements).mockRejectedValueOnce(
      new Error("Ítem no encontrado o sin acceso")
    );
    const result = await getItemMovementsAction(COMPANY_ID, "item-no-existe");
    expect(result).toEqual({ success: false, error: "Ítem no encontrado o sin acceso" });
  });
});
