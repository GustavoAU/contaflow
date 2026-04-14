// src/modules/inventory/__tests__/InventoryOperationsService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    account: { findFirstOrThrow: vi.fn() },
    inventoryItem: {
      create: vi.fn(),
      update: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    inventoryMovement: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
    invoice: { findFirstOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  createInventoryItem,
  updateInventoryItem,
  createDraftMovement,
  voidDraftMovement,
  getInventoryItems,
  getItemMovements,
} from "../services/InventoryOperationsService";
import prisma from "@/lib/prisma";

const COMPANY_ID = "company-001";
const USER_ID = "user-test";

const makeItem = (overrides = {}) => ({
  id: "item-001",
  companyId: COMPANY_ID,
  sku: "PROD-001",
  name: "Producto Test",
  unit: "unidad",
  averageCost: new Decimal("100.00"),
  stockQuantity: new Decimal("10.00"),
  deletedAt: null,
  accountId: "acc-inv",
  cogsAccountId: "acc-cogs",
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: USER_ID,
  description: null,
  ...overrides,
});

const makeTx = () => ({
  inventoryItem: {
    create: vi.fn().mockResolvedValue(makeItem()),
    update: vi.fn().mockResolvedValue(makeItem()),
    findFirstOrThrow: vi.fn().mockResolvedValue(makeItem()),
  },
  inventoryMovement: {
    create: vi.fn().mockResolvedValue({
      id: "mov-001",
      status: "DRAFT",
      itemId: "item-001",
      type: "ENTRADA",
      quantity: new Decimal("5"),
      unitCost: new Decimal("100"),
      totalCost: new Decimal("500"),
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    }),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ id: "mov-001", status: "VOIDED" }),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

let currentTx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  currentTx = makeTx();

  vi.mocked(prisma.account.findFirstOrThrow).mockResolvedValue({ id: "acc-inv" } as never);
  vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue(makeItem() as never);
  vi.mocked(prisma.inventoryMovement.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
    id: "mov-001",
    status: "DRAFT",
    companyId: COMPANY_ID,
  } as never);
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof currentTx) => unknown) => fn(currentTx)) as never
  );
});

// ─── createInventoryItem ──────────────────────────────────────────────────────

