// src/modules/invoices/actions/invoice-contacts.actions.ts
// Autocompletado de contraparte en InvoiceForm — busca en Vendor + Customer por RIF o nombre
"use server";

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export type ContactSuggestion = {
  rif: string;
  name: string;
  address: string | null;
  isSpecialContributor: boolean;
  source: "vendor" | "customer";
};

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function searchContactsByRifAction(
  companyId: string,
  query: string
): Promise<ActionResult<ContactSuggestion[]>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const q = query.trim();
    if (!companyId || q.length < 2) return { success: true, data: [] };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!member) return { success: false, error: "Acceso denegado" };

    const [vendors, customers] = await Promise.all([
      prisma.vendor.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [
            { rif: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { rif: true, name: true, address: true, isSpecialContributor: true },
        take: 5,
      }),
      prisma.customer.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [
            { rif: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { rif: true, name: true, address: true },
        take: 5,
      }),
    ]);

    // isSpecialContributor existe en Vendor pero no en Customer (solo aplica retención a proveedores)
    const results: ContactSuggestion[] = [
      ...vendors
        .filter((v) => v.rif)
        .map((v) => ({ rif: v.rif!, name: v.name, address: v.address ?? null, isSpecialContributor: v.isSpecialContributor, source: "vendor" as const })),
      ...customers
        .filter((c) => c.rif)
        .map((c) => ({ rif: c.rif!, name: c.name, address: c.address ?? null, isSpecialContributor: false, source: "customer" as const })),
    ].slice(0, 8);

    return { success: true, data: results };
  } catch (e) {
    console.error("searchContactsByRifAction:", e);
    return { success: false, error: "Error al buscar contactos" };
  }
}
