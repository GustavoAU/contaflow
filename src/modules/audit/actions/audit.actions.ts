"use server";

// src/modules/audit/actions/audit.actions.ts
// Consulta paginada del AuditLog — solo OWNER/ADMIN
// OM-04: exportAuditLogPDFAction — PDF firmado digitalmente (R-2 contentHash en AuditLog)

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { createHash } from "crypto";
import { AuditLogService, type AuditLogFilters, type AuditLogPage } from "../services/AuditLogService";
import { generateAuditLogPDF } from "../services/AuditLogPDFService";
import { DocumentSigningService } from "@/modules/certificates/services/DocumentSigningService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function listAuditLogsAction(
  filters: Omit<AuditLogFilters, "companyId"> & { companyId: string }
): Promise<ActionResult<AuditLogPage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: filters.companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo OWNER y ADMIN pueden ver el registro de auditoría" };
    }

    const data = await AuditLogService.list(filters);
    return { success: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al obtener el registro de auditoría";
    return { success: false, error: msg };
  }
}

export async function getAuditEntityNamesAction(
  companyId: string
): Promise<ActionResult<string[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "No autorizado" };
    }

    const names = await AuditLogService.getDistinctEntityNames(companyId);
    return { success: true, data: names };
  } catch {
    return { success: false, error: "Error al obtener entidades" };
  }
}

// ─── OM-04: Exportar Audit Log como PDF firmado ───────────────────────────────
// R-2: contentHash SHA-256 almacenado en AuditLog (no en Object Storage —
//      el contenido es derivable; la trazabilidad del export es lo que importa).
// ADR-020: firma digital si hay certificado activo; degradación graceful si no.

export type AuditLogPDFFilters = {
  entityName?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
};

type PDFExportResult = {
  pdf: string;        // base64
  filename: string;
  contentHash: string;
  signed: boolean;
  rowCount: number;
};

export async function exportAuditLogPDFAction(
  companyId: string,
  filters: AuditLogPDFFilters
): Promise<ActionResult<PDFExportResult>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const [member, company] = await Promise.all([
      prisma.companyMember.findUnique({
        where: { userId_companyId: { userId, companyId } },
        select: { role: true },
      }),
      prisma.company.findFirst({ where: { id: companyId }, select: { name: true, rif: true } }),
    ]);

    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo OWNER y ADMIN pueden exportar el registro de auditoría" };
    }
    if (!company) return { success: false, error: "Empresa no encontrada" };

    // Obtener todos los registros según filtros (hasta 1000)
    const rows = await AuditLogService.listAll({ companyId, ...filters });

    // Generar PDF preliminar para calcular el hash del contenido
    const previewPdf = await generateAuditLogPDF({
      rows,
      companyName: company.name,
      companyRif: company.rif,
      filters,
      exportedBy: userId,
      contentHash: "CALCULANDO...",
      signed: false,
    });

    // R-2: contentHash del PDF sin firma (hash del contenido puro)
    const contentHash = createHash("sha256").update(previewPdf).digest("hex");

    // ADR-020: intentar firma digital (degradación graceful si no hay certificado)
    let finalPdf: Buffer = previewPdf;
    let signed = false;
    let thumbprint: string | undefined;
    let signedAt: string | undefined;

    try {
      // Regenerar con hash correcto antes de firmar
      const pdfToSign = await generateAuditLogPDF({
        rows,
        companyName: company.name,
        companyRif: company.rif,
        filters,
        exportedBy: userId,
        contentHash,
        signed: false,
      });

      const signedDoc = await DocumentSigningService.signInvoicePDF(companyId, pdfToSign);
      finalPdf = signedDoc.pdf;
      signed = true;
      thumbprint = signedDoc.thumbprint;
      signedAt = signedDoc.signedAt;
    } catch {
      // Sin certificado configurado → exportar sin firma (solo con hash)
      finalPdf = await generateAuditLogPDF({
        rows,
        companyName: company.name,
        companyRif: company.rif,
        filters,
        exportedBy: userId,
        contentHash,
        signed: false,
      });
    }

    // R-2: registrar el export en AuditLog (inmutabilidad por apéndice)
    await prisma.auditLog.create({
      data: {
        companyId,
        entityId: companyId,
        entityName: "AuditLogExport",
        action: "EXPORT_PDF",
        userId,
        newValue: {
          contentHash,
          signed,
          thumbprint: thumbprint ?? null,
          signedAt: signedAt ?? null,
          rowCount: rows.length,
          filters,
        },
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `auditlog-${companyId.slice(-6)}-${today}.pdf`;

    return {
      success: true,
      data: {
        pdf: finalPdf.toString("base64"),
        filename,
        contentHash,
        signed,
        rowCount: rows.length,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al exportar el registro de auditoría";
    return { success: false, error: msg };
  }
}
