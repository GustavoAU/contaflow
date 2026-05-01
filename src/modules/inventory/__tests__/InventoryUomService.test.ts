import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    inventoryItem: { findFirstOrThrow: vi.fn() },
    inventoryItemUnit: {
      create: vi.fn(),
      update: vi.fn(),
      findFirstOrThrow: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    inventoryMovement: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  createUnit,
  updateUnit,
  softDeleteUnit,
  listUnits,
  resolveQuantity,
} from "../services/InventoryUomService";
import prisma from "@/lib/prisma";

const COMPANY_ID = "company-001";
const ITEM_ID = "item-001";
const UNIT_ID = "unit-001";
const USER_ID = "user-test";

const makeUnit = (overrides = {}) => ({
  id: UNIT_ID,
  companyId: COMPANY_ID,
  itemId: ITEM_ID,
  name: "Caja",
  abbreviation: "CJ",
  conversionFactor: new Decimal("12"),
  isBase: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: USER_ID,
  ...overrides,
});

const makeBaseUnit = (overrides = {}) =>
  makeUnit({ id: "unit-base", name: "Unidad", abbreviation: "UN", conversionFactor: new Decimal("1"), isBase: true, ...overrides });

const makeTx = () => ({
  inventoryItemUnit: {
    create: vi.fn().mockResolvedValue(makeUnit()),
    update: vi.fn().mockResolvedValue(makeUnit()),
  },
  inventoryItem: {
    update: vi.fn().mockResolvedValue({}),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
});

let currentTx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  currentTx = makeTx();

  vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockResolvedValue({ id: ITEM_ID } as never);
  vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValue(makeUnit() as never);
  vi.mocked(prisma.inventoryMovement.count).mockResolvedValue(0);
  vi.mocked(prisma.inventoryItemUnit.count).mockResolvedValue(0);
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof currentTx) => unknown) => fn(currentTx)) as never
  );
});

// ─── createUnit ──────────────────────────────────────────────────────────────

describe("createUnit", () => {
  it("crea unidad con datos válidos", async () => {
    const result = await createUnit(
      { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Caja", abbreviation: "CJ", conversionFactor: "12", isBase: false },
      USER_ID
    );
    expect(result).toBeDefined();
    expect(currentTx.inventoryItemUnit.create).toHaveBeenCalledOnce();
    expect(currentTx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("HIGH-1: verifica ownership del ítem antes de crear", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Item not found")
    );
    await expect(
      createUnit(
        { companyId: COMPANY_ID, itemId: "other-item", name: "Caja", abbreviation: "CJ", conversionFactor: "12", isBase: false },
        USER_ID
      )
    ).rejects.toThrow("Item not found");
  });

  it("MEDIUM-4: rechaza factor <= 0 a nivel de servicio", async () => {
    await expect(
      createUnit(
        { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Caja", abbreviation: "CJ", conversionFactor: "0", isBase: false },
        USER_ID
      )
    ).rejects.toThrow("mayor que cero");
  });

  it("sincroniza denorm en InventoryItem cuando isBase = true", async () => {
    currentTx.inventoryItemUnit.create.mockResolvedValue(makeBaseUnit());

    await createUnit(
      { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Unidad", abbreviation: "UN", conversionFactor: "1", isBase: true },
      USER_ID
    );

    expect(currentTx.inventoryItem.update).toHaveBeenCalledOnce();
    expect(currentTx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseUnitName: "Unidad", baseUnitAbbr: "UN" }),
      })
    );
  });

  it("no actualiza denorm cuando isBase = false", async () => {
    await createUnit(
      { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Caja", abbreviation: "CJ", conversionFactor: "12", isBase: false },
      USER_ID
    );
    expect(currentTx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it("MEDIUM-3: captura P2002 de partial index (segunda unidad base)", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002", meta: { target: ["itemId"] } })
    );
    await expect(
      createUnit(
        { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Otra", abbreviation: "OT", conversionFactor: "2", isBase: true },
        USER_ID
      )
    ).rejects.toThrow("unidad base");
  });

  it("MEDIUM-3: captura P2002 de @@unique([itemId, name])", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002", meta: { target: ["name"] } })
    );
    await expect(
      createUnit(
        { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Caja", abbreviation: "CJ", conversionFactor: "12", isBase: false },
        USER_ID
      )
    ).rejects.toThrow("nombre");
  });

  it("propaga errores no P2002", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("DB error"));
    await expect(
      createUnit(
        { companyId: COMPANY_ID, itemId: ITEM_ID, name: "X", abbreviation: "X", conversionFactor: "1", isBase: false },
        USER_ID
      )
    ).rejects.toThrow("DB error");
  });

  it("almacena ipAddress y userAgent en AuditLog", async () => {
    await createUnit(
      { companyId: COMPANY_ID, itemId: ITEM_ID, name: "Caja", abbreviation: "CJ", conversionFactor: "12", isBase: false },
      USER_ID,
      "192.168.1.1",
      "Mozilla/5.0"
    );
    expect(currentTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: "192.168.1.1", userAgent: "Mozilla/5.0" }),
      })
    );
  });
});

