// src/modules/fixed-assets/services/FixedAssetService.ts
//
// Fase 21 — Activos Fijos y Depreciación (VEN-NIF 16 / IAS 16)
// Métodos: Línea Recta, Suma de Dígitos, Unidades de Producción

import { Decimal } from "decimal.js";
import type { PrismaClient, DepreciationMethod, FixedAsset } from "@prisma/client";
import type {
  CreateFixedAssetInput,
  DisposeFixedAssetInput,
  PostINPCRestatementInput,
} from "../schemas/fixed-asset.schema";
import { computeAssetRestatement, buildInpcMap } from "./FixedAssetINPCService";

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

export type DepreciationCalculation = {
  amount: Decimal; // cuota del período
  accumulated: Decimal; // depreciación acumulada al final del período
  bookValue: Decimal; // valor en libros = costo − acumulada
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
  // FC-02 campos legales
  serialNumber: string | null;
  internalCode: string | null;
  invoiceNumber: string | null;
  providerRif: string | null;
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
  asset: Pick<
    FixedAsset,
    "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits"
  >,
  month1: number, // mes ordinal desde inicio (1-based)
  unitsThisPeriod = 0
): Decimal {
  const cost = new Decimal(asset.acquisitionCost.toString());
  const residual = new Decimal(asset.residualValue.toString());
  const depreciable = cost.minus(residual);
  const n = asset.usefulLifeMonths;

  if (depreciable.lessThanOrEqualTo(0)) return new Decimal(0);
  if (month1 > n) return new Decimal(0); // totalmente depreciado

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
  asset: Pick<
    FixedAsset,
    "acquisitionCost" | "residualValue" | "usefulLifeMonths" | "depreciationMethod" | "totalUnits"
  >,
  month1: number,
  previousAccumulated: Decimal,
  unitsThisPeriod = 0
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
  asset: Pick<
    FixedAsset,
    | "acquisitionCost"
    | "residualValue"
    | "usefulLifeMonths"
    | "depreciationMethod"
    | "totalUnits"
    | "acquisitionDate"
  >
): DepreciationScheduleRow[] {
  const rows: DepreciationScheduleRow[] = [];
  let accumulated = new Decimal(0);
  const startDate = new Date(asset.acquisitionDate);
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth() + 2; // depreciar desde el mes siguiente a la adquisición (UTC)
  if (month > 12) {
    month = 1;
    year++;
  }

  for (let m = 1; m <= asset.usefulLifeMonths; m++) {
    const calc = calcDepreciationForPeriod(asset, m, accumulated);
    if (calc.amount.equals(0) && m > 1) break;
    accumulated = calc.accumulated;
    rows.push({ year, month, ...calc });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
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
        // FC-02 campos legales SENIAT
        invoiceNumber: input.invoiceNumber ?? null,
        providerRif: input.providerRif ?? null,
        serialNumber: input.serialNumber ?? null,
        serviceStartDate: input.serviceStartDate ?? null,
        internalCode: input.internalCode ?? null,
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
    unitsThisPeriod = 0
  ): Promise<{ entry: { id: string; amount: Decimal }; created: boolean }> {
    // Idempotencia: si ya existe la entrada, retornar
    const existing = await tx.depreciationEntry.findUnique({
      where: {
        fixedAssetId_periodYear_periodMonth: {
          fixedAssetId: assetId,
          periodYear: year,
          periodMonth: month,
        },
      },
    });
    if (existing) {
      return {
        entry: { id: existing.id, amount: new Decimal(existing.amount.toString()) },
        created: false,
      };
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
   * VEN-NIF 8 / IAS 8: Catch-up consolidado para períodos de ejercicios fiscales CERRADOS.
   *
   * Genera UN único asiento GL con fecha de hoy (período corriente) que agrupa la
   * depreciación de TODOS los períodos pendientes de ejercicios ya cerrados.
   * Cada período recibe su propio DepreciationEntry individual (visible en la tabla de
   * depreciación del activo), pero todos quedan vinculados al mismo transactionId.
   *
   * Justificación: no se pueden retroactuar asientos en ejercicios declarados al SENIAT
   * (Art. 32 CComercio). El error no-material se reconoce en el período corriente (IAS 8 §42).
   *
   * @param periods  Períodos pendientes (ya ordenados cronológicamente, ya filtrados sin existing entry)
   */
  static async postClosedYearCatchUpDepreciation(
    assetId:   string,
    companyId: string,
    periods:   { year: number; month: number }[],
    userId:    string,
    tx:        Tx,
  ): Promise<{ processed: number }> {
    if (periods.length === 0) return { processed: 0 };

    const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id: assetId, companyId } });

    // Acumulado ya persistido en BD
    const prevAgg = await tx.depreciationEntry.aggregate({
      where: { fixedAssetId: assetId },
      _sum: { amount: true },
    });
    let runningAccumulated = new Decimal(prevAgg._sum.amount?.toString() ?? "0");

    const acqDate  = new Date(asset.acquisitionDate);
    const acqYear  = acqDate.getUTCFullYear();
    const acqMonth = acqDate.getUTCMonth() + 1;

    type EntryCalc = { year: number; month: number; amount: Decimal; accumulated: Decimal; bookValue: Decimal };
    const entryCalcs: EntryCalc[] = [];
    let totalAmount = new Decimal(0);

    for (const { year: y, month: m } of periods) {
      const month1 = (y - acqYear) * 12 + (m - acqMonth);
      if (month1 <= 0) continue;

      const calc = calcDepreciationForPeriod(asset, month1, runningAccumulated, 0);
      if (calc.amount.equals(0)) break; // totalmente depreciado

      entryCalcs.push({ year: y, month: m, amount: calc.amount, accumulated: calc.accumulated, bookValue: calc.bookValue });
      runningAccumulated = calc.accumulated;
      totalAmount = totalAmount.plus(calc.amount);
    }

    if (entryCalcs.length === 0 || totalAmount.equals(0)) return { processed: 0 };

    // Ejercicios involucrados para la descripción del asiento
    const years = [...new Set(entryCalcs.map((e) => e.year))].sort().join(", ");
    const today = new Date();
    // txNumber único: por construcción (un solo catch-up VEN-NIF8 por activo por mes corriente)
    const txNumber = `DEP-VNF8-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}-${assetId.slice(-8).toUpperCase()}`;

    const glTx = await tx.transaction.create({
      data: {
        companyId,
        number:      txNumber,
        date:        today,
        description: `Ajuste depreciación ejercicios anteriores (${years}) — VEN-NIF 8 / ${asset.name}`,
        type:        "AJUSTE",
        userId,
        entries: {
          create: [
            {
              accountId:   asset.depreciationAccountId,
              amount:      totalAmount,
              description: `Dep. ejercicios ${years}: ${asset.name} — VEN-NIF 8`,
            },
            {
              accountId:   asset.accDepreciationAccountId,
              amount:      totalAmount.negated(),
              description: `Dep. Acum. ejercicios ${years}: ${asset.name} — VEN-NIF 8`,
            },
          ],
        },
      },
    });

    // DepreciationEntry individual por período (la tabla de depreciación los muestra correctamente)
    for (const e of entryCalcs) {
      await tx.depreciationEntry.create({
        data: {
          companyId,
          fixedAssetId:           assetId,
          periodYear:             e.year,
          periodMonth:            e.month,
          amount:                 e.amount,
          accumulatedDepreciation: e.accumulated,
          bookValue:              e.bookValue,
          transactionId:          glTx.id, // todos vinculados al mismo asiento GL
          postedAt:               new Date(),
        },
      });
    }

    // Verificar si el activo quedó totalmente depreciado
    const lastCalc = entryCalcs[entryCalcs.length - 1]!;
    if (lastCalc.bookValue.lessThanOrEqualTo(new Decimal("0.01"))) {
      await tx.fixedAsset.update({ where: { id: assetId }, data: { status: "FULLY_DEPRECIATED" } });
    }

    return { processed: entryCalcs.length };
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
    tx: Tx
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
          asset.id,
          companyId,
          year,
          month,
          userId,
          tx
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
    const cost = new Decimal(asset.acquisitionCost.toString());
    const bookValue = cost.minus(accumulated);
    const proceeds = new Decimal(input.saleProceeds ?? "0");

    // IVA Débito Fiscal (Art. 3 LIVA): solo si es venta y el usuario lo activó
    const applyIva = input.applyIva === true && input.reason === "SALE";
    const ivaRate = applyIva ? new Decimal(input.ivaRate ?? "0.16") : new Decimal("0");
    const ivaAmount = applyIva
      ? proceeds.times(ivaRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : new Decimal("0");
    // El banco recibe el precio TOTAL (con IVA); la ganancia/pérdida se calcula sobre el precio NETO
    const totalReceivable = proceeds.plus(ivaAmount);
    const gainLoss = proceeds.minus(bookValue); // + ganancia, − pérdida (sobre precio neto)

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
        accountId: asset.accDepreciationAccountId,
        amount: accumulated,
        description: `Baja activo — dep. acum.: ${label}`,
      });
    }

    // 2. DEBE: Banco / CxC — importe total cobrado (precio + IVA si aplica)
    if (proceeds.greaterThan(new Decimal("0.001")) && input.proceedsAccountId) {
      glEntries.push({
        accountId: input.proceedsAccountId,
        amount: totalReceivable, // precio neto + IVA (o solo precio neto si no aplica IVA)
        description: `Baja activo — cobro venta${applyIva ? " (inc. IVA)" : ""}: ${label}`,
      });
    }

    // 2b. HABER: IVA Débito Fiscal (Art. 3 LIVA) — solo si venta con IVA activado
    if (applyIva && ivaAmount.greaterThan(new Decimal("0.001")) && input.ivaDFAccountId) {
      glEntries.push({
        accountId: input.ivaDFAccountId,
        amount: ivaAmount.negated(), // negativo = crédito
        description: `Baja activo — IVA DF 16% venta: ${label}`,
      });
    }

    // 3. HABER: Eliminar costo histórico del activo del balance
    glEntries.push({
      accountId: asset.assetAccountId,
      amount: cost.negated(), // negativo = crédito
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
        accountId: glAccountId,
        amount: gainLoss.negated(),
        description: `Baja activo — ${gainLoss.greaterThan(0) ? "ganancia" : "pérdida"}: ${label}`,
      });
    }

    // 5. Art. 66 LIVA — Reintegro IVA Crédito Fiscal por baja anticipada (< 36 meses)
    //    DEBE  Gasto IVA Reintegrado  (art66ExpenseAccountId, EXPENSE)  → amount: +reintegro
    //    HABER IVA Crédito Fiscal     (ivaDFAccountId, ASSET)           → amount: −reintegro
    //    La fracción: (36 − meses_usados) / 36 del IVA crédito original (cost × 16%)
    if (input.applyArt66 && input.art66ExpenseAccountId && input.ivaDFAccountId) {
      const art66Amount = new Decimal(input.art66ReintegroAmount ?? "0");
      if (art66Amount.greaterThan(new Decimal("0.001"))) {
        glEntries.push({
          accountId: input.art66ExpenseAccountId,
          amount: art66Amount,                  // DEBE (positivo)
          description: `Reintegro IVA Crédito Fiscal Art. 66 LIVA — baja anticipada: ${label}`,
        });
        glEntries.push({
          accountId: input.ivaDFAccountId,
          amount: art66Amount.negated(),        // HABER (negativo)
          description: `Reintegro IVA Crédito Fiscal Art. 66 LIVA — baja anticipada: ${label}`,
        });
      }
    }

    await tx.transaction.create({
      data: {
        companyId: input.companyId,
        number: txNumber,
        date: input.disposalDate,
        description: `Baja de activo: ${label}${input.notes ? ` — ${input.notes}` : ""}`,
        type: "AJUSTE",
        userId,
        entries: { create: glEntries },
      },
    });

    await tx.fixedAsset.update({
      where: { id: input.assetId },
      data: { status: "DISPOSED" },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        entityId: input.assetId,
        entityName: "FixedAsset",
        action: "UPDATE",
        userId,
        newValue: {
          status: "DISPOSED",
          reason: input.reason,
          disposalDate: input.disposalDate,
          proceeds: input.saleProceeds,
          gainLoss: gainLoss.toFixed(2),
          notes: input.notes,
        },
      },
    });
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

    const glEntries: { accountId: string; amount: Decimal; description: string }[] = [];
    let processed = 0;
    let skipped = 0;
    let totalAdjust = new Decimal(0);

    for (const asset of assets) {
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

      totalAdjust = totalAdjust.plus(adjustment);
      processed++;
    }

    if (glEntries.length === 0) {
      return { processed: 0, skipped, totalAdjustment: new Decimal(0) };
    }

    const txCount = await tx.transaction.count({ where: { companyId } });
    const txNumber = `INF-AF-${periodYear}${String(periodMonth).padStart(2, "0")}-${String(txCount + 1).padStart(4, "0")}`;

    await tx.transaction.create({
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
}
