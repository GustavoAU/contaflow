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
  trackingType: "NONE" as const,
  deletedAt: null,
};

const makeMockMovement = (
  overrides: Partial<{
    status: string;
    type: string;
    quantity: Decimal;
    unitCost: Decimal;
    totalCost: Decimal;
    item: typeof mockItem;
  }> = {}
) => ({
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

import {
  postMovement,
  voidPostedMovement,
  getInventoryValuation,
  autoPostMovementInTx,
} from "../services/InventoryAccountingService";
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

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("lanza error si el ítem no tiene accountId configurado", async () => {
    const movement = makeMockMovement({
      item: { ...mockItem, accountId: null! },
    });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

    await expect(
      postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("cuenta de inventario");
  });

  it("lanza error si el movimiento no está en DRAFT", async () => {
    const movement = makeMockMovement({ status: "POSTED" });
    const tx = makeTx(movement);

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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
    vi.mocked(prisma.$transaction).mockImplementation(((
      fn: (t: typeof tx) => unknown,
      opts: unknown
    ) => {
      expect(opts).toEqual({ isolationLevel: "Serializable" });
      return fn(tx);
    }) as never);

    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("registra AuditLog dentro del mismo $transaction", async () => {
    const tx = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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

    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

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
      {
        ...mockItem,
        id: "item-002",
        stockQuantity: new Decimal("5"),
        averageCost: new Decimal("200"),
      },
    ] as never);

    const result = await getInventoryValuation(COMPANY_ID);
    // 10×100 + 5×200 = 1000 + 1000 = 2000
    expect(result.totalValue.toString()).toBe("2000");
  });
});

// ─── autoPostMovementInTx — OM-01 ─────────────────────────────────────────────

describe("autoPostMovementInTx — OM-01: contabilización inline en factura", () => {
  const makeAutoTx = (movement: ReturnType<typeof makeMockMovement>) => ({
    inventoryMovement: {
      findFirst: vi.fn().mockResolvedValue(movement),
      update: vi.fn().mockResolvedValue({ ...movement, status: "POSTED" }),
    },
    inventoryItem: { update: vi.fn().mockResolvedValue({}) },
    transaction: {
      count: vi.fn().mockResolvedValue(3),
      create: vi.fn().mockResolvedValue({ id: "tx-auto-001" }),
    },
  });

  it("SALIDA — crea asiento Dr COGS / Cr Inventario y marca POSTED", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("100"),
      totalCost: new Decimal("500"),
      item: { ...mockItem, trackingType: "NONE" } as never,
    });
    const tx = makeAutoTx(movement);

    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, null);

    // Debe crear transacción con Dr COGS / Cr Inventario
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entries: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ accountId: "acc-cogs" }),
              expect.objectContaining({ accountId: "acc-inv" }),
            ]),
          }),
        }),
      })
    );

    // Stock debe bajar
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stockQuantity: expect.any(Object), // Decimal
        }),
      })
    );

    // Movimiento debe marcarse POSTED
    expect(tx.inventoryMovement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
  });

  it("ENTRADA — reutiliza glTransactionId de la factura (no crea asiento nuevo)", async () => {
    const movement = makeMockMovement({
      type: "ENTRADA",
      quantity: new Decimal("10"),
      unitCost: new Decimal("120"),
      totalCost: new Decimal("1200"),
      item: { ...mockItem, trackingType: "NONE" } as never,
    });
    const tx = makeAutoTx(movement);

    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, "invoice-tx-001");

    // No debe crear nueva transacción GL (la factura ya tiene Dr Inventario)
    expect(tx.transaction.create).not.toHaveBeenCalled();

    // Stock debe subir y CPP actualizarse
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stockQuantity: expect.any(Object) }),
      })
    );

    // Movimiento POSTED con el transactionId de la factura
    expect(tx.inventoryMovement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "POSTED",
          transactionId: "invoice-tx-001",
        }),
      })
    );
  });

  it("ENTRADA sin invoiceGLTransactionId → skip silencioso (movimiento queda DRAFT)", async () => {
    const movement = makeMockMovement({
      type: "ENTRADA",
      item: { ...mockItem, trackingType: "NONE" } as never,
    });
    const tx = makeAutoTx(movement);

    // invoiceGLTransactionId = null → no puede contabilizar ENTRADA sin GL de factura
    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, null);

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.update).not.toHaveBeenCalled();
  });

  it("LOT tracking → skip silencioso (requiere datos de lote)", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      item: { ...mockItem, trackingType: "LOT" } as never,
    });
    const tx = makeAutoTx(movement);

    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, null);

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.update).not.toHaveBeenCalled();
  });

  it("SALIDA sin cogsAccountId → skip silencioso (sin config GL)", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      item: { ...mockItem, cogsAccountId: null, trackingType: "NONE" } as never,
    });
    const tx = makeAutoTx(movement);

    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, null);

    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.update).not.toHaveBeenCalled();
  });

  it("movimiento no encontrado → skip silencioso", async () => {
    const tx = {
      inventoryMovement: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      inventoryItem: { update: vi.fn() },
      transaction: { count: vi.fn(), create: vi.fn() },
    };

    await autoPostMovementInTx(tx as never, "nonexistent", COMPANY_ID, USER_ID, null);

    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});

