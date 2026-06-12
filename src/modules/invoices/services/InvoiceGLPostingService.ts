// src/modules/invoices/services/InvoiceGLPostingService.ts
// ADR-026: Causación automática de facturas al Libro Mayor
//
// Convención JournalEntry: positivo = Débito, negativo = Crédito
//
// VENTA:  Dr CxC (total+IGTF) | Cr Ingresos (base) + Cr IVA-DF (iva) [+ Cr IGTF por Enterar]
//         Si ivaTotal = 0: desc incluye "Exento Art. 9 LIVA" (Error 3 dictamen SENIAT)
//         H-6: si igtfAmount > 0 y igtfPayableAccountId configurado:
//           Dr CxC se amplía con igtfAmount | Cr IGTF Percibido por Enterar
//           Si igtfPayableAccountId es null → asiento IGTF omitido, registra IGTF_GL_SKIPPED
// COMPRA: Dr Inventario (base) + Dr IVA-CF (iva) | Cr Proveedores (neto) [+ Cr Ret.IVA si aplica]
//         inventoryAccountId → ASSET 1115 (inventario perpetuo — Error 4 dictamen SENIAT)
//         InventoryAccountingService.postMovement(SALIDA) se encarga del Dr COGS / Cr Inventario
//         cuando la mercancía se vende, completando el ciclo perpetuo.
//         GAP-03: si ivaRetentionPayableAccountId está configurado y existen retenciones IVA
//         vinculadas a la factura, el Cr a Proveedores se fracciona:
//           Cr Proveedores = total - Σ ivaRetention   (lo que efectivamente se paga al proveedor)
//           Cr Ret.IVA p.p. = Σ ivaRetention          (obligación por enterar al SENIAT)
//
// Invariante: Σ entries = 0 (totalAmountVes = Σ base + Σ iva por diseño de InvoiceService)

import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

export interface InvoiceGLConfig {
  arAccountId: string | null;
  apAccountId: string | null;
  salesAccountId: string | null;
  purchaseExpenseAccountId: string | null; // legacy — inventario periódico (no usado en posting)
  inventoryAccountId: string | null;       // ASSET — Inventario de Mercancías (inventario perpetuo)
  ivaDFAccountId: string | null;
  ivaCFAccountId: string | null;
  ivaRetentionPayableAccountId: string | null; // LIABILITY — Retenciones IVA p.p. (GAP-03)
  igtfPayableAccountId: string | null;         // H-6 — IGTF Percibido por Enterar (ADR-030)
}

