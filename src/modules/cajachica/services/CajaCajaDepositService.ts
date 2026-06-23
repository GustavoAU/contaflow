import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import { assertAccountOfType } from "./account-type.guard";
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

    // IDOR + integridad + tipo (HAL-001): la cuenta origen debe existir, pertenecer a
    // la empresa, no estar borrada y ser de tipo ASSET (la contrapartida que financia
    // el fondo es un banco/caja general — un Pasivo/Gasto/Ingreso daría un asiento incorrecto).
    await assertAccountOfType(tx, {
      accountId: input.sourceAccountId,
      companyId: input.companyId,
      expected: "ASSET",
      label: "La cuenta origen",
    });
    if (input.sourceAccountId === caja.accountId) {
      throw new Error("La cuenta origen debe ser distinta de la cuenta de la Caja Chica");
    }

    // HC-02: la fecha del depósito debe caer dentro del período contable abierto.
    // El asiento (más abajo) usa este mismo period.id, garantizando que el GL
    // queda asentado en el período que corresponde a la fecha del depósito.
    const period = await PeriodService.assertDateInOpenPeriod(input.companyId, depositDate, tx);

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
        // HAL-002 (consistencia): la reversión se fecha HOY y debe caer en el período
        // abierto, igual que el resto de asientos de caja chica (no usar new Date() +
        // período OPEN sin validar, que dejaría la contrapartida fuera de su período).
        const today = new Date();
        const period = await PeriodService.assertDateInOpenPeriod(input.companyId, today, tx);
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
            date: today,
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
    take: 5000, // cap defensivo (gate Fase 4 LOW): acota memoria del export PDF/CSV
  });
  return deposits.map(serializeDeposit);
}
