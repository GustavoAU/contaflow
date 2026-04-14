// src/modules/invoices/__tests__/invoice-ncnd.actions.test.ts
// Tests para searchInvoicesForPickerAction y getCreditDebitNotesAction

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const COMPANY_ID = "company-abc";

import {
  searchInvoicesForPickerAction,
  getCreditDebitNotesAction,
} from "../actions/invoice.actions";
import { auth } from "@clerk/nextjs/server";

const mockInvoice = {
  id: "inv-1",
  invoiceNumber: "F-0001",
  counterpartName: "Cliente X",
  totalAmountVes: { toString: () => "1000.00" },
  date: new Date("2026-04-01T00:00:00Z"),
};

describe("searchInvoicesForPickerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([mockInvoice] as never);
  });

  it("ACCOUNTANT recibe facturas", async () => {
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.invoiceNumber).toBe("F-0001");
      expect(r.data[0]!.date).toBe("2026-04-01");
    }
  });

  it("ADMINISTRATIVE recibe facturas (WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMINISTRATIVE" } as never);
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "");
    expect(r.success).toBe(true);
  });

  it("VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "");
    expect(r.success).toBe(false);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "");
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("sin membresía retorna acceso denegado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "test");
    expect(r.success).toBe(false);
  });

  it("normaliza totalAmountVes null", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { ...mockInvoice, totalAmountVes: null },
    ] as never);
    const r = await searchInvoicesForPickerAction(COMPANY_ID, "SALE", "");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[0]!.totalAmountVes).toBeNull();
  });
});

describe("getCreditDebitNotesAction", () => {
  const mockNote = {
    id: "nc-1",
    invoiceNumber: "NC-0001",
    docType: "NOTA_CREDITO",
    date: new Date("2026-04-05T00:00:00Z"),
    counterpartName: "Cliente X",
    totalAmountVes: { toString: () => "200.00" },
    paymentStatus: "UNPAID",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([mockNote] as never);
  });

  it("ACCOUNTANT recibe notas vinculadas", async () => {
    const r = await getCreditDebitNotesAction(COMPANY_ID, "inv-1");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0]!.docType).toBe("NOTA_CREDITO");
      expect(r.data[0]!.date).toBe("2026-04-05");
    }
  });

  it("VIEWER es rechazado", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const r = await getCreditDebitNotesAction(COMPANY_ID, "inv-1");
    expect(r.success).toBe(false);
  });

  it("sin userId retorna error no autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getCreditDebitNotesAction(COMPANY_ID, "inv-1");
    expect(r).toEqual({ success: false, error: "No autorizado" });
  });

  it("retorna array vacío si no hay notas", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    const r = await getCreditDebitNotesAction(COMPANY_ID, "inv-1");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(0);
  });
});