describe("createInventoryItem", () => {
  it("crea un ítem con los datos correctos", async () => {
    const result = await createInventoryItem(
      { companyId: COMPANY_ID, sku: "PROD-001", name: "Test", unit: "unidad" },
      USER_ID
    );
    expect(result).toBeDefined();
    expect(currentTx.inventoryItem.create).toHaveBeenCalledOnce();
    expect(currentTx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("CRITICAL-2: verifica ownership de accountId antes de crear", async () => {
    vi.mocked(prisma.account.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Account not found")
    );
    await expect(
      createInventoryItem(
        {
          companyId: COMPANY_ID,
          sku: "X",
          name: "Test",
          unit: "unidad",
          accountId: "acc-other-company",
        },
        USER_ID
      )
    ).rejects.toThrow("Account not found");
  });

  it("CRITICAL-2: verifica ownership de cogsAccountId", async () => {
    vi.mocked(prisma.account.findFirstOrThrow)
      .mockResolvedValueOnce({ id: "acc-inv" } as never)
      .mockRejectedValueOnce(new Error("COGS account not found"));
    await expect(
      createInventoryItem(
        {
          companyId: COMPANY_ID,
          sku: "X",
          name: "Test",
          unit: "unidad",
          accountId: "acc-inv",
          cogsAccountId: "acc-other-company-cogs",
        },
        USER_ID
      )
    ).rejects.toThrow("COGS account not found");
  });

  it("no verifica accounts si no se proporcionan", async () => {
    await createInventoryItem(
      { companyId: COMPANY_ID, sku: "NO-ACCS", name: "Sin cuentas", unit: "kg" },
      USER_ID
    );
    expect(vi.mocked(prisma.account.findFirstOrThrow)).not.toHaveBeenCalled();
  });
});

// ─── updateInventoryItem ──────────────────────────────────────────────────────

describe("updateInventoryItem", () => {
  it("CRITICAL-1: usa findFirstOrThrow con companyId para verificar ownership", async () => {
    await updateInventoryItem({ itemId: "item-001", companyId: COMPANY_ID, name: "Nuevo" }, USER_ID);
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item-001", companyId: COMPANY_ID }),
      })
    );
  });

  it("lanza error si el ítem no pertenece a la empresa (CRITICAL-1)", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("No InventoryItem found")
    );
    await expect(
      updateInventoryItem({ itemId: "item-other", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow();
  });

  it("actualiza solo los campos proporcionados", async () => {
    await updateInventoryItem({ itemId: "item-001", companyId: COMPANY_ID, name: "Nuevo" }, USER_ID);
    const updateCall = currentTx.inventoryItem.update.mock.calls[0]![0];
    expect(updateCall.data).toMatchObject({ name: "Nuevo" });
    expect(updateCall.data.sku).toBeUndefined();
  });
});

// ─── createDraftMovement ──────────────────────────────────────────────────────

describe("createDraftMovement", () => {
  const BASE = {
    companyId: COMPANY_ID,
    itemId: "item-001",
    type: "ENTRADA" as const,
    quantity: 5,
    unitCost: 120,
    date: new Date().toISOString(),
    idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
  };

  it("crea movimiento DRAFT con unitCost del input para ENTRADA", async () => {
    await createDraftMovement(BASE, USER_ID);
    const createCall = currentTx.inventoryMovement.create.mock.calls[0]![0];
    expect(createCall.data.unitCost.toString()).toBe("120");
    expect(createCall.data.totalCost.toString()).toBe("600"); // 5 × 120
  });

  it("MEDIUM-2: para SALIDA usa CPP del ítem — ignora unitCost del cliente", async () => {
    await createDraftMovement({ ...BASE, type: "SALIDA", unitCost: 999 }, USER_ID);
    const createCall = currentTx.inventoryMovement.create.mock.calls[0]![0];
    // unitCost debe ser 100 (averageCost del ítem), no 999
    expect(createCall.data.unitCost.toString()).toBe("100");
  });

  it("lanza error si SALIDA con stock insuficiente", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValueOnce(
      makeItem({ stockQuantity: new Decimal("3") }) as never
    );
    await expect(
      createDraftMovement({ ...BASE, type: "SALIDA", quantity: 5 }, USER_ID)
    ).rejects.toThrow("Stock insuficiente");
  });

  it("CRITICAL-1: usa findFirstOrThrow con companyId para verificar ítem", async () => {
    await createDraftMovement(BASE, USER_ID);
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "item-001", companyId: COMPANY_ID }),
      })
    );
  });

  it("es idempotente — retorna movimiento existente si ya existe idempotencyKey", async () => {
    const existingMovement = { id: "mov-existing", status: "DRAFT" };
    // findUnique se llama en prisma directo (no en tx)
    vi.mocked(prisma.inventoryMovement.findUnique).mockResolvedValueOnce(
      existingMovement as never
    );
    const result = await createDraftMovement(BASE, USER_ID);
    expect(result).toEqual(existingMovement);
    expect(currentTx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it("verifica ownership de invoiceId si se proporciona", async () => {
    vi.mocked(prisma.invoice.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Invoice not found")
    );
    await expect(
      createDraftMovement({ ...BASE, invoiceId: "inv-other-company" }, USER_ID)
    ).rejects.toThrow("Invoice not found");
  });
});

// ─── voidDraftMovement ────────────────────────────────────────────────────────

describe("voidDraftMovement", () => {
  it("anula movimiento DRAFT correctamente", async () => {
    vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
      id: "mov-001",
      status: "DRAFT",
      companyId: COMPANY_ID,
    } as never);
    const result = await voidDraftMovement(
      { movementId: "mov-001", companyId: COMPANY_ID },
      USER_ID
    );
    expect(result.status).toBe("VOIDED");
  });

  it("lanza error si el movimiento no está en DRAFT", async () => {
    vi.mocked(prisma.inventoryMovement.findFirstOrThrow).mockResolvedValue({
      id: "mov-001",
      status: "POSTED",
      companyId: COMPANY_ID,
    } as never);
    await expect(
      voidDraftMovement({ movementId: "mov-001", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Solo se pueden anular movimientos en DRAFT");
  });
});

// ─── getInventoryItems ────────────────────────────────────────────────────────

describe("getInventoryItems", () => {
  it("ADR-004: consulta siempre incluye companyId en el where", async () => {
    await getInventoryItems(COMPANY_ID);
    expect(vi.mocked(prisma.inventoryItem.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      })
    );
  });
});

// ─── getItemMovements ─────────────────────────────────────────────────────────

describe("getItemMovements", () => {
  beforeEach(() => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue({
      id: "item-001",
    } as never);
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([] as never);
  });

  it("CRITICAL-1: verifica ownership del ítem antes de consultar movimientos", async () => {
    await getItemMovements(COMPANY_ID, "item-001");
    expect(vi.mocked(prisma.inventoryItem.findFirstOrThrow)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-001", companyId: COMPANY_ID },
      })
    );
  });

  it("consulta movimientos con companyId e itemId en el where", async () => {
    await getItemMovements(COMPANY_ID, "item-001");
    expect(vi.mocked(prisma.inventoryMovement.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, itemId: "item-001" },
        orderBy: { date: "desc" },
      })
    );
  });

  it("lanza error si el ítem no pertenece a la empresa (CRITICAL-1)", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("No encontrado")
    );
    await expect(getItemMovements(COMPANY_ID, "item-ajeno")).rejects.toThrow("No encontrado");
    expect(vi.mocked(prisma.inventoryMovement.findMany)).not.toHaveBeenCalled();
  });

  it("devuelve array vacío cuando no hay movimientos", async () => {
    const result = await getItemMovements(COMPANY_ID, "item-001");
    expect(result).toEqual([]);
  });
});
