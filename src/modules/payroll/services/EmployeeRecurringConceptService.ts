// src/modules/payroll/services/EmployeeRecurringConceptService.ts
//
// Asignaciones y deducciones fijas de un trabajador: lo que se repite en cada
// proceso de nómina mientras esté vigente.
//
// Por qué existe: la nómina venezolana real paga el salario en bolívares —base
// de las cotizaciones y lo que se declara ante IVSS, BANAVIH e INCES— y entrega
// el resto en dólares como bonificación no salarial. Antes eso sólo podía
// expresarse con `manualConcepts` de `CreatePayrollRunSchema`, que hay que
// reescribir empleado por empleado en cada quincena y que además ninguna
// pantalla enviaba nunca: la funcionalidad existía en el backend y estaba muerta.
//
// La NATURALEZA salarial no vive aquí: la gobierna el `PayrollConcept`
// referenciado (ADR-045 D-1). Así un mismo bono no puede ser salarial para un
// trabajador y no salarial para otro, que es justo la incoherencia que una
// fiscalización busca.

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { PayrollPaymentCurrency, SalaryNature } from "@prisma/client";
import type {
  CreateRecurringConceptInput,
  EndRecurringConceptInput,
} from "../schemas/employee-recurring-concept.schema";

export interface RecurringConceptRow {
  id: string;
  employeeId: string;
  employeeName: string;
  conceptId: string;
  conceptCode: string;
  conceptName: string;
  salaryNature: SalaryNature;
  amount: string;
  currency: PayrollPaymentCurrency;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  notes: string | null;
}

