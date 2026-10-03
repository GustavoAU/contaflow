// src/lib/prisma-tercero-required-gate.test.ts
// TDD SPEC — gate de Prisma que exige tercero (Customer/Vendor/Partner/Employee) en cada línea
// de asiento (JournalEntry) cuya cuenta tenga Account.requiresThirdParty = true. Ver ADR-054.
// Todo este archivo es RED hoy: "./prisma-tercero-required-gate" NO EXISTE todavía.
// No modificar este archivo — implementar en src/lib/prisma-tercero-required-gate.ts
// (funciones puras: isRelevantOperation, hasThirdParty, extractEntryPartyPairs,
// notEnoughThirdPartyMessage) para hacerlo pasar. createTerceroRequiredGateExtension NO se
// testea aquí directo (mismo criterio que prisma-postable-account-gate.test.ts — solo las
// funciones puras).
import { describe, it, expect } from "vitest";
import {
  isRelevantOperation,
  hasThirdParty,
  extractEntryPartyPairs,
  notEnoughThirdPartyMessage,
} from "./prisma-tercero-required-gate";

describe("isRelevantOperation", () => {
  it("Transaction.create/update/upsert son relevantes", () => {
    expect(isRelevantOperation("Transaction", "create")).toBe(true);
    expect(isRelevantOperation("Transaction", "update")).toBe(true);
    expect(isRelevantOperation("Transaction", "upsert")).toBe(true);
  });

  it("otras operaciones de Transaction NO son relevantes", () => {
    expect(isRelevantOperation("Transaction", "delete")).toBe(false);
    expect(isRelevantOperation("Transaction", "findMany")).toBe(false);
  });

  it("otro modelo nunca es relevante, aunque también use `entries` o `accountId`", () => {
    expect(isRelevantOperation("Invoice", "create")).toBe(false);
  });

  it("model undefined no es relevante", () => {
    expect(isRelevantOperation(undefined, "create")).toBe(false);
  });
});

describe("hasThirdParty", () => {
  it("customerId no vacío → true", () => {
    expect(hasThirdParty({ customerId: "c1" })).toBe(true);
  });

  it("vendorId no vacío → true", () => {
    expect(hasThirdParty({ vendorId: "v1" })).toBe(true);
  });

  it("partnerId no vacío → true", () => {
    expect(hasThirdParty({ partnerId: "p1" })).toBe(true);
  });

  it("employeeId no vacío → true", () => {
    expect(hasThirdParty({ employeeId: "e1" })).toBe(true);
  });

  it("objeto sin ningún campo de tercero → false", () => {
    expect(hasThirdParty({})).toBe(false);
  });

  it("customerId null → false", () => {
    expect(hasThirdParty({ customerId: null })).toBe(false);
  });

  it("customerId string vacío → false (no cuenta)", () => {
    expect(hasThirdParty({ customerId: "" })).toBe(false);
  });

  it("dos campos de tercero poblados a la vez → true (el gate no valida exclusión mutua, eso lo hace el CHECK de la BD)", () => {
    expect(hasThirdParty({ customerId: "c1", vendorId: "v1" })).toBe(true);
  });

  it("row malformado (null/undefined/string/number) → false, nunca lanza", () => {
    expect(hasThirdParty(null)).toBe(false);
    expect(hasThirdParty(undefined)).toBe(false);
    expect(hasThirdParty("string")).toBe(false);
    expect(hasThirdParty(123)).toBe(false);
  });
});

describe("extractEntryPartyPairs", () => {
  it("entries.create como ARRAY con 2 líneas, una con customerId y otra sin nada", () => {
    const args = {
      data: {
        number: "AS-0001",
        entries: {
          create: [
            { accountId: "a1", amount: "100", customerId: "c1" },
            { accountId: "a2", amount: "-100" },
          ],
        },
      },
    };
    expect(extractEntryPartyPairs(args)).toEqual([
      { accountId: "a1", hasThirdParty: true },
      { accountId: "a2", hasThirdParty: false },
    ]);
  });

  it("entries.create como OBJETO único con vendorId", () => {
    const args = {
      data: { entries: { create: { accountId: "a1", amount: "100", vendorId: "v1" } } },
    };
    expect(extractEntryPartyPairs(args)).toEqual([{ accountId: "a1", hasThirdParty: true }]);
  });

  it("entries.createMany.data con 2 líneas", () => {
    const args = {
      data: {
        entries: {
          createMany: {
            data: [{ accountId: "a1", partnerId: "p1" }, { accountId: "a2" }],
          },
        },
      },
    };
    expect(extractEntryPartyPairs(args)).toEqual([
      { accountId: "a1", hasThirdParty: true },
      { accountId: "a2", hasThirdParty: false },
    ]);
  });

  it("forma de transaction.upsert (SIN `data` en el nivel raíz) — junta pares de create Y update", () => {
    const args = {
      where: { id: "t1" },
      create: { entries: { create: [{ accountId: "a1", employeeId: "e1" }] } },
      update: { entries: { create: [{ accountId: "a2" }] } },
    };
    expect(extractEntryPartyPairs(args)).toEqual([
      { accountId: "a1", hasThirdParty: true },
      { accountId: "a2", hasThirdParty: false },
    ]);
  });

  it("DOS líneas contra la MISMA cuenta, una con tercero y otra sin → NO se colapsan (a diferencia de extractAccountIds)", () => {
    const args = {
      data: {
        entries: {
          create: [{ accountId: "a1", customerId: "c1" }, { accountId: "a1" }],
        },
      },
    };
    expect(extractEntryPartyPairs(args)).toEqual([
      { accountId: "a1", hasThirdParty: true },
      { accountId: "a1", hasThirdParty: false },
    ]);
  });

  it("sin `entries` en absoluto → []", () => {
    expect(extractEntryPartyPairs({ data: { number: "1", description: "x" } })).toEqual([]);
  });

  it("`entries` presente pero vacío → []", () => {
    expect(extractEntryPartyPairs({ data: { entries: { create: [] } } })).toEqual([]);
  });

  it("args malformado nunca lanza y siempre devuelve [] (mismos casos que extractAccountIds)", () => {
    const malformedInputs: unknown[] = [
      null,
      undefined,
      "string",
      {},
      { data: null },
      { data: { entries: null } },
      {
        data: {
          entries: {
            create: [null, { noAccountId: true }, { accountId: 123 }],
          },
        },
      },
    ];

    for (const bad of malformedInputs) {
      expect(() => extractEntryPartyPairs(bad)).not.toThrow();
      expect(extractEntryPartyPairs(bad)).toEqual([]);
    }
  });

  it("createMany.data que no es array (ej. undefined) → no lanza, no aporta pares", () => {
    const args = { data: { entries: { createMany: { data: undefined } } } };
    expect(() => extractEntryPartyPairs(args)).not.toThrow();
    expect(extractEntryPartyPairs(args)).toEqual([]);
  });
});

describe("notEnoughThirdPartyMessage", () => {
  it("incluye código, nombre, y menciona 'tercero'", () => {
    const msg = notEnoughThirdPartyMessage("1.1.02.02.001", "Cuentas por Cobrar Clientes");
    expect(msg).toContain("1.1.02.02.001");
    expect(msg).toContain("Cuentas por Cobrar Clientes");
    expect(msg).toMatch(/tercero/i);
  });
});
