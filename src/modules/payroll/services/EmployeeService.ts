// src/modules/payroll/services/EmployeeService.ts
// Fase NOM-B: CRUD de empleados + historial de salarios
//
// Security findings addressed (pre-emptive, audit 2026-04-15):
//   NOM-B-01 (CRITICAL): companyId siempre verificado en la action (companyMember)
//   NOM-B-02 (CRITICAL): cédula única por empresa vía @@unique en DB + P2002 → msg amigable
//   NOM-B-03 (HIGH):     SalaryHistory INSERT dentro de $transaction con AuditLog
//   NOM-B-04 (HIGH):     write = ADMIN_ONLY, read = WRITERS — guard en action
//   NOM-B-05 (MEDIUM):   terminationDate >= hireDate — validado en Zod
//
// Regla: nunca DELETE empleados — solo status TERMINATED + terminationDate.
// SalaryHistory es append-only; el salario vigente = max(effectiveFrom) <= hoy.

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import type {
  ContractType,
  EmployeeStatus,
  JornadaType,
  LottRegime,
  MaritalStatus,
  PayrollPaymentCurrency,
  PayrollWorkerType,
} from "@prisma/client";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  TerminateEmployeeInput,
  AddSalaryInput,
} from "../schemas/employee.schema";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface SalaryHistoryRow {
  id: string;
  effectiveFrom: string;
  amount: string;
  currency: PayrollPaymentCurrency;
  createdAt: string;
}

export interface EmployeeRow {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  cedulaType: string;
  cedulaNumber: string;
  cedula: string; // "V-12345678"
  contractType: ContractType;
  employeeRegime: LottRegime;
  hireDate: string;
  terminationDate: string | null;
  status: EmployeeStatus;
  position: string;
  department: string | null;
  email: string | null;
  phone: string | null;
  bankName: string | null;
  bankAccount: string | null;
  costCenter: string | null;
  // F-01: campos parafiscales
  ivssNumber: string | null;
  banavihNumber: string | null;
  dependents: number | null;
  birthDate: string | null;
  workSchedule: JornadaType | null;
  // F-02: clasificación LOTTT + estado civil
  maritalStatus: MaritalStatus | null;
  payrollWorkerType: PayrollWorkerType;
  contractEndDate: string | null;
  useFideicomiso: boolean;
  currentSalary: SalaryHistoryRow | null;
  updatedAt: string;
}

export interface EmployeeListRow {
  id: string;
  fullName: string;
  cedula: string;
  position: string;
  department: string | null;
  status: EmployeeStatus;
  contractType: ContractType;
  hireDate: string;
  currentSalaryAmount: string | null;
  currentSalaryCurrency: PayrollPaymentCurrency | null;
  // C-06: tipo trabajador — visible en tabla para identificar Forma 14-02 IVSS
  payrollWorkerType: PayrollWorkerType;
}

// ─── Helpers de serialización ─────────────────────────────────────────────────

function serializeSalary(s: {
  id: string;
  effectiveFrom: Date;
  amount: Decimal;
  currency: PayrollPaymentCurrency;
  createdAt: Date;
}): SalaryHistoryRow {
  return {
    id: s.id,
    effectiveFrom: s.effectiveFrom.toISOString().split("T")[0],
    amount: s.amount.toString(),
    currency: s.currency,
    createdAt: s.createdAt.toISOString(),
  };
}

type PrismaEmployee = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  cedulaType: string;
  cedulaNumber: string;
  contractType: ContractType;
  employeeRegime: LottRegime;
  hireDate: Date;
  terminationDate: Date | null;
  status: EmployeeStatus;
  position: string;
  department: string | null;
  email: string | null;
  phone: string | null;
  bankName: string | null;
  bankAccount: string | null;
  costCenter: string | null;
  ivssNumber: string | null;
  banavihNumber: string | null;
  dependents: number | null;
  birthDate: Date | null;
  workSchedule: JornadaType | null;
  maritalStatus: MaritalStatus | null;
  payrollWorkerType: PayrollWorkerType;
  contractEndDate: Date | null;
  useFideicomiso: boolean;
  updatedAt: Date;
  salaryHistory: Array<{
    id: string;
    effectiveFrom: Date;
    amount: Decimal;
    currency: PayrollPaymentCurrency;
    createdAt: Date;
  }>;
};

