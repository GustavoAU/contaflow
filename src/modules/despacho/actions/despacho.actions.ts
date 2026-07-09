"use server";

// ADR-034: Fase Despacho — Server Actions (auth + companyId guard + R-6 IP/UA)
import { revalidatePath } from "next/cache";
import { limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import {
  AddManagedClientSchema,
  ArchiveManagedClientSchema,
  ListManagedClientsSchema,
  UpgradeDespachoTierSchema,
} from "../schemas/despacho.schema";
import {
  canAddManagedClient,
  addManagedClient,
  archiveManagedClient,
  listManagedClients,
  upgradeDespachoTier,
} from "../services/DespachoService";

// ─── getDespachoStatusAction ──────────────────────────────────────────────────

export async function getDespachoStatusAction(companyId: string) {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return { success: false as const, error: ctx.error.error };

  const subscription = await prisma.subscription.findUnique({
    where: { companyId },
    select: { despachoTier: true },
  });

  const { currentCount, limit } = await canAddManagedClient(companyId);

  return {
    success: true as const,
    despachoTier: subscription?.despachoTier ?? null,
    currentCount,
    limit,
  };
}

// ─── listManagedClientsAction ─────────────────────────────────────────────────

export async function listManagedClientsAction(companyId: string) {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.WRITERS });
  if (!ctx.ok) return { success: false as const, error: ctx.error.error };

  const parsed = ListManagedClientsSchema.safeParse({ companyId });
  if (!parsed.success) return { success: false as const, error: "Parámetros inválidos" };

  const clients = await listManagedClients(companyId);
  const { currentCount, limit } = await canAddManagedClient(companyId);

  return { success: true as const, clients, currentCount, limit };
}

// ─── addManagedClientAction ───────────────────────────────────────────────────

export async function addManagedClientAction(formData: FormData) {
  const raw = {
    companyId: formData.get("companyId") as string,
    rif: (formData.get("rif") as string ?? "").toUpperCase().trim(),
    clientName: (formData.get("clientName") as string ?? "").trim(),
    ciiu: (formData.get("ciiu") as string ?? "").trim() || undefined,
    notes: (formData.get("notes") as string ?? "").trim() || undefined,
  };

  const parsed = AddManagedClientSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => i.message).join(", ");
    return { success: false as const, error: errors };
  }

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return { success: false as const, error: ctx.error.error };

  const result = await addManagedClient(
    parsed.data.companyId,
    { rif: parsed.data.rif, clientName: parsed.data.clientName, ciiu: parsed.data.ciiu, notes: parsed.data.notes },
    ctx.userId,
    ctx.ipAddress,
    ctx.userAgent,
  );

  if (result.success) {
    revalidatePath(`/company/${parsed.data.companyId}/despacho/rifs`);
  }

  return result;
}

// ─── upgradeDespachoTierAction ────────────────────────────────────────────────
// Inicia el checkout del tier Despacho (NOWPayments). Solo OWNER (ADR-034 §6.3).

export async function upgradeDespachoTierAction(input: {
  companyId: string;
  tier: "STARTER" | "PRO" | "UNLIMITED";
}) {
  const parsed = UpgradeDespachoTierSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  // ADR-034 §6.3: gestionar el tier (pago) es exclusivo del Propietario.
  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ["OWNER"],
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return { success: false as const, error: ctx.error.error };

  return upgradeDespachoTier(
    parsed.data.companyId,
    parsed.data.tier,
    ctx.userId,
    ctx.ipAddress,
    ctx.userAgent,
  );
}

// ─── archiveManagedClientAction ───────────────────────────────────────────────

export async function archiveManagedClientAction(formData: FormData) {
  const parsed = ArchiveManagedClientSchema.safeParse({
    companyId: formData.get("companyId"),
    managedClientId: formData.get("managedClientId"),
  });
  if (!parsed.success) return { success: false as const, error: "Parámetros inválidos" };

  const ctx = await requireCompanyAction(parsed.data.companyId, {
    roles: ROLES.ADMIN_ONLY,
    captureNet: true,
  });
  if (!ctx.ok) return { success: false as const, error: ctx.error.error };

  const result = await archiveManagedClient(
    parsed.data.companyId,
    parsed.data.managedClientId,
    ctx.userId,
    ctx.ipAddress,
    ctx.userAgent,
  );

  if (result.success) {
    revalidatePath(`/company/${parsed.data.companyId}/despacho/rifs`);
  }

  return result;
}
