// src/lib/__tests__/account-guard.test.ts
//
// assertAccountsBelongToCompany: el guard que faltaba en ~41 campos *AccountId
// de ~20 modelos (hallazgo MEDIUM del security-agent, 2026-09-05).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertAccountsBelongToCompany, assertBankAccountsBelongToCompany } from "../account-guard";

function makeDb(existentes: string[]) {
  const impl = async ({ where }: { where: { id: { in: string[] }; companyId: string } }) =>
    where.id.in.filter((id) => existentes.includes(id)).map((id) => ({ id }));
  return { account: { findMany: vi.fn(impl) }, bankAccount: { findMany: vi.fn(impl) } } as never;
}

describe("assertAccountsBelongToCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no hace nada si todos los ids son null/undefined — un campo sin asignar no es un error", async () => {
    const db = makeDb([]);
    await expect(
      assertAccountsBelongToCompany(db, "company-1", [null, undefined, null]),
    ).resolves.toBeUndefined();
  });

  it("no hace nada si la lista de candidatos está vacía", async () => {
    const db = makeDb([]);
    await expect(assertAccountsBelongToCompany(db, "company-1", [])).resolves.toBeUndefined();
  });

  it("pasa cuando todas las cuentas existen y son de la empresa", async () => {
    const db = makeDb(["acc-1", "acc-2"]);
    await expect(
      assertAccountsBelongToCompany(db, "company-1", ["acc-1", "acc-2", null]),
    ).resolves.toBeUndefined();
  });

  it("RECHAZA cuando una cuenta es de otra empresa (o no existe)", async () => {
    const db = makeDb(["acc-1"]); // acc-2 no pertenece a company-1
    await expect(
      assertAccountsBelongToCompany(db, "company-1", ["acc-1", "acc-2"]),
    ).rejects.toThrow(/no existe o no pertenece/);
  });

  it("pluraliza el mensaje cuando faltan varias", async () => {
    const db = makeDb([]);
    await expect(
      assertAccountsBelongToCompany(db, "company-1", ["acc-1", "acc-2"]),
    ).rejects.toThrow(/Una o más cuentas/);
  });

  it("deduplica ids repetidos antes de consultar — una sola query, un solo id", async () => {
    const db = makeDb(["acc-1"]);
    await assertAccountsBelongToCompany(db, "company-1", ["acc-1", "acc-1", "acc-1"]);
    const call = (db as { account: { findMany: ReturnType<typeof vi.fn> } }).account.findMany.mock.calls[0][0];
    expect(call.where.id.in).toEqual(["acc-1"]);
  });

  it("consulta SIEMPRE con el companyId del servidor, no uno ajeno", async () => {
    const db = makeDb(["acc-1"]);
    await assertAccountsBelongToCompany(db, "company-real", ["acc-1"]);
    const call = (db as { account: { findMany: ReturnType<typeof vi.fn> } }).account.findMany.mock.calls[0][0];
    expect(call.where.companyId).toBe("company-real");
  });
});

describe("assertBankAccountsBelongToCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta la tabla BankAccount, no Account", async () => {
    const db = makeDb(["bank-1"]);
    await assertBankAccountsBelongToCompany(db, "company-1", ["bank-1"]);
    expect((db as { bankAccount: { findMany: ReturnType<typeof vi.fn> } }).bankAccount.findMany).toHaveBeenCalled();
    expect((db as { account: { findMany: ReturnType<typeof vi.fn> } }).account.findMany).not.toHaveBeenCalled();
  });

  it("RECHAZA con mensaje propio de cuenta bancaria", async () => {
    const db = makeDb([]);
    await expect(
      assertBankAccountsBelongToCompany(db, "company-1", ["bank-ajeno"]),
    ).rejects.toThrow(/cuenta bancaria/);
  });
});
