/**
 * SeniatReportingService — Fase 35H (ADR-019 D-1 / D-4) + Addendum D-1.1 (2026-06-10)
 *
 * Implementa el patrón Outbox para transmisión PA-121 al SENIAT:
 *   - createSubmission(tx, ...)   → fila SeniatSubmission DENTRO del mismo $transaction
 *                                   que persiste la factura/NC/ND (invariante D-1).
 *   - publishForInvoice(invoiceId) → publica a QStash DESPUÉS del commit (D-1.1a).
 *                                   Nunca lanza: si falla, la submission queda PENDING
 *                                   y el poller /api/cron/seniat-outbox la rescata (D-1.1b).
 *   - transmit(submissionId)      → worker QStash; idempotente sobre SENT/ACKNOWLEDGED.
 *
 * Invariante D-1.1: NUNCA I/O HTTP externo dentro de un $transaction Prisma.
 *
 * NOTA: SeniatHttpAdapter es un stub hasta que el SENIAT publique su API de homologación.
 */

import { Client as QStashClient } from "@upstash/qstash";
import type { Invoice, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import * as Sentry from "@sentry/nextjs";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SeniatPayload {
  invoiceId: string;
  invoiceNumber: string;
  controlNumber: string | null;
  type: string;
  docType: string;
  date: string;
  companyRif: string | null;
  counterpartRif: string | null;
  counterpartName: string | null;
  currency: string;
  totalAmount: string;
  taxLines: Array<{
    taxType: string;
    base: string;
    rate: string;
    amount: string;
  }>;
  emittedAt: string;
}

export interface TransmitResult {
  success: boolean;
  referenceId?: string;
  error?: string;
}

/** Factura con taxLines tal como sale de invoice.create({ include: { taxLines: true } }) */
export type InvoiceForPayload = Invoice & {
  taxLines?: Array<{
    taxType: string;
    base: Prisma.Decimal;
    rate: Prisma.Decimal;
    amount: Prisma.Decimal;
  }>;
};

// ─── Stub del adapter HTTP SENIAT (ADR-019 D-4) ──────────────────────────────

class SeniatHttpAdapter {
  async send(_payload: SeniatPayload): Promise<TransmitResult> {
    if (process.env.NODE_ENV === "development") {
      return { success: true, referenceId: `MOCK-${Date.now()}` };
    }
    // En producción: API no disponible aún — SeniatSubmission queda en PENDING
    console.warn("[SeniatHttpAdapter] API SENIAT no configurada — submission permanece PENDING");
    return { success: false, error: "API SENIAT no disponible" };
  }
}

const httpAdapter = new SeniatHttpAdapter();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * URL base de la app para el callback de QStash.
 * Precedencia: NEXT_PUBLIC_APP_URL > https://VERCEL_URL > localhost.
 * (D-1.1: el operador ?? mezclado con ?: sin paréntesis producía "https://undefined".)
 */
export function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

// ─── Servicio principal ───────────────────────────────────────────────────────

export class SeniatReportingService {
  /**
   * Construye el payload de transmisión a partir de una factura/NC/ND.
   * Solo incluye campos normados — sin IDs internos ni metadatos de sistema.
   * R-5: los Decimal se serializan como string, nunca number.
   */
  static buildPayload(invoice: InvoiceForPayload, companyRif: string | null): SeniatPayload {
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber ?? null,
      type: invoice.type,
      docType: invoice.docType,
      date: invoice.date.toISOString().split("T")[0],
      companyRif,
      counterpartRif: invoice.counterpartRif ?? null,
      counterpartName: invoice.counterpartName ?? null,
      currency: invoice.currency,
      totalAmount: invoice.totalAmountVes?.toString() ?? "0",
      taxLines: (invoice.taxLines ?? []).map((tl) => ({
        taxType: tl.taxType,
        base: tl.base.toString(),
        rate: tl.rate.toString(),
        amount: tl.amount.toString(),
      })),
      emittedAt: new Date().toISOString(),
    };
  }

  /**
   * Crea la SeniatSubmission (outbox row).
   * DEBE llamarse dentro del mismo $transaction que crea la factura/NC/ND (ADR-019 D-1).
   * NO publica a QStash — eso ocurre post-commit vía publishForInvoice (D-1.1a).
   */
  static async createSubmission(
    tx: Prisma.TransactionClient,
    companyId: string,
    invoiceId: string,
    payload: SeniatPayload
  ) {
    return tx.seniatSubmission.create({
      data: {
        companyId,
        invoiceId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Publica la submission de una factura a QStash. Llamar SOLO después del commit
   * del $transaction que creó el documento (ADR-019 D-1.1a).
   *
   * Nunca lanza: cualquier fallo deja la submission en PENDING (el poller
   * /api/cron/seniat-outbox la rescata) y reporta a Sentry.
   *
   * @returns true si se encoló en QStash; false si no (sin token, sin submission, o error).
   */
  static async publishForInvoice(invoiceId: string): Promise<boolean> {
    try {
      const token = process.env.QSTASH_TOKEN;
      if (!token) {
        // Patrón no-op de src/lib/ratelimit.ts: sin infra configurada → degradación silenciosa
        console.warn("[SeniatReportingService] QSTASH_TOKEN no configurado — submission queda PENDING (poller la recogerá)");
        return false;
      }

      const submission = await prisma.seniatSubmission.findUnique({
        where: { invoiceId },
        select: { id: true },
      });
      if (!submission) return false;

      return await SeniatReportingService.publishSubmission(submission.id, token);
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag("invoiceId", invoiceId);
        Sentry.captureException(err);
      });
      return false;
    }
  }

  /**
   * Publica una submission concreta a QStash (usado por publishForInvoice y el poller).
   * Nunca lanza — retorna false ante cualquier fallo.
   */
  static async publishSubmission(submissionId: string, token?: string): Promise<boolean> {
    try {
      const qstashToken = token ?? process.env.QSTASH_TOKEN;
      if (!qstashToken) return false;

      const qstash = new QStashClient({ token: qstashToken });
      await qstash.publishJSON({
        url: `${resolveAppBaseUrl()}/api/webhooks/seniat-report`,
        body: { submissionId },
        retries: 5,
      });
      return true;
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag("submissionId", submissionId);
        Sentry.captureException(err);
      });
      return false;
    }
  }

  /**
   * Transmite una SeniatSubmission al SENIAT (llamado por el worker QStash).
   */
  static async transmit(submissionId: string): Promise<TransmitResult> {
    return await Sentry.startSpan(
      {
        name: "seniat.transmit",
        op: "http.client",
        attributes: {
          "contaflow.submission_id": submissionId,
        },
      },
      async () => {
        const submission = await prisma.seniatSubmission.findUnique({
          where: { id: submissionId },
        });

        if (!submission) {
          return { success: false, error: "Submission no encontrada" };
        }

        // Idempotencia PA-121: descarta reintentos duplicados de QStash (Z-4)
        // status IN [SENT, ACKNOWLEDGED] → ya transmitida, no re-enviar.
        if (submission.status === "SENT" || submission.status === "ACKNOWLEDGED") {
          return { success: true, referenceId: "already-sent" };
        }

        const payload = submission.payload as unknown as SeniatPayload;
        const result = await httpAdapter.send(payload);

        if (result.success) {
          await prisma.seniatSubmission.update({
            where: { id: submissionId },
            data: {
              status: "SENT",
              sentAt: new Date(),
              lastResponse: result as unknown as Prisma.InputJsonValue,
            },
          });
        } else {
          const nextAttempts = submission.attempts + 1;
          await prisma.seniatSubmission.update({
            where: { id: submissionId },
            data: {
              status: nextAttempts >= 5 ? "FAILED" : "PENDING",
              attempts: nextAttempts,
              lastResponse: result as unknown as Prisma.InputJsonValue,
            },
          });
        }

        return result;
      }
    );
  }
}
