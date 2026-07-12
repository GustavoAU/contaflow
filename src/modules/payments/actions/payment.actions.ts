"use server";

import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { Currency, PaymentMethod } from "@prisma/client";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { CreatePaymentSchema } from "../schemas/payment.schema";
import { PaymentService, PaymentRecordSummary } from "../services/PaymentService";
import { limiters } from "@/lib/ratelimit";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { PaymentAttachmentService, AttachmentSummary } from "../services/PaymentAttachmentService";
import { PaymentGLService } from "../services/PaymentGLService";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { isPrismaError } from "@/lib/prisma-errors";

// ─── Crear registro de pago ───────────────────────────────────────────────────
export async function createPaymentAction(
  input: unknown,
): Promise<ActionResult<PaymentRecordSummary>> {
  try {
    const parsed = CreatePaymentSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const ctx = await requireCompanyAction(d.companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    const dateObj = new Date(d.date + "T00:00:00.000Z");

    // ── H-003 (Z-2, CRÍTICO): amountVes autoritativo server-side ──────────────
    // El campo "Equivalente en Bs.D" del cliente es editable y NO se debe confiar:
    // manipularlo sub-declara el IGTF (Art. 4 LGTF). Para pagos en divisa el
    // amountVes se RECALCULA = amountOriginal × tasa BCV oficial (última ≤ fecha).
    // Para VES se usa tal cual. Todo con Decimal.js (R-5).
    let amountVes: Decimal;
    // INFO-1: para divisa, persistimos el id de la tasa REALMENTE aplicada (no el que
    // manda el cliente) para que la trazabilidad coincida con el amountVes recalculado.
    let resolvedExchangeRateId = d.exchangeRateId;
    if (d.currency === "VES") {
      amountVes = new Decimal(d.amountVes);
    } else {
      if (!d.amountOriginal) {
        throw new Error("Falta el monto en divisa para el pago en " + d.currency);
      }
      const rate = await ExchangeRateService.getRateForDate(
        d.companyId,
        d.currency as Currency,
        dateObj,
      );
      amountVes = new Decimal(d.amountOriginal)
        .mul(new Decimal(rate.rate))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      resolvedExchangeRateId = rate.id;
    }

    // IGTF: computar server-side con Decimal.js — sobre el amountVes autoritativo
    const company = await prisma.company.findFirst({
      where: { id: d.companyId },
      select: { isSpecialContributor: true },
    });
    const igtfApplies = IGTFService.applies(d.currency, company?.isSpecialContributor ?? false);
    const computedIgtf = igtfApplies
      ? new Decimal(IGTFService.calculate(amountVes.toString(), IGTF_RATE).igtfAmount)
      : undefined;

    const result = await prisma.$transaction(
      async (tx) =>
        withCompanyContext(d.companyId, tx, async (tx) => {
          // H-004 (R-3): la fecha del pago debe caer en el período contable abierto
          await PeriodService.assertDateInOpenPeriod(d.companyId, dateObj, tx);

          // H6 (ADR-032): idempotencia — un reintento (timeout de red, doble pestaña,
          // POST directo) con la misma clave NO crea un segundo pago. Paridad con
          // recordPaymentAction (CxC). El @unique de BD es el backstop ante el race.
          // companyId en el where (security-agent LOW): el pre-check no debe actuar
          // como oráculo global de existencia de claves de otros tenants (ADR-004).
          const dupe = await (tx as typeof prisma).paymentRecord.findFirst({
            where: { idempotencyKey: d.idempotencyKey, companyId: d.companyId },
            select: { id: true },
          });
          if (dupe) {
            throw new Error("Pago duplicado — ya existe un pago con esta clave de idempotencia");
          }

          // ADR-032 F1: PaymentRecord es la vía canónica — aplica el pago al saldo
          // de la factura DENTRO del mismo $transaction. FOR UPDATE serializa
          // contra pagos concurrentes; guards: anulada, año cerrado, sobre-pago.
          if (d.invoiceId) {
            await PaymentService.applyPaymentToInvoice(
              tx,
              d.companyId,
              d.invoiceId,
              amountVes,
            );
          }

          const record = await PaymentService.create(tx as typeof prisma, {
            companyId: d.companyId,
            invoiceId: d.invoiceId,
            method: d.method as PaymentMethod,
            amountVes,
            currency: d.currency as Currency,
            amountOriginal: d.amountOriginal ? new Decimal(d.amountOriginal) : undefined,
            exchangeRateId: resolvedExchangeRateId,
            referenceNumber: d.referenceNumber,
            originBank: d.originBank,
            destBank: d.destBank,
            senderPhone: d.senderPhone,
            destPhone: d.destPhone,
            commissionPct: d.commissionPct ? new Decimal(d.commissionPct) : undefined,
            commissionAmount: d.commissionAmount ? new Decimal(d.commissionAmount) : undefined,
            igtfAmount: computedIgtf,
            ivaRetentionAmount: d.ivaRetentionAmount ? new Decimal(d.ivaRetentionAmount) : undefined,
            date: dateObj,
            notes: d.notes,
            createdBy: userId, // always use authenticated userId
            bankAccountId: d.bankAccountId,
            // ADR-032 F1: el saldo ya fue decrementado arriba dentro de esta tx
            appliedToInvoice: !!d.invoiceId,
            // H6 (ADR-032): dedupe de doble-submit — @unique en BD
            idempotencyKey: d.idempotencyKey,
          });

          // Acumular igtfBase/igtfAmount en la factura vinculada.
          // Necesario cuando el pago en divisa se registra después de emitir la factura
          // (Invoice.igtfBase queda en 0 si se llenó sin pago simultáneo).
          if (computedIgtf && d.invoiceId) {
            const inv = await (tx as typeof prisma).invoice.findUnique({
              where: { id: d.invoiceId },
              select: { type: true, igtfBase: true, igtfAmount: true },
            });
            if (inv?.type === "SALE") {
              await (tx as typeof prisma).invoice.update({
                where: { id: d.invoiceId },
                data: {
                  igtfBase:   new Decimal(inv.igtfBase.toString()).plus(amountVes),
                  igtfAmount: new Decimal(inv.igtfAmount.toString()).plus(computedIgtf),
                },
              });
            }
          }

          // ADR-030: GL auto-posting — solo si bankAccountId + invoiceId + arAccountId configurados
          if (d.bankAccountId && d.invoiceId) {
            const settings = await (tx as typeof prisma).companySettings.findUnique({
              where: { companyId: d.companyId },
              select: {
                arAccountId: true,
                igtfPayableAccountId: true,
                fxGainAccountId: true,                  // NIC 21 diferencial cambiario
                fxLossAccountId: true,
                ivaRetentionReceivableAccountId: true,  // Riesgo-6 audit
              },
            });
            if (settings?.arAccountId) {
              await PaymentGLService.postPaymentRecordGL(
                tx,
                {
                  paymentRecordId: record.id,
                  bankAccountId: d.bankAccountId,
                  amountVes,
                  igtfAmount: computedIgtf ?? null,
                  invoiceId: d.invoiceId,
                  amountOriginal: d.amountOriginal ? new Decimal(d.amountOriginal) : undefined,
                  currency: d.currency,
                  ivaRetentionAmount: d.ivaRetentionAmount ? new Decimal(d.ivaRetentionAmount) : undefined,
                  context: {
                    companyId: d.companyId,
                    date: dateObj,
                    createdBy: userId,
                    description: `Cobro ${d.notes?.trim() || "efectuado"} — ${d.method}`,
                    ipAddress,
                    userAgent,
                  },
                },
                {
                  arAccountId: settings.arAccountId,
                  igtfPayableAccountId: settings.igtfPayableAccountId,
                  fxGainAccountId: settings.fxGainAccountId,
                  fxLossAccountId: settings.fxLossAccountId,
                  ivaRetentionReceivableAccountId: settings.ivaRetentionReceivableAccountId,
                },
              );
            }
          }

          await (tx as typeof prisma).auditLog.create({
            data: {
              companyId: d.companyId,
              entityId: record.id,
              entityName: "PaymentRecord",
              action: "CREATE",
              userId,
              ipAddress,
              userAgent,
              newValue: {
                method: d.method,
                // H-003: registrar el amountVes autoritativo, no el valor del cliente
                amountVes: amountVes.toString(),
                currency: d.currency,
                date: d.date,
                invoiceId: d.invoiceId ?? null,
                bankAccountId: d.bankAccountId ?? null,
                // ADR-032 F1: trazabilidad de la aplicación al saldo
                appliedToInvoice: !!d.invoiceId,
              },
            },
          });

          return record;
        }),
      { timeout: 30000 },
    );

    revalidatePath(`/company/${d.companyId}/payments`);
    return { success: true, data: result };
  } catch (err) {
    // H6 (ADR-032): duplicado detectado por el pre-check dentro de la tx
    if (err instanceof Error && err.message.includes("clave de idempotencia")) {
      return { success: false, error: err.message };
    }
    // H6: race — dos submits simultáneos con la misma key; el @unique de BD ganó.
    // Acotado al target idempotencyKey para no enmascarar otros uniques de la tx.
    if (
      isPrismaError(err, "P2002") &&
      (err.meta?.target as string[] | undefined)?.includes("idempotencyKey")
    ) {
      return { success: false, error: "Pago duplicado — ya existe un pago con esta clave de idempotencia" };
    }
    // Sanitización centralizada: errores de negocio (español) pasan; errores técnicos
    // de BD/Postgres (p.ej. "permission denied for schema public") → mensaje genérico en español.
    return toActionError(err);
  }
}

// ─── Anular pago (#14) ────────────────────────────────────────────────────────
export async function voidPaymentRecordAction(
  companyId: string,
  paymentId: string,
  voidReason: string,
): Promise<ActionResult<PaymentRecordSummary>> {
  try {
    if (!voidReason?.trim()) return { success: false, error: "El motivo de anulación es obligatorio" };

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    // Verificar que el pago pertenece a esta empresa y no está ya anulado
    const existing = await prisma.paymentRecord.findFirst({
      where: { id: paymentId, companyId },
      select: { id: true, deletedAt: true, invoiceId: true, appliedToInvoice: true, amountVes: true },
    });
    if (!existing) return { success: false, error: "Pago no encontrado" };
    if (existing.deletedAt) return { success: false, error: "El pago ya está anulado" };

    const result = await prisma.$transaction(async (tx) => {
      // ADR-030: revertir asiento GL si existe (antes de anular el registro)
      await PaymentGLService.reversePaymentRecordGL(tx, paymentId, companyId, userId, {
        companyId,
        date: new Date(),
        createdBy: userId,
        description: `Anulación pago — ${voidReason.trim()}`,
        ipAddress,
        userAgent,
      });

      const voided = await PaymentService.void(tx as typeof prisma, paymentId, companyId, voidReason.trim());

      // ADR-032 F1 (D-4): void en espejo — restaura el saldo SOLO si este pago
      // lo decrementó al crearse (appliedToInvoice). Los pagos legacy nunca
      // tocaron saldo y restaurarlo corrompería la cartera.
      if (existing.appliedToInvoice && existing.invoiceId) {
        await PaymentService.revertPaymentFromInvoice(
          tx,
          companyId,
          existing.invoiceId,
          paymentId,
          new Decimal(existing.amountVes.toString()),
        );
      }

      await (tx as typeof prisma).auditLog.create({
        data: {
          companyId,
          entityId: paymentId,
          entityName: "PaymentRecord",
          action: "VOID",
          userId,
          ipAddress,
          userAgent,
          newValue: { voidReason: voidReason.trim() },
        },
      });
      return voided;
    });

    revalidatePath(`/company/${companyId}/payments`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Obtener adjuntos de un pago ──────────────────────────────────────────────
export async function getPaymentAttachmentsAction(
  companyId: string,
  paymentRecordId: string,
): Promise<ActionResult<AttachmentSummary[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;

    const data = await PaymentAttachmentService.getAttachmentsByPaymentRecord(
      paymentRecordId,
      companyId,
    );
    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Eliminar adjunto (soft-delete) ───────────────────────────────────────────
// Roles: OWNER, ADMIN, ACCOUNTANT (ADMINISTRATIVE y VIEWER bloqueados — ADR-029 D-5)
export async function deleteAttachmentAction(
  companyId: string,
  attachmentId: string,
): Promise<ActionResult<void>> {
  try {
    // Solo OWNER/ADMIN/ACCOUNTANT pueden eliminar comprobantes (ADR-029 D-5)
    const ctx = await requireCompanyAction(companyId, {
      roles: ["OWNER", "ADMIN", "ACCOUNTANT"],
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    await PaymentAttachmentService.softDeleteAttachment(
      attachmentId,
      companyId,
      userId,
      ipAddress,
      userAgent,
    );

    revalidatePath(`/company/${companyId}/payments`);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Listar cuentas bancarias activas (para selector GL auto-posting ADR-030) ─
export type BankAccountOption = {
  id: string;
  name: string;
  bankName: string;
  currency: string;
};

export async function listBankAccountsAction(
  companyId: string,
): Promise<ActionResult<BankAccountOption[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;

    const accounts = await prisma.bankAccount.findMany({
      where: { companyId, isActive: true, deletedAt: null },
      select: { id: true, name: true, bankName: true, currency: true },
      orderBy: { name: "asc" },
    });

    return {
      success: true,
      data: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        bankName: a.bankName,
        currency: a.currency,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Analizar comprobante con Gemini OCR (ADR-030 D-4) ───────────────────────
export type ReceiptAnalysisResult = {
  method: "EFECTIVO" | "TRANSFERENCIA" | "PAGOMOVIL" | "ZELLE" | "CASHEA" | null;
  amount: string | null;
  currency: "VES" | "USD" | "EUR" | null;
  referenceNumber: string | null;
  originBank: string | null;
  destBank: string | null;
  senderPhone: string | null;
  destPhone: string | null;
  date: string | null; // YYYY-MM-DD
  confidence: number;
};

/**
 * Analiza un comprobante bancario con Gemini y retorna campos para pre-llenar PaymentForm.
 * NO crea ningún registro en BD — solo lectura + llamada externa.
 * Rate limit: limiters.ocr (10/min por usuario).
 */
export async function analyzeReceiptAction(
  companyId: string,
  attachmentId: string,
): Promise<ActionResult<ReceiptAnalysisResult>> {
  try {
    // VIEWER no puede analizar comprobantes (ADR-030 D-4.2)
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.ocr,
    });
    if (!ctx.ok) return ctx.error;

    // Verificar que el adjunto pertenece a esta empresa (ADR-004)
    const attachment = await prisma.paymentAttachment.findFirst({
      where: { id: attachmentId, companyId, deletedAt: null },
      select: { blobUrl: true, mimeType: true },
    });
    if (!attachment) return { success: false, error: "Comprobante no encontrado" };

    // Verificar que GEMINI_API_KEY está configurado
    if (!process.env.GEMINI_API_KEY) {
      return { success: false, error: "El análisis con IA no está disponible en esta configuración." };
    }

    // Descargar el blob y convertir a base64 (Gemini inline_data)
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15000);

    let fileBase64: string;
    try {
      const fileResponse = await fetch(attachment.blobUrl, { signal: abortController.signal });
      if (!fileResponse.ok) throw new Error("Blob no accesible");
      const buffer = await fileResponse.arrayBuffer();
      fileBase64 = Buffer.from(buffer).toString("base64");
    } catch {
      return { success: false, error: "El análisis con IA no está disponible ahora mismo." };
    } finally {
      clearTimeout(timeout);
    }

    // Llamar a Gemini 2.0 Flash con JSON mode
    const geminiBody = {
      contents: [
        {
          parts: [
            {
              text: `Analiza este comprobante bancario venezolano. Extrae los siguientes campos y devuelve SOLO un JSON válido (sin markdown, sin explicaciones):
{
  "method": "PAGOMOVIL" | "TRANSFERENCIA" | "ZELLE" | "EFECTIVO" | null,
  "amount": "<monto numérico como string, punto decimal>" | null,
  "currency": "VES" | "USD" | "EUR" | null,
  "referenceNumber": "<número de referencia o confirmación>" | null,
  "originBank": "<nombre del banco emisor>" | null,
  "destBank": "<nombre del banco receptor>" | null,
  "senderPhone": "<teléfono del emisor, solo dígitos>" | null,
  "destPhone": "<teléfono del receptor, solo dígitos>" | null,
  "date": "<fecha en formato YYYY-MM-DD>" | null,
  "confidence": <número entre 0.0 y 1.0 indicando confianza general>
}
Para PagoMóvil: captura banco origen, banco destino, teléfono emisor, teléfono receptor, monto, referencia, fecha.
Para Zelle: captura monto USD, referencia, fecha.
Para transferencia: captura banco origen, número de referencia, monto, fecha.
Si algún campo no es visible o legible, devuelve null para ese campo.`,
            },
            {
              inline_data: {
                mime_type: attachment.mimeType,
                data: fileBase64,
              },
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    };

    const abortController2 = new AbortController();
    const timeout2 = setTimeout(() => abortController2.abort(), 15000);

    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
          signal: abortController2.signal,
        },
      );
    } catch {
      return { success: false, error: "El análisis con IA no está disponible ahora mismo." };
    } finally {
      clearTimeout(timeout2);
    }

    if (!geminiResponse.ok) {
      return { success: false, error: "El análisis con IA no está disponible ahora mismo." };
    }

    let parsed: ReceiptAnalysisResult;
    try {
      const geminiJson = (await geminiResponse.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const raw = JSON.parse(text) as Partial<ReceiptAnalysisResult>;

      // Validar y sanitizar respuesta — nunca confiar ciegamente en Gemini
      parsed = {
        method: ["EFECTIVO", "TRANSFERENCIA", "PAGOMOVIL", "ZELLE", "CASHEA"].includes(
          raw.method ?? "",
        )
          ? (raw.method as ReceiptAnalysisResult["method"])
          : null,
        amount: typeof raw.amount === "string" && /^\d+(\.\d+)?$/.test(raw.amount)
          ? raw.amount
          : null,
        currency: ["VES", "USD", "EUR"].includes(raw.currency ?? "")
          ? (raw.currency as ReceiptAnalysisResult["currency"])
          : null,
        referenceNumber: typeof raw.referenceNumber === "string"
          ? raw.referenceNumber.slice(0, 100)
          : null,
        originBank: typeof raw.originBank === "string" ? raw.originBank.slice(0, 100) : null,
        destBank: typeof raw.destBank === "string" ? raw.destBank.slice(0, 100) : null,
        senderPhone: typeof raw.senderPhone === "string"
          ? raw.senderPhone.replace(/\D/g, "").slice(0, 20)
          : null,
        destPhone: typeof raw.destPhone === "string"
          ? raw.destPhone.replace(/\D/g, "").slice(0, 20)
          : null,
        date:
          typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null,
        confidence:
          typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
            ? raw.confidence
            : 0,
      };
    } catch {
      return { success: false, error: "El análisis con IA no está disponible ahora mismo." };
    }

    return { success: true, data: parsed };
  } catch {
    return { success: false, error: "El análisis con IA no está disponible ahora mismo." };
  }
}

// ─── Listar pagos ─────────────────────────────────────────────────────────────
export async function listPaymentsAction(
  companyId: string,
): Promise<ActionResult<PaymentRecordSummary[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL, limiter: limiters.read });
    if (!ctx.ok) return ctx.error;

    const data = await PaymentService.list(companyId);
    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}
