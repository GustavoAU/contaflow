import Decimal from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import prisma from "@/lib/prisma";
import type {
  CreateReimbursementSchema,
  PostReimbursementSchema,
  VoidReimbursementSchema,
} from "../schemas/cajachica.schema";
import type { z } from "zod";

export type ReimbursementSummary = {
  id: string;
  cajaCajaId: string;
  monthYear: string;
  reimbursementNumber: string;
  totalExpensesVes: string;
  status: string;
  transactionId: string | null;
  movementCount: number;
  postedAt: string | null;
  postedBy: string | null;
  createdAt: string;
  voidedAt: string | null;
};

function serializeReimbursement(r: {
  id: string;
  cajaCajaId: string;
  monthYear: string;
  reimbursementNumber: string;
  totalExpensesVes: Decimal;
  status: string;
  transactionId: string | null;
  postedAt: Date | null;
  postedBy: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  movements: { id: string }[];
}): ReimbursementSummary {
  return {
    id: r.id,
    cajaCajaId: r.cajaCajaId,
    monthYear: r.monthYear,
    reimbursementNumber: r.reimbursementNumber,
    totalExpensesVes: r.totalExpensesVes.toFixed(2),
    status: r.status,
    transactionId: r.transactionId,
    movementCount: r.movements.length,
    postedAt: r.postedAt?.toISOString() ?? null,
    postedBy: r.postedBy,
    createdAt: r.createdAt.toISOString(),
    voidedAt: r.voidedAt?.toISOString() ?? null,
  };
}

