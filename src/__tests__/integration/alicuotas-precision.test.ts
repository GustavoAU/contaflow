// src/__tests__/integration/alicuotas-precision.test.ts
//
// @integration — requiere DATABASE_URL_TEST apuntando a una DB de test aislada (job `integration`
// del CI, branch efímero de Neon con TODAS las migraciones aplicadas desde cero).
//
// SPEC-006: el salario diario y las alícuotas de prestaciones se guardan con todos sus decimales
// (contadora, 2026-10-04: "0,12353 tal cual"). El código guarda 8 decimales; si la columna siguiera
// en DECIMAL(19,4), Postgres los recortaría en silencio. Este test comprueba el contrato REAL de la
// base de datos: precisión 19 y escala 8 en las 7 columnas de snapshot.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DB_URL = process.env.DATABASE_URL_TEST;

const COLUMNAS: Array<[table: string, column: string]> = [
  ["BenefitAccrualLine", "dailyNormalWage"],
  ["BenefitAccrualLine", "profitDaysAliquot"],
  ["BenefitAccrualLine", "vacationBonusDaysAliquot"],
  ["BenefitAccrualLine", "integralDailyWage"],
  ["VacationRecord", "dailyNormalWage"],
  ["ProfitSharingRecord", "baseSalarySnapshot"],
  ["Termination", "profitSharingBaseSalary"],
];

describe.skipIf(!DB_URL)("@integration alicuotas-precision (SPEC-006)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!DB_URL) return;
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$disconnect();
  });

  it.each(COLUMNAS)("%s.%s es NUMERIC(19,8)", async (table, column) => {
    const rows = await prisma.$queryRaw<
      Array<{ numeric_precision: number; numeric_scale: number }>
    >`SELECT numeric_precision, numeric_scale
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].numeric_precision)).toBe(19);
    expect(Number(rows[0].numeric_scale)).toBe(8);
  });

  it("un valor con 5 decimales (0,12353) se guarda y se lee tal cual en una columna NUMERIC(19,8)", async () => {
    // Misma definición de tipo que las columnas de snapshot; sin FKs que montar.
    const rows = await prisma.$queryRaw<Array<{ v: string }>>`
      SELECT (CAST('0.12353' AS NUMERIC(19,8)))::text AS v`;
    expect(rows[0].v).toBe("0.12353000");
    // y con el tipo VIEJO se perdía el quinto decimal:
    const viejo = await prisma.$queryRaw<Array<{ v: string }>>`
      SELECT (CAST('0.12353' AS NUMERIC(19,4)))::text AS v`;
    expect(viejo[0].v).toBe("0.1235");
  });
});
