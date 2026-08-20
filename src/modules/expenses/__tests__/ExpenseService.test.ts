// src/modules/expenses/__tests__/ExpenseService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

// NOTA: `expense.findUnique` NO está en el mock a propósito.
// El lookup de idempotencia debe ser `findFirst` acotado por companyId; si
// alguien vuelve a `findUnique({ where: { idempotencyKey } })` (el IDOR
// cross-tenant original), el test revienta con "findUnique is not a function"
// en vez de pasar en verde. El mock es parte de la aserción.
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({
        expense: {
          create: vi.fn().mockResolvedValue(makeDbExpense()),
          update: vi.fn().mockResolvedValue(makeDbExpense({ status: "CONFIRMED" })),
        },
        expenseCategory: { createMany: vi.fn(), create: vi.fn() },
        auditLog: { create: vi.fn() },
      })
    ),
    expense: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    expenseCategory: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: "cat-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    vendor: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "vendor-1" }) },
    account: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "acc-1" }) },
    auditLog: { create: vi.fn() },
  },
}));

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  createExpense,
  confirmExpense,
  voidExpense,
  listExpenses,
  seedExpenseCategories,
  DEFAULT_EXPENSE_CATEGORIES,
} from "../services/ExpenseService";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeDbExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: "expense-1",
    companyId: "company-1",
    vendorId: null,
    supplierName: "Proveedor Demo",
    concept: "Servicio de internet",
    categoryId: "cat-1",
    amount: new Decimal("100"),
    currency: "VES",
    exchangeRate: null,
    amountVes: new Decimal("100"),
    hasIva: false,
    ivaAmount: null,
    isDeductible: true,
    invoiceNumber: null,
    invoiceDate: null,
    attachmentUrl: null,
    transactionId: null,
    expenseAccountId: null,
    status: "DRAFT",
    idempotencyKey: "uuid-1234",
    deletedAt: null,
    deletedBy: null,
    createdBy: "user-1",
    createdAt: new Date("2026-05-06"),
    updatedAt: new Date("2026-05-06"),
    category: { name: "Servicios Básicos" },
    ...overrides,
  };
}

const makeCreateInput = (overrides = {}) => ({
  companyId: "company-1",
  supplierName: "Proveedor Demo",
  concept: "Servicio de internet",
  categoryId: "cat-1",
  amount: "100",
  currency: "VES" as const,
  hasIva: false,
  isDeductible: true,
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
  ...overrides,
});

/**
 * `findFirst` falso que se comporta como la BD: filtra las filas por TODAS las
 * claves escalares del `where`. Si el servicio omite `companyId`, la fila de la
 * otra empresa hace match y el test falla — que es exactamente lo que no pasaba
 * con `mockResolvedValue(fila)`, un mock que devuelve la fila pase lo que pase.
 */
function fakeFindFirst(rows: Array<Record<string, unknown>>) {
  return vi.fn(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    const scalar = Object.entries(where).filter(
      ([, v]) => v === null || typeof v !== "object"
    );
    return (
      rows.find((row) => scalar.every(([k, v]) => row[k] === v)) ?? null
    );
  });
}

// ─── seedExpenseCategories ────────────────────────────────────────────────────
describe("seedExpenseCategories", () => {
  it("llama createMany con las 9 categorías semilla", async () => {
    const txMock = {
      expenseCategory: { createMany: vi.fn().mockResolvedValue({ count: 9 }) },
    };

    await seedExpenseCategories("company-1", txMock as unknown as Parameters<typeof seedExpenseCategories>[1]);

    expect(txMock.expenseCategory.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: "Servicios Básicos", isDefault: true }),
        expect.objectContaining({ name: "Alquiler", isDefault: true }),
        expect.objectContaining({ name: "Otros Gastos Operativos", isDefault: true }),
      ]),
      skipDuplicates: true,
    });
    expect(DEFAULT_EXPENSE_CATEGORIES).toHaveLength(9);
  });
});