function serializeEmployee(e: PrismaEmployee): EmployeeRow {
  const currentSalary = e.salaryHistory[0] ?? null;
  return {
    id: e.id,
    companyId: e.companyId,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: `${e.firstName} ${e.lastName}`,
    cedulaType: e.cedulaType,
    cedulaNumber: e.cedulaNumber,
    cedula: `${e.cedulaType}-${e.cedulaNumber}`,
    contractType: e.contractType,
    employeeRegime: e.employeeRegime,
    hireDate: e.hireDate.toISOString().split("T")[0],
    terminationDate: e.terminationDate ? e.terminationDate.toISOString().split("T")[0] : null,
    status: e.status,
    position: e.position,
    department: e.department,
    email: e.email,
    phone: e.phone,
    bankName: e.bankName,
    bankAccount: e.bankAccount,
    costCenter: e.costCenter,
    ivssNumber: e.ivssNumber,
    banavihNumber: e.banavihNumber,
    dependents: e.dependents,
    birthDate: e.birthDate ? e.birthDate.toISOString().split("T")[0] : null,
    workSchedule: e.workSchedule,
    maritalStatus: e.maritalStatus,
    payrollWorkerType: e.payrollWorkerType,
    contractEndDate: e.contractEndDate ? e.contractEndDate.toISOString().split("T")[0] : null,
    useFideicomiso: e.useFideicomiso,
    currentSalary: currentSalary ? serializeSalary(currentSalary) : null,
    updatedAt: e.updatedAt.toISOString(),
  };
}

const WITH_CURRENT_SALARY = {
  salaryHistory: {
    orderBy: { effectiveFrom: "desc" as const },
    take: 1,
  },
};

// ─── EmployeeService ──────────────────────────────────────────────────────────

