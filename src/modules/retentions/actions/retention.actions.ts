"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { checkRateLimit, limiters, redis } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";
import type { Retencion } from "@prisma/client";
import {
  CreateRetentionSchema,
  EnterRetentionSchema,
  type CreateRetentionInput,
  type EnterRetentionInput,
} from "../schemas/retention.schema";
import {
  RetentionService,
  linkRetentionToInvoice,
  getNextVoucherNumber,
  enterRetention,
} from "../services/RetentionService";
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
  incesAmount: string | null;
  fatAmount: string | null;
  totalRetention: string;
  voucherNumber: string | null;
  type: string;
  status: string;
  enteradoAt: Date | null;
  createdAt: Date;
};

async function getIpAndUa() {
  const h = await headers();
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}

// ─── Crear retención ──────────────────────────────────────────────────────────
export async function createRetentionAction(
  input: CreateRetentionInput
): Promise<ActionResult<RetentionSummary>> {
  let txStart = 0;
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = CreateRetentionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const data = parsed.data;

    const { ipAddress, userAgent } = await getIpAndUa();

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: data.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const retYear = data.invoiceDate.getFullYear();
    const retYearClosed = await FiscalYearCloseService.isFiscalYearClosed(data.companyId, retYear);
    if (retYearClosed) {
      return {
        success: false,
        error: `El ejercicio económico ${retYear} está cerrado. No se pueden registrar retenciones en ejercicios cerrados.`,
      };
    }

    const calc = RetentionService.calculate(
      data.taxBase,
      data.ivaRetentionPct as 75 | 100,
      data.islrCode,
      16,
      data.type,
      data.applyInces ?? false,
      data.applyFat ?? false
    );

    const idempotencyKey = data.idempotencyKey ?? crypto.randomUUID();

    if (data.idempotencyKey) {
      const existing = await prisma.retencion.findFirst({
        where: { idempotencyKey, companyId: data.companyId },
      });
      if (existing) {
        return {
          success: true,
          data: serializeRetention(existing),
        };
      }
    }

    const P2034_DELAYS = [0, 50, 100] as const;
    const MAX_ATTEMPTS = 3;
    let retention!: Retencion;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));
      txStart = Date.now();
      try {
        retention = await prisma.$transaction(
          async (tx) =>
            withCompanyContext(data.companyId, tx, async (tx) => {
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
                  islrRetentionPct: calc.islrRetentionPct
                    ? new Decimal(calc.islrRetentionPct)
                    : null,
                  incesAmount: calc.incesAmount ? new Decimal(calc.incesAmount) : null,
                  incesRetentionPct: calc.incesRetentionPct
                    ? new Decimal(calc.incesRetentionPct)
                    : null,
                  fatAmount: calc.fatAmount ? new Decimal(calc.fatAmount) : null,
                  fatRetentionPct: calc.fatRetentionPct
                    ? new Decimal(calc.fatRetentionPct)
                    : null,
                  totalRetention: new Decimal(calc.totalRetention),
                  voucherNumber,
                  type: data.type,
                  status: "PENDING",
                  createdBy: userId,
                  idempotencyKey,
                },
              });

              await tx.auditLog.create({
                data: {
                  companyId: data.companyId,
                  entityId: ret.id,
                  entityName: "Retencion",
                  action: "CREATE",
                  userId,
                  ipAddress,
                  userAgent,
                  newValue: {
                    providerRif: data.providerRif,
                    invoiceNumber: data.invoiceNumber,
                    totalRetention: calc.totalRetention,
                    voucherNumber,
                    applyInces: data.applyInces ?? false,
                    applyFat: data.applyFat ?? false,
                  },
                },
              });

              return ret;
            }),
          { isolationLevel: "Serializable" }
        );
        break;
      } catch (innerErr: unknown) {
        if (
          innerErr instanceof Error &&
          "code" in innerErr &&
          (innerErr as { code: string }).code === "P2034"
        ) {
          if (redis) {
            const key = `p2034:${data.companyId}:${new Date().toISOString().slice(0, 10)}`;
            await redis
              .pipeline()
              .incr(key)
              .expire(key, 604800)
              .exec()
              .catch(() => {});
          }
          if (attempt === MAX_ATTEMPTS) {
            Sentry.withScope((scope) => {
              scope.setTag("companyId", input.companyId);
              scope.setExtra("attempt", attempt);
              scope.setExtra("duration_ms", Date.now() - txStart);
              Sentry.captureMessage("P2034 createRetentionAction", "warning");
            });
            return { success: false, error: "Conflicto de concurrencia — reintente la operación" };
          }
          continue;
        }
        throw innerErr;
      }
    }

    revalidatePath(`/company/${data.companyId}/retentions`);

    return { success: true, data: serializeRetention(retention) };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002") && input.idempotencyKey) {
        const existing = await prisma.retencion.findFirst({
          where: { idempotencyKey: input.idempotencyKey, companyId: input.companyId },
        });
        if (existing) {
          return { success: true, data: serializeRetention(existing) };
        }
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: "Error al crear la retención" };
  }
}

