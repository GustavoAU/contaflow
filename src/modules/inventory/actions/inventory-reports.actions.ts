"use server";
// src/modules/inventory/actions/inventory-reports.actions.ts
// Reportes de inventario — solo lectura. Requiere rol ACCOUNTING.

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import {
  InventoryReportService,
  type StockSummary,
  type MovementReportItem,
  type RotationReportItem,
} from "../services/InventoryReportService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Resumen de existencias ───────────────────────────────────────────────────

export async function getStockSummaryAction(
  companyId: string
): Promise<ActionResult<StockSummary>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Acceso denegado" };
  }

  try {
    const data = await InventoryReportService.getStockSummary(companyId);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener reporte de existencias" };
  }
}

// ─── Reporte de movimientos ───────────────────────────────────────────────────

export async function getMovementReportAction(
  companyId: string,
  from: string,    // ISO date "YYYY-MM-DD"
  to: string,      // ISO date "YYYY-MM-DD"
  type?: string,
  itemId?: string,
  status?: string
): Promise<ActionResult<MovementReportItem[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Acceso denegado" };
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { success: false, error: "Fechas inválidas" };
  }
  if (fromDate > toDate) {
    return { success: false, error: "La fecha inicial no puede ser mayor a la final" };
  }

  try {
    const data = await InventoryReportService.getMovementReport(companyId, {
      from: fromDate,
      to: toDate,
      type: type || undefined,
      itemId: itemId || undefined,
      status: status || undefined,
    });
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener reporte de movimientos" };
  }
}

// ─── Reporte de rotación y ventas ─────────────────────────────────────────────

export async function getRotationReportAction(
  companyId: string,
  from: string,   // ISO date "YYYY-MM-DD"
  to: string      // ISO date "YYYY-MM-DD"
): Promise<ActionResult<RotationReportItem[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Acceso denegado" };
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { success: false, error: "Fechas inválidas" };
  }
  if (fromDate > toDate) {
    return { success: false, error: "La fecha inicial no puede ser mayor a la final" };
  }

  try {
    const data = await InventoryReportService.getRotationReport(companyId, fromDate, toDate);
    return { success: true, data };
  } catch {
    return { success: false, error: "Error al obtener reporte de rotación" };
  }
}
