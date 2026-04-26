// src/modules/payroll/services/PayrollConceptService.ts
// Fase NOM-B: CRUD de conceptos de nómina configurables
//
// Conceptos del sistema (isSystem=true): generados automáticamente al inicializar
// la nómina, no se pueden eliminar pero sí desactivar.
// Conceptos de usuario: CRUD completo, solo ADMIN_ONLY en action.

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ConceptType } from "@prisma/client";
import type { CreateConceptInput, UpdateConceptInput } from "../schemas/payroll-concept.schema";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface PayrollConceptRow {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: ConceptType;
  isSystem: boolean;
  isActive: boolean;
  updatedAt: string;
}

// ─── Conceptos del sistema (seeded cuando se activan por primera vez) ─────────
// Basados en la configuración NOM-A: IVSS, INCES, Banavih — se activan según
// los flags ivssEnabled/incesEnabled/banavihEnabled de PayrollConfig.

const SYSTEM_CONCEPTS: Array<{
  code: string;
  name: string;
  type: ConceptType;
  affectsSalaryIntegral: boolean;
}> = [
  // Asignaciones — afectan salario integral (LOTTT Art. 104)
  { code: "SAL_BASE",     name: "Salario Básico",                  type: "EARNING",   affectsSalaryIntegral: true  },
  { code: "HE_DIURNA",   name: "Horas Extra Diurnas (50%)",        type: "EARNING",   affectsSalaryIntegral: true  },
  { code: "HE_NOCTURNA", name: "Horas Extra Nocturnas (100%)",     type: "EARNING",   affectsSalaryIntegral: true  },
  { code: "BONO_NOCHE",  name: "Bono Nocturno (30%)",              type: "EARNING",   affectsSalaryIntegral: true  },
  // CESTA_TICKET: beneficio social — NO afecta salario integral (LOTTT Art. 105 / LCEA Art. 5)
  { code: "CESTA_TICKET", name: "Cesta Ticket / Alimentación",     type: "EARNING",   affectsSalaryIntegral: false },
  // Deducciones — no afectan salario integral (son retenciones, no ingresos)
  { code: "IVSS_OBR",   name: "IVSS Obrero (4%)",                  type: "DEDUCTION", affectsSalaryIntegral: false },
  { code: "INCES_OBR",  name: "INCES Trabajador (0.5%)",           type: "DEDUCTION", affectsSalaryIntegral: false },
  { code: "FAOV_OBR",   name: "Banavih / FAOV Trabajador (1%)",    type: "DEDUCTION", affectsSalaryIntegral: false },
  { code: "RPE_OBR",    name: "Paro Forzoso RPE (0.5%)",           type: "DEDUCTION", affectsSalaryIntegral: false },
  { code: "ISLR_RET",   name: "Retención ISLR Empleado",           type: "DEDUCTION", affectsSalaryIntegral: false },
];

// ─── Serialización ────────────────────────────────────────────────────────────

function serialize(c: {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: ConceptType;
  isSystem: boolean;
  isActive: boolean;
  updatedAt: Date;
}): PayrollConceptRow {
  return {
    id: c.id,
    companyId: c.companyId,
    code: c.code,
    name: c.name,
    type: c.type,
    isSystem: c.isSystem,
    isActive: c.isActive,
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ─── PayrollConceptService ────────────────────────────────────────────────────

export const PayrollConceptService = {
  // ── list — todos los conceptos de la empresa ──────────────────────────────
  async list(companyId: string): Promise<PayrollConceptRow[]> {
    const concepts = await prisma.payrollConcept.findMany({
      where: { companyId },
      orderBy: [{ type: "asc" }, { isSystem: "desc" }, { code: "asc" }],
    });
    return concepts.map(serialize);
  },

  // ── seedDefaults — crea los conceptos del sistema si no existen ───────────
  // Idempotente: usa upsert por (companyId, code). Llamado al abrir la nómina
  // por primera vez o cuando el admin accede a la lista de conceptos.
  async seedDefaults(companyId: string): Promise<void> {
    await Promise.all(
      SYSTEM_CONCEPTS.map((concept) =>
        prisma.payrollConcept.upsert({
          where: { companyId_code: { companyId, code: concept.code } },
          create: {
            companyId,
            code: concept.code,
            name: concept.name,
            type: concept.type,
            affectsSalaryIntegral: concept.affectsSalaryIntegral,
            isSystem: true,
            isActive: true,
          },
          update: {
            affectsSalaryIntegral: concept.affectsSalaryIntegral,
          },
        })
      )
    );
  },

  // ── create — concepto personalizado (no isSystem) ─────────────────────────
  // NOM-C-15: $transaction + AuditLog (operación de impacto fiscal — ADR-006 D-4)
  async create(companyId: string, userId: string, input: CreateConceptInput): Promise<PayrollConceptRow> {
    return prisma.$transaction(async (tx) => {
      const concept = await tx.payrollConcept.create({
        data: {
          companyId,
          code: input.code,
          name: input.name,
          type: input.type,
          isSystem: false,
          isActive: true,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConcept",
          entityId: concept.id,
          action: "CREATE_PAYROLL_CONCEPT",
          userId,
          oldValue: Prisma.JsonNull,
          newValue: { code: input.code, name: input.name, type: input.type },
        },
      });
      return serialize(concept);
    });
  },

  // ── update — actualiza nombre e isActive ──────────────────────────────────
  // No se puede cambiar el code ni el type (inmutables para integridad contable)
  // NOM-C-15: $transaction + AuditLog
  async update(
    companyId: string,
    userId: string,
    conceptId: string,
    input: UpdateConceptInput
  ): Promise<PayrollConceptRow> {
    return prisma.$transaction(async (tx) => {
      const concept = await tx.payrollConcept.findFirst({
        where: { id: conceptId, companyId },
      });
      if (!concept) throw new Error("Concepto no encontrado");

      const updated = await tx.payrollConcept.update({
        where: { id: conceptId },
        data: { name: input.name, isActive: input.isActive },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConcept",
          entityId: conceptId,
          action: "UPDATE_PAYROLL_CONCEPT",
          userId,
          oldValue: { name: concept.name, isActive: concept.isActive },
          newValue: { name: input.name, isActive: input.isActive },
        },
      });
      return serialize(updated);
    });
  },

  // ── delete — solo conceptos no-sistema y sin líneas de nómina ────────────
  // NOM-B: solo permitir borrar si isSystem = false
  // PayrollRunLine.conceptId → onDelete: Restrict (previene borrado con referencias)
  // NOM-C-15: $transaction + AuditLog
  async delete(companyId: string, userId: string, conceptId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const concept = await tx.payrollConcept.findFirst({
        where: { id: conceptId, companyId },
      });
      if (!concept) throw new Error("Concepto no encontrado");
      if (concept.isSystem)
        throw new Error("Los conceptos del sistema no se pueden eliminar. Puedes desactivarlos.");

      await tx.payrollConcept.delete({ where: { id: conceptId } });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConcept",
          entityId: conceptId,
          action: "DELETE_PAYROLL_CONCEPT",
          userId,
          oldValue: { code: concept.code, name: concept.name, type: concept.type },
          newValue: Prisma.JsonNull,
        },
      });
    });
  },

  // ── getSystemConcepts — para uso en NOM-C (cálculo de nómina) ─────────────
  async getSystemConcepts(companyId: string): Promise<PayrollConceptRow[]> {
    const concepts = await prisma.payrollConcept.findMany({
      where: { companyId, isSystem: true, isActive: true },
      orderBy: { code: "asc" },
    });
    return concepts.map(serialize);
  },
};
