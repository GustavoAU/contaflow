"use server";

import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { Currency, PaymentMethod } from "@prisma/client";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { CreatePaymentSchema } from "../schemas/payment.schema";
import { PaymentService, PaymentRecordSummary } from "../services/PaymentService";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { IGTFService, IGTF_RATE } from "@/modules/igtf/services/IGTFService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear registro de pago ───────────────────────────────────────────────────
export async function createPaymentAction(
  input: unknown,
): Promise<ActionResult<PaymentRecordSummary>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreatePaymentSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Datos inválidos";
      return { success: false, error: msg };
    }

    const d = parsed.data;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: d.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

    // IGTF: computar server-side con Decimal.js — nunca confiar en el valor del cliente
    const company = await prisma.company.findFirst({
      where: { id: d.companyId },
      select: { isSpecialContributor: true },
    });
    const igtfApplies = IGTFService.applies(d.currency, company?.isSpecialContributor ?? false);
    const computedIgtf = igtfApplies
      ? new Decimal(IGTFService.calculate(d.amountVes, IGTF_RATE).igtfAmount)
      : undefined;

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
            igtfAmount: computedIgtf,
            date: dateObj,
            notes: d.notes,
            createdBy: userId, // always use authenticated userId
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
                  igtfBase:   new Decimal(inv.igtfBase.toString()).plus(d.amountVes),
                  igtfAmount: new Decimal(inv.igtfAmount.toString()).plus(computedIgtf),
                },
              });
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

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const data = await PaymentService.list(companyId);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener pagos" };
  }
}
