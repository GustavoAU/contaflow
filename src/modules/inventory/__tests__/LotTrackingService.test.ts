// src/modules/inventory/__tests__/LotTrackingService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import {
  resolveLotAllocations,
  validateLotAllocation,
  applyLotMovement,
  voidLotMovement,
} from "../services/LotTrackingService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeLot = (overrides: Partial<{ id: string; quantityOnHand: Decimal; expiresAt: Date | null }> = {}) => ({
  id: overrides.id ?? "lot-001",
  quantityOnHand: overrides.quantityOnHand ?? new Decimal("10"),
  expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : null,
});

const makeTx = (overrides: Partial<ReturnType<typeof defaultTx>> = {}) => ({
  ...defaultTx(),
  ...overrides,
});

const defaultTx = () => ({
  inventoryLot: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  inventoryMovementLot: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
});

const COMPANY = "company-001";
const ITEM = "item-001";
const MOVEMENT = "mov-001";
const USER = "user-001";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── resolveLotAllocations ────────────────────────────────────────────────────

describe("resolveLotAllocations", () => {
  it("usa asignaciones manuales si se proveen (fefoOverridden = true)", async () => {
    const tx = makeTx();
    const manual = [{ lotId: "lot-a", quantity: "5" }];
    const result = await resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("5"), manual);
    expect(result.fefoOverridden).toBe(true);
    expect(result.allocations).toEqual(manual);
    expect(tx.inventoryLot.findMany).not.toHaveBeenCalled();
  });

  it("calcula FEFO automático cuando no hay asignaciones manuales (fefoOverridden = false)", async () => {
    const tx = makeTx();
    tx.inventoryLot.findMany.mockResolvedValue([
      makeLot({ id: "lot-exp", quantityOnHand: new Decimal("3"), expiresAt: new Date("2026-06-01") }),
      makeLot({ id: "lot-no-exp", quantityOnHand: new Decimal("10"), expiresAt: null }),
    ]);

    const result = await resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("7"));
    expect(result.fefoOverridden).toBe(false);
    expect(result.allocations).toHaveLength(2);
    // Primero el lote con vencimiento (FEFO)
    expect(result.allocations[0]!.lotId).toBe("lot-exp");
    expect(result.allocations[0]!.quantity).toBe("3");
    // Luego el lote sin vencimiento para cubrir el restante (4)
    expect(result.allocations[1]!.lotId).toBe("lot-no-exp");
    expect(result.allocations[1]!.quantity).toBe("4");
  });

  it("FEFO con un solo lote que cubre exactamente la cantidad", async () => {
    const tx = makeTx();
    tx.inventoryLot.findMany.mockResolvedValue([
      makeLot({ id: "lot-a", quantityOnHand: new Decimal("5") }),
    ]);

    const result = await resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("5"));
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.quantity).toBe("5");
  });

  it("FEFO lanza error cuando stock en lotes es insuficiente", async () => {
    const tx = makeTx();
    tx.inventoryLot.findMany.mockResolvedValue([
      makeLot({ id: "lot-a", quantityOnHand: new Decimal("2") }),
    ]);

    await expect(
      resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("5"))
    ).rejects.toThrow("Stock insuficiente en lotes");
  });

  it("FEFO no asigna lotes con quantityOnHand = 0 (filtrado en DB)", async () => {
    const tx = makeTx();
    // El mock simula que findMany filtra quantityOnHand > 0
    tx.inventoryLot.findMany.mockResolvedValue([
      makeLot({ id: "lot-a", quantityOnHand: new Decimal("3") }),
    ]);

    const result = await resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("3"));
    expect(result.allocations).toHaveLength(1);
  });

  it("FEFO vacío lanza error de stock insuficiente", async () => {
    const tx = makeTx();
    tx.inventoryLot.findMany.mockResolvedValue([]);

    await expect(
      resolveLotAllocations(tx as never, COMPANY, ITEM, new Decimal("1"))
    ).rejects.toThrow("Stock insuficiente en lotes");
  });
});

// ─── validateLotAllocation ───────────────────────────────────────────────────

