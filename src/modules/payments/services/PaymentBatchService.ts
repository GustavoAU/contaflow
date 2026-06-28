import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { PaymentMethod, Currency, PaymentBatchStatus } from "@prisma/client";
import { PaymentGLService } from "./PaymentGLService";
import { VEN_TAX_RATES } from "@/lib/tax-config";
import { IGTFService } from "@/modules/igtf/services/IGTFService";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type BatchLineSummary = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;  // #6 — mostrar número legible en lugar de ID
  counterpartName: string | null;
  amountVes: string;
  amountOriginal: string | null;
  igtfAmount: string | null;
  notes: string | null;
};

export type PaymentBatchSummary = {
  id: string;
  companyId: string;
  status: PaymentBatchStatus;
  method: PaymentMethod;
  totalAmountVes: string;
  currency: string;
  totalAmountOriginal: string | null;
  exchangeRateId: string | null;
  referenceNumber: string | null;
  originBank: string | null;
  destBank: string | null;
  commissionPct: string | null;
  commissionAmount: string | null;
  totalIgtfAmount: string | null;
  date: Date;
  notes: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string;
  idempotencyKey: string;
  lines: BatchLineSummary[];
};

type CreateBatchLineInput = {
  invoiceId: string;
  amountVes: Decimal;
  amountOriginal?: Decimal;
  igtfAmount?: Decimal;
  notes?: string;
};

export type CreateBatchInput = {
  companyId: string;
  method: PaymentMethod;
  totalAmountVes: Decimal;
  currency?: string;
  totalAmountOriginal?: Decimal;
  exchangeRateId?: string;
  referenceNumber?: string;
  originBank?: string;
  destBank?: string;
  commissionPct?: Decimal;
  commissionAmount?: Decimal;
  totalIgtfAmount?: Decimal;
  date: Date;
  notes?: string;
  createdBy: string;
  idempotencyKey: string;
  lines: CreateBatchLineInput[];
  ipAddress?: string | null;
  userAgent?: string | null;
  // ADR-030: FK opcional a BankAccount para GL auto-posting en applyBatch()
  bankAccountId?: string | null;
};

