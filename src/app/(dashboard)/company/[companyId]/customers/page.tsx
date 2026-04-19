// src/app/(dashboard)/company/[companyId]/customers/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { CustomerService } from "@/modules/vendors/services/CustomerService";
import { CustomerList } from "@/modules/vendors/components/CustomerList";

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

  const customers = await CustomerService.list(companyId);

  const canWrite  = canAccess(member.role, ROLES.WRITERS);
  const canDelete = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8 px-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href={`/company/${companyId}`} className="hover:text-zinc-800">Inicio</Link>
          <span>›</span>
          <span>Clientes</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Directorio de clientes. Se vinculan opcionalmente a facturas de venta.
        </p>
      </div>

      <CustomerList
        companyId={companyId}
        initialCustomers={customers}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}
