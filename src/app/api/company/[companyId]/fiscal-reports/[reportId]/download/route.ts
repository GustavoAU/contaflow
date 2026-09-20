// src/app/api/company/[companyId]/fiscal-reports/[reportId]/download/route.ts
// Descarga de un libro fiscal guardado en Vercel Blob PRIVADO (ADR-047).
// La URL del blob no es pública: esta ruta autentica, comprueba pertenencia y rol, y hace stream con get().
// La autenticación va AQUÍ, junto al get(), y no en el middleware (recomendación de Vercel para blobs privados).

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { checkRateLimit, limiters, fiscalKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOK_SLUG: Record<string, string> = { LIBRO_VENTAS: "ventas", LIBRO_COMPRAS: "compras" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string; reportId: string }> },
): Promise<Response> {
  const { companyId, reportId } = await params;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.read);
  if (!rl.allowed) return NextResponse.json({ error: rl.error }, { status: 429 });

  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return NextResponse.json({ error: ctx.error.error }, { status: 403 });

  // ADR-004: companyId en el where. Un reportId de otra empresa da 404, no 403: no confirma que exista.
  const report = await prisma.fiscalReport.findFirst({
    where: { id: reportId, companyId },
    select: { blobUrl: true, reportType: true, year: true, month: true, contentHash: true },
  });
  if (!report) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });

  let result: Awaited<ReturnType<typeof get>>;
  try {
    result = await get(report.blobUrl, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 502 });
  }
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "El archivo del reporte no está disponible" }, { status: 404 });
  }

  const slug = BOOK_SLUG[report.reportType] ?? "fiscal";
  const filename = `libro-${slug}-${report.year}-${String(report.month).padStart(2, "0")}.pdf`;

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-Content-SHA256": report.contentHash,
    },
  });
}
