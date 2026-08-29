// src/modules/payroll/__tests__/OvertimeService.test.ts
// LOTTT Art. 183 — registro de horas extraordinarias.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    employee: { findFirst: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    overtimeEntry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { OvertimeService } from "../services/OvertimeService";
import { CreateOvertimeEntrySchema } from "../schemas/overtime.schema";

const COMPANY = "co-1";
const USER = "user-1";
const EMP = "emp-1";

const BASE_INPUT = {
  employeeId: EMP,
  workedOn: "2026-03-10",
  hours: 4,
  kind: "DIURNA" as const,
  workPerformed: "Cierre de inventario de fin de mes",
  authorized: true,
  authorizationRef: "INS-2026-114",
};

const CREATED = {
  id: "ot-1",
  employeeId: EMP,
  employee: { firstName: "Ana", lastName: "García" },
  workedOn: new Date("2026-03-10T00:00:00.000Z"),
  hours: new Decimal("4.00"),
  kind: "DIURNA" as const,
  workPerformed: BASE_INPUT.workPerformed,
  authorized: true,
  authorizationRef: "INS-2026-114",
  payrollRunId: null,
  paidAmount: null,
  createdAt: new Date(),
};

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTx();
  vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: EMP, status: "ACTIVE" } as never);
  vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ status: "OPEN" } as never);
  vi.mocked(prisma.overtimeEntry.create).mockResolvedValue(CREATED as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
});

describe("CreateOvertimeEntrySchema", () => {
  it("exige describir el trabajo efectuado (Art. 183)", () => {
    // El articulo lo nombra expresamente: "los trabajos efectuados en esas
    // horas". Un registro sin eso no se lleva "conforme a la Ley".
    const r = CreateOvertimeEntrySchema.safeParse({ ...BASE_INPUT, workPerformed: "x" });
    expect(r.success).toBe(false);
  });

  it("rechaza mas de diez horas en un registro (Art. 178)", () => {
    expect(CreateOvertimeEntrySchema.safeParse({ ...BASE_INPUT, hours: 11 }).success).toBe(false);
  });

  it("rechaza horas en cero o negativas", () => {
    expect(CreateOvertimeEntrySchema.safeParse({ ...BASE_INPUT, hours: 0 }).success).toBe(false);
    expect(CreateOvertimeEntrySchema.safeParse({ ...BASE_INPUT, hours: -2 }).success).toBe(false);
  });

  it("rechaza una fecha futura", () => {
    const manana = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    expect(CreateOvertimeEntrySchema.safeParse({ ...BASE_INPUT, workedOn: manana }).success).toBe(false);
  });

  it("por defecto las horas van SIN autorizacion", () => {
    // Art. 182: el permiso es PREVIO. Asumir que existe sin que nadie lo diga
    // abarataria la hora a la mitad del recargo que manda la Ley.
    const { authorized: _omitido, ...sinFlag } = BASE_INPUT;
    const r = CreateOvertimeEntrySchema.safeParse(sinFlag);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.authorized).toBe(false);
  });

  it("acepta un registro completo", () => {
    expect(CreateOvertimeEntrySchema.safeParse(BASE_INPUT).success).toBe(true);
  });
});

describe("OvertimeService.create", () => {
  it("registra y deja AuditLog en el mismo $transaction", async () => {
    const row = await OvertimeService.create(COMPANY, USER, BASE_INPUT, "1.2.3.4", "UA");
    expect(row.hours).toBe("4");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_OVERTIME_ENTRY",
          ipAddress: "1.2.3.4",
          userAgent: "UA",
        }),
      }),
    );
  });

  it("IDOR: un empleado de otra empresa no existe", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);
    await expect(
      OvertimeService.create(COMPANY, USER, BASE_INPUT),
    ).rejects.toThrow("Empleado no encontrado");
  });

  it("no admite horas de un empleado inactivo", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: EMP, status: "TERMINATED" } as never);
    await expect(
      OvertimeService.create(COMPANY, USER, BASE_INPUT),
    ).rejects.toThrow("inactivo");
  });

  it("R-3: periodo contable cerrado bloquea el registro", async () => {
    // Se avisa aqui, que es cuando el usuario todavia puede corregir la fecha,
    // y no al intentar procesar la nomina.
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ status: "CLOSED" } as never);
    await expect(
      OvertimeService.create(COMPANY, USER, BASE_INPUT),
    ).rejects.toThrow("cerrado");
  });

  it("sin periodo contable creado todavia NO bloquea", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    await expect(OvertimeService.create(COMPANY, USER, BASE_INPUT)).resolves.toBeDefined();
  });
});

describe("OvertimeService.delete", () => {
  it("borra un registro no pagado y lo deja en el AuditLog", async () => {
    vi.mocked(prisma.overtimeEntry.findFirst).mockResolvedValue(CREATED as never);
    vi.mocked(prisma.overtimeEntry.delete).mockResolvedValue({} as never);

    await OvertimeService.delete(COMPANY, USER, "ot-1");

    expect(vi.mocked(prisma.overtimeEntry.delete)).toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE_OVERTIME_ENTRY" }),
      }),
    );
  });

  it("NO borra uno ya pagado: el registro conserva la remuneracion (Art. 183)", async () => {
    vi.mocked(prisma.overtimeEntry.findFirst).mockResolvedValue(
      { ...CREATED, payrollRunId: "run-1", paidAmount: new Decimal("500") } as never,
    );
    await expect(
      OvertimeService.delete(COMPANY, USER, "ot-1"),
    ).rejects.toThrow("ya se pagaron");
    expect(vi.mocked(prisma.overtimeEntry.delete)).not.toHaveBeenCalled();
  });

  it("IDOR: un registro de otra empresa no existe", async () => {
    vi.mocked(prisma.overtimeEntry.findFirst).mockResolvedValue(null as never);
    await expect(
      OvertimeService.delete(COMPANY, USER, "ot-ajeno"),
    ).rejects.toThrow("no encontrado");
  });
});
