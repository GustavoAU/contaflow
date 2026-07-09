// src/modules/fixed-assets/services/FixedAssetService.ts
//
// Fase 21 — Activos Fijos y Depreciación (VEN-NIF 16 / IAS 16)
// Métodos: Línea Recta, Suma de Dígitos, Unidades de Producción

import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import type { PrismaClient, DepreciationMethod } from "@prisma/client";
import type {
  CreateFixedAssetInput,
  DisposeFixedAssetInput,
  PostINPCRestatementInput,
} from "../schemas/fixed-asset.schema";
import { computeAssetRestatement, buildInpcMap } from "./FixedAssetINPCService";
import {
  generateDepreciationSchedule,
  postDepreciation as _postDepreciation,
  postClosedYearCatchUpDepreciation as _postClosedYearCatchUpDepreciation,
  postMonthlyDepreciation as _postMonthlyDepreciation,
  dispose as _dispose,
  type DepreciationCalculation,
  type DepreciationScheduleRow,
} from "./FixedAssetDepreciationService";

// Cálculo de cuotas + posteo mensual/catch-up + baja: extraído a
// FixedAssetDepreciationService.ts (split por tamaño de archivo) — re-exportado abajo.
export {
  calcMonthlyDepreciation,
  calcDepreciationForPeriod,
  generateDepreciationSchedule,
} from "./FixedAssetDepreciationService";
export type { DepreciationCalculation, DepreciationScheduleRow };

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ─── Tipos de salida ────────────────────────────────────────────────────────────

/**
 * FU-03: Fila de conciliación GL vs. Módulo por cuenta de Depreciación Acumulada.
 * difference > 0 → GL tiene más que el módulo (asiento manual de más)
 * difference < 0 → módulo registra más que el GL (entry sin transacción)
 */
