"use server";

// src/modules/ocr/actions/ocr.actions.ts
//
// OCR-v2: migrado de Groq+Tesseract a Gemini Vision directo.
// Flujo: base64 → GeminiOCRService.extractFromImage → ExtractedInvoice (campos VEN-NIF)
//
// ADR-006 D-1: auth → checkRateLimit → safeParse → companyMember → lógica

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { z } from "zod";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { GeminiOCRService } from "../services/GeminiOCRService";
import { ExtractedInvoiceSchema, type ExtractedInvoice } from "../schemas/invoice.schema";
import { generateOcrDraftPDF } from "../services/OcrDraftPDFService";
import prisma from "@/lib/prisma";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Input schema ─────────────────────────────────────────────────────────────

const Schema = z.object({
  companyId: z.string().min(1, { error: "companyId requerido" }),
  // 14 MB cap (10 MB image + ~33% base64 overhead) — client enforces 10 MB but server must too
  base64: z.string().min(1, { error: "Imagen requerida" }).max(14_000_000, { error: "La imagen no puede superar 10 MB" }),
  mimeType: z
    .enum(["image/jpeg", "image/png", "image/webp"])
    .catch("image/jpeg"),
});

// ─── Server Action ────────────────────────────────────────────────────────────

/**
 * Extrae datos de una factura venezolana directamente desde base64.
 * Utiliza Gemini Vision (Plan Pro) en lugar del flujo Tesseract+Groq.
 *
 * @param companyId  ID de empresa (membership check)
 * @param base64     Imagen en base64 sin prefijo data:...;base64,
 * @param mimeType   Tipo MIME (image/jpeg | image/png | image/webp)
 */
export async function extractInvoiceAction(
  companyId: string,
  base64: string,
  mimeType: string = "image/jpeg",
): Promise<ActionResult<ExtractedInvoice>> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. Rate limit (12/min — margen sobre límite gratuito Gemini 15 RPM)
  const rl = await checkRateLimit(userId, limiters.ocr);
  if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes. Intenta más tarde." };

  // 3. Validar input
  const parsed = Schema.safeParse({ companyId, base64, mimeType });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // 4. Verificar membresía (cualquier rol puede usar OCR)
  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) {
    return { success: false, error: "Empresa no encontrada o acceso denegado" };
  }

  // 5. Verificar que GEMINI_API_KEY esté configurada
  if (!process.env.GEMINI_API_KEY) {
    return { success: false, error: "OCR no disponible — GEMINI_API_KEY no configurada" };
  }

  // Capturar IP/UA para AuditLog (R-6)
  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const data = await GeminiOCRService.extractFromImage(
      parsed.data.base64,
      parsed.data.mimeType,
    );

    // R-6: Registrar cada escaneo OCR como evento de trazabilidad fiscal.
    // El operador asumió la responsabilidad de confidencialidad (COT Art. 126)
    // al confirmar el aviso de privacidad en la UI antes de enviar la imagen.
    await prisma.auditLog.create({
      data: {
        companyId: parsed.data.companyId,
        entityName: "OCR",
        entityId: parsed.data.companyId,
        action: "OCR_SCAN",
        userId,
        ipAddress,
        userAgent,
        newValue: {
          mimeType: parsed.data.mimeType,
          hasCriticalRisks: (data._fieldRisks ?? []).some(r => r.severity === "critical"),
          extractedRif: data.rif ?? null,
          extractedNumeroControl: data.numeroControl ?? null,
        },
      },
    }).catch(() => { /* audit no bloquea si falla */ });

    return { success: true, data };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Exportar PDF borrador OCR ────────────────────────────────────────────────

const ExportPDFSchema = z.object({
  companyId: z.string().min(1, { error: "companyId requerido" }),
  extracted: ExtractedInvoiceSchema,
});

/**
 * Genera un comprobante PDF "BORRADOR" con los datos extraídos por OCR.
 * No persiste nada en base de datos — solo genera el PDF para descarga.
 */
export async function exportOcrDraftPDFAction(
  companyId: string,
  extracted: ExtractedInvoice,
): Promise<ActionResult<{ pdf: string; filename: string }>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const parsed = ExportPDFSchema.safeParse({ companyId, extracted });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const member = await prisma.companyMember.findFirst({
    where: { companyId: parsed.data.companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

  try {
    const company = await prisma.company.findUnique({
      where: { id: parsed.data.companyId },
      select: { name: true, rif: true, address: true },
    });

    const buffer = await generateOcrDraftPDF({
      extracted: parsed.data.extracted,
      companyName: company?.name ?? "Empresa",
      companyRif: company?.rif ?? "",
      companyAddress: company?.address ?? null,
      extractedAt: new Date(),
    });

    const invoiceNum = parsed.data.extracted.numeroFactura
    const filename = `OCR-Borrador${invoiceNum ? `-${invoiceNum}` : ""}.pdf`

    return {
      success: true,
      data: { pdf: buffer.toString("base64"), filename },
    }
  } catch (error) {
    // No filtrar errores técnicos crudos al cliente (sanitización central).
    return toActionError(error);
  }
}
