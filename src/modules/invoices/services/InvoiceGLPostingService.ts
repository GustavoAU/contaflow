// src/modules/invoices/services/InvoiceGLPostingService.ts
// ADR-026: Causación automática de facturas al Libro Mayor
//
// Convención JournalEntry: positivo = Débito, negativo = Crédito
//
// VENTA:  Dr CxC (totalAmountVes) | Cr Ingresos (base) + Cr IVA-DF (iva)
// COMPRA: Dr Gasto (base) + Dr IVA-CF (iva) | Cr Proveedores (totalAmountVes)
//
// Invariante: Σ entries = 0 (totalAmountVes = Σ base + Σ iva por diseño de InvoiceService)

import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

export interface InvoiceGLConfig {
  arAccountId: string | null;
  apAccountId: string | null;
  salesAccountId: string | null;
  purchaseExpenseAccountId: string | null;
  ivaDFAccountId: string | null;
  ivaCFAccountId: string | null;
}

export interface InvoiceForGL {
  id: string;
  type: "SALE" | "PURCHASE";
  invoiceNumber: string;
  counterpartName: string;
  date: Date;
  periodId: string | null;
  totalAmountVes: Decimal | null;
  taxLines: Array<{ taxType: string; base: Decimal; amount: Decimal }>;
}

export class InvoiceGLPostingService {
  static canPost(invoiceType: "SALE" | "PURCHASE", config: InvoiceGLConfig): boolean {
    if (invoiceType === "SALE") {
      return !!(config.arAccountId && config.salesAccountId && config.ivaDFAccountId);
    }
    return !!(config.apAccountId && config.purchaseExpenseAccountId && config.ivaCFAccountId);
  }

  static async postInvoice(
    invoice: InvoiceForGL,
    config: InvoiceGLConfig,
    companyId: string,
    userId: string,
    db: Prisma.TransactionClient
  ): Promise<string> {
    const total = new Decimal(invoice.totalAmountVes?.toString() ?? "0");
    const baseTotal = invoice.taxLines.reduce(
      (s, tl) => s.plus(new Decimal(tl.base.toString())),
      new Decimal(0)
    );
    const ivaTotal = invoice.taxLines.reduce(
      (s, tl) => s.plus(new Decimal(tl.amount.toString())),
      new Decimal(0)
    );

    const desc = `Causación ${invoice.type === "SALE" ? "venta" : "compra"} — ${invoice.invoiceNumber} (${invoice.counterpartName})`;

    let entries: Array<{ accountId: string; amount: Decimal; description: string }>;

    if (invoice.type === "SALE") {
      entries = [
        { accountId: config.arAccountId!, amount: total, description: `${desc} — CxC` },
        { accountId: config.salesAccountId!, amount: baseTotal.negated(), description: `${desc} — ingresos` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: config.ivaDFAccountId!, amount: ivaTotal.negated(), description: `${desc} — IVA débito fiscal` });
      }
    } else {
      entries = [
        { accountId: config.purchaseExpenseAccountId!, amount: baseTotal, description: `${desc} — gasto/costo` },
        { accountId: config.apAccountId!, amount: total.negated(), description: `${desc} — CxP` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: config.ivaCFAccountId!, amount: ivaTotal, description: `${desc} — IVA crédito fiscal` });
      }
    }

    // Verificación de cuadre (modo paranoico — ADR-026)
    const sum = entries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
    if (sum.abs().greaterThan(new Decimal("0.01"))) {
      throw new Error(`InvoiceGLPosting: asiento desbalanceado (suma = ${sum.toFixed(4)}, factura ${invoice.invoiceNumber})`);
    }

    const prefix = invoice.type === "SALE" ? "FAC" : "CMP";
    const glTx = await db.transaction.create({
      data: {
        companyId,
        number: `${prefix}-${invoice.invoiceNumber}`,
        date: invoice.date,
        description: desc,
        reference: invoice.id,
        userId,
        periodId: invoice.periodId ?? undefined,
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

    await db.invoice.update({
      where: { id: invoice.id },
      data: { transactionId: glTx.id },
    });

    return glTx.id;
  }
}
