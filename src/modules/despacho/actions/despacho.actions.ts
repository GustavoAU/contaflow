"use server";

// ADR-034: Fase Despacho — Server Actions (auth + companyId guard + R-6 IP/UA)
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";
import {
  AddManagedClientSchema,
  ArchiveManagedClientSchema,
  ListManagedClientsSchema,
} from "../schemas/despacho.schema";
import {
  canAddManagedClient,
  addManagedClient,
  archiveManagedClient,
  listManagedClients,
} from "../services/DespachoService";

// ─── Auth context ─────────────────────────────────────────────────────────────

async function getAuthContext() {
  const { userId } = await auth();
  if (!userId) return null;
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { userId, ipAddress, userAgent };
}

async function assertMember(companyId: string, userId: string, allowed = ROLES.WRITERS) {
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) throw new Error("No perteneces a esta empresa");
  if (!canAccess(member.role, allowed)) throw new Error("No autorizado");
}

// ─── getDespachoStatusAction ──────────────────────────────────────────────────

export async function getDespachoStatusAction(companyId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { success: false as const, error: "No autorizado" };

  await assertMember(companyId, ctx.userId);

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
  const ctx = await getAuthContext();
  if (!ctx) return { success: false as const, error: "No autorizado" };

  const parsed = ListManagedClientsSchema.safeParse({ companyId });
  if (!parsed.success) return { success: false as const, error: "Parámetros inválidos" };

  await assertMember(companyId, ctx.userId);

  const clients = await listManagedClients(companyId);
  const { currentCount, limit } = await canAddManagedClient(companyId);

  return { success: true as const, clients, currentCount, limit };
}

// ─── addManagedClientAction ───────────────────────────────────────────────────

export async function addManagedClientAction(formData: FormData) {
  const ctx = await getAuthContext();
  if (!ctx) return { success: false as const, error: "No autorizado" };

  const rl = await checkRateLimit(`despacho-add:${ctx.userId}`, limiters.fiscal);
  if (!rl.allowed) return { success: false as const, error: "Demasiadas solicitudes. Intenta en un minuto." };

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

  await assertMember(parsed.data.companyId, ctx.userId, ROLES.ADMIN_ONLY);

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

// ─── archiveManagedClientAction ───────────────────────────────────────────────

export async function archiveManagedClientAction(formData: FormData) {
  const ctx = await getAuthContext();
  if (!ctx) return { success: false as const, error: "No autorizado" };

  const parsed = ArchiveManagedClientSchema.safeParse({
    companyId: formData.get("companyId"),
    managedClientId: formData.get("managedClientId"),
  });
  if (!parsed.success) return { success: false as const, error: "Parámetros inválidos" };

  await assertMember(parsed.data.companyId, ctx.userId, ROLES.ADMIN_ONLY);

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
