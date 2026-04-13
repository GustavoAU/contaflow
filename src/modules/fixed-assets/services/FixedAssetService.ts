// src/modules/fixed-assets/services/FixedAssetService.ts
//
// Fase 21 — Activos Fijos y Depreciación (VEN-NIF 16 / IAS 16)
// Métodos: Línea Recta, Suma de Dígitos, Unidades de Producción

import { Decimal } from "decimal.js";
import type { PrismaClient, DepreciationMethod, FixedAsset } from "@prisma/client";
import type { CreateFixedAssetInput, DisposeFixedAssetInput } from "../schemas/fixed-asset.schema";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// ─── Tipos de salida ────────────────────────────────────────────────────────────

export type DepreciationCalculation = {
  amount: Decimal;           // cuota del período
  accumulated: Decimal;      // depreciación acumulada al final del período
  bookValue: Decimal;        // valor en libros = costo − acumulada
};

export type DepreciationScheduleRow = {
  year: number;
  month: number;
  amount: Decimal;
  accumulated: Decimal;
  bookValue: Decimal;
};

export type FixedAssetSummary = {
  id: string;
  name: string;
  acquisitionDate: Date;
  acquisitionCost: Decimal;
  residualValue: Decimal;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  status: string;
  bookValue: Decimal;
  accumulatedDepreciation: Decimal;
  lastEntryDate: { year: number; month: number } | null;
};

// ─── Helpers de cálculo (pure functions — testables) ───────────────────────────

/**
 * Devuelve la cuota mensual de depreciación para un período dado.
 *
 * @param asset     datos del activo (costo, valor residual, vida útil, método)
 * @param month1    número de mes contado desde la adquisición (1 = primer mes)
 * @param unitsThisPeriod unidades usadas este período (solo UNIDADES_PRODUCCION)
 */
export function calcMonthlyDepreciation(
  asset: Pick<FixedAsset, "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits">,
  month1: number,         // mes ordinal desde inicio (1-based)
  unitsThisPeriod = 0,
): Decimal {
  const cost = new Decimal(asset.acquisitionCost.toString());
  const residual = new Decimal(asset.residualValue.toString());
  const depreciable = cost.minus(residual);
  const n = asset.usefulLifeMonths;

  if (depreciable.lessThanOrEqualTo(0)) return new Decimal(0);
  if (month1 > n) return new Decimal(0);  // totalmente depreciado

  switch (asset.depreciationMethod as DepreciationMethod) {
    case "LINEA_RECTA":
      return depreciable.dividedBy(n).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    case "SUMA_DIGITOS": {
      // SDA mensual: peso del período = (n − month1 + 1) / Σ(1..n)
      // Σ(1..n) = n*(n+1)/2
      const sumOfDigits = new Decimal(n).times(n + 1).dividedBy(2);
      const weight = new Decimal(n - month1 + 1).dividedBy(sumOfDigits);
      return depreciable.times(weight).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    }

    case "UNIDADES_PRODUCCION": {
      if (!asset.totalUnits || asset.totalUnits === 0) return new Decimal(0);
      const ratePerUnit = depreciable.dividedBy(asset.totalUnits);
      return ratePerUnit.times(unitsThisPeriod).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    }
  }
}

/**
 * Calcula depreciación para un mes dado, dado un acumulado previo.
 */
export function calcDepreciationForPeriod(
  asset: Pick<FixedAsset, "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits">,
  month1: number,
  previousAccumulated: Decimal,
  unitsThisPeriod = 0,
): DepreciationCalculation {
  const cost = new Decimal(asset.acquisitionCost.toString());
  const residual = new Decimal(asset.residualValue.toString());
  const depreciable = cost.minus(residual);

  let amount = calcMonthlyDepreciation(asset, month1, unitsThisPeriod);

  // No depreciar más allá del valor depreciable
  const remainingDepreciable = depreciable.minus(previousAccumulated);
  if (amount.greaterThan(remainingDepreciable)) {
    amount = Decimal.max(remainingDepreciable, new Decimal(0));
  }

  const accumulated = previousAccumulated.plus(amount);
  const bookValue = cost.minus(accumulated);

  return { amount, accumulated, bookValue };
}

/**
 * Genera la tabla completa de cuotas proyectadas (sin BD).
 */
