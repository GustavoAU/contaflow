// src/modules/invoices/services/InvoiceGLPostingService.ts
// ADR-026: Causación automática de facturas al Libro Mayor
//
// Convención JournalEntry: positivo = Débito, negativo = Crédito
//
// VENTA:  Dr CxC (total) | Cr Ingresos (base) + Cr IVA-DF (iva)
//         Si ivaTotal = 0: desc incluye "Exento Art. 9 LIVA" (Error 3 dictamen SENIAT)
// COMPRA: Dr Inventario (base) + Dr IVA-CF (iva) | Cr Proveedores (total)
//         inventoryAccountId → ASSET 1115 (inventario perpetuo — Error 4 dictamen SENIAT)
//         InventoryAccountingService.postMovement(SALIDA) se encarga del Dr COGS / Cr Inventario
//         cuando la mercancía se vende, completando el ciclo perpetuo.
//
// Invariante: Σ entries = 0 (totalAmountVes = Σ base + Σ iva por diseño de InvoiceService)

import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

export interface InvoiceGLConfig {
  arAccountId: string | null;
  apAccountId: string | null;
  salesAccountId: string | null;
  purchaseExpenseAccountId: string | null; // legacy — inventario periódico (no usado en posting)
  inventoryAccountId: string | null;       // ASSET — Inventario de Mercancías (inventario perpetuo)
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
    // COMPRA: requiere inventoryAccountId (ASSET 1115) en lugar de purchaseExpenseAccountId
    return !!(config.apAccountId && config.inventoryAccountId && config.ivaCFAccountId);
  }

  static async postInvoice(
    invoice: InvoiceForGL,
    config: InvoiceGLConfig,
    companyId: string,
    userId: string,
    db: Prisma.TransactionClient
  ): Promise<string> {
    const total = new Decimal(invoice.totalAmountVes?.toString() ?? "0");
    const ivaTotal = invoice.taxLines.reduce(
      (s, tl) => s.plus(new Decimal(tl.amount.toString())),
      new Decimal(0)
    );
    // IVA_ADICIONAL de lujo comparte base con IVA_GENERAL — usar total−iva evita
    // doblar la base cuando hay múltiples líneas sobre el mismo monto gravable.
    const baseTotal = total.minus(ivaTotal);

    let desc = `Causación ${invoice.type === "SALE" ? "venta" : "compra"} — ${invoice.invoiceNumber} (${invoice.counterpartName})`;

    // Error 3 dictamen SENIAT: ventas sin IVA deben documentar la base legal
    // de la exención en la descripción del asiento para trazabilidad fiscal.
    if (invoice.type === "SALE" && ivaTotal.isZero()) {
      desc += " — Exento Art. 9 LIVA";
    }

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
      // COMPRA — inventario perpetuo (Error 4 dictamen SENIAT):
      // Dr Inventario (base) | Dr IVA-CF (iva) | Cr CxP (total)
      // El asiento Dr COGS / Cr Inventario ocurre en InventoryAccountingService.postMovement(SALIDA)
      entries = [
        { accountId: config.inventoryAccountId!, amount: baseTotal, description: `${desc} — inventario` },
        { accountId: config.apAccountId!, amount: total.negated(), description: `${desc} — CxP` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: config.ivaCFAccountId!, amount: ivaTotal, description: `${desc} — IVA crédito fiscal` });
      }
    }

    // Guarda semántica: base negativa indica totalAmountVes < ivaTotal (dato corrupto)
    if (baseTotal.lessThan(0)) {
      throw new Error(`InvoiceGLPosting: base negativa — totalAmountVes menor que IVA (factura ${invoice.invoiceNumber})`);
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
