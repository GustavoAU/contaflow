"use server";

// src/modules/documents/actions/document.actions.ts
// Q3-1: Server Actions para Gestión Documental.
// R-6: ipAddress + userAgent en AuditLog de operaciones relevantes.

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { signDocShareToken } from "@/lib/document-share-jwt";
import type { DocShareType } from "@/lib/document-share-jwt";
import { DocumentService, type DocumentRow, type DocumentFilters } from "../services/DocumentService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

async function resolveIpUa() {
  const h = await headers();
  const ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const userAgent = h.get("user-agent") ?? null;
  return { ipAddress, userAgent };
}

const FiltersSchema = z.object({
  docType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().max(100).optional(),
  page: z.number().int().min(1).optional(),
});

// ─── Listar documentos ────────────────────────────────────────────────────────
export async function listDocumentsAction(
  companyId: string,
  rawFilters: unknown,
): Promise<ActionResult<{ items: DocumentRow[]; total: number; page: number }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // VIEWER y superiores pueden ver documentos
    if (!canAccess(member.role, ROLES.ALL)) return { success: false, error: "No autorizado" };

    const parsed = FiltersSchema.safeParse(rawFilters);
    if (!parsed.success) return { success: false, error: "Filtros inválidos" };

    const { page = 1, ...filters } = parsed.data;
    const result = await DocumentService.list(companyId, filters as DocumentFilters, page);

    return { success: true, data: { ...result, page } };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Generar link temporal firmado (7 días) ───────────────────────────────────
// El link permite que un auditor SENIAT descargue el PDF sin acceder al app.
// R-6: AuditLog de la generación del link (trazabilidad de qué se compartió y cuándo).
export async function generateDocShareTokenAction(
  companyId: string,
  docType: DocShareType,
  docId: string,
): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    // Solo OWNER/ADMIN/ACCOUNTANT pueden compartir documentos
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "No autorizado" };

    // Verificar que el documento pertenece a esta empresa (ADR-004 cross-tenant guard)
    if (docType === "INVOICE") {
      const exists = await prisma.invoice.findFirst({
        where: { id: docId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return { success: false, error: "Documento no encontrado" };
    } else if (docType === "RETENTION") {
      const exists = await prisma.retencion.findFirst({
        where: { id: docId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return { success: false, error: "Documento no encontrado" };
    } else {
      return { success: false, error: "Tipo de documento inválido" };
    }

    const { token, jti } = signDocShareToken(docType, docId, companyId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const url = `${appUrl}/api/doc/${token}`;
    const expiresAtDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString();

    // AuditLog + DocShareToken en mismo $transaction (R-6 + M6 revocación)
    const { ipAddress, userAgent } = await resolveIpUa();

    await prisma.$transaction([
      prisma.docShareToken.create({
        data: { companyId, jti, docType, docId, createdBy: userId, expiresAt: expiresAtDate },
      }),
      prisma.auditLog.create({
        data: {
          companyId,
          entityId: docId,
          entityName: docType === "INVOICE" ? "Invoice" : "Retencion",
          action: "DOC_SHARED",
          userId,
          ipAddress,
          userAgent,
          newValue: { docType, expiresAt, jti },
        },
      }),
    ]);

    revalidatePath(`/company/${companyId}/documents`);
    return { success: true, data: { url, expiresAt } };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Revocar link temporal (M6) ───────────────────────────────────────────────
export async function revokeDocShareTokenAction(
  companyId: string,
  jti: string,
): Promise<ActionResult<{ revoked: true }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "No autorizado" };

    const record = await prisma.docShareToken.findFirst({
      where: { jti, companyId },
      select: { id: true, revokedAt: true },
    });
    if (!record) return { success: false, error: "Token no encontrado" };
    if (record.revokedAt) return { success: false, error: "El enlace ya estaba revocado" };

    const { ipAddress, userAgent } = await resolveIpUa();

    await prisma.$transaction([
      prisma.docShareToken.update({
        where: { jti },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          companyId,
          entityId: record.id,
          entityName: "DocShareToken",
          action: "DOC_SHARE_REVOKED",
          userId,
          ipAddress,
          userAgent,
          newValue: { jti, revokedAt: new Date().toISOString() },
        },
      }),
    ]);

    revalidatePath(`/company/${companyId}/documents`);
    return { success: true, data: { revoked: true } };
  } catch (err) {
    return toActionError(err);
  }
}