describe("validateLotAllocation", () => {
  it("válida cuando las asignaciones suman exactamente a quantityInBase", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst
      .mockResolvedValueOnce({ id: "lot-a", quantityOnHand: new Decimal("5") })
      .mockResolvedValueOnce({ id: "lot-b", quantityOnHand: new Decimal("5") });

    const allocations = [
      { lotId: "lot-a", quantity: "3" },
      { lotId: "lot-b", quantity: "2" },
    ];

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("5"), allocations)
    ).resolves.toBeUndefined();
  });

  it("lanza error cuando la suma no coincide con quantityInBase", async () => {
    const tx = makeTx();

    const allocations = [{ lotId: "lot-a", quantity: "3" }];

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("5"), allocations)
    ).rejects.toThrow("no coinciden con la cantidad del movimiento");
  });

  it("lanza error cuando array está vacío", async () => {
    const tx = makeTx();

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("5"), [])
    ).rejects.toThrow("al menos una asignación");
  });

  it("CRITICAL-1: lanza error cuando lotId no pertenece a companyId+itemId", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst.mockResolvedValue(null); // no existe para este company+item

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("3"), [
        { lotId: "lote-otro-empresa", quantity: "3" },
      ])
    ).rejects.toThrow("no encontrado o acceso denegado");
  });

  it("lanza error cuando lote no tiene stock suficiente", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst.mockResolvedValue({ id: "lot-a", quantityOnHand: new Decimal("1") });

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("5"), [
        { lotId: "lot-a", quantity: "5" },
      ])
    ).rejects.toThrow("Stock insuficiente en lote");
  });

  it("lanza error cuando cantidad de asignación es cero o negativa", async () => {
    const tx = makeTx();

    await expect(
      validateLotAllocation(tx as never, COMPANY, ITEM, new Decimal("0"), [
        { lotId: "lot-a", quantity: "0" },
      ])
    ).rejects.toThrow("debe ser positiva");
  });
});

// ─── applyLotMovement — ENTRADA ───────────────────────────────────────────────

describe("applyLotMovement — ENTRADA", () => {
  it("crea un lote nuevo cuando lotNumber no existe", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst.mockResolvedValue(null);
    tx.inventoryLot.create.mockResolvedValue({ id: "new-lot" });

    await applyLotMovement(
      tx as never,
      COMPANY, ITEM, MOVEMENT, "ENTRADA",
      new Decimal("10"), [],
      USER,
      { lotNumber: "LOTE-001" }
    );

    expect(tx.inventoryLot.create).toHaveBeenCalledOnce();
    const createArgs = tx.inventoryLot.create.mock.calls[0]![0].data;
    expect(createArgs.lotNumber).toBe("LOTE-001");
    expect(createArgs.companyId).toBe(COMPANY);
    expect(createArgs.itemId).toBe(ITEM);
    expect(tx.inventoryMovementLot.create).toHaveBeenCalledOnce();
  });

  it("actualiza lote existente cuando lotNumber ya existe", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst.mockResolvedValue({ id: "existing-lot", quantityOnHand: new Decimal("5") });
    tx.inventoryLot.update.mockResolvedValue({ id: "existing-lot" });

    await applyLotMovement(
      tx as never,
      COMPANY, ITEM, MOVEMENT, "ENTRADA",
      new Decimal("3"), [],
      USER,
      { lotNumber: "LOTE-001" }
    );

    expect(tx.inventoryLot.update).toHaveBeenCalledOnce();
    const updateData = tx.inventoryLot.update.mock.calls[0]![0].data;
    // 5 + 3 = 8
    expect(updateData.quantityOnHand.toString()).toBe("8");
    expect(tx.inventoryLot.create).not.toHaveBeenCalled();
  });

  it("asigna expiresAt cuando se provee en lotData", async () => {
    const tx = makeTx();
    tx.inventoryLot.findFirst.mockResolvedValue(null);
    tx.inventoryLot.create.mockResolvedValue({ id: "new-lot" });

    const expiresAt = new Date("2027-01-01");
    await applyLotMovement(
      tx as never,
      COMPANY, ITEM, MOVEMENT, "ENTRADA",
      new Decimal("5"), [],
      USER,
      { lotNumber: "LOTE-EXP", expiresAt }
    );

    const createData = tx.inventoryLot.create.mock.calls[0]![0].data;
    expect(createData.expiresAt).toEqual(expiresAt);
  });

  it("lanza error si lotData no se provee en ENTRADA", async () => {
    const tx = makeTx();

    await expect(
      applyLotMovement(tx as never, COMPANY, ITEM, MOVEMENT, "ENTRADA", new Decimal("5"), [], USER)
    ).rejects.toThrow("lotData");
  });
});

// ─── applyLotMovement — SALIDA ────────────────────────────────────────────────

