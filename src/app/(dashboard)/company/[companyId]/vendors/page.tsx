// src/app/(dashboard)/company/[companyId]/vendors/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { VendorService } from "@/modules/vendors/services/VendorService";
import { VendorList } from "@/modules/vendors/components/VendorList";

type Props = { params: Promise<{ companyId: string }> };

export default async function VendorsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}`);

  const vendors = await VendorService.list(companyId);

  const canWrite  = canAccess(member.role, ROLES.WRITERS);
  const canDelete = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8 px-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href={`/company/${companyId}`} className="hover:text-zinc-800">Inicio</Link>
          <span>›</span>
          <span>Proveedores</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">
          Directorio de proveedores. Se vinculan opcionalmente a facturas de compra.
        </p>
      </div>

      <VendorList
        companyId={companyId}
        initialVendors={vendors}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}
