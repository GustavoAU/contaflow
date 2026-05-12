import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import type {
  CreateMovementSchema,
  ApproveMovementSchema,
  VoidMovementSchema,
} from "../schemas/cajachica.schema";
import type { z } from "zod";

export type MovementSummary = {
  id: string;
  cajaCajaId: string;
  date: string;
  voucherNumber: string;
  concept: string;
  description: string | null;
  expenseAccountId: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  amount: string;
  currency: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  reimbursementId: string | null;
  createdAt: string;
  voidedAt: string | null;
};

function serializeMovement(m: {
  id: string;
  cajaCajaId: string;
  date: Date;
  voucherNumber: string;
  concept: string;
  description: string | null;
  expenseAccountId: string;
  expenseAccount: { code: string; name: string };
  amount: Decimal;
  currency: string;
  status: string;
  approvedAt: Date | null;
  approvedBy: string | null;
  reimbursementId: string | null;
  createdAt: Date;
  voidedAt: Date | null;
}): MovementSummary {
  return {
    id: m.id,
    cajaCajaId: m.cajaCajaId,
    date: m.date.toISOString().slice(0, 10),
    voucherNumber: m.voucherNumber,
    concept: m.concept,
    description: m.description,
    expenseAccountId: m.expenseAccountId,
    expenseAccountCode: m.expenseAccount.code,
    expenseAccountName: m.expenseAccount.name,
    amount: m.amount.toFixed(2),
    currency: m.currency,
    status: m.status,
    approvedAt: m.approvedAt?.toISOString() ?? null,
    approvedBy: m.approvedBy,
    reimbursementId: m.reimbursementId,
    createdAt: m.createdAt.toISOString(),
    voidedAt: m.voidedAt?.toISOString() ?? null,
  };
}

async function getNextVoucherNumber(companyId: string, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Promise<string> {
  const count = await tx.cajaCajaMovement.count({ where: { companyId } });
  return `CCC-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

export async function createMovement(
  input: z.infer<typeof CreateMovementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<MovementSummary> {
  const movementDate = new Date(input.date);
  const amountDecimal = new Decimal(input.amount);

  const result = await prisma.$transaction(async (tx) => {
    const caja = await tx.cajaCaja.findFirst({
      where: { id: input.cajaCajaId, companyId: input.companyId },
      include: {
        deposits: { where: { status: "POSTED" }, select: { amount: true } },
        movements: {
          where: { status: { in: ["PENDING", "APPROVED"] } },
          select: { amount: true },
        },
      },
    });
    if (!caja) throw new Error("Caja Chica no encontrada");
    if (caja.status !== "ACTIVE") throw new Error("La Caja Chica no está activa");

    // No-overdraft guard
    const totalDeposited = caja.deposits.reduce((s, d) => s.plus(d.amount), new Decimal(0));
    const committed = caja.movements.reduce((s, m) => s.plus(m.amount), new Decimal(0));
    const available = totalDeposited.minus(committed);
    if (amountDecimal.greaterThan(available)) {
      throw new Error(
        `Saldo insuficiente. Disponible: ${available.toFixed(2)}, Requerido: ${amountDecimal.toFixed(2)}`
      );
    }

    const period = await tx.accountingPeriod.findFirst({
      where: { companyId: input.companyId, status: "OPEN" },
    });
    if (!period) throw new Error("No hay período contable abierto");

    const expenseAccount = await tx.account.findFirst({
      where: { id: input.expenseAccountId, companyId: input.companyId },
      select: { code: true, name: true },
    });
    if (!expenseAccount) throw new Error("Cuenta de gasto no encontrada");

    const voucherNumber = await getNextVoucherNumber(input.companyId, tx);

    const movement = await tx.cajaCajaMovement.create({
      data: {
        companyId: input.companyId,
        cajaCajaId: input.cajaCajaId,
        date: movementDate,
        voucherNumber,
        concept: input.concept,
        description: input.description,
        expenseAccountId: input.expenseAccountId,
        amount: amountDecimal,
        currency: input.currency as "VES" | "USD" | "EUR",
        supportingDocumentId: input.supportingDocumentId,
        notes: input.notes,
        status: "PENDING",
        createdBy: userId,
      },
      include: { expenseAccount: { select: { code: true, name: true } } },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "CREATE_MOVEMENT",
        entityName: "CajaCajaMovement",
        entityId: movement.id,
        ipAddress,
        userAgent,
        newValue: { voucherNumber, amount: input.amount, concept: input.concept },
      },
    });

    return movement;
  });

  return serializeMovement(result);
}

export async function approveMovement(
  input: z.infer<typeof ApproveMovementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<MovementSummary> {
  const result = await prisma.$transaction(async (tx) => {
    const movement = await tx.cajaCajaMovement.findFirst({
      where: { id: input.movementId, companyId: input.companyId },
      include: { expenseAccount: { select: { code: true, name: true } } },
    });
    if (!movement) throw new Error("Movimiento no encontrado");
    if (movement.status !== "PENDING") throw new Error("Solo se pueden aprobar movimientos en estado PENDING");

    const period = await tx.accountingPeriod.findFirst({
      where: { companyId: input.companyId, status: "OPEN" },
    });
    if (!period) throw new Error("No hay período contable abierto");

    const updated = await tx.cajaCajaMovement.update({
      where: { id: input.movementId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: userId },
      include: { expenseAccount: { select: { code: true, name: true } } },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "APPROVE_MOVEMENT",
        entityName: "CajaCajaMovement",
        entityId: input.movementId,
        ipAddress,
        userAgent,
        newValue: { approvedAt: new Date().toISOString() },
      },
    });

    return updated;
  });

  return serializeMovement(result);
}

export async function voidMovement(
  input: z.infer<typeof VoidMovementSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const movement = await tx.cajaCajaMovement.findFirst({
      where: { id: input.movementId, companyId: input.companyId },
    });
    if (!movement) throw new Error("Movimiento no encontrado");
    if (movement.status === "REIMBURSED") throw new Error("No se puede anular un movimiento ya reembolsado");
    if (movement.status === "VOIDED") throw new Error("El movimiento ya está anulado");

    await tx.cajaCajaMovement.update({
      where: { id: input.movementId },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: input.voidReason },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "VOID_MOVEMENT",
        entityName: "CajaCajaMovement",
        entityId: input.movementId,
        ipAddress,
        userAgent,
        newValue: { voidReason: input.voidReason },
      },
    });
  });
}

export async function listMovements(
  cajaCajaId: string,
  companyId: string
): Promise<MovementSummary[]> {
  const movements = await prisma.cajaCajaMovement.findMany({
    where: { cajaCajaId, companyId },
    include: { expenseAccount: { select: { code: true, name: true } } },
    orderBy: { date: "desc" },
  });
  return movements.map(serializeMovement);
}
