// src/modules/accounting/actions/report.actions.ts
"use server";

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Decimal } from "decimal.js";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters, fiscalKey } from "@/lib/ratelimit";
import { IncomeStatementService } from "../services/IncomeStatementService";
import { BalanceSheetService } from "../services/BalanceSheetService";
import { TX_STATUS } from "../constants";
import type {
  JournalTransaction,
  LedgerAccount,
  TrialBalanceRow,
  IncomeStatementResult,
  BalanceSheet,
} from "../types/report-types";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// Re-exportamos todos los tipos desde los archivos centralizados para que
// los importadores existentes (páginas, componentes, PDF service) no necesiten
// cambiar su ruta de importación si ya apuntan a este archivo.
export type {
  JournalLine,
  JournalTransaction,
  LedgerEntry,
  LedgerAccount,
  TrialBalanceRow,
  IncomeStatementRow,
  IncomeStatement,
  IncomeStatementResult,
  BalanceSheetRow,
  BalanceSheet,
} from "../types/report-types";

// ─── Utilidades locales ───────────────────────────────────────────────────────

// Construye el filtro de rango de fechas para queries Prisma.
// Retorna {} si ninguna fecha está definida, lo que Prisma interpreta como sin filtro.
function dateRange(dateFrom?: Date, dateTo?: Date) {
  if (!dateFrom && !dateTo) return {};
  return {
    date: {
      ...(dateFrom && { gte: dateFrom }),
      ...(dateTo && { lte: dateTo }),
    },
  };
}

// Valida que el rango de fechas sea coherente (from ≤ to) y que los objetos Date sean válidos.
// Retorna un mensaje de error si el rango es inválido, null si es válido.
// R-01: captura objetos Invalid Date creados por new Date("abc") antes de llegar a Prisma,
// evitando que el ORM exponga detalles internos de la query al cliente.
function validateDateRange(dateFrom?: Date, dateTo?: Date): string | null {
  if (dateFrom && isNaN(dateFrom.getTime())) return "Formato de fecha inválido";
  if (dateTo && isNaN(dateTo.getTime())) return "Formato de fecha inválido";
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return "La fecha de inicio debe ser anterior o igual a la fecha de fin";
  }
  return null;
}

// ─── Guard de acceso al módulo de Contabilidad ────────────────────────────────

// Verifica autenticación, rate limit y rol antes de ejecutar cualquier acción.
// Retorna { userId } si el acceso está permitido, o { success: false, error } si no.
async function guardAccounting(
  companyId: string,
): Promise<{ userId: string } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // Lectura de reportes (Diario/Mayor/Balance/etc.) — limiter de lecturas (120/min por
    // empresa×usuario), no el de mutaciones fiscales (10/min). Evita bloquear navegación intensa.
    const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.read);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ACCOUNTING))
      return { success: false, error: "Acceso denegado" };

    return { userId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error de conexión" };
  }
}

// MEDIUM-01 (auditoría Reportes): topes para acotar el volumen de filas que cada
// reporte puede traer a memoria en un solo request. En navegación normal los reportes
// ya están acotados por el filtro de fecha (año fiscal corriente por defecto), así que
// estos topes solo se disparan con rangos manuales patológicos (varios años).
//   - JOURNAL_TX_CAP: el Libro Diario pagina por transacción → se trunca y se avisa
//     (hasMore) sin corromper nada (cada asiento es una unidad completa).
//   - LEDGER_ENTRY_CAP: el Libro Mayor necesita TODAS las filas para el saldo rodante,
//     truncar lo corrompería → se cuenta primero y se rechaza el rango si excede.
const JOURNAL_TX_CAP = 5000;
const LEDGER_ENTRY_CAP = 5000;

// ─── Libro Diario ─────────────────────────────────────────────────────────────

