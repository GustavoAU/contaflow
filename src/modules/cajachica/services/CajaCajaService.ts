import Decimal from "decimal.js";
import prisma from "@/lib/prisma";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import { assertAccountOfType } from "./account-type.guard";
import type { CajaCajaMovementStatus } from "@prisma/client";
import type { CreateCajaCajaSchema, CloseCajaCajaSchema } from "../schemas/cajachica.schema";
import type { z } from "zod";

export type CajaCajaSummary = {
  id: string;
  name: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  custodianId: string | null;
  custodianName: string | null;
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
  custodian: { select: { id: true, firstName: true, lastName: true } },
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
  // ADR-004-EXCEPTION: findFirst en tipo ReturnType<typeof>, no es una query de runtime
  caja: Awaited<ReturnType<typeof prisma.cajaCaja.findFirst>> & {
    account: { id: string; code: string; name: string };
    custodian: { id: string; firstName: string; lastName: string } | null;
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
    custodianId: caja.custodian?.id ?? null,
    custodianName: caja.custodian
      ? `${caja.custodian.firstName} ${caja.custodian.lastName}`
      : null,
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
    // HC-09 (ADR-036 D-3): la cuenta de la caja debe ser de tipo ASSET, de la
    // empresa y no borrada. Defensa server-side (ADR-006).
    await assertAccountOfType(tx, {
      accountId: input.accountId,
      companyId: input.companyId,
      expected: "ASSET",
      label: "La cuenta de la caja",
    });

    // HC-03 (ADR-036 D-1): el custodio debe existir, pertenecer a la MISMA empresa
    // (ADR-004 cross-tenant) y estar ACTIVO. No basta la FK: un id de otra empresa
    // o un empleado inactivo no es un custodio válido.
    const custodian = await tx.employee.findFirst({
      where: { id: input.custodianId, companyId: input.companyId },
      select: { id: true, status: true },
    });
    if (!custodian) {
      throw new Error("El custodio no existe o no pertenece a esta empresa");
    }
    if (custodian.status !== "ACTIVE") {
      throw new Error("El custodio debe ser un empleado activo");
    }

    const caja = await tx.cajaCaja.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        accountId: input.accountId,
        custodianId: input.custodianId,
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
        newValue: { name: input.name, accountId: input.accountId, custodianId: input.custodianId },
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
  // HC-05 (ADR-036 D-2.5): el cierre crea un Transaction con correlativo
  // (@@unique([companyId, number])) → Z-1 obliga Serializable.
  await prisma.$transaction(
    async (tx) => {
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

      // ADR-036 D-2.4: la cuenta de retorno debe ser ASSET, de la empresa, no
      // borrada y distinta de la cuenta de la caja (no liquidar contra sí misma).
      await assertAccountOfType(tx, {
        accountId: input.returnAccountId,
        companyId: input.companyId,
        expected: "ASSET",
        label: "La cuenta de retorno",
      });
      if (input.returnAccountId === caja.accountId) {
        throw new Error("La cuenta de retorno debe ser distinta de la cuenta de la Caja Chica");
      }

      // ADR-036 D-2.3: remanente = saldo GL real de la cuenta caja = SUM(amount)
      // de los JournalEntry de esa accountId cuyo Transaction está POSTED y es de
      // la empresa. El GL es la fuente de verdad (R-1); VOID ya revierte vía
      // contrapartida POSTED, así que sumar entries POSTED da el saldo correcto.
      // Convención del schema: amount positivo = Débito, negativo = Crédito; el
      // saldo de una cuenta ASSET es directamente esa suma neta.
      const remainderAgg = await tx.journalEntry.aggregate({
        _sum: { amount: true },
        where: {
          accountId: caja.accountId,
          transaction: {
            companyId: input.companyId,
            status: "POSTED",
          },
        },
      });
      const remaining = new Decimal(remainderAgg._sum.amount?.toString() ?? "0");

      let closeTransactionId: string | null = null;

      if (remaining.isNegative()) {
        // Saldo acreedor en una cuenta ASSET de caja chica = corrupción contable
        // (más reembolsos POSTED que depósitos). No silenciar (ADR-036 D-2.4).
        throw new Error(
          "La cuenta de la caja tiene saldo acreedor inesperado; revise los asientos antes de cerrar."
        );
      }

      if (remaining.greaterThan(0)) {
        // ADR-036 D-2.5: la fecha del asiento (hoy) debe caer en el período OPEN.
        const today = new Date();
        const period = await PeriodService.assertDateInOpenPeriod(input.companyId, today, tx);

        // ADR-036 D-2.4: Dr cuenta retorno / Cr cuenta caja por el remanente.
        // Devuelve el efectivo a su origen y deja el GL de la caja en 0.
        const closeEntries = [
          {
            accountId: input.returnAccountId,
            amount: remaining,
            description: `Liquidación de caja chica: ${caja.name}`,
          },
          {
            accountId: caja.accountId,
            amount: remaining.negated(),
            description: `Liquidación de caja chica: ${caja.name}`,
          },
        ];
        assertBalancedGLEntries(closeEntries); // R-1: invariante partida doble

        const closeCount = await tx.cajaCaja.count({
          where: { companyId: input.companyId, closeTransactionId: { not: null } },
        });

        try {
          const closeTransaction = await tx.transaction.create({
            data: {
              companyId: input.companyId,
              periodId: period.id,
              date: today,
              number: `CCC-LIQ-${String(closeCount + 1).padStart(6, "0")}`,
              description: `Liquidación de caja chica: ${caja.name}`,
              type: "DIARIO",
              userId,
              entries: { create: closeEntries },
            },
          });
          closeTransactionId = closeTransaction.id;
        } catch (e) {
          // Z-1: P2002 en el correlativo (@@unique([companyId, number])) bajo
          // contención → error transitorio, reintentable.
          if (
            e &&
            typeof e === "object" &&
            "code" in e &&
            (e as { code?: string }).code === "P2002"
          ) {
            throw new Error("Error transitorio — intenta de nuevo.");
          }
          throw e;
        }
      }
      // remaining == 0: no se genera asiento; closeTransactionId queda null.

      await tx.cajaCaja.update({
        where: { id: input.cajaCajaId },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: userId,
          closeTransactionId,
        },
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
          newValue: {
            closedAt: new Date().toISOString(),
            returnAccountId: input.returnAccountId,
            remainingAmount: remaining.toFixed(2),
            closeTransactionId,
          },
        },
      });
    },
    { isolationLevel: "Serializable" }
  );
}
