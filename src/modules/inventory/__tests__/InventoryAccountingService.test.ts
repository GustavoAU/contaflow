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

// SPEC-007: el movimiento lleva ahora contrapartida, factura y asiento enlazado. El valor por
// defecto es una ENTRADA con contrapartida Banco (valida): los tests que ejercitan la falta de
// contrapartida la ponen en null de forma explicita.
const makeMockMovement = (
  overrides: Partial<{
    status: string;
    type: string;
    quantity: Decimal;
    unitCost: Decimal;
    totalCost: Decimal;
    item: typeof mockItem;
    date: Date;
    counterpartAccountId: string | null;
    invoiceId: string | null;
    transactionId: string | null;
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
  counterpartAccountId: "acc-banco" as string | null,
  invoiceId: null as string | null,
  transactionId: null as string | null,
  item: mockItem,
  ...overrides,
});

const makeTx = (
  movement = makeMockMovement(),
  // Periodos existentes en la "BD" falsa (por defecto ninguno). El servicio consulta solo los CLOSED.
  periods: Row[] = []
) => ({
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
  // SPEC-007: tablas falsas que filtran por TODO el where (detectan un companyId omitido).
  account: { findFirst: fakeFindFirst(FAKE_ACCOUNTS) },
  invoice: { findFirst: fakeFindFirst(FAKE_INVOICES) },
  accountingPeriod: { findFirst: fakeFindFirst(periods) },
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

// SPEC-007 RN-3: la contrapartida se valida con el guard de cuentas ajenas (ADR-004).
vi.mock("@/lib/account-guard", () => ({
  assertAccountsBelongToCompany: vi.fn(),
}));

// Lotes y seriales tienen sus propios tests: aqui se mockean para comprobar que la rama de
// ENTRADA ligada a factura sigue aplicandolos.
vi.mock("../services/LotTrackingService", () => ({
  resolveLotAllocations: vi.fn(),
  validateLotAllocation: vi.fn(),
  applyLotMovement: vi.fn().mockResolvedValue(undefined),
  voidLotMovement: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/SerialTrackingService", () => ({
  createSerials: vi.fn().mockResolvedValue(undefined),
  validateSerialAvailability: vi.fn(),
  applySerialMovement: vi.fn(),
  voidSerialMovement: vi.fn().mockResolvedValue(undefined),
}));

import {
  postMovement,
  voidPostedMovement,
  getInventoryValuation,
  autoPostMovementInTx,
} from "../services/InventoryAccountingService";
import { applyLotMovement } from "../services/LotTrackingService";
import { createSerials } from "../services/SerialTrackingService";
import { assertAccountsBelongToCompany } from "@/lib/account-guard";
import prisma from "@/lib/prisma";
import {
  FAKE_ACCOUNTS,
  FAKE_INVOICES,
  OTHER_COMPANY_ID,
  fakeFindFirst,
  findFirstOrThrowImpl,
  type Row,
} from "./helpers/fake-db";

const COMPANY_ID = "company-001";
const USER_ID = "user-test";

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset (no solo clear): una mockRejectedValue de un test no debe filtrarse al siguiente.
  vi.mocked(assertAccountsBelongToCompany).mockReset();
  vi.mocked(assertAccountsBelongToCompany).mockResolvedValue(undefined);
});

// ─── Helpers de los tests ─────────────────────────────────────────────────────

type Tx = ReturnType<typeof makeTx>;
type Line = { accountId: string; amount: Decimal };

/** Lineas del PRIMER asiento creado con tx.transaction.create (contabilizar o anular). */
const linesOf = (tx: Tx) => tx.transaction.create.mock.calls[0]![0].data.entries.create as Line[];
const sumOf = (lines: Line[]) => lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
const amountOf = (lines: Line[], accountId: string) =>
  lines.find((l) => l.accountId === accountId)?.amount.toString();

const wire = (tx: Tx) =>
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: Tx) => unknown) => fn(tx)) as never);

const post = async (tx: Tx, extra: Partial<Parameters<typeof postMovement>[0]> = {}) => {
  wire(tx);
  return postMovement({ movementId: "mov-001", companyId: COMPANY_ID, ...extra }, USER_ID);
};

