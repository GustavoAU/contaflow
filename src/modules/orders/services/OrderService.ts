// src/modules/orders/services/OrderService.ts
// Fase 28: Órdenes de Compra (OC) y Órdenes de Venta (OV)
//
// Security: addresses audit findings CRITICAL-1 and CRITICAL-2:
//   CRITICAL-1: All queries include { companyId } to prevent cross-tenant IDOR.
//   CRITICAL-2: convertOrderToInvoice asserts order.status === 'APPROVED' atomically
//               inside the same $transaction before any mutation.
//
// Regla VEN-NIF: OC/OV NO generan asiento contable — solo registran compromiso pre-contable.
// Solo la Factura resultante de la conversión genera el asiento.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import { type OrderStatus, type QuotationType, type IvaLineRate } from "@prisma/client";
import { type QuotationItemInput } from "./QuotationService";
import type { InvoiceLineInput } from "@/modules/invoices/schemas/invoice.schema";
import { computeLineTotals, deriveInvoiceTaxLines, createInvoiceLinesInTx } from "@/modules/invoices/services/InvoiceLineService";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CreateOrderInput {
  type: QuotationType;
  quotationId?: string;          // opcional — puede crearse sin cotización previa
  counterpartName: string;
  counterpartRif?: string;
  expectedDate?: Date;
  notes?: string;
  currency?: string;
  items: QuotationItemInput[];   // misma estructura que cotización
}

export interface OrderRow {
  id: string;
  type: QuotationType;
  status: OrderStatus;
  number: string;
  quotationId: string | null;
  counterpartName: string;
  counterpartRif: string | null;
  expectedDate: string | null;  // ISO date
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;  // ISO datetime
  createdAt: string;
  items: {
    id: string;
    description: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    taxRate: string;
    totalPrice: string;
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeTotals(items: QuotationItemInput[]) {
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  const computed = items.map((item) => {
    const qty = new Decimal(item.quantity);
    const price = new Decimal(item.unitPrice);
    const rate = new Decimal(item.taxRate).div(100);
    const base = qty.mul(price);
    const tax = base.mul(rate);
    subtotal = subtotal.add(base);
    taxAmount = taxAmount.add(tax);
    return {
      description: item.description.trim(),
      unit: item.unit.trim(),
      quantity: qty,
      unitPrice: price,
      taxRate: new Decimal(item.taxRate),
      totalPrice: base.add(tax),
    };
  });

  return { computed, subtotal, taxAmount, total: subtotal.add(taxAmount) };
}

function serializeOrder(o: {
  id: string;
  type: QuotationType;
  status: OrderStatus;
  number: string;
  quotationId: string | null;
  counterpartName: string;
  counterpartRif: string | null;
  expectedDate: Date | null;
  notes: string | null;
  subtotal: { toString(): string };
  taxAmount: { toString(): string };
  total: { toString(): string };
  currency: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  items: {
    id: string;
    description: string;
    unit: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string };
    taxRate: { toString(): string };
    totalPrice: { toString(): string };
  }[];
}): OrderRow {
  return {
    id: o.id,
    type: o.type,
    status: o.status,
    number: o.number,
    quotationId: o.quotationId,
    counterpartName: o.counterpartName,
    counterpartRif: o.counterpartRif,
    expectedDate: o.expectedDate
      ? o.expectedDate.toISOString().split("T")[0]!
      : null,
    notes: o.notes,
    subtotal: new Decimal(o.subtotal.toString()).toFixed(2),
    taxAmount: new Decimal(o.taxAmount.toString()).toFixed(2),
    total: new Decimal(o.total.toString()).toFixed(2),
    currency: o.currency,
    createdBy: o.createdBy,
    approvedBy: o.approvedBy ?? null,
    approvedAt: o.approvedAt ? o.approvedAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      description: i.description,
      unit: i.unit,
      quantity: new Decimal(i.quantity.toString()).toFixed(4),
      unitPrice: new Decimal(i.unitPrice.toString()).toFixed(2),
      taxRate: new Decimal(i.taxRate.toString()).toFixed(2),
      totalPrice: new Decimal(i.totalPrice.toString()).toFixed(2),
    })),
  };
}

