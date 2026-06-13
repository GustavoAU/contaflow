// src/modules/accounting/services/IncomeStatementService.ts
//
// Calcula el Estado de Resultados (Ganancias y Pérdidas) para un período dado.
// Este servicio se ocupa únicamente del cómputo: consulta BD + mapeo a tipos.
// La autenticación y autorización ocurren en report.actions.ts antes de llamar aquí.

import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import type { IncomeStatement, IncomeStatementRow } from "../types/report-types";
import { TX_STATUS } from "../constants";

// Construye el filtro de fecha para las queries de Prisma.
// Retorna undefined si no se pasó ninguna fecha (sin restricción temporal).
function buildDateFilter(dateFrom?: Date, dateTo?: Date) {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: dateFrom } : {}),
    ...(dateTo ? { lte: dateTo } : {}),
  };
}

// Consulta las cuentas de INGRESOS y GASTOS del período y construye el Estado de Resultados.
//
// Convención de signos (heredada del modelo contable):
//   - Ingresos: saldo crédito → valor negativo en BD → mostramos el absoluto
//   - Gastos:   saldo débito  → valor positivo en BD → mostramos el absoluto
//
// netIncome = totalRevenues - totalExpenses
//   positivo → utilidad del período
//   negativo → pérdida del período
export class IncomeStatementService {
  /**
   * Calcula el Estado de Resultados para el período indicado.
   * @param companyId - empresa propietaria (aislamiento multi-tenant, ADR-004)
   * @param dateFrom  - inicio del período; si se omite no hay límite inferior
   * @param dateTo    - fin del período; si se omite no hay límite superior
   * @returns Ingresos, gastos y utilidad/pérdida neta del período
   */
  static async compute(
    companyId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<IncomeStatement> {
    const dateFilter = buildDateFilter(dateFrom, dateTo);

    // N5: metadata + groupBy en paralelo — evita traer filas individuales de JournalEntry.
    const [accountMeta, sums] = await Promise.all([
      prisma.account.findMany({
        where: { companyId, type: { in: ["REVENUE", "EXPENSE"] } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, type: true },
      }),
      prisma.journalEntry.groupBy({
        by: ["accountId"],
        where: {
          account: { companyId, type: { in: ["REVENUE", "EXPENSE"] } },
          transaction: {
            status: TX_STATUS.POSTED,
            ...(dateFilter ? { date: dateFilter } : {}),
          },
        },
        _sum: { amount: true },
      }),
    ]);

    const sumMap = new Map(
      sums.map((s) => [s.accountId, new Decimal(s._sum.amount?.toString() ?? "0")])
    );

    let totalRevenues = new Decimal(0);
    let totalExpenses = new Decimal(0);
    const revenues: IncomeStatementRow[] = [];
    const expenses: IncomeStatementRow[] = [];

    for (const account of accountMeta) {
      const balance = sumMap.get(account.id) ?? new Decimal(0);
      // Ignorar cuentas sin movimientos en el período — no deben aparecer en el reporte
      if (balance.isZero()) continue;

      const row: IncomeStatementRow = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance: balance.abs().toFixed(2), // siempre positivo en pantalla
      };

      if (account.type === "REVENUE") {
        revenues.push(row);
        totalRevenues = totalRevenues.plus(balance.abs());
      } else {
        expenses.push(row);
        totalExpenses = totalExpenses.plus(balance.abs());
      }
    }

    return {
      revenues,
      expenses,
      totalRevenues: totalRevenues.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      netIncome: totalRevenues.minus(totalExpenses).toFixed(2),
    };
  }
}
