// prisma/fix-invoice-gl.ts
// Crea asientos contables para facturas existentes sin transactionId (ADR-026)
// Usa la config GL de CompanySettings para cada empresa.
//
// Ejecutar: npx tsx prisma/fix-invoice-gl.ts

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import pg from "pg";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const COMPANY_RIF = "J-12345678-9";
const SYSTEM_USER_ID = "system-gl-backfill";

async function main() {
  const company = await prisma.company.findUniqueOrThrow({ where: { rif: COMPANY_RIF } });
  const cId = company.id;
  console.log(`\nBackfill GL: ${company.name}\n${"─".repeat(60)}`);

  // 1. Leer config GL
  const settings = await prisma.companySettings.findUnique({
    where: { companyId: cId },
    select: {
      arAccountId: true,
      apAccountId: true,
      salesAccountId: true,
      purchaseExpenseAccountId: true,
      ivaDFAccountId: true,
      ivaCFAccountId: true,
    },
  });

  if (!settings) {
    console.error("❌ CompanySettings no encontrado. Ejecutar seed-demo.ts primero.");
    process.exit(1);
  }

  const hasFullSaleConfig = !!(settings.arAccountId && settings.salesAccountId && settings.ivaDFAccountId);
  const hasFullPurchaseConfig = !!(settings.apAccountId && settings.purchaseExpenseAccountId && settings.ivaCFAccountId);

  console.log(`Config VENTA:  ${hasFullSaleConfig ? "✅" : "❌ incompleta"}`);
  console.log(`Config COMPRA: ${hasFullPurchaseConfig ? "✅" : "❌ incompleta"}\n`);

  // 2. Facturas sin asiento
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: cId,
      transactionId: null,
      deletedAt: null,
      type: { in: ["SALE", "PURCHASE"] },
    },
    include: {
      taxLines: { select: { taxType: true, base: true, amount: true } },
      period: { select: { id: true } },
    },
    orderBy: { date: "asc" },
  });

  if (invoices.length === 0) {
    console.log("✅ No hay facturas sin asiento contable.");
    return;
  }

  console.log(`⚠️  ${invoices.length} factura(s) sin asiento contable:\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const inv of invoices) {
    const prefix = inv.type === "SALE" ? "FAC" : "CMP";
    const typeLabel = inv.type === "SALE" ? "VENTA" : "COMPRA";

    if (inv.type === "SALE" && !hasFullSaleConfig) {
      console.log(`  ⏭️  ${prefix}-${inv.invoiceNumber} — config VENTA incompleta`);
      skipped++;
      continue;
    }
    if (inv.type === "PURCHASE" && !hasFullPurchaseConfig) {
      console.log(`  ⏭️  ${prefix}-${inv.invoiceNumber} — config COMPRA incompleta`);
      skipped++;
      continue;
    }

    const total = new Decimal(inv.totalAmountVes?.toString() ?? "0");
    const baseTotal = inv.taxLines.reduce((s, tl) => s.plus(new Decimal(tl.base.toString())), new Decimal(0));
    const ivaTotal = inv.taxLines.reduce((s, tl) => s.plus(new Decimal(tl.amount.toString())), new Decimal(0));
    const desc = `Causación ${inv.type === "SALE" ? "venta" : "compra"} — ${inv.invoiceNumber} (${inv.counterpartName})`;

    let entries: Array<{ accountId: string; amount: Decimal; description: string }>;

    if (inv.type === "SALE") {
      entries = [
        { accountId: settings.arAccountId!, amount: total, description: `${desc} — CxC` },
        { accountId: settings.salesAccountId!, amount: baseTotal.negated(), description: `${desc} — ingresos` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: settings.ivaDFAccountId!, amount: ivaTotal.negated(), description: `${desc} — IVA débito fiscal` });
      }
    } else {
      entries = [
        { accountId: settings.purchaseExpenseAccountId!, amount: baseTotal, description: `${desc} — gasto/costo` },
        { accountId: settings.apAccountId!, amount: total.negated(), description: `${desc} — CxP` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: settings.ivaCFAccountId!, amount: ivaTotal, description: `${desc} — IVA crédito fiscal` });
      }
    }

    const sum = entries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
    if (sum.abs().greaterThan(new Decimal("0.01"))) {
      console.log(`  ❌ ${prefix}-${inv.invoiceNumber} — asiento desbalanceado (suma = ${sum.toFixed(4)})`);
      errors++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Verificar que el número de transacción no exista ya
        const numExists = await tx.transaction.findUnique({
          where: { companyId_number: { companyId: cId, number: `${prefix}-${inv.invoiceNumber}` } },
          select: { id: true },
        });
        if (numExists) {
          // Vincular la existente sin crear duplicado
          await tx.invoice.update({
            where: { id: inv.id },
            data: { transactionId: numExists.id },
          });
          return;
        }

        const glTx = await tx.transaction.create({
          data: {
            companyId: cId,
            number: `${prefix}-${inv.invoiceNumber}`,
            date: inv.date,
            description: desc,
            reference: inv.id,
            userId: SYSTEM_USER_ID,
            periodId: inv.period?.id ?? undefined,
            type: "DIARIO",
            entries: {
              create: entries.map((e) => ({
                accountId: e.accountId,
                amount: e.amount,
                description: e.description,
              })),
            },
          },
        });

        await tx.invoice.update({
          where: { id: inv.id },
          data: { transactionId: glTx.id },
        });
      });

      console.log(`  ✅ ${typeLabel} ${inv.invoiceNumber} — ${total.toFixed(2)} Bs. → asiento creado`);
      created++;
    } catch (err) {
      console.error(`  ❌ ${prefix}-${inv.invoiceNumber} — error:`, err);
      errors++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Creados: ${created} | Saltados: ${skipped} | Errores: ${errors}`);

  if (errors > 0) {
    console.log("\n⚠️  Algunos asientos no pudieron crearse. Revisar los errores arriba.");
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error("Error:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
