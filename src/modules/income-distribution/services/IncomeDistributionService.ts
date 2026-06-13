// src/modules/income-distribution/services/IncomeDistributionService.ts

import { createHash } from "crypto";
import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import prisma from "@/lib/prisma";
import type { IncomeDistributionStatus } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DistributionLineSummary = {
  id: string;
  distributionId: string;
  recipientCompanyId: string;
  recipientCompanyName: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  percentageShare: string;
  amountVes: string;
  lineDescription: string | null;
  lineNumber: number;
};

export type IncomeDistributionSummary = {
  id: string;
  companyId: string;
  referenceNumber: string | null;
  description: string | null;
  date: Date;
  status: IncomeDistributionStatus;
  currencyCode: string;
  totalAmountOriginal: string;
  totalAmountVes: string;
  exchangeRate: string;
  originAccountId: string;
  originAccountCode: string;
  originAccountName: string;
  transactionId: string | null;
  idempotencyKey: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string;
  lines: DistributionLineSummary[];
};

export type CreateDistributionInput = {
  companyId: string;
  date: Date;
  description?: string;
  currencyCode: string;
  totalAmountOriginal: Decimal;
  exchangeRate: Decimal;
  originAccountId: string;
  lines: {
    recipientCompanyId: string;
    accountId: string;
    percentageShare: Decimal;
    lineDescription?: string;
  }[];
  createdBy: string;
  idempotencyKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const P2034_DELAYS = [0, 50, 100] as const;

function isP2034(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "P2034"
  );
}

function serialize(dist: {
  id: string;
  companyId: string;
  referenceNumber: string | null;
  description: string | null;
  date: Date;
  status: IncomeDistributionStatus;
  currencyCode: string;
  totalAmountOriginal: Decimal;
  totalAmountVes: Decimal;
  exchangeRate: Decimal;
  originAccountId: string;
  originAccount: { code: string; name: string };
  transactionId: string | null;
  idempotencyKey: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string;
  lines: {
    id: string;
    distributionId: string;
    recipientCompanyId: string;
    recipientCompany: { name: string };
    accountId: string;
    account: { code: string; name: string };
    percentageShare: Decimal;
    amountVes: Decimal;
    lineDescription: string | null;
    lineNumber: number;
  }[];
}): IncomeDistributionSummary {
  return {
    id: dist.id,
    companyId: dist.companyId,
    referenceNumber: dist.referenceNumber,
    description: dist.description,
    date: dist.date,
    status: dist.status,
    currencyCode: dist.currencyCode,
    totalAmountOriginal: dist.totalAmountOriginal.toString(),
    totalAmountVes: dist.totalAmountVes.toString(),
    exchangeRate: dist.exchangeRate.toString(),
    originAccountId: dist.originAccountId,
    originAccountCode: dist.originAccount.code,
    originAccountName: dist.originAccount.name,
    transactionId: dist.transactionId,
    idempotencyKey: dist.idempotencyKey,
    voidReason: dist.voidReason,
    voidedAt: dist.voidedAt,
    voidedBy: dist.voidedBy,
    createdAt: dist.createdAt,
    createdBy: dist.createdBy,
    lines: dist.lines.map((l) => ({
      id: l.id,
      distributionId: l.distributionId,
      recipientCompanyId: l.recipientCompanyId,
      recipientCompanyName: l.recipientCompany.name,
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      percentageShare: l.percentageShare.toString(),
      amountVes: l.amountVes.toString(),
      lineDescription: l.lineDescription,
      lineNumber: l.lineNumber,
    })),
  };
}

const DIST_INCLUDE = {
  originAccount: { select: { code: true, name: true } },
  lines: {
    include: {
      recipientCompany: { select: { name: true } },
      account: { select: { code: true, name: true } },
    },
    orderBy: { lineNumber: "asc" as const },
  },
};

