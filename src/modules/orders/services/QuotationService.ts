// src/modules/orders/services/QuotationService.ts
// Fase 28: Cotizaciones de compra (COT) y presupuestos de venta (PRE)
// Regla VEN-NIF: las cotizaciones NO generan asiento contable — son pre-contables.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import { type QuotationStatus, type QuotationType } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface QuotationItemInput {
  description: string;
  unit: string;
  quantity: string;   // Decimal string
  unitPrice: string;  // Decimal string
  taxRate: string;    // "0" | "8" | "16"
  inventoryItemId?: string | null; // OM-08: FK opcional al catálogo de inventario
}

export interface CreateQuotationInput {
  type: QuotationType;
  counterpartName: string;
  counterpartRif?: string;
  validUntil: Date;
  notes?: string;
  currency?: string;
  items: QuotationItemInput[];
}

export interface QuotationRow {
  id: string;
  type: QuotationType;
  status: QuotationStatus;
  number: string;
  counterpartName: string;
  counterpartRif: string | null;
  validUntil: string;   // ISO date string
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

function serializeQuotation(q: {
  id: string;
  type: QuotationType;
  status: QuotationStatus;
  number: string;
  counterpartName: string;
  counterpartRif: string | null;
  validUntil: Date;
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
}): QuotationRow {
  return {
    id: q.id,
    type: q.type,
    status: q.status,
    number: q.number,
    counterpartName: q.counterpartName,
    counterpartRif: q.counterpartRif,
    validUntil: q.validUntil.toISOString().split("T")[0]!,
    notes: q.notes,
    subtotal: new Decimal(q.subtotal.toString()).toFixed(2),
    taxAmount: new Decimal(q.taxAmount.toString()).toFixed(2),
    total: new Decimal(q.total.toString()).toFixed(2),
    currency: q.currency,
    createdBy: q.createdBy,
    approvedBy: q.approvedBy ?? null,
    approvedAt: q.approvedAt ? q.approvedAt.toISOString() : null,
    createdAt: q.createdAt.toISOString(),
    items: q.items.map((i) => ({
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

// ─── Secuencia — Serializable (previene doble número bajo concurrencia) ───────

async function getNextQuotationNumber(
  companyId: string,
  type: QuotationType
): Promise<string> {
  const docType =
    type === "PURCHASE" ? "PURCHASE_QUOTATION" : "SALE_QUOTATION";
  const prefix = type === "PURCHASE" ? "COT" : "PRE";

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

// ─── QuotationService ─────────────────────────────────────────────────────────

export const QuotationService = {
  // ── create ────────────────────────────────────────────────────────────────
  async createQuotation(
    companyId: string,
    userId: string,
    input: CreateQuotationInput
  ): Promise<QuotationRow> {
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

    const number = await getNextQuotationNumber(companyId, input.type);
    const { computed, subtotal, taxAmount, total } = computeTotals(input.items);

    const quotation = await prisma.quotation.create({
      data: {
        companyId,
        type: input.type,
        number,
        counterpartName: input.counterpartName.trim(),
        counterpartRif: input.counterpartRif?.trim() || null,
        validUntil: input.validUntil,
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

    return serializeQuotation(quotation);
  },

  // ── update — solo en DRAFT ─────────────────────────────────────────────────
  async updateQuotation(
    companyId: string,
    quotationId: string,
    userId: string,
    input: Partial<CreateQuotationInput>,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<QuotationRow> {
    const existing = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId, deletedAt: null },
    });
    if (!existing) throw new Error("Cotización no encontrada");
    if (existing.status !== "DRAFT")
      throw new Error("Solo se puede editar una cotización en Borrador");

    const updates: Record<string, unknown> = {};
    if (input.counterpartName) updates.counterpartName = input.counterpartName.trim();
    if (input.counterpartRif !== undefined)
      updates.counterpartRif = input.counterpartRif?.trim() || null;
    if (input.validUntil) updates.validUntil = input.validUntil;
    if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;
    if (input.currency) updates.currency = input.currency;

    let itemsComputed: ReturnType<typeof computeTotals>["computed"] | null = null;
    if (input.items && input.items.length > 0) {
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

      const { computed, subtotal, taxAmount, total } = computeTotals(input.items);
      itemsComputed = computed;
      updates.subtotal = subtotal;
      updates.taxAmount = taxAmount;
      updates.total = total;
    }

    const quotation = await prisma.$transaction(
      async (tx) => {
        if (itemsComputed) {
          await tx.quotationItem.deleteMany({ where: { quotationId } });
          updates.items = {
            create: itemsComputed.map((c) => ({
              description: c.description,
              unit: c.unit,
              quantity: c.quantity,
              unitPrice: c.unitPrice,
              taxRate: c.taxRate,
              totalPrice: c.totalPrice,
              inventoryItemId: c.inventoryItemId, // OM-08: thread through
            })),
          };
        }

        const updated = await tx.quotation.update({
          where: { id: quotationId },
          data: updates,
          include: { items: true },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityId: quotationId,
            entityName: "Quotation",
            action: "UPDATE",
            userId,
            ipAddress,
            userAgent,
            newValue: {
              updatedFields: Object.keys(updates).filter((k) => k !== "items"),
              itemsReplaced: itemsComputed !== null,
            },
          },
        });

        return updated;
      },
      { isolationLevel: "Serializable" },
    );

    return serializeQuotation(quotation);
  },

  // ── submit → PENDING_APPROVAL ─────────────────────────────────────────────
  async submitForApproval(companyId: string, quotationId: string): Promise<void> {
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId, deletedAt: null },
    });
    if (!q) throw new Error("Cotización no encontrada");
    if (q.status !== "DRAFT")
      throw new Error("Solo se puede enviar a aprobación una cotización en Borrador");

    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: "PENDING_APPROVAL" },
    });
  },

  // ── approve → APPROVED ────────────────────────────────────────────────────
  async approveQuotation(companyId: string, quotationId: string, userId: string): Promise<void> {
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId, deletedAt: null },
    });
    if (!q) throw new Error("Cotización no encontrada");
    if (q.status !== "PENDING_APPROVAL")
      throw new Error("Solo se puede aprobar una cotización en Pendiente de Aprobación");

    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: "APPROVED", approvedBy: userId, approvedAt: new Date() },
    });
  },

  // ── reject → REJECTED ─────────────────────────────────────────────────────
  async rejectQuotation(companyId: string, quotationId: string): Promise<void> {
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId, deletedAt: null },
    });
    if (!q) throw new Error("Cotización no encontrada");
    if (q.status !== "PENDING_APPROVAL")
      throw new Error("Solo se puede rechazar una cotización en Pendiente de Aprobación");

    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: "REJECTED" },
    });
  },

  // ── list ──────────────────────────────────────────────────────────────────
  async getQuotations(
    companyId: string,
    filters?: { type?: QuotationType; status?: QuotationStatus }
  ): Promise<QuotationRow[]> {
    const quotations = await prisma.quotation.findMany({
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
    return quotations.map(serializeQuotation);
  },

  // ── single ────────────────────────────────────────────────────────────────
  async getQuotation(
    companyId: string,
    quotationId: string
  ): Promise<QuotationRow | null> {
    const q = await prisma.quotation.findFirst({
      where: { id: quotationId, companyId, deletedAt: null },
      include: { items: true },
    });
    return q ? serializeQuotation(q) : null;
  },
};
