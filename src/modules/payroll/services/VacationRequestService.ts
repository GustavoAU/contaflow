// src/modules/payroll/services/VacationRequestService.ts
// Feature 8/9/10: solicitudes de vacaciones con flujo aprobación LOTTT.
// Balance = días causados (LOTTT) + saldo inicial - días procesados (VacationRecord) - días en PENDING/APPROVED.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { VacationRequestStatus } from "@prisma/client";

// ─── Row type serializado ─────────────────────────────────────────────────────

export interface VacationRequestRow {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  daysRequested: string;   // Decimal serializado
  status: VacationRequestStatus;
  notes: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface VacationBalanceRow {
  employeeId: string;
  yearsOfService: number;
  daysAccrued: number;        // LOTTT accrual
  initialBalance: number;     // saldo del sistema anterior
  daysUsed: number;           // VacationRecord procesados
  daysPending: number;        // PENDING + APPROVED requests
  daysAvailable: number;      // accrued + initial - used - pending
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapRow(r: {
  id: string;
  companyId: string;
  employeeId: string;
  employee: { firstName: string; lastName: string };
  startDate: Date;
  endDate: Date;
  daysRequested: Decimal;
  status: VacationRequestStatus;
  notes: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
}): VacationRequestRow {
  return {
    id: r.id,
    companyId: r.companyId,
    employeeId: r.employeeId,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    startDate: toIsoDate(r.startDate),
    endDate: toIsoDate(r.endDate),
    daysRequested: r.daysRequested.toString(),
    status: r.status,
    notes: r.notes,
    rejectionReason: r.rejectionReason,
    reviewedByUserId: r.reviewedByUserId,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

// LOTTT Art. 190: días mínimos por año de servicio.
// Año 1: 15 días. Cada año adicional: +1 día. Máximo 30 días/año.
function accrualForYear(year: number): number {
  return Math.min(30, 14 + year); // year 1 → 15, year 2 → 16, …, year 16+ → 30
}

// ─── VacationRequestService ───────────────────────────────────────────────────

export const VacationRequestService = {
  // ── listByEmployee ──────────────────────────────────────────────────────────
  async listByEmployee(companyId: string, employeeId: string): Promise<VacationRequestRow[]> {
    const rows = await prisma.vacationRequest.findMany({
      where: { companyId, employeeId },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapRow);
  },

  // ── listPending — para el inbox del manager ─────────────────────────────────
  async listPending(companyId: string): Promise<VacationRequestRow[]> {
    const rows = await prisma.vacationRequest.findMany({
      where: { companyId, status: "PENDING" },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapRow);
  },

  // ── pendingCount ────────────────────────────────────────────────────────────
  async pendingCount(companyId: string): Promise<number> {
    return prisma.vacationRequest.count({ where: { companyId, status: "PENDING" } });
  },

  // ── create ──────────────────────────────────────────────────────────────────
  async create(
    companyId: string,
    input: {
      employeeId: string;
      startDate: Date;
      endDate: Date;
      daysRequested: Decimal;
      notes?: string;
      createdByUserId: string;
      ipAddress: string | null;
      userAgent: string | null;
    }
  ): Promise<VacationRequestRow> {
    const row = await prisma.$transaction(async (tx) => {
      const req = await tx.vacationRequest.create({
        data: {
          companyId,
          employeeId: input.employeeId,
          startDate: input.startDate,
          endDate: input.endDate,
          daysRequested: input.daysRequested,
          notes: input.notes ?? null,
          createdByUserId: input.createdByUserId,
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId: input.createdByUserId,
          action: "VACATION_REQUEST_CREATED",
          entityName: "VacationRequest",
          entityId: req.id,
          newValue: {
            employeeId: input.employeeId,
            startDate: toIsoDate(input.startDate),
            endDate: toIsoDate(input.endDate),
            daysRequested: input.daysRequested.toString(),
          },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });

      return req;
    });

    return mapRow(row);
  },

  // ── approve ─────────────────────────────────────────────────────────────────
  async approve(
    companyId: string,
    requestId: string,
    reviewerUserId: string,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<VacationRequestRow> {
    const req = await prisma.vacationRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!req) throw new Error("Solicitud de vacaciones no encontrada");
    if (req.status !== "PENDING") throw new Error("Solo se pueden aprobar solicitudes en estado PENDIENTE");

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.vacationRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId: reviewerUserId,
          action: "VACATION_REQUEST_APPROVED",
          entityName: "VacationRequest",
          entityId: requestId,
          newValue: { status: "APPROVED" },
          ipAddress,
          userAgent,
        },
      });

      return updated;
    });

    return mapRow(row);
  },

  // ── reject ──────────────────────────────────────────────────────────────────
  async reject(
    companyId: string,
    requestId: string,
    reviewerUserId: string,
    rejectionReason: string,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<VacationRequestRow> {
    const req = await prisma.vacationRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!req) throw new Error("Solicitud de vacaciones no encontrada");
    if (req.status !== "PENDING") throw new Error("Solo se pueden rechazar solicitudes en estado PENDIENTE");

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.vacationRequest.update({
        where: { id: requestId },
        data: {
          status: "REJECTED",
          rejectionReason,
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId: reviewerUserId,
          action: "VACATION_REQUEST_REJECTED",
          entityName: "VacationRequest",
          entityId: requestId,
          newValue: { status: "REJECTED", rejectionReason },
          ipAddress,
          userAgent,
        },
      });

      return updated;
    });

    return mapRow(row);
  },

