// src/modules/payroll/actions/payroll-reports.actions.ts
// Fase NOM-E: Server Actions de reportes legales de nómina (read-only)
//
// Seguridad (ADR-006):
//   - Todas las actions: auth → companyId guard (tenant check) → ACCOUNTING role
//   - PDF exports: limiters.export (3 por 10 minutos) para prevenir generación masiva
//   - Sin $transaction (sin escrituras)
//   - Sin AuditLog (sin mutaciones)
//   - PDFs: retornados como base64 (patrón exportForma30PDFAction)
//   - exportArcPdfAction: verifica que employeeId pertenezca a companyId (IDOR guard)

"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import {
  PayrollReportService,
  type IvssReportData,
  type BanavihReportData,
  type IncesReportData,
  type ArcReportData,
} from "../services/PayrollReportService";
import { PayrollPdfReportService, type ConstanciaTrabajoData } from "../services/PayrollPdfReportService";
import { PayrollBankTxtService } from "../services/PayrollBankTxtService";
import { MintraReportService } from "../services/MintraReportService";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

type PdfResult = { success: true; buffer: string } | { success: false; error: string };
type TxtResult = { success: true; txt: string; filename: string } | { success: false; error: string };

// ─── Helper de auth + companyId guard ────────────────────────────────────────

async function resolveAccounting(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, ok: false as const };
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
    select: { role: true },
  });
  if (!member) return { userId, ok: false as const };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) return { userId, ok: false as const };
  return { userId, ok: true as const };
}

// ─── IVSS ─────────────────────────────────────────────────────────────────────

export async function getIvssReportAction(
  companyId: string,
  year: number,
  month: number
): Promise<ActionResult<IvssReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIvssReport(companyId, year, month);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

export async function exportIvssPdfAction(
  companyId: string,
  year: number,
  month: number
): Promise<PdfResult> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getIvssReport(companyId, year, month);
    const buffer = await PayrollPdfReportService.generateIvssPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── Banavih/FAOV ─────────────────────────────────────────────────────────────

export async function getBanavihReportAction(
  companyId: string,
  year: number,
  month: number
): Promise<ActionResult<BanavihReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getBanavihReport(companyId, year, month);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

export async function exportBanavihPdfAction(
  companyId: string,
  year: number,
  month: number
): Promise<PdfResult> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getBanavihReport(companyId, year, month);
    const buffer = await PayrollPdfReportService.generateBanavihPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── INCES ────────────────────────────────────────────────────────────────────

export async function getIncesReportAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<ActionResult<IncesReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIncesReport(companyId, year, quarter);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

export async function exportIncesPdfAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<PdfResult> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getIncesReport(companyId, year, quarter);
    const buffer = await PayrollPdfReportService.generateIncesPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── ARC/ISLR ─────────────────────────────────────────────────────────────────

