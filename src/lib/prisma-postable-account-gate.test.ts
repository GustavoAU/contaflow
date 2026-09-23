// src/lib/prisma-postable-account-gate.test.ts
// TDD SPEC — gate de Prisma que bloquea asientos (Transaction.entries) contra cuentas
// de título (Account.isPostable = false). Ver diseño en la tarea del orquestador.
// Todo este archivo es RED hoy: "./prisma-postable-account-gate" NO EXISTE todavía.
// No modificar este archivo — implementar en src/lib/prisma-postable-account-gate.ts
// (funciones puras: isRelevantOperation, extractAccountIds, notPostableMessage)
// para hacerlo pasar. createPostableAccountGateExtension NO se testea aquí directo
// (mismo criterio que prisma-billing-gate.test.ts — solo las funciones puras).
import { describe, it, expect } from "vitest";
import {
  isRelevantOperation,
  extractAccountIds,
  notPostableMessage,
} from "./prisma-postable-account-gate";

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

describe("extractAccountIds", () => {
  it("entries.create como ARRAY — forma real de TransactionService.ts:185-202", () => {
    const args = {
      data: {
        number: "AS-0001",
        entries: {
          create: [
            { accountId: "a1", amount: "100", description: "Debe" },
            { accountId: "a2", amount: "-100", description: "Haber" },
          ],
        },
      },
    };
    expect(extractAccountIds(args).sort()).toEqual(["a1", "a2"]);
  });

  it("entries.create como OBJETO único (Prisma también lo permite)", () => {
    const args = {
      data: { entries: { create: { accountId: "a1", amount: "100" } } },
    };
    expect(extractAccountIds(args)).toEqual(["a1"]);
  });

  it("entries.createMany.data", () => {
    const args = {
      data: {
        entries: {
          createMany: { data: [{ accountId: "a1" }, { accountId: "a2" }] },
        },
      },
    };
    expect(extractAccountIds(args).sort()).toEqual(["a1", "a2"]);
  });

  it("forma de transaction.upsert (SIN `data` en el nivel raíz) — junta accountIds de create Y update", () => {
    const args = {
      where: { id: "t1" },
      create: { entries: { create: [{ accountId: "a1" }] } },
      update: { entries: { create: [{ accountId: "a2" }] } },
    };
    expect(extractAccountIds(args).sort()).toEqual(["a1", "a2"]);
  });

  it("sin `entries` en absoluto → []", () => {
    expect(extractAccountIds({ data: { number: "1", description: "x" } })).toEqual([]);
  });

  it("`entries` presente pero vacío → []", () => {
    expect(extractAccountIds({ data: { entries: { create: [] } } })).toEqual([]);
  });

  it("args malformado nunca lanza y siempre devuelve []", () => {
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
      expect(() => extractAccountIds(bad)).not.toThrow();
      expect(extractAccountIds(bad)).toEqual([]);
    }
  });

  it("accountId duplicado en el mismo array → aparece UNA sola vez", () => {
    const args = {
      data: {
        entries: {
          create: [
            { accountId: "a1", amount: "100" },
            { accountId: "a1", amount: "-100" },
          ],
        },
      },
    };
    expect(extractAccountIds(args)).toEqual(["a1"]);
  });

  it("createMany.data que no es array (ej. undefined) → no lanza, no aporta ids", () => {
    const args = { data: { entries: { createMany: { data: undefined } } } };
    expect(() => extractAccountIds(args)).not.toThrow();
    expect(extractAccountIds(args)).toEqual([]);
  });
});

describe("notPostableMessage", () => {
  it("incluye código, nombre, y explica que es cuenta de título sin admitir movimientos", () => {
    const msg = notPostableMessage("1.1.01", "CAJAS");
    expect(msg).toContain("1.1.01");
    expect(msg).toContain("CAJAS");
    expect(msg).toMatch(/t[ií]tulo/i);
    expect(msg).toMatch(/no admite|movimientos/i);
  });
});