// ─── createExpense ─────────────────────────────────────────────────────────────
describe("createExpense", () => {
  beforeEach(() => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.expenseCategory.findFirstOrThrow).mockResolvedValue({ id: "cat-1" } as never);
  });

  it("crea un gasto en VES correctamente", async () => {
    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: { create: vi.fn().mockResolvedValue(makeDbExpense()) },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await createExpense(makeCreateInput(), "user-1");

    expect(result.id).toBe("expense-1");
    expect(result.status).toBe("DRAFT");
    expect(result.amountVes).toBe("100.0000");
  });

  it("calcula amountVes correctamente para USD con tasa de cambio", async () => {
    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          create: vi.fn().mockResolvedValue(
            makeDbExpense({
              amount: new Decimal("10"),
              currency: "USD",
              exchangeRate: new Decimal("36.50"),
              amountVes: new Decimal("365"),
            })
          ),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await createExpense(
      makeCreateInput({ amount: "10", currency: "USD", exchangeRate: "36.50" }),
      "user-1"
    );

    expect(result.amountVes).toBe("365.0000"); // 10 × 36.50
  });

  it("retorna el gasto existente si ya existe idempotencyKey", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(makeDbExpense() as never);
    vi.mocked(prisma.$transaction).mockClear();

    const result = await createExpense(makeCreateInput(), "user-1");
    expect(result.id).toBe("expense-1");
    // No debe llamar a $transaction cuando existe idempotencyKey
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── createExpense — idempotencia ACOTADA a la empresa (IDOR cross-tenant) ─────
//
// `Expense.idempotencyKey` es `@unique` GLOBAL y el valor lo suministra el
// CLIENTE (`z.string().uuid()` en el schema). Con el lookup sin `companyId`,
// la empresa B que mandara la clave de la empresa A recibía de vuelta —completo
// y serializado— el gasto de A: monto, proveedor, concepto y categoría. Y su
// propio gasto nunca se creaba.
describe("createExpense — idempotencia acotada a companyId (regresión IDOR)", () => {
  const SHARED_KEY = "123e4567-e89b-12d3-a456-426614174000";
  const VICTIM_COMPANY = "company-victima";
  const ATTACKER_COMPANY = "company-atacante";

  const victimExpense = makeDbExpense({
    id: "expense-de-la-victima",
    companyId: VICTIM_COMPANY,
    supplierName: "Proveedor confidencial",
    concept: "Honorarios abogado — litigio",
    amount: new Decimal("999999"),
    amountVes: new Decimal("999999"),
    idempotencyKey: SHARED_KEY,
    category: { name: "Honorarios Profesionales" },
  });

  beforeEach(() => {
    vi.mocked(prisma.expenseCategory.findFirstOrThrow).mockResolvedValue({ id: "cat-1" } as never);
    // La BD contiene el gasto de la víctima con esa clave — y nada más.
    vi.mocked(prisma.expense.findFirst).mockClear();
    vi.mocked(prisma.expense.findFirst).mockImplementation(fakeFindFirst([victimExpense]) as never);
  });

  it("NO devuelve el gasto de otra empresa cuando reusan la misma idempotencyKey", async () => {
    const ownExpense = makeDbExpense({
      id: "expense-del-atacante",
      companyId: ATTACKER_COMPANY,
      idempotencyKey: SHARED_KEY,
    });
    const txCreate = vi.fn().mockResolvedValue(ownExpense);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: (tx: unknown) => unknown) =>
        fn({ expense: { create: txCreate }, auditLog: { create: vi.fn() } })) as never
    );

    const result = await createExpense(
      makeCreateInput({ companyId: ATTACKER_COMPANY, idempotencyKey: SHARED_KEY }),
      "user-atacante"
    );

    // 1. No se filtra NADA de la empresa víctima
    expect(result.id).toBe("expense-del-atacante");
    expect(result.companyId).toBe(ATTACKER_COMPANY);
    expect(result.concept).not.toBe(victimExpense.concept);
    expect(result.supplierName).not.toBe(victimExpense.supplierName);
    expect(result.amount).not.toBe("999999.0000");

    // 2. El gasto propio SÍ se crea (antes se perdía silenciosamente)
    expect(txCreate).toHaveBeenCalledOnce();
    expect(txCreate.mock.calls[0]![0].data.companyId).toBe(ATTACKER_COMPANY);
  });

  it("el where del lookup de idempotencia lleva companyId además de la clave", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: (tx: unknown) => unknown) =>
        fn({
          expense: { create: vi.fn().mockResolvedValue(makeDbExpense({ companyId: ATTACKER_COMPANY })) },
          auditLog: { create: vi.fn() },
        })) as never
    );

    await createExpense(
      makeCreateInput({ companyId: ATTACKER_COMPANY, idempotencyKey: SHARED_KEY }),
      "user-atacante"
    );

    const where = vi.mocked(prisma.expense.findFirst).mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ idempotencyKey: SHARED_KEY, companyId: ATTACKER_COMPANY });
    expect(Object.keys(where)).toContain("companyId");
  });

  it("la idempotencia legítima sigue funcionando: misma clave + MISMA empresa devuelve la fila existente", async () => {
    vi.mocked(prisma.$transaction).mockClear();

    const result = await createExpense(
      makeCreateInput({ companyId: VICTIM_COMPANY, idempotencyKey: SHARED_KEY }),
      "user-victima"
    );

    expect(result.id).toBe("expense-de-la-victima");
    expect(result.amount).toBe("999999.0000");
    expect(result.categoryName).toBe("Honorarios Profesionales");
    // No crea un duplicado
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── confirmExpense ────────────────────────────────────────────────────────────
describe("confirmExpense", () => {
  it("confirma un gasto DRAFT correctamente", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(makeDbExpense() as never);

    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          update: vi.fn().mockResolvedValue(
            makeDbExpense({ status: "CONFIRMED" })
          ),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await confirmExpense(
      { expenseId: "expense-1", companyId: "company-1" },
      "user-1"
    );

    expect(result.status).toBe("CONFIRMED");
  });

  it("lanza error si el gasto no está en DRAFT", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "CONFIRMED" }) as never
    );

    await expect(
      confirmExpense({ expenseId: "expense-1", companyId: "company-1" }, "user-1")
    ).rejects.toThrow("Solo se pueden confirmar gastos en estado DRAFT");
  });

  it("lanza error si el gasto no pertenece a la empresa (IDOR guard)", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(null);

    await expect(
      confirmExpense({ expenseId: "expense-1", companyId: "otra-empresa" }, "user-1")
    ).rejects.toThrow("no pertenece a esta empresa");
  });
});