describe("applyLotMovement — SALIDA", () => {
  it("decrementa quantityOnHand de cada lote asignado", async () => {
    const tx = makeTx();
    tx.inventoryLot.update.mockResolvedValue({});
    tx.inventoryMovementLot.create.mockResolvedValue({});

    const allocations = [
      { lotId: "lot-a", quantity: "3" },
      { lotId: "lot-b", quantity: "2" },
    ];

    await applyLotMovement(
      tx as never, COMPANY, ITEM, MOVEMENT, "SALIDA", new Decimal("5"), allocations, USER
    );

    expect(tx.inventoryLot.update).toHaveBeenCalledTimes(2);
    expect(tx.inventoryMovementLot.create).toHaveBeenCalledTimes(2);

    // Verifica decremento correcto para lot-a
    const firstCall = tx.inventoryLot.update.mock.calls[0]![0];
    expect(firstCall.data.quantityOnHand.decrement.toString()).toBe("3");
  });

  it("crea un InventoryMovementLot por cada asignación", async () => {
    const tx = makeTx();
    tx.inventoryLot.update.mockResolvedValue({});
    tx.inventoryMovementLot.create.mockResolvedValue({});

    const allocations = [
      { lotId: "lot-a", quantity: "5" },
    ];

    await applyLotMovement(
      tx as never, COMPANY, ITEM, MOVEMENT, "SALIDA", new Decimal("5"), allocations, USER
    );

    const lineData = tx.inventoryMovementLot.create.mock.calls[0]![0].data;
    expect(lineData.movementId).toBe(MOVEMENT);
    expect(lineData.lotId).toBe("lot-a");
    expect(lineData.quantity.toString()).toBe("5");
  });
});

// ─── voidLotMovement ──────────────────────────────────────────────────────────

describe("voidLotMovement", () => {
  it("void ENTRADA: resta la cantidad del lote (revertir el incremento)", async () => {
    const tx = makeTx();
    tx.inventoryMovementLot.findMany.mockResolvedValue([
      { lotId: "lot-a", quantity: new Decimal("5") },
    ]);
    tx.inventoryLot.findFirst.mockResolvedValue({ id: "lot-a" });
    tx.inventoryLot.update.mockResolvedValue({});

    await voidLotMovement(tx as never, COMPANY, MOVEMENT, "ENTRADA");

    const updateCall = tx.inventoryLot.update.mock.calls[0]![0];
    expect(updateCall.data.quantityOnHand.decrement.toString()).toBe("5");
  });

  it("void SALIDA: restaura la cantidad al lote (revertir el decremento)", async () => {
    const tx = makeTx();
    tx.inventoryMovementLot.findMany.mockResolvedValue([
      { lotId: "lot-a", quantity: new Decimal("3") },
    ]);
    tx.inventoryLot.findFirst.mockResolvedValue({ id: "lot-a" });
    tx.inventoryLot.update.mockResolvedValue({});

    await voidLotMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");

    const updateCall = tx.inventoryLot.update.mock.calls[0]![0];
    expect(updateCall.data.quantityOnHand.increment.toString()).toBe("3");
  });

  it("CRITICAL-1: lanza error si un lote no pertenece a companyId", async () => {
    const tx = makeTx();
    tx.inventoryMovementLot.findMany.mockResolvedValue([
      { lotId: "lote-otra-empresa", quantity: new Decimal("5") },
    ]);
    tx.inventoryLot.findFirst.mockResolvedValue(null); // no encontrado en esta empresa

    await expect(
      voidLotMovement(tx as never, COMPANY, MOVEMENT, "SALIDA")
    ).rejects.toThrow("no pertenece a esta empresa");
  });

  it("no hace nada cuando no hay líneas de lote (caso borde)", async () => {
    const tx = makeTx();
    tx.inventoryMovementLot.findMany.mockResolvedValue([]);

    await voidLotMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");
    expect(tx.inventoryLot.update).not.toHaveBeenCalled();
  });

  it("void múltiples lotes en una SALIDA", async () => {
    const tx = makeTx();
    tx.inventoryMovementLot.findMany.mockResolvedValue([
      { lotId: "lot-a", quantity: new Decimal("3") },
      { lotId: "lot-b", quantity: new Decimal("2") },
    ]);
    tx.inventoryLot.findFirst
      .mockResolvedValueOnce({ id: "lot-a" })
      .mockResolvedValueOnce({ id: "lot-b" });
    tx.inventoryLot.update.mockResolvedValue({});

    await voidLotMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");
    expect(tx.inventoryLot.update).toHaveBeenCalledTimes(2);
  });
});
