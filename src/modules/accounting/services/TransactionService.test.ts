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
    accountingPeriod: {
      findFirst: vi.fn(),
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

describe("createBalancedTransaction - period validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lanza error si no hay per├¡odo abierto", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: "acc-1" },
      { id: "acc-2" },
    ] as never);

    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(
      TransactionService.createBalancedTransaction({
        companyId: "company-1",
        userId: "user-1",
        description: "Test",
        date: new Date("2026-03-10"),
        type: "DIARIO",
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "0" },
          { accountId: "acc-2", debit: "0", credit: "1000" },
        ],
      })
    ).rejects.toThrow("No hay período contable abierto");
  });
});