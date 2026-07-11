// src/modules/bank-reconciliation/actions/auto-reconciliation.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { GeminiBankStatementService } from "../services/GeminiBankStatementService";
import { AutoReconciliationService } from "../services/AutoReconciliationService";
import { BankingService } from "../services/BankingService";
import { BankReconciliationService } from "../services/BankReconciliationService";
import { parseAmount } from "../services/CsvParserService";
import {
  ParseBankStatementSchema,
  RunAutoReconciliationSchema,
  ConfirmSuggestedSchema,
  type ExtractedBankStatement,
  type AutoReconciliationResult,
} from "../schemas/auto-reconciliation.schema";
import { Decimal } from "decimal.js";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parsea fechas en formato dd/mm/yyyy (Gemini) o ISO (fallback).
// Usa UTC para evitar desplazamientos de zona horaria al comparar períodos.
function parseStatementDate(dateStr: string): Date {
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateStr.trim());
  if (ddmmyyyy) {
    return new Date(
      Date.UTC(
        parseInt(ddmmyyyy[3]!, 10),
        parseInt(ddmmyyyy[2]!, 10) - 1,
        parseInt(ddmmyyyy[1]!, 10),
      ),
    );
  }
  return new Date(dateStr);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Analiza un PDF de extracto bancario con Gemini Vision.
 * Disponible para todos los roles (lectura/análisis, sin escritura en DB).
 * Rate limit: limiters.ocr (10/min).
 */
export async function parseBankStatementAction(
  input: unknown
): Promise<ActionResult<ExtractedBankStatement>> {
  try {
    const parsed = ParseBankStatementSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId, base64Pdf } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: "MEMBER_ANY",
      limiter: limiters.ocr,
    });
    if (!ctx.ok) return ctx.error;

    if (!process.env.GEMINI_API_KEY) {
      return { success: false, error: "El servicio de análisis de PDF no está configurado" };
    }

    const result = await GeminiBankStatementService.extractFromPdf(base64Pdf);

    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Ejecuta la auto-conciliación:
 * 1. Importa el extracto bancario (crea BankStatement + BankTransactions)
 * 2. Corre el motor de matching
 * 3. Aplica matches AUTO automáticamente
 * Requiere role ACCOUNTANT o ADMIN.
 */
export async function runAutoReconciliationAction(
  input: unknown
): Promise<ActionResult<AutoReconciliationResult>> {
  try {
    const parsed = RunAutoReconciliationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId, bankAccountId, rows, openingBalance, closingBalance } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;
    const { userId } = ctx;

    // Calcular el período a partir de las fechas de las filas
    const dates = rows.map((r) => parseStatementDate(r.date));
    const periodStart = new Date(Math.min(...dates.map((d) => d.getTime())));
    const periodEnd = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Guard: si no hay datos en el sistema para el período, devolver guard payload
    const periodHasData = await AutoReconciliationService.periodHasTransactions(
      companyId,
      periodStart,
      periodEnd
    );

    if (!periodHasData) {
      return {
        success: true,
        data: {
          auto: [],
          suggested: [],
          unmatched: [],
          periodHasData: false,
          totalRows: rows.length,
        },
      };
    }

    // Convertir filas a CsvRow para importStatement
    const csvRows = rows.map((r) => ({
      date: parseStatementDate(r.date),
      description: r.description,
      debit: r.debit ? (parseAmount(r.debit) ?? null) : null,
      credit: r.credit ? (parseAmount(r.credit) ?? null) : null,
      balance: r.balance ? (parseAmount(r.balance) ?? null) : null,
    }));

    // Importar el extracto
    const openingDec = new Decimal(openingBalance.replace(/\./g, "").replace(",", "."));
    const closingDec = new Decimal(closingBalance.replace(/\./g, "").replace(",", "."));

    const { statementId } = await BankingService.importStatement(
      bankAccountId,
      companyId,
      csvRows,
      openingDec,
      closingDec,
      userId
    );

    // Obtener los BankTransaction creados para hacer los matches AUTO
    const bankTransactions = await prisma.bankTransaction.findMany({
      where: { statementId, companyId },
      orderBy: { date: "asc" },
      select: { id: true, date: true, description: true, amount: true, type: true },
    });

    // Correr el motor de auto-conciliación
    const result = await AutoReconciliationService.run(
      companyId,
      rows,
      periodStart,
      periodEnd
    );

    // Aplicar matches AUTO automáticamente
    // Mapeamos resultados AUTO a BankTransactions por índice posicional
    const autoResults = result.auto.filter((r) => r.matchId && r.matchType);

    for (let i = 0; i < Math.min(autoResults.length, bankTransactions.length); i++) {
      const autoResult = autoResults[i];
      const bankTx = bankTransactions.find(
        (t) =>
          t.description === autoResult.description &&
          new Decimal(t.amount.toString()).toFixed(4) === autoResult.amount
      );

      if (!bankTx || !autoResult.matchId || !autoResult.matchType) continue;

      try {
        await BankReconciliationService.matchTransaction(
          bankTx.id,
          { type: autoResult.matchType, id: autoResult.matchId },
          companyId,
          userId
        );
      } catch {
        // Si un match falla, continuar con los demás
      }
    }

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Confirma matches sugeridos seleccionados por el usuario.
 * Requiere role ACCOUNTANT o ADMIN.
 */
export async function confirmSuggestedAction(
  input: unknown
): Promise<ActionResult<{ confirmed: number }>> {
  try {
    const parsed = ConfirmSuggestedSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    }

    const { companyId, confirmations } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;
    const { userId } = ctx;

    let confirmed = 0;
    for (const c of confirmations) {
      try {
        await BankReconciliationService.matchTransaction(
          c.bankTransactionId,
          { type: c.matchType, id: c.matchId },
          companyId,
          userId
        );
        confirmed++;
      } catch {
        // Si un match individual falla, continuar con los demás
      }
    }

    revalidatePath(`/company/${companyId}/bank-reconciliation`);

    return { success: true, data: { confirmed } };
  } catch (err) {
    return toActionError(err);
  }
}
