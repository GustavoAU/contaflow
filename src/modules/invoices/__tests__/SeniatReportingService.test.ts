// src/modules/invoices/__tests__/SeniatReportingService.test.ts
// ADR-019 D-1 + Addendum D-1.1 — outbox PA-121: createSubmission / publish / transmit
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Decimal } from "decimal.js";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockSubmissionFindUnique = vi.hoisted(() => vi.fn());
const mockSubmissionUpdateMany = vi.hoisted(() => vi.fn());
const mockSubmissionUpdate = vi.hoisted(() => vi.fn());
const mockPublishJSON = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  default: {
    seniatSubmission: {
      findUnique: mockSubmissionFindUnique,
      updateMany: mockSubmissionUpdateMany,
      update: mockSubmissionUpdate,
    },
  },
}));

vi.mock("@upstash/qstash", () => ({
  // Clase real (no vi.fn) — inmune a clearAllMocks/mockReset entre tests
  Client: class {
    publishJSON = mockPublishJSON;
  },
}));

import {
  SeniatReportingService,
  resolveAppBaseUrl,
  type InvoiceForPayload,
} from "../services/SeniatReportingService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockInvoice = {
  id: "inv-1",
  invoiceNumber: "0000001",
  controlNumber: "00-00000001",
  type: "SALE",
  docType: "FACTURA",
  date: new Date("2026-06-01T00:00:00.000Z"),
  currency: "VES",
  totalAmountVes: new Decimal("1160.00"),
  counterpartName: "Cliente Demo C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [
    {
      taxType: "IVA_GENERAL",
      base: new Decimal("1000.00"),
      rate: new Decimal("16"),
      amount: new Decimal("160.00"),
    },
  ],
} as unknown as InvoiceForPayload;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── buildPayload ─────────────────────────────────────────────────────────────
describe("SeniatReportingService.buildPayload", () => {
  it("serializa Decimals como string y mapea taxType (no `type`) — fix auditoría 2026-06-10", () => {
    const payload = SeniatReportingService.buildPayload(mockInvoice, "J-99999999-9");

    expect(payload.companyRif).toBe("J-99999999-9");
    expect(payload.totalAmount).toBe("1160");
    expect(payload.date).toBe("2026-06-01");
    expect(payload.docType).toBe("FACTURA");
    expect(payload.taxLines).toEqual([
      { taxType: "IVA_GENERAL", base: "1000", rate: "16", amount: "160" },
    ]);
    // R-5: nada numérico nativo en montos
    expect(typeof payload.totalAmount).toBe("string");
  });

  it("tolera companyRif null y taxLines ausentes", () => {
    const lean = { ...mockInvoice, taxLines: undefined } as InvoiceForPayload;
    const payload = SeniatReportingService.buildPayload(lean, null);

    expect(payload.companyRif).toBeNull();
    expect(payload.taxLines).toEqual([]);
  });
});

// ─── createSubmission ─────────────────────────────────────────────────────────
describe("SeniatReportingService.createSubmission", () => {
  it("crea la fila SeniatSubmission con el tx provisto (mismo $transaction — ADR-019 D-1)", async () => {
    const txCreate = vi.fn().mockResolvedValue({ id: "sub-1" });
    const tx = { seniatSubmission: { create: txCreate } } as never;
    const payload = SeniatReportingService.buildPayload(mockInvoice, "J-99999999-9");

    await SeniatReportingService.createSubmission(tx, "company-1", "inv-1", payload);

    expect(txCreate).toHaveBeenCalledWith({
      data: {
        companyId: "company-1",
        invoiceId: "inv-1",
        payload,
      },
    });
  });
});

// ─── resolveAppBaseUrl ────────────────────────────────────────────────────────
describe("resolveAppBaseUrl", () => {
  it("prefiere NEXT_PUBLIC_APP_URL sobre VERCEL_URL (fix precedencia ??/?:)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://contaflow.app");
    vi.stubEnv("VERCEL_URL", "deploy-abc.vercel.app");

    expect(resolveAppBaseUrl()).toBe("https://contaflow.app");
  });

  it("usa https://VERCEL_URL cuando no hay NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_URL", "deploy-abc.vercel.app");
    // stubEnv("", ...) deja string vacío — forzar undefined real
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(resolveAppBaseUrl()).toBe("https://deploy-abc.vercel.app");
  });

  it("cae a localhost sin ninguna env configurada", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    expect(resolveAppBaseUrl()).toBe("http://localhost:3000");
  });
});