/** Genera clave SHA256 para idempotencia según ADR-023 D-5 */
export function buildIdempotencyKey(
  companyId: string,
  date: Date,
  totalAmountVes: Decimal,
  lines: { recipientCompanyId: string; percentageShare: Decimal }[],
): string {
  const sorted = [...lines]
    .sort((a, b) => a.recipientCompanyId.localeCompare(b.recipientCompanyId))
    .map((l) => `${l.recipientCompanyId}:${l.percentageShare.toFixed(2)}`)
    .join("|");
  const raw = `${companyId}|${date.toISOString()}|${totalAmountVes.toFixed(2)}|${sorted}`;
  return createHash("sha256").update(raw).digest("hex");
}

/** Calcula totalAmountVes = totalAmountOriginal * exchangeRate */
export function computeTotalVes(original: Decimal, rate: Decimal): Decimal {
  return original.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Distribuye totalVes entre las líneas según porcentajes; la última absorbe el residuo */
export function distributeAmounts(
  totalVes: Decimal,
  lines: { percentageShare: Decimal }[],
): Decimal[] {
  const amounts: Decimal[] = [];
  let accumulated = new Decimal(0);
  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1) {
      amounts.push(totalVes.minus(accumulated));
    } else {
      const amount = totalVes
        .mul(lines[i].percentageShare)
        .div(new Decimal(100))
        .toDecimalPlaces(2, Decimal.ROUND_DOWN);
      amounts.push(amount);
      accumulated = accumulated.plus(amount);
    }
  }
  return amounts;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function createDistribution(
  input: CreateDistributionInput,
): Promise<IncomeDistributionSummary> {
  const totalVes = computeTotalVes(input.totalAmountOriginal, input.exchangeRate);
  const amounts = distributeAmounts(totalVes, input.lines);

  return prisma.$transaction(async (tx) => {
    let dist;
    try {
      dist = await tx.incomeDistribution.create({
        data: {
          companyId: input.companyId,
          date: input.date,
          description: input.description ?? null,
          currencyCode: input.currencyCode,
          totalAmountOriginal: input.totalAmountOriginal,
          totalAmountVes: totalVes,
          exchangeRate: input.exchangeRate,
          originAccountId: input.originAccountId,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.createdBy,
          lines: {
            create: input.lines.map((l, idx) => ({
              recipientCompanyId: l.recipientCompanyId,
              accountId: l.accountId,
              percentageShare: l.percentageShare,
              amountVes: amounts[idx],
              lineDescription: l.lineDescription ?? null,
              lineNumber: idx + 1,
            })),
          },
        },
        include: DIST_INCLUDE,
      });
    } catch (err) {
      if (
        typeof err === "object" && err !== null &&
        "code" in err && (err as { code: string }).code === "P2002"
      ) {
        const meta = (err as { meta?: { target?: string[] } }).meta;
        if (meta?.target?.includes("idempotencyKey")) {
          throw new Error("Esta distribución ya fue creada — refresque la página.");
        }
      }
      throw err;
    }

    await tx.incomeDistributionAudit.create({
      data: {
        distributionId: dist.id,
        action: "CREATED",
        userId: input.createdBy,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        changesSummary: {
          status: "DRAFT",
          totalAmountVes: totalVes.toFixed(2),
          lineCount: input.lines.length,
        },
      },
    });

    return serialize(dist);
  });
}