export type ApplyBatchInput = {
  batchId: string;
  companyId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type VoidBatchInput = {
  batchId: string;
  companyId: string;
  userId: string;
  voidReason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type DiscardBatchInput = {
  batchId: string;
  companyId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const P2034_DELAYS = [0, 50, 100] as const;

function isP2034(err: unknown): err is Error {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "P2034"
  );
}

function serializeBatch(
  batch: {
    id: string;
    companyId: string;
    status: PaymentBatchStatus;
    method: PaymentMethod;
    totalAmountVes: Decimal;
    currency: string;
    totalAmountOriginal: Decimal | null;
    exchangeRateId: string | null;
    referenceNumber: string | null;
    originBank: string | null;
    destBank: string | null;
    commissionPct: Decimal | null;
    commissionAmount: Decimal | null;
    totalIgtfAmount: Decimal | null;
    date: Date;
    notes: string | null;
    voidReason: string | null;
    voidedAt: Date | null;
    voidedBy: string | null;
    createdAt: Date;
    createdBy: string;
    idempotencyKey: string;
    lines: {
      id: string;
      invoiceId: string;
      amountVes: Decimal;
      amountOriginal: Decimal | null;
      igtfAmount: Decimal | null;
      notes: string | null;
      invoice?: { invoiceNumber: string | null; counterpartName: string | null } | null;
    }[];
  }
): PaymentBatchSummary {
  return {
    id: batch.id,
    companyId: batch.companyId,
    status: batch.status,
    method: batch.method,
    totalAmountVes: batch.totalAmountVes.toString(),
    currency: batch.currency,
    totalAmountOriginal: batch.totalAmountOriginal?.toString() ?? null,
    exchangeRateId: batch.exchangeRateId,
    referenceNumber: batch.referenceNumber,
    originBank: batch.originBank,
    destBank: batch.destBank,
    commissionPct: batch.commissionPct?.toString() ?? null,
    commissionAmount: batch.commissionAmount?.toString() ?? null,
    totalIgtfAmount: batch.totalIgtfAmount?.toString() ?? null,
    date: batch.date,
    notes: batch.notes,
    voidReason: batch.voidReason,
    voidedAt: batch.voidedAt,
    voidedBy: batch.voidedBy,
    createdAt: batch.createdAt,
    createdBy: batch.createdBy,
    idempotencyKey: batch.idempotencyKey,
    lines: batch.lines.map((l) => ({
      id: l.id,
      invoiceId: l.invoiceId,
      invoiceNumber: l.invoice?.invoiceNumber ?? null,
      counterpartName: l.invoice?.counterpartName ?? null,
      amountVes: l.amountVes.toString(),
      amountOriginal: l.amountOriginal?.toString() ?? null,
      igtfAmount: l.igtfAmount?.toString() ?? null,
      notes: l.notes,
    })),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class PaymentBatchService {
  /**
   * Crea un lote en estado DRAFT con sus líneas. Read Committed.
   * Valida guards A/P (invoice.type === PURCHASE, companyId, no deletedAt) antes de persistir.
   */
  static async createBatch(input: CreateBatchInput): Promise<PaymentBatchSummary> {
    if (input.lines.length === 0) {
      throw new Error("El lote debe tener al menos una línea");
    }

    return prisma.$transaction(async (tx) => {
      // Validar cada factura: A/P, misma empresa, no anulada (ADR-022 D-3)
      for (const line of input.lines) {
        const invoice = await tx.invoice.findFirst({
          where: {
            id: line.invoiceId,
            companyId: input.companyId,
            type: "PURCHASE",
            deletedAt: null,
          },
          select: { id: true, invoiceNumber: true, paymentStatus: true },
        });
        if (!invoice) {
          throw new Error("Una de las facturas seleccionadas no es válida para esta empresa");
        }
        if (invoice.paymentStatus === "VOIDED") {
          throw new Error(`Factura ${invoice.invoiceNumber ?? "seleccionada"} está anulada`);
        }
        if (invoice.paymentStatus === "PAID") {
          throw new Error(`Factura ${invoice.invoiceNumber ?? "seleccionada"} ya está completamente pagada`);
        }
      }

      // FINDING-4: Calcular IGTF server-side — ignorar valor provisto por el cliente (ADR-022 D-6)
      const company = await tx.company.findFirst({
        where: { id: input.companyId },
        select: { isSpecialContributor: true },
      });
      const currency = input.currency ?? "VES";
      const igtfApplies = IGTFService.applies(currency, company?.isSpecialContributor ?? false);
      const IGTF_RATE = new Decimal(VEN_TAX_RATES.igtf);
      const computedTotalIgtf = igtfApplies
        ? input.totalAmountVes.mul(IGTF_RATE).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        : null;

      // Distribuir IGTF proporcionalmente a las líneas (con ajuste en la última para cuadrar)
      const linesWithIgtf = input.lines.map((l) => ({ ...l, computedIgtf: null as Decimal | null }));
      if (computedTotalIgtf) {
        let accumulated = new Decimal(0);
        for (let i = 0; i < linesWithIgtf.length; i++) {
          const isLast = i === linesWithIgtf.length - 1;
          if (isLast) {
            linesWithIgtf[i].computedIgtf = computedTotalIgtf.minus(accumulated);
          } else {
            const proportional = linesWithIgtf[i].amountVes
              .div(input.totalAmountVes)
              .mul(computedTotalIgtf)
              .toDecimalPlaces(4, Decimal.ROUND_DOWN);
            linesWithIgtf[i].computedIgtf = proportional;
            accumulated = accumulated.plus(proportional);
          }
        }
      }

      let batch;
      try {
        batch = await tx.paymentBatch.create({
          data: {
            companyId: input.companyId,
            method: input.method,
            totalAmountVes: input.totalAmountVes,
            currency,
            totalAmountOriginal: input.totalAmountOriginal ?? null,
            exchangeRateId: input.exchangeRateId ?? null,
            referenceNumber: input.referenceNumber ?? null,
            originBank: input.originBank ?? null,
            destBank: input.destBank ?? null,
            commissionPct: input.commissionPct ?? null,
            commissionAmount: input.commissionAmount ?? null,
            totalIgtfAmount: computedTotalIgtf,
            date: input.date,
            notes: input.notes ?? null,
            createdBy: input.createdBy,
            idempotencyKey: input.idempotencyKey,
            bankAccountId: input.bankAccountId ?? null, // ADR-030
            lines: {
              create: linesWithIgtf.map((l) => ({
                invoiceId: l.invoiceId,
                amountVes: l.amountVes,
                amountOriginal: l.amountOriginal ?? null,
                igtfAmount: l.computedIgtf,
                notes: l.notes ?? null,
              })),
            },
          },
          include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
        });
      } catch (err) {
        // FINDING-3: P2002 en idempotencyKey → mensaje de negocio (ADR-022 D-10)
        if (
          typeof err === "object" && err !== null &&
          "code" in err && (err as { code: string }).code === "P2002"
        ) {
          const meta = (err as { meta?: { target?: string[] } }).meta;
          if (meta?.target?.includes("idempotencyKey")) {
            throw new Error("El lote ya fue creado — refresque la página.");
          }
        }
        throw err;
      }

      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          entityId: batch.id,
          entityName: "PaymentBatch",
          action: "CREATE",
          userId: input.createdBy,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          newValue: {
            status: "DRAFT",
            totalAmountVes: input.totalAmountVes.toFixed(4),
            lineCount: input.lines.length,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });

      return serializeBatch(batch);
    });
  }

  /**
   * Aplica el lote: crea un InvoicePayment por línea y actualiza Invoice.
   * Serializable obligatorio para evitar sobrepago concurrente (ADR-022 D-4).
   * Retry hasta 3 veces en P2034 (SSI write-write conflict).
   */
  static async applyBatch(input: ApplyBatchInput): Promise<PaymentBatchSummary> {
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

      try {
        return await prisma.$transaction(
          async (tx) => {
            // Guard multi-tenant (ADR-004)
            const batch = await tx.paymentBatch.findFirst({
              where: { id: input.batchId, companyId: input.companyId, deletedAt: null },
              include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
            });
            if (!batch) throw new Error("Lote no encontrado o no pertenece a esta empresa");
            if (batch.status !== "DRAFT") {
              throw new Error(`El lote no puede aplicarse — estado actual: ${batch.status}`);
            }

            // Validar invariante de suma (ADR-022 D-1)
            PaymentBatchService.validateSumInvariant(batch);

            // Aplicar cada línea
            for (const line of batch.lines) {
              // Guard A/P + companyId dentro del mismo tx Serializable (ADR-022 D-3)
              const invoice = await tx.invoice.findFirst({
                where: {
                  id: line.invoiceId,
                  companyId: input.companyId,
                  type: "PURCHASE",
                  deletedAt: null,
                },
                select: { id: true, invoiceNumber: true, paymentStatus: true, pendingAmount: true, totalAmountVes: true },
              });
              if (!invoice) {
                throw new Error("Una de las facturas del lote no es válida para esta empresa");
              }
              if (invoice.paymentStatus === "VOIDED") {
                throw new Error(`Factura ${invoice.invoiceNumber ?? "seleccionada"} está anulada`);
              }

              const amountVes = new Decimal(line.amountVes.toString());
              const currentPending = invoice.pendingAmount
                ? new Decimal(invoice.pendingAmount.toString())
                : invoice.totalAmountVes
                  ? new Decimal(invoice.totalAmountVes.toString())
                  : new Decimal(0);

              if (amountVes.greaterThan(currentPending)) {
                throw new Error(
                  `El monto de la línea (${amountVes.toFixed(2)} Bs.D) excede el saldo pendiente de la factura ${invoice.invoiceNumber ?? "seleccionada"} (${currentPending.toFixed(2)} Bs.D)`
                );
              }

              // Idempotencia: batch:{batchId}:line:{lineId} (ADR-022 D-2)
              const idempotencyKey = `batch:${batch.id}:line:${line.id}`;

              await tx.invoicePayment.create({
                data: {
                  companyId: input.companyId,
                  invoiceId: line.invoiceId,
                  amount: amountVes,
                  currency: batch.currency as Currency,
                  amountOriginal: line.amountOriginal ?? null,
                  exchangeRateId: batch.exchangeRateId ?? null,
                  method: batch.method,
                  referenceNumber: batch.referenceNumber ?? null,
                  originBank: batch.originBank ?? null,
                  destBank: batch.destBank ?? null,
                  commissionPct: batch.commissionPct ?? null,
                  igtfAmount: line.igtfAmount ?? null,
                  date: batch.date,
                  notes: line.notes ?? batch.notes ?? null,
                  createdBy: input.userId,
                  idempotencyKey,
                },
              });

              const newPending = currentPending.minus(amountVes);
              const newStatus = newPending.isZero() ? "PAID" : "PARTIAL";

              await tx.invoice.update({
                where: { id: line.invoiceId },
                data: { pendingAmount: newPending, paymentStatus: newStatus },
              });
            }

            // Marcar batch APPLIED
            const applied = await tx.paymentBatch.update({
              where: { id: batch.id },
              data: { status: "APPLIED" },
              include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
            });

            // ADR-030: GL auto-posting — solo si bankAccountId + apAccountId configurados
            if (batch.bankAccountId) {
              const settings = await tx.companySettings.findUnique({
                where: { companyId: input.companyId },
                select: { apAccountId: true, igtfPayableAccountId: true },
              });
              if (settings?.apAccountId) {
                await PaymentGLService.postPaymentBatchGL(
                  tx,
                  {
                    paymentBatchId: batch.id,
                    bankAccountId: batch.bankAccountId,
                    lines: batch.lines.map((l) => ({
                      invoiceId: l.invoiceId,
                      amountVes: new Decimal(l.amountVes.toString()),
                      igtfAmount: l.igtfAmount ? new Decimal(l.igtfAmount.toString()) : null,
                    })),
                    context: {
                      companyId: input.companyId,
                      date: batch.date,
                      createdBy: input.userId,
                      description: `Pago lote ${batch.id.slice(-8)} — ${batch.method}`,
                      ipAddress: input.ipAddress ?? null,
                      userAgent: input.userAgent ?? null,
                    },
                  },
                  { apAccountId: settings.apAccountId, igtfPayableAccountId: settings.igtfPayableAccountId },
                );
              }
            }

            await tx.auditLog.create({
              data: {
                companyId: input.companyId,
                entityId: batch.id,
                entityName: "PaymentBatch",
                action: "APPLY",
                userId: input.userId,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                newValue: {
                  status: "APPLIED",
                  lineCount: batch.lines.length,
                  totalAmountVes: new Decimal(batch.totalAmountVes.toString()).toFixed(4),
                },
              },
            });

            return serializeBatch(applied);
          },
          { isolationLevel: "Serializable" }
        );
      } catch (err) {
        if (isP2034(err)) {
          lastErr = err;
          if (attempt === MAX_ATTEMPTS) throw new Error("Conflicto de concurrencia — reintente la operación");
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  }

  /**
   * Anula el lote: soft-delete de InvoicePayments, revierte Invoice, VOID el batch.
   * Serializable obligatorio (ADR-022 D-4).
   */
  static async voidBatch(input: VoidBatchInput): Promise<PaymentBatchSummary> {
    if (!input.voidReason?.trim()) {
      throw new Error("voidReason es obligatorio");
    }

    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

      try {
        return await prisma.$transaction(
          async (tx) => {
            // Guard multi-tenant (ADR-004)
            const batch = await tx.paymentBatch.findFirst({
              where: { id: input.batchId, companyId: input.companyId, deletedAt: null },
              include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
            });
            if (!batch) throw new Error("Lote no encontrado o no pertenece a esta empresa");
            if (batch.status !== "APPLIED") {
              throw new Error(`Solo se pueden anular lotes APPLIED. Estado actual: ${batch.status}`);
            }

            const now = new Date();

            // Revertir cada línea (ADR-022 D-5)
            for (const line of batch.lines) {
              const idempotencyKey = `batch:${batch.id}:line:${line.id}`;

              // Soft-delete del InvoicePayment generado
              const payment = await tx.invoicePayment.findUnique({
                where: { idempotencyKey },
                select: { id: true, amount: true, invoiceId: true },
              });

              if (payment) {
                await tx.invoicePayment.update({
                  where: { id: payment.id },
                  data: { deletedAt: now },
                });

                // Revertir pendingAmount y paymentStatus en Invoice
                const invoice = await tx.invoice.findFirst({
                  where: { id: line.invoiceId, companyId: input.companyId },
                  select: { id: true, pendingAmount: true, totalAmountVes: true, paymentStatus: true },
                });

                if (invoice) {
                  const amountVes = new Decimal(payment.amount.toString());
                  const currentPending = invoice.pendingAmount
                    ? new Decimal(invoice.pendingAmount.toString())
                    : new Decimal(0);
                  const totalVes = invoice.totalAmountVes
                    ? new Decimal(invoice.totalAmountVes.toString())
                    : new Decimal(0);

                  const newPending = currentPending.plus(amountVes);
                  const newStatus = newPending.greaterThanOrEqualTo(totalVes) ? "UNPAID" : "PARTIAL";

                  await tx.invoice.update({
                    where: { id: invoice.id },
                    data: { pendingAmount: newPending, paymentStatus: newStatus },
                  });
                }
              }
            }

            // ADR-030: revertir asiento GL si existe
            await PaymentGLService.reversePaymentBatchGL(tx, batch.id, input.companyId, input.userId, {
              companyId: input.companyId,
              date: now,
              createdBy: input.userId,
              description: `Anulación lote — ${input.voidReason}`,
              ipAddress: input.ipAddress ?? null,
              userAgent: input.userAgent ?? null,
            });

            // Marcar batch VOID
            const voided = await tx.paymentBatch.update({
              where: { id: batch.id },
              data: {
                status: "VOID",
                voidReason: input.voidReason,
                voidedAt: now,
                voidedBy: input.userId,
                deletedAt: now,
              },
              include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
            });

            await tx.auditLog.create({
              data: {
                companyId: input.companyId,
                entityId: batch.id,
                entityName: "PaymentBatch",
                action: "VOID",
                userId: input.userId,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                newValue: {
                  status: "VOID",
                  voidReason: input.voidReason,
                  voidedAt: now.toISOString(),
                },
              },
            });

            return serializeBatch(voided);
          },
          { isolationLevel: "Serializable" }
        );
      } catch (err) {
        if (isP2034(err)) {
          lastErr = err;
          if (attempt === MAX_ATTEMPTS) throw new Error("Conflicto de concurrencia — reintente la operación");
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  }

  /**
   * Descarta (soft-delete) un lote en estado DRAFT. HA-02.
   * Un DRAFT nunca tocó facturas ni GL, así que NO hay saldos ni asientos que revertir:
   * solo se marca deletedAt (la lista filtra por deletedAt: null) y se audita.
   * Read Committed normal — sin Serializable ni retry P2034 porque no hay contención
   * sobre facturas.
   */
  static async discardBatch(input: DiscardBatchInput): Promise<PaymentBatchSummary> {
    return prisma.$transaction(async (tx) => {
      // Guard multi-tenant (ADR-004)
      const batch = await tx.paymentBatch.findFirst({
        where: { id: input.batchId, companyId: input.companyId, deletedAt: null },
        include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
      });
      if (!batch) throw new Error("Lote no encontrado o no pertenece a esta empresa");
      if (batch.status !== "DRAFT") {
        throw new Error(
          "Solo se pueden descartar lotes en borrador (DRAFT). Los lotes aplicados deben anularse."
        );
      }
      if (batch.deletedAt) {
        throw new Error("El lote ya fue descartado");
      }

      const updated = await tx.paymentBatch.update({
        where: { id: batch.id },
        data: { deletedAt: new Date() },
        include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
      });

      // AuditLog en el mismo $transaction (R-6 trazabilidad)
      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          entityId: batch.id,
          entityName: "PaymentBatch",
          action: "DISCARD",
          userId: input.userId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          newValue: {
            status: "DRAFT",
            discarded: true,
          },
        },
      });

      return serializeBatch(updated);
    });
  }

  /**
   * Valida que SUM(lines.amountVes) === batch.totalAmountVes
   * y SUM(lines.igtfAmount) === batch.totalIgtfAmount (ADR-022 D-1, D-6).
   */
  static validateSumInvariant(batch: {
    totalAmountVes: Decimal;
    totalIgtfAmount: Decimal | null;
    lines: { amountVes: Decimal; igtfAmount: Decimal | null }[];
  }): void {
    const sumAmountVes = batch.lines.reduce(
      (acc, l) => acc.plus(new Decimal(l.amountVes.toString())),
      new Decimal(0)
    );
    const expectedVes = new Decimal(batch.totalAmountVes.toString());

    if (!sumAmountVes.equals(expectedVes)) {
      throw new Error(
        `Invariante de suma violada: SUM(lines.amountVes)=${sumAmountVes.toFixed(4)} ≠ totalAmountVes=${expectedVes.toFixed(4)}`
      );
    }

    if (batch.totalIgtfAmount !== null) {
      const sumIgtf = batch.lines.reduce(
        (acc, l) => acc.plus(new Decimal((l.igtfAmount ?? 0).toString())),
        new Decimal(0)
      );
      const expectedIgtf = new Decimal(batch.totalIgtfAmount.toString());
      if (!sumIgtf.equals(expectedIgtf)) {
        throw new Error(
          `Invariante IGTF violada: SUM(lines.igtfAmount)=${sumIgtf.toFixed(4)} ≠ totalIgtfAmount=${expectedIgtf.toFixed(4)}`
        );
      }
    }
  }

  /**
   * Obtiene un lote con sus líneas, verificando ownership (ADR-004).
   */
  static async getById(batchId: string, companyId: string): Promise<PaymentBatchSummary | null> {
    const batch = await prisma.paymentBatch.findFirst({
      where: { id: batchId, companyId },
      include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
    });
    return batch ? serializeBatch(batch) : null;
  }

  /**
   * Lista los lotes de una empresa, paginados por cursor (cursor-based, máx 50).
   */
  static async list(
    companyId: string,
    cursor?: string,
    limit = 50
  ): Promise<{ batches: PaymentBatchSummary[]; nextCursor: string | null }> {
    const take = limit + 1;
    // R-8: mostrar lotes activos (deletedAt: null) y los ANULADOS (status VOID) para
    // trazabilidad. Los borradores DESCARTADOS (status DRAFT + deletedAt) quedan ocultos:
    // no caen en ninguna de las dos ramas del OR.
    const batches = await prisma.paymentBatch.findMany({
      where: { companyId, OR: [{ deletedAt: null }, { status: "VOID" }] },
      include: { lines: { include: { invoice: { select: { invoiceNumber: true, counterpartName: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = batches.length === take;
    const page = hasMore ? batches.slice(0, limit) : batches;
    return {
      batches: page.map(serializeBatch),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
