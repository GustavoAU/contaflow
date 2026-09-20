// src/app/api/payments/attachments/upload/route.ts
// ADR-029: handleUpload para adjuntos de comprobante de pago
//
// IMPORTANTE: el handler se invoca en DOS fases distintas:
//   Fase 1 (type="blob.generate-client-token"): el browser pide un token firmado.
//              → aquí aplica Clerk auth + guards de negocio.
//   Fase 2 (type="blob.upload-completed"): Vercel Blob CDN llama de vuelta.
//              → NO lleva cookies de Clerk. Auth se valida por firma Vercel Blob.
//              → NO aplicar auth() en esta fase o devuelve 401 y upload cuelga.
// La ruta es pública para el middleware (src/lib/public-routes.ts) por esa fase 2.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { PaymentAttachmentService } from "@/modules/payments/services/PaymentAttachmentService";
import {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
  isValidAttachmentPathname,
  sanitizeAttachmentFileName,
  type AllowedMimeType,
} from "@/modules/payments/constants/payment-attachment.constants";
import path from "path";
import { z } from "zod";

export const runtime = "nodejs"; // handleUpload incompatible con Edge Runtime

// El clientPayload viene del navegador: sin tipos estrictos, un objeto como companyId se cuela en los
// where de Prisma como filtro (ej. { not: "x" }) y evade la verificación de pertenencia.
const ID_RE = /^[A-Za-z0-9_-]+$/;
const ClientPayloadSchema = z.object({
  companyId: z.string().min(1).max(64).regex(ID_RE),
  paymentRecordId: z.string().min(1).max(64).regex(ID_RE),
  contentType: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/i),
  fileSize: z.number().int().min(1).max(MAX_SIZE_BYTES),
  fileName: z.string().max(255).optional(),
});

// Ventana corta: con addRandomSuffix un token reutilizado crea un blob nuevo cada vez.
const TOKEN_TTL_MS = 5 * 60_000;

// Rechazo intencional: su mensaje es seguro para el cliente. Cualquier otro error se responde genérico.
class UploadRejection extends Error {}

// ─── POST /api/payments/attachments/upload ────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Degradación graceful — BLOB_READ_WRITE_TOKEN ausente
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Adjuntos no disponibles en esta configuración" },
      { status: 503 },
    );
  }

  // Ruta pública para el middleware: sin sesión ni firma de Vercel no se hace nada más.
  const { userId: sessionUserId } = await auth();
  if (!sessionUserId && !request.headers.get("x-vercel-signature")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  try {
    const responseBody = await handleUpload({
      body,
      request,

      // ── Fase 1: generar token de upload ────────────────────────────────────
      // Esta función SOLO se llama cuando type === "blob.generate-client-token".
      // Aquí sí aplica Clerk auth y guards de negocio.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // ── Auth Clerk ──────────────────────────────────────────────────────
        // Repetido a propósito: una firma x-vercel-signature falsa no debe bastar para pedir un token.
        const { userId } = await auth();
        if (!userId) throw new UploadRejection("No autorizado");

        const h = await headers();
        const ipAddress =
          h.get("x-real-ip") ??
          h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
          null;
        const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

        // ── Rate limiting (ADR-006 D-5) ─────────────────────────────────────
        const rl = await checkRateLimit(userId, limiters.fiscal);
        if (!rl.allowed) {
          throw new UploadRejection("Demasiadas solicitudes. Intenta de nuevo más tarde.");
        }

        // ── Parsear clientPayload ───────────────────────────────────────────
        let rawPayload: unknown;
        try {
          rawPayload = JSON.parse(clientPayload ?? "{}");
        } catch {
          throw new UploadRejection("Payload inválido");
        }
        const validated = ClientPayloadSchema.safeParse(rawPayload);
        if (!validated.success) throw new UploadRejection("Payload inválido");
        const parsed = validated.data;

        const { companyId, paymentRecordId, contentHash, fileSize } = parsed;

        // ── MIME type (ADR-029 D-4) ─────────────────────────────────────────
        if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(parsed.contentType)) {
          throw new UploadRejection("Tipo de archivo no permitido. Use PDF, JPEG, PNG o WebP.");
        }
        const contentType = parsed.contentType as AllowedMimeType;

        // ── Membership + role guard (ADR-004, ADR-006 D-1) ─────────────────
        const member = await prisma.companyMember.findFirst({
          where: { companyId, userId },
          select: { role: true },
        });
        if (!member) throw new UploadRejection("Empresa no encontrada o acceso denegado");
        if (!canAccess(member.role, ROLES.WRITERS)) {
          throw new UploadRejection("No autorizado para adjuntar comprobantes");
        }

        // ── PaymentRecord pertenece a companyId y no está anulado ───────────
        const record = await prisma.paymentRecord.findFirst({
          where: { id: paymentRecordId, companyId },
          select: { deletedAt: true },
        });
        if (!record) throw new UploadRejection("Pago no encontrado o no pertenece a esta empresa");
        if (record.deletedAt !== null) {
          throw new UploadRejection("No se puede adjuntar un comprobante a un pago anulado");
        }

        // ── Máximo 1 adjunto activo por PaymentRecord (ADR-029 D-5) ────────
        const existing = await prisma.paymentAttachment.findFirst({
          where: { paymentRecordId, companyId, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          throw new UploadRejection(
            "Este pago ya tiene un comprobante adjunto. Elimine el actual antes de subir uno nuevo.",
          );
        }

        // ── Pathname aislado por tenant (ADR-004) ───────────────────────────
        // handleUpload firma el token con el pathname del cliente e ignora el del servidor: se valida lo recibido.
        if (!isValidAttachmentPathname(pathname, companyId, paymentRecordId, contentType)) {
          throw new UploadRejection("Ruta de archivo inválida");
        }
        const originalFileName = sanitizeAttachmentFileName(parsed.fileName);

        return {
          // El token queda ligado al tipo y tamaño ya validados, no a toda la lista permitida.
          allowedContentTypes: [contentType],
          maximumSizeInBytes: fileSize,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_TTL_MS,
          tokenPayload: JSON.stringify({
            companyId,
            paymentRecordId,
            contentHash,
            fileSize,
            uploadedBy: userId,
            ipAddress,
            userAgent,
            originalFileName,
          }),
        };
      },

      // ── Fase 2: upload completado ───────────────────────────────────────────
      // Llamado por Vercel Blob CDN. En desarrollo el SDK no registra callback salvo con VERCEL_BLOB_CALLBACK_URL (túnel).
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
  } catch (error) {
    if (error instanceof UploadRejection) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Con sesión un fallo inesperado es nuestro; sin sesión es un callback con firma inválida.
    if (sessionUserId) Sentry.captureException(error);
    else console.warn("[PaymentAttachment] callback rechazado:", error instanceof Error ? error.message : "error desconocido");
    return NextResponse.json(
      { error: "No se pudo procesar la subida" },
      { status: sessionUserId ? 500 : 400 },
    );
  }
}
