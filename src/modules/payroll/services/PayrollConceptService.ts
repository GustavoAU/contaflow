// src/modules/payroll/services/PayrollConceptService.ts
// Fase NOM-B: CRUD de conceptos de nómina configurables
//
// Conceptos del sistema (isSystem=true): generados automáticamente al inicializar
// la nómina, no se pueden eliminar pero sí desactivar.
// Conceptos de usuario: CRUD completo, solo ADMIN_ONLY en action.

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ConceptType, SalaryNature } from "@prisma/client";
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

export const SYSTEM_CONCEPTS: Array<{
  code: string;
  name: string;
  type: ConceptType;
  affectsSalaryIntegral: boolean;
  // ADR-045 D-1 — base de cotizaciones parafiscales.
  salaryNature: SalaryNature;
}> = [
  // Asignaciones — afectan salario integral (LOTTT Art. 104)
  { code: "SAL_BASE",     name: "Salario Básico",                  type: "EARNING",   affectsSalaryIntegral: true  , salaryNature: "SALARIO_NORMAL" },
  { code: "HE_DIURNA",   name: "Horas Extra Diurnas (50%)",        type: "EARNING",   affectsSalaryIntegral: true  , salaryNature: "SALARIAL_ACCIDENTAL" },
  { code: "HE_NOCTURNA", name: "Horas Extra Nocturnas (95%)",      type: "EARNING",   affectsSalaryIntegral: true  , salaryNature: "SALARIAL_ACCIDENTAL" },
  { code: "BONO_NOCHE",  name: "Bono Nocturno (30%)",              type: "EARNING",   affectsSalaryIntegral: true  , salaryNature: "SALARIO_NORMAL" },
  // CESTA_TICKET: beneficio social — NO afecta salario integral (LOTTT Art. 105 / LCEA Art. 5)
  { code: "CESTA_TICKET",    name: "Cesta Ticket / Alimentación",              type: "EARNING",   affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  // BONO_ALIM_EFECT: alternativa en efectivo al cestaticket (LCEA Art. 5)
  { code: "BONO_ALIM_EFECT", name: "Bono de Alimentación en efectivo",         type: "EARNING",   affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  // RETROACTIVO: la salida cuando algo se quedo fuera de un periodo ya cerrado.
  // Solo puede haber UN proceso vigente por periodo y moneda —dos asientos por el
  // mismo periodo dejarian el Libro Diario ilegible—, asi que al trabajador que
  // se olvido no se le hace un segundo proceso de ese mes: se le paga en el
  // siguiente. Es SALARIO_NORMAL, no un bono: es salario devengado que se paga
  // tarde, y clasificarlo como no salarial lo sacaria de la base de cotizaciones
  // a la que tiene derecho.
  { code: "RETROACTIVO",      name: "Retroactivo de salario",                   type: "EARNING",   affectsSalaryIntegral: true  , salaryNature: "SALARIO_NORMAL" },
  // BONO_DIVISAS: la practica extendida en Venezuela es pagar el salario en
  // bolivares —base de cotizaciones y lo que se declara— y el resto en dolares
  // como bonificacion no salarial. Se siembra como concepto para que el contador
  // pueda expresarlo, NO porque el sistema afirme que es correcto: LOTTT Art. 105
  // es una lista CERRADA, y el Art. 104 considera salario toda remuneracion
  // regular y permanente. Clasificarlo aqui es decision del contador, y por eso
  // queda en el catalogo de la empresa donde puede reclasificarse.
  { code: "BONO_DIVISAS",     name: "Bono en divisas (no salarial)",            type: "EARNING",   affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  // DOM_FERIADO: trabajo en día de descanso/feriado → recargo 100% del salario normal (Art. 119 LOTTT)
  { code: "DOM_FERIADO",     name: "Domingos y Feriados trabajados (100%)",    type: "EARNING",   affectsSalaryIntegral: false , salaryNature: "SALARIAL_ACCIDENTAL" },
  // DESCANSO_COMP: compensación cuando no se otorga el descanso compensatorio (Art. 120 LOTTT)
  { code: "DESCANSO_COMP",   name: "Descanso compensatorio no otorgado (100%)", type: "EARNING",   affectsSalaryIntegral: false , salaryNature: "SALARIAL_ACCIDENTAL" },
  // Deducciones — no afectan salario integral (son retenciones, no ingresos)
  { code: "IVSS_OBR",   name: "IVSS Obrero (4%)",                  type: "DEDUCTION", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "INCES_OBR",  name: "INCES Trabajador (0,5% de utilidades)", type: "DEDUCTION", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "FAOV_OBR",   name: "Banavih / FAOV Trabajador (1%)",    type: "DEDUCTION", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "RPE_OBR",    name: "Paro Forzoso RPE (0.5%)",           type: "DEDUCTION", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "ISLR_RET",   name: "Retención ISLR Empleado",           type: "DEDUCTION", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  // Cuota de préstamo empresa — no afecta salario integral (es recuperación de deuda, no gasto salarial)
  { code: "PRESTAMO_EMP", name: "Cuota Préstamo Empresa",          type: "DEDUCTION",     affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  // F-03: Aportes patronales — no afectan neto del empleado (EMPLOYER_COST)
  { code: "IVSS_PAT",   name: "IVSS Patronal (segun clase de riesgo)", type: "EMPLOYER_COST", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "INCES_PAT",  name: "INCES Patronal (2%)",               type: "EMPLOYER_COST", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "FAOV_PAT",   name: "Banavih / FAOV Patronal (2%)",      type: "EMPLOYER_COST", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
  { code: "RPE_PAT",    name: "Paro Forzoso Patronal (2%)",        type: "EMPLOYER_COST", affectsSalaryIntegral: false , salaryNature: "NO_SALARIAL" },
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
  async seedDefaults(
    companyId: string,
    userId?: string,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<void> {
    // D3: antes esto reescribia en CADA llamada —y se llama desde rutas de
    // lectura— tres campos con incidencia fiscal (salaryNature,
    // affectsSalaryIntegral, isSystem) sin dejar rastro de nada. Se lee primero
    // y solo se toca lo que de verdad esta mal, con AuditLog cuando eso ocurre:
    // una reparacion silenciosa de un campo que decide una cotizacion es
    // exactamente lo que no debe pasar desapercibido.
    const existing = await prisma.payrollConcept.findMany({
      where: { companyId, code: { in: SYSTEM_CONCEPTS.map((c) => c.code) } },
      select: {
        id: true, code: true, isSystem: true,
        affectsSalaryIntegral: true, salaryNature: true,
      },
    });
    const byCode = new Map(existing.map((c) => [c.code, c]));

    const missing = SYSTEM_CONCEPTS.filter((c) => !byCode.has(c.code));
    const repairs = SYSTEM_CONCEPTS.flatMap((concept) => {
      const row = byCode.get(concept.code);
      if (!row) return [];
      const drift =
        row.isSystem !== true ||
        row.affectsSalaryIntegral !== concept.affectsSalaryIntegral ||
        row.salaryNature !== concept.salaryNature;
      return drift ? [{ concept, row }] : [];
    });

    if (missing.length === 0 && repairs.length === 0) return;

    // Concurrencia: dos peticiones simultaneas que vean el mismo drift ejecutan
    // ambas la reparacion. Los `update` son idempotentes —escriben el mismo
    // valor canonico— asi que lo unico que se duplica es la entrada del
    // AuditLog. Se acepta a proposito: es autolimitado (tras la primera
    // reparacion ya no hay drift) y el drift no se puede reintroducir desde la
    // UI, porque `update` bloquea salaryNature e isActive en conceptos del
    // sistema. Un advisory lock por companyId en una ruta que corre en cada
    // render costaria mas de lo que evita.

    await prisma.$transaction(async (tx) => {
      for (const concept of missing) {
        await tx.payrollConcept.create({
          data: {
            companyId,
            code: concept.code,
            name: concept.name,
            type: concept.type,
            affectsSalaryIntegral: concept.affectsSalaryIntegral,
            salaryNature: concept.salaryNature,
            isSystem: true,
            isActive: true,
          },
        });
      }

      for (const { concept, row } of repairs) {
        await tx.payrollConcept.update({
          where: { id: row.id },
          data: {
            affectsSalaryIntegral: concept.affectsSalaryIntegral,
            // La naturaleza de un concepto del sistema la fija la ley, no la
            // empresa. Los personalizados (isSystem:false) no pasan por aqui.
            salaryNature: concept.salaryNature,
            // REPARA isSystem. El motor de nomina carga los conceptos con
            // `where: { isSystem: true }`, asi que una fila de SYSTEM_CONCEPTS
            // marcada como false es invisible para el: si le pasa a SAL_BASE,
            // la nomina no genera NINGUNA linea de salario y el neto sale
            // negativo. Precedente: seed-demo-tesa.ts creaba SAL_BASE con
            // isSystem:false (2026-08-23).
            isSystem: true,
          },
        });
      }

      if (repairs.length > 0) {
        await tx.auditLog.create({
          data: {
            companyId,
            entityName: "PayrollConcept",
            entityId: repairs[0].row.id,
            action: "REPAIR_SYSTEM_CONCEPTS",
            // "system" SOLO cuando de verdad no hay usuario (una ruta de
            // render). Si la reparacion la disparo una peticion autenticada, el
            // AuditLog dice quien y desde donde: R-6 pide IP/UA en toda mutacion
            // fiscal, y estos tres campos lo son.
            userId: userId ?? "system",
            ipAddress,
            userAgent,
            oldValue: repairs.map(({ concept, row }) => ({
              code: concept.code,
              isSystem: row.isSystem,
              affectsSalaryIntegral: row.affectsSalaryIntegral,
              salaryNature: row.salaryNature,
            })),
            newValue: repairs.map(({ concept }) => ({
              code: concept.code,
              isSystem: true,
              affectsSalaryIntegral: concept.affectsSalaryIntegral,
              salaryNature: concept.salaryNature,
            })),
          },
        });
      }
    });
  },

  // ── create — concepto personalizado (no isSystem) ─────────────────────────
  // NOM-C-15: $transaction + AuditLog (operación de impacto fiscal — ADR-006 D-4)
  async create(companyId: string, userId: string, input: CreateConceptInput, ipAddress: string | null = null, userAgent: string | null = null): Promise<PayrollConceptRow> {
    return prisma.$transaction(async (tx) => {
      const concept = await tx.payrollConcept.create({
        data: {
          companyId,
          code: input.code,
          name: input.name,
          type: input.type,
          salaryNature: input.salaryNature ?? "NO_SALARIAL",
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
          ipAddress,
          userAgent,
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
    input: UpdateConceptInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<PayrollConceptRow> {
    return prisma.$transaction(async (tx) => {
      const concept = await tx.payrollConcept.findFirst({
        where: { id: conceptId, companyId },
      });
      if (!concept) throw new Error("Concepto no encontrado");

      // Un concepto del sistema NO se puede desactivar. El motor los carga con
      // `where: { isSystem: true, isActive: true }`: desactivar SAL_BASE deja la
      // nomina sin ninguna linea de salario y el neto sale negativo. Es el mismo
      // estado catastrofico que provocaba isSystem=false (fix 4a5149e), por otra
      // puerta que no tenia guarda.
      if (concept.isSystem && input.isActive === false) {
        throw new Error(
          "Los conceptos legales del sistema no se pueden desactivar. " +
          "Para dejar de aplicar un organismo, usa los interruptores de la configuracion de nomina."
        );
      }

      const updated = await tx.payrollConcept.update({
        where: { id: conceptId },
        data: {
          name: input.name,
          isActive: input.isActive,
          // La naturaleza de un concepto del sistema la fija la ley: seedDefaults
          // la repara en cada corrida, asi que aceptarla aqui seria mentir.
          ...(concept.isSystem || input.salaryNature === undefined
            ? {}
            : { salaryNature: input.salaryNature }),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConcept",
          entityId: conceptId,
          action: "UPDATE_PAYROLL_CONCEPT",
          userId,
          ipAddress,
          userAgent,
          oldValue: {
            name: concept.name,
            isActive: concept.isActive,
            salaryNature: concept.salaryNature,
          },
          newValue: {
            name: input.name,
            isActive: input.isActive,
            salaryNature: concept.isSystem
              ? concept.salaryNature
              : input.salaryNature ?? concept.salaryNature,
          },
        },
      });
      return serialize(updated);
    });
  },

  // ── delete — solo conceptos no-sistema y sin líneas de nómina ────────────
  // NOM-B: solo permitir borrar si isSystem = false
  // PayrollRunLine.conceptId → onDelete: Restrict (previene borrado con referencias)
  // NOM-C-15: $transaction + AuditLog
  async delete(companyId: string, userId: string, conceptId: string, ipAddress: string | null = null, userAgent: string | null = null): Promise<void> {
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
          ipAddress,
          userAgent,
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
