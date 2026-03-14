// src/modules/retentions/actions/retention.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { CreateRetentionSchema, type CreateRetentionInput } from "../schemas/retention.schema";
import { RetentionService } from "../services/RetentionService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type RetentionSummary = {
  id: string;
  providerName: string;
  providerRif: string;
  invoiceNumber: string;
  invoiceDate: Date;
  invoiceAmount: string;
  ivaRetention: string;
  islrAmount: string | null;
  totalRetention: string;
  type: string;
  status: string;
  createdAt: Date;
};

// ─── Crear retención ──────────────────────────────────────────────────────────
export async function createRetentionAction(
  input: CreateRetentionInput
): Promise<ActionResult<RetentionSummary>> {
  try {
    const parsed = CreateRetentionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const data = parsed.data;

    // Calcular retenciones
    const calc = RetentionService.calculate(
      data.taxBase,
      data.ivaRetentionPct as 75 | 100,
      data.islrCode
    );

    const retention = await prisma.retencion.create({
      data: {
        companyId: data.companyId,
        providerName: data.providerName,
        providerRif: data.providerRif,
        invoiceNumber: data.invoiceNumber,
        invoiceDate: data.invoiceDate,
        invoiceAmount: new Decimal(data.invoiceAmount),
        taxBase: new Decimal(data.taxBase),
        ivaAmount: new Decimal(calc.ivaAmount),
        ivaRetention: new Decimal(calc.ivaRetention),
        ivaRetentionPct: new Decimal(calc.ivaRetentionPct),
        islrAmount: calc.islrAmount ? new Decimal(calc.islrAmount) : null,
        islrRetentionPct: calc.islrRetentionPct ? new Decimal(calc.islrRetentionPct) : null,
        totalRetention: new Decimal(calc.totalRetention),
        type: data.type,
        status: "PENDING",
        createdBy: data.createdBy,
      },
    });

    // AuditLog
    await prisma.auditLog.create({
      data: {
        entityId: retention.id,
        entityName: "Retencion",
        action: "CREATE",
        userId: data.createdBy,
        newValue: {
          providerRif: data.providerRif,
          invoiceNumber: data.invoiceNumber,
          totalRetention: calc.totalRetention,
        },
      },
    });

    revalidatePath(`/company/${data.companyId}/retentions`);

    return {
      success: true,
      data: {
        id: retention.id,
        providerName: retention.providerName,
        providerRif: retention.providerRif,
        invoiceNumber: retention.invoiceNumber,
        invoiceDate: retention.invoiceDate,
        invoiceAmount: retention.invoiceAmount.toString(),
        ivaRetention: retention.ivaRetention.toString(),
        islrAmount: retention.islrAmount?.toString() ?? null,
        totalRetention: retention.totalRetention.toString(),
        type: retention.type,
        status: retention.status,
        createdAt: retention.createdAt,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al crear la retención" };
  }
}

// ─── Listar retenciones ───────────────────────────────────────────────────────
export async function getRetentionsAction(
  companyId: string
): Promise<ActionResult<RetentionSummary[]>> {
  try {
    const retentions = await prisma.retencion.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: retentions.map((r) => ({
        id: r.id,
        providerName: r.providerName,
        providerRif: r.providerRif,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        invoiceAmount: r.invoiceAmount.toString(),
        ivaRetention: r.ivaRetention.toString(),
        islrAmount: r.islrAmount?.toString() ?? null,
        totalRetention: r.totalRetention.toString(),
        type: r.type,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener las retenciones" };
  }
}
