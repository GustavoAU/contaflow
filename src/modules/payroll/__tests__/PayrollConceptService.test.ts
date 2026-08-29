// src/modules/payroll/__tests__/PayrollConceptService.test.ts
// Tests: NOM-B PayrollConceptService — CRUD + seedDefaults + system guard
// NOM-C-15: create/update/delete ahora usan $transaction + AuditLog

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollConcept: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { PayrollConceptService, SYSTEM_CONCEPTS } from "../services/PayrollConceptService";

// Las filas tal como quedarian en la BD tras un seed correcto. Se derivan de la
// misma constante que usa el servicio: lo que se comprueba aqui es la logica de
// deteccion de diferencias, no los valores legales (esos los fijan los tests del
// calculador y las Gacetas citadas en el propio servicio).
const SYSTEM_CONCEPTS_ROWS = SYSTEM_CONCEPTS.map((c, i) => ({
  id: `sys-${i}`,
  code: c.code,
  isSystem: true,
  affectsSalaryIntegral: c.affectsSalaryIntegral,
  salaryNature: c.salaryNature,
}));

const COMPANY_ID = "company-test";
const USER_ID = "user-1";

const BASE_CONCEPT = {
  id: "concept-1",
  companyId: COMPANY_ID,
  code: "SAL_BASE",
  name: "Salario Básico",
  type: "EARNING" as const,
  isSystem: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Helper: simula $transaction pasando las mismas instancias mockeadas
function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PayrollConceptService.list", () => {
  it("returns all concepts for a company", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([BASE_CONCEPT] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("SAL_BASE");
    expect(vi.mocked(prisma.payrollConcept.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });

  it("returns empty array when no concepts", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toHaveLength(0);
  });
});

describe("PayrollConceptService.seedDefaults", () => {
  // D3: antes reescribia los 18 conceptos con upsert en CADA llamada —y se
  // llama desde rutas de lectura—, tocando tres campos con incidencia fiscal
  // sin dejar rastro. Ahora lee primero y solo escribe lo que de verdad esta mal.

  function existentes(rows: unknown[]) {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.payrollConcept.create).mockResolvedValue(BASE_CONCEPT as never);
    vi.mocked(prisma.payrollConcept.update).mockResolvedValue(BASE_CONCEPT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockTx();
  }

  it("crea los 18 conceptos del sistema cuando no existe ninguno", async () => {
    existentes([]);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    // 11 originales + 4 aportes patronales (F-03) + 3 de la auditoria 2026-06-02
    expect(vi.mocked(prisma.payrollConcept.create)).toHaveBeenCalledTimes(18);
    const codes = vi.mocked(prisma.payrollConcept.create).mock.calls
      .map((c) => (c[0].data as { code: string }).code);
    // Sin SAL_BASE la nomina no tiene ingresos.
    expect(codes).toContain("SAL_BASE");
  });

  it("con todo en orden NO escribe nada", async () => {
    // El caso normal: seedDefaults corre en cada calculo de nomina y al abrir la
    // lista de conceptos. Reescribir 18 filas cada vez era trabajo y riesgo de
    // balde.
    existentes(SYSTEM_CONCEPTS_ROWS);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    expect(vi.mocked(prisma.payrollConcept.create)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.payrollConcept.update)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).not.toHaveBeenCalled();
  });

  // El motor de nomina carga los conceptos con `where: { isSystem: true }`. Una
  // fila de SYSTEM_CONCEPTS marcada como false es INVISIBLE para el: si le pasa
  // a SAL_BASE, la nomina no genera linea de salario y el neto sale negativo.
  // Precedente medido: seed-demo-tesa.ts creo SAL_BASE con isSystem:false y la
  // nomina de esa empresa no podia calcularse (2026-08-23).
  it("REPARA isSystem en filas ya existentes y lo deja en el AuditLog", async () => {
    const rotas = SYSTEM_CONCEPTS_ROWS.map((r) =>
      r.code === "SAL_BASE" ? { ...r, isSystem: false } : r,
    );
    existentes(rotas);
    await PayrollConceptService.seedDefaults(COMPANY_ID);

    expect(vi.mocked(prisma.payrollConcept.update)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.payrollConcept.update).mock.calls[0][0].data)
      .toMatchObject({ isSystem: true });
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "REPAIR_SYSTEM_CONCEPTS" }),
      }),
    );
  });

  it("REPARA una salaryNature alterada — decide una cotizacion", async () => {
    const rotas = SYSTEM_CONCEPTS_ROWS.map((r) =>
      r.code === "SAL_BASE" ? { ...r, salaryNature: "NO_SALARIAL" } : r,
    );
    existentes(rotas);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    expect(vi.mocked(prisma.payrollConcept.update).mock.calls[0][0].data)
      .toMatchObject({ salaryNature: "SALARIO_NORMAL" });
  });
});

