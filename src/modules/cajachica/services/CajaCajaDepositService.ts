import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
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

    // IDOR + integridad: la cuenta origen debe existir y pertenecer a la empresa.
    const sourceAccount = await tx.account.findFirst({
      where: { id: input.sourceAccountId, companyId: input.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!sourceAccount) {
      throw new Error("Cuenta origen no encontrada o no pertenece a esta empresa");
    }
    if (sourceAccount.id === caja.accountId) {
      throw new Error("La cuenta origen debe ser distinta de la cuenta de la Caja Chica");
    }

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

    // Partida doble (R-1): Dr Caja Chica (entra el fondo) / Cr cuenta origen (sale el efectivo).
    const depositCount = await tx.cajaCajaDeposit.count({ where: { companyId: input.companyId } });
    const depositEntries = [
      {
        accountId: caja.accountId,
        amount: amountDecimal,
        description: `Depósito Caja Chica — ${input.description}`,
      },
      {
        accountId: input.sourceAccountId,
        amount: amountDecimal.negated(),
        description: `Salida fondos hacia Caja Chica — ${input.description}`,
      },
    ];
    assertBalancedGLEntries(depositEntries); // N4: invariante partida doble
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
          create: depositEntries,
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

    // Revertir el asiento contable con una contrapartida espejo (VOID nunca borra — R-1).
    // Sin esto, anular el depósito dejaría el GL intacto y descuadraría los libros.
    if (deposit.transactionId) {
      const original = await tx.transaction.findFirst({
        where: { id: deposit.transactionId, companyId: input.companyId },
        include: { entries: true },
      });
      if (original && original.status !== "VOIDED") {
        const period = await tx.accountingPeriod.findFirst({
          where: { companyId: input.companyId, status: "OPEN" },
        });
        if (!period) {
          throw new Error("No hay período contable abierto para registrar la reversión del depósito");
        }
        const reverseEntries = original.entries.map((e) => ({
          accountId: e.accountId,
          amount: new Decimal(e.amount.toString()).negated(),
          description: `Reversión depósito — ${e.description ?? ""}`.trim(),
        }));
        assertBalancedGLEntries(reverseEntries); // N4: invariante partida doble
        const reverseCount = await tx.cajaCajaDeposit.count({ where: { companyId: input.companyId } });
        await tx.transaction.create({
          data: {
            companyId: input.companyId,
            periodId: period.id,
            date: new Date(),
            number: `DEP-REV-${String(reverseCount + 1).padStart(6, "0")}`,
            description: `Anulación depósito Caja Chica — ${input.voidReason}`,
            type: "DIARIO",
            userId,
            entries: { create: reverseEntries },
          },
        });
        await tx.transaction.update({
          where: { id: original.id },
          data: { status: "VOIDED" },
        });
      }
    }

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
