// src/modules/auth/actions/user.actions.ts
"use server";

import { currentUser } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function syncUserAction() {
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
}

export async function getUserCompaniesAction() {
  const clerkUser = await currentUser();
  if (!clerkUser) return [];

  const memberships = await prisma.companyMember.findMany({
    where: { userId: clerkUser.id },
    include: { company: true },
    orderBy: { company: { name: "asc" } },
  });

  return memberships.map((m) => ({
    ...m.company,
    role: m.role,
  }));
}
