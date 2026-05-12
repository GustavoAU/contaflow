// prisma/fix-payroll-balance.ts
// Corrige el asiento de nómina desbalanceado ID cmoad36ad001cu4uke2l1uej4
// Ajusta el crédito de "Sueldos por Pagar" para que Σ entries = 0
//
// Ejecutar: npx tsx prisma/fix-payroll-balance.ts

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const UNBALANCED_TX_ID = "cmoad36ad001cu4uke2l1uej4";

async function main() {
  // Verificar el desbalance actual
  const tx = await prisma.transaction.findUniqueOrThrow({
    where: { id: UNBALANCED_TX_ID },
    include: { entries: { include: { account: { select: { code: true, name: true } } } } },
  });

  console.log(`\nAsiento: ${tx.number} — ${tx.description}`);
  console.log(`${"─".repeat(70)}`);

  const currentSum = tx.entries.reduce(
    (s, e) => s.plus(new Decimal(e.amount.toString())),
    new Decimal(0),
  );
  console.log(`Desbalance actual: ${currentSum.toFixed(2)} Bs.\n`);

  // Encontrar la entrada de "Sueldos por Pagar" (el único crédito — negativo)
  // El asiento de nómina tiene UN débito (gastos) y UN crédito (sueldos por pagar)
  const creditEntry = tx.entries.find((e) => new Decimal(e.amount.toString()).lessThan(0));
  if (!creditEntry) {
    throw new Error("No se encontró la entrada de crédito");
  }

  const debitTotal = tx.entries
    .filter((e) => new Decimal(e.amount.toString()).greaterThan(0))
    .reduce((s, e) => s.plus(new Decimal(e.amount.toString())), new Decimal(0));

  const otherCredits = tx.entries
    .filter((e) => new Decimal(e.amount.toString()).lessThan(0) && e.id !== creditEntry.id)
    .reduce((s, e) => s.plus(new Decimal(e.amount.toString())), new Decimal(0));

  // El crédito correcto = -(debitTotal - |otherCredits|) = -(debitTotal + otherCredits)
  const correctCredit = debitTotal.plus(otherCredits).negated();

  console.log(`Débito total:        ${debitTotal.toFixed(2)} Bs.`);
  console.log(`Otros créditos:      ${otherCredits.toFixed(2)} Bs.`);
  console.log(`Crédito actual:      ${new Decimal(creditEntry.amount.toString()).toFixed(2)} Bs.`);
  console.log(`Crédito correcto:    ${correctCredit.toFixed(2)} Bs.`);
  console.log(`Cuenta:              ${creditEntry.account?.code} — ${creditEntry.account?.name}\n`);

  if (correctCredit.equals(new Decimal(creditEntry.amount.toString()))) {
    console.log("✅ El asiento ya está balanceado. No se requiere corrección.");
    return;
  }

  // Aplicar corrección
  await prisma.journalEntry.update({
    where: { id: creditEntry.id },
    data: { amount: correctCredit },
  });

  console.log(`✅ Corrección aplicada. Nuevo crédito: ${correctCredit.toFixed(2)} Bs.`);
  console.log(`   El asiento ahora está balanceado.`);
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
