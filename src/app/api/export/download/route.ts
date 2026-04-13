import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

// GET /api/export/download?jobId=<id>
// CRITICAL-1: verifies job.createdBy === clerkUserId + companyId membership
// MEDIUM-2: checks expiresAt
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return new NextResponse("jobId requerido", { status: 400 });
  }

  const job = await prisma.exportJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      companyId: true,
      createdBy: true,
      status: true,
      fileData: true,
      fileSize: true,
      expiresAt: true,
      dateFrom: true,
      dateTo: true,
    },
  });

  if (!job) {
    return new NextResponse("Exportación no encontrada", { status: 404 });
  }

  // CRITICAL-1: ownership check — createdBy must match current user
  if (job.createdBy !== userId) {
    return new NextResponse("Acceso denegado", { status: 403 });
  }

  // Additional: verify company membership (defense in depth)
  const member = await prisma.companyMember.findFirst({
    where: { companyId: job.companyId, userId },
    select: { role: true },
  });
  if (!member) {
    return new NextResponse("Acceso denegado", { status: 403 });
  }

  if (job.status !== "DONE") {
    return new NextResponse(
      job.status === "ERROR" ? "Error al generar la exportación" : "Exportación en proceso",
      { status: 409 }
    );
  }

  // MEDIUM-2: expiry check
  if (job.expiresAt && job.expiresAt < new Date()) {
    return new NextResponse("El enlace de descarga ha expirado", { status: 410 });
  }

  if (!job.fileData) {
    return new NextResponse("Archivo no disponible", { status: 404 });
  }

  const from = job.dateFrom.toISOString().split("T")[0];
  const to = job.dateTo.toISOString().split("T")[0];
  const filename = `contaflow-export-${from}-${to}.zip`;

  return new NextResponse(job.fileData, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(job.fileSize ?? job.fileData.length),
      "Cache-Control": "no-store",
    },
  });
}
