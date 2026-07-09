"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction, type GuardContext } from "@/lib/action-guard";
import { CertificateService, type CertificateStatusDTO } from "../services/CertificateService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Schemas ───────────────────────────────────────────────────────────────────

const GenerateDemoCertSchema = z.object({
  companyId: z.string().min(1),
});

const UploadCertificateSchema = z.object({
  companyId: z.string().min(1),
  // base64 del .p12 — máximo 100 KB (base64 ~33% overhead → 136_000 chars)
  p12Base64: z.string().min(1).max(136_000, { error: "El archivo .p12 no puede superar 100 KB" }),
});

const GetCertStatusSchema = z.object({
  companyId: z.string().min(1),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

type CertGuardResult = { ctx: GuardContext } | { success: false; error: string };

// Guards the two write-only ADMIN actions (generate + upload) — includes rate limit.
async function guardAdminCert(companyId: string): Promise<CertGuardResult> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  return { ctx };
}

// ─── generateDemoCertificateAction ────────────────────────────────────────────

export async function generateDemoCertificateAction(
  input: unknown,
): Promise<ActionResult<{ thumbprint: string; expiresAt: Date; isSelfSigned: true }>> {
  const parsed = GenerateDemoCertSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const g = await guardAdminCert(parsed.data.companyId);
  if ("success" in g) return g;

  try {
    const company = await prisma.company.findUnique({
      where: { id: parsed.data.companyId },
      select: { name: true, rif: true },
    });
    if (!company) return { success: false, error: "Empresa no encontrada" };

    const result = await prisma.$transaction(async (tx) => {
      return CertificateService.generateSelfSigned(
        tx,
        parsed.data.companyId,
        company.name,
        company.rif ?? "",
        g.ctx.userId,
        g.ctx.ipAddress,
        g.ctx.userAgent,
      );
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── uploadOfficialCertificateAction ──────────────────────────────────────────

export async function uploadOfficialCertificateAction(
  input: unknown,
): Promise<ActionResult<{ thumbprint: string; expiresAt: Date; issuedBy: string; isSelfSigned: false }>> {
  const parsed = UploadCertificateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const g = await guardAdminCert(parsed.data.companyId);
  if ("success" in g) return g;

  try {
    const p12Buffer = Buffer.from(parsed.data.p12Base64, "base64");
    if (p12Buffer.length > 100_000) {
      return { success: false, error: "El archivo .p12 no puede superar 100 KB" };
    }

    const result = await prisma.$transaction(async (tx) => {
      return CertificateService.loadOfficialCertificate(
        tx,
        parsed.data.companyId,
        p12Buffer,
        g.ctx.userId,
        g.ctx.ipAddress,
        g.ctx.userAgent,
      );
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── getCertificateStatusAction ────────────────────────────────────────────────

export async function getCertificateStatusAction(
  input: unknown,
): Promise<ActionResult<CertificateStatusDTO>> {
  const parsed = GetCertStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    // VIEWER no accede (solo lectura de estado de certificado requiere ACCOUNTANT+)
    const ctx = await requireCompanyAction(parsed.data.companyId, { roles: ROLES.WRITERS });
    if (!ctx.ok) return ctx.error;

    const data = await CertificateService.getCertificateStatus(parsed.data.companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}
