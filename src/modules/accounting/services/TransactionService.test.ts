// src/modules/accounting/services/TransactionService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { TransactionService } from "./TransactionService";

describe("generateTransactionNumber", () => {
  beforeEach(() => vi.clearAllMocks());

  it("genera el primer numero del mes si no hay asientos", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-03-10")
    );

    expect(number).toBe("2026-03-000001");
  });

  it("incrementa el numero correctamente", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      number: "2026-03-000005",
    } as never);

    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-03-10")
    );

    expect(number).toBe("2026-03-000006");
  });

  it("reinicia el contador en un nuevo mes", async () => {
    // En abril no hay asientos aun
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-04-01")
    );

    expect(number).toBe("2026-04-000001");
  });

  it("es independiente por empresa", async () => {
    // Empresa B no tiene asientos aunque Empresa A tenga 10
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const number = await TransactionService.generateTransactionNumber(
      "company-2",
      new Date("2026-03-10")
    );

    expect(number).toBe("2026-03-000001");
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-2" }),
      })
    );
  });
});
