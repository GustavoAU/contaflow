// src/modules/retentions/services/RetentionService.ts
import { Decimal } from "decimal.js";
import { ISLR_RATES, IVA_RETENTION_RATES } from "../schemas/retention.schema";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type RetentionCalculation = {
  taxBase: string;
  ivaAmount: string;
  ivaRetention: string;
  ivaRetentionPct: number;
  islrAmount: string | null;
  islrRetentionPct: number | null;
  totalRetention: string;
};

export class RetentionService {
  // ─── Calcular retención IVA ────────────────────────────────────────────────
  static calculateIvaRetention(
    taxBase: string,
    ivaRate: number = 16,
    retentionPct: 75 | 100 = 75
  ): { ivaAmount: string; ivaRetention: string; ivaRetentionPct: number } {
    const base = new Decimal(taxBase);
    const ivaAmount = base.mul(ivaRate).div(100);
    const retention = ivaAmount.mul(retentionPct).div(100);

    return {
      ivaAmount: ivaAmount.toFixed(2),
      ivaRetention: retention.toFixed(2),
      ivaRetentionPct: retentionPct,
    };
  }

  // ─── Calcular retención ISLR ───────────────────────────────────────────────
  static calculateIslrRetention(
    taxBase: string,
    islrCode: string
  ): { islrAmount: string; islrRetentionPct: number } | null {
    const rate = ISLR_RATES[islrCode];
    if (!rate) return null;

    const base = new Decimal(taxBase);
    const retention = base.mul(rate.pct).div(100);

    return {
      islrAmount: retention.toFixed(2),
      islrRetentionPct: rate.pct,
    };
  }

  // ─── Calcular retención completa ───────────────────────────────────────────
  static calculate(
    taxBase: string,
    ivaRetentionPct: 75 | 100 = 75,
    islrCode?: string,
    ivaRate: number = 16
  ): RetentionCalculation {
    const iva = this.calculateIvaRetention(taxBase, ivaRate, ivaRetentionPct);
    const islr = islrCode ? this.calculateIslrRetention(taxBase, islrCode) : null;

    const total = new Decimal(iva.ivaRetention).plus(
      islr ? new Decimal(islr.islrAmount) : new Decimal(0)
    );

    return {
      taxBase,
      ivaAmount: iva.ivaAmount,
      ivaRetention: iva.ivaRetention,
      ivaRetentionPct: iva.ivaRetentionPct,
      islrAmount: islr?.islrAmount ?? null,
      islrRetentionPct: islr?.islrRetentionPct ?? null,
      totalRetention: total.toFixed(2),
    };
  }

  // ─── Validar RIF venezolano ────────────────────────────────────────────────
  static validateRif(rif: string): boolean {
    return validateVenezuelanRif(rif);
  }

  // ─── Obtener descripción de tasa ISLR ─────────────────────────────────────
  static getIslrRateDescription(islrCode: string): string {
    return ISLR_RATES[islrCode]?.description ?? "Código ISLR desconocido";
  }

  // ─── Obtener tasa IVA según tipo ───────────────────────────────────────────
  static getIvaRetentionRate(
    full: boolean = false
  ): (typeof IVA_RETENTION_RATES)[keyof typeof IVA_RETENTION_RATES] {
    return full ? IVA_RETENTION_RATES.FULL : IVA_RETENTION_RATES.STANDARD;
  }
}

// ─── linkRetentionToInvoice ────────────────────────────────────────────────────
/**
 * Vincula una retención existente a una factura de la misma empresa.
 * Ejecuta dentro de $transaction sin isolationLevel Serializable
 * (no genera correlativo — Read Committed por defecto es suficiente).
 */
export async function linkRetentionToInvoice(
  retentionId: string,
  invoiceId: string,
  companyId: string
): Promise<Prisma.RetencionGetPayload<{ include: { invoice: true } }>> {
  // 1. Verificar que retención pertenece a companyId
  const retention = await prisma.retencion.findFirst({
    where: { id: retentionId, companyId, deletedAt: null },
  });
  if (!retention) throw new Error("Retención no encontrada");

  // 2. Verificar que factura pertenece a companyId
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
  });
  if (!invoice) throw new Error("Factura no encontrada");

  // 3. $transaction (no Serializable — no hay correlativo)
  const [updated] = await prisma.$transaction([
    prisma.retencion.update({
      where: { id: retentionId },
      data: { invoiceId },
      include: { invoice: true },
    }),
    prisma.auditLog.create({
      data: {
        entityId: retentionId,
        entityName: "Retencion",
        action: "LINK_RETENTION_INVOICE",
        userId: retention.createdBy,
        newValue: { invoiceId, companyId },
      },
    }),
  ]);

  // 4. Retornar retención con invoice incluido
  return updated as Prisma.RetencionGetPayload<{ include: { invoice: true } }>;
}

// ─── getRetentionsByInvoice ────────────────────────────────────────────────────
/**
 * Retorna todas las retenciones activas vinculadas a una factura.
 * Resultado ordenado por createdAt desc.
 */
export async function getRetentionsByInvoice(
  invoiceId: string,
  companyId: string
): Promise<Prisma.RetencionGetPayload<object>[]> {
  return prisma.retencion.findMany({
    where: { invoiceId, companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}
