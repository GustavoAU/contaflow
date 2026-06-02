// src/modules/payroll/services/LegalThresholdService.ts
// Ítem 72: Histórico de topes legales venezolanos por empresa.
// Cada vez que un decreto modifica el salario mínimo o la UT, el ADMIN agrega
// una fila con effectiveFrom = fecha de vigencia.
// PayrollRunService consume getActive() para obtener el tope vigente al período.

import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import type { LegalThresholdType } from "@prisma/client";
import prisma from "@/lib/prisma";

export interface LegalThresholdRow {
  id: string;
  type: LegalThresholdType;
  effectiveFrom: string; // ISO date YYYY-MM-DD
  value: string;         // Decimal serializado
  notes: string | null;
  createdAt: string;
}

export interface CreateLegalThresholdInput {
  type: LegalThresholdType;
  effectiveFrom: Date;
  value: Decimal;
  notes?: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function serialize(t: {
  id: string;
  type: LegalThresholdType;
  effectiveFrom: Date;
  value: { toString(): string };
  notes: string | null;
  createdAt: Date;
}): LegalThresholdRow {
  return {
    id: t.id,
    type: t.type,
    effectiveFrom: t.effectiveFrom.toISOString().slice(0, 10),
    value: new Decimal(t.value.toString()).toFixed(2),
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
  };
}

export const LegalThresholdService = {
  async getActive(
    companyId: string,
    type: LegalThresholdType,
    date: Date,
  ): Promise<Decimal | null> {
    const row = await prisma.legalThreshold.findFirst({
      where: { companyId, type, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: "desc" },
      select: { value: true },
    });
    return row ? new Decimal(row.value.toString()) : null;
  },

  async list(companyId: string): Promise<LegalThresholdRow[]> {
    const rows = await prisma.legalThreshold.findMany({
      where: { companyId },
      orderBy: [{ type: "asc" }, { effectiveFrom: "desc" }],
    });
    return rows.map(serialize);
  },

  async create(
    companyId: string,
    input: CreateLegalThresholdInput,
  ): Promise<LegalThresholdRow> {
    return prisma.$transaction(async (tx) => {
      const row = await tx.legalThreshold.create({
        data: {
          companyId,
          type: input.type,
          effectiveFrom: input.effectiveFrom,
          value: input.value,
          notes: input.notes ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "LegalThreshold",
          entityId: row.id,
          action: "CREATE_LEGAL_THRESHOLD",
          userId: input.userId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          oldValue: Prisma.JsonNull,
          newValue: { type: input.type, effectiveFrom: input.effectiveFrom.toISOString().slice(0, 10), value: input.value.toString() },
        },
      });
      return serialize(row);
    });
  },

  async delete(
    companyId: string,
    id: string,
    userId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<void> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.legalThreshold.findFirst({
        where: { id, companyId },
      });
      if (!existing) throw new Error("Registro no encontrado");
      await tx.legalThreshold.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "LegalThreshold",
          entityId: id,
          action: "DELETE_LEGAL_THRESHOLD",
          userId,
          ipAddress,
          userAgent,
          oldValue: { type: existing.type, effectiveFrom: existing.effectiveFrom.toISOString().slice(0, 10), value: existing.value.toString() },
          newValue: Prisma.JsonNull,
        },
      });
    });
  },
};
