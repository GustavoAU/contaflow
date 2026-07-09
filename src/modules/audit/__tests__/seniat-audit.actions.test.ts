// src/modules/audit/__tests__/seniat-audit.actions.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    paymentRecord: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import {
  getInvoiceAuditReportAction,
  getCashAuditReportAction,
} from "../actions/seniat-audit.actions";

const COMPANY_ID = "company-abc";

const adminMember = { role: "ADMIN" };

describe("getInvoiceAuditReportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(adminMember as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
  });

  it("ADMIN recibe informe de facturas vacío", async () => {
    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.entries).toHaveLength(0);
      expect(r.data.total).toBe(0);
      expect(r.data.page).toBe(1);
    }
  });

  it("rol SENIAT recibe informe de facturas", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "SENIAT" } as never);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna error no autorizado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("ACCOUNTANT es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("mapea facturas a InvoiceAuditEntry correctamente", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        invoiceNumber: "F-0001",
        controlNumber: "00-12345678",
        type: "SALE",
        date: new Date("2026-01-15T00:00:00Z"),
        counterpartName: "Cliente S.A.",
        counterpartRif: "J-12345678-9",
        currency: "VES",
        totalAmountVes: "100.00",
        deletedAt: null,
        seniatSubmission: { status: "SENT", sentAt: new Date("2026-01-16T00:00:00Z") },
      },
    ] as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      const entry = r.data.entries[0]!;
      expect(entry.invoiceNumber).toBe("F-0001");
      expect(entry.status).toBe("VIGENTE");
      expect(entry.submissionStatus).toBe("SENT");
      expect(entry.date).toBe("2026-01-15");
    }
  });

  it("factura anulada tiene status ANULADA", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        invoiceNumber: "F-0002",
        controlNumber: null,
        type: "SALE",
        date: new Date("2026-02-01T00:00:00Z"),
        counterpartName: null,
        counterpartRif: null,
        currency: "USD",
        totalAmountVes: null,
        deletedAt: new Date("2026-02-05T00:00:00Z"),
        seniatSubmission: null,
      },
    ] as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(1 as never);

    const r = await getInvoiceAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.entries[0]!.status).toBe("ANULADA");
      expect(r.data.entries[0]!.totalAmount).toBe("0");
    }
  });
});

describe("getCashAuditReportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(adminMember as never);
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.paymentRecord.count).mockResolvedValue(0 as never);
  });

  it("ADMIN recibe informe de caja vacío", async () => {
    const r = await getCashAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.entries).toHaveLength(0);
      expect(r.data.total).toBe(0);
    }
  });

  it("sin autorización retorna error", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const r = await getCashAuditReportAction(COMPANY_ID);
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("mapea pagos a CashAuditEntry correctamente", async () => {
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([
      {
        date: new Date("2026-03-10T00:00:00Z"),
        notes: "Pago cliente",
        amountVes: "500.00",
        currency: "VES",
        method: "TRANSFERENCIA",
      },
    ] as never);
    vi.mocked(prisma.paymentRecord.count).mockResolvedValue(1 as never);

    const r = await getCashAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) {
      const entry = r.data.entries[0]!;
      expect(entry.date).toBe("2026-03-10");
      expect(entry.description).toBe("Pago cliente");
      expect(entry.amount).toBe("500.00");
      expect(entry.paymentMethod).toBe("TRANSFERENCIA");
    }
  });

  it("usa 'Pago' como descripción cuando notes es null", async () => {
    vi.mocked(prisma.paymentRecord.findMany).mockResolvedValue([
      {
        date: new Date("2026-03-11T00:00:00Z"),
        notes: null,
        amountVes: "200.00",
        currency: "USD",
        method: "EFECTIVO",
      },
    ] as never);
    vi.mocked(prisma.paymentRecord.count).mockResolvedValue(1 as never);

    const r = await getCashAuditReportAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entries[0]!.description).toBe("Pago");
  });
});
