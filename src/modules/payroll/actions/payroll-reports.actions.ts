// src/modules/payroll/actions/payroll-reports.actions.ts
// Fase NOM-E: Server Actions de reportes legales de nómina (read-only)
//
// Seguridad (ADR-006):
//   - Todas las actions: auth → companyId guard (tenant check) → ACCOUNTING role
//   - Sin rate limiting de mutación (read-only — no aplica limiters.fiscal)
//   - Sin $transaction (sin escrituras)
//   - Sin AuditLog (sin mutaciones)
//   - PDFs: retornados como base64 (patrón exportForma30PDFAction)
//   - exportArcPdfAction: verifica que employeeId pertenezca a companyId (IDOR guard)

"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import {
  PayrollReportService,
  type IvssReportData,
  type BanavihReportData,
  type IncesReportData,
  type ArcReportData,
} from "../services/PayrollReportService";
import { PayrollPdfReportService } from "../services/PayrollPdfReportService";

type Result<T> = { success: true; data: T } | { success: false; error: string };
type PdfResult = { success: true; buffer: string } | { success: false; error: string };

// ─── Helper de auth + companyId guard ────────────────────────────────────────

async function resolveAccounting(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, ok: false };
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
    select: { role: true },
  });
  if (!member) return { userId, ok: false };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) return { userId, ok: false };
  return { userId, ok: true };
}

// ─── IVSS ─────────────────────────────────────────────────────────────────────

export async function getIvssReportAction(
  companyId: string,
  year: number,
  month: number
): Promise<Result<IvssReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIvssReport(companyId, year, month);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar reporte IVSS" };
  }
}

export async function exportIvssPdfAction(
  companyId: string,
  year: number,
  month: number
): Promise<PdfResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIvssReport(companyId, year, month);
    const buffer = await PayrollPdfReportService.generateIvssPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar PDF IVSS" };
  }
}

// ─── Banavih/FAOV ─────────────────────────────────────────────────────────────

export async function getBanavihReportAction(
  companyId: string,
  year: number,
  month: number
): Promise<Result<BanavihReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getBanavihReport(companyId, year, month);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar reporte Banavih" };
  }
}

export async function exportBanavihPdfAction(
  companyId: string,
  year: number,
  month: number
): Promise<PdfResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getBanavihReport(companyId, year, month);
    const buffer = await PayrollPdfReportService.generateBanavihPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar PDF Banavih" };
  }
}

// ─── INCES ────────────────────────────────────────────────────────────────────

export async function getIncesReportAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<Result<IncesReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIncesReport(companyId, year, quarter);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar reporte INCES" };
  }
}

export async function exportIncesPdfAction(
  companyId: string,
  year: number,
  quarter: number
): Promise<PdfResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  try {
    const data = await PayrollReportService.getIncesReport(companyId, year, quarter);
    const buffer = await PayrollPdfReportService.generateIncesPdf(data);
    return { success: true, buffer: buffer.toString("base64") };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar PDF INCES" };
  }
}

// ─── ARC/ISLR ─────────────────────────────────────────────────────────────────

export async function getArcReportAction(
  companyId: string,
  employeeId: string,
  year: number
): Promise<Result<ArcReportData>> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

  // IDOR guard: verificar que el empleado pertenece a la empresa
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true },
  });
  if (!emp) return { success: false, error: "Empleado no encontrado" };

  try {
    const data = await PayrollReportService.getArcReport(companyId, employeeId, year);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al generar ARC" };
  }
}

export async function exportArcPdfAction(
  companyId: string,
  employeeId: string,
  year: number
): Promise<PdfResult> {
  const { ok } = await resolveAccounting(companyId);
  if (!ok) return { success: false, error: "No autorizado" };

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
    return { success: false, error: err instanceof Error ? err.message : "Error al generar PDF ARC" };
  }
}
