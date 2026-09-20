// src/modules/payments/services/PaymentAttachmentService.ts
// ADR-029: Adjuntos de comprobante de pago
// Contenido en Vercel Blob — solo metadatos + contentHash en BD (R-2)

import prisma from "@/lib/prisma";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type AttachmentUploadPayload = {
  companyId: string;
  paymentRecordId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobUrl: string;
  blobKey: string;
  contentHash: string;
  uploadedBy: string;
  ipAddress: string | null; // R-6
  userAgent: string | null; // R-6
};

export type AttachmentSummary = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  uploadedBy: string;
  uploadedAt: Date;
  deletedAt: Date | null;
};

// ─── Constantes de seguridad (D-4) — re-exportadas desde constants (sin Prisma) ─
export {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_BYTES,
  type AllowedMimeType,
} from "@/modules/payments/constants/payment-attachment.constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serialize(
  row: import("@prisma/client").PaymentAttachment,
): AttachmentSummary {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
    deletedAt: row.deletedAt,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const PaymentAttachmentService = {
  /**
   * Persiste los metadatos del adjunto tras guardar el archivo en el Blob privado.
   * Llamado exclusivamente desde la ruta POST /api/payments/attachments/upload.
   *
   * Idempotente: P2002 en @@unique([companyId, blobKey]) → "ya registrado".
   */
  async persistAttachmentMetadata(
    payload: AttachmentUploadPayload,
  ): Promise<AttachmentSummary> {
    return await prisma.$transaction(async (tx) => {
      // ADR-029 D-5 también aquí: un token reutilizado dentro de su vigencia sube otro blob y dispara otro callback.
      // Bloqueo de fila del pago: bajo ReadCommitted dos callbacks simultáneos verían "ninguno activo" e insertarían ambos.
      await tx.$executeRaw`SELECT id FROM "PaymentRecord" WHERE id = ${payload.paymentRecordId} AND "companyId" = ${payload.companyId} FOR UPDATE`;
      const active = await tx.paymentAttachment.findFirst({
        where: {
          paymentRecordId: payload.paymentRecordId,
          companyId: payload.companyId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (active) throw new Error("Este pago ya tiene un comprobante adjunto");

      let attachment;
      try {
        attachment = await tx.paymentAttachment.create({
          data: {
            companyId: payload.companyId,
            paymentRecordId: payload.paymentRecordId,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            sizeBytes: payload.sizeBytes,
            blobUrl: payload.blobUrl,
            blobKey: payload.blobKey,
            contentHash: payload.contentHash,
            uploadedBy: payload.uploadedBy,
          },
        });
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code === "P2002") {
          // idempotencia: webhook duplicado de Vercel Blob
          throw new Error("El comprobante ya fue registrado");
        }
        throw e;
      }

      // AuditLog — R-6
      await tx.auditLog.create({
        data: {
          companyId: payload.companyId,
          entityName: "PaymentAttachment",
          entityId: attachment.id,
          action: "UPLOAD",
          newValue: {
            blobKey: payload.blobKey,
            fileName: payload.fileName,
            contentHash: payload.contentHash,
          },
          userId: payload.uploadedBy,
          ipAddress: payload.ipAddress ?? null,
          userAgent: payload.userAgent ?? null,
        },
      });

      return serialize(attachment);
    });
  },

  /**
   * Retorna los adjuntos activos de un pago.
   * NUNCA llamar sin companyId — viola ADR-004.
   */
  async getAttachmentsByPaymentRecord(
    paymentRecordId: string,
    companyId: string,
  ): Promise<AttachmentSummary[]> {
    const rows = await prisma.paymentAttachment.findMany({
      where: { paymentRecordId, companyId, deletedAt: null },
      orderBy: { uploadedAt: "asc" },
    });
    return rows.map(serialize);
  },

  /**
   * Soft-delete de un adjunto.
   * El blob permanece en Vercel Blob (evidencia de auditoría — ADR-029 D-6).
   */
  async softDeleteAttachment(
    attachmentId: string,
    companyId: string,
    deletedByUserId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentAttachment.findFirst({
        where: { id: attachmentId, companyId },
      });

      if (!existing) {
        throw new Error(
          "Comprobante no encontrado o no pertenece a esta empresa",
        );
      }
      if (existing.deletedAt !== null) {
        throw new Error("El comprobante ya fue eliminado");
      }

      const now = new Date();
      await tx.paymentAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: now, deletedBy: deletedByUserId },
      });

      // AuditLog — R-6
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PaymentAttachment",
          entityId: attachmentId,
          action: "DELETE",
          oldValue: { blobKey: existing.blobKey, fileName: existing.fileName },
          newValue: { deletedAt: now.toISOString() },
          userId: deletedByUserId,
          ipAddress,
          userAgent,
        },
      });
    });
  },
};
