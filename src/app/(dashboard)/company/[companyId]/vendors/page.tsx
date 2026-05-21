// src/app/(dashboard)/company/[companyId]/vendors/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { VendorService } from "@/modules/vendors/services/VendorService";
import { VendorGroupService } from "@/modules/vendors/services/ContactGroupService";
import { VendorList } from "@/modules/vendors/components/VendorList";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

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

  const [vendors, vendorGroups] = await Promise.all([
    VendorService.list(companyId),
    VendorGroupService.list(companyId),
  ]);

  const canWrite  = canAccess(member.role, ROLES.WRITERS);
  const canDelete = canAccess(member.role, ROLES.ADMIN_ONLY);

  const contactosTabs = [
    { label: "Proveedores", href: `/company/${companyId}/vendors` },
    { label: "Clientes",    href: `/company/${companyId}/customers` },
    { label: "CxP",         href: `/company/${companyId}/payables` },
    { label: "CxC",         href: `/company/${companyId}/receivables` },
  ];

  return (
    <div className="mx-auto max-w-6xl py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">
          Directorio de proveedores. Se vinculan opcionalmente a facturas de compra.
        </p>
      </div>

      <ModuleTabs tabs={contactosTabs} color="emerald" />

      <VendorList
        companyId={companyId}
        initialVendors={vendors}
        initialGroups={vendorGroups}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}
