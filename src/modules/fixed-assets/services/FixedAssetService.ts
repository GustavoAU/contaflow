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
        location: input.location ?? null,
        responsible: input.responsible ?? null,
        createdBy: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
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

    if (asset.status === "DISPOSED" || asset.status === "FULLY_DEPRECIATED") {
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
    // Número único por construcción: assetId + YYYYMM no puede repetirse gracias a
    // @@unique([fixedAssetId, periodYear, periodMonth]) en DepreciationEntry.
    // Elimina el race condition de count()+1 bajo concurrencia (Fix #4).
    const txNumber = `DEP-${year}${String(month).padStart(2, "0")}-${assetId.slice(-8).toUpperCase()}`;
    // VEN-NIF 16 párr. 55: el asiento se registra en el último día del mes depreciado.
    // new Date(year, month, 0) → día 0 del mes siguiente = último día del mes actual.
    const periodDate = new Date(year, month, 0);

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
              description: `Depreciación: ${asset.name} — ${year}/${String(month).padStart(2, "0")}`,
            },
            // Crédito: Depreciación Acumulada (negativo = crédito en nuestro modelo)
            {
              accountId: asset.accDepreciationAccountId,
              amount: calc.amount.negated(),
              description: `Dep. Acumulada: ${asset.name} — ${year}/${String(month).padStart(2, "0")}`,
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
   * Da de baja un activo (DISPOSED). Genera asiento de baja cuadrado.
   *
   * Estructura del asiento:
   *   DEBE  Dep. Acumulada          (elimina crédito acumulado)
   *   DEBE  Banco/CxC               (cobro por venta — si saleProceeds > 0)
   *   DEBE  Pérdida en baja         (si gainLoss < 0 y gainLossAccountId)
   *   HABER Activo (costo)          (elimina el activo del balance)
   *   HABER Ganancia en venta       (si gainLoss > 0 y gainLossAccountId)
   *
   * El asiento cuadra siempre que se proporcionen los IDs de cuenta necesarios.
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
    const cost        = new Decimal(asset.acquisitionCost.toString());
    const bookValue   = cost.minus(accumulated);
    const proceeds    = new Decimal(input.saleProceeds ?? "0");
    const gainLoss    = proceeds.minus(bookValue); // + ganancia, − pérdida

    // Número único por construcción: un activo solo puede darse de baja una vez
    // (status === "DISPOSED" guard arriba). Elimina race condition de count()+1 (Fix #4).
    const disposalDateStr = [
      input.disposalDate.getFullYear(),
      String(input.disposalDate.getMonth() + 1).padStart(2, "0"),
      String(input.disposalDate.getDate()).padStart(2, "0"),
    ].join("");
    const txNumber = `BAJA-${disposalDateStr}-${input.assetId.slice(-8).toUpperCase()}`;
    const label = asset.name;

    // ── Construir las líneas del asiento ─────────────────────────────────────
    const glEntries: { accountId: string; amount: Decimal; description: string }[] = [];

    // 1. DEBE: Dep. Acumulada (revertir créditos de períodos anteriores)
    if (accumulated.greaterThan(new Decimal("0.001"))) {
      glEntries.push({
        accountId:   asset.accDepreciationAccountId,
        amount:      accumulated,
        description: `Baja activo — dep. acum.: ${label}`,
      });
    }

    // 2. DEBE: Banco / CxC por cobro de venta (solo si hay precio de venta)
    if (proceeds.greaterThan(new Decimal("0.001")) && input.proceedsAccountId) {
      glEntries.push({
        accountId:   input.proceedsAccountId,
        amount:      proceeds,
        description: `Baja activo — cobro venta: ${label}`,
      });
    }

    // 3. HABER: Eliminar costo histórico del activo del balance
    glEntries.push({
      accountId:   asset.assetAccountId,
      amount:      cost.negated(),   // negativo = crédito
      description: `Baja activo — costo histórico: ${label}`,
    });

    // 4. Ganancia o Pérdida en baja
    //    gainLoss > 0 → ganancia → HABER a cuenta REVENUE  → amount: gainLoss.negated() (negativo)
    //    gainLoss < 0 → pérdida  → DEBE  a cuenta EXPENSE  → amount: gainLoss.negated() (positivo)
    //    Si no se proporcionó gainLossAccountId, usar depreciationAccountId como fallback
    //    para no dejar el asiento descuadrado (aunque la cuenta no es la ideal).
    const glAccountId = input.gainLossAccountId ?? asset.depreciationAccountId;
    if (gainLoss.abs().greaterThan(new Decimal("0.01"))) {
      glEntries.push({
        accountId:   glAccountId,
        amount:      gainLoss.negated(),
        description: `Baja activo — ${gainLoss.greaterThan(0) ? "ganancia" : "pérdida"}: ${label}`,
      });
    }

    await tx.transaction.create({
      data: {
        companyId:   input.companyId,
        number:      txNumber,
        date:        input.disposalDate,
        description: `Baja de activo: ${label}${input.notes ? ` — ${input.notes}` : ""}`,
        type:        "AJUSTE",
        userId,
        entries: { create: glEntries },
      },
    });

    await tx.fixedAsset.update({
      where: { id: input.assetId },
      data:  { status: "DISPOSED" },
    });

    await tx.auditLog.create({
      data: {
        companyId:  input.companyId,
        entityId:   input.assetId,
        entityName: "FixedAsset",
        action:     "UPDATE",
        userId,
        newValue: {
          status:       "DISPOSED",
          reason:       input.reason,
          disposalDate: input.disposalDate,
          proceeds:     input.saleProceeds,
          gainLoss:     gainLoss.toFixed(2),
          notes:        input.notes,
        },
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