export function generateDepreciationSchedule(
  asset: Pick<FixedAsset, "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits" | "acquisitionDate">,
): DepreciationScheduleRow[] {
  const rows: DepreciationScheduleRow[] = [];
  let accumulated = new Decimal(0);
  const startDate = new Date(asset.acquisitionDate);
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth() + 2; // depreciar desde el mes siguiente a la adquisición (UTC)
  if (month > 12) { month = 1; year++; }

  for (let m = 1; m <= asset.usefulLifeMonths; m++) {
    const calc = calcDepreciationForPeriod(asset, m, accumulated);
    if (calc.amount.equals(0) && m > 1) break;
    accumulated = calc.accumulated;
    rows.push({ year, month, ...calc });
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return rows;
}

// ─── FixedAssetService ─────────────────────────────────────────────────────────

export class FixedAssetService {
  /**
   * Registra un nuevo activo fijo. AuditLog dentro del mismo tx (CLAUDE.md).
   */
  static async create(input: CreateFixedAssetInput, userId: string, tx: Tx) {
    const asset = await tx.fixedAsset.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        assetAccountId: input.assetAccountId,
        depreciationAccountId: input.depreciationAccountId,
        accDepreciationAccountId: input.accDepreciationAccountId,
        acquisitionDate: input.acquisitionDate,
        acquisitionCost: new Decimal(input.acquisitionCost),
        residualValue: new Decimal(input.residualValue ?? "0"),
        usefulLifeMonths: input.usefulLifeMonths,
        depreciationMethod: input.depreciationMethod,
        totalUnits: input.totalUnits,
        createdBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        entityId: asset.id,
        entityName: "FixedAsset",
        action: "CREATE",
        userId,
        newValue: {
          name: input.name,
          acquisitionCost: input.acquisitionCost,
          companyId: input.companyId,
          depreciationMethod: input.depreciationMethod,
        },
      },
    });

    return asset;
  }

  /**
   * Calcula y registra la depreciación de UN activo para un mes dado.
   * Idempotente: retorna la entrada existente si ya fue calculada.
   * Genera el asiento contable dentro del mismo $transaction.
   */
  static async postDepreciation(
    assetId: string,
    companyId: string,
    year: number,
    month: number,
    userId: string,
    tx: Tx,
    unitsThisPeriod = 0,
  ): Promise<{ entry: { id: string; amount: Decimal }; created: boolean }> {
    // Idempotencia: si ya existe la entrada, retornar
    const existing = await tx.depreciationEntry.findUnique({
      where: { fixedAssetId_periodYear_periodMonth: { fixedAssetId: assetId, periodYear: year, periodMonth: month } },
    });
    if (existing) {
      return { entry: { id: existing.id, amount: new Decimal(existing.amount.toString()) }, created: false };
    }

    const asset = await tx.fixedAsset.findFirstOrThrow({
      where: { id: assetId, companyId },
    });

    if (asset.status === "DISPOSED" || asset.status === "FULLY_DEPRECATED" as never) {
      throw new Error("El activo ya fue dado de baja o está totalmente depreciado");
    }

    // Acumulado previo: suma de todas las entradas anteriores
    const prevEntries = await tx.depreciationEntry.aggregate({
      where: { fixedAssetId: assetId },
      _sum: { amount: true },
    });
    const previousAccumulated = new Decimal(prevEntries._sum.amount?.toString() ?? "0");

    // Mes ordinal desde adquisición (UTC para evitar desfase horario)
    const acqDate = new Date(asset.acquisitionDate);
    const acqYear = acqDate.getUTCFullYear();
    const acqMonth = acqDate.getUTCMonth() + 1;
    const month1 = (year - acqYear) * 12 + (month - acqMonth);

    if (month1 <= 0) {
      throw new Error("El período de depreciación es anterior a la fecha de adquisición");
    }

    const calc = calcDepreciationForPeriod(asset, month1, previousAccumulated, unitsThisPeriod);

    if (calc.amount.equals(0)) {
      // Activo totalmente depreciado — marcar status
      await tx.fixedAsset.update({
        where: { id: assetId },
        data: { status: "FULLY_DEPRECIATED" },
      });
      throw new Error("El activo ya alcanzó su depreciación total");
    }

    // Generar asiento contable de depreciación
    const transactionCount = await tx.transaction.count({ where: { companyId } });
    const txNumber = `DEP-${year}${String(month).padStart(2, "0")}-${String(transactionCount + 1).padStart(4, "0")}`;
    const periodDate = new Date(year, month - 1, 1);

    const journalTx = await tx.transaction.create({
      data: {
        companyId,
        number: txNumber,
        date: periodDate,
        description: `Depreciación: ${asset.name} (${year}/${String(month).padStart(2, "0")})`,
        type: "AJUSTE",
        userId,
        entries: {
          create: [
            // Débito: Gasto Depreciación
            {
              accountId: asset.depreciationAccountId,
              amount: calc.amount,
            },
            // Crédito: Depreciación Acumulada (negativo = crédito en nuestro modelo)
            {
              accountId: asset.accDepreciationAccountId,
              amount: calc.amount.negated(),
            },
          ],
        },
      },
    });

    const entry = await tx.depreciationEntry.create({
      data: {
        companyId,
        fixedAssetId: assetId,
        periodYear: year,
        periodMonth: month,
        amount: calc.amount,
        accumulatedDepreciation: calc.accumulated,
        bookValue: calc.bookValue,
        transactionId: journalTx.id,
        postedAt: new Date(),
      },
    });

    return { entry: { id: entry.id, amount: calc.amount }, created: true };
  }

  /**
   * Calcula depreciación mensual para TODOS los activos ACTIVE de una empresa.
   * Retorna sumario de activos procesados y errores.
   */
  static async postMonthlyDepreciation(
    companyId: string,
    year: number,
    month: number,
    userId: string,
    tx: Tx,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    const assets = await tx.fixedAsset.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
    });

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const asset of assets) {
      try {
        const result = await FixedAssetService.postDepreciation(
          asset.id, companyId, year, month, userId, tx,
        );
        if (result.created) processed++;
        else skipped++;
      } catch (e) {
        errors.push(`${asset.name}: ${e instanceof Error ? e.message : "Error desconocido"}`);
      }
    }

    return { processed, skipped, errors };
  }

  /**
   * Da de baja un activo (DISPOSED). Genera asiento de baja.
   */
  static async dispose(input: DisposeFixedAssetInput, userId: string, tx: Tx) {
    const asset = await tx.fixedAsset.findFirstOrThrow({
      where: { id: input.assetId, companyId: input.companyId },
    });

    if (asset.status === "DISPOSED") {
      throw new Error("El activo ya fue dado de baja");
    }

    const prevEntries = await tx.depreciationEntry.aggregate({
      where: { fixedAssetId: input.assetId },
      _sum: { amount: true },
    });
    const accumulated = new Decimal(prevEntries._sum.amount?.toString() ?? "0");
    const cost = new Decimal(asset.acquisitionCost.toString());
    const bookValue = cost.minus(accumulated);
    const proceeds = new Decimal(input.saleProceeds ?? "0");
    const gainLoss = proceeds.minus(bookValue);

    // Asiento de baja: eliminar activo y depreciación acumulada de libros
    const transactionCount = await tx.transaction.count({ where: { companyId: input.companyId } });
    const txNumber = `BAJA-${String(transactionCount + 1).padStart(4, "0")}`;

    await tx.transaction.create({
      data: {
        companyId: input.companyId,
        number: txNumber,
        date: input.disposalDate,
        description: `Baja de activo: ${asset.name}${input.notes ? ` — ${input.notes}` : ""}`,
        type: "AJUSTE",
        userId,
        entries: {
          create: [
            // Débito: eliminar depreciación acumulada (revertir créditos acumulados)
            { accountId: asset.accDepreciationAccountId, amount: accumulated },
            // Crédito: eliminar activo del balance
            { accountId: asset.assetAccountId, amount: cost.negated() },
            // Si hay ganancia: crédito a Otros Ingresos (no modelado aquí — JournalEntry queda en la cuenta de depreciación como proxy)
            // Si hay pérdida: débito a Pérdida por Baja
            // NOTA: gainLoss > 0 = ganancia (crédito), < 0 = pérdida (débito)
            ...(gainLoss.abs().greaterThan(0.001)
              ? [{ accountId: asset.depreciationAccountId, amount: gainLoss.negated() }]
              : []),
          ],
        },
      },
    });

    await tx.fixedAsset.update({
      where: { id: input.assetId },
      data: { status: "DISPOSED" },
    });

    await tx.auditLog.create({
      data: {
        entityId: input.assetId,
        entityName: "FixedAsset",
        action: "UPDATE",
        userId,
        newValue: { status: "DISPOSED", disposalDate: input.disposalDate, proceeds: input.saleProceeds },
      },
    });
  }

  /**
   * Listado de activos con resumen de valor en libros.
   */
  static async getSummary(companyId: string): Promise<FixedAssetSummary[]> {
    const assets = await (await import("@/lib/prisma")).default.fixedAsset.findMany({
      where: { companyId, deletedAt: null },
      include: {
        entries: {
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return assets.map((a) => {
      const lastEntry = a.entries[0];
      const accumulated = lastEntry
        ? new Decimal(lastEntry.accumulatedDepreciation.toString())
        : new Decimal(0);
      const cost = new Decimal(a.acquisitionCost.toString());

      return {
        id: a.id,
        name: a.name,
        acquisitionDate: a.acquisitionDate,
        acquisitionCost: cost,
        residualValue: new Decimal(a.residualValue.toString()),
        usefulLifeMonths: a.usefulLifeMonths,
        depreciationMethod: a.depreciationMethod,
        status: a.status,
        bookValue: cost.minus(accumulated),
        accumulatedDepreciation: accumulated,
        lastEntryDate: lastEntry ? { year: lastEntry.periodYear, month: lastEntry.periodMonth } : null,
      };
    });
  }

  /**
   * Tabla completa de depreciación de un activo (proyección + historial real).
   */
  static async getSchedule(assetId: string, companyId: string) {
    const prisma = (await import("@/lib/prisma")).default;
    const asset = await prisma.fixedAsset.findFirstOrThrow({ where: { id: assetId, companyId } });
    const postedEntries = await prisma.depreciationEntry.findMany({ // ADR-004-EXCEPTION: scoped via fixedAssetId FK — asset ya validado con companyId arriba
      where: { fixedAssetId: assetId },
      orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
    });

    const projected = generateDepreciationSchedule(asset);

    return {
      asset,
      projected,
      posted: postedEntries,
    };
  }
}
