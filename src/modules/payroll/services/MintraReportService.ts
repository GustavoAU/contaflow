// src/modules/payroll/services/MintraReportService.ts
// Declaración Trimestral MINTRA — CSV para el Ministerio del Trabajo.
//
// Datos fijos: empresa (RIF, nombre, CIIU, dirección)
// Datos variables por empleado: cédula, nombre, cargo, contrato, sexo,
//   fecha ingreso/egreso, días trabajados, salario mensual.
// Formato: semicolón-delimitado, UTF-8, compatible con sistema MINTRA.

import prisma from "@/lib/prisma";

export interface MintraCsvResult {
  csv: string;
  totalEmployees: number;
  quarter: number;
  year: number;
}

// Meses del trimestre (1-based)
function quarterMonths(quarter: number): number[] {
  const base = (quarter - 1) * 3 + 1;
  return [base, base + 1, base + 2];
}

// Días del mes (para días trabajados)
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const MintraReportService = {
  async generateCsv(companyId: string, year: number, quarter: number): Promise<MintraCsvResult> {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, rif: true, address: true, ciiu: true },
    });

    const months = quarterMonths(quarter);
    const periodStart = new Date(Date.UTC(year, months[0] - 1, 1));
    const periodEnd = new Date(Date.UTC(year, months[2], 0));

    // Empleados activos o con terminationDate dentro del trimestre
    const employees = await prisma.employee.findMany({
      where: {
        companyId,
        OR: [
          { status: "ACTIVE" },
          {
            status: "TERMINATED",
            terminationDate: { gte: periodStart, lte: periodEnd },
          },
        ],
      },
      include: {
        salaryHistory: {
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    // Días trabajados: para ACTIVE = totalDías del trimestre; TERMINATED = hasta terminationDate
    const totalDaysInQuarter = months.reduce((s, m) => s + daysInMonth(year, m), 0);

    const header = [
      "RIF_PATRONO",
      "NOMBRE_PATRONO",
      "CIIU",
      "TRIMESTRE",
      "AÑO",
      "CEDULA",
      "NOMBRES",
      "APELLIDOS",
      "CARGO",
      "TIPO_CONTRATO",
      "REGIMEN",
      "FECHA_INGRESO",
      "FECHA_EGRESO",
      "DIAS_TRABAJADOS",
      "SALARIO_MENSUAL",
    ].join(";");

    const rifPatrono = company.rif ?? "J-00000000-0";
    const nomPatrono = (company.name ?? "").toUpperCase().replace(/;/g, ",");
    const ciiuCode = company.ciiu ?? "";

    const rows = employees.map((emp) => {
      const lastSalary = emp.salaryHistory[0];
      const salaryMensual = lastSalary ? parseFloat(lastSalary.amount.toString()).toFixed(2) : "0.00";

      let diasTrabajados = totalDaysInQuarter;
      let fechaEgreso = "";
      if (emp.terminationDate) {
        const termDate = new Date(emp.terminationDate);
        if (termDate <= periodEnd) {
          // Calcular días efectivos hasta egreso
          const termMonthIdx = termDate.getUTCMonth() + 1;
          const termDay = termDate.getUTCDate();
          let daysWorked = 0;
          for (const m of months) {
            if (m < termMonthIdx) daysWorked += daysInMonth(year, m);
            else if (m === termMonthIdx) daysWorked += termDay;
          }
          diasTrabajados = daysWorked;
          fechaEgreso = termDate.toISOString().slice(0, 10);
        }
      }

      return [
        rifPatrono,
        nomPatrono,
        ciiuCode,
        `T${quarter}`,
        String(year),
        `${emp.cedulaType}-${emp.cedulaNumber}`,
        emp.firstName.toUpperCase().replace(/;/g, " "),
        emp.lastName.toUpperCase().replace(/;/g, " "),
        (emp.position ?? "").toUpperCase().replace(/;/g, " "),
        emp.contractType,
        emp.employeeRegime,
        new Date(emp.hireDate).toISOString().slice(0, 10),
        fechaEgreso,
        String(diasTrabajados),
        salaryMensual,
      ].join(";");
    });

    const csv = [header, ...rows].join("\r\n");

    return {
      csv,
      totalEmployees: employees.length,
      quarter,
      year,
    };
  },
};