// `effectiveFrom` es @db.Date — medianoche UTC. Se serializa con getters UTC:
// pasarlo por un Date local corre el día hacia atrás en Venezuela.
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDateUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export const EmployeeRecurringConceptService = {
  /**
   * Asignaciones de la empresa, opcionalmente de un solo trabajador.
   * Incluye las ya vencidas: el histórico explica por qué una nómina de hace
   * tres meses tiene una línea que hoy no aparece.
   */
  async list(
    companyId: string,
    filters?: { employeeId?: string },
  ): Promise<RecurringConceptRow[]> {
    const rows = await prisma.employeeRecurringConcept.findMany({
      where: {
        companyId,
        ...(filters?.employeeId ? { employeeId: filters.employeeId } : {}),
      },
      select: {
        id: true, employeeId: true, amount: true, currency: true,
        effectiveFrom: true, effectiveTo: true, notes: true,
        employee: { select: { firstName: true, lastName: true } },
        concept: { select: { id: true, code: true, name: true, salaryNature: true } },
      },
      orderBy: [{ effectiveFrom: "desc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.lastName}, ${r.employee.firstName}`,
      conceptId: r.concept.id,
      conceptCode: r.concept.code,
      conceptName: r.concept.name,
      salaryNature: r.concept.salaryNature,
      amount: r.amount.toString(),
      currency: r.currency,
      effectiveFrom: toISO(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? toISO(r.effectiveTo) : null,
      notes: r.notes,
    }));
  },

  async create(
    companyId: string,
    userId: string,
    input: CreateRecurringConceptInput,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<RecurringConceptRow> {
    // Guard de tenant explícito sobre AMBAS referencias. La RLS no cubre esto
    // (ADR-044: la app conecta con BYPASSRLS), así que un id de otra empresa
    // pasaría sin más. Se comprueban en la misma consulta que trae los datos que
    // hacen falta, para no leer dos veces.
    const [employee, concept] = await Promise.all([
      prisma.employee.findFirst({
        where: { id: input.employeeId, companyId },
        select: { id: true, status: true },
      }),
      prisma.payrollConcept.findFirst({
        where: { id: input.conceptId, companyId },
        select: { id: true, isActive: true },
      }),
    ]);
    if (!employee) throw new Error("El trabajador no pertenece a esta empresa");
    if (!concept) throw new Error("El concepto no pertenece a esta empresa");
    if (!concept.isActive) {
      throw new Error("El concepto está desactivado. Actívalo antes de asignarlo.");
    }

    // Dos asignaciones vigentes del MISMO concepto al MISMO trabajador se
    // sumarían en la nómina sin que nadie lo note. Casi siempre es un duplicado
    // por doble envío o por olvidar cerrar la anterior al cambiar el monto.
    const desde = toDateUTC(input.effectiveFrom);
    const hasta = input.effectiveTo ? toDateUTC(input.effectiveTo) : null;

    const solapada = await prisma.employeeRecurringConcept.findFirst({
      where: {
        companyId,
        employeeId: input.employeeId,
        conceptId: input.conceptId,
        effectiveFrom: { lte: hasta ?? new Date("9999-12-31T00:00:00.000Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: desde } }],
      },
      select: { effectiveFrom: true, effectiveTo: true },
    });
    if (solapada) {
      const fin = solapada.effectiveTo ? toISO(solapada.effectiveTo) : "sin fecha de fin";
      throw new Error(
        `Este trabajador ya tiene ese concepto asignado desde el ` +
        `${toISO(solapada.effectiveFrom)} (${fin}), y las fechas se solapan. ` +
        "Cierra la asignación anterior antes de crear la nueva."
      );
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.employeeRecurringConcept.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          conceptId: input.conceptId,
          amount: input.amount,
          currency: input.currency,
          effectiveFrom: desde,
          effectiveTo: hasta,
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
        select: {
          id: true, employeeId: true, amount: true, currency: true,
          effectiveFrom: true, effectiveTo: true, notes: true,
          employee: { select: { firstName: true, lastName: true } },
          concept: { select: { id: true, code: true, name: true, salaryNature: true } },
        },
      });

      // R-6: la asignación decide un pago recurrente. IP y user-agent al AuditLog.
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "EmployeeRecurringConcept",
          entityId: created.id,
          action: "CREATE_RECURRING_CONCEPT",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            employeeId: input.employeeId,
            conceptCode: created.concept.code,
            // La naturaleza se registra porque es lo que decide si el importe
            // entra en la base de cotizaciones: si mañana se reclasifica el
            // concepto, el histórico dice bajo qué criterio se asignó.
            salaryNature: created.concept.salaryNature,
            amount: created.amount.toString(),
            currency: created.currency,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo ?? null,
          },
        },
      });

      return {
        id: created.id,
        employeeId: created.employeeId,
        employeeName: `${created.employee.lastName}, ${created.employee.firstName}`,
        conceptId: created.concept.id,
        conceptCode: created.concept.code,
        conceptName: created.concept.name,
        salaryNature: created.concept.salaryNature,
        amount: created.amount.toString(),
        currency: created.currency,
        effectiveFrom: toISO(created.effectiveFrom),
        effectiveTo: created.effectiveTo ? toISO(created.effectiveTo) : null,
        notes: created.notes,
      };
    });
  },

  /**
   * Cierra una asignación poniéndole fecha de fin. No se borra: las nóminas ya
   * calculadas la referencian y el histórico es lo que explica sus líneas.
   */
  async end(
    companyId: string,
    userId: string,
    input: EndRecurringConceptInput,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<RecurringConceptRow> {
    const hasta = toDateUTC(input.effectiveTo);

    return prisma.$transaction(async (tx) => {
      // El companyId va en el where del update, no en una lectura previa: entre
      // comprobar y escribir cabe otra petición, y aquí el id viene del cliente.
      const updated = await tx.employeeRecurringConcept.updateMany({
        where: { id: input.id, companyId },
        data: { effectiveTo: hasta },
      });
      if (updated.count === 0) {
        throw new Error("La asignación no existe o no pertenece a esta empresa");
      }

      const row = await tx.employeeRecurringConcept.findFirstOrThrow({
        where: { id: input.id, companyId },
        select: {
          id: true, employeeId: true, amount: true, currency: true,
          effectiveFrom: true, effectiveTo: true, notes: true,
          employee: { select: { firstName: true, lastName: true } },
          concept: { select: { id: true, code: true, name: true, salaryNature: true } },
        },
      });

      if (row.effectiveTo && row.effectiveTo < row.effectiveFrom) {
        throw new Error(
          "La fecha de fin no puede ser anterior a la de inicio de la asignación " +
          `(${toISO(row.effectiveFrom)}).`
        );
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "EmployeeRecurringConcept",
          entityId: row.id,
          action: "END_RECURRING_CONCEPT",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: { effectiveTo: input.effectiveTo, conceptCode: row.concept.code },
        },
      });

      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeName: `${row.employee.lastName}, ${row.employee.firstName}`,
        conceptId: row.concept.id,
        conceptCode: row.concept.code,
        conceptName: row.concept.name,
        salaryNature: row.concept.salaryNature,
        amount: row.amount.toString(),
        currency: row.currency,
        effectiveFrom: toISO(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? toISO(row.effectiveTo) : null,
        notes: row.notes,
      };
    });
  },
};
