// src/modules/invoices/services/InvoiceCreditDebitNoteService.ts
// Extraído MECÁNICAMENTE desde InvoiceService.ts (sin cambios de lógica) — split por tamaño de archivo.
import { Decimal } from "decimal.js";
import prismaDefault from "@/lib/prisma";
import type { TaxLineType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";
import { InvoiceGLPostingService } from "./InvoiceGLPostingService";
import { getNextControlNumber } from "./InvoiceSequenceService";
import { SeniatReportingService } from "./SeniatReportingService";

// ─── Types for NC/ND ─────────────────────────────────────────────────────────
export type CreateCreditDebitNoteInput = {
  relatedInvoiceId: string;
  invoiceNumber: string;
  date: Date;
  counterpartName: string;
  counterpartRif: string;
  taxLines: Array<{ taxType: string; base: string; rate: string; amount: string; description?: string }>;
  ivaRetentionAmount: string;
  islrRetentionAmount: string;
  igtfBase: string;
  igtfAmount: string;
  currency: string;
  companyId?: string;
  type?: string;
  docType?: string;
  taxCategory?: string;
  [key: string]: unknown;
};

// P2034 retry delays in ms: 0ms before attempt 1, 50ms before attempt 2, 100ms before attempt 3
const P2034_DELAYS = [0, 50, 100] as const;

function isP2034(err: unknown): err is Error {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "P2034";
}

// ─── Crear Nota de Crédito ───────────────────────────────────────────────────
export async function createCreditNote(
  companyId: string,
  data: CreateCreditDebitNoteInput,
  createdBy: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  const MAX_ATTEMPTS = 3;
  let lastP2034Err: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

    const txStart = Date.now();
    try {
  return await prismaDefault.$transaction(
    async (tx) => {
      // Guard multi-tenant: findFirst with companyId prevents IDOR (ADR-004)
      const original = await tx.invoice.findFirst({
        where: { id: data.relatedInvoiceId, companyId },
      });
      if (!original) {
        throw new Error("Factura original no encontrada o no pertenece a esta empresa");
      }

      // Loop prevention: only FACTURA can have NC/ND
      if (original.docType !== "FACTURA") {
        throw new Error("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
      }

      // Void guard: deletedAt or paymentStatus VOIDED
      if (original.deletedAt || original.paymentStatus === "VOIDED") {
        throw new Error("La factura original está anulada");
      }

      // Fix A2: período CLOSED guard (R-3) + auto-assign periodId (igual que createInvoice)
      const ncDate = new Date(data.date);
      const ncYear = ncDate.getFullYear();
      const ncMonth = ncDate.getMonth() + 1;
      const periodForDate = await tx.accountingPeriod.findFirst({
        where: { companyId, year: ncYear, month: ncMonth },
        select: { id: true, status: true, year: true, month: true },
      });
      if (periodForDate?.status === "CLOSED") {
        throw new Error(
          `No se puede registrar una nota de crédito en el período ${String(periodForDate.month).padStart(2, "0")}/${periodForDate.year} porque está CERRADO.`
        );
      }
      const resolvedPeriodId = periodForDate?.id ?? null;

      // Calculate totalAmountVes from taxLines (never trust client-side totalAmountVes)
      const totalAmountVes = data.taxLines.reduce(
        (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
        new Decimal(0)
      );

      // Amount guard
      const pendingAmount = original.pendingAmount ? new Decimal(original.pendingAmount.toString()) : new Decimal(0);
      if (totalAmountVes.greaterThan(pendingAmount)) {
        throw new Error("El monto de la nota supera el saldo pendiente de la factura original");
      }

      // Derive relatedDocNumber server-side — never from client input
      const relatedDocNumber = original.invoiceNumber;

      // H-002: auto-generar Nº Control para NC de Venta (Prov. 0071 Art. 14)
      const ncType = ((data.type as string) || original.type) as "SALE" | "PURCHASE";
      let ncControlNumber = (data as { controlNumber?: string }).controlNumber;
      if (ncType === "SALE" && !ncControlNumber) {
        ncControlNumber = await getNextControlNumber(tx, companyId, "SALE");
      }

      // Create the NC invoice
      const nc = await tx.invoice.create({
        data: {
          companyId,
          type: ncType,
          docType: "NOTA_CREDITO",
          taxCategory: (data.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION") ?? original.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION",
          invoiceNumber: data.invoiceNumber,
          controlNumber: ncControlNumber ?? null,
          date: data.date,
          counterpartName: data.counterpartName,
          counterpartRif: data.counterpartRif,
          ivaRetentionAmount: new Decimal(data.ivaRetentionAmount),
          islrRetentionAmount: new Decimal(data.islrRetentionAmount),
          igtfBase: new Decimal(data.igtfBase),
          igtfAmount: new Decimal(data.igtfAmount),
          currency: (data.currency as "VES" | "USD" | "EUR") ?? "VES",
          totalAmountVes,
          pendingAmount: new Decimal(0),
          paymentStatus: "PAID",
          relatedInvoiceId: data.relatedInvoiceId,
          relatedDocNumber,
          periodId: resolvedPeriodId,
          createdBy,
          taxLines: {
            create: data.taxLines.map((line) => ({
              taxType: line.taxType as TaxLineType,
              // B4: truncar a 2 decimales (consistencia BD ↔ PDF)
              base: new Decimal(line.base).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
              rate: new Decimal(line.rate),
              amount: new Decimal(line.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
              description: line.description ?? null,
            })),
          },
        },
        include: { taxLines: true },
      });

      // Update original invoice pendingAmount and paymentStatus
      const newPending = pendingAmount.minus(totalAmountVes);
      const newStatus = newPending.lessThanOrEqualTo(new Decimal(0)) ? "PAID" : "PARTIAL";
      await tx.invoice.update({
        where: { id: original.id },
        data: {
          pendingAmount: newPending,
          paymentStatus: newStatus,
        },
      });

      // Fix A2: GL reverso (ADR-026) — solo si GL está configurado en CompanySettings
      const ncSettings = await tx.companySettings.findUnique({
        where: { companyId },
        select: {
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
      if (ncSettings && InvoiceGLPostingService.canPost(ncType, ncSettings)) {
        await InvoiceGLPostingService.postCreditNote(
          {
            id: nc.id,
            type: ncType,
            docType: "NOTA_CREDITO",
            invoiceNumber: nc.invoiceNumber,
            counterpartName: nc.counterpartName,
            date: nc.date,
            periodId: resolvedPeriodId,
            totalAmountVes: nc.totalAmountVes,
            taxLines: nc.taxLines,
            igtfAmount: nc.igtfAmount,
          },
          ncSettings,
          companyId,
          createdBy,
          tx
        );
      }

      // PA-121: SeniatSubmission en el MISMO $transaction (ADR-019 D-1 / D-1.1d)
      // NC de venta es documento emitido → se transmite. Publish post-commit en la action.
      if (ncType === "SALE") {
        const ncCompany = await tx.company.findUnique({
          where: { id: companyId },
          select: { rif: true },
        });
        const payload = SeniatReportingService.buildPayload(nc, ncCompany?.rif ?? null);
        await SeniatReportingService.createSubmission(tx, companyId, nc.id, payload);
      }

      // AuditLog #1: NC creation
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: nc.id,
          entityName: "Invoice",
          action: "CREATE_NC",
          userId: createdBy,
          ipAddress,
          userAgent,
          newValue: {
            invoiceNumber: nc.invoiceNumber,
            relatedInvoiceId: data.relatedInvoiceId,
            relatedDocNumber,
            totalAmountVes: totalAmountVes.toFixed(2),
            companyId,
          },
        },
      });

      // AuditLog #2: original invoice pendingAmount update
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: original.id,
          entityName: "Invoice",
          action: "PENDING_AMOUNT_UPDATE",
          userId: createdBy,
          ipAddress,
          userAgent,
          newValue: {
            pendingAmount: newPending.toFixed(2),
            paymentStatus: newStatus,
          },
        },
      });

      return nc;
    },
    { isolationLevel: "Serializable" }
  );
    } catch (err: unknown) {
      if (isP2034(err)) {
        if (redis) {
          const key = `p2034:${companyId}:${new Date().toISOString().slice(0, 10)}`;
          await redis.pipeline().incr(key).expire(key, 604800).exec().catch(() => {});
        }
        lastP2034Err = err;
        if (attempt === MAX_ATTEMPTS) {
          Sentry.withScope((scope) => {
            scope.setTag("companyId", companyId);
            scope.setExtra("attempt", attempt);
            scope.setExtra("duration_ms", Date.now() - txStart);
            Sentry.captureMessage("P2034 createCreditNote", "warning");
          });
        }
        continue;
      }
      throw err;
    }
  }

  void lastP2034Err;
  throw new Error("Conflicto de concurrencia — reintente la operación");
}

// ─── Crear Nota de Débito ────────────────────────────────────────────────────
export async function createDebitNote(
  companyId: string,
  data: CreateCreditDebitNoteInput,
  createdBy: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  const MAX_ATTEMPTS = 3;
  let lastP2034Err: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

    const txStart = Date.now();
    try {
  return await prismaDefault.$transaction(
    async (tx) => {
      // Guard multi-tenant: findFirst with companyId prevents IDOR (ADR-004)
      const original = await tx.invoice.findFirst({
        where: { id: data.relatedInvoiceId, companyId },
      });
      if (!original) {
        throw new Error("Factura original no encontrada o no pertenece a esta empresa");
      }

      // Loop prevention: only FACTURA can have NC/ND
      if (original.docType !== "FACTURA") {
        throw new Error("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
      }

      // Soft-delete + VOID guard (ADR-006 HIGH-1: ambas condiciones obligatorias en NC y ND)
      if (original.deletedAt || original.paymentStatus === "VOIDED") {
        throw new Error("La factura original está anulada");
      }

      // Fix A2: período CLOSED guard (R-3) + auto-assign periodId
      const ndDate = new Date(data.date);
      const ndYear = ndDate.getFullYear();
      const ndMonth = ndDate.getMonth() + 1;
      const ndPeriodForDate = await tx.accountingPeriod.findFirst({
        where: { companyId, year: ndYear, month: ndMonth },
        select: { id: true, status: true, year: true, month: true },
      });
      if (ndPeriodForDate?.status === "CLOSED") {
        throw new Error(
          `No se puede registrar una nota de débito en el período ${String(ndPeriodForDate.month).padStart(2, "0")}/${ndPeriodForDate.year} porque está CERRADO.`
        );
      }
      const ndResolvedPeriodId = ndPeriodForDate?.id ?? null;

      // Calculate totalAmountVes from taxLines
      const totalAmountVes = data.taxLines.reduce(
        (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
        new Decimal(0)
      );

      // Derive relatedDocNumber server-side
      const relatedDocNumber = original.invoiceNumber;

      // H-002: auto-generar Nº Control para ND de Venta (Prov. 0071 Art. 14)
      const ndType = ((data.type as string) || original.type) as "SALE" | "PURCHASE";
      let ndControlNumber = (data as { controlNumber?: string }).controlNumber;
      if (ndType === "SALE" && !ndControlNumber) {
        ndControlNumber = await getNextControlNumber(tx, companyId, "SALE");
      }

      // Create the ND invoice
      const nd = await tx.invoice.create({
        data: {
          companyId,
          type: ndType,
          docType: "NOTA_DEBITO",
          taxCategory: (data.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION") ?? original.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION",
          invoiceNumber: data.invoiceNumber,
          controlNumber: ndControlNumber ?? null,
          date: data.date,
          counterpartName: data.counterpartName,
          counterpartRif: data.counterpartRif,
          ivaRetentionAmount: new Decimal(data.ivaRetentionAmount),
          islrRetentionAmount: new Decimal(data.islrRetentionAmount),
          igtfBase: new Decimal(data.igtfBase),
          igtfAmount: new Decimal(data.igtfAmount),
          currency: (data.currency as "VES" | "USD" | "EUR") ?? "VES",
          totalAmountVes,
          pendingAmount: totalAmountVes,
          paymentStatus: "UNPAID",
          relatedInvoiceId: data.relatedInvoiceId,
          relatedDocNumber,
          periodId: ndResolvedPeriodId,
          createdBy,
          taxLines: {
            create: data.taxLines.map((line) => ({
              taxType: line.taxType as TaxLineType,
              // B4: truncar a 2 decimales (consistencia BD ↔ PDF)
              base: new Decimal(line.base).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
              rate: new Decimal(line.rate),
              amount: new Decimal(line.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
              description: line.description ?? null,
            })),
          },
        },
        include: { taxLines: true },
      });

      // Update original invoice: pendingAmount increases, recalculate paymentStatus
      const originalPending = original.pendingAmount ? new Decimal(original.pendingAmount.toString()) : new Decimal(0);
      const newPending = originalPending.plus(totalAmountVes);
      // If was PAID and pendingAmount > 0 → PARTIAL; otherwise keep UNPAID
      const currentStatus = original.paymentStatus;
      const newStatus = newPending.greaterThan(new Decimal(0)) && currentStatus === "PAID"
        ? "PARTIAL"
        : currentStatus === "PAID" ? "PAID" : "UNPAID";

      await tx.invoice.update({
        where: { id: original.id },
        data: {
          pendingAmount: newPending,
          paymentStatus: newStatus,
        },
      });

      // Fix A2: GL posting ND (ADR-026) — misma dirección que factura original
      const ndSettings = await tx.companySettings.findUnique({
        where: { companyId },
        select: {
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
      if (ndSettings && InvoiceGLPostingService.canPost(ndType, ndSettings)) {
        await InvoiceGLPostingService.postInvoice(
          {
            id: nd.id,
            type: ndType,
            docType: "NOTA_DEBITO",
            invoiceNumber: nd.invoiceNumber,
            counterpartName: nd.counterpartName,
            date: nd.date,
            periodId: ndResolvedPeriodId,
            totalAmountVes: nd.totalAmountVes,
            taxLines: nd.taxLines,
            igtfAmount: nd.igtfAmount,
          },
          ndSettings,
          companyId,
          createdBy,
          tx
        );
      }

      // PA-121: SeniatSubmission en el MISMO $transaction (ADR-019 D-1 / D-1.1d)
      // ND de venta es documento emitido → se transmite. Publish post-commit en la action.
      if (ndType === "SALE") {
        const ndCompany = await tx.company.findUnique({
          where: { id: companyId },
          select: { rif: true },
        });
        const payload = SeniatReportingService.buildPayload(nd, ndCompany?.rif ?? null);
        await SeniatReportingService.createSubmission(tx, companyId, nd.id, payload);
      }

      // AuditLog #1: ND creation
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: nd.id,
          entityName: "Invoice",
          action: "CREATE_ND",
          userId: createdBy,
          ipAddress,
          userAgent,
          newValue: {
            invoiceNumber: nd.invoiceNumber,
            relatedInvoiceId: data.relatedInvoiceId,
            relatedDocNumber,
            totalAmountVes: totalAmountVes.toFixed(2),
            companyId,
          },
        },
      });

      // AuditLog #2: original invoice pendingAmount update
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: original.id,
          entityName: "Invoice",
          action: "PENDING_AMOUNT_UPDATE",
          userId: createdBy,
          ipAddress,
          userAgent,
          newValue: {
            pendingAmount: newPending.toFixed(2),
            paymentStatus: newStatus,
          },
        },
      });

      return nd;
    },
    { isolationLevel: "Serializable" }
  );
    } catch (err: unknown) {
      if (isP2034(err)) {
        if (redis) {
          const key = `p2034:${companyId}:${new Date().toISOString().slice(0, 10)}`;
          await redis.pipeline().incr(key).expire(key, 604800).exec().catch(() => {});
        }
        lastP2034Err = err;
        if (attempt === MAX_ATTEMPTS) {
          Sentry.withScope((scope) => {
            scope.setTag("companyId", companyId);
            scope.setExtra("attempt", attempt);
            scope.setExtra("duration_ms", Date.now() - txStart);
            Sentry.captureMessage("P2034 createDebitNote", "warning");
          });
        }
        continue;
      }
      throw err;
    }
  }

  void lastP2034Err;
  throw new Error("Conflicto de concurrencia — reintente la operación");
}

// ─── Obtener NC/ND de una factura ────────────────────────────────────────────
export async function getCreditDebitNotes(originalInvoiceId: string, companyId: string) {
  return prismaDefault.invoice.findMany({
    where: {
      relatedInvoiceId: originalInvoiceId,
      companyId,
      deletedAt: null,
    },
    orderBy: [{ date: "asc" }],
  });
}
