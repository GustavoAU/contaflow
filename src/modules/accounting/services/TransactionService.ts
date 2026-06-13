// src/modules/accounting/services/TransactionService.ts
import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { PrismaClient } from "@prisma/client";
import { CreateTransactionSchema, VoidTransactionSchema } from "../schemas/transaction.schema";
import type { CreateTransactionInput, VoidTransactionInput } from "../schemas/transaction.schema";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import { TX_STATUS, MAX_PAGE_SIZE } from "../constants";

// Cliente de Prisma dentro de $transaction — igual al patrón de PeriodSnapshotService.
type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// ─── Tipos de paginación ──────────────────────────────────────────────────────

// Full transaction row including journal entry lines — used by the paginated list UI.
export type TransactionWithEntries = {
  id: string;
  number: string;
  date: Date;
  description: string;
  status: string;
  type: string;
  entries: {
    id: string;
    accountId: string;
    amount: Decimal;
    account: { id: string; name: string; code: string } | null;
  }[];
};

// Header-only row without entry detail — used by the Libro Diario list (R-1 separation).
export type TransactionHeader = {
  id: string;
  number: string;
  date: Date;
  description: string;
  status: string;
  type: string;
  totalDebit: string; // computed server-side with Decimal.js (R-5)
};

export type TransactionPage = {
  data: TransactionWithEntries[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

// Parámetros para el listado paginado de transacciones.
// cursor y limit son opcionales para retrocompatibilidad.
export type TransactionListParams = {
  companyId: string;
  periodId?: string;   // filtro opcional por período contable
  cursor?: string;     // id del último registro visto (cursor opaco)
  limit?: number;      // default MAX_PAGE_SIZE
};

export class TransactionService {
  /**
   * Genera el numero correlativo automatico para un asiento.
   * Formato: YYYY-MM-XXXXXX (ej: 2026-03-000001)
   * Es unico por empresa y por mes.
   */
  static async generateTransactionNumber(companyId: string, date: Date, tx: PrismaTransactionClient): Promise<string> {
    // Usar siempre componentes UTC — las fechas se almacenan como UTC midnight en Prisma/PostgreSQL.
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const prefix = `${year}-${month}-`;

    // Buscar el ultimo numero del mes para esta empresa (debe correr dentro del $transaction Serializable)
    const last = await tx.transaction.findFirst({
      where: {
        companyId,
        number: { startsWith: prefix },
      },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    let sequence = 1;
    if (last) {
      // Extraer el numero secuencial del ultimo asiento
      const lastSequence = parseInt(last.number.replace(prefix, ""), 10);
      sequence = lastSequence + 1;
    }

    return `${prefix}${String(sequence).padStart(6, "0")}`;
  }

  /**
   * Crea un asiento contable validando la regla de partida doble.
   *
   * Convención de signos de JournalEntry.amount:
   *   Débito  → amount positivo  (aumenta Activo/Gasto, disminuye Pasivo/Patrimonio/Ingreso)
   *   Crédito → amount negativo  (aumenta Pasivo/Patrimonio/Ingreso, disminuye Activo/Gasto)
   *
   * Esta convención es usada de forma consistente en todo el módulo: getLedgerAction,
   * getTrialBalanceAction, BalanceSheetService y IncomeStatementService esperan este signo
   * para calcular saldos correctamente.
   */
  static async createBalancedTransaction(
    input: CreateTransactionInput,
    ipAddress?: string | null,
    userAgent?: string | null,
  ) {
    // 1. Validar con Zod — verifica partida doble: Σdébitos = Σcréditos
    const validated = CreateTransactionSchema.parse(input);

    // 2. Mapear debit/credit del formulario → amount con convención de signos
    //    debit > 0 → amount positivo | credit > 0 → amount negativo (negated)
    const entries = validated.entries.map((entry) => ({
      accountId: entry.accountId,
      description: entry.description || undefined,
      amount:
        entry.debit && Number(entry.debit) > 0
          ? new Decimal(entry.debit)
          : new Decimal(entry.credit || "0").negated(),
    }));

    // N4: invariante de partida doble — lanza si Σ(amount) ≠ 0
    assertBalancedGLEntries(entries);

    // 3. Validar que todas las cuentas existen y pertenecen a la empresa
    const accountIds = entries.map((e) => e.accountId);
    const accounts = await prisma.account.findMany({
      where: {
        id: { in: accountIds },
        companyId: validated.companyId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (accounts.length !== accountIds.length) {
      const foundIds = accounts.map((a) => a.id);
      const missing = accountIds.filter((id) => !foundIds.includes(id));
      throw new Error(
        "Cuentas no encontradas o no pertenecen a esta empresa: " + missing.join(", ")
      );
    }

    // 4. Verificar que el ejercicio económico no esté cerrado (Fase 15)
    // Usar UTC para ser consistente con generateTransactionNumber y el almacenamiento en BD.
    const txDate = validated.date ?? new Date();
    const txYear = txDate.getUTCFullYear();
    const isClosed = await FiscalYearCloseService.isFiscalYearClosed(validated.companyId, txYear);
    if (isClosed) {
      throw new Error(
        `El ejercicio económico ${txYear} está cerrado. No se pueden registrar asientos en ejercicios cerrados.`
      );
    }

    // 5. Verificar que hay un período abierto y que la fecha del asiento cae en él.
    // Sin esta validación sería posible registrar un asiento backdateado a un período
    // cerrado mientras otro período está abierto, violando el Art. 36 del Código de Comercio.
    const activePeriod = await prisma.accountingPeriod.findFirst({
      where: { companyId: validated.companyId, status: "OPEN" },
    });

    if (!activePeriod) {
      throw new Error(
        "No hay período contable abierto. Abre un período en Configuración antes de registrar asientos."
      );
    }

    const txMonth = txDate.getUTCMonth() + 1;
    if (txYear !== activePeriod.year || txMonth !== activePeriod.month) {
      throw new Error(
        `La fecha del asiento (${txYear}-${String(txMonth).padStart(2, "0")}) no corresponde ` +
        `al período abierto (${activePeriod.year}-${String(activePeriod.month).padStart(2, "0")}). ` +
        `Abre el período correcto antes de registrar.`
      );
    }

    // 6. Generar numero correlativo y crear transaccion + AuditLog de forma atómica.
    // Serializable garantiza que ningún otro worker puede leer/escribir el mismo prefijo
    // entre el findFirst y el create — elimina la race condition de correlativo duplicado (Z-1).
    const date = validated.date ?? new Date();
    const transaction = await prisma.$transaction(async (tx) => {
      const number = await TransactionService.generateTransactionNumber(validated.companyId, date, tx);
      const created = await tx.transaction.create({
        data: {
          number,
          companyId: validated.companyId,
          userId: validated.userId,
          description: validated.description,
          reference: validated.reference,
          notes: validated.notes,
          date,
          type: validated.type,
          periodId: activePeriod.id,
          entries: {
            create: entries,
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: validated.companyId,
          entityId: created.id,
          entityName: "Transaction",
          action: "CREATE",
          userId: validated.userId,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          newValue: created as object,
        },
      });

      return created;
    }, { isolationLevel: "Serializable" });

    return transaction;
  }

  /**
   * Anula un asiento contabilizado creando un asiento espejo con montos invertidos.
   * El asiento original queda con status VOIDED — nunca se borra.
   * companyId es obligatorio para garantizar aislamiento multi-tenant (ADR-004).
   */
  static async voidTransaction(
    input: VoidTransactionInput,
    companyId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    // 1. Validar con Zod
    const validated = VoidTransactionSchema.parse(input);

    // 2. Buscar la transaccion original — companyId obligatorio para evitar cross-tenant (ADR-004)
    const original = await prisma.transaction.findFirst({
      where: { id: validated.transactionId, companyId },
      include: { entries: true },
    });

    if (!original) {
      throw new Error("Transaccion no encontrada: " + validated.transactionId);
    }

    // 3. Verificar que no este ya anulada
    if (original.status === TX_STATUS.VOIDED) {
      throw new Error("Esta transaccion ya fue anulada anteriormente");
    }

    // 3b. Hard-lock: no se puede anular en un período cerrado (R-3)
    // Usa el FK periodId del asiento — no heurística de fecha, que falla cuando
    // el período asignado no coincide con el mes calendario de la transacción.
    if (!original.periodId) {
      throw new Error(
        "El asiento no tiene período contable asignado y no puede ser anulado."
      );
    }
    const originalPeriod = await prisma.accountingPeriod.findUnique({
      where: { id: original.periodId },
      select: { status: true, year: true, month: true },
    });
    if (originalPeriod?.status === "CLOSED") {
      throw new Error(
        `No se puede anular un asiento en un período cerrado (${originalPeriod.year}-${String(originalPeriod.month).padStart(2, "0")})`
      );
    }

    // 3c. Hard-lock: no se puede anular si el año fiscal ya fue cerrado (MEDIUM)
    const voidYear = new Date().getFullYear();
    const isFYClosed = await FiscalYearCloseService.isFiscalYearClosed(original.companyId, voidYear);
    if (isFYClosed) {
      throw new Error(
        `No se puede registrar el asiento de anulación: el año fiscal ${voidYear} ya fue cerrado.`
      );
    }

    // 4. Verificar que hay un período abierto para registrar el asiento de anulación
    const activePeriodForVoid = await prisma.accountingPeriod.findFirst({
      where: { companyId: original.companyId, status: "OPEN" },
    });
    if (!activePeriodForVoid) {
      throw new Error(
        "No hay período contable abierto. No se puede registrar el asiento de anulación."
      );
    }

    // 5. Crear asiento de contrapartida y marcar original como VOIDED.
    // Serializable garantiza que el correlativo de anulación no genera duplicado (Z-1).
    const voidDate = new Date();
    const voidTransaction = await prisma.$transaction(async (tx) => {
      const voidNumber = await TransactionService.generateTransactionNumber(
        original.companyId,
        voidDate,
        tx,
      );
      // Crear asiento espejo con montos invertidos
      const voidTx = await tx.transaction.create({
        data: {
          number: voidNumber,
          companyId: original.companyId,
          userId: validated.userId,
          description: "ANULACION: " + original.description + " — " + validated.reason,
          reference: original.reference ?? undefined,
          date: voidDate,
          type: original.type,
          status: TX_STATUS.POSTED,
          periodId: activePeriodForVoid.id,
          entries: {
            create: original.entries.map((entry) => ({
              accountId: entry.accountId,
              amount: new Decimal(entry.amount.toString()).negated(),
              description: entry.description
                ? `ANULACIÓN: ${entry.description}`
                : undefined,
            })),
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      });

      // Marcar original como VOIDED y vincular con el asiento de anulacion
      await tx.transaction.update({
        where: { id: original.id },
        data: {
          status: TX_STATUS.VOIDED,
          voidedById: voidTx.id,
        },
      });

      // 6. AuditLog dentro del mismo $transaction (R-6: IP/UA obligatorio)
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: original.id,
          entityName: "Transaction",
          action: "VOID",
          userId: validated.userId,
          ipAddress,
          userAgent,
          oldValue: original as object,
          newValue: voidTx as object,
        },
      });

      return voidTx;
    }, { isolationLevel: "Serializable" });

    return voidTransaction;
  }

  /**
   * Retorna una vista de Libro Diario: cabeceras de asientos + total débito.
   * NO incluye el detalle de líneas (JournalEntry) — eso es Libro Mayor (R-1).
   * El totalDebit se calcula server-side con Decimal.js (R-5).
   */
  static async getTransactionsByCompany(companyId: string): Promise<TransactionHeader[]> {
    const rows = await prisma.transaction.findMany({
      where: { companyId },
      orderBy: { date: "desc" },
      include: {
        entries: { select: { amount: true } },
      },
    });

    return rows.map((tx) => ({
      id: tx.id,
      number: tx.number,
      date: tx.date,
      description: tx.description,
      status: tx.status,
      type: tx.type,
      totalDebit: tx.entries
        .reduce((sum, e) => {
          const amt = new Decimal(e.amount.toString());
          return amt.greaterThan(0) ? sum.plus(amt) : sum;
        }, new Decimal(0))
        .toFixed(2),
    }));
  }

  /**
   * Retorna una página de transacciones usando cursor-based pagination.
   * @param companyId - empresa propietaria de los asientos (ADR-004)
   * @param cursor    - id del último elemento de la página anterior (opcional)
   * @param limit     - cantidad de registros por página (default/max: MAX_PAGE_SIZE)
   * @param periodId  - filtro opcional por período contable
   */
  static async getTransactionsPaginated(
    companyId: string,
    cursor?: string,
    limit: number = MAX_PAGE_SIZE,
    periodId?: string
  ): Promise<TransactionPage> {
    const safeLimit = Math.min(limit, MAX_PAGE_SIZE);

    const where = {
      companyId,
      ...(periodId ? { periodId } : {}),
    };

    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: safeLimit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        number: true,
        date: true,
        description: true,
        status: true,
        type: true,
        entries: {
          select: {
            id: true,
            accountId: true,
            amount: true,
            account: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    const hasNextPage = rows.length > safeLimit;
    const data = hasNextPage ? rows.slice(0, safeLimit) : rows;
    const nextCursor = hasNextPage ? data[data.length - 1].id : null;

    return {
      data: data as TransactionWithEntries[],
      nextCursor,
      hasNextPage,
    };
  }

  /**
   * Overload que acepta TransactionListParams como objeto.
   * Permite pasar periodId sin romper la firma posicional existente.
   */
  static async listTransactions(params: TransactionListParams): Promise<TransactionPage> {
    return TransactionService.getTransactionsPaginated(
      params.companyId,
      params.cursor,
      params.limit ?? MAX_PAGE_SIZE,
      params.periodId
    );
  }
}
