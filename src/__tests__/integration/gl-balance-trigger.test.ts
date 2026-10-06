// src/__tests__/integration/gl-balance-trigger.test.ts
//
// @integration — requiere DATABASE_URL_TEST apuntando a una DB de test aislada.
// SPEC-001 / ADR-060: el trigger de cuadre (`trg_journalentry_balance`) debe rechazar, al COMMIT,
// cualquier asiento cuya suma no sea EXACTAMENTE 0. Un trigger no se puede probar con mocks: solo
// Postgres real (en CI, branch efímero de Neon con TODAS las migraciones aplicadas desde cero).
//
// Cubre CA-2..CA-6 de la spec y comprueba, contra la forma REAL del error que entrega Prisma con
// adapter-pg, que `isUnbalancedEntryError` lo reconoce y que `toActionError` devuelve el mensaje de
// negocio (nunca el error crudo del motor). La forma con el adaptador de Neon (producción) es otra:
// el detector recorre el error entero (ver prisma-errors.unbalanced.test.ts).
//
// Correr con:
//   DATABASE_URL_TEST=postgresql://... npx vitest run --config vitest.integration.config.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isUnbalancedEntryError, UNBALANCED_ENTRY_MESSAGE } from "@/lib/prisma-errors";
import { toActionError } from "@/lib/action-errors";

const DB_URL = process.env.DATABASE_URL_TEST;

