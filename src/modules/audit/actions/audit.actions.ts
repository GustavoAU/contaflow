"use server";

// src/modules/audit/actions/audit.actions.ts
// Consulta paginada del AuditLog — solo OWNER/ADMIN
// OM-04: exportAuditLogPDFAction — PDF firmado digitalmente (R-2 contentHash en AuditLog)

import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import { limiters } from "@/lib/ratelimit";
import { createHash } from "crypto";
import { AuditLogService, type AuditLogFilters, type AuditLogPage } from "../services/AuditLogService";
import { generateAuditLogPDF } from "../services/AuditLogPDFService";
import { DocumentSigningService } from "@/modules/certificates/services/DocumentSigningService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Guard compartido ─────────────────────────────────────────────────────────
// Verifica auth, rate limit, membresía y rol ADMIN_ONLY para todas las acciones
// de auditoría. Retorna { userId } si el acceso está permitido.

type AuditGuardResult = { userId: string } | { success: false; error: string };

async function guardAuditAccess(companyId: string): Promise<AuditGuardResult> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
  });
  if (!ctx.ok) return ctx.error;
  return { userId: ctx.userId };
}

// ─── Listar registros de auditoría ────────────────────────────────────────────

export async function listAuditLogsAction(
  filters: Omit<AuditLogFilters, "companyId"> & { companyId: string }
): Promise<ActionResult<AuditLogPage>> {
  try {
    const guard = await guardAuditAccess(filters.companyId);
    if ("error" in guard) return guard;

    const data = await AuditLogService.list(filters);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Obtener nombres de entidades distintas ───────────────────────────────────

export async function getAuditEntityNamesAction(
  companyId: string
): Promise<ActionResult<string[]>> {
  try {
    const guard = await guardAuditAccess(companyId);
    if ("error" in guard) return guard;

    const names = await AuditLogService.getDistinctEntityNames(companyId);
    return { success: true, data: names };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── OM-04: Exportar Audit Log como PDF firmado ───────────────────────────────
// R-2: contentHash SHA-256 almacenado en AuditLog (no en Object Storage —
//      el contenido es derivable; la trazabilidad del export es lo que importa).
// ADR-020: firma digital si hay certificado activo; degradación graceful si no.

export type AuditLogPDFFilters = {
  entityName?: string;
  entityNames?: string[];
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
    const guard = await guardAuditAccess(companyId);
    if ("error" in guard) return guard;
    const { userId } = guard;

    const company = await prisma.company.findFirst({
      where: { id: companyId },
      select: { name: true, rif: true },
    });
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
    return toActionError(err);
  }
}

// ─── F-09: Exportar Audit Log como CSV ───────────────────────────────────────

type CSVExportResult = {
  csv: string;    // UTF-8 text
  filename: string;
  rowCount: number;
};

export async function exportAuditLogCSVAction(
  companyId: string,
  filters: AuditLogPDFFilters
): Promise<ActionResult<CSVExportResult>> {
  try {
    const guard = await guardAuditAccess(companyId);
    if ("error" in guard) return guard;
    const { userId } = guard;

    const rows = await AuditLogService.listAll({ companyId, ...filters });

    // Generar CSV (RFC 4180)
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["id", "fecha", "entidad", "accion", "entityId", "usuario", "cambios"].map(escape).join(",");
    const lines = rows.map((r) =>
      [
        r.id,
        new Date(r.createdAt).toISOString(),
        r.entityName,
        r.action,
        r.entityId,
        r.userId,
        JSON.stringify(r.newValue),
      ]
        .map(String)
        .map(escape)
        .join(",")
    );
    const csv = [header, ...lines].join("\r\n");

    // Registrar el export en AuditLog
    await prisma.auditLog.create({
      data: {
        companyId,
        entityId: companyId,
        entityName: "AuditLogExport",
        action: "EXPORT_CSV",
        userId,
        newValue: { rowCount: rows.length, filters },
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    const filename = `auditlog-${companyId.slice(-6)}-${today}.csv`;

    return { success: true, data: { csv, filename, rowCount: rows.length } };
  } catch (err) {
    return toActionError(err);
  }
}