// ─── Enterar retención ────────────────────────────────────────────────────────
export async function enterRetentionAction(
  input: EnterRetentionInput
): Promise<ActionResult<{ retentionId: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const parsed = EnterRetentionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const data = parsed.data;

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: data.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const { ipAddress, userAgent } = await getIpAndUa();

    await enterRetention(data, userId, ipAddress, userAgent);

    revalidatePath(`/company/${data.companyId}/retentions`);

    return { success: true, data: { retentionId: data.retentionId } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al enterar la retención" };
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

    const retentionType = retention.type as "IVA" | "ISLR" | "AMBAS";
    let retentionRate: number | undefined
    if (retentionType === "ISLR") retentionRate = Number(retention.islrRetentionPct ?? 0)
    else if (retentionType === "IVA") retentionRate = Number(retention.ivaRetentionPct)

    const pdfBuffer = await generateRetentionVoucherPDF({
      companyName: retention.company.name,
      companyRif: retention.company.rif ?? "",
      companyAddress: retention.company.address ?? undefined,
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
      ivaRetention: retention.ivaRetention,
      ivaRetentionPct: Number(retention.ivaRetentionPct),
      islrAmount: retention.islrAmount ?? undefined,
      islrRetentionPct: retention.islrRetentionPct ? Number(retention.islrRetentionPct) : undefined,
      incesAmount: retention.incesAmount ?? undefined,
      incesRetentionPct: retention.incesRetentionPct ? Number(retention.incesRetentionPct) : undefined,
      fatAmount: retention.fatAmount ?? undefined,
      fatRetentionPct: retention.fatRetentionPct ? Number(retention.fatRetentionPct) : undefined,
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
      select: { role: true },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(membership.role, ROLES.ACCOUNTING))
      return { success: false, error: "Módulo contable: se requiere rol Contador o superior" };

    const { ipAddress, userAgent } = await getIpAndUa();
    await linkRetentionToInvoice(retentionId, invoiceId, companyId, ipAddress, userAgent);

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
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const retentions = await prisma.retencion.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: retentions.map(serializeRetention),
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener las retenciones" };
  }
}

// ─── Listar cuentas para selector de enteramiento ─────────────────────────────
export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
};

export async function getAccountsForEnteramientoAction(
  companyId: string
): Promise<ActionResult<AccountOption[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };

    const accounts = await prisma.account.findMany({
      where: {
        companyId,
        type: { in: ["ASSET", "LIABILITY"] },
      },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    });

    return { success: true, data: accounts };
  } catch {
    return { success: false, error: "Error al obtener cuentas" };
  }
}

// ─── Serializar Retencion → RetentionSummary ──────────────────────────────────
function serializeRetention(r: Retencion): RetentionSummary {
  return {
    id: r.id,
    providerName: r.providerName,
    providerRif: r.providerRif,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate,
    invoiceAmount: r.invoiceAmount.toString(),
    ivaRetention: r.ivaRetention.toString(),
    islrAmount: r.islrAmount?.toString() ?? null,
    incesAmount: r.incesAmount?.toString() ?? null,
    fatAmount: r.fatAmount?.toString() ?? null,
    totalRetention: r.totalRetention.toString(),
    voucherNumber: r.voucherNumber ?? null,
    type: r.type,
    status: r.status,
    enteradoAt: r.enteradoAt ?? null,
    createdAt: r.createdAt,
  };
}
