// src/modules/payroll/services/BenefitAdvanceService.ts
// Anticipo de Prestaciones Sociales — Art. 144 LOTTT Venezuela
//
// Reglas de negocio:
//   - Máximo 75% del saldo acumulado (garantía + intereses) al momento del anticipo
//   - Motivos tasados: HOUSING | HEALTH | EDUCATION
//   - F-04: flujo PENDING → APPROVED (GL + descuento) | REJECTED
//   - requestAdvance()  → crea PENDING, sin GL ni descuento de saldo
//   - approveAdvance()  → PENDING → APPROVED, crea GL + descuenta saldo
//   - rejectAdvance()   → PENDING → REJECTED, sin impacto contable
//   - registerAdvance() → path directo APPROVED (admin — backward compat)
//   - Asiento contable solo en APPROVED dentro del mismo $transaction (ADR-014 Dec. 7)
//   - AuditLog dentro del mismo $transaction (ADR-006 D-3)
//
// Security:
//   - companyId siempre verificado por el server guard de la action (ADMIN_ONLY)
//   - employeeId validado → pertenece a companyId antes de cualquier mutación
//   - amount nunca viene del cliente sin validación Zod + guard 75%

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { assertBalancedGLEntries } from "@/lib/gl-assertions";
import type { BenefitAdvanceReason, BenefitAdvanceStatus } from "@prisma/client";

export interface BenefitAdvanceRow {
  id: string;
  employeeId: string;
  amount: string;
  reason: BenefitAdvanceReason;
  status: BenefitAdvanceStatus;
  notes: string | null;
  rejectionReason: string | null;
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface RegisterAdvanceInput {
  employeeId: string;
  amount: string; // string → Decimal en service
  reason: BenefitAdvanceReason;
  notes?: string | null;
}

const MAX_ADVANCE_RATIO = new Decimal("0.75"); // Art. 144 LOTTT

const REASON_LABELS: Record<BenefitAdvanceReason, string> = {
  HOUSING: "Vivienda",
  HEALTH: "Salud",
  EDUCATION: "Educación",
};

function serializeAdvance(a: {
  id: string;
  employeeId: string;
  amount: Decimal;
  reason: BenefitAdvanceReason;
  status: BenefitAdvanceStatus;
  notes: string | null;
  rejectionReason: string | null;
  transactionId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}): BenefitAdvanceRow {
  return {
    id: a.id,
    employeeId: a.employeeId,
    amount: a.amount.toString(),
    reason: a.reason,
    status: a.status,
    notes: a.notes,
    rejectionReason: a.rejectionReason,
    transactionId: a.transactionId,
    createdByUserId: a.createdByUserId,
    approvedByUserId: a.approvedByUserId,
    approvedAt: a.approvedAt?.toISOString() ?? null,
    rejectedAt: a.rejectedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ─── Guards reutilizables ─────────────────────────────────────────────────────

async function loadAndValidateForAdvance(
  companyId: string,
  employeeId: string,
  amount: Decimal
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });
  if (!employee) throw new Error("Empleado no encontrado en esta empresa");
  if (employee.status !== "ACTIVE") throw new Error("Solo se pueden registrar anticipos para empleados activos");

  const balance = await prisma.benefitBalance.findUnique({
    where: { employeeId },
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

  return { employee, balance };
}

// ─── BenefitAdvanceService ────────────────────────────────────────────────────

export const BenefitAdvanceService = {
  // ── listAdvances — lista de anticipos de un empleado ─────────────────────
  async listAdvances(companyId: string, employeeId: string): Promise<BenefitAdvanceRow[]> {
    const advances = await prisma.benefitAdvance.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: "desc" },
    });
    return advances.map(serializeAdvance);
  },

