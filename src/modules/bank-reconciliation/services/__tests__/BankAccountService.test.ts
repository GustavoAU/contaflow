// src/modules/bank-reconciliation/services/__tests__/BankAccountService.test.ts
//
// BankAccountService.create no tenía tests. Se agrega uno enfocado: el guard
// que verifica que `accountId` pertenezca a la empresa (hallazgo MEDIUM del
// security-agent, 2026-09-05) — no cobertura exhaustiva del servicio completo.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bankAccount: { create: vi.fn() },
    account: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { BankAccountService } from "../BankAccountService";

// LOW follow-up (2026-09-05): guard y create ahora comparten `tx`.
function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({ bankAccount: prisma.bankAccount, account: prisma.account })) as never
  );
}

const BASE_INPUT = {
  companyId: "company-1",
  accountId: "acc-1",
  name: "Cuenta Corriente Banesco",
  bankName: "Banesco",
  currency: "VES",
  createdBy: "user-1",
} as const;

describe("BankAccountService.create — guard de cuenta ajena", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.bankAccount.create).mockResolvedValue({ id: "ba-1" } as never);
  });

  it("RECHAZA si la cuenta contable no pertenece a esta empresa", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([] as never); // acc-1 no es de company-1
    await expect(BankAccountService.create(BASE_INPUT as never)).rejects.toThrow(/no existe o no pertenece/);
    expect(prisma.bankAccount.create).not.toHaveBeenCalled();
  });

  it("permite crear cuando la cuenta contable es de esta empresa", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: "acc-1" }] as never);
    await BankAccountService.create(BASE_INPUT as never);
    expect(prisma.bankAccount.create).toHaveBeenCalled();
  });
});
