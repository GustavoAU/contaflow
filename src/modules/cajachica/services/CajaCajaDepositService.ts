import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import type { CreateDepositSchema, VoidDepositSchema } from "../schemas/cajachica.schema";
import type { z } from "zod";

export type DepositSummary = {
  id: string;
  cajaCajaId: string;
  date: string;
  amount: string;
  description: string;
  status: string;
  transactionId: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

function serializeDeposit(d: {
  id: string;
  cajaCajaId: string;
  date: Date;
  amount: Decimal;
  description: string;
  status: string;
  transactionId: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
}): DepositSummary {
  return {
    id: d.id,
    cajaCajaId: d.cajaCajaId,
    date: d.date.toISOString().slice(0, 10),
    amount: d.amount.toFixed(2),
    description: d.description,
    status: d.status,
    transactionId: d.transactionId,
    createdAt: d.createdAt.toISOString(),
    voidedAt: d.voidedAt?.toISOString() ?? null,
    voidReason: d.voidReason,
  };
}

export async function createDeposit(
  input: z.infer<typeof CreateDepositSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<DepositSummary> {
  const depositDate = new Date(input.date);
  const amountDecimal = new Decimal(input.amount);

  const result = await prisma.$transaction(async (tx) => {
    const caja = await tx.cajaCaja.findFirst({
      where: { id: input.cajaCajaId, companyId: input.companyId },
    });
    if (!caja) throw new Error("Caja Chica no encontrada");
    if (caja.status !== "ACTIVE") throw new Error("La Caja Chica no está activa");

    // Find open period
    const period = await tx.accountingPeriod.findFirst({
      where: { companyId: input.companyId, status: "OPEN" },
    });
    if (!period) throw new Error("No hay período contable abierto");

    const deposit = await tx.cajaCajaDeposit.create({
      data: {
        companyId: input.companyId,
        cajaCajaId: input.cajaCajaId,
        date: depositDate,
        amount: amountDecimal,
        description: input.description,
        supportingDocumentId: input.supportingDocumentId,
        status: "POSTED",
        createdBy: userId,
      },
    });

    // Debit caja account, Credit source (same account for now — bookkeeper will adjust)
    const depositCount = await tx.cajaCajaDeposit.count({ where: { companyId: input.companyId } });
    const transaction = await tx.transaction.create({
      data: {
        companyId: input.companyId,
        periodId: period.id,
        date: depositDate,
        number: `DEP-${String(depositCount + 1).padStart(6, "0")}`,
        description: `Depósito Caja Chica: ${input.description}`,
        type: "DIARIO",
        userId,
        entries: {
          create: [
            {
              accountId: caja.accountId,
              amount: amountDecimal,
              description: `Depósito — ${input.description}`,
            },
          ],
        },
      },
    });

    await tx.cajaCajaDeposit.update({
      where: { id: deposit.id },
      data: { transactionId: transaction.id },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "CREATE_DEPOSIT",
        entityName: "CajaCajaDeposit",
        entityId: deposit.id,
        ipAddress,
        userAgent,
        newValue: { amount: input.amount, cajaCajaId: input.cajaCajaId },
      },
    });

    return { ...deposit, transactionId: transaction.id };
  });

  return serializeDeposit(result);
}

export async function voidDeposit(
  input: z.infer<typeof VoidDepositSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deposit = await tx.cajaCajaDeposit.findFirst({
      where: { id: input.depositId, companyId: input.companyId },
    });
    if (!deposit) throw new Error("Depósito no encontrado");
    if (deposit.status === "VOIDED") throw new Error("El depósito ya está anulado");

    await tx.cajaCajaDeposit.update({
      where: { id: input.depositId },
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
        action: "VOID_DEPOSIT",
        entityName: "CajaCajaDeposit",
        entityId: input.depositId,
        ipAddress,
        userAgent,
        newValue: { voidReason: input.voidReason },
      },
    });
  });
}

export async function listDeposits(cajaCajaId: string, companyId: string): Promise<DepositSummary[]> {
  const deposits = await prisma.cajaCajaDeposit.findMany({
    where: { cajaCajaId, companyId },
    orderBy: { date: "desc" },
  });
  return deposits.map(serializeDeposit);
}
