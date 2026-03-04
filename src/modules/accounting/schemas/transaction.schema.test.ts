// src/modules/accounting/schemas/transaction.schema.test.ts
import { describe, it, expect } from "vitest";
import { CreateTransactionSchema } from "./transaction.schema";

// ─── Datos base para los tests ────────────────────────────────────────────────

const BASE_TRANSACTION = {
  companyId: "company-1",
  userId: "user-1",
  description: "Venta al contado",
  date: new Date("2026-01-01"),
  type: "DIARIO" as const,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateTransactionSchema", () => {
  describe("Partida doble", () => {
    it("acepta un asiento balanceado", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rechaza un asiento desbalanceado", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "" },
          { accountId: "acc-2", debit: "", credit: "500" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("balanceado"))).toBe(true);
      }
    });

    it("acepta asiento con multiples lineas balanceado", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "500", credit: "" },
          { accountId: "acc-2", debit: "500", credit: "" },
          { accountId: "acc-3", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rechaza asiento con menos de 2 lineas", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [{ accountId: "acc-1", debit: "1000", credit: "" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Validacion de lineas", () => {
    it("rechaza una linea sin debito ni credito", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("rechaza una linea con debito y credito al mismo tiempo", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "1000" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("rechaza una linea sin accountId", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "", debit: "1000", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Precision decimal", () => {
    it("acepta montos con hasta 4 decimales balanceados", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "1000.1234", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000.1234" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("balancea correctamente montos decimales", () => {
      // Clasico error de punto flotante: 0.1 + 0.2 !== 0.3 en JavaScript
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        entries: [
          { accountId: "acc-1", debit: "0.1", credit: "" },
          { accountId: "acc-2", debit: "0.2", credit: "" },
          { accountId: "acc-3", debit: "", credit: "0.3" },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Campos requeridos", () => {
    it("rechaza descripcion vacia", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        description: "",
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("rechaza descripcion menor a 3 caracteres", () => {
      const result = CreateTransactionSchema.safeParse({
        ...BASE_TRANSACTION,
        description: "AB",
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "" },
          { accountId: "acc-2", debit: "", credit: "1000" },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});
