// src/modules/company/services/MemberService.ts
import prisma from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

export type MemberRow = {
  id: string;
  userId: string;
  role: UserRole;
  user: { id: string; name: string | null; email: string };
};

// ─── Listar miembros ──────────────────────────────────────────────────────────

export async function listMembers(companyId: string): Promise<MemberRow[]> {
  return prisma.companyMember.findMany({
    where: { companyId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ role: "asc" }],
  });
}

// ─── Agregar miembro ─────────────────────────────────────────────────────────

export async function addMember(
  companyId: string,
  email: string,
  role: UserRole,
  actorUserId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  if (role === "OWNER") {
    throw new Error("No se puede asignar el rol de Propietario.");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw new Error(
      "Usuario no encontrado. Pídele que inicie sesión en ContaFlow primero."
    );
  }

  const existing = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  if (existing) {
    throw new Error("Este usuario ya es miembro de la empresa.");
  }

  return prisma.$transaction(async (tx) => {
    const member = await tx.companyMember.create({
      data: { userId: user.id, companyId, role },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: member.id,
        entityName: "CompanyMember",
        action: "ADD_MEMBER",
        userId: actorUserId,
        ipAddress,
        userAgent,
        newValue: { email: normalizedEmail, role, memberId: member.id } as object,
      },
    });

    return member;
  });
}

// ─── Actualizar rol ───────────────────────────────────────────────────────────

export async function updateMemberRole(
  companyId: string,
  targetUserId: string,
  role: UserRole,
  actorUserId: string
) {
  if (role === "OWNER") {
    throw new Error("No se puede asignar el rol de Propietario.");
  }
  if (targetUserId === actorUserId) {
    throw new Error("No puedes cambiar tu propio rol.");
  }

  // ADR-004: companyId obligatorio para evitar cross-tenant
  const member = await prisma.companyMember.findFirst({
    where: { userId: targetUserId, companyId },
  });
  if (!member) throw new Error("Miembro no encontrado.");
  if (member.role === "OWNER") {
    throw new Error("No se puede modificar el rol del Propietario.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.companyMember.update({
      where: { userId_companyId: { userId: targetUserId, companyId } },
      data: { role },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: updated.id,
        entityName: "CompanyMember",
        action: "UPDATE_ROLE",
        userId: actorUserId,
        ipAddress: null,
        userAgent: null,
        oldValue: { role: member.role } as object,
        newValue: { role } as object,
      },
    });

    return updated;
  });
}

// ─── Eliminar miembro ─────────────────────────────────────────────────────────

export async function removeMember(
  companyId: string,
  targetUserId: string,
  actorUserId: string,
  ipAddress: string | null = null,
  userAgent: string | null = null
) {
  if (targetUserId === actorUserId) {
    throw new Error("No puedes eliminarte a ti mismo.");
  }

  // ADR-004: companyId obligatorio para evitar cross-tenant
  const member = await prisma.companyMember.findFirst({
    where: { userId: targetUserId, companyId },
    include: { user: { select: { email: true } } },
  });
  if (!member) throw new Error("Miembro no encontrado.");
  if (member.role === "OWNER") {
    throw new Error("No se puede eliminar al Propietario de la empresa.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.companyMember.delete({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        entityId: member.id,
        entityName: "CompanyMember",
        action: "REMOVE_MEMBER",
        userId: actorUserId,
        ipAddress,
        userAgent,
        newValue: {
          removedUserId: targetUserId,
          email: member.user.email,
          role: member.role,
        } as object,
      },
    });
  });
}