// ─── updateUnit ──────────────────────────────────────────────────────────────

describe("updateUnit", () => {
  it("actualiza name y abbreviation correctamente", async () => {
    const result = await updateUnit(
      { unitId: UNIT_ID, companyId: COMPANY_ID, name: "Caja Grande" },
      USER_ID
    );
    expect(result).toBeDefined();
    expect(currentTx.inventoryItemUnit.update).toHaveBeenCalledOnce();
  });

  it("HIGH-2: verifica ownership antes de actualizar", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Unit not found")
    );
    await expect(
      updateUnit({ unitId: "other-unit", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Unit not found");
  });

  it("HIGH-3: bloquea cambio de factor si hay movimientos DRAFT", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(3);
    await expect(
      updateUnit(
        { unitId: UNIT_ID, companyId: COMPANY_ID, conversionFactor: "24" },
        USER_ID
      )
    ).rejects.toThrow("inmutable");
  });

  it("HIGH-3: bloquea cambio de factor si hay movimientos POSTED", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(1);
    await expect(
      updateUnit(
        { unitId: UNIT_ID, companyId: COMPANY_ID, conversionFactor: "6" },
        USER_ID
      )
    ).rejects.toThrow("inmutable");
  });

  it("HIGH-3: permite cambio de factor si no hay movimientos", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(0);
    const result = await updateUnit(
      { unitId: UNIT_ID, companyId: COMPANY_ID, conversionFactor: "24" },
      USER_ID
    );
    expect(result).toBeDefined();
  });

  it("HIGH-3: permite actualizar solo nombre sin verificar movimientos", async () => {
    const result = await updateUnit(
      { unitId: UNIT_ID, companyId: COMPANY_ID, name: "Otro nombre" },
      USER_ID
    );
    expect(result).toBeDefined();
    expect(prisma.inventoryMovement.count).not.toHaveBeenCalled();
  });

  it("sincroniza baseUnitName cuando se actualiza unidad base", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBaseUnit() as never
    );

    await updateUnit(
      { unitId: "unit-base", companyId: COMPANY_ID, name: "Nueva Unidad" },
      USER_ID
    );

    expect(currentTx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseUnitName: "Nueva Unidad" }),
      })
    );
  });

  it("no actualiza denorm cuando la unidad no es base", async () => {
    await updateUnit(
      { unitId: UNIT_ID, companyId: COMPANY_ID, name: "Nuevo Nombre" },
      USER_ID
    );
    expect(currentTx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it("HIGH-3: no verifica movimientos si conversionFactor no cambia (mismo valor)", async () => {
    // existing.conversionFactor = "12", nuevo también = "12"
    await updateUnit(
      { unitId: UNIT_ID, companyId: COMPANY_ID, conversionFactor: "12" },
      USER_ID
    );
    expect(prisma.inventoryMovement.count).not.toHaveBeenCalled();
  });
});

// ─── softDeleteUnit ───────────────────────────────────────────────────────────

describe("softDeleteUnit", () => {
  it("soft-delete exitoso cuando no hay movimientos", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(0);
    const result = await softDeleteUnit({ unitId: UNIT_ID, companyId: COMPANY_ID }, USER_ID);
    expect(result).toBeDefined();
    expect(currentTx.inventoryItemUnit.update).toHaveBeenCalledOnce();
  });

  it("HIGH-2: verifica ownership antes de eliminar", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Unit not found")
    );
    await expect(
      softDeleteUnit({ unitId: "other-unit", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("Unit not found");
  });

  it("D-7: bloquea eliminación si existen movimientos referenciados", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(2);
    await expect(
      softDeleteUnit({ unitId: UNIT_ID, companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("movimiento");
  });

  it("bloquea eliminar unidad base si hay otras unidades activas", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBaseUnit() as never
    );
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.inventoryItemUnit.count).mockResolvedValueOnce(2); // hay otras unidades

    await expect(
      softDeleteUnit({ unitId: "unit-base", companyId: COMPANY_ID }, USER_ID)
    ).rejects.toThrow("unidad base");
  });

  it("permite eliminar unidad base si no hay otras unidades activas", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBaseUnit() as never
    );
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.inventoryItemUnit.count).mockResolvedValueOnce(0); // no hay otras

    const result = await softDeleteUnit({ unitId: "unit-base", companyId: COMPANY_ID }, USER_ID);
    expect(result).toBeDefined();
  });
});