  // ── cancel (por el propio empleado o ADMIN) ─────────────────────────────────
  async cancel(
    companyId: string,
    requestId: string,
    userId: string,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<VacationRequestRow> {
    const req = await prisma.vacationRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!req) throw new Error("Solicitud de vacaciones no encontrada");
    if (req.status === "REJECTED" || req.status === "CANCELLED")
      throw new Error("La solicitud ya está cerrada");

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.vacationRequest.update({
        where: { id: requestId },
        data: { status: "CANCELLED" },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: "VACATION_REQUEST_CANCELLED",
          entityName: "VacationRequest",
          entityId: requestId,
          newValue: { status: "CANCELLED" },
          ipAddress,
          userAgent,
        },
      });

      return updated;
    });

    return mapRow(row);
  },

  // ── getBalance — calcula días disponibles para un empleado ──────────────────
  async getBalance(companyId: string, employeeId: string): Promise<VacationBalanceRow> {
    const [employee, vacationRecords, pendingRequests] = await Promise.all([
      prisma.employee.findFirst({
        where: { id: employeeId, companyId },
        select: { hireDate: true, initialVacationDays: true },
      }),
      prisma.vacationRecord.findMany({
        where: { companyId, employeeId, isFractional: false },
        select: { vacationDays: true },
      }),
      prisma.vacationRequest.findMany({
        where: { companyId, employeeId, status: { in: ["PENDING", "APPROVED"] } },
        select: { daysRequested: true },
      }),
    ]);

    if (!employee) throw new Error("Empleado no encontrado");

    const today = new Date();
    const hireDate = new Date(employee.hireDate);
    const yearsOfService = Math.floor(
      (today.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );

    // Días causados según LOTTT Art. 190 (suma acumulada de todos los años cumplidos)
    let daysAccrued = 0;
    for (let y = 1; y <= yearsOfService; y++) {
      daysAccrued += accrualForYear(y);
    }

    const initialBalance = employee.initialVacationDays
      ? Number(employee.initialVacationDays.toString())
      : 0;

    const daysUsed = vacationRecords.reduce(
      (s, r) => s + Number(r.vacationDays.toString()),
      0
    );

    const daysPending = pendingRequests.reduce(
      (s, r) => s + Number(r.daysRequested.toString()),
      0
    );

    const daysAvailable = Math.max(0, daysAccrued + initialBalance - daysUsed - daysPending);

    return {
      employeeId,
      yearsOfService,
      daysAccrued,
      initialBalance,
      daysUsed,
      daysPending,
      daysAvailable,
    };
  },

  // ── setInitialVacationBalance — Feature 4: migración desde otro sistema ─────
  async setInitialVacationBalance(
    companyId: string,
    employeeId: string,
    initialDays: Decimal,
    userId: string,
    ipAddress: string | null,
    userAgent: string | null
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId, companyId },
        data: { initialVacationDays: initialDays },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: "EMPLOYEE_INITIAL_VACATION_SET",
          entityName: "Employee",
          entityId: employeeId,
          newValue: { initialVacationDays: initialDays.toString() },
          ipAddress,
          userAgent,
        },
      });
    });
  },
};
