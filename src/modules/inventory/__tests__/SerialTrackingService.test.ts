// src/modules/inventory/__tests__/SerialTrackingService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import {
  createSerials,
  validateSerialAvailability,
  applySerialMovement,
  voidSerialMovement,
} from "../services/SerialTrackingService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeTx = () => ({
  inventorySerial: {
    findMany: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  inventoryMovementSerial: {
    findMany: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

const COMPANY = "company-001";
const ITEM = "item-001";
const MOVEMENT = "mov-001";
const USER = "user-001";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createSerials ────────────────────────────────────────────────────────────

describe("createSerials", () => {
  it("crea seriales y links de movimiento correctamente", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany
      .mockResolvedValueOnce([]) // verificación de existentes: ninguno
      .mockResolvedValueOnce([{ id: "ser-1" }, { id: "ser-2" }]); // IDs creados

    await createSerials(tx as never, COMPANY, ITEM, MOVEMENT, ["SN-001", "SN-002"], USER);

    expect(tx.inventorySerial.createMany).toHaveBeenCalledOnce();
    const createData = tx.inventorySerial.createMany.mock.calls[0]![0].data;
    expect(createData).toHaveLength(2);
    expect(createData[0].serialNumber).toBe("SN-001");
    expect(createData[0].companyId).toBe(COMPANY);
    expect(createData[0].status).toBe("AVAILABLE");

    expect(tx.inventoryMovementSerial.createMany).toHaveBeenCalledOnce();
  });

  it("HIGH-3: lanza error opaco si algún serialNumber ya existe (no expone el valor)", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValueOnce([{ status: "SOLD" }]); // ya existe

    await expect(
      createSerials(tx as never, COMPANY, ITEM, MOVEMENT, ["SN-DUPE"], USER)
    ).rejects.toThrow("ERR_SERIAL_ALREADY_EXISTS");
  });

  it("HIGH-3: nunca llama createMany si ya existen seriales (no upsert, no update)", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValueOnce([{ status: "VOIDED" }]);

    await expect(
      createSerials(tx as never, COMPANY, ITEM, MOVEMENT, ["SN-VOIDED"], USER)
    ).rejects.toThrow();

    expect(tx.inventorySerial.createMany).not.toHaveBeenCalled();
  });

  it("lanza error si el lote contiene números de serie duplicados", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValueOnce([]); // no existen aún — pero dup en batch

    await expect(
      createSerials(tx as never, COMPANY, ITEM, MOVEMENT, ["SN-001", "SN-001"], USER)
    ).rejects.toThrow("ERR_SERIAL_DUPLICATE_BATCH");
  });

  it("mensaje de error es opaco: no contiene el valor del serialNumber", async () => {
    const tx = makeTx();
    const sensitiveSerial = "SENIAT-SERIAL-12345-CONF";
    tx.inventorySerial.findMany.mockResolvedValueOnce([{ status: "SOLD" }]);

    await expect(
      createSerials(tx as never, COMPANY, ITEM, MOVEMENT, [sensitiveSerial], USER)
    ).rejects.toThrow(expect.objectContaining({
      message: expect.not.stringContaining(sensitiveSerial),
    }));
  });

  it("crea correctamente con notas opcionales", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "ser-1" }]);

    await createSerials(tx as never, COMPANY, ITEM, MOVEMENT, ["SN-001"], USER, "Factura 001");

    const createData = tx.inventorySerial.createMany.mock.calls[0]![0].data;
    expect(createData[0].notes).toBe("Factura 001");
  });
});

// ─── validateSerialAvailability ───────────────────────────────────────────────