// ─── listUnits ────────────────────────────────────────────────────────────────

describe("listUnits", () => {
  it("HIGH-1: verifica ownership del ítem antes de listar", async () => {
    vi.mocked(prisma.inventoryItem.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Item not found")
    );
    await expect(
      listUnits({ companyId: COMPANY_ID, itemId: "other-item" })
    ).rejects.toThrow("Item not found");
  });

  it("retorna lista vacía cuando no hay unidades", async () => {
    vi.mocked(prisma.inventoryItemUnit.findMany).mockResolvedValueOnce([] as never);
    const result = await listUnits({ companyId: COMPANY_ID, itemId: ITEM_ID });
    expect(result).toEqual([]);
  });
});

// ─── resolveQuantity ─────────────────────────────────────────────────────────

describe("resolveQuantity", () => {
  it("convierte cantidad a unidad base correctamente", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeUnit({ conversionFactor: new Decimal("12") }) as never
    );
    const { quantityInBase, conversionFactor } = await resolveQuantity(
      COMPANY_ID, UNIT_ID, new Decimal("5")
    );
    expect(quantityInBase.toNumber()).toBe(60);
    expect(conversionFactor.toNumber()).toBe(12);
  });

  it("unidad base (factor=1): cantidad no cambia", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeBaseUnit({ conversionFactor: new Decimal("1") }) as never
    );
    const { quantityInBase } = await resolveQuantity(
      COMPANY_ID, "unit-base", new Decimal("5")
    );
    expect(quantityInBase.toNumber()).toBe(5);
  });

  it("HIGH-1: verifica companyId antes de usar el factor", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockRejectedValueOnce(
      new Error("Unit not found or access denied")
    );
    await expect(
      resolveQuantity("other-company", UNIT_ID, new Decimal("5"))
    ).rejects.toThrow();
  });

  it("MEDIUM-4: lanza error si factor en DB es <= 0 (corrupción)", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeUnit({ conversionFactor: new Decimal("0") }) as never
    );
    await expect(
      resolveQuantity(COMPANY_ID, UNIT_ID, new Decimal("5"))
    ).rejects.toThrow("inválido");
  });

  it("usa Decimal.js sin pérdida de precisión", async () => {
    vi.mocked(prisma.inventoryItemUnit.findFirstOrThrow).mockResolvedValueOnce(
      makeUnit({ conversionFactor: new Decimal("0.001") }) as never
    );
    const { quantityInBase } = await resolveQuantity(
      COMPANY_ID, UNIT_ID, new Decimal("1000")
    );
    // 1000 * 0.001 = 1 exacto — sin floating-point error
    expect(quantityInBase.toFixed(10)).toBe("1.0000000000");
  });
});
