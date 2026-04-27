// src/modules/payroll/services/BenefitAdvanceService.ts
// Anticipo de Prestaciones Sociales — Art. 144 LOTTT Venezuela
//
// Reglas de negocio:
//   - Máximo 75% del saldo acumulado (garantía + intereses) al momento del anticipo
//   - Motivos tasados: HOUSING | HEALTH | EDUCATION
//   - Inmutable post-registro (append-only). Correcciones vía asiento inverso + AuditLog.
//   - Asiento contable obligatorio dentro del mismo $transaction (ADR-014 Dec. 7)
//   - AuditLog dentro del mismo $transaction (ADR-006 D-3)
//
// Security:
//   - companyId siempre verificado por el server guard de la action (ADMIN_ONLY)
//   - employeeId validado → pertenece a companyId antes de cualquier mutación
//   - amount nunca viene del cliente sin validación Zod + guard 75%

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import type { BenefitAdvanceReason } from "@prisma/client";

export interface BenefitAdvanceRow {
  id: string;
  employeeId: string;
  amount: string;
  reason: BenefitAdvanceReason;
  notes: string | null;
  transactionId: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface RegisterAdvanceInput {
  employeeId: string;
  amount: string; // string → Decimal en service
  reason: BenefitAdvanceReason;
  notes?: string | null;
}

const MAX_ADVANCE_RATIO = new Decimal("0.75"); // Art. 144 LOTTT

export const BenefitAdvanceService = {
  // ── listAdvances — lista de anticipos de un empleado ─────────────────────
  async listAdvances(companyId: string, employeeId: string): Promise<BenefitAdvanceRow[]> {
    const advances = await prisma.benefitAdvance.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: "desc" },
    });
    return advances.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      amount: a.amount.toString(),
      reason: a.reason,
      notes: a.notes,
      transactionId: a.transactionId,
      createdByUserId: a.createdByUserId,
      createdAt: a.createdAt.toISOString(),
    }));
  },

  // ── registerAdvance — registra anticipo con asiento + descuento de saldo ──
  async registerAdvance(
    companyId: string,
    userId: string,
    input: RegisterAdvanceInput
  ): Promise<BenefitAdvanceRow> {
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw new Error("El monto del anticipo debe ser mayor a cero");

    // Verificar que el empleado pertenece a la empresa
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, companyId },
    });
    if (!employee) throw new Error("Empleado no encontrado en esta empresa");
    if (employee.status !== "ACTIVE") throw new Error("Solo se pueden registrar anticipos para empleados activos");

    // Obtener saldo de prestaciones
    const balance = await prisma.benefitBalance.findUnique({
      where: { employeeId: input.employeeId },
    });
    if (!balance) throw new Error("El empleado no tiene saldo de prestaciones acumulado");
    if (balance.isLiquidated) throw new Error("Las prestaciones de este empleado ya fueron liquidadas");

    const totalBalance = new Decimal(balance.currentBalance.toString())
      .add(new Decimal(balance.interestBalance.toString()));
    const maxAllowed = totalBalance.mul(MAX_ADVANCE_RATIO);

    if (amount.gt(maxAllowed)) {
      throw new Error(
        `El anticipo (${amount.toFixed(2)}) supera el 75% del saldo disponible (${maxAllowed.toFixed(2)}). ` +
        `Saldo total: ${totalBalance.toFixed(2)}`
      );
    }

    // Config — necesita cuentas contables de prestaciones
    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config?.benefitsExpenseAccountId || !config?.benefitsPayableAccountId) {
      throw new Error("Configure las cuentas contables de prestaciones en la configuración de nómina");
    }

    // Período contable OPEN para el asiento
    const today = new Date();
    const period = await prisma.accountingPeriod.findFirst({
      where: { companyId, year: today.getFullYear(), month: today.getMonth() + 1, status: "OPEN" },
    });
    if (!period) {
      throw new Error(
        `No hay período contable abierto para ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}. ` +
        "Abra el período antes de registrar el anticipo."
      );
    }

    const REASON_LABELS: Record<BenefitAdvanceReason, string> = {
      HOUSING: "Vivienda",
      HEALTH: "Salud",
      EDUCATION: "Educación",
    };

    return prisma.$transaction(async (tx) => {
      // Asiento contable: Débito Prestaciones por Pagar / Crédito Banco (o Caja — simplificado)
      // Convención: Db Prestaciones Sociales por Pagar (reduce pasivo) / Cr Nómina por Pagar
      const transaction = await tx.transaction.create({
        data: {
          companyId,
          periodId: period.id,
          number: `NOM-D-ANT-${employee.id.slice(-6)}-${Date.now().toString().slice(-6)}`,
          date: today,
          description: `Anticipo prestaciones — ${employee.firstName} ${employee.lastName} (${REASON_LABELS[input.reason]})`,
          userId,
          type: "DIARIO",
          entries: {
            create: [
              {
                accountId: config.benefitsPayableAccountId!, // Db Prestaciones por Pagar (reduce pasivo)
                amount: new Decimal(amount).toDecimalPlaces(4),
                description: `Anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
              },
              {
                accountId: config.benefitsExpenseAccountId!, // Cr Gasto Prestaciones (contrapartida)
                amount: new Decimal(amount).negated().toDecimalPlaces(4),
                description: `Pago anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
              },
            ],
          },
        },
      });

      // Descontar del saldo corriente
      const newBalance = new Decimal(balance.currentBalance.toString()).sub(amount);
      if (newBalance.lt(0)) throw new Error("El anticipo excede el saldo de garantía acumulado");

      await tx.benefitBalance.update({
        where: { id: balance.id },
        data: { currentBalance: newBalance.toFixed(4) },
      });

      // Registro del anticipo
      const advance = await tx.benefitAdvance.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          benefitBalanceId: balance.id,
          amount: amount.toFixed(4),
          reason: input.reason,
          notes: input.notes ?? null,
          transactionId: transaction.id,
          createdByUserId: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "BenefitAdvance",
          entityId: advance.id,
          action: "REGISTER_BENEFIT_ADVANCE",
          userId,
          oldValue: { currentBalance: balance.currentBalance.toString() },
          newValue: {
            employeeId: input.employeeId,
            amount: amount.toFixed(4),
            reason: input.reason,
            newBalance: newBalance.toFixed(4),
          },
        },
      });

      return {
        id: advance.id,
        employeeId: advance.employeeId,
        amount: advance.amount.toString(),
        reason: advance.reason,
        notes: advance.notes,
        transactionId: advance.transactionId,
        createdByUserId: advance.createdByUserId,
        createdAt: advance.createdAt.toISOString(),
      };
    });
  },
};