const voidPosted = async (tx: Tx) => {
  wire(tx);
  return voidPostedMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID);
};

/**
 * Un rechazo de negocio no puede dejar NADA escrito. En produccion el $transaction haria rollback,
 * pero el mock no: exigir "no se llamo" obliga a validar ANTES de escribir (stock, asiento, estado).
 */
const expectNoWrites = (tx: Tx) => {
  expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  expect(tx.transaction.create).not.toHaveBeenCalled();
  expect(tx.inventoryMovement.update).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
};

// ─── postMovement — CPP ───────────────────────────────────────────────────────

describe("postMovement — CPP y actualización de stock", () => {
  it("ENTRADA: calcula nuevo averageCost con fórmula CPP", async () => {
    const movement = makeMockMovement({
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("120"),
      totalCost: new Decimal("600"),
      counterpartAccountId: "acc-banco", // SPEC-007: toda ENTRADA sin factura lleva contrapartida
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
  const runPost = async (movement: ReturnType<typeof makeMockMovement>) => {
    const tx = makeTx(movement);
    await post(tx);
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
    expect(sumOf(lines).isZero()).toBe(true);
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
        counterpartAccountId: "acc-cxp",
      })
    );
    const lines = linesOf(tx);
    expect(lines.map((l) => l.amount.toString())).toEqual(["233.33", "-233.33"]);
    expect(sumOf(lines).isZero()).toBe(true);
  });

  // SPEC-007 (RN-5): reemplaza al test "ADR-058 B1: ENTRADA standalone conserva su asiento de UNA
  // linea", que codificaba justo lo que la spec elimina. El redondeo de la ENTRADA se sigue
  // verificando, pero ahora sobre un asiento COMPLETO.
  it("ENTRADA con costo a 4 decimales: AMBAS lineas a 2 decimales, Σ = 0 exacta y sin residuo (233.3376 → 233.34)", async () => {
    const tx = await runPost(
      makeMockMovement({
        type: "ENTRADA",
        quantity: new Decimal("7"),
        unitCost: new Decimal("33.3333"),
        totalCost: new Decimal("233.3376"),
        counterpartAccountId: "acc-cxp",
      })
    );
    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.accountId)).toEqual(["acc-inv", "acc-cxp"]);
    expect(lines.map((l) => l.amount.toString())).toEqual(["233.34", "-233.34"]);
    expect(sumOf(lines).isZero()).toBe(true);
    for (const l of lines) expect("noAbsorb" in l).toBe(false);
    // El DOCUMENTO se persiste a 2 decimales y no hay residuo de redondeo que auditar.
    const movUpdate = tx.inventoryMovement.update.mock.calls[0]![0];
    expect(movUpdate.data.totalCost.toString()).toBe("233.34");
    const audit = tx.auditLog.create.mock.calls[0]![0];
    expect(audit.data.newValue).not.toHaveProperty("glRounding");
  });

  it("anulacion de un movimiento historico a 4 decimales: negacion EXACTA (no cuantiza)", async () => {
    const movement = makeMockMovement({
      status: "POSTED",
      type: "SALIDA",
      quantity: new Decimal("3"),
      totalCost: new Decimal("1234.5678"),
    });
    const tx = makeTx(movement);
    await voidPosted(tx);

    const lines = linesOf(tx);
    expect(lines.map((l) => l.amount.toString())).toEqual(["-1234.5678", "1234.5678"]);
    expect(sumOf(lines).isZero()).toBe(true);
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

    const lines = tx.transaction.create.mock.calls[0]![0].data.entries.create as Line[];
    expect(lines.map((l) => l.amount.toString())).toEqual(["1234.57", "-1234.57"]);
    for (const l of lines) expect("noAbsorb" in l).toBe(false);
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data.totalCost.toString()).toBe("1234.57");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SPEC-007 — Toda entrada de inventario lleva contrapartida (TDD: RED primero)
//
// Contrato que implementa el ledger-agent. Ningun camino de codigo puede crear un asiento de
// inventario con una sola linea (RN-5). Los tests que ya pasan hoy estan marcados "(guarda)":
// protegen contra un sobre-rechazo en la implementacion, no son el RED.
// ═════════════════════════════════════════════════════════════════════════════

const MSG_SIN_CONTRAPARTIDA =
  "La entrada de inventario requiere una cuenta de contrapartida: Banco o Caja si fue de contado, Cuentas por pagar si fue a crédito, o Capital si es aporte de socios.";
const MSG_CUENTA_AJENA_GUARD = "La cuenta seleccionada no existe o no pertenece a esta empresa.";
const MSG_CONTRAPARTIDA_NO_EXISTE =
  "La cuenta de contrapartida no existe o no pertenece a esta empresa.";
const MSG_FACTURA_SIN_ASIENTO =
  "La factura de esta entrada aún no tiene asiento contable. Contabilice la factura antes de registrar la entrada de inventario.";
const MSG_ANULAR_ENTRADA_DE_FACTURA =
  "Esta entrada pertenece a una factura: anule la factura o emita una nota de crédito.";
const MSG_ANULAR_ASIENTO_SIN_CONTRAPARTIDA =
  "Esta entrada tiene un asiento sin contrapartida (dato previo). No se puede anular automáticamente; corrija con un asiento manual.";

// ─── RN-1: sin contrapartida no hay entrada ───────────────────────────────────

describe("SPEC-007 RN-1 — postMovement: la ENTRADA sin factura exige contrapartida", () => {
  it.each([null, undefined])(
    "CA-1: ENTRADA sin factura y counterpartAccountId=%s → error de negocio y no se persiste nada",
    async (counterpart) => {
      const tx = makeTx(makeMockMovement({ type: "ENTRADA", counterpartAccountId: counterpart }));

      await expect(post(tx)).rejects.toThrow(MSG_SIN_CONTRAPARTIDA);

      // Ni stock, ni asiento (de una linea o de las que sean), ni cambio de estado, ni auditoria.
      expectNoWrites(tx);
    }
  );

  it("CA-1: el error de contrapartida llega aunque el ítem sea de seguimiento por lote", async () => {
    const tx = makeTx(
      makeMockMovement({
        type: "ENTRADA",
        counterpartAccountId: null,
        item: { ...mockItem, trackingType: "LOT" } as never,
      })
    );

    await expect(post(tx, { lotData: { lotNumber: "L-001" } })).rejects.toThrow(
      MSG_SIN_CONTRAPARTIDA
    );
    expect(applyLotMovement).not.toHaveBeenCalled();
    expectNoWrites(tx);
  });
});

// ─── RN-2 / RN-3: asiento completo y contrapartida valida ─────────────────────

describe("SPEC-007 RN-2/RN-3 — postMovement: ENTRADA con contrapartida = Dr Inventario / Cr contrapartida", () => {
  it("CA-2: contrapartida Banco → exactamente 2 lineas, Dr Inventario / Cr Banco, Σ = 0", async () => {
    const tx = makeTx(
      makeMockMovement({
        type: "ENTRADA",
        totalCost: new Decimal("600"),
        counterpartAccountId: "acc-banco",
      })
    );

    await post(tx);

    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.accountId).toBe("acc-inv");
    expect(lines[0]!.amount.toString()).toBe("600");
    expect(lines[1]!.accountId).toBe("acc-banco");
    expect(lines[1]!.amount.toString()).toBe("-600");
    expect(sumOf(lines).isZero()).toBe(true);
    // El asiento propio queda enlazado al movimiento.
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data.transactionId).toBe("tx-001");
    // RN-3: la contrapartida se valida con el guard de cuentas ajenas, dentro de la transaccion.
    expect(assertAccountsBelongToCompany).toHaveBeenCalledWith(tx, COMPANY_ID, ["acc-banco"]);
  });

  it("CA-3: contrapartida Capital (aporte de socios, EQUITY) → exactamente 2 lineas, Σ = 0", async () => {
    const tx = makeTx(
      makeMockMovement({
        type: "ENTRADA",
        totalCost: new Decimal("600"),
        counterpartAccountId: "acc-capital",
      })
    );

    await post(tx);

    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(amountOf(lines, "acc-inv")).toBe("600");
    expect(amountOf(lines, "acc-capital")).toBe("-600");
    expect(sumOf(lines).isZero()).toBe(true);
    expect(assertAccountsBelongToCompany).toHaveBeenCalledWith(tx, COMPANY_ID, ["acc-capital"]);
  });

  it.each([
    ["ASSET (Banco)", "acc-banco"],
    ["LIABILITY (Cuentas por pagar)", "acc-cxp"],
    ["EQUITY (Capital)", "acc-capital"],
    ["EXPENSE (Costo/Gasto)", "acc-gasto"],
  ])(
    "(guarda) PA-1: contrapartida de tipo %s se admite y da un asiento de 2 lineas con Σ = 0",
    async (_tipo, counterpartId) => {
      const tx = makeTx(
        makeMockMovement({
          type: "ENTRADA",
          totalCost: new Decimal("600"),
          counterpartAccountId: counterpartId,
        })
      );

      await post(tx);

      const lines = linesOf(tx);
      expect(lines).toHaveLength(2);
      expect(amountOf(lines, "acc-inv")).toBe("600");
      expect(amountOf(lines, counterpartId)).toBe("-600");
      expect(sumOf(lines).isZero()).toBe(true);
    }
  );

  it.each([
    ["REVENUE (Ingreso)", "acc-ingreso"],
    ["CONTRA_ASSET (cuenta regularizadora)", "acc-deprec"],
  ])(
    "PA-1: contrapartida de tipo %s se rechaza y no se persiste nada",
    async (_tipo, counterpartId) => {
      const tx = makeTx(makeMockMovement({ type: "ENTRADA", counterpartAccountId: counterpartId }));

      await expect(post(tx)).rejects.toThrow(/Ingresos|regularizadora/i);

      expectNoWrites(tx);
    }
  );

  it("PA-1: la propia cuenta de inventario del ítem no puede ser su contrapartida", async () => {
    // acc-inv existe, es de la empresa y es ASSET: solo la regla "misma cuenta" puede rechazarla.
    const tx = makeTx(makeMockMovement({ type: "ENTRADA", counterpartAccountId: "acc-inv" }));

    await expect(post(tx)).rejects.toThrow(/misma cuenta de inventario/i);

    expectNoWrites(tx);
  });

  it("CA-4: contrapartida de otra empresa → el guard de cuentas la rechaza y no se persiste nada", async () => {
    vi.mocked(assertAccountsBelongToCompany).mockRejectedValue(new Error(MSG_CUENTA_AJENA_GUARD));
    const tx = makeTx(
      makeMockMovement({ type: "ENTRADA", counterpartAccountId: "acc-otra-empresa" })
    );

    await expect(post(tx)).rejects.toThrow(MSG_CUENTA_AJENA_GUARD);

    expect(assertAccountsBelongToCompany).toHaveBeenCalledWith(tx, COMPANY_ID, [
      "acc-otra-empresa",
    ]);
    expectNoWrites(tx);
  });

  it.each([
    ["una cuenta que no existe", "acc-fantasma"],
    ["una cuenta de OTRA empresa (aunque el guard no la detecte)", "acc-otra-empresa"],
  ])(
    "RN-3: %s → 'La cuenta de contrapartida no existe o no pertenece a esta empresa.'",
    async (_caso, counterpartId) => {
      // El guard (mock permisivo) deja pasar: la consulta del tipo, acotada por companyId, es la
      // segunda defensa y no puede devolver la cuenta ajena.
      const tx = makeTx(makeMockMovement({ type: "ENTRADA", counterpartAccountId: counterpartId }));

      await expect(post(tx)).rejects.toThrow(MSG_CONTRAPARTIDA_NO_EXISTE);

      expectNoWrites(tx);
    }
  );

  it("RN-3: el tipo de la contrapartida se consulta acotado por companyId y pide el campo type", async () => {
    const tx = makeTx(makeMockMovement({ type: "ENTRADA", counterpartAccountId: "acc-banco" }));

    await post(tx);

    expect(tx.account.findFirst).toHaveBeenCalledTimes(1);
    const args = tx.account.findFirst.mock.calls[0]![0] as { where: Row; select: Row };
    expect(args.where).toMatchObject({ id: "acc-banco", companyId: COMPANY_ID });
    expect(args.select).toMatchObject({ type: true });
  });

  it("(guarda) SALIDA y AJUSTE no exigen contrapartida ni la consultan", async () => {
    for (const type of ["SALIDA", "AJUSTE"]) {
      const tx = makeTx(
        makeMockMovement({
          type,
          quantity: new Decimal("3"),
          unitCost: new Decimal("100"),
          totalCost: new Decimal("300"),
          counterpartAccountId: null,
        })
      );

      await post(tx);

      const lines = linesOf(tx);
      expect(lines).toHaveLength(2);
      expect(amountOf(lines, "acc-cogs")).toBe("300");
      expect(amountOf(lines, "acc-inv")).toBe("-300");
      expect(tx.account.findFirst).not.toHaveBeenCalled();
    }
    expect(assertAccountsBelongToCompany).not.toHaveBeenCalled();
  });
});