export async function getArcReportAction(
  companyId: string,
  employeeId: string,
  year: number
): Promise<ActionResult<ArcReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  // IDOR guard: verificar que el empleado pertenezca a la empresa
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true },
  });
  if (!emp) return { success: false, error: "Empleado no encontrado" };

  try {
    const data = await PayrollReportService.getArcReport(companyId, employeeId, year);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

export async function exportArcPdfAction(
  companyId: string,
  employeeId: string,
  year: number
): Promise<PdfResult> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  // IDOR guard
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true },
  });
  if (!emp) return { success: false, error: "Empleado no encontrado" };

  try {
    const data = await PayrollReportService.getArcReport(companyId, employeeId, year);
    const buffer = await PayrollPdfReportService.generateArcPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── Excel IVSS ───────────────────────────────────────────────────────────────

export async function exportIvssExcelAction(
  companyId: string,
  year: number,
  month: number
): Promise<{ success: true; buffer: string } | { success: false; error: string }> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getIvssReport(companyId, year, month);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("IVSS");
    ws.columns = [
      { header: "Apellidos y Nombres", key: "name", width: 32 },
      { header: "Cédula", key: "ci", width: 14 },
      { header: "Semanas", key: "weeks", width: 10 },
      { header: "Salario Base", key: "salBase", width: 18 },
      { header: "IVSS Obrero (4%)", key: "worker", width: 18 },
      { header: "IVSS Patronal (9%)", key: "employer", width: 18 },
      { header: "Total IVSS", key: "total", width: 18 },
    ];
    for (const r of data.rows) {
      ws.addRow({
        name: `${r.lastName}, ${r.firstName}`,
        ci: `${r.cedulaType}-${r.cedulaNumber}`,
        weeks: r.weeksWorked,
        salBase: parseFloat(r.salaryBase.toString()),
        worker: parseFloat(r.ivssWorkerAmount.toString()),
        employer: parseFloat(r.ivssEmployerAmount.toString()),
        total: parseFloat(r.ivssTotalAmount.toString()),
      });
    }
    ws.addRow({ name: "TOTALES", worker: parseFloat(data.totalWorkerAmount.toString()), employer: parseFloat(data.totalEmployerAmount.toString()), total: parseFloat(data.totalAmount.toString()) });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { success: true, buffer: buf.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── Excel FAOV ───────────────────────────────────────────────────────────────

export async function exportBanavihExcelAction(
  companyId: string,
  year: number,
  month: number
): Promise<{ success: true; buffer: string } | { success: false; error: string }> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getBanavihReport(companyId, year, month);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("FAOV");
    ws.columns = [
      { header: "Apellidos y Nombres", key: "name", width: 32 },
      { header: "Cédula", key: "ci", width: 14 },
      { header: "Salario Base", key: "salBase", width: 18 },
      { header: "FAOV Trabajador (1%)", key: "worker", width: 20 },
      { header: "FAOV Patronal (1%)", key: "employer", width: 20 },
      { header: "Total FAOV", key: "total", width: 18 },
    ];
    for (const r of data.rows) {
      ws.addRow({
        name: `${r.lastName}, ${r.firstName}`,
        ci: `${r.cedulaType}-${r.cedulaNumber}`,
        salBase: parseFloat(r.salaryBase.toString()),
        worker: parseFloat(r.faovWorkerAmount.toString()),
        employer: parseFloat(r.faovEmployerAmount.toString()),
        total: parseFloat(r.faovTotalAmount.toString()),
      });
    }
    ws.addRow({ name: "TOTALES", worker: parseFloat(data.totalWorkerAmount.toString()), employer: parseFloat(data.totalEmployerAmount.toString()), total: parseFloat(data.totalAmount.toString()) });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { success: true, buffer: buf.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── Excel INCES ──────────────────────────────────────────────────────────────

export async function exportIncesExcelAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<{ success: true; buffer: string } | { success: false; error: string }> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const data = await PayrollReportService.getIncesReport(companyId, year, quarter);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("INCES");
    ws.columns = [
      { header: "Apellidos y Nombres", key: "name", width: 32 },
      { header: "Cédula", key: "ci", width: 14 },
      { header: "Salario Trim.", key: "salBase", width: 18 },
      { header: "INCES Obrero (2%)", key: "worker", width: 20 },
      { header: "Utilidades Año", key: "profit", width: 18 },
    ];
    for (const r of data.rows) {
      ws.addRow({
        name: `${r.lastName}, ${r.firstName}`,
        ci: `${r.cedulaType}-${r.cedulaNumber}`,
        salBase: parseFloat(r.salaryBase.toString()),
        worker: parseFloat(r.incesWorkerAmount.toString()),
        profit: parseFloat(r.profitAmount.toString()),
      });
    }
    ws.addRow({ name: "TOTALES — Aporte patronal utilidades (0.5%)", worker: parseFloat(data.totalWorkerAmount.toString()), profit: parseFloat(data.totalEmployerProfitContrib.toString()) });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { success: true, buffer: buf.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── Constancia de Trabajo IVSS (Forma 14-100) ────────────────────────────────

export async function exportConstanciaTrabajoAction(
  companyId: string,
  employeeId: string
): Promise<PdfResult> {
  const { userId, ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: rl.error };

  try {
    const [company, emp] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, rif: true } }),
      prisma.employee.findFirstOrThrow({
        where: { id: employeeId, companyId },
        select: {
          firstName: true, lastName: true, cedulaType: true, cedulaNumber: true,
          ivssNumber: true, position: true, payrollWorkerType: true,
          contractType: true, hireDate: true, terminationDate: true,
          salaryHistory: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { amount: true } },
        },
      }),
    ]);

    const data: ConstanciaTrabajoData = {
      companyName: company.name,
      companyRif: company.rif ?? "No registrado",
      employeeName: `${emp.lastName} ${emp.firstName}`,
      cedulaType: emp.cedulaType,
      cedulaNumber: emp.cedulaNumber,
      ivssNumber: emp.ivssNumber,
      position: emp.position,
      payrollWorkerType: emp.payrollWorkerType,
      contractType: emp.contractType,
      hireDate: new Date(emp.hireDate).toISOString().slice(0, 10),
      terminationDate: emp.terminationDate ? new Date(emp.terminationDate).toISOString().slice(0, 10) : null,
      salaryMensual: emp.salaryHistory[0]?.amount?.toString() ?? "0.00",
      issueDate: new Date().toISOString().slice(0, 10),
    };

    const buffer = await PayrollPdfReportService.generateConstanciaPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── TXT BANAVIH (FAOV-Web) ───────────────────────────────────────────────────

export async function exportBanavihTxtAction(
  companyId: string,
  year: number,
  month: number
): Promise<TxtResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const txt = await PayrollBankTxtService.generateBanavihTxt(companyId, year, month);
    const filename = `BANAVIH_FAOV_${year}_${String(month).padStart(2, "0")}.txt`;
    return { success: true, txt, filename };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}

// ─── CSV MINTRA (Declaración Trimestral) ──────────────────────────────────────

export async function exportMintraCsvAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<TxtResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const result = await MintraReportService.generateCsv(companyId, year, quarter);
    const filename = `MINTRA_T${quarter}_${year}.csv`;
    return { success: true, txt: result.csv, filename };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}