// ─── ADR-058 / SPEC-004 lote 2 — cuantizacion al centimo ─────────────────────

describe("ADR-058 — InventoryAccountingService cuantiza al centimo", () => {
  type L = { accountId: string; amount: Decimal };
  const linesOf = (tx: ReturnType<typeof makeTx>) =>
    tx.transaction.create.mock.calls[0]![0].data.entries.create as L[];
  const runPost = async (movement: ReturnType<typeof makeMockMovement>) => {
    const tx = makeTx(movement);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);
    await postMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);
    return tx;
  };

  it("SALIDA con totalCost a 4 decimales: asiento y movimiento a 2 decimales, Σ = 0", async () => {
    const tx = await runPost(
      makeMockMovement({
        type: "SALIDA",
        quantity: new Decimal("3"),
        unitCost: new Decimal("411.5226"),
        totalCost: new Decimal("1234.5678"),
      })
    );
    const lines = linesOf(tx);
    // 1234.5678 -> 1234.57
    expect(lines.map((l) => l.amount.toString())).toEqual(["1234.57", "-1234.57"]);
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
    for (const l of lines) expect("noAbsorb" in l).toBe(false);
    // El DOCUMENTO se persiste a 2 decimales; el costo unitario CPP (factor) no se toca.
    const movUpdate = tx.inventoryMovement.update.mock.calls[0]![0];
    expect(movUpdate.data.totalCost.toString()).toBe("1234.57");
    expect(movUpdate.data.unitCost.toString()).toBe("411.5226");
  });

  it("ENTRADA con contrapartida: 2 lineas a 2 decimales y Σ = 0", async () => {
    const tx = await runPost(
      makeMockMovement({
        type: "ENTRADA",
        quantity: new Decimal("7"),
        unitCost: new Decimal("33.3333"),
        totalCost: new Decimal("233.3331"),
        ...({ counterpartAccountId: "acc-cxp" } as object),
      })
    );
    const lines = linesOf(tx);
    expect(lines.map((l) => l.amount.toString())).toEqual(["233.33", "-233.33"]);
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
  });

  it("ADR-058 B1: ENTRADA standalone conserva su asiento de UNA linea (se redondea, no se exige Σ = 0)", async () => {
    const tx = await runPost(
      makeMockMovement({
        type: "ENTRADA",
        quantity: new Decimal("7"),
        unitCost: new Decimal("33.3333"),
        totalCost: new Decimal("233.3376"),
      })
    );
    const lines = linesOf(tx);
    expect(lines).toHaveLength(1);
    expect(lines[0].accountId).toBe("acc-inv");
    expect(lines[0].amount.toString()).toBe("233.34");
    expect("noAbsorb" in lines[0]).toBe(false);
  });

  it("anulacion de un movimiento historico a 4 decimales: negacion EXACTA (no cuantiza)", async () => {
    const movement = makeMockMovement({
      status: "POSTED",
      type: "SALIDA",
      quantity: new Decimal("3"),
      totalCost: new Decimal("1234.5678"),
    });
    const tx = makeTx(movement);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => unknown) =>
      fn(tx)) as never);

    await voidPostedMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);

    const lines = linesOf(tx);
    expect(lines.map((l) => l.amount.toString())).toEqual(["-1234.5678", "1234.5678"]);
    expect(lines.reduce((a, l) => a.plus(l.amount), new Decimal(0)).isZero()).toBe(true);
  });

  it("autoPostMovementInTx SALIDA con totalCost a 4 decimales: asiento COGS a 2 decimales, Σ = 0", async () => {
    const movement = makeMockMovement({
      type: "SALIDA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("246.9136"),
      totalCost: new Decimal("1234.5678"),
      item: { ...mockItem, trackingType: "NONE" } as never,
    });
    const tx = {
      inventoryMovement: {
        findFirst: vi.fn().mockResolvedValue(movement),
        update: vi.fn().mockResolvedValue({}),
      },
      inventoryItem: { update: vi.fn().mockResolvedValue({}) },
      transaction: {
        count: vi.fn().mockResolvedValue(3),
        create: vi.fn().mockResolvedValue({ id: "tx-auto-001" }),
      },
    };

    await autoPostMovementInTx(tx as never, "mov-001", COMPANY_ID, USER_ID, null);

    const lines = tx.transaction.create.mock.calls[0]![0].data.entries.create as L[];
    expect(lines.map((l) => l.amount.toString())).toEqual(["1234.57", "-1234.57"]);
    for (const l of lines) expect("noAbsorb" in l).toBe(false);
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data.totalCost.toString()).toBe("1234.57");
  });
});
