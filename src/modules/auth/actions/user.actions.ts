// src/modules/auth/actions/user.actions.ts
"use server";

import { currentUser } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function syncUserAction() {
  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const user = await prisma.user.upsert({
      where: { id: clerkUser.id },
      update: {
        name: clerkUser.fullName,
        email: clerkUser.emailAddresses[0].emailAddress,
      },
      create: {
        id: clerkUser.id,
        name: clerkUser.fullName,
        email: clerkUser.emailAddresses[0].emailAddress,
      },
    });

    return user;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ADR-004-EXCEPTION: cross-company intencional — lista empresas del usuario por status
// (company switcher y panel de archivadas necesitan ver todas las empresas del usuario)
async function getCompaniesByStatus(status: "ACTIVE" | "ARCHIVED") {
  const clerkUser = await currentUser();
  if (!clerkUser) return [];

  const memberships = await prisma.companyMember.findMany({
    where: { userId: clerkUser.id, company: { status } },
    include: { company: true },
    orderBy: { company: { name: "asc" } },
  });

  return memberships.map((m) => ({ ...m.company, role: m.role }));
}

// ─── Acciones públicas ────────────────────────────────────────────────────────

export async function getUserCompaniesAction() {
  try {
    return await getCompaniesByStatus("ACTIVE");
  } catch {
    // Neon cold start u otro error de conexión — el layout recibe [] y
    // redirige a /dashboard; la UI muestra "reconectando" en lugar de crashear.
    return [];
  }
}

export async function getArchivedCompaniesAction() {
  try {
    return await getCompaniesByStatus("ARCHIVED");
  } catch {
    return [];
  }
}