// Retorna las transacciones POSTED del período como entradas de Libro Diario.
// Cada transacción incluye sus líneas de asiento (débitos y créditos).
// `hasMore` indica que el resultado fue truncado al tope JOURNAL_TX_CAP.
export async function getJournalAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
  search?: string,
): Promise<ActionResult<{ transactions: JournalTransaction[]; hasMore: boolean }>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const dateError = validateDateRange(dateFrom, dateTo);
  if (dateError) return { success: false, error: dateError };

  const searchTerm = search?.trim();

  try {
    // take: CAP + 1 para detectar si hay más filas de las que mostramos.
    const fetched = await prisma.transaction.findMany({
      where: {
        companyId,
        status: TX_STATUS.POSTED,
        ...dateRange(dateFrom, dateTo),
        ...(searchTerm
          ? {
              OR: [
                { description: { contains: searchTerm, mode: "insensitive" } },
                { number: { contains: searchTerm, mode: "insensitive" } },
                { reference: { contains: searchTerm, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
      take: JOURNAL_TX_CAP + 1,
      include: {
        entries: {
          include: {
            account: { select: { code: true, name: true } },
          },
          orderBy: { amount: "desc" }, // débitos primero (positivos), créditos después
        },
      },
    });

    const hasMore = fetched.length > JOURNAL_TX_CAP;
    const transactions = hasMore ? fetched.slice(0, JOURNAL_TX_CAP) : fetched;

    const journalTransactions = transactions.map((tx) => {
      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);

      const lines = tx.entries.map((entry) => {
        const amount = new Decimal(entry.amount.toString());

        if (amount.greaterThan(0)) {
          totalDebit = totalDebit.plus(amount);
          return {
            accountCode: entry.account?.code ?? "—",
            accountName: entry.account?.name ?? "—",
            debit: amount.toFixed(2),
            credit: "",
          };
        } else {
          totalCredit = totalCredit.plus(amount.abs());
          return {
            accountCode: entry.account?.code ?? "—",
            accountName: entry.account?.name ?? "—",
            debit: "",
            credit: amount.abs().toFixed(2),
          };
        }
      });

      return {
        id: tx.id,
        number: tx.number,
        date: tx.date,
        description: tx.description,
        reference: tx.reference,
        type: tx.type,
        lines,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
      };
    });

    return { success: true, data: { transactions: journalTransactions, hasMore } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Libro Mayor ──────────────────────────────────────────────────────────────

// Retorna el Mayor de todas las cuentas con movimientos en el período.
// Cada cuenta incluye su saldo anterior (openingBalance), sus movimientos
// y el saldo rodante acumulado después de cada movimiento.
//
// INVARIANTE de reportes contables: los reportes (Mayor, Balance de Comprobación,
// Balance General, Estado de Resultados) INCLUYEN toda cuenta con movimientos POSTED
// sin importar `account.deletedAt`. La historia POSTED es permanente (ADR-005, Código
// de Comercio Art. 32-35): un asiento nunca se borra, solo se anula (VOID). Si un
// reporte ocultara una cuenta soft-deleted con movimientos, sus débitos/créditos
// desaparecerían del agregado y los libros dejarían de reconciliar (Σdébitos ≠ Σcréditos
// en el Balance de Comprobación). El filtro `deletedAt: null` es exclusivo de las vistas
// de gestión del Plan de Cuentas (selector de cuentas activas), NUNCA de los reportes.
export async function getLedgerAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<ActionResult<LedgerAccount[]>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const dateError = validateDateRange(dateFrom, dateTo);
  if (dateError) return { success: false, error: dateError };

  try {
    // MEDIUM-01: el Mayor necesita TODAS las filas del rango para el saldo rodante; un
    // take las truncaría y dejaría saldos incorrectos. Por eso contamos primero (query
    // barata) y rechazamos el rango si excede el tope, en lugar de truncar silenciosamente.
    // Sin filtro `deletedAt`: el conteo debe cubrir exactamente las mismas filas que la
    // query principal de movimientos (que filtra solo por companyId), si no el tope sería
    // inconsistente con lo que realmente se carga después.
    const entryCount = await prisma.journalEntry.count({
      where: {
        account: { companyId },
        transaction: { status: TX_STATUS.POSTED, ...dateRange(dateFrom, dateTo) },
      },
    });
    if (entryCount > LEDGER_ENTRY_CAP) {
      return {
        success: false,
        error: `El rango seleccionado tiene ${entryCount} movimientos (máximo ${LEDGER_ENTRY_CAP}). Afine el rango de fechas para ver el Libro Mayor.`,
      };
    }

    // Calcular el saldo acumulado antes de dateFrom para cada cuenta (saldo anterior).
    // Se hace con un groupBy para traer un solo agregado por cuenta en lugar de
    // traer todas las entradas previas individualmente.
    // Sin filtro `deletedAt`: una cuenta soft-deleted con historia previa debe aportar su
    // saldo anterior real; excluirla aquí dejaría su openingBalance en 0 mientras la query
    // principal sí mostraría sus movimientos del período → saldo rodante corrupto.
    const openingBalanceMap = new Map<string, Decimal>();
    if (dateFrom) {
      const priorEntries = await prisma.journalEntry.groupBy({
        by: ["accountId"],
        where: {
          account: { companyId },
          transaction: { status: TX_STATUS.POSTED, date: { lt: dateFrom } },
        },
        _sum: { amount: true },
      });
      for (const row of priorEntries) {
        openingBalanceMap.set(
          row.accountId,
          new Decimal(row._sum.amount?.toString() ?? "0"),
        );
      }
    }

    const accounts = await prisma.account.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
      include: {
        journalEntries: {
          include: {
            transaction: true,
          },
          where: {
            transaction: {
              status: TX_STATUS.POSTED,
              ...dateRange(dateFrom, dateTo),
            },
          },
          // Error 5 SENIAT-dictamen: desempate por número de transacción dentro del mismo día
          // para que el saldo rodante no muestre valores intermedios negativos ilógicos.
          // Los formatos "T-2026-NNN" y "YYYY-MM-NNNNNN" son lexicográficamente ordenables.
          orderBy: [
            { transaction: { date: "asc" } },
            { transaction: { number: "asc" } },
          ],
        },
      },
    });

    const ledgerAccounts = accounts
      .filter((account) => account.journalEntries.length > 0)
      .map((account) => {
        const openingBalance = openingBalanceMap.get(account.id) ?? new Decimal(0);
        let runningBalance = openingBalance;
        let totalDebit = new Decimal(0);
        let totalCredit = new Decimal(0);

        const entries = account.journalEntries.map((entry) => {
          const amount = new Decimal(entry.amount.toString());

          if (amount.greaterThan(0)) {
            totalDebit = totalDebit.plus(amount);
          } else {
            totalCredit = totalCredit.plus(amount.abs());
          }

          runningBalance = runningBalance.plus(amount);

          return {
            date: entry.transaction.date,
            number: entry.transaction.number,
            description: entry.description ?? entry.transaction.description,
            debit: amount.greaterThan(0) ? amount.toFixed(2) : "",
            credit: amount.lessThan(0) ? amount.abs().toFixed(2) : "",
            balance: runningBalance.toFixed(2),
            transactionId: entry.transactionId,
          };
        });

        return {
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          entries,
          totalDebit: totalDebit.toFixed(2),
          totalCredit: totalCredit.toFixed(2),
          balance: runningBalance.toFixed(2),
          openingBalance: openingBalance.toFixed(2),
        };
      });

    return { success: true, data: ledgerAccounts };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Balance de Comprobación ──────────────────────────────────────────────────

// Retorna las sumas y saldos de todas las cuentas con movimientos en el período.
// Es la base para verificar que los débitos totales = créditos totales.
export async function getTrialBalanceAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
): Promise<ActionResult<TrialBalanceRow[]>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const dateError = validateDateRange(dateFrom, dateTo);
  if (dateError) return { success: false, error: dateError };

  try {
    // N5/MEDIUM-01: pre-agregado a nivel de BD — evita cargar filas individuales de
    // JournalEntry en memoria (acotado por nº de cuentas, no por volumen de asientos).
    // El Balance de Comprobación necesita débitos y créditos BRUTOS por cuenta, así que
    // se hacen dos groupBy (amount>0 y amount<0); un solo groupBy daría únicamente el neto.
    const txFilter = { status: TX_STATUS.POSTED, ...dateRange(dateFrom, dateTo) };
    const [accountMeta, debitSums, creditSums] = await Promise.all([
      prisma.account.findMany({
        where: { companyId },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, type: true },
      }),
      prisma.journalEntry.groupBy({
        by: ["accountId"],
        where: { account: { companyId }, transaction: txFilter, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      prisma.journalEntry.groupBy({
        by: ["accountId"],
        where: { account: { companyId }, transaction: txFilter, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
    ]);

    const debitMap = new Map(
      debitSums.map((s) => [s.accountId, new Decimal(s._sum.amount?.toString() ?? "0")]),
    );
    const creditMap = new Map(
      creditSums.map((s) => [s.accountId, new Decimal(s._sum.amount?.toString() ?? "0")]),
    );

    const rows = accountMeta
      .map((account) => ({
        account,
        totalDebit: debitMap.get(account.id) ?? new Decimal(0),
        // créditos vienen negativos del groupBy (amount<0) → abs para mostrar positivo
        totalCredit: (creditMap.get(account.id) ?? new Decimal(0)).abs(),
      }))
      // Solo cuentas con movimientos en el período (débito o crédito distinto de cero)
      .filter(({ totalDebit, totalCredit }) => !totalDebit.isZero() || !totalCredit.isZero())
      .map(({ account, totalDebit, totalCredit }) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        balance: totalDebit.minus(totalCredit).toFixed(2),
      }));

    return { success: true, data: rows };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Estado de Resultados ─────────────────────────────────────────────────────

// Retorna el Estado de Resultados del período actual y, opcionalmente, de un período
// de comparación (para análisis horizontal período vs. período).
// El cómputo está delegado a IncomeStatementService para mantener esta capa delgada.
export async function getIncomeStatementAction(
  companyId: string,
  dateFrom?: Date,
  dateTo?: Date,
  compareDateFrom?: Date,
  compareDateTo?: Date,
): Promise<ActionResult<IncomeStatementResult>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  // R-01: validar ambos rangos antes de pasar a los servicios
  const dateError =
    validateDateRange(dateFrom, dateTo) ?? validateDateRange(compareDateFrom, compareDateTo);
  if (dateError) return { success: false, error: dateError };

  try {
    const hasComparePeriod = !!(compareDateFrom || compareDateTo);

    // Sin fechas → defaultea al año fiscal corriente para coincidir con Balance General (hallazgo #3)
    let resolvedFrom = dateFrom;
    let resolvedTo = dateTo;
    if (!dateFrom && !dateTo) {
      const now = new Date();
      resolvedFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      resolvedTo = now;
    }

    const [current, compare] = await Promise.all([
      IncomeStatementService.compute(companyId, resolvedFrom, resolvedTo),
      hasComparePeriod
        ? IncomeStatementService.compute(companyId, compareDateFrom, compareDateTo)
        : Promise.resolve(undefined),
    ]);

    return { success: true, data: { current, compare } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Balance General ──────────────────────────────────────────────────────────

// Retorna el Balance General (Estado de Situación Financiera) a la fecha de corte.
// El cómputo está delegado a BalanceSheetService para mantener esta capa delgada.
export async function getBalanceSheetAction(
  companyId: string,
  dateTo?: Date,
): Promise<ActionResult<BalanceSheet>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  const dateError = validateDateRange(undefined, dateTo);
  if (dateError) return { success: false, error: dateError };

  try {
    const resolvedTo = dateTo ?? new Date();
    // "Resultado del Ejercicio" acotado al año fiscal del corte — alinea con Income Statement (hallazgo #3)
    const incomeDateFrom = new Date(Date.UTC(resolvedTo.getUTCFullYear(), 0, 1));
    const data = await BalanceSheetService.compute(companyId, resolvedTo, incomeDateFrom);
    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Datos de encabezado de empresa ──────────────────────────────────────────

// Retorna el nombre y RIF de la empresa para incluirlos en los encabezados de reporte.
export async function getCompanyHeaderAction(
  companyId: string,
): Promise<ActionResult<{ name: string; rif: string | null }>> {
  const guard = await guardAccounting(companyId);
  if ("error" in guard) return guard;

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, rif: true },
    });
    if (!company) return { success: false, error: "Empresa no encontrada" };
    return { success: true, data: { name: company.name, rif: company.rif } };
  } catch (error) {
    return toActionError(error);
  }
}
