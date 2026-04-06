// src/modules/igtf/actions/igtf.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { IGTFService, IGTF_RATE } from "../services/IGTFService";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

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
  amount: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, { error: "Monto inválido" }),
  currency: z.enum(["USD", "EUR", "VES"]),
  concept: z.string().min(1, { error: "Concepto requerido" }),
  transactionId: z.string().optional(),
  createdBy: z.string().min(1),
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

    const rl = await checkRateLimit(`${data.companyId}:${data.createdBy}`, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

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
            createdBy: data.createdBy,
          },
        });

        await tx.auditLog.create({
          data: {
            entityId: created.id,
            entityName: "IGTFTransaction",
            action: "CREATE",
            userId: data.createdBy,
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
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al registrar el IGTF" };
  }
}

// ─── Listar IGTF ──────────────────────────────────────────────────────────────
export async function getIGTFAction(companyId: string): Promise<ActionResult<IGTFSummary[]>> {
  try {
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
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los registros IGTF" };
  }
}
