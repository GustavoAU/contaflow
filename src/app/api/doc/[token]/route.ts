// src/app/api/doc/[token]/route.ts
// Q3-1: Endpoint público para descarga de documentos compartidos.
// Autenticación: JWT firmado con DOC_SHARE_SECRET (sin Clerk).
// No requiere sesión — el token es la credencial.
// ADR-004: companyId embebido en el token + guard en DB query.

import { NextRequest } from "next/server";
import { verifyDocShareToken } from "@/lib/document-share-jwt";
import { DocumentService } from "@/modules/documents/services/DocumentService";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  // N6: rate limit por IP — ruta pública sin auth (30/min)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const rl = await checkRateLimit(`doc:${ip}`, limiters.publicDoc);
  if (!rl.allowed) {
    return new Response("Demasiadas solicitudes.", { status: 429 });
  }

  const { token } = await params;

  // 1. Validar token — firma + expiración
  const payload = verifyDocShareToken(token);
  if (!payload) {
    return new Response("Enlace inválido o expirado.", { status: 401 });
  }

  try {
    // 2. Verificar que el token no fue revocado (M6)
    const record = await prisma.docShareToken.findUnique({
      where: { jti: payload.jti },
      select: { revokedAt: true },
    });
    if (!record || record.revokedAt !== null) {
      return new Response("Enlace revocado.", { status: 401 });
    }
    // 3. Generar PDF según tipo — companyId del token como guard ADR-004
    let pdfBuffer: Buffer | null = null;
    let filename: string;

    if (payload.typ === "INVOICE") {
      pdfBuffer = await DocumentService.generateInvoicePDFBuffer(payload.did, payload.cid);
      filename = `factura-${payload.did.slice(-8)}.pdf`;
    } else if (payload.typ === "RETENTION") {
      pdfBuffer = await DocumentService.generateRetentionPDFBuffer(payload.did, payload.cid);
      filename = `retencion-${payload.did.slice(-8)}.pdf`;
    } else {
      return new Response("Tipo de documento no soportado.", { status: 400 });
    }

    if (!pdfBuffer) {
      return new Response("Documento no encontrado.", { status: 404 });
    }

    // 4. Retornar PDF como descarga (Content-Disposition: attachment)
    // Convertir Buffer de Node.js a Uint8Array para compatibilidad con BodyInit
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Caché: no cachear — PDFs pueden ser revocados lógicamente (void)
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Error al generar el documento.", { status: 500 });
  }
}
