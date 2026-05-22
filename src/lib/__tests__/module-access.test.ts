// src/lib/__tests__/module-access.test.ts
// Tests: hasModuleAccess — fast paths + grant query

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    rolePermission: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";

const COMPANY_ID = "company-test";

describe("hasModuleAccess — fast paths (sin DB)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("OWNER siempre tiene acceso — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "OWNER", "invoicing");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("ADMIN siempre tiene acceso — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "ADMIN", "payroll");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT tiene acceso base a accounting — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "ACCOUNTANT", "accounting");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("ACCOUNTANT tiene acceso base a invoicing — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "ACCOUNTANT", "invoicing");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("ADMINISTRATIVE tiene acceso base a invoicing — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "ADMINISTRATIVE", "invoicing");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("ADMINISTRATIVE tiene acceso base a orders — no consulta DB", async () => {
    const result = await hasModuleAccess(COMPANY_ID, "ADMINISTRATIVE", "orders");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
  });
});

describe("hasModuleAccess — consulta grants (rol sin acceso base)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("VIEWER con grant explícito tiene acceso", async () => {
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue({ id: "grant-1" } as never);

    const result = await hasModuleAccess(COMPANY_ID, "VIEWER", "invoicing");
    expect(result).toBe(true);
    expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, role: "VIEWER", module: "invoicing" },
      select: { id: true },
    });
  });

  it("VIEWER sin grant no tiene acceso", async () => {
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null);

    const result = await hasModuleAccess(COMPANY_ID, "VIEWER", "invoicing");
    expect(result).toBe(false);
  });

  it("ADMINISTRATIVE sin acceso base a accounting — consulta grants", async () => {
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null);

    // ADMINISTRATIVE no tiene base access a accounting (solo OWNER/ADMIN/ACCOUNTANT)
    const result = await hasModuleAccess(COMPANY_ID, "ADMINISTRATIVE", "accounting");
    expect(result).toBe(false);
    expect(prisma.rolePermission.findFirst).toHaveBeenCalled();
  });

  it("ADMINISTRATIVE con grant a accounting tiene acceso", async () => {
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue({ id: "grant-2" } as never);

    const result = await hasModuleAccess(COMPANY_ID, "ADMINISTRATIVE", "accounting");
    expect(result).toBe(true);
  });

  it("VIEWER sin acceso base a payroll — consulta grants", async () => {
    vi.mocked(prisma.rolePermission.findFirst).mockResolvedValue(null);

    const result = await hasModuleAccess(COMPANY_ID, "VIEWER", "payroll");
    expect(result).toBe(false);
    expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: "VIEWER", module: "payroll" }) })
    );
  });
});

describe("moduleAccessError", () => {
  it("retorna mensaje con label del módulo en español", () => {
    expect(moduleAccessError("invoicing")).toContain("Facturación");
    expect(moduleAccessError("accounting")).toContain("Contabilidad");
    expect(moduleAccessError("payroll")).toContain("Nómina");
    expect(moduleAccessError("inventory")).toContain("Inventario");
  });

  it("incluye instrucción de contactar administrador", () => {
    const msg = moduleAccessError("orders");
    expect(msg).toContain("administrador");
  });
});
