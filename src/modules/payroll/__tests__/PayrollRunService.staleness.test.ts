// src/modules/payroll/__tests__/PayrollRunService.staleness.test.ts
//
// Guardia de obsolescencia: `create` congela las líneas, así que un borrador
// que espera deja de reflejar la realidad. Sin este aviso, la comprobación
// depende de que alguien se acuerde de hacerla a mano.

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { PayrollRunService } from "../services/PayrollRunService";

vi.mock("../services/PayrollConceptService", () => ({
  PayrollConceptService: { seedDefaults: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollRun: { findFirst: vi.fn() },
    salaryHistory: { count: vi.fn() },
    overtimeEntry: { count: vi.fn() },
    employeeLoan: { count: vi.fn() },
    employeeRecurringConcept: { count: vi.fn() },
    legalThreshold: { count: vi.fn() },
  },
}));

const CALCULADO = new Date("2026-09-01T10:00:00Z");

const RUN_BORRADOR = {
  status: "DRAFT",
  createdAt: CALCULADO,
  periodStart: new Date("2026-08-16T00:00:00Z"),
  periodEnd: new Date("2026-08-31T00:00:00Z"),
  lines: [{ employeeId: "emp-1" }, { employeeId: "emp-1" }, { employeeId: "emp-2" }],
};

function sinCambios() {
  vi.mocked(prisma.salaryHistory.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.overtimeEntry.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.employeeLoan.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.employeeRecurringConcept.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.legalThreshold.count).mockResolvedValue(0 as never);
}

describe("PayrollRunService.getStaleSignals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sinCambios();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(RUN_BORRADOR as never);
  });

  it("un borrador sin cambios posteriores no está obsoleto", async () => {
    const r = await PayrollRunService.getStaleSignals("company-1", "run-1");
    expect(r).not.toBeNull();
    expect(r!.stale).toBe(false);
    expect(r!.signals).toHaveLength(0);
    expect(r!.calculatedAt).toBe(CALCULADO.toISOString());
  });

  it("detecta un aumento de sueldo registrado después del cálculo", async () => {
    vi.mocked(prisma.salaryHistory.count).mockResolvedValue(1 as never);
    const r = await PayrollRunService.getStaleSignals("company-1", "run-1");
    expect(r!.stale).toBe(true);
    expect(r!.signals[0].label).toContain("1 cambio de sueldo");
  });

  it("acumula varias señales y pluraliza con el número", async () => {
    vi.mocked(prisma.overtimeEntry.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.legalThreshold.count).mockResolvedValue(1 as never);
    const r = await PayrollRunService.getStaleSignals("company-1", "run-1");
    expect(r!.signals).toHaveLength(2);
    expect(r!.signals.map((s) => s.label).join(" | ")).toContain("3 registros de horas extra");
    expect(r!.signals.map((s) => s.label).join(" | ")).toContain("1 tope legal actualizado");
  });

  it("sólo mira las horas extra DEL PERÍODO y aún sin pagar", async () => {
    await PayrollRunService.getStaleSignals("company-1", "run-1");
    const where = vi.mocked(prisma.overtimeEntry.count).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.payrollRunId).toBeNull();
    expect(where.workedOn).toEqual({ gte: RUN_BORRADOR.periodStart, lte: RUN_BORRADOR.periodEnd });
    expect(where.companyId).toBe("company-1");
  });

  it("consulta sólo a los trabajadores de ESTE proceso, sin repetirlos", async () => {
    await PayrollRunService.getStaleSignals("company-1", "run-1");
    const where = vi.mocked(prisma.salaryHistory.count).mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.employeeId).toEqual({ in: ["emp-1", "emp-2"] });
  });

  it("un proceso APROBADO no produce aviso: el asiento ya existe", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...RUN_BORRADOR, status: "APPROVED",
    } as never);
    expect(await PayrollRunService.getStaleSignals("company-1", "run-1")).toBeNull();
  });

  it("un proceso de otra empresa no existe para esta (IDOR guard)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    expect(await PayrollRunService.getStaleSignals("company-1", "run-ajeno")).toBeNull();
    const where = vi.mocked(prisma.payrollRun.findFirst).mock.calls[0][0]!.where;
    expect(where).toEqual({ id: "run-ajeno", companyId: "company-1" });
  });
});