// ─── RN-4 / PA-3: ENTRADA ligada a factura ───────────────────────────────────

describe("SPEC-007 RN-4 — postMovement: la ENTRADA ligada a factura no crea asiento propio", () => {
  const entradaConFactura = (over: Parameters<typeof makeMockMovement>[0] = {}) =>
    makeMockMovement({
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("120"),
      totalCost: new Decimal("600"),
      counterpartAccountId: null, // con factura la contrapartida NO es exigible
      invoiceId: "inv-001",
      ...over,
    });

  it("CA-5: no crea asiento y se enlaza al asiento de la factura (no duplica el débito a Inventario)", async () => {
    const tx = makeTx(entradaConFactura());

    const result = await post(tx);

    expect(tx.transaction.create).not.toHaveBeenCalled();
    const movUpdate = tx.inventoryMovement.update.mock.calls[0]![0];
    expect(movUpdate.data).toMatchObject({ status: "POSTED", transactionId: "tx-factura-001" });
    // El resultado expone el asiento de la factura, no uno nuevo.
    expect(result.transaction.id).toBe("tx-factura-001");
  });

  it("CA-5: el stock y el CPP se actualizan igual que en cualquier entrada", async () => {
    const tx = makeTx(entradaConFactura());

    await post(tx);

    // CPP: (10 × 100 + 5 × 120) / 15 = 106.6667
    const upd = tx.inventoryItem.update.mock.calls[0]![0];
    expect(upd.data.stockQuantity.toString()).toBe("15");
    expect(upd.data.averageCost.toFixed(4)).toBe("106.6667");
  });

  it("CA-5: la auditoría registra el asiento de la factura y el movimiento queda auditado una vez", async () => {
    const tx = makeTx(entradaConFactura());

    await post(tx);

    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    const audit = tx.auditLog.create.mock.calls[0]![0];
    expect(audit.data).toMatchObject({ entityName: "InventoryMovement", action: "POST" });
    expect(audit.data.newValue).toMatchObject({ transactionId: "tx-factura-001" });
  });

  it("ADR-004: la factura se lee acotada por companyId y pide solo transactionId", async () => {
    const tx = makeTx(entradaConFactura());

    await post(tx);

    expect(tx.invoice.findFirst).toHaveBeenCalledTimes(1);
    const args = tx.invoice.findFirst.mock.calls[0]![0] as { where: Row; select: Row };
    expect(args.where).toMatchObject({ id: "inv-001", companyId: COMPANY_ID });
    expect(args.select).toMatchObject({ transactionId: true });
  });

  it("RN-4: nunca crea asiento propio, aunque el movimiento traiga además una contrapartida", async () => {
    const tx = makeTx(entradaConFactura({ counterpartAccountId: "acc-banco" }));

    const result = await post(tx);

    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(result.transaction.id).toBe("tx-factura-001");
  });

  it.each([
    ["una factura que aún no tiene asiento", "inv-sin-asiento"],
    ["una factura que no existe", "inv-fantasma"],
    ["una factura de OTRA empresa", "inv-ajena"],
  ])(
    "CA-5b: ENTRADA ligada a %s → error de negocio y el movimiento sigue en DRAFT",
    async (_caso, invoiceId) => {
      const tx = makeTx(entradaConFactura({ invoiceId }));

      await expect(post(tx)).rejects.toThrow(MSG_FACTURA_SIN_ASIENTO);

      // Sin tocar stock, sin crear asiento, sin cambiar el estado del movimiento.
      expectNoWrites(tx);
    }
  );

  it("ítem LOT con factura: aplica el lote, no crea asiento y enlaza el asiento de la factura", async () => {
    const tx = makeTx(entradaConFactura({ item: { ...mockItem, trackingType: "LOT" } as never }));

    await post(tx, { lotData: { lotNumber: "L-001" } });

    expect(applyLotMovement).toHaveBeenCalledTimes(1);
    expect(applyLotMovement).toHaveBeenCalledWith(
      tx,
      COMPANY_ID,
      "item-001",
      "mov-001",
      "ENTRADA",
      new Decimal("5"),
      [],
      USER_ID,
      expect.objectContaining({ lotNumber: "L-001" })
    );
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data.transactionId).toBe("tx-factura-001");
  });

  it("ítem SERIAL con factura: crea los seriales, no crea asiento y enlaza el asiento de la factura", async () => {
    const serialNumbers = ["S-1", "S-2", "S-3", "S-4", "S-5"];
    const tx = makeTx(
      entradaConFactura({ item: { ...mockItem, trackingType: "SERIAL" } as never })
    );

    await post(tx, { serialNumbers });

    expect(createSerials).toHaveBeenCalledTimes(1);
    expect(createSerials).toHaveBeenCalledWith(
      tx,
      COMPANY_ID,
      "item-001",
      "mov-001",
      serialNumbers,
      USER_ID
    );
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data.transactionId).toBe("tx-factura-001");
  });
});

