// src/modules/accounting/services/PeriodService.ts
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export class PeriodService {
  /**
   * ADR-055: valida que `date` caiga en un `AccountingPeriod` OPEN cuyo `FiscalYear`
   * también esté OPEN, y lo retorna. `year`/`month` de `AccountingPeriod` NUNCA
   * cambiaron de significado (siguen siendo el año/mes calendario literal) — por eso
   * esta función resuelve por fecha exactamente igual que antes de ADR-055; lo único
   * que cambió es que ya NO existe "el único período OPEN de la empresa": ahora puede
   * haber hasta 24 (dos ejercicios de 12 meses) simultáneamente. Firma y forma de
   * retorno sin cambios — cero impacto en los ~30 call-sites que la invocan.
   *
   * Importante: se usan getters UTC porque las fechas de operación se construyen como
   * `new Date("YYYY-MM-DD")` (medianoche UTC). Usar getters locales desplazaría el mes
   * en husos negativos como Venezuela (UTC-4). Ver patrón en fixed-assets/payroll.
   */
  static async assertDateInOpenPeriod(
    companyId: string,
    date: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; year: number; month: number }> {
    const db = tx ?? prisma;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;

    const period = await db.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      select: { id: true, year: true, month: true, status: true, fiscalYear: { select: { status: true } } },
    });

    const mm = String(month).padStart(2, "0");

    if (!period) {
      throw new Error(
        `No existe un período contable abierto para ${mm}/${year}. Verifica el ejercicio fiscal en Contabilidad → Ejercicios.`,
      );
    }
    if (period.status !== "OPEN" || period.fiscalYear?.status !== "OPEN") {
      throw new Error(
        `El período ${mm}/${year} está cerrado. Solo se pueden registrar operaciones en un período abierto.`,
      );
    }
    return { id: period.id, year: period.year, month: period.month };
  }

  /**
   * E-14 (auditoría Compras/Ventas 2026-07): resuelve el periodId de un documento
   * FISCAL (factura directa o convertida desde orden) fechado en `date`.
   *
   * ADR-055: sin cambios de contrato — ya resolvía por (companyId, year, month)
   * literal, nunca asumió un único período OPEN global (D-5, confirmado leyendo la
   * implementación completa, no una suposición).
   *
   * Reglas:
   * - Período del mes CLOSED (o su FiscalYear CLOSED) → error (R-3).
   * - Mes SIN período cuando la empresa YA usa disciplina de períodos (tiene ≥1
   *   período) → error.
   * - Empresa SIN ningún período (demo/pre-onboarding) → null, se permite.
   */
  static async resolveFiscalPeriodId(
    db: Prisma.TransactionClient,
    companyId: string,
    date: Date,
    docLabel = "el documento",
  ): Promise<string | null> {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const mm = String(month).padStart(2, "0");

    const periodForDate = await db.accountingPeriod.findFirst({
      where: { companyId, year, month },
      select: { id: true, status: true, fiscalYear: { select: { status: true } } },
    });
    if (periodForDate && (periodForDate.status === "CLOSED" || periodForDate.fiscalYear?.status === "CLOSED")) {
      throw new Error(
        `No se puede registrar ${docLabel} en el período ${mm}/${year} porque está CERRADO. Use una fecha en el período activo.`,
      );
    }
    if (!periodForDate) {
      const anyPeriod = await db.accountingPeriod.findFirst({
        where: { companyId },
        select: { id: true },
      });
      if (anyPeriod) {
        throw new Error(
          `No existe un período contable para ${mm}/${year}. Ábralo en Contabilidad → Ejercicios o use una fecha del ejercicio activo.`,
        );
      }
      return null;
    }
    return periodForDate.id;
  }

  /**
   * Obtiene todos los períodos de una empresa ordenados por fecha.
   * ADR-055: incluye `fiscalYearId` para que la UI pueda agrupar por ejercicio.
   */
  static async getPeriods(companyId: string) {
    return prisma.accountingPeriod.findMany({
      where: { companyId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }
}
