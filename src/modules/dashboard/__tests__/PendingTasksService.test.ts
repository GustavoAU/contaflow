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
    order: { count: vi.fn() },           // GAP-02
    inventoryItem: { count: vi.fn() },   // PC-03
    company: { findFirst: vi.fn() },     // ADR-030 audit: isSpecialContributor
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
  vi.mocked(prisma.order.count).mockResolvedValue(0 as never);           // GAP-02
  vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0 as never);   // PC-03
  vi.mocked(prisma.company.findFirst).mockResolvedValue(null as never);  // no CE por defecto
  // $queryRaw se usa 2 veces: stockBajo (raw SQL) e igtfPagosSinRegistrar (raw SQL)
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
    // 1ª llamada = PENDING/sin factura (SIN_VINCULAR); 2ª = ISSUED (POR_ENTERAR) → 0
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(5 as never);
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

  it("detecta órdenes con fecha vencida (ORDENES_VENCIDAS) — GAP-02 — severity warning", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(2 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].type).toBe("ORDENES_VENCIDAS");
    expect(result.tasks[0].severity).toBe("warning");
    expect(result.tasks[0].href).toBe("/orders");
    expect(result.tasks[0].count).toBe(2);
  });

  it("detecta retenciones emitidas sin enterar (RETENCIONES_POR_ENTERAR) — OM-06 — severity error", async () => {
    // 1ª llamada = PENDING/sin factura → 0; 2ª llamada = ISSUED (POR_ENTERAR) → 4
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(0 as never).mockResolvedValueOnce(4 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "RETENCIONES_POR_ENTERAR");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(4);
    expect(task?.href).toBe("/retentions");
    expect(task?.description).toContain("200%");
  });

  it("RETENCIONES_POR_ENTERAR filtra status ISSUED y deletedAt null", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
    await PendingTasksService.getPendingTasks("company-1");
    const calls = vi.mocked(prisma.retencion.count).mock.calls;
    // 2ª llamada debe tener status: "ISSUED"
    expect(calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({ status: "ISSUED", deletedAt: null }),
    });
  });

  it("ORDENES_VENCIDAS filtra solo DRAFT y APPROVED con expectedDate < now", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(1 as never);
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.order.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "APPROVED"] },
          expectedDate: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });

  it("acumula múltiples tareas y suma totalCount correctamente", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(2 as never);
    // 1ª llamada = PENDING/sin factura; 2ª llamada = ISSUED → 0
    vi.mocked(prisma.retencion.count).mockResolvedValueOnce(3 as never);
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

  // PC-03: productos físicos sin cuentas GL
  it("detecta ítems físicos sin cuenta GL (INVENTARIO_SIN_CUENTAS_GL) — severity error", async () => {
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(3 as never);
    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "INVENTARIO_SIN_CUENTAS_GL");
    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(3);
    expect(task?.href).toBe("/inventory");
    expect(task?.description).toContain("COGS");
  });

  it("INVENTARIO_SIN_CUENTAS_GL filtra solo ítems físicos con OR accountId/cogsAccountId null", async () => {
    await PendingTasksService.getPendingTasks("company-1");
    expect(vi.mocked(prisma.inventoryItem.count)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          itemType: { in: ["GOODS", "RAW_MATERIAL", "FINISHED_GOOD"] },
          OR: expect.arrayContaining([
            { accountId: null },
            { cogsAccountId: null },
          ]),
        }),
      }),
    );
  });

  it("no emite INVENTARIO_SIN_CUENTAS_GL cuando todos los productos tienen cuentas GL", async () => {
    // mockAllZero ya pone inventoryItem.count = 0
    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "INVENTARIO_SIN_CUENTAS_GL")).toBeUndefined();
  });

  // ADR-030 audit: IGTF_PAGOS_SIN_REGISTRAR — solo para Contribuyentes Especiales
  it("detecta cobros en divisa sin IGTF para CE (IGTF_PAGOS_SIN_REGISTRAR) — severity error", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: true } as never);
    // 1ª llamada $queryRaw = stockBajo (0), 2ª = igtfPagosSinRegistrar (5)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(5) }] as never);

    const result = await PendingTasksService.getPendingTasks("company-1");
    const task = result.tasks.find((t) => t.type === "IGTF_PAGOS_SIN_REGISTRAR");

    expect(task).toBeDefined();
    expect(task?.severity).toBe("error");
    expect(task?.count).toBe(5);
    expect(task?.href).toBe("/payments");
    expect(task?.description).toContain("IGTF");
    expect(task?.description).toContain("3%");
  });

  it("NO emite IGTF_PAGOS_SIN_REGISTRAR para empresa no CE aunque haya pagos en divisa", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ isSpecialContributor: false } as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)
      .mockResolvedValueOnce([{ count: BigInt(10) }] as never); // 10 pagos sin IGTF — no CE → no alert

    const result = await PendingTasksService.getPendingTasks("company-1");
    expect(result.tasks.find((t) => t.type === "IGTF_PAGOS_SIN_REGISTRAR")).toBeUndefined();
  });
});
