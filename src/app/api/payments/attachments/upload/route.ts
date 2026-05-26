// src/app/api/payments/attachments/upload/route.ts
// ADR-029: handleUpload para adjuntos de comprobante de pago
//
// IMPORTANTE: el handler se invoca en DOS fases distintas:
//   Fase 1 (type="blob.generate-client-token"): el browser pide un token firmado.
//              → aquí aplica Clerk auth + guards de negocio.
//   Fase 2 (type="blob.upload-completed"): Vercel Blob CDN llama de vuelta.
//              → NO lleva cookies de Clerk. Auth se valida por firma Vercel Blob.
//              → NO aplicar auth() en esta fase o devuelve 401 y upload cuelga.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { PaymentAttachmentService } from "@/modules/payments/services/PaymentAttachmentService";
import {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
} from "@/modules/payments/constants/payment-attachment.constants";
import path from "path";

export const runtime = "nodejs"; // handleUpload incompatible con Edge Runtime

// ─── POST /api/payments/attachments/upload ────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Degradación graceful — BLOB_READ_WRITE_TOKEN ausente
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Adjuntos no disponibles en esta configuración" },
      { status: 503 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  const responseBody = await handleUpload({
    body,
    request,

    // ── Fase 1: generar token de upload ──────────────────────────────────────
    // Esta función SOLO se llama cuando type === "blob.generate-client-token".
    // Aquí sí aplica Clerk auth y guards de negocio.
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // ── Auth Clerk ────────────────────────────────────────────────────────
      const { userId } = await auth();
      if (!userId) throw new Error("No autorizado");

      const h = await headers();
      const ipAddress =
        h.get("x-real-ip") ??
        h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
        null;
      const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

      // ── Rate limiting (ADR-006 D-5) ───────────────────────────────────────
      const rl = await checkRateLimit(userId, limiters.fiscal);
      if (!rl.allowed) {
        throw new Error("Demasiadas solicitudes. Intenta de nuevo más tarde.");
      }

      // ── Parsear clientPayload ─────────────────────────────────────────────
      let parsed: {
        companyId?: string;
        paymentRecordId?: string;
        contentType?: string;
        contentHash?: string;
        fileSize?: number;
      } = {};
      try {
        parsed = JSON.parse(clientPayload ?? "{}") as typeof parsed;
      } catch {
        throw new Error("Payload inválido");
      }

      const companyId = parsed.companyId ?? "";
      const paymentRecordId = parsed.paymentRecordId ?? "";
      const contentHash = parsed.contentHash ?? "";
      const fileSize = parsed.fileSize ?? 0;
      const declaredContentType = parsed.contentType ?? "";

      if (!companyId || !paymentRecordId) {
        throw new Error("companyId y paymentRecordId son requeridos");
      }

      // ── MIME type (ADR-029 D-4) ───────────────────────────────────────────
      if (
        declaredContentType &&
        !ALLOWED_MIME_TYPES.includes(
          declaredContentType as (typeof ALLOWED_MIME_TYPES)[number],
        )
      ) {
        throw new Error("Tipo de archivo no permitido. Use PDF, JPEG, PNG o WebP.");
      }

      // ── Membership + role guard (ADR-004, ADR-006 D-1) ───────────────────
      const member = await prisma.companyMember.findFirst({
        where: { companyId, userId },
        select: { role: true },
      });
      if (!member) throw new Error("Empresa no encontrada o acceso denegado");
      if (!canAccess(member.role, ROLES.WRITERS)) {
        throw new Error("No autorizado para adjuntar comprobantes");
      }

      // ── PaymentRecord pertenece a companyId y no está anulado ─────────────
      const record = await prisma.paymentRecord.findFirst({
        where: { id: paymentRecordId, companyId },
        select: { deletedAt: true },
      });
      if (!record) throw new Error("Pago no encontrado o no pertenece a esta empresa");
      if (record.deletedAt !== null) {
        throw new Error("No se puede adjuntar un comprobante a un pago anulado");
      }

      // ── Máximo 1 adjunto activo por PaymentRecord (ADR-029 D-5) ──────────
      const existing = await prisma.paymentAttachment.findFirst({
        where: { paymentRecordId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new Error(
          "Este pago ya tiene un comprobante adjunto. Elimine el actual antes de subir uno nuevo.",
        );
      }

      // ── Pathname aislado por tenant (ADR-004) ─────────────────────────────
      const ext = path.extname(pathname).toLowerCase() || ".bin";
      const safePath = `${companyId}/payments/${paymentRecordId}/${crypto.randomUUID()}${ext}`;

      return {
        allowedContentTypes: [...ALLOWED_MIME_TYPES],
        maximumSizeInBytes: MAX_SIZE_BYTES,
        pathname: safePath,
        addRandomSuffix: false,
        tokenPayload: JSON.stringify({
          companyId,
          paymentRecordId,
          contentHash,
          fileSize,
          uploadedBy: userId,
          ipAddress,
          userAgent,
          originalFileName: pathname,
        }),
      };
    },

    // ── Fase 2: upload completado ─────────────────────────────────────────────
    // Llamado por Vercel Blob CDN (producción) o por el browser SDK (desarrollo).
    // NO aplica Clerk auth — la autenticación es la firma de Vercel Blob.
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      try {
        const payload = JSON.parse(tokenPayload ?? "{}") as {
          companyId: string;
          paymentRecordId: string;
          contentHash: string;
          fileSize: number;
          uploadedBy: string;
          ipAddress: string | null;
          userAgent: string | null;
          originalFileName: string;
        };

        const ext = path.extname(blob.pathname).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".pdf": "application/pdf",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
        };
        const mimeType = mimeMap[ext] ?? "application/octet-stream";

        await PaymentAttachmentService.persistAttachmentMetadata({
          companyId: payload.companyId,
          paymentRecordId: payload.paymentRecordId,
          fileName: payload.originalFileName,
          mimeType,
          sizeBytes: payload.fileSize,
          blobUrl: blob.url,
          blobKey: blob.pathname,
          contentHash: payload.contentHash,
          uploadedBy: payload.uploadedBy,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
        });
      } catch (err) {
        // Loguear el error pero NO lanzar — si onUploadCompleted falla el blob
        // ya está en Vercel. El registro en BD puede reintentarse manualmente.
        console.error("[PaymentAttachment] onUploadCompleted error:", err);
      }
    },
  });

  return NextResponse.json(responseBody);
}