// ─── PA-7: periodo CLOSED al contabilizar ────────────────────────────────────

describe("SPEC-007 PA-7 — postMovement respeta el período CLOSED (R-3)", () => {
  const FECHA_ABRIL = new Date("2026-04-15T12:00:00.000Z");
  const periodo = (year: number, month: number, over: Row = {}): Row => ({
    companyId: COMPANY_ID,
    status: "CLOSED",
    year,
    month,
    ...over,
  });

  const casos: Array<[string, Parameters<typeof makeMockMovement>[0]]> = [
    ["ENTRADA con contrapartida", { type: "ENTRADA", counterpartAccountId: "acc-banco" }],
    [
      "ENTRADA ligada a factura",
      { type: "ENTRADA", counterpartAccountId: null, invoiceId: "inv-001" },
    ],
    [
      "SALIDA",
      {
        type: "SALIDA",
        quantity: new Decimal("3"),
        unitCost: new Decimal("100"),
        totalCost: new Decimal("300"),
      },
    ],
    [
      "AJUSTE",
      {
        type: "AJUSTE",
        quantity: new Decimal("2"),
        unitCost: new Decimal("100"),
        totalCost: new Decimal("200"),
      },
    ],
  ];

  it.each(casos)(
    "%s con el período de la fecha CERRADO → error con CERRADO, sin asiento ni cambio de stock",
    async (_nombre, over) => {
      const tx = makeTx(makeMockMovement({ ...over, date: FECHA_ABRIL }), [periodo(2026, 4)]);

      await expect(post(tx)).rejects.toThrow("CERRADO");

      expectNoWrites(tx);
    }
  );

  it("el período se resuelve con la fecha del movimiento en UTC, no en hora local", async () => {
    // 2026-04-01T03:30Z es el 31 de marzo en Venezuela (UTC-4). Se fuerzan a propósito valores
    // locales distintos (marzo de 2025) para que el test no dependa de la zona horaria de quien
    // lo corre: solo getUTCFullYear/getUTCMonth devuelven 2026/4.
    const date = new Date("2026-04-01T03:30:00.000Z");
    vi.spyOn(date, "getFullYear").mockReturnValue(2025);
    vi.spyOn(date, "getMonth").mockReturnValue(2);
    const tx = makeTx(makeMockMovement({ date }), [periodo(2026, 4)]);

    await expect(post(tx)).rejects.toThrow("CERRADO");

    expectNoWrites(tx);
  });

  it.each([
    ["un período CERRADO de OTRA empresa", periodo(2026, 4, { companyId: OTHER_COMPANY_ID })],
    ["un período ABIERTO del mismo mes", periodo(2026, 4, { status: "OPEN" })],
    ["otro mes cerrado del mismo año", periodo(2026, 3)],
    ["el mismo mes cerrado de otro año", periodo(2025, 4)],
  ])("(guarda) %s no bloquea la contabilización", async (_caso, fila) => {
    const tx = makeTx(makeMockMovement({ type: "ENTRADA", date: FECHA_ABRIL }), [fila]);

    await post(tx);

    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(tx.inventoryMovement.update).toHaveBeenCalledTimes(1);
  });
});

