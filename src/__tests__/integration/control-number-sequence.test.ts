// src/__tests__/integration/control-number-sequence.test.ts
//
// @integration — requiere DATABASE_URL_TEST apuntando a una DB de test aislada.
// Verificación: dos llamadas concurrentes a getNextControlNumber para la misma
// empresa nunca retornan el mismo número (Serializable isolation).
//
// Correr con:
//   DATABASE_URL_TEST=postgresql://... npx vitest run --config vitest.integration.config.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getNextControlNumber } from "@/modules/invoices/services/InvoiceSequenceService";

// Enum local — evita importar de @prisma/client en tests de integración sin generate
const InvoiceType = { SALE: "SALE", PURCHASE: "PURCHASE" } as const;
type InvoiceType = (typeof InvoiceType)[keyof typeof InvoiceType];

const DB_URL = process.env.DATABASE_URL_TEST;

// Skip the entire suite if no test DB is configured — safe for local dev and CI without DB
describe.skipIf(!DB_URL)("@integration control-number-sequence", () => {
  let prisma: PrismaClient;
  const COMPANY_ID = `integration-test-${Date.now()}`;

  beforeAll(async () => {
    if (!DB_URL) return;
    const adapter = new PrismaPg({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    // Cleanup: remove test data so repeated runs stay idempotent
    await prisma.controlNumberSequence.deleteMany({
      where: { companyId: COMPANY_ID },
    });
    await prisma.$disconnect();
  });

  it("dos llamadas secuenciales retornan números distintos", async () => {
    const n1 = await prisma.$transaction(
      (tx) => getNextControlNumber(tx, COMPANY_ID, InvoiceType.SALE),
      { isolationLevel: "Serializable" },
    );
    const n2 = await prisma.$transaction(
      (tx) => getNextControlNumber(tx, COMPANY_ID, InvoiceType.SALE),
      { isolationLevel: "Serializable" },
    );
    expect(n1).not.toBe(n2);
    expect(n1).toMatch(/^00-\d{8}$/);
    expect(n2).toMatch(/^00-\d{8}$/);
  });

  it("llamadas concurrentes nunca retornan el mismo número", async () => {
    // Lanza 5 transacciones en paralelo — sin Serializable habría colisión
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction(
          (tx) => getNextControlNumber(tx, COMPANY_ID, InvoiceType.SALE),
          { isolationLevel: "Serializable" },
        ),
      ),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(5); // todos distintos
    results.forEach((n) => expect(n).toMatch(/^00-\d{8}$/));
  });

  it("tipos distintos (SALE vs PURCHASE) tienen secuencias independientes", async () => {
    const sale = await prisma.$transaction(
      (tx) => getNextControlNumber(tx, COMPANY_ID, InvoiceType.SALE),
      { isolationLevel: "Serializable" },
    );
    const purchase = await prisma.$transaction(
      (tx) => getNextControlNumber(tx, COMPANY_ID, InvoiceType.PURCHASE),
      { isolationLevel: "Serializable" },
    );
    // Cada tipo tiene su propia secuencia — no interfieren entre sí
    expect(sale).not.toBe(purchase);
  });
});
