// src/app/api/company/[companyId]/payments/attachments/[attachmentId]/download/route.ts
// Descarga de un comprobante de pago guardado en el Blob PRIVADO (ADR-047). Mismo patrón que el libro fiscal:
// autentica, comprueba pertenencia y hace stream con get(); la URL del blob no es accesible desde el navegador.

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { getPrivateBlob } from "@/lib/private-blob";
import {
  ALLOWED_MIME_TYPES,
  isValidAttachmentPathname,
} from "@/modules/payments/constants/payment-attachment.constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Nombre ASCII de respaldo + el real codificado (RFC 5987): nunca se inserta texto libre en la cabecera.
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]+/g, "_") || "comprobante";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ companyId: string; attachmentId: string }> },
): Promise<Response> {
  const { companyId, attachmentId } = await params;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Clave por usuario: companyId viene de la URL y aún no está autorizado; rotarlo no debe eludir el límite.
  const rl = await checkRateLimit(`user:${userId}`, limiters.read);
  if (!rl.allowed) return NextResponse.json({ error: rl.error }, { status: 429 });

  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
  if (!ctx.ok) return NextResponse.json({ error: ctx.error.error }, { status: 403 });

  // ADR-004: companyId en el where. Un id de otra empresa da 404, no 403: no confirma que exista.
  const attachment = await prisma.paymentAttachment.findFirst({
    where: { id: attachmentId, companyId, deletedAt: null },
    select: { paymentRecordId: true, blobKey: true, fileName: true, mimeType: true, contentHash: true },
  });
  if (!attachment) return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });

  if (!isValidAttachmentPathname(attachment.blobKey, companyId, attachment.paymentRecordId)) {
    Sentry.captureMessage("PaymentAttachment.blobKey fuera del prefijo de su pago", {
      level: "error",
      tags: { companyId, attachmentId },
    });
    return NextResponse.json({ error: "El comprobante no está disponible" }, { status: 404 });
  }

  let result: Awaited<ReturnType<typeof getPrivateBlob>>;
  try {
    result = await getPrivateBlob(attachment.blobKey, req.signal);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 502 });
  }
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "El comprobante no está disponible" }, { status: 404 });
  }

  const contentType = (ALLOWED_MIME_TYPES as readonly string[]).includes(attachment.mimeType)
    ? attachment.mimeType
    : "application/octet-stream";

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(attachment.fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": attachment.contentHash,
    },
  });
}
