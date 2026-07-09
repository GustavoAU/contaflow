// src/modules/inventory/__tests__/inventory-reports.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    inventoryItem: { findMany: vi.fn() },
    inventoryMovement: { findMany: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const COMPANY_ID = "company-test";

import {
  getStockSummaryAction,
  getMovementReportAction,
} from "../actions/inventory-reports.actions";
import { auth } from "@clerk/nextjs/server";

const mockItem = {
  id: "item-1",
  sku: "MED-001",
  name: "Acetaminofén",
  unit: "caja",
  stockQuantity: { toString: () => "50" },
  averageCost: { toString: () => "5.50" },
  minimumStock: null,
};

const mockMovement = {
  id: "mov-1",
  date: new Date("2026-04-01T10:00:00Z"),
  type: "ENTRADA",
  status: "POSTED",
  quantity: { toString: () => "50" },
  unitCost: { toString: () => "5.50" },
  totalCost: { toString: () => "275" },
  reference: "OC-001",
  notes: null,
  invoiceId: null,
  item: { id: "item-1", sku: "MED-001", name: "Acetaminofén", unit: "caja" },
};

// ─── getStockSummaryAction ────────────────────────────────────────────────────

describe("getStockSummaryAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([mockItem] as never);
  });

  it("ACCOUNTANT obtiene resumen de existencias", async () => {
    const r = await getStockSummaryAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items).toHaveLength(1);
      expect(r.data.items[0]!.sku).toBe("MED-001");
      expect(r.data.totalInventoryValue).toBe("275.00");
    }
  });

  it("OWNER obtiene resumen (ACCOUNTING includes OWNER)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    const r = await getStockSummaryAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("ADMINISTRATIVE es rechazado (no es ACCOUNTING)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMINISTRATIVE" } as never);
    const r = await getStockSummaryAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("sin userId retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getStockSummaryAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await getStockSummaryAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});

// ─── getMovementReportAction ──────────────────────────────────────────────────

describe("getMovementReportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([mockMovement] as never);
  });

  it("ACCOUNTANT obtiene movimientos en rango", async () => {
    const r = await getMovementReportAction(COMPANY_ID, "2026-04-01", "2026-04-30");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.type).toBe("ENTRADA");
      expect(r.data[0]!.date).toBe("2026-04-01");
    }
  });

  it("fecha inválida retorna error", async () => {
    const r = await getMovementReportAction(COMPANY_ID, "not-a-date", "2026-04-30");
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toBe("Fechas inválidas");
  });

  it("from > to retorna error", async () => {
    const r = await getMovementReportAction(COMPANY_ID, "2026-04-30", "2026-04-01");
    expect(r.success).toBe(false);
    expect((r as { success: false; error: string }).error).toContain("fecha inicial");
  });

  it("sin userId retorna no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getMovementReportAction(COMPANY_ID, "2026-04-01", "2026-04-30");
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getMovementReportAction(COMPANY_ID, "2026-04-01", "2026-04-30");
    expect(r.success).toBe(false);
  });

  it("retorna array vacío si no hay movimientos en el período", async () => {
    vi.mocked(prisma.inventoryMovement.findMany).mockResolvedValue([] as never);
    const r = await getMovementReportAction(COMPANY_ID, "2026-04-01", "2026-04-30");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(0);
  });
});
