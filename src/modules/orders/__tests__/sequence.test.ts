// src/modules/orders/__tests__/sequence.test.ts
// P1 (audit 2026-07-05): retry P2034 en el correlativo de Compras y Ventas.

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    orderNumberSequence: { upsert: vi.fn() },
  },
}));

import { getNextDocumentNumber } from "../utils/sequence";

const COMPANY_ID = "company-test";

function p2034() {
  return Object.assign(new Error("could not serialize access"), { code: "P2034" });
}

describe("getNextDocumentNumber — Serializable + retry P2034", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({ orderNumberSequence: prisma.orderNumberSequence })) as never
    );
    vi.mocked(prisma.orderNumberSequence.upsert).mockResolvedValue({ lastNumber: 7 } as never);
  });

  it("mapea el prefijo por tipo de documento", async () => {
    expect(await getNextDocumentNumber(COMPANY_ID, "PURCHASE_QUOTATION")).toBe("COT-0007");
    expect(await getNextDocumentNumber(COMPANY_ID, "SALE_QUOTATION")).toBe("PRE-0007");
    expect(await getNextDocumentNumber(COMPANY_ID, "PURCHASE_ORDER")).toBe("OC-0007");
    expect(await getNextDocumentNumber(COMPANY_ID, "SALE_ORDER")).toBe("OV-0007");
  });

  it("reintenta transparente tras un P2034 (clicks simultáneos misma empresa)", async () => {
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(p2034() as never)
      .mockImplementationOnce(((fn: (tx: unknown) => unknown) =>
        fn({ orderNumberSequence: prisma.orderNumberSequence })) as never);

    const number = await getNextDocumentNumber(COMPANY_ID, "SALE_ORDER");

    expect(number).toBe("OV-0007");
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("agota 3 intentos de P2034 → error de negocio en español", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(p2034() as never);

    await expect(getNextDocumentNumber(COMPANY_ID, "PURCHASE_ORDER")).rejects.toThrow(
      /Conflicto de concurrencia/,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("un error que NO es P2034 propaga inmediato, sin reintentos", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("connection lost") as never);

    await expect(getNextDocumentNumber(COMPANY_ID, "PURCHASE_ORDER")).rejects.toThrow(
      "connection lost",
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
