// src/modules/payroll/__tests__/PayrollBankTxtService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollRun: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { PayrollBankTxtService } from "../services/PayrollBankTxtService";

const COMPANY_ID = "company-1";
const RUN_ID = "run-1";

const PERIOD_START = new Date("2026-04-01");
const PERIOD_END   = new Date("2026-04-15");

function makeRun(lines: object[]) {
  return { periodStart: PERIOD_START, periodEnd: PERIOD_END, lines };
}

function makeLine(
  employeeId: string,
  conceptType: "EARNING" | "DEDUCTION",
  amount: string,
  emp: { firstName: string; lastName: string; cedulaType: string; cedulaNumber: string; bankName: string | null; bankAccount: string | null },
) {
  return { employeeId, conceptType, amount: { toString: () => amount }, employee: emp };
}

const EMP_A = { firstName: "JUAN", lastName: "PEREZ", cedulaType: "V", cedulaNumber: "12345678", bankName: "BANESCO", bankAccount: "01340100001234567890" };
const EMP_B = { firstName: "MARIA", lastName: "GARCIA", cedulaType: "V", cedulaNumber: "87654321", bankName: null, bankAccount: null };

describe("PayrollBankTxtService.generate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lanza error si el run no existe", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null);

    await expect(PayrollBankTxtService.generate(COMPANY_ID, RUN_ID)).rejects.toThrow(
      "Proceso de nómina no encontrado",
    );
  });

  it("calcula neto correctamente (asignaciones - deducciones)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING",   "1500.00", EMP_A),
      makeLine("emp-1", "DEDUCTION",  "300.00", EMP_A),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].monto).toBe("1200.00");
    expect(result.totalAmount).toBe("1200.00");
  });

  it("genera fila correcta con datos bancarios completos", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING", "2000.00", EMP_A),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);
    const row = result.rows[0];

    expect(row.cedula).toBe("V-12345678");
    expect(row.nombre).toBe("JUAN PEREZ");
    expect(row.banco).toBe("BANESCO");
    expect(row.cuenta).toBe("01340100001234567890");
    expect(row.missingBankInfo).toBe(false);
  });

  it("marca missingBankInfo y usa placeholder cuando faltan datos bancarios", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-2", "EARNING", "1000.00", EMP_B),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);
    const row = result.rows[0];

    expect(row.missingBankInfo).toBe(true);
    expect(row.banco).toBe("SIN BANCO");
    expect(row.cuenta).toBe("SIN CUENTA");
    expect(result.warningCount).toBe(1);
  });

  it("incluye AVISO en el TXT cuando hay empleados sin datos bancarios", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-2", "EARNING", "1000.00", EMP_B),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);

    expect(result.txt).toContain("AVISO");
    expect(result.txt).toContain("sin datos bancarios");
  });

  it("NO incluye AVISO en el TXT cuando todos tienen datos bancarios", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING", "2000.00", EMP_A),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);

    expect(result.txt).not.toContain("AVISO");
    expect(result.warningCount).toBe(0);
  });

  it("genera encabezado y línea de datos correctamente", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING", "1500.00", EMP_A),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);
    const lines = result.txt.split("\n");

    expect(lines[0]).toContain("NOMINA ContaFlow");
    expect(lines[0]).toContain("2026-04-01");
    expect(lines[0]).toContain("2026-04-15");
    expect(lines).toContain("CEDULA|NOMBRE|BANCO|CUENTA|MONTO");
    expect(lines.some((l) => l.startsWith("V-12345678|"))).toBe(true);
  });

  it("acumula múltiples conceptos del mismo empleado correctamente", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING",   "2000.00", EMP_A),
      makeLine("emp-1", "EARNING",    "500.00", EMP_A), // bono
      makeLine("emp-1", "DEDUCTION",  "200.00", EMP_A), // IVSS
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].monto).toBe("2300.00");
  });

  it("calcula total correcto con múltiples empleados", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(makeRun([
      makeLine("emp-1", "EARNING", "1000.00", EMP_A),
      makeLine("emp-2", "EARNING",  "800.00", EMP_B),
    ]) as never);

    const result = await PayrollBankTxtService.generate(COMPANY_ID, RUN_ID);

    expect(result.totalEmployees).toBe(2);
    expect(result.totalAmount).toBe("1800.00");
  });
});
