// src/modules/payroll/services/PayrollConfigService.ts
// Fase NOM-A: Configuración de Nómina — singleton por empresa
//
// Security findings addressed (pre-emptively, audit 2026-04-15):
//   NOM-A-01 (CRITICAL): companyId siempre verificado via companyMember antes de cualquier query
//   NOM-A-02 (CRITICAL): UPSERT dentro de $transaction con AuditLog (oldValue + newValue)
//   NOM-A-04 (HIGH):     rate limit aplicado en la action (no en el service)
//   NOM-A-05 (HIGH):     rol verificado en la action (ADMIN_ONLY para write)
//
// Regla: PayrollConfig es singleton — companyId @unique garantiza una sola fila.
// Sin Serializable: el @unique de PG es el mutex correcto para UPSERT sobre una clave única.
// Sin deletedAt: el historial vive en AuditLog (oldValue/newValue).

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  PayrollSizeRange,
  LottRegime,
  PayrollPaymentCurrency,
  PayrollFrequency,
  CestaTicketType,
  FideicomisoType,
} from "@prisma/client";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface PayrollConfigRow {
  id: string;
  companyId: string;
  sizeRange: PayrollSizeRange;
  lottRegime: LottRegime;
  ivssEnabled: boolean;
  incesEnabled: boolean;
  banavihEnabled: boolean;
  rpeEnabled: boolean;
  cestaTicketType: CestaTicketType;
  paymentCurrency: PayrollPaymentCurrency;
  frequency: PayrollFrequency;
  fideicomiso: FideicomisoType;
  salaryMinimumVes: string | null;
  benefitsExpenseAccountId: string | null;
  benefitsPayableAccountId: string | null;
  vacationPayableAccountId: string | null;
  profitSharingPayableAccountId: string | null;
  rpePayableAccountId: string | null;
  updatedAt: string;
}

export interface SavePayrollConfigInput {
  sizeRange: PayrollSizeRange;
  lottRegime: LottRegime;
  ivssEnabled: boolean;
  incesEnabled: boolean;
  banavihEnabled: boolean;
  rpeEnabled: boolean;
  cestaTicketType: CestaTicketType;
  paymentCurrency: PayrollPaymentCurrency;
  frequency: PayrollFrequency;
  fideicomiso: FideicomisoType;
  salaryMinimumVes?: string | null;
  benefitsExpenseAccountId?: string | null;
  benefitsPayableAccountId?: string | null;
  vacationPayableAccountId?: string | null;
  profitSharingPayableAccountId?: string | null;
  rpePayableAccountId?: string | null;
}

// ─── Serialización ────────────────────────────────────────────────────────────

function serializeConfig(c: {
  id: string;
  companyId: string;
  sizeRange: PayrollSizeRange;
  lottRegime: LottRegime;
  ivssEnabled: boolean;
  incesEnabled: boolean;
  banavihEnabled: boolean;
  rpeEnabled: boolean;
  cestaTicketType: CestaTicketType;
  paymentCurrency: PayrollPaymentCurrency;
  frequency: PayrollFrequency;
  fideicomiso: FideicomisoType;
  salaryMinimumVes: { toString(): string } | null;
  benefitsExpenseAccountId: string | null;
  benefitsPayableAccountId: string | null;
  vacationPayableAccountId: string | null;
  profitSharingPayableAccountId: string | null;
  rpePayableAccountId: string | null;
  updatedAt: Date;
}): PayrollConfigRow {
  return {
    id: c.id,
    companyId: c.companyId,
    sizeRange: c.sizeRange,
    lottRegime: c.lottRegime,
    ivssEnabled: c.ivssEnabled,
    incesEnabled: c.incesEnabled,
    banavihEnabled: c.banavihEnabled,
    rpeEnabled: c.rpeEnabled,
    cestaTicketType: c.cestaTicketType,
    paymentCurrency: c.paymentCurrency,
    frequency: c.frequency,
    fideicomiso: c.fideicomiso,
    salaryMinimumVes: c.salaryMinimumVes ? c.salaryMinimumVes.toString() : null,
    benefitsExpenseAccountId: c.benefitsExpenseAccountId,
    benefitsPayableAccountId: c.benefitsPayableAccountId,
    vacationPayableAccountId: c.vacationPayableAccountId,
    profitSharingPayableAccountId: c.profitSharingPayableAccountId,
    rpePayableAccountId: c.rpePayableAccountId,
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ─── PayrollConfigService ────────────────────────────────────────────────────

export const PayrollConfigService = {
  // ── getConfig — lectura (any member, companyId ya verificado en action) ────
  async getConfig(companyId: string): Promise<PayrollConfigRow | null> {
    const cfg = await prisma.payrollConfig.findUnique({
      where: { companyId },
    });
    return cfg ? serializeConfig(cfg) : null;
  },

  // ── isConfigured — ¿el wizard fue completado? ────────────────────────────
  async isConfigured(companyId: string): Promise<boolean> {
    const count = await prisma.payrollConfig.count({
      where: { companyId },
    });
    return count > 0;
  },

  // ── saveConfig — UPSERT dentro de $transaction con AuditLog ───────────────
  // NOM-A-02: AuditLog registra oldValue (config previa) y newValue (nueva config)
  // para trazabilidad completa ante SENIAT.
  async saveConfig(
    companyId: string,
    userId: string,
    input: SavePayrollConfigInput
  ): Promise<PayrollConfigRow> {
    return prisma.$transaction(async (tx) => {
      // Leer config previa para AuditLog (oldValue)
      const previous = await tx.payrollConfig.findUnique({
        where: { companyId },
      });

      const cfg = await tx.payrollConfig.upsert({
        where: { companyId },
        create: {
          companyId,
          ...input,
        },
        update: {
          ...input,
        },
      });

      // NOM-A-02: AuditLog dentro del mismo $transaction
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConfig",
          entityId: cfg.id,
          action: previous ? "UPDATE_PAYROLL_CONFIG" : "CREATE_PAYROLL_CONFIG",
          userId,
          ipAddress: null,
          userAgent: null,
          oldValue: previous
            ? {
                sizeRange: previous.sizeRange,
                lottRegime: previous.lottRegime,
                ivssEnabled: previous.ivssEnabled,
                incesEnabled: previous.incesEnabled,
                banavihEnabled: previous.banavihEnabled,
                rpeEnabled: previous.rpeEnabled,
                cestaTicketType: previous.cestaTicketType,
                paymentCurrency: previous.paymentCurrency,
                frequency: previous.frequency,
                fideicomiso: previous.fideicomiso,
                salaryMinimumVes: previous.salaryMinimumVes?.toString() ?? null,
              }
            : Prisma.JsonNull,
          newValue: {
            sizeRange: input.sizeRange,
            lottRegime: input.lottRegime,
            ivssEnabled: input.ivssEnabled,
            incesEnabled: input.incesEnabled,
            banavihEnabled: input.banavihEnabled,
            rpeEnabled: input.rpeEnabled,
            cestaTicketType: input.cestaTicketType,
            paymentCurrency: input.paymentCurrency,
            frequency: input.frequency,
            fideicomiso: input.fideicomiso,
            salaryMinimumVes: input.salaryMinimumVes ?? null,
          },
        },
      });

      return serializeConfig(cfg);
    });
  },
};
