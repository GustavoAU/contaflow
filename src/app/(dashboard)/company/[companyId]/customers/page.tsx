// src/app/(dashboard)/company/[companyId]/customers/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { CustomerService } from "@/modules/vendors/services/CustomerService";
import { CustomerGroupService } from "@/modules/vendors/services/ContactGroupService";
import { CustomerList } from "@/modules/vendors/components/CustomerList";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

type Props = { params: Promise<{ companyId: string }> };

export default async function CustomersPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}`);

  const [customers, customerGroups] = await Promise.all([
    CustomerService.list(companyId),
    CustomerGroupService.list(companyId),
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
    <div className="mx-auto max-w-4xl py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Directorio de clientes. Se vinculan opcionalmente a facturas de venta.
        </p>
      </div>

      <ModuleTabs tabs={contactosTabs} color="emerald" />

      <CustomerList
        companyId={companyId}
        initialCustomers={customers}
        initialGroups={customerGroups}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}
