// src/app/api/payments/attachments/upload/route.ts
// ADR-029 / ADR-047: el comprobante llega a ESTA ruta (multipart) y el servidor lo guarda en el store Blob PRIVADO.
// No hay subida directa desde el navegador ni callback de Vercel: el servidor valida el contenido real, calcula el
// SHA-256 (R-2), fija la ruta y registra en BD en la misma petición. Tope de cuerpo de una Vercel Function: 4,5 MB.

import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { toActionError } from "@/lib/action-errors";
import { deletePrivateBlob, isPrivateBlobConfigured, putPrivateBlob } from "@/lib/private-blob";
import { PaymentAttachmentService } from "@/modules/payments/services/PaymentAttachmentService";
import {
  MAX_SIZE_BYTES,
  MAX_SIZE_MB,
  buildAttachmentPathname,
  attachmentFileNameFor,
  detectAttachmentMime,
} from "@/modules/payments/constants/payment-attachment.constants";

export const runtime = "nodejs";
export const maxDuration = 30;

// Los ids vienen del navegador: sin tipos estrictos, un objeto se colaría en los where de Prisma como filtro.
const ID_RE = /^[A-Za-z0-9_-]+$/;
const FieldsSchema = z.object({
  companyId: z.string().min(1).max(64).regex(ID_RE),
  paymentRecordId: z.string().min(1).max(64).regex(ID_RE),
});

// Margen sobre el tope del archivo para los delimitadores del multipart.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const reject = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

// ─── POST /api/payments/attachments/upload ────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isPrivateBlobConfigured()) return reject("Adjuntos no disponibles en esta configuración", 503);

  // Defensa en profundidad además de SameSite: el navegador marca las peticiones que vienen de otro sitio.
  if (request.headers.get("sec-fetch-site") === "cross-site") return reject("Solicitud no permitida", 403);

  // Sin sesión no se lee el cuerpo.
  const { userId } = await auth();
  if (!userId) return reject("No autorizado", 401);

  // Límite por USUARIO y ANTES de leer el cuerpo: companyId sale del formulario y aún no está autorizado, así que un
  // límite por (empresa x usuario) se elude rotando ids, y cada intento parsearía hasta 4,5 MB.
  const rl = await checkRateLimit(`user:${userId}`, limiters.fiscal);
  if (!rl.allowed) return reject(rl.error ?? "Demasiadas solicitudes. Intenta de nuevo más tarde.", 429);

  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) return reject("Solicitud inválida", 400);
    if (declaredLength > MAX_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return reject(`El archivo supera el límite de ${MAX_SIZE_MB} MB.`, 413);
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject("Solicitud inválida", 400);
  }
  const fields = FieldsSchema.safeParse({
    companyId: form.get("companyId"),
    paymentRecordId: form.get("paymentRecordId"),
  });
  const file = form.get("file");
  if (!fields.success || !(file instanceof File)) return reject("Solicitud inválida", 400);
  if (file.size < 1) return reject("El archivo está vacío.", 400);
  if (file.size > MAX_SIZE_BYTES) return reject(`El archivo supera el límite de ${MAX_SIZE_MB} MB.`, 413);
  const { companyId, paymentRecordId } = fields.data;

  // Membresía + rol + IP/UA (ADR-004, ADR-041, R-6). companyId sale del formulario: aquí se autoriza.
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS, captureNet: true });
  if (!ctx.ok) return reject(ctx.error.error, 403);

  // El pago pertenece a la empresa y no está anulado (ADR-004).
  const record = await prisma.paymentRecord.findFirst({
    where: { id: paymentRecordId, companyId },
    select: { deletedAt: true },
  });
  if (!record) return reject("Pago no encontrado o no pertenece a esta empresa", 404);
  if (record.deletedAt !== null) return reject("No se puede adjuntar un comprobante a un pago anulado", 409);

  // Máximo 1 adjunto activo por pago (ADR-029 D-5); el servicio lo vuelve a comprobar bajo bloqueo de fila.
  const existing = await prisma.paymentAttachment.findFirst({
    where: { paymentRecordId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return reject("Este pago ya tiene un comprobante adjunto. Elimine el actual antes de subir uno nuevo.", 409);
  }

  // El tipo se decide por los bytes, no por lo que declare el navegador.
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = detectAttachmentMime(bytes);
  if (!mimeType) return reject("Tipo de archivo no permitido. Use PDF, JPEG, PNG o WebP.", 415);

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const pathname = buildAttachmentPathname(companyId, paymentRecordId, mimeType, randomUUID());

  let blob: Awaited<ReturnType<typeof putPrivateBlob>>;
  try {
    blob = await putPrivateBlob(pathname, bytes, mimeType);
  } catch (error) {
    Sentry.captureException(error);
    return reject("No se pudo guardar el archivo. Intenta de nuevo.", 502);
  }

  try {
    const attachment = await PaymentAttachmentService.persistAttachmentMetadata({
      companyId,
      paymentRecordId,
      fileName: attachmentFileNameFor(file.name, mimeType),
      mimeType,
      sizeBytes: bytes.length,
      blobUrl: blob.url,
      blobKey: blob.pathname,
      contentHash,
      uploadedBy: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return NextResponse.json({ success: true, attachmentId: attachment.id });
  } catch (error) {
    // Sin fila en BD el blob quedaría huérfano y sin dueño.
    await deletePrivateBlob(blob.url).catch((cleanupError) => Sentry.captureException(cleanupError));
    Sentry.captureException(error);
    const failure = toActionError(error);
    return reject(failure.success ? "No se pudo registrar el comprobante" : failure.error, 409);
  }
}
