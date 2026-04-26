// src/modules/dashboard/__tests__/PendingTasksService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PendingTasksService } from "../services/PendingTasksService";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { count: vi.fn() },
    accountingPeriod: { count: vi.fn() },
    fixedAsset: { count: vi.fn() },
    retencion: { count: vi.fn() },
    bankStatement: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";

function mockAllZero() {
  vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.accountingPeriod.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.fixedAsset.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.bankStatement.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: BigInt(0) }] as never);
}

describe("PendingTasksService.getPendingTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllZero();
  });

  it("retorna tareas vacías cuando todo está limpio", async () => {
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("detecta facturas sin asiento contable (INVOICES_SIN_CAUSAR) — severity error", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(3 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("INVOICES_SIN_CAUSAR");
    expect(result.tasks[0].severity).toBe("error");
    expect(result.tasks[0].count).toBe(3);
    expect(result.tasks[0].href).toBe("/invoices");
    expect(result.totalCount).toBe(3);
  });

  it("detecta período contable abierto > 30 días (PERIODO_ABIERTO_VIEJO) — severity warning", async () => {
    vi.mocked(prisma.accountingPeriod.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("PERIODO_ABIERTO_VIEJO");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/settings");
  });

  it("detecta activos fijos sin depreciar este mes (ACTIVOS_SIN_DEPRECIAR) — severity warning", async () => {
    vi.mocked(prisma.fixedAsset.count).mockResolvedValue(2 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("ACTIVOS_SIN_DEPRECIAR");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/fixed-assets");
    expect(result.tasks[0].count).toBe(2);
  });

  it("detecta retenciones sin vincular (RETENCIONES_SIN_VINCULAR) — severity warning", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(5 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("RETENCIONES_SIN_VINCULAR");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/retentions");
    expect(result.tasks[0].count).toBe(5);
  });

  it("detecta extractos bancarios sin conciliar > 30 días (EXTRACTO_SIN_CONCILIAR) — severity info", async () => {
    vi.mocked(prisma.bankStatement.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("EXTRACTO_SIN_CONCILIAR");
    expect(result.tasks[0].severity).toBe("info");
    expect(result.tasks[0].href).toBe("/bank-reconciliation");
  });

  it("acumula múltiples tareas y suma totalCount correctamente", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.retencion.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.bankStatement.count).mockResolvedValue(1 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(3);
    expect(result.totalCount).toBe(6); // 2 + 3 + 1
  });

  it("pasa companyId a todas las queries (ownership scoping)", async () => {
    await PendingTasksService.getPendingTasks("company-abc");
    expect(vi.mocked(prisma.invoice.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
    expect(vi.mocked(prisma.retencion.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
    expect(vi.mocked(prisma.fixedAsset.count)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-abc" }) }),
    );
  });

  it("filtra invoices con deletedAt: null y transactionId: null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.invoice.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transactionId: null,
          deletedAt: null,
          type: { in: ["SALE", "PURCHASE"] },
        }),
      }),
    );
  });

  it("filtra retenciones con status PENDING e invoiceId null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.retencion.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoiceId: null,
          deletedAt: null,
          status: "PENDING",
        }),
      }),
    );
  });
});