export async function applyDistribution(
  distributionId: string,
  companyId: string,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<IncomeDistributionSummary> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

    try {
      return await prisma.$transaction(
        async (tx) => {
          // Guard multi-tenant (ADR-004)
          const dist = await tx.incomeDistribution.findFirst({
            where: { id: distributionId, companyId },
            include: DIST_INCLUDE,
          });
          if (!dist) throw new Error("Distribución no encontrada o no pertenece a esta empresa");
          if (dist.status !== "DRAFT") {
            throw new Error(`La distribución no puede aplicarse — estado actual: ${dist.status}`);
          }

          // V-6: sum invariant (con tolerancia ±0.01)
          const sumLines = dist.lines.reduce(
            (acc, l) => acc.plus(new Decimal(l.amountVes.toString())),
            new Decimal(0),
          );
          const totalVes = new Decimal(dist.totalAmountVes.toString());
          if (sumLines.minus(totalVes).abs().greaterThan(new Decimal("0.01"))) {
            throw new Error(
              `Invariante violada: suma de líneas ${sumLines.toFixed(2)} ≠ total ${totalVes.toFixed(2)}`,
            );
          }

          // Correlativo Serializable (ADR-001 / ADR-023 D-3)
          const count = await tx.incomeDistribution.count({ where: { companyId } });
          const referenceNumber = `DIST-${String(count).padStart(6, "0")}`;

          // Asiento contable: Débito origen, Crédito cada línea (ADR-023 D-3)
          const distEntries = [
            // Débito: cuenta origen
            {
              accountId: dist.originAccountId,
              amount: totalVes,
              description: `Distribución ${referenceNumber} — ingreso`,
            },
            // Crédito: una línea por destinatario
            ...dist.lines.map((l) => ({
              accountId: l.accountId,
              amount: new Decimal(l.amountVes.toString()).negated(),
              description: l.lineDescription ?? `${referenceNumber} — ${l.recipientCompany.name}`,
            })),
          ];
          assertBalancedGLEntries(distEntries); // N4: invariante partida doble
          const transaction = await tx.transaction.create({
            data: {
              companyId,
              date: dist.date,
              number: referenceNumber,
              description: dist.description ?? `Distribución de ingresos ${referenceNumber}`,
              type: "DIARIO",
              userId,
              entries: {
                create: distEntries,
              },
            },
          });

          const applied = await tx.incomeDistribution.update({
            where: { id: dist.id },
            data: {
              status: "APPLIED",
              referenceNumber,
              transactionId: transaction.id,
            },
            include: DIST_INCLUDE,
          });

          await tx.incomeDistributionAudit.create({
            data: {
              distributionId: dist.id,
              action: "APPLIED",
              userId,
              ipAddress: ipAddress ?? null,
              userAgent: userAgent ?? null,
              changesSummary: {
                referenceNumber,
                transactionId: transaction.id,
                totalAmountVes: totalVes.toFixed(2),
              },
            },
          });

          return serialize(applied);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      if (isP2034(err)) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) throw new Error("Conflicto de concurrencia — reintente la operación");
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function voidDistribution(
  distributionId: string,
  companyId: string,
  voidReason: string,
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<IncomeDistributionSummary> {
  return prisma.$transaction(
    async (tx) => {
      const dist = await tx.incomeDistribution.findFirst({
        where: { id: distributionId, companyId },
        include: DIST_INCLUDE,
      });
      if (!dist) throw new Error("Distribución no encontrada o no pertenece a esta empresa");
      // MVP: solo DRAFT puede anularse; APPLIED → deferred to Fase 36E (ADR-023)
      if (dist.status !== "DRAFT") {
        throw new Error(
          `Solo se pueden anular distribuciones en DRAFT. Estado actual: ${dist.status}. Para revertir una distribución aplicada, contacte al administrador.`,
        );
      }

      const now = new Date();
      const voided = await tx.incomeDistribution.update({
        where: { id: dist.id },
        data: {
          status: "VOID",
          voidReason,
          voidedAt: now,
          voidedBy: userId,
          deletedAt: now,
        },
        include: DIST_INCLUDE,
      });

      await tx.incomeDistributionAudit.create({
        data: {
          distributionId: dist.id,
          action: "VOIDED",
          userId,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          changesSummary: { voidReason, voidedAt: now.toISOString() },
        },
      });

      return serialize(voided);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function getDistributionById(
  distributionId: string,
  companyId: string,
): Promise<IncomeDistributionSummary | null> {
  const dist = await prisma.incomeDistribution.findFirst({
    where: { id: distributionId, companyId },
    include: DIST_INCLUDE,
  });
  return dist ? serialize(dist) : null;
}

export async function listDistributions(
  companyId: string,
  cursor?: string,
  limit = 50,
): Promise<{ distributions: IncomeDistributionSummary[]; nextCursor: string | null }> {
  const take = limit + 1;
  const rows = await prisma.incomeDistribution.findMany({
    where: { companyId, deletedAt: null },
    include: DIST_INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length === take;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    distributions: page.map(serialize),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}
