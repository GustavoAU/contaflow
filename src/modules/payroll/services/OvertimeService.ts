// src/modules/payroll/services/OvertimeService.ts
// LOTTT Art. 183 — registro de horas extraordinarias.
//
// "Todo patrono y patrona llevará un registro donde anotará las horas
// extraordinarias utilizadas en la entidad de trabajo; los trabajos efectuados en
// esas horas; los trabajadores y las trabajadoras que las realizaron; y la
// remuneración especial que haya pagado a cada trabajador y trabajadora."
//
// El segundo aparte del artículo es lo que le da peso: si el registro no existe o
// no se lleva conforme a la Ley, "se presumen ciertos, hasta prueba en contrario,
// los alegatos de los trabajadores y las trabajadoras sobre la prestación de sus
// servicios en horas extraordinarias, así como sobre la remuneración y beneficios
// sociales percibidos por ello". Se invierte la carga de la prueba.
//
// Es además la ÚNICA vía de entrada de horas extra a la nómina: hasta 2026-08-29
// `PayrollRunService` las fijaba en cero en duro y no había pantalla para
// cargarlas, así que los recargos de los Arts. 117/118 y los topes del Art. 178
// eran código que nunca llegaba a ejecutarse.

import prisma from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import type { OvertimeKind } from "@prisma/client";
import type { CreateOvertimeEntryInput } from "../schemas/overtime.schema";
import { todayInTimeZone } from "@/lib/today";
import { getFiscalConfig } from "@/lib/tax-config";

export interface OvertimeEntryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  workedOn: string; // YYYY-MM-DD
  hours: string;
  kind: OvertimeKind;
  workPerformed: string;
  authorized: boolean;
  authorizationRef: string | null;
  // Se llena cuando la nómina que las pagó queda APPROVED: es la "remuneración
  // especial" del Art. 183. Mientras sea null, las horas están sin pagar.
  payrollRunId: string | null;
  paidAmount: string | null;
  createdAt: string;
}

