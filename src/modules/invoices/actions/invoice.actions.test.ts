// src/modules/invoices/actions/invoice.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInvoiceAction, getInvoiceBookAction } from "./invoice.actions";
import { InvoiceService } from "../services/InvoiceService";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("../services/InvoiceService", () => ({
  InvoiceService: {
    create: vi.fn(),
    getBook: vi.fn(),
  },
}));

const BASE_INPUT = {
  companyId: "company-1",
  type: "SALE",
  docType: "FACTURA",
  taxCategory: "GRAVADA",
  invoiceNumber: "0000001",
  controlNumber: "00-0000001",
  date: "2026-03-01",
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16", amount: "160.00" }],
  ivaRetentionAmount: "0",
  islrRetentionAmount: "0",
  igtfBase: "0",
  igtfAmount: "0",
  createdBy: "user-1",
};

const BASE_FILTER = {
  companyId: "company-1",
  type: "SALE",
  year: 2026,
  month: 3,
};

const EMPTY_SUMMARY = {
  totalBaseGeneral: "0.00",
  totalIvaGeneral: "0.00",
  totalBaseReduced: "0.00",
  totalIvaReduced: "0.00",
  totalBaseAdditional: "0.00",
  totalIvaAdditional: "0.00",
  totalExempt: "0.00",
  totalIvaRetention: "0.00",
  totalIslrRetention: "0.00",
  totalIgtf: "0.00",
};

describe("createInvoiceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna success true con input válido", async () => {
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-1" } as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("inv-1");
  });

  it("retorna error si falta invoiceNumber", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, invoiceNumber: "" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("retorna error si falta counterpartRif", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, counterpartRif: "" });

    expect(result.success).toBe(false);
  });

  it("retorna error si falta counterpartName", async () => {
    const result = await createInvoiceAction({ ...BASE_INPUT, counterpartName: "" });

    expect(result.success).toBe(false);
  });

  it("retorna error si el service lanza excepción", async () => {
    vi.mocked(InvoiceService.create).mockRejectedValue(new Error("DB error") as never);

    const result = await createInvoiceAction(BASE_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al registrar la factura");
  });

  it("retorna error si el input no es válido", async () => {
    const result = await createInvoiceAction({ invalid: true });

    expect(result.success).toBe(false);
  });

  it("acepta factura con taxLines vacíos", async () => {
    vi.mocked(InvoiceService.create).mockResolvedValue({ id: "inv-2" } as never);

    const result = await createInvoiceAction({ ...BASE_INPUT, taxLines: [] });

    expect(result.success).toBe(true);
  });
});

describe("getInvoiceBookAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna success true con filtro válido", async () => {
    vi.mocked(InvoiceService.getBook).mockResolvedValue({
      rows: [],
      summary: EMPTY_SUMMARY,
    } as never);

    const result = await getInvoiceBookAction(BASE_FILTER);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.rows).toHaveLength(0);
  });

  it("retorna error si falta companyId", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, companyId: "" });

    expect(result.success).toBe(false);
  });

  it("retorna error si mes es inválido", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, month: 13 });

    expect(result.success).toBe(false);
  });

  it("retorna error si año es inválido", async () => {
    const result = await getInvoiceBookAction({ ...BASE_FILTER, year: 1999 });

    expect(result.success).toBe(false);
  });

  it("retorna error si el service lanza excepción", async () => {
    vi.mocked(InvoiceService.getBook).mockRejectedValue(new Error("DB error") as never);

    const result = await getInvoiceBookAction(BASE_FILTER);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Error al obtener el libro");
  });
});
