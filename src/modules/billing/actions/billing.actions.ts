// src/modules/billing/actions/billing.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import * as BillingService from "../services/BillingService";
import { CreateCheckoutSchema, type CreateCheckoutInput } from "../schemas/billing.schema";

// ─── Tipo de respuesta estándar ───────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── createCheckoutAction ─────────────────────────────────────────────────────

export async function createCheckoutAction(
  input: CreateCheckoutInput,
): Promise<ActionResult<{ invoiceUrl: string; subscriptionPaymentId: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const validated = CreateCheckoutSchema.parse(input);

    // Verificar que el usuario es OWNER de la empresa
    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    // ADR-025: intencionalmente solo OWNER puede gestionar la suscripción
    if (member.role !== "OWNER") {
      return { success: false, error: "Solo el Propietario puede gestionar la suscripción." };
    }

    const h = await headers();
    const ipAddress =
      h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const result = await BillingService.createCheckout(
      validated.companyId,
      validated.plan,
      userId,
      ipAddress,
      userAgent,
    );

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: "Datos inválidos" };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al crear el checkout" };
  }
}