function serialize(e: {
  id: string;
  employeeId: string;
  employee: { firstName: string; lastName: string };
  workedOn: Date;
  hours: Prisma.Decimal;
  kind: OvertimeKind;
  workPerformed: string;
  authorized: boolean;
  authorizationRef: string | null;
  payrollRunId: string | null;
  paidAmount: Prisma.Decimal | null;
  createdAt: Date;
}): OvertimeEntryRow {
  return {
    id: e.id,
    employeeId: e.employeeId,
    employeeName: `${e.employee.firstName} ${e.employee.lastName}`,
    workedOn: e.workedOn.toISOString().split("T")[0],
    hours: e.hours.toString(),
    kind: e.kind,
    workPerformed: e.workPerformed,
    authorized: e.authorized,
    authorizationRef: e.authorizationRef,
    payrollRunId: e.payrollRunId,
    paidAmount: e.paidAmount?.toString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

const WITH_EMPLOYEE = {
  employee: { select: { firstName: true, lastName: true } },
} as const;

export const OvertimeService = {
  // ── list — registro del período, o de un empleado ─────────────────────────
  async list(
    companyId: string,
    filters: { employeeId?: string; from?: Date; to?: Date } = {},
  ): Promise<OvertimeEntryRow[]> {
    const entries = await prisma.overtimeEntry.findMany({
      where: {
        companyId,
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.from || filters.to
          ? { workedOn: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
          : {}),
      },
      include: WITH_EMPLOYEE,
      orderBy: [{ workedOn: "desc" }, { createdAt: "desc" }],
      // D-2 (auditoría STRIDE): toda lectura de listado lleva cota.
      take: 500,
    });
    return entries.map(serialize);
  },

  // ── create ────────────────────────────────────────────────────────────────
  async create(
    companyId: string,
    userId: string,
    input: CreateOvertimeEntryInput,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<OvertimeEntryRow> {
    // IDOR guard: el empleado tiene que ser de esta empresa (ADR-004).
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, companyId },
      select: { id: true, status: true },
    });
    if (!employee) throw new Error("Empleado no encontrado");
    if (employee.status !== "ACTIVE") {
      throw new Error("No se pueden registrar horas extra de un empleado inactivo");
    }

    const workedOn = new Date(`${input.workedOn}T00:00:00.000Z`);

    // La cota de "no futuro" se comprueba aquí y no en el schema: comparar
    // `new Date(v) <= new Date()` mide medianoche UTC del día declarado contra
    // el instante actual, y entre las 20:00 y las 24:00 en Venezuela (UTC-4) el
    // "ahora" en UTC ya es del día siguiente — o sea que MAÑANA pasaba. El
    // schema no puede resolverlo solo porque no conoce el huso del país.
    if (input.workedOn > todayInTimeZone(getFiscalConfig("VEN").timezone)) {
      throw new Error("No se pueden registrar horas extra de una fecha futura");
    }

    // R-3: si el período contable del día trabajado está cerrado, la nómina que
    // pagaría estas horas no se puede emitir ahí. Se bloquea al registrar, que es
    // cuando el usuario todavía puede corregir la fecha.
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        year: workedOn.getUTCFullYear(),
        month: workedOn.getUTCMonth() + 1,
      },
      select: { status: true },
    });
    if (period && period.status !== "OPEN") {
      throw new Error(
        `El período contable ${workedOn.getUTCFullYear()}-` +
        `${String(workedOn.getUTCMonth() + 1).padStart(2, "0")} está cerrado: ` +
        "no se pueden registrar horas extra con esa fecha."
      );
    }

    return prisma.$transaction(async (tx) => {
      const entry = await tx.overtimeEntry.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          workedOn,
          hours: new Decimal(input.hours).toFixed(2),
          kind: input.kind,
          workPerformed: input.workPerformed,
          authorized: input.authorized,
          authorizationRef: input.authorizationRef?.trim() || null,
          createdByUserId: userId,
        },
        include: WITH_EMPLOYEE,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "OvertimeEntry",
          entityId: entry.id,
          action: "CREATE_OVERTIME_ENTRY",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            employeeId: input.employeeId,
            workedOn: input.workedOn,
            hours: entry.hours.toString(),
            kind: input.kind,
            // Art. 182: si no hubo permiso de la Inspectoría, las horas se pagan
            // con el doble del recargo. Queda en el rastro quién lo declaró.
            authorized: input.authorized,
            authorizationRef: entry.authorizationRef,
          },
        },
      });

      return serialize(entry);
    });
  },

  // ── delete — sólo si aún no se pagó ───────────────────────────────────────
  async delete(
    companyId: string,
    userId: string,
    entryId: string,
    ipAddress: string | null = null,
    userAgent: string | null = null,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // La lectura va DENTRO de la transacción: fuera, entre comprobar que no
      // está pagada y borrarla cabía que otra petición aprobara la nómina, y se
      // pagaba una hora cuyo registro ya no existía.
      const entry = await tx.overtimeEntry.findFirst({
        where: { id: entryId, companyId },
        include: WITH_EMPLOYEE,
      });
      if (!entry) throw new Error("Registro de horas extra no encontrado");
      if (entry.payrollRunId) {
        // `payrollRunId` se llena al CREAR el proceso de nómina, no al
        // aprobarlo, así que esto cubre también el borrador: borrar aquí dejaría
        // pagada una hora extra sin el soporte que el Art. 183 exige — que es el
        // supuesto exacto en que el artículo invierte la carga de la prueba.
        throw new Error(
          "Estas horas ya están incluidas en un proceso de nómina. Si el proceso " +
          "sigue en borrador, cancélalo primero; si ya se aprobó, el registro debe " +
          "conservar la remuneración especial pagada (LOTTT Art. 183) y la " +
          "corrección va por un concepto manual en la nómina siguiente."
        );
      }

      // El `where` repite la condición: un solo statement decide, en vez de
      // confiar en que nada cambió entre la lectura y el borrado.
      const deleted = await tx.overtimeEntry.deleteMany({
        where: { id: entryId, companyId, payrollRunId: null },
      });
      if (deleted.count !== 1) {
        throw new Error("El registro cambió de estado mientras se eliminaba. Vuelve a intentarlo.");
      }
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "OvertimeEntry",
          entityId: entryId,
          action: "DELETE_OVERTIME_ENTRY",
          userId,
          ipAddress,
          userAgent,
          oldValue: {
            employeeId: entry.employeeId,
            workedOn: entry.workedOn.toISOString().split("T")[0],
            hours: entry.hours.toString(),
            kind: entry.kind,
            workPerformed: entry.workPerformed,
            authorized: entry.authorized,
          },
          newValue: Prisma.JsonNull,
        },
      });
    });
  },
};