async function getNextReimbNumber(
  companyId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  const count = await tx.cajaCajaReimbursement.count({ where: { companyId } });
  return `REIMB-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

export async function createReimbursement(
  input: z.infer<typeof CreateReimbursementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<ReimbursementSummary> {
  const result = await prisma.$transaction(
    async (tx) => {
      const caja = await tx.cajaCaja.findFirst({
        where: { id: input.cajaCajaId, companyId: input.companyId },
      });
      if (!caja) throw new Error("Caja Chica no encontrada");
      if (caja.status !== "ACTIVE") throw new Error("La Caja Chica no está activa");

      // Check for existing reimbursement for same month
      const existing = await tx.cajaCajaReimbursement.findFirst({
        where: {
          companyId: input.companyId,
          cajaCajaId: input.cajaCajaId,
          monthYear: input.monthYear,
          status: { not: "VOIDED" },
        },
      });
      if (existing) throw new Error(`Ya existe un reembolso para ${input.monthYear}`);

      // Gather approved movements for the month
      const [yearStr, monthStr] = input.monthYear.split("-");
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);

      const approvedMovements = await tx.cajaCajaMovement.findMany({
        where: {
          companyId: input.companyId,
          cajaCajaId: input.cajaCajaId,
          status: "APPROVED",
          date: { gte: startDate, lt: endDate },
          reimbursementId: null,
        },
        include: { expenseAccount: { select: { id: true, code: true, name: true } } },
      });

      if (approvedMovements.length === 0) {
        throw new Error("No hay gastos aprobados para reembolsar en este período");
      }

      const totalExpenses = approvedMovements.reduce(
        (s, m) => s.plus(m.amount),
        new Decimal(0)
      );

      const reimbNumber = await getNextReimbNumber(input.companyId, tx);

      const reimbursement = await tx.cajaCajaReimbursement.create({
        data: {
          companyId: input.companyId,
          cajaCajaId: input.cajaCajaId,
          monthYear: input.monthYear,
          reimbursementNumber: reimbNumber,
          totalExpensesVes: totalExpenses,
          status: "DRAFT",
          createdBy: userId,
        },
        include: { movements: { select: { id: true } } },
      });

      // Link movements to this reimbursement
      await tx.cajaCajaMovement.updateMany({
        where: { id: { in: approvedMovements.map((m) => m.id) } },
        data: { reimbursementId: reimbursement.id },
      });

      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          userId,
          action: "CREATE_REIMBURSEMENT",
          entityName: "CajaCajaReimbursement",
          entityId: reimbursement.id,
          ipAddress,
          userAgent,
          newValue: { monthYear: input.monthYear, total: totalExpenses.toFixed(2) },
        },
      });

      return { ...reimbursement, movements: approvedMovements.map((m) => ({ id: m.id })) };
    },
    { isolationLevel: "Serializable" }
  );

  return serializeReimbursement(result);
}

export async function postReimbursement(
  input: z.infer<typeof PostReimbursementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<ReimbursementSummary> {
  const result = await prisma.$transaction(
    async (tx) => {
      const reimbursement = await tx.cajaCajaReimbursement.findFirst({
        where: { id: input.reimbursementId, companyId: input.companyId },
        include: {
          cajaCaja: true,
          movements: {
            where: { status: "APPROVED" },
            include: { expenseAccount: { select: { id: true } } },
          },
        },
      });
      if (!reimbursement) throw new Error("Reembolso no encontrado");
      if (reimbursement.status !== "DRAFT") throw new Error("Solo se pueden publicar reembolsos en borrador");

      const period = await tx.accountingPeriod.findFirst({
        where: { companyId: input.companyId, status: "OPEN" },
      });
      if (!period) throw new Error("No hay período contable abierto");

      // Build journal entry: debit each expense account, credit caja account
      const entriesByAccount = new Map<string, Decimal>();
      for (const m of reimbursement.movements) {
        const cur = entriesByAccount.get(m.expenseAccountId) ?? new Decimal(0);
        entriesByAccount.set(m.expenseAccountId, cur.plus(m.amount));
      }

      const journalEntries = [
        // Debit expense accounts
        ...Array.from(entriesByAccount.entries()).map(([accountId, amount]) => ({
          accountId,
          amount,
          description: `Reembolso Caja Chica ${reimbursement.reimbursementNumber}`,
        })),
        // Credit caja account
        {
          accountId: reimbursement.cajaCaja.accountId,
          amount: reimbursement.totalExpensesVes.negated(),
          description: `Reembolso Caja Chica ${reimbursement.reimbursementNumber}`,
        },
      ];

      assertBalancedGLEntries(journalEntries); // N4: invariante partida doble
      const transaction = await tx.transaction.create({
        data: {
          companyId: input.companyId,
          periodId: period.id,
          date: new Date(),
          number: reimbursement.reimbursementNumber,
          description: `Reembolso Caja Chica ${reimbursement.reimbursementNumber} — ${reimbursement.monthYear}`,
          type: "DIARIO",
          userId,
          entries: { create: journalEntries },
        },
      });

      // Mark movements as REIMBURSED
      await tx.cajaCajaMovement.updateMany({
        where: { reimbursementId: input.reimbursementId },
        data: { status: "REIMBURSED" },
      });

      const updated = await tx.cajaCajaReimbursement.update({
        where: { id: input.reimbursementId },
        data: {
          status: "POSTED",
          postedAt: new Date(),
          postedBy: userId,
          transactionId: transaction.id,
        },
        include: { movements: { select: { id: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          userId,
          action: "POST_REIMBURSEMENT",
          entityName: "CajaCajaReimbursement",
          entityId: input.reimbursementId,
          ipAddress,
          userAgent,
          newValue: { transactionId: transaction.id },
        },
      });

      return updated;
    },
    { isolationLevel: "Serializable" }
  );

  return serializeReimbursement(result);
}

export async function voidReimbursement(
  input: z.infer<typeof VoidReimbursementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const reimbursement = await tx.cajaCajaReimbursement.findFirst({
      where: { id: input.reimbursementId, companyId: input.companyId },
    });
    if (!reimbursement) throw new Error("Reembolso no encontrado");
    if (reimbursement.status === "VOIDED") throw new Error("El reembolso ya está anulado");
    if (reimbursement.status === "POSTED") {
      throw new Error("Los reembolsos publicados no se pueden anular directamente. Contacte al administrador.");
    }

    // Reset linked movements back to APPROVED
    await tx.cajaCajaMovement.updateMany({
      where: { reimbursementId: input.reimbursementId },
      data: { reimbursementId: null },
    });

    await tx.cajaCajaReimbursement.update({
      where: { id: input.reimbursementId },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidReason: input.voidReason,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "VOID_REIMBURSEMENT",
        entityName: "CajaCajaReimbursement",
        entityId: input.reimbursementId,
        ipAddress,
        userAgent,
        newValue: { voidReason: input.voidReason },
      },
    });
  });
}

export async function listReimbursements(
  cajaCajaId: string,
  companyId: string
): Promise<ReimbursementSummary[]> {
  const reimbursements = await prisma.cajaCajaReimbursement.findMany({
    where: { cajaCajaId, companyId },
    include: { movements: { select: { id: true } } },
    orderBy: { monthYear: "desc" },
  });
  return reimbursements.map(serializeReimbursement);
}
