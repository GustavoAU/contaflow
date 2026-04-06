"use server";

import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { Currency, PaymentMethod } from "@prisma/client";
import { CreatePaymentSchema } from "../schemas/payment.schema";
import { PaymentService, PaymentRecordSummary } from "../services/PaymentService";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear registro de pago ───────────────────────────────────────────────────
export async function createPaymentAction(
  input: unknown,
): Promise<ActionResult<PaymentRecordSummary>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(limiters.fiscal, userId);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreatePaymentSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;
    const dateObj = new Date(d.date + "T00:00:00.000Z");

    const result = await prisma.$transaction(
      async (tx) =>
        withCompanyContext(d.companyId, tx, async (tx) => {
          const record = await PaymentService.create(tx as typeof prisma, {
            companyId: d.companyId,
            invoiceId: d.invoiceId,
            method: d.method as PaymentMethod,
            amountVes: new Decimal(d.amountVes),
            currency: d.currency as Currency,
            amountOriginal: d.amountOriginal ? new Decimal(d.amountOriginal) : undefined,
            exchangeRateId: d.exchangeRateId,
            referenceNumber: d.referenceNumber,
            originBank: d.originBank,
            destBank: d.destBank,
            commissionPct: d.commissionPct ? new Decimal(d.commissionPct) : undefined,
            commissionAmount: d.commissionAmount ? new Decimal(d.commissionAmount) : undefined,
            igtfAmount: d.igtfAmount ? new Decimal(d.igtfAmount) : undefined,
            date: dateObj,
            notes: d.notes,
            createdBy: d.createdBy,
          });

          await (tx as typeof prisma).auditLog.create({
            data: {
              entityId: record.id,
              entityName: "PaymentRecord",
              action: "CREATE",
              userId,
              newValue: {
                method: d.method,
                amountVes: d.amountVes,
                currency: d.currency,
                date: d.date,
                invoiceId: d.invoiceId ?? null,
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
    if (err instanceof Error) {
      // Sanitizar errores de Prisma/DB — no exponer detalles técnicos al cliente
      const raw = err.message;
      if (raw.includes("Transaction") || raw.includes("Prisma") || raw.includes("connect")) {
        return { success: false, error: "Error al registrar el pago. Intente nuevamente." };
      }
      return { success: false, error: raw };
    }
    return { success: false, error: "Error al registrar el pago" };
  }
}

// ─── Listar pagos ─────────────────────────────────────────────────────────────
export async function listPaymentsAction(
  companyId: string,
): Promise<ActionResult<PaymentRecordSummary[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const data = await PaymentService.list(companyId);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener pagos" };
  }
}