export type GLReconciliationRow = {
  accDepreciationAccountId: string;
  accountCode: string;
  accountName: string;
  moduleTotal: Decimal; // suma accumulatedDepreciation del módulo (no-DISPOSED)
  glTotal: Decimal; // saldo crédito neto en GL (no-VOIDED)
  difference: Decimal; // glTotal − moduleTotal  (0 = cuadrado)
  assetCount: number; // activos no-DISPOSED en este grupo
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
  // FC-02 campos legales
  serialNumber: string | null;
  internalCode: string | null;
  invoiceNumber: string | null;
  providerRif: string | null;
  // N2: moneda de adquisición y tasa BCV histórica
  acquisitionCurrency: string;
  bcvRateAtAcquisition: Decimal | null;
};

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
        // FC-02 campos legales SENIAT
        invoiceNumber: input.invoiceNumber ?? null,
        providerRif: input.providerRif ?? null,
        serialNumber: input.serialNumber ?? null,
        serviceStartDate: input.serviceStartDate ?? null,
        internalCode: input.internalCode ?? null,
        // N2: moneda de adquisición y tasa BCV histórica
        acquisitionCurrency: input.acquisitionCurrency ?? "VES",
        bcvRateAtAcquisition: input.bcvRateAtAcquisition ? new Decimal(input.bcvRateAtAcquisition) : null,
        createdBy: userId,
      },
    });

    // Hallazgo #8: asiento de adquisición GL — Dr Activos Fijos Brutos / Cr Origen
    // Solo si se proporcionó acquisitionCounterpartAccountId (campo opcional).
    // Evita que la cuenta de Activos Fijos Brutos quede en cero en el Balance General.
    if (input.acquisitionCounterpartAccountId) {
      const acqCost = new Decimal(input.acquisitionCost);
      const txCount = await tx.transaction.count({ where: { companyId: input.companyId } });
      const acqEntries = [
        {
          accountId: input.assetAccountId,
          amount:     acqCost,
          description: `Activo fijo adquirido — ${input.name}`,
        },
        {
          accountId: input.acquisitionCounterpartAccountId,
          amount:     acqCost.negated(),
          description: `Origen adquisición — ${input.name}`,
        },
      ];
      assertBalancedGLEntries(acqEntries); // N4: invariante partida doble
      await tx.transaction.create({
        data: {
          companyId: input.companyId,
          number: `AF-ACQ-${String(txCount + 1).padStart(6, "0")}`,
          date: input.acquisitionDate,
          description: `Adquisición ${input.name} — costo ${acqCost.toFixed(2)}`,
          type: "DIARIO",
          userId,
          entries: {
            create: acqEntries,
          },
        },
      });
    }

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
          acquisitionCounterpartAccountId: input.acquisitionCounterpartAccountId ?? null,
        },
      },
    });

    return asset;
  }

  // ─── Depreciación (posteo mensual/catch-up) + baja: extraído a
  // FixedAssetDepreciationService.ts (split por tamaño de archivo) ────────────
  static postDepreciation(
    assetId: string,
    companyId: string,
    year: number,
    month: number,
    userId: string,
    tx: Tx,
    unitsThisPeriod = 0
  ) {
    return _postDepreciation(assetId, companyId, year, month, userId, tx, unitsThisPeriod);
  }

  static postClosedYearCatchUpDepreciation(
    assetId: string,
    companyId: string,
    periods: { year: number; month: number }[],
    userId: string,
    tx: Tx
  ) {
    return _postClosedYearCatchUpDepreciation(assetId, companyId, periods, userId, tx);
  }

  static postMonthlyDepreciation(
    companyId: string,
    year: number,
    month: number,
    userId: string,
    tx: Tx
  ) {
    return _postMonthlyDepreciation(companyId, year, month, userId, tx);
  }

  static dispose(input: DisposeFixedAssetInput, userId: string, tx: Tx) {
    return _dispose(input, userId, tx);
  }

  /**
   * Listado de activos con resumen de valor en libros.
   */
  static async getSummary(companyId: string): Promise<FixedAssetSummary[]> {
    const assets = await (
      await import("@/lib/prisma")
    ).default.fixedAsset.findMany({
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
        lastEntryDate: lastEntry
          ? { year: lastEntry.periodYear, month: lastEntry.periodMonth }
          : null,
        // FC-02 campos legales
        serialNumber: a.serialNumber ?? null,
        internalCode: a.internalCode ?? null,
        invoiceNumber: a.invoiceNumber ?? null,
        providerRif: a.providerRif ?? null,
        // N2: moneda de adquisición y tasa BCV histórica
        acquisitionCurrency: a.acquisitionCurrency,
        bcvRateAtAcquisition: a.bcvRateAtAcquisition
          ? new Decimal(a.bcvRateAtAcquisition.toString())
          : null,
      };
    });
  }

  /**
   * Tabla completa de depreciación de un activo (proyección + historial real).
   */
  static async getSchedule(assetId: string, companyId: string) {
    const prisma = (await import("@/lib/prisma")).default;
    const asset = await prisma.fixedAsset.findFirstOrThrow({ where: { id: assetId, companyId } });
    const postedEntries = await prisma.depreciationEntry.findMany({
      // ADR-004-EXCEPTION: scoped via fixedAssetId FK — asset ya validado con companyId arriba
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

  /**
   * FU-03: Conciliación GL vs. Módulo de Activos Fijos.
   *
   * Compara la depreciación acumulada registrada en el módulo (DepreciationEntry)
   * contra el saldo neto crédito en las cuentas CONTRA_ASSET del Libro Mayor,
   * excluyendo asientos anulados (VOIDED) — misma convención que PeriodSnapshotService.
   *
   * Detecta:
   *  - Asientos manuales que aumentan/reducen la cuenta sin pasar por el módulo
   *  - DepreciationEntries sin transacción contable asociada
   */
  static async getGLReconciliation(companyId: string): Promise<GLReconciliationRow[]> {
    const prisma = (await import("@/lib/prisma")).default;

    // 1. Activos no-DISPOSED agrupados por cuenta de Dep. Acumulada
    const assets = await prisma.fixedAsset.findMany({
      where: { companyId, status: { not: "DISPOSED" }, deletedAt: null },
      select: {
        accDepreciationAccountId: true,
        entries: {
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
          take: 1,
          select: { accumulatedDepreciation: true },
        },
      },
    });

    if (assets.length === 0) return [];

    // 2. Agrupar por cuenta — suma depreciación acumulada del módulo
    const moduleGroups = new Map<string, { total: Decimal; count: number }>();
    for (const a of assets) {
      const existing = moduleGroups.get(a.accDepreciationAccountId) ?? {
        total: new Decimal(0),
        count: 0,
      };
      const lastEntry = a.entries[0];
      const accDep = lastEntry
        ? new Decimal(lastEntry.accumulatedDepreciation.toString())
        : new Decimal(0);
      moduleGroups.set(a.accDepreciationAccountId, {
        total: existing.total.plus(accDep),
        count: existing.count + 1,
      });
    }

    const accountIds = [...moduleGroups.keys()];

    // 3. Saldo neto GL (solo transacciones no-VOIDED) — igual que PeriodSnapshotService
    const jeLines = await prisma.journalEntry.findMany({
      where: {
        accountId: { in: accountIds },
        transaction: { companyId, status: { not: "VOIDED" } },
      },
      select: { accountId: true, amount: true },
    });

    const glSums = new Map<string, Decimal>();
    for (const je of jeLines) {
      const prev = glSums.get(je.accountId) ?? new Decimal(0);
      glSums.set(je.accountId, prev.plus(new Decimal(je.amount.toString())));
    }

    // 4. Metadatos de cuentas para la UI
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds }, companyId },
      select: { id: true, code: true, name: true },
    });
    const accMap = new Map(accounts.map((a) => [a.id, a]));

    // 5. Resultado: CONTRA_ASSET tiene saldo crédito natural → negado para positivo
    const result: GLReconciliationRow[] = [];
    for (const [accId, { total: moduleTotal, count }] of moduleGroups) {
      const netJE = glSums.get(accId) ?? new Decimal(0);
      const glTotal = netJE.negated(); // crédito = positivo
      const difference = glTotal.minus(moduleTotal);
      const acc = accMap.get(accId);
      result.push({
        accDepreciationAccountId: accId,
        accountCode: acc?.code ?? accId,
        accountName: acc?.name ?? "—",
        moduleTotal,
        glTotal,
        difference,
        assetCount: count,
      });
    }

    return result.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  /**
   * Genera el asiento de Reajuste Regular por Inflación INPC para todos los activos ACTIVE.
   * Art. 173 ISLR: costo reexpresado = costo × (INPC_periodo / INPC_adquisicion)
   * Asiento: DEBE Cuenta Activo / HABER Cuenta Actualización de Patrimonio
   *
   * @param input.periodYear/periodMonth    período INPC objetivo (debe estar cargado)
   * @param input.patrimonioAccountId       cuenta EQUITY de Actualización de Patrimonio
   */
  static async postINPCRestatement(
    input: PostINPCRestatementInput,
    userId: string,
    tx: Tx
  ): Promise<{ processed: number; skipped: number; totalAdjustment: Decimal }> {
    const { companyId, periodYear, periodMonth, patrimonioAccountId } = input;

    // 1. Obtener el índice INPC del período objetivo
    const periodRate = await tx.iNPCRate.findUnique({
      where: { companyId_year_month: { companyId, year: periodYear, month: periodMonth } },
    });
    if (!periodRate) {
      throw new Error(
        `No hay índice INPC cargado para ${periodYear}/${String(periodMonth).padStart(2, "0")}. Cárgalo en el módulo de Inflación.`
      );
    }

    // 2. Obtener todos los índices disponibles para armar el mapa
    const allRates = await tx.iNPCRate.findMany({ where: { companyId } });
    const inpcMap = buildInpcMap(
      allRates.map((r) => ({ year: r.year, month: r.month, indexValue: r.indexValue.toString() }))
    );

    // 3. Activos activos con cuentas vinculadas
    const assets = await tx.fixedAsset.findMany({
      where: { companyId, status: "ACTIVE", deletedAt: null },
    });

    // N3: pre-cargar reajustes ya registrados para este período (idempotencia)
    const existingRestatements = await tx.fixedAssetINPCRestatement.findMany({
      where: { companyId, inpcPeriodYear: periodYear, inpcPeriodMonth: periodMonth },
      select: { assetId: true },
    });
    const alreadyRestatementSet = new Set(existingRestatements.map((r) => r.assetId));

    const glEntries: { accountId: string; amount: Decimal; description: string }[] = [];
    // N3: datos para los registros históricos por activo
    const restatementRecords: {
      assetId: string;
      factor: Decimal;
      adjustmentAmount: Decimal;
      previousBookValue: Decimal;
      newRestatedValue: Decimal;
    }[] = [];
    let processed = 0;
    let skipped = 0;
    let totalAdjust = new Decimal(0);

    for (const asset of assets) {
      // N3: saltar si ya fue procesado en este período
      if (alreadyRestatementSet.has(asset.id)) {
        skipped++;
        continue;
      }

      const restatement = computeAssetRestatement(
        asset.acquisitionDate,
        asset.acquisitionCost.toString(),
        inpcMap,
        {
          year: periodRate.year,
          month: periodRate.month,
          indexValue: periodRate.indexValue.toString(),
        }
      );

      if (!restatement || restatement.acqRateMissing) {
        skipped++;
        continue;
      }

      const adjustment = new Decimal(restatement.adjustment);
      if (adjustment.abs().lessThan(new Decimal("0.01"))) {
        skipped++;
        continue;
      }

      const previousBookValue = new Decimal(asset.acquisitionCost.toString());
      const newRestatedValue  = previousBookValue.plus(adjustment);
      const factor            = new Decimal(restatement.factor);

      // DEBE: Activo (ajuste al costo histórico)
      glEntries.push({
        accountId: asset.assetAccountId,
        amount: adjustment, // positivo = débito
        description: `Reajuste INPC ${periodYear}/${String(periodMonth).padStart(2, "0")}: ${asset.name}`,
      });
      // HABER: Actualización de Patrimonio
      glEntries.push({
        accountId: patrimonioAccountId,
        amount: adjustment.negated(), // negativo = crédito
        description: `Reajuste INPC ${periodYear}/${String(periodMonth).padStart(2, "0")}: ${asset.name}`,
      });

      restatementRecords.push({ assetId: asset.id, factor, adjustmentAmount: adjustment, previousBookValue, newRestatedValue });
      totalAdjust = totalAdjust.plus(adjustment);
      processed++;
    }

    if (glEntries.length === 0) {
      return { processed: 0, skipped, totalAdjustment: new Decimal(0) };
    }

    const txCount = await tx.transaction.count({ where: { companyId } });
    const txNumber = `INF-AF-${periodYear}${String(periodMonth).padStart(2, "0")}-${String(txCount + 1).padStart(4, "0")}`;

    assertBalancedGLEntries(glEntries); // N4: invariante partida doble
    const createdTx = await tx.transaction.create({
      data: {
        companyId,
        number: txNumber,
        date: new Date(periodYear, periodMonth, 0), // último día del mes
        description: `Reajuste por Inflación INPC — Activos Fijos ${periodYear}/${String(periodMonth).padStart(2, "0")} (Art. 173 ISLR)`,
        type: "AJUSTE",
        userId,
        entries: { create: glEntries },
      },
    });

    // N3: crear registros históricos de reajuste INPC por activo
    await tx.fixedAssetINPCRestatement.createMany({
      data: restatementRecords.map((r) => ({
        id:                `${r.assetId}-${periodYear}-${periodMonth}-${Date.now()}`,
        companyId,
        assetId:           r.assetId,
        inpcPeriodYear:    periodYear,
        inpcPeriodMonth:   periodMonth,
        factor:            r.factor,
        adjustmentAmount:  r.adjustmentAmount,
        previousBookValue: r.previousBookValue,
        newRestatedValue:  r.newRestatedValue,
        equityAccountId:   patrimonioAccountId,
        transactionId:     `${createdTx.id}-${r.assetId}`,
        userId,
      })),
      skipDuplicates: true,
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: companyId,
        entityName: "FixedAssetINPCRestatement",
        action: "CREATE",
        userId,
        newValue: {
          periodYear,
          periodMonth,
          processed,
          skipped,
          totalAdjustment: totalAdjust.toFixed(2),
          txNumber,
        },
      },
    });

    return { processed, skipped, totalAdjustment: totalAdjust };
  }

  /**
   * N3: Historial de reajustes INPC para un activo (o toda la empresa).
   */
  static async getINPCRestatementHistory(
    companyId: string,
    assetId?: string,
  ) {
    const prismaClient = (await import("@/lib/prisma")).default;
    const records = await prismaClient.fixedAssetINPCRestatement.findMany({
      where: { companyId, ...(assetId ? { assetId } : {}) },
      include: { asset: { select: { name: true } } },
      orderBy: [{ inpcPeriodYear: "desc" }, { inpcPeriodMonth: "desc" }],
    });
    return records.map((r) => ({
      id:                r.id,
      assetId:           r.assetId,
      assetName:         r.asset.name,
      inpcPeriodYear:    r.inpcPeriodYear,
      inpcPeriodMonth:   r.inpcPeriodMonth,
      factor:            new Decimal(r.factor.toString()),
      adjustmentAmount:  new Decimal(r.adjustmentAmount.toString()),
      previousBookValue: new Decimal(r.previousBookValue.toString()),
      newRestatedValue:  new Decimal(r.newRestatedValue.toString()),
      equityAccountId:   r.equityAccountId,
      transactionId:     r.transactionId,
      createdAt:         r.createdAt,
    }));
  }
}
