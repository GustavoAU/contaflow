// src/modules/receivables/actions/receivable.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import type { Currency, PaymentMethod } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { ReceivableService } from "../services/ReceivableService";
import type { AgingReport, InvoicePaymentSummary, ReceivablePage } from "../services/ReceivableService";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import {
  RecordPaymentSchema,
  CancelPaymentSchema,
  AgingReportFilterSchema,
  UpdatePaymentTermsSchema,
} from "../schemas/receivable.schema";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";
// ADR-032 F2: la vía canónica de pagos vive en el módulo payments — receivables delega
import { PaymentService, type PaymentRecordSummary } from "@/modules/payments/services/PaymentService";
import { PaymentGLService } from "@/modules/payments/services/PaymentGLService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { isPrismaError } from "@/lib/prisma-errors";

// ─── Obtener cartera CxC (Aging) ───────────────────────────────────────────────
export async function getReceivablesAction(
  companyId: string,
  asOf?: string
): Promise<ActionResult<AgingReport>> {
  const parsed = AgingReportFilterSchema.safeParse({ companyId, type: "CXC", asOf });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL — todos los roles pueden consultar CxC (incluye VIEWER y ADMINISTRATIVE)
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const report = await ReceivableService.getReceivables(companyId, parsed.data.asOf);
    return { success: true, data: report };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener cartera CxP (Aging) ───────────────────────────────────────────────
export async function getPayablesAction(
  companyId: string,
  asOf?: string
): Promise<ActionResult<AgingReport>> {
  const parsed = AgingReportFilterSchema.safeParse({ companyId, type: "CXP", asOf });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL — todos los roles pueden consultar CxP
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const report = await ReceivableService.getPayables(companyId, parsed.data.asOf);
    return { success: true, data: report };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listado paginado CxC cursor-based ────────────────────────────────────────
export async function getReceivablesPaginatedAction(
  companyId: string,
  asOf: Date,
  cursor?: string,
  limit?: number
): Promise<ActionResult<ReceivablePage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const page = await ReceivableService.getReceivablesPaginated(companyId, asOf, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listado paginado CxP cursor-based ────────────────────────────────────────
export async function getPayablesPaginatedAction(
  companyId: string,
  asOf: Date,
  cursor?: string,
  limit?: number
): Promise<ActionResult<ReceivablePage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const page = await ReceivableService.getPayablesPaginated(companyId, asOf, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Registrar pago sobre una factura ──────────────────────────────────────────
// ADR-032 F2 (D-5): vía CANÓNICA — crea PaymentRecord (saldo + IGTF + GL),
// ya NO crea InvoicePayment (entidad legacy, solo lectura desde F2).
export async function recordPaymentAction(
  input: unknown
): Promise<ActionResult<PaymentRecordSummary>> {
  const parsed = RecordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    const d = parsed.data;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: d.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    // ── H-003 follow-up (Z-2, CRÍTICO): amountVes autoritativo server-side ─────
    // El dialog de CxC permite cobrar en USD/EUR (EFECTIVO/ZELLE) y envía `amount`
    // en la MONEDA seleccionada. Tratarlo como VES sub-aplica el saldo (la factura
    // está en VES) y sub-declara el IGTF (Art. 4 LGTF: la base es el equivalente
    // en Bs. del pago en divisa). Para divisa se RECALCULA amountVes =
    // amountOriginal × tasa BCV oficial (última ≤ fecha). Todo Decimal.js (R-5).
    let amountVes: Decimal;
    let amountOriginal: Decimal | undefined;
    // INFO-1: para divisa persistimos el id de la tasa REALMENTE aplicada (no el
    // que envía el cliente) para que la trazabilidad coincida con el amountVes.
    let resolvedExchangeRateId = d.exchangeRateId;
    if (d.currency === "VES") {
      amountVes = new Decimal(d.amount);
      amountOriginal = d.amountOriginal ? new Decimal(d.amountOriginal) : undefined;
    } else {
      // `amount` ES el monto en divisa cuando currency !== VES
      amountOriginal = new Decimal(d.amount);
      // getRateForDate lanza error en español si no hay tasa → propaga (no se crea el cobro)
      const rate = await ExchangeRateService.getRateForDate(
        d.companyId,
        d.currency as Currency,
        d.date,
      );
      amountVes = amountOriginal
        .mul(new Decimal(rate.rate))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      resolvedExchangeRateId = rate.id;
    }

    // IGTF: computar server-side con Decimal.js — sobre el amountVes autoritativo,
    // nunca sobre el valor crudo del cliente
    const company = await prisma.company.findFirst({
      where: { id: d.companyId },
      select: { isSpecialContributor: true },
    });
    const igtfApplies = IGTFService.applies(d.currency, company?.isSpecialContributor ?? false);
    const computedIgtf = igtfApplies
      ? new Decimal(IGTFService.calculate(amountVes.toString(), IGTF_RATE).igtfAmount)
      : undefined;

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const result = await prisma.$transaction(
      async (tx) =>
        withCompanyContext(d.companyId, tx, async (tx) => {
          // H-004 (R-3): la fecha del pago debe caer en el período contable abierto
          await PeriodService.assertDateInOpenPeriod(d.companyId, d.date, tx);

          // Idempotencia: paridad con el flujo legacy (InvoicePayment.idempotencyKey)
          const existing = await tx.paymentRecord.findUnique({
            where: { idempotencyKey: d.idempotencyKey },
            select: { id: true },
          });
          if (existing) {
            throw new Error("Pago duplicado — ya existe un pago con esta clave de idempotencia");
          }

          // ADR-032 F1: saldo + guards (FOR UPDATE, sobre-pago tolerancia 0,
          // año fiscal cerrado R-3, factura anulada) — mismo $transaction.
          // El saldo de la factura es VES → aplicar el amountVes autoritativo.
          await PaymentService.applyPaymentToInvoice(
            tx,
            d.companyId,
            d.invoiceId,
            amountVes,
          );

          const record = await PaymentService.create(tx as typeof prisma, {
            companyId: d.companyId,
            invoiceId: d.invoiceId,
            method: d.method as PaymentMethod,
            amountVes,
            currency: d.currency as Currency,
            amountOriginal,
            exchangeRateId: resolvedExchangeRateId,
            referenceNumber: d.referenceNumber,
            originBank: d.originBank,
            destBank: d.destBank,
            commissionPct: d.commissionPct ? new Decimal(d.commissionPct) : undefined,
            igtfAmount: computedIgtf,
            date: d.date,
            notes: d.notes,
            createdBy: userId, // siempre el userId autenticado — nunca el del cliente
            bankAccountId: d.bankAccountId,
            appliedToInvoice: true,
            idempotencyKey: d.idempotencyKey,
          });

          // Leer tipo de factura para IGTF acumulado y dirección del asiento GL
          const inv = await tx.invoice.findFirst({
            where: { id: d.invoiceId, companyId: d.companyId },
            select: { type: true, igtfBase: true, igtfAmount: true, invoiceNumber: true },
          });

          // IGTF acumulado en la factura SALE (paridad con createPaymentAction).
          // Base acumulada = amountVes autoritativo (no el amount crudo del cliente).
          if (computedIgtf && inv?.type === "SALE") {
            await tx.invoice.update({
              where: { id: d.invoiceId },
              data: {
                igtfBase: new Decimal(inv.igtfBase.toString()).plus(amountVes),
                igtfAmount: new Decimal(inv.igtfAmount.toString()).plus(computedIgtf),
              },
            });
          }

          // ADR-032 F2 (D-5): GL según dirección — SALE → COBRO (Dr Banco / Cr CxC),
          // PURCHASE → PAGO (Dr CxP / Cr Banco). Sin bankAccountId → sin asiento
          // (degradación graceful, igual que el módulo payments — ADR-030).
          if (d.bankAccountId && inv) {
            const settings = await tx.companySettings.findUnique({
              where: { companyId: d.companyId },
              select: {
                arAccountId: true,
                apAccountId: true,
                igtfPayableAccountId: true,
                fxGainAccountId: true,
                fxLossAccountId: true,
                ivaRetentionReceivableAccountId: true,
              },
            });

            const glInput = {
              paymentRecordId: record.id,
              bankAccountId: d.bankAccountId,
              amountVes,
              igtfAmount: computedIgtf ?? null,
              invoiceId: d.invoiceId,
              amountOriginal,
              currency: d.currency,
              context: {
                companyId: d.companyId,
                date: d.date,
                createdBy: userId,
                description: `${inv.type === "SALE" ? "Cobro" : "Pago"} factura ${inv.invoiceNumber} — ${d.method}`,
                ipAddress,
                userAgent,
              },
            };

            if (inv.type === "SALE" && settings?.arAccountId) {
              await PaymentGLService.postPaymentRecordGL(tx, glInput, {
                arAccountId: settings.arAccountId,
                igtfPayableAccountId: settings.igtfPayableAccountId,
                fxGainAccountId: settings.fxGainAccountId,
                fxLossAccountId: settings.fxLossAccountId,
                ivaRetentionReceivableAccountId: settings.ivaRetentionReceivableAccountId,
              });
            } else if (inv.type === "PURCHASE" && settings?.apAccountId) {
              await PaymentGLService.postVendorPaymentRecordGL(tx, glInput, {
                apAccountId: settings.apAccountId,
                igtfPayableAccountId: settings.igtfPayableAccountId,
              });
            }
          }

          // R-6: AuditLog con IP/UA en el mismo $transaction
          await tx.auditLog.create({
            data: {
              companyId: d.companyId,
              entityId: record.id,
              entityName: "PaymentRecord",
              action: "CREATE",
              userId,
              ipAddress,
              userAgent,
              newValue: {
                source: "receivables", // ADR-032 F2: vía canónica desde cartera
                method: d.method,
                // H-003: registrar el amountVes autoritativo, no el valor del cliente
                amountVes: amountVes.toString(),
                amountOriginal: amountOriginal ? amountOriginal.toString() : null,
                currency: d.currency,
                exchangeRateId: resolvedExchangeRateId ?? null,
                date: d.date.toISOString(),
                invoiceId: d.invoiceId,
                bankAccountId: d.bankAccountId ?? null,
                appliedToInvoice: true,
              },
            },
          });

          return record;
        }),
      { timeout: 30000 },
    );

    revalidatePath(`/company/${d.companyId}/receivables`);
    revalidatePath(`/company/${d.companyId}/payables`);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error && error.message.includes("clave de idempotencia")) {
      return { success: false, error: error.message };
    }
    if (isPrismaError(error, "P2002")) {
      // Race: dos submits simultáneos con la misma key — el unique de BD ganó
      return { success: false, error: "Pago duplicado — ya existe un pago con esta clave de idempotencia" };
    }
    return toActionError(error);
  }
}

// ─── Cancelar un pago ──────────────────────────────────────────────────────────
// Solo ADMIN u OWNER pueden cancelar pagos (operación de anulación — ADR-006 D-1)
export async function cancelPaymentAction(
  input: unknown
): Promise<ActionResult<{ ok: true }>> {
  const parsed = CancelPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "No autorizado" };
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    // ADR-032 F2: detectar el origen del pago. Los pagos canónicos (PaymentRecord)
    // se anulan con reverso GL + restauración de saldo; los legacy (InvoicePayment)
    // siguen el flujo histórico de ReceivableService.
    const canonical = await prisma.paymentRecord.findFirst({
      where: { id: parsed.data.paymentId, companyId: parsed.data.companyId },
      select: { id: true, deletedAt: true, invoiceId: true, appliedToInvoice: true, amountVes: true },
    });

    if (canonical) {
      if (canonical.deletedAt) return { success: false, error: "El pago ya está anulado" };

      await prisma.$transaction(async (tx) => {
        // ADR-030: reverso del asiento GL si existe
        await PaymentGLService.reversePaymentRecordGL(
          tx, parsed.data.paymentId, parsed.data.companyId, userId,
          {
            companyId: parsed.data.companyId,
            date: new Date(),
            createdBy: userId,
            description: "Anulación de pago desde cartera (CxC/CxP)",
            ipAddress,
            userAgent,
          },
        );

        await PaymentService.void(
          tx as typeof prisma, parsed.data.paymentId, parsed.data.companyId,
          "Anulado desde cartera (CxC/CxP)",
        );

        // ADR-032 D-4: restaurar saldo SOLO si este pago lo decrementó
        if (canonical.appliedToInvoice && canonical.invoiceId) {
          await PaymentService.revertPaymentFromInvoice(
            tx, parsed.data.companyId, canonical.invoiceId, parsed.data.paymentId,
            new Decimal(canonical.amountVes.toString()),
          );
        }

        // R-6: AuditLog en el mismo $transaction
        await tx.auditLog.create({
          data: {
            companyId: parsed.data.companyId,
            entityId: parsed.data.paymentId,
            entityName: "PaymentRecord",
            action: "VOID",
            userId,
            ipAddress,
            userAgent,
            newValue: {
              source: "receivables",
              voidReason: "Anulado desde cartera (CxC/CxP)",
              saldoRestaurado: canonical.appliedToInvoice && !!canonical.invoiceId,
            },
          },
        });
      });
    } else {
      // Pago legacy (InvoicePayment) — flujo histórico
      await ReceivableService.cancelPayment(parsed.data.paymentId, parsed.data.companyId, userId, ipAddress, userAgent);
    }

    revalidatePath(`/company/${parsed.data.companyId}/receivables`);
    revalidatePath(`/company/${parsed.data.companyId}/payables`);
    return { success: true, data: { ok: true } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Obtener pagos de una factura ──────────────────────────────────────────────
export async function getPaymentsByInvoiceAction(
  invoiceId: string,
  companyId: string
): Promise<ActionResult<InvoicePaymentSummary[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: ROLES.ALL
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.read);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    const payments = await ReceivableService.getPaymentsByInvoice(invoiceId, companyId);
    return { success: true, data: payments };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Actualizar plazo de pago de empresa ───────────────────────────────────────
// Solo ADMIN puede cambiar la configuración de plazos
export async function updatePaymentTermsAction(
  input: unknown
): Promise<ActionResult<{ paymentTermDays: number }>> {
  const parsed = UpdatePaymentTermsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo los administradores pueden cambiar el plazo de pago" };
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes alcanzado" };

    // MEDIUM-04: AuditLog en el mismo $transaction que la mutación — R-6
    const company = await prisma.$transaction(async (tx) => {
      const prev = await tx.company.findUnique({
        where: { id: parsed.data.companyId },
        select: { paymentTermDays: true },
      });
      const updated = await tx.company.update({
        where: { id: parsed.data.companyId },
        data: { paymentTermDays: parsed.data.paymentTermDays },
        select: { paymentTermDays: true },
      });
      await tx.auditLog.create({
        data: {
          companyId: parsed.data.companyId,
          entityId: parsed.data.companyId,
          entityName: "Company",
          action: "UPDATE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { paymentTermDays: prev?.paymentTermDays ?? null },
          newValue: { paymentTermDays: parsed.data.paymentTermDays },
        },
      });
      return updated;
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true, data: { paymentTermDays: company.paymentTermDays } };
  } catch (error) {
    return toActionError(error);
  }
}
