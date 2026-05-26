// src/modules/payments/services/PaymentGLService.ts
// ADR-030 — GL Auto-Posting de Pagos (Fase 38)
//
// Este servicio genera asientos contables automáticos al registrar/anular pagos.
// Es invocado INTERNAMENTE por PaymentService y PaymentBatchService dentro del
// mismo $transaction. No es una Server Action.
//
// R-5: TODOS los cálculos usan Decimal.js — NUNCA number nativo para montos.

import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type GLPostingContext = {
  companyId: string;
  date: Date;
  createdBy: string; // userId Clerk
  description: string; // "Cobro factura FAC-00042 — PagoMóvil"
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PaymentRecordGLInput = {
  paymentRecordId: string;
  bankAccountId: string; // BankAccount.id — verificado que pertenece a companyId
  amountVes: Decimal;
  igtfAmount: Decimal | null;
  // NIC 21 / VEN-NIF BA-5 — diferencial cambiario al cobro (Fix auditoría ADR-030)
  invoiceId?: string;        // para leer la tasa de la factura original
  amountOriginal?: Decimal;  // monto en divisa (USD/EUR)
  currency?: string;         // "USD" | "EUR" | "VES"
  // Riesgo-6 auditoría: IVA retenido por el cliente CE (Prov. 0049 75%/100%)
  // Dr. IVA Ret. x Cobrar = ivaRetentionAmount | Cr. CxC = amountVes + ivaRetentionAmount
  ivaRetentionAmount?: Decimal;
  context: GLPostingContext;
};

export type PaymentBatchGLInput = {
  paymentBatchId: string;
  bankAccountId: string;
  lines: Array<{
    invoiceId: string;
    amountVes: Decimal;
    igtfAmount: Decimal | null;
  }>;
  context: GLPostingContext;
};

// Tipo interno para datos enriquecidos de línea
type BatchLineEnriched = {
  invoiceId: string;
  amountVes: Decimal;
  igtfAmount: Decimal | null;
  invoiceNumber: string | null;   // Fix 4: descripción enriquecida en asiento
  counterpartName: string | null;
};

export type GLPostingResult = {
  transactionId: string;
  journalEntriesCount: number;
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Genera un número de asiento para el mes dado.
 * Patrón: YYYY-MM-NNNNNN — igual que TransactionService.generateTransactionNumber.
 * Debe ejecutarse dentro del mismo tx para garantizar consistencia.
 */
async function generateTxNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date,
): Promise<string> {
  const year = date.getFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `${year}-${month}-`;

  const last = await tx.transaction.findFirst({
    where: { companyId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  let sequence = 1;
  if (last) {
    const lastSeq = parseInt(last.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) sequence = lastSeq + 1;
  }

  return `${prefix}${String(sequence).padStart(6, "0")}`;
}

// ─── PaymentGLService ─────────────────────────────────────────────────────────

export class PaymentGLService {
  /**
   * Genera el asiento GL para un cobro (CxC → Banco).
   *
   * Asiento cobro:
   *   Dr. BankAccount.accountId    amountVes   [cobro en banco]
   *   Cr. settings.arAccountId     amountVes   [cancela CxC]
   *
   * Si igtfAmount > 0 y settings.igtfPayableAccountId configurado:
   *   Dr. BankAccount.accountId           igtfAmount  [IGTF en banco]
   *   Cr. settings.igtfPayableAccountId   igtfAmount  [IGTF por pagar]
   *
   * Si igtfAmount > 0 pero igtfPayableAccountId es null:
   *   → Asiento solo con las 2 líneas principales + AuditLog "IGTF_GL_SKIPPED".
   *
   * Precondiciones (verificadas por PaymentService antes de llamar):
   *   - bankAccountId pertenece a companyId
   *   - settings.arAccountId IS NOT NULL
   *   - El período activo no está CLOSED (verificado antes de llamar)
   */
  static async postPaymentRecordGL(
    tx: Prisma.TransactionClient,
    input: PaymentRecordGLInput,
    settings: {
      arAccountId: string;
      igtfPayableAccountId: string | null;
      fxGainAccountId: string | null; // NIC 21
      fxLossAccountId: string | null; // NIC 21
      ivaRetentionReceivableAccountId: string | null; // Riesgo-6: IVA retenido x cobrar
    },
  ): Promise<GLPostingResult> {
    const { companyId, date, createdBy, description, ipAddress, userAgent } =
      input.context;

    // Resolver cuenta GL del banco (accountId en BankAccount)
    const bankAcc = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId },
      select: { accountId: true },
    });
    if (!bankAcc) {
      throw new Error("La cuenta bancaria no pertenece a esta empresa");
    }

    // Resolver período activo (R-3: período CLOSED → no postear)
    const period = await tx.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      select: { id: true },
    });
    if (!period) {
      throw new Error(
        "No hay período contable abierto. Abre un período antes de registrar asientos.",
      );
    }

    const number = await generateTxNumber(tx, companyId, date);

    // Construir líneas de asiento (Débito = positivo, Crédito = negativo — convención R-1)
    const amountVes = new Decimal(input.amountVes.toString());
    const igtfAmount = input.igtfAmount
      ? new Decimal(input.igtfAmount.toString())
      : null;

    // Descripción enriquecida para asientos en divisa (Rec 2 auditoría ADR-030)
    let richDescription = description;
    if (input.currency && input.currency !== "VES" && input.amountOriginal) {
      const impliedRate = amountVes.dividedBy(input.amountOriginal).toDecimalPlaces(2);
      richDescription = `${description} | ${input.currency} ${input.amountOriginal.toFixed(2)} × Bs.${impliedRate} (BCV) = Bs.${amountVes.toFixed(2)}`;
      if (igtfAmount && igtfAmount.greaterThan(0)) {
        richDescription += ` | IGTF Bs.${igtfAmount.toFixed(2)}`;
      }
    }

    const entries: { accountId: string; amount: Decimal; description: string }[] =
      [];

    // ── IVA Retenido por Cobrar (Riesgo-6 / Prov. 0049) ─────────────────────
    // Si el cliente CE retiene el IVA (75%/100%), el cobro neto es menor al total.
    // Asiento: Dr. Banco (neto) + Dr. IVA Ret. x Cobrar = Cr. CxC (total factura).
    // Nota: cuando hay retención IVA saltamos diferencial cambiario (complejidad).
    const ivaRet = input.ivaRetentionAmount
      ? new Decimal(input.ivaRetentionAmount.toString())
      : new Decimal(0);
    const hasIvaRetention =
      ivaRet.greaterThan(0) &&
      !!settings.ivaRetentionReceivableAccountId;

    // ── Diferencial cambiario NIC 21 / VEN-NIF BA-5 ──────────────────────────
    // La CxC fue causada a la tasa del día de la factura.
    // Si la tasa cambió al cobrar, la CxC se extingue a la tasa original
    // y la diferencia se reconoce como Ganancia o Pérdida Cambiaria.
    // Saltamos diferencial si hay retención IVA (combinación compleja).
    let cxcCreditAmount = amountVes; // default: sin diferencial (VES o sin datos)
    let fxDiff = new Decimal(0);

    const fxApplies =
      !hasIvaRetention && // Riesgo-6: no mezclar retención IVA con FX diff
      input.currency &&
      input.currency !== "VES" &&
      input.amountOriginal &&
      input.invoiceId &&
      settings.fxGainAccountId &&
      settings.fxLossAccountId;

    if (fxApplies && input.invoiceId && input.amountOriginal) {
      const inv = await tx.invoice.findFirst({
        where: { id: input.invoiceId, companyId },
        select: { exchangeRate: { select: { rate: true } } },
      });
      if (inv?.exchangeRate) {
        const invoiceRate = new Decimal(inv.exchangeRate.rate.toString());
        const invoiceAmountVes = new Decimal(input.amountOriginal.toString()).times(invoiceRate);
        fxDiff = amountVes.minus(invoiceAmountVes);

        // Solo ajustar si la diferencia es significativa (> 0.01 Bs.)
        if (fxDiff.abs().greaterThan("0.01")) {
          cxcCreditAmount = invoiceAmountVes; // Cr. CxC a tasa de la factura
        } else {
          fxDiff = new Decimal(0); // diferencia insignificante — tratar como sin diferencial
        }
      }
    }

    // Si hay retención IVA, la CxC se cancela por el total (neto + retenido)
    if (hasIvaRetention) {
      cxcCreditAmount = amountVes.plus(ivaRet);
    }

    // Dr. Banco (monto neto recibido en VES)
    entries.push({
      accountId: bankAcc.accountId,
      amount: amountVes, // positivo = Débito
      description: richDescription,
    });

    // Dr. IVA Retenido por Cobrar (si aplica Riesgo-6)
    if (hasIvaRetention) {
      entries.push({
        accountId: settings.ivaRetentionReceivableAccountId!,
        amount: ivaRet, // Débito
        description: `${richDescription} — IVA retenido (Prov. 0049)`,
      });
    }

    // Cr. CxC (a la tasa de la factura original; si VES o sin datos → amountVes; si retención → total)
    entries.push({
      accountId: settings.arAccountId,
      amount: cxcCreditAmount.negated(), // negativo = Crédito
      description: richDescription,
    });

    // Diferencial cambiario (NIC 21) — solo si hay diff significativo y cuentas configuradas
    if (fxDiff.abs().greaterThan("0.01")) {
      if (fxDiff.greaterThan(0)) {
        // Ganancia cambiaria: VES cobrados > VES causados → Cr. Ganancia Cambiaria
        entries.push({
          accountId: settings.fxGainAccountId!,
          amount: fxDiff.negated(), // Crédito
          description: `${richDescription} — Ganancia cambiaria NIC 21`,
        });
      } else {
        // Pérdida cambiaria: VES cobrados < VES causados → Dr. Pérdida Cambiaria
        entries.push({
          accountId: settings.fxLossAccountId!,
          amount: fxDiff.abs(), // Débito
          description: `${richDescription} — Pérdida cambiaria NIC 21`,
        });
      }
    }

    let igtfSkipped = false;

    if (igtfAmount && igtfAmount.greaterThan(0)) {
      if (settings.igtfPayableAccountId) {
        // Dr. Banco (IGTF percibido del cliente — ya incluido en amountVes)
        entries.push({
          accountId: bankAcc.accountId,
          amount: igtfAmount,
          description: `${richDescription} — IGTF`,
        });
        // Cr. IGTF por pagar
        entries.push({
          accountId: settings.igtfPayableAccountId,
          amount: igtfAmount.negated(),
          description: `${richDescription} — IGTF`,
        });
      } else {
        igtfSkipped = true;
      }
    }

    // Crear Transaction + JournalEntries + actualizar PaymentRecord
    // Riesgo-9 (Art. 33 COT): tipo COBRO para identificación correcta en Libro Diario
    const txRecord = await tx.transaction.create({
      data: {
        number,
        companyId,
        userId: createdBy,
        description,
        date,
        type: "COBRO",
        status: "POSTED",
        periodId: period.id,
        entries: {
          create: entries.map((e) => ({
            accountId: e.accountId,
            amount: e.amount,
            description: e.description,
          })),
        },
      },
      select: { id: true },
    });

    // Actualizar PaymentRecord.glTransactionId
    await tx.paymentRecord.update({
      where: { id: input.paymentRecordId },
      data: { glTransactionId: txRecord.id },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        companyId,
        entityId: input.paymentRecordId,
        entityName: "PaymentRecord",
        action: "GL_POSTED",
        userId: createdBy,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        newValue: {
          transactionId: txRecord.id,
          journalEntriesCount: entries.length,
          ...(igtfSkipped ? { igtfGlSkipped: true } : {}),
        },
      },
    });

    if (igtfSkipped) {
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: input.paymentRecordId,
          entityName: "PaymentRecord",
          action: "IGTF_GL_SKIPPED",
          userId: createdBy,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          newValue: {
            igtfAmount: input.igtfAmount?.toString(),
            reason: "igtfPayableAccountId no configurado en CompanySettings",
          },
        },
      });
    }

    return { transactionId: txRecord.id, journalEntriesCount: entries.length };
  }

  /**
   * Genera el asiento GL para un pago A/P (Proveedores → Banco).
   * Llamado exclusivamente desde PaymentBatchService.applyBatch() dentro de $transaction Serializable.
   *
   * Por cada línea:
   *   Dr. settings.apAccountId    line.amountVes   [cancela CxP proveedor]
   *   Cr. BankAccount.accountId   line.amountVes   [salida del banco]
   *
   * Si line.igtfAmount > 0 y igtfPayableAccountId configurado:
   *   Dr. settings.igtfPayableAccountId  line.igtfAmount  [IGTF]
   *   Cr. BankAccount.accountId          line.igtfAmount  [salida adicional banco]
   *
   * Un batch = un solo Transaction con 2N o 4N JournalEntries.
   */
  static async postPaymentBatchGL(
    tx: Prisma.TransactionClient,
    input: PaymentBatchGLInput,
    settings: { apAccountId: string; igtfPayableAccountId: string | null },
  ): Promise<GLPostingResult> {
    const { companyId, date, createdBy, description, ipAddress, userAgent } =
      input.context;

    // Resolver cuenta GL del banco
    const bankAcc = await tx.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId },
      select: { accountId: true },
    });
    if (!bankAcc) {
      throw new Error("La cuenta bancaria no pertenece a esta empresa");
    }

    // Resolver período activo
    const period = await tx.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      select: { id: true },
    });
    if (!period) {
      throw new Error(
        "No hay período contable abierto. Abre un período antes de registrar asientos.",
      );
    }

    const number = await generateTxNumber(tx, companyId, date);

    // Fix 4 (auditoría ADR-030): enriquecer líneas con datos de la factura (proveedor + número)
    const invoiceDataMap = new Map<string, { invoiceNumber: string | null; counterpartName: string | null }>();
    const invoiceIds = input.lines.map((l) => l.invoiceId);
    const invoiceRows = await tx.invoice.findMany({
      where: { id: { in: invoiceIds }, companyId },
      select: { id: true, invoiceNumber: true, counterpartName: true },
    });
    for (const row of invoiceRows) {
      invoiceDataMap.set(row.id, { invoiceNumber: row.invoiceNumber, counterpartName: row.counterpartName });
    }

    const enrichedLines: BatchLineEnriched[] = input.lines.map((l) => ({
      ...l,
      invoiceNumber: invoiceDataMap.get(l.invoiceId)?.invoiceNumber ?? null,
      counterpartName: invoiceDataMap.get(l.invoiceId)?.counterpartName ?? null,
    }));

    // Construir todas las JournalEntries del batch (un asiento por batch, no por línea)
    const entries: { accountId: string; amount: Decimal; description: string }[] =
      [];
    let igtfSkipped = false;

    for (const line of enrichedLines) {
      const amountVes = new Decimal(line.amountVes.toString());
      const igtfAmount = line.igtfAmount
        ? new Decimal(line.igtfAmount.toString())
        : null;

      // Descripción enriquecida por línea: Proveedor — Factura Nro. (Art. 91 COT)
      const lineDesc = line.counterpartName && line.invoiceNumber
        ? `${description} | ${line.counterpartName} — ${line.invoiceNumber}`
        : line.counterpartName
          ? `${description} | ${line.counterpartName}`
          : description;

      // Dr. CxP (apAccountId)
      entries.push({
        accountId: settings.apAccountId,
        amount: amountVes, // positivo = Débito
        description: lineDesc,
      });
      // Cr. Banco
      entries.push({
        accountId: bankAcc.accountId,
        amount: amountVes.negated(), // negativo = Crédito
        description: lineDesc,
      });

      if (igtfAmount && igtfAmount.greaterThan(0)) {
        if (settings.igtfPayableAccountId) {
          // Dr. IGTF por pagar
          entries.push({
            accountId: settings.igtfPayableAccountId,
            amount: igtfAmount,
            description: `${lineDesc} — IGTF`,
          });
          // Cr. Banco (salida adicional)
          entries.push({
            accountId: bankAcc.accountId,
            amount: igtfAmount.negated(),
            description: `${lineDesc} — IGTF`,
          });
        } else {
          igtfSkipped = true;
        }
      }
    }

    // Crear Transaction + JournalEntries + actualizar PaymentBatch
    // Riesgo-9 (Art. 33 COT): tipo PAGO para identificación correcta en Libro Diario
    const txRecord = await tx.transaction.create({
      data: {
        number,
        companyId,
        userId: createdBy,
        description,
        date,
        type: "PAGO",
        status: "POSTED",
        periodId: period.id,
        entries: {
          create: entries.map((e) => ({
            accountId: e.accountId,
            amount: e.amount,
            description: e.description,
          })),
        },
      },
      select: { id: true },
    });

    // Actualizar PaymentBatch.glTransactionId
    await tx.paymentBatch.update({
      where: { id: input.paymentBatchId },
      data: { glTransactionId: txRecord.id },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        companyId,
        entityId: input.paymentBatchId,
        entityName: "PaymentBatch",
        action: "GL_POSTED",
        userId: createdBy,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        newValue: {
          transactionId: txRecord.id,
          journalEntriesCount: entries.length,
          lineCount: input.lines.length,
          ...(igtfSkipped ? { igtfGlSkipped: true } : {}),
        },
      },
    });

    if (igtfSkipped) {
      await tx.auditLog.create({
        data: {
          companyId,
          entityId: input.paymentBatchId,
          entityName: "PaymentBatch",
          action: "IGTF_GL_SKIPPED",
          userId: createdBy,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          newValue: {
            reason: "igtfPayableAccountId no configurado en CompanySettings",
          },
        },
      });
    }

    return { transactionId: txRecord.id, journalEntriesCount: entries.length };
  }

  /**
   * Genera el asiento de reverso GL al anular un PaymentRecord.
   * Solo actúa si PaymentRecord.glTransactionId IS NOT NULL.
   *
   * Proceso:
   *   1. Lee Transaction original con JournalEntries
   *   2. Crea Transaction de reverso con líneas invertidas (Db↔Cr)
   *   3. Marca Transaction original VOIDED (voidedById = reverso.id)
   *   4. AuditLog
   *
   * PaymentRecord.glTransactionId permanece apuntando al asiento original
   * (el historial queda trazable via Transaction.voidedById).
   */
  static async reversePaymentRecordGL(
    tx: Prisma.TransactionClient,
    paymentRecordId: string,
    companyId: string,
    voidedBy: string,
    context: GLPostingContext,
  ): Promise<void> {
    // Verificar que el PaymentRecord tiene un asiento GL
    const record = await tx.paymentRecord.findFirst({
      where: { id: paymentRecordId, companyId },
      select: { glTransactionId: true },
    });
    if (!record?.glTransactionId) return; // sin asiento GL → nada que revertir

    const originalTx = await tx.transaction.findFirst({
      where: { id: record.glTransactionId, companyId },
      include: { entries: true },
    });
    if (!originalTx || originalTx.status === "VOIDED") return;

    const period = await tx.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      select: { id: true },
    });
    if (!period) {
      throw new Error(
        "No hay período contable abierto para registrar el asiento de reverso.",
      );
    }

    const number = await generateTxNumber(tx, companyId, context.date);
    const reverseDesc = `Reverso — ${originalTx.description}`;

    // Crear asiento de reverso (cada línea invierte su signo)
    // Riesgo-9: preservar tipo COBRO del asiento original
    const reverseTx = await tx.transaction.create({
      data: {
        number,
        companyId,
        userId: voidedBy,
        description: reverseDesc,
        date: context.date,
        type: "COBRO",
        status: "POSTED",
        periodId: period.id,
        entries: {
          create: originalTx.entries.map((e) => ({
            accountId: e.accountId,
            amount: new Decimal(e.amount.toString()).negated(),
            description: reverseDesc,
          })),
        },
      },
      select: { id: true },
    });

    // Marcar original VOIDED
    await tx.transaction.update({
      where: { id: originalTx.id },
      data: { status: "VOIDED", voidedById: reverseTx.id },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        companyId,
        entityId: paymentRecordId,
        entityName: "PaymentRecord",
        action: "GL_REVERSED",
        userId: voidedBy,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        newValue: {
          originalTransactionId: originalTx.id,
          reverseTransactionId: reverseTx.id,
        },
      },
    });
  }

  /**
   * Genera el asiento de reverso GL al anular un PaymentBatch.
   * Simétrico a reversePaymentRecordGL.
   */
  static async reversePaymentBatchGL(
    tx: Prisma.TransactionClient,
    paymentBatchId: string,
    companyId: string,
    voidedBy: string,
    context: GLPostingContext,
  ): Promise<void> {
    const batch = await tx.paymentBatch.findFirst({
      where: { id: paymentBatchId, companyId },
      select: { glTransactionId: true },
    });
    if (!batch?.glTransactionId) return; // sin asiento GL → nada que revertir

    const originalTx = await tx.transaction.findFirst({
      where: { id: batch.glTransactionId, companyId },
      include: { entries: true },
    });
    if (!originalTx || originalTx.status === "VOIDED") return;

    const period = await tx.accountingPeriod.findFirst({
      where: { companyId, status: "OPEN" },
      select: { id: true },
    });
    if (!period) {
      throw new Error(
        "No hay período contable abierto para registrar el asiento de reverso.",
      );
    }

    const number = await generateTxNumber(tx, companyId, context.date);
    const reverseDesc = `Reverso — ${originalTx.description}`;

    // Riesgo-9: preservar tipo PAGO del asiento original
    const reverseTx = await tx.transaction.create({
      data: {
        number,
        companyId,
        userId: voidedBy,
        description: reverseDesc,
        date: context.date,
        type: "PAGO",
        status: "POSTED",
        periodId: period.id,
        entries: {
          create: originalTx.entries.map((e) => ({
            accountId: e.accountId,
            amount: new Decimal(e.amount.toString()).negated(),
            description: reverseDesc,
          })),
        },
      },
      select: { id: true },
    });

    await tx.transaction.update({
      where: { id: originalTx.id },
      data: { status: "VOIDED", voidedById: reverseTx.id },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: paymentBatchId,
        entityName: "PaymentBatch",
        action: "GL_REVERSED",
        userId: voidedBy,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        newValue: {
          originalTransactionId: originalTx.id,
          reverseTransactionId: reverseTx.id,
        },
      },
    });
  }
}
