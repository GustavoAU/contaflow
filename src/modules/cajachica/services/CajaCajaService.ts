import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import type { CajaCajaMovementStatus } from "@prisma/client";
import type { CreateCajaCajaSchema, CloseCajaCajaSchema } from "../schemas/cajachica.schema";
import type { z } from "zod";

export type CajaCajaSummary = {
  id: string;
  name: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  maxBalance: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  totalDeposited: string;
  totalPendingMovements: string;
  totalApprovedMovements: string;
  availableBalance: string;
  percentUsed: number;
};

const ACTIVE_STATUSES: CajaCajaMovementStatus[] = ["PENDING", "APPROVED"];

const CAJA_INCLUDE = {
  account: { select: { id: true, code: true, name: true } },
  deposits: {
    where: { status: "POSTED" as const },
    select: { amount: true },
  },
  movements: {
    where: { status: { in: ACTIVE_STATUSES } },
    select: { amount: true, status: true },
  },
};

function computeBalance(caja: {
  maxBalance: Decimal;
  deposits: { amount: Decimal }[];
  movements: { amount: Decimal; status: string }[];
}) {
  const totalDeposited = caja.deposits.reduce((s, d) => s.plus(d.amount), new Decimal(0));
  const totalPending = caja.movements
    .filter((m) => m.status === "PENDING")
    .reduce((s, m) => s.plus(m.amount), new Decimal(0));
  const totalApproved = caja.movements
    .filter((m) => m.status === "APPROVED")
    .reduce((s, m) => s.plus(m.amount), new Decimal(0));
  const spent = totalPending.plus(totalApproved);
  const available = totalDeposited.minus(spent);
  const percentUsed = totalDeposited.isZero()
    ? 0
    : spent.dividedBy(totalDeposited).times(100).toDecimalPlaces(1).toNumber();

  return { totalDeposited, totalPending, totalApproved, available, percentUsed };
}

function serializeCaja(
  caja: Awaited<ReturnType<typeof prisma.cajaCaja.findFirst>> & {
    account: { id: string; code: string; name: string };
    deposits: { amount: Decimal }[];
    movements: { amount: Decimal; status: string }[];
  }
): CajaCajaSummary {
  if (!caja) throw new Error("unreachable");
  const { totalDeposited, totalPending, totalApproved, available, percentUsed } = computeBalance(caja);
  return {
    id: caja.id,
    name: caja.name,
    accountId: caja.accountId,
    accountCode: caja.account.code,
    accountName: caja.account.name,
    currency: caja.currency,
    maxBalance: caja.maxBalance.toFixed(2),
    status: caja.status,
    createdAt: caja.createdAt.toISOString(),
    closedAt: caja.closedAt?.toISOString() ?? null,
    totalDeposited: totalDeposited.toFixed(2),
    totalPendingMovements: totalPending.toFixed(2),
    totalApprovedMovements: totalApproved.toFixed(2),
    availableBalance: available.toFixed(2),
    percentUsed,
  };
}

export async function createCajaCaja(
  input: z.infer<typeof CreateCajaCajaSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<CajaCajaSummary> {
  const result = await prisma.$transaction(async (tx) => {
    const caja = await tx.cajaCaja.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        accountId: input.accountId,
        currency: input.currency as "VES" | "USD" | "EUR",
        maxBalance: new Decimal(input.maxBalance),
        createdBy: userId,
      },
      include: CAJA_INCLUDE,
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "CREATE_CAJA_CHICA",
        entityName: "CajaCaja",
        entityId: caja.id,
        ipAddress,
        userAgent,
        newValue: { name: input.name, accountId: input.accountId },
      },
    });

    return caja;
  });

  return serializeCaja(result as Parameters<typeof serializeCaja>[0]);
}

export async function listCajasCajas(companyId: string): Promise<CajaCajaSummary[]> {
  const cajas = await prisma.cajaCaja.findMany({
    where: { companyId },
    include: CAJA_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  return cajas.map((c) => serializeCaja(c as Parameters<typeof serializeCaja>[0]));
}

export async function getCajaCajaById(
  id: string,
  companyId: string
): Promise<CajaCajaSummary | null> {
  const caja = await prisma.cajaCaja.findFirst({
    where: { id, companyId },
    include: CAJA_INCLUDE,
  });
  if (!caja) return null;
  return serializeCaja(caja as Parameters<typeof serializeCaja>[0]);
}

export async function closeCajaCaja(
  input: z.infer<typeof CloseCajaCajaSchema>,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const caja = await tx.cajaCaja.findFirst({
      where: { id: input.cajaCajaId, companyId: input.companyId },
      include: {
        movements: { where: { status: { in: ACTIVE_STATUSES } } },
      },
    });
    if (!caja) throw new Error("Caja Chica no encontrada");
    if (caja.status === "CLOSED") throw new Error("La Caja Chica ya está cerrada");
    if (caja.movements.length > 0)
      throw new Error("No se puede cerrar con movimientos pendientes o aprobados");

    await tx.cajaCaja.update({
      where: { id: input.cajaCajaId },
      data: { status: "CLOSED", closedAt: new Date(), closedBy: userId },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId,
        action: "CLOSE_CAJA_CHICA",
        entityName: "CajaCaja",
        entityId: input.cajaCajaId,
        ipAddress,
        userAgent,
        newValue: { closedAt: new Date().toISOString() },
      },
    });
  });
}
