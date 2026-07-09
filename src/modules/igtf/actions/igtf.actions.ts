// src/modules/igtf/actions/igtf.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { IGTFService, IGTF_RATE } from "../services/IGTFService";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";
import { limiters } from "@/lib/ratelimit";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export type IGTFSummary = {
  id: string;
  amount: string;
  igtfRate: string;
  igtfAmount: string;
  currency: string;
  concept: string;
  createdAt: Date;
};

const CreateIGTFSchema = z.object({
  companyId: z.string().min(1),
  amount: z.string().refine(
    (v) => {
      try {
        const d = new Decimal(v);
        return d.gt(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
      } catch {
        return false;
      }
    },
    { error: "Monto inválido o fuera del rango permitido" }
  ),
  currency: z.enum(SUPPORTED_CURRENCIES),
  concept: z.string().min(1, { error: "Concepto requerido" }),
  transactionId: z.string().optional(),
  createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
});

export type CreateIGTFInput = z.infer<typeof CreateIGTFSchema>;

// ─── Crear IGTF ───────────────────────────────────────────────────────────────
export async function createIGTFAction(input: CreateIGTFInput): Promise<ActionResult<IGTFSummary>> {
  try {
    const parsed = CreateIGTFSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const data = parsed.data;

    const ctx = await requireCompanyAction(data.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const userId = ctx.userId;
    const ipAddress = ctx.ipAddress;
    const userAgent = ctx.userAgent;

    const calc = IGTFService.calculate(data.amount, IGTF_RATE);

    const igtf = await prisma.$transaction(async (tx) =>
      withCompanyContext(data.companyId, tx, async (tx) => {
        const created = await tx.iGTFTransaction.create({
          data: {
            companyId: data.companyId,
            amount: new Decimal(data.amount),
            igtfRate: new Decimal(IGTF_RATE),
            igtfAmount: new Decimal(calc.igtfAmount),
            currency: data.currency,
            concept: data.concept,
            transactionId: data.transactionId ?? null,
            createdBy: userId, // always use authenticated userId
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: data.companyId,
            entityId: created.id,
            entityName: "IGTFTransaction",
            action: "CREATE",
            userId, // always use authenticated userId
            ipAddress,
            userAgent,
            newValue: { amount: data.amount, currency: data.currency, igtfAmount: calc.igtfAmount },
          },
        });

        return created;
      })
    );

    revalidatePath(`/company/${data.companyId}/igtf`);

    return {
      success: true,
      data: {
        id: igtf.id,
        amount: igtf.amount.toString(),
        igtfRate: igtf.igtfRate.toString(),
        igtfAmount: igtf.igtfAmount.toString(),
        currency: igtf.currency,
        concept: igtf.concept,
        createdAt: igtf.createdAt,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Listar IGTF ──────────────────────────────────────────────────────────────
export async function getIGTFAction(companyId: string): Promise<ActionResult<IGTFSummary[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const records = await prisma.iGTFTransaction.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: records.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        igtfRate: r.igtfRate.toString(),
        igtfAmount: r.igtfAmount.toString(),
        currency: r.currency,
        concept: r.concept,
        createdAt: r.createdAt,
      })),
    };
  } catch (error) {
    return toActionError(error);
  }
}
