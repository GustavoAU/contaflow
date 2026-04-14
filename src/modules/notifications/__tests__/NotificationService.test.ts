// src/modules/notifications/__tests__/NotificationService.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "@/lib/prisma";
import { NotificationService } from "../services/NotificationService";

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findMany: vi.fn() },
    retencion: { count: vi.fn() },
    inventoryMovement: { count: vi.fn() },
  },
}));

const COMPANY_ID = "company-abc";
const now = new Date("2026-04-14T12:00:00Z");

function makeInvoice(overrides: object = {}) {
  return {
    id: "inv-1",
    invoiceNumber: "F-0001",
    dueDate: new Date("2026-04-10T00:00:00Z"), // vencida
    ...overrides,
  };
}

describe("NotificationService.getAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Defaults vacíos
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValue(0 as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna array vacío si no hay alertas", async () => {
    const alerts = await NotificationService.getAlerts(COMPANY_ID);
    expect(alerts).toEqual([]);
  });

  it("genera alerta error para factura vencida", async () => {
    // Primera llamada (overdue) devuelve 1 factura; segunda (due soon) vacío
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([makeInvoice()] as never)
      .mockResolvedValueOnce([] as never);

    const alerts = await NotificationService.getAlerts(COMPANY_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("INVOICE_OVERDUE");
    expect(alerts[0]!.severity).toBe("error");
    expect(alerts[0]!.title).toContain("F-0001");
  });

  it("genera alerta warning para factura por vencer en 3 días", async () => {
    const dueSoon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([makeInvoice({ dueDate: dueSoon })] as never);

    const alerts = await NotificationService.getAlerts(COMPANY_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("INVOICE_DUE_SOON");
    expect(alerts[0]!.severity).toBe("warning");
    expect(alerts[0]!.description).toContain("3 días");
  });

  it("genera alerta warning para retenciones PENDING", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(3 as never);

    const alerts = await NotificationService.getAlerts(COMPANY_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("RETENCIONES_PENDING");
    expect(alerts[0]!.severity).toBe("warning");
    expect(alerts[0]!.title).toContain("3 retenciones");
  });

  it("genera alerta info para movimientos DRAFT de inventario", async () => {
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValue(5 as never);

    const alerts = await NotificationService.getAlerts(COMPANY_ID);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.type).toBe("INVENTORY_DRAFTS");
    expect(alerts[0]!.severity).toBe("info");
    expect(alerts[0]!.title).toContain("5 movimientos");
  });

  it("ordena: error primero, warning segundo, info último", async () => {
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([makeInvoice()] as never) // overdue → error
      .mockResolvedValueOnce([makeInvoice({ id: "inv-2", dueDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000) })] as never); // due soon → warning
    vi.mocked(prisma.retencion.count).mockResolvedValue(1 as never);  // → warning
    vi.mocked(prisma.inventoryMovement.count).mockResolvedValue(2 as never); // → info

    const alerts = await NotificationService.getAlerts(COMPANY_ID);

    expect(alerts[0]!.severity).toBe("error");
    const lastIdx = alerts.length - 1;
    expect(alerts[lastIdx]!.severity).toBe("info");
  });

  it("singular en retención cuando count = 1", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(1 as never);
    const alerts = await NotificationService.getAlerts(COMPANY_ID);
    expect(alerts[0]!.title).toContain("1 retención");
    expect(alerts[0]!.title).not.toContain("retenciones");
  });

  it("href apunta al módulo correcto de la empresa", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(1 as never);
    const alerts = await NotificationService.getAlerts(COMPANY_ID);
    expect(alerts[0]!.href).toContain(`/company/${COMPANY_ID}/retentions`);
  });

  it("no genera alerta si retenciones count = 0", async () => {
    vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
    const alerts = await NotificationService.getAlerts(COMPANY_ID);
    expect(alerts.filter((a) => a.type === "RETENCIONES_PENDING")).toHaveLength(0);
  });
});
