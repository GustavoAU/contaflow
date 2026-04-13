"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { CreateExportJobSchema } from "../schemas/export.schema";
import { generateExportZip } from "../services/ExportService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear y ejecutar job de exportación ─────────────────────────────────────

export async function createExportJobAction(
  input: unknown
): Promise<ActionResult<{ jobId: string }>> {
  const parsed = CreateExportJobSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { companyId, dateFrom, dateTo } = parsed.data;

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // Rate limit — MEDIUM-2: exports son costosos
    const rl = await checkRateLimit(userId, limiters.export);
    if (!rl.allowed) return { success: false, error: (rl as { allowed: false; error: string }).error };

    // CRITICAL-1: cross-tenant guard — verifica membresía
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (member.role === "VIEWER") return { success: false, error: "Sin permisos para exportar" };

    // MEDIUM-1: bloquear exports concurrentes por empresa
    const inProgress = await prisma.exportJob.findFirst({
      where: {
        companyId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      select: { id: true },
    });
    if (inProgress) {
      return {
        success: false,
        error: "Ya existe una exportación en proceso para esta empresa. Intenta de nuevo en unos minutos.",
      };
    }

    // Crear el job en PROCESSING (sincrónico — generamos en el mismo request)
    const job = await prisma.exportJob.create({
      data: {
        companyId,
        createdBy: userId,
        status: "PROCESSING",
        dateFrom,
        dateTo,
      },
      select: { id: true },
    });

    try {
      // CRITICAL-2: todas las queries dentro del service reciben companyId explícito
      const { data, sizeBytes } = await generateExportZip({ companyId, dateFrom, dateTo });

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h

      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          fileData: data as unknown as Uint8Array<ArrayBuffer>,
          fileSize: sizeBytes,
          expiresAt,
        },
      });
    } catch (genError) {
      await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: "ERROR",
          errorMsg:
            genError instanceof Error ? genError.message : "Error desconocido",
        },
      });
      throw genError;
    }

    revalidatePath("/export");
    return { success: true, data: { jobId: job.id } };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Error desconocido")) {
      return { success: false, error: error.message };
    }
    console.error("[createExportJobAction]", error);
    return { success: false, error: "Error al generar la exportación" };
  }
}

// ─── Listar jobs recientes del usuario para una empresa ───────────────────────

export async function listExportJobsAction(
  companyId: string
): Promise<ActionResult<Array<{
  id: string;
  status: string;
  dateFrom: Date;
  dateTo: Date;
  fileSize: number | null;
  expiresAt: Date | null;
  createdAt: Date;
}>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // CRITICAL-1: verify membership
    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Acceso denegado" };

    const jobs = await prisma.exportJob.findMany({
      where: { companyId, createdBy: userId },
      select: {
        id: true,
        status: true,
        dateFrom: true,
        dateTo: true,
        fileSize: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return { success: true, data: jobs };
  } catch (error) {
    console.error("[listExportJobsAction]", error);
    return { success: false, error: "Error al obtener historial de exportaciones" };
  }
}