describe("validateSerialAvailability", () => {
  it("válida correctamente cuando todos los seriales están AVAILABLE y coinciden", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValue([
      { id: "ser-1", status: "AVAILABLE" },
      { id: "ser-2", status: "AVAILABLE" },
    ]);

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1", "ser-2"], new Decimal("2"))
    ).resolves.toBeUndefined();
  });

  it("lanza error si serialIds está vacío", async () => {
    const tx = makeTx();

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, [], new Decimal("1"))
    ).rejects.toThrow("ERR_SERIAL_REQUIRED");
  });

  it("lanza error si la cantidad de seriales no coincide con quantityInBase", async () => {
    const tx = makeTx();

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1", "ser-2"], new Decimal("3"))
    ).rejects.toThrow("ERR_SERIAL_COUNT_MISMATCH");
  });

  it("CRITICAL-1: lanza error opaco si algún serialId no pertenece a companyId+itemId", async () => {
    const tx = makeTx();
    // findMany devuelve solo 1 de 2 — el otro no pertenece a este company+item
    tx.inventorySerial.findMany.mockResolvedValue([{ id: "ser-1", status: "AVAILABLE" }]);

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1", "ser-cross-tenant"], new Decimal("2"))
    ).rejects.toThrow("ERR_SERIAL_NOT_FOUND");
  });

  it("lanza error si algún serial no está en estado AVAILABLE (SOLD)", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValue([
      { id: "ser-1", status: "SOLD" },
    ]);

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1"], new Decimal("1"))
    ).rejects.toThrow("ERR_SERIAL_UNAVAILABLE");
  });

  it("lanza error si algún serial está VOIDED", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValue([
      { id: "ser-1", status: "VOIDED" },
    ]);

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1"], new Decimal("1"))
    ).rejects.toThrow("ERR_SERIAL_UNAVAILABLE");
  });

  it("lanza error si algún serial está IN_TRANSIT", async () => {
    const tx = makeTx();
    tx.inventorySerial.findMany.mockResolvedValue([
      { id: "ser-1", status: "IN_TRANSIT" },
    ]);

    await expect(
      validateSerialAvailability(tx as never, COMPANY, ITEM, ["ser-1"], new Decimal("1"))
    ).rejects.toThrow("ERR_SERIAL_UNAVAILABLE");
  });

  it("error de unavailable no expone valores de serialNumber", async () => {
    const tx = makeTx();
    const sensitiveSerial = "SERIAL-CONF-FISCAL-99";
    tx.inventorySerial.findMany.mockResolvedValue([{ id: sensitiveSerial, status: "SOLD" }]);

    try {
      await validateSerialAvailability(tx as never, COMPANY, ITEM, [sensitiveSerial], new Decimal("1"));
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain(sensitiveSerial);
    }
  });
});

// ─── applySerialMovement ──────────────────────────────────────────────────────

describe("applySerialMovement", () => {
  it("marca seriales como SOLD y establece soldAt", async () => {
    const tx = makeTx();

    await applySerialMovement(tx as never, COMPANY, ITEM, MOVEMENT, ["ser-1", "ser-2"]);

    expect(tx.inventorySerial.updateMany).toHaveBeenCalledOnce();
    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.where.id.in).toEqual(["ser-1", "ser-2"]);
    expect(updateArgs.where.companyId).toBe(COMPANY); // CRITICAL-1: guard de empresa
    expect(updateArgs.where.itemId).toBe(ITEM);
    expect(updateArgs.data.status).toBe("SOLD");
    expect(updateArgs.data.soldAt).toBeInstanceOf(Date);
  });

  it("crea links InventoryMovementSerial para cada serial", async () => {
    const tx = makeTx();

    await applySerialMovement(tx as never, COMPANY, ITEM, MOVEMENT, ["ser-1"]);

    expect(tx.inventoryMovementSerial.createMany).toHaveBeenCalledOnce();
    const linkData = tx.inventoryMovementSerial.createMany.mock.calls[0]![0].data;
    expect(linkData).toHaveLength(1);
    expect(linkData[0].movementId).toBe(MOVEMENT);
    expect(linkData[0].serialId).toBe("ser-1");
  });
});

// ─── voidSerialMovement ───────────────────────────────────────────────────────

describe("voidSerialMovement", () => {
  it("void SALIDA: retorna seriales a AVAILABLE (soldAt = null)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([
      { serialId: "ser-1" },
      { serialId: "ser-2" },
    ]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");

    expect(tx.inventorySerial.updateMany).toHaveBeenCalledOnce();
    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe("AVAILABLE");
    expect(updateArgs.data.soldAt).toBeNull();
    expect(updateArgs.where.companyId).toBe(COMPANY); // CRITICAL-1
  });

  it("void ENTRADA: marca seriales como VOIDED (nunca AVAILABLE — ADR-021 D-3)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([
      { serialId: "ser-1" },
    ]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "ENTRADA");

    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe("VOIDED");
    expect(updateArgs.data.voidedAt).toBeInstanceOf(Date);
    // Verificar que NO es AVAILABLE — un serial de ENTRADA anulada nunca vuelve a stock
    expect(updateArgs.data.status).not.toBe("AVAILABLE");
  });

  it("void AJUSTE: trata igual que SALIDA (retorna a AVAILABLE)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([{ serialId: "ser-1" }]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "AJUSTE");

    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe("AVAILABLE");
  });

  it("no hace nada cuando no hay líneas de serial (caso borde)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");
    expect(tx.inventorySerial.updateMany).not.toHaveBeenCalled();
  });

  it("void SALIDA incluye companyId en el where (defensa en profundidad CRITICAL-1)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([{ serialId: "ser-1" }]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "SALIDA");

    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.where.companyId).toBe(COMPANY);
  });

  it("void ENTRADA incluye companyId en el where (defensa en profundidad CRITICAL-1)", async () => {
    const tx = makeTx();
    tx.inventoryMovementSerial.findMany.mockResolvedValue([{ serialId: "ser-1" }]);

    await voidSerialMovement(tx as never, COMPANY, MOVEMENT, "ENTRADA");

    const updateArgs = tx.inventorySerial.updateMany.mock.calls[0]![0];
    expect(updateArgs.where.companyId).toBe(COMPANY);
  });
});