// ─── Secuencia — Serializable ─────────────────────────────────────────────────

async function getNextOrderNumber(
  companyId: string,
  type: QuotationType
): Promise<string> {
  const docType = type === "PURCHASE" ? "PURCHASE_ORDER" : "SALE_ORDER";
  const prefix = type === "PURCHASE" ? "OC" : "OV";

  return prisma.$transaction(
    async (tx) => {
      const seq = await tx.orderNumberSequence.upsert({
        where: { companyId_docType: { companyId, docType } },
        create: { companyId, docType, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      return `${prefix}-${String(seq.lastNumber).padStart(4, "0")}`;
    },
    { isolationLevel: "Serializable" }
  );
}

// Fase 37C: mapea taxRate numérico de OrderItem al enum IvaLineRate
function orderItemToIvaRate(taxRate: Decimal): IvaLineRate {
  const r = taxRate.toNumber();
  if (r === 0) return "EXENTO";
  if (r === 8) return "REDUCIDO_8";
  if (r === 31) return "ADICIONAL_31";
  return "GENERAL_16";
}

// ─── OrderService ─────────────────────────────────────────────────────────────

export const OrderService = {
  // ── create ────────────────────────────────────────────────────────────────
  async createOrder(
    companyId: string,
    userId: string,
    input: CreateOrderInput
  ): Promise<OrderRow> {
    // CRITICAL-1 (HIGH-1): if quotationId provided, verify it belongs to this company
    if (input.quotationId) {
      const quotation = await prisma.quotation.findFirst({
        where: { id: input.quotationId, companyId, deletedAt: null },
      });
      if (!quotation) throw new Error("Cotización no encontrada");
      if (quotation.status !== "APPROVED")
        throw new Error("Solo se puede crear una orden desde una cotización aprobada");
    }

    const number = await getNextOrderNumber(companyId, input.type);
    const { computed, subtotal, taxAmount, total } = computeTotals(input.items);

    const order = await prisma.order.create({
      data: {
        companyId,
        type: input.type,
        number,
        quotationId: input.quotationId ?? null,
        counterpartName: input.counterpartName.trim(),
        counterpartRif: input.counterpartRif?.trim() || null,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes?.trim() || null,
        subtotal,
        taxAmount,
        total,
        currency: (input.currency ?? "VES") as never,
        createdBy: userId,
        items: {
          create: computed.map((c) => ({
            description: c.description,
            unit: c.unit,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            taxRate: c.taxRate,
            totalPrice: c.totalPrice,
          })),
        },
      },
      include: { items: true },
    });

    // Mark source quotation as CONVERTED
    if (input.quotationId) {
      await prisma.quotation.update({
        where: { id: input.quotationId },
        data: { status: "CONVERTED" },
      });
    }

    return serializeOrder(order);
  },

  // ── approve — DRAFT → APPROVED ────────────────────────────────────────────
  async approveOrder(companyId: string, orderId: string, userId: string): Promise<void> {
    // CRITICAL-1: companyId guard — no findUnique by PK alone
    const order = await prisma.order.findFirst({
      where: { id: orderId, companyId, deletedAt: null },
    });
    if (!order) throw new Error("Orden no encontrada");
    if (order.status !== "DRAFT")
      throw new Error("Solo se puede aprobar una orden en Borrador");

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
    });
  },

  // ── convertToInvoice — CRITICAL-1 + CRITICAL-2 + MEDIUM-1 ────────────────
  // CRITICAL-1: orderId is scoped to companyId inside $transaction.
  // CRITICAL-2: status === 'APPROVED' asserted atomically before any mutation.
  // MEDIUM-1:   AuditLog inside the same $transaction (no fire-and-forget).
  async convertOrderToInvoice(
    companyId: string,
    orderId: string,
    userId: string,
    invoiceData: {
      invoiceNumber: string;
      controlNumber?: string;
      date: Date;
      dueDate?: Date;
      periodId?: string;
    },
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<{ invoiceId: string }> {
    return prisma.$transaction(async (tx) => {
      // CRITICAL-1: scope to companyId — no cross-tenant IDOR possible
      const order = await tx.order.findFirst({
        where: { id: orderId, companyId, deletedAt: null },
        include: { items: true },
      });
      if (!order) throw new Error("Orden no encontrada");

      // CRITICAL-2: status machine — only APPROVED orders can convert
      if (order.status !== "APPROVED")
        throw new Error("Solo se puede convertir a factura una orden Aprobada");

      // Determine invoice type
      const invoiceType = order.type === "PURCHASE" ? "PURCHASE" : "SALE";

      // Fase 37C: mapear OrderItems → InvoiceLineInput (ADR-024 D-1 / D-2)
      // OrderItem.unit es un string (no FK a InventoryItemUnit) → unitId omitido
      // OrderItem no tiene inventoryItemId → stock check se omite en createInvoiceLinesInTx
      const lineInputs: InvoiceLineInput[] = order.items.map((item, idx) => ({
        nameSnapshot: item.description,
        quantity: new Decimal(item.quantity.toString()).toString(),
        unitPriceVes: new Decimal(item.unitPrice.toString()).toString(),
        ivaRate: orderItemToIvaRate(new Decimal(item.taxRate.toString())),
        lineNumber: idx + 1,
      }));

      const computed = computeLineTotals(lineInputs);
      const derivedTaxLines = deriveInvoiceTaxLines(computed);

      // Create invoice (no journal entry — that is handled by InvoiceAccountingService)
      // Invoice total is tracked via taxLines; totalAmountVes holds the VES equivalent.
      const invoice = await tx.invoice.create({
        data: {
          companyId,
          type: invoiceType,
          docType: "FACTURA",
          invoiceNumber: invoiceData.invoiceNumber,
          controlNumber: invoiceData.controlNumber ?? null,
          date: invoiceData.date,
          dueDate: invoiceData.dueDate ?? null,
          counterpartName: order.counterpartName,
          counterpartRif: order.counterpartRif ?? "",
          currency: order.currency,
          totalAmountVes: order.total,
          createdBy: userId,
          periodId: invoiceData.periodId ?? null,
          orderId: order.id,
          ivaRetentionAmount: 0,
          igtfBase: 0,
          igtfAmount: 0,
          islrRetentionAmount: 0,
        },
      });

      // Fase 37C: crear InvoiceTaxLine desde líneas derivadas (fix: ADICIONAL_31 genera 2 registros)
      for (const tl of derivedTaxLines) {
        await tx.invoiceTaxLine.create({
          data: {
            invoiceId: invoice.id,
            taxType: tl.taxType,
            base: tl.base,
            rate: tl.rate,
            amount: tl.amount,
            description: null,
          },
        });
      }

      // Fase 37C: crear InvoiceLines desde OrderItems
      await createInvoiceLinesInTx(
        invoice.id,
        companyId,
        computed,
        invoiceData.date,
        userId,
        "WARN",
        tx
      );

      // Mark order as CONVERTED
      await tx.order.update({
        where: { id: orderId },
        data: { status: "CONVERTED" },
      });

      // MEDIUM-1: AuditLog inside same $transaction
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "Order",
          entityId: orderId,
          action: "CONVERTED_TO_INVOICE",
          userId,
          ipAddress,
          userAgent,
          newValue: { invoiceId: invoice.id, invoiceNumber: invoiceData.invoiceNumber },
        },
      });

      return { invoiceId: invoice.id };
    });
  },

  // ── list ──────────────────────────────────────────────────────────────────
  async getOrders(
    companyId: string,
    filters?: { type?: QuotationType; status?: OrderStatus }
  ): Promise<OrderRow[]> {
    const orders = await prisma.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(filters?.type ? { type: filters.type } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return orders.map(serializeOrder);
  },

  // ── single — CRITICAL-1: always includes companyId guard ─────────────────
  async getOrder(companyId: string, orderId: string): Promise<OrderRow | null> {
    const o = await prisma.order.findFirst({
      where: { id: orderId, companyId, deletedAt: null },
      include: { items: true },
    });
    return o ? serializeOrder(o) : null;
  },
};
