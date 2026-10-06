// src/__tests__/integration/gl-quantize-balance.test.ts
//
// @integration — requiere DATABASE_URL_TEST apuntando a una DB de test aislada.
// ADR-058 / SPEC-004 paso 3 (TDD, RED): lo que se GUARDA en JournalEntry (Decimal(19,4))
// debe sumar exactamente 0. Sin cuantizar, el caso real de produccion se guarda con
// Σ = -0.0001; cuantizado con quantizeGLEntries, Σ = 0 y cada monto es multiplo de 0.01.
//
// SPEC-001: desde el trigger de cuadre (trg_journalentry_balance, T = 0) un asiento que se guarde con
// Σ ≠ 0 YA NO PUEDE llegar a la BD: el caso (i-a) pasó de "demuestra el defecto" a "el defecto está
// bloqueado". Los casos cuantizados (i-b) y (ii) siguen siendo la prueba de que el camino correcto
// guarda Σ = 0.
//
// Correr con:
//   DATABASE_URL_TEST=postgresql://... npx vitest run --config vitest.integration.config.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import { quantizeGLEntries } from "@/lib/gl-assertions";
import { isUnbalancedEntryError } from "@/lib/prisma-errors";

const DB_URL = process.env.DATABASE_URL_TEST;

// Caso real de produccion: Σ bruta exactamente -0.0001.
const REAL_CASE = [
  "6268062.4567",
  "272234.5159",
  "-46.7971",
  "-93.5943",
  "-140.3914",
  "-280.7828",
  "-71958.3900",
  "-127912.1608",
  "-143901.1809",
  "-194988.0500",
  "-6000975.6254",
];

describe.skipIf(!DB_URL)("@integration gl-quantize-balance", () => {
  let prisma: PrismaClient;
  const COMPANY_ID = `integration-glq-${Date.now()}`;
  const ACCOUNT_IDS = [`${COMPANY_ID}-a1`, `${COMPANY_ID}-a2`, `${COMPANY_ID}-a3`];
  let txCounter = 0;

  /** Persiste las lineas tal cual (sin tocarlas) en una Transaction nueva y devuelve su id. */
  async function persist(lines: { amount: Decimal }[]): Promise<string> {
    txCounter++;
    const tx = await prisma.transaction.create({
      data: {
        number: `GLQ-${txCounter}`,
        description: "integration gl-quantize-balance",
        companyId: COMPANY_ID,
        userId: "integration-user",
        entries: {
          create: lines.map((l, i) => ({
            amount: l.amount.toString(),
            accountId: ACCOUNT_IDS[i % ACCOUNT_IDS.length]!,
          })),
        },
      },
    });
    return tx.id;
  }

  /** Σ de lo que quedo guardado, leida de la BD (no recalculada en memoria). */
  async function storedSum(transactionId: string): Promise<Decimal> {
    const agg = await prisma.journalEntry.aggregate({
      where: { transactionId },
      _sum: { amount: true },
    });
    return new Decimal(agg._sum.amount?.toString() ?? "0");
  }

  async function storedAmounts(transactionId: string): Promise<Decimal[]> {
    const rows = await prisma.journalEntry.findMany({ where: { transactionId } });
    return rows.map((r) => new Decimal(r.amount.toString()));
  }

  beforeAll(async () => {
    if (!DB_URL) return;
    const adapter = new PrismaPg({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
    await prisma.company.create({ data: { id: COMPANY_ID, name: "integration-glq" } });
    for (const [i, id] of ACCOUNT_IDS.entries()) {
      await prisma.account.create({
        data: {
          id,
          name: `glq-${i}`,
          code: `9.${i}`,
          type: "ASSET",
          companyId: COMPANY_ID,
        },
      });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    // Orden por FKs (Restrict): lineas -> transacciones -> cuentas -> empresa.
    await prisma.journalEntry.deleteMany({ where: { transaction: { companyId: COMPANY_ID } } });
    await prisma.transaction.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.account.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.company.deleteMany({ where: { id: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("(i-a) el defecto está BLOQUEADO: las 11 lineas reales SIN cuantizar (Σ = -0.0001) las rechaza el trigger de cuadre", async () => {
    const lines = REAL_CASE.map((v) => ({ amount: new Decimal(v) }));
    const error = await persist(lines).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).not.toBeNull();
    expect(isUnbalancedEntryError(error)).toBe(true);
  });

  it("(i-b) las 11 lineas reales cuantizadas se guardan con Σ = 0 y montos multiplos de 0.01", async () => {
    const quantized = quantizeGLEntries(REAL_CASE.map((v) => ({ amount: new Decimal(v) })));
    const id = await persist(quantized.entries);

    const total = await storedSum(id);
    expect(total.isZero()).toBe(true);

    const amounts = await storedAmounts(id);
    expect(amounts).toHaveLength(REAL_CASE.length);
    for (const a of amounts) expect(a.times(100).isInteger()).toBe(true);
  });

  it("(ii) asiento USD x tasa 779.9522: tras quantizeGLEntries la Σ leida de la BD es 0", async () => {
    const RATE = new Decimal("779.9522");
    const usd = ["1000.10", "250.35", "99.99", "1333.33", "0.07"];
    const debits = usd.map((v) => ({ amount: new Decimal(v).times(RATE) }));
    const total = debits.reduce((a, l) => a.plus(l.amount), new Decimal(0));
    // Una sola linea de HABER por el total exacto (Σ bruta = 0, pero con 4+ decimales).
    const raw = [...debits, { amount: total.negated() }];

    const quantized = quantizeGLEntries(raw);
    const id = await persist(quantized.entries);

    expect((await storedSum(id)).isZero()).toBe(true);
    for (const a of await storedAmounts(id)) expect(a.times(100).isInteger()).toBe(true);
  });
});