// ─── voidExpense ───────────────────────────────────────────────────────────────
describe("voidExpense", () => {
  it("anula un gasto correctamente", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "CONFIRMED" }) as never
    );

    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        expense: {
          update: vi.fn().mockResolvedValue(makeDbExpense({ status: "VOIDED" })),
        },
        auditLog: { create: vi.fn() },
      };
      return fn(tx);
    });
    vi.mocked(prisma.$transaction).mockImplementation(txFn as never);

    const result = await voidExpense(
      { expenseId: "expense-1", companyId: "company-1", reason: "Error de captura" },
      "user-1"
    );

    expect(result.status).toBe("VOIDED");
  });

  it("lanza error si el gasto ya está anulado", async () => {
    vi.mocked(prisma.expense.findFirst).mockResolvedValue(
      makeDbExpense({ status: "VOIDED" }) as never
    );

    await expect(
      voidExpense(
        { expenseId: "expense-1", companyId: "company-1", reason: "test" },
        "user-1"
      )
    ).rejects.toThrow("ya está anulado");
  });
});

// ─── listExpenses ──────────────────────────────────────────────────────────────
describe("listExpenses", () => {
  it("retorna página vacía cuando no hay gastos", async () => {
    vi.mocked(prisma.expense.findMany).mockResolvedValue([]);

    const result = await listExpenses({ companyId: "company-1", limit: 50 });

    expect(result.data).toHaveLength(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("pagina correctamente con cursor cuando hay más resultados", async () => {
    const expenses = Array.from({ length: 51 }, (_, i) =>
      makeDbExpense({ id: `expense-${i + 1}` })
    );
    vi.mocked(prisma.expense.findMany).mockResolvedValue(expenses as never);

    const result = await listExpenses({ companyId: "company-1", limit: 50 });

    expect(result.data).toHaveLength(50);
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).toBe("expense-50");
  });
});

// ─── createExpense — recuperación TOCTOU del P2002 (auditoría LOW) ────────────
//
// El pre-check de idempotencia (`findFirst`) vive FUERA de la transacción, así
// que dos submits con la misma clave lo pasan LOS DOS: ambos leen `null` antes
// de que ninguno haya escrito. El `@@unique([companyId, idempotencyKey])` impide
// la doble escritura —eso nunca estuvo roto—, pero el perdedor de la carrera se
// llevaba "Ya existe un registro con esos datos" en vez de la fila que pidió:
// el contrato de idempotencia ("misma clave ⇒ misma respuesta") se rompía.
//
// La carrera se modela con un `db` mutable: el pre-check lo lee vacío y el
// `$transaction` inserta la fila del GANADOR justo antes de lanzar el P2002 —
// exactamente el intervalo del TOCTOU.
describe("createExpense — recuperación TOCTOU del P2002 de idempotencia", () => {
  const KEY = "123e4567-e89b-12d3-a456-426614174000";
  const COMPANY = "company-1";
  const OTHER_COMPANY = "company-ajena";

  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target },
    });

  // Forma REAL del target con el adaptador de Neon sobre @@unique compuesto.
  const IDEMPOTENCY_TARGET = ["companyId", "idempotencyKey"];

  // Fila que el ganador commiteó entre nuestro pre-check y nuestro INSERT.
  const winner = makeDbExpense({
    id: "expense-del-ganador",
    companyId: COMPANY,
    idempotencyKey: KEY,
    concept: "Servicio de internet",
    category: { name: "Servicios Básicos" },
  });

  const foreignWinner = makeDbExpense({
    id: "expense-de-otra-empresa",
    companyId: OTHER_COMPANY,
    idempotencyKey: KEY,
    concept: "Honorarios abogado — litigio",
    amount: new Decimal("999999"),
    amountVes: new Decimal("999999"),
    category: { name: "Honorarios Profesionales" },
  });

  let db: Array<Record<string, unknown>>;

  /** Hace que el $transaction inserte `row` en el `db` y luego lance `err`. */
  function raceThenThrow(row: Record<string, unknown> | null, err: unknown) {
    vi.mocked(prisma.$transaction).mockImplementation((async () => {
      if (row) db.push(row);
      throw err;
    }) as never);
  }

  beforeEach(() => {
    db = [];
    vi.mocked(prisma.expenseCategory.findFirstOrThrow).mockResolvedValue({ id: "cat-1" } as never);
    vi.mocked(prisma.expense.findFirst).mockReset();
    vi.mocked(prisma.expense.findFirst).mockImplementation(fakeFindFirst(db) as never);
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("devuelve la fila del ganador en vez de propagar el P2002 (misma clave ⇒ misma respuesta)", async () => {
    raceThenThrow(winner, p2002(IDEMPOTENCY_TARGET));

    const result = await createExpense(
      makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }),
      "user-perdedor"
    );

    expect(result.id).toBe("expense-del-ganador");
    expect(result.categoryName).toBe("Servicios Básicos");
    // Dos lecturas: el pre-check (vacío) y la recuperación del catch.
    expect(vi.mocked(prisma.expense.findFirst)).toHaveBeenCalledTimes(2);
    // Y se intentó crear una sola vez — no reintenta a ciegas.
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1);
  });

  it("el findFirst de recuperación va acotado por companyId (ADR-004)", async () => {
    raceThenThrow(winner, p2002(IDEMPOTENCY_TARGET));

    await createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor");

    const recoveryWhere = vi.mocked(prisma.expense.findFirst).mock.calls[1]![0]!.where!;
    expect(recoveryWhere).toEqual({ idempotencyKey: KEY, companyId: COMPANY });
    expect(Object.keys(recoveryWhere)).toContain("companyId");
  });

  it("NO devuelve la fila de otra empresa que reusó la clave — relanza el P2002", async () => {
    // El `@@unique` es compuesto, así que este choque no puede pasar en la BD real;
    // el test blinda el `where` de la recuperación: si alguien le quita el
    // companyId, la fila ajena hace match y se devuelve al cliente equivocado.
    const err = p2002(IDEMPOTENCY_TARGET);
    raceThenThrow(foreignWinner, err);

    await expect(
      createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor")
    ).rejects.toBe(err);
  });

  it("P2002 de OTRO constraint se relanza aunque exista una fila con esa clave", async () => {
    const err = p2002(["transactionId"]);
    raceThenThrow(winner, err); // la fila existe: lo que decide es el target, no el hallazgo

    await expect(
      createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor")
    ).rejects.toBe(err);
    // No se consultó la recuperación: solo hubo el pre-check.
    expect(vi.mocked(prisma.expense.findFirst)).toHaveBeenCalledTimes(1);
  });

  it("P2002 sin `meta.target` se relanza (fail-closed)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: {},
    });
    raceThenThrow(winner, err);

    await expect(
      createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor")
    ).rejects.toBe(err);
  });

  it("un error que no es P2002 se relanza intacto — no se disfraza de idempotencia", async () => {
    const err = new Error("El período contable está CERRADO");
    raceThenThrow(winner, err);

    await expect(
      createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor")
    ).rejects.toBe(err);
    expect(vi.mocked(prisma.expense.findFirst)).toHaveBeenCalledTimes(1);
  });

  it("P2002 de idempotencyKey pero sin fila recuperable → relanza (no inventa respuesta)", async () => {
    const err = p2002(IDEMPOTENCY_TARGET);
    raceThenThrow(null, err); // el `db` sigue vacío: la recuperación no encuentra nada

    await expect(
      createExpense(makeCreateInput({ companyId: COMPANY, idempotencyKey: KEY }), "user-perdedor")
    ).rejects.toBe(err);
    expect(vi.mocked(prisma.expense.findFirst)).toHaveBeenCalledTimes(2);
  });
});
