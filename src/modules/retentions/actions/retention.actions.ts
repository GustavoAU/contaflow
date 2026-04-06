// src/modules/retentions/actions/retention.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CreateRetentionSchema, type CreateRetentionInput } from "../schemas/retention.schema";
import { RetentionService, linkRetentionToInvoice, getNextVoucherNumber } from "../services/RetentionService";
import { generateRetentionVoucherPDF } from "../services/RetentionVoucherPDFService";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";

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
  voucherNumber: string | null;
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

    const rl = await checkRateLimit(`${data.companyId}:${data.createdBy}`, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    // Fase 15: Guard — no permitir retenciones en ejercicios cerrados
    const retYear = data.invoiceDate.getFullYear();
    const retYearClosed = await FiscalYearCloseService.isFiscalYearClosed(data.companyId, retYear);
    if (retYearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${retYear} está cerrado. No se pueden registrar retenciones en ejercicios cerrados.`,
      };
    }

    // Calcular retenciones
    const calc = RetentionService.calculate(
      data.taxBase,
      data.ivaRetentionPct as 75 | 100,
      data.islrCode
    );

    // Idempotencia: clave provista por cliente o generada aquí (constante para este request)
    const idempotencyKey = data.idempotencyKey ?? crypto.randomUUID();

    // Fast path: si ya existe una retención con esta clave, retornar la existente
    if (data.idempotencyKey) {
      const existing = await prisma.retencion.findFirst({
        where: { idempotencyKey, companyId: data.companyId },
      });
      if (existing) {
        return {
          success: true,
          data: {
            id: existing.id,
            providerName: existing.providerName,
            providerRif: existing.providerRif,
            invoiceNumber: existing.invoiceNumber,
            invoiceDate: existing.invoiceDate,
            invoiceAmount: existing.invoiceAmount.toString(),
            ivaRetention: existing.ivaRetention.toString(),
            islrAmount: existing.islrAmount?.toString() ?? null,
            totalRetention: existing.totalRetention.toString(),
            voucherNumber: existing.voucherNumber ?? null,
            type: existing.type,
            status: existing.status,
            createdAt: existing.createdAt,
          },
        };
      }
    }

    // $transaction Serializable — getNextVoucherNumber requiere SSI
    const retention = await prisma.$transaction(async (tx) => {
      const voucherNumber = await getNextVoucherNumber(tx, data.companyId);

      const ret = await tx.retencion.create({
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
          voucherNumber,
          type: data.type,
          status: "PENDING",
          createdBy: data.createdBy,
          idempotencyKey,
        },
      });

      await tx.auditLog.create({
        data: {
          entityId: ret.id,
          entityName: "Retencion",
          action: "CREATE",
          userId: data.createdBy,
          newValue: {
            providerRif: data.providerRif,
            invoiceNumber: data.invoiceNumber,
            totalRetention: calc.totalRetention,
            voucherNumber,
          },
        },
      });

      return ret;
    }, { isolationLevel: "Serializable" });

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
        voucherNumber: retention.voucherNumber ?? null,
        type: retention.type,
        status: retention.status,
        createdAt: retention.createdAt,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      // Race condition: otro request con la misma clave ganó — buscar y retornar el existente
      if (error.message.includes("P2002") && input.idempotencyKey) {
        const existing = await prisma.retencion.findFirst({
          where: { idempotencyKey: input.idempotencyKey, companyId: input.companyId },
        });
        if (existing) {
          return {
            success: true,
            data: {
              id: existing.id,
              providerName: existing.providerName,
              providerRif: existing.providerRif,
              invoiceNumber: existing.invoiceNumber,
              invoiceDate: existing.invoiceDate,
              invoiceAmount: existing.invoiceAmount.toString(),
              ivaRetention: existing.ivaRetention.toString(),
              islrAmount: existing.islrAmount?.toString() ?? null,
              totalRetention: existing.totalRetention.toString(),
              voucherNumber: existing.voucherNumber ?? null,
              type: existing.type,
              status: existing.status,
              createdAt: existing.createdAt,
            },
          };
        }
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Error al crear la retención" };
  }
}

// ─── Exportar comprobante de retención en PDF ─────────────────────────────────
export async function exportRetentionVoucherPDFAction(
  retentionId: string,
  companyId: string
): Promise<{ success: true; buffer: number[] } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      include: { company: true },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const retention = await prisma.retencion.findFirst({
      where: { id: retentionId, companyId, deletedAt: null },
      include: { company: true },
    });
    if (!retention) return { success: false, error: "Retención no encontrada" };

    const issueDate = retention.createdAt;
    const monthLabel = issueDate.toLocaleString("es-VE", { month: "long", year: "numeric" });

    const retentionType: "IVA" | "ISLR" = retention.islrAmount ? "ISLR" : "IVA";
    const retentionRate = retentionType === "ISLR"
      ? Number(retention.islrRetentionPct ?? 0)
      : Number(retention.ivaRetentionPct);

    const pdfBuffer = await generateRetentionVoucherPDF({
      companyName: retention.company.name,
      companyRif: retention.company.rif ?? "",
      voucherNumber: retention.voucherNumber ?? retention.id,
      issueDate,
      providerName: retention.providerName,
      providerRif: retention.providerRif,
      periodLabel: monthLabel,
      retentionType,
      retentionRate,
      invoiceNumber: retention.invoiceNumber,
      invoiceDate: retention.invoiceDate,
      invoiceAmount: retention.invoiceAmount,
      taxableBase: retention.taxBase,
      retainedAmount: retention.totalRetention,
    });

    return { success: true, buffer: Array.from(pdfBuffer) };
  } catch {
    return { success: false, error: "Error al generar comprobante PDF" };
  }
}

// ─── Vincular retención a factura ─────────────────────────────────────────────
export async function linkRetentionToInvoiceAction(
  retentionId: string,
  invoiceId: string,
  companyId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    await linkRetentionToInvoice(retentionId, invoiceId, companyId);

    revalidatePath("/accounting/retentions");
    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        return { success: false, error: "La retención ya está vinculada a una factura" };
      }
      if (error.message.includes("P2003")) {
        return { success: false, error: "Factura o retención no válida" };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Error al vincular retención" };
  }
}

// ─── Buscar factura por número ────────────────────────────────────────────────
export type InvoiceMatch = {
  id: string;
  invoiceNumber: string;
  date: Date;
  counterpartName: string;
  counterpartRif: string;
  type: string;
};

export async function findInvoiceByNumberAction(
  invoiceNumber: string,
  companyId: string
): Promise<ActionResult<InvoiceMatch[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        invoiceNumber: { contains: invoiceNumber, mode: "insensitive" },
        deletedAt: null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        counterpartName: true,
        counterpartRif: true,
        type: true,
      },
      orderBy: { date: "desc" },
      take: 10,
    });

    return { success: true, data: invoices };
  } catch {
    return { success: false, error: "Error al buscar factura" };
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
        voucherNumber: r.voucherNumber ?? null,
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
