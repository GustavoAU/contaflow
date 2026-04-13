// src/modules/inventory/__tests__/InventoryAccountingService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockItem = {
  id: "item-001",
  companyId: "company-001",
  name: "Producto Test",
  unit: "unidad",
  averageCost: new Decimal("100.00"),
  stockQuantity: new Decimal("10.00"),
  accountId: "acc-inv",
  cogsAccountId: "acc-cogs",
  deletedAt: null,
};

const makeMockMovement = (overrides: Partial<{
  status: string;
  type: string;
  quantity: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  item: typeof mockItem;
}> = {}) => ({
  id: "mov-001",
  companyId: "company-001",
  status: "DRAFT",
  type: "ENTRADA",
  quantity: new Decimal("5"),
  unitCost: new Decimal("120"),
  totalCost: new Decimal("600"),
  date: new Date(),
  item: mockItem,
  ...overrides,
});

const makeTx = (movement = makeMockMovement()) => ({
  inventoryMovement: {
    findFirstOrThrow: vi.fn().mockResolvedValue(movement),
    update: vi.fn().mockResolvedValue({ ...movement, status: "POSTED" }),
  },
  inventoryItem: {
    update: vi.fn().mockResolvedValue(mockItem),
  },
  transaction: {
    count: vi.fn().mockResolvedValue(5),
    create: vi.fn().mockResolvedValue({ id: "tx-001" }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
});

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    inventoryMovement: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { postMovement, voidPostedMovement, getInventoryValuation } from "../services/InventoryAccountingService";
import prisma from "@/lib/prisma";

const COMPANY_ID = "company-001";
const USER_ID = "user-test";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── postMovement — CPP ───────────────────────────────────────────────────────

describe("postMovement — CPP y actualización de stock", () => {
  it("ENTRADA: calcula nuevo averageCost con fórmula CPP", async () => {
    const movement = makeMockMovement({
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("120"),
      totalCost: new Decimal("600"),
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);

    // CPP: (10 × 100 + 5 × 120) / (10 + 5) = (1000 + 600) / 15 = 106.666...
    const updateCall = tx.inventoryItem.update.mock.calls[0]![0];
    expect(updateCall.data.stockQuantity.toString()).toBe("15");
    const expectedAvg = new Decimal("10").mul("100").plus(new Decimal("5").mul("120")).div("15");
    expect(updateCall.data.averageCost.toFixed(4)).toBe(expectedAvg.toFixed(4));
  });

  it("SALIDA: descuenta stock y mantiene averageCost", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      quantity: new Decimal("3"),
      unitCost: new Decimal("100"),
      totalCost: new Decimal("300"),
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);

    const updateCall = tx.inventoryItem.update.mock.calls[0]![0];
    expect(updateCall.data.stockQuantity.toString()).toBe("7"); // 10 - 3
    // averageCost no cambia en salidas
    expect(updateCall.data.averageCost.toString()).toBe(mockItem.averageCost.toString());
  });

  it("HIGH-4: lanza error si SALIDA con stock insuficiente", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      quantity: new Decimal("15"), // > stock=10
      unitCost: new Decimal("100"),
      totalCost: new Decimal("1500"),
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("lanza error si el ítem no tiene accountId configurado", async () => {
    const movement = makeMockMovement({
      item: { ...mockItem, accountId: null! },
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("cuenta de inventario");
  });

  it("lanza error si el movimiento no está en DRAFT", async () => {
    const movement = makeMockMovement({ status: "POSTED" });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Solo se pueden contabilizar movimientos en DRAFT");
  });

  it("genera asiento contable SALIDA: Débito COGS / Crédito Inventario", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      quantity: new Decimal("3"),
      unitCost: new Decimal("100"),
      totalCost: new Decimal("300"),
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);

    const txCreate = tx.transaction.create.mock.calls[0]![0];
    const entries = txCreate.data.entries.create;
    expect(entries).toHaveLength(2);
    // Débito COGS
    expect(entries[0].accountId).toBe("acc-cogs");
    expect(entries[0].amount.gt(0)).toBe(true);
    // Crédito Inventario
    expect(entries[1].accountId).toBe("acc-inv");
    expect(entries[1].amount.lt(0)).toBe(true);
  });

  it("captura P2034 y lanza error descriptivo", async () => {
    const p2034Error = Object.assign(new Error("P2034"), { code: "P2034" });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2034Error);

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Conflicto de concurrencia — reintente la operación");
  });

  it("usa isolationLevel Serializable", async () => {
    const tx = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown, opts: unknown) => {
        expect(opts).toEqual({ isolationLevel: "Serializable" });
        return fn(tx);
      }) as never
    );

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
  });

  it("registra AuditLog dentro del mismo $transaction", async () => {
    const tx = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);

    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityName: "InventoryMovement",
          action: "POST",
          userId: USER_ID,
        }),
      })
    );
  });
});

// ─── voidPostedMovement ───────────────────────────────────────────────────────

describe("voidPostedMovement", () => {
  it("lanza error si el movimiento no está en POSTED", async () => {
    const movement = {
      ...makeMockMovement({ status: "DRAFT" }),
    };
    const tx = {
      inventoryMovement: {
        findFirstOrThrow: vi.fn().mockResolvedValue(movement),
        update: vi.fn(),
      },
      inventoryItem: { update: vi.fn() },
      transaction: { count: vi.fn().mockResolvedValue(1), create: vi.fn() },
      auditLog: { create: vi.fn() },
    };

    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: typeof tx) => unknown) => fn(tx)) as never
    );

    await expect(
      voidPostedMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Solo se pueden anular movimientos en POSTED");
  });

  it("captura P2034 y lanza error descriptivo", async () => {
    const p2034Error = Object.assign(new Error("P2034"), { code: "P2034" });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2034Error);

    await expect(
      voidPostedMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Conflicto de concurrencia — reintente la operación");
  });
});

// ─── getInventoryValuation — ADR-004 ─────────────────────────────────────────

describe("getInventoryValuation", () => {
  it("ADR-004: incluye companyId en el where de la consulta", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);
    await getInventoryValuation(COMPANY_ID);
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      })
    );
  });

  it("calcula totalValue correctamente con múltiples ítems", async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { ...mockItem, stockQuantity: new Decimal("10"), averageCost: new Decimal("100") },
      { ...mockItem, id: "item-002", stockQuantity: new Decimal("5"), averageCost: new Decimal("200") },
    ] as never);

    const result = await getInventoryValuation(COMPANY_ID);
    // 10×100 + 5×200 = 1000 + 1000 = 2000
    expect(result.totalValue.toString()).toBe("2000");
  });
});