describe.skipIf(!DB_URL)("@integration gl-balance-trigger (SPEC-001)", () => {
  let prisma: PrismaClient;
  const COMPANY_ID = `integration-glbt-${Date.now()}`;
  const ACCOUNT_A = `${COMPANY_ID}-a`;
  const ACCOUNT_B = `${COMPANY_ID}-b`;
  let counter = 0;
  const nextNumber = () => `GLBT-${++counter}`;

  /** Rechazo esperado: devuelve el error para inspeccionarlo (falla el test si NO rechaza). */
  async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error("Se esperaba que el commit fuera rechazado por el trigger de cuadre");
  }

  /** Crea un asiento cuadrado en una transacción aparte y devuelve el id y los de sus líneas. */
  async function balanced(amount = "250.00") {
    const t = await prisma.transaction.create({
      data: {
        number: nextNumber(),
        description: "integration gl-balance-trigger",
        companyId: COMPANY_ID,
        userId: "integration-user",
        entries: {
          create: [
            { accountId: ACCOUNT_A, amount },
            { accountId: ACCOUNT_B, amount: `-${amount}` },
          ],
        },
      },
      include: { entries: true },
    });
    return { id: t.id, number: t.number, lines: t.entries };
  }

  beforeAll(async () => {
    if (!DB_URL) return;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
    await prisma.$connect();
    await prisma.company.create({ data: { id: COMPANY_ID, name: "integration-glbt" } });
    for (const [id, code] of [
      [ACCOUNT_A, "9.1"],
      [ACCOUNT_B, "9.2"],
    ] as const) {
      await prisma.account.create({
        data: { id, name: `glbt-${code}`, code, type: "ASSET", companyId: COMPANY_ID },
      });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    // Orden por FKs (Restrict): líneas -> transacciones -> cuentas -> empresa. Borrar TODAS las líneas
    // de un asiento lo deja en 0, así que el trigger no se opone a la limpieza.
    await prisma.journalEntry.deleteMany({ where: { transaction: { companyId: COMPANY_ID } } });
    await prisma.transaction.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.account.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.company.deleteMany({ where: { id: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("CA-2: un asiento cuadrado insertado línea por línea dentro de un $transaction hace commit", async () => {
    const number = nextNumber();
    await prisma.$transaction(async (tx) => {
      const t = await tx.transaction.create({
        data: { number, description: "ca-2", companyId: COMPANY_ID, userId: "integration-user" },
      });
      // Estado intermedio descuadrado (solo el débito): el trigger es diferido, no debe quejarse aquí.
      await tx.journalEntry.create({
        data: { transactionId: t.id, accountId: ACCOUNT_A, amount: "100.0000" },
      });
      await tx.journalEntry.create({
        data: { transactionId: t.id, accountId: ACCOUNT_B, amount: "-100.0000" },
      });
    });
    const saved = await prisma.transaction.findFirst({
      where: { companyId: COMPANY_ID, number },
      include: { entries: true },
    });
    expect(saved?.entries).toHaveLength(2);
  });

  it("CA-3: un asiento descuadrado hace rollback completo (ni cabecera ni líneas)", async () => {
    const number = nextNumber();
    const error = await rejection(() =>
      prisma.transaction.create({
        data: {
          number,
          description: "ca-3",
          companyId: COMPANY_ID,
          userId: "integration-user",
          entries: {
            create: [
              { accountId: ACCOUNT_A, amount: "100.0000" },
              { accountId: ACCOUNT_B, amount: "-99.0000" },
            ],
          },
        },
      })
    );
    expect(isUnbalancedEntryError(error)).toBe(true);
    expect(await prisma.transaction.count({ where: { companyId: COMPANY_ID, number } })).toBe(0);
    expect(
      await prisma.journalEntry.count({
        where: { transaction: { companyId: COMPANY_ID, number } },
      })
    ).toBe(0);
  });

  it("T = 0: un descuadre de 0,0001 también se rechaza", async () => {
    const error = await rejection(() =>
      prisma.transaction.create({
        data: {
          number: nextNumber(),
          description: "t-cero",
          companyId: COMPANY_ID,
          userId: "integration-user",
          entries: {
            create: [
              { accountId: ACCOUNT_A, amount: "100.0000" },
              { accountId: ACCOUNT_B, amount: "-99.9999" },
            ],
          },
        },
      })
    );
    expect(isUnbalancedEntryError(error)).toBe(true);
  });

  it("CA-4: modificar el monto de una línea de modo que descuadre falla al commit", async () => {
    const { lines } = await balanced();
    const error = await rejection(() =>
      prisma.journalEntry.update({ where: { id: lines[0]!.id }, data: { amount: "250.0001" } })
    );
    expect(isUnbalancedEntryError(error)).toBe(true);
    const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: lines[0]!.id } });
    expect(after.amount.toString()).toBe("250");
  });

  it("CA-5: borrar una línea de un asiento cuadrado falla al commit", async () => {
    const { lines } = await balanced();
    const error = await rejection(() =>
      prisma.journalEntry.delete({ where: { id: lines[1]!.id } })
    );
    expect(isUnbalancedEntryError(error)).toBe(true);
    expect(await prisma.journalEntry.count({ where: { id: lines[1]!.id } })).toBe(1);
  });

  it("cambiar la descripción de una línea NO se valida (el trigger vigila amount y transactionId)", async () => {
    const { lines } = await balanced();
    await expect(
      prisma.journalEntry.update({ where: { id: lines[0]!.id }, data: { description: "nueva" } })
    ).resolves.toBeDefined();
  });

  it("RN-3: anular un asiento sigue sujeto al cuadre (el reverso cuadrado pasa; uno descuadrado no)", async () => {
    const { id, lines } = await balanced("80.00");
    // Reverso cuadrado
    await expect(
      prisma.transaction.create({
        data: {
          number: nextNumber(),
          description: `reverso de ${id}`,
          companyId: COMPANY_ID,
          userId: "integration-user",
          entries: {
            create: lines.map((l) => ({
              accountId: l.accountId,
              amount: l.amount.negated().toString(),
            })),
          },
        },
      })
    ).resolves.toBeDefined();
    // Reverso a medias (solo una pierna): descuadra
    const error = await rejection(() =>
      prisma.transaction.create({
        data: {
          number: nextNumber(),
          description: "reverso a medias",
          companyId: COMPANY_ID,
          userId: "integration-user",
          entries: { create: [{ accountId: lines[0]!.accountId, amount: "-80.0000" }] },
        },
      })
    );
    expect(isUnbalancedEntryError(error)).toBe(true);
  });

  it("una Transaction sin líneas no dispara el trigger", async () => {
    await expect(
      prisma.transaction.create({
        data: {
          number: nextNumber(),
          description: "sin líneas",
          companyId: COMPANY_ID,
          userId: "integration-user",
        },
      })
    ).resolves.toBeDefined();
  });

  it("CA-6: el error real que entrega Prisma se traduce al mensaje de negocio (no al crudo del motor)", async () => {
    const error = await rejection(() =>
      prisma.transaction.create({
        data: {
          number: nextNumber(),
          description: "ca-6",
          companyId: COMPANY_ID,
          userId: "integration-user",
          entries: { create: [{ accountId: ACCOUNT_A, amount: "5.0000" }] },
        },
      })
    );
    const result = toActionError(error);
    expect(result).toEqual({ success: false, error: UNBALANCED_ENTRY_MESSAGE });
    if (result.success) throw new Error("se esperaba un resultado de error");
    expect(result.error).not.toMatch(/CF001|transactionId|trigger/i);
  });
});