  // ── listPendingAdvances — anticipos PENDING de la empresa ─────────────────
  // Usado por la acción de aprobación para mostrar solicitudes pendientes.
  async listPendingAdvances(companyId: string): Promise<BenefitAdvanceRow[]> {
    const advances = await prisma.benefitAdvance.findMany({
      where: { companyId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    return advances.map(serializeAdvance);
  },

  // ── requestAdvance — F-04: crea solicitud PENDING (sin GL, sin descuento) ─
  // El HR/Admin deberá aprobar o rechazar en un segundo paso.
  async requestAdvance(
    companyId: string,
    userId: string,
    input: RegisterAdvanceInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<BenefitAdvanceRow> {
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw new Error("El monto del anticipo debe ser mayor a cero");

    const { employee: _employee, balance } = await loadAndValidateForAdvance(companyId, input.employeeId, amount);

    // Crear solicitud PENDING — sin GL, sin descuento de saldo
    return prisma.$transaction(async (tx) => {
      const advance = await tx.benefitAdvance.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          benefitBalanceId: balance.id,
          amount: amount.toFixed(4),
          reason: input.reason,
          status: "PENDING",
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "BenefitAdvance",
          entityId: advance.id,
          action: "REQUEST_BENEFIT_ADVANCE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "none" },
          newValue: {
            employeeId: input.employeeId,
            amount: amount.toFixed(4),
            reason: input.reason,
            status: "PENDING",
          },
        },
      });

      return serializeAdvance(advance);
    });
  },

  // ── approveAdvance — F-04: PENDING → APPROVED + GL + descuento de saldo ──
  async approveAdvance(
    companyId: string,
    userId: string,
    advanceId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<BenefitAdvanceRow> {
    // IDOR guard + state guard
    const existing = await prisma.benefitAdvance.findFirst({
      where: { id: advanceId, companyId },
    });
    if (!existing) throw new Error("Solicitud de anticipo no encontrada");
    if (existing.status !== "PENDING") {
      throw new Error(
        existing.status === "APPROVED"
          ? "Este anticipo ya fue aprobado"
          : "No se puede aprobar un anticipo rechazado"
      );
    }

    const amount = new Decimal(existing.amount.toString());
    const { employee, balance } = await loadAndValidateForAdvance(companyId, existing.employeeId, amount);

    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config?.benefitsExpenseAccountId || !config?.benefitsPayableAccountId) {
      throw new Error("Configure las cuentas contables de prestaciones en la configuración de nómina");
    }

    const today = new Date();
    const period = await prisma.accountingPeriod.findFirst({
      where: { companyId, year: today.getFullYear(), month: today.getMonth() + 1, status: "OPEN" },
    });
    if (!period) {
      throw new Error(
        `No hay período contable abierto para ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}. ` +
        "Abra el período antes de aprobar el anticipo."
      );
    }

    const newBalance = new Decimal(balance.currentBalance.toString()).sub(amount);
    if (newBalance.lt(0)) throw new Error("El anticipo excede el saldo de garantía acumulado");

    return prisma.$transaction(async (tx) => {
      const advanceEntries = [
        {
          accountId: config.benefitsPayableAccountId!,
          amount: amount.toDecimalPlaces(4),
          description: `Anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
        },
        {
          accountId: config.benefitsExpenseAccountId!,
          amount: amount.negated().toDecimalPlaces(4),
          description: `Pago anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
        },
      ];
      assertBalancedGLEntries(advanceEntries); // N4: invariante partida doble
      const transaction = await tx.transaction.create({
        data: {
          companyId,
          periodId: period.id,
          number: `NOM-D-ANT-${existing.employeeId.slice(-6)}-${Date.now().toString().slice(-6)}`,
          date: today,
          description: `Anticipo prestaciones — ${employee.firstName} ${employee.lastName} (${REASON_LABELS[existing.reason]})`,
          userId,
          type: "DIARIO",
          entries: {
            create: advanceEntries,
          },
        },
      });

      await tx.benefitBalance.update({
        where: { id: balance.id },
        data: { currentBalance: newBalance.toFixed(4) },
      });

      const approved = await tx.benefitAdvance.update({
        where: { id: advanceId },
        data: {
          status: "APPROVED",
          transactionId: transaction.id,
          approvedByUserId: userId,
          approvedAt: today,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "BenefitAdvance",
          entityId: advanceId,
          action: "APPROVE_BENEFIT_ADVANCE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "PENDING", currentBalance: balance.currentBalance.toString() },
          newValue: {
            status: "APPROVED",
            amount: amount.toFixed(4),
            newBalance: newBalance.toFixed(4),
            transactionId: transaction.id,
          },
        },
      });

      return serializeAdvance(approved);
    });
  },

  // ── rejectAdvance — F-04: PENDING → REJECTED (sin impacto contable) ───────
  async rejectAdvance(
    companyId: string,
    userId: string,
    advanceId: string,
    rejectionReason: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<BenefitAdvanceRow> {
    const existing = await prisma.benefitAdvance.findFirst({
      where: { id: advanceId, companyId },
    });
    if (!existing) throw new Error("Solicitud de anticipo no encontrada");
    if (existing.status !== "PENDING") {
      throw new Error(
        existing.status === "APPROVED"
          ? "No se puede rechazar un anticipo ya aprobado"
          : "Este anticipo ya fue rechazado"
      );
    }
    if (!rejectionReason?.trim()) throw new Error("Debe indicar el motivo del rechazo");

    return prisma.$transaction(async (tx) => {
      const rejected = await tx.benefitAdvance.update({
        where: { id: advanceId },
        data: {
          status: "REJECTED",
          rejectionReason: rejectionReason.trim(),
          rejectedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "BenefitAdvance",
          entityId: advanceId,
          action: "REJECT_BENEFIT_ADVANCE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: "PENDING" },
          newValue: { status: "REJECTED", rejectionReason: rejectionReason.trim() },
        },
      });

      return serializeAdvance(rejected);
    });
  },

  // ── registerAdvance — path directo APPROVED (admin / backward compat) ─────
  // Crea el anticipo y lo aprueba en un solo paso — para registro manual por RRHH.
  async registerAdvance(
    companyId: string,
    userId: string,
    input: RegisterAdvanceInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<BenefitAdvanceRow> {
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw new Error("El monto del anticipo debe ser mayor a cero");

    const { employee, balance } = await loadAndValidateForAdvance(companyId, input.employeeId, amount);

    const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
    if (!config?.benefitsExpenseAccountId || !config?.benefitsPayableAccountId) {
      throw new Error("Configure las cuentas contables de prestaciones en la configuración de nómina");
    }

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

    return prisma.$transaction(async (tx) => {
      const advanceEntries = [
        {
          accountId: config.benefitsPayableAccountId!,
          amount: new Decimal(amount).toDecimalPlaces(4),
          description: `Anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
        },
        {
          accountId: config.benefitsExpenseAccountId!,
          amount: new Decimal(amount).negated().toDecimalPlaces(4),
          description: `Pago anticipo prestaciones — ${employee.firstName} ${employee.lastName}`,
        },
      ];
      assertBalancedGLEntries(advanceEntries); // N4: invariante partida doble
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
            create: advanceEntries,
          },
        },
      });

      const newBalance = new Decimal(balance.currentBalance.toString()).sub(amount);
      if (newBalance.lt(0)) throw new Error("El anticipo excede el saldo de garantía acumulado");

      await tx.benefitBalance.update({
        where: { id: balance.id },
        data: { currentBalance: newBalance.toFixed(4) },
      });

      const advance = await tx.benefitAdvance.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          benefitBalanceId: balance.id,
          amount: amount.toFixed(4),
          reason: input.reason,
          status: "APPROVED",
          notes: input.notes ?? null,
          transactionId: transaction.id,
          createdByUserId: userId,
          approvedByUserId: userId,
          approvedAt: today,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "BenefitAdvance",
          entityId: advance.id,
          action: "REGISTER_BENEFIT_ADVANCE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { currentBalance: balance.currentBalance.toString() },
          newValue: {
            employeeId: input.employeeId,
            amount: amount.toFixed(4),
            reason: input.reason,
            newBalance: newBalance.toFixed(4),
          },
        },
      });

      return serializeAdvance(advance);
    });
  },
};