export const EmployeeService = {
  // ── list — todos los empleados de la empresa ──────────────────────────────
  async list(companyId: string, status?: EmployeeStatus): Promise<EmployeeListRow[]> {
    const employees = await prisma.employee.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: WITH_CURRENT_SALARY,
    });

    return employees.map((e) => ({
      id: e.id,
      fullName: `${e.firstName} ${e.lastName}`,
      cedula: `${e.cedulaType}-${e.cedulaNumber}`,
      position: e.position,
      department: e.department,
      status: e.status,
      contractType: e.contractType,
      hireDate: e.hireDate.toISOString().split("T")[0],
      currentSalaryAmount: e.salaryHistory[0]?.amount.toString() ?? null,
      currentSalaryCurrency: e.salaryHistory[0]?.currency ?? null,
      payrollWorkerType: e.payrollWorkerType,
    }));
  },

  // ── getById — empleado individual con historial de salario ────────────────
  async getById(companyId: string, employeeId: string): Promise<EmployeeRow | null> {
    const e = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: WITH_CURRENT_SALARY,
    });
    return e ? serializeEmployee(e) : null;
  },

  // ── getSalaryHistory — historial completo ─────────────────────────────────
  async getSalaryHistory(
    companyId: string,
    employeeId: string
  ): Promise<SalaryHistoryRow[]> {
    const rows = await prisma.salaryHistory.findMany({
      where: { employeeId, companyId },
      orderBy: { effectiveFrom: "desc" },
    });
    return rows.map(serializeSalary);
  },

  // ── create — nuevo empleado + salario inicial (opcional) ──────────────────
  // NOM-B-03: si hay salario inicial, crea SalaryHistory + AuditLog en $transaction
  async create(
    companyId: string,
    userId: string,
    input: CreateEmployeeInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<EmployeeRow> {
    return prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          companyId,
          firstName: input.firstName,
          lastName: input.lastName,
          cedulaType: input.cedulaType,
          cedulaNumber: input.cedulaNumber,
          contractType: input.contractType,
          employeeRegime: input.employeeRegime,
          hireDate: new Date(input.hireDate),
          position: input.position,
          department: input.department ?? null,
          email: input.email || null,
          phone: input.phone ?? null,
          bankName: input.bankName ?? null,
          bankAccount: input.bankAccount ?? null,
          costCenter: input.costCenter ?? null,
          ivssNumber: input.ivssNumber ?? null,
          banavihNumber: input.banavihNumber ?? null,
          dependents: input.dependents ?? null,
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          workSchedule: input.workSchedule ?? null,
          maritalStatus: input.maritalStatus ?? null,
          payrollWorkerType: input.payrollWorkerType ?? "EMPLEADO",
          contractEndDate: input.contractEndDate ? new Date(input.contractEndDate) : null,
          useFideicomiso: input.useFideicomiso ?? false,
        },
        include: WITH_CURRENT_SALARY,
      });

      // Salario inicial opcional
      if (
        input.initialSalaryAmount &&
        Number(input.initialSalaryAmount) > 0 &&
        input.initialSalaryCurrency
      ) {
        await tx.salaryHistory.create({
          data: {
            companyId,
            employeeId: employee.id,
            effectiveFrom: new Date(input.hireDate),
            amount: new Decimal(input.initialSalaryAmount),
            currency: input.initialSalaryCurrency,
            createdByUserId: userId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "Employee",
          entityId: employee.id,
          action: "CREATE_EMPLOYEE",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            firstName: input.firstName,
            lastName: input.lastName,
            cedula: `${input.cedulaType}-${input.cedulaNumber}`,
            contractType: input.contractType,
            position: input.position,
            hireDate: input.hireDate,
          },
        },
      });

      // Re-fetch con salario para serializar correctamente
      const created = await tx.employee.findUniqueOrThrow({
        where: { id: employee.id },
        include: WITH_CURRENT_SALARY,
      });
      return serializeEmployee(created);
    });
  },

  // ── update — actualizar datos del empleado (no cédula, no hireDate) ───────
  async update(
    companyId: string,
    userId: string,
    employeeId: string,
    input: UpdateEmployeeInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<EmployeeRow> {
    return prisma.$transaction(async (tx) => {
      const previous = await tx.employee.findFirst({
        where: { id: employeeId, companyId },
      });
      if (!previous) throw new Error("Empleado no encontrado");

      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          contractType: input.contractType,
          employeeRegime: input.employeeRegime,
          position: input.position,
          department: input.department ?? null,
          email: input.email || null,
          phone: input.phone ?? null,
          bankName: input.bankName ?? null,
          bankAccount: input.bankAccount ?? null,
          costCenter: input.costCenter ?? null,
          ivssNumber: input.ivssNumber ?? null,
          banavihNumber: input.banavihNumber ?? null,
          dependents: input.dependents ?? null,
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          workSchedule: input.workSchedule ?? null,
          maritalStatus: input.maritalStatus ?? null,
          payrollWorkerType: input.payrollWorkerType ?? "EMPLEADO",
          contractEndDate: input.contractEndDate ? new Date(input.contractEndDate) : null,
          useFideicomiso: input.useFideicomiso ?? false,
        },
        include: WITH_CURRENT_SALARY,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "Employee",
          entityId: employeeId,
          action: "UPDATE_EMPLOYEE",
          userId,
          ipAddress,
          userAgent,
          oldValue: {
            firstName: previous.firstName,
            lastName: previous.lastName,
            contractType: previous.contractType,
            position: previous.position,
          },
          newValue: {
            firstName: input.firstName,
            lastName: input.lastName,
            contractType: input.contractType,
            position: input.position,
          },
        },
      });

      return serializeEmployee(updated);
    });
  },

  // ── terminate — status TERMINATED + terminationDate ───────────────────────
  // NOM-B: nunca DELETE, solo status change con fecha de egreso
  async terminate(
    companyId: string,
    userId: string,
    employeeId: string,
    input: TerminateEmployeeInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<EmployeeRow> {
    return prisma.$transaction(async (tx) => {
      const previous = await tx.employee.findFirst({
        where: { id: employeeId, companyId },
      });
      if (!previous) throw new Error("Empleado no encontrado");
      if (previous.status === "TERMINATED") throw new Error("El empleado ya está egresado");

      // NOM-D residual fix: terminationDate debe ser >= hireDate
      const terminationDateObj = new Date(input.terminationDate);
      if (terminationDateObj < previous.hireDate) {
        throw new Error("La fecha de egreso no puede ser anterior a la fecha de ingreso");
      }

      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: {
          status: "TERMINATED",
          terminationDate: new Date(input.terminationDate),
        },
        include: WITH_CURRENT_SALARY,
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "Employee",
          entityId: employeeId,
          action: "TERMINATE_EMPLOYEE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { status: previous.status },
          newValue: { status: "TERMINATED", terminationDate: input.terminationDate },
        },
      });

      return serializeEmployee(updated);
    });
  },

  // ── addSalary — agrega entrada al historial de salarios ──────────────────
  // NOM-B-03: INSERT en SalaryHistory + AuditLog en $transaction
  async addSalary(
    companyId: string,
    userId: string,
    employeeId: string,
    input: AddSalaryInput,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ): Promise<SalaryHistoryRow> {
    return prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, companyId },
      });
      if (!employee) throw new Error("Empleado no encontrado");
      // NOM-D residual fix: no modificar salario de empleado egresado
      if (employee.status === "TERMINATED") {
        throw new Error("No se puede modificar el salario de un empleado egresado");
      }

      const entry = await tx.salaryHistory.create({
        data: {
          companyId,
          employeeId,
          effectiveFrom: new Date(input.effectiveFrom),
          amount: new Decimal(input.amount),
          currency: input.currency,
          createdByUserId: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "SalaryHistory",
          entityId: entry.id,
          action: "ADD_SALARY",
          userId,
          ipAddress,
          userAgent,
          oldValue: Prisma.JsonNull,
          newValue: {
            employeeId,
            effectiveFrom: input.effectiveFrom,
            amount: input.amount,
            currency: input.currency,
          },
        },
      });

      return serializeSalary(entry);
    });
  },

  // ── count — cantidad de empleados activos ────────────────────────────────
  async countActive(companyId: string): Promise<number> {
    return prisma.employee.count({ where: { companyId, status: "ACTIVE" } });
  },
};