// ─── publishForInvoice ────────────────────────────────────────────────────────
describe("SeniatReportingService.publishForInvoice", () => {
  it("sin QSTASH_TOKEN → no-op (false) sin tocar la BD", async () => {
    delete process.env.QSTASH_TOKEN;

    const result = await SeniatReportingService.publishForInvoice("inv-1");

    expect(result).toBe(false);
    expect(mockSubmissionFindUnique).not.toHaveBeenCalled();
  });

  it("con token pero sin submission → false", async () => {
    vi.stubEnv("QSTASH_TOKEN", "tok-1");
    mockSubmissionFindUnique.mockResolvedValue(null);

    const result = await SeniatReportingService.publishForInvoice("inv-1");

    expect(result).toBe(false);
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("publica a QStash con la URL del webhook y el submissionId (post-commit, D-1.1a)", async () => {
    vi.stubEnv("QSTASH_TOKEN", "tok-1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://contaflow.app");
    mockSubmissionFindUnique.mockResolvedValue({ id: "sub-1" });
    mockPublishJSON.mockResolvedValue({ messageId: "msg-1" });

    const result = await SeniatReportingService.publishForInvoice("inv-1");

    expect(result).toBe(true);
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://contaflow.app/api/webhooks/seniat-report",
      body: { submissionId: "sub-1" },
      retries: 5,
    });
  });

  it("NUNCA lanza si QStash falla — la submission queda PENDING para el poller", async () => {
    vi.stubEnv("QSTASH_TOKEN", "tok-1");
    mockSubmissionFindUnique.mockResolvedValue({ id: "sub-1" });
    mockPublishJSON.mockRejectedValue(new Error("Upstash caído"));

    await expect(SeniatReportingService.publishForInvoice("inv-1")).resolves.toBe(false);
  });
});

// ─── transmit — idempotencia PA-121 atómica (N2 — Z-4) ───────────────────────
// Nuevo flujo: updateMany(PENDING→PROCESSING) atómico primero, luego findUnique
describe("SeniatReportingService.transmit", () => {
  it("descarta reintento duplicado cuando status=SENT (N2: claim vía updateMany)", async () => {
    // updateMany no encuentra PENDING → count=0
    mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmissionFindUnique.mockResolvedValue({ id: "sub-1", status: "SENT" });

    const result = await SeniatReportingService.transmit("sub-1");

    expect(result).toEqual({ success: true, referenceId: "already-sent" });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("descarta reintento duplicado cuando status=ACKNOWLEDGED (N2: claim vía updateMany)", async () => {
    mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmissionFindUnique.mockResolvedValue({ id: "sub-1", status: "ACKNOWLEDGED" });

    const result = await SeniatReportingService.transmit("sub-1");

    expect(result).toEqual({ success: true, referenceId: "already-sent" });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("otro worker ya está en vuelo (PROCESSING) → already-processing sin update", async () => {
    mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmissionFindUnique.mockResolvedValue({ id: "sub-1", status: "PROCESSING" });

    const result = await SeniatReportingService.transmit("sub-1");

    expect(result).toEqual({ success: true, referenceId: "already-processing" });
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });

  it("PENDING con API no disponible → incrementa attempts y revierte a PENDING", async () => {
    // Claim exitoso (count=1), luego findUnique devuelve el payload completo
    mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
    mockSubmissionFindUnique.mockResolvedValue({
      id: "sub-1",
      status: "PROCESSING",
      attempts: 0,
      payload: {},
    });
    mockSubmissionUpdate.mockResolvedValue({});

    const result = await SeniatReportingService.transmit("sub-1");

    expect(result.success).toBe(false);
    expect(mockSubmissionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub-1" },
        data: expect.objectContaining({ status: "PENDING", attempts: 1 }),
      })
    );
  });

  it("PENDING en el 5to intento fallido → status FAILED", async () => {
    mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
    mockSubmissionFindUnique.mockResolvedValue({
      id: "sub-1",
      status: "PROCESSING",
      attempts: 4,
      payload: {},
    });
    mockSubmissionUpdate.mockResolvedValue({});

    await SeniatReportingService.transmit("sub-1");

    expect(mockSubmissionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", attempts: 5 }),
      })
    );
  });

  it("submission inexistente → error sin update", async () => {
    mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmissionFindUnique.mockResolvedValue(null);

    const result = await SeniatReportingService.transmit("sub-x");

    expect(result.success).toBe(false);
    expect(mockSubmissionUpdate).not.toHaveBeenCalled();
  });
});
