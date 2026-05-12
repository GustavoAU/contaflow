// src/modules/retentions/services/RetentionService.ts
import { Decimal } from "decimal.js";
import { ISLR_RATES, IVA_RETENTION_RATES, INCES_RATE, FAT_RATE } from "../schemas/retention.schema";
import type { EnterRetentionInput } from "../schemas/retention.schema";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// ─── getNextVoucherNumber ──────────────────────────────────────────────────────
/**
 * Obtiene y reserva el siguiente número de comprobante de retención para una
 * empresa en formato "CR-XXXXXXXX".
 *
 * Precondiciones:
 *   - `tx` DEBE ser un cliente dentro de `prisma.$transaction({ isolationLevel: 'Serializable' })`
 *
 * Postcondiciones:
 *   - Retorna un string único no reutilizado con formato "CR-XXXXXXXX"
 *   - `lastNumber` en RetentionSequence queda incrementado en 1
 */
export async function getNextVoucherNumber(
  tx: Prisma.TransactionClient,
  companyId: string
): Promise<string> {
  const seq = await tx.retentionSequence.upsert({
    where: { companyId },
    create: { companyId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `CR-${String(seq.lastNumber).padStart(8, "0")}`;
}

export type RetentionCalculation = {
  taxBase: string;
  ivaAmount: string;
  ivaRetention: string;
  ivaRetentionPct: number;
  islrAmount: string | null;
  islrRetentionPct: number | null;
  incesAmount: string | null;
  incesRetentionPct: number | null;
  fatAmount: string | null;
  fatRetentionPct: number | null;
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

  // ─── Calcular retención INCES (2%) ────────────────────────────────────────
  static calculateIncesRetention(taxBase: string): { incesAmount: string; incesRetentionPct: number } {
    const base = new Decimal(taxBase);
    const retention = base.mul(INCES_RATE.pct).div(100);
    return {
      incesAmount: retention.toFixed(2),
      incesRetentionPct: INCES_RATE.pct,
    };
  }

  // ─── Calcular retención FAT (0.75%) ───────────────────────────────────────
  static calculateFatRetention(taxBase: string): { fatAmount: string; fatRetentionPct: number } {
    const base = new Decimal(taxBase);
    const retention = base.mul(FAT_RATE.pct).div(100);
    return {
      fatAmount: retention.toFixed(2),
      fatRetentionPct: FAT_RATE.pct,
    };
  }

  // ─── Calcular retención completa ───────────────────────────────────────────
  static calculate(
    taxBase: string,
    ivaRetentionPct: 75 | 100 = 75,
    islrCode?: string,
    ivaRate: number = 16,
    type: "IVA" | "ISLR" | "AMBAS" = "AMBAS",
    applyInces: boolean = false,
    applyFat: boolean = false
  ): RetentionCalculation {
    const includeIva = type !== "ISLR";
    const iva = this.calculateIvaRetention(taxBase, ivaRate, ivaRetentionPct);
    const islr = islrCode ? this.calculateIslrRetention(taxBase, islrCode) : null;
    const inces = applyInces ? this.calculateIncesRetention(taxBase) : null;
    const fat = applyFat ? this.calculateFatRetention(taxBase) : null;

    const total = (includeIva ? new Decimal(iva.ivaRetention) : new Decimal(0))
      .plus(islr ? new Decimal(islr.islrAmount) : new Decimal(0))
      .plus(inces ? new Decimal(inces.incesAmount) : new Decimal(0))
      .plus(fat ? new Decimal(fat.fatAmount) : new Decimal(0));

    return {
      taxBase,
      ivaAmount: includeIva ? iva.ivaAmount : "0.00",
      ivaRetention: includeIva ? iva.ivaRetention : "0.00",
      ivaRetentionPct: iva.ivaRetentionPct,
      islrAmount: islr?.islrAmount ?? null,
      islrRetentionPct: islr?.islrRetentionPct ?? null,
      incesAmount: inces?.incesAmount ?? null,
      incesRetentionPct: inces?.incesRetentionPct ?? null,
      fatAmount: fat?.fatAmount ?? null,
      fatRetentionPct: fat?.fatRetentionPct ?? null,
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

// ─── enterRetention ────────────────────────────────────────────────────────────
/**
 * Registra el enteramiento de una retención ante el SENIAT.
 * Crea el asiento contable DIARIO:
 *   Débito: cuenta Retenciones por Pagar (liabilityAccountId)
 *   Crédito: cuenta Banco/Caja (bankAccountId)
 * Transiciona status → ENTERADO.
 */
export async function enterRetention(
  input: EnterRetentionInput,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const retention = await tx.retencion.findFirst({
      where: { id: input.retentionId, companyId: input.companyId, deletedAt: null },
    });
    if (!retention) throw new Error("Retención no encontrada");
    if (retention.status === "ENTERADO") throw new Error("La retención ya fue enterada");
    if (retention.status === "VOIDED") throw new Error("No se puede enterar una retención anulada");

    const period = await tx.accountingPeriod.findFirst({
      where: { companyId: input.companyId, status: "OPEN" },
    });
    if (!period) throw new Error("No hay período contable abierto");

    // Validate accounts belong to company
    const [liabilityAccount, bankAccount] = await Promise.all([
      tx.account.findFirst({ where: { id: input.liabilityAccountId, companyId: input.companyId } }),
      tx.account.findFirst({ where: { id: input.bankAccountId, companyId: input.companyId } }),
    ]);
    if (!liabilityAccount) throw new Error("Cuenta de pasivo (Retenciones por Pagar) no encontrada");
    if (!bankAccount) throw new Error("Cuenta banco/caja no encontrada");

    // Total amount to enter = totalRetention + INCES + FAT
    const enterAmount = new Decimal(retention.totalRetention.toString())
      .plus(retention.incesAmount ? new Decimal(retention.incesAmount.toString()) : new Decimal(0))
      .plus(retention.fatAmount ? new Decimal(retention.fatAmount.toString()) : new Decimal(0));

    // Sequence number for enteramiento transaction
    const enterCount = await tx.retencion.count({
      where: { companyId: input.companyId, enteradoAt: { not: null } },
    });
    const txNumber = `ENT-${input.enterDate.getFullYear()}-${String(enterCount + 1).padStart(5, "0")}`;

    // Journal entry: Debit liability, Credit bank
    const transaction = await tx.transaction.create({
      data: {
        companyId: input.companyId,
        periodId: period.id,
        date: input.enterDate,
        number: txNumber,
        description: `Enteramiento retención ${retention.voucherNumber ?? retention.id} — ${retention.providerName}`,
        type: "DIARIO",
        userId,
        entries: {
          create: [
            {
              accountId: input.liabilityAccountId,
              amount: enterAmount,
              description: `Enteramiento retención ${retention.voucherNumber ?? retention.id}`,
            },
            {
              accountId: input.bankAccountId,
              amount: enterAmount.negated(),
              description: `Enteramiento retención ${retention.voucherNumber ?? retention.id}`,
            },
          ],
        },
      },
    });

    await tx.retencion.update({
      where: { id: input.retentionId },
      data: {
        status: "ENTERADO",
        enteradoAt: new Date(),
        enteradoBy: userId,
        transactionId: transaction.id,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: input.retentionId,
        entityName: "Retencion",
        action: "ENTER_RETENTION",
        userId,
        ipAddress,
        userAgent,
        newValue: {
          transactionId: transaction.id,
          enterAmount: enterAmount.toFixed(2),
          liabilityAccountId: input.liabilityAccountId,
          bankAccountId: input.bankAccountId,
        },
      },
    });
  });
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

  // 3. $transaction (no Serializable — no hay correlativo; Read Committed es suficiente)
  const [updated] = await prisma.$transaction([
    prisma.retencion.update({
      where: { id: retentionId },
      data: { invoiceId },
      include: { invoice: true },
    }),
    // Sync campos denormalizados de retención en Invoice
    prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        ivaRetentionAmount: retention.ivaRetention,
        ivaRetentionVoucher: retention.voucherNumber ?? retention.id,
        ivaRetentionDate: retention.createdAt,
        ...(retention.islrAmount ? { islrRetentionAmount: retention.islrAmount } : {}),
      },
    }),
    prisma.auditLog.create({
      data: {
        companyId,
        entityId: retentionId,
        entityName: "Retencion",
        action: "LINK_RETENTION_INVOICE",
        userId: retention.createdBy,
        ipAddress: null,
        userAgent: null,
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
