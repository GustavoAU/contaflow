// src/modules/accounting/services/FiscalYearService.ts
// ADR-055: Ejercicio Fiscal Anual — apertura/consulta del ejercicio completo.
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { withSerializableRetry } from "@/lib/tx-helpers";
import type { Prisma } from "@prisma/client";

export type FiscalYearPeriod = {
  id: string;
  year: number;
  month: number;
  status: "OPEN" | "CLOSED";
};

export type FiscalYearWithPeriods = {
  id: string;
  companyId: string;
  year: number;
  startMonth: number;
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  openedBy: string;
  closedAt: Date | null;
  closedBy: string | null;
  periods: FiscalYearPeriod[];
};

const MAX_CONCURRENT_OPEN_FISCAL_YEARS = 2;

/** Índice cronológico mes-a-mes desde el inicio del ejercicio (D-8 / fix H-2). */
function chronologicalKey(startYear: number, startMonth: number, p: { year: number; month: number }): number {
  return (p.year - startYear) * 12 + (p.month - startMonth);
}

export class FiscalYearService {
  /**
   * Ejercicio activo = el FiscalYear con status OPEN cuyo (year, startMonth) es el
   * más reciente. Dato DERIVADO (D-3), nunca persistido — evita que se desincronice.
   * Puede coexistir con OTRO FiscalYear también OPEN (el que está en su ventana de
   * cierre — ver D-9): ese no es "el activo", pero sigue siendo editable.
   */
  static async getActiveFiscalYear(companyId: string): Promise<FiscalYearWithPeriods | null> {
    const fy = await prisma.fiscalYear.findFirst({
      where: { companyId, status: "OPEN" },
      orderBy: [{ year: "desc" }, { startMonth: "desc" }],
      include: { periods: { select: { id: true, year: true, month: true, status: true } } },
    });
    return fy as FiscalYearWithPeriods | null;
  }

  /** Todos los ejercicios de la empresa, más reciente primero, con sus períodos. */
  static async getFiscalYears(companyId: string): Promise<FiscalYearWithPeriods[]> {
    const list = await prisma.fiscalYear.findMany({
      where: { companyId },
      orderBy: [{ year: "desc" }, { startMonth: "desc" }],
      include: { periods: { select: { id: true, year: true, month: true, status: true } } },
    });
    return list as FiscalYearWithPeriods[];
  }

  /**
   * Abre el ejercicio completo: crea el FiscalYear + sus 12 AccountingPeriod (OPEN)
   * en una sola operación (D-B). Reemplaza el flujo viejo de abrir un mes a la vez.
   *
   * D-9: máximo 2 FiscalYear OPEN simultáneos por empresa (soporta la convivencia
   * real "2026 en cierre + 2027 activo" sin permitir acumulación descontrolada).
   * D-10: apertura estrictamente secuencial sin huecos — el próximo ejercicio se
   * calcula SIEMPRE a partir del último FiscalYear ya persistido (nunca de "hoy").
   * Solo el primer ejercicio de una empresa (bootstrap) toma `year` de un input
   * validado del usuario y `startMonth` de Company.fiscalYearStartMonth.
   *
   * D-11: Serializable + retry P2034 — la validación "máx. 2 OPEN" es
   * lectura-decide-escribe sobre un conteo; bajo Read Committed, dos aperturas
   * concurrentes de AÑOS DISTINTOS no chocan contra ningún @@unique y podrían
   * violar el límite en silencio.
   */
  static async openFiscalYear(
    companyId: string,
    userId: string,
    bootstrapYear?: number,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<FiscalYearWithPeriods> {
    return withSerializableRetry((tx) =>
      withCompanyContext(companyId, tx, async (tx) => {
        const openCount = await tx.fiscalYear.count({ where: { companyId, status: "OPEN" } });
        if (openCount >= MAX_CONCURRENT_OPEN_FISCAL_YEARS) {
          throw new Error(
            `Ya hay ${openCount} ejercicios fiscales abiertos (el máximo permitido). Cierra el ejercicio más antiguo antes de abrir uno nuevo.`,
          );
        }

        const lastFiscalYear = await tx.fiscalYear.findFirst({
          where: { companyId },
          orderBy: [{ year: "desc" }, { startMonth: "desc" }],
          select: { year: true, startMonth: true },
        });

        let year: number;
        let startMonth: number;

        if (!lastFiscalYear) {
          // Bootstrap: primer ejercicio de la empresa.
          const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { fiscalYearStartMonth: true },
          });
          if (!company) throw new Error("Empresa no encontrada.");
          if (!bootstrapYear || bootstrapYear < 2000 || bootstrapYear > 2100) {
            throw new Error("Debe indicar el año del primer ejercicio a abrir.");
          }
          year = bootstrapYear;
          startMonth = company.fiscalYearStartMonth;
        } else {
          // D-10: siempre el mes inmediato siguiente al fin del ejercicio anterior —
          // nunca input libre del usuario más allá del bootstrap.
          const totalMonths = lastFiscalYear.year * 12 + (lastFiscalYear.startMonth - 1) + 12;
          year = Math.floor(totalMonths / 12);
          startMonth = (totalMonths % 12) + 1;
        }

        const existing = await tx.fiscalYear.findUnique({
          where: { companyId_year: { companyId, year } },
          select: { id: true },
        });
        if (existing) {
          throw new Error(`Ya existe un ejercicio fiscal para el año ${year}.`);
        }

        const created = await tx.fiscalYear.create({
          data: { companyId, year, startMonth, status: "OPEN", openedBy: userId },
        });

        const periodsData: Prisma.AccountingPeriodCreateManyInput[] = Array.from(
          { length: 12 },
          (_, i) => {
            const totalMonths = year * 12 + (startMonth - 1) + i;
            return {
              companyId,
              year: Math.floor(totalMonths / 12),
              month: (totalMonths % 12) + 1,
              status: "OPEN" as const,
              openedBy: userId,
              fiscalYearId: created.id,
            };
          },
        );

        await tx.accountingPeriod.createMany({ data: periodsData });

        const periods = await tx.accountingPeriod.findMany({
          where: { fiscalYearId: created.id },
          select: { id: true, year: true, month: true, status: true },
        });

        await tx.auditLog.create({
          data: {
            companyId,
            entityId: created.id,
            entityName: "FiscalYear",
            action: "OPEN",
            userId,
            ipAddress,
            userAgent,
            newValue: {
              year,
              startMonth,
              periodIds: periods.map((p) => p.id),
            },
          },
        });

        return { ...created, periods } as FiscalYearWithPeriods;
      })
    );
  }

  /** Índice cronológico (mes 0 = primer mes del ejercicio) — expuesto para closeFiscalYear (fix H-2). */
  static chronologicalKey = chronologicalKey;
}