describe("PayrollConceptService.create", () => {
  it("creates a non-system concept and writes AuditLog", async () => {
    mockTx();
    const custom = { ...BASE_CONCEPT, id: "custom-1", code: "BONO_ESP", isSystem: false };
    vi.mocked(prisma.payrollConcept.create).mockResolvedValue(custom as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollConceptService.create(COMPANY_ID, USER_ID, {
      code: "BONO_ESP",
      name: "Bono Especial",
      type: "EARNING",
    });

    expect(result.code).toBe("BONO_ESP");
    expect(result.isSystem).toBe(false);
    expect(vi.mocked(prisma.payrollConcept.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isSystem: false }),
      })
    );
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE_PAYROLL_CONCEPT" }),
      })
    );
  });
});

describe("PayrollConceptService.update", () => {
  it("updates name and isActive with AuditLog", async () => {
    mockTx();
    // Concepto propio de la empresa: los del sistema no se pueden desactivar.
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue({
      ...BASE_CONCEPT, isSystem: false, code: "BONO_PROD",
    } as never);
    vi.mocked(prisma.payrollConcept.update).mockResolvedValue({
      ...BASE_CONCEPT,
      isSystem: false,
      name: "Salario Base Actualizado",
      isActive: false,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollConceptService.update(COMPANY_ID, USER_ID, "concept-1", {
      name: "Salario Base Actualizado",
      isActive: false,
    });

    expect(result.isActive).toBe(false);
    expect(result.name).toBe("Salario Base Actualizado");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "UPDATE_PAYROLL_CONCEPT" }),
      })
    );
  });

  it("throws when concept not found", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.update(COMPANY_ID, USER_ID, "nonexistent", { name: "X", isActive: true })
    ).rejects.toThrow("Concepto no encontrado");
  });
});

describe("PayrollConceptService.delete", () => {
  it("deletes non-system concept and writes AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue({
      ...BASE_CONCEPT,
      isSystem: false,
    } as never);
    vi.mocked(prisma.payrollConcept.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollConceptService.delete(COMPANY_ID, USER_ID, "concept-1");
    expect(vi.mocked(prisma.payrollConcept.delete)).toHaveBeenCalledWith({
      where: { id: "concept-1" },
    });
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE_PAYROLL_CONCEPT" }),
      })
    );
  });

  it("throws when trying to delete system concept", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, USER_ID, "concept-1")
    ).rejects.toThrow("Los conceptos del sistema no se pueden eliminar");
  });

  it("throws when concept not found", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, USER_ID, "nonexistent")
    ).rejects.toThrow("Concepto no encontrado");
  });
});

describe("PayrollConceptService.getSystemConcepts", () => {
  it("returns only active system concepts", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([BASE_CONCEPT] as never);
    const result = await PayrollConceptService.getSystemConcepts(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(vi.mocked(prisma.payrollConcept.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, isSystem: true, isActive: true },
      })
    );
  });
});

describe("PayrollConceptService.update — conceptos del sistema", () => {
  it("no deja desactivar un concepto legal del sistema", async () => {
    // El motor carga los conceptos con isActive:true. Desactivar SAL_BASE dejaba
    // la nomina sin ninguna linea de salario — el mismo estado catastrofico que
    // provocaba isSystem=false, por una puerta que no tenia guarda.
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);

    await expect(
      PayrollConceptService.update(COMPANY_ID, USER_ID, "concept-1", {
        name: "Salario Básico", isActive: false,
      })
    ).rejects.toThrow("no se pueden desactivar");

    expect(vi.mocked(prisma.payrollConcept.update)).not.toHaveBeenCalled();
  });

  it("si deja renombrarlo", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    vi.mocked(prisma.payrollConcept.update).mockResolvedValue({
      ...BASE_CONCEPT, name: "Sueldo Base",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const r = await PayrollConceptService.update(COMPANY_ID, USER_ID, "concept-1", {
      name: "Sueldo Base", isActive: true,
    });
    expect(r.name).toBe("Sueldo Base");
  });
});