export interface InvoiceForGL {
  id: string;
  type: "SALE" | "PURCHASE";
  docType?: string;
  invoiceNumber: string;
  counterpartName: string;
  date: Date;
  periodId: string | null;
  totalAmountVes: Decimal | null;
  taxLines: Array<{ taxType: string; base: Decimal; amount: Decimal }>;
  // NIC 21: tasa de conversión para enriquecer descripción del asiento (ALERTA 1)
  currency?: string;
  exchangeRateVes?: Decimal | null;
  // H-6: IGTF percibido en ventas en divisas (Decreto Constituyente IGTF 2022)
  igtfAmount?: Decimal | null;
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
    return await Sentry.startSpan(
      {
        name: "invoice.gl_post",
        op: "db.transaction",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.invoice_type": invoice.type,
          "contaflow.invoice_number": invoice.invoiceNumber,
        },
      },
      async () => this._postInvoiceInner(invoice, config, companyId, userId, db, false)
    );
  }

  // Fix A2 (ADR-007 addendum): GL reverso para Notas de Crédito.
  // Niega todos los signos del asiento original — Σ entries = 0 se mantiene.
  // NC VENTA:  Cr CxC | Dr Ingresos | Dr IVA-DF  (inverso de postInvoice SALE)
  // NC COMPRA: Dr CxP | Cr Inventario | Cr IVA-CF (inverso de postInvoice PURCHASE)
  static async postCreditNote(
    creditNote: InvoiceForGL,
    config: InvoiceGLConfig,
    companyId: string,
    userId: string,
    db: Prisma.TransactionClient
  ): Promise<string> {
    return await Sentry.startSpan(
      {
        name: "invoice.gl_post_credit_note",
        op: "db.transaction",
        attributes: {
          "contaflow.company_id": companyId,
          "contaflow.invoice_type": creditNote.type,
          "contaflow.invoice_number": creditNote.invoiceNumber,
        },
      },
      async () => this._postInvoiceInner(creditNote, config, companyId, userId, db, true)
    );
  }

  private static async _postInvoiceInner(
    invoice: InvoiceForGL,
    config: InvoiceGLConfig,
    companyId: string,
    userId: string,
    db: Prisma.TransactionClient,
    isReversal: boolean = false
  ): Promise<string> {
    const total = new Decimal(invoice.totalAmountVes?.toString() ?? "0");
    const ivaTotal = invoice.taxLines.reduce(
      (s, tl) => s.plus(new Decimal(tl.amount.toString())),
      new Decimal(0)
    );
    // IVA_ADICIONAL de lujo comparte base con IVA_GENERAL — usar total−iva evita
    // doblar la base cuando hay múltiples líneas sobre el mismo monto gravable.
    const baseTotal = total.minus(ivaTotal);

    // H-6: IGTF percibido — tributo separado del IVA (Decreto Constituyente IGTF 2022)
    const igtfAmount = invoice.igtfAmount && invoice.igtfAmount.greaterThan(0)
      ? new Decimal(invoice.igtfAmount.toString())
      : new Decimal(0);

    let desc = `Causación ${invoice.type === "SALE" ? "venta" : "compra"} — ${invoice.invoiceNumber} (${invoice.counterpartName})`;

    // NIC 21: documentar conversión en facturas emitidas en moneda extranjera (ALERTA 1)
    if (invoice.currency && invoice.currency !== "VES" && invoice.exchangeRateVes?.greaterThan(0)) {
      const originalTotal = total.div(invoice.exchangeRateVes).toDecimalPlaces(2);
      desc += ` — ${invoice.currency} ${originalTotal.toFixed(2)} × ${invoice.exchangeRateVes.toFixed(4)} Bs/${invoice.currency} = Bs. ${total.toFixed(2)}`;
    }

    // Error 3 dictamen SENIAT: ventas sin IVA deben documentar la base legal
    // de la exención en la descripción del asiento para trazabilidad fiscal.
    if (invoice.type === "SALE" && ivaTotal.isZero()) {
      desc += " — Exento Art. 9 LIVA";
    }

    let entries: Array<{ accountId: string; amount: Decimal; description: string }>;

    if (invoice.type === "SALE") {
      // H-6: CxC incluye IGTF cuando aplica (total + igtf es el total exigible al cliente)
      const arAmount = igtfAmount.greaterThan(0) && config.igtfPayableAccountId
        ? total.plus(igtfAmount)
        : total;

      entries = [
        { accountId: config.arAccountId!, amount: arAmount, description: `${desc} — CxC` },
        { accountId: config.salesAccountId!, amount: baseTotal.negated(), description: `${desc} — ingresos` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: config.ivaDFAccountId!, amount: ivaTotal.negated(), description: `${desc} — IVA débito fiscal` });
      }
      // H-6: Cr IGTF Percibido por Enterar si configurado; si no → IGTF_GL_SKIPPED
      if (igtfAmount.greaterThan(0)) {
        if (config.igtfPayableAccountId) {
          entries.push({
            accountId: config.igtfPayableAccountId,
            amount: igtfAmount.negated(),
            description: `${desc} — IGTF percibido por enterar`,
          });
        } else {
          // Consistente con PaymentGLService: omitir silenciosamente + audit
          await db.auditLog.create({
            data: {
              companyId,
              entityId: invoice.id,
              entityName: "Invoice",
              action: "IGTF_GL_SKIPPED",
              userId,
              newValue: {
                reason: "igtfPayableAccountId no configurado en CompanySettings",
                igtfAmount: igtfAmount.toFixed(2),
                invoiceNumber: invoice.invoiceNumber,
              },
            },
          });
        }
      }
    } else {
      // COMPRA — inventario perpetuo (Error 4 dictamen SENIAT):
      // Dr Inventario (base) | Dr IVA-CF (iva) | Cr CxP (total neto) [+ Cr Ret.IVA p.p. si GAP-03]
      // El asiento Dr COGS / Cr Inventario ocurre en InventoryAccountingService.postMovement(SALIDA)

      // GAP-03: Consultar retenciones IVA vinculadas para fraccionar el Cr a Proveedores
      let ivaRetentionTotal = new Decimal(0);
      if (config.ivaRetentionPayableAccountId) {
        const retenciones = await db.retencion.findMany({
          where: {
            companyId,
            invoiceId: invoice.id,
            type: { in: ["IVA", "AMBAS"] },
            deletedAt: null,
          },
          select: { ivaRetention: true },
        });
        ivaRetentionTotal = retenciones.reduce(
          (s, r) => s.plus(new Decimal(r.ivaRetention.toString())),
          new Decimal(0)
        );
      }

      const apAmount = ivaRetentionTotal.greaterThan(0)
        ? total.minus(ivaRetentionTotal) // lo que efectivamente se paga al proveedor
        : total;

      entries = [
        { accountId: config.inventoryAccountId!, amount: baseTotal, description: `${desc} — inventario` },
        { accountId: config.apAccountId!, amount: apAmount.negated(), description: `${desc} — CxP` },
      ];
      if (ivaTotal.greaterThan(0)) {
        entries.push({ accountId: config.ivaCFAccountId!, amount: ivaTotal, description: `${desc} — IVA crédito fiscal` });
      }
      // GAP-03: Cr separado para Retenciones IVA por Pagar (2110)
      if (ivaRetentionTotal.greaterThan(0) && config.ivaRetentionPayableAccountId) {
        entries.push({
          accountId: config.ivaRetentionPayableAccountId,
          amount: ivaRetentionTotal.negated(),
          description: `${desc} — retención IVA por pagar`,
        });
      }
    }

    // Guarda semántica: base negativa indica dato corrupto — no aplica en reversals
    if (!isReversal && baseTotal.lessThan(0)) {
      throw new Error(`InvoiceGLPosting: base negativa — totalAmountVes menor que IVA (factura ${invoice.invoiceNumber})`);
    }

    // Fix A2: reversal niega todos los signos → Σ entries = 0 se mantiene (DR = CR)
    if (isReversal) {
      entries = entries.map((e) => ({ ...e, amount: e.amount.negated() }));
    }

    const docType = invoice.docType ?? "";
    const prefix = docType === "NOTA_CREDITO" ? "NC"
      : docType === "NOTA_DEBITO" ? "ND"
      : invoice.type === "SALE" ? "FAC" : "CMP";
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
