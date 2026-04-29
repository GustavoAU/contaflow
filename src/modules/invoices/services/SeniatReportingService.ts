/**
 * SeniatReportingService — Fase 35H (ADR-019 D-1 / D-4)
 *
 * Implementa el patrón Outbox para transmisión PA-121 al SENIAT.
 * El registro SeniatSubmission se crea dentro del mismo $transaction que la factura.
 * Un worker QStash consume la cola y reintenta con backoff exponencial.
 *
 * NOTA: SeniatHttpAdapter es un stub hasta que el SENIAT publique su API de homologación.
 */

import { Client as QStashClient } from "@upstash/qstash";
import type { Invoice, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SeniatPayload {
  invoiceId: string;
  invoiceNumber: string;
  controlNumber: string | null;
  type: string;
  date: string;
  companyRif: string | null;
  counterpartRif: string | null;
  counterpartName: string | null;
  currency: string;
  totalAmount: string;
  taxLines: Array<{
    type: string;
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

// ─── Servicio principal ───────────────────────────────────────────────────────

export class SeniatReportingService {
  /**
   * Construye el payload de transmisión a partir de una factura.
   * Solo incluye campos normados — sin IDs internos ni metadatos de sistema.
   */
  static buildPayload(
    invoice: Invoice & {
      company: { rif: string | null };
      taxLines?: Array<{
        type: string;
        base: Prisma.Decimal;
        rate: Prisma.Decimal;
        amount: Prisma.Decimal;
      }>;
    }
  ): SeniatPayload {
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber ?? null,
      type: invoice.type,
      date: invoice.date.toISOString().split("T")[0],
      companyRif: invoice.company.rif,
      counterpartRif: invoice.counterpartRif ?? null,
      counterpartName: invoice.counterpartName ?? null,
      currency: invoice.currency,
      totalAmount: invoice.totalAmountVes?.toString() ?? "0",
      taxLines: (invoice.taxLines ?? []).map((tl) => ({
        type: tl.type,
        base: tl.base.toString(),
        rate: tl.rate.toString(),
        amount: tl.amount.toString(),
      })),
      emittedAt: new Date().toISOString(),
    };
  }

  /**
   * Encola una SeniatSubmission.
   * DEBE llamarse dentro del mismo $transaction que crea la factura (ADR-019 D-1).
   *
   * @param tx - Transacción Prisma activa
   * @param companyId - ID de la empresa emisora
   * @param invoiceId - ID de la factura emitida
   * @param payload - Payload construido con buildPayload()
   */
  static async enqueue(
    tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
    companyId: string,
    invoiceId: string,
    payload: SeniatPayload
  ) {
    const submission = await tx.seniatSubmission.create({
      data: {
        companyId,
        invoiceId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    // Encolar en QStash para procesamiento asíncrono
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      console.warn("[SeniatReportingService] QSTASH_TOKEN no configurado — submission creada en DB pero no encolada en QStash");
      return submission;
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const qstash = new QStashClient({ token });
    await qstash.publishJSON({
      url: `${baseUrl}/api/webhooks/seniat-report`,
      body: { submissionId: submission.id },
      retries: 5,
    });

    return submission;
  }

  /**
   * Transmite una SeniatSubmission al SENIAT (llamado por el worker QStash).
   * Implementa idempotencia: si status=SENT, retorna sin re-transmitir.
   */
  static async transmit(submissionId: string): Promise<TransmitResult> {
    const submission = await prisma.seniatSubmission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      return { success: false, error: "Submission no encontrada" };
    }

    // Idempotencia (ADR-019 MEDIUM finding): no retransmitir si ya fue enviada
    if (submission.status === "SENT") {
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
}
