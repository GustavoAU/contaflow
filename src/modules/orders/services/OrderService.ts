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
import { getNextDocumentNumber } from "../utils/sequence";
import { InvoiceGLPostingService } from "@/modules/invoices/services/InvoiceGLPostingService";
import { autoPostMovementInTx } from "@/modules/inventory/services/InventoryAccountingService";

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
      inventoryItemId: item.inventoryItemId ?? null, // OM-08: thread through
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

// ─── Secuencia — Serializable + retry P2034 (compartida con QuotationService) ─

function getNextOrderNumber(companyId: string, type: QuotationType): Promise<string> {
  return getNextDocumentNumber(companyId, type === "PURCHASE" ? "PURCHASE_ORDER" : "SALE_ORDER");
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
    input: CreateOrderInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
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

    // OM-08: validar que inventoryItemIds (si se especifican) pertenecen a la empresa
    const itemIds = input.items.map((i) => i.inventoryItemId).filter(Boolean) as string[];
    if (itemIds.length > 0) {
      const found = await prisma.inventoryItem.findMany({
        where: { id: { in: itemIds }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== itemIds.length) {
        throw new Error("Uno o más productos del catálogo no pertenecen a esta empresa");
      }
    }

    const number = await getNextOrderNumber(companyId, input.type);
    const { computed, subtotal, taxAmount, total } = computeTotals(input.items);

    // AUD-01 (R-6): create + marca de cotización + AuditLog en el mismo $transaction
    // (además hace atómica la conversión Cotización→Orden, antes en dos awaits sueltos).
    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
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
              inventoryItemId: c.inventoryItemId, // OM-08
            })),
          },
        },
        include: { items: true },
      });

      // Mark source quotation as CONVERTED
      if (input.quotationId) {
        await tx.quotation.update({
          where: { id: input.quotationId },
          data: { status: "CONVERTED" },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: o.id,
          entityName: "Order",
          action: "CREATE",
          userId,
          ipAddress,
          userAgent,
          newValue: {
            number,
            type: input.type,
            counterpartName: o.counterpartName,
            total: total.toString(),
            fromQuotation: input.quotationId ?? null,
          },
        },
      });

      return o;
    });

    return serializeOrder(order);
  },

  // ── approve — DRAFT → APPROVED ────────────────────────────────────────────
  async approveOrder(
    companyId: string,
    orderId: string,
    userId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<void> {
    // CRITICAL-1: companyId guard — no findUnique by PK alone
    const order = await prisma.order.findFirst({
      where: { id: orderId, companyId, deletedAt: null },
    });
    if (!order) throw new Error("Orden no encontrada");
    if (order.status !== "DRAFT")
      throw new Error("Solo se puede aprobar una orden en Borrador");

    // AUD-01 (R-6): update + AuditLog en el mismo $transaction
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: orderId,
          entityName: "Order",
          action: "APPROVE",
          userId,
          ipAddress,
          userAgent,
          newValue: { status: "APPROVED", approvedBy: userId },
        },
      });
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

      // E-14 (R-3): la factura resultante no puede caer en un período CERRADO.
      // Espejo de InvoiceService.createInvoice — la conversión NO debe evadir el guard
      // de período que sí aplica la emisión directa de facturas. Mismos getters (locales)
      // que InvoiceService para que una orden y una factura directa con la misma fecha
      // resuelvan al mismo período. Auto-asigna periodId si el caller no lo provee.
      const invYear = invoiceData.date.getFullYear();
      const invMonth = invoiceData.date.getMonth() + 1; // getMonth() es 0-based
      const periodForDate = await tx.accountingPeriod.findFirst({
        where: { companyId, year: invYear, month: invMonth },
        select: { id: true, status: true, year: true, month: true },
      });
      if (periodForDate?.status === "CLOSED") {
        throw new Error(
          `No se puede convertir a factura en el período ${String(periodForDate.month).padStart(2, "0")}/${periodForDate.year} porque está CERRADO. Use una fecha en el período activo.`
        );
      }
      const resolvedPeriodId = invoiceData.periodId ?? periodForDate?.id ?? null;

      // H-8: respetar stockControlLevel + config GL para causación automática (hallazgo #2)
      const settings = await tx.companySettings.findUnique({
        where: { companyId },
        select: {
          stockControlLevel: true,
          arAccountId: true,
          apAccountId: true,
          salesAccountId: true,
          purchaseExpenseAccountId: true,
          inventoryAccountId: true,
          ivaDFAccountId: true,
          ivaCFAccountId: true,
          ivaRetentionPayableAccountId: true,
          igtfPayableAccountId: true,
        },
      });
      const stockLevel = settings?.stockControlLevel ?? "WARN";

      // Fase 37C: mapear OrderItems → InvoiceLineInput (ADR-024 D-1 / D-2)
      // OrderItem.unit es un string (no FK a InventoryItemUnit) → unitId omitido
      // H-8: inventoryItemId se propaga para habilitar control de stock en createInvoiceLinesInTx
      const lineInputs: InvoiceLineInput[] = order.items.map((item, idx) => ({
        inventoryItemId: item.inventoryItemId ?? undefined,
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
          periodId: resolvedPeriodId,
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
      // OM-01: pasar invoiceType para crear ENTRADA (compra) o SALIDA (venta) según corresponda
      // H-8: stockLevel real de la empresa — habilita validación NIC 2 / Art. 13 Ley IVA
      await createInvoiceLinesInTx(
        invoice.id,
        companyId,
        computed,
        invoiceData.date,
        userId,
        stockLevel,
        tx,
        invoiceType  // OM-01: "PURCHASE" → ENTRADA, "SALE" → SALIDA
      );

      // ─── Hallazgo #2: GL auto-posting (mismo patrón que InvoiceService.create) ────
      // Sin esto, las compras convertidas desde órdenes nunca generaban Dr Inventario / Cr CxP
      // y los movimientos ENTRADA quedaban en DRAFT sin actualizar stock ni CPP.
      let glTransactionId: string | null = null;
      if (settings && InvoiceGLPostingService.canPost(invoiceType, settings)) {
        const totalAmountVes = computed.length > 0
          ? computed.reduce((acc, c) => acc.plus(c.total), new Decimal(0))
          : new Decimal(order.total.toString());

        glTransactionId = await InvoiceGLPostingService.postInvoice(
          {
            id: invoice.id,
            type: invoiceType,
            invoiceNumber: invoiceData.invoiceNumber,
            counterpartName: order.counterpartName,
            date: invoiceData.date,
            periodId: resolvedPeriodId,
            totalAmountVes,
            taxLines: derivedTaxLines.map((tl) => ({
              taxType: tl.taxType,
              base: tl.base,
              amount: tl.amount,
            })),
            currency: order.currency,
            exchangeRateVes: null,
            igtfAmount: new Decimal(0),
          },
          settings,
          companyId,
          userId,
          tx
        );
      }

      // Auto-post ENTRADA/SALIDA movements (actualiza stock/CPP y vincula al asiento GL)
      const draftMovements = await tx.inventoryMovement.findMany({
        where: { invoiceId: invoice.id, status: "DRAFT" },
        select: { id: true, type: true },
      });
      for (const m of draftMovements) {
        if (m.type === "ENTRADA" && !glTransactionId) continue;
        await autoPostMovementInTx(
          tx,
          m.id,
          companyId,
          userId,
          m.type === "ENTRADA" ? glTransactionId : null
        );
      }

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
