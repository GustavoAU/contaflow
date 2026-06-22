import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// HC-08 (ADR-037 D-2): el módulo escribe en prisma.auditLog.create. Mockeamos el
// singleton de Prisma para inspeccionar la llamada sin tocar DB.
const mockAuditCreate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  default: { auditLog: { create: mockAuditCreate } },
}));

import { logRejection, shouldLogRejection } from "../utils/log-rejection";

function makeKnownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("msg", {
    code,
    clientVersion: "7.4.1",
  });
}

describe("shouldLogRejection — HC-08 filtro de qué se loguea", () => {
  it("TRUE para un error de regla de negocio normal", () => {
    expect(shouldLogRejection(new Error("Saldo insuficiente"))).toBe(true);
  });

  it("FALSE para P2002 (correlativo transitorio, ruido)", () => {
    expect(shouldLogRejection(makeKnownError("P2002"))).toBe(false);
  });

  it("TRUE para P2003 (FK inválida — sí es un rechazo de regla)", () => {
    expect(shouldLogRejection(makeKnownError("P2003"))).toBe(true);
  });

  it("FALSE para PrismaClientInitializationError (DB no disponible)", () => {
    const initErr = new Prisma.PrismaClientInitializationError("no db", "7.4.1");
    expect(shouldLogRejection(initErr)).toBe(false);
  });

  it("FALSE para error de conexión / timeout", () => {
    expect(shouldLogRejection(new Error("connection terminated"))).toBe(false);
    expect(shouldLogRejection(new Error("ECONNRESET while querying"))).toBe(false);
    expect(shouldLogRejection(new Error("Request timeout"))).toBe(false);
  });
});

describe("logRejection — HC-08 registro best-effort append-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama auditLog.create con action *_REJECTED y newValue {reason, outcome:REJECTED}", async () => {
    mockAuditCreate.mockResolvedValue({});
    await logRejection({
      companyId: "comp-1",
      userId: "user-1",
      action: "CREATE_MOVEMENT",
      entityName: "CajaCajaMovement",
      entityId: "mov-1",
      reason: "Saldo insuficiente",
    });

    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const arg = mockAuditCreate.mock.calls[0][0];
    expect(arg.data.action).toBe("CREATE_MOVEMENT_REJECTED");
    expect(arg.data.action.endsWith("_REJECTED")).toBe(true);
    expect(arg.data.entityId).toBe("mov-1");
    expect(arg.data.newValue).toMatchObject({
      reason: "Saldo insuficiente",
      outcome: "REJECTED",
    });
  });

  it("usa entityId 'N/A' cuando no se provee (creaciones)", async () => {
    mockAuditCreate.mockResolvedValue({});
    await logRejection({
      companyId: "comp-1",
      userId: "user-1",
      action: "CREATE_DEPOSIT",
      entityName: "CajaCajaDeposit",
      reason: "Caja cerrada",
    });
    expect(mockAuditCreate.mock.calls[0][0].data.entityId).toBe("N/A");
  });

  it("best-effort: si auditLog.create RECHAZA, logRejection NO relanza", async () => {
    mockAuditCreate.mockRejectedValue(new Error("DB caída"));
    await expect(
      logRejection({
        companyId: "comp-1",
        userId: "user-1",
        action: "CREATE_MOVEMENT",
        entityName: "CajaCajaMovement",
        reason: "Saldo insuficiente",
      })
    ).resolves.toBeUndefined();
  });
});