// ─── CA-tenant ────────────────────────────────────────────────────────────────

describe("SPEC-007 CA-tenant — contabilizar y anular acotan el movimiento por companyId (ADR-004)", () => {
  const ajeno = (over: Parameters<typeof makeMockMovement>[0] = {}) => ({
    ...makeMockMovement(over),
    companyId: OTHER_COMPANY_ID,
  });

  /** findFirstOrThrow que se comporta como la BD: una fila de otra empresa no aparece. */
  const soloVeFilas = (tx: Tx, rows: Row[]) =>
    tx.inventoryMovement.findFirstOrThrow.mockImplementation(
      findFirstOrThrowImpl(rows, "InventoryMovement") as never
    );

  it("(guarda) postMovement lee el movimiento con where { id, companyId }", async () => {
    const tx = makeTx(makeMockMovement());

    await post(tx);

    const where = tx.inventoryMovement.findFirstOrThrow.mock.calls[0]![0].where as Row;
    expect(where).toMatchObject({ id: "mov-001", companyId: COMPANY_ID });
    expect(Object.keys(where)).toContain("companyId");
  });

  it("(guarda) CA-tenant: el movimiento de otra empresa no se contabiliza", async () => {
    const tx = makeTx(makeMockMovement());
    soloVeFilas(tx, [ajeno()]);

    await expect(post(tx)).rejects.toThrow("No InventoryMovement found");

    expectNoWrites(tx);
  });

  it("(guarda) CA-tenant: el movimiento de otra empresa no se anula", async () => {
    const tx = makeTx(makeMockMovement({ status: "POSTED" }));
    soloVeFilas(tx, [ajeno({ status: "POSTED" })]);

    await expect(voidPosted(tx)).rejects.toThrow("No InventoryMovement found");

    expectNoWrites(tx);
  });

  it("(guarda) el movimiento propio con el mismo id sí se encuentra (el doble no rechaza todo)", async () => {
    const tx = makeTx(makeMockMovement());
    soloVeFilas(tx, [ajeno(), { ...makeMockMovement() }]);

    await post(tx);

    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
  });
});

