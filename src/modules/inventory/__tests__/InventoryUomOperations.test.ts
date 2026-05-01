// Tests de integración: createDraftMovement + resolveQuantity (Fase 35F Sub-fase B)
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    inventoryItem: { findFirstOrThrow: vi.fn() },
    inventoryItemUnit: { findFirstOrThrow: vi.fn() },
    inventoryMovement: { findUnique: vi.fn(), findMany: vi.fn() },
    invoice: { findFirstOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { createDraftMovement } from "../services/InventoryOperationsService";
import prisma from "@/lib/prisma";

const COMPANY_ID = "company-001";
const ITEM_ID = "item-001";
const UNIT_ID = "unit-box";
const USER_ID = "user-test";

const makeItem = (overrides = {}) => ({
  id: ITEM_ID,
  companyId: COMPANY_ID,
  sku: "PROD-001",
  name: "Producto Test",
  averageCost: new Decimal("100.00"),
  stockQuantity: new Decimal("120.00"),  // 10 cajas × 12 unidades/caja
  deletedAt: null,
  accountId: "acc-inv",
  cogsAccountId: "acc-cogs",
  ...overrides,
});

const makeBoxUnit = (overrides = {}) => ({
  id: UNIT_ID,
  companyId: COMPANY_ID,
  itemId: ITEM_ID,
  conversionFactor: new Decimal("12"),  // 1 caja = 12 unidades
  isBase: false,
  deletedAt: null,
  ...overrides,
});

const makeMovement = (overrides = {}) => ({
  id: "mov-001",
  status: "DRAFT",
  itemId: ITEM_ID,
  type: "ENTRADA",
  quantity: new Decimal("60"),
  unitCost: new Decimal("100"),
  totalCost: new Decimal("6000"),
  idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
  ...overrides,
});

const makeTx = () => ({
  inventoryMovement: {
    create: vi.fn().mockResolvedValue(makeMovement()),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

let currentTx: ReturnType<typeof makeTx>;

const BASE = {
  companyId: COMPANY_ID,
  itemId: ITEM_ID,
  type: "ENTRADA" as const,
  quantity: 5,
  unitCost: 100,
  date: new Date().toISOString(),
  idempotencyKey: "550e8400-e29b-41d4-a716-446655440001",
};

beforeEach(() => {
  vi.clearAllMocks();
  currentTx = makeTx();

  vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue(makeItem() as never);
  vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValue(makeBoxUnit() as never);
  vi.mocked(prisma.inventoryMovement.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof currentTx) => unknown) => fn(currentTx)) as never
  );
});

// ─── Sin unitId — comportamiento base sin cambios ─────────────────────────────

describe("createDraftMovement — sin unitId (unidad base implícita)", () => {
  it("quantity en DB es igual al input cuando no hay unitId", async () => {
    await createDraftMovement(BASE, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.quantity.toString()).toBe("5");
    expect(data.quantityInUnit.toString()).toBe("5");
    expect(data.conversionSnapshot.toString()).toBe("1");
    expect(data.unitId).toBeNull();
  });

  it("no llama a prisma.inventoryItemUnit cuando unitId es null", async () => {
    await createDraftMovement(BASE, USER_ID);
    expect(prisma.inventoryItemUnit.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("totalCost = unitCost × quantity (sin conversión)", async () => {
    await createDraftMovement({ ...BASE, quantity: 3, unitCost: 200 }, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.totalCost.toString()).toBe("600");
  });
});

// ─── Con unitId — conversión a unidad base ─────────────────────────────────────

describe("createDraftMovement — con unitId (conversión de unidad)", () => {
  const BASE_WITH_UNIT = { ...BASE, unitId: UNIT_ID };

  it("convierte quantity a unidad base (5 cajas × 12 = 60 unidades)", async () => {
    await createDraftMovement(BASE_WITH_UNIT, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.quantity.toString()).toBe("60");       // en base
    expect(data.quantityInUnit.toString()).toBe("5");  // input original
    expect(data.conversionSnapshot.toString()).toBe("12");
    expect(data.unitId).toBe(UNIT_ID);
  });

  it("totalCost usa cantidad en unidad base", async () => {
    // 60 unidades × 100 = 6000
    await createDraftMovement({ ...BASE_WITH_UNIT, unitCost: 100 }, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.totalCost.toString()).toBe("6000");
  });

  it("HIGH-1: resolveQuantity verifica companyId — rechaza unidad de otra empresa", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Unit not found")
    );
    await expect(
      createDraftMovement({ ...BASE_WITH_UNIT, unitId: "unit-other-company" }, USER_ID)
    ).rejects.toThrow();
  });

  it("validación de stock usa cantidad convertida a base", async () => {
    // Stock = 120 unidades base = 10 cajas
    // Pedir 11 cajas = 132 unidades base → debe fallar
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValueOnce(
      makeItem({ stockQuantity: new Decimal("120") }) as never
    );
    await expect(
      createDraftMovement(
        { ...BASE_WITH_UNIT, type: "SALIDA", quantity: 11 },
        USER_ID
      )
    ).rejects.toThrow("Stock insuficiente");
  });

  it("validación de stock pasa cuando hay suficiente en base", async () => {
    // Stock = 120 unidades base = 10 cajas
    // Pedir 9 cajas = 108 unidades base → debe pasar
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValueOnce(
      makeItem({ stockQuantity: new Decimal("120") }) as never
    );
    await createDraftMovement(
      { ...BASE_WITH_UNIT, type: "SALIDA", quantity: 9 },
      USER_ID
    );
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.quantity.toString()).toBe("108"); // 9 × 12
  });

  it("AuditLog incluye quantityInBase, quantityInUnit y conversionSnapshot", async () => {
    await createDraftMovement(BASE_WITH_UNIT, USER_ID);
    const auditCall = currentTx.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.newValue).toMatchObject({
      quantityInBase: "60",
      quantityInUnit: "5",
      conversionSnapshot: "12",
      unitId: UNIT_ID,
    });
  });

  it("conversionSnapshot es inmutable: se guarda el factor al momento del movimiento", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBoxUnit({ conversionFactor: new Decimal("24") }) as never
    );
    await createDraftMovement({ ...BASE_WITH_UNIT, quantity: 2 }, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.conversionSnapshot.toString()).toBe("24");
    expect(data.quantity.toString()).toBe("48"); // 2 × 24
  });

  it("factor de conversión fraccionario (gramos a kg: 0.001)", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBoxUnit({ conversionFactor: new Decimal("0.001") }) as never
    );
    // 500 gramos → 0.5 kg en base
    await createDraftMovement({ ...BASE_WITH_UNIT, quantity: 500 }, USER_ID);
    const data = currentTx.inventoryMovement.create.mock.calls[0]![0].data;
    expect(data.quantity.toFixed(4)).toBe("0.5000");
    expect(data.conversionSnapshot.toString()).toBe("0.001");
  });

  it("idempotencia: retorna movimiento existente sin llamar a inventoryItemUnit", async () => {
    vi.mocked(prisma.inventoryMovement.findUnique).mockResolvedValueOnce(
      makeMovement() as never
    );
    const result = await createDraftMovement(BASE_WITH_UNIT, USER_ID);
    expect(result.id).toBe("mov-001");
    expect(prisma.inventoryItemUnit.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
