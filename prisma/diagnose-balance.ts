// prisma/diagnose-balance.ts
// Diagnóstico de integridad del Balance General
// Ejecutar: npx tsx prisma/diagnose-balance.ts
//
// Busca transacciones desbalanceadas (suma de entries ≠ 0)
// y muestra el resumen por cuenta contable.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const COMPANY_RIF = "J-12345678-9"; // Ajustar si es necesario

async function main() {
  const company = await prisma.company.findUniqueOrThrow({ where: { rif: COMPANY_RIF } });
  const cId = company.id;
  console.log(`\nDiagnóstico: ${company.name}\n${"─".repeat(60)}`);

  // 1. Transacciones POSTED con suma de entries ≠ 0
  const transactions = await prisma.transaction.findMany({
    where: { companyId: cId, status: "POSTED" },
    include: { entries: { select: { amount: true } } },
  });

  const unbalanced: { id: string; number: string; description: string; sum: string }[] = [];

  for (const tx of transactions) {
    const sum = tx.entries.reduce(
      (acc, e) => acc.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );
    if (sum.abs().greaterThan(new Decimal("0.01"))) {
      unbalanced.push({ id: tx.id, number: tx.number, description: tx.description, sum: sum.toFixed(4) });
    }
  }

  if (unbalanced.length === 0) {
    console.log("✅ Todas las transacciones POSTED están balanceadas.");
  } else {
    console.log(`⚠️  ${unbalanced.length} transacción(es) DESBALANCEADA(S):\n`);
    for (const tx of unbalanced) {
      console.log(`  ID:   ${tx.id}`);
      console.log(`  #:    ${tx.number}`);
      console.log(`  Desc: ${tx.description}`);
      console.log(`  Suma: ${tx.sum} Bs. (debería ser 0.0000)`);
      console.log();
    }
  }

  // 2. Resumen por tipo de cuenta — verificar que Activos = Pasivos + Patrimonio + Resultado
  const accounts = await prisma.account.findMany({
    where: { companyId: cId },
    include: {
      journalEntries: {
        where: { transaction: { status: "POSTED" } },
        select: { amount: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const totals: Record<string, Decimal> = {
    ASSET: new Decimal(0),
    CONTRA_ASSET: new Decimal(0),
    LIABILITY: new Decimal(0),
    EQUITY: new Decimal(0),
    REVENUE: new Decimal(0),
    EXPENSE: new Decimal(0),
  };

  for (const acc of accounts) {
    if (acc.journalEntries.length === 0) continue;
    const bal = acc.journalEntries.reduce(
      (s, e) => s.plus(new Decimal(e.amount.toString())),
      new Decimal(0),
    );
    totals[acc.type] = totals[acc.type].plus(bal);
  }

  const grandSum = Object.values(totals).reduce((s, v) => s.plus(v), new Decimal(0));

  console.log("─".repeat(60));
  console.log("Suma de saldos por tipo de cuenta (debe ser 0 si está balanceado):\n");
  for (const [type, val] of Object.entries(totals)) {
    console.log(`  ${type.padEnd(15)} ${val.toFixed(2).padStart(15)} Bs.`);
  }
  console.log("─".repeat(40));
  console.log(`  ${"TOTAL".padEnd(15)} ${grandSum.toFixed(2).padStart(15)} Bs.`);

  if (grandSum.abs().lessThan(new Decimal("0.02"))) {
    console.log("\n✅ Ecuación contable cuadrada (Σ = 0)");
  } else {
    console.log(`\n⚠️  Desfase total: ${grandSum.toFixed(2)} Bs.`);
  }
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