// ─── RN-6: anular una ENTRADA ────────────────────────────────────────────────

describe("SPEC-007 RN-6 — voidPostedMovement de una ENTRADA", () => {
  const entradaPosted = (over: Parameters<typeof makeMockMovement>[0] = {}) =>
    makeMockMovement({
      status: "POSTED",
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("120"),
      totalCost: new Decimal("600"),
      counterpartAccountId: "acc-banco",
      transactionId: "tx-original-001",
      invoiceId: null,
      ...over,
    });

  it("CA-7: con contrapartida y asiento propio → contra-asiento de 2 lineas: Dr contrapartida / Cr Inventario, Σ = 0", async () => {
    const tx = makeTx(entradaPosted());

    await voidPosted(tx);

    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(amountOf(lines, "acc-banco")).toBe("600"); // Dr contrapartida
    expect(amountOf(lines, "acc-inv")).toBe("-600"); // Cr Inventario
    expect(sumOf(lines).isZero()).toBe(true);
  });

  it("CA-7: el contra-asiento es el espejo EXACTO del guardado, a 4 decimales (no cuantiza)", async () => {
    // Movimiento historico guardado a 4 decimales: la anulacion deriva de lo guardado (ADR-058 B2).
    const tx = makeTx(
      entradaPosted({ totalCost: new Decimal("233.3331"), counterpartAccountId: "acc-cxp" })
    );

    await voidPosted(tx);

    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(amountOf(lines, "acc-cxp")).toBe("233.3331");
    expect(amountOf(lines, "acc-inv")).toBe("-233.3331");
    expect(sumOf(lines).isZero()).toBe(true);
  });

  it("CA-7: revierte el stock, marca VOIDED y deja el contra-asiento en la auditoría", async () => {
    const tx = makeTx(entradaPosted());

    await voidPosted(tx);

    // stock 10 - 5 de la entrada anulada
    expect(tx.inventoryItem.update.mock.calls[0]![0].data.stockQuantity.toString()).toBe("5");
    expect(tx.inventoryMovement.update.mock.calls[0]![0].data).toMatchObject({ status: "VOIDED" });
    const audit = tx.auditLog.create.mock.calls[0]![0];
    expect(audit.data).toMatchObject({ entityName: "InventoryMovement", action: "VOID_POSTED" });
    expect(audit.data.newValue).toMatchObject({ voidTransactionId: "tx-001" });
  });

  it.each([
    ["asiento de la factura", { transactionId: "tx-factura-001" }],
    ["sin asiento enlazado", { transactionId: null }],
    [
      "con contrapartida registrada",
      { transactionId: "tx-factura-001", counterpartAccountId: "acc-banco" },
    ],
  ])(
    "CA-8: ENTRADA ligada a factura (%s) → rechazada; el stock no cambia y el movimiento sigue POSTED",
    async (_caso, over) => {
      const tx = makeTx(
        entradaPosted({ invoiceId: "inv-001", counterpartAccountId: null, ...over })
      );

      await expect(voidPosted(tx)).rejects.toThrow(MSG_ANULAR_ENTRADA_DE_FACTURA);

      expectNoWrites(tx);
    }
  );

  it.each([null, "acc-banco"])(
    "CA-9: ENTRADA sin asiento original (transactionId nulo, contrapartida=%s) → revierte el stock y NO crea asiento",
    async (counterpart) => {
      const tx = makeTx(entradaPosted({ transactionId: null, counterpartAccountId: counterpart }));

      await voidPosted(tx);

      expect(tx.transaction.create).not.toHaveBeenCalled();
      expect(tx.inventoryItem.update.mock.calls[0]![0].data.stockQuantity.toString()).toBe("5");
      expect(tx.inventoryMovement.update.mock.calls[0]![0].data).toMatchObject({
        status: "VOIDED",
      });
      // La auditoría se conserva aunque no haya contra-asiento.
      expect(tx.auditLog.create).toHaveBeenCalledOnce();
      expect(tx.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "VOID_POSTED" });
    }
  );

  it("RN-6: ENTRADA con asiento pero sin contrapartida (dato previo) → error de negocio, sin cambios", async () => {
    const tx = makeTx(
      entradaPosted({ counterpartAccountId: null, transactionId: "tx-previo-001" })
    );

    await expect(voidPosted(tx)).rejects.toThrow(MSG_ANULAR_ASIENTO_SIN_CONTRAPARTIDA);

    expectNoWrites(tx);
  });

  it("(guarda) anular una ENTRADA cuyo stock ya se consumió sigue rechazándose y no escribe nada", async () => {
    const tx = makeTx(
      entradaPosted({
        item: { ...mockItem, stockQuantity: new Decimal("3") }, // 3 - 5 < 0
      })
    );

    await expect(voidPosted(tx)).rejects.toThrow(
      "No se puede anular: el stock resultante sería negativo"
    );

    expectNoWrites(tx);
  });

  it("(guarda) anular una SALIDA ligada a factura sigue creando su contra-asiento de 2 lineas (la restricción es solo de ENTRADA)", async () => {
    const tx = makeTx(
      makeMockMovement({
        status: "POSTED",
        type: "SALIDA",
        quantity: new Decimal("3"),
        unitCost: new Decimal("100"),
        totalCost: new Decimal("300"),
        counterpartAccountId: null,
        invoiceId: "inv-001",
        transactionId: "tx-original-002",
      })
    );

    await voidPosted(tx);

    const lines = linesOf(tx);
    expect(lines).toHaveLength(2);
    expect(amountOf(lines, "acc-cogs")).toBe("-300");
    expect(amountOf(lines, "acc-inv")).toBe("300");
    expect(sumOf(lines).isZero()).toBe(true);
    // la SALIDA devuelve stock: 10 + 3
    expect(tx.inventoryItem.update.mock.calls[0]![0].data.stockQuantity.toString()).toBe("13");
  });
});
