// src/modules/analytics/__tests__/KpiDashboardService.test.ts
// MEDIUM-01 follow-up: el service agrega en BD (groupBy) en vez de cargar filas.
// Los tests emulan el groupBy de Postgres sobre fixtures para seguir verificando
// la clasificación por ventanas de dueDate de punta a punta.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { KpiDashboardService } from "../services/KpiDashboardService";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

const COMPANY_ID = "company-abc";
const now = new Date("2026-04-14T12:00:00Z");

type InvoiceFixture = {
  type: "SALE" | "PURCHASE";
  dueDate?: Date | null;
  pendingAmount: string | null;
};

/**
 * Emula `invoice.groupBy(by: ["type"], _sum: { pendingAmount })` de Postgres:
 * filtra por el rango de dueDate del `where` (gte/gt/lte), agrupa por type y
 * suma pendingAmount (NULLs ignorados en la suma, como SUM() en SQL).
 */
function emulateGroupBy(rows: InvoiceFixture[]) {
  vi.mocked(prisma.invoice.groupBy).mockImplementation(((args: {
    where: { dueDate?: { gte?: Date; gt?: Date; lte?: Date } };
  }) => {
    const range = args.where.dueDate;
    const inWindow = rows.filter((f) => {
      if (range) {
        if (!f.dueDate) return false; // rango sobre columna NULL → excluida
        if (range.gte && f.dueDate < range.gte) return false;
        if (range.gt && f.dueDate <= range.gt) return false;
        if (range.lte && f.dueDate > range.lte) return false;
      }
      return true;
    });
    const byType = new Map<string, Decimal | null>();
    for (const f of inWindow) {
      const prev = byType.get(f.type);
      if (f.pendingAmount == null) {
        if (prev === undefined) byType.set(f.type, null); // SUM de solo NULLs = NULL
        continue;
      }
      byType.set(f.type, (prev ?? new Decimal(0)).plus(f.pendingAmount));
    }
    return Promise.resolve(
      [...byType.entries()].map(([type, sum]) => ({
        type,
        _sum: { pendingAmount: sum === null ? null : sum.toString() },
      })),
    );
  }) as never);
}

describe("KpiDashboardService.getKpiSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    emulateGroupBy([]);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna ceros cuando no hay facturas", async () => {
    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("0.00");
    expect(r.cxpTotal).toBe("0.00");
    expect(r.workingCapital).toBe("0.00");
    expect(r.dso).toBeNull();
  });

  it("separa CxC (SALE) y CxP (PURCHASE) correctamente", async () => {
    emulateGroupBy([
      { type: "SALE", pendingAmount: "1000.00" },
      { type: "PURCHASE", pendingAmount: "400.00" },
    ]);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("1000.00");
    expect(r.cxpTotal).toBe("400.00");
    expect(r.workingCapital).toBe("600.00");
  });

  it("suma múltiples facturas del mismo tipo en BD (groupBy)", async () => {
    emulateGroupBy([
      { type: "SALE", pendingAmount: "600.00" },
      { type: "SALE", pendingAmount: "400.00" },
    ]);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("1000.00");
  });

  it("capital de trabajo negativo cuando CxP > CxC", async () => {
    emulateGroupBy([
      { type: "SALE", pendingAmount: "200.00" },
      { type: "PURCHASE", pendingAmount: "500.00" },
    ]);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.workingCapital).toBe("-300.00");
  });

  it("calcula DSO = (CxC / ventas_30d) × 30 redondeado", async () => {
    emulateGroupBy([{ type: "SALE", pendingAmount: "600.00" }]);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: "1000.00" },
    } as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    // DSO = (600 / 1000) × 30 = 18
    expect(r.dso).toBe(18);
  });

  it("DSO es null si no hay ventas en últimos 30 días", async () => {
    emulateGroupBy([{ type: "SALE", pendingAmount: "500.00" }]);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.dso).toBeNull();
  });

  it("ignora sumas NULL (grupo sin pendingAmount)", async () => {
    emulateGroupBy([
      { type: "SALE", pendingAmount: null },
      { type: "PURCHASE", pendingAmount: null },
    ]);

    const r = await KpiDashboardService.getKpiSummary(COMPANY_ID);
    expect(r.cxcTotal).toBe("0.00");
    expect(r.cxpTotal).toBe("0.00");
  });
});

describe("KpiDashboardService.getCashFlowProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    emulateGroupBy([]);
    vi.mocked(prisma.invoice.aggregate).mockResolvedValue({
      _sum: { totalAmountVes: null },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna 3 buckets con ceros cuando no hay facturas", async () => {
    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r).toHaveLength(3);
    expect(r[0]!.label).toBe("0-30d");
    expect(r[1]!.label).toBe("31-60d");
    expect(r[2]!.label).toBe("61-90d");
    r.forEach((b) => {
      expect(b.collections).toBe("0.00");
      expect(b.payments).toBe("0.00");
      expect(b.net).toBe("0.00");
    });
    // Una consulta agregada por ventana — no se cargan filas individuales
    expect(prisma.invoice.groupBy).toHaveBeenCalledTimes(3);
  });

  it("clasifica cobros en el bucket correcto (vence en 15 días → 0-30d)", async () => {
    const due15 = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    emulateGroupBy([{ type: "SALE", dueDate: due15, pendingAmount: "800.00" }]);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.collections).toBe("800.00");
    expect(r[0]!.net).toBe("800.00");
    expect(r[1]!.collections).toBe("0.00");
  });

  it("clasifica pagos en bucket 31-60d correctamente", async () => {
    const due45 = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    emulateGroupBy([{ type: "PURCHASE", dueDate: due45, pendingAmount: "300.00" }]);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[1]!.payments).toBe("300.00");
    expect(r[1]!.net).toBe("-300.00");
    expect(r[0]!.payments).toBe("0.00");
  });

  it("límite exacto: vence en 30 días exactos → 0-30d (ceil ≤ 30 ⇔ due ≤ hoy+30d)", async () => {
    // El service trunca `now` a medianoche UTC → el límite exacto es T0+30d
    const due30 = new Date("2026-05-14T00:00:00.000Z");
    emulateGroupBy([{ type: "SALE", dueDate: due30, pendingAmount: "100.00" }]);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.collections).toBe("100.00");
    expect(r[1]!.collections).toBe("0.00");
  });

  it("net negativo cuando pagos > cobros en misma ventana", async () => {
    const due10 = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    emulateGroupBy([
      { type: "SALE", dueDate: due10, pendingAmount: "100.00" },
      { type: "PURCHASE", dueDate: due10, pendingAmount: "250.00" },
    ]);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.net).toBe("-150.00");
  });

  it("excluye facturas sin dueDate (rango sobre NULL) e ignora sumas NULL", async () => {
    emulateGroupBy([
      { type: "SALE", dueDate: null, pendingAmount: "500.00" },
      {
        type: "SALE",
        dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
        pendingAmount: null,
      },
    ]);

    const r = await KpiDashboardService.getCashFlowProjection(COMPANY_ID);
    expect(r[0]!.collections).toBe("0.00");
  });
});
